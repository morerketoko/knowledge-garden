/** Phase 11：Web Context（文案联网，§一百二十~一百二十三 / §一百五十三~一百五十五）。
 * - 纯函数清洗（stripHtmlTags/cleanWebHtml/truncateText/webContextHash）便于 Node 测试。
 * - 网络层优先使用 Obsidian requestUrl()（§一百二十），不用 fetch；请求失败不抛出到 UI（返回空页）。
 * - 短缓存：内存 Map + 短 TTL（§一百零二），不建大数据库。
 * - 单页 ≤5000 chars、总上下文 ≤16000 chars（§一百二十一）；最多 5 个 URL。
 * - Web 内容是不可信输入：调用方必须把 SECURITY_BLOCK 注入提示词（§一百二十三，见 prompts.ts）。
 */
import { requestUrl } from "obsidian";
import { sha256 } from "./ai/cache";

export const WEB_MAX_URLS = 5;
export const WEB_MAX_CHARS_PER_PAGE = 5000;
export const WEB_MAX_TOTAL_CHARS = 16000;
export const WEB_CACHE_TTL_MS = 15 * 60 * 1000;
const WEB_CACHE_MAX_ENTRIES = 60;

/** 会话内真实网页抓取计数（§一百一十五 Diagnostics：Web Requests；只统计实际发起 HTTP 的请求，缓存命中不计） */
export let webFetchCount = 0;

/** 去 script/style 块（§一百二十二 第一步） */
export function stripUnsafeBlocks(html: string): string {
  return (html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/gi, " ");
}

/** 基础 HTML 实体解码（常见实体；未知实体保留原样） */
export function decodeEntities(text: string): string {
  const map: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'",
    "&nbsp;": " ", "&#x27;": "'", "&#x2F;": "/", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–",
  };
  let out = text;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

/** 网页正文清洗：去 script/style → 保留 title/headings/main text 结构 → 去标签 → 解实体 → 归一化空白（§一百二十二） */
export function cleanWebHtml(html: string): string {
  const without = stripUnsafeBlocks(html);
  const withHeaders = without
    .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, "\n$1\n")
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n$1\n")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 (链接: $1)");
  const noTags = withHeaders.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(noTags);
  return decoded
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** 截断到最大字符数（§一百二十一） */
export function truncateText(text: string, max: number): string {
  const t = text ?? "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** Web 内容指纹（§一百八十五：URL + 实际内容 hash 进缓存键，不只 URL） */
export function webContextHash(text: string): string {
  return sha256(text ?? "");
}

interface WebCacheEntry { url: string; text: string; fetchedAt: number; }
const webCache = new Map<string, WebCacheEntry>();

/** 抓取单页（带短缓存）：失败 → 返回空串（调用方跳过，UI 提示「部分网页获取失败」） */
async function fetchPage(url: string): Promise<string> {
  const cached = webCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < WEB_CACHE_TTL_MS) return cached.text;
  webFetchCount++;
  try {
    const res = await requestUrl({ url, method: "GET", throw: false });
    if (res.status < 200 || res.status >= 400) return "";
    const raw = typeof res.text === "string" ? res.text : "";
    const clean = truncateText(cleanWebHtml(raw), WEB_MAX_CHARS_PER_PAGE);
    if (webCache.size >= WEB_CACHE_MAX_ENTRIES) {
      const first = webCache.keys().next().value;
      if (first) webCache.delete(first);
    }
    webCache.set(url, { url, text: clean, fetchedAt: Date.now() });
    return clean;
  } catch {
    return "";
  }
}

export interface WebContextResult {
  pages: { url: string; text: string }[];
  totalChars: number;
  /** §一百八十五/一百零二：URL + 内容 hash，进 Copywriting 缓存键 */
  contextHash: string;
}

/** 收集网页上下文（§一百二十一：最多 5 URL，单页 ≤5000，总量 ≤16000；失败页跳过） */
export async function collectWebContext(urls: string[]): Promise<WebContextResult> {
  const valid = [...new Set((urls ?? []).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))].slice(0, WEB_MAX_URLS);
  if (valid.length === 0) return { pages: [], totalChars: 0, contextHash: "" };
  const pages: { url: string; text: string }[] = [];
  let total = 0;
  for (const url of valid) {
    const text = await fetchPage(url);
    if (!text) continue;
    const remain = WEB_MAX_TOTAL_CHARS - total;
    const piece = remain >= text.length ? text : text.slice(0, remain);
    pages.push({ url, text: piece });
    total += piece.length;
    if (total >= WEB_MAX_TOTAL_CHARS) break;
  }
  const contextHash = fingerprintWeb(pages);
  return { pages, totalChars: total, contextHash };
}

/** URL + 内容 hash 的稳定指纹（页面顺序敏感；空集合返回空串） */
export function fingerprintWeb(pages: { url: string; text: string }[]): string {
  if (!pages || pages.length === 0) return "";
  return sha256(pages.map((p) => p.url + "\u0000" + webContextHash(p.text)).join("\n"));
}