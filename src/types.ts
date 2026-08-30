/** 数据结构：Knowledge Garden 全部配置与领域模型（数据层，与 UI 分离） */

export type Period = "daily" | "weekly" | "monthly" | "quarterly" | "custom";

export interface HeroConfig {
  background: string;   // Vault 内图片路径（单图）
  folder: string;       // 随机壁纸文件夹
  random: boolean;
  overlay: number;      // 遮罩透明度 0..1
  title: string;
  subtitle: string;
  /** Phase 6：当前选中壁纸（持久化；Dashboard render 不重复随机，§11） */
  current?: string;
}

export interface MusicConfig {
  enabled: boolean;
  folder: string;       // Vault 内音乐文件夹
  shuffle: boolean;
  repeat: boolean;
  volume: number;       // 0..1
  /** Phase 6：自动播放（默认关；play() 被浏览器拒绝时静默，§21） */
  autoplay: boolean;
  /** Phase 6：当前曲目路径（持久化） */
  currentTrack?: string;
  /** Phase 6：当前播放位置秒（只在关键节点保存，§20） */
  currentPos?: number;
}

/** Phase 6：Dashboard 显示配置（控制首页密度与区块可见性，不改变后端数据） */
export interface DashboardConfig {
  contentWidth: number;      // 内容最大宽度 px（建议 1200-1600，§7/40）
  showHero: boolean;
  showMusic: boolean;
  showRecentAccess: boolean;
  showForgotten: boolean;
  density: "compact" | "comfortable";
}

/** 知识区域：用户定义，笔记统计实时从 Vault 计算，不手动填数 */
export interface KnowledgeArea {
  id: string;
  name: string;
  folder: string;       // Vault 内相对路径
  icon: string;
  participateInAI: boolean; // 是否参与 AI 候选选择
}

export type ProviderId = "siliconflow";
/** ---------- Phase 13：Knowledge Workspace / Skills / Model Capability / Permission（§二~§九十四） ---------- */

export type PermissionValue = "allow" | "ask" | "deny";
export type AIActionCategory = "LOCAL_READ" | "LOCAL_WRITE" | "RELATIONSHIP_WRITE" | "EXTERNAL_WEB" | "DESTRUCTIVE";

/** Workspace 权限限制（§九十二：Workspace 只能收紧，不能绕过 Global Safety） */
export interface WorkspacePermissionPolicy {
  web?: PermissionValue;
  write?: PermissionValue;
  relationship?: PermissionValue;
}

/** Knowledge Workspace（§五/§十三：只引用 AI Profile ID，不允许直接持有 API Key） */
export interface KnowledgeWorkspace {
  id: string;
  name: string;
  description?: string;
  /** 复用 DiscoveryScope（§六：不复制第二套筛选逻辑） */
  discoveryScope?: DiscoveryScope;
  /** 该空间倾向的知识区域（§四：Workspace 与 Knowledge Area 不同） */
  knowledgeAreas?: string[];
  /** 默认 AI Profile ID（§十四：Feature Route > Workspace Default > Global Default） */
  defaultAIProfileId?: string;
  /** 该空间聚焦的 Skill 列表（§二十七） */
  skills?: string[];
  /** Workspace Instructions（§十一/§十二） */
  instructions?: string;
  /** 该空间对 web/write/relationship 的限制（§九十二） */
  permissions?: WorkspacePermissionPolicy;
  createdAt: number;
  updatedAt: number;
}

/** Skill Registry 条目（§二十二：仅保存 name/description/path/enabled，正文按需加载） */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  /** 复杂流程可声明需要 Plan（§一百三十五：第一版只在特定 Feature 开启） */
  requiresPlan?: boolean;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
}

/** Model Capability（§四十五：能力 ≠ 质量评分） */
export interface ModelCapability {
  reasoning?: boolean;
  structuredOutput?: boolean;
  longContext?: boolean;
  vision?: boolean;
  toolCalling?: boolean;
  translation?: boolean;
  multilingual?: boolean;
  creativeWriting?: boolean;
}

/** Model Metadata（§四十六：modelId/provider/capabilities/contextWindow/pricingHint） */
export interface ModelMetadata {
  modelId: string;
  provider: string;
  capabilities?: ModelCapability;
  contextWindow?: number;
  /** 只在有可靠来源时记录（§四十六：不猜价格） */
  pricingHint?: "low" | "medium" | "high";
  /** 用户手动补充（§一百一十五：用户配置 > Provider metadata > 保守默认） */
  userOverrides?: Partial<ModelCapability>;
}

/** Feature 能力要求（§四十八） */
export interface AIFeatureRequirement {
  reasoning?: "required" | "preferred";
  structuredOutput?: "required" | "preferred";
  longContext?: "required" | "preferred";
  translation?: "required" | "preferred";
  multilingual?: "required" | "preferred";
  creativeWriting?: "required" | "preferred";
}


export interface AIConfig {
  provider: ProviderId;
  baseUrl: string;      // OpenAI-compatible 端点
  apiKey: string;       // 仅存于 data.json，绝不写入 Markdown/日志/git
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  /** Phase 13.5 §43：配置修改版本。每次保存成功 +1；作为安全指纹标记参与 Cache Key（§41/42），
   *  使 API Key / 名称等不进入 fingerprint 的字段变化也能触发 Cache Miss，且真实 Key 绝不入指纹。 */
  revision?: number;
}

/** ---------- Phase 11：功能级模型路由（AI Feature Routing）---------- */

/** AI 功能标识：每个功能独立路由（Profile + Model + 参数），相互之间缓存互不影响（§六十九） */
export type AIFeature =
  | "daily_curiosity"
  | "daily_review"
  | "weekly_review"
  | "monthly_review"
  | "quarterly_review"
  | "monthly_evolution"
  | "quarterly_evolution"
  | "review_question"
  | "query_exploration"
  | "knowledge_roaming"      // 今日知识漫游（connections）
  | "knowledge_processing"
  | "knowledge_refinement"   // 右键提炼（Note Context）
  | "relationship_suggestion"
  | "anchor_exploration"     // 右键/以笔记探索关联
  | "translation"
  | "copywriting"
  | "writing_academic"     // Phase 12：学术表达（严谨化，不堆术语）
  | "writing_argument"    // 论证与结构
  | "writing_critique"    // 批判性分析
  | "writing_research"    // 研究问题 / 文献综合 / 假设
  | "writing_application" // 知识迁移 / 应用
  | "writing_brainstorm"  // 头脑风暴 / 反方 / 苏格拉底
  | "writing_copy";       // 普通改写 / 润色 / 自定义

/** AI Provider 类型：第一版仅 OpenAI-compatible（SiliconFlow 等，见 ProviderId） */
export type AIProviderType = "openai_compatible";

/** Phase 13.5：Profile 编辑草稿（validateProfileDraft / applyProfileDraft 输入，§87/88）。
 *  apiKeyChange：编辑已有 Profile 时区分「保留原 Key」（changed=false/缺省，§7）
 *  与「显式修改/清空」（changed=true，value 按原样写入，§8）；真实 Key 绝不写入日志/缓存/指纹。 */
export interface ProfileDraft {
  name: string;
  providerType?: AIProviderType;
  baseUrl: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  apiKeyChange?: { changed: boolean; value: string };
}

/** AI 服务 Profile（§六十九~七十三）：API Key 只存 data.json，绝不写入源码/README/缓存/Markdown/日志（§九十二） */
export interface AIProfile {
  id: string;               // "default" = 旧 settings.ai 迁移生成的默认 Profile（§一百三十九）
  name: string;
  providerType: AIProviderType;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;     // 模型名称由 Profile 配置决定，代码不写死（§一百九十九）
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  /** Phase 13.5 §43：配置修改版本。每次保存成功 +1；作为安全指纹标记参与 Cache Key（§41/42），
   *  使 API Key / 名称等不进入 fingerprint 的字段变化也能触发 Cache Miss，且真实 Key 绝不入指纹。 */
  revision?: number;
}

/** 单个 AI 功能的路由配置（§七十六~八十）：未配置 → 回退 Default Profile（§一百三十五：不静默使用错误模型） */
export interface AIFunctionConfig {
  feature: AIFeature;
  profileId: string;
  modelOverride?: string;       // 为空 → Profile.defaultModel（§一百三十八）
  temperatureOverride?: number;
  maxTokensOverride?: number;
  timeoutOverride?: number;
  webEnabled?: boolean;         // 文案等联网功能是否允许访问外部网页（默认 false）
}

/** 解析后的实际路由（resolveAIFunctionConfig 输出，§八十一：纳入缓存指纹） */
export interface AIFunctionRoute {
  profileId: string;
  providerType: AIProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  /** Phase 13.5 §43：配置修改版本。每次保存成功 +1；作为安全指纹标记参与 Cache Key（§41/42），
   *  使 API Key / 名称等不进入 fingerprint 的字段变化也能触发 Cache Miss，且真实 Key 绝不入指纹。 */
  revision?: number;
  webEnabled: boolean;
}

/** ---------- Phase 11：状态随机浏览（State Browse，0 AI，§四~十六） ---------- */

export type StateBrowseScopeMode = "vault" | "discovery" | "areas" | "folders" | "tags" | "recent" | "custom";

/** 状态浏览范围设置（§一百二十四：默认整个仓库；discovery=复用当前 Discovery Scope） */
export interface StateBrowseConfig {
  mode: StateBrowseScopeMode;
  areaNames?: string[];
  folders?: string[];
  tags?: string[];
  recentDays?: number;
  includeSubfolders?: boolean;
  recentLimit?: number;
}

/** ---------- Phase 11：Web Context（文案联网；§一百二十：URL / 已配置 Provider 抽象，不强制绑定） ---------- */

/** Web Search Provider 配置（第一版仅占位，不绑定 Tavily/Brave/Serper） */
export interface WebSearchProviderConfig {
  id: string;
  name: string;
  type: "none" | "api";
  apiKey?: string;
}

export interface WebSearchConfig {
  providers: WebSearchProviderConfig[];
}
export interface DaySchedule  { enabled: boolean; time: string; }          // "20:00"
export interface WeekSchedule { enabled: boolean; weekday: number; time: string; } // 0=周日
export interface MonthSchedule{ enabled: boolean; day: string; time: string; }     // "last" 或 1..28
export interface CustomSchedule { enabled: boolean; everyDays: number; anchorDate: string; time: string; } // anchorDate: "YYYY-MM-DD"，为空则以首次启用当天为锚点

export interface ReviewConfig {
  daily: DaySchedule;
  weekly: WeekSchedule;
  monthly: MonthSchedule;
  quarterly: MonthSchedule;  // day: "last" 或 1..28（季度末日期）
  custom: CustomSchedule;
}

/** 一次已生成的复盘（结果本体是可读 Markdown，这里只存指针+时间） */
export interface ReviewRecord {
  period: Period;
  date: number;         // 时间戳
  path: string;         // Vault 内 Markdown 路径
  generatedBy: string;  // "siliconflow" | "local"
}

export type InsightType = "connection" | "question" | "tension" | "pattern" | "missing_link";

export interface AIInsightNote { path: string; reason: string; }
/** AI 洞察：知识连接器输出（可落盘为 Review Markdown 的核心素材） */
export interface AIInsight {
  title: string;
  type: InsightType;
  summary: string;      // 为什么值得注意（跨领域关系），不是全文概括
  question: string;
  notes: AIInsightNote[]; // 引用的真实笔记（path 必须存在于 Vault）
}

/** ---------- Phase 5：AI 知识探索网络（Connection 可视化 Schema） ---------- */

export type ConnectionNodeRole =
  | "question"
  | "origin"
  | "concept"
  | "bridge"
  | "destination"
  | "note";

/** 图中的节点：path 必须是真实候选笔记（Vault 内存在），label 为显示用 */
export interface AIConnectionNode {
  path: string;               // 必须 ∈ candidatePaths（service 校验）
  role?: ConnectionNodeRole;  // 该笔记在这条连接中的角色
  label?: string;             // 节点显示标题（默认取笔记 basename）
  reason?: string;            // 为什么这篇笔记在这个连接里（hover/面板展示）
}

/** 图中的边：from/to 必须引用 nodes[].path（service 校验），relation 是图上显示的关系 */
export interface AIConnectionEdge {
  from: string;               // 等于某个 node 的 path
  to: string;                 // 等于某个 node 的 path
  relation: string;           // 简短关系（如「边界」「解耦」）
  direction?: "forward" | "bidirectional";
  reason?: string;            // 为什么这条关系成立（hover/面板展示）
}

/** AI 知识探索网络：AI 提出连接，人沿着连接探索（可解释，不做成普通 Graph View） */
export interface AIConnectionResult {
  title: string;
  type: InsightType;
  summary: string;            // AI 为什么这样连接（讲关系，不做全文概括）
  question?: string;
  nodes: AIConnectionNode[];
  edges: AIConnectionEdge[];
}
export interface CuriosityEntry { date: number; insight: AIInsight; }

export interface PluginSettings {
  dashboardName: string;
  autoRefresh: boolean;
  openOnStartup: boolean;
  hero: HeroConfig;
  music: MusicConfig;
  dashboard: DashboardConfig;
  knowledgeAreas: KnowledgeArea[];
  ai: AIConfig;
  review: ReviewConfig;
  activity: ActivityConfig;
  automaticReview: AutoReviewConfig;
  reviews: ReviewRecord[];
  lastCuriosity: CuriosityEntry | null;
  lastMonthlyEvolution: LongTermReflectionData | null;
  lastQuarterlyEvolution: LongTermReflectionData | null;
  evolution: EvolutionConfig;
  reviewCenter: ReviewCenterConfig;
  discovery: DiscoveryConfig;
  queryExplorer: QueryExplorerConfig;
  capture: CaptureConfig;
  relationship: RelationshipConfig;
  stateBrowse: StateBrowseConfig;
  aiProfiles: AIProfile[];
  aiFunctionConfig: AIFunctionConfig[];
  /** Phase 13：Knowledge Workspaces（§二~§十五） */
  workspaces: KnowledgeWorkspace[];
  /** 当前 Workspace（§九：默认 None → 完全保持现在行为） */
  currentWorkspaceId: string | null;
  /** Skill Registry（§二十二；内置 Skills 由代码提供，此列表存储用户启停覆盖） */
  skillRegistry: SkillSummary[];
  /** Model Capability Registry（§四十六；用户配置优先于保守默认） */
  modelMetadata: ModelMetadata[];
  /** 全局权限策略（§九十：默认 LOCAL_READ allow、写入/关系/外网 ask、删除 deny） */
  permissionsPolicy: Partial<Record<AIActionCategory, PermissionValue>>;
  webSearch: WebSearchConfig;
  /** Phase 13.5 §14/15/17：全局默认 Profile ID。缺省 → 回退 DEFAULT_PROFILE_ID="default"，兼容 Phase 11 迁移行为。 */
  defaultProfileId?: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  dashboardName: "知识花园",
  autoRefresh: false,
  openOnStartup: false,
  hero: {
    background: "",
    folder: "",
    random: true,
    overlay: 0.25,
    title: "Knowledge Garden",
    subtitle: "让知识重新连接起来",
    current: "",
  },
  music: { enabled: false, folder: "", shuffle: false, repeat: true, volume: 0.7, autoplay: false, currentTrack: "", currentPos: 0 },
  knowledgeAreas: [],
  ai: {
    provider: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    model: "Qwen/Qwen2.5-7B-Instruct",
    temperature: 0.7,
    maxTokens: 1500,
    timeoutSec: 60,
  },
  review: {
    daily: { enabled: false, time: "20:00" },
    weekly: { enabled: false, weekday: 0, time: "20:00" },
    monthly: { enabled: false, day: "last", time: "20:00" },
    quarterly: { enabled: false, day: "last", time: "20:00" },
    custom: { enabled: false, everyDays: 3, anchorDate: "", time: "20:00" },
  },
  reviews: [],
  dashboard: {
    contentWidth: 1480,
    showHero: true,
    showMusic: true,
    showRecentAccess: true,
    showForgotten: true,
    density: "comfortable",
  },
  activity: { newDays: 7, staleDays: 14, forgottenDays: 30, recentLimit: 8 },
  automaticReview: {
    enabled: false,         // 默认 OFF：首次安装绝不自动消耗 Token（§二十）
    confirmBeforeRun: true, // 生成前询问（§21）
    confirmAfterMissed: true, // 错过后询问（§19/36）
    startupCheck: true,     // 应用启动后检查（§36）
    notifiedOnce: false,    // 首次开启自动复盘的一次性提示（§39）
  },
  lastCuriosity: null,
  lastMonthlyEvolution: null,
  lastQuarterlyEvolution: null,
  evolution: { enabled: true, longTermAI: "metadata", keepWeeks: 52 },
  reviewCenter: {
    queueSize: 5,
    autoQueue: true,
    aiQuestion: true,
    maxQuestions: 5,
    skipPenalty: true,
    autoOpenReview: false,
  },
  discovery: {
    curiosity: { scope: { mode: "vault" }, candidateCount: 16, exploreOld: true },
    roaming: { scope: { mode: "vault" }, candidateCount: 16, preferCrossArea: true },
  },
  queryExplorer: {
    scopeMode: "vault",
    candidateCount: 16,
    localResultLimit: 50,
    historyLimit: 20,
    autoSave: false,
  },
  capture: {
    inboxFolder: "Knowledge Garden/Inbox",
    processingFolder: "Knowledge Garden/Processing",
    knowledgeFolder: "Knowledge Garden/Knowledge",
    archiveFolder: "Knowledge Garden/Archive",
    autoProcess: false,
    suggestTags: true,
    suggestAreas: true,
    preserveSources: true,
  },
  relationship: { folder: "Knowledge Garden/Relationships" },
  stateBrowse: { mode: "vault" },
  aiProfiles: [], // 首次启动由旧 settings.ai 自动迁移生成 default（§一百三十九），见 main.loadSettings
  aiFunctionConfig: [],
  webSearch: { providers: [] },
  // Phase 13：Workspace / Skills / Capability / Permission（默认跟随旧行为，§一百二十九）
  workspaces: [],
  currentWorkspaceId: null,
  skillRegistry: [],
  modelMetadata: [],
  permissionsPolicy: {},
};
export function todayKey(date = new Date()): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** 深合并设置：嵌套对象逐字段合并，数组整体替换 */
export function mergeSettings(
  defaults: PluginSettings,
  data: Partial<PluginSettings> | null | undefined
): PluginSettings {
  const out = JSON.parse(JSON.stringify(defaults)) as PluginSettings;
  if (!data || typeof data !== "object") return out;
  const raw = data as Record<string, unknown>;
  // §七十一：未知字段尽量保留（未来版本新增的设置项，绝不因 parse→rewrite 被删除）
  for (const key of Object.keys(raw)) {
    if (!(key in defaults)) {
      (out as unknown as Record<string, unknown>)[key] = raw[key];
    }
  }
  for (const key of Object.keys(defaults) as (keyof PluginSettings)[]) {
    const dv = defaults[key];
    const v = raw[key];
    if (v === undefined) continue;
    if (
      dv !== null && typeof dv === "object" && !Array.isArray(dv) &&
      v !== null && typeof v === "object" && !Array.isArray(v)
    ) {
      (out as unknown as Record<string, unknown>)[key] = {
        ...(dv as unknown as Record<string, unknown>),
        ...(v as unknown as Record<string, unknown>),
      };
    } else {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

export function periodLabel(p: Period): string {
  const map: Record<Period, string> = {
    daily: "日复盘",
    weekly: "周复盘",
    monthly: "月复盘",
    quarterly: "季度复盘",
    custom: "自定义复盘",
  };
  return map[p];
}

export function insightTypeLabel(t: InsightType): string {
  const map: Record<InsightType, string> = {
    connection: "✨ 今日知识奇想 · 连接",
    question: "❓ 一个值得追问的问题",
    tension: "⚡ 观点冲突",
    pattern: "🔁 反复出现的模式",
    missing_link: "🧩 知识体系缺失的关键节点",
  };
  return map[t];
}

/** AI 缓存：同一周期/同一候选/同一配置默认复用，手动 Regenerate 强制新结果 */
export type AICacheType =
  | "daily_curiosity"
  | "daily_review"
  | "weekly_review"
  | "monthly_review"
  | "quarterly_review"
  | "connections"
  | "monthly_evolution"
  | "quarterly_evolution"
  | "review_question"
  | "query_exploration"
  | "knowledge_processing"
  | "translation"
  | "copywriting"
  | "anchor_exploration";

export interface AICacheErrorInfo {
  /** TIMEOUT | NETWORK | HTTP_<status> | INVALID_JSON | EMPTY_RESPONSE | MISSING_KEY | OTHER */
  code: string;
  message: string;
}

export interface AICacheEntry<T = unknown> {
  key: string;              // sha256(type + periodKey + candidateSig + configSig)
  type: AICacheType;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;       // 可选：connections 由候选指纹决定，不依赖 TTL
  model: string;
  promptVersion: string;
  candidateFingerprint: string;
  configFingerprint: string;
  status: "success" | "error";
  data?: T;                 // 仅存「已校验结果」，不存原始 prompt / 笔记原文
  error?: AICacheErrorInfo;
}

export interface ReviewCacheData { markdown: string; model: string; }
export type InsightCacheData = AIInsight;
/** Phase 5：知识探索网络缓存数据（含可视化 nodes/edges） */
export type ConnectionCacheData = AIConnectionResult;

/** ---------- Phase 3：Activity + Knowledge State ---------- */

/** 每篇笔记的活动数据（O(note count)，随删除清理；独立于 AI Cache 生命周期） */
export interface ActivityEntry {
  lastAccessedAt?: number;
  accessCount?: number;
  lastReviewedAt?: number;
  reviewCount?: number;
}

export type KGState = "new" | "growing" | "active" | "stale" | "forgotten";

/** 本地状态判定阈值：改变只影响 Knowledge State 与候选排序，绝不自动清 AI Cache */
export interface ActivityConfig {
  newDays: number;        // 创建后 N 天内视为 new
  staleDays: number;      // N 天无访问/修改/复习 → stale
  forgottenDays: number;  // N 天未访问且未复习且有连接 → 可能正在被遗忘
  recentLimit: number;    // Dashboard 最近访问显示数量
}
/** ---------- Phase 4：自动周期调度（Schedule State 独立于 AI Cache 与 Activity） ---------- */

export type ScheduleStatus =
  | "pending"
  | "queued"
  | "running"
  | "done"
  | "skipped"
  | "missed";

/** 只记录调度状态；AI 结果继续由 AI Cache + Review Markdown 负责（§五） */
export interface ScheduleRecord {
  type: Period;
  periodKey: string;
  scheduledAt: number;   // 本周期“应执行”的本地时间戳
  status: ScheduleStatus;
  startedAt?: number;
  completedAt?: number;
  skippedAt?: number;
  snoozedUntil?: number; // “稍后提醒”
  attempts?: number;     // 本周期已尝试次数（§27 上限 3）
  retryAt?: number;      // 自动重试最早时间
  lastError?: { code: string; message: string };
}

export interface AutoReviewConfig {
  enabled: boolean;
  confirmBeforeRun: boolean;
  confirmAfterMissed: boolean;
  startupCheck: boolean;
  notifiedOnce: boolean;
}

/** ---------- Phase 7：知识状态机与长期演化 ---------- */

/** 长期状态（Phase 7）：回答“过去一段时间发生了什么”；与 Phase 3 短期五态（new/growing/active/stale/forgotten）是两个时间尺度，不混成一个 enum（§十七/十八） */
export type LongTermKnowledgeState =
  | "emerging"   // 最近快速增加（新笔记+修改+访问）
  | "sustained"  // 连续多个 snapshot 都活跃
  | "fading"     // 过去活跃，最近下降
  | "dormant"    // 长期没有行为
  | "core";      // 持续活跃 + 连接度高 + 跨区域连接多（“核心知识候选”，不是“你的核心知识”）

export interface ConceptStat { name: string; count: number; }

/** 单区域长期统计（§十二）：只存聚合指标，不存笔记全文/prompt/activity 历史（§六） */
export interface AreaEvolutionStat {
  area: string;
  folder: string;
  noteCount: number;
  newCount: number;
  activeCount: number;
  growingCount: number;
  staleCount: number;
  forgottenCount: number;
  recentActivity: number;      // 最近访问时间戳（区域最大 lastAccessedAt），0=无
  recentReviewCount: number;   // 近 30 天内“标记为已复习”次数
  linkCount: number;           // 区域内出链+回链（真实 wikilink 证据）
  crossAreaCount: number;      // 该区域参与的跨区域连接数（§21 真实证据）
  growthDelta?: number;        // 相对上一快照的增长率（仅用于排序/趋势，不显示成精确分数，§十四/十五）
  activityDelta?: number;
}

/** 跨区域连接（§21）：只有真实 AI edges 或真实 WikiLinks 才能作为证据 */
export interface CrossAreaLinkStat {
  a: string;
  b: string;
  count: number;
  evidence: "wikilink" | "ai_edge" | "both";
  samplePaths: string[];
}

/** 长期反复出现的问题（§25/26/27）：规范化 + 指纹识别，跨复盘周期归并 */
export interface PersistentQuestion {
  fingerprint: string;
  text: string;
  firstSeen: string;      // "2026-06"
  lastSeen: string;
  occurrences: number;
  periods: string[];      // 出现过的周期标签
}

/** 每周快照（§四/五/六）：时间观察点，轻量聚合指标 */
export interface KnowledgeEvolutionSnapshot {
  date: string;           // YYYY-MM-DD（周一）
  periodKey: string;      // snapshot:weekly:YYYY-MM-DD（幂等键，§九）
  totalNotes: number;
  totalAreas: number;
  activeNotes: number;
  growingNotes: number;
  staleNotes: number;
  forgottenNotes: number;
  newNotes: number;
  topConcepts: ConceptStat[];
  areaStats: AreaEvolutionStat[];
  crossAreaLinks: CrossAreaLinkStat[];
  unresolvedQuestions: PersistentQuestion[];
  confirmedRelationshipCount?: number;
  relationshipGrowth?: number;
}

/** AI 长期观察输出（§三十）：JSON Schema 校验失败不写 success cache */
export interface LongTermReflectionData {
  period: string;          // "2026-08" / "2026-Q3"
  headline: string;
  themes: string[];
  emergingAreas: string[];
  sustainedAreas: string[];
  fadingAreas: string[];
  bridges: string[];
  recurringQuestions: string[];
  knowledgeGaps: string[];
  nextExplorations: string[];
}

/** 长期演化设置（§四十八）：默认 Metadata only；Off 则不自动调用长期 AI */
export interface EvolutionConfig {
  enabled: boolean;             // 主开关：是否记录快照与演化
  longTermAI: "off" | "metadata" | "excerpts";  // 第一版实现 metadata；excerpts 留结构
  keepWeeks: number;            // 快照最多保留周数（§四十三：52）
}
/** ---------- Phase 8：Review Center / 主动复习闭环 ---------- */

/** 每日复习队列规模（§八：3/5/8/10，默认 5） */
export type ReviewQueueSize = 3 | 5 | 8 | 10;

/** Review Center 设置（§六十二/六十三）：只影响本地队列/复习行为，不改变复盘的 AI 调度 */
export interface ReviewCenterConfig {
  queueSize: ReviewQueueSize;   // 每日复习数量（默认 5）
  autoQueue: boolean;           // 日复盘成功后自动生成本地队列（默认 ON，§四十二）
  aiQuestion: boolean;          // AI 复习问题开关（默认 ON，§六十二）
  maxQuestions: number;         // 每次 Session 最多生成问题数（3/5，默认 5，§五十六）
  skipPenalty: boolean;         // 连续跳过惩罚开关（默认 ON，§三十二）
  autoOpenReview: boolean;      // 日复盘成功后自动打开复习窗口（默认 OFF，§四十三/六十三）
}

/** AI 复习问题类型（§二十/二十一）：帮助重新建立知识结构，不是考试 */
export type ReviewQuestionPurpose = "recall" | "connection" | "application" | "contrast";

/** AI 复习问题（§二十）：path 必须 ∈ 当前待复习候选（代码层二次校验，§五十三/五十四） */
export interface ReviewQuestion {
  path: string;
  question: string;
  purpose: ReviewQuestionPurpose;
  answerHint?: string;
}

/** 单条复习候选（§五）：priorityScore 只是本次复习排序依据，不代表“知识重要程度” */
export interface ReviewCandidate {
  path: string;
  title: string;
  area?: string;
  state: KGState;
  longTermState?: LongTermKnowledgeState;
  lastAccessedAt?: number;
  lastReviewedAt?: number;
  daysSinceReview?: number;
  daysSinceAccess?: number;
  reason: string;
  priorityScore: number;
}

/** 队列条目（§九/三十）：snoozedUntil 只影响队列，绝不更新 Activity（§三十一） */
export interface ReviewQueueItem {
  path: string;
  stateAtSelection: KGState;
  priorityScore: number;
  status: "pending" | "reviewing" | "completed" | "skipped";
  selectedAt: number;
  completedAt?: number;
  snoozedUntil?: number;        // “稍后再看”：明天/3 天/7 天（§三十）
}

/** Review Queue（§九/十/十一）：本地可执行状态，与 AI Cache 分离、按 periodKey 幂等 */
export interface ReviewQueue {
  periodKey: string;            // daily:YYYY-MM-DD（§十二）
  createdAt: number;
  items: ReviewQueueItem[];
  completedCount: number;
  skippedCount: number;
}

/** Session 持久化（§三十九）：只存指针，不存 AI prompt / 笔记全文（§七十四） */
export interface ReviewSessionState {
  periodKey: string;
  currentIndex: number;
  queueKey: string;             // 等于该 session 工作的 queue.periodKey（恢复不丢进度，§三十八）
  updatedAt: number;
}

/** ---------- Discovery Scope：全库知识奇想 + 可调节知识漫游范围 ---------- */

/** 发现范围模式（§四）：vault=整个仓库 / areas=知识区域 / folders=文件夹 / tags=标签 / recent=最近 N 天 / custom=组合过滤 */
export type DiscoveryScopeMode = "vault" | "areas" | "folders" | "tags" | "recent" | "custom";

/**
 * Discovery Scope（§五：与 Review Scope 完全分离，§三）。
 * - vault：整个仓库本地筛选（真正的探索边界，不是整库上传）。
 * - areas：只选 knowledgeAreas 中勾选的区域。
 * - folders / tags：按文件夹 / 标签本地过滤（第一版 text 输入，§四十八）。
 * - recent：最近 N 天（recentDays）。
 * - custom：组合过滤。
 */
export interface DiscoveryScope {
  mode: DiscoveryScopeMode;
  areaNames?: string[];
  folders?: string[];
  tags?: string[];
  recentDays?: number;
  includeSubfolders?: boolean;
  includeUntagged?: boolean;
  includeUncategorized?: boolean;
}

/** 单个发现功能（奇想 / 漫游）配置：Scope 独立保存（§六），候选数量可设（§三十/三十一） */
export interface DiscoveryFeatureConfig {
  scope: DiscoveryScope;
  /** 最终发给 AI 的候选数量：8 | 12 | 16 | 24 | 32（默认 16） */
  candidateCount: number;
  /** 奇想：探索旧知识（§四十六：ON；§二十七 探索候选 10~20%） */
  exploreOld?: boolean;
  /** 漫游：优先跨领域 / 图连接性（§三十五：更看重 relationship potential + cross-area + graph connectivity） */
  preferCrossArea?: boolean;
}

/** 奇想与漫游分别保存 Scope（§六：发散与收敛两种独立认知过程） */
export interface DiscoveryConfig {
  curiosity: DiscoveryFeatureConfig;
  roaming: DiscoveryFeatureConfig;
}

/** Discovery Exposure 数据（§二十一）：AI Discovery 行为，不代表用户行为（§二十三），绝不写 Activity */
export interface DiscoveryMetaEntry {
  lastCuriositySeenAt?: number;
  lastRoamingSeenAt?: number;
  curiosityExposureCount?: number;
  roamingExposureCount?: number;
}

/** DiscoveryStore 持久化结构（cache/discovery.json，§二十二） */
export interface DiscoveryMetaFile {
  formatVersion?: number;
  entries: Record<string, DiscoveryMetaEntry>;
}
/** ---------- Query Explorer：用户主动提问 → 全库检索 → AI 关联（Query Explorer 阶段） ---------- */

/** Query 范围（§四）：vault=整个仓库（默认）；current-discovery-scope=当前漫游范围 */
export type QueryScopeMode = "vault" | "current-discovery-scope";

/** Query Explorer 设置（§一百一十六） */
export interface QueryExplorerConfig {
  /** 默认范围（§四/五：默认整个仓库） */
  scopeMode: QueryScopeMode;
  /** 最终发给 AI 的候选数量：8|12|16|24|32（§三十/三十一，默认 16） */
  candidateCount: number;
  /** 本地检索候选池上限（§三十，默认 50） */
  localResultLimit: number;
  /** 最近探索保留条数（§五十四/一百一十八，默认 20，最多 100） */
  historyLimit: number;
  /** 保存探索时自动生成 Markdown（§一百零四/一百一十七，默认 OFF） */
  autoSave: boolean;
}

/** Query 探索节点（§三十八）：path 必须 ∈ 最终候选集；role 不含 query（query 中心由前端合成，§四十/四十三） */
export interface QueryExplorationNode {
  path: string;
  label?: string;
  role?: "origin" | "concept" | "bridge" | "destination";
  reason: string;
}

/** Query 探索边（§三十九）：from/to 必须 ∈ nodes */
export interface QueryExplorationEdge {
  from: string;
  to: string;
  relation: string;
  direction?: "forward" | "bidirectional";
  reason?: string;
}

/** AI Query 探索结果（§三十七） */
export interface QueryExplorationResult {
  query: string;
  headline: string;
  summary: string;
  nodes: QueryExplorationNode[];
  edges: QueryExplorationEdge[];
  insights: string[];
  suggestedQuestions?: string[];
}

/** Query 历史条目（§五十四：只存 query/时间/范围/缓存键/标题，不存 AI prompt） */
export interface QueryHistoryEntry {
  query: string;
  createdAt: number;
  scope: QueryScopeMode;
  cacheKey: string;
  headline?: string;
}

/** QueryHistoryStore 持久化结构（cache/query-history.json，§五十五） */
export interface QueryHistoryFile {
  formatVersion?: number;
  entries: QueryHistoryEntry[];
}

/** ---------- Saved Exploration / 收藏知识链路（Saved Exploration 阶段） ---------- */

/** 收藏来源（九：奇想 / 主动探索 / 知识连接；manual 预留） */
export type SavedExplorationSource = "daily_curiosity" | "query_exploration" | "connection" | "manual" | "anchor_exploration";

/** 收藏节点快照（六：保存完整快照，不依赖 AI Cache） */
export interface SavedExplorationNode {
  path: string;
  label?: string;
  role?: string;
  reason?: string;
}

/** 收藏边快照（七） */
export interface SavedExplorationEdge {
  from: string;
  to: string;
  relation: string;
  direction?: "forward" | "bidirectional";
  reason?: string;
}

/** 收藏知识链路（五：JSON 索引条目 = 完整快照；Markdown 是用户可见视图与恢复源） */
export interface SavedExploration {
  id: string;
  title: string;
  query?: string;
  source: SavedExplorationSource;
  /** Phase 12 §六：Anchor 探索来源笔记（从哪篇笔记发起的关联探索） */
  anchorPath?: string;
  createdAt: number;
  updatedAt: number;
  scope?: DiscoveryScope;
  headline?: string;
  summary?: string;
  nodes: SavedExplorationNode[];
  edges: SavedExplorationEdge[];
  markdownPath: string;
  tags?: string[];
  /** Phase 13 §一百零二：保存收藏时的 Workspace 快照（历史不变，不动态改旧收藏） */
  workspaceSnapshot?: { id?: string; name?: string };
  /** 四十八：sha256(source + normalizedQuery + nodePaths + edgeDefs)，用于去重；不是用户可见 ID */
  fingerprint: string;
}

/** saved-explorations.json 结构（四） */
export interface SavedExplorationFile {
  formatVersion?: number;
  entries: SavedExploration[];
}

// ---------- Capture / Processing / Provenance / Knowledge Refinement（Capture 阶段） ----------

/** Capture 类型（§七：note/clipboard/url/import；rss/youtube 等未来扩展，本阶段不实现） */
export type CaptureType = "note" | "clipboard" | "url" | "import";

/** Knowledge Origin（§十：source/derived/personal/synthesis） */
export type KnowledgeOrigin = "source" | "derived" | "personal" | "synthesis";

/** Curate 状态机（§四十三/四十四：Inbox → Processing → Candidate → Accepted/Archived） */
export type CurationStatus = "inbox" | "processing" | "candidate" | "accepted" | "archived";

/** Suggested Link（§三十/三十一：AI 只能建议；本地必须验证 Vault 真实存在后才生成 WikiLink） */
export interface SuggestedLink {
  /** AI 建议的标题（不做路径猜测） */
  title: string;
  /** 本地校验后真实存在的笔记路径（不存在时留空，显示「建议建立新概念」） */
  path?: string;
  reason?: string;
}

/** Knowledge Candidate（§二十六：AI Processing 输出；knowledgeValue 是 AI 建议，不是客观价值 §二十七） */
export interface KnowledgeCandidate {
  sourcePath: string;
  title: string;
  summary: string;
  concepts: string[];
  claims: string[];
  questions: string[];
  suggestedLinks: SuggestedLink[];
  suggestedRelationships?: SuggestedRelationship[];
  knowledgeValue: "low" | "medium" | "high";
  confidence?: number;
  /** §一百零四：AI 建议知识区域（不自动写入，用户选择已有 Area §七十） */
  suggestedArea?: string;
  /** §一百零四：AI 建议标签（可逐项接受/忽略/编辑） */
  suggestedTags?: string[];
}

/** Capture frontmatter（§九：来源信息与正文分离，全部放 frontmatter；本文档即来源证明） */
export interface CaptureFrontmatter {
  type: "capture";
  captureType: CaptureType;
  /** 来源类型（§八：url/clipboard/manual/import） */
  sourceType: CaptureType;
  sourceUrl?: string;
  sourceTitle?: string;
  /** §八：capturedAt 记录捕获时刻（ISO 日期 YYYY-MM-DD） */
  capturedAt: string;
}

/** Capture Meta：parseCaptureFrontmatter 的解析结果（供 Dashboard/Processing 复用） */
export interface CaptureMeta {
  captureType: CaptureType;
  sourceType: CaptureType;
  sourceUrl?: string;
  sourceTitle?: string;
  capturedAt?: string;
  origin?: KnowledgeOrigin;
  status?: CurationStatus;
  area?: string;
  tags: string[];
}

/** Capture & Processing 设置（§六十九/一百零八/一百零九） */
export interface CaptureConfig {
  inboxFolder: string;
  processingFolder: string;
  knowledgeFolder: string;
  archiveFolder: string;
  /** §一百一十：默认 OFF —— Capture 是低成本输入，AI Processing 是用户掌控的主动操作 */
  autoProcess: boolean;
  suggestTags: boolean;
  suggestAreas: boolean;
  preserveSources: boolean;
}

/* ---------- Phase 10：Relationship Lifecycle（Provenance / User Confirmed Relations） ---------- */

/** 关系证据来源（§三：三种来源兼容升级，不删除旧 wikilink/ai_edge 结构） */
export type RelationshipEvidence = "wikilink" | "ai_inferred" | "user_confirmed";

/** 关系方向（§十七：forward / bidirectional） */
export type RelationshipDirection = "forward" | "bidirectional";

/** 正式知识关系（§四：AI 推断 ≠ 用户认可；只有 user_confirmed 才进入长期结构）。
 *  id = sha256(归一化 from+to+relation)（§十六：不用 from+to 作唯一键）；
 *  bidirectional 下 A→B 与 B→A 视为同一无向关系（§十八）。
 *  status = dismissed 只记录用户反馈（§十三），不进入长期/不写 Markdown（§五十七）。 */
export interface KnowledgeRelationship {
  id: string;
  from: string;              // Vault 内笔记路径（带 .md）
  to: string;                // Vault 内笔记路径（带 .md）
  relation: string;
  reason?: string;
  evidence: RelationshipEvidence[];   // §十九/二十/二十一：可组合
  direction: RelationshipDirection;
  status: "active" | "dismissed";
  createdAt: number;
  updatedAt: number;
  dismissedAt?: number;
}

/** cache/relationships.json（§十：独立于 AI Cache；清空 AI Cache 不删 §十一） */
export interface RelationshipStoreFile {
  formatVersion: number;    // §七十一：relationshipsFormatVersion = 1
  relationships: KnowledgeRelationship[];
}

/** Relationship 目录设置（§五十四：确认关系 Markdown 落盘文件夹，默认 Knowledge Garden/Relationships） */
export interface RelationshipConfig {
  folder: string;
}

/** Processing AI 建议关系（§四十三：from/to/relation/reason；from/to 必须经本地路径验证 §四十四；
 *  验证失败丢弃该条建议，绝不自动写 Markdown §五十六/五十八/六十）。 */
export interface SuggestedRelationship {
  from: string;              // 验证后真实存在的 Vault 路径（带 .md）
  to: string;
  relation: string;
  reason?: string;
}

