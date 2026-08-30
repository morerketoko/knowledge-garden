/** Phase 13 §四十三~§五十六：Model Capability Registry。
 * - Capability 不是质量评分（§四十七）：只有 reasoning/writing/translation 等布尔能力，不猜分数。
 * - 来源优先级：用户配置 > Provider metadata > 保守默认（§一百一十五）。
 * - 未知能力 → 显示 Unknown，绝不当作「全部支持」（§一百一十六）。
 * - 纯函数，无 Obsidian 依赖。
 */
import type { AIFeature, AIFeatureRequirement, ModelCapability, ModelMetadata } from "./types";

/** 各 Feature 的能力要求（§四十八/§四十九）：required 不满足 → 阻止（§五十五/§一百一十七） */
export const FEATURE_REQUIREMENTS: Partial<Record<AIFeature, AIFeatureRequirement>> = {
  daily_review: { structuredOutput: "preferred", creativeWriting: "preferred" },
  weekly_review: { structuredOutput: "preferred", creativeWriting: "preferred" },
  monthly_review: { structuredOutput: "preferred", creativeWriting: "preferred" },
  quarterly_review: { structuredOutput: "preferred", creativeWriting: "preferred" },
  daily_curiosity: { reasoning: "preferred", structuredOutput: "required" },
  knowledge_roaming: { reasoning: "preferred", structuredOutput: "required" },
  query_exploration: { reasoning: "required", structuredOutput: "required" },
  anchor_exploration: { reasoning: "required", structuredOutput: "required" },
  knowledge_processing: { structuredOutput: "required" },
  knowledge_refinement: { reasoning: "preferred" },
  monthly_evolution: { reasoning: "required", structuredOutput: "required" },
  quarterly_evolution: { reasoning: "required", structuredOutput: "required" },
  review_question: { reasoning: "preferred" },
  translation: { translation: "required", multilingual: "required" },
  copywriting: { creativeWriting: "required" },
  writing_academic: { reasoning: "required" },
  writing_argument: { reasoning: "required" },
  writing_critique: { reasoning: "required" },
  writing_research: { reasoning: "required", structuredOutput: "preferred" },
  writing_application: { reasoning: "preferred", creativeWriting: "preferred" },
  writing_brainstorm: { reasoning: "preferred", creativeWriting: "required" },
  writing_copy: { creativeWriting: "preferred" },
};

export function featureRequirement(feature: AIFeature): AIFeatureRequirement {
  return FEATURE_REQUIREMENTS[feature] ?? {};
}

/** 合并用户覆盖后的能力（§一百一十五：用户配置 > Provider metadata > 保守默认） */
export function mergedCapabilities(meta: ModelMetadata | undefined): ModelCapability {
  const base: ModelCapability = meta && meta.capabilities ? meta.capabilities : {};
  const overrides = meta && meta.userOverrides ? meta.userOverrides : {};
  return { ...base, ...overrides };
}

/** 能力未知（未声明任何能力且无用户覆盖）→ 保守：视为无能力，而非全部支持（§一百一十六） */
export function capabilitiesUnknown(meta: ModelMetadata | undefined): boolean {
  if (!meta) return true;
  const merged = mergedCapabilities(meta);
  return Object.values(merged).every((v) => v === undefined);
}

/** 能力检查（§五十五/§一百一十七）：required 能力缺失 → 阻止 */
export function checkCapabilities(
  meta: ModelMetadata | undefined,
  feature: AIFeature
): { ok: boolean; missing: string[]; unknown: boolean } {
  const req = featureRequirement(feature);
  const missing: string[] = [];
  const merged = mergedCapabilities(meta);
  const unknown = meta ? Object.values(merged).every((v) => v === undefined) : true;
  if (meta === undefined) {
    // 元数据未知：required 能力无法确认 → 保守阻止（§一百一十六/§一百一十七 精神）
    const reqKeys = Object.keys(req).filter((k) => req[k as keyof AIFeatureRequirement] === "required") as (keyof AIFeatureRequirement)[];
    return { ok: reqKeys.length === 0, missing: reqKeys.map((k) => capabilityKeyLabel(k)), unknown: true };
  }
  for (const [k, v] of Object.entries(req) as [keyof AIFeatureRequirement, "required" | "preferred"][]) {
    if (v === "required") {
      const has = merged[k as keyof ModelCapability];
      if (has !== true) missing.push(capabilityKeyLabel(k));
    }
  }
  return { ok: missing.length === 0, missing, unknown };
}

export function capabilityKeyLabel(k: keyof AIFeatureRequirement): string {
  const map: Record<keyof AIFeatureRequirement, string> = {
    reasoning: "推理能力",
    structuredOutput: "结构化输出",
    longContext: "长上下文",
    translation: "翻译能力",
    multilingual: "多语言能力",
    creativeWriting: "创意写作",
  };
  return map[k] ?? k;
}

export function capabilityLabel(c: ModelCapability): { key: string; label: string; value: boolean }[] {
  const order: { key: keyof ModelCapability; label: string }[] = [
    { key: "reasoning", label: "推理" },
    { key: "structuredOutput", label: "结构化输出" },
    { key: "longContext", label: "长上下文" },
    { key: "vision", label: "视觉" },
    { key: "toolCalling", label: "工具调用" },
    { key: "translation", label: "翻译" },
    { key: "multilingual", label: "多语言" },
    { key: "creativeWriting", label: "创意写作" },
  ];
  return order.filter((o) => c[o.key] !== undefined).map((o) => ({ key: o.key, label: o.label, value: !!c[o.key] }));
}

/** 模型推荐排序（§五十）：Capability match > 成本偏好 > 名称（不按名字排）。分数仅供排序，不做质量评分。 */
export function scoreModelFor(
  meta: ModelMetadata | undefined,
  feature: AIFeature,
  opts?: { preferCost?: "low" | "high" }
): number {
  let score = 0;
  const req = featureRequirement(feature);
  if (!meta) return -1; // 未知模型排最后
  const merged = mergedCapabilities(meta);
  for (const [k, v] of Object.entries(req) as [keyof AIFeatureRequirement, "required" | "preferred"][]) {
    if (v === "required" && merged[k as keyof ModelCapability] === true) score += 4;
    if (v === "preferred" && merged[k as keyof ModelCapability] === true) score += 1;
  }
  // 成本偏好仅作为次级排序（§五十/§五十一：只有配置了成本级别才参与）
  if (meta.pricingHint) {
    if (opts?.preferCost === "low" && meta.pricingHint === "low") score += 2;
    if (opts?.preferCost === "high" && meta.pricingHint === "high") score += 2;
  }
  return score;
}

export function recommendModels(
  metas: ModelMetadata[],
  feature: AIFeature,
  opts?: { preferCost?: "low" | "high" }
): ModelMetadata[] {
  return metas
    .slice()
    .sort((a, b) => scoreModelFor(b, feature, opts) - scoreModelFor(a, feature, opts));
}
