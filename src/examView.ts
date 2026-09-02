/** Phase 14 Exam UI：构建考试 Modal + 考试会话视图（Card Mode 默认 / Exam Mode）。 
 * - 视图只做 UI 与事件转发；状态写入 main.ts（ExamSessionStore 持久化 §一百八十七）。
 * - 开放题默认不自动 AI 评分（§二百二十七：按需点击「AI 评估我的回答」）。
 * - 完成页不伪造单一数字：自评掌握 % + AI 评估 %（有则显示）+ 差异提示（§二百三十~二百三十三）。
 */
import { ItemView, Modal, Notice, Setting, TFile, WorkspaceLeaf } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { ExamAnswerMode, ExamDifficulty, ExamMode, ExamQuestion, ExamQuestionType, MasteryRating, NoteExam, ExamSessionState } from "./types";
import { examProgress, examSessionFinished, canonicalizeExamIndex, selfMasteryPercent, aiMasteryPercent, masteryLabel, weakConceptsOf, strongConceptsOf, masteryGapHint } from "./examEngine";

export const VIEW_TYPE_EXAM = "knowledge-garden-exam";

export interface ExamBuildParams {
  mode: ExamMode;
  topic?: string;
  questionCount: number;
  difficulty: ExamDifficulty;
  answerMode: ExamAnswerMode;
  webEnabled: boolean;
  cardMode: boolean;
  force?: boolean;
}

const MASTERY_OPTIONS: { value: MasteryRating; label: string }[] = [
  { value: "forgot", label: "😵 没想起来" },
  { value: "hard", label: "😕 很困难" },
  { value: "good", label: "🙂 基本掌握" },
  { value: "easy", label: "😎 很熟练" },
];

const COUNT_OPTIONS = [3, 5, 8, 10, 15, 20];

/** 构建考试 Modal（§六/七/十一~十四/十五）：Holistic / Custom 主题 / 题量 / 难度 / 答案来源 / Web（默认 OFF）。 */
export class ExamBuildModal extends Modal {
  private params: ExamBuildParams;
  private topicInput: HTMLInputElement | null = null;
  private countInput: HTMLInputElement | null = null;
  constructor(
    private plugin: KnowledgeGardenPlugin,
    private file: TFile,
    private onGenerate: (p: ExamBuildParams) => void
  ) {
    super(plugin.app);
    const e = plugin.settings.exam;
    this.params = {
      mode: e.defaultMode === "custom" ? "custom" : "holistic",
      questionCount: e.defaultCount || 5,
      difficulty: (e.defaultDifficulty === "easy" || e.defaultDifficulty === "hard" ? e.defaultDifficulty : "medium"),
      answerMode: (e.defaultAnswerMode === "source_only" || e.defaultAnswerMode === "web_allowed" ? e.defaultAnswerMode : "source_preferred"),
      webEnabled: !!e.webEnabled,
      cardMode: e.cardMode !== false,
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kg-exam-modal");
    const head = contentEl.createDiv({ cls: "kg-modal-head", text: "📝 构建知识考试" });
    contentEl.createDiv({ cls: "kg-modal-sub", text: "《" + this.file.basename + "》 · 针对这篇笔记生成考察你的真实理解度的考试（AI 只出题，答案以原文为准）。" });

    new Setting(contentEl)
      .setName("考试方式")
      .setDesc("整体考察：不限定主题，AI 覆盖全文主要结构；自定义：你指定主题严格围绕它出题。")
      .addDropdown((dd) => {
        dd.addOption("holistic", "AI 整体性考察");
        dd.addOption("custom", "自定义主题");
        dd.setValue(this.params.mode);
        dd.onChange((v) => {
          this.params.mode = v as ExamMode;
          if (this.topicInput) this.topicInput.disabled = v !== "custom";
        });
      });
    new Setting(contentEl)
      .setName("主题（自定义时必填）")
      .setDesc("例如：模块边界、耦合、维护成本")
      .addText((t) => {
        this.topicInput = t.inputEl;
        t.inputEl.disabled = this.params.mode !== "custom";
        t.setPlaceholder("例如：为什么要划分模块边界");
        t.onChange((v) => { this.params.topic = v.trim() || undefined; });
      });
    new Setting(contentEl)
      .setName("题目数量")
      .setDesc("OpenAI 生成题数。")
      .addDropdown((dd) => {
        for (const n of COUNT_OPTIONS) dd.addOption(String(n), String(n) + " 题");
        dd.addOption("custom", "自定义…");
        dd.setValue(String(this.params.questionCount));
        dd.onChange((v) => {
          if (v === "custom") {
            // 简易自定义输入
            if (!this.countInput) {
              new Setting(contentEl)
                .setName("自定义题目数量（1~30）")
                .addText((t2) => {
                  this.countInput = t2.inputEl;
                  t2.inputEl.value = String(this.params.questionCount);
                  t2.onChange((v2) => {
                    const n = parseInt(v2, 10);
                    if (Number.isFinite(n) && n >= 1 && n <= 30) this.params.questionCount = n;
                  });
                });
            }
          } else this.params.questionCount = parseInt(v, 10);
        });
      });
    new Setting(contentEl)
      .setName("难度")
      .addDropdown((dd) => {
        dd.addOption("easy", "简单");
        dd.addOption("medium", "中等");
        dd.addOption("hard", "困难");
        dd.setValue(this.params.difficulty);
        dd.onChange((v) => { this.params.difficulty = v as ExamDifficulty; });
      });
    new Setting(contentEl)
      .setName("答案来源")
      .setDesc("原文：答案只来自这篇笔记；原文优先：可补充但注明；允许联网：原文 + 外部资料。")
      .addDropdown((dd) => {
        dd.addOption("source_only", "仅原文");
        dd.addOption("source_preferred", "原文优先");
        dd.addOption("web_allowed", "允许联网补充");
        dd.setValue(this.params.answerMode);
        dd.onChange((v) => {
          this.params.answerMode = v as ExamAnswerMode;
          if (v === "web_allowed") this.params.webEnabled = true;
        });
      });
    if (this.plugin.settings.webSearch?.providers?.length) {
      new Setting(contentEl)
        .setName("允许联网（默认关闭）")
        .setDesc("仅当你上面选择「允许联网补充」且已配置 Web 时生效。")
        .addToggle((t) => {
          t.setValue(this.params.webEnabled);
          t.onChange((v) => { this.params.webEnabled = v; });
        });
    }
    new Setting(contentEl)
      .setName("答题模式")
      .setDesc("卡片模式：一题一答，适合复习；考试模式：全部做完后统一揭示答案，适合检验自己。")
      .addDropdown((dd) => {
        dd.addOption("card", "卡片模式");
        dd.addOption("exam", "考试模式");
        dd.setValue(this.params.cardMode ? "card" : "exam");
        dd.onChange((v) => { this.params.cardMode = v !== "exam"; });
      });
    new Setting(contentEl)
      .setName("生成考试")
      .addButton((b) => {
        b.setButtonText("生成").setCta();
        b.onClick(() => { this.close(); this.onGenerate(this.params); });
      });
  }
  onClose(): void { this.contentEl.empty(); }
}

/** 考试会话视图：卡片 / 考试两种模式 + 完成页（§五十三/七十一/一百五十）。 */
export class ExamSessionView extends ItemView {
  private exam: NoteExam | null = null;
  private state: ExamSessionState | null = null;
  private currentAnswer = "";
  private revealed = false;
  private skipLockUntil = 0;     // Hotfix2 §26：跳过连点 300ms 锁（HF2-13）
  private aiGrading = false;
  private aiResult: { correctness: string; score: number; strengths: string[]; missing: string[]; misconceptions: string[] } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_EXAM; }
  getDisplayText(): string { return this.exam ? "📝 " + this.exam.title : "知识考试"; }
  getIcon(): string { return "graduation-cap"; }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.containerEl.addClass("kg-exam");
    const inner = this.containerEl.createDiv({ cls: "kg-inner" });
    const examId = (this as unknown as { examIdParam?: string }).examIdParam;
    const st = this.plugin.getActiveExamSession();
    if (!st) {
      inner.createDiv({ cls: "kg-empty", text: "还没有进行中的考试。右键任意笔记 → 📝 构建知识考试，或从命令面板运行「构建知识考试」。" });
      return;
    }
    this.exam = this.plugin.examStore.get(st.examId) ?? null;
    if (!this.exam) {
      inner.createDiv({ cls: "kg-empty", text: "考试不存在或已删除（收藏卡不受影响）。" });
      return;
    }
    this.state = st;
    this.render(inner);
  }

  async refresh(): Promise<void> {
    const inner = this.containerEl.querySelector(".kg-inner") as HTMLElement | null;
    if (!inner) return;
    inner.empty();
    let st = this.plugin.getActiveExamSession();
    this.exam = st ? this.plugin.examStore.get(st.examId) ?? null : null;
    if (st && st.status !== "completed" && st.mode === "card" && this.exam) {
      const target = canonicalizeExamIndex(this.exam, st);
      if (target !== st.currentIndex) {
        console.info("[KG][Exam] canonicalize " + st.currentIndex + " -> " + target);
        this.plugin.advanceExamSession(st.examId, target);
        st = this.plugin.getActiveExamSession();
        this.exam = st ? this.plugin.examStore.get(st.examId) ?? null : null;
      }
    }
    this.state = st;
    if (st && st.status === "completed") { this.renderDone(inner); return; }
    this.render(inner);
  }

  private render(inner: HTMLElement): void {
    inner.empty();
    if (!this.exam || !this.state) {
      inner.createDiv({ cls: "kg-empty", text: "没有进行中的考试。" });
      return;
    }
    const e = this.exam;
    if (this.state.status === "completed" || examSessionFinished(this.state, e.questions.length)) {
      this.renderDone(inner);
      return;
    }
    const head = inner.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "📝 " + e.title });
    head.createSpan({ cls: "kg-review-progress", text: "模式：" + (this.state.mode === "exam" ? "考试模式" : "卡片模式") + " · " + (this.plugin.getExamProgressText(e, this.state)) });

    const q = e.questions[this.state.currentIndex];
    if (!q) { this.renderDone(inner); return; }
    // Hotfix2 §19/25：已答未评 → 恢复答案区 + 自评（HF2-3/4/15；避免 reload/autoGrade 重绘把答案区擦掉）
    const prevRec = this.state.answers.find((a) => a.questionId === q.id);
    if (this.state.mode === "card" && prevRec && typeof prevRec.answer === "string" && !prevRec.skipped && !prevRec.selfRating) {
      const rCard = inner.createDiv({ cls: "kg-card kg-exam-card" });
      rCard.createDiv({ cls: "kg-exam-qmeta", text: "第 " + (this.state.currentIndex + 1) + " / " + e.questions.length + " 题 · " + examTypeLabel(q.type) + (q.concept ? " · " + q.concept : "") });
      rCard.createDiv({ cls: "kg-exam-question", text: q.question });
      if (q.type === "multiple_choice" && q.options && q.options.length) {
        const optsBox = rCard.createDiv({ cls: "kg-exam-options" });
        for (let i = 0; i < q.options.length; i++) {
          const o = q.options[i];
          const lbl = String.fromCharCode(65 + i);
          const row = optsBox.createDiv({ cls: "kg-exam-opt" });
          row.createSpan({ cls: "kg-exam-opt-lbl", text: lbl });
          row.createDiv({ cls: "kg-exam-opt-text", text: o });
        }
        this.renderOptsResult(optsBox, q, prevRec.answer.trim().charAt(0));
      }
      const skipRow = rCard.createDiv({ cls: "kg-row" });
      skipRow.createEl("button", { cls: "kg-btn", text: "跳过（记为 skipped，不评分）" })
        .addEventListener("click", () => {
          if (this.skipLockUntil > Date.now()) return;
          this.skipLockUntil = Date.now() + 300;
          this.plugin.skipExamQuestion(this.state!.examId, q.id);
          this.refresh();
        });
      this.revealed = true;
      this.renderAfterAnswer(rCard, q);
      return;
    }

    // Hotfix3：渲染未答新题时重置视图级状态（否则第一题后 revealed/aiGrading/currentAnswer 泄漏，后续题无法作答/评分）
    this.revealed = false;
    this.aiGrading = false;
    this.currentAnswer = "";

    const card = inner.createDiv({ cls: "kg-card kg-exam-card" });
    card.createDiv({ cls: "kg-exam-qmeta", text: "第 " + (this.state.currentIndex + 1) + " / " + e.questions.length + " 题 · " + examTypeLabel(q.type) + (q.concept ? " · " + q.concept : "") });
    card.createDiv({ cls: "kg-exam-question", text: q.question });

    if (q.type === "multiple_choice" && q.options && q.options.length) {
      const optsBox = card.createDiv({ cls: "kg-exam-options" });
      for (let i = 0; i < q.options.length; i++) {
        const o = q.options[i];
        const lbl = String.fromCharCode(65 + i);
        const row = optsBox.createDiv({ cls: "kg-exam-opt" });
        row.createSpan({ cls: "kg-exam-opt-lbl", text: lbl });
        row.createDiv({ cls: "kg-exam-opt-text", text: o });
        row.addEventListener("click", () => {
          if (this.revealed) return;     // Hotfix2 §27：答案显示后不再触发重复作答（HF2-12）
          const ans = this.state!.mode === "exam" ? lbl : lbl + ". " + o;
          this.currentAnswer = ans;
          this.plugin.answerExamQuestion(this.state!.examId, q.id, ans);
          if (this.state!.mode === "card") {
            this.revealed = true;
            this.renderOptsResult(optsBox, q, lbl);
            this.renderAfterAnswer(card, q);
          }
        });
      }
      if (this.state.mode === "exam") {
        const done = card.createDiv({ cls: "kg-row" });
        const submit = done.createEl("button", { cls: "kg-btn kg-btn-primary", text: "提交全部题并统一揭示" });
        submit.addEventListener("click", () => { this.plugin.completeExamAll(this.state!.examId); this.refresh(); });
      }
    } else if (q.type === "true_false") {
      const tf = card.createDiv({ cls: "kg-exam-options" });
      for (const v of ["true", "false"]) {
        const row = tf.createDiv({ cls: "kg-exam-opt" });
        row.createDiv({ cls: "kg-exam-opt-text", text: v === "true" ? "✓ 正确" : "✗ 错误" });
        row.addEventListener("click", () => {
          if (this.revealed) return;     // Hotfix2 §27
          this.currentAnswer = v;
          this.plugin.answerExamQuestion(this.state!.examId, q.id, v);
          if (this.state!.mode === "card") { this.revealed = true; this.renderAfterAnswer(card, q); }
        });
      }
    } else {
      const ta = card.createEl("textarea", { cls: "kg-exam-answer-input", attr: { rows: "5", placeholder: "先凭自己的记忆回答，不要看答案…" } });
      ta.value = this.currentAnswer;
      ta.addEventListener("input", () => { this.currentAnswer = ta.value; });
      const row = card.createDiv({ cls: "kg-row" });
      const recallBtn = row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "我想好了（先自己回忆）" });
      recallBtn.addEventListener("click", () => {
        if (this.revealed) return;     // Hotfix2 §27
        this.plugin.answerExamQuestion(this.state!.examId, q.id, this.currentAnswer.trim() || "（未填写）");
        this.revealed = true;
        this.renderAfterAnswer(card, q);
      });
    }

    const skip = card.createDiv({ cls: "kg-row" });
    skip.createEl("button", { cls: "kg-btn", text: "跳过（记为 skipped，不评分）" })
      .addEventListener("click", () => {
        if (this.skipLockUntil > Date.now()) return;
        this.skipLockUntil = Date.now() + 300;     // Hotfix2 §26：连点 Skip 只推进 1 题（HF2-13）
        this.plugin.skipExamQuestion(this.state!.examId, q.id);
        this.refresh();
      });
  }

  private renderOptsResult(optsBox: HTMLElement, q: ExamQuestion, picked: string): void {
    for (const el of Array.from(optsBox.querySelectorAll(".kg-exam-opt"))) {
      const lbl = el.querySelector(".kg-exam-opt-lbl")?.textContent ?? "";
      if (lbl === picked) el.addClass("kg-exam-opt-picked");
      if (q.correctAnswer && lbl === q.correctAnswer.trim()) el.addClass("kg-exam-opt-correct");
    }
  }

  private renderAfterAnswer(card: HTMLElement, q: ExamQuestion): void {
    if (!this.state) return;
    const answerArea = card.createDiv({ cls: "kg-exam-answer-area" });
    answerArea.createDiv({ cls: "kg-exam-answer-title", text: "📖 参考答案" });
    answerArea.createDiv({ cls: "kg-exam-answer-text", text: q.referenceAnswer });
    if (q.explanation) answerArea.createDiv({ cls: "kg-exam-ans-explanation", text: "说明：" + q.explanation });
    if (q.sourceEvidence && q.sourceEvidence.length) {
      answerArea.createDiv({ cls: "kg-exam-ans-evidence-label", text: "📎 原文依据" });
      for (const s of q.sourceEvidence) answerArea.createDiv({ cls: "kg-exam-ans-evidence", text: "• " + s });
    }
    if (q.type === "recall" || q.type === "explanation" || q.type === "application" || q.type === "comparison" || q.type === "counterexample") {
      if (this.plugin.settings.exam.autoGrade && !this.aiGrading) {
        this.aiGrading = true;
        void this.gradeWithAI(q);
      } else if (!this.aiGrading) {
        const g = answerArea.createDiv({ cls: "kg-row" });
        g.createEl("button", { cls: "kg-btn kg-btn-primary", text: "AI 评估我的回答（按需，0~1 次 Token）" })
          .addEventListener("click", () => { this.aiGrading = true; void this.gradeWithAI(q); });
      }
    }
    const stRec = this.state.answers.find((a) => a.questionId === q.id);
    if (stRec && typeof stRec.aiScore === "number") {
      answerArea.createDiv({ cls: "kg-exam-ai-result", text: "AI 评估：" + stRec.aiScore + " / 5" });
      if (stRec.aiAssessment) answerArea.createDiv({ cls: "kg-exam-ai-assessment", text: stRec.aiAssessment });
    }
    this.renderSelfRating(answerArea, q);
  }

  private async gradeWithAI(q: ExamQuestion): Promise<void> {
    const st = this.state;
    if (!st || !this.exam) return;
    // Hotfix2 §25：AI 结果持久化在 session，由 render() 统一恢复展示；不再手动 append（避免被 refresh 擦掉）
    const r = await this.plugin.gradeExamQuestion(st.examId, q.id);
    if (r && r.aiScore !== undefined) this.refresh();
  }

  private renderSelfRating(area: HTMLElement, q: ExamQuestion): void {
    const st = this.state;
    if (!st) return;
    const row = area.createDiv({ cls: "kg-row" });
    row.createSpan({ cls: "kg-review-qlabel", text: "我掌握得怎么样？（自评后才能下一题）" });
    const btns = area.createDiv({ cls: "kg-exam-selfrating" });
    for (const m of MASTERY_OPTIONS) {
      const b = btns.createEl("button", { cls: "kg-btn", text: m.label });
      b.addEventListener("click", () => {
        this.plugin.selfRateExamQuestion(st.examId, q.id, m.value);
        const next = this.plugin.examNextIndex(st.examId);
        if (next === null) this.refresh();
        else {
          this.plugin.advanceExamSession(st.examId, next);
          this.refresh();
        }
      });
    }
  }

  private renderDone(inner: HTMLElement): void {
    inner.empty();
    if (!this.exam || !this.state) {
      inner.createDiv({ cls: "kg-empty", text: "没有可完成的考试。" });
      return;
    }
    const e = this.exam;
    const answers = this.state.answers;
    const prog = examProgress(e, answers);
    const self = selfMasteryPercent(answers);
    const ai = aiMasteryPercent(answers);
    const weak = weakConceptsOf(e, answers);
    const strong = strongConceptsOf(e, answers);
    const gap = masteryGapHint(self, ai);

    inner.createDiv({ cls: "kg-section-title", text: "🎉 本次考试完成" });
    inner.createDiv({ cls: "kg-empty", text: "「完成考试」不等于「标记为已复习」——需要计入复习时请点下方按钮。（§一百五十/九十八）" });

    const summary = inner.createDiv({ cls: "kg-card kg-exam-summary" });
    summary.createDiv({ cls: "kg-exam-summary-line", text: "已作答 " + prog.answered + " / " + prog.total + " · 跳过 " + prog.skipped });
    if (self !== null) {
      summary.createDiv({ cls: "kg-exam-summary-line", text: "自评掌握： " + self + "%（" + masteryLabel(self) + "）" });
    } else {
      summary.createDiv({ cls: "kg-exam-summary-line", text: "自评掌握：未自评" });
    }
    if (ai !== null) {
      summary.createDiv({ cls: "kg-exam-summary-line", text: "AI 评估： " + ai + "%（按需评分 " + prog.graded + " 题）" });
      summary.createDiv({ cls: "kg-exam-summary-note", text: "AI 分数不是唯一真值：它是辅助评估（§二百三十一）。" });
    }
    if (gap) summary.createDiv({ cls: "kg-exam-summary-gap", text: "⚠ " + gap });

    if (weak.length) {
      summary.createDiv({ cls: "kg-exam-weak-label", text: "核心薄弱点" });
      for (const c of weak) summary.createDiv({ cls: "kg-exam-weak", text: "• " + c });
    }
    if (strong.length) {
      summary.createDiv({ cls: "kg-exam-strong-label", text: "最熟悉" });
      for (const c of strong) summary.createDiv({ cls: "kg-exam-strong", text: "• " + c });
    }

    const actions = inner.createDiv({ cls: "kg-exam-actions" });
    actions.createEl("button", { cls: "kg-btn", text: "🔁 重新参加（同一套题，新会话，0 AI）" })
      .addEventListener("click", () => { this.plugin.retakeExamSession(e.id); });
    actions.createEl("button", { cls: "kg-btn", text: "♻ 重新生成考试（调用 AI，跳过缓存）" })
      .addEventListener("click", () => { void this.plugin.regenerateExam(e.id); });
    actions.createEl("button", { cls: "kg-btn", text: "☆ 收藏全部优秀卡片（需确认）" })
      .addEventListener("click", () => { void this.plugin.saveAllCardsFromExam(e.id); });
    actions.createEl("button", { cls: "kg-btn", text: "✓ 将本次考试计为复习（调用 activity.markReviewed）" })
      .addEventListener("click", () => { void this.plugin.markExamAsReviewed(e.id); });
    actions.createEl("button", { cls: "kg-btn", text: "打开原笔记" })
      .addEventListener("click", () => { this.plugin.openNote(e.sourcePath); });
    actions.createEl("button", { cls: "kg-btn", text: "📚 打开我的复习卡" })
      .addEventListener("click", () => { void this.plugin.openCardsView(); });
  }
}

/** 题型中文标签 */
export function examTypeLabel(t: ExamQuestionType): string {
  switch (t) {
    case "recall": return "回忆";
    case "explanation": return "解释";
    case "comparison": return "比较";
    case "application": return "应用";
    case "true_false": return "判断";
    case "multiple_choice": return "选择";
    case "counterexample": return "反例 / 边界";
  }
}
