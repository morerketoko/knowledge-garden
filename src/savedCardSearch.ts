/**
 * Phase 22：我的复习卡「关键词搜索」（§30~42/85/88）。
 * - 纯本地、0 AI：先在当前 scope 过滤，再按 query 过滤，最后排序（本模块只做匹配，不排序，§41）。
 * - 字段（§32~34）：question / answer / explanation / concept / sourcePath / source basename / exam title。
 * - 中文 substring；英文/数字按空白与标点切 token，AND 语义；不做 AI、不读 Markdown、不改任何缓存（§85/88）。
 */
import type { SavedReviewCard } from "./types";

/** 搜索文本归一化：去空白折叠、lowercase（中文不动，直接 substring，§35） */
export function normalizeSearchText(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 拆 token：空白与常见标点；保留 CJK 连续段（substring 语义），英文按词（§35/37） */
export function searchTokens(query: string): string[] {
  const q = normalizeSearchText(query);
  if (!q) return [];
  return q.split(/[，。！？；;：:,.!?()（）《》「」"'“”‘’、_\-—…\s#/\\|~]+/).map((t) => t.trim()).filter(Boolean);
}

/**
 * 匹配：归一化 haystack 包含整句 query，或 query 的每个 token 都出现在 haystack 中。
 * 例：输入「模块边界」→ 整句 substring 命中“为什么需要模块边界？”与“模块边界可以降低…”（§36）。
 */
export function savedCardMatchesQuery(haystack: string, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const hay = normalizeSearchText(haystack);
  if (hay.includes(q)) return true;
  const tokens = searchTokens(query);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

/** 单卡可搜索文本（含可选 exam title / source basename，§33/34） */
export function savedCardHaystack(card: SavedReviewCard, examTitle?: string, sourceBasename?: string): string {
  return [
    card.question ?? "",
    card.answer ?? "",
    card.explanation ?? "",
    card.concept ?? "",
    (card.tags ?? []).join(" "),
    card.sourcePath ?? "",
    sourceBasename ?? "",
    examTitle ?? "",
  ].join(" \n ");
}

/** scope 内过滤（保持输入顺序；排序由调用方在过滤后执行，§41） */
export function filterSavedCardsByQuery(
  cards: SavedReviewCard[],
  query: string,
  meta: (c: SavedReviewCard) => { examTitle?: string; sourceBasename?: string }
): SavedReviewCard[] {
  const q = normalizeSearchText(query);
  if (!q) return cards;
  return cards.filter((c) => savedCardMatchesQuery(savedCardHaystack(c, meta(c).examTitle, meta(c).sourceBasename), q));
}
