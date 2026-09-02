/** Phase 11：功能级模型路由（§六十九~八十一）。
 * - 每个 AI 功能（AIFeature）独立路由：Profile + Model + 参数（temperature/maxTokens/timeout/webEnabled）。
 * - 换 Model / 换 Profile → 该功能 Cache Miss；不同功能之间互不影响（用户特别强调）。
 * - 模型名称一律来自 Profile 配置，代码不写死（§一百九十九）。
 * - 纯函数、无 Obsidian 依赖（便于 Node 测试）。API Key 只进内存路由，绝不写入缓存/日志（§九十二）。
 */
import { fingerprintKey } from "./ai/cache";
import type { AIConfig, AIFeature, AIFunctionConfig, AIFunctionRoute, AIProfile, AIProviderType, KnowledgeWorkspace, ProfileDraft } from "./types";
import { workspaceFingerprint } from "./workspace";

export const DEFAULT_PROFILE_ID = "default";

/** 功能 → 中文显示名（设置页 / 诊断 / 菜单） */
export function featureLabel(feature: AIFeature): string {
  const map: Record<AIFeature, string> = {
    daily_curiosity: "今日知识奇想",
    daily_review: "日复盘",
    weekly_review: "周复盘",
    monthly_review: "月复盘",
    quarterly_review: "季度复盘",
    monthly_evolution: "月度演化",
    quarterly_evolution: "季度演化",
    review_question: "复习问题",
    query_exploration: "Query 探索",
    knowledge_roaming: "今日知识漫游",
    knowledge_processing: "知识处理",
    knowledge_refinement: "知识提炼",
    relationship_suggestion: "关系建议（预留）",
    anchor_exploration: "关联探索",
    translation: "翻译",
    copywriting: "文案生成",
    writing_academic: "写作·学术表达",
    writing_argument: "写作·论证与结构",
    writing_critique: "写作·批判性分析",
    writing_research: "写作·研究问题/文献综合",
    writing_application: "写作·知识迁移/应用",
    writing_brainstorm: "写作·头脑风暴/反方/苏格拉底",
    writing_copy: "写作·普通改写",
    note_exam_generation: "知识考试·生成（§106）",
    note_exam_grading: "知识考试·评分（§106）",
    workbench_ask: "AI 工作台·Ask（本地检索→带来源回答）",
    workbench_deep: "AI 工作台·Knowledge Agent 深度（检索→阅读→证据→综合）",
    workbench_research: "AI 工作台·Research Agent 深度分支",
    research_planning: "AI 工作台·研究计划",
    research_execution: "AI 工作台·研究执行（Agent Loop）",
    project_planning: "AI 工作台·项目定义",
    agent_tool_call: "AI 工作台·工具调用意图",
    source_summarization: "AI 工作台·材料提炼/来源摘要",
  };
  return map[feature] ?? feature;
}

/** 功能 → 对应 AI 缓存类型（§一百零二：新增 translation/copywriting/anchor_exploration） */
export function cacheTypeForFeature(feature: AIFeature): string {
  const map: Record<AIFeature, string> = {
    daily_curiosity: "daily_curiosity",
    daily_review: "daily_review",
    weekly_review: "weekly_review",
    monthly_review: "monthly_review",
    quarterly_review: "quarterly_review",
    monthly_evolution: "monthly_evolution",
    quarterly_evolution: "quarterly_evolution",
    review_question: "review_question",
    query_exploration: "query_exploration",
    knowledge_roaming: "connections",
    knowledge_processing: "knowledge_processing",
    knowledge_refinement: "knowledge_processing",
    relationship_suggestion: "connections",
    anchor_exploration: "anchor_exploration",
    translation: "translation",
    copywriting: "copywriting",
    // Phase 12：写作任务共用 copywriting 缓存池；key 内含 task + 配置指纹（§七十五~七十九）
    writing_academic: "copywriting",
    writing_argument: "copywriting",
    writing_critique: "copywriting",
    writing_research: "copywriting",
    writing_application: "copywriting",
    writing_brainstorm: "copywriting",
    writing_copy: "copywriting",
    note_exam_generation: "note_exam",   // §40：考试生成缓存类型
    note_exam_grading: "exam_grading",   // §108/164：评分缓存类型
    workbench_ask: "workbench_ask",
    workbench_deep: "workbench_deep",
    workbench_research: "workbench_research",
    research_planning: "research_plan",
    research_execution: "research_search",
    project_planning: "project_plan",
    agent_tool_call: "agent_tool_call",
    source_summarization: "research_summary",
  };
  return map[feature] ?? "connections";
}

/** 功能列表（设置页路由矩阵 / 诊断展示用，固定顺序） */
export function allFeatures(): AIFeature[] {
  return [
    "daily_curiosity",
    "knowledge_roaming",
    "query_exploration",
    "anchor_exploration",
    "knowledge_processing",
    "knowledge_refinement",
    "translation",
    "copywriting",
    "daily_review",
    "weekly_review",
    "monthly_review",
    "quarterly_review",
    "monthly_evolution",
    "quarterly_evolution",
    "review_question",
    "relationship_suggestion",
    "writing_academic",
    "writing_argument",
    "writing_critique",
    "writing_research",
    "writing_application",
    "writing_brainstorm",
    "writing_copy",
    "note_exam_generation", // Phase 14：生成考试（§一百零六）
    "note_exam_grading",    // Phase 14：评分（§一百零六）
    "workbench_ask", // Phase 15：Workbench Ask
    "workbench_deep", // Phase 16：Knowledge Agent Deep
    "workbench_research", // Phase 16：Research Agent Deep
    "research_planning", // Phase 15：研究计划
    "research_execution", // Phase 15：研究执行
    "project_planning", // Phase 15：项目定义
    "agent_tool_call", // Phase 15：Agent 工具调用
    "source_summarization", // Phase 15：材料提炼
  ];
}

/** 从旧 settings.ai 自动生成 Default Profile（§一百三十九：升级后自动由旧配置生成，不要求用户重新配置） */
export function defaultProfileFrom(cfg: AIConfig): AIProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: "Default Profile（由旧配置迁移）",
    providerType: "openai_compatible",
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    defaultModel: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeoutSec: cfg.timeoutSec,
  };
}

/** 解析单个功能的路由（§七十六~八十）：
 *  - 功能未配置 → 回退 Default Profile（§一百三十五：配置缺失不能静默使用错误模型；返回空路由交由 UI 提示）
 *  - modelOverride 为空 → Profile.defaultModel（§一百三十八）
 */
export function resolveAIFunctionRoute(
  feature: AIFeature,
  profiles: AIProfile[],
  funcConfigs: AIFunctionConfig[],
  defaultProfileId?: string
): AIFunctionRoute {
  const cfg = funcConfigs.find((c) => c.feature === feature && c.profileId);
  const profileId = (cfg && cfg.profileId) || defaultProfileId || DEFAULT_PROFILE_ID;
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile || !profile.defaultModel || !profile.baseUrl) {
    // §一百三十五：配置缺失 → 空路由（模型为空），调用层提示配置缺失而不是静默用错误模型
    return {
      profileId: profileId || DEFAULT_PROFILE_ID,
      providerType: "openai_compatible",
      baseUrl: "",
      apiKey: "",
      model: "",
      temperature: 0.7,
      maxTokens: 1500,
      timeoutSec: 60,
      webEnabled: false,
    };
  }
  return {
    profileId: profile.id,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: cfg?.modelOverride && cfg.modelOverride.trim() ? cfg.modelOverride.trim() : profile.defaultModel,
    temperature: cfg?.temperatureOverride ?? profile.temperature,
    maxTokens: cfg?.maxTokensOverride ?? profile.maxTokens,
    timeoutSec: cfg?.timeoutOverride ?? profile.timeoutSec,
    webEnabled: !!cfg?.webEnabled,
  };
}

/** 路由指纹（§八十一）：feature + resolved profile + provider + model + 参数。
 *  - 必须包含 feature：同一 Profile 用于不同功能时互不影响缓存；
 *  - 换 profile/换 model/改参数 → 指纹变化 → 该功能 cache miss（用户特别强调：实际路由模型纳入 fingerprint）。 */
export function routeFingerprint(
  feature: AIFeature,
  profiles: AIProfile[],
  funcConfigs: AIFunctionConfig[],
  defaultProfileId?: string
): string {
  const r = resolveAIFunctionRoute(feature, profiles, funcConfigs, defaultProfileId);
  return fingerprintKey([
    "feature:" + feature,
    "dp:" + (defaultProfileId || DEFAULT_PROFILE_ID),
    "profile:" + r.profileId,
    "rev:" + (profiles.find((p) => p.id === r.profileId)?.revision ?? 0),
    "provider:" + r.providerType,
    "baseUrl:" + r.baseUrl,
    "model:" + r.model,
    "t:" + String(r.temperature),
    "mt:" + String(r.maxTokens),
    "to:" + String(r.timeoutSec),
    "web:" + (r.webEnabled ? "1" : "0"),
  ]);
}

/** Phase 13 §五十四/§一百零二：带 Workspace 层路由。
 * 优先级：Temporary Override > Feature Route > Workspace Default > Global Default（§五十四）。
 * - Feature 已配置 → 仍以 Feature 路由为准（§十四：Feature-specific route 高于 Workspace）。
 * - 未配置 → Workspace.defaultAIProfileId（§五）→ 仍无 → 全局 Default Profile。
 * - Workspace 不持有 API Key（§十三），只引用 Profile ID。
 */
export function resolveAIFunctionRouteWithWorkspace(
  feature: AIFeature,
  profiles: AIProfile[],
  funcConfigs: AIFunctionConfig[],
  workspace: KnowledgeWorkspace | undefined,
  temporary?: { profileId?: string; modelOverride?: string },
  defaultProfileId?: string
): AIFunctionRoute {
  const hasFeatureCfg = funcConfigs.some((c) => c.feature === feature && !!c.profileId);
  if (hasFeatureCfg) {
    const r = resolveAIFunctionRoute(feature, profiles, funcConfigs, defaultProfileId);
    if (temporary && temporary.profileId) {
      const p = profiles.find((x) => x.id === temporary.profileId);
      if (p && p.defaultModel && p.baseUrl) {
        return {
          profileId: p.id,
          providerType: p.providerType,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          model: temporary.modelOverride && temporary.modelOverride.trim() ? temporary.modelOverride.trim() : p.defaultModel,
          temperature: p.temperature,
          maxTokens: p.maxTokens,
          timeoutSec: p.timeoutSec,
          webEnabled: false,
        };
      }
    }
    return r;
  }
  const wsProfileId = (workspace && workspace.defaultAIProfileId) || undefined;
  const effectiveProfileId = (temporary && temporary.profileId) || wsProfileId || defaultProfileId || DEFAULT_PROFILE_ID;
  const profile = profiles.find((p) => p.id === effectiveProfileId);
  if (!profile || !profile.defaultModel || !profile.baseUrl) {
    // §一百三十五：配置缺失 → 回退全局默认解析（可能仍为空路由，交由 UI 提示）
    return resolveAIFunctionRoute(feature, profiles, funcConfigs, defaultProfileId);
  }
  return {
    profileId: profile.id,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: temporary && temporary.modelOverride && temporary.modelOverride.trim() ? temporary.modelOverride.trim() : profile.defaultModel,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    timeoutSec: profile.timeoutSec,
    webEnabled: false,
  };
}

/** Phase 13 §一百零二/§一百零三：带 Workspace 指纹的路由指纹（Test 37：Workspace 变化 → Cache Miss）。
 * 同时保留 feature/profile/provider/model/参数（§八十一：换模型/换参数 → miss）。 */
export function routeFingerprintWithWorkspace(
  feature: AIFeature,
  profiles: AIProfile[],
  funcConfigs: AIFunctionConfig[],
  workspace: KnowledgeWorkspace | undefined,
  temporary?: { profileId?: string; modelOverride?: string },
  defaultProfileId?: string
): string {
  const r = resolveAIFunctionRouteWithWorkspace(feature, profiles, funcConfigs, workspace, temporary, defaultProfileId);
  const prof = profiles.find((p) => p.id === r.profileId);
  return fingerprintKey([
    "feature:" + feature,
    "ws:" + workspaceFingerprint(workspace),
    "dp:" + (defaultProfileId || DEFAULT_PROFILE_ID),
    "profile:" + r.profileId,
    "rev:" + (prof && typeof prof.revision === "number" ? prof.revision : 0),
    "provider:" + r.providerType,
    "baseUrl:" + r.baseUrl,
    "model:" + r.model,
    "t:" + String(r.temperature),
    "mt:" + String(r.maxTokens),
    "to:" + String(r.timeoutSec),
    "web:" + (r.webEnabled ? "1" : "0"),
  ]);
}

/**** Phase 13.5 Profile CRUD 纯函数（§87/88/11/12/47/48） ****/

/** 简短唯一 id（copyProfileTemplate 生成新 Profile ID，§97：B ID 必须不同） */
export function newProfileId(): string {
  return "prof-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 表单校验（§87：统一 validateProfileDraft，尽量纯函数）。返回错误文案列表；空数组 = 通过。
 *  §24: Base URL trim + 基础格式（不过度严格 whitelist，允许自定义 endpoint）；
 *  §25: 默认模型必填（当前不允许动态模型）；§26: temperature 按 provider 范围 0-2；
 *  §27/28: maxTokens / timeout 必须为正整数；§88: 至少覆盖 missing name / missing model /
 *  invalid timeout / invalid temperature / blank Base URL。
 *  API Key 允许为空（§64：未完成配置允许保存，仅标记 ⚠ 不完整），create 模式同样放行。 */
export function validateProfileDraft(draft: ProfileDraft): string[] {
  const errs: string[] = [];
  if (!draft.name || !draft.name.trim()) errs.push("请填写名称。");
  const baseUrl = (draft.baseUrl || "").trim();
  if (!baseUrl) errs.push("请填写 Base URL。");
  else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(baseUrl)) errs.push("Base URL 格式不正确（应以 http(s):// 开头）。");
  if (!draft.defaultModel || !draft.defaultModel.trim()) errs.push("请填写默认模型。");
  if (!(typeof draft.temperature === "number") || Number.isNaN(draft.temperature) || draft.temperature < 0 || draft.temperature > 2) {
    errs.push("Temperature 必须在 0–2 之间。");
  }
  if (!(typeof draft.maxTokens === "number") || !Number.isFinite(draft.maxTokens) || draft.maxTokens <= 0 || !Number.isInteger(draft.maxTokens)) {
    errs.push("Max Tokens 必须为正整数。");
  }
  if (!(typeof draft.timeoutSec === "number") || !Number.isFinite(draft.timeoutSec) || draft.timeoutSec <= 0 || !Number.isInteger(draft.timeoutSec)) {
    errs.push("Timeout 必须为正整数。");
  }
  return errs;
}

/** 应用草稿到已有 Profile（§12：updateProfile(existing.id, draft)，禁止删除+新建；§11：id 永不改变）。
 *  §7: apiKeyChange 缺省或 changed=false → 原 Key 原样保留；§8: changed=true 且 value 清空 → 允许清空；
 *  §43: 每次保存成功 revision+1（参与 Cache 指纹，§41/42：Key 不进 fingerprint，但 Key 修改必须 Miss）。
 *  §33: 调用方必须持有独立拷贝，本函数不改写入参。 */
export function applyProfileDraft(existing: AIProfile, draft: ProfileDraft): AIProfile {
  const keyChange = draft.apiKeyChange;
  const apiKey = keyChange && keyChange.changed ? keyChange.value : existing.apiKey;
  return {
    ...existing,
    name: draft.name.trim() || existing.name,
    providerType: draft.providerType ?? existing.providerType,
    baseUrl: (draft.baseUrl || "").trim(),
    defaultModel: draft.defaultModel.trim(),
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
    timeoutSec: draft.timeoutSec,
    apiKey,
    revision: (typeof existing.revision === "number" ? existing.revision : 0) + 1,
  };
}

/** 应用草稿到新 Profile（create 模式：id 新生成；其他字段与 applyProfileDraft 一致） */
export function createProfileFromDraft(draft: ProfileDraft): AIProfile {
  const keyChange = draft.apiKeyChange;
  return {
    id: newProfileId(),
    name: draft.name.trim(),
    providerType: draft.providerType ?? "openai_compatible" as AIProviderType,
    baseUrl: (draft.baseUrl || "").trim(),
    apiKey: keyChange && keyChange.changed ? keyChange.value : "",
    defaultModel: draft.defaultModel.trim(),
    temperature: draft.temperature,
    maxTokens: draft.maxTokens,
    timeoutSec: draft.timeoutSec,
    revision: 1,
  };
}

/** 复制 Profile（§47/48/49）：复制非凭证配置；API Key 默认不复制（§48，防止多重凭证）；
 *  §97：新 ID 不同、不自动成为 Default；revision 归零（新实体）。 */
export function copyProfileTemplate(p: AIProfile): AIProfile {
  return {
    id: newProfileId(),
    name: (p.name || p.id) + " Copy",
    providerType: p.providerType,
    baseUrl: p.baseUrl,
    apiKey: "",
    defaultModel: p.defaultModel,
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    timeoutSec: p.timeoutSec,
    revision: 0,
  };
}

/** 编辑器草稿（§33：表单初始化复制对象，不得直接引用原 Profile 导致输入污染） */
export function draftFromProfile(p: AIProfile): ProfileDraft {
  return {
    name: p.name,
    providerType: p.providerType,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    timeoutSec: p.timeoutSec,
  };
}

/** Phase 13.5 §五十/§五十九/§六十：Profile 引用统计（删除保护 + 卡片使用数 + Diagnostics 共用）。
 *  feature 引用：显式配置 + 未配置功能回退 defaultProfileId（§一百三十五：功能未配置 → default）；
 *  workspace 引用：Workspace.defaultAIProfileId === profileId（§九十三：Workspace 只引用 Profile ID）。
 */
export interface ProfileUsage {
  features: AIFeature[];
  workspaces: string[];
}

export function profileUsage(
  profileId: string,
  funcConfigs: AIFunctionConfig[],
  workspaces: KnowledgeWorkspace[],
  defaultProfileId?: string
): ProfileUsage {
  const defId = defaultProfileId || DEFAULT_PROFILE_ID;
  const features = allFeatures().filter((f) => {
    const cfg = (funcConfigs ?? []).find((c) => c?.feature === f);
    const assigned = cfg ? (cfg.profileId || defId) : defId;
    return assigned === profileId;
  });
  const wsNames = (workspaces ?? []).filter((w) => w.defaultAIProfileId === profileId).map((w) => w.name || w.id);
  return { features, workspaces: wsNames };
}
