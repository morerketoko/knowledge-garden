/** Exam Engine（Phase 14 §197-234）：纯函数——题面解析/校验/去重、Mastery 计算、薄弱点提取、双指标差异提示。
 * - 不依赖 Obsidian DOM 与本地存储，便于测试。
 * - AI 输出是不可信输入：代码层过滤（空题/重复/无答案/非法 type）。
 * - Mastery：以用户自评为主，AI 评分为辅，绝不硬合成一个唯一数字。
 */
import type { ExamAnswer, ExamQuestion, ExamQuestionType, MasteryRating, NoteExam } from "./types";

export const VALID_EXAM_TYPES: ExamQuestionType[] = [
  "recall", "explanation", "comparison", "application", "true_false", "multiple_choice", "counterexample",
];

export function normalizedExamQuestion(q: string): string {
  return (q || "").replace(/[ \t\u3000]+/g, " ").replace(/[。．.!！?？;；,，]/g, " ").toLowerCase().trim().slice(0, 160);
}

export function filterValidExamQuestions(raw: unknown, maxCount: number): ExamQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ExamQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= maxCount) break;
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const type = rec["type"] as string;
    if (!VALID_EXAM_TYPES.includes(type as ExamQuestionType)) continue;
    const question = typeof rec["question"] === "string" ? rec["question"].trim().slice(0, 300) : "";
    if (!question) continue;
    const norm = normalizedExamQuestion(question);
    if (seen.has(norm)) continue;
    const referenceAnswer = typeof rec["referenceAnswer"] === "string" ? rec["referenceAnswer"].trim().slice(0, 1200) : "";
    if (!referenceAnswer) continue;
    if (type === "multiple_choice") {
      const opts = Array.isArray(rec["options"]) ? rec["options"].map((o) => String(o)).filter(Boolean).slice(0, 6) : [];
      if (opts.length !== 4) continue;
    }
    if (type === "true_false") {
      const ca = String(rec["correctAnswer"] ?? "").toLowerCase();
      if (ca !== "true" && ca !== "false") continue;
    }
    seen.add(norm);
    const evidence = Array.isArray(rec["sourceEvidence"])
      ? rec["sourceEvidence"].map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 6)
      : [];
    out.push({
      id: typeof rec["id"] === "string" && rec["id"] ? String(rec["id"]).slice(0, 40) : "q" + (out.length + 1),
      type: type as ExamQuestionType,
      question,
      options: type === "multiple_choice" ? Array.isArray(rec["options"]) ? rec["options"].map((o) => String(o)).slice(0, 4) : undefined : undefined,
      correctAnswer: type === "true_false" || type === "multiple_choice" ? String(rec["correctAnswer"] ?? "").slice(0, 120) : undefined,
      referenceAnswer,
      explanation: typeof rec["explanation"] === "string" ? rec["explanation"].trim().slice(0, 600) : undefined,
      sourceEvidence: evidence,
      sourcePath: typeof rec["sourcePath"] === "string" ? String(rec["sourcePath"]).slice(0, 400) : "",
      difficulty: rec["difficulty"] === "easy" || rec["difficulty"] === "hard" ? rec["difficulty"] : rec["difficulty"] === "medium" ? "medium" : undefined,
      concept: typeof rec["concept"] === "string" ? String(rec["concept"]).trim().slice(0, 80) : undefined,
    });
  }
  return out;
}

export function masteryRatingScore(r: MasteryRating): number {
  switch (r) {
    case "forgot": return 25;
    case "hard": return 50;
    case "good": return 75;
    case "easy": return 100;
  }
}

export function selfMasteryPercent(answers: ExamAnswer[]): number | null {
  const rated = answers.filter((a) => a.selfRating && !a.skipped);
  if (!rated.length) return null;
  const sum = rated.reduce((acc, a) => acc + masteryRatingScore(a.selfRating as MasteryRating), 0);
  return Math.round(sum / rated.length);
}

export function aiMasteryPercent(answers: ExamAnswer[]): number | null {
  const graded = answers.filter((a) => typeof a.aiScore === "number" && !a.skipped);
  if (!graded.length) return null;
  const sum = graded.reduce((acc, a) => acc + Math.max(0, Math.min(5, a.aiScore as number)) * 20, 0);
  return Math.round(sum / graded.length);
}

export function masteryLabel(p: number): string {
  if (p <= 39) return "需要重新学习";
  if (p <= 59) return "正在建立理解";
  if (p <= 79) return "基本掌握";
  if (p <= 94) return "熟练掌握";
  return "高度掌握";
}

export function weakConceptsOf(exam: NoteExam, answers: ExamAnswer[]): string[] {
  const map = new Map<string, number>();
  for (const a of answers) {
    const q = exam.questions.find((x) => x.id === a.questionId);
    if (!q || !q.concept) continue;
    const weak =
      (!a.skipped && a.selfRating && (a.selfRating === "forgot" || a.selfRating === "hard")) ||
      (!a.skipped && typeof a.aiScore === "number" && (a.aiScore as number) <= 2);
    if (weak) map.set(q.concept, (map.get(q.concept) ?? 0) + 1);
  }
  return [...map.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c).slice(0, 6);
}

export function strongConceptsOf(exam: NoteExam, answers: ExamAnswer[]): string[] {
  const map = new Map<string, number>();
  for (const a of answers) {
    const q = exam.questions.find((x) => x.id === a.questionId);
    if (!q || !q.concept) continue;
    const strong =
      (!a.skipped && a.selfRating && (a.selfRating === "good" || a.selfRating === "easy")) ||
      (!a.skipped && typeof a.aiScore === "number" && (a.aiScore as number) >= 4);
    if (strong) map.set(q.concept, (map.get(q.concept) ?? 0) + 1);
  }
  return [...map.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c).slice(0, 6);
}

export function masteryGapHint(self: number | null, ai: number | null): string | null {
  if (self === null || ai === null) return null;
  if (ai - self >= 25) return "你的回答核心方向正确，可能低估了自己的掌握程度。";
  if (self - ai >= 25) return "你可能高估了自己对这一知识点的掌握。";
  return null;
}

export interface ExamProgressStats {
  total: number;
  answered: number;
  skipped: number;
  rated: number;
  graded: number;
}

export function examProgress(exam: NoteExam, answers: ExamAnswer[]): ExamProgressStats {
  return {
    total: exam.questions.length,
    answered: answers.filter((a) => typeof a.answer === "string" && a.answer.trim() && !a.skipped).length,
    skipped: answers.filter((a) => a.skipped).length,
    rated: answers.filter((a) => a.selfRating).length,
    graded: answers.filter((a) => typeof a.aiScore === "number").length,
  };
}

export function examSessionFinished(state: { status: string; answers: ExamAnswer[] }, total: number): boolean {
  if (state.status === "completed") return true;
  if (!state.answers.length) return false;
  const handled = state.answers.filter((a) => a.skipped || typeof a.selfRating !== "undefined" || typeof a.answer === "string" || typeof a.aiScore === "number").length;
  return handled >= total;
}

export function safeExamResumeIndex(state: { answers: ExamAnswer[] }, total: number, fallback = 0): number {
  if (!state || total <= 0) return fallback;
  const idx = state.answers.length;
  return idx >= total ? Math.max(0, total - 1) : Math.max(0, idx);
}

/** Hotfix2 §21：把 currentIndex 收敛到下一「未完成」题（已跳过或已自评 = 已完成）。纯函数、幂等；上限=题数防循环。 */
export function canonicalizeExamIndex(exam: NoteExam, session: { currentIndex: number; answers: ExamAnswer[] }): number {
  let target = session.currentIndex;
  const total = exam.questions.length;
  for (let guard = 0; target < total && guard <= total; guard++) {
    const q = exam.questions[target];
    const rec = session.answers.find((a) => a.questionId === q.id);
    if (!rec || !(rec.skipped || rec.selfRating)) break;
    target++;
  }
  return target;
}
