/**
 * Phase 23：Exam Generation 2.0 纯逻辑（无 Obsidian / AI 依赖，便于 Node 自动测试）。
 * 职责：question fingerprint / 近重复检测（trigram+token+concept 加权，中文友好）、
 * 历史上下文与 historyFingerprint、batch 计划与自适应拆分、批间/历史去重（strict/balanced/allow）、
 * coverage 主题（headings）提取与分批主题分配、replacement 数量与上限。
 * 不建立第二套 Exam/Cache/Generator（§三）：只产出计划与校验，网络调用由 AIService 复用。
 */
import type { ExamContentStrategy, ExamQuestion, ExamRepeatPolicy } from "./types";

/* ---------- 归一化 / 指纹 ---------- */

/** 简易 NFKC：常见全角 → 半角 + 中文空格；其余靠 lower/strip（Node 无内置 NFKC 时不强依赖） */
export function normalizeExamText(s: string): string {
  let t = (s ?? "").trim().toLowerCase();
  t = t.replace(/\u3000/g, " ");
  t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  t = t.replace(/[，。！？；：、,.!?;:()（）《》「」"'“”‘’[\]{}|\\/<>#*_\-—…\s]+/g, " ").trim();
  t = t.replace(/\s+/g, " ");
  return t;
}

/** 本地确定性 hash（不是加密用途；fingerprint 只要稳定即可） */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** §13：题干指纹（normalize → hash） */
export function examQuestionFingerprint(q: { question: string }): string {
  return hashText(normalizeExamText(q.question));
}

/* ---------- 相似度（§14~16/23/24） ---------- */

/** 字符 n-gram 集合（去掉空格后逐字符窗口） */
function charNGrams(s: string, n: number): Set<string> {
  const t = normalizeExamText(s).replace(/ /g, "");
  const out = new Set<string>();
  if (t.length < n) { if (t) out.add(t); return out; }
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}

/** token 集合：ASCII 词整体 + CJK 连续段及其 2-gram（提升中文改写命中） */
function tokenSet(s: string): Set<string> {
  const norm = normalizeExamText(s);
  const out = new Set<string>();
  for (const tok of norm.split(" ")) {
    if (!tok) continue;
    if (/^[\u4e00-\u9fff]+$/.test(tok)) {
      out.add(tok);
      if (tok.length >= 2) for (let i = 0; i + 2 <= tok.length; i++) out.add(tok.slice(i, i + 2));
    } else out.add(tok);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** concept 相似：归一化相等 → 1；非空且有词/2-gram 重叠 → 0.6；否则 0 */
export function conceptSimilarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const na = normalizeExamText(a);
  const nb = normalizeExamText(b);
  if (na === nb) return 1;
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  let overlap = false;
  for (const x of sa) if (sb.has(x)) { overlap = true; break; }
  return overlap ? 0.6 : 0;
}

/** §16：questionSimilarity = trigram*0.45 + token*0.35 + concept*0.20 */
export function questionSimilarity(a: string, b: string, conceptA?: string, conceptB?: string): number {
  const triA = charNGrams(a, 3);
  const triB = charNGrams(b, 3);
  const tokA = tokenSet(a);
  const tokB = tokenSet(b);
  return jaccard(triA, triB) * 0.45 + jaccard(tokA, tokB) * 0.35 + conceptSimilarity(conceptA, conceptB) * 0.2;
}

/** token/bigram 包含率（inter / min(|A|,|B|)）：用于同 concept 改写（词序调整/增删虚词）检测 */
function tokenContainment(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

function conceptsEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return normalizeExamText(a) === normalizeExamText(b);
}

export const EXAM_NEAR_DUP_THRESHOLD = 0.78;   // §16：>= 视为 near duplicate（阈值可被测试调节）

/** 近重复：score≥阈值，或“concept 相同 + token/bigram 包含率≥0.5”（中文改写，§14/15） */
export function isNearDuplicate(a: string, b: string, conceptA?: string, conceptB?: string): boolean {
  if (questionSimilarity(a, b, conceptA, conceptB) >= EXAM_NEAR_DUP_THRESHOLD) return true;
  return conceptsEqual(conceptA, conceptB) && tokenContainment(a, b) >= 0.5;
}

/* ---------- 历史上下文（§10~12/52/67/105） ---------- */

export interface ExamHistoryQuestion { question: string; concept?: string; type?: string; }

export interface ExamHistoryContext {
  examCount: number;
  priorQuestions: ExamHistoryQuestion[];   // 传给 AI 的压缩列表（≤100，§12）
  priorConcepts: string[];                 // ≤100
  priorCoverageTopics: string[];           // ≤100
  historyFingerprint: string;              // 全部历史（fingerprint+concept+topic 排序 hash，§52）
}

export function buildExamHistoryContext(exams: ReadonlyArray<{
  questions: ReadonlyArray<{ question: string; concept?: string; type?: string }>;
  coverageTopics?: string[];
}>): ExamHistoryContext {
  const fpParts: string[] = [];
  const prior: ExamHistoryQuestion[] = [];
  const concepts = new Set<string>();
  const topics = new Set<string>();
  for (const e of exams) {
    for (const q of e.questions ?? []) {
      if (!q.question) continue;
      fpParts.push(examQuestionFingerprint(q));
      if (prior.length < 100) prior.push({ question: String(q.question).slice(0, 240), concept: q.concept, type: q.type });
      const c = (q.concept ?? "").trim();
      if (c) { concepts.add(c); fpParts.push("c:" + normalizeExamText(c)); }
    }
    for (const t of e.coverageTopics ?? []) {
      const tn = (t ?? "").trim();
      if (tn) { topics.add(tn); fpParts.push("t:" + normalizeExamText(tn)); }
    }
  }
  const sortedConcepts = [...concepts].sort();
  const sortedTopics = [...topics].sort();
  fpParts.sort();
  return {
    examCount: exams.length,
    priorQuestions: prior,
    priorConcepts: sortedConcepts.slice(0, 100),
    priorCoverageTopics: sortedTopics.slice(0, 100),
    historyFingerprint: hashText(fpParts.join("|")),
  };
}

/* ---------- Batch 计划（§28~32/35/36/108/109） ---------- */

export function planExamBatches(count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n <= 15) return [n];                       // §28：<=15 单批
  const out: number[] = [];
  let rest = n;
  while (rest > 0) {
    const take = Math.min(10, rest);             // §29：batchSize=10
    out.push(take);
    rest -= take;
  }
  return out;
}

/** §36：截断重试拆分：10→5+5、5→3+2、3→2+1、2→1+1；unit<=1 → []（不再拆分） */
export function splitUnitForRetry(unit: number): number[] {
  if (unit <= 1) return [];
  if (unit === 10) return [5, 5];
  if (unit === 5) return [3, 2];
  if (unit === 3) return [2, 1];
  const half = Math.ceil(unit / 2);
  return [half, unit - half];
}

export const EXAM_MAX_BATCH_REQUESTS = 8;   // §108/109：30 题初始 3 + replacement ≤3 + 余量 ≤ 8
export const EXAM_REPLACEMENT_ROUNDS = 3;    // §46

/* ---------- 去重（§40~44/18~20） ---------- */

export interface DedupeResult {
  questions: ExamQuestion[];
  removedCount: number;
  duplicates: ExamQuestion[];
}

/**
 * 候选合并去重：同批/跨批/历史 两级去重（§41/42）。
 * - exact：题干指纹相同 → 丢弃（所有 policy）
 * - near：相似度≥阈值 → strict/balanced 丢弃
 * - concept：strict 同 concept 丢弃；balanced 仅当同 concept 且题型也相同才丢弃（换题型可保留，§19）；
 *   allow 不排除 concept，仍禁止 exact/near 之外? allow 允许历史同 concept，但同批内 exact/near 依然要防（§20）。
 */
export function dedupeExamQuestions(
  candidates: ExamQuestion[],
  history: ExamHistoryContext,
  policy: ExamRepeatPolicy
): DedupeResult {
  const kept: ExamQuestion[] = [];
  const duplicates: ExamQuestion[] = [];
  const fpSeen = new Set<string>();
  const conceptTypeSeen = new Map<string, Set<string>>();
  for (const h of history.priorQuestions) {
    fpSeen.add(examQuestionFingerprint(h));
    if (h.concept) {
      const set = conceptTypeSeen.get(normalizeExamText(h.concept)) ?? new Set<string>();
      set.add(h.type ?? "");
      conceptTypeSeen.set(normalizeExamText(h.concept), set);
    }
  }
  const historyConceptSet = new Set(history.priorConcepts.map((c) => normalizeExamText(c)));
  for (const q of candidates) {
    const fp = examQuestionFingerprint(q);
    if (fpSeen.has(fp)) { duplicates.push(q); continue; }           // exact（含历史 + 已保留）
    const conceptN = normalizeExamText(q.concept ?? "");
    // near dup（对已保留 + 历史题干；balanced：换题型则不视为近重复，§19/69/78）
    if (policy !== "allow") {
      const nearWith = (otherQ: string, otherC?: string, otherType?: string): boolean => {
        if (policy === "balanced" && q.type && otherType && q.type !== otherType) return false;
        return isNearDuplicate(otherQ, q.question, otherC, q.concept);
      };
      let near = false;
      for (const k of kept) if (nearWith(k.question, k.concept, k.type)) { near = true; break; }
      if (!near) for (const h of history.priorQuestions) if (nearWith(h.question, h.concept, h.type)) { near = true; break; }
      if (near) { duplicates.push(q); continue; }
    }
    // concept 去重
    if (q.concept) {
      const types = conceptTypeSeen.get(conceptN);
      const qtype = q.type ?? "";
      const conflict = policy === "strict"
        ? historyConceptSet.has(conceptN) || !!types
        : policy === "balanced"
          ? !!types && types.has(qtype)   // 同 concept 且同题型 → 冲突；换题型可保留（§19/78）
          : false;
      if (policy !== "allow" && conflict) { duplicates.push(q); continue; }
      const set = conceptTypeSeen.get(conceptN) ?? new Set<string>();
      set.add(qtype);
      conceptTypeSeen.set(conceptN, set);
    }
    kept.push(q);
    fpSeen.add(fp);
  }
  return { questions: kept, removedCount: duplicates.length, duplicates };
}

/* ---------- Coverage（§21~24/73~75） ---------- */

export function extractHeadings(md: string, limit = 50): string[] {
  const out: string[] = [];
  for (const line of (md ?? "").split("\n")) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (m) {
      const h = m[1].trim().replace(/[#*_`]/g, "").trim();
      if (h && !out.includes(h)) out.push(h);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** §21/22：未覆盖主题候选 = headings 中未出现在历史 concept/coverageTopics 的（用归一化/token 相交判断） */
export function uncoveredTopics(headings: string[], history: ExamHistoryContext): string[] {
  const covered = new Set<string>();
  for (const c of history.priorConcepts) covered.add(normalizeExamText(c));
  for (const t of history.priorCoverageTopics) covered.add(normalizeExamText(t));
  return headings.filter((h) => {
    const n = normalizeExamText(h);
    if (!n) return false;
    if (covered.has(n)) return false;
    return ![...covered].some((c) => c.includes(n) || n.includes(c));
  });
}

/** 把候选主题分给各批（§75）：每批一批滑动取（数量相同时循环覆盖） */
export function assignBatchTopics(candidates: string[], batchIndex: number, batchCount: number): string[] {
  if (!candidates.length || batchCount <= 1) return candidates.slice(0, 6);
  const per = Math.max(1, Math.ceil(candidates.length / batchCount));
  const start = Math.min(candidates.length, batchIndex * per);
  const slice = candidates.slice(start, start + per);
  // 数量不足时补头部主题循环
  if (slice.length < 3) {
    for (const c of candidates) { if (slice.length >= 3) break; if (!slice.includes(c)) slice.push(c); }
  }
  return slice.slice(0, 6);
}

/** §13/55/109 常量汇总（report/测试用） */
export const BATCH_UNIT = 10;
