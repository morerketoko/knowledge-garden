/**
 * Phase 20：原文依据摘录（§38~43/八十三）。
 * - 纯函数：输入 Markdown 原文（真实 Vault 笔记正文）→ 短摘录；绝不生成/编造内容（§39/105）。
 * - 0 AI：由 View 用 cachedRead 读当前笔记后调用本模块（只读当前卡，§82/83）。
 * - 长度默认 300~800 字符（§41）；笔记过短时如实返回全文（证据完整优先）。
 * 本文件不依赖 Obsidian API（便于 Node 自动测试）。
 */
export interface DerivedAnswer {
  excerpt: string;
  heading: string | null;   // 命中的标题（若有）
  found: boolean;           // 是否定位到正文（false → UI 显示「原文内容见 [[笔记]]」+ 打开按钮，§40.5）
}

export const ANSWER_MIN_CHARS = 300;
export const ANSWER_MAX_CHARS = 800;

const HEADING_RE = /^#{1,6}\s+(.+)$/;
const SEP_RE = /[，。！？；;：:,.!?()（）《》「」"'“”‘’、\s#/\\|~\-—…]+/;

export function stripFrontmatter(src: string): string {
  const s = src ?? "";
  if (!s.startsWith("---")) return s;
  const end = s.indexOf("\n---", 3);
  if (end < 0) return s;
  return s.slice(end + 4);
}

/** 把正文切成 (标题, 文本) 段；无标题时为 (null, 全文块) */
export function segmentMarkdown(body: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let cur: { heading: string | null; text: string[] } = { heading: null, text: [] };
  const flush = (): void => {
    const text = cur.text.join("\n").trim();
    if (text) out.push({ heading: cur.heading, text });
    cur = { heading: null, text: [] };
  };
  for (const line of (body ?? "").split("\n")) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      cur.heading = m[1].trim();
    } else {
      cur.text.push(line);
    }
  }
  flush();
  return out;
}

/** 问题 → 关键词（中文按分隔符切 token；英文 ≥3 字符） */
export function questionKeywords(question?: string): string[] {
  if (!question) return [];
  const tokens = question.split(SEP_RE).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    if (/^[\u4e00-\u9fff]+$/.test(t)) {
      if (t.length >= 2) out.push(t);           // 中文整词
    } else if (t.length >= 3) {
      out.push(t.toLowerCase());
    }
  }
  return out;
}

function countHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const k of keywords) if (lower.includes(k)) n++;
  return n;
}

/** 在 max 字符内截取窗口（围绕首个关键词尽量居中，避免开头无意义截断） */
export function sliceWindow(text: string, keywords: string[], max: number): string {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= max) return t;
  let start = 0;
  const lower = t.toLowerCase();
  for (const k of keywords) {
    const idx = lower.indexOf(k);
    if (idx >= 0) { start = Math.max(0, idx - Math.floor(max * 0.3)); break; }
  }
  let end = Math.min(t.length, start + max);
  if (end - start < max) start = Math.max(0, end - max);
  return (start > 0 ? "…" : "") + t.slice(start, end).trim() + (end < t.length ? "…" : "");
}

/**
 * §40/41/42：定位与 question 相关的 heading/paragraph → 300~800 字符摘录。
 * 命中策略：按标题与段落命中关键词打分；找不到相关内容时退化为第一段正文。
 * found=false 只发生在无正文时（UI 显示 [[笔记]] 链接，绝不编造）。
 */
export function deriveAnswerFromMarkdown(src: string, question?: string): DerivedAnswer {
  const body = stripFrontmatter(src ?? "").trim();
  if (!body) return { excerpt: "", heading: null, found: false };
  const keywords = questionKeywords(question);
  const segments = segmentMarkdown(body);
  let best = segments[0] ?? { heading: null, text: body };
  let bestScore = -1;
  for (const seg of segments) {
    const text = seg.text;
    if (!text) continue;
    let score = countHits(text, keywords);
    if (seg.heading && keywords.length) score += countHits(seg.heading, keywords) * 1.5;
    if (score > bestScore) { bestScore = score; best = seg; }
  }
  // 短段优先展示全文：段文本在区间内或整篇很短 → 直接返回，保证证据完整
  const text = best.text;
  if (text.length <= ANSWER_MAX_CHARS) {
    return { excerpt: text, heading: best.heading, found: true };
  }
  return {
    excerpt: sliceWindow(text, keywords, ANSWER_MAX_CHARS),
    heading: best.heading,
    found: true,
  };
}
