/** Phase 13 §八十七~§九十四：Permission Policy。
 * - 统一 AI Action Category（§八十八）：LOCAL_READ / LOCAL_WRITE / RELATIONSHIP_WRITE / EXTERNAL_WEB / DESTRUCTIVE。
 * - 三态：allow / ask / deny（§八十九）。
 * - 默认策略（§九十）：Delete → deny；写/关系/外网 → ask；本地读/分析 → allow。
 * - Workspace 只能收紧，不能绕过 Global Safety（§九十二）；Feature 不得绕过全局（§九十三/Test 36）。
 * - AI 本身不能更改 Permission（§九十一）。
 * - 纯函数，无 Obsidian 依赖。
 */
import type { AIFeature, AIActionCategory, PermissionValue, WorkspacePermissionPolicy } from "./types";

export const AI_ACTION_CATEGORIES: AIActionCategory[] = [
  "LOCAL_READ",
  "LOCAL_WRITE",
  "RELATIONSHIP_WRITE",
  "EXTERNAL_WEB",
  "DESTRUCTIVE",
];

export const DEFAULT_PERMISSIONS: Record<AIActionCategory, PermissionValue> = {
  LOCAL_READ: "allow",
  LOCAL_WRITE: "ask",
  RELATIONSHIP_WRITE: "ask",
  EXTERNAL_WEB: "ask",
  DESTRUCTIVE: "deny",
};

/** Feature 可声明需要的/可选的动作（§九十三）；本阶段主要用来向用户解释与触发权限提示 */
export const FEATURE_ACTIONS: Partial<Record<AIFeature, { requires: AIActionCategory[]; optional: AIActionCategory[] }>> = {
  translation: { requires: ["LOCAL_READ"], optional: [] },
  writing_academic: { requires: ["LOCAL_READ"], optional: ["EXTERNAL_WEB"] },
  writing_research: { requires: ["LOCAL_READ"], optional: ["EXTERNAL_WEB"] },
  writing_critique: { requires: ["LOCAL_READ"], optional: [] },
  knowledge_refinement: { requires: ["LOCAL_READ"], optional: ["LOCAL_WRITE"] },
  knowledge_processing: { requires: ["LOCAL_READ"], optional: ["LOCAL_WRITE"] },
  relationship_suggestion: { requires: ["LOCAL_READ"], optional: ["RELATIONSHIP_WRITE"] },
  query_exploration: { requires: ["LOCAL_READ"], optional: ["EXTERNAL_WEB"] },
};

/** 生效权限（§九十二/Test 36）：全局 deny 永远保持 deny；Workspace 只能把 allow 收紧为 ask/deny，不能放宽 */
export function effectivePermission(
  action: AIActionCategory,
  globalPolicy: Partial<Record<AIActionCategory, PermissionValue>> = DEFAULT_PERMISSIONS,
  workspacePolicy?: WorkspacePermissionPolicy
): PermissionValue {
  const base: PermissionValue = globalPolicy[action] ?? "ask";
  const wsValue = (() => {
    if (workspacePolicy) {
      if (action === "EXTERNAL_WEB" && workspacePolicy.web) return workspacePolicy.web;
      if (action === "LOCAL_WRITE" && workspacePolicy.write) return workspacePolicy.write;
      if (action === "RELATIONSHIP_WRITE" && workspacePolicy.relationship) return workspacePolicy.relationship;
    }
    return undefined;
  })();
  if (base === "deny") return "deny"; // Global Safety 不可绕过
  if (wsValue === "deny") return "deny";
  if (wsValue === "allow") return "allow"; // 注意：Workspace 只能收紧——但即使 ws 为 allow，仍需 global 允许
  if (base === "ask" || wsValue === "ask") return "ask";
  // base 是 allow 且 ws 未限制 → allow
  if (wsValue === undefined) return "allow";
  return "ask";
}

/** 某 Feature 是否需要「权限提示」（外部 Web 或写操作在 ask 时） */
export function featureActionPrompt(
  feature: AIFeature,
  policy: Partial<Record<AIActionCategory, PermissionValue>> = DEFAULT_PERMISSIONS,
  workspacePolicy?: WorkspacePermissionPolicy
): { action: AIActionCategory; value: PermissionValue }[] {
  const fa = FEATURE_ACTIONS[feature];
  if (!fa) return [];
  const out: { action: AIActionCategory; value: PermissionValue }[] = [];
  for (const a of [...fa.requires, ...fa.optional]) {
    const v = effectivePermission(a, policy, workspacePolicy);
    if (v !== "allow") out.push({ action: a, value: v });
  }
  return out;
}

export function actionLabel(a: AIActionCategory): string {
  const map: Record<AIActionCategory, string> = {
    LOCAL_READ: "读取本地笔记",
    LOCAL_WRITE: "修改笔记",
    RELATIONSHIP_WRITE: "建立知识关系",
    EXTERNAL_WEB: "访问外部网页",
    DESTRUCTIVE: "删除内容",
  };
  return map[a] ?? a;
}
