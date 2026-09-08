/**
 * Phase 21：Note Exam Hub（§41~58）—— 当前笔记考试中心 + 考试回顾（Exam Review）。
 *
 * - NoteExamHubModal：只读 examStore.findBySource(path)（§43/81/114，绝不整库扫描）；
 *   列出已有考试（createdAt DESC §44）：题量/主题/创建时间/会话进度(§45)/已收藏卡数(§52)；
 *   [📖 回顾]（默认，§131）→ Exam Review；[▶ 继续/重新作答] → 既有 ExamSessionView（绝不重新生成，§47）；
 *   [📄 查看考试] → 打开考试 Markdown；[已收藏 N] → 打开我的复习卡（scope=examId，§52/57）。
 * - ExamReviewView（§49~51/132~136）：回顾 ≠ 新考试，0 AI：
 *   题 → 📖 参考答案 → 解释 → 原文依据（Vault/Web 分开标注 §92）→ 🧠 上次自评 → [☆收藏为复习卡]。
 *   只有已收藏的题才允许 4 档 Rating（写 Saved Card FSRS，§134/135），绝不凭空建卡、绝不改原考试答案。
 */
import { App, ItemView, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { NoteExam, ExamQuestion } from "./types";
import { examProgress, examSessionFinished } from "./examEngine";
import { examTypeLabel } from "./examView";
import { examMarkdownPath } from "./examStore";
import { FSRS_RATINGS, FSRS_RATING_LABEL, FSRS_RATING_EMOJI } from "./spacedReview";

export const VIEW_TYPE_EXAM_REVIEW = "knowledge-garden-exam-review";

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ================= 考试中心 Modal（§43~48/80/129/130） ================= */

export class NoteExamHubModal extends Modal {
  constructor(app: App, private plugin: KnowledgeGardenPlugin, private sourcePath: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kg-dashboard");
    const title = this.plugin.basename(this.sourcePath);
    contentEl.createEl("h3", { text: "📝《" + title + "》考试中心" });
    const exams = this.plugin.examStore.findBySource(this.sourcePath);   // §43：只查该笔记（§81/114）
    if (exams.length === 0) {
      contentEl.createDiv({ cls: "kg-empty", text: "这篇笔记还没有创建考试。" });   // §129
      const row = contentEl.createDiv({ cls: "kg-row" });
      row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "构建考试" })
        .addEventListener("click", () => {
          this.close();
          const f = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
          if (f instanceof TFile) void this.plugin.openExamBuilder(f);
          else this.plugin.openExamBuilderForActive();
        });
      return;
    }
    contentEl.createDiv({ cls: "kg-review-progress", text: "共 " + exams.length + " 场考试（回顾/继续/查看全部 0 AI，绝不重新生成）。" });
    for (const e of exams) this.renderExamRow(contentEl, e);   // findBySource 已 createdAt DESC
  }

  private renderExamRow(parent: HTMLElement, e: NoteExam): void {
    const plugin = this.plugin;
    const st = plugin.examSessions.get(e.id);
    const progress = examProgress(e, st?.answers ?? []);
    const finished = !!st && examSessionFinished(st, e.questions.length);
    const running = !!st && st.status === "running" && !finished;
    const savedCount = plugin.cards.findByExam(e.id).length;
    const box = parent.createDiv({ cls: "kg-card kg-card-row kg-hub-exam" });
    const head = box.createDiv({ cls: "kg-row kg-hub-head" });
    head.createDiv({ cls: "kg-card-question", text: "《" + e.title + "》" });
    head.createSpan({ cls: "kg-chip", text: e.mode === "custom" ? "主题卷" : "整体考察" });
    if (e.difficulty) head.createSpan({ cls: "kg-chip", text: e.difficulty });
    const meta = box.createDiv({ cls: "kg-card-meta" });
    const parts = [
      (e.topic ? "主题：" + e.topic : ""),
      e.questionCount + " 题",
      "创建 " + fmtDate(e.createdAt),
      st ? "进度 " + (progress.answered + progress.skipped) + " / " + progress.total : "未开始",
    ].filter(Boolean);
    meta.setText(parts.join(" · "));
    if (st) box.createDiv({ cls: "kg-card-meta", text: "完成：" + (finished ? "✓" : "进行中" + (progress.answered > 0 ? "（已答 " + progress.answered + "）" : "")) });

    const actions = box.createDiv({ cls: "kg-row" });
    const reviewBtn = actions.createEl("button", { cls: "kg-btn kg-btn-primary", text: "📖 回顾" });   // §131：默认回顾
    reviewBtn.addEventListener("click", () => { this.close(); plugin.openExamReview(e.id); });
    const contBtn = actions.createEl("button", { cls: "kg-btn", text: running ? "▶ 继续作答" : "▶ 重新作答" });
    contBtn.addEventListener("click", () => { this.close(); if (running) void plugin.openExamSession(e.id); else plugin.retakeExamSession(e.id); });
    const viewBtn = actions.createEl("button", { cls: "kg-btn", text: "📄 查看考试" });
    viewBtn.addEventListener("click", () => {
      this.close();
      const f = plugin.app.vault.getAbstractFileByPath(examMarkdownPath(e));
      if (f) plugin.openNote((f as { path: string }).path);
      else { new Notice("考试 Markdown 不存在（可在考试视图内重新生成）。"); void plugin.openExamSession(e.id); }
    });
    if (savedCount > 0) {
      const cardsBtn = actions.createEl("button", { cls: "kg-btn", text: "📚 已收藏 " + savedCount + " 张" });
      cardsBtn.addEventListener("click", () => { this.close(); void plugin.openCardsView({ scope: { mode: "exam", examId: e.id } }); });   // §52/57
    }
  }

  onClose(): void { this.contentEl.empty(); }
}

/* ================= Exam Review（回顾模式：§49~51/132~136；0 AI） ================= */

export class ExamReviewView extends ItemView {
  private exam: NoteExam | null = null;
  private qIndex = 0;
  private savedByQuestion = new Map<string, boolean>();

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_EXAM_REVIEW; }
  getDisplayText(): string { return this.exam ? "回顾 · " + this.exam.title : "考试回顾"; }
  getIcon(): string { return "book-open"; }

  loadExam(examId: string): void {
    const e = this.plugin.examStore.get(examId);
    if (!e) { new Notice("考试不存在或已删除（收藏卡不受影响）。"); return; }
    this.exam = e;
    this.qIndex = 0;
    this.syncSavedMap();
    this.render();
  }

  private syncSavedMap(): void {
    this.savedByQuestion.clear();
    if (!this.exam) return;
    for (const c of this.plugin.cards.findByExam(this.exam.id)) {
      if (c.examQuestionId) this.savedByQuestion.set(c.examQuestionId, true);
    }
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.containerEl.addClass("kg-exam");
    this.containerEl.createDiv({ cls: "kg-inner" });
    if (!this.exam) {
      // 从参数恢复（openExamReview 设置 view 后调用 loadExam，这里仅兜底）
      const param = (this as unknown as { examIdParam?: string }).examIdParam;
      if (param) this.loadExam(param);
      else this.containerEl.querySelector(".kg-inner")?.createDiv({ cls: "kg-empty", text: "还没有打开要回顾的考试。在笔记右键 →「📝 本篇笔记考试中心」→ 回顾。" });
      return;
    }
    this.render();
  }

  async refresh(): Promise<void> {
    this.syncSavedMap();
    this.render();
  }
  async onClose(): Promise<void> { this.containerEl.empty(); }

  private render(): void {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
    if (!inner) return;
    inner.empty();
    const e = this.exam;
    if (!e) return;
    const q = e.questions[this.qIndex];
    if (!q) { inner.createDiv({ cls: "kg-empty", text: "这份考试没有题目。" }); return; }

    const head = inner.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "📖 回顾 ·《" + e.title + "》" });
    head.createSpan({ cls: "kg-review-progress", text: (this.qIndex + 1) + " / " + e.questions.length + " · 回顾模式（0 AI，不写新考试）" });

    const card = inner.createDiv({ cls: "kg-card kg-exam-card" });
    card.createDiv({ cls: "kg-exam-qmeta", text: "第 " + (this.qIndex + 1) + " 题 · " + examTypeLabel(q.type) + (q.concept ? " · ★ " + q.concept : "") });
    card.createDiv({ cls: "kg-exam-question", text: q.question });

    // 选择题选项（展示 + 正确答案标注；kg-card 内部 kg-exam-options 网格样式，§84/94）
    if (q.type === "multiple_choice" && q.options && q.options.length) {
      const optsBox = card.createDiv({ cls: "kg-exam-options" });
      for (let i = 0; i < q.options.length; i++) {
        const o = q.options[i];
        const lbl = String.fromCharCode(65 + i);
        const row = optsBox.createDiv({ cls: "kg-exam-opt" });
        row.createSpan({ cls: "kg-exam-opt-lbl", text: lbl });
        row.createDiv({ cls: "kg-exam-opt-text", text: o });
        const correct = q.correctAnswer === lbl || (q.correctAnswer && q.correctAnswer.trim().toUpperCase() === lbl);
        if (correct) row.addClass("kg-exam-opt-correct");
      }
      if (q.correctAnswer) card.createDiv({ cls: "kg-exam-opt-correct kg-exam-correct-note", text: "✅ 正确答案：" + q.correctAnswer });
    }

    // 答案区默认显示（§93/132/156）
    const ans = card.createDiv({ cls: "kg-exam-answer-area" });
    ans.createDiv({ cls: "kg-exam-answer-title", text: "📖 参考答案" });
    ans.createDiv({ cls: "kg-exam-answer-text", text: q.referenceAnswer || "（该题未提供参考答案）" });
    if (q.explanation) ans.createDiv({ cls: "kg-exam-ans-explanation", text: "解释：" + q.explanation });

    // 原文依据（Vault 证据；web 来源显式分开 §90~92）
    if (q.sourceEvidence && q.sourceEvidence.length) {
      ans.createDiv({ cls: "kg-exam-ans-evidence-label", text: "📎 原文依据" });
      for (const s of q.sourceEvidence) ans.createDiv({ cls: "kg-exam-ans-evidence", text: "• " + s });
    }
    if (q.webSources && q.webSources.length) {
      ans.createDiv({ cls: "kg-exam-ans-evidence-label", text: "🌐 Web 来源（外部，非 Vault 证据）" });
      for (const w of q.webSources) ans.createDiv({ cls: "kg-exam-ans-evidence", text: "• " + (w.title || w.url) + " — " + w.url });
    }

    // 🧠 上次自评（读既有会话，不改它，§50/134）
    const st = this.plugin.examSessions.get(e.id);
    const rec = st?.answers.find((a) => a.questionId === q.id);
    if (rec?.selfRating) {
      const emojiMap: Record<string, string> = { forgot: "😵", hard: "😕", good: "🙂", easy: "😎" };
      const labelMap: Record<string, string> = { forgot: "没想起来", hard: "很困难", good: "基本掌握", easy: "很熟练" };
      ans.createDiv({ cls: "kg-review-meta", text: "🧠 我的上次自评：" + (emojiMap[rec.selfRating] ?? "") + " " + (labelMap[rec.selfRating] ?? rec.selfRating) });
    }

    // 收藏（§53/54；去重在 main）
    const saved = this.savedByQuestion.get(q.id) ?? false;
    const starRow = inner.createDiv({ cls: "kg-row kg-review-nav" });
    const starBtn = starRow.createEl("button", { cls: "kg-btn" + (saved ? " kg-btn-primary" : ""), text: saved ? "★ 已收藏为复习卡" : "☆ 收藏为复习卡（0 AI）" });
    starBtn.addEventListener("click", () => {
      if (saved) { new Notice("已收藏过该题（examId + questionId 去重，§54）。"); return; }
      void this.saveQuestionAsCard(q).then((ok) => { if (ok) { this.syncSavedMap(); this.render(); } });
    });
    this.renderRating(starRow, q, saved);

    const nav = inner.createDiv({ cls: "kg-row kg-review-nav" });
    const back = nav.createEl("button", { cls: "kg-btn", text: "← 返回考试中心" });
    back.addEventListener("click", () => {
      if (this.exam) new NoteExamHubModal(this.app, this.plugin, this.exam.sourcePath).open();
    });
    const prev = nav.createEl("button", { cls: "kg-btn", text: "← 上一题" });
    prev.disabled = this.qIndex <= 0;
    prev.addEventListener("click", () => { if (this.qIndex > 0) { this.qIndex--; this.render(); } });
    const next = nav.createEl("button", { cls: "kg-btn", text: "下一题 →" });
    next.disabled = this.qIndex >= e.questions.length - 1;
    next.addEventListener("click", () => { if (this.qIndex < e.questions.length - 1) { this.qIndex++; this.render(); } });
  }

  /** §134/135：只有已收藏的题才允许 Rating（写该 Saved Card 的 FSRS；评分=复习反馈，不改原考试答案/不建新卡） */
  private renderRating(parent: HTMLElement, q: ExamQuestion, saved: boolean): void {
    const e = this.exam;
    if (!e) return;
    if (!saved) {
      parent.createSpan({ cls: "kg-review-days", text: "收藏后可直接在这里用 😵😕🙂😎 同步复习卡（未收藏不会凭空建卡，§135）" });
      return;
    }
    const card = this.plugin.cards.findByExamQuestion(e.id, q.id);
    if (!card) return;
    const row = parent.createDiv({ cls: "kg-row" });
    row.createSpan({ cls: "kg-review-qlabel", text: "复习反馈：" });
    const btns = row.createDiv({ cls: "kg-exam-selfrating" });
    for (const r of FSRS_RATINGS) {
      const b = btns.createEl("button", { cls: "kg-btn", text: FSRS_RATING_EMOJI[r] + " " + FSRS_RATING_LABEL[r] });
      b.addEventListener("click", () => {
        const ok = this.plugin.rateSavedCard(card.id, r);
        if (ok) {
          new Notice("已同步复习卡（" + FSRS_RATING_EMOJI[r] + FSRS_RATING_LABEL[r] + "，0 AI）。原考试答案未修改。");
          this.refresh();
        }
      });
    }
  }

  private async saveQuestionAsCard(q: ExamQuestion): Promise<boolean> {
    const e = this.exam;
    if (!e) return false;
    try {
      await this.plugin.saveReviewCard({
        sourcePath: e.sourcePath,
        sourceVersion: e.sourceVersion,
        examId: e.id,
        examQuestionId: q.id,
        question: q.question,
        answer: q.referenceAnswer,
        explanation: q.explanation,
        questionType: q.type,
        options: q.type === "multiple_choice" ? q.options : undefined,
        correctAnswer: q.type === "multiple_choice" || q.type === "true_false" ? q.correctAnswer : undefined,
        sourceEvidence: q.sourceEvidence,
        concept: q.concept,
      });
      return true;
    } catch {
      new Notice("收藏失败（0 AI）。");
      return false;
    }
  }
}
