/**
 * Workbench Source Link：两层可点击链接（§Source Link Hotfix）。
 * - 第一层：AI 正文中出现的笔记名 → 用结构化 sources 的真实 path 替换为 [[wikilink]]，
 *   绝不从 AI 文本猜测路径、绝不反向让 AI 生成链接。
 * - 第二层：来源卡 [打开笔记] / [查看证据]；证据为本地真实原文片段（0 AI 请求）。
 * - 纯函数（无 Obsidian DOM / 无 AI 依赖），便于 Node 自动测试。
 */
import type { AIAnswerSource } from "./types";

/** 中文/字母/数字/连字符：用于边界判断（避免「游戏」被替换进「游戏设计」） */
/** 左边界阻挡：仅英文/数字/连字符（中文动词「提到/关于/是」前可正常链接，避免漏链） */
const BEFORE_BLOCK = /[A-Za-z0-9_-]/;
/** 右边界阻挡：中文/英文/数字/连字符（防「游戏」误链进「游戏设计」） */
const AFTER_BLOCK = /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9_-]/;
/** 连续中文片段（证据摘要关键词定位） */
const CJKRUN = /[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g;

/**
 * 第一层：把正文中的笔记名（来自 sources 的真实 path / basename）替换为 [[真实路径]]。
 * - 只处理 type==="vault" 且有 path 的来源；web / inference 不参与正文链接化。
 * - 替换顺序按候选长度降序（先完整路径 → 去 .md 路径 → basename），避免短名抢先。
 * - 前后边界为中文/字母/数字/连字符时不替换（防部分匹配）。
 * - 全程占位符替换，防止 [[...]] 嵌套。
 */
export function linkifyAnswerText(text: string, sources: AIAnswerSource[]): string {
  const vault = (sources ?? []).filter((s) => s.type === "vault" && s.path);
  if (vault.length === 0) return text || "";
  const cands: { pattern: string; link: string }[] = [];
  const seenBases = new Set<string>();
  for (const s of vault) {
    const p = s.path!;
    const stem = p.replace(/\.md$/i, "");
    const base = stem.split("/").pop() || stem;
    cands.push({ pattern: p, link: stem });
    cands.push({ pattern: stem, link: stem });
    if (!seenBases.has(base)) {
      seenBases.add(base);
      cands.push({ pattern: base, link: stem });
    }
  }
  cands.sort((a, b) => b.pattern.length - a.pattern.length);

  const P0 = "\uE000";
  const P1 = "\uE001";
  const slots: string[] = [];
  let out = text || "";
  let n = 0;
  for (const c of cands) {
    if (c.pattern.length < 1) continue;
    const token = P0 + n + P1;
    slots.push("[[" + c.link + "]]");
    out = replaceBoundary(out, c.pattern, token);
    n++;
  }
  return out.replace(new RegExp(P0 + "(\\d+)" + P1, "g"), (_m, d) => slots[Number(d)] ?? "");
}

/** 边界感知替换：前后是中文/字母/数字/连字符时不替换；一次只处理一处 */
function replaceBoundary(text: string, pattern: string, replacement: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(pattern, i);
    if (idx < 0) {
      out += text.slice(i);
      break;
    }
    const before = idx > 0 ? text[idx - 1] : "";
    const after = text[idx + pattern.length] ?? "";
    if (!BEFORE_BLOCK.test(before) && !AFTER_BLOCK.test(after)) {
      out += text.slice(i, idx) + replacement;
      i = idx + pattern.length;
    } else {
      out += text.slice(i, idx + 1);
      i = idx + 1;
    }
  }
  return out;
}

/**
 * 证据片段：真实原文（不是 AI 重新生成）。
 * 优先 reason 中最长连续中文关键词所在位置 ± 窗口；否则取正文开头。
 */
export function extractEvidenceSnippet(content: string, reason?: string, limit = 500): string {
  const body = (content || "").trim();
  if (!body) return "";
  const keywords = (reason || "").match(CJKRUN) ?? [];
  if (keywords.length) {
    const ordered = [...new Set(keywords)].sort((a, b) => b.length - a.length);
    for (const k of ordered) {
      const at = body.indexOf(k);
      if (at >= 0) {
        const half = Math.floor(limit / 2);
        const start = Math.max(0, at - half);
        const slice = body.slice(start, start + limit);
        return (start > 0 ? "…" : "") + slice + (start + limit < body.length ? "…" : "");
      }
    }
  }
  return body.slice(0, limit) + (body.length > limit ? "…" : "");
}

/**
 * 过滤已不存在的 vault source（防假 wikilink §51）：
 * - vault 且路径经 exists() 校验为真 → 保留；
 * - web / inference → 保留（不涉及 wikilink）。
 * exists 由调用方注入（Obsidian: app.vault.getAbstractFileByPath）。
 */
export function existingVaultSources(
  sources: AIAnswerSource[],
  exists: (path: string) => boolean
): AIAnswerSource[] {
  return (sources ?? []).filter(
    (s) => s.type !== "vault" || (!!s.path && exists(s.path))
  );
}