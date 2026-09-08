/**
 * Phase 21 Hotfix：我的复习卡「显示答案」DOM 生命周期（纯前端；0 AI）。
 * - 本模块只含**纯逻辑/内容模型**（无 Obsidian DOM 依赖，便于 Node 自动测试 P-HOTFIX-*）。
 * - View（src/cardsView.ts）用它驱动 DOM：点击「显示答案」→ 若 .answer-body 不存在则立即创建并 display:""；
 *   「隐藏答案」→ 只 display:none（不删 DOM）；按钮文字立即同步。绝不再整卡重绘（不调用 renderReview）。
 * - 答案内容一律来自 SavedReviewCard.answer（不存在时用占位文案），不调用 deriveReviewAnswer / AI（§24/26）。
 * - 每张卡用 card.id 隔离显隐状态（同一 sourcePath 可有多张卡，§19/20）。
 */
import type { SavedReviewCard } from "./types";

/** 无答案占位文案（P-HOTFIX-16：与旧渲染文案保持一致） */
export const ANSWER_FALLBACK = "（该卡没有保存答案文字）";

/** §14/15：showAnswerByDefault 默认显示语义 */
export function defaultAnswerVisible(showByDefault: boolean): boolean {
  return showByDefault !== false;
}

/**
 * 该卡当前是否可见（§19：以 card.id 为 key；同一 sourcePath 的多张卡互不污染）。
 * - 默认显示模式（showAnswerByDefault=true）：除非被加入 hiddenAnswers → 隐藏。
 * - 默认隐藏模式（showAnswerByDefault=false）：只有被加入 shownAnswers → 显示。
 */
export function answerVisibility(cardId: string, defaultVisible: boolean, hidden: Set<string>, shown: Set<string>): boolean {
  return defaultVisible ? !hidden.has(cardId) : shown.has(cardId);
}

/**
 * 点击按钮后切换显隐状态（§8：状态更新 + 返回点击后的目标可见态 willShow）。
 * 操作 hiddenAnswers / shownAnswers 两个集合，保持各自语义（§14）不变。
 */
export function toggleAnswerVisibility(cardId: string, defaultVisible: boolean, hidden: Set<string>, shown: Set<string>): boolean {
  const before = answerVisibility(cardId, defaultVisible, hidden, shown);
  const after = !before;
  if (defaultVisible) {
    if (after) hidden.delete(cardId); else hidden.add(cardId);
  } else {
    if (after) shown.add(cardId); else shown.delete(cardId);
  }
  return after;
}

export type RevealDomAction = "create" | "show" | "hide" | "none";

/**
 * §7/12/13/十六：由「当前是否已有 .answer-body」与「目标是否显示」决定对现有 DOM 的唯一动作。
 * - 目标显示且无 body → create（P-HOTFIX-02）
 * - 目标显示且有 body → show（display:""，不重建，§18）
 * - 目标隐藏且有 body → hide（display:none，不删 DOM，§12/17）
 * - 目标隐藏且无 body → none
 * 任何一次调用最多产生一次 create → 反复 显示/隐藏/显示 不会出现重复 body（P-HOTFIX-06）。
 */
export function revealDomAction(hasBody: boolean, willShow: boolean): RevealDomAction {
  if (willShow) return hasBody ? "show" : "create";
  return hasBody ? "hide" : "none";
}

/** 答案 body 内容模型（单一数据源；View 按此渲染，测试按此断言 P-HOTFIX-03/13/14/15/16） */
export interface AnswerBodyContent {
  answer: string;          // 原样；空时由渲染端显示 ANSWER_FALLBACK
  explanation?: string;
  evidence: string[];
  sourcePath: string;
}

export function answerBodyContent(card: SavedReviewCard): AnswerBodyContent {
  return {
    answer: card.answer || "",
    explanation: card.explanation,
    evidence: card.sourceEvidence ?? [],
    sourcePath: card.sourcePath,
  };
}
