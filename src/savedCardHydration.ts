/**
 * Phase 21 Hotfix：我的复习卡「选择题选项丢失」—— Saved Card Snapshot Hydration。
 * - 选择题选项必须是 SavedReviewCard 的一等快照数据（§72）。
 * - 旧卡缺 options → 从真实 ExamQuestion 恢复（本地 0 AI，不猜题，不改写历史，§3/10/36）；
 *   Exam 已删除 / 无 examId / 题干歧义 → 不恢复（返回 unavailable），绝不 AI 补题。
 * - 恢复只补 options/correctAnswer（缺失时）；不覆盖 card.question/answer/explanation/sourceEvidence
 *   与 id/examId/examQuestionId/createdAt/reviewCount/mastery 等（§6/37/56~58）。
 * - 本文件纯逻辑、无 Obsidian 依赖（注入 exam 查找器），便于 Node 自动测试。
 */
import type { ExamQuestion, NoteExam, SavedReviewCard } from "./types";

export type HydrationSource = "existing" | "exam" | "question-match" | "unavailable";

export interface SavedCardHydrationResult {
  card: SavedReviewCard;
  repaired: boolean;
  source: HydrationSource;
}

/** 是否「需要修复」：multiple_choice 且 options 无效（缺失/空/仅 1 项，§52/53）；correctAnswer 缺失也算（§48） */
export function needsSavedCardHydration(card: SavedReviewCard): boolean {
  if (card.questionType !== "multiple_choice") return false;
  const optionsOk = Array.isArray(card.options) && card.options.length >= 2;
  return !optionsOk || !card.correctAnswer;
}

function questionMatchesText(a: string, b: string): boolean {
  return (a || "").trim() === (b || "").trim();
}

/**
 * 单卡 hydration：
 * 恢复优先级（严格，§5）：
 *  1. examId + examQuestionId 精确定位；
 *  2. examId 内 question 文本精确匹配（必须唯一）；
 *  3. sourcePath + question 文本在所有考试内精确匹配（必须唯一）。
 */
export function hydrateSavedReviewCardWith(
  card: SavedReviewCard,
  getExam: (examId: string) => NoteExam | undefined,
  examsBySource: (sourcePath: string) => NoteExam[]
): SavedCardHydrationResult {
  if (card.questionType !== "multiple_choice") return { card, repaired: false, source: "existing" };
  const optionsOk = Array.isArray(card.options) && card.options.length >= 2;
  const needCorrect = !card.correctAnswer;
  if (optionsOk && !needCorrect) return { card, repaired: false, source: "existing" };

  // 无 examId → 无法从真实题目恢复（§9/42）
  if (!card.examId) return { card, repaired: false, source: "unavailable" };

  const exam = getExam(card.examId);
  if (!exam) return { card, repaired: false, source: "unavailable" };   // §8/43

  let matched: { q: ExamQuestion; source: HydrationSource } | null = null;

  const pick = (list: ExamQuestion[], qid?: string): { q: ExamQuestion; source: HydrationSource } | null => {
    if (qid) {
      const q = list.find((x) => x.id === qid);
      if (q) return { q, source: "exam" };
    }
    const exact = list.filter((x) => questionMatchesText(x.question, card.question));
    if (exact.length === 1) return { q: exact[0], source: "question-match" };   // 唯一才恢复（§45）
    return null;
  };

  matched = pick(exam.questions, card.examQuestionId);

  // 3) sourcePath + question 全局唯一匹配（仅当未在本考试命中）
  if (!matched) {
    const across: ExamQuestion[] = [];
    for (const e of examsBySource(card.sourcePath)) {
      if (e.questions) across.push(...e.questions);
    }
    const textMatches = across.filter((x) => questionMatchesText(x.question, card.question));
    if (textMatches.length === 1) {
      const q = textMatches[0];
      if (q.type === "multiple_choice") matched = { q, source: "question-match" };
    }
  }

  if (!matched || matched.q.type !== "multiple_choice") return { card, repaired: false, source: "unavailable" };

  const q = matched.q;
  const nextOptions = !optionsOk && Array.isArray(q.options) && q.options.length > 0 ? [...q.options] : card.options;
  const nextCorrect = needCorrect ? (q.correctAnswer || card.correctAnswer) : card.correctAnswer;
  const changed =
    (optionsOk ? false : JSON.stringify(nextOptions ?? null) !== JSON.stringify(card.options ?? null)) ||
    (needCorrect ? nextCorrect !== card.correctAnswer : false);
  if (!changed) return { card, repaired: false, source: matched.source };
  return {
    card: { ...card, options: nextOptions, correctAnswer: nextCorrect },
    repaired: true,
    source: matched.source,
  };
}

/** 批量 hydration（按 examId 缓存 Exam，避免每卡 examStore.get，§62~64；同时支持逐卡惰性调用） */
export function hydrateSavedCardBatch(
  cards: SavedReviewCard[],
  examIndex: Map<string, NoteExam>,
  examsBySource: (sourcePath: string) => NoteExam[]
): { cards: SavedReviewCard[]; repairedCount: number; unavailableCount: number } {
  const out: SavedReviewCard[] = [];
  let repairedCount = 0;
  let unavailableCount = 0;
  for (const c of cards) {
    if (!needsSavedCardHydration(c)) {
      out.push(c);
      continue;
    }
    const res = hydrateSavedReviewCardWith(c, (id) => examIndex.get(id), examsBySource);
    if (res.repaired) repairedCount++;
    else if (res.source === "unavailable") unavailableCount++;
    out.push(res.card);
  }
  return { cards: out, repairedCount, unavailableCount };
}

/** 需要批量修复的候选数（命令/统计用） */
export function legacyMcCandidates(cards: SavedReviewCard[]): SavedReviewCard[] {
  return cards.filter(needsSavedCardHydration);
}
