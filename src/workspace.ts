/** Phase 13 §二~§十五：Knowledge Workspace —— 用户进行某一类知识活动时的「稳定 AI 上下文」。
 * - 复用现有 DiscoveryScope，不复制第二套筛选逻辑（§六）。
 * - Workspace 只引用 AI Profile ID，不允许直接持有 API Key（§十三）。
 * - 纯函数、无 Obsidian 依赖，便于 Node 测试。
 */
import type { DiscoveryScope, KnowledgeWorkspace } from "./types";
import { fingerprintKey } from "./ai/cache";

export const DEFAULT_WORKSPACE_ID = "workspace-default";

/** 内置 Default Workspace（§一百二十九：Migration 后旧行为不变：scope = Global Discovery Scope，profile = Global Default） */
export function defaultWorkspace(
  globalScope: DiscoveryScope | undefined,
  globalProfileId: string | undefined
): KnowledgeWorkspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "默认工作空间",
    description: "跟随全局发现范围与全局默认 AI Profile（由旧配置迁移生成，§一百二十九）",
    discoveryScope: globalScope,
    defaultAIProfileId: globalProfileId,
    skills: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** 当前 Workspace：未设置 → undefined（完全保持现有行为，§九） */
export function resolveWorkspace(
  workspaces: KnowledgeWorkspace[],
  currentWorkspaceId: string | undefined | null
): KnowledgeWorkspace | undefined {
  if (!currentWorkspaceId) return undefined;
  return workspaces.find((w) => w.id === currentWorkspaceId);
}

/** Workspace 实际生效的 Discovery Scope：未设置 → 回退全局（§一百零四） */
export function workspaceScope(
  ws: KnowledgeWorkspace | undefined,
  globalScope: DiscoveryScope | undefined
): DiscoveryScope | undefined {
  return ws && ws.discoveryScope ? ws.discoveryScope : globalScope;
}

/** Workspace 文本指纹：参与缓存 key（§三十七~§四十：Workspace 变化 → Cache Miss，Test 37） */
export function workspaceFingerprint(ws: KnowledgeWorkspace | undefined): string {
  if (!ws) return "ws:none";
  return fingerprintKey([
    "ws:" + ws.id,
    "ws-name:" + ws.name,
    "ws-scope:" + (ws.discoveryScope ? JSON.stringify(ws.discoveryScope) : "none"),
    "ws-profile:" + (ws.defaultAIProfileId || ""),
    "ws-skills:" + (ws.skills || []).slice().sort().join(","),
    "ws-instr:" + (ws.instructions || "").trim(),
  ]);
}

/** Workspace Instructions 文本（§十一/§十二） */
export function workspaceInstructions(ws: KnowledgeWorkspace | undefined): string {
  const t = (ws && ws.instructions ? ws.instructions : "").trim();
  return t || "";
}

/** Workspace → 技能 id 列表（§二十七） */
export function workspaceSkillIds(ws: KnowledgeWorkspace | undefined): string[] {
  return ws && ws.skills ? ws.skills.slice() : [];
}
