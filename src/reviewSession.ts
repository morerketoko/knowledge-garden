/** Review Session（§十五/十六）：Obsidian 独立 View ——「再进入复习窗口」。
 *  - 只做 UI 与事件转发；一切状态变更走 main.ts 的统一入口（Activity / Queue / Session 持久化）。
 *  - 完成/跳过/稍后都由用户显式点击触发（§五十九：不自动跳下一篇）。
 *  - AI 问题在本 Session 每次 open 最多请求一次（§五十六），失败用系统 fallback（§二十五）。
 */
import { ItemView, WorkspaceLeaf } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { ReviewQueue, ReviewQuestion } from "./types";
import { stateReason, resolveQuestion, sessionFinished } from "./reviewCenter";

export const VIEW_TYPE_REVIEW = "knowledge-garden-review";

type SnoozeChoice = 1 | 3 | 7;

export class ReviewSessionView extends ItemView {
  private queue: ReviewQueue | null = null;
  private currentIndex = 0;
  private questions = new Map<string, ReviewQuestion>();
  private questionLoadedFor: string | null = null;
  private snoozeOpen = false;

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
    const inner = this.containerEl.createDiv({ cls: "kg-inner" });
    this.queue = this.plugin.ensureReviewQueue();
    if (!this.queue || this.queue.items.length === 0) {
      inner.createDiv({ cls: "kg-empty", text: "今天还没有复习队列。打开 Knowledge Garden → 「今日复习」→ 开始今日复习 即可生成（纯本地，不需要 AI）。" });
      return;
    }
    this.currentIndex = this.plugin.reviewResumeIndex(this.queue);
    if (this.questionLoadedFor !== this.queue.periodKey) {
      this.questionLoadedFor = this.queue.periodKey;
      this.questions = await this.plugin.reviewQuestions(this.queue);
    }
    this.render();
  }

  /** 复用已有 leaf 时刷新当前队列与进度（§四十：只恢复同一 periodKey 的 active session） */
  async refresh(): Promise<void> {
    const q = this.plugin.ensureReviewQueue();
    this.queue = q;
    if (!q || q.items.length === 0) {
      const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
      if (inner) { inner.empty(); inner.createDiv({ cls: "kg-empty", text: "今天还没有复习队列。打开 Knowledge Garden → 「今日复习」→ 开始今日复习 即可生成（纯本地，不需要 AI）。" }); }
      return;
    }
    this.currentIndex = this.plugin.reviewResumeIndex(q);
    if (this.questionLoadedFor !== q.periodKey) {
      this.questionLoadedFor = q.periodKey;
      this.questions = await this.plugin.reviewQuestions(q);
    }
    this.render();
  }
  async onClose(): Promise<void> {
    this.containerEl.empty();
    return Promise.resolve();
  }

  private render(): void {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement;
    if (!inner) return;
    inner.empty();
    const q = this.queue;
    if (!q || q.items.length === 0) {
      inner.createDiv({ cls: "kg-empty", text: "今天还没有复习队列。" });
      return;
    }
    const head = inner.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "今日复习" });
    head.createSpan({ cls: "kg-review-progress", text: (q.completedCount + q.skippedCount) + " / " + q.items.length });

    if (sessionFinished(q)) {
      this.renderDone(inner, q);
      return;
    }
    const item = q.items[this.currentIndex];
    if (!item) {
      this.renderDone(inner, q);
      return;
    }
    const card = inner.createDiv({ cls: "kg-card kg-review-card" });
    card.createDiv({ cls: "kg-review-title", text: "《" + this.plugin.basename(item.path) + "》" });
    const area = this.plugin.reviewAreaOf(item.path);
    card.createDiv({ cls: "kg-review-meta", text: (area ? area + " · " : "") + stateReason(item.stateAtSelection) });
    const days = this.daysSinceReview(item.path);
    if (days !== null) card.createDiv({ cls: "kg-review-days", text: days });
    card.createDiv({ cls: "kg-review-divider" });
    const qBlock = card.createDiv({ cls: "kg-review-question" });
    qBlock.createDiv({ cls: "kg-review-question-label", text: "❓ 先想一想：" });
    qBlock.createDiv({ cls: "kg-review-question-text", text: resolveQuestion(this.questions, item.path) });

    const actions = card.createDiv({ cls: "kg-row" });
    const viewBtn = actions.createEl("button", { cls: "kg-btn", text: "查看笔记" });
    viewBtn.addEventListener("click", () => { this.plugin.openNote(item.path); });
    const doneBtn = actions.createEl("button", { cls: "kg-btn kg-btn-primary", text: "✓ 已复习" });
    doneBtn.addEventListener("click", () => { this.act(() => this.plugin.completeReviewItem(item.path)); });
    const skipBtn = actions.createEl("button", { cls: "kg-btn", text: "跳过" });
    skipBtn.addEventListener("click", () => { this.act(() => this.plugin.skipReviewItem(item.path)); });
    const snoozeBtn = actions.createEl("button", { cls: "kg-btn", text: "稍后再看" });
    snoozeBtn.addEventListener("click", () => { this.snoozeOpen = !this.snoozeOpen; this.render(); });

    if (this.snoozeOpen) {
      const snoozeRow = card.createDiv({ cls: "kg-row" });
      snoozeRow.createSpan({ cls: "kg-review-qlabel", text: "稍后再看：" });
      for (const days of [1, 3, 7] as SnoozeChoice[]) {
        const b = snoozeRow.createEl("button", { cls: "kg-btn", text: days === 1 ? "明天" : days + " 天后" });
        b.addEventListener("click", () => { this.act(() => this.plugin.snoozeReviewItem(item.path, days)); });
      }
    }

    const nav = card.createDiv({ cls: "kg-row kg-review-nav" });
    const prevBtn = nav.createEl("button", { cls: "kg-btn", text: "← 上一个" });
    const prevIdx = this.plugin.reviewPrevIndex(q, this.currentIndex);
    prevBtn.disabled = prevIdx === null;
    prevBtn.addEventListener("click", () => { this.currentIndex = prevIdx ?? 0; this.render(); });
    const nextBtn = nav.createEl("button", { cls: "kg-btn", text: "下一个 →" });
    const nextIdx = this.plugin.reviewNextIndex(q, this.currentIndex);
    nextBtn.disabled = nextIdx === null;
    nextBtn.addEventListener("click", () => { this.currentIndex = nextIdx ?? this.currentIndex; this.render(); });
  }

  /** 完成页（§六十）：🎉 今日复习完成 N/N + 接触区域 + 返回；无动画（§六十） */
  private renderDone(inner: HTMLElement, q: ReviewQueue): void {
    const card = inner.createDiv({ cls: "kg-card kg-review-done" });
    card.createDiv({ cls: "kg-review-done-title", text: "🎉 今日复习完成" });
    card.createDiv({ cls: "kg-review-progress", text: q.items.length + " / " + q.items.length });
    const areas = this.plugin.reviewContactAreas(q);
    if (areas.length > 0) {
      card.createDiv({ cls: "kg-review-meta", text: "你刚刚重新接触了：" });
      card.createDiv({ cls: "kg-review-areas", text: areas.join(" · ") });
    }
    const back = card.createEl("button", { cls: "kg-btn kg-btn-primary", text: "返回知识花园" });
    back.addEventListener("click", () => { void this.plugin.activateView(); });
  }

  private act(fn: () => void): void {
    fn();
    const q = this.plugin.ensureReviewQueue();
    if (q) {
      this.queue = q;
      if (!sessionFinished(q)) {
        this.currentIndex = this.plugin.reviewResumeIndex(q);
      }
    }
    this.snoozeOpen = false;
    this.render();
  }

  private daysSinceReview(pathKey: string): string | null {
    const n = this.plugin.index.all().find((x) => x.path === pathKey);
    const a = this.plugin.activity.get(pathKey);
    if (!a || typeof a.lastReviewedAt !== "number") return null;
    const days = Math.floor((Date.now() - a.lastReviewedAt) / 86400000);
    return days < 1 ? "刚刚复习过" : days + " 天未复习";
  }
}