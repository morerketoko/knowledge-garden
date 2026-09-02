import { ItemView, WorkspaceLeaf, TFile, TFolder, Notice, setIcon, normalizePath } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import { todayKey, isSameDay, insightTypeLabel, periodLabel, type AIInsight, type AICacheEntry, type AIConnectionResult, type KGState, type KnowledgeEvolutionSnapshot } from "./types";
import { classifyLongTerm, growthScore, trendArrow } from "./knowledgeEvolution";
import { stateCounts } from "./knowledgeState";
import { periodCn } from "./scheduler";
import { normalizeConnection, normalizeQueryResult, QUERY_NODE_PATH, selectCoreGraph, type GraphModel } from "./knowledgeGraph";
import { computeGraphLayout } from "./graphLayout";
import { GraphSvg } from "./graphSvg";
import { HeroWall } from "./dashboard/hero";
import { MusicPlayer } from "./dashboard/musicPlayer";
import { stateReason, sessionFinished } from "./reviewCenter";
import { discoveryScopeLabel } from "./discovery";
import { QUERY_MAX_LENGTH, normalizeQuery, parseQuery, queryScopePaths, rankSearchResults } from "./queryExplorer";
import type { DiscoveryScope, QueryScopeMode, SavedExplorationEdge, SavedExplorationNode, SavedExplorationSource } from "./types";
import { savedFingerprint } from "./savedExploration";

export const VIEW_TYPE_KG = "knowledge-garden-dashboard";

/** Dashboard 框架：按用户每日使用顺序布局（§25）：Hero+音乐 → 今日状态 → 知识区域 → 今日AI → 漫游 → 最近访问/遗忘（两列） → 复盘。 */
export class DashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_KG; }
  getDisplayText(): string { return this.plugin.settings.dashboardName; }
  getIcon(): string { return "flower-2"; }

  private renderTimer: number | null = null;
  /** Discovery Scope：当前设置的探索范围标签（奇想/漫游各自独立，§六/四十九） */
  private discoveryScopeOf(feature: "curiosity" | "roaming"): string {
    return discoveryScopeLabel(this.plugin.settings.discovery?.[feature]?.scope, this.plugin.settings.knowledgeAreas);
  }
  /** Phase 5：当前 SVG 图实例（Dashboard 负责创建与销毁） */
  private graph: GraphSvg | null = null;
  /** Phase 6：内容容器（onOpen 创建一次，render 只重建其内部） */
  private inner!: HTMLElement;
  private hero: HeroWall | null = null;
  private music: MusicPlayer | null = null;
  private closed = false;
  /** Query Explorer：范围下拉当前选择（仅记住用户本次选择，不持久化到设置；§六十七） */
  private queryScopeMode: QueryScopeMode = "vault";

  async onOpen(): Promise<void> {
    this.closed = false;
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.inner = this.containerEl.createDiv({ cls: "kg-inner" });
    // Hero / Music 生命周期由 Component 管理（addChild → 卸载时自动 onunload）
    if (!this.hero) {
      this.hero = new HeroWall(this.plugin, this.inner);
      this.addChild(this.hero);
    }
    if (!this.music) {
      this.music = new MusicPlayer(this.plugin, this.inner);
      this.addChild(this.music);
    }
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile && file.extension === "md") this.scheduleRender();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.scheduleRender();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) this.scheduleRender();
    }));
    this.render();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    // 显式卸载子组件（播放器保存进度并停止；Hero 不再监听 Vault）
    if (this.hero) { this.removeChild(this.hero); this.hero = null; }
    if (this.music) { this.removeChild(this.music); this.music = null; }
    if (this.graph) { this.graph.destroy(); this.graph = null; }
    this.containerEl.empty();
    return Promise.resolve();
  }

  scheduleRender(): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      if (this.closed || !this.containerEl.isConnected) return;
      this.render();
    }, 400);
  }

  render(): void {
    if (this.graph) { this.graph.destroy(); this.graph = null; }
    const inner = this.inner;
    inner.empty();
    const s = this.plugin.settings;
    inner.style.maxWidth = String(s.dashboard.contentWidth) + "px";

    // ---- 顶部工具条：仅保留刷新（Hero 已内置「⚙ 设置」/「🖼 换一张」，§14 保持简洁） ----
    const header = inner.createDiv({ cls: "kg-header" });
    const refreshBtn = header.createEl("button", { cls: "kg-btn kg-btn-icon", attr: { title: "刷新", "aria-label": "刷新 Dashboard" } });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => { void this.plugin.index.rescanAll(); this.render(); });

    // ---- 1. Hero（+ 下方音乐播放器，§25 / §15/19）----
    if (s.dashboard.showHero && this.hero) this.hero.render();
    if (s.dashboard.showMusic && this.music) this.music.render();

    // ---- 2. 今日状态（§26：大数字卡片，视觉重点；本地规则推导，AI 不参与判定） ----

    // ---- Phase 15：AI 工作台快速入口（Hero 后；§二百七十二 打开即进入，0 AI） ----
    const wbSection = inner.createDiv({ cls: "kg-section" });
    wbSection.createDiv({ cls: "kg-section-title", text: "AI 工作台" });
    const wbRow = wbSection.createDiv({ cls: "kg-row kg-gap" });
    const askBtn = wbRow.createEl("button", { cls: "kg-btn kg-btn-primary", text: "提问" });
    askBtn.addEventListener("click", () => { this.plugin.openWorkbenchView("ask"); });
    const rsBtn = wbRow.createEl("button", { cls: "kg-btn", text: "研究" });
    rsBtn.addEventListener("click", () => { this.plugin.openWorkbenchView("research"); });
    const pjBtn = wbRow.createEl("button", { cls: "kg-btn", text: "项目" });
    pjBtn.addEventListener("click", () => { this.plugin.openWorkbenchView("project"); });
    const resumeBtn = wbRow.createEl("button", { cls: "kg-btn", text: "继续最近任务" });
    resumeBtn.addEventListener("click", () => { this.plugin.openWorkbenchResume(); });
    const stateSection = inner.createDiv({ cls: "kg-section" });
    stateSection.createDiv({ cls: "kg-section-title", text: "今日状态" });
    const counts = stateCounts(this.plugin.index.all(), (p) => this.plugin.activity.get(p), this.plugin.settings.activity);
    const stateGrid = stateSection.createDiv({ cls: "kg-grid kg-state-grid" });
    const stateDefs: { label: string; state: KGState }[] = [
      { label: "🌱 新知识", state: "new" },
      { label: "📈 正在增长", state: "growing" },
      { label: "● 活跃", state: "active" },
      { label: "○ 疏于维护", state: "stale" },
      { label: "↺ 可能正在被遗忘", state: "forgotten" },
    ];
    for (const d of stateDefs) {
      const card = stateGrid.createDiv({ cls: "kg-card kg-state kg-state-clickable" });
      card.createSpan({ cls: "kg-state-count", text: String(counts[d.state]) });
      card.createSpan({ cls: "kg-state-label", text: d.label });
      // Phase 11（§八/十三/一百二十五/一百二十六）：点击 → 状态卡随机浏览（纯本地 0 AI，绝不触发 AI）
      card.setAttr("title", "点击随机浏览「" + d.label + "」笔记（纯本地，0 AI）");
      card.addEventListener("click", () => this.plugin.browseState(d.state as KGState));
    }
    stateSection.createDiv({ cls: "kg-section-desc", text: "判定来自本地规则 + 行为记录；点击状态卡可随机浏览对应状态的笔记（纯本地，0 AI）；修改阈值不影响 AI 缓存。" });

    // ---- 2.5 Inbox（Capture/Processing，本阶段 §六十二/一百一十一/一百一十二：极轻量 1 张小卡片，0 AI） ----
    const inboxCard = inner.createDiv({ cls: "kg-card kg-inbox-card" });
    const s3 = this.plugin.captureSummaryText;
    inboxCard.createDiv({ cls: "kg-inbox-title", text: "📥 Inbox" });
    const inboxGrid = inboxCard.createDiv({ cls: "kg-inbox-grid" });
    const inboxDefs: { count: number; label: string }[] = [
      { count: s3.inbox, label: "待处理" },
      { count: s3.candidates, label: "知识候选" },
      { count: s3.accepted, label: "已确认知识" },
    ];
    for (const d of inboxDefs) {
      const cell = inboxGrid.createDiv({ cls: "kg-inbox-cell" });
      cell.createSpan({ cls: "kg-inbox-count", text: String(d.count) });
      cell.createSpan({ cls: "kg-inbox-label", text: d.label });
    }
    const inboxActions = inboxCard.createDiv({ cls: "kg-inbox-actions" });
    const openInboxBtn = inboxActions.createEl("button", { cls: "kg-btn kg-btn-sm", text: "打开 Inbox" });
    openInboxBtn.addEventListener("click", () => { void this.plugin.openCaptureFolder(this.plugin.settings.capture.inboxFolder); });
    const openCandBtn = inboxActions.createEl("button", { cls: "kg-btn kg-btn-sm", text: "打开知识候选" });
    openCandBtn.addEventListener("click", () => { void this.plugin.openCaptureFolder(this.plugin.settings.capture.processingFolder); });
    const openKnowBtn = inboxActions.createEl("button", { cls: "kg-btn kg-btn-sm", text: "打开 Knowledge" });
    openKnowBtn.addEventListener("click", () => { void this.plugin.openCaptureFolder(this.plugin.settings.capture.knowledgeFolder); });
    if (this.plugin.captureError) {
      const errBox = inboxCard.createDiv({ cls: "kg-error" });
      errBox.createSpan({ text: "AI 提炼失败：" + this.plugin.captureError });
      const retryBtn = errBox.createEl("button", { cls: "kg-btn kg-btn-sm", text: "重试当前捕获" });
      retryBtn.addEventListener("click", () => { void this.plugin.processCurrentCapture(); });
    }
    inboxCard.createDiv({ cls: "kg-capture-hint", text: "捕获不调用 AI；对 Inbox 笔记执行「知识花园：处理当前捕获」后才进入 AI 提炼（§二十二）。" });

    // ---- 3. 知识区域（§27/28：按 settings.knowledgeAreas 顺序；点击打开文件夹/搜索视图） ----
    const areaSection = inner.createDiv({ cls: "kg-section" });
    areaSection.createDiv({ cls: "kg-section-title", text: "知识区域" });
    const areaGrid = areaSection.createDiv({ cls: "kg-grid" });
    if (s.knowledgeAreas.length === 0) {
      areaGrid.createDiv({ cls: "kg-empty", text: "尚未配置知识区域。请到 设置 → Knowledge Areas 添加（名称 + Vault 内文件夹）。" });
    } else {
      for (const area of s.knowledgeAreas) {
        const stats = this.plugin.index.areaStats(area);
        const recent = this.plugin.index.recentInArea(area, 3);
        const card = areaGrid.createDiv({ cls: "kg-card kg-area" });
        const head = card.createDiv({ cls: "kg-area-head" });
        head.createSpan({ cls: "kg-area-icon", text: area.icon || "📁" });
        head.createSpan({ cls: "kg-area-name", text: area.name });
        head.createSpan({ cls: "kg-area-count", text: String(stats.count) + " 篇" });
        const sub = card.createDiv({ cls: "kg-area-sub" });
        if (stats.lastModified) sub.createDiv({ text: "最近修改 " + this.fmtDate(new Date(stats.lastModified)) });
        if (stats.lastCreated) sub.createDiv({ text: "最近新增 " + this.fmtDate(new Date(stats.lastCreated)) });
        const list = card.createDiv({ cls: "kg-micro-list" });
        if (recent.length === 0) list.createDiv({ cls: "kg-empty", text: "该文件夹下还没有笔记" });
        for (const n of recent) this.noteRow(list, n.path, n.title);
        card.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".kg-note-item")) return;
          this.revealArea(area.folder);
        });
      }
    }

    // ---- 4. 今日 AI（§29：奇想 / 问题 / 连接合一；§30 文字提问 → 图给探索路径，不重复信息） ----
    const aiSection = inner.createDiv({ cls: "kg-section" });
    const aiHead = aiSection.createDiv({ cls: "kg-section-title-row" });
    aiHead.createDiv({ cls: "kg-section-title", text: "✦ 今日知识奇想" });
    const genBtn = aiHead.createEl("button", { cls: "kg-btn kg-btn-primary", text: "生成今日知识奇想" });
    genBtn.addEventListener("click", () => void this.generateCuriosity(genBtn));
    const forceBtn = aiHead.createEl("button", { cls: "kg-btn", text: "强制重新生成" });
    forceBtn.addEventListener("click", () => void this.generateCuriosity(forceBtn, true));
    if (this.plugin.curiosityError) {
      const err = aiSection.createDiv({ cls: "kg-error" });
      err.createDiv({ text: "AI 暂时无法连接" });
      err.createDiv({ cls: "kg-error-detail", text: this.plugin.curiosityError });
      const retry = err.createEl("button", { cls: "kg-btn", text: "重试" });
      retry.addEventListener("click", () => { this.plugin.curiosityError = null; this.render(); void this.generateCuriosity(retry, true); });
      err.createDiv({ cls: "kg-error-note", text: "你的本地知识索引仍然正常工作。" });
    }
    const insight = s.lastCuriosity && isSameDay(s.lastCuriosity.date, Date.now()) ? s.lastCuriosity.insight : null;
    if (insight) {
      const cards = aiSection.createDiv({ cls: "kg-ai-cards" });
      this.insightCard(cards, "奇想", insightTypeLabel(insight.type), insight.title, insight.summary, insight);
      this.insightCard(cards, "问题", "❓ 一个值得追问的问题", insight.question, "", insight);
      const connText = insight.notes.map((n) => n.reason || n.path).join("；");
      this.insightCard(cards, "连接", "🔗 AI 发现了一条连接", "相关笔记：" + insight.notes.length + " 篇", connText, insight);
      this.renderCuriositySaveRow(aiSection, insight);
      const curMeta = this.plugin.discoveryMeta?.curiosity;
      aiSection.createDiv({ cls: "kg-section-desc", text: "探索范围：" + (curMeta ? curMeta.scopeLabel : this.discoveryScopeOf("curiosity")) + (curMeta ? " · 候选池 " + curMeta.poolCount + " 篇 / 本次候选 " + curMeta.count + " 篇" : "") });
    } else {
      aiSection.createDiv({ cls: "kg-empty", text: "还没有今日奇想。点击「生成今日知识奇想」，AI 会在当前探索范围（" + this.discoveryScopeOf("curiosity") + "）内寻找跨领域的连接、问题与冲突——而不是替你写总结。" });
    }

    // ---- 5. 今日知识漫游（§31/33：视觉中心；可解释路径；只读缓存，绝不自动请求 AI） ----
    const expSection = inner.createDiv({ cls: "kg-section" });
    expSection.createDiv({ cls: "kg-section-title", text: "✦ 今日知识漫游" });
    expSection.createDiv({ cls: "kg-section-desc", text: "AI 在当前探索范围（" + this.discoveryScopeOf("roaming") + "）内发现了一条值得继续探索的路径。" });
        this.renderConnections(expSection);
    // ---- 5.4 Query Explorer（§六十八/七十二/一百二十三：我发问 ↔ AI 发问；独立区块，不覆盖今日漫游 §四十六） ----
    const querySection = inner.createDiv({ cls: "kg-section" });
    querySection.createDiv({ cls: "kg-section-title", text: "🔎 Query Explorer · 我的探索" });
    querySection.createDiv({ cls: "kg-section-desc", text: "输入问题或关键词，AI 会从全库找到相关知识并说明“为什么这些值得连起来”（本地检索 + AI 关联两阶段；缓存命中 0 AI 请求）。" });
    this.renderQueryExplorer(querySection);    
// ---- 5.5 知识演化（Phase 7 §38/53/55：只读本地快照 + AI 缓存展示，绝不自动触发 AI） ----
    const evoSection = inner.createDiv({ cls: "kg-section" });
    evoSection.createDiv({ cls: "kg-section-title", text: "✦ 知识演化" });
    this.renderEvolution(evoSection);
    // ---- 5.6 Saved Exploration 收藏的知识链路（§二十一/二十二：Dashboard 入口，0 AI） ----
    const savedSection = inner.createDiv({ cls: "kg-section" });
    savedSection.createDiv({ cls: "kg-section-title", text: "★ 收藏的知识链路" });
    this.renderSavedSection(savedSection);

    // ---- Phase 17 §82：✦ 最近保存（最近 5 个 Artifact；0 AI §83） ----
    const arts = this.plugin.artifactStore.recent(5);
    if (arts.length) {
      const artSection = inner.createDiv({ cls: "kg-section" });
      artSection.createDiv({ cls: "kg-section-title", text: "✦ 最近保存" });
      const artList = artSection.createDiv({ cls: "kg-note-list" });
      for (const a of arts) {
        artList.createEl("div", { cls: "kg-note-row" }, (row) => {
          const link = row.createEl("a", { text: "📎 " + (a.title || "AI 产物"), cls: "kg-note-link" });
          link.addEventListener("click", () => {
            const f = this.app.vault.getAbstractFileByPath(a.vaultPath);
            if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
            else new Notice("文件不存在：" + a.vaultPath);
          });
          row.createSpan({ cls: "kg-note-path", text: a.vaultPath });
        });
      }
    }
    // ---- 6/7. 最近访问 ↔ 值得重新看看（两列，§39 小窗口自动变一列） ----
    const two = inner.createDiv({ cls: "kg-grid-two" });
    if (s.dashboard.showRecentAccess) {
      const rvSection = two.createDiv({ cls: "kg-section" });
      rvSection.createDiv({ cls: "kg-section-title", text: "最近访问" });
      const rvList = rvSection.createDiv({ cls: "kg-note-list" });
      const recentAccess = this.plugin.activity.recent(this.plugin.settings.activity.recentLimit);
      if (recentAccess.length === 0) rvList.createDiv({ cls: "kg-empty", text: "还没有打开记录。打开笔记后会记录最近访问（仅影响排序，不触发 AI）。" });
      for (const { path, entry } of recentAccess) {
        const times = entry.accessCount ?? 0;
        this.noteRow(rvList, path, this.basename(path) + "（" + this.relTime(entry.lastAccessedAt) + " · " + times + " 次访问）");
      }
    }
    if (s.dashboard.showForgotten) {
      this.renderReviewCenter(two);
    }
    // Phase 14（§一百二十九/一百三十）：📚 我的复习卡（统计 + 最近 5 张 + 查看全部；0 AI）
    this.renderReviewCardsSection(two);

    // ---- 8. 最近复盘（§36：上一次 / 今日 / 下次；使用 Phase 4 Scheduler 状态） ----
    const revSection = inner.createDiv({ cls: "kg-section" });
    const revHead = revSection.createDiv({ cls: "kg-section-title-row" });
    revHead.createDiv({ cls: "kg-section-title", text: "最近复盘" });
    const dailyBtn = revHead.createEl("button", { cls: "kg-btn", text: "生成日复盘" });
    dailyBtn.addEventListener("click", () => void this.runReview("daily", dailyBtn));
    const weeklyBtn = revHead.createEl("button", { cls: "kg-btn", text: "生成周复盘" });
    weeklyBtn.addEventListener("click", () => void this.runReview("weekly", weeklyBtn));

    const autoBlock = revSection.createDiv({ cls: "kg-auto-block" });
    const nextInfo = this.plugin.scheduler.getNextReviewInfo();
    if (!nextInfo) {
      autoBlock.createDiv({ cls: "kg-auto-line", text: "下次复盘：自动复盘未启用（设置 → Automatic Review）" });
    } else {
      autoBlock.createDiv({ cls: "kg-auto-line", text: "下次" + periodCn(nextInfo.type) + "复盘：" + nextInfo.label });
    }
    const statusLines = this.plugin.scheduler.getStatusLines();
    for (const l of statusLines) {
      autoBlock.createDiv({ cls: "kg-auto-line", text: l.text });
    }

    const revList = revSection.createDiv({ cls: "kg-note-list" });
    if (s.reviews.length === 0) revList.createDiv({ cls: "kg-empty", text: "还没有复盘记录。复盘结果始终是可读的 Markdown：" + "Knowledge Garden/Reviews/" });
    for (const r of s.reviews.slice(0, 6)) {
      const row = revList.createDiv({ cls: "kg-note-item" });
      row.createSpan({ cls: "kg-note-title", text: periodLabel(r.period) + " · " + this.fmtDate(new Date(r.date)) + (r.generatedBy === "local" ? "（本地降级）" : "") });
      row.createSpan({ cls: "kg-note-meta", text: r.path });
      row.addEventListener("click", () => this.openNote(r.path));
    }
  }

  /** Phase 14（§一百二十九/一百三十）：📚 我的复习卡 —— 统计（最近掌握 / 需要复习）+ 最近 5 张 + 查看全部（0 AI）。
   *  点击卡片/查看全部 → openCardsView（§一百二十九）；绝不触发 AI、不修改访问数据。 */
  private renderReviewCardsSection(parent: HTMLElement): void {
    const cards = this.plugin.cards.all();
    const section = parent.createDiv({ cls: "kg-section" });
    const head = section.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "📚 我的复习卡" });
    const allBtn = head.createEl("button", { cls: "kg-btn", text: "查看全部" });
    allBtn.addEventListener("click", () => { void this.plugin.openCardsView(); });
    const masteryMap: Record<string, string> = { forgot: "😵 没想起来", hard: "😕 很困难", good: "🙂 基本掌握", easy: "😎 很熟练" };
    const goodCount = cards.filter((c) => c.mastery === "good" || c.mastery === "easy").length;
    const needCount = cards.filter((c) => !c.mastery || c.mastery === "hard" || c.mastery === "forgot").length;
    section.createDiv({ cls: "kg-section-desc", text: "最近掌握：🙂 " + goodCount + " · 需要复习：😕 " + needCount + "（复习卡来自「📝 构建知识考试」后收藏题目；0 AI）" });
    const list = section.createDiv({ cls: "kg-note-list" });
    if (cards.length === 0) {
      list.createDiv({ cls: "kg-empty", text: "还没有收藏复习卡。在任何笔记右键 →「📝 构建知识考试」→ 作答后把题目收藏为复习卡。" });
      return;
    }
    for (const c of cards.slice(0, 5)) {
      const row = list.createDiv({ cls: "kg-note-item" });
      row.createSpan({ cls: "kg-note-title", text: c.question.slice(0, 46) });
      row.createSpan({ cls: "kg-note-meta", text: "《" + this.plugin.basename(c.sourcePath) + "》" + (c.mastery ? " · " + (masteryMap[c.mastery] ?? c.mastery) : " · 未复习") });
      row.addEventListener("click", () => { void this.plugin.openCardsView(); });
    }
    if (cards.length > 5) section.createDiv({ cls: "kg-empty", text: "…共 " + cards.length + " 张，点击「查看全部」浏览。" });
  }

  /** Phase 8：今日复习卡（§三十七/七十五）：数据源=本地 Review Queue（§十/六十四），绝不触发 AI（Test 14）。
   *  “可能正在被遗忘”作为候选 Reason 展示，不再是平行大区块（§七十五）。 */
  private renderReviewCenter(section: HTMLElement): void {
    const plugin = this.plugin;
    section.createDiv({ cls: "kg-section-title", text: "✦ 今日复习" });
    section.createDiv({ cls: "kg-section-desc", text: "候选由本地规则决定（状态 + 连接度 + 陈旧度 + 跨区域 − 近期复习惩罚 − 连续跳过惩罚），不调用 AI。" });
    const q = plugin.ensureReviewQueue();   // 幂等：同一天默认复用（§十）
    if (!q || q.items.length === 0) {
      section.createDiv({ cls: "kg-empty", text: "今天还没有可复习的笔记。点击下方开始后会自动生成（纯本地）。" });
      const b = section.createEl("button", { cls: "kg-btn kg-btn-primary", text: "开始今日复习" });
      b.addEventListener("click", () => { this.render(); });
      return;
    }
    const done = q.completedCount + q.skippedCount;
    const finished = sessionFinished(q);
    section.createDiv({ cls: "kg-review-progress-line", text: (finished ? "✓ 今日复习已完成 · " : (q.completedCount > 0 ? q.completedCount + " 已完成 · " : "")) + done + " / " + q.items.length });
    const list = section.createDiv({ cls: "kg-note-list" });
    if (finished) {
      const areas = plugin.reviewContactAreas(q);
      list.createDiv({ cls: "kg-empty", text: "✓ 今日复习已完成" + (areas.length > 0 ? " · 重新接触：" + areas.join(" / ") : "") });
      return;
    }
    for (const it of q.items.slice(0, 3)) {
      const n = plugin.index.all().find((x) => x.path === it.path);
      if (!n) continue;
      const row = list.createDiv({ cls: "kg-note-item" });
      row.createSpan({ cls: "kg-note-title", text: "《" + n.title + "》" });
      const meta = row.createSpan({ cls: "kg-note-meta" });
      const a = plugin.reviewAreaOf(it.path);
      const act = plugin.activity.get(it.path);
      let daysTxt = "从未复习";
      if (act && typeof act.lastReviewedAt === "number") {
        const d = Math.floor((Date.now() - act.lastReviewedAt) / 86400000);
        daysTxt = d < 1 ? "刚刚复习" : d + " 天未复习";
      }
      const conn = n.links.length + n.backlinks.length;
      meta.setText((a ? a + " · " : "") + stateReason(it.stateAtSelection) + " · " + daysTxt + (conn > 0 ? " · " + conn + " 个关联" : ""));
      row.addEventListener("click", () => this.openNote(it.path));
    }
    if (q.items.length > 3) list.createDiv({ cls: "kg-empty kg-review-more", text: "…共 " + q.items.length + " 篇" });
    const start = section.createEl("button", { cls: "kg-btn kg-btn-primary", text: done > 0 ? "继续复习" : "开始今日复习" });
    start.addEventListener("click", () => { void plugin.openReviewSession(); });
  }
  private noteRow(parent: HTMLElement, path: string, label: string): void {
    const row = parent.createDiv({ cls: "kg-note-item" });
    row.createSpan({ cls: "kg-note-title", text: label });
    const meta = row.createSpan({ cls: "kg-note-meta" });
    meta.setText(path);
    row.addEventListener("click", () => this.openNote(path));
  }

  private metaSuffix(n: { folder: string; wordCount: number; modified: number }): string {
    const days = Math.max(1, Math.round((Date.now() - n.modified) / 86400000));
    return "（" + n.folder + (n.folder ? " · " : "") + n.wordCount + " 字 · " + days + " 天前）";
  }

  private insightCard(
    parent: HTMLElement, key: string, label: string, title: string, body: string, insight: AIInsight
  ): void {
    const card = parent.createDiv({ cls: "kg-card kg-ai-card" });
    card.createDiv({ cls: "kg-ai-label", text: label });
    card.createDiv({ cls: "kg-ai-title", text: title });
    if (body) card.createDiv({ cls: "kg-ai-body", text: body });
    if (key === "奇想" && insight.notes.length > 0) {
      const links = card.createDiv({ cls: "kg-ai-notes" });
      for (const ref of insight.notes) {
        const l = links.createDiv({ cls: "kg-note-item" });
        l.createSpan({ cls: "kg-note-title", text: this.basename(ref.path) });
        l.createSpan({ cls: "kg-note-meta", text: ref.reason || ref.path });
        l.addEventListener("click", () => this.openNote(ref.path));
      }
    }
    if (key === "连接") {
      const explore = card.createEl("button", { cls: "kg-btn", text: "查看相关笔记" });
      explore.addEventListener("click", () => {
        if (insight.notes[0]) this.openNote(insight.notes[0].path);
      });
    }
  }

  private async generateCuriosity(btn: HTMLElement, force = false): Promise<void> {
    btn.addClass("kg-loading");
    btn.setText("生成中…");
    try {
      await this.plugin.runCuriosity(force); // 缓存命中 / 错误缓存 / 网络失败都由统一入口处理
    } finally {
      btn.removeClass("kg-loading");
      this.render();
    }
  }
  private async runReview(period: "daily" | "weekly", btn: HTMLElement): Promise<void> {
    btn.addClass("kg-loading");
    btn.setText("生成中…");
    try {
      await this.plugin.runReview(period); // 同一周期默认复用缓存；手动强制走命令面板「强制重新生成」
    } finally {
      btn.removeClass("kg-loading");
      this.render();
    }
  }
  /** 最新一条 connections 成功缓存（仅读取，绝不触发 AI） */
  private latestConnectionCache(): AICacheEntry<AIConnectionResult> | undefined {
    const list = this.plugin.cache.byType("connections").filter((e) => e.status === "success");
    list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return list[0] as AICacheEntry<AIConnectionResult> | undefined;
  }

  /** v2 形状判断：nodes[] + edges[] 都存在才是可可视化结果（旧缓存不猜边） */
  private isConnectionShape(d: unknown): d is AIConnectionResult {
    if (!d || typeof d !== "object") return false;
    const o = d as Record<string, unknown>;
    return Array.isArray(o["nodes"]) && Array.isArray(o["edges"]);
  }

  /** 数据流：Cache → normalize → GraphModel → Layout → SVG；任何失败都只改 UI，不碰缓存 */
  /** Phase 7：知识演化卡（§三十八/五十三/五十五）：只读 cache/evolution.json 与设置中演化摘要；绝不自动触发 AI */
  private renderEvolution(section: HTMLElement): void {
    if (!this.plugin.settings.evolution.enabled) {
      section.createDiv({ cls: "kg-empty", text: "知识演化未启用（设置 → 知识演化）。" });
      return;
    }
    const snaps = this.plugin.evolution.latest(8);
    if (snaps.length === 0) {
      section.createDiv({ cls: "kg-empty", text: "还没有本地周快照。运行一次周复盘或执行「生成本周知识演化快照」后，这里会展示长期演化摘要（§五十三：无缓存显示“尚未生成”，绝不自动请求 AI）。" });
      this.renderEvolutionButtons(section);
      return;
    }
    const latest = snaps[snaps.length - 1];
    const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : undefined;
    const now = Date.now();
    const sorted = [...latest.areaStats].sort((a, b) => growthScore(b, now) - growthScore(a, now));
    section.createDiv({ cls: "kg-section-desc", text: "本地聚合统计（" + latest.date + "）。" });

    const card = section.createDiv({ cls: "kg-evolution-card" });
    // 近期增长（趋势箭头：↑ / → / ↓，§五十五；不展示 0~100 分数）
    const growthRow = card.createDiv({ cls: "kg-evo-row" });
    growthRow.createSpan({ cls: "kg-evo-label", text: "近期增长" });
    for (const s of sorted.slice(0, 4)) {
      const p = prev?.areaStats.find((x) => x.area === s.area);
      const arrow = p ? trendArrow(s, p) : "→";
      const ch = growthRow.createSpan({ cls: "kg-evo-chip" });
      ch.createSpan({ cls: "kg-evo-name", text: s.area });
      ch.createSpan({ cls: "kg-evo-arrow " + (arrow === "↑" ? "kg-evo-up" : arrow === "↓" ? "kg-evo-down" : "kg-evo-flat"), text: arrow });
    }
    // 持续主题 / 核心知识候选（§二十：文案是“候选”，不是“你的核心知识”）
    const longStates = new Map<string, string>();
    for (const a of latest.areaStats) longStates.set(a.area, classifyLongTerm(snaps, a.area, now));
    const cores = [...longStates.entries()].filter(([, st]) => st === "core" || st === "sustained").map(([name]) => name);
    const themeRow = card.createDiv({ cls: "kg-evo-row" });
    themeRow.createSpan({ cls: "kg-evo-label", text: "持续主题" });
    if (cores.length > 0) {
      for (const name of cores.slice(0, 3)) themeRow.createSpan({ cls: "kg-evo-chip", text: name });
    } else {
      for (const c of latest.topConcepts.slice(0, 3)) themeRow.createSpan({ cls: "kg-evo-chip", text: c.name });
    }
    // 跨领域连接（§21：只有真实 wiki 链接或 AI edge）
    if (latest.crossAreaLinks.length > 0) {
      const linkRow = card.createDiv({ cls: "kg-evo-row" });
      linkRow.createSpan({ cls: "kg-evo-label", text: "连接最密集" });
      for (const l of latest.crossAreaLinks.slice(0, 3)) linkRow.createSpan({ cls: "kg-evo-chip kg-evo-link", text: l.a + " ↔ " + l.b });
    }
    // 反复出现的问题（§25/27：文案为“反复出现”，不自动认定“没解决”）
    const pq = this.plugin.evolution.persistentQuestions().filter((q) => q.occurrences >= 2);
    if (pq.length > 0) {
      const qRow = card.createDiv({ cls: "kg-evo-row" });
      qRow.createSpan({ cls: "kg-evo-label", text: "反复出现的问题" });
      qRow.createSpan({ cls: "kg-evo-question", text: "「" + pq[0].text + "」（" + pq[0].periods.length + " 个周期）" });
    }
    this.renderEvolutionButtons(section);
  }

  /** Phase 7：演化操作按钮（查看/生成月度·季度；§五十三无缓存“尚未生成”、§五十四手动生成） */
  private renderEvolutionButtons(section: HTMLElement): void {
    const btnRow = section.createDiv({ cls: "kg-evo-buttons" });
    const monthly = this.plugin.settings.lastMonthlyEvolution;
    const quarterly = this.plugin.settings.lastQuarterlyEvolution;
    const mBtn = btnRow.createEl("button", { cls: "kg-btn", text: monthly ? "查看月度演化" : "生成月度演化" });
    mBtn.addEventListener("click", () => {
      if (monthly) this.plugin.openNote("Knowledge Garden/Reviews/Monthly/" + monthly.period + " 月度知识演化.md");
      else void this.plugin.runMonthlyEvolution(false);
    });
    const qBtn = btnRow.createEl("button", { cls: "kg-btn", text: quarterly ? "查看季度演化" : "生成季度演化" });
    qBtn.addEventListener("click", () => {
      if (quarterly) this.plugin.openNote("Knowledge Garden/Reviews/Quarterly/" + quarterly.period + " 季度知识演化.md");
      else void this.plugin.runQuarterlyEvolution(false);
    });
    if (this.plugin.evolutionError) {
      const err = section.createDiv({ cls: "kg-error" });
      err.createDiv({ text: "AI 暂时无法连接（长期演化）" });
      err.createDiv({ cls: "kg-error-detail", text: this.plugin.evolutionError });
      const retry = err.createEl("button", { cls: "kg-btn", text: "重试" });
      retry.addEventListener("click", () => { this.plugin.evolutionError = null; this.render(); void this.plugin.runMonthlyEvolution(true); });
      err.createDiv({ cls: "kg-error-note", text: "你的本地快照与统计仍然正常工作。" });
    }
  }

  private renderConnections(expSection: HTMLElement): void {
    const conn = this.latestConnectionCache();
    if (!conn) {
      expSection.createDiv({ cls: "kg-empty", text: "今天还没有可视化的 AI 知识连接。" });
      const btn = expSection.createEl("button", { cls: "kg-btn kg-btn-primary", text: "生成今日知识连接" });
      btn.addEventListener("click", () => void this.generateConnections(btn));
      expSection.createDiv({ cls: "kg-section-desc", text: "点击后 AI 会在当前探索范围（" + this.discoveryScopeOf("roaming") + "）内提出一条「可探索的知识连接路径」；之后打开 Dashboard 只读缓存，0 AI 请求。" });
      return;
    }
    const data = conn.data as AIConnectionResult | undefined;
    if (!this.isConnectionShape(data)) {
      expSection.createDiv({ cls: "kg-empty", text: "当前缓存尚未包含可视化关系。" });
      expSection.createDiv({ cls: "kg-section-desc", text: "旧版连接结果只有 notes 摘要、没有 nodes/edges。点击重新生成，按新 Schema 重建后再显示图（不自行猜边）。" });
      const btn = expSection.createEl("button", { cls: "kg-btn kg-btn-primary", text: "重新生成知识连接" });
      btn.addEventListener("click", () => void this.generateConnections(btn, true));
      return;
    }
    let model = normalizeConnection(data);
    if (!model) {
      expSection.createDiv({ cls: "kg-empty", text: "无法解析连接数据。" });
      expSection.createDiv({ cls: "kg-section-desc", text: "缓存数据不完整；点击重新生成，按新 Schema 重建后再显示图。" });
      const btn = expSection.createEl("button", { cls: "kg-btn kg-btn-primary", text: "重新生成连接" });
      btn.addEventListener("click", () => void this.generateConnections(btn, true));
      return;
    }
    if (model.nodes.length === 0) {
      expSection.createDiv({ cls: "kg-empty", text: "没有可用于可视化的节点。点击重新生成，让 AI 从候选笔记中提取关系。" });
      const btn = expSection.createEl("button", { cls: "kg-btn kg-btn-primary", text: "重新生成连接" });
      btn.addEventListener("click", () => void this.generateConnections(btn, true));
      return;
    }
    this.plugin.decorateGraphEdges(model);
    model = selectCoreGraph(model);
    const roamMeta = this.plugin.discoveryMeta?.roaming;
    const scopeNote = roamMeta ? "探索：" + roamMeta.scopeLabel + " · 候选池 " + roamMeta.poolCount + " 篇 / 本次候选 " + roamMeta.count + " 篇 · " : "探索：" + this.discoveryScopeOf("roaming") + " · ";
    const relStat = this.plugin.relationshipCounts();
    const relNote = expSection.createDiv({ cls: "kg-cache-status kg-rel-count", text: "关系：已确认 " + relStat.confirmed + " · AI 建议 " + relStat.aiInferred + "（虚线） · 已忽略 " + relStat.dismissed + "" });
    const meta = expSection.createDiv({ cls: "kg-cache-status", text: scopeNote + model.nodes.length + " 个笔记 · " + model.edges.length + " 个连接" + (model.moreCount > 0 ? " · 还有 " + model.moreCount + " 个相关节点" : "") + "（缓存更新于 " + this.fmtDate(new Date(conn.updatedAt ?? conn.createdAt)) + "）" });
    // 重新生成失败 → 保留旧图 + 重试条
    if (this.plugin.connectionError) {
      const err = expSection.createDiv({ cls: "kg-error" });
      err.createDiv({ text: "重新生成失败" });
      err.createDiv({ cls: "kg-error-detail", text: this.plugin.connectionError });
      err.createDiv({ cls: "kg-error-note", text: "正在继续显示上一版知识连接。" });
      const retry = err.createEl("button", { cls: "kg-btn", text: "重试" });
      retry.addEventListener("click", () => { this.plugin.connectionError = null; this.render(); void this.generateConnections(retry, true); });
    }
    const box = expSection.createDiv({ cls: "kg-graph-box" });
    const layout = computeGraphLayout(model, box.clientWidth || 760, box.clientHeight || 380);
    this.graph = new GraphSvg(box, model, layout, { onOpenNote: (p) => this.openNote(p) });
    const toolbar = expSection.createDiv({ cls: "kg-graph-toolbar" });
    const zoom = toolbar.createDiv({ cls: "kg-graph-zoom" });
    const plus = zoom.createEl("button", { cls: "kg-btn kg-btn-icon", text: "+", attr: { title: "放大", "aria-label": "放大" } });
    plus.addEventListener("click", () => { if (this.graph) this.graph.zoomIn(); });
    const minus = zoom.createEl("button", { cls: "kg-btn kg-btn-icon", text: "−", attr: { title: "缩小", "aria-label": "缩小" } });
    minus.addEventListener("click", () => { if (this.graph) this.graph.zoomOut(); });
    const home = zoom.createEl("button", { cls: "kg-btn kg-btn-icon", text: "⌂", attr: { title: "重置视图", "aria-label": "重置视图" } });
    home.addEventListener("click", () => { if (this.graph) this.graph.fit(); });
    const regen = toolbar.createEl("button", { cls: "kg-btn kg-btn-primary", text: "重新生成连接" });
    regen.addEventListener("click", () => void this.generateConnections(regen, true));
    this.renderRoamSaveBtn(toolbar, model);
    // Insight Panel——图不是装饰，而是可解释的 AI 输出
    const panel = expSection.createDiv({ cls: "kg-graph-insight" });
    panel.createDiv({ cls: "kg-ai-label", text: "✦ AI 为什么这样连接？" });
    if (model.title) panel.createDiv({ cls: "kg-ai-title", text: model.title });
    if (model.question) panel.createDiv({ cls: "kg-ai-body", text: "问题：" + model.question });
    if (model.summary) panel.createDiv({ cls: "kg-ai-body", text: model.summary });
    panel.createDiv({ cls: "kg-ai-label", text: "相关关系" });
    const relList = panel.createDiv({ cls: "kg-note-list" });
    for (const e of model.edges) {
      const from = model.nodes.find((n) => n.id === e.from);
      const to = model.nodes.find((n) => n.id === e.to);
      if (!from || !to) continue;
      const row = relList.createDiv({ cls: "kg-note-item" });
      row.createSpan({ cls: "kg-note-title", text: from.label + " → " + to.label });
      row.createSpan({ cls: "kg-note-meta", text: e.relation + (e.reason ? " · " + e.reason : "") });
      row.addEventListener("click", () => this.openNote(from.path));
    }
  }  /** Query Explorer 区块（§六十八/七十二/一百二十三）：输入 + 范围 + 最近探索 + 两阶段状态 + 结果图/观察。
   *  结果图复用现有 GraphSvg（§四十二：不复制 GraphModel/SVG 一套）；点击 Query 中心节点 → 重新运行查询。
   *  打开 Dashboard 只读状态，绝不自动请求 AI（§五十/五十六）。 */
  private renderQueryExplorer(section: HTMLElement): void {
    const plugin = this.plugin;
    const st = plugin.queryExploration;
    const cfg = plugin.settings.queryExplorer;
    // ---- 输入区（§六十七/五十六：恢复历史只放回输入框，不自动执行） ----
    const bar = section.createDiv({ cls: "kg-query-bar" });
    const input = bar.createEl("input", {
      cls: "kg-query-input",
      attr: { type: "text", placeholder: "输入一个问题或关键词，例如：为什么好的系统需要清晰的边界？", maxlength: String(QUERY_MAX_LENGTH), "aria-label": "探索问题" },
    });
    input.value = st.rawQuery || "";
    const scopeSel = bar.createEl("select", { cls: "kg-select", attr: { "aria-label": "探索范围" } });
    scopeSel.createEl("option", { value: "vault", text: "范围：整个仓库" });
    scopeSel.createEl("option", { value: "current-discovery-scope", text: "范围：当前漫游范围" });
    scopeSel.value = this.queryScopeMode;
    scopeSel.addEventListener("change", () => { this.queryScopeMode = scopeSel.value as QueryScopeMode; });
    const go = bar.createEl("button", { cls: "kg-btn kg-btn-primary", text: "探索 →" });
    const runQuery = (opts?: { forceAi?: boolean; allowWeak?: boolean }): void => {
      const val = input.value.trim();
      if (!val) { new Notice("请输入问题或关键词。"); return; }
      this.queryScopeMode = (scopeSel.value as QueryScopeMode) || cfg.scopeMode;
      void plugin.runQueryExploration(val, { ...opts, scopeMode: this.queryScopeMode });
    };
    go.addEventListener("click", () => runQuery());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runQuery(); } });

    // ---- 最近探索（§五十六：点击恢复到输入框 + [重新探索]；§五十八 只存 query/时间/范围） ----
    const recent = plugin.queryHistory.recent(5);
    if (recent.length > 0) {
      const hist = section.createDiv({ cls: "kg-query-history" });
      hist.createDiv({ cls: "kg-ai-label", text: "最近探索" });
      for (const h of recent) {
        const line = hist.createDiv({ cls: "kg-query-history-row" });
        const label = line.createSpan({ cls: "kg-query-history-q", text: h.headline || h.query });
        line.createSpan({ cls: "kg-query-history-meta", text: this.relTime(h.createdAt) + " · " + (h.scope === "vault" ? "整个仓库" : "当前漫游范围") });
        label.addEventListener("click", () => { input.value = h.query; scopeSel.value = h.scope; this.queryScopeMode = h.scope; });
        const reBtn = line.createEl("button", { cls: "kg-btn kg-btn-sm", text: "重新探索" });
        reBtn.addEventListener("click", () => { input.value = h.query; scopeSel.value = h.scope; this.queryScopeMode = h.scope; runQuery(); });
      }
    }

    // ---- 两阶段状态提示（§五十七：搜索 → 找到 N 篇 → 正在整理 M 个候选） ----
    if (st.status === "searching") { section.createDiv({ cls: "kg-query-state", text: "正在搜索知识库…" }); return; }
    if (st.status === "found") { section.createDiv({ cls: "kg-query-state", text: "本地找到 " + st.localCount + " 篇相关笔记…" }); return; }
    if (st.status === "thinking") { section.createDiv({ cls: "kg-query-state", text: "正在整理 " + st.candidateCount + " 个候选之间的关系…" }); return; }

    // ---- 失败 / 无结果 / 弱相关（§六十四/六十五/五十三：本地结果不丢，绝不让 AI 凭空生成知识） ----
    if (st.status === "error") {
      const err = section.createDiv({ cls: "kg-error" });
      err.createDiv({ text: st.localCount > 0 ? "找到 " + st.localCount + " 篇相关知识，但 AI 暂时无法整理。" : "AI 暂时无法连接。" });
      err.createDiv({ cls: "kg-error-detail", text: plugin.queryExplorerError ?? "未知错误" });
      err.createDiv({ cls: "kg-error-note", text: "本地检索已完成，可稍后重试（保留本地结果）。" });
      const retry = err.createEl("button", { cls: "kg-btn", text: "重试" });
      retry.addEventListener("click", () => runQuery({ forceAi: true }));
      if (st.localCount > 0) this.renderQueryLocalList(section, st);
      return;
    }
    if (st.status === "done" && !st.result) {
      if (st.localCount === 0) {
        section.createDiv({ cls: "kg-empty", text: "没有找到相关笔记。换个关键词试试（本地检索，未调用 AI）。" });
      } else {
        section.createDiv({ cls: "kg-query-state", text: "没有找到足够相关的知识。" });
        section.createDiv({ cls: "kg-empty", text: "本地找到 " + st.localCount + " 篇弱相关笔记。是否仍然探索？" });
        const weak = section.createEl("button", { cls: "kg-btn", text: "仍然探索" });
        weak.addEventListener("click", () => runQuery({ allowWeak: true }));
        this.renderQueryLocalList(section, st);
      }
      return;
    }

    // ---- 成功结果（缓存命中则 0 AI 请求，§五十） ----
    if (!st.result) return;
    section.createDiv({ cls: "kg-cache-status", text: "本地找到 " + st.localCount + " 篇 · 候选 " + st.candidateCount + " 篇" + (st.fromCache ? "（复用 AI 缓存）" : "") + " · 范围：" + st.scopeLabel });
    const model = normalizeQueryResult(st.result, st.cacheKey, st.rawQuery);
    if (model && model.nodes.length > 1) {
      this.plugin.decorateGraphEdges(model);

      const box = section.createDiv({ cls: "kg-graph-box" });
      const layout = computeGraphLayout(model, box.clientWidth || 760, box.clientHeight || 380);
      this.graph = new GraphSvg(box, model, layout, {
        onOpenNote: (p) => {
          if (p === QUERY_NODE_PATH) { runQuery(); return; }
          this.openNote(p);
        },
      });
      const toolbar = section.createDiv({ cls: "kg-graph-toolbar" });
      const zoom = toolbar.createDiv({ cls: "kg-graph-zoom" });
      const plus = zoom.createEl("button", { cls: "kg-btn kg-btn-icon", text: "+", attr: { title: "放大", "aria-label": "放大" } });
      plus.addEventListener("click", () => { if (this.graph) this.graph.zoomIn(); });
      const minus = zoom.createEl("button", { cls: "kg-btn kg-btn-icon", text: "−", attr: { title: "缩小", "aria-label": "缩小" } });
      minus.addEventListener("click", () => { if (this.graph) this.graph.zoomOut(); });
      const home = zoom.createEl("button", { cls: "kg-btn kg-btn-icon", text: "⌂", attr: { title: "重置视图", "aria-label": "重置视图" } });
      home.addEventListener("click", () => { if (this.graph) this.graph.fit(); });
      const saveBtn = toolbar.createEl("button", { cls: "kg-btn kg-btn-primary", text: "☆ 保存链路" });
      saveBtn.addEventListener("click", () => { void plugin.saveQueryExploration(); });
      const reBtn = toolbar.createEl("button", { cls: "kg-btn", text: "重新探索" });
      reBtn.addEventListener("click", () => runQuery());
      const forceBtn = toolbar.createEl("button", { cls: "kg-btn", text: "强制重新探索" });
      forceBtn.addEventListener("click", () => runQuery({ forceAi: true }));
    } else {
      section.createDiv({ cls: "kg-empty", text: "AI 没有给出可用的连接关系（可能证据不足）。" });
    }
    // AI 观察面板（§三十七：图不是装饰，是可解释的探索） —— 与图并列，独立于今日漫游（§四十六）
    const panel = section.createDiv({ cls: "kg-graph-insight" });
    panel.createDiv({ cls: "kg-ai-label", text: "✦ AI 为什么把这些连起来？" });
    if (st.result.headline) panel.createDiv({ cls: "kg-ai-title", text: st.result.headline });
    if (st.result.summary) panel.createDiv({ cls: "kg-ai-body", text: st.result.summary });
    if (st.result.insights.length > 0) {
      panel.createDiv({ cls: "kg-ai-label", text: "观察" });
      for (const ins of st.result.insights) panel.createDiv({ cls: "kg-ai-body", text: "· " + ins });
    }
    if (st.result.suggestedQuestions && st.result.suggestedQuestions.length > 0) {
      panel.createDiv({ cls: "kg-ai-label", text: "值得继续思考" });
      for (const q of st.result.suggestedQuestions) panel.createDiv({ cls: "kg-ai-body", text: "? " + q });
    }
  }

  /** 本地检索命中的笔记列表（AI 失败/弱相关时展示，§六十六：明确“本地找到”） */
  private renderQueryLocalList(section: HTMLElement, st: { rawQuery: string; scopeMode: QueryScopeMode; localCount: number }): void {
    const plugin = this.plugin;
    const parsed = parseQuery(st.rawQuery);
    const allNotes = plugin.index.all();
    const notesById = new Map(allNotes.map((n) => [n.path, n]));
    const scopePaths = queryScopePaths(st.scopeMode, allNotes, plugin.settings.discovery?.roaming?.scope, plugin.settings.knowledgeAreas);
    const docs = plugin.searchIndex.search(parsed.tokens, plugin.settings.queryExplorer.localResultLimit ?? 50).filter((d) => scopePaths.has(d.path));
    const ranked = rankSearchResults(docs, parsed.tokens, plugin.settings.knowledgeAreas, notesById);
    // Phase 10 Test 15：已确认关系加权（0 AI）——两端都被命中的确认关系提升排序
    const hitPaths = new Set(ranked.map((r) => r.doc.path));
    const boost = new Map<string, number>();
    for (const rel of plugin.relationships.confirmed()) {
      if (hitPaths.has(rel.from) && hitPaths.has(rel.to)) {
        boost.set(rel.from, (boost.get(rel.from) || 0) + 1);
        boost.set(rel.to, (boost.get(rel.to) || 0) + 1);
      }
    }
    let linkCount = 0;
    for (const v of boost.values()) linkCount += v;
    linkCount = linkCount / 2;
    const rankedFinal = ranked
      .map((r) => ({ ...r, score: r.score + (boost.get(r.doc.path) || 0) * 3 }))
      .sort((a, b) => b.score - a.score);
    const list = section.createDiv({ cls: "kg-note-list" });
    list.createDiv({ cls: "kg-ai-label", text: "本地相关笔记（" + rankedFinal.length + " 篇）" + (linkCount > 0 ? " · 已确认关系链路 " + linkCount + " 条" : "") });
    for (const r of rankedFinal.slice(0, 10)) {
      const row = list.createDiv({ cls: "kg-note-item" });
      row.createSpan({ cls: "kg-note-title", text: (r.doc.title || this.basename(r.doc.path)) + (r.area ? "（" + r.area + "）" : "") });
      row.createSpan({ cls: "kg-note-meta", text: r.doc.path });
      row.addEventListener("click", () => this.openNote(r.doc.path));
    }
  }

  /* ---------- Saved Exploration 收藏入口（保存/打开/删除全部 0 AI） ---------- */
  /** §五十：今日奇想保存按钮——收藏当前 AI 奇想（问题 + 连接解释），fingerprint 去重（同链路不重复收藏）。 */
  private renderCuriositySaveRow(section: HTMLElement, insight: AIInsight): void {
    const plugin = this.plugin;
    if (!insight || !insight.notes || insight.notes.length === 0) return;
    const nodes = insight.notes.map((n) => ({ path: n.path, reason: n.reason }));
    const fp = savedFingerprint("daily_curiosity", normalizeQuery(insight.title || ""), nodes, []);
    const existing = plugin.findSaved(fp);
    const row = section.createDiv({ cls: "kg-saved-row" });
    const btn = row.createEl("button", { cls: "kg-btn" + (existing ? " kg-btn-minor" : " kg-btn-primary"), text: existing ? "★ 已收藏" : "☆ 保存链路" });
    btn.setAttr("title", existing ? "这条今日奇想已在收藏中" : "收藏当前 AI 奇想（问题 + 连接解释，0 AI 请求）");
    btn.addEventListener("click", () => {
      void plugin.saveExploration({
        source: "daily_curiosity",
        title: insight.title || "今日奇想",
        query: insight.title,
        normalizedQuery: normalizeQuery(insight.title || ""),
        headline: insight.title,
        summary: insight.summary,
        nodes,
        edges: [],
      });
      btn.setText("★ 已收藏");
    });
    if (existing) {
      const open = row.createEl("button", { cls: "kg-btn kg-btn-minor", text: "查看" });
      open.addEventListener("click", () => plugin.activateSavedView());
    }
  }

  /** §五十一：知识漫游保存按钮——收藏完整节点 + 边 + AI 当时的解释，fingerprint 去重。 */
  private renderRoamSaveBtn(toolbar: HTMLElement, model: GraphModel): void {
    const plugin = this.plugin;
    if (!model || !model.nodes || model.nodes.length === 0) return;
    const nodes = model.nodes.filter((n) => n.path !== QUERY_NODE_PATH).map(({ path, label, role, reason }) => ({ path, label, role, reason }));
    const edges = model.edges.map(({ from, to, relation, direction, reason }) => ({ from, to, relation, direction, reason }));
    const fp = savedFingerprint("connection", "", nodes, edges);
    const existing = plugin.findSaved(fp);
    const btn = toolbar.createEl("button", { cls: "kg-btn kg-btn-primary" + (existing ? " kg-btn-minor" : ""), text: existing ? "★ 已收藏" : "☆ 保存此链路" });
    btn.setAttr("title", existing ? "这条连接路径已在收藏中" : "保存整条知识路径（节点 + 关系 + AI 解释，0 AI 请求）");
    btn.addEventListener("click", () => {
      void plugin.saveExploration({
        source: "connection",
        title: model.title || "知识漫游连接",
        headline: model.title,
        summary: model.summary,
        nodes,
        edges,
      });
      btn.setText("★ 已收藏");
    });
  }

  /** §二十一/二十二：Dashboard 收藏区——最近 5 条收藏链路，点击进入收藏 View（只读展示）。 */
  private renderSavedSection(section: HTMLElement): void {
    const plugin = this.plugin;
    const saved = plugin.saved.all().slice(0, 5);
    if (saved.length === 0) {
      section.createDiv({ cls: "kg-section-desc", text: "还没有收藏的知识链路。在今日奇想 / 知识漫游 / Query Explorer 的结果里点「☆ 保存链路 / 保存此链路」即可收藏当前 AI 探索路径。" });
      return;
    }
    const list = section.createDiv({ cls: "kg-note-list" });
    for (const entry of saved) {
      const row = list.createDiv({ cls: "kg-note-item" });
      row.createSpan({ cls: "kg-note-title", text: entry.title || "（无标题）" });
      row.createSpan({ cls: "kg-note-meta", text: this.savedSourceLabel(entry.source) + " · " + this.shortDay(entry.createdAt) });
      row.createSpan({ cls: "kg-note-meta", text: entry.markdownPath });
      row.addEventListener("click", () => plugin.activateSavedView());
    }
    const more = section.createEl("button", { cls: "kg-btn kg-btn-minor", text: "查看全部收藏" });
    more.addEventListener("click", () => plugin.activateSavedView());
  }

  private savedSourceLabel(source: SavedExplorationSource): string {
    return source === "daily_curiosity" ? "今日奇想" : source === "query_exploration" ? "Query 探索" : source === "connection" ? "知识漫游" : "手动收藏";
  }

  private shortDay(ts: number): string {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  /** 用户主动点击才发起 AI（只有「生成/重新生成」按钮与命令可触发） */
  private async generateConnections(btn: HTMLElement, force = false): Promise<void> {
    btn.addClass("kg-loading");
    btn.setText("生成中…");
    try {
      await this.plugin.runConnections(force);
    } finally {
      btn.removeClass("kg-loading");
      this.render();
    }
  }

  /** §27：点击知识区域 → 优先 Obsidian 原生文件浏览器定位文件夹；不可用则打开首篇笔记 */
  private revealArea(folder: string): void {
    const dir = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!(dir instanceof TFolder)) return;
    const fe = (this.app as unknown as {
      internalPlugins: { plugins: Record<string, { instance?: { revealInFolder?: (f: object) => void } }> };
    }).internalPlugins.plugins["file-explorer"]?.instance;
    if (fe && typeof fe.revealInFolder === "function") {
      try { fe.revealInFolder(dir); return; } catch { /* 忽略，走 fallback */ }
    }
    const first = this.app.vault.getFiles().find((f) => f.path.startsWith(dir.path + "/"));
    if (first) this.openNote(first.path);
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice("笔记不存在：" + path);
      return;
    }
    void this.app.workspace.openLinkText(file.basename, file.path, false);
  }

  private relTime(t: number | undefined): string {
    if (!t) return "从未";
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return mins + " 分钟前";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + " 小时前";
    const days = Math.floor(hours / 24);
    if (days === 1) return "昨天";
    if (days < 7) return days + " 天前";
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return weeks + " 周前";
    return Math.floor(days / 30) + " 个月前";
  }

  private basename(p: string): string {
    return p.split("/").pop()?.replace(/\.md$/, "") ?? p;
  }
  private two(n: number): string { return String(n).padStart(2, "0"); }
  private fmtDate(d: Date): string { return d.getFullYear() + "-" + this.two(d.getMonth() + 1) + "-" + this.two(d.getDate()); }
}
