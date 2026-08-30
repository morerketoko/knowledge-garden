/** Phase 13 §六十八~§七十六：Plan Mode。
 * - 不是所有任务都需要 Plan（§六十九）：只用于 Knowledge Refinement / Research / Literature Synthesis / Complex Writing / Multi-step Processing。
 * - 简单功能（翻译一句/润色一句）直接执行（§七十）。
 * - Plan 阶段只读，不执行任何操作、不修改任何文件（§七十二/§一百三十六）。
 * - Plan 也进入 Cache（§七十四）：taskType + contextHash + model + promptVersion。
 * - 用户修改的 Plan 必须进入最终 Prompt（§七十五）。
 * - Plan 不保存 API Key（§七十六）。
 * - 纯函数，无 Obsidian 依赖。
 */
import type { AIFeature } from "./types";
import { fingerprintKey } from "./ai/cache";

export const PLAN_PROMPT_VERSION = "plan-v1";

export const PLAN_FEATURES: AIFeature[] = [
  "knowledge_refinement",
  "knowledge_processing",
  "writing_research",
  "writing_critique",
  "writing_argument",
];

export function requiresPlan(feature: AIFeature): boolean {
  return PLAN_FEATURES.includes(feature);
}

export interface PlanResult {
  feature: AIFeature;
  steps: string[];
}

/** Plan 生成：系统 Prompt（§一百三十五：SKILL 可声明 requiresPlan；第一版只在特定 Feature 开启） */
export function buildPlanSystem(feature: AIFeature, skillInstructions: string): string {
  const parts: string[] = [
    "你是 Knowledge Garden 的「计划生成器」，只产出执行计划，不执行任何操作、不修改任何文件（§七十二/§一百三十六）。",
    "任务类型：" + feature,
    "输出一份分步执行计划（每步一行，最多 8 步），覆盖：分析材料 → 提炼核心 → 区分来源与推论 → 查找相关知识 → 生成输出。",
    "不要声称这是唯一正确方案；计划可以调整（§七十五：用户修改的计划会进入最终请求）。",
  ];
  if (skillInstructions.trim()) {
    parts.push("【当前 Skill 流程，请让计划遵循它】\n" + skillInstructions.trim());
  }
  return parts.join("\n");
}

/** Plan 生成：用户请求（§二十一：可用 Skill 摘要进请求） */
export function buildPlanUserRequest(userInstruction: string, selection: string): string {
  const parts: string[] = [];
  if (selection.trim()) parts.push("材料摘录：\n" + selection.trim().slice(0, 6000));
  parts.push("任务要求：" + (userInstruction.trim() || "（未说明，请按任务类型默认流程）"));
  return parts.join("\n\n");
}

/** Plan Cache Key（§七十四）：feature + contextHash + model + promptVersion */
export function planCacheKey(feature: AIFeature, contextHash: string, model: string): string {
  return fingerprintKey(["plan", "feature:" + feature, "ctx:" + contextHash, "model:" + model, "pv:" + PLAN_PROMPT_VERSION]);
}

/** 解析 Plan 输出：按行取步骤（兼容编号列表） */
export function parsePlanText(raw: string): PlanResult {
  const lines = (raw || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.replace(/^[\d\u2022-]+[.、)）]?\s*/, ""))
    .filter((l) => !/^(计划|plan|步骤|step)/i.test(l));
  return { feature: "knowledge_refinement" as AIFeature, steps: lines.slice(0, 8) };
}

/** 最终请求注入：用户（可能已修改）的计划进入最终 Prompt（§七十五） */
export function buildPlanFinalInstruction(plan: string[]): string {
  return "执行计划（用户确认/修改后的版本）：\n" + plan.map((s, i) => (i + 1) + ". " + s).join("\n");
}
