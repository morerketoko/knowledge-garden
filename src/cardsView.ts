/**
 * Phase 21：📚 我的复习卡（CardsView 升级版，§九~§三十一/§60~63）。
 * - 全面接入 Phase 20 FSRS：Refresh / 范围(vault·current-note·folder·area·exam·custom) / Auto Answer /
 *   掌握度(EWMA)与保持率(FSRS retrievability)分离展示 / 4 档 Rating 真实预览 / Due 徽标 / 排序。
 * - 打开/刷新/切范围/显示隐藏答案/评分/打开来源与来源考试：全部 0 AI（§86/165）。
 * - Skip 不调用 FSRS（§30）；Snooze 不模拟 Again（§31）；Rating = 真实复习（§137）。
 * - 选择题保持卡片 UI（§32/34）：选项 → 作答 → ✅ 正确答案 → FSRS Rating（§94）。
 */
import { App, ItemView, Modal, WorkspaceLeaf, Notice } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { SavedReviewCard, SavedCardScope, SavedCardScopeMode, FsrsRating } from "./types";
import { examTypeLabel } from "./examView";
import {
  ANSWER_FALLBACK, answerVisibility, toggleAnswerVisibility, revealDomAction, answerBodyContent,
} from "./reviewCardAnswer";
import {
  FSRS_RATINGS, FSRS_RATING_LABEL, FSRS_RATING_EMOJI, masteryConfidence,
  defaultSavedCardScope, savedCardScopeText, savedCardOverview, clampCustomFolders, CUSTOM_SCOPE_FOLDER_LIMIT,
  isNewSavedCard, rankSavedCards, type SavedCardSpacedState, type MasteryBand, type SavedCardSortMode,
} from "./spacedReview";

export const VIEW_TYPE_CARDS = "knowledge-garden-cards";

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
const DAY_MS = 86400000;

/** 删除确认 Modal（Phase 21.x §4/61：Obsidian Modal，不用 window.confirm） */
class CardDeleteConfirmModal extends Modal {
  constructor(app: App, private question: string, private onConfirm: () => void) {
    super(app);
  }
  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.addClass("kg-dashboard");
    this.contentEl.createEl("h3", { text: "确定删除这张复习卡？" });
    this.contentEl.createEl("p", { text: "《" + (this.question || "无题").slice(0, 60) + "》" });
    this.contentEl.createEl("p", { text: "删除将同时移除：复习卡、其 FSRS 状态、该卡复习历史。不会删除：原笔记、来源考试、AI Cache。" });
    const row = this.contentEl.createDiv({ cls: "kg-row" });
    row.createEl("button", { cls: "kg-btn", text: "取消" }).addEventListener("click", () => this.close());
    row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "确认删除" }).addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }
  onClose(): void { this.contentEl.empty(); }
}

type ListSort = SavedCardSortMode;

function fmtDue(due: number | undefined, now: number): { text: string; tone: string } {
  if (typeof due !== "number") return { text: "—", tone: "green" };
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dd = new Date(due);
  const dueDay = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate()).getTime();
  if (due <= now) return { text: dueDay === today ? "已到期" : "逾期", tone: "red" };
  const diff = Math.round((dueDay - today) / DAY_MS);
  if (diff === 0) return { text: "今天", tone: "orange" };
  if (diff === 1) return { text: "明天", tone: "yellow" };
  return { text: diff + " 天后", tone: "green" };
}
function fmtDueText(due: number | undefined, now: number): string { return fmtDue(due, now).text; }
function fmtAgo(ts: number | undefined, now: number): string {
  if (typeof ts !== "number") return "从未";
  const diff = now - ts;
  if (diff < DAY_MS) return diff < 3600000 ? Math.floor(diff / 60000) + " 分钟前" : Math.floor(diff / 3600000) + " 小时前";
  return Math.floor(diff / DAY_MS) <= 1 ? "昨天" : Math.floor(diff / DAY_MS) + " 天前";
}
function fmtPreview(intervalDays: number, due: number, now: number): string {
  if (intervalDays < 1 && intervalDays > 0) {
    const mins = Math.max(1, Math.round(intervalDays * 1440));
    return mins < 60 ? mins + " 分钟后" : Math.floor(mins / 60) + " 小时后";
  }
  return fmtDueText(due, now);
}

export class CardsView extends ItemView {
  private cards: SavedReviewCard[] = [];
  private cardScope: SavedCardScope = defaultSavedCardScope();
  private scopeEditorOpen = false;
  private customInput = "";
  private listSort: ListSort = "forget";           // §27：默认最可能忘记
  private deleting = new Set<string>();            // Phase 21.x：连点防重（P-HF-DELETE-15）
  private hiddenAnswers = new Set<string>();
  private shownAnswers = new Set<string>();
  private reviewing: SavedReviewCard[] = [];
  private reviewIndex = 0;
  private mode: "list" | "review" = "list";
  private chosenOption = "";
  private ratingDone = false;

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_CARDS; }
  getDisplayText(): string { return "📚 我的复习卡"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.containerEl.addClass("kg-cards");
    this.containerEl.createDiv({ cls: "kg-inner" });
    this.reloadCards();
    this.renderList();
  }

  async refresh(): Promise<void> { this.reloadCards(); this.mode = "list"; this.renderList(); }

  /** §76/52：外部预置范围（Exam Hub「已收藏 N」入口），0 AI */
  setScope(scope: SavedCardScope): void { this.cardScope = scope; this.reloadCards(); this.renderList(); }

  async onClose(): Promise<void> { this.containerEl.empty(); }

  private reloadCards(): void {
    // Phase 21 Hotfix §11/34：惰性 hydration——只对 options 缺失/无效的 MC 卡尝试从真实 ExamQuestion 恢复（0 AI）
    this.cards = this.plugin.hydrateSavedReviewCards(this.plugin.cards.all());
  }

  private scopedCards(): SavedReviewCard[] {
    const all = this.cards;
    if (!this.cardScope || this.cardScope.mode === "vault") return all;
    return all.filter((c) => this.inScope(c));
  }
  private inScope(c: SavedReviewCard): boolean {
    const s = this.cardScope;
    switch (s.mode) {
      case "current-note": return !!s.notePath && c.sourcePath === s.notePath;
      case "folder": return !!s.folderPath && this.inFolder(c.sourcePath, s.folderPath);
      case "area": return !!s.folderPath && this.inFolder(c.sourcePath, s.folderPath);
      case "exam": return !!s.examId && c.examId === s.examId;
      case "custom": {
        if (s.folders && s.folders.length && !s.folders.some((f) => this.inFolder(c.sourcePath, f))) return false;
        return true;
      }
      default: return true;
    }
  }
  private inFolder(p: string, folderPath: string): boolean {
    const fp = (folderPath || "").replace(/\/+$/, "");
    if (!fp) return true;
    if (p === fp || p === fp + ".md") return true;
    return p.startsWith(fp + "/");
  }

  private stateOf(id: string): SavedCardSpacedState | null { return this.plugin.savedCardStateOf(id); }

  private metaOf(c: SavedReviewCard): { due?: number; retrievability: number | null; mastery?: number; lastReviewedAt?: number } {
    const st = this.stateOf(c.id);
    if (!st) return { retrievability: null, mastery: undefined, lastReviewedAt: c.lastReviewedAt };
    const sched = this.plugin.spacedScheduler();
    return {
      due: st.fsrsState.due,
      retrievability: sched.retrievability(st.fsrsState, Date.now()),
      mastery: st.masteryPercent,
      lastReviewedAt: st.lastReviewedAt ?? c.lastReviewedAt,
    };
  }

  /* ================= 列表 ================= */

  private renderList(): void {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
    if (!inner) return;
    inner.empty();
    this.mode = "list";
    this.renderHeader(inner);
    const scoped = this.scopedCards();
    if (scoped.length === 0) {
      inner.createDiv({ cls: "kg-empty", text: this.scopeEmptyText() });
      return;
    }
    // 排序（默认最可能忘记；支持 🌱 新卡优先 / 推荐）
    const sorted = this.sortCards(scoped);
    const list = inner.createDiv({ cls: "kg-note-list kg-cards-body" });
    const now = Date.now();
    for (const c of sorted) {
      const m = this.metaOf(c);
      const st = this.stateOf(c.id);
      const isNew = isNewSavedCard(st);
      const examTitle = c.examId ? this.plugin.examStore.get(c.examId)?.title : undefined;
      const sourceGone = !this.plugin.index.get(c.sourcePath);
      const row = list.createDiv({ cls: "kg-note-item kg-list-item" });
      row.createDiv({ cls: "kg-card-question", text: (c.question || "").slice(0, 80) });
      const chips = row.createDiv({ cls: "kg-row kg-chip-row" });
      if (c.questionType === "multiple_choice") chips.createSpan({ cls: "kg-chip", text: "🅰 选择" });
      else chips.createSpan({ cls: "kg-chip", text: examTypeLabel(c.questionType) });
      if (isNew) {
        chips.createSpan({ cls: "kg-chip", text: "🌱 新卡 · 尚未复习" });   // §26：不显示成“最可能忘记/遗忘风险”
      } else {
        const due = m.due;
        const tone = fmtDue(due, now);
        chips.createSpan({ cls: "kg-chip kg-due-" + tone.tone, text: tone.text === "—" ? "已调度" : tone.text });
      }
      if (st) {
        const conf = masteryConfidence(st.reviewCount);
        if (conf.low) chips.createSpan({ cls: "kg-chip", text: conf.hint });
      }
      const metaRow = row.createDiv({ cls: "kg-row kg-list-meta" });
      if (typeof m.mastery === "number") {
        metaRow.createSpan({ cls: "kg-review-qlabel", text: "掌握度" });
        this.bar(metaRow, m.mastery);
        metaRow.createSpan({ cls: "kg-mastery-pct", text: m.mastery + "%" });
      }
      if (m.retrievability !== null) {
        metaRow.createSpan({ cls: "kg-review-qlabel", text: "保持率" });
        this.bar(metaRow, Math.round(m.retrievability * 100), "var(--color-blue, #1e88e5)");
        metaRow.createSpan({ cls: "kg-mastery-pct", text: Math.round(m.retrievability * 100) + "%" });
      }
      metaRow.createSpan({ cls: "kg-review-days", text: isNew ? "首次复习（评分后生成下次时间）" : (m.due !== undefined ? "下次：" + fmtDueText(m.due, now) : "已调度") + " · 复习 " + (st ? st.reviewCount : 0) + " 次" });
      row.createDiv({ cls: "kg-review-meta" }).setText(
        "《" + this.plugin.basename(c.sourcePath) + "》" + (c.concept ? " · ★ " + c.concept : "") +
        (c.examId ? (examTitle ? " · 📝 " + examTitle : " · 📝 原考试已删除") : "") +
        (sourceGone ? " · ⚠ 来源笔记已删除（卡仍可复习）" : "")
      );
      row.addEventListener("click", () => { this.startReviewAt(c); });
      // 删除入口（§3/60）：stopPropagation 防止同时打开复习卡
      const delBtn = row.createEl("button", { cls: "kg-btn kg-btn-danger kg-card-del", text: "删除" });
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.confirmDelete(c);
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private scopeEmptyText(): string {
    if (this.cards.length === 0) return "还没有复习卡。";   // §76：区分“没有卡”与“没有到期卡”
    return "当前范围没有复习卡（打开/刷新 0 AI）。可点上方「复习范围」调整，或在笔记右键「📝 构建知识考试」→ 作答后收藏题目。";
  }

  /** 排序（§14/17/19/24/61）：复用纯函数 rankSavedCards（含稳定 tie-break createdAt/id，§71） */
  private sortCards(cards: SavedReviewCard[]): SavedReviewCard[] {
    const now = Date.now();
    const byId = new Map(cards.map((c) => [c.id, c] as const));
    const weight = this.plugin.settings.spacedReview?.savedCardNewWeight ?? 30;   // §21/22：推荐中的新卡权重（默认 30）
    const order = rankSavedCards(
      cards,
      (id) => this.stateOf(id),
      (id) => this.metaOf(byId.get(id) as SavedReviewCard),
      this.listSort,
      weight,
      now
    );
    return order.map((id) => byId.get(id)).filter((x): x is SavedReviewCard => !!x);
  }

  /* ---------- Phase 21.x：删除（后端一律走 plugin.deleteCard，§5/9；本层只做 UI+本地移除） ---------- */

  private confirmDelete(c: SavedReviewCard): void {
    new CardDeleteConfirmModal(this.app, c.question, () => { void this.doDelete(c); }).open();   // §4/61
  }

  private async doDelete(c: SavedReviewCard): Promise<void> {
    if (this.deleting.has(c.id)) return;                                   // P-HF-DELETE-15：连点防重
    this.deleting.add(c.id);
    try {
      await this.plugin.deleteCard(c.id);   // main：删 Markdown + store + FSRS(scRemoveCard) + CardReviewRecord；保留 Exam/Source/AI（§9/11/12）
    } finally {
      this.deleting.delete(c.id);
    }
    // 本地同步移除（§6/73），Store 生命周期由 main 统一
    this.cards = this.cards.filter((x) => x.id !== c.id);
    const wasReview = this.reviewing.some((x) => x.id === c.id);
    this.reviewing = this.reviewing.filter((x) => x.id !== c.id);
    if (wasReview && this.reviewing.length > 0) {
      this.reviewIndex = Math.min(this.reviewIndex, this.reviewing.length - 1);   // §74 clamp
      this.chosenOption = "";
      this.ratingDone = false;
      this.renderReview();                                                       // §7：进入下一张
    } else {
      this.reviewIndex = 0;
      this.mode = "list";
      this.renderList();                                                         // §72：只刷新本列表
    }
  }

  private bar(parent: HTMLElement, value: number, color?: string): void {
    const wrap = parent.createDiv({ cls: "kg-mastery-bar" });
    const fill = wrap.createDiv({ cls: "kg-mastery-fill" });
    fill.style.width = Math.max(0, Math.min(100, value)) + "%";
    if (color) fill.style.background = color;
  }

  /**
   * §5/6：渲染答案 body（内容完全等同旧逻辑：答案/说明/原文依据/来源/打开笔记；0 AI）。
   * 返回 .kg-answer-body 元素；调用方决定 display。只在 body 不存在时调用（§7/12）。
   */
  private renderAnswerBody(answerArea: HTMLElement, card: SavedReviewCard): HTMLElement {
    const content = answerBodyContent(card);
    const body = answerArea.createDiv({ cls: "kg-answer-body" });
    body.createDiv({ cls: "kg-answer-text", text: content.answer || ANSWER_FALLBACK });   // P-HOTFIX-03/16
    if (content.explanation) body.createDiv({ cls: "kg-exam-ans-explanation", text: "说明：" + content.explanation });   // P-HOTFIX-15
    if (content.evidence.length) {   // P-HOTFIX-14
      body.createDiv({ cls: "kg-exam-ans-evidence-label", text: "📎 原文依据" });
      for (const s of content.evidence) body.createDiv({ cls: "kg-exam-ans-evidence", text: "• " + s });
    }
    const srcRow = body.createDiv({ cls: "kg-row kg-answer-source" });
    srcRow.createSpan({ cls: "kg-review-qlabel", text: "来源：" + content.sourcePath });   // P-HOTFIX-13
    srcRow.createEl("button", { cls: "kg-btn", text: "打开笔记" })
      .addEventListener("click", () => { this.plugin.openNote(card.sourcePath); });   // §14/79：0 AI
    return body;
  }







  private renderHeader(inner: HTMLElement): void {
    const head = inner.createDiv({ cls: "kg-section-title-row kg-review-head" });
    const titleWrap = head.createDiv({ cls: "kg-review-head-title" });
    titleWrap.createDiv({ cls: "kg-section-title", text: "📚 我的复习卡" });
    // §60/62/28 概览（本地计算 0 AI；新卡单独统计 §29/30）
    const scoped = this.scopedCards();
    const states = scoped.map((c) => this.stateOf(c.id)).filter((x): x is SavedCardSpacedState => !!x);
    const newCount = scoped.filter((c) => isNewSavedCard(this.stateOf(c.id))).length;
    const ov = savedCardOverview(states, [], this.plugin.spacedScheduler(), Date.now(), newCount);
    titleWrap.createDiv({ cls: "kg-review-progress", text: "共 " + ov.total + " 张 · 到期 " + ov.due + " · 即将遗忘 " + ov.forgetting + " · 新卡 " + ov.newCount + " · 稳定掌握 " + ov.stable + " · 今日已复习 " + ov.reviewsToday });
    const scopeBtn = head.createEl("button", { cls: "kg-btn kg-btn-icon", text: "📚 " + this.scopeText() + " ▼" });
    scopeBtn.addEventListener("click", () => { this.scopeEditorOpen = !this.scopeEditorOpen; this.renderList(); });
    const refreshBtn = head.createEl("button", { cls: "kg-btn kg-btn-icon", text: "🔄 刷新" });
    refreshBtn.setAttr("title", "重读 ReviewCardStore + FSRS saved-card state + 日志；统计/排序/due/mastery/retrievability 重算（0 AI，§11）");
    refreshBtn.addEventListener("click", () => { this.refresh(); });

    if (this.scopeEditorOpen) this.renderScopeEditor(inner);
    // §61/62/29/30：掌握分布 + FSRS 概览（未评分新卡不计入五档分布）
    const distBox = inner.createDiv({ cls: "kg-card kg-overview" });
    distBox.createDiv({ cls: "kg-review-qlabel", text: "掌握分布（本地 0 AI）" });
    if (ov.newCount > 0) distBox.createDiv({ cls: "kg-review-meta", text: "🌱 新卡 " + ov.newCount + "（尚未评分，不计入下面分布）" });
    const dist = ov.dist;
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total > 0) {
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
    } else {
      distBox.createDiv({ cls: "kg-empty", text: "还没有评分记录（对任意卡点 😵😕🙂😎 开始建立掌握度）。" });
    }

    if (scoped.length > 0) {
      const tool = inner.createDiv({ cls: "kg-row kg-sort-row" });
      tool.createEl("button", { cls: "kg-btn kg-btn-primary", text: "▶ 开始复习（0 AI）" })
        .addEventListener("click", () => { if (scoped.length) this.startReviewAt(scoped[0]); });
      tool.createSpan({ cls: "kg-review-qlabel", text: "排序：" });
      const opts: { id: ListSort; label: string }[] = [
        { id: "forget", label: "最可能忘记" }, { id: "new", label: "🌱 新卡优先" }, { id: "recommend", label: "推荐" },
        { id: "mastery", label: "掌握度低" }, { id: "recent", label: "最近复习" }, { id: "next", label: "下次复习" },
      ];
      for (const o of opts) {
        const b = tool.createEl("button", { cls: "kg-btn" + (this.listSort === o.id ? " kg-btn-primary" : ""), text: o.label });
        b.addEventListener("click", () => { this.listSort = o.id; this.renderList(); });
      }
    }
  }

  private scopeText(): string {
    const examTitle = this.cardScope.mode === "exam" && this.cardScope.examId ? this.plugin.examStore.get(this.cardScope.examId)?.title : undefined;
    return savedCardScopeText(this.cardScope, examTitle);
  }

  /** §17/26/27 Scope 编辑器（0 AI） */
  private renderScopeEditor(inner: HTMLElement): void {
    const box = inner.createDiv({ cls: "kg-review-scope-editor" });
    const modes: { id: SavedCardScopeMode; label: string }[] = [
      { id: "vault", label: "🌐 整个 Vault" },
      { id: "current-note", label: "📄 当前笔记" },
      { id: "folder", label: "📁 当前文件夹" },
      { id: "area", label: "🗂 知识区域" },
      { id: "exam", label: "📝 来源考试" },
      { id: "custom", label: "📚 自定义文件夹" },
    ];
    const modeRow = box.createDiv({ cls: "kg-row" });
    for (const m of modes) {
      const b = modeRow.createEl("button", { cls: "kg-btn" + (this.cardScope.mode === m.id ? " kg-btn-primary" : ""), text: m.label });
      b.addEventListener("click", () => this.applyScopeMode(m.id));
    }
    const active = this.plugin.app.workspace.getActiveFile();
    if (this.cardScope.mode === "current-note") {
      box.createDiv({ cls: "kg-review-meta", text: active ? "当前：《" + active.basename + "》（只显示 sourcePath === 该笔记）" : "当前没有打开笔记。" });
    }
    if (this.cardScope.mode === "exam") {
      const exams = this.plugin.examsForSavedCardsScope();
      if (exams.length === 0) box.createDiv({ cls: "kg-empty", text: "还没有任何考试。先在某篇笔记右键 →「📝 构建知识考试」。" });
      else {
        const row = box.createDiv({ cls: "kg-row" });
        for (const e of exams.slice(0, 30)) {
          const b = row.createEl("button", { cls: "kg-btn" + (this.cardScope.examId === e.id ? " kg-btn-primary" : ""), text: "《" + e.title + "》" });
          b.addEventListener("click", () => this.applyExam(e.id));
        }
        if (exams.length > 30) box.createDiv({ cls: "kg-empty", text: "…还有 " + (exams.length - 30) + " 场考试" });
      }
    }
    if (this.cardScope.mode === "area") {
      const areas = this.plugin.settings.knowledgeAreas;
      if (areas.length === 0) box.createDiv({ cls: "kg-empty", text: "还没配置知识区域 → 设置 → Knowledge Areas。" });
      else {
        const row = box.createDiv({ cls: "kg-row" });
        for (const a of areas) {
          const b = row.createEl("button", { cls: "kg-btn" + (this.cardScope.areaId === a.id ? " kg-btn-primary" : ""), text: (a.icon || "📁") + " " + a.name });
          b.addEventListener("click", () => this.applyArea(a.id, a.folder || undefined));
        }
      }
    }
    if (this.cardScope.mode === "custom") {
      const folders = this.cardScope.folders ?? [];
      box.createDiv({ cls: "kg-review-qlabel", text: "文件夹（最多 " + CUSTOM_SCOPE_FOLDER_LIMIT + " 个）" });
      const chips = box.createDiv({ cls: "kg-row" });
      for (const f of folders) {
        const chip = chips.createSpan({ cls: "kg-chip" });
        chip.setText(f + " ✕");
        chip.addEventListener("click", () => this.applyCustom(folders.filter((x) => x !== f)));
      }
      const addRow = box.createDiv({ cls: "kg-row" });
      const input = addRow.createEl("input", { cls: "kg-input", attr: { placeholder: "如 01 盒子/游戏" } });
      input.value = this.customInput;
      input.addEventListener("input", () => { this.customInput = input.value; });
      addRow.createEl("button", { cls: "kg-btn", text: "添加" }).addEventListener("click", () => {
        const f = this.customInput.trim().replace(/\/+$/, "");
        this.customInput = "";
        if (!f) { new Notice("请输入文件夹路径。"); return; }
        const next = clampCustomFolders(Array.from(new Set([...folders, f])));
        this.applyCustom(next);
      });
    }
  }

  private applyScopeMode(mode: SavedCardScopeMode): void {
    if (mode === "current-note") {
      const f = this.plugin.app.workspace.getActiveFile();
      if (!f) { new Notice("当前没有打开的笔记。"); return; }
      this.setScope({ mode: "current-note", notePath: f.path });
      return;
    }
    if (mode === "folder") {
      const f = this.plugin.app.workspace.getActiveFile();
      const folder = f ? f.path.split("/").slice(0, -1).join("/") : "";
      if (!folder) { new Notice("当前笔记在 Vault 根目录，没有上级文件夹。"); return; }
      this.setScope({ mode: "folder", folderPath: folder });
      return;
    }
    if (mode === "vault") { this.setScope(defaultSavedCardScope()); return; }
    // area / exam / custom：保留编辑器内细化
    const base = { ...this.cardScope };
    this.setScope({ mode, areaId: base.areaId, examId: base.examId, folders: base.folders });
  }
  private applyExam(examId: string): void { this.setScope({ mode: "exam", examId }); }
  private applyArea(areaId: string, folderPath?: string): void {
    this.setScope({ mode: "area", areaId, folderPath });
  }
  private applyCustom(folders: string[]): void { this.setScope({ mode: "custom", folders }); }

  /* ================= 复习（§28/30/137：Rating=真实复习；Skip 不改 FSRS） ================= */

  private startReviewAt(c: SavedReviewCard): void {
    const scoped = this.scopedCards();
    const sorted = this.sortCards(scoped);
    this.reviewing = sorted;
    const idx = sorted.findIndex((x) => x.id === c.id);
    this.reviewIndex = Math.max(0, idx);
    this.chosenOption = "";
    this.ratingDone = false;
    this.mode = "review";
    this.renderReview();
  }

  private currentReviewCard(): SavedReviewCard | null {
    return this.reviewing[this.reviewIndex] ?? null;
  }

  private renderReview(): void {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
    if (!inner) return;
    inner.empty();
    const c = this.currentReviewCard();
    if (!c) { this.renderList(); return; }
    const total = this.reviewing.length;
    this.mode = "review";
    const head = inner.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "📚 复习卡 · " + (this.reviewIndex + 1) + " / " + total });
    head.createSpan({ cls: "kg-review-progress", text: "0 AI" });
    const back = head.createEl("button", { cls: "kg-btn", text: "← 返回列表" });
    back.addEventListener("click", () => { this.mode = "list"; this.renderList(); });

    const now = Date.now();
    const card = inner.createDiv({ cls: "kg-card kg-review-card" });
    const titleRow = card.createDiv({ cls: "kg-row kg-card-title-row" });
    titleRow.createDiv({ cls: "kg-review-title", text: (c.question || "复习卡").slice(0, 90) });
    const noteMeta = this.plugin.index.get(c.sourcePath);
    const updatedAfterSaved = !!noteMeta && noteMeta.modified > c.createdAt + 60000;   // §143：来源已有更新（只读元数据，0 AI）
    card.createDiv({ cls: "kg-review-meta" }).setText(
      (c.concept ? "★ " + c.concept + " · " : "") + examTypeLabel(c.questionType) +
      (c.examId ? " · 📝 " + (this.plugin.examStore.get(c.examId)?.title ?? "原考试已删除") : "") +
      (noteMeta ? (updatedAfterSaved ? " · ✏ 来源笔记已有更新" : "") : " · ⚠ 来源笔记已删除")
    );

    const st = this.stateOf(c.id);
    const sched = this.plugin.spacedScheduler();
    const retr = st ? sched.retrievability(st.fsrsState, now) : null;
    const due = st ? st.fsrsState.due : undefined;
    const chips = card.createDiv({ cls: "kg-row kg-chip-row" });
    const tone = fmtDue(due, now);
    chips.createSpan({ cls: "kg-chip kg-due-" + tone.tone, text: due === undefined ? (st ? "已调度" : "新卡 · 首次复习") : tone.text });
    if (st) {
      chips.createSpan({ cls: "kg-chip", text: "复习 " + st.reviewCount + " 次" });
      const conf = masteryConfidence(st.reviewCount);
      if (conf.low) chips.createSpan({ cls: "kg-chip", text: conf.hint });
    }

    // 选择题：kg-card 内部 kg-exam-options（§32/34/42：保持卡片 UI，绝不转普通列表）
    if (c.questionType === "multiple_choice") {
      const opts = c.options ?? [];
      const optsOk = opts.length >= 1;
      if (optsOk) {
        card.createDiv({ cls: "kg-review-divider" });
        const optsBox = card.createDiv({ cls: "kg-exam-options" });
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i];
          const lbl = String.fromCharCode(65 + i);
          const row = optsBox.createDiv({ cls: "kg-exam-opt" + (this.chosenOption === lbl ? " kg-exam-opt-picked" : "") });
          row.createSpan({ cls: "kg-exam-opt-lbl", text: lbl });
          row.createDiv({ cls: "kg-exam-opt-text", text: o });
          row.addEventListener("click", () => {
            this.chosenOption = lbl;
            this.ratingDone = false;
            this.renderReview();
          });
        }
        if (opts.length < 2) {   // §53：单选项视为异常提示（hydration 已尽力）
          const warn = card.createDiv({ cls: "kg-review-hint" });
          warn.setText("⚠ 此卡仅 1 个选项，可能不完整；若原考试仍在可执行「修复我的复习卡数据」。");
        }
      }
      // 未修复缺失选项：绝不静默只显示题干（§8/9/42/43）；也绝不 AI 猜题
      if (!optsOk) {
        const note = card.createDiv({ cls: "kg-review-hint" });
        const examExists = !!c.examId && !!this.plugin.examStore.get(c.examId);
        note.setText(
          examExists
            ? "⚠ 此旧选择题卡缺少选项数据（原考试仍在但未唯一匹配题目，无法自动恢复；已保留题干）。"
            : (c.examId ? "⚠ 原考试已删除，无法恢复该选择题选项（已保留题干）。" : "⚠ 此旧选择题卡缺少选项数据（无来源考试，无法恢复；已保留题干）。")
        );
        card.createEl("button", { cls: "kg-btn", text: "打开卡片来源" })
          .addEventListener("click", () => { this.plugin.openNote(c.sourcePath); });
      }
      // §94/27：正确答案独立显示（即使 options 缺失也展示已保存的 correctAnswer）
      if (c.correctAnswer) {
        const correct = card.createDiv({ cls: "kg-exam-answer-title kg-exam-correct-note" });
        correct.setText("✅ 正确答案：" + c.correctAnswer + (this.chosenOption ? (this.chosenOption === c.correctAnswer.trim().toUpperCase() ? "（你选对了 🎉）" : "（你选了 " + this.chosenOption + "）") : ""));
      }
    }

    // 📖 答案区（默认显示 §12/14/93/88；SavedReviewCard.answer 优先，不调 deriveReviewAnswer）
    const defaultVisible = this.plugin.settings.reviewCenter?.showAnswerByDefault !== false;
    const hidden = !answerVisibility(c.id, defaultVisible, this.hiddenAnswers, this.shownAnswers);
    const answerArea = card.createDiv({ cls: "kg-answer-area" });
    const ansHead = answerArea.createDiv({ cls: "kg-row kg-answer-header" });
    ansHead.createDiv({ cls: "kg-answer-title", text: "📖 答案" });
    const hideBtn = ansHead.createEl("button", { cls: "kg-btn", text: hidden ? "显示答案" : "隐藏答案" });
    hideBtn.addEventListener("click", () => {
      // §8：willShow = 点击后的目标状态（由本卡 id 在 shown/hidden 集合中的状态决定，§19）
      const willShow = toggleAnswerVisibility(c.id, defaultVisible, this.hiddenAnswers, this.shownAnswers);
      let body = answerArea.querySelector(".kg-answer-body") as HTMLElement | null;
      const action = revealDomAction(!!body, willShow);   // §7/12/13/十六
      if (action === "create") {
        body = this.renderAnswerBody(answerArea, c);      // 立即创建，答案马上出现（§3）
        body.style.display = "";
      } else if (action === "show") {
        body!.style.display = "";                          // §13/18：只改 display，不重建
      } else if (action === "hide" && body) {
        body.style.display = "none";                       // §12/17：只隐藏，不删 DOM
      }
      hideBtn.setText(willShow ? "隐藏答案" : "显示答案");   // §10：按钮文字立即同步
    });
    if (!hidden) {
      const body = this.renderAnswerBody(answerArea, c);
      body.style.display = "";
    }

    // 掌握度 vs 保持率（§24 分离展示）
    if (st) {
      if (typeof st.masteryPercent === "number") {
        const mr = card.createDiv({ cls: "kg-row kg-card-meta-row" });
        mr.createSpan({ cls: "kg-review-qlabel", text: "掌握度（历史评分）" });
        this.bar(mr, st.masteryPercent);
        mr.createSpan({ cls: "kg-mastery-pct", text: st.masteryPercent + "%" });
      }
      if (retr !== null) {
        const rr = card.createDiv({ cls: "kg-row kg-card-meta-row" });
        rr.createSpan({ cls: "kg-review-qlabel", text: "当前保持率（FSRS）" });
        this.bar(rr, Math.round(retr * 100), "var(--color-blue, #1e88e5)");
        rr.createSpan({ cls: "kg-mastery-pct", text: Math.round(retr * 100) + "%" });
      }
    }

    card.createDiv({ cls: "kg-review-divider" });

    // §四十九 风格：真实 FSRS 预览 + 四档
    const previews = sched.previewAll(st ? st.fsrsState : null, now);
    const pRow = card.createDiv({ cls: "kg-review-preview-row" });
    for (const r of FSRS_RATINGS) {
      const cell = pRow.createDiv({ cls: "kg-preview-cell" });
      cell.createDiv({ cls: "kg-review-qlabel", text: FSRS_RATING_EMOJI[r] + " " + FSRS_RATING_LABEL[r] });
      cell.createDiv({ cls: "kg-preview-due", text: fmtPreview(previews[r].intervalDays, previews[r].due, now) });
    }
    const ratingRow = card.createDiv({ cls: "kg-row kg-rating-row" });
    if (this.ratingDone) {
      ratingRow.createSpan({ cls: "kg-review-days", text: "✓ 已记录。选下一张继续，或返回列表。" });
    } else {
      for (const r of FSRS_RATINGS) {
        const b = ratingRow.createEl("button", { cls: "kg-btn kg-rating kg-rating-" + r, text: FSRS_RATING_EMOJI[r] + " " + FSRS_RATING_LABEL[r] });
        b.addEventListener("click", () => { this.rate(c, r); });
      }
    }
    const alt = card.createDiv({ cls: "kg-row kg-review-nav" });
    const skip = alt.createEl("button", { cls: "kg-btn", text: "跳过（不改变 FSRS）" });
    skip.setAttr("title", "§30：Skip 不调用 FSRS，不改 mastery/reviewCount/lastReviewedAt/due");
    skip.addEventListener("click", () => { this.nextCard(false); });
    const prev = alt.createEl("button", { cls: "kg-btn", text: "← 上一张" });
    prev.disabled = this.reviewIndex <= 0;
    prev.addEventListener("click", () => { if (this.reviewIndex > 0) { this.reviewIndex--; this.chosenOption = ""; this.ratingDone = false; this.renderReview(); } });
    const next = alt.createEl("button", { cls: "kg-btn", text: "下一张 →" });
    next.disabled = this.reviewIndex >= total - 1;
    next.addEventListener("click", () => { if (this.reviewIndex < total - 1) { this.reviewIndex++; this.chosenOption = ""; this.ratingDone = false; this.renderReview(); } });
    // Phase 21.x：复习页也可删除当前卡（§6/7；后端仍走 plugin.deleteCard）
    const del = alt.createEl("button", { cls: "kg-btn kg-btn-danger", text: "删除这张卡" });
    del.addEventListener("click", () => { this.confirmDelete(c); });
  }

  /** §28/29/138：Rating 成功 → 下一张；失败保留（main 已拦截） */
  private rate(c: SavedReviewCard, rating: FsrsRating): void {
    const ok = this.plugin.rateSavedCard(c.id, rating);
    if (!ok) return;
    this.ratingDone = true;
    this.renderReview();
  }

  private nextCard(reviewed: boolean): void {
    if (this.reviewIndex < this.reviewing.length - 1) {
      this.reviewIndex++;
      this.chosenOption = "";
      this.ratingDone = false;
      this.renderReview();
    } else {
      new Notice(reviewed ? "本组复习完成（0 AI）。" : "已跳过当前卡（0 AI）。");
      this.renderList();
    }
  }
}
