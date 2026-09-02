import { Plugin, WorkspaceLeaf, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type Period, type PluginSettings, type ReviewQueue, type ReviewQuestion } from "./types";
import { NoteIndex, type NoteMetadata } from "./noteIndex";
import { SearchIndex, extractAliases, extractHeadings, tokenizeText } from "./searchIndex";
import { QueryHistoryStore } from "./queryHistory";
import { QUERY_MAX_LENGTH, buildQueryCacheKey, parseQuery, queryScopePaths, rankSearchResults, selectQueryCandidates } from "./queryExplorer";
import { PROMPT_VERSIONS } from "./ai/service";
import type { DiscoveryScope, KnowledgeWorkspace, QueryExplorationResult, QueryScopeMode, SavedExploration, SavedExplorationEdge, SavedExplorationNode, SavedExplorationSource, NoteExam, ExamSessionState, SavedReviewCard, MasteryRating, ExamQuestionType } from "./types";
import type { ActivityEntry, KGState } from "./types";
import { defaultProfileFrom, resolveAIFunctionRoute, resolveAIFunctionRouteWithWorkspace, routeFingerprint, routeFingerprintWithWorkspace } from "./aiRouting";
import { defaultWorkspace, resolveWorkspace, workspaceFingerprint } from "./workspace";
import { BUILTIN_SKILL_SUMMARIES } from "./skills";
import { AITaskEngine } from "./taskEngine";
import { getNotesByState, pickRandomNote, resolveStateBrowseScope, stateBrowseLabel } from "./stateBrowse";
import { ANCHOR_COUNT_DEFAULT, ANCHOR_LOCAL_LIMIT_DEFAULT, anchorScopePaths, anchorTokens, buildAnchorCacheKey } from "./anchorExplorer";
import { ANCHOR_PROMPT_VERSION } from "./prompts";
import { NoteToolbox } from "./noteToolbox";
import { SavedExplorationStore, parseSavedFrontmatter, safeTitle, savedFingerprint, savedId, savedMarkdown } from "./savedExploration";
import { AIError, SiliconFlowProvider } from "./ai/provider";
import { AIService } from "./ai/service";
import { ReviewManager } from "./review";
import { ActivityStore } from "./activity";
import { ReviewCenterStore, buildReviewQueue, dailyPeriodKey, markCompleted, markSkipped, markSnoozed, nextActiveIndex, pruneQueue, safeResumeIndex, sessionFinished } from "./reviewCenter";
import { ReviewSessionView, VIEW_TYPE_REVIEW } from "./reviewSession";

/* ================= Phase 14：Note Exam / Review Cards ================= */
import { ExamSessionView, VIEW_TYPE_EXAM } from "./examView";
import { CardsView, VIEW_TYPE_CARDS } from "./cardsView";
import { examMarkdown, cardMarkdown, examMarkdownPath, cardMarkdownPath, examFingerprint, newExamId, newCardId, examDirPath, cardsDirPath, parseExamMarkdown, parseCardMarkdown, ExamStore, ReviewCardStore, ExamSessionStore, CardReviewStore } from "./examStore";
import { filterValidExamQuestions, examProgress, examSessionFinished, safeExamResumeIndex, selfMasteryPercent, aiMasteryPercent, masteryLabel, masteryGapHint, weakConceptsOf, strongConceptsOf, type ExamProgressStats } from "./examEngine";
import { ExamBuildModal, type ExamBuildParams } from "./examView";
import { collectWebContext } from "./webContext";
import { ReviewScheduler } from "./scheduler";
import { forgottenCandidates } from "./knowledgeState";
import { DashboardView, VIEW_TYPE_KG } from "./dashboard";
import { SavedExplorationView, VIEW_TYPE_SAVED } from "./savedView";
import { KnowledgeGardenSettingTab } from "./settings";
import { AICache } from "./ai/cache";
import { FORMAT_VERSION, withFormatVersion } from "./migrations";
import { DiagnosticsModal } from "./diagnostics";
import { RelationshipStore, buildRelationshipMarkdown, parseRelationshipMarkdown, relNodeLabel, relSafeFileName, type ParsedRelationshipMarkdown } from "./relationshipStore";
import { DISCOVERY_SELECTION_VERSION, DiscoveryStore, discoveryDateKey, discoveryPool, discoveryScopeFingerprint, discoveryScopeLabel, selectCandidates, type DiscoveryFeature } from "./discovery";
import { EvolutionStore } from "./evolutionStore";
import { buildEvolutionSummary, computeSnapshot, findBridgeNotes, growthScore, monthlyPeriodLabel, quarterlyPeriodLabel, trendArrow } from "./knowledgeEvolution";
import { areaSig, candidateSig, fingerprintKey, periodKeyFor } from "./ai/cache";
import type { AICallOpts } from "./ai/service";
import type { DiscoveryPromptContext, EvolutionPromptInput } from "./prompts";
import type { LongTermReflectionData } from "./types";
import type { CaptureType, CurationStatus, KnowledgeCandidate, KnowledgeOrigin } from "./types";
import type { KnowledgeRelationship, RelationshipEvidence } from "./types";
import { buildCaptureMarkdown, parseCaptureFrontmatter, captureBody, captureFilePath, captureDate, urlFingerprint } from "./capture";
import { buildKnowledgeMarkdown, buildProcessingMarkdown, kgDate, parseCandidateFrontmatter, processingAiRegion, replaceProcessingAiRegion, setFrontmatterStatus, sourceVersionFor } from "./knowledgeProcessor";
import { CaptureFormModal, UrlCaptureModal, CaptureConfirmModal, type CaptureFormInput } from "./captureUi";
import { SourceLedger } from "./sourceLedger";
import { WorkbenchTaskStore, WorkbenchProjectStore } from "./workbenchStore";
import { WorkbenchService } from "./workbenchService";
import { WorkbenchSessionStore } from "./workbenchSession";
import { ArtifactStore } from "./artifactStore";
import { PromptLibraryStore, seedPromptLibrary } from "./promptLibrary";
import { LatencyCollector } from "./latency";
import * as path from "path";
import { AIWorkbenchView, VIEW_TYPE_AI_WORKBENCH } from "./workbenchView";

/** Discovery Scope：discoveryPrep 的返回结构（AIPrep 的 Discovery 变体，含 scope 指纹 / 选择版本 / 展示上下文） */
interface DiscoveryPrepResult {
  candidateLines: string[];
  candidatePaths: string[];
  areaLines: string[];
  dateLabel: string;
  candidateSig: string;
  areaSig: string;
  periodKey: string;
  scopeFingerprint: string;
  selectionVersion: string;
  discovery: DiscoveryPromptContext;
  pool: NoteMetadata[];
}

/** Query Explorer：Dashboard 读取的查询展示状态（§五十/五十六~六十二；失败保留本地结果，绝不丢） */
interface QueryExplorationState {
  status: "idle" | "searching" | "found" | "thinking" | "done" | "error";
  rawQuery: string;
  normalizedQuery: string;
  cacheKey: string;
  scopeLabel: string;
  scopeMode: QueryScopeMode;
  localCount: number;
  candidateCount: number;
  fromCache: boolean;
  error: string | null;
  result: QueryExplorationResult | null;
}

export default class KnowledgeGardenPlugin extends Plugin {
  settings!: PluginSettings;
  index!: NoteIndex;
  ai!: AIService;
  reviews!: ReviewManager;
  activity!: ActivityStore;
  scheduler!: ReviewScheduler;
  /** AI 失败原因（Dashboard 上展示为可重试的错误卡，绝不崩溃） */
  curiosityError: string | null = null;
  /** Phase 5：知识漫游连接生成失败原因（保留旧图时可展示重试条） */
  connectionError: string | null = null;
  cache!: AICache;
  evolution!: EvolutionStore;
  /** Phase 7：长期演化 AI 失败原因（Dashboard 显示重试条，不崩） */
  evolutionError: string | null = null;
  /** Phase 8：Review Center 本地存储（队列 + session 指针 + 连续跳过历史） */
  reviewCenter!: ReviewCenterStore;
  /** Phase 8：本周期复习问题只请求一次（§五十六：每次 Session 最多 1 次 AI request） */
  reviewQuestionMemo: { key: string; map: Map<string, ReviewQuestion> } | null = null;
  /** Discovery Scope：AI Discovery 曝光数据（cache/discovery.json，§二十二） */
  discovery!: DiscoveryStore;
  /** Discovery Scope：最近一次成功生成时的探索范围信息（Dashboard 展示用，零成本读缓存） */
  discoveryMeta: { curiosity?: { scopeLabel: string; poolCount: number; count: number }; roaming?: { scopeLabel: string; poolCount: number; count: number } } = {};
  /** Capture/Processing（本阶段）：AI 提炼失败原因（Dashboard 错误条，绝不崩溃 §十一/十二） */
  captureError: string | null = null;
  /** Capture/Processing（本阶段）：本地计数摘要（§六十二/一百一十一；0 AI，只读文件名/frontmatter） */
  captureSummaryText = { inbox: 0, candidates: 0, accepted: 0, archived: 0 };
  /** Phase 9：Review 操作连点防抖时间戳（§二十八~三十：✓/跳过/稍后 快速连点只生效一次） */
  private reviewActionUntil = 0;
  /** Query Explorer：本地全库检索索引（§九/十六~二十二：内存索引 + NoteIndex 事件联动增量） */
  searchIndex!: SearchIndex;
  /** Query Explorer：最近探索历史（cache/query-history.json，§五十四/五十五） */
  queryHistory!: QueryHistoryStore;
  /** Query Explorer：最近一次查询的展示状态（Dashboard 读它渲染；查询只在用户点击时执行，打开 Dashboard 0 AI 请求） */
  queryExploration: QueryExplorationState = {
    status: "idle", rawQuery: "", normalizedQuery: "", cacheKey: "", scopeLabel: "整个仓库",
    scopeMode: "vault", localCount: 0, candidateCount: 0, fromCache: false, error: null, result: null,
  };
  /** Query Explorer：AI 整理失败原因（保留本地结果时展示，§五十三/六十） */
  queryExplorerError: string | null = null;
  /** Phase 11：右键 AI 工具箱（菜单 + 翻译/文案/Anchor Modal） */
  toolbox!: NoteToolbox;
  /** Phase 13 §七十七~八十六：统一 AI 任务状态（Diagnostics / Cancellation / Progress） */
  taskEngine = new AITaskEngine();

  /** Phase 14：考试索引（cache/exams.json + Knowledge Garden/Exams/*.md，§一百四十六） */
  examStore!: ExamStore;
  /** Phase 14：收藏复习卡索引（cache/cards.json + Knowledge Garden/Review Cards/*.md，§一百四十六） */
  cards!: ReviewCardStore;
  /** Phase 14：考试会话（cache/exam-sessions.json，§一百八十七 可恢复） */
  examSessions!: ExamSessionStore;
  /** Phase 14：复习卡复习历史（cache/card-reviews.json，§九十一/二百一十四） */
  cardReviews!: CardReviewStore;
  /** 最近一次打开的考试 id（Dashboard/命令「打开当前笔记考试」用） */
  lastExamId: string | null = null;
  /** 考试生成失败原因（保留旧考试时展示重试，§五十/五十一） */
  examError: string | null = null;
  /** Phase 13 §二十三：Skills 正文预读缓存（vault-relative relPath → 文本；readSkill 同步读） */
  private skillFileCache = new Map<string, string>();
  /** Phase 11：状态浏览「上次随机打开」只存内存（§一百八十九：绝不持久化） */
  browseLastPath: string | null = null;
  /** Saved Exploration：收藏知识链路索引（cache/saved-explorations.json，§四/五；Markdown 是恢复源 §四十/四十三） */
  saved!: SavedExplorationStore;
  /** Phase 10：知识关系（AI 建议 → 用户确认 → 长期结构；cache/relationships.json + Relationships/*.md） */
  relationships!: RelationshipStore;
  /** Phase 15：AI Workbench（service + 存储；§五十/二百六十四） */
  sourceLedger!: SourceLedger;
  taskStore!: WorkbenchTaskStore;
  projectStore!: WorkbenchProjectStore;
  workbenchService!: WorkbenchService;
  /** Phase 16 §65-67：Workbench Ask 追问 Session 存储 */
  sessionStore!: WorkbenchSessionStore;
  /** Phase 17 §14-15：Message Artifact 索引（cache/artifacts.json；独立于 AI Cache §79） */
  artifactStore!: ArtifactStore;
  /** Phase 16 §四~十七：Prompt Library 存储（Markdown = Source of Truth；cache/prompts.json = 统计缓存） */
  promptLibraryStore!: PromptLibraryStore;
  /** Phase 16 §十九~二十：Latency 收集器（cache/latency.json；只存 mode/ttft/total/时间戳） */
  latencyCollector!: LatencyCollector;
  /** Phase 15 §二百一十六：工具调用日志（Diagnostics 展示；只记 toolId/结果/时间，不记网页正文/参数原文） */
  workbenchToolLog: { toolId: string; ok: boolean; at: number }[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    const manifest = this.manifest as unknown as { dir?: string };
    const baseDir =
      manifest.dir ??
      (this.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.() ??
      ".";
    this.index = new NoteIndex(this.app, baseDir);
    await this.index.load();
    this.searchIndex = new SearchIndex(this.app, (pathStr) => this.index.get(pathStr));
    this.queryHistory = new QueryHistoryStore(baseDir);
    const queryHistoryCorrupt = this.queryHistory.load();
    this.saved = new SavedExplorationStore(baseDir);
    const savedCorrupt = this.saved.load();
    this.relationships = new RelationshipStore(baseDir);
    const relCorrupt = this.relationships.load();
    this.activity = new ActivityStore(baseDir);
    const activityCorrupt = this.activity.load();
    this.activity.prune(new Set(this.index.all().map((n) => n.path)));
    this.cache = new AICache(baseDir);
    const cacheCorrupt = this.cache.load();
    this.evolution = new EvolutionStore(baseDir);
    const evolutionCorrupt = this.evolution.load();
    this.evolution.setKeepWeeks(this.settings.evolution.keepWeeks);
    this.reviewCenter = new ReviewCenterStore(baseDir);

    this.examStore = new ExamStore(baseDir);
    const examCorrupt = this.examStore.load();
    this.cards = new ReviewCardStore(baseDir);
    const cardsCorrupt = this.cards.load();
    this.examSessions = new ExamSessionStore(baseDir);
    const examSessionsCorrupt = this.examSessions.load();
    this.cardReviews = new CardReviewStore(baseDir);
    const cardReviewsCorrupt = this.cardReviews.load();
    const reviewCorrupt = this.reviewCenter.load();
    this.discovery = new DiscoveryStore(baseDir);
    const discoveryCorrupt = this.discovery.load();
    this.ai = new AIService(
      () => this.settings.ai,
      this.cache,
      (feature) => resolveAIFunctionRouteWithWorkspace(feature, this.settings.aiProfiles, this.settings.aiFunctionConfig, this.currentWorkspace(), undefined, this.settings.defaultProfileId)
    );
    this.toolbox = new NoteToolbox(this.app, this);
    this.addChild(this.toolbox);
    // Phase 13 §二十三/一百四十八：启动时轻量预读 Skills（Knowledge Garden/Skills/<id>/SKILL.md + 资源）；
    // 只读文件不扫描 Vault：workspace 切换不触发扫描。
    void this.preloadSkills();
    // Phase 15：Workbench 存储与服务（§五十/六十四/二百六十四；损坏隔离沿用 Recovery 模式）
    this.sourceLedger = new SourceLedger(baseDir);
    const workbenchCorrupt = this.sourceLedger.load();
    this.taskStore = new WorkbenchTaskStore(baseDir);
    const tasksCorrupt = this.taskStore.load();
    this.projectStore = new WorkbenchProjectStore(baseDir);
    const projectsCorrupt = this.projectStore.load();
    this.workbenchService = new WorkbenchService(this);
    this.sessionStore = new WorkbenchSessionStore(baseDir);
    const sessionCorrupt = this.sessionStore.load();
    this.artifactStore = new ArtifactStore(baseDir);
    const artifactCorrupt = this.artifactStore.load();
    this.promptLibraryStore = new PromptLibraryStore(baseDir);
    const promptCorrupt = this.promptLibraryStore.load();
    seedPromptLibrary(this.promptLibraryStore);
    this.latencyCollector = new LatencyCollector(path.join(baseDir, "cache", "latency.json"));
    this.latencyCollector.load();

    this.reviews = new ReviewManager(
      this.app,
      () => this.settings,
      this.index,
      this.ai,
      this.activity,
      () => { void this.saveSettings(); }
    );

    this.scheduler = new ReviewScheduler(
      {
        app: this.app,
        getSettings: () => this.settings,
        reviews: this.reviews,
        ai: this.ai,
        runReview: (period, force, override) => this.runReview(period, force, override),
        rerenderDashboard: () => this.rerenderDashboard(),
      },
      baseDir
    );
    // §九/十/十一/十三：损坏文件已隔离为 *.corrupt-*（保留原文件）并重建
    if (cacheCorrupt) new Notice("AI 缓存已损坏，已隔离并重建。原文件已保留为 .corrupt-*。");
    if (activityCorrupt) new Notice("最近访问数据已损坏，已隔离并重建。原文件已保留为 .corrupt-*。");
    if (evolutionCorrupt) new Notice("知识演化缓存已损坏，已隔离并重建。原文件已保留为 .corrupt-*。");
    if (reviewCorrupt) {
      this.ensureReviewQueue(); // §十三：queue 损坏 → 重新生成当前周期队列（纯本地，不调用 AI）
      new Notice("复习队列已损坏，已隔离并重建当前队列。");
    }
    if (discoveryCorrupt) new Notice("知识发现曝光数据已损坏，已隔离并重建。原文件已保留为 .corrupt-*。");
    if (workbenchCorrupt) new Notice("来源台账已损坏，已隔离重建（原文件保留为 .corrupt-*）。");
    if (tasksCorrupt) new Notice("AI 任务数据已损坏，已隔离重建。");
    if (projectsCorrupt) new Notice("知识项目索引已损坏，已隔离重建（Projects/*.md 仍可恢复）。");

    if (examCorrupt) {
      void this.reindexExams(); // §一百九十六：exams.json 损坏 → 从 Exams/*.md 恢复（0 AI）
      new Notice("考试索引已损坏，已隔离；正在从 Exams/*.md 恢复（0 AI）。");
    }
    if (cardsCorrupt) {
      void this.reindexCards(); // §一百九十六：cards.json 损坏 → 从 Review Cards/*.md 恢复（0 AI）
      new Notice("复习卡索引已损坏，已隔离；正在从 Review Cards/*.md 恢复（0 AI）。");
    }
    if (examSessionsCorrupt) new Notice("考试会话已损坏，已隔离重建（原文件保留为 .corrupt-*）。");
    if (cardReviewsCorrupt) new Notice("复习卡复习记录已损坏，已隔离重建。");
    if (queryHistoryCorrupt) new Notice("最近探索历史已损坏，已隔离并重建。原文件已保留为 .corrupt-*。");
    if (savedCorrupt) {
      new Notice("收藏索引已损坏，原文件已隔离（.corrupt-*）；正在从收藏 Markdown 重新建立索引（§四十一/四十三）。");
      this.reindexSaved(); // 0 AI；Saved/*.md 是恢复源
    }
    if (relCorrupt) {
      void this.scanRelationshipMarkdown(); // 0 AI；Relationships/*.md 是恢复源（§五十二/五十五）
      new Notice("知识关系数据已损坏，已隔离并重建；已确认关系将从 Relationships/*.md 恢复（0 AI）。");
    }
    this.scheduler.start(); // §36：load schedule + 启动检查（绝不无提示消耗 AI）
    // Query Explorer：后台分批构建搜索索引（§十二/十六/十七：不阻塞启动；增量由 NoteIndex 事件联动，§二十~二十二）
    void this.searchIndex.buildFromList(this.index.all().map((n) => n.path), (st) => { if (!st.building) this.rerenderDashboard(); });
    // §8：用 Obsidian 生命周期 API 注册周期任务，插件卸载时自动清理
    this.registerInterval(window.setInterval(() => { void this.scheduler.checkNow(); }, 60 * 1000));

    this.registerView(VIEW_TYPE_KG, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TYPE_SAVED, (leaf) => new SavedExplorationView(leaf, this));
    this.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewSessionView(leaf, this));

    this.registerView(VIEW_TYPE_EXAM, (leaf) => new ExamSessionView(leaf, this));
    this.registerView(VIEW_TYPE_CARDS, (leaf) => new CardsView(leaf, this));
    this.registerView(VIEW_TYPE_AI_WORKBENCH, (leaf) => new AIWorkbenchView(leaf, this));
    this.addRibbonIcon("flower-2", "打开知识花园", () => { void this.activateView(); });
    this.addRibbonIcon("bot", "打开 AI 工作台（提问 / 研究 / 项目）", () => { this.openWorkbenchView(); });

    this.addCommand({ id: "kg-open-dashboard", name: "打开知识花园 Dashboard", callback: () => { void this.activateView(); } });
    this.addCommand({ id: "kg-refresh", name: "刷新知识索引与 Dashboard", callback: () => { void this.refreshAll(); } });
    this.addCommand({ id: "kg-test-ai", name: "测试 AI 连接", callback: () => { void this.testAI(); } });
    this.addCommand({ id: "kg-curiosity", name: "生成今日知识奇想", callback: () => { void this.runCuriosity(); } });
    this.addCommand({ id: "kg-curiosity-force", name: "强制重新生成今日知识奇想（跳过缓存）", callback: () => { void this.runCuriosity(true); } });
    this.addCommand({ id: "kg-connections", name: "生成今日知识漫游连接（可探索知识图）", callback: () => { void this.runConnections(); } });
    this.addCommand({ id: "kg-connections-force", name: "强制重新生成今日知识漫游连接（跳过缓存）", callback: () => { void this.runConnections(true); } });
    this.addCommand({ id: "kg-review-daily", name: "生成日复盘", callback: () => { void this.runReview("daily"); } });
    this.addCommand({ id: "kg-review-daily-force", name: "强制重新生成日复盘（跳过缓存）", callback: () => { void this.runReview("daily", true); } });
    this.addCommand({ id: "kg-review-weekly", name: "生成周复盘", callback: () => { void this.runReview("weekly"); } });
    this.addCommand({ id: "kg-review-weekly-force", name: "强制重新生成周复盘（跳过缓存）", callback: () => { void this.runReview("weekly", true); } });
    this.addCommand({ id: "kg-rescan", name: "重建知识索引（全量扫描）", callback: () => { void this.rescanAll(); } });
    this.addCommand({ id: "kg-clear-ai-cache", name: "清空 AI 缓存（只删 cache/，不动 Reviews/）", callback: () => { this.clearAICache(); } });
    this.addCommand({ id: "kg-clear-expired-ai-cache", name: "清理过期 AI 缓存（只删过期/陈旧的，不动 Reviews/）", callback: () => { this.clearExpiredAICache(); } });
    this.addCommand({ id: "kg-diagnostics", name: "知识花园：诊断", callback: () => { new DiagnosticsModal(this.app, this).open(); } });
    this.addCommand({ id: "kg-mark-reviewed", name: "标记当前笔记为已复习", callback: () => { void this.markReviewed(); } });
    this.addCommand({ id: "kg-view-recent", name: "查看最近访问", callback: () => { this.viewRecent(); } });
    this.addCommand({ id: "kg-view-forgotten", name: "查看可能正在被遗忘的知识", callback: () => { this.viewForgotten(); } });
    this.addCommand({ id: "kg-schedule-status", name: "查看自动复盘调度状态", callback: () => { this.scheduler.showStatus(); } });
    this.addCommand({ id: "kg-evolution-snapshot", name: "生成本周知识演化快照（本地计算）", callback: () => { if (this.settings.evolution.enabled) this.updateWeeklySnapshot(); new Notice("本周知识演化快照已更新（本地计算，不调用 AI）。"); } });
    this.addCommand({ id: "kg-evolution-monthly", name: "生成月度知识演化", callback: () => { void this.runMonthlyEvolution(false); } });
    this.addCommand({ id: "kg-evolution-monthly-force", name: "强制重新生成月度知识演化（跳过缓存）", callback: () => { void this.runMonthlyEvolution(true); } });
    this.addCommand({ id: "kg-evolution-quarterly", name: "生成季度知识演化", callback: () => { void this.runQuarterlyEvolution(false); } });
    this.addCommand({ id: "kg-evolution-quarterly-force", name: "强制重新生成季度知识演化（跳过缓存）", callback: () => { void this.runQuarterlyEvolution(true); } });
    this.addCommand({ id: "kg-review-center", name: "打开今日复习窗口（Review Center）", callback: () => { void this.openReviewSession(); } });
    this.addCommand({ id: "kg-query-explore", name: "打开 Query Explorer（问题 → 全库知识关联探索）", callback: () => { void this.activateView(); } });
    this.addCommand({ id: "kg-query-history-clear", name: "清空最近探索历史（只删 query-history.json，不动 AI 缓存）", callback: () => { this.clearQueryHistory(); } });
    this.addCommand({ id: "kg-saved-open", name: "打开我的知识收藏（Saved Exploration）", callback: () => { void this.activateSavedView(); } });
    this.addCommand({ id: "kg-saved-reindex", name: "重新建立收藏索引（从 Saved/*.md 恢复，0 AI）", callback: () => { this.reindexSaved(); } });
    this.addCommand({ id: "kg-rel-open", name: "打开知识关系目录（已确认连接）", callback: () => { void this.openRelationshipFolder(); } });
    this.addCommand({ id: "kg-rel-recover", name: "重新恢复知识关系（扫描 Relationships/*.md，0 AI）", callback: () => { void this.scanRelationshipMarkdown(true); } });
    // ---------- Capture / Processing / Provenance（本阶段 §六十八：5 个指定命令 + 处理/确认/归档入口） ----------
    this.addCommand({ id: "kg-capture-new", name: "知识花园：新建捕获（Manual Capture）", callback: () => { new CaptureFormModal(this.app, (input) => { void this.createCapture(input); }).open(); } });
    this.addCommand({ id: "kg-capture-clipboard", name: "知识花园：从剪贴板捕获（Clipboard Capture）", callback: () => { void this.clipboardCapture(); } });
    this.addCommand({ id: "kg-capture-url", name: "知识花园：从 URL 捕获（URL Capture）", callback: () => { new UrlCaptureModal(this.app, (input) => { void this.createCapture(input); }).open(); } });
    this.addCommand({ id: "kg-capture-open-inbox", name: "知识花园：打开 Inbox（待处理捕获）", callback: () => { void this.openCaptureFolder(this.settings.capture.inboxFolder); } });
    this.addCommand({ id: "kg-capture-open-processing", name: "知识花园：打开知识候选（Processing）", callback: () => { void this.openCaptureFolder(this.settings.capture.processingFolder); } });
    this.addCommand({ id: "kg-capture-open-knowledge", name: "知识花园：打开 Knowledge（已确认知识）", callback: () => { void this.openCaptureFolder(this.settings.capture.knowledgeFolder); } });
    this.addCommand({ id: "kg-capture-process-current", name: "知识花园：处理当前捕获（AI 提炼 → 知识候选）", callback: () => { void this.processCurrentCapture(); } });
    this.addCommand({ id: "kg-capture-process-current-force", name: "知识花园：强制重新处理当前捕获（跳过 AI 缓存）", callback: () => { void this.processCurrentCapture(true); } });
    this.addCommand({ id: "kg-capture-accept-current", name: "知识花园：将当前知识候选提炼为知识（用户确认）", callback: () => { void this.acceptCurrentCandidate(); } });
    this.addCommand({ id: "kg-capture-archive-current", name: "知识花园：归档当前捕获/候选（保留来源，不删除）", callback: () => { void this.archiveCurrentCapture(); } });
    this.addCommand({ id: "kg-review-queue-rebuild", name: "强制重建今日复习队列（本地计算，不调用 AI）", callback: () => { this.ensureReviewQueue(true); new Notice("今日复习队列已重建（本地计算，不调用 AI）。"); this.rerenderDashboard(); } });
    // Phase 11：状态随机浏览（§十六：0 AI；Dashboard 点击与命令共用同一逻辑 §十五）
    const browseStates: { id: KGState; label: string }[] = [
      { id: "new", label: "随机查看新知识" },
      { id: "growing", label: "随机查看正在增长" },
      { id: "active", label: "随机查看活跃知识" },
      { id: "stale", label: "随机查看疏于维护知识" },
      { id: "forgotten", label: "随机查看可能被遗忘知识" },
    ];
    for (const s of browseStates) {
      this.addCommand({ id: "kg-state-browse-" + s.id, name: s.label, callback: () => this.browseState(s.id) });
    }
    this.addCommand({ id: "kg-anchor-explore-current", name: "知识花园：以当前笔记探索关联", callback: () => { const f = this.app.workspace.getActiveFile(); if (f instanceof TFile) this.toolbox.openAnchor(f.path); else new Notice("当前没有打开的笔记。"); } });
    // Phase 12 §八十七：写作助手 / 研究问题 / 应用思路 均可从命令面板运行
    this.addCommand({ id: "kg-writing-assistant", name: "AI 写作助手：当前笔记（学术/论证/批判/研究/应用/头脑风暴）", callback: () => { const f = this.app.workspace.getActiveFile(); if (f instanceof TFile) this.toolbox.openWritingAssistant(f.path); else new Notice("当前没有打开的笔记。"); } });
    this.addCommand({ id: "kg-research-questions", name: "从当前笔记生成研究问题", callback: () => { const f = this.app.workspace.getActiveFile(); if (f instanceof TFile) this.toolbox.runQuickResearchQuestion({ file: f, editor: null, selectedText: "" }); else new Notice("当前没有打开的笔记。"); } });

    // Phase 14 §一百七十：考试 / 复习卡命令（构建 / 重新生成 / 打开 / 查看收藏；入口只读，0 AI）
    this.addCommand({ id: "kg-exam-build", name: "知识花园：构建当前笔记考试", callback: () => { this.openExamBuilderForActive(); } });
    this.addCommand({ id: "kg-exam-rebuild", name: "知识花园：重新生成当前笔记考试（跳过 AI 缓存）", callback: () => { void this.regenerateExamForActive(); } });
    this.addCommand({ id: "kg-exam-open", name: "知识花园：打开当前笔记考试", callback: () => { void this.openExamForActive(); } });
    this.addCommand({ id: "kg-cards-open", name: "知识花园：查看收藏复习卡", callback: () => { void this.openCardsView(); } });
    this.addCommand({ id: "kg-application-ideas", name: "从当前笔记生成应用思路", callback: () => { const f = this.app.workspace.getActiveFile(); if (f instanceof TFile) this.toolbox.runQuickApplication({ file: f, editor: null, selectedText: "" }); else new Notice("当前没有打开的笔记。"); } });
    this.addCommand({ id: "kg-wb-open", name: "打开 Knowledge Garden AI 工作台（提问/研究/项目）", callback: () => { this.openWorkbenchView(); } });
    this.addCommand({ id: "kg-wb-ask", name: "向 Knowledge Garden 提问", callback: () => { this.openWorkbenchView("ask"); } });
    this.addCommand({ id: "kg-wb-research", name: "开始知识研究（计划→确认→执行）", callback: () => { this.openWorkbenchView("research"); } });
    this.addCommand({ id: "kg-wb-project", name: "建立知识项目", callback: () => { this.openWorkbenchView("project"); } });
    this.addCommand({ id: "kg-wb-resume", name: "继续最近 AI 任务", callback: () => { this.openWorkbenchResume(); } });
    this.addCommand({ id: "kg-wb-tasks", name: "查看 AI 任务", callback: () => { this.openWorkbenchTasks(); } });
    this.toolbox.registerMenuHandlers();
    // Phase 15 §二百七十三：右键笔记/选中文本 → AI 工作台（不覆盖原生菜单）
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      menu.addItem((item) => item.setTitle("知识花园：以此笔记向 AI 提问").setIcon("bot").onClick(() => { this.openWorkbenchView("ask", file.path); }));
      menu.addItem((item) => item.setTitle("知识花园：以此笔记开始研究").setIcon("search").onClick(() => { this.openWorkbenchView("research", file.path); }));
    }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      const sel = typeof editor.getSelection === "function" ? (editor.getSelection() ?? "") : "";
      if (!sel.trim()) return;
      menu.addItem((item) => item.setTitle("知识花园：向 AI 提问选中内容").setIcon("bot").onClick(() => { this.openWorkbenchView("ask", sel.slice(0, 4000)); }));
    }));

    // 增量索引：Vault 事件 → 单文件更新，不整库重扫
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        void this.index.updateFile(file).then(() => { void this.searchIndex.updateFile(file.path); });
      }
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        void this.index.updateFile(file).then(() => { void this.searchIndex.updateFile(file.path); });
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        this.index.removeFile(file.path);
        this.searchIndex.remove(file.path);
        this.relationships.removeNode(file.path); // Phase 10：来源笔记删除 → 关系移除（§Test 14）
        this.pruneActivity();
      }
    }));
    // Capture/Processing 目录文件变更 → 只刷新 Dashboard 计数（§五十三：访问/修改 Capture 不触发 AI；0 AI）
    this.registerEvent(this.app.vault.on("create", (file) => { if (file instanceof TFile && this.isCapturePath(file.path)) { void this.refreshCaptureSummary(); } }));
    this.registerEvent(this.app.vault.on("modify", (file) => { if (file instanceof TFile && this.isCapturePath(file.path)) { void this.refreshCaptureSummary(); } }));
    this.registerEvent(this.app.vault.on("delete", (file) => { if (file instanceof TFile && this.isCapturePath(file.path)) { void this.refreshCaptureSummary(); } }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      const act = this.activity.get(oldPath);
      if (act) this.activity.set(file.path, act);
      this.reviewCenter.migratePaths(oldPath, file.path);
      this.index.removeFile(oldPath);
      this.searchIndex.rename(oldPath, file.path);
      this.saved.migratePaths(oldPath, file.path); // §十八：收藏引用跟随 rename（0 AI）

    this.examStore.migratePaths(oldPath, file.path);  // Phase 14：考试来源跟随 rename（0 AI）
    this.cards.migratePaths(oldPath, file.path);      // Phase 14：复习卡来源跟随 rename（0 AI）
      this.relationships.migratePaths(oldPath, file.path); // Phase 10：关系引用跟随 rename（0 AI，§五十九）
      if (file.extension === "md") {
        void this.index.updateFile(file).then(() => { this.pruneActivity(); });
      } else {
        this.pruneActivity();
      }
    }));

    // 行为记录：打开笔记只更新本地 activity，绝不触发 AI、不重建 Dashboard（§21/23）；scheduleRender 为页内 400ms 防抖局部刷新
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.activity.recordAccess(file.path);
      this.rerenderDashboard();
    }));

    this.addSettingTab(new KnowledgeGardenSettingTab(this.app, this));

    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => { void this.activateView(); });
    }
    if (this.settings.evolution.enabled) this.updateWeeklySnapshot();
    // Phase 10：确保关系目录 + 从 Relationships/*.md 恢复（0 AI，§五十二/五十五）
    void this.ensureRelationshipFolder().then(() => void this.scanRelationshipMarkdown());
    // Capture/Processing（本阶段）：确保目录可用 + 刷新计数（0 AI，§六十九/一百一十一）
    void this.ensureCaptureFolders();
  }

  onunload(): void {
    this.scheduler?.stop();
    this.activity?.flush();
    this.queryHistory?.flush();
    this.saved?.flush();
    void this.index?.saveCache();
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PluginSettings> | null | undefined;
    // §三~五：formatVersion 是迁移字段不是用户设置，读入时剥离（未知/多余字段其余保留）
    if (raw && typeof raw === "object") delete (raw as Record<string, unknown>)["formatVersion"];
    this.settings = mergeSettings(DEFAULT_SETTINGS, raw);
    if (!Array.isArray(this.settings.knowledgeAreas)) this.settings.knowledgeAreas = [];
    // §一百三十九：旧 settings.ai 自动迁移为 Default Profile（用户无需重新配置）
    if (!Array.isArray(this.settings.aiProfiles) || this.settings.aiProfiles.length === 0) {
      this.settings.aiProfiles = [defaultProfileFrom(this.settings.ai)];
    }
    if (!Array.isArray(this.settings.reviews)) this.settings.reviews = [];
    // Phase 13 §一百二十九：首次升级创建 Default Workspace（scope=Global Discovery、profile=Global Default、skills=[]），
    // currentWorkspaceId 保持 null（§九：默认 None → 完全保持现有行为）；0 AI 请求（§一百三十一）。
    if (!Array.isArray(this.settings.workspaces) || this.settings.workspaces.length === 0) {
      this.settings.workspaces = [
        defaultWorkspace(
          this.settings.discovery?.roaming?.scope,
          (this.settings.aiProfiles[0] && this.settings.aiProfiles[0].id) || "default"
        ),
      ];
    }
    // Phase 13 §一百三十二/一百三十三：内置 Skills Registry（用户可启停；正文按需加载）
    if (!Array.isArray(this.settings.skillRegistry) || this.settings.skillRegistry.length === 0) {
      this.settings.skillRegistry = BUILTIN_SKILL_SUMMARIES.map((x) => ({ ...x }));
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(withFormatVersion(this.settings));
  }

  /** Phase 13 §九：当前 Workspace（未设置 → undefined，路由/范围全部回退全局） */
  currentWorkspace(): KnowledgeWorkspace | undefined {
    return resolveWorkspace(this.settings.workspaces, this.settings.currentWorkspaceId);
  }

  /** Phase 13 §十：切换当前 Workspace（UI Picker 调用；不改变全局 Discovery Scope，§七） */
  async switchWorkspace(id: string | null): Promise<void> {
    this.settings.currentWorkspaceId = id;
    await this.saveSettings();
    const ws = this.currentWorkspace();
    new Notice(ws ? "已切换工作空间：「" + ws.name + "」。" : "已切换回默认（不使用 Workspace，保持原有行为）。");
    this.rerenderDashboard();
  }

  /** Phase 13 §十八/二十三：Skills 预读（Knowledge Garden/Skills/**；只读文件，不调 AI；workspace 切换不触发） */
  async preloadSkills(): Promise<void> {
    const root = "Knowledge Garden/Skills";
    const folder = this.app.vault.getAbstractFileByPath(root);
    if (!(folder instanceof TFolder)) return;
    const files: TFile[] = [];
    const walk = (f: TFolder): void => {
      for (const c of f.children) {
        if (c instanceof TFile) files.push(c);
        else if (c instanceof TFolder) walk(c);
      }
    };
    walk(folder);
    const next = new Map<string, string>();
    for (const f of files) {
      const rel = f.path.slice(root.length + 1);
      try {
        next.set(rel, await this.app.vault.cachedRead(f));
      } catch { /* 读取失败视为未提供，回退内置 */ }
    }
    this.skillFileCache = next;
  }

  /** Phase 13 §二十三：同步读取 Skill 正文（预读缓存；readSkill(null) → 回退内置正文） */
  readSkill(id: string): string | null {
    const key = id.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "") + "/SKILL.md";
    const v = this.skillFileCache.get(key);
    return v !== undefined ? v : null;
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_KG);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_KG, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** §二十三：打开「我的知识收藏」View（列表 + 详情；0 AI） */
  async activateSavedView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SAVED);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_SAVED, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async refreshAll(): Promise<void> {
    await this.index.rescanAll();
    this.pruneActivity();
    this.rerenderDashboard();
  }

  async rescanAll(): Promise<void> {
    new Notice("正在重建知识索引…");
    await this.index.rescanAll();
    this.pruneActivity();
    this.rerenderDashboard();
    new Notice("知识索引已重建。");
  }

  async testAI(): Promise<void> {
    try {
      await this.ai.testConnection();
      new Notice("AI 连接成功。");
    } catch (e) {
      new Notice("AI 连接失败：" + (e instanceof Error ? e.message : String(e)) + "（本地知识索引不受影响）");
    }
  }

  /** Phase 11：测试指定 AI Profile 连接（settings「测试连接」按钮，§一百三十六）。
   *  只构造该 Profile 对应 Provider 发一个最小请求；不写 AI 缓存、不影响任何功能路由（§八十五）。
   *  API Key 只来自 data.json，绝不写入源码/报告（§九十二）。 */
  /** Phase 11/13.5：测试指定 AI Profile 连接（settings「测试连接」按钮，§十八/§一百三十六）。
   *  只构造该 Profile 对应 Provider 发一个最小请求；不写 AI 缓存、不影响任何功能路由（§十九/二十）。
   *  失败返回结构化 code（§二十二：MISSING_KEY / TIMEOUT / NETWORK / HTTP_xxx / …），复用现有 AIError 体系。
   *  API Key 只来自 data.json，绝不写入源码/报告/日志/缓存（§九十八）。 */
  async testProfileConnection(profileId: string): Promise<{ ok: boolean; message: string; code?: string }> {
    const p = (this.settings.aiProfiles ?? []).find((x) => x.id === profileId);
    if (!p) return { ok: false, message: "未找到 Profile：" + profileId, code: "NOT_FOUND" };
    return this.testProviderConfig({ baseUrl: p.baseUrl, apiKey: p.apiKey, defaultModel: p.defaultModel });
  }

  /** Phase 13.5 §21：编辑 Modal 内「测试连接」——使用当前表单的未保存配置（不先保存再测试）。
   *  不写 AI 缓存、不影响任何功能路由（§十九/二十）。 */
  async testProfileConnectionDraft(draft: { baseUrl: string; apiKey: string; defaultModel: string }): Promise<{ ok: boolean; message: string; code?: string }> {
    return this.testProviderConfig(draft);
  }

  /** 共享的最小 Provider 测试：MISSING_KEY 在空 Key 时返回（§二十二）；成功显示当前模型（§二十三，不显示 Key）。 */
  private async testProviderConfig(cfg: { baseUrl: string; apiKey: string; defaultModel: string }): Promise<{ ok: boolean; message: string; code?: string }> {
    if (!cfg.apiKey) return { ok: false, message: "该 Profile 尚未配置 API Key（Key 只存 data.json，§九十二）", code: "MISSING_KEY" };
    const provider = new SiliconFlowProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.defaultModel });
    try {
      await provider.testConnection();
      return { ok: true, message: cfg.defaultModel || "默认模型" };
    } catch (e) {
      const err = e instanceof AIError ? e : null;
      return { ok: false, message: e instanceof Error ? e.message : String(e), code: err?.code };
    }
  }

  /** Discovery Scope：本地 Scope 过滤 + 确定性选择 → AI 请求上下文（§十七/二十八/三十四）。
   *  与 Review 完全分离（§三十三）：奇想/漫游各自 Scope（§六），缓存 key 附加 scope 指纹 + 选择版本（§四十/四十二）。 */
  private async discoveryPrep(feature: DiscoveryFeature): Promise<DiscoveryPrepResult> {
    const cfg = this.settings.discovery[feature];
    const scope = cfg.scope ?? { mode: "vault" as const };
    const pool = discoveryPool(this.index.all(), scope, this.settings.knowledgeAreas);
    const scopeFingerprint = discoveryScopeFingerprint(scope);
    const dateKey = discoveryDateKey();
    const candidates = selectCandidates(pool, {
      feature,
      count: cfg.candidateCount ?? 16,
      dateKey,
      scopeFingerprint,
      exploreOld: cfg.exploreOld,
      preferCrossArea: cfg.preferCrossArea,
      getAct: (p) => this.activity.get(p),
      meta: this.discovery.allEntries(),
      areas: this.settings.knowledgeAreas,
    });
    const lines = await this.index.candidatePayload(candidates, 700);
    const areaLines = this.reviews.areaLines();
    return {
      candidateLines: lines,
      candidatePaths: candidates.map((c) => c.path),
      areaLines,
      dateLabel: dateKey,
      candidateSig: candidateSig(candidates.map((n) => ({ path: n.path, modified: n.modified, size: n.size }))),
      areaSig: areaSig(areaLines),
      periodKey: "daily:" + dateKey,
      scopeFingerprint,
      selectionVersion: DISCOVERY_SELECTION_VERSION,
      discovery: { scopeLabel: discoveryScopeLabel(scope, this.settings.knowledgeAreas), poolCount: pool.length, count: candidates.length },
      pool,
    };
  }

  private toDiscoveryCallOpts(prep: DiscoveryPrepResult): AICallOpts {
    return {
      candidateLines: prep.candidateLines,
      candidatePaths: prep.candidatePaths,
      areaLines: prep.areaLines,
      dateLabel: prep.dateLabel,
      candidateSig: prep.candidateSig,
      areaSig: prep.areaSig,
      periodKey: prep.periodKey,
      scopeFingerprint: prep.scopeFingerprint,
      selectionVersion: prep.selectionVersion,
      discovery: prep.discovery,
    };
  }

  /** 今日知识奇想：AI=知识连接器。同一天默认复用缓存；force=true 跳过缓存强制新结果。
   *  Discovery Scope：候选来自本地 Scope 过滤（§十七），同日期同范围结果稳定（§二十八）。
   *  只在真正生成时记录曝光（§二十三/四十五），缓存命中绝不记录（§二十五）。 */
  async runCuriosity(force = false): Promise<void> {
    if (!force) this.curiosityError = null;
    const prep = await this.discoveryPrep("curiosity");
    if (prep.candidatePaths.length === 0) {
      new Notice("当前探索范围（" + prep.discovery.scopeLabel + "）内没有可分析的笔记，请调整「知识发现」设置或先添加笔记。");
      return;
    }
    const outcome = await this.ai.generateCuriosity(this.toDiscoveryCallOpts(prep), force);
    if (outcome.ok) {
      if (!outcome.fromCache) this.discovery.recordExposure(prep.candidatePaths, "curiosity");
      this.discoveryMeta.curiosity = { scopeLabel: prep.discovery.scopeLabel, poolCount: prep.discovery.poolCount, count: prep.discovery.count };
      this.settings.lastCuriosity = { date: Date.now(), insight: outcome.data };
      this.curiosityError = null;
      await this.saveSettings();
      new Notice(outcome.fromCache ? "今日知识奇想（复用缓存）：" + outcome.data.title : "今日知识奇想已生成：" + outcome.data.title);
    } else {
      this.curiosityError = outcome.error.message;
      new Notice("AI 暂时无法连接：" + outcome.error.message);
    }
    this.rerenderDashboard();
  }
  /** Phase 5：今日知识漫游——AI 提出可探索的 nodes/edges 连接（同一天默认复用缓存）。
   *  结果只进 AI Cache（type=connections），Dashboard 直接读缓存渲染，绝不自动请求 AI（§五十四）。
   *  force 绕过现有 connections 缓存；失败只置错误标志，绝不删除旧成功缓存（§三十）。 */
  async runConnections(force = false): Promise<void> {
    if (!force) this.connectionError = null;
    const prep = await this.discoveryPrep("roaming");
    if (prep.candidatePaths.length === 0) {
      new Notice("当前探索范围（" + prep.discovery.scopeLabel + "）内没有可分析的笔记，请调整「知识发现」设置或先添加笔记。");
      return;
    }
    const outcome = await this.ai.generateConnections(this.toDiscoveryCallOpts(prep), force);
    if (outcome.ok) {
      if (!outcome.fromCache) this.discovery.recordExposure(prep.candidatePaths, "roaming");
      this.discoveryMeta.roaming = { scopeLabel: prep.discovery.scopeLabel, poolCount: prep.discovery.poolCount, count: prep.discovery.count };
      this.connectionError = null;
      new Notice(outcome.fromCache ? "今日知识漫游（复用缓存）：" + outcome.data.title : "今日知识连接已生成：" + outcome.data.title);
    } else {
      this.connectionError = outcome.error.message;
      new Notice("AI 暂时无法连接：" + outcome.error.message);
    }
    this.rerenderDashboard();
  }
  /** ---------- Query Explorer：用户主动提问 → 全库检索 → AI 关联（AI 发问 ↔ 我发问，§九） ---------- */

  private aiConfigFingerprint(): string {
    const c = this.settings.ai;
    return fingerprintKey([c.provider, c.baseUrl, c.model, String(c.temperature), String(c.maxTokens), String(c.timeoutSec)]);
  }

  private queryScopeLabel(scopeMode: QueryScopeMode): string {
    return scopeMode === "vault" ? "整个仓库" : discoveryScopeLabel(this.settings.discovery?.roaming?.scope, this.settings.knowledgeAreas);
  }

  /** Query Explorer 主流程（§九/五十~六十二）：本地检索始终执行；0 结果不调 AI（§六十五）；
   *  弱相关（≤2 篇）提示「仍然探索」不自动调 AI（§六十四）；AI 结果进 query_exploration 缓存（§七十八~八十一）。
   *  override：forceAi 跳过 AI 缓存；allowWeak 允许弱相关继续；scopeMode 切换范围。
   *  搜索绝不写 Activity / Review / Scheduler（§八十七~八十九）；打开笔记才算 file-open。 */
  async runQueryExploration(
    rawInput: string,
    override?: { forceAi?: boolean; allowWeak?: boolean; scopeMode?: QueryScopeMode }
  ): Promise<void> {
    const cfg = this.settings.queryExplorer;
    const parsed = parseQuery(rawInput);
    if (parsed.tokens.length === 0) { new Notice("请输入问题或关键词。"); return; }
    if ((rawInput ?? "").trim().length > QUERY_MAX_LENGTH) new Notice("问题较长，已保留前 " + QUERY_MAX_LENGTH + " 字进行探索。");
    // Phase 13 §一百零四：Query Explorer 默认使用当前 Workspace Scope；未设置 → 回退 Global Discovery（现有行为）
    const wsNow = this.currentWorkspace();
    const wsScope = wsNow && wsNow.discoveryScope ? wsNow.discoveryScope : undefined;
    const wsAreaNames = wsNow && wsNow.knowledgeAreas ? wsNow.knowledgeAreas : [];
    const wsAreas = wsAreaNames.length > 0 ? this.settings.knowledgeAreas.filter((a) => wsAreaNames.includes(a.name)) : this.settings.knowledgeAreas;
    const scopeMode: QueryScopeMode = override?.scopeMode ?? (wsScope ? "current-discovery-scope" : cfg.scopeMode);
    const scopeLabel = this.queryScopeLabel(scopeMode);
    const allNotes = this.index.all();
    const notesById = new Map(allNotes.map((n) => [n.path, n]));
    const metaOf = (pathStr: string): { path: string; modified: number; size: number } => {
      const n = notesById.get(pathStr);
      return { path: pathStr, modified: n?.modified ?? 0, size: n?.size ?? 0 };
    };
    this.queryExploration = {
      status: "searching", rawQuery: parsed.raw, normalizedQuery: parsed.normalized, cacheKey: "",
      scopeLabel, scopeMode, localCount: 0, candidateCount: 0, fromCache: false, error: null, result: null,
    };
    this.queryExplorerError = null;
    this.rerenderDashboard();
    // 阶段 1：本地检索（内存索引「正在搜索知识库…」→「找到 N 篇」，§五十七/六十六/十二）
    const localLimit = Math.max(1, Math.min(200, cfg.localResultLimit ?? 50));
    const scopePaths = queryScopePaths(scopeMode, allNotes, wsScope ?? this.settings.discovery?.roaming?.scope, wsAreas);
    const docs = this.searchIndex.search(parsed.tokens, localLimit).filter((d) => scopePaths.has(d.path));
    const ranked = rankSearchResults(docs, parsed.tokens, this.settings.knowledgeAreas, notesById);
    this.queryExploration.status = "found";
    this.queryExploration.localCount = ranked.length;
    this.rerenderDashboard();
    if (ranked.length === 0) {
      // §六十五：0 结果绝不调用 AI
      this.queryExploration.status = "done";
      this.queryExploration.error = "没有找到相关笔记。换个关键词试试（本地检索，未调用 AI）。";
      this.rerenderDashboard();
      new Notice("没有找到相关笔记。");
      return;
    }
    if (ranked.length <= 2 && !override?.allowWeak) {
      // §六十四：弱相关不自动调 AI（防止 AI 凭空生成知识），用户点「仍然探索」才继续
      this.queryExploration.status = "done";
      this.queryExploration.error = "没有找到足够相关的知识。";
      this.queryExploration.candidateCount = ranked.length;
      this.rerenderDashboard();
      new Notice("找到 " + ranked.length + " 篇弱相关笔记，未自动调用 AI。可点击「仍然探索」继续。");
      return;
    }
    // 阶段 2：候选选择（相关性优先 + 软多样性 round-robin，§三十/三十四）
    const candidates = selectQueryCandidates(ranked, cfg.candidateCount ?? 16, this.settings.knowledgeAreas)
      .slice(0, Math.max(1, Math.min(32, cfg.candidateCount ?? 16)));
    const candidatePaths = candidates.map((c) => c.doc.path);
    const candSig = candidateSig(candidatePaths.map(metaOf));
    const areaLines = this.reviews.areaLines();
    const scopeFp = scopeMode === "vault" ? "vault" : discoveryScopeFingerprint(wsScope ?? this.settings.discovery?.roaming?.scope);
    // §四十九/五十/七十八~八十一：候选集不变 → 缓存有效；配置/范围/选择版本任一变化 → 自动失效
    const periodKey = buildQueryCacheKey(
      "query_exploration", parsed.normalized, candSig, areaSig(areaLines),
      PROMPT_VERSIONS.query_exploration, this.aiConfigFingerprint() + "|ws:" + workspaceFingerprint(wsNow), scopeFp
    );
    this.queryExploration.status = "thinking";
    this.queryExploration.cacheKey = periodKey;
    this.queryExploration.candidateCount = candidates.length;
    this.rerenderDashboard();
    // 阶段 3：AI 关联（缓存命中零请求「正在整理 M 个候选之间的关系…」；force 跳过缓存）
    const lines = await this.index.candidatePayload(candidates.map((c) => notesById.get(c.doc.path)!), 700);
    const outcome = await this.ai.generateQueryExploration({
      query: parsed.raw,
      candidateLines: lines,
      candidatePaths,
      areaLines,
      dateLabel: "",
      candidateSig: candSig,
      areaSig: areaSig(areaLines),
      periodKey,
      discovery: { scopeLabel, poolCount: ranked.length, count: candidates.length },
    }, override?.forceAi ?? false);
    if (outcome.ok) {
      this.queryExploration.status = "done";
      this.queryExploration.result = outcome.data;
      this.queryExploration.fromCache = outcome.fromCache;
      this.queryExploration.error = null;
      // §一百零四/一百一十七：autoSave=ON 时成功探索可自动保存 Markdown（默认 OFF，只在用户点击时保存）
      if (this.settings.queryExplorer.autoSave) void this.saveQueryExploration();
      this.queryHistory.add(
        { query: parsed.raw, createdAt: Date.now(), scope: scopeMode, cacheKey: periodKey, headline: outcome.data.headline },
        Math.max(1, Math.min(100, cfg.historyLimit ?? 20))
      );
      new Notice(outcome.fromCache ? ("知识关联探索（复用缓存）：" + outcome.data.headline) : ("知识关联探索完成：" + outcome.data.headline));
    } else {
      // 失败只置错误标志，绝不丢本地结果（阶段 1/2 保留在状态里供 Dashboard 展示「找到 N 篇…」）
      this.queryExploration.status = "error";
      this.queryExploration.error = "找到 " + ranked.length + " 篇相关知识，但 AI 暂时无法整理。点击「重试」可稍后再试（本地结果保留）。";
      this.queryExplorerError = outcome.error.message;
      new Notice("AI 暂时无法整理：" + outcome.error.message);
    }
    this.rerenderDashboard();
  }

  /** 收藏 Query Explorer 结果（§五十二：与奇想/漫游同一收藏体系——写 Explorations/Saved/*.md + 收藏索引；0 AI，fingerprint 去重） */
  async saveQueryExploration(): Promise<void> {
    const st = this.queryExploration;
    if (!st.result || st.result.nodes.length === 0) { new Notice("当前没有可保存的探索结果。"); return; }
    const r = st.result;
    const nodes: SavedExplorationNode[] = r.nodes.map((n) => ({ path: n.path, label: n.label, role: n.role, reason: n.reason }));
    const edges: SavedExplorationEdge[] = r.edges.map((e) => ({ from: e.from, to: e.to, relation: e.relation, direction: e.direction, reason: e.reason }));
    const scope: DiscoveryScope | undefined = st.scopeMode === "vault" ? { mode: "vault" } : this.settings.discovery?.roaming?.scope;
    await this.saveExploration({
      source: "query_exploration",
      title: st.rawQuery || r.query || "知识探索",
      query: st.rawQuery || r.query,
      scope,
      headline: r.headline,
      summary: r.summary,
      nodes,
      edges,
    });
  }

  /** 清空最近探索历史（§九十五：只删 query-history.json，绝不触碰 AI 缓存 / Reviews） */
  clearQueryHistory(): void {
    this.queryHistory.clear();
    new Notice("已清空最近探索历史（只删 query-history.json；AI 缓存与 Reviews 不受影响）。");
    this.rerenderDashboard();
  }

  /** ---------- Saved Exploration：收藏知识链路（§五十二~五十四：保存/打开/删除 0 AI） ---------- */

  /** §四十九~五十一：当前结果是否已收藏（★ 已收藏 / ☆ 保存链路 由 UI 用 fingerprint 查询） */
  findSaved(fingerprint: string): SavedExploration | undefined {
    return this.saved.findByFingerprint(fingerprint);
  }

  /** 收藏当前探索结果（§八/十/五十二：serialize → Markdown → JSON 索引，0 AI；只保存已验证快照，绝不重新调 AI）。
   *  input.nodes/edges 来自当前结果（Query / 奇想 / 连接），保存后同 fingerprint 不重复收藏（§十二）。 */
  async saveExploration(input: {
    source: SavedExplorationSource;
    title?: string;
    query?: string;
    normalizedQuery?: string;
    scope?: DiscoveryScope;
    /** Phase 12 §六：Anchor 探索的起始笔记路径 */
    anchorPath?: string;
    headline?: string;
    summary?: string;
    nodes: SavedExplorationNode[];
    edges: SavedExplorationEdge[];
  }): Promise<void> {
    if (!input.nodes || input.nodes.length === 0) {
      new Notice("当前结果没有可收藏的知识节点。");
      return;
    }
    const normalized = input.normalizedQuery ?? (input.query ? parseQuery(input.query).normalized : "");
    const fingerprint = savedFingerprint(input.source, normalized, input.nodes, input.edges);
    const existing = this.saved.findByFingerprint(fingerprint);
    if (existing) {
      new Notice("已收藏过同一条知识链路：「" + existing.title + "」。");
      this.rerenderDashboard();
      return; // §十二：同一链路不重复收藏
    }
    const createdAt = Date.now();
    const wsNow = this.currentWorkspace();
    const d = new Date(createdAt);
    const ymd = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const title = (input.title || input.headline || input.query || "知识收藏").trim().slice(0, 80) || "知识收藏";
    const entry: SavedExploration = {
      id: savedId(d),
      title,
      query: input.query,
      source: input.source,
      createdAt,
      updatedAt: createdAt,
      scope: input.scope,
      anchorPath: input.anchorPath,
      headline: input.headline,
      summary: input.summary,
      // Phase 13 §一百零二：保存收藏时的 Workspace 快照（历史不变，不动态改旧收藏）
      workspaceSnapshot: wsNow ? { id: wsNow.id, name: wsNow.name } : undefined,
      nodes: input.nodes.map((n) => ({ path: n.path, label: n.label, role: n.role, reason: n.reason })),
      edges: input.edges.map((e) => ({ from: e.from, to: e.to, relation: e.relation, direction: e.direction, reason: e.reason })),
      markdownPath: "Knowledge Garden/Explorations/Saved/" + ymd + " " + safeTitle(title) + ".md",
      fingerprint,
    };
    try {
      await this.ensureVaultFolder("Knowledge Garden/Explorations/Saved");
      const body = savedMarkdown(entry) + "\n";
      const existingMd = this.app.vault.getAbstractFileByPath(normalizePath(entry.markdownPath));
      if (existingMd instanceof TFile) await this.app.vault.modify(existingMd, body);
      else await this.app.vault.create(entry.markdownPath, body);
    } catch (e) {
      new Notice("写入收藏 Markdown 失败：" + (e instanceof Error ? e.message : String(e)));
      return;
    }
    this.saved.add(entry);
    // §十八：引用跟随 rename——重写 Markdown 保持 Graph 与 md 一致（§四十五）
    this.rerenderDashboard();
    new Notice("已收藏：「" + title + "」（保存当前结果快照，0 AI；不依赖 AI Cache）。");
  }

  /** 删除收藏（§三十五/三十六：确认后只删收藏 Markdown + JSON 条目，绝不删除原始笔记；0 AI）。
   *  确认弹窗由 UI（Saved View / Dashboard）负责；此方法只执行。 */
  async deleteSaved(id: string): Promise<void> {
    const entry = this.saved.get(id);
    if (!entry) { new Notice("收藏不存在。"); return; }
    let removedMd = false;
    try {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(entry.markdownPath));
      if (f instanceof TFile) { await this.app.vault.trash(f, true); removedMd = true; }
    } catch { removedMd = false; }
    this.saved.remove(id);
    this.rerenderDashboard();
    new Notice("已删除收藏「" + entry.title + "」" + (removedMd ? "" : "（收藏 Markdown 未找到，索引已删除）") + "。原始笔记未受影响。");
  }

  /** 标题/标签编辑（§三十二/三十三：同步 JSON 索引 + 收藏 Markdown H1/frontmatter；绝不修改原始笔记；0 AI） */
  async updateSavedMeta(id: string, patch: { title?: string; tags?: string[] }): Promise<void> {
    const entry = this.saved.get(id);
    if (!entry) { new Notice("收藏不存在。"); return; }
    this.saved.update(id, patch);
    const updated = this.saved.get(id);
    if (!updated) return;
    try {
      const body = savedMarkdown(updated) + "\n";
      const f = this.app.vault.getAbstractFileByPath(normalizePath(updated.markdownPath));
      if (f instanceof TFile) await this.app.vault.modify(f, body);
      else await this.app.vault.create(updated.markdownPath, body);
    } catch (e) {
      new Notice("更新收藏 Markdown 失败：" + (e instanceof Error ? e.message : String(e)));
      return;
    }
    this.rerenderDashboard();
    new Notice("收藏已更新（标题/标签已同步 Markdown 与索引；原始笔记未修改，0 AI）。");
  }

  /** §四十一~四十三：从收藏 Markdown 重新建立索引（读 frontmatter；0 AI；JSON 损坏后的恢复源） */
  async reindexSaved(): Promise<void> {
    const folder = "Knowledge Garden/Explorations/Saved";
    const dir = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!(dir instanceof TFolder)) {
      this.saved.replaceAll([]);
      this.rerenderDashboard();
      new Notice("没有收藏 Markdown 目录（" + folder + "），收藏索引已置空（0 AI）。");
      return;
    }
    const files = dir.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
    const entries: SavedExploration[] = [];
    let broken = 0;
    for (const f of files) {
      try {
        const md = await this.app.vault.adapter.read(f.path);
        const fm = parseSavedFrontmatter(md);
        if (!fm) { broken++; continue; }
        const nodes = fm.nodes.length ? fm.nodes : this.savedNodesFromPathLine(md, f.path);
        const obs = this.savedAIFromMarkdown(md);
        entries.push({
          id: fm.id,
          title: fm.title || f.basename,
          query: fm.query,
          source: fm.source,
          anchorPath: fm.anchorPath,
          createdAt: this.savedDateFromYmd(fm.date) ?? f.stat?.mtime ?? Date.now(),
          updatedAt: f.stat?.mtime ?? Date.now(),
          scope: fm.scope ? this.savedScopeFromJson(fm.scope) : undefined,
          headline: obs.headline,
          summary: obs.summary,
          nodes,
          edges: fm.edges,
          markdownPath: f.path,
          fingerprint: savedFingerprint(fm.source, fm.query ?? "", nodes, fm.edges),
        });
      } catch { broken++; }
    }
    this.saved.replaceAll(entries);
    this.rerenderDashboard();
    new Notice("收藏索引已重建：" + entries.length + " 条" + (broken ? "（" + broken + " 篇 Markdown 无法解析，文件未删除）" : "") + "（0 AI）。");
  }

  /** 恢复辅助：知识路径行 [[A]] → [[B]]（§四十三 兜底：frontmatter 无 nodes 时） */
  private savedNodesFromPathLine(md: string, mdPath: string): SavedExplorationNode[] {
    const i = md.indexOf("## 知识路径");
    if (i < 0) return [];
    const rest = md.slice(i + 8);
    const j = rest.indexOf("## 关系");
    const seg = j > 0 ? rest.slice(0, j) : rest;
    const line = seg.split("\n").find((s) => s.includes("[["));
    if (!line) return [];
    const titles = [...line.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]).filter(Boolean);
    return titles.map((tl) => ({ path: tl + ".md", label: tl }));
  }

  /** 恢复辅助：AI 观察段落（§四十三） */
  private savedAIFromMarkdown(md: string): { headline?: string; summary?: string } {
    const i = md.indexOf("## AI 观察");
    const j = md.indexOf("## 知识路径", i);
    if (i < 0 || j <= i) return {};
    const paras = md.slice(i + 8, j).split("\n").map((s) => s.trim()).filter(Boolean);
    if (paras.length === 0) return {};
    return { headline: paras[0], summary: paras.slice(1).join("\n") || undefined };
  }

  private savedDateFromYmd(ymd?: string): number | null {
    if (!ymd) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  private savedScopeFromJson(s: string): DiscoveryScope | undefined {
    try {
      const obj = JSON.parse(s) as DiscoveryScope;
      if (obj && typeof obj === "object" && typeof obj.mode === "string") return obj;
      return undefined;
    } catch { return undefined; }
  }

  /** §二十九：基于收藏重新探索——恢复 query/scope 到 Query Explorer，不自动调 AI（用户点「重新探索」才请求） */
  async resumeQueryExploration(entry: SavedExploration): Promise<void> {
    const scopeMode: QueryScopeMode = entry.scope && (entry.scope as DiscoveryScope).mode === "vault" ? "vault" : "current-discovery-scope";
    const raw = entry.query || entry.title || "";
    this.queryExploration = {
      status: "idle", rawQuery: raw, normalizedQuery: raw ? parseQuery(raw).normalized : "",
      cacheKey: "", scopeLabel: this.queryScopeLabel(scopeMode), scopeMode,
      localCount: 0, candidateCount: 0, fromCache: false, error: null, result: null,
    };
    await this.activateView();
  }

  /** Phase 12 §十五：基于保存的 Anchor 收藏恢复探索——只恢复起点笔记 + 范围到 Anchor 探索器，
   *  不自动调 AI（用户点「重新探索」才请求；§十六 打开收藏全程 0 AI）。 */
  async resumeAnchorExploration(entry: SavedExploration): Promise<void> {
    const anchorPath = entry.anchorPath || "";
    if (!anchorPath) { new Notice("该收藏缺少起始笔记信息（anchorPath 缺失）。"); return; }
    const scopeMode: "vault" | "discovery" =
      entry.scope && (entry.scope as DiscoveryScope).mode === "vault" ? "vault" : "discovery";
    const f = this.app.vault.getAbstractFileByPath(anchorPath);
    if (!(f instanceof TFile)) {
      new Notice("起始笔记已不存在：《" + (anchorPath.split("/").pop() ?? anchorPath).replace(/.md$/i, "") + "》（收藏快照仍可查看，无法恢复探索，§十九）。");
      return;
    }
    this.toolbox.openAnchorFromSaved(f.path, scopeMode);
  }

  async runReview(period: Period, force = false, periodKeyOverride?: string): Promise<{ path: string; offline: boolean; fromCache: boolean } | null> {
    try {
      const result = await this.reviews.generateReview(period, force, periodKeyOverride);
      if (result) this.openNote(result.path);
      // §29/30：手动 / 强制 / Scheduler 成功后统一写 ScheduleState=done（到点后 Scheduler 直接跳过）
      if (this.scheduler) this.scheduler.markGenerated(period, result);
      // Phase 7：复盘成功后顺带更新周快照（§十：本地计算无 AI）；月度复盘成功后按设置决定是否补充长期演化（§五十一/五十二：缓存命中则零请求）
      if (result && this.settings.evolution.enabled && (period === "weekly" || period === "monthly" || period === "quarterly")) {
        this.updateWeeklySnapshot();
        if (period === "monthly" && this.settings.evolution.longTermAI !== "off") void this.runMonthlyEvolution(false);
      }
      // Phase 8 §四十一~四十四：日复盘成功后按 autoQueue 生成本地队列（不调 AI，§六十四）；默认不自动打开窗口（§四十三）
      if (result && period === "daily" && this.settings.reviewCenter.autoQueue) {
        const before = this.reviewCenter.getQueue();
        this.ensureReviewQueue(false);
        const after = this.reviewCenter.getQueue();
        if (!before || before.periodKey !== after?.periodKey) {
          new Notice("今日复习队列已生成（本地计算）。可在 Dashboard「今日复习」或命令面板打开复习窗口。");
          if (this.settings.reviewCenter.autoOpenReview) void this.openReviewSession();
        }
      }
      return result;
    } catch (e) {
      new Notice("复盘生成失败：" + (e instanceof Error ? e.message : String(e)));
      return null;
    } finally {
      this.rerenderDashboard();
    }
  }

  openNote(p: string): void {
    const f = this.app.vault.getAbstractFileByPath(p);
    if (!(f instanceof TFile)) { new Notice("笔记不存在：" + p); return; }
    void this.app.workspace.openLinkText(f.basename, f.path, false);
  }

  /** 清空 AI 缓存：只删 cache/ 下的 AI 结果，绝不触碰 Reviews/（复盘 Markdown 是用户知识，不可删）。 */
  clearAICache(): void {
    const removed = this.cache.clearType("*");
    new Notice("已清空 AI 缓存（" + removed + " 条）。本地索引与 Reviews/ 不受影响。");
    this.rerenderDashboard();
  }
  /** §四十六：新增「清理过期 AI 缓存」——只删 expired/obsolete，不默认全删；Reviews/ 绝不触碰 */
  clearExpiredAICache(): void {
    const removed = this.cache.clearExpired();
    new Notice("已清理过期 AI 缓存（" + removed + " 条）。未过期的有效结果与 Reviews/ 不受影响。");
    this.rerenderDashboard();
  }

  /** §20：标记当前笔记为已复习——只写本地 activity，绝不修改原笔记，也绝不使 AI 缓存失效 */
  async markReviewed(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile)) { new Notice("当前没有打开的笔记。"); return; }
    this.activity.recordAccess(f.path);
    this.activity.markReviewed(f.path);
    new Notice("已标记《" + f.basename + "》为已复习（本地记录，不修改原笔记，不影响 AI 缓存）。");
    this.rerenderDashboard();
  }

  /** Phase 11：状态随机浏览（§四~十六）：纯本地 0 AI；点击/命令共用同一逻辑（§十五） */
  browseState(state: KGState): void {
    const pool = resolveStateBrowseScope(this.settings.stateBrowse, this.index.all(), this.settings.knowledgeAreas, this.settings.discovery?.roaming?.scope);
    const notes = getNotesByState(pool, (p: string) => this.activity.get(p), this.settings.activity, state);
    const pick = pickRandomNote(notes, this.browseLastPath ?? undefined);
    if (!pick) {
      new Notice("当前范围内没有符合「" + stateBrowseLabel(state) + "」的笔记。（纯本地，未调用 AI）");
      return;
    }
    this.browseLastPath = pick.path; // §一百八十九：只存内存 last path
    this.openNote(pick.path);
  }

  /** Phase 11：右键「提炼到知识库」（§二十三~二十九）：复用 knowledgeProcessor + knowledge_processing 缓存；
   *  只生成知识候选，绝不覆盖当前笔记（§二十四）；目标 Area 在候选确认时由用户最终决定（§二十五）。 */
  async refineNoteToKnowledge(sourcePath: string, opts?: { sourceKind?: "note" | "knowledge" | "capture" }): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(f instanceof TFile)) { new Notice("笔记不存在：" + sourcePath); return; }
    const md = await this.app.vault.cachedRead(f);
    const body = captureBody(md);
    if (!body.trim()) { new Notice("该笔记没有可提炼的正文。"); return; }
    await this.ensureVaultFolder(this.settings.capture.processingFolder);
    const areaLines = this.settings.knowledgeAreas.map((a) => a.name);
    const vaultPaths = this.app.vault.getMarkdownFiles().map((x) => x.path);
    const outcome = await this.ai.generateKnowledgeProcessing({
      content: body,
      sourcePath: f.path,
      sourceVersion: sourceVersionFor(f.stat?.mtime ?? 0, f.stat?.size ?? 0),
      sourceTitle: f.basename,
      suggestTags: this.settings.capture.suggestTags,
      suggestAreas: this.settings.capture.suggestAreas,
      areaLines,
      vaultPaths,
    });
    if (!outcome.ok) {
      this.captureError = outcome.error.message;
      new Notice("AI 提炼失败：" + outcome.error.message + "（原始笔记保持未动，可稍后重试）。");
      this.rerenderDashboard();
      return;
    }
    const candidate = outcome.data;
    const targetPath = captureFilePath(this.settings.capture.processingFolder, captureDate(), candidate.title);
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      const oldMd = await this.app.vault.cachedRead(existing);
      const updated = replaceProcessingAiRegion(oldMd, processingAiRegion(candidate));
      await this.app.vault.modify(existing, updated);
      new Notice((outcome.fromCache ? "已更新知识候选（复用 AI 缓存）：" : "已更新知识候选：") + targetPath);
    } else {
      const full = buildProcessingMarkdown({ candidate, origin: "derived", sourcePath: f.path, sourceTitle: f.basename });
      await this.app.vault.create(targetPath, full);
      new Notice((outcome.fromCache ? "已生成知识候选（复用 AI 缓存）：" : "已生成知识候选：") + targetPath);
    }
    new Notice("请打开知识候选确认目标 Area（由你最终决定），然后执行「将当前知识候选提炼为知识」。");
    await this.refreshCaptureSummary();
  }

  /** Phase 11：Anchor Knowledge Exploration（§三十~四十一）：当前笔记 → 本地产检 → AI 关联 → 图。
   *  只读本地；不写 Activity/Review/Scheduler；结果只在用户点「★ 保存链路」时进 Saved（§一百二十九/一百三十）。 */
  async runAnchorExploration(
    anchorPath: string,
    scopeMode: "vault" | "discovery",
    onUpdate: (s: { status: "searching" | "thinking" | "done" | "error"; message: string; result?: QueryExplorationResult; cacheKey?: string; fromCache?: boolean }) => void,
    force = false
  ): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(anchorPath);
    if (!(f instanceof TFile)) { onUpdate({ status: "error", message: "笔记不存在：" + anchorPath }); return; }
    const md = await this.app.vault.cachedRead(f);
    const meta = this.index.get(f.path);
    const tokenMap = new Map<string, number>();
    for (const tok of tokenizeText(md)) tokenMap.set(tok, (tokenMap.get(tok) ?? 0) + 1);
    const tokens = anchorTokens({
      title: f.basename,
      tags: meta?.tags ?? [],
      headings: extractHeadings(md),
      aliases: extractAliases(md),
      tokenMap,
    });
    if (tokens.length === 0) { onUpdate({ status: "error", message: "无法从该笔记提取检索关键词。" }); return; }
    onUpdate({ status: "searching", message: "正在搜索候选知识…" });
    const allNotes = this.index.all();
    const noteMap = new Map(allNotes.map((n) => [n.path, n]));
    // Phase 13 §一百零五：Anchor 默认 Workspace Scope；用户可手动切「Entire Vault」
    const wsNow = this.currentWorkspace();
    const wsScope = wsNow && wsNow.discoveryScope ? wsNow.discoveryScope : undefined;
    const wsAreaNames = wsNow && wsNow.knowledgeAreas ? wsNow.knowledgeAreas : [];
    const wsAreas = wsAreaNames.length > 0 ? this.settings.knowledgeAreas.filter((a) => wsAreaNames.includes(a.name)) : this.settings.knowledgeAreas;
    const scopePaths = anchorScopePaths(scopeMode, allNotes, wsScope ?? this.settings.discovery?.roaming?.scope, wsAreas);
    const docs = this.searchIndex.search(tokens, ANCHOR_LOCAL_LIMIT_DEFAULT)
      .filter((d) => scopePaths.has(d.path) && d.path !== f.path);
    const ranked = rankSearchResults(docs, tokens, this.settings.knowledgeAreas, noteMap);
    if (ranked.length === 0) { onUpdate({ status: "done", message: "没有找到相关候选笔记（未调用 AI）。" }); return; }
    const candidates = selectQueryCandidates(ranked, ANCHOR_COUNT_DEFAULT, this.settings.knowledgeAreas).slice(0, 16);
    const paths = [f.path, ...candidates.map((c) => c.doc.path)].slice(0, 16);
    const metaOf = (p: string): { path: string; modified: number; size: number } => {
      const n = noteMap.get(p);
      return { path: p, modified: n?.modified ?? 0, size: n?.size ?? 0 };
    };
    const candSig = candidateSig(paths.map(metaOf));
    const areaLines = this.reviews.areaLines();
    const scopeFp = scopeMode === "vault" ? "vault" : discoveryScopeFingerprint(wsScope ?? this.settings.discovery?.roaming?.scope);
    const periodKey = buildAnchorCacheKey({
      anchorPath: f.path,
      scopeFingerprint: scopeFp,
      candidateSig: candSig,
      areaSig: areaSig(areaLines),
      promptVersion: ANCHOR_PROMPT_VERSION,
      routeFingerprint: routeFingerprintWithWorkspace("anchor_exploration", this.settings.aiProfiles, this.settings.aiFunctionConfig, wsNow, undefined, this.settings.defaultProfileId),
    });
    onUpdate({ status: "thinking", message: "正在整理 " + candidates.length + " 个候选之间的关系…" });
    const anchorNotes = paths.map((p) => noteMap.get(p)).filter((n): n is NoteMetadata => !!n);
    const lines = await this.index.candidatePayload(anchorNotes, 700);
    const outcome = await this.ai.generateAnchorExploration({
      anchorTitle: f.basename,
      anchorPath: f.path,
      candidateLines: lines,
      candidatePaths: paths,
      areaLines,
      dateLabel: "",
      candidateSig: candSig,
      areaSig: areaSig(areaLines),
      periodKey,
      discovery: {
        scopeLabel: scopeMode === "vault" ? "整个仓库" : discoveryScopeLabel(this.settings.discovery?.roaming?.scope, this.settings.knowledgeAreas),
        poolCount: ranked.length,
        count: paths.length,
      },
    }, force);
    if (outcome.ok) {
      onUpdate({ status: "done", message: outcome.data.headline || "探索完成。", result: outcome.data, cacheKey: periodKey, fromCache: outcome.fromCache });
    } else {
      onUpdate({ status: "error", message: "AI 暂时无法整理：" + outcome.error.message });
    }
  }

  // ---------- Capture / Processing / Provenance / Knowledge Refinement（本阶段：只增不改；Capture 0 AI §二十二） ----------

  /** §一十三/一百零一：Capture/Processing/Knowledge/Archive 四目录在 Capture 体系内 */
  isCapturePath(path: string): boolean {
    const lower = path.toLowerCase();
    const cap = this.settings.capture;
    for (const folder of [cap.inboxFolder, cap.processingFolder, cap.knowledgeFolder, cap.archiveFolder]) {
      const f = folder.replace(/[\\/]+$/, "").toLowerCase();
      if (f && (lower === f || lower.startsWith(f + "/"))) return true;
    }
    return false;
  }

  // ---------- Phase 10：Relationship Lifecycle（AI 建议 → 用户确认 → 长期关系；全部 0 AI §六十七/七十七） ----------

  /** 确保关系目录存在（§五十四：默认 Knowledge Garden/Relationships） */
  async ensureRelationshipFolder(): Promise<void> {
    await this.ensureVaultFolder(this.settings.relationship.folder);
  }

  /** basename（不带 .md）→ Vault 真实路径（§四十四：path 必须 ∈ Vault 真实路径） */
  private resolveRelNode(title: string): string | undefined {
    const t = (title || '').trim().replace(/\.md$/i, '');
    const lower = t.toLowerCase();
    const hits = this.index.all().filter((n) => {
      const base = (n.path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase();
      return base === lower;
    });
    return hits.length ? hits[0].path : undefined;
  }

  /** 用户确认连接（§六/七）：创建长期 Relationship + 写 Relationships/*.md（§五十三/五十四）；0 AI */
  async confirmRelationship(input: { from: string; to: string; relation: string; reason?: string; direction?: 'forward' | 'bidirectional' }): Promise<void> {
    const from = this.resolveRelNode(input.from);
    const to = this.resolveRelNode(input.to);
    if (!from || !to || relNodeLabel(from) === relNodeLabel(to)) {
      new Notice('无法确认连接：两个节点必须是 Vault 中真实存在的笔记（§四十四）。');
      return;
    }
    const evidence: RelationshipEvidence[] = ['user_confirmed'];
    // §十九/二十：两端真实 WikiLink 存在 → 证据合并（绝不自动修改原笔记 §八/六十）
    const hasWiki = !!this.index.get(from)?.links.some((l) => relNodeLabel(l.replace(/#.*$/, '')) === relNodeLabel(to))
      || !!this.index.get(to)?.links.some((l) => relNodeLabel(l.replace(/#.*$/, '')) === relNodeLabel(from));
    if (hasWiki) evidence.push('wikilink');
    const rel = this.relationships.confirm({
      from, to,
      relation: input.relation,
      ...(input.reason && input.reason.trim() ? { reason: input.reason.trim() } : {}),
      evidence,
      direction: input.direction === 'forward' ? 'forward' : 'bidirectional',
    });
    const mdPath = this.relationshipMarkdownPath(rel);
    try {
      await this.ensureRelationshipFolder();
      const body = buildRelationshipMarkdown(rel) + '\n';
      const existing = this.app.vault.getAbstractFileByPath(mdPath);
      if (existing instanceof TFile) await this.app.vault.modify(existing, body);
      else await this.app.vault.create(mdPath, body);
    } catch (e) {
      new Notice('写入关系 Markdown 失败：' + (e instanceof Error ? e.message : String(e)) + '（关系已存索引；可用「恢复知识关系」重生成）。');
    }
    new Notice('已确认连接：' + relNodeLabel(from) + ' ↔ ' + relNodeLabel(to) + '（0 AI；长期关系已保存）。');
    this.rerenderDashboard();
  }

  /** 关系 Markdown 路径（文件名含 id 前缀，§五十四 风格 + §五十九 可识别） */
  private relationshipMarkdownPath(rel: KnowledgeRelationship): string {
    const folder = this.settings.relationship.folder.replace(/[\\/]+$/, '');
    const fileName = relSafeFileName(relNodeLabel(rel.from) + '--' + relNodeLabel(rel.to)) + '-' + rel.id.slice(0, 8) + '.md';
    return normalizePath(folder + '/' + fileName);
  }

  /** 忽略 AI 建议（§十三/十四）：只记录 feedback，不写 Markdown（§五十七）；0 AI */
  async dismissSuggestion(input: { from: string; to: string; relation: string; direction?: 'forward' | 'bidirectional' }): Promise<void> {
    const from = this.resolveRelNode(input.from);
    const to = this.resolveRelNode(input.to);
    if (!from || !to) {
      new Notice('无法忽略建议：节点必须是 Vault 中真实存在的笔记（§四十四）。');
      return;
    }
    this.relationships.dismiss({ from, to, relation: input.relation, direction: input.direction === 'forward' ? 'forward' : 'bidirectional' });
    new Notice('已忽略该关系建议（0 AI；短时间内不再重复推荐 §十五）。');
    this.rerenderDashboard();
  }

  /** §五十二/五十五/五十八：扫描 Relationships/*.md → 与索引同步（恢复 + 删 md 同步移除）；0 AI */
  async scanRelationshipMarkdown(showNotice = false): Promise<void> {
    const folder = this.settings.relationship.folder.replace(/[\\/]+$/, '').toLowerCase();
    const parsed: ParsedRelationshipMarkdown[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.toLowerCase().startsWith(folder + '/')) continue;
      try {
        const md = await this.app.vault.cachedRead(f);
        const p = parseRelationshipMarkdown(md);
        if (p) parsed.push(p);
      } catch { /* 单个文件解析失败忽略，不阻塞恢复 */ }
    }
    this.relationships.reconcileFromMarkdown(parsed, (title) => this.resolveRelNode(title));
    if (showNotice) new Notice('知识关系已同步（Relationships/*.md 为准；0 AI）。');
    this.rerenderDashboard();
  }

  /** 打开关系目录（§五十四；0 AI） */
  async openRelationshipFolder(): Promise<void> {
    await this.ensureRelationshipFolder();
    const folder = this.settings.relationship.folder;
    const prefix = folder.replace(/[\\/]+$/, '').toLowerCase() + '/';
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.toLowerCase().startsWith(prefix));
    if (files.length === 0) { new Notice('关系目录为空：' + folder + '。请在知识图中「确认连接」。'); return; }
    await this.app.workspace.getLeaf(false).openFile(files[0]);
  }

  /** §六十三/七十：关系概览数字（Dashboard 图旁 + Diagnostics；0 AI） */
  relationshipCounts(): { confirmed: number; dismissed: number; aiInferred: number; wikilinkEvidence: number } {
    const st = this.relationships.stats();
    const aiEdgeSet = new Set<string>();
    for (const e of this.aiEdges()) {
      const a = (e.from.replace(/\.md$/i, '').split('/').pop() ?? e.from).toLowerCase();
      const b = (e.to.replace(/\.md$/i, '').split('/').pop() ?? e.to).toLowerCase();
      aiEdgeSet.add(a <= b ? a + '|' + b : b + '|' + a);
    }
    let wikilinkEvidence = 0;
    for (const n of this.index.all()) wikilinkEvidence += n.links.length + n.backlinks.length;
    return { confirmed: st.confirmed, dismissed: st.dismissed, aiInferred: aiEdgeSet.size, wikilinkEvidence };
  }

  /** §二十二/二十三/二十四：给 Graph 边附加证据（实线=confirmed、普通实线=wikilink、虚线=ai_inferred） */
  decorateGraphEdges(model: { edges: { from: string; to: string }[] }): void {
    for (const e of model.edges) {
      const confirmed = this.relationships.findBetween(e.from, e.to).some((r) => r.status === 'active' && r.evidence.includes('user_confirmed'));
      const hasWiki = !!this.index.get(e.from)?.links.some((l) => relNodeLabel(l.replace(/#.*$/, '')) === relNodeLabel(e.to))
        || !!this.index.get(e.to)?.links.some((l) => relNodeLabel(l.replace(/#.*$/, '')) === relNodeLabel(e.from));
      (e as unknown as { evidence?: RelationshipEvidence[] }).evidence = confirmed
        ? (hasWiki ? ['user_confirmed', 'wikilink'] : ['user_confirmed'])
        : (hasWiki ? ['wikilink'] : ['ai_inferred']);
    }
  }


  /** §六十九/一百零八：确保 Capture 四目录存在（幂等；不移动用户已有目录） */
  async ensureCaptureFolders(): Promise<void> {
    const cap = this.settings.capture;
    for (const folder of [cap.inboxFolder, cap.processingFolder, cap.knowledgeFolder, cap.archiveFolder]) {
      await this.ensureVaultFolder(folder);
    }
    await this.refreshCaptureSummary();
  }

  /** §六十二/一百一十一/一百一十二：本地计数摘要（0 AI，只读 frontmatter/文件名；Dashboard/Diagnostics 复用） */
  async refreshCaptureSummary(): Promise<void> {
    const cap = this.settings.capture;
    const norm = (s: string): string => s.replace(/[\\/]+$/, "").toLowerCase();
    const inbox = norm(cap.inboxFolder);
    const processing = norm(cap.processingFolder);
    const knowledge = norm(cap.knowledgeFolder);
    const archive = norm(cap.archiveFolder);
    let inboxCount = 0;
    let candidates = 0;
    let accepted = 0;
    let archived = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const p = f.path.toLowerCase();
      if (inbox && p.startsWith(inbox + "/")) {
        const md = await this.app.vault.cachedRead(f);
        const meta = parseCaptureFrontmatter(md);
        if (!meta?.status || meta.status === "inbox" || meta.status === "processing") inboxCount++;
      } else if (processing && p.startsWith(processing + "/")) {
        candidates++;
      } else if (knowledge && p.startsWith(knowledge + "/")) {
        accepted++;
      } else if (archive && p.startsWith(archive + "/")) {
        archived++;
      }
    }
    this.captureSummaryText = { inbox: inboxCount, candidates, accepted, archived };
    this.rerenderDashboard();
  }

  /** §二十一/九：新建捕获 —— Capture 0 AI；frontmatter 存 provenance，正文分离（§九）。§一百一十五：重复 URL 仅提示不阻止。 */
  async createCapture(input: CaptureFormInput): Promise<void> {
    const cap = this.settings.capture;
    if (!input.title.trim() && !input.body.trim() && !(input.sourceUrl ?? "").trim()) {
      new Notice("捕获内容为空，已取消。"); return;
    }
    await this.ensureVaultFolder(cap.inboxFolder);
    let dupPath: string | null = null;
    if ((input.sourceUrl ?? "").trim()) {
      const fp = urlFingerprint((input.sourceUrl ?? "").trim());
      const inboxPrefix = cap.inboxFolder.replace(/[\\/]+$/, "").toLowerCase() + "/";
      for (const f of this.app.vault.getMarkdownFiles()) {
        if (!f.path.toLowerCase().startsWith(inboxPrefix)) continue;
        const md = await this.app.vault.cachedRead(f);
        const meta = parseCaptureFrontmatter(md);
        if (meta?.sourceUrl && urlFingerprint(meta.sourceUrl) === fp) { dupPath = f.path; break; }
      }
    }
    const path = captureFilePath(cap.inboxFolder, captureDate(), input.title);
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice("同名捕获已存在：" + path + "。请换标题或直接处理已有捕获。"); return;
    }
    const md = buildCaptureMarkdown({
      captureType: input.captureType,
      title: input.title,
      body: input.body,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      ...(input.sourceTitle ? { sourceTitle: input.sourceTitle } : {}),
    });
    await this.app.vault.create(path, md);
    if (dupPath) {
      new Notice("提示：来源 URL 与已有捕获重复（" + dupPath + "）。仍已保存（同一 URL 可能有新内容，§一百一十五）。");
    } else {
      new Notice("已捕获到 Inbox：" + path + "（0 AI；需要时对该笔记执行「处理当前捕获」）。");
    }
    await this.refreshCaptureSummary();
  }

  /** §二十：从剪贴板捕获（中文/英文/多段；0 AI；剪贴板失败时降级为表单） */
  async clipboardCapture(): Promise<void> {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { /* 降级：提示手动粘贴 */ }
    if (!text || !text.trim()) {
      new CaptureFormModal(this.app, (input) => { void this.createCapture(input); }).open();
      new Notice("剪贴板为空或不可读，已打开新建捕获表单代替（§二十）。");
      return;
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const title = (lines[0] ?? "剪贴板内容").slice(0, 60);
    await this.createCapture({ captureType: "clipboard", title, body: lines.join("\n") });
  }

  /** §一百零七：当前打开笔记操作 —— 处理当前捕获（§二十四：唯一 AI 入口） */
  async processCurrentCapture(force = false): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile)) { new Notice("当前没有打开的笔记。"); return; }
    const meta = parseCaptureFrontmatter(await this.app.vault.cachedRead(f));
    if (!meta || meta.captureType !== "clipboard" && meta.captureType !== "url" && meta.captureType !== "note" && meta.captureType !== "import") {
      new Notice("当前笔记不是 Capture（缺少 type: capture frontmatter）。请先新建捕获。"); return;
    }
    await this.runKnowledgeProcessing(f.path, force);
  }

  /** §二十四/九十五~九十八：AI Processing —— 只提炼为知识候选；原始 Capture 绝不修改（§十四/二十五）。 */
  async runKnowledgeProcessing(capturePath: string, force = false): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(capturePath);
    if (!(f instanceof TFile)) { new Notice("找不到该捕获笔记。"); return; }
    const md = await this.app.vault.cachedRead(f);
    const meta = parseCaptureFrontmatter(md);
    const content = captureBody(md);
    if (!content) { new Notice("该捕获没有正文，无法处理。"); return; }
    if (!force) this.captureError = null;
    await this.ensureVaultFolder(this.settings.capture.processingFolder);
    const areaLines = this.settings.knowledgeAreas.map((a) => a.name);
    const vaultPaths = this.app.vault.getMarkdownFiles().map((x) => x.path);
    const outcome = await this.ai.generateKnowledgeProcessing({
      content,
      sourcePath: f.path,
      sourceVersion: sourceVersionFor(f.stat?.mtime ?? 0, f.stat?.size ?? 0),
      sourceTitle: meta?.sourceTitle,
      suggestTags: this.settings.capture.suggestTags,
      suggestAreas: this.settings.capture.suggestAreas,
      areaLines,
      vaultPaths,
    }, force);
    if (!outcome.ok) {
      this.captureError = outcome.error.message;
      new Notice("AI 提炼失败：" + outcome.error.message + "（原始 Capture 保留未动，可稍后重试）。");
      this.rerenderDashboard();
      return;
    }
    const candidate = outcome.data;
    const origin: KnowledgeOrigin = "derived";
    const targetPath = captureFilePath(this.settings.capture.processingFolder, captureDate(), candidate.title);
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      const oldMd = await this.app.vault.cachedRead(existing);
      const updated = replaceProcessingAiRegion(oldMd, processingAiRegion(candidate));
      await this.app.vault.modify(existing, updated);
      new Notice(outcome.fromCache ? "已更新知识候选（复用 AI 缓存）：" + targetPath : "已更新知识候选：" + targetPath);
    } else {
      const full = buildProcessingMarkdown({ candidate, origin, sourcePath: f.path, sourceTitle: meta?.sourceTitle });
      await this.app.vault.create(targetPath, full);
      new Notice(outcome.fromCache ? "已生成知识候选（复用 AI 缓存）：" + targetPath : "已生成知识候选：" + targetPath);
    }
    await this.refreshCaptureSummary();
  }

  /** §四十一/一百零三：用户确认（Knowledge Curation，不是 Memory Review）→ Candidate → Knowledge；
   *  provenance（origin/source）保留；Inbox/处理原件默认不删除（§一百零七）。 */
  async acceptCurrentCandidate(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile)) { new Notice("当前没有打开的笔记。"); return; }
    const md = await this.app.vault.cachedRead(f);
    const cand = parseCandidateFrontmatter(md);
    if (!cand) { new Notice("当前笔记不是知识候选（type: knowledge-candidate）。请先对被捕获笔记执行「处理当前捕获」。"); return; }
    const body = captureBody(md);
    const heading = body.match(/^#\s+(.+)$/m);
    const title = heading ? heading[1].trim() : f.basename;
    const area = cand.area;
    await this.ensureVaultFolder(this.settings.capture.knowledgeFolder);
    const kPath = captureFilePath(this.settings.capture.knowledgeFolder, captureDate(), title);
    if (this.app.vault.getAbstractFileByPath(kPath)) {
      new Notice("Knowledge 中已存在同名笔记：" + kPath + "。请先打开它补充「我的理解」，或改名。"); return;
    }
    const knowledgeMd = buildKnowledgeMarkdown({
      title,
      origin: cand.origin ?? "derived",
      sourcePaths: cand.sourceNote ? [cand.sourceNote] : [f.basename],
      area,
    });
    await this.app.vault.create(kPath, knowledgeMd);
    // §一百零七：默认不删除 Inbox 原件 —— 只把 Processing 候选标记 accepted（provenance 链保留）
    await this.app.vault.modify(f, setFrontmatterStatus(md, "accepted"));
    new Notice("已提炼为知识：" + kPath + "（来源链保留；你可以在 Knowledge 笔记中继续写「我的理解」）。");
    await this.refreshCaptureSummary();
  }

  /** §一百零六/一百零七：归档当前捕获/候选（Archive 优先于 Delete；provenance 保留；不自动删原件） */
  async archiveCurrentCapture(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile)) { new Notice("当前没有打开的笔记。"); return; }
    if (!this.isCapturePath(f.path)) { new Notice("当前笔记不在 Capture 体系内（Inbox/Processing/Knowledge/Archive）。"); return; }
    const md = await this.app.vault.cachedRead(f);
    
    const dest = captureFilePath(this.settings.capture.archiveFolder, captureDate(), f.basename);
    let target = dest;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(target)) {
      target = dest.replace(/\.md$/, "-" + n + ".md"); n++;
    }
    await this.app.vault.rename(f, target);
    const moved = this.app.vault.getAbstractFileByPath(target);
    if (moved instanceof TFile) {
      const movedMd = await this.app.vault.cachedRead(moved);
      await this.app.vault.modify(moved, setFrontmatterStatus(movedMd, "archived"));
    }
    new Notice("已归档（保留来源/provenance，未删除）：" + target + "；可在 Archive 中继续补充。");
    await this.refreshCaptureSummary();
  }

  /** §六十八/一百一十一：打开 Capture 目录（Inbox/候选/知识/归档） */
  async openCaptureFolder(folder: string): Promise<void> {
    await this.ensureVaultFolder(folder);
    const prefix = folder.replace(/[\\/]+$/, "").toLowerCase() + "/";
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.toLowerCase().startsWith(prefix));
    if (files.length === 0) { new Notice("目录为空：" + folder + "。"); return; }
    await this.app.workspace.getLeaf(false).openFile(files[0]);
  }
  viewRecent(): void {
    const list = this.activity.recent(this.settings.activity.recentLimit);
    if (list.length === 0) { new Notice("还没有打开记录。"); return; }
    const now = Date.now();
    const lines = list.map(({ path, entry }) => {
      const times = entry.accessCount ?? 0;
      const mins = Math.floor((now - (entry.lastAccessedAt ?? 0)) / 60000);
      const when = mins < 1 ? "刚刚" : mins < 60 ? mins + " 分钟前" : Math.floor(mins / 60) < 24 ? Math.floor(mins / 60) + " 小时前" : Math.floor(mins / 1440) + " 天前";
      return (path.split("/").pop() ?? path).replace(/.md$/, "") + "（" + when + "，" + times + " 次访问）";
    });
    new Notice(lines.join(String.fromCharCode(10)), 10000);
  }

  /** §16：查看可能正在被遗忘的知识——本地规则候选，UI 文案一律“可能正在被遗忘” */
  viewForgotten(): void {
    const now = Date.now();
    const list = forgottenCandidates(this.index.all(), (p) => this.activity.get(p), this.settings.activity, now).slice(0, 8);
    if (list.length === 0) { new Notice("暂无“可能正在被遗忘”的知识。"); return; }
    const lines = list.map((n) => {
      const days = Math.max(1, Math.round((now - n.modified) / 86400000));
      return n.title + "（" + days + " 天未修改 · 关联 " + (n.links.length + n.backlinks.length) + " 篇）";
    });
    new Notice(lines.join(String.fromCharCode(10)), 10000);
  }

  /** ---------- Phase 8：Review Center / 主动复习闭环 ---------- */

  basename(p: string): string {
    return (p.split("/").pop() ?? p).replace(/\.md$/i, "");
  }

  /** 确保今日队列存在（§十/四十二/六十四）：同 periodKey 幂等复用；删除的笔记安全移除（Test 18）；
   *  force=true 重建时排除「稍后再看」未到期笔记（§三十）。纯本地计算，绝不调用 AI（§六十四/七十一）。 */
  ensureReviewQueue(force = false): ReviewQueue | null {
    const key = dailyPeriodKey();
    const store = this.reviewCenter;
    const notes = this.index.all();
    const existingPaths = new Set(notes.map((n) => n.path));
    let base = store.getQueue();
    if (base && base.periodKey === key) base = pruneQueue(base, existingPaths);
    else base = null;
    const now = Date.now();
    if (!force && base && base.items.length >= 0) return base;
    if (force) this.reviewQuestionMemo = null;   // 重建 → 旧问题缓存失效（同周期内重新提问）
    const eligible = notes.filter((n) => {
      const e = base?.items.find((i) => i.path === n.path);
      return !(e?.snoozedUntil && e.snoozedUntil > now);
    });
    const q = buildReviewQueue(
      eligible,
      (p) => this.activity.get(p),
      this.settings.knowledgeAreas,
      this.settings.reviewCenter,
      this.settings.activity,
      store.getSkipHistory(),
      now
    );
    store.setQueue(q);
    return q;
  }

  /** 恢复下标（§三十八/三十九/四十）：同 queueKey 复用 active session；否则从 0 开始 */
  reviewResumeIndex(q: ReviewQueue): number {
    return safeResumeIndex(this.reviewCenter.getSession(), q);
  }

  reviewPrevIndex(q: ReviewQueue, from: number): number | null {
    for (let i = from - 1; i >= 0; i--) {
      if (q.items[i].status === "pending" || q.items[i].status === "reviewing") return i;
    }
    return null;
  }

  reviewNextIndex(q: ReviewQueue, from: number): number | null {
    for (let i = from + 1; i < q.items.length; i++) {
      if (q.items[i].status === "pending" || q.items[i].status === "reviewing") return i;
    }
    return null;
  }

  /** ✓ 已复习（§二十六/五十八/七十）：唯一更新 Activity 的行为；历史 snapshot 保持历史（§四十五） */
  /** §二十八~三十：连点防抖——300ms 内只允许一个 Review 动作生效（进度/写盘只推进一次） */
  private reviewActionGuard(): boolean {
    const now = Date.now();
    if (this.reviewActionUntil > now) return false;
    this.reviewActionUntil = now + 300;
    return true;
  }

  completeReviewItem(path: string): void {
    if (!this.reviewActionGuard()) return;
    const q = this.reviewCenter.getQueue();
    if (!q) return;
    this.activity.recordAccess(path);   // 用户在复习中打开笔记 → 访问记录（§六十八：file-open 语义）
    this.activity.markReviewed(path);   // 唯一写 lastReviewedAt 的入口（§三/七十）
    this.reviewCenter.resetSkip(path);  // 真正完成复习 → 清除连续跳过（§三十二：不永久排除）
    const updated = markCompleted(q, path);
    this.reviewCenter.setQueue(updated);
    this.advanceReviewSession(updated);
    this.rerenderDashboard();
  }

  /** 跳过（§二十九）：status=skipped；绝不更新 lastReviewedAt/reviewCount（§二十九）；连续跳过登记（§三十二） */
  skipReviewItem(path: string): void {
    if (!this.reviewActionGuard()) return;
    const q = this.reviewCenter.getQueue();
    if (!q) return;
    const updated = markSkipped(q, path);
    this.reviewCenter.setQueue(updated);
    this.reviewCenter.recordSkip(path);
    this.advanceReviewSession(updated);
    this.rerenderDashboard();
  }

  /** 稍后再看（§三十/三十一）：snoozedUntil 只进队列，绝不更新 Activity（Test 9） */
  snoozeReviewItem(path: string, days: number): void {
    if (!this.reviewActionGuard()) return;
    const q = this.reviewCenter.getQueue();
    if (!q) return;
    const until = Date.now() + Math.max(1, Math.floor(days)) * 86400000;
    const updated = markSnoozed(q, path, until);
    this.reviewCenter.setQueue(updated);
    this.reviewCenter.recordSkip(path);
    this.advanceReviewSession(updated);
    this.rerenderDashboard();
  }

  /** 保存 session 指针（§三十九）：完成则清除（进入完成页后无需恢复）；只存指针不存 AI/全文（§七十四） */
  private advanceReviewSession(q: ReviewQueue): void {
    if (sessionFinished(q)) { this.reviewCenter.setSession(null); return; }
    const next = nextActiveIndex(q, 0);
    this.reviewCenter.setSession({
      periodKey: q.periodKey,
      currentIndex: next === null ? 0 : next,
      queueKey: q.periodKey,
      updatedAt: Date.now(),
    });
  }

  /** AI 复习问题（§十七~二十五）：本周期只请求一次（§五十六）；失败/关闭 → 空 Map，Session 用系统 fallback（§二十五） */
  async reviewQuestions(q: ReviewQueue): Promise<Map<string, ReviewQuestion>> {
    if (!this.settings.reviewCenter.aiQuestion) return new Map();
    if (this.reviewQuestionMemo && this.reviewQuestionMemo.key === q.periodKey) return this.reviewQuestionMemo.map;
    const notes = q.items
      .map((i) => this.index.all().find((n) => n.path === i.path))
      .filter((x): x is NoteMetadata => !!x);
    const lines = await this.index.candidatePayload(notes, 400);   // §十九：只读当前待复习笔记
    const paths = q.items.map((i) => i.path);
    const areaLines = this.reviews.areaLines();
    const prep = {
      candidateLines: lines,
      candidatePaths: paths,
      areaLines,
      dateLabel: "今日复习",
      candidateSig: candidateSig(notes.map((n) => ({ path: n.path, modified: n.modified, size: n.size }))),
      areaSig: areaSig(areaLines),
      periodKey: "review:" + q.periodKey,
      reviewQuestionMax: this.settings.reviewCenter.maxQuestions,
    };
    const outcome = await this.ai.generateReviewQuestions(prep, false);
    const map = new Map<string, ReviewQuestion>();
    if (outcome.ok) for (const qq of outcome.data) if (!map.has(qq.path)) map.set(qq.path, qq);
    this.reviewQuestionMemo = { key: q.periodKey, map };
    return map;
  }

  reviewAreaOf(path: string): string | undefined {
    const areas = this.settings.knowledgeAreas;
    for (const a of areas) {
      if (!a.folder) continue;
      if (path === a.folder + ".md" || path.startsWith(a.folder + "/")) return a.name;
    }
    const n = this.index.all().find((x) => x.path === path);
    if (n) {
      for (const a of areas) if (a.folder === n.folder) return a.name;
    }
    return undefined;
  }

  /** 完成页接触区域（§六十）：只统计真正「已复习」完成的条目 */
  reviewContactAreas(q: ReviewQueue): string[] {
    const areas: string[] = [];
    for (const it of q.items) {
      if (it.status !== "completed") continue;
      const a = this.reviewAreaOf(it.path);
      if (a && !areas.includes(a)) areas.push(a);
    }
    return areas;
  }

  /** 打开今日复习窗口（§十五/四十）：已有同类型 leaf 直接恢复；否则右侧新建 */
  async openReviewSession(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_REVIEW);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      (leaves[0].view as ReviewSessionView).refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) { new Notice("无法创建复习窗口。"); return; }
    await leaf.setViewState({ type: VIEW_TYPE_REVIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /** 行为数据随索引清理：删除/改名/重建后，移除已不存在笔记的活动条目，保持 O(note count) */
  private pruneActivity(): void {
    const existing = new Set(this.index.all().map((n) => n.path));
    this.activity.prune(existing);
    this.reviewCenter.prunePaths(existing);
    this.discovery.prune(existing);
  }

  /** Phase 7：从 AI Cache（connections）读取真实 AI edges（§21 跨区域连接证据之一） */
  private aiEdges(): { from: string; to: string }[] {
    const out: { from: string; to: string }[] = [];
    for (const entry of this.cache.byType("connections")) {
      if (entry.status !== "success" || !entry.data) continue;
      const data = entry.data as unknown as { edges?: { from?: string; to?: string }[] };
      for (const e of data.edges ?? []) {
        if (typeof e.from === "string" && typeof e.to === "string") out.push({ from: e.from, to: e.to });
      }
    }
    return out;
  }

  /** Phase 7：本周期出现的问题（§二十五；数据源=当日知识奇想的问题，跨周期归并识别重复） */
  private currentQuestions(): string[] {
    const q: string[] = [];
    const c = this.settings.lastCuriosity;
    if (c && c.insight && typeof c.insight.question === "string") {
      const t = c.insight.question.trim();
      if (t) q.push(t);
    }
    return q;
  }

  /** Phase 7：本地周快照（§五/六/九/十）：轻量聚合、幂等 upsert、绝不调用 AI */
  updateWeeklySnapshot(): void {
    if (!this.settings.evolution.enabled) return;
    const questions = this.currentQuestions();
    this.evolution.setKeepWeeks(this.settings.evolution.keepWeeks);
    const snap = computeSnapshot({
      notes: this.index.all(),
      areas: this.settings.knowledgeAreas,
      getAct: (p) => this.activity.get(p),
      rules: this.settings.activity,
      aiEdges: this.aiEdges(),
      questions,
      periodLabel: monthlyPeriodLabel(),
      prev: this.evolution.latest(1)[0] ?? null,
      confirmedRelationships: this.relationships.confirmed(),
    });
    this.evolution.upsertSnapshot(snap);
    this.evolution.addQuestions(questions.map((question) => ({ periodLabel: monthlyPeriodLabel(), question })));
  }

  /** Phase 7：组装给长期 AI 的聚合输入（§三十三：绝不发全部 snapshot；只发聚合摘要 + top 数据） */
  private evolutionAIOpts(mode: "monthly" | "quarterly"): { input: EvolutionPromptInput; opts: AICallOpts } | null {
    const snaps = this.evolution.latest(12);
    if (snaps.length === 0) return null;
    const now = Date.now();
    const areas = this.settings.knowledgeAreas.filter((a) => a.folder && a.folder.trim() !== "");
    const edges = this.aiEdges();
    const bridges = findBridgeNotes(this.index.all(), areas, edges);
    const questions = this.evolution.persistentQuestions().filter((q) => q.occurrences >= 2);
    const summaryLines = buildEvolutionSummary(snaps, bridges, questions, now).split("\n");
    const latest = snaps[snaps.length - 1];
    const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : undefined;
    const sorted = [...latest.areaStats].sort((a, b) => growthScore(b, now) - growthScore(a, now));
    const topAreas = sorted.slice(0, 6).map((s) => {
      const p = prev?.areaStats.find((x) => x.area === s.area);
      return s.area + "（" + s.noteCount + " 篇，活跃度" + (p ? trendArrow(s, p) : "→") + "）";
    });
    const topBridges = bridges.slice(0, 4).map((b) => "《" + b.title + "》连接：" + b.areas.join(" / "));
    const topConnections = latest.crossAreaLinks.slice(0, 5).map((l) => l.a + " ↔ " + l.b + "（" + l.count + " 条真实证据）");
    const sampleNoteTitles: string[] = [];
    for (const b of bridges.slice(0, 2)) sampleNoteTitles.push(b.title);
    if (sampleNoteTitles.length < 3) {
      const topLinked = [...this.index.all()]
        .sort((a, b) => (b.links.length + b.backlinks.length) - (a.links.length + a.backlinks.length))
        .slice(0, 4 - sampleNoteTitles.length);
      for (const n of topLinked) if (!sampleNoteTitles.includes(n.title)) sampleNoteTitles.push(n.title);
    }
    const periodLabel = mode === "monthly" ? monthlyPeriodLabel() : quarterlyPeriodLabel();
    const input: EvolutionPromptInput = {
      periodLabel,
      summaryLines,
      topAreas,
      topBridges,
      recurringQuestions: questions.slice(0, 5).map((q) => q.text),
      topConnections,
      sampleNoteTitles,
      isQuarterly: mode === "quarterly",
    };
    const opts: AICallOpts = {
      candidateLines: summaryLines,
      candidatePaths: [],
      areaLines: this.settings.knowledgeAreas.map((a) => a.icon + " " + a.name + "（文件夹：" + a.folder + "）"),
      dateLabel: periodLabel,
      candidateSig: fingerprintKey(["evolution", summaryLines.join("\n"), periodLabel]),
      areaSig: areaSig(this.settings.knowledgeAreas.map((a) => a.name)),
      periodKey: periodKeyFor(mode === "monthly" ? "monthly" : "quarterly"),
    };
    return { input, opts };
  }

  /** Phase 7：月度/季度长期演化（§五十/五十四）：同周期默认复用 AI Cache；force 才重新生成；失败只置错误标志 */
  async runMonthlyEvolution(force = false): Promise<void> { await this.runEvolution("monthly", force); }
  async runQuarterlyEvolution(force = false): Promise<void> { await this.runEvolution("quarterly", force); }
  private async runEvolution(mode: "monthly" | "quarterly", force: boolean): Promise<void> {
    if (!this.settings.evolution.enabled) { new Notice("知识演化未启用（设置 → 知识演化）。"); return; }
    const prep = this.evolutionAIOpts(mode);
    if (!prep) { this.evolutionError = "还没有本地周快照——先运行一次周复盘或手动生成本周快照。"; this.rerenderDashboard(); return; }
    const outcome = mode === "monthly"
      ? await this.ai.generateMonthlyEvolution({ ...prep.opts, ...prep.input }, force)
      : await this.ai.generateQuarterlyEvolution({ ...prep.opts, ...prep.input }, force);
    if (outcome.ok) {
      if (mode === "monthly") this.settings.lastMonthlyEvolution = outcome.data;
      else this.settings.lastQuarterlyEvolution = outcome.data;
      this.evolutionError = null;
      await this.saveSettings();
      await this.writeEvolutionMarkdown(mode, outcome.data);
      const label = mode === "monthly" ? "月度知识演化" : "季度知识演化";
      new Notice((outcome.fromCache ? "（复用缓存）" : "") + label + "已生成：" + outcome.data.headline);
    } else {
      this.evolutionError = outcome.error.message;
      new Notice("AI 暂时无法连接：" + outcome.error.message + "（本地快照与统计不受影响）");
    }
    this.rerenderDashboard();
  }

  /** Phase 7：长期演化写入 Reviews Markdown（§三十五/四十/四十一）：只新建/更新 Review，绝不修改原始笔记 */
  private async writeEvolutionMarkdown(mode: "monthly" | "quarterly", d: LongTermReflectionData): Promise<void> {
    const root = "Knowledge Garden/Reviews";
    const sub = mode === "monthly" ? "Monthly" : "Quarterly";
    const fileName = d.period + (mode === "monthly" ? " 月度知识演化.md" : " 季度知识演化.md");
    const full = normalizePath(root + "/" + sub + "/" + fileName);
    await this.ensureVaultFolder(root + "/" + sub);
    const fm = ["---", "type: evolution", "period: " + mode, "periodKey: " + d.period, "---", ""].join("\n");
    const body = fm + this.evolutionMarkdownBody(mode, d) + "\n";
    const existing = this.app.vault.getAbstractFileByPath(full);
    if (existing instanceof TFile) await this.app.vault.modify(existing, body);
    else await this.app.vault.create(full, body);
  }

  /** 真实笔记标题 → [[wikilink]]；不存在的标题保持原文（不编造链接，§四十） */
  private linkifyTitle(text: string): string {
    return text.replace(/《([^》]+)》/g, (_all, t: string) => {
      const m = this.index.all().find((n) => n.title === t);
      return m ? "[[" + m.title + "]]" : "《" + t + "》";
    });
  }

  /** Phase 7：演化 Markdown 正文（§四十/四十一 结构；AI 观察文案，不宣称绝对事实） */
  private evolutionMarkdownBody(mode: "monthly" | "quarterly", d: LongTermReflectionData): string {
    const li = (arr: string[]): string[] => (arr.length === 0 ? ["- （暂无足够数据）"] : arr.map((s) => "- " + s));
    const foot = [
      "",
      "---",
      "",
      "> 以上为 AI 基于本地聚合统计的观察（§六十八）：「AI 观察到……/可能正在形成……/值得进一步探索……」，不是对你的绝对断言。",
      "> 本地确定性统计存在 cache/evolution.json（最多保留最近 52 个周快照）；原始笔记与 Reviews 复盘不受影响（§四十二/四十三）。",
    ];
    if (mode === "monthly") {
      return [
        "# " + d.period + " 知识演化",
        "",
        "## 一句话观察",
        "",
        d.headline,
        "",
        "## 正在增长",
        ...li(d.emergingAreas.map((s) => this.linkifyTitle(s))),
        "",
        "## 持续主题",
        ...li([...d.sustainedAreas, ...d.themes].map((s) => this.linkifyTitle(s))),
        "",
        "## 跨领域连接",
        ...li(d.bridges.map((s) => this.linkifyTitle(s))),
        "",
        "## 反复出现的问题",
        ...li(d.recurringQuestions),
        "",
        "## 可能的知识空白",
        ...li(d.knowledgeGaps),
        "",
        "## 下一阶段值得探索",
        ...li(d.nextExplorations.map((s) => this.linkifyTitle(s))),
        ...foot,
      ].join("\n");
    }
    return [
      "# " + d.period + " 知识演化",
      "",
      "## 这一季度发生了什么",
      "",
      d.headline,
      "",
      "## 长期增长领域",
      ...li([...d.sustainedAreas, ...d.emergingAreas].map((s) => this.linkifyTitle(s))),
      "",
      "## 兴趣迁移",
      ...li([...d.themes, ...d.fadingAreas.map((s) => "（逐渐消退）" + s)].map((s) => this.linkifyTitle(s))),
      "",
      "## 核心知识候选",
      ...li(d.sustainedAreas.map((s) => this.linkifyTitle(s))),
      "",
      "## 桥梁知识",
      ...li(d.bridges.map((s) => this.linkifyTitle(s))),
      "",
      "## 长期问题",
      ...li(d.recurringQuestions),
      "",
      "## 被遗忘但值得恢复的知识",
      ...li(d.fadingAreas.map((s) => this.linkifyTitle(s))),
      "",
      "## 下一季度探索方向",
      ...li(d.nextExplorations.map((s) => this.linkifyTitle(s))),
      ...foot,
    ].join("\n");
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? cur + "/" + part : part;
      if (this.app.vault.getAbstractFileByPath(cur)) continue;
      try { await this.app.vault.createFolder(cur); } catch { /* 并发已创建等场景忽略 */ }
    }
  }

  rerenderDashboard(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_KG)) {
      (leaf.view as unknown as { scheduleRender(): void }).scheduleRender();
    }
  }


  /* ================= Phase 14：Note Exam / Review Cards（§二百四十一 完成条件） ================= */

  /** 笔记正文内容指纹（Phase 14 §四十一：长度 + 前 2000 字符参与 sourceVersion） */
  private examContentHash(src: string): string {
    return fingerprintKey(["content", String(src.length), src.slice(0, 2000)]);
  }

  /** 从笔记正文提取 http(s) URL 抓取网页上下文（§一百零三 web_allowed + webEnabled 时；失败降级为空） */
  private async collectWebContextForExam(src: string): Promise<string[]> {
    try {
      const urls = [...(src ?? "").matchAll(/https?:\/\/[^\s"'<>()]+/g)]
        .map((m) => m[0])
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, 5);
      if (!urls.length) return [];
      const res = await collectWebContext(urls);
      return res.pages.map((pg) => "### " + pg.url + "\n" + pg.text);
    } catch {
      return [];
    }
  }
  /** 打开「构建知识考试」Modal（右键/命令入口，§七） */
  openExamBuilder(file: TFile): void {
    new ExamBuildModal(this, file, (p) => { void this.buildExamForNote(file, p); }).open();
  }

  /** 以当前活跃笔记打开构建 Modal（命令入口） */
  openExamBuilderForActive(): void {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile)) { new Notice("当前没有打开的笔记。"); return; }
    this.openExamBuilder(f);
  }

  /** 生成考试（§一百一十四：force=true 重新生成；AI 失败保留旧 Exam §五十一） */
  async buildExamForNote(file: TFile, p: ExamBuildParams): Promise<void> {
    if (!file) { new Notice("没有可考试的笔记。"); return; }
    try { await this.ensureVaultFolder(examDirPath()); } catch { /* ignore */ }
    const src = await this.app.vault.cachedRead(file);
    const sourceVersion = fingerprintKey(["note", file.path, String(src.length), this.examContentHash(src)]);
    const webContextLines: string[] = [];
    if (p.answerMode === "web_allowed" && p.webEnabled) {
      const wc = await this.collectWebContextForExam(src);
      webContextLines.push(...wc);
    }
    const skill = this.examSkillInstructions();
    const ctxHash = fingerprintKey([file.path, sourceVersion, JSON.stringify({ topic: p.topic ?? "", count: p.questionCount, difficulty: p.difficulty ?? "medium", answerMode: p.answerMode, web: p.webEnabled })]);
    const wsFp = workspaceFingerprint(this.currentWorkspace());
    const skillFp = fingerprintKey(["skill", skill ?? "none"]);
    const out = await this.ai.generateExam({
      sourcePath: file.path,
      sourceVersion,
      noteTitle: file.basename,
      noteText: src.slice(0, 24000),
      mode: p.mode,
      topic: p.topic,
      questionCount: p.questionCount,
      difficulty: p.difficulty,
      answerMode: p.answerMode,
      webEnabled: p.webEnabled,
      webContextLines,
      skillInstructions: skill ?? undefined,
      workspaceFingerprint: wsFp,
      skillFingerprint: skillFp,
      contextHash: ctxHash,
    }, p.force ?? false);
    if (!out.ok) {
      this.examError = out.error?.message ?? "考试生成失败";
      const old = this.examStore.findBySource(file.path);
      if (old.length) {
        new Notice("AI 生成失败，保留已有考试（" + this.examError + "）。");
        this.lastExamId = old[0].id;
        await this.openExamSession(old[0].id);
        return;
      }
      new Notice("AI 生成失败：" + this.examError + "。可去 设置→AI 检查 Key/网络后重试。");
      return;
    }
    const questions = filterValidExamQuestions(out.data.questions, p.questionCount);
    if (!questions.length) {
      this.examError = "AI 返回的题目全部无效";
      new Notice("考试生成失败：" + this.examError + "。");
      return;
    }
    const fp = examFingerprint({ sourcePath: file.path, sourceVersion, mode: p.mode, topic: p.topic, questionCount: p.questionCount, difficulty: p.difficulty, answerMode: p.answerMode });
    let exam = this.examStore.findByFingerprint(fp);
    if (exam && !p.force) {
      new Notice("已有同参数考试（0 AI），直接打开。");
      this.lastExamId = exam.id;
      await this.openExamSession(exam.id);
      return;
    }
    if (exam && p.force) {
      this.examStore.update(exam.id, { questions, coverageTopics: out.data.coverageTopics, examVersion: (exam.examVersion ?? 1) + 1, updatedAt: Date.now() });
      const updated = this.examStore.get(exam.id)!;
      await this.writeExamMarkdown(updated);
      this.lastExamId = updated.id;
      await this.openExamSession(updated.id);
      return;
    }
    const now = Date.now();
    const newexam: NoteExam = {
      id: newExamId(),
      sourcePath: file.path,
      sourceVersion,
      title: (out.data.title || file.basename + " 知识考试").trim().slice(0, 80),
      mode: p.mode,
      topic: p.topic,
      questionCount: p.questionCount,
      difficulty: p.difficulty,
      answerMode: p.answerMode,
      questions,
      examVersion: 1,
      coverageTopics: out.data.coverageTopics,
      createdAt: now,
      updatedAt: now,
    };
    this.examStore.add(newexam);
    await this.writeExamMarkdown(newexam);
    this.lastExamId = newexam.id;
    this.examError = null;
    this.rerenderDashboard();
    new Notice("考试已生成：" + newexam.title + "（" + questions.length + " 题）。");
    await this.openExamSession(newexam.id);
  }

  /** 写入 Exam Markdown（§一百一十八；0 AI 的恢复源） */
  async writeExamMarkdown(e: NoteExam): Promise<void> {
    try {
      await this.ensureVaultFolder(examDirPath());
      const body = examMarkdown(e) + "\n";
      const p = examMarkdownPath(e);
      const existing = this.app.vault.getAbstractFileByPath(normalizePath(p));
      if (existing instanceof TFile) await this.app.vault.modify(existing, body);
      else await this.app.vault.create(p, body);
    } catch (err) {
      new Notice("写入考试 Markdown 失败：" + String((err as Error)?.message ?? err));
    }
  }

  /** 打开最近一次考试/当前笔记考试（命令入口） */
  async openExamForActive(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (f instanceof TFile) {
      const list = this.examStore.findBySource(f.path);
      if (list.length) { this.lastExamId = list[0].id; await this.openExamSession(list[0].id); return; }
      new Notice("这篇笔记还没有考试。右键 → 📝 构建知识考试。");
      return;
    }
    if (this.lastExamId) { await this.openExamSession(this.lastExamId); return; }
    const recent = this.examStore.all();
    if (recent.length) { this.lastExamId = recent[0].id; await this.openExamSession(recent[0].id); return; }
    new Notice("还没有生成过考试。");
  }

  /** 打开考试会话视图（若已有 running/completed 会话则恢复 §一百八十八；否则新建 Card 模式会话 §七十二） */
  async openExamSession(examId: string, force = false): Promise<void> {
    const exam = this.examStore.get(examId);
    if (!exam) { new Notice("考试不存在（收藏卡不受影响）。"); return; }
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_EXAM);
    let st = this.examSessions.get(examId);
    if (!st || force) {
      st = {
        examId,
        mode: this.settings.exam.cardMode !== false ? "card" : "exam",
        currentIndex: 0,
        answers: [],
        status: "running",
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.examSessions.upsert(st);
    }
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      (leaves[0].view as ExamSessionView).refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) { new Notice("无法创建考试窗口。"); return; }
    await leaf.setViewState({ type: VIEW_TYPE_EXAM, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 重新生成考试（§一百一十四/二百五十七：force=true，跳过缓存） */
  /** Phase 14 §一百七十：重新生成当前笔记考试（跳过 AI 缓存；无考试则打开构建器；不修改访问数据） */
  async regenerateExamForActive(): Promise<void> {
    const f = this.app.workspace.getActiveFile();
    if (!(f instanceof TFile)) { new Notice("请先打开一篇笔记。"); return; }
    const list = this.examStore.findBySource(f.path);
    if (!list.length) { this.openExamBuilderForActive(); return; }
    await this.regenerateExam(list[0].id);
  }
  async regenerateExam(examId: string): Promise<void> {
    const e = this.examStore.get(examId);
    if (!e) { new Notice("考试不存在。"); return; }
    const f = this.app.vault.getAbstractFileByPath(normalizePath(e.sourcePath));
    if (!(f instanceof TFile)) { new Notice("原笔记不存在，无法重新生成。"); return; }
    await this.buildExamForNote(f, {
      mode: e.mode, topic: e.topic, questionCount: e.questionCount, difficulty: e.difficulty ?? "medium",
      answerMode: e.answerMode, webEnabled: e.answerMode === "web_allowed", cardMode: this.settings.exam.cardMode !== false,
      force: true,
    });
  }

  /** 用户作答开放/选择/判断题（§一百八十六：答案保存在本地 Session，不进 AI Cache §一百九十一） */
  answerExamQuestion(examId: string, questionId: string, answer: string): void {
    const st = this.examSessions.get(examId);
    if (!st) return;
    const idx = st.answers.findIndex((a) => a.questionId === questionId);
    const rec = idx >= 0 ? st.answers[idx] : { questionId, answeredAt: Date.now() };
    rec.answer = answer;
    rec.answeredAt = Date.now();
    rec.skipped = false;
    if (idx >= 0) st.answers[idx] = rec; else st.answers.push(rec);
    st.updatedAt = Date.now();
    this.examSessions.upsert(st);
  }

  /** 自评（§五十七/一百八十二：😵😕🙂😎；选择后才允许下一题 §一百八十三） */
  selfRateExamQuestion(examId: string, questionId: string, rating: MasteryRating): void {
    const st = this.examSessions.get(examId);
    if (!st) return;
    const idx = st.answers.findIndex((a) => a.questionId === questionId);
    const rec = idx >= 0 ? st.answers[idx] : { questionId, answeredAt: Date.now() };
    rec.selfRating = rating;
    rec.answeredAt = Date.now();
    if (idx >= 0) st.answers[idx] = rec; else st.answers.push(rec);
    st.updatedAt = Date.now();
    this.examSessions.upsert(st);
  }

  /** 跳过（§一百八十四/一百八十五：记为 skipped，不自动评分） */
  skipExamQuestion(examId: string, questionId: string): void {
    const st = this.examSessions.get(examId);
    if (!st) return;
    const idx = st.answers.findIndex((a) => a.questionId === questionId);
    const rec = idx >= 0 ? st.answers[idx] : { questionId, skipped: true, answeredAt: Date.now() };
    rec.skipped = true;
    rec.answeredAt = Date.now();
    if (idx >= 0) st.answers[idx] = rec; else st.answers.push(rec);
    st.updatedAt = Date.now();
    this.examSessions.upsert(st);
  }

  /** 按需 AI 评分（§二百二十七/二百二十八：默认不自动触发；评分进 exam_grading cache §一百零八） */
  async gradeExamQuestion(examId: string, questionId: string): Promise<{ aiScore?: number; aiAssessment?: string } | null> {
    const e = this.examStore.get(examId);
    const st = this.examSessions.get(examId);
    if (!e || !st) return null;
    const q = e.questions.find((x) => x.id === questionId);
    const a = st.answers.find((x) => x.questionId === questionId);
    if (!q || !a || typeof a.answer !== "string") return null;
    const out = await this.ai.gradeExamAnswer({
      examId, questionId,
      question: q.question,
      referenceAnswer: q.referenceAnswer,
      sourceEvidence: q.sourceEvidence,
      userAnswer: a.answer.slice(0, 4000),
      hasWeb: (q as { webSources?: unknown[] }).webSources?.length ? true : false,
    });
    if (!out.ok) { new Notice("AI 评分失败：" + (out.error?.message ?? "未知")); return null; }
    const g = out.data;
    a.aiScore = Math.max(1, Math.min(5, Math.round(g.score)));
    a.aiAssessment = [
      "AI 评估：" + g.correctness + "（" + g.score + "/5）",
      ...(g.strengths.length ? ["答对：" + g.strengths.join("；")] : []),
      ...(g.missing.length ? ["遗漏：" + g.missing.join("；")] : []),
      ...(g.misconceptions.length ? ["误解：" + g.misconceptions.join("；")] : []),
    ].join("\n");
    a.gradedAt = Date.now();
    st.updatedAt = Date.now();
    this.examSessions.upsert(st);
    this.rerenderExamSession();
    return { aiScore: a.aiScore, aiAssessment: a.aiAssessment };
  }

  /** 下一题 index（§一百八十三：自评后推进；完成返回 null） */
  examNextIndex(examId: string): number | null {
    const e = this.examStore.get(examId);
    const st = this.examSessions.get(examId);
    if (!e || !st) return null;
    const total = e.questions.length;
    if (examSessionFinished(st, total)) return null;
    const next = st.currentIndex + 1;
    return next < total ? next : null;
  }

  /** 推进会话到指定 index（§一百八十八） */
  advanceExamSession(examId: string, next: number): void {
    const st = this.examSessions.get(examId);
    if (!st) return;
    st.currentIndex = next;
    st.updatedAt = Date.now();
    this.examSessions.upsert(st);
    this.rerenderExamSession();
  }

  /** 考试模式：全部完成后统一揭示答案并完成（§一百八十一） */
  completeExamAll(examId: string): void {
    const e = this.examStore.get(examId);
    const st = this.examSessions.get(examId);
    if (!e || !st) return;
    const answered = st.answers.filter((a) => !a.skipped && (typeof a.answer === "string" || a.selfRating));
    for (const q of e.questions) {
      if (!st.answers.some((a) => a.questionId === q.id)) {
        st.answers.push({ questionId: q.id, skipped: true, answeredAt: Date.now() });
      }
    }
    st.status = "completed";
    st.completedAt = Date.now();
    st.updatedAt = Date.now();
    this.examSessions.upsert(st);
    this.rerenderExamSession();
    new Notice("考试完成（" + answered.length + " 题作答，跳过 " + (e.questions.length - answered.length) + " 题）。结果只保存在本地；不自动调用 markReviewed（§二百零七）。");
  }

  /** 重新参加（§一百三十七/一百三十八：同一套题，新会话，0 AI） */
  retakeExamSession(examId: string): void {
    const e = this.examStore.get(examId);
    if (!e) return;
    this.examSessions.upsert({
      examId,
      mode: this.settings.exam.cardMode !== false ? "card" : "exam",
      currentIndex: 0,
      answers: [],
      status: "running",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.rerenderExamSession();
    new Notice("已开始重新参加（同一套题，新会话，0 AI）。");
  }

  /** 完成页数据：进度 / 自评掌握 / AI 评估 / 薄弱点（§六十三~六十五） */
  examSummaryData(examId: string): {
    progress: ExamProgressStats;
    self: number | null; ai: number | null; label: string;
    weak: string[]; strong: string[]; gap: string | null;
  } {
    const e = this.examStore.get(examId);
    const st = this.examSessions.get(examId);
    const empty = { progress: { total: 0, answered: 0, skipped: 0, rated: 0, graded: 0 }, self: null, ai: null, label: "-", weak: [], strong: [], gap: null };
    if (!e || !st) return empty;
    const progress = examProgress(e, st.answers);
    const self = selfMasteryPercent(st.answers);
    const ai = aiMasteryPercent(st.answers);
    return {
      progress,
      self,
      ai,
      label: self !== null ? masteryLabel(self) : "-",
      weak: weakConceptsOf(e, st.answers),
      strong: strongConceptsOf(e, st.answers),
      gap: masteryGapHint(self, ai),
    };
  }

  /** 将本次考试计为复习（§九十八/二百零七：用户显式选择才调用 activity.markReviewed；不 recordAccess §二百零七） */
  markExamAsReviewed(examId: string): void {
    const e = this.examStore.get(examId);
    if (!e) return;
    this.activity.markReviewed(e.sourcePath);
    this.rerenderDashboard();
    new Notice("已将《" + e.title + "》计为复习（只更新 lastReviewedAt/reviewCount，不记录访问）。");
  }

  /** 收藏一张卡（§一百四十七 快照：0 AI；独立于 AI Cache / Exam §七十七/七十八/七十九） */
  async saveReviewCard(input: {
    sourcePath: string; sourceVersion: string; examId?: string;
    question: string; answer: string; explanation?: string;
    questionType: ExamQuestionType; sourceEvidence?: string[]; concept?: string; tags?: string[];
  }): Promise<void> {
    const dup = this.cards.all().find((c) => c.sourcePath === input.sourcePath && c.question === input.question);
    if (dup) { new Notice("这张卡已收藏过（不重复，0 AI）。"); return; }
    try { await this.ensureVaultFolder(cardsDirPath()); } catch { /* ignore */ }
    const now = Date.now();
    const card: SavedReviewCard = {
      id: newCardId(),
      sourcePath: input.sourcePath,
      sourceVersion: input.sourceVersion,
      examId: input.examId,
      question: input.question.trim().slice(0, 240),
      answer: input.answer.trim().slice(0, 3000),
      explanation: input.explanation?.trim().slice(0, 1200),
      questionType: input.questionType,
      sourceEvidence: input.sourceEvidence,
      concept: input.concept,
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
    };
    this.cards.add(card);
    try {
      const p = cardMarkdownPath(card);
      const existing = this.app.vault.getAbstractFileByPath(normalizePath(p));
      if (existing instanceof TFile) await this.app.vault.modify(existing, cardMarkdown(card) + "\n");
      else await this.app.vault.create(p, cardMarkdown(card) + "\n");
    } catch (err) {
      new Notice("写入复习卡 Markdown 失败：" + String((err as Error)?.message ?? err));
    }
    this.rerenderDashboard();
    new Notice("已收藏复习卡（0 AI）：" + card.question.slice(0, 40) + (input.examId ? "（来自考试 " + input.examId.slice(0, 8) + "…）" : ""));
  }

  /** 收藏考试中全部题目为卡（§一百二十二/一百二十四：第一版直接收藏，用户随后在卡视图删除不需要的） */
  async saveAllCardsFromExam(examId: string): Promise<void> {
    const e = this.examStore.get(examId);
    if (!e) return;
    let saved = 0;
    for (const q of e.questions) {
      const dup = this.cards.all().find((c) => c.sourcePath === e.sourcePath && c.question === q.question);
      if (dup) continue;
      await this.saveReviewCard({
        sourcePath: e.sourcePath, sourceVersion: e.sourceVersion, examId: e.id,
        question: q.question, answer: q.referenceAnswer, explanation: q.explanation,
        questionType: q.type, sourceEvidence: q.sourceEvidence, concept: q.concept,
      });
      saved++;
    }
    new Notice("已收藏 " + saved + " 张复习卡（0 AI；可在复习卡视图删除不需要的）。");
  }

  /** 删除收藏卡（§一百一十二：0 AI；只删卡 Markdown + 索引，绝不删原笔记 §一百四十二） */
  async deleteCard(cardId: string): Promise<void> {
    const c = this.cards.get(cardId);
    if (!c) { new Notice("复习卡不存在。"); return; }
    const f = this.app.vault.getAbstractFileByPath(normalizePath(cardMarkdownPath(c)));
    if (f instanceof TFile) await this.app.vault.trash(f, true);
    this.cards.remove(cardId);
    this.rerenderDashboard();
    new Notice("已删除复习卡（0 AI）。");
  }

  /** 记录复习卡复习（§九十一/二百一十四：0 AI；不调 markReviewed §二百零七） */
  recordCardReview(cardId: string, rating: MasteryRating): void {
    const c = this.cards.get(cardId);
    if (!c) return;
    const now = Date.now();
    c.mastery = rating;
    c.reviewCount = (c.reviewCount ?? 0) + 1;
    c.lastReviewedAt = now;
    this.cards.update(c.id, { mastery: rating, reviewCount: c.reviewCount, lastReviewedAt: now });
    this.cardReviews.add({ cardId, reviewedAt: now, rating });
    this.rerenderDashboard();
    new Notice("复习卡已记录（" + rating + "，0 AI；不修改原笔记复习状态）。");
  }

  /** 打开我的复习卡 View（§八十四：搜索/来源/掌握度；首页最近 5 张 §一百三十） */
  async openCardsView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CARDS);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      (leaves[0].view as CardsView).refresh();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CARDS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Exam 会话视图刷新 */
  rerenderExamSession(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_EXAM)) {
      (leaf.view as ExamSessionView).refresh();
    }
  }

  /** 当前考试会话（视图读取） */
  getActiveExamSession(): ExamSessionState | null {
    if (!this.lastExamId) return null;
    return this.examSessions.get(this.lastExamId) ?? null;
  }

  /** Dashboard 进度文案（§一百五十） */
  getExamProgressText(exam: NoteExam, st: ExamSessionState): string {
    const p = examProgress(exam, st.answers);
    return "已答 " + p.answered + " / " + p.total + (p.skipped ? " · 跳过 " + p.skipped : "");
  }

  /** 最近 5 张收藏卡（Dashboard §八十二） */
  recentCards(limit = 5): SavedReviewCard[] {
    return this.cards.all().slice(0, limit);
  }

  /** 考试 Skill 指令（§三十六：内置指令，不额外调 AI） */
  private examSkillInstructions(): string | null {
    return "如何构建覆盖全面且能区分真正理解与机械记忆的考试：避免重复题、避免只考表面事实、增加关系/应用/边界考察、题目必须可从指定来源回答。";
  }

  /** Phase 15：打开 AI 工作台（§二百七十二；mode=ask/research/project；initialText 预填） */
  openWorkbenchView(mode?: "ask" | "research" | "project", initialText?: string): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_WORKBENCH);
    if (leaves.length) {
      this.app.workspace.revealLeaf(leaves[0]);
      this.app.workspace.setActiveLeaf(leaves[0], { focus: true });
      if (mode) (leaves[0].view as AIWorkbenchView).preset(mode, initialText ?? "");
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    void leaf.setViewState({ type: VIEW_TYPE_AI_WORKBENCH, active: true }).then(() => {
      const v = leaf.view;
      if (v instanceof AIWorkbenchView && mode) v.preset(mode, initialText ?? "");
    });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Phase 15：继续最近 AI 任务（打开工作台研究模式） */
  openWorkbenchResume(): void { this.openWorkbenchView("research"); }

  /** Phase 15：查看 AI 任务（打开工作台任务历史） */
  openWorkbenchTasks(): void { this.openWorkbenchView(); }

  /** Phase 15 §二百一十六：工具调用日志（只记 toolId/结果/时间；不记参数原文/网页正文） */
  logWorkbenchToolCall(toolId: string, ok: boolean, _summary: string): void {
    this.workbenchToolLog.push({ toolId, ok, at: Date.now() });
    if (this.workbenchToolLog.length > 200) this.workbenchToolLog.splice(0, this.workbenchToolLog.length - 200);
  }

  /** Phase 15：当前启用 Skills 摘要（ws.skills + registry enabled；只读，不调 AI） */
  selectedSkillsText(): string {
    const ws = this.currentWorkspace();
    const wsSkills = ws?.skills ?? [];
    const reg = this.settings.skillRegistry ?? [];
    const enabled = reg.filter((s) => s.enabled).map((s) => s.id);
    const ids = [...new Set([...wsSkills, ...enabled])];
    const lines = ids.map((id) => {
      const s = reg.find((r) => r.id === id) ?? BUILTIN_SKILL_SUMMARIES.find((b) => b.id === id);
      return "- " + (s?.name ?? id) + (s?.description ? "：" + s.description : "");
    });
    return lines.length ? lines.join("\n") : "（未启用 Skills）";
  }

  /** Phase 16 §46：当前启用 Skill ID 列表（Workspace skills + registry enabled；对称于 selectedSkillsText） */
  selectedSkillIds(): string[] {
    const ws = this.currentWorkspace();
    const wsSkills = ws?.skills ?? [];
    const reg = this.settings.skillRegistry ?? [];
    const enabled = reg.filter((s) => s.enabled).map((s) => s.id);
    return Array.from(new Set([...wsSkills, ...enabled]));
  }

  /** reindex：exams.json 损坏 → 从 Exams/*.md 恢复（§一百九十六/二百零四；0 AI） */
  async reindexExams(): Promise<void> {
    const dir = this.app.vault.getAbstractFileByPath(normalizePath(examDirPath()));
    if (!(dir instanceof TFolder)) { this.examStore.replaceAll([]); return; }
    const files = dir.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
    const entries: NoteExam[] = [];
    for (const f of files) {
      try {
        const md = await this.app.vault.adapter.read(f.path);
        const parsed = parseExamMarkdown(md);
        if (parsed.exam) entries.push(parsed.exam);
      } catch { /* 跳过损坏文件 */ }
    }
    this.examStore.replaceAll(entries);
    this.rerenderDashboard();
  }

  /** reindex：cards.json 损坏 → 从 Review Cards/*.md 恢复（§一百九十六；0 AI） */
  async reindexCards(): Promise<void> {
    const dir = this.app.vault.getAbstractFileByPath(normalizePath(cardsDirPath()));
    if (!(dir instanceof TFolder)) { this.cards.replaceAll([]); return; }
    const files = dir.children.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
    const entries: SavedReviewCard[] = [];
    for (const f of files) {
      try {
        const md = await this.app.vault.adapter.read(f.path);
        const parsed = parseCardMarkdown(md);
        if (parsed.card) entries.push(parsed.card);
      } catch { /* 跳过 */ }
    }
    this.cards.replaceAll(entries);
    this.rerenderDashboard();
  }

}
