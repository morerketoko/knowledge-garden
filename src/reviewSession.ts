/**
 * Phase 20：Review Session 2.0（Obsidian 独立 View ——「今日复习」）。
 *
 * 相比 Phase 8 版本新增：
 * - 🔄 刷新复习（§32~37：重算队列、保留已完成进度、不写 FSRS 日志、跨日自动切换、失败保留 UI；0 AI）
 * - 复习范围（§19~31：vault / current-note / folder / area / custom；始终可见；指纹决定队列键）
 * - 自动答案（§38~46/八十三：优先真实 Vault 原文摘录 300~800 字符；[隐藏答案] 只切 DOM；0 AI）
 * - 四种 FSRS Rating（§九/四十八~五十一：Again/Hard/Good/Easy；预览下次由 ts-fsrs 真实计算 §四十九）
 * - 掌握度与保持率分离展示（§五十三~五十七）+ 今日掌握概况/横向分布条（§58~60，纯 DOM/CSS）
 * - Skip（§10/21）与 Snooze（§11/22）不调用 FSRS；Rating 成功才 markReviewed（§94/95）
 * - Session 恢复 scope/currentIndex/队列（§97/98）
 */
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { ReviewQueue, ReviewQuestion, ReviewScope, ReviewScopeMode, ReviewQueueItem, FsrsRating } from "./types";
import { stateReason, resolveQuestion, sessionFinished, sortReviewQueueForList } from "./reviewCenter";
import {
  FSRS_RATINGS, FSRS_RATING_LABEL, FSRS_RATING_EMOJI,
  masteryConfidence, reviewBandOf, clampCustomFolders, CUSTOM_SCOPE_FOLDER_LIMIT,
  defaultReviewScope,
  type SpacedReviewCard, type MasteryBand,
} from "./spacedReview";
import type { DerivedAnswer } from "./reviewAnswer";

export const VIEW_TYPE_REVIEW = "knowledge-garden-review";

const DAY_MS = 86400000;
type SnoozeChoice = 1 | 3 | 7;
type ListSort = "forget" | "mastery" | "recent" | "next" | "recommend";

const BAND_LABEL: Record<MasteryBand, string> = {
  relearn: "需要重新学习 (0-39)",
  building: "正在建立 (40-59)",
  basic: "基本掌握 (60-79)",
  proficient: "熟练 (80-94)",
  mastered: "高度掌握 (95-100)",
};
const BAND_COLOR: Record<MasteryBand, string> = {
  relearn: "var(--color-red, #e53935)",
  building: "var(--color-orange, #ff9800)",
  basic: "var(--color-yellow, #fbc02d)",
  proficient: "var(--color-blue, #1e88e5)",
  mastered: "var(--color-green, #43a047)",
};

/* ---------- 纯展示辅助（不影响状态） ---------- */

function fmtAgo(ts: number | undefined, now: number): string {
  if (typeof ts !== "number") return "从未";
  const diff = now - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff < DAY_MS) return Math.floor(diff / 3600000) + " 小时前";
  const days = Math.floor(diff / DAY_MS);
  return days <= 1 ? "昨天" : days + " 天前";
}

function startOfDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 下次复习相对标签（含 due badge 用：🔴 已到期 / 🟠 今天 / 🟡 明天 / 🟢 N 天后） */
export function fmtDueText(due: number | undefined, now: number): { text: string; tone: "red" | "orange" | "yellow" | "green" } {
  if (typeof due !== "number") return { text: "—", tone: "green" };
  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  if (due <= now) return { text: dueDay === today ? "已到期" : "逾期 " + Math.max(1, Math.round((today - dueDay) / DAY_MS)) + " 天", tone: "red" };
  const dayDiff = Math.round((dueDay - today) / DAY_MS);
  if (dayDiff === 0) return { text: "今天", tone: "orange" };
  if (dayDiff === 1) return { text: "明天", tone: "yellow" };
  return { text: dayDiff + " 天后", tone: "green" };
}

export function fmtRelativeTimeLabel(due: number | undefined, now: number): string {
  const t = fmtDueText(due, now);
  return t.text === "—" ? "—" : t.text;
}

function pctBar(parent: HTMLElement, value: number | null, color?: string): void {
  const bar = parent.createDiv({ cls: "kg-mastery-bar" });
  const fill = bar.createDiv({ cls: "kg-mastery-fill" });
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  fill.style.width = v + "%";
  if (color) fill.style.background = color;
}

function clampIndex(idx: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(len - 1, Math.floor(idx)));
}

export class ReviewSessionView extends ItemView {
  private queue: ReviewQueue | null = null;
  private currentIndex = 0;
  private questions = new Map<string, ReviewQuestion>();
  private questionLoadedFor: string | null = null;
  private snoozeOpen = false;
  private scopeEditorOpen = false;
  private customInput = "";
  private hiddenAnswers = new Set<string>();          // §45：只改 DOM 状态
  private shownAnswers = new Set<string>();           // 默认隐藏时显式「显示答案」过的卡（§44）
  private answerCache = new Map<string, DerivedAnswer>();
  private answerLoading = new Set<string>();
  private expanded = new Set<string>();               // 高级 FSRS 展开（§63/64）
  private listSort: ListSort = "forget";              // §61：默认最可能忘记
  private refreshing = false;

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_REVIEW; }
  getDisplayText(): string { return "今日复习"; }
  getIcon(): string { return "check-circle"; }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.containerEl.addClass("kg-review");
    this.containerEl.createDiv({ cls: "kg-inner" });
    const q = this.plugin.ensureReviewQueue();
    if (!q) { this.renderEmptyRoot(); return; }
    this.applyQueue(q);
    await this.ensureQuestions(q);
    this.render();
  }

  /** 复用已有 leaf 时的入口 + 手动刷新共用（§32~37/40） */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const q = this.plugin.ensureReviewQueue();
      if (!q) { this.renderEmptyRoot(); return; }
      // 同周期同指纹 → 刷新重算（保留已完成/已跳过）；跨日/改指纹 → 全新队列（§36/98）
      const fresh = this.plugin.refreshReviewSessionQueue(q.scope ?? defaultReviewScope());
      if (!fresh) {
        new Notice("刷新失败，已保留当前复习进度。");   // §37
        return;
      }
      this.applyQueue(fresh);
      await this.ensureQuestions(fresh, false);
      this.render();
    } catch {
      new Notice("刷新失败，已保留当前复习进度。");       // §37：不要清空
    } finally {
      this.refreshing = false;
    }
  }

  async onClose(): Promise<void> {
    this.containerEl.empty();
  }

  /* ================= 状态应用 / 问题缓存 ================= */

  private applyQueue(q: ReviewQueue): void {
    const keyChanged = this.questionLoadedFor !== (q.key ?? q.periodKey);
    this.queue = q;
    this.currentIndex = this.plugin.reviewResumeIndex(q);
    if (keyChanged) this.questionLoadedFor = null;   // 新队列：问题重新加载（AI 只允许发生在 Question 场景 §93）
  }

  /** AI 复习问题（§93：保留 AI Review Question + AI Cache；失败 fallback 不阻塞）。refresh 期间不新增请求。 */
  private async ensureQuestions(q: ReviewQueue, allowFetch = true): Promise<void> {
    const key = q.key ?? q.periodKey;
    if (this.questionLoadedFor === key) return;
    if (!allowFetch) return;
    this.questionLoadedFor = key;
    try {
      this.questions = await this.plugin.reviewQuestions(q);
    } catch {
      this.questions = new Map();
    }
  }

  /* ================= Render ================= */

  private renderEmptyRoot(): void {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
    if (!inner) return;
    inner.empty();
    inner.createDiv({ cls: "kg-empty", text: "今天还没有复习队列。打开 Knowledge Garden → 「今日复习」即可生成（纯本地，不需要 AI）。" });
  }

  private render(): void {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement;
    if (!inner) return;
    inner.empty();
    const q = this.queue;
    if (!q) {
      inner.createDiv({ cls: "kg-empty", text: "当前没有复习队列。" });
      return;
    }
    const scope = q.scope ?? defaultReviewScope();
    this.renderHeader(inner, q, scope);
    if (q.items.length === 0) {
      this.renderNoCards(inner, scope);
      return;
    }
    if (sessionFinished(q)) {
      this.renderDone(inner, q);
      return;
    }
    // §五十八：今日掌握概况（0 AI）
    if (this.plugin.spacedEnabled()) this.renderOverview(inner, q, scope);
    this.renderCard(inner, q, scope);
    this.renderListSection(inner, q, scope);
  }

  private renderHeader(inner: HTMLElement, q: ReviewQueue, scope: ReviewScope): void {
    const head = inner.createDiv({ cls: "kg-section-title-row kg-review-head" });
    const titleWrap = head.createDiv({ cls: "kg-review-head-title" });
    titleWrap.createDiv({ cls: "kg-section-title", text: "今日复习" });
    titleWrap.createDiv({ cls: "kg-review-progress", text: this.progressText(q) });
    // 范围按钮（§26/27：范围必须可见；不是 Permission §28）
    const scopeBtn = head.createEl("button", { cls: "kg-btn kg-btn-icon", text: "📚 " + this.plugin.reviewScopeLabel(scope) + " ▼" });
    scopeBtn.addEventListener("click", () => { this.scopeEditorOpen = !this.scopeEditorOpen; this.render(); });
    // 🔄 刷新复习（§32）
    const refreshBtn = head.createEl("button", { cls: "kg-btn kg-btn-icon", text: "🔄 刷新复习" });
    refreshBtn.setAttr("title", "重新计算今日队列并刷新掌握度（0 AI，不重置进度）");
    refreshBtn.addEventListener("click", () => { void this.refresh(); });

    if (this.scopeEditorOpen) {
      inner.createDiv({ cls: "kg-review-scope-editor" }, (box) => this.renderScopeEditor(box, q, scope));
    }
    inner.createDiv({ cls: "kg-review-divider" });
  }

  private progressText(q: ReviewQueue): string {
    const done = q.completedCount + q.skippedCount;
    return done + " / " + q.items.length;
  }

  /* ---------- 范围选择器（§26：5 种模式；custom ≤10 文件夹 §25；0 AI §87） ---------- */

  private renderScopeEditor(box: HTMLElement, q: ReviewQueue, scope: ReviewScope): void {
    box.createDiv({ cls: "kg-review-qlabel", text: "复习范围：" });
    const modes: { id: ReviewScopeMode; label: string }[] = [
      { id: "vault", label: "🌐 整个 Vault" },
      { id: "current-note", label: "📄 当前笔记" },
      { id: "folder", label: "📁 当前文件夹" },
      { id: "area", label: "🗂 知识区域" },
      { id: "custom", label: "📚 自定义文件夹" },
    ];
    const modeRow = box.createDiv({ cls: "kg-row kg-scope-mode-row" });
    for (const m of modes) {
      const b = modeRow.createEl("button", { cls: "kg-btn" + (scope.mode === m.id ? " kg-btn-primary" : ""), text: m.label });
      b.addEventListener("click", () => this.applyScopeFromMode(m.id));
    }
    if (scope.mode === "current-note") {
      const active = this.plugin.app.workspace.getActiveFile();
      box.createDiv({ cls: "kg-review-meta", text: active ? "来源：《" + active.basename + "》（只复习该来源，§22）" : "当前没有打开的笔记 → 使用上一次来源或整个 Vault。" });
    }
    if (scope.mode === "folder") {
      const active = this.plugin.app.workspace.getActiveFile();
      const folder = active ? (active.path.split("/").slice(0, -1).join("/")) : "";
      box.createDiv({ cls: "kg-review-meta", text: folder ? "范围：📁 " + folder + "/（含子目录）" : "当前笔记在 Vault 根目录：等同整个 Vault。" });
    }
    if (scope.mode === "area") {
      const areas = this.plugin.settings.knowledgeAreas;
      if (areas.length === 0) {
        box.createDiv({ cls: "kg-empty", text: "还没有配置知识区域 → 设置 → Knowledge Areas 添加。" });
      } else {
        const areaRow = box.createDiv({ cls: "kg-row" });
        for (const a of areas) {
          const b = areaRow.createEl("button", { cls: "kg-btn" + (scope.areaId === a.id ? " kg-btn-primary" : ""), text: (a.icon || "📁") + " " + a.name });
          b.addEventListener("click", () => this.applyScopeMode("area", { areaId: a.id, folderPath: a.folder || undefined }));
        }
      }
    }
    if (scope.mode === "custom") {
      const folders = scope.folders ?? [];
      box.createDiv({ cls: "kg-review-qlabel", text: "自定义文件夹（最多 " + CUSTOM_SCOPE_FOLDER_LIMIT + " 个）" });
      const chips = box.createDiv({ cls: "kg-row" });
      for (const f of folders) {
        const chip = chips.createSpan({ cls: "kg-chip" });
        chip.setText(f + " ✕");
        chip.addEventListener("click", () => {
          const next = folders.filter((x) => x !== f);
          this.applyScopeMode("custom", { folders: next });
        });
      }
      const addRow = box.createDiv({ cls: "kg-row" });
      const input = addRow.createEl("input", { cls: "kg-input", attr: { placeholder: "如 01 盒子/游戏" } });
      input.value = this.customInput;
      input.addEventListener("input", () => { this.customInput = input.value; });
      const add = addRow.createEl("button", { cls: "kg-btn", text: "添加" });
      add.addEventListener("click", () => {
        const f = this.customInput.trim().replace(/\/+$/, "");
        this.customInput = "";
        if (!f) { new Notice("请输入文件夹路径。"); return; }
        const next = clampCustomFolders(Array.from(new Set([...folders, f])));
        if (next.length === folders.length && !folders.includes(f)) new Notice("自定义文件夹最多 " + CUSTOM_SCOPE_FOLDER_LIMIT + " 个。");
        this.applyScopeMode("custom", { folders: next });
      });
      if (folders.length === 0) {
        box.createDiv({ cls: "kg-empty", text: "未选择文件夹 → 等同整个 Vault（含全部顶层文件夹）。" });
      }
    }
  }

  private applyScopeFromMode(mode: ReviewScopeMode): void {
    const active = this.plugin.app.workspace.getActiveFile();
    if (mode === "current-note") {
      if (!active) { new Notice("当前没有打开的笔记。"); return; }
      this.applyScopeMode("current-note", { notePath: active.path });
      return;
    }
    if (mode === "folder") {
      const folder = active ? active.path.split("/").slice(0, -1).join("/") : "";
      if (!folder) { new Notice("当前笔记在 Vault 根目录，没有上级文件夹。"); return; }
      this.applyScopeMode("folder", { folderPath: folder });
      return;
    }
    // vault / area / custom 用当前 scope 字段（area/custom 在编辑器内再细化）
    const current: ReviewScope = mode === "vault" ? { mode: "vault" } : { ...(this.queue?.scope ?? defaultReviewScope()), mode };
    this.applyScopeMode(mode, current);
  }

  /** 应用新范围：新指纹 → 新本地队列（0 AI）；不沿用旧队列（§31）；范围始终显示（§27） */
  private applyScopeMode(mode: ReviewScopeMode, patch: Partial<ReviewScope>): void {
    const prev = (this.queue?.scope ?? defaultReviewScope()) as ReviewScope;
    const scope: ReviewScope = {
      mode,
      notePath: mode === "current-note" ? (patch.notePath ?? prev.notePath) : undefined,
      folderPath: mode === "folder" ? (patch.folderPath ?? prev.folderPath) : mode === "area" ? (patch.folderPath ?? prev.folderPath) : undefined,
      areaId: mode === "area" ? (patch.areaId ?? prev.areaId) : undefined,
      folders: mode === "custom" ? (patch.folders ?? prev.folders ?? []) : undefined,
      tags: mode === "custom" ? (patch.tags ?? prev.tags) : undefined,
    };
    const q = this.plugin.setReviewScope(scope);
    this.scopeEditorOpen = false;
    this.snoozeOpen = false;
    if (q) {
      this.applyQueue(q);
      void this.ensureQuestions(q);
      this.render();
    }
  }

  /* ---------- 空范围（§88：不调用 AI；提供操作入口） ---------- */

  private renderNoCards(inner: HTMLElement, scope: ReviewScope): void {
    const card = inner.createDiv({ cls: "kg-card kg-review-empty" });
    card.createDiv({ cls: "kg-empty", text: "当前范围没有到期复习卡。" });
    const areas = this.plugin.settings.knowledgeAreas.find((a) => a.id === scope.areaId);
    card.createDiv({ cls: "kg-review-meta", text: "范围：" + this.plugin.reviewScopeLabel(scope) + "（FSRS 已启用：到期卡 + 每日新卡都在这里按本地规则挑选，0 AI）" });
    const row = card.createDiv({ cls: "kg-row" });
    const vault = row.createEl("button", { cls: "kg-btn", text: "查看全部卡（整个 Vault）" });
    vault.addEventListener("click", () => this.applyScopeMode("vault", {}));
    const edit = row.createEl("button", { cls: "kg-btn", text: "修改范围" });
    edit.addEventListener("click", () => { this.scopeEditorOpen = true; this.render(); });
  }

  private renderDone(inner: HTMLElement, q: ReviewQueue): void {
    const card = inner.createDiv({ cls: "kg-card kg-review-done" });
    card.createDiv({ cls: "kg-review-done-title", text: "🎉 今日复习完成" });
    card.createDiv({ cls: "kg-review-progress", text: q.items.length + " / " + q.items.length });
    if (this.plugin.spacedEnabled()) {
      const stats = this.plugin.spacedStats(q.scope);
      const retr = stats.avgRetrievability === null ? "—" : Math.round(stats.avgRetrievability * 100) + "%";
      card.createDiv({ cls: "kg-review-meta", text: "今日复习 " + stats.reviewsToday + " 次 · 范围平均保持率 " + retr });
    }
    const areas = this.plugin.reviewContactAreas(q);
    if (areas.length > 0) {
      card.createDiv({ cls: "kg-review-meta", text: "你刚刚重新接触了：" });
      card.createDiv({ cls: "kg-review-areas", text: areas.join(" · ") });
    }
    const row = card.createDiv({ cls: "kg-row" });
    const back = row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "返回知识花园" });
    back.addEventListener("click", () => { void this.plugin.activateView(); });
    const again = row.createEl("button", { cls: "kg-btn", text: "🔄 刷新复习" });
    again.addEventListener("click", () => { void this.refresh(); });
  }

  /* ---------- 今日掌握概况（§58；纯 DOM/CSS，无 Chart.js） ---------- */

  private renderOverview(inner: HTMLElement, q: ReviewQueue, scope: ReviewScope): void {
    const stats = this.plugin.spacedStats(scope);
    const now = Date.now();
    const scopedCards = this.plugin.scopedSpacedCards(scope);
    const dueLow = scopedCards.filter((c) => {
      const r = this.plugin.spacedScheduler().retrievability(c.fsrsState, now);
      return c.fsrsState.due <= now && r !== null && r < 0.7;
    }).length;
    const stable = scopedCards.filter((c) => typeof c.masteryPercent === "number" && (c.masteryPercent as number) >= 80).length;
    const pendingCount = q.items.filter((i) => i.status === "pending" || i.status === "reviewing").length;

    const wrap = inner.createDiv({ cls: "kg-card kg-overview" });
    wrap.createDiv({ cls: "kg-review-qlabel", text: "今日掌握概况" });
    const nums = wrap.createDiv({ cls: "kg-overview-nums" });
    const mkNum = (label: string, value: number | string): void => {
      const cell = nums.createDiv({ cls: "kg-overview-num" });
      cell.createDiv({ cls: "kg-overview-value", text: String(value) });
      cell.createDiv({ cls: "kg-overview-label", text: label });
    };
    mkNum("需要复习", pendingCount);
    mkNum("即将遗忘", dueLow);
    mkNum("稳定掌握", stable);
    // §60：整体掌握分布（沿用 examEngine.masteryLabel 的同一套边界，0-39/40-59/60-79/80-94/95-100）
    const dist = { relearn: 0, building: 0, basic: 0, proficient: 0, mastered: 0 } as Record<MasteryBand, number>;
    for (const c of scopedCards) if (typeof c.masteryPercent === "number") dist[reviewBandOf(c.masteryPercent as number)]++;
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total > 0) {
      const distBox = wrap.createDiv({ cls: "kg-dist" });
      for (const band of Object.keys(BAND_LABEL) as MasteryBand[]) {
        const n = dist[band];
        const row = distBox.createDiv({ cls: "kg-dist-row" });
        row.createSpan({ cls: "kg-dist-label", text: BAND_LABEL[band] });
        const barRow = row.createDiv({ cls: "kg-dist-bar" });
        const fill = barRow.createDiv({ cls: "kg-mastery-fill" });
        fill.style.width = Math.round((n / total) * 100) + "%";
        fill.style.background = BAND_COLOR[band];
        row.createSpan({ cls: "kg-dist-count", text: String(n) });
      }
    }
  }

  /* ---------- 主卡片（§47） ---------- */

  private renderCard(inner: HTMLElement, q: ReviewQueue, scope: ReviewScope): void {
    const spaced = this.plugin.spacedEnabled();
    const item = q.items[clampIndex(this.currentIndex, q.items.length)];
    if (!item) return;
    const note = this.plugin.index.all().find((x) => x.path === item.path);
    const now = Date.now();
    const card = inner.createDiv({ cls: "kg-card kg-review-card" });
    const titleRow = card.createDiv({ cls: "kg-row kg-card-title-row" });
    titleRow.createDiv({ cls: "kg-review-title", text: "《" + this.plugin.basename(item.path) + "》" });
    const area = this.plugin.reviewAreaOf(item.path);
    card.createDiv({ cls: "kg-review-meta", text: (area ? area + " · " : "") + stateReason(item.stateAtSelection) });

    // 该笔记 FSRS 卡信息（§55：掌握度 ≠ 保持率）
    const fsrsCard = this.plugin.fsrsCardOf(item.path);
    const scheduler = this.plugin.spacedScheduler();
    const retention = fsrsCard ? scheduler.retrievability(fsrsCard.fsrsState, now) : null;
    const due = fsrsCard ? fsrsCard.fsrsState.due : item.dueAt;
    const dueLabel = fmtDueText(due, now);

    const chips = card.createDiv({ cls: "kg-row kg-chip-row" });
    const dueChip = chips.createSpan({ cls: "kg-chip kg-due-" + dueLabel.tone, text: dueLabel.text === "—" ? (spaced ? "新卡" : "从未复习") : dueLabel.text });
    if (fsrsCard) {
      chips.createSpan({ cls: "kg-chip", text: "已复习 " + fsrsCard.reviewCount + " 次" });
      const conf = masteryConfidence(fsrsCard.reviewCount);
      if (conf.low) chips.createSpan({ cls: "kg-chip", text: "数据较少" });
    }

    // 问题区（AI Question 只是复习提示；失败 fallback 系统问题，§82/25）
    card.createDiv({ cls: "kg-review-divider" });
    const qBlock = card.createDiv({ cls: "kg-review-question" });
    const qLabel = qBlock.createDiv({ cls: "kg-review-question-label", text: "❓ 问题：" });
    qLabel.setAttr("title", "AI 复习问题（每周期一次，缓存感知）；关闭/失败时使用系统问题，0 阻塞");
    qBlock.createDiv({ cls: "kg-review-question-text", text: resolveQuestion(this.questions, item.path) });

    // 📖 原文依据（§42；优先真实 Vault，绝不 AI 编造 §39/八十三）
    card.createDiv({ cls: "kg-review-divider" });
    const answerArea = card.createDiv({ cls: "kg-answer-area" });
    const defaultHidden = this.plugin.settings.reviewCenter?.showAnswerByDefault === false;   // §44：默认显示（可设默认隐藏）
    const hidden = defaultHidden ? !this.shownAnswers.has(item.path) : this.hiddenAnswers.has(item.path);
    const ansHeader = answerArea.createDiv({ cls: "kg-row kg-answer-header" });
    ansHeader.createDiv({ cls: "kg-answer-title", text: "📖 原文依据" });
    const hideBtn = ansHeader.createEl("button", { cls: "kg-btn", text: hidden ? "显示答案" : "隐藏答案" });
    hideBtn.addEventListener("click", () => {
      if (defaultHidden) {
        if (this.shownAnswers.has(item.path)) this.shownAnswers.delete(item.path); else this.shownAnswers.add(item.path);
      } else {
        if (hidden) this.hiddenAnswers.delete(item.path); else this.hiddenAnswers.add(item.path);
      }
      if (hidden) {
        // 由隐藏 → 显示：若答案体尚未加载（默认隐藏场景）则惰性读取原文（0 AI）
        const box = answerArea.querySelector(".kg-answer-body") as HTMLElement | null;
        if (box) box.style.display = "";
        else void this.renderAnswerBody(answerArea, item, note?.title);
      } else {
        const box = answerArea.querySelector(".kg-answer-body") as HTMLElement | null;
        if (box) box.style.display = "none";   // §45/46：只切 DOM，不重渲染整 View
      }
    });
    if (!hidden) {
      void this.renderAnswerBody(answerArea, item, note?.title);
    }

    // AI 提示（§43：AI 提示 ≠ 原文证据；只作辅助）
    const hint = this.questions.get(item.path)?.answerHint;
    if (hint && !hidden) {
      const hintBox = card.createDiv({ cls: "kg-review-hint" });
      hintBox.createDiv({ cls: "kg-review-qlabel", text: "AI 提示（非原文证据）" });
      hintBox.createDiv({ text: hint });
    }

    card.createDiv({ cls: "kg-review-divider" });

    if (!spaced) {
      this.renderLegacyActions(card, q, item);
    } else {
      this.renderFsrsActions(card, q, item, fsrsCard, scheduler, now, dueLabel);
    }
  }

  /** 原文摘录渲染（异步读取真实笔记；0 AI）。found=false → 「原文内容见 [[笔记]]」+ 打开按钮（§40.5） */
  private async renderAnswerBody(area: HTMLElement, item: ReviewQueueItem, title?: string): Promise<void> {
    const cached = this.answerCache.get(item.path);
    let answer: DerivedAnswer;
    if (cached) {
      answer = cached;
    } else if (this.answerLoading.has(item.path)) {
      return;   // 正在加载，已有一轮异步 render 会补上
    } else {
      this.answerLoading.add(item.path);
      try {
        const question = this.questions.get(item.path)?.question;
        answer = await this.plugin.deriveReviewAnswer(item.path, question);
        this.answerCache.set(item.path, answer);
      } finally {
        this.answerLoading.delete(item.path);
      }
    }
    if (area.isConnected !== true) return;   // 容器已被替换
    const body = area.createDiv({ cls: "kg-answer-body" });
    if (answer.found && answer.excerpt) {
      if (answer.heading) body.createDiv({ cls: "kg-answer-heading", text: "§ " + answer.heading });
      body.createDiv({ cls: "kg-answer-text", text: answer.excerpt });
    } else {
      body.createDiv({ cls: "kg-answer-missing", text: "原文内容见 [[笔记]]" });
    }
    const source = body.createDiv({ cls: "kg-row kg-answer-source" });
    source.createSpan({ cls: "kg-review-qlabel", text: "来源：" + (title || item.path) });
    const open = source.createEl("button", { cls: "kg-btn", text: "打开笔记" });
    open.addEventListener("click", () => { this.plugin.openNote(item.path); });   // §86：点击来源打开真实笔记，0 AI
  }

  /* ---------- FSRS 关闭时的旧交互（✓已复习/跳过/稍后再看） ---------- */

  private renderLegacyActions(card: HTMLElement, q: ReviewQueue, item: ReviewQueueItem): void {
    const done = item.status === "completed" || item.status === "skipped";
    const actions = card.createDiv({ cls: "kg-row" });
    const viewBtn = actions.createEl("button", { cls: "kg-btn", text: "查看笔记" });
    viewBtn.addEventListener("click", () => { this.plugin.openNote(item.path); });
    const doneBtn = actions.createEl("button", { cls: "kg-btn kg-btn-primary", text: "✓ 已复习", attr: done ? { disabled: "true" } : {} });
    doneBtn.addEventListener("click", () => { this.act(() => this.plugin.completeReviewItem(item.path)); });
    const skipBtn = actions.createEl("button", { cls: "kg-btn", text: "跳过" });
    skipBtn.addEventListener("click", () => { this.act(() => this.plugin.skipReviewItem(item.path)); });
    const snoozeBtn = actions.createEl("button", { cls: "kg-btn", text: "稍后再看" });
    snoozeBtn.addEventListener("click", () => { this.snoozeOpen = !this.snoozeOpen; this.render(); });
    if (this.snoozeOpen) this.renderSnoozeRow(card, item);
    this.renderNavRow(card, q);
  }

  private renderSnoozeRow(card: HTMLElement, item: ReviewQueueItem): void {
    const row = card.createDiv({ cls: "kg-row" });
    row.createSpan({ cls: "kg-review-qlabel", text: "稍后再看：" });
    for (const days of [1, 3, 7] as SnoozeChoice[]) {
      const b = row.createEl("button", { cls: "kg-btn", text: days === 1 ? "明天" : days + " 天后" });
      b.addEventListener("click", () => { this.act(() => this.plugin.snoozeReviewItem(item.path, days)); });
    }
  }

  private renderNavRow(card: HTMLElement, q: ReviewQueue): void {
    const nav = card.createDiv({ cls: "kg-row kg-review-nav" });
    const prevBtn = nav.createEl("button", { cls: "kg-btn", text: "← 上一个" });
    const prevIdx = this.plugin.reviewPrevIndex(q, this.currentIndex);
    prevBtn.disabled = prevIdx === null;
    prevBtn.addEventListener("click", () => { if (prevIdx !== null) { this.currentIndex = prevIdx; this.render(); } });
    const nextBtn = nav.createEl("button", { cls: "kg-btn", text: "下一个 →" });
    const nextIdx = this.plugin.reviewNextIndex(q, this.currentIndex);
    nextBtn.disabled = nextIdx === null;
    nextBtn.addEventListener("click", () => { if (nextIdx !== null) { this.currentIndex = nextIdx; this.render(); } });
  }

  /* ---------- FSRS Rating（§九/48~51/四十九：预览由 ts-fsrs 真实计算） ---------- */

  private renderFsrsActions(
    card: HTMLElement,
    q: ReviewQueue,
    item: ReviewQueueItem,
    fsrsCard: SpacedReviewCard | undefined,
    scheduler: ReturnType<KnowledgeGardenPlugin["spacedScheduler"]>,
    now: number,
    dueLabel: { text: string; tone: string }
  ): void {
    const state = fsrsCard ? fsrsCard.fsrsState : null;
    const previews = scheduler.previewAll(state, now);   // §49：不写死，真实 preview
    // 每档预览：下次时间（真实 FSRS 结果）
    const previewRow = card.createDiv({ cls: "kg-review-preview-row" });
    const mkPreview = (r: FsrsRating): void => {
      const cell = previewRow.createDiv({ cls: "kg-preview-cell" });
      cell.createDiv({ cls: "kg-review-qlabel", text: FSRS_RATING_EMOJI[r] + " " + FSRS_RATING_LABEL[r] });
      cell.createDiv({ cls: "kg-preview-due", text: this.previewDueText(previews[r].due, previews[r].intervalDays, now) });
    };
    for (const r of FSRS_RATINGS) mkPreview(r);

    const buttons = card.createDiv({ cls: "kg-row kg-rating-row" });
    const done = item.status === "completed" || item.status === "skipped";
    for (const r of FSRS_RATINGS) {
      const b = buttons.createEl("button", { cls: "kg-btn kg-rating kg-rating-" + r, text: FSRS_RATING_EMOJI[r] + " " + FSRS_RATING_LABEL[r] });
      if (done) b.disabled = true;
      b.addEventListener("click", () => { this.rateAndNext(item.path, r); });
    }
    if (fsrsCard && typeof fsrsCard.masteryPercent === "number") {
      const masteryRow = card.createDiv({ cls: "kg-row kg-card-meta-row" });
      masteryRow.createSpan({ cls: "kg-review-qlabel", text: "掌握度（历史评分）" });
      pctBar(masteryRow, fsrsCard.masteryPercent ?? null, undefined);
      masteryRow.createSpan({ cls: "kg-mastery-pct", text: fsrsCard.masteryPercent + "%" });
      const conf = masteryConfidence(fsrsCard.reviewCount);
      if (conf.low) masteryRow.createSpan({ cls: "kg-chip", text: conf.hint });
    }
    // §55：掌握度与当前保持率分开展示
    const retr = scheduler.retrievability(state, now);
    if (retr !== null) {
      const retrRow = card.createDiv({ cls: "kg-row kg-card-meta-row" });
      retrRow.createSpan({ cls: "kg-review-qlabel", text: "当前保持率（FSRS）" });
      pctBar(retrRow, Math.round(retr * 100), undefined);
      retrRow.createSpan({ cls: "kg-mastery-pct", text: Math.round(retr * 100) + "%" });
    }

    // 高级 FSRS 展开（§63/64：默认不塞满 UI；仅用户需要时显示）
    const expandRow = card.createDiv({ cls: "kg-row" });
    const expandBtn = expandRow.createEl("button", { cls: "kg-btn", text: this.expanded.has(item.path) ? "收起 FSRS 状态" : "FSRS 状态详情" });
    expandBtn.addEventListener("click", () => {
      if (this.expanded.has(item.path)) this.expanded.delete(item.path); else this.expanded.add(item.path);
      this.render();
    });
    if (this.expanded.has(item.path) && fsrsCard) {
      const s = fsrsCard.fsrsState;
      const info = card.createDiv({ cls: "kg-fsrs-info" });
      const rows: [string, string][] = [
        ["稳定性", (typeof s.stability === "number" ? s.stability : 0).toFixed(1) + " 天"],
        ["当前保持率", retr === null ? "—" : Math.round(retr * 100) + "%"],
        ["难度", (typeof s.difficulty === "number" ? s.difficulty : 0).toFixed(1)],
        ["上次复习", fmtAgo(fsrsCard.lastReviewedAt, now)],
        ["下次", dueLabel.text],
        ["复习次数 / 遗忘次数", fsrsCard.reviewCount + " / " + s.lapses],
      ];
      for (const [k, v] of rows) {
        const line = info.createDiv({ cls: "kg-row" });
        line.createSpan({ cls: "kg-review-qlabel", text: k });
        line.createSpan({ text: v });
      }
    }

    const altRow = card.createDiv({ cls: "kg-row kg-review-nav" });
    const skipBtn = altRow.createEl("button", { cls: "kg-btn", text: "跳过（不改变 FSRS）" });
    skipBtn.setAttr("title", "跳过不调用 FSRS：不改 stability/difficulty/due（§10/21）");
    skipBtn.addEventListener("click", () => { this.act(() => this.plugin.skipReviewItem(item.path)); });
    const snoozeBtn = altRow.createEl("button", { cls: "kg-btn", text: "稍后再看（不改变 FSRS）" });
    snoozeBtn.setAttr("title", "稍后再看不调用 FSRS，只改 session/queue（§11/22）");
    snoozeBtn.addEventListener("click", () => { this.snoozeOpen = !this.snoozeOpen; this.render(); });
    if (this.snoozeOpen) this.renderSnoozeRow(card, item);
    this.renderNavRow(card, q);
  }

  private previewDueText(due: number, intervalDays: number, now: number): string {
    // 学习/重学步骤（<1 天）用分钟数更直观；否则用日期差
    if (intervalDays < 1 && intervalDays > 0) {
      const mins = Math.max(1, Math.round(intervalDays * 1440));
      return mins < 60 ? mins + " 分钟后" : Math.floor(mins / 60) + " 小时后";
    }
    return fmtRelativeTimeLabel(due, now);
  }

  /** §50/51：Rating → FSRS 保存成功 → 进入下一张 due 卡；失败保留当前卡（main 已拦截） */
  private rateAndNext(path: string, rating: FsrsRating): void {
    const ok = this.plugin.rateReviewItem(path, rating);
    if (!ok) return;
    const q = this.plugin.ensureReviewQueue();
    if (q) {
      this.queue = q;
      if (!sessionFinished(q)) this.currentIndex = this.plugin.reviewResumeIndex(q);
    }
    this.snoozeOpen = false;
    this.render();
  }

  private act(fn: () => void): void {
    fn();
    const q = this.plugin.ensureReviewQueue();
    if (q) {
      this.queue = q;
      if (!sessionFinished(q)) this.currentIndex = this.plugin.reviewResumeIndex(q);
    }
    this.snoozeOpen = false;
    this.render();
  }

  /* ---------- 复习列表（§53/54/61：标题 + 掌握度 + 当前保持率 + 下次 + 排序） ---------- */

  private renderListSection(inner: HTMLElement, q: ReviewQueue, scope: ReviewScope): void {
    const spaced = this.plugin.spacedEnabled();
    const section = inner.createDiv({ cls: "kg-section" });
    section.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "复习列表" });

    const sortRow = section.createDiv({ cls: "kg-row kg-sort-row" });
    sortRow.createSpan({ cls: "kg-review-qlabel", text: "排序：" });
    const sortOpts: { id: ListSort; label: string }[] = [
      { id: "forget", label: "最可能忘记" },
      { id: "recommend", label: "推荐" },
      { id: "mastery", label: "掌握度低" },
      { id: "recent", label: "最近复习" },
      { id: "next", label: "下次复习" },
    ];
    for (const o of sortOpts) {
      const b = sortRow.createEl("button", { cls: "kg-btn" + (this.listSort === o.id ? " kg-btn-primary" : ""), text: o.label });
      b.addEventListener("click", () => { this.listSort = o.id; this.render(); });
    }

    const meta = (p: string) => {
      const card = spaced ? this.plugin.fsrsCardOf(p) : undefined;
      const sched = spaced ? this.plugin.spacedScheduler() : null;
      return {
        due: spaced ? (card ? card.fsrsState.due : undefined) : undefined,
        retrievability: spaced && card && sched ? sched.retrievability(card.fsrsState, Date.now()) : null,
        mastery: spaced ? card?.masteryPercent : undefined,
        lastReviewedAt: spaced ? card?.lastReviewedAt : this.plugin.activity.get(p)?.lastReviewedAt,
      };
    };
    const sorted = sortReviewQueueForList(q.items, this.listSort, meta);

    const list = section.createDiv({ cls: "kg-note-list" });
    const now = Date.now();
    for (const it of sorted) {
      const m = meta(it.path);
      const row = list.createDiv({ cls: "kg-note-item kg-list-item" + (it.path === (q.items[this.currentIndex]?.path) ? " kg-list-active" : "") });
      const main = row.createDiv({ cls: "kg-list-main" });
      const titleRow = main.createDiv({ cls: "kg-row kg-list-title-row" });
      titleRow.createSpan({ cls: "kg-note-title", text: "《" + this.plugin.basename(it.path) + "》" });
      if (it.status === "completed") titleRow.createSpan({ cls: "kg-chip", text: "✓ 已复习" });
      else if (it.status === "skipped") titleRow.createSpan({ cls: "kg-chip", text: "已跳过" });
      else {
        const dueTone = fmtDueText(m.due, now);
        titleRow.createSpan({ cls: "kg-chip kg-due-" + dueTone.tone, text: dueTone.text });
      }
      const metaRow = main.createDiv({ cls: "kg-row kg-list-meta" });
      if (spaced && m.mastery !== undefined) {
        metaRow.createSpan({ cls: "kg-review-qlabel", text: "掌握度" });
        pctBar(metaRow, m.mastery ?? null, undefined);
        metaRow.createSpan({ cls: "kg-mastery-pct", text: m.mastery + "%" });
      }
      if (spaced && m.retrievability !== null) {
        metaRow.createSpan({ cls: "kg-review-qlabel", text: "保持率" });
        pctBar(metaRow, Math.round((m.retrievability ?? 0) * 100), "var(--color-blue, #1e88e5)");
        metaRow.createSpan({ cls: "kg-mastery-pct", text: Math.round((m.retrievability ?? 0) * 100) + "%" });
      }
      metaRow.createSpan({ cls: "kg-review-days", text: spaced ? (m.due ? "下次：" + fmtRelativeTimeLabel(m.due, now) : "新卡") : (fmtAgo(m.lastReviewedAt, now) === "从未" ? "从未复习" : fmtAgo(m.lastReviewedAt, now)) });
      const sub = row.createDiv({ cls: "kg-review-meta" });
      sub.setText(stateReason(it.stateAtSelection) + (this.plugin.reviewAreaOf(it.path) ? " · " + this.plugin.reviewAreaOf(it.path) : ""));
      row.addEventListener("click", () => {
        const idx = q.items.findIndex((x) => x.path === it.path);
        if (idx >= 0 && (it.status === "pending" || it.status === "reviewing")) {
          this.currentIndex = idx;
          this.render();
        }
      });
    }
  }
}
