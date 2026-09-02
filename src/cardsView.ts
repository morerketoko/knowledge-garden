/** Phase 14 Cards View（§八十三~八十六/一百八十~一百八十六）：收藏复习卡列表 + 搜索/来源/掌握度过滤 + Card Viewer。
 * - 打开/搜索/收藏/删除/复习全部无 AI（§一百一十一/一百一十二/二百零六）。
 * - 首页只展示最近 5 张（§一百三十）；查看全部进入本视图。
 * - Card Review（§一百八十五/二百三十六）：问题 → 回忆 → 显示答案 → 自评 → 下一张，0 AI。
 */
import { ItemView, WorkspaceLeaf } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { MasteryRating, SavedReviewCard } from "./types";
import { masteryLabel } from "./examEngine";
import { examTypeLabel } from "./examView";

export const VIEW_TYPE_CARDS = "knowledge-garden-cards";

const MASTERY_OPTIONS: { value: MasteryRating; label: string }[] = [
  { value: "forgot", label: "😵 没想起来" },
  { value: "hard", label: "😕 很困难" },
  { value: "good", label: "🙂 基本掌握" },
  { value: "easy", label: "😎 很熟练" },
];

/** 掌握度排序权重（越低越需要复习） */
function masteryWeight(m?: MasteryRating): number {
  switch (m) {
    case "forgot": return 0;
    case "hard": return 1;
    case "good": return 2;
    case "easy": return 3;
    default: return 1.5;
  }
}

/** 收藏复习卡视图：列表 / 搜索 / 来源过滤 / 掌握度过滤 / Card Viewer / 复习模式 */
export class CardsView extends ItemView {
  private cards: SavedReviewCard[] = [];
  private query = "";
  private sourceFilter = "";
  private masteryFilter: MasteryRating | "" = "";
  private reviewing: SavedReviewCard[] = [];
  private reviewIndex = 0;
  private mode: "list" | "view" | "review" = "list";
  private activeCard: SavedReviewCard | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_CARDS; }
  getDisplayText(): string { return "📚 我的复习卡"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.containerEl.addClass("kg-cards");
    const inner = this.containerEl.createDiv({ cls: "kg-inner" });
    this.cards = this.plugin.cards.all();
    this.mode = "list";
    this.render(inner);
  }

  async refresh(): Promise<void> {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
    if (!inner) return;
    this.cards = this.plugin.cards.all();
    this.render(inner);
  }
  async onClose(): Promise<void> { this.containerEl.empty(); return Promise.resolve(); }

  private render(inner: HTMLElement): void {
    inner.empty();
    if (this.mode === "view" && this.activeCard) { this.renderCardViewer(inner, this.activeCard); return; }
    if (this.mode === "review") { this.renderReviewStep(inner); return; }
    this.renderList(inner);
  }

  /* ---------- 列表（搜索 / 来源 / 掌握度过滤；首页最近 5 张对应 §一百二十九） ---------- */
  private renderList(inner: HTMLElement): void {
    inner.createDiv({ cls: "kg-section-title", text: "📚 我的复习卡" });
    inner.createDiv({ cls: "kg-empty", text: "收藏数量：" + this.cards.length + "（打开/刷新均 0 AI；卡片是独立快照，清 AI 缓存不影响）" });

    const filters = inner.createDiv({ cls: "kg-cards-filters" });
    const search = filters.createEl("input", { cls: "kg-input", attr: { placeholder: "🔍 搜索问题 / 概念 / 来源…" } });
    search.value = this.query;
    search.addEventListener("input", () => { this.query = search.value.trim(); this.renderListBody(inner); });
    const srcSel = filters.createEl("select", { cls: "kg-select" });
    srcSel.createEl("option", { value: "", text: "全部来源" });
    const sources = [...new Set(this.cards.map((c) => c.sourcePath).filter(Boolean))];
    for (const s of sources) srcSel.createEl("option", { value: s, text: s });
    srcSel.value = this.sourceFilter;
    srcSel.addEventListener("change", () => { this.sourceFilter = srcSel.value; this.renderListBody(inner); });
    const masterySel = filters.createEl("select", { cls: "kg-select" });
    masterySel.createEl("option", { value: "", text: "全部掌握度" });
    for (const m of MASTERY_OPTIONS) masterySel.createEl("option", { value: m.value, text: m.label });
    masterySel.value = this.masteryFilter;
    masterySel.addEventListener("change", () => { this.masteryFilter = masterySel.value as MasteryRating | ""; this.renderListBody(inner); });

    if (this.cards.length) inner.createEl("button", { cls: "kg-btn kg-btn-primary", text: "▶ 开始复习（无 AI）" })
      .addEventListener("click", () => { this.startReview(); });

    const body = inner.createDiv({ cls: "kg-cards-body" });
    this.renderListBody(body);
  }
  private renderListBody(body: HTMLElement): void {
    body.empty();
    const q = this.query.toLowerCase();
    const filtered = this.cards.filter((c) => {
      if (this.sourceFilter && c.sourcePath !== this.sourceFilter) return false;
      if (this.masteryFilter && c.mastery !== this.masteryFilter) return false;
      if (!q) return true;
      const hay = ((c.question || "") + " " + (c.concept || "") + " " + (c.sourcePath || "")).toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => masteryWeight(a.mastery) - masteryWeight(b.mastery));

    if (!filtered.length) {
      body.createDiv({ cls: "kg-empty", text: "没有符合条件的复习卡。" });
      return;
    }
    for (const c of filtered.slice(0, 50)) {
      const row = body.createDiv({ cls: "kg-card kg-card-row" });
      row.createDiv({ cls: "kg-card-question", text: c.question });
      row.createDiv({ cls: "kg-card-meta", text: (c.concept ? "★ " + c.concept + " · " : "") + "《" + this.plugin.basename(c.sourcePath) + "》 · " + examTypeLabel(c.questionType) });
      row.createDiv({ cls: "kg-card-mastery", text: "掌握： " + (c.mastery ? MASTERY_OPTIONS.find((m) => m.value === c.mastery)?.label ?? c.mastery : "未复习") });
      row.addEventListener("click", () => { this.activeCard = c; this.mode = "view"; this.render(this.containerEl.querySelector(".kg-inner") as HTMLElement); });
    }
    if (filtered.length > 50) body.createDiv({ cls: "kg-empty", text: "（仅显示前 50 张，可缩小筛选范围）" });
  }

  /* ---------- Card Viewer（§八十六：问题 → 显示答案 → 解释 → 证据 → 打开原笔记 → 掌握度） ---------- */
  private renderCardViewer(inner: HTMLElement, c: SavedReviewCard): void {
    inner.createDiv({ cls: "kg-section-title", text: "🔎 复习卡" });
    inner.createEl("button", { cls: "kg-btn", text: "← 返回列表" })
      .addEventListener("click", () => { this.mode = "list"; this.render(inner); });
    const card = inner.createDiv({ cls: "kg-card kg-exam-card" });
    card.createDiv({ cls: "kg-exam-qmeta", text: examTypeLabel(c.questionType) + (c.concept ? " · " + c.concept : "") });
    card.createDiv({ cls: "kg-exam-question", text: c.question });
    const showBtn = card.createEl("button", { cls: "kg-btn kg-btn-primary", text: "👁 显示答案" });
    const answerZone = card.createDiv({ cls: "kg-exam-answer-area kg-hidden" });
    answerZone.createDiv({ cls: "kg-exam-answer-title", text: "📖 答案" });
    answerZone.createDiv({ cls: "kg-exam-answer-text", text: c.answer });
    if (c.explanation) answerZone.createDiv({ cls: "kg-exam-ans-explanation", text: "说明：" + c.explanation });
    if (c.sourceEvidence && c.sourceEvidence.length) {
      answerZone.createDiv({ cls: "kg-exam-ans-evidence-label", text: "📎 原文依据" });
      for (const s of c.sourceEvidence) answerZone.createDiv({ cls: "kg-exam-ans-evidence", text: "• " + s });
    }
    showBtn.addEventListener("click", () => { answerZone.removeClass("kg-hidden"); showBtn.addClass("kg-hidden"); this.renderSelfRatingZone(answerZone, c); });

    const actions = inner.createDiv({ cls: "kg-row" });
    actions.createEl("button", { cls: "kg-btn", text: "打开原笔记" })
      .addEventListener("click", () => { this.plugin.openNote(c.sourcePath); });
    const delBtn = actions.createEl("button", { cls: "kg-btn kg-btn-danger", text: "删除收藏（0 AI）" });
    delBtn.addEventListener("click", () => { void this.plugin.deleteCard(c.id); this.mode = "list"; this.refresh(); });
    const reviewBtn = actions.createEl("button", { cls: "kg-btn kg-btn-primary", text: "开始复习这张" });
    reviewBtn.addEventListener("click", () => { this.reviewing = [c]; this.reviewIndex = 0; this.mode = "review"; this.render(inner); });
  }

  private renderSelfRatingZone(zone: HTMLElement, c: SavedReviewCard): void {
    const row = zone.createDiv({ cls: "kg-row" });
    row.createSpan({ cls: "kg-review-qlabel", text: "这次复习感觉：" });
    const btns = zone.createDiv({ cls: "kg-exam-selfrating" });
    for (const m of MASTERY_OPTIONS) {
      const b = btns.createEl("button", { cls: "kg-btn", text: m.label });
      b.addEventListener("click", () => {
        this.plugin.recordCardReview(c.id, m.value);
        zone.createDiv({ cls: "kg-exam-ai-assessment", text: "已记录（" + m.label + "），0 AI。" });
        btns.querySelectorAll("button").forEach((bb) => { (bb as HTMLButtonElement).disabled = true; });
      });
    }
  }
  /* ---------- 复习模式（§二百三十六：0 AI） ---------- */
  private startReview(): void {
    this.reviewing = [...this.cards].sort((a, b) => masteryWeight(a.mastery) - masteryWeight(b.mastery));
    this.reviewIndex = 0;
    this.mode = "review";
    this.render(this.containerEl.querySelector(".kg-inner") as HTMLElement);
  }

  private renderReviewStep(inner: HTMLElement): void {
    const c = this.reviewing[this.reviewIndex];
    if (!c) {
      this.mode = "list";
      this.render(inner);
      return;
    }
    inner.createDiv({ cls: "kg-section-title", text: "📚 复习卡复习 · " + (this.reviewIndex + 1) + " / " + this.reviewing.length });
    inner.createEl("button", { cls: "kg-btn", text: "退出复习" })
      .addEventListener("click", () => { this.mode = "list"; this.render(inner); });
    const card = inner.createDiv({ cls: "kg-card kg-exam-card" });
    card.createDiv({ cls: "kg-exam-qmeta", text: examTypeLabel(c.questionType) + (c.concept ? " · " + c.concept : "") });
    card.createDiv({ cls: "kg-exam-question", text: c.question });
    const ta = card.createEl("textarea", { cls: "kg-exam-answer-input", attr: { rows: 4, placeholder: "先在自己的记忆里回忆，再显示答案…" } });
    const showBtn = card.createEl("button", { cls: "kg-btn kg-btn-primary", text: "显示答案" });
    const zone = card.createDiv({ cls: "kg-exam-answer-area kg-hidden" });
    zone.createDiv({ cls: "kg-exam-answer-title", text: "📖 答案" });
    zone.createDiv({ cls: "kg-exam-answer-text", text: c.answer });
    if (c.explanation) zone.createDiv({ cls: "kg-exam-ans-explanation", text: "说明：" + c.explanation });
    showBtn.addEventListener("click", () => {
      zone.removeClass("kg-hidden");
      showBtn.addClass("kg-hidden");
      const row = zone.createDiv({ cls: "kg-row" });
      row.createSpan({ cls: "kg-review-qlabel", text: "自评：" });
      const btns = zone.createDiv({ cls: "kg-exam-selfrating" });
      for (const m of MASTERY_OPTIONS) {
        const b = btns.createEl("button", { cls: "kg-btn", text: m.label });
        b.addEventListener("click", () => {
          this.plugin.recordCardReview(c.id, m.value);
          this.reviewIndex++;
          this.render(inner);
        });
      }
    });
  }
}
