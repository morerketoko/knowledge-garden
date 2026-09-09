/**
 * Phase 22：我的复习卡「卡片编辑器」纯逻辑（§43~72）。
 * - 只修改 SavedReviewCard 自身快照字段；绝不改 ExamQuestion / Source Note / FSRS（除非显式重置，§59~68）。
 * - 校验：题干非空；multiple_choice 至少 2 个非空选项；correctAnswer 必须对应某选项字母（§54/§11~13）。
 * - sourcePath / examId / cardId / createdAt 一律只读不可改（§49~52）。
 * 无 Obsidian 依赖（便于 Node 自动测试）；DOM 编辑器在 cardsView。
 */
import type { FsrsRating } from "./types";
import type { SavedReviewCard } from "./types";

/** 可编辑字段输入（编辑器收集） */
export interface SavedCardEditInput {
  question: string;
  answer: string;
  explanation: string;
  concept: string;
  tagsText: string;          // 逗号/空格分隔
  options: string[];         // 仅 multiple_choice 使用
  correctAnswer: string;     // 字母 A/B/C/D… 或 true/false
}

export interface SavedCardEditValidation {
  ok: boolean;
  errors: string[];          // 空 = ok
}

/** 判断题允许值 */
export function isTrueFalseValue(v: string): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "true" || t === "false";
}

/** 字母 → 是否正确（"A"） */
export function letterIndex(letter: string): number {
  const t = (letter ?? "").trim().toUpperCase();
  if (t.length !== 1 || t < "A" || t > "Z") return -1;
  return t.charCodeAt(0) - 65;
}

export function indexToLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

/** 校验（§54/§11~13） */
export function validateSavedCardEdit(input: SavedCardEditInput, questionType: string): SavedCardEditValidation {
  const errors: string[] = [];
  const question = (input.question ?? "").trim();
  if (!question) errors.push("题干不能为空");
  const options = (input.options ?? []).map((o) => (o ?? "").trim());
  if (questionType === "multiple_choice") {
    const filled = options.filter(Boolean);
    if (filled.length < 2) errors.push("选择题至少需要 2 个选项");
    else {
      const ca = (input.correctAnswer ?? "").trim().toUpperCase();
      const idx = letterIndex(ca);
      if (idx < 0 || idx >= options.length || !options[idx]) {
        errors.push("正确答案必须对应某个选项");
      }
    }
  } else if (questionType === "true_false") {
    if (!isTrueFalseValue(input.correctAnswer)) errors.push("判断题正确答案必须是 true 或 false");
  }
  return { ok: errors.length === 0, errors };
}

/** 标签文本 → 规范化数组（逗号/中文顿号/空白分隔） */
export function parseTagsText(text: string): string[] {
  return (text ?? "")
    .split(/[,，、\s]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .slice(0, 20);
}

/** 应用编辑：只改白名单快照字段；返回新卡（不写盘）。 */
export function applySavedCardEdit(card: SavedReviewCard, input: SavedCardEditInput): SavedReviewCard {
  const options = (input.options ?? []).map((o) => (o ?? "").trim());
  const next: SavedReviewCard = {
    ...card,
    question: (input.question ?? "").trim().slice(0, 240),
    answer: (input.answer ?? "").trim().slice(0, 3000),
    explanation: (input.explanation ?? "").trim().slice(0, 1200) || undefined,
    concept: (input.concept ?? "").trim().slice(0, 80) || undefined,
    tags: parseTagsText(input.tagsText),
  };
  if (card.questionType === "multiple_choice") {
    next.options = options.length ? options.slice(0, 8) : undefined;
    next.correctAnswer = options.length ? (input.correctAnswer ?? "").trim().toUpperCase() : undefined;
  } else if (card.questionType === "true_false") {
    next.correctAnswer = (input.correctAnswer ?? "").trim().toLowerCase() || undefined;
  }
  return next;
}

/** 默认编辑草稿（从卡片初始化） */
export function editDraftFromCard(card: SavedReviewCard): SavedCardEditInput {
  const ca = card.correctAnswer ?? "";
  return {
    question: card.question ?? "",
    answer: card.answer ?? "",
    explanation: card.explanation ?? "",
    concept: card.concept ?? "",
    tagsText: (card.tags ?? []).join(", "),
    options: card.options ? [...card.options] : [],
    correctAnswer: ca,
  };
}

export type FsrsRatingOrReset = FsrsRating; // 占位（无 UI 用途，保留类型导出便于扩展）
