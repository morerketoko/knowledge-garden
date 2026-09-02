import { AIError, SiliconFlowProvider, type ChatMessage, type ChatOptions } from "./provider";
import { AICache, fingerprintKey } from "./cache";
import { extractJsonBlockText, parseExamGeneration, parseExamGrading, examCacheDataValid } from "./parsers";
import { buildConnectionsSystem, buildCuriositySystem, buildDailyReviewUser, buildMonthlyEvolutionUser, buildQuarterlyEvolutionUser, buildQueryExplorationSystem, buildWeeklyReviewUser, type DiscoveryPromptContext, type EvolutionPromptInput, type WeeklyReviewInput } from "../prompts";
import { buildReviewQuestionsSystem, buildReviewQuestionsUser } from "../prompts";
import { buildCaptureProcessingSystem } from "../prompts";
import { buildExamGenerationSystem, buildExamGradingSystem, buildExamGradingUser, EXAM_GENERATION_PROMPT_VERSION, EXAM_GRADING_PROMPT_VERSION, type ExamGenerationInput } from "../prompts";
import { filterValidQuestions } from "../reviewCenter";
import { PROCESSING_TYPE_CAPTURE, PROCESSING_VERSION, parseProcessingResult } from "../knowledgeProcessor";
import { filterConnectionEdges, filterConnectionNodes } from "../knowledgeGraph";
import { parseQueryExplorationText } from "../queryExplorer";
import { cacheTypeForFeature } from "../aiRouting";
import { ANCHOR_PROMPT_VERSION, COPYWRITING_PROMPT_VERSION, TRANSLATION_PROMPT_VERSION, buildAnchorExplorationSystem } from "../prompts";
import { WORKBENCH_ASK_PROMPT_VERSION, KNOWLEDGE_ASK_PROMPT_VERSION, RESEARCH_PLAN_PROMPT_VERSION, RESEARCH_EXECUTION_PROMPT_VERSION, PROJECT_DEFINITION_PROMPT_VERSION, AGENT_TOOL_CALL_PROMPT_VERSION, SOURCE_SUMMARIZATION_PROMPT_VERSION } from "../prompts";
import type {
  AIConfig,
  AIFeature,
  AIFunctionRoute,
  AICacheType,
  AICacheErrorInfo,
  AICacheEntry,
  AIConnectionResult,
  AIInsight,
  InsightType,
  QueryExplorationResult,
  KnowledgeCandidate,
  ReviewCacheData,
  LongTermReflectionData,
  ExamAnswerMode,
  ExamQuestion,
  ReviewQuestion,
} from "../types";

export { AIError } from "./provider";

export const VALID_TYPES: InsightType[] = ["connection", "question", "tension", "pattern", "missing_link"];

/** Prompt 版本：任何 Prompt 语义变化必须手动提升对应版本，否则旧缓存会复用旧语义 */
export const PROMPT_VERSIONS: Record<AICacheType, string> = {
  daily_curiosity: "v2",  // Discovery Scope：注入探索范围上下文（§三十七）
  daily_review: "v1",
  weekly_review: "v1",
  monthly_review: "v1",
  quarterly_review: "v1",
  connections: "v3",  // Discovery Scope：注入探索范围上下文（§三十七）
  monthly_evolution: "v1",  // Phase 7：月度长期演化
  quarterly_evolution: "v1", // Phase 7：季度长期演化
  review_question: "v1", // Phase 8：AI 复习问题
  query_exploration: "query-exploration-v1", // Query Explorer（§八十一）
  knowledge_processing: PROCESSING_VERSION, // Capture Processing（§一百）
  translation: TRANSLATION_PROMPT_VERSION, // Phase 11：右键翻译（feature 独立路由）
  copywriting: COPYWRITING_PROMPT_VERSION, // Phase 11：文案生成（feature 独立路由）
  anchor_exploration: ANCHOR_PROMPT_VERSION, // Phase 11：Anchor 探索（复用 Query schema）
  note_exam: EXAM_GENERATION_PROMPT_VERSION,     // Phase 14：考试生成（§四十）
  exam_grading: EXAM_GRADING_PROMPT_VERSION,     // Phase 14：考试评分（§一百零八）
  workbench_ask: WORKBENCH_ASK_PROMPT_VERSION,        // Phase 15：Workbench Ask（§一百四十九）
  workbench_deep: KNOWLEDGE_ASK_PROMPT_VERSION,        // Phase 16：Knowledge Agent Deep（检索→阅读→证据→综合）
  workbench_research: KNOWLEDGE_ASK_PROMPT_VERSION,    // Phase 16：Research Agent Deep 分支
  research_plan: RESEARCH_PLAN_PROMPT_VERSION,         // Phase 15：研究计划（§二十一~二十四）
  research_search: RESEARCH_EXECUTION_PROMPT_VERSION,  // Phase 15：研究执行/检索（Agent Loop §七十七）
  research_summary: SOURCE_SUMMARIZATION_PROMPT_VERSION, // Phase 15：材料提炼/来源摘要（§一百零五）
  research_synthesis: RESEARCH_PLAN_PROMPT_VERSION,    // Phase 15：研究综合（复用计划版；语义不同则升版）
  project_plan: PROJECT_DEFINITION_PROMPT_VERSION,     // Phase 15：项目定义（§三十一）
  agent_tool_call: AGENT_TOOL_CALL_PROMPT_VERSION,     // Phase 15：Agent 工具意图（§一百四十八）
};

/** cacheType → AIFeature（路由/统计反推用） */
const FEATURE_BY_TYPE: Record<AICacheType, AIFeature> = {
  daily_curiosity: "daily_curiosity",
  daily_review: "daily_review",
  weekly_review: "weekly_review",
  monthly_review: "monthly_review",
  quarterly_review: "quarterly_review",
  connections: "knowledge_roaming",
  monthly_evolution: "monthly_evolution",
  quarterly_evolution: "quarterly_evolution",
  review_question: "review_question",
  query_exploration: "query_exploration",
  knowledge_processing: "knowledge_processing",
  translation: "translation",
  copywriting: "copywriting",
  anchor_exploration: "anchor_exploration",
  note_exam: "note_exam_generation",
  exam_grading: "note_exam_grading",
  workbench_ask: "workbench_ask",
  workbench_deep: "workbench_deep",
  workbench_research: "workbench_research",
  research_plan: "research_planning",
  research_search: "research_execution",
  research_summary: "source_summarization",
  research_synthesis: "research_execution",
  project_plan: "project_planning",
  agent_tool_call: "agent_tool_call",
};

function featureForType(type: AICacheType): AIFeature {
  return FEATURE_BY_TYPE[type] ?? "daily_curiosity";
}

/** AI 请求结果：成功带数据；失败带错误码（不抛给 UI 层，Dashboard 不崩） */
export type AIOutcome<T> =
  | { ok: true; data: T; fromCache: boolean; model: string }
  | { ok: false; error: AICacheErrorInfo; fromCache: boolean };

export interface AICallOpts {
  candidateLines: string[];
  candidatePaths: string[];
  areaLines: string[];
  dateLabel: string;
  /** 候选指纹（path+mtime+size）、区域指纹、周期键由调用方（ReviewManager）计算 */
  candidateSig: string;
  areaSig: string;
  periodKey: string;
  /** Discovery Scope（§四十）：scope 独立指纹 + 候选选择版本（§四十二）加入缓存 key；Review 不传 → key 不变 */
  scopeFingerprint?: string;
  selectionVersion?: string;
  /** Discovery 上下文（§三十七）：注入 prompt 的探索范围说明（奇想/漫游时由 main 提供） */
  discovery?: DiscoveryPromptContext;
  /** Query Explorer（本阶段）：用户原始问题（进 prompt；归一化问题已入 periodKey，§四十九/五十） */
  query?: string;
  /** Phase 8：一次复习 Session 最多生成问题数（§五十六：默认 5） */
  reviewQuestionMax?: number;
  /** Phase 14 Hotfix：考试生成目标题数上限（validate 传给 parser 作过滤上限，Hotfix §五） */
  examQuestionMax?: number;
  /** Phase 11：Anchor 探索（§三十）：以当前笔记为中心 */
  anchorTitle?: string;
  anchorPath?: string;
}

export interface AIGenerateRequest extends AICallOpts {
  type: AICacheType;
  messages: ChatMessage[];
  chatOpts: ChatOptions;
  allowReview: boolean;
  /** Phase 11：功能标识（路由与统计用；未传则按 cache type 反推） */
  feature?: AIFeature;
  /** Capture Processing（本阶段）：自定义缓存键部件（§九十八：processingType/sourcePath/sourceVersion） */
  customKeyParts?: string[];
  /** Capture Processing：来源 Capture 路径（validate 填充 candidate.sourcePath） */
  processingSourcePath?: string;
}

function cap(s: string, max: number): string {
  const t = (s || "").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function filterPaths(notes: unknown, allowed: string[]): { path: string; reason: string }[] {
  if (!Array.isArray(notes)) return [];
  const allowedSet = new Set(allowed.map((p) => p.replace(/\.md$/i, "")));
  const out: { path: string; reason: string }[] = [];
  for (const item of notes) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["path"] !== "string") continue;
    const bare = rec["path"].replace(/\.md$/i, "");
    if (!allowedSet.has(bare) && !allowed.includes(rec["path"] as string)) continue;
    if (out.length >= 5) break;
    out.push({
      path: rec["path"].replace(/\.md$/i, "") + ".md",
      reason: cap(typeof rec["reason"] === "string" ? rec["reason"] : "", 120),
    });
  }
  return out;
}


/** Phase 8：解析并校验 AI 复习问题（§五十三/五十四）。JSON 非法或过滤后无有效问题 → 抛错（只进 error 缓存，Test 12） */
export function parseReviewQuestionsText(raw: string, allowedPaths: string[], maxQuestions = 5): ReviewQuestion[] {
  const tryParse = (text: string): ReviewQuestion[] | null => {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const questions = filterValidQuestions(obj["questions"], allowedPaths, maxQuestions);
      return questions.length === 0 ? null : questions;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;
  const repaired = extractJsonBlockText(raw);
  if (repaired) {
    const parsed = tryParse(repaired);
    if (parsed) return parsed;
  }
  throw new AIError("AI 返回的复习问题 JSON 非法，或所有 path 都不在当前待复习候选清单中，已校验拒绝。请重试。");
}
/** AI Service：Request Cache + 请求合并(coalescing) + 错误缓存 + 手动 Regenerate。UI 层不接触裸 API。 */
export class AIService {
  private inFlight = new Map<string, Promise<AIOutcome<unknown>>>();

  constructor(
    private aiConfig: () => AIConfig,
    private cache: AICache,
    private resolveRoute?: (feature: AIFeature) => AIFunctionRoute
  ) {}

  /** 功能 → 实际路由（§一百三十五：未提供 resolver 时回退旧 settings.ai） */
  private routeFor(feature: AIFeature): AIFunctionRoute {
    if (this.resolveRoute) return this.resolveRoute(feature);
    const c = this.aiConfig();
    return {
      profileId: "default",
      providerType: "openai_compatible",
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      model: c.model,
      temperature: c.temperature,
      maxTokens: c.maxTokens,
      timeoutSec: c.timeoutSec,
      webEnabled: false,
    };
  }

  private provider(feature: AIFeature): SiliconFlowProvider {
    const r = this.routeFor(feature);
    return new SiliconFlowProvider({ baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model });
  }

  /** 配置指纹（§八十一：feature 独立路由；profile/provider/model/参数任一变化 → 该功能缓存失效，互不影响） */
  private configFingerprint(feature: AIFeature): string {
    const r = this.routeFor(feature);
    return fingerprintKey([
      "feature:" + feature,
      "profile:" + r.profileId,
      r.providerType,
      r.baseUrl,
      r.model,
      String(r.temperature),
      String(r.maxTokens),
      String(r.timeoutSec),
      "web:" + (r.webEnabled ? "1" : "0"),
    ]);
  }

  /** 完整 key：type + 周期 + 候选指纹 + 区域指纹 + promptVersion + 配置指纹（Discovery 时附加 scope + selectionVersion，§四十/四十二） */
  private buildKey(req: AIGenerateRequest): string {
    const parts = [
      req.type,
      req.periodKey,
      req.candidateSig,
      req.areaSig,
      PROMPT_VERSIONS[req.type],
      this.configFingerprint(req.feature ?? featureForType(req.type)),
    ];
    if (req.customKeyParts && req.customKeyParts.length) {
      // §九十八：Capture Processing 专用 key：type + processingType/sourcePath/sourceVersion + promptVersion + config
      return fingerprintKey([req.type, ...req.customKeyParts, PROMPT_VERSIONS[req.type], this.configFingerprint(req.feature ?? featureForType(req.type))]);
    }
    if (req.scopeFingerprint) {
      parts.push("scope:" + req.scopeFingerprint);
      parts.push("sel:" + (req.selectionVersion ?? ""));
    }
    return fingerprintKey(parts);
  }

  async testConnection(): Promise<void> {
    await this.provider("daily_curiosity").testConnection();
  }

  private async exec<T>(req: AIGenerateRequest, force: boolean): Promise<AIOutcome<T>> {
    const key = this.buildKey(req);
    const kf = force ? key + ":force" : key;

    // 1) 未强制且缓存命中 → 直接复用（成功或已缓存的错误，都不再请求）
    if (!force) {
      const hit = this.cache.get(key);
      if (hit) {
        if (hit.status === "success" && hit.data !== undefined && examCacheDataValid(req.type, hit.data)) {
          console.info("[KnowledgeGarden][AI] cache hit", req.type);
          return { ok: true, data: hit.data as T, fromCache: true, model: hit.model };
        }
        if (hit.status === "error" && hit.error) {
          console.info("[KnowledgeGarden][AI] cache hit (error 缓存)", req.type);
          return { ok: false, error: hit.error, fromCache: true };
        }
      }
    }

    // 2) 请求合并：同一 key 并发 → 等待既有请求（快速连点只产生一个真实请求）
    const existing = this.inFlight.get(kf) as Promise<AIOutcome<T>> | undefined;
    if (existing) {
      console.info("[KnowledgeGarden][AI] request coalesced", req.type);
      return existing;
    }

    const promise = this.requestOnce<T>(req, key);
    this.inFlight.set(kf, promise as Promise<AIOutcome<unknown>>);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(kf);
    }
  }

  private async requestOnce<T>(req: AIGenerateRequest, key: string): Promise<AIOutcome<T>> {
    this.recordRequest(req.type);
    const now = Date.now();
    try {
      const res = await this.provider(req.feature ?? featureForType(req.type)).chat(req.messages, req.chatOpts);
      // 校验成功才允许写入 success 缓存（非法 JSON / 过短结果只进 error 缓存）
      const data = this.validate<T>(res.content, req);
      this.cache.put({
        key,
        type: req.type,
        createdAt: now,
        updatedAt: now,
        model: res.model,
        promptVersion: PROMPT_VERSIONS[req.type],
        candidateFingerprint: req.candidateSig,
        configFingerprint: this.configFingerprint(req.feature ?? featureForType(req.type)),
        status: "success",
        data: data as AICacheEntry["data"],
      } as AICacheEntry<any>);
      console.info("[KnowledgeGarden][AI] cache miss -> success", req.type);
      return { ok: true, data, fromCache: false, model: res.model };
    } catch (e) {
      const err = e instanceof AIError ? e : new AIError(String((e as Error)?.message || "未知错误"));
      const info: AICacheErrorInfo = { code: this.errorCode(err), message: err.message };
      this.cache.put({
        key,
        type: req.type,
        createdAt: now,
        updatedAt: now,
        model: this.routeFor(req.feature ?? featureForType(req.type)).model,
        promptVersion: PROMPT_VERSIONS[req.type],
        candidateFingerprint: req.candidateSig,
        configFingerprint: this.configFingerprint(req.feature ?? featureForType(req.type)),
        status: "error",
        error: info,
      } as AICacheEntry<any>);
      console.info("[KnowledgeGarden][AI] cache miss -> error", req.type, info.code);
      return { ok: false, error: info, fromCache: false };
    }
  }

  private errorCode(e: AIError): string {
    const m = e.message;
    if (m.includes("考试") && m.includes("JSON")) return "EXAM_INVALID_JSON";
    if (m.includes("考试") && m.includes("字段")) return "EXAM_INVALID_SCHEMA";
    if (m.includes("无有效题目")) return "EXAM_NO_VALID_QUESTIONS";
    if (m.includes("评分")) return "EXAM_GRADING_INVALID";
    if (m.includes("尚未配置") || m.includes("API Key")) return "MISSING_KEY";
    if (m.includes("超时") || /timeout/i.test(m)) return "TIMEOUT";
    if (m.includes("API 返回错误")) return "HTTP_ERROR";
    if (m.includes("JSON") || m.includes("解析")) return "INVALID_JSON";
    if (m.includes("空响应") || m.includes("过短")) return "EMPTY_RESPONSE";
    return "NETWORK";
  }

  /** 结果校验入口：奇想/连接走 JSON schema；复盘走 Markdown 最小长度 */
  private validate<T>(content: string, req: AIGenerateRequest): T {
    if (req.type === "monthly_evolution" || req.type === "quarterly_evolution") {
      return this.parseEvolution(content) as unknown as T;
    }
    if (req.type === "review_question") {
      return parseReviewQuestionsText(content, req.candidatePaths, req.reviewQuestionMax ?? 5) as unknown as T;
    }
    if (req.type === "knowledge_processing") {
      const c = parseProcessingResult(content, req.candidatePaths, req.processingSourcePath);
      if (!c) throw new AIError("AI 返回的 Processing 结果缺少必要字段（title/summary）或不是合法 JSON，已校验拒绝。请重试。");
      return c as unknown as T;
    }
    if (req.type === "query_exploration") {
      const qr = this.parseQueryExploration(content, req.candidatePaths);
      if (!qr) throw new AIError("AI 返回的知识关联 JSON 非法，或没有有效节点，已校验拒绝。请重试。");
      return qr as unknown as T;
    }
    if (req.type === "anchor_exploration") {
      const ar = this.parseQueryExploration(content, req.candidatePaths);
      if (!ar) throw new AIError("AI 返回的 Anchor 关联 JSON 非法，或没有有效节点，已校验拒绝。请重试。");
      return ar as unknown as T;
    }
    if (req.type === "note_exam") {
      return parseExamGeneration(content, req.examQuestionMax) as unknown as T;
    }
    if (req.type === "exam_grading") {
      return parseExamGrading(content) as unknown as T;
    }
    // Phase 15：Workbench 系列（Ask/研究/项目/Agent）——领域解析链在 service 之外（workbenchParsers / agentLoop）。
    // validate 只做「合法 JSON 门禁」后原样透传 content；否则会掉入下方 markdown fallback、返回 {markdown,model} 对象，
    // 导致下游 parser 对对象调用 (content ?? "").trim() 崩溃（Hotfix 根因：trim is not a function）。
    if (req.type === "workbench_ask" || req.type === "workbench_deep" || req.type === "workbench_research" || req.type === "research_plan" || req.type === "research_search"
      || req.type === "research_summary" || req.type === "research_synthesis" || req.type === "project_plan"
      || req.type === "agent_tool_call") {
      const block = this.extractJsonBlock(content);
      if (!block) throw new AIError("AI 返回的 Workbench 结果不是合法 JSON，已校验拒绝。请重试。");
      return content as unknown as T;
    }
    if (req.type === "translation" || req.type === "copywriting") {
      const tx = content.trim();
      if (!tx) throw new AIError("AI 返回的内容为空，请重试。");
      return tx as unknown as T;
    }

    if (req.type === "daily_curiosity" || req.type === "connections") {
      if (req.type === "connections") {
        const conn = this.parseConnections(content, req.candidatePaths);
        if (!conn.title || !conn.summary || conn.nodes.length === 0) {
          throw new AIError("AI 返回的 JSON 缺少有效节点（title/summary/nodes）。请重试。");
        }
        return conn as unknown as T;
      }
      const insight = this.parseInsight(content, req.candidatePaths);
      if (!insight.title || !insight.summary || !Array.isArray(insight.notes)) {
        throw new AIError("AI 返回的 JSON 缺少必要字段（title/summary/notes），已校验拒绝。请重试。");
      }
      return insight as unknown as T;
    }
    const markdown = content.trim();
    if (markdown.length < 50) throw new AIError("AI 返回的复盘内容过短，请重试。");
    return { markdown, model: this.aiConfig().model } as unknown as T;
  }

  private parseInsight(raw: string, allowedPaths: string[]): AIInsight {
    const tryParse = (text: string): AIInsight | null => {
      try {
        const obj = JSON.parse(text) as Record<string, unknown>;
        const type = VALID_TYPES.includes(obj["type"] as InsightType) ? (obj["type"] as InsightType) : "connection";
        return {
          title: cap(obj["title"] as string, 80),
          type,
          summary: cap(obj["summary"] as string, 500),
          question: cap(obj["question"] as string, 300),
          notes: filterPaths(obj["notes"], allowedPaths),
        };
      } catch {
        return null;
      }
    };
    const direct = tryParse(raw);
    if (direct) return direct;
    const repaired = this.extractJsonBlock(raw);
    if (repaired) {
      const parsed = tryParse(repaired);
      if (parsed) return parsed;
    }
    throw new AIError("AI 返回的内容不是合法 JSON，自动修复失败。请重试。");
  }

  /** Phase 5：解析并校验 Connection 结果——JSON parse → schema → path 校验 → edge 校验（§42） */
  private parseConnections(raw: string, allowedPaths: string[]): AIConnectionResult {
    const tryParse = (text: string): AIConnectionResult | null => {
      try {
        const obj = JSON.parse(text) as Record<string, unknown>;
        const type = VALID_TYPES.includes(obj["type"] as InsightType) ? (obj["type"] as InsightType) : "connection";
        const nodes = filterConnectionNodes(obj["nodes"], allowedPaths);
        if (nodes.length === 0) return null; // 无有效节点 → 整条结果无效（进 error 缓存）
        const edges = filterConnectionEdges(obj["edges"], nodes);
        return {
          title: cap(obj["title"] as string, 80),
          type,
          summary: cap(obj["summary"] as string, 500),
          question: cap(obj["question"] as string, 300),
          nodes,
          edges,
        };
      } catch {
        return null;
      }
    };
    const direct = tryParse(raw);
    if (direct) return direct;
    const repaired = this.extractJsonBlock(raw);
    if (repaired) {
      const parsed = tryParse(repaired);
      if (parsed) return parsed;
    }
    throw new AIError("AI 返回的内容不是合法 JSON，自动修复失败。请重试。");
  }
  /** Phase 7：解析并校验长期演化 JSON（§三十：period/headline 必填，数组可为空；失败不入 success 缓存） */
  private parseEvolution(content: string): LongTermReflectionData {
    const tryParse = (text: string): LongTermReflectionData | null => {
      try {
        const obj = JSON.parse(text) as Record<string, unknown>;
        const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
        const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim().slice(0, 200)).filter(Boolean) : []);
        const periodVal = str(obj["period"], 16);
        const headline = str(obj["headline"], 200);
        if (!periodVal || !headline) return null;
        return {
          period: periodVal,
          headline,
          themes: arr(obj["themes"]),
          emergingAreas: arr(obj["emergingAreas"]),
          sustainedAreas: arr(obj["sustainedAreas"]),
          fadingAreas: arr(obj["fadingAreas"]),
          bridges: arr(obj["bridges"]),
          recurringQuestions: arr(obj["recurringQuestions"]),
          knowledgeGaps: arr(obj["knowledgeGaps"]),
          nextExplorations: arr(obj["nextExplorations"]),
        };
      } catch { return null; }
    };
    const direct = tryParse(content);
    if (direct) return direct;
    const repaired = this.extractJsonBlock(content);
    if (repaired) { const p = tryParse(repaired); if (p) return p; }
    throw new AIError("AI 返回的长期演化 JSON 缺少必要字段（period/headline）或不是合法 JSON，已校验拒绝。请重试。");
  }

  private extractJsonBlock(text: string): string | null {
    return extractJsonBlockText(text);
  }

  private chatOpts(feature: AIFeature, maxTokens?: number): ChatOptions {
    const r = this.routeFor(feature);
    return { temperature: r.temperature, maxTokens: maxTokens ?? r.maxTokens, timeoutSec: r.timeoutSec };
  }

  // ---------- 公开入口 ----------

  /** 今日知识奇想（connections 同语义）：同一天、同候选、同配置默认复用；force=true 强制新结果 */
  async generateCuriosity(opts: AICallOpts, force = false): Promise<AIOutcome<AIInsight>> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildCuriositySystem(opts.candidateLines, opts.areaLines, opts.dateLabel, opts.discovery) },
      { role: "user", content: "请只输出符合 schema 的 JSON。若没有有价值的连接，优先输出 type=question 或 missing_link，并说明缺失的是什么。" },
    ];
    return this.exec<AIInsight>({
      ...opts,
      type: "daily_curiosity",
      feature: "daily_curiosity",
      messages,
      chatOpts: this.chatOpts("daily_curiosity"),
      allowReview: false,
    }, force);
  }

  /** Phase 5：今日知识漫游——AI 提出可解释的 nodes/edges 连接；同一天同候选默认复用缓存；force=true 强制新结果 */
  async generateConnections(opts: AICallOpts, force = false): Promise<AIOutcome<AIConnectionResult>> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildConnectionsSystem(opts.candidateLines, opts.areaLines, opts.dateLabel, opts.discovery) },
      { role: "user", content: "请只输出符合 schema 的 JSON，nodes[].path 与 edges[].from/to 必须使用候选清单中的完整路径。" },
    ];
    return this.exec<AIConnectionResult>({
      ...opts,
      type: "connections",
      feature: "knowledge_roaming",
      messages,
      chatOpts: this.chatOpts("knowledge_roaming", 2200),
      allowReview: false,
    }, force);
  }

  /** Query Explorer：用户主动提问 → AI 整理候选关系；同 query+scope+候选 复用缓存；force 强制新结果（§四十八/五十二/七十三） */
  async generateQueryExploration(opts: AICallOpts, force = false): Promise<AIOutcome<QueryExplorationResult>> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildQueryExplorationSystem(
          opts.query ?? "",
          opts.discovery?.scopeLabel ?? "整个仓库",
          opts.candidateLines,
          opts.discovery?.poolCount ?? opts.candidatePaths.length,
          opts.candidatePaths.length
        ),
      },
      { role: "user", content: "请只输出符合 schema 的 JSON。若候选不足以支持结论，headline 如实说明证据不足，不要强行制造连接。" },
    ];
    return this.exec<QueryExplorationResult>({
      ...opts,
      type: "query_exploration",
      feature: "query_exploration",
      messages,
      chatOpts: this.chatOpts("query_exploration", 2200),
      allowReview: false,
    }, force);
  }

  /** Query Explorer：解析并校验 AI 结果（节点白名单 + 边校验，§八十四/八十五；非法 → null → error 缓存） */
  private parseQueryExploration(raw: string, allowedPaths: string[]): QueryExplorationResult | null {
    return parseQueryExplorationText(raw, allowedPaths);
  }

  /** Phase 7：月度长期演化——AI 只解读本地聚合摘要（§三十三）；同月同摘要默认复用缓存；force 强制（§五十/五十四） */
  async generateMonthlyEvolution(opts: AICallOpts & EvolutionPromptInput, force = false): Promise<AIOutcome<LongTermReflectionData>> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildMonthlyEvolutionUser(opts) },
      { role: "user", content: "请只输出符合 schema 的 JSON。数据不足时数组可以为空，但 period 与 headline 不能为空。" },
    ];
    return this.exec<LongTermReflectionData>({
      ...opts,
      type: "monthly_evolution",
      feature: "monthly_evolution",
      messages,
      chatOpts: this.chatOpts("monthly_evolution", 2200),
      allowReview: false,
    }, force);
  }

  /** Phase 7：季度长期演化（§三十七）：更宏观，结构变化与兴趣迁移优先 */
  async generateQuarterlyEvolution(opts: AICallOpts & EvolutionPromptInput, force = false): Promise<AIOutcome<LongTermReflectionData>> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildQuarterlyEvolutionUser(opts) },
      { role: "user", content: "请只输出符合 schema 的 JSON。季度观察更宏观：结构变化与兴趣迁移优先于逐月数字。" },
    ];
    return this.exec<LongTermReflectionData>({
      ...opts,
      type: "quarterly_evolution",
      feature: "quarterly_evolution",
      messages,
      chatOpts: this.chatOpts("quarterly_evolution", 2600),
      allowReview: false,
    }, force);
  }

  /** Capture Processing（本阶段）：AI 只提炼为 Knowledge Candidate（§九十六 schema 校验；失败只进 error 缓存）。
   *  cache key：processingType/sourcePath/sourceVersion/promptVersion/config（§九十八），
   *  无关笔记修改不会失效；同 source 未修改时缓存命中（Test 8/9/10）。 */
  async generateKnowledgeProcessing(opts: {
    content: string;
    sourcePath: string;
    sourceVersion: string;
    sourceTitle?: string;
    suggestTags: boolean;
    suggestAreas: boolean;
    areaLines: string[];
    vaultPaths: string[];
    processingType?: string;
  }, force = false): Promise<AIOutcome<KnowledgeCandidate>> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildCaptureProcessingSystem({
          content: opts.content,
          sourceTitle: opts.sourceTitle,
          suggestTags: opts.suggestTags,
          suggestAreas: opts.suggestAreas,
          areaLines: opts.areaLines,
        }),
      },
      { role: "user", content: "请只输出符合 schema 的 JSON。资料本身不可信；若资料没有进一步提炼的价值，knowledgeValue 如实填 low。" },
    ];
    return this.exec<KnowledgeCandidate>({
      type: "knowledge_processing",
      feature: "knowledge_processing",
      candidateLines: [],
      candidatePaths: opts.vaultPaths,
      areaLines: opts.areaLines,
      dateLabel: "",
      candidateSig: "",
      areaSig: "",
      periodKey: "",
      customKeyParts: [opts.processingType ?? PROCESSING_TYPE_CAPTURE, opts.sourcePath, opts.sourceVersion],
      processingSourcePath: opts.sourcePath,
      messages,
      chatOpts: this.chatOpts("knowledge_processing", 2200),
      allowReview: false,
    }, force);
  }

  /** Phase 8：AI 复习问题（§十七~二十五）：只针对当前待复习笔记生成，每次 Session 最多一次请求（§五十六）。
   *  同周期同候选同配置默认复用缓存；失败由 Session 用系统 fallback（§二十五）；绝不影响 lastReviewedAt（§六十九）。 */
  async generateReviewQuestions(opts: AICallOpts, force = false): Promise<AIOutcome<ReviewQuestion[]>> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildReviewQuestionsSystem(opts.dateLabel) },
      { role: "user", content: buildReviewQuestionsUser({ dateLabel: opts.dateLabel, lines: opts.candidateLines }) },
    ];
    return this.exec<ReviewQuestion[]>({
      ...opts,
      type: "review_question",
      feature: "review_question",
      messages,
      chatOpts: this.chatOpts("review_question", 1200),
      allowReview: false,
    }, force);
  }
  async generateDailyReview(opts: AICallOpts, force = false): Promise<AIOutcome<ReviewCacheData>> {
    const messages: ChatMessage[] = [
      { role: "system", content: "你是知识复盘助手（见用户消息中的角色定义）。" },
      { role: "user", content: buildDailyReviewUser(opts.candidateLines, opts.areaLines, opts.dateLabel) },
    ];
    return this.exec<ReviewCacheData>({
      ...opts,
      type: "daily_review",
      feature: "daily_review",
      messages,
      chatOpts: this.chatOpts("daily_review", 2500),
      allowReview: true,
    }, force);
  }

  /** 周/月/季/自定义复用同一结构化输入管线；缓存按 cacheType 区分（§42：调度与缓存共用同一 key 算法） */
  private async reviewFrom(opts: AICallOpts & WeeklyReviewInput, cacheType: AICacheType, force: boolean): Promise<AIOutcome<ReviewCacheData>> {
    const messages: ChatMessage[] = [
      { role: "system", content: "你是知识复盘助手（见用户消息中的角色定义）。" },
      { role: "user", content: buildWeeklyReviewUser(opts) },
    ];
    return this.exec<ReviewCacheData>({
      ...opts,
      type: cacheType,
      feature: featureForType(cacheType),
      messages,
      chatOpts: this.chatOpts(featureForType(cacheType), 3000),
      allowReview: true,
    }, force);
  }

  async generateWeeklyReview(opts: AICallOpts & WeeklyReviewInput, force = false): Promise<AIOutcome<ReviewCacheData>> {
    return this.reviewFrom(opts, "weekly_review", force);
  }

  async generateMonthlyReview(opts: AICallOpts & WeeklyReviewInput, force = false): Promise<AIOutcome<ReviewCacheData>> {
    return this.reviewFrom({ ...opts, periodLabel: "月" }, "monthly_review", force);
  }

  async generateQuarterlyReview(opts: AICallOpts & WeeklyReviewInput, force = false): Promise<AIOutcome<ReviewCacheData>> {
    return this.reviewFrom({ ...opts, periodLabel: "季" }, "quarterly_review", force);
  }

  async generateCustomReview(opts: AICallOpts & WeeklyReviewInput, force = false): Promise<AIOutcome<ReviewCacheData>> {
    return this.reviewFrom({ ...opts, periodLabel: "自定义" }, "weekly_review", force);
  }

  /** Phase 11：Anchor Knowledge Exploration（以当前笔记为中心探索关联；复用 Query schema 校验） */
  async generateAnchorExploration(opts: AICallOpts, force = false): Promise<AIOutcome<QueryExplorationResult>> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildAnchorExplorationSystem({
          anchorTitle: opts.anchorTitle ?? "",
          anchorPath: opts.anchorPath ?? "",
          scopeLabel: opts.discovery?.scopeLabel ?? "整个仓库",
          candidateLines: opts.candidateLines,
          poolCount: opts.discovery?.poolCount ?? opts.candidatePaths.length,
          count: opts.candidatePaths.length,
        }),
      },
      { role: "user", content: "请只输出符合 schema 的 JSON。若证据不足，headline 如实说明，不要强行制造连接。" },
    ];
    return this.exec<QueryExplorationResult>({
      ...opts,
      type: "anchor_exploration",
      feature: "anchor_exploration",
      messages,
      chatOpts: this.chatOpts("anchor_exploration", 2200),
      allowReview: false,
    }, force);
  }

  /** Phase 11 统一自由文本入口（翻译/文案等）：customKeyParts 由调用方构造（含用户输入/路由相关部件） */
  async generateForFeature(
    feature: AIFeature,
    messages: ChatMessage[],
    opts: { maxTokens?: number; customKeyParts: string[]; force?: boolean }
  ): Promise<AIOutcome<string>> {
    const type = cacheTypeForFeature(feature) as AICacheType;
    return this.exec<string>({
      type,
      feature,
      candidateLines: [],
      candidatePaths: [],
      areaLines: [],
      dateLabel: "",
      candidateSig: "",
      areaSig: "",
      periodKey: "",
      customKeyParts: opts.customKeyParts,
      messages,
      chatOpts: this.chatOpts(feature, opts.maxTokens),
      allowReview: false,
    }, opts.force ?? false);
  }

  /**
   * Phase 16 §二十六~二十九 / 三十~三十一：Streaming 优先的写作入口（Fast/Deep Rewrite）。
   * - 缓存命中 → 直接返回全量（AI Request = 0，§三十一）。
   * - Miss → provider.stream（onDelta 实时渲染；onFirstToken 记 TTFT）；stream 抛错 → 仅回退一次普通 chat（§二十七）。
   * - 用户取消（AbortController，§二十八）→ 返回 CANCELLED 且不写缓存（取消不是 AI 失败，不污染 error cache）。
   */
  async generateForFeatureStream(
    feature: AIFeature,
    messages: ChatMessage[],
    opts: {
      maxTokens?: number;
      customKeyParts: string[];
      force?: boolean;
      signal?: AbortSignal;
      onDelta?: (delta: string) => void;
      onFirstToken?: (at: number) => void;
    }
  ): Promise<AIOutcome<string>> {
    const type = cacheTypeForFeature(feature) as AICacheType;
    const req: AIGenerateRequest = {
      type,
      feature,
      candidateLines: [],
      candidatePaths: [],
      areaLines: [],
      dateLabel: "",
      candidateSig: "",
      areaSig: "",
      periodKey: "",
      customKeyParts: opts.customKeyParts,
      messages,
      chatOpts: this.chatOpts(feature, opts.maxTokens),
      allowReview: false,
    };
    const key = this.buildKey(req);
    const kf = opts.force ? key + ":force" : key;
    if (!opts.force) {
      const hit = this.cache.get(key);
      if (hit && hit.status === "success" && typeof hit.data === "string") {
        console.info("[KnowledgeGarden][AI] cache hit (stream)", type);
        return { ok: true, data: hit.data as string, fromCache: true, model: hit.model };
      }
      if (hit && hit.status === "error" && hit.error) {
        console.info("[KnowledgeGarden][AI] cache hit error (stream)", type);
        return { ok: false, error: hit.error, fromCache: true };
      }
    }
    const existing = this.inFlight.get(kf) as Promise<AIOutcome<string>> | undefined;
    if (existing) return existing;
    const promise = this.requestOnceStream(req, key, opts);
    this.inFlight.set(kf, promise as Promise<AIOutcome<unknown>>);
    try { return await promise; } finally { this.inFlight.delete(kf); }
  }

  private async requestOnceStream(
    req: AIGenerateRequest,
    key: string,
    opts: { signal?: AbortSignal; onDelta?: (delta: string) => void; onFirstToken?: (at: number) => void }
  ): Promise<AIOutcome<string>> {
    this.recordRequest(req.type);
    const now = Date.now();
    const route = this.routeFor(req.feature ?? featureForType(req.type));
    const provider = this.provider(req.feature ?? featureForType(req.type));
    try {
      let content: string;
      let model: string;
      try {
        const res = await provider.stream(req.messages, req.chatOpts, opts.signal, opts.onDelta, opts.onFirstToken);
        content = res.content;
        model = res.model;
      } catch {
        // §二十七：stream 失败 → 回退普通 chat（仅一次；stream 正常时绝不重复发起两个请求）
        const res = await provider.chat(req.messages, req.chatOpts);
        content = res.content;
        model = res.model;
      }
      const data = this.validate<string>(content, req);
      this.cache.put({
        key,
        type: req.type,
        createdAt: now,
        updatedAt: now,
        model,
        promptVersion: PROMPT_VERSIONS[req.type],
        candidateFingerprint: req.candidateSig,
        configFingerprint: this.configFingerprint(req.feature ?? featureForType(req.type)),
        status: "success",
        data: data as AICacheEntry["data"],
      } as AICacheEntry<any>);
      console.info("[KnowledgeGarden][AI] cache miss -> success (stream)", req.type);
      return { ok: true, data, fromCache: false, model };
    } catch (e) {
      if (opts.signal && opts.signal.aborted) {
        return { ok: false, error: { code: "CANCELLED", message: "已取消当前请求。" }, fromCache: false };
      }
      const err = e instanceof AIError ? e : new AIError(String((e as Error)?.message || "未知错误"));
      const info: AICacheErrorInfo = { code: this.errorCode(err), message: err.message };
      this.cache.put({
        key,
        type: req.type,
        createdAt: now,
        updatedAt: now,
        model: route.model,
        promptVersion: PROMPT_VERSIONS[req.type],
        candidateFingerprint: req.candidateSig,
        configFingerprint: this.configFingerprint(req.feature ?? featureForType(req.type)),
        status: "error",
        error: info,
      } as AICacheEntry<any>);
      console.info("[KnowledgeGarden][AI] cache miss -> error (stream)", req.type, info.code);
      return { ok: false, error: info, fromCache: false };
    }
  }

  // ---------- Phase 11：AI 请求统计（今日调用次数；本地诊断，不记 Key/Prompt/网页正文） ----------
  private statDayKey = "";
  private statByFeature = new Map<string, number>();
  private statTotal = 0;

  private statDay(now = new Date()): string {
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  private recordRequest(type: AICacheType): void {
    const day = this.statDay();
    if (this.statDayKey !== day) { this.statDayKey = day; this.statByFeature.clear(); this.statTotal = 0; }
    const f = featureForType(type);
    this.statByFeature.set(f, (this.statByFeature.get(f) ?? 0) + 1);
    this.statTotal++;
  }

  /** 今日真实 AI 请求统计（缓存命中不计） */
  requestStats(): { day: string; byFeature: Record<string, number>; total: number } {
    const day = this.statDay();
    if (this.statDayKey !== day) { this.statDayKey = day; this.statByFeature.clear(); this.statTotal = 0; }
    const byFeature: Record<string, number> = {};
    for (const [f, n] of this.statByFeature) byFeature[f] = n;
    return { day, byFeature, total: this.statTotal };
  }

  /** Scheduler 联动（§25/40/42）：只读缓存状态 success/error/none，绝不发起请求，key 与 exec 完全一致 */
  cacheStatus(type: AICacheType, periodKey: string, candidateSig: string, areaSig: string): "success" | "error" | "none" {
    const key = fingerprintKey([type, periodKey, candidateSig, areaSig, PROMPT_VERSIONS[type], this.configFingerprint(featureForType(type))]);
    const hit = this.cache.get(key);
    if (!hit) return "none";
    return hit.status === "success" ? "success" : "error";
  }


  /** Phase 14 §一百一十四~一百一十六：生成笔记知识考试（§40/41 cache key：sourcePath+sourceVersion+mode+topic+count+difficulty+answerMode+model+promptVersion+contextHash+workspace+skill+web）。 */
  async generateExam(
    opts: {
      sourcePath: string;
      sourceVersion: string;
      noteTitle: string;
      noteText: string;                    // 已按 Context Policy 截断
      mode: "holistic" | "custom";
      topic?: string;
      questionCount: number;
      difficulty?: "easy" | "medium" | "hard";
      answerMode: ExamAnswerMode;
      webEnabled: boolean;
      webContextLines?: string[];          // web_allowed 时的外部补充
      skillInstructions?: string;          // Exam Skill（可选）
      workspaceFingerprint?: string;       // §四十六：Workspace 参与 → 缓存失效
      skillFingerprint?: string;           // §四十六
      contextHash?: string;                // §四十一：Exam Context Hash
    },
    force = false
  ): Promise<AIOutcome<{ title: string; coverageTopics?: string[]; questions: ExamQuestion[] }>> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildExamGenerationSystem({
          mode: opts.mode,
          topic: opts.topic,
          questionCount: opts.questionCount,
          difficulty: opts.difficulty,
          answerMode: opts.answerMode,
          noteTitle: opts.noteTitle,
          noteText: opts.noteText,
          webContextLines: opts.webContextLines,
          skillInstructions: opts.skillInstructions,
        }),
      },
      { role: "user", content: "请只输出符合 schema 的 JSON。若原文信息不足，题目的 referenceAnswer 明确写“原文没有足够信息回答该题”，不要编造。" },
    ];
    return this.exec<{ title: string; coverageTopics?: string[]; questions: ExamQuestion[] }>({
      type: "note_exam",
      feature: "note_exam_generation",
      candidateLines: [],
      candidatePaths: [opts.sourcePath],
      areaLines: [],
      dateLabel: "",
      candidateSig: fingerprintKey([opts.sourcePath, opts.sourceVersion]),
      areaSig: "",
      periodKey: "",
      customKeyParts: [
        "exam",
        opts.sourcePath,
        opts.sourceVersion,
        opts.mode,
        opts.topic ?? "",
        String(opts.questionCount),
        opts.difficulty ?? "medium",
        opts.answerMode,
        "web:" + (opts.webEnabled ? "1" : "0"),
        "ws:" + (opts.workspaceFingerprint ?? ""),
        "skill:" + (opts.skillFingerprint ?? ""),
        "ctx:" + (opts.contextHash ?? ""),
      ],
        examQuestionMax: opts.questionCount,
      messages,
      chatOpts: this.chatOpts("note_exam_generation", 3000),
      allowReview: false,
    }, force);
  }

  /** Phase 14 §一百五十九/一百六十二：开放题按需 AI 评分（§164 cache 不含 API Key；答案/参考变 → miss）。 */
  async gradeExamAnswer(
    opts: {
      examId: string;
      questionId: string;
      question: string;
      referenceAnswer: string;
      sourceEvidence?: string[];
      userAnswer: string;
      hasWeb?: boolean;
      model?: string; // 信息性
      workspaceFingerprint?: string;
      skillFingerprint?: string;
    },
    force = false
  ): Promise<AIOutcome<{ correctness: "correct" | "partial" | "wrong"; score: number; strengths: string[]; missing: string[]; misconceptions: string[] }>> {
    const messages: ChatMessage[] = [
      { role: "system", content: buildExamGradingSystem() },
      {
        role: "user",
        content: buildExamGradingUser({
          question: opts.question,
          referenceAnswer: opts.referenceAnswer,
          sourceEvidence: opts.sourceEvidence,
          userAnswer: opts.userAnswer,
          hasWeb: opts.hasWeb,
        }),
      },
    ];
    return this.exec<{ correctness: "correct" | "partial" | "wrong"; score: number; strengths: string[]; missing: string[]; misconceptions: string[] }>({
      type: "exam_grading",
      feature: "note_exam_grading",
      candidateLines: [],
      candidatePaths: [],
      areaLines: [],
      dateLabel: "",
      candidateSig: fingerprintKey([opts.examId, opts.questionId, opts.referenceAnswer]),
      areaSig: "",
      periodKey: "",
      customKeyParts: [
        "grade",
        opts.examId,
        opts.questionId,
        fingerprintKey([opts.referenceAnswer, opts.userAnswer]), // §一百零九/一百六十五：答案或参考变化 → miss
        "ws:" + (opts.workspaceFingerprint ?? ""),
        "skill:" + (opts.skillFingerprint ?? ""),
      ],
      messages,
      chatOpts: this.chatOpts("note_exam_grading", 1200),
      allowReview: false,
    }, force);
  }
}

