/** Query Explorer：用户主动提问 → 全库检索 → AI 关联（§九）。
 * - 纯函数引擎（parse/rank/select/validate）无 Obsidian DOM 依赖，便于 Node 测试。
 * - 复用 Discovery Scope（§三）与 AICache（§四十八）；一次性 Query（§一百二十六）。
 * - 搜索决不进入 Activity / Review / Scheduler（§八十七~八十九）。
 */
import type { DiscoveryScope, KnowledgeArea, QueryExplorationEdge, QueryExplorationNode, QueryExplorationResult, QueryScopeMode } from "./types";
import type { NoteMetadata } from "./noteIndex";
import { tokenizeText } from "./searchIndex";
import { areaOfNote, discoveryPool } from "./discovery";
import { fingerprintKey } from "./ai/cache";

/** 候选选择版本（§八十/一百二十）：ranking/tokenization/diversity 变化时 v1 → v2 自动失效旧 Query Cache */
export const QUERY_SELECTION_VERSION = "v1";
/** 输入上限（§八）：500 字符，超出提示并截断，不直接请求 */
export const QUERY_MAX_LENGTH = 500;
/** 本地候选池默认上限（§三十：Top 50） */
export const QUERY_LOCAL_LIMIT_DEFAULT = 50;

/* ---------- 归一化（§五十一）与解析（§七/二十七） ---------- */

const FULLWIDTH: Record<string, string> = {
  "，": ",", "。": ".", "！": "!", "？": "?", "、": ",", "；": ";", "：": ":", "“": "\"", "”": "\"", "‘": "'", "’": "'",
};

/** 归一化：trim / NFKC / lowercase / 折叠空白 / 标点归一（不过度丢失语义） */
export function normalizeQuery(raw: string): string {
  return (raw ?? "")
    .trim()
    .normalize("NFKC")
    .split("")
    .map((ch) => FULLWIDTH[ch] ?? ch)
    .join("")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[？?]+$/, "")
    .trim();
}

/** parseQuery（§七/二十七/二十八）：保留原文 + 归一化 + tokenize */
export function parseQuery(raw: string): { raw: string; normalized: string; tokens: string[] } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { raw: "", normalized: "", tokens: [] };
  if (trimmed.length > QUERY_MAX_LENGTH) {
    const cut = trimmed.slice(0, QUERY_MAX_LENGTH);
    return { raw: cut, normalized: normalizeQuery(cut), tokens: tokenizeText(cut) };
  }
  return { raw: trimmed, normalized: normalizeQuery(trimmed), tokens: tokenizeText(trimmed) };
}

/* ---------- Ranking（§二十五/二十六）：相关性主导 + 图连接 + 跨区域 + 长期 ---------- */

export interface RankedDoc {
  doc: import("./searchIndex").SearchDocument;
  score: number;
  area: string | undefined;
}

function areaOf(pathStr: string, areas: KnowledgeArea[]): string | undefined {
  return areaOfNote(pathStr, areas, (p) => p.split("/")[0] ?? "");
}

/** 评分：ExactTitle > TitleTokens > Tag > Heading > Content > Alias > Folder + wiki 连接 + 跨区域 + 长期（§二十五） */
export function scoreSearchDoc(
  doc: import("./searchIndex").SearchDocument,
  queryTokens: string[],
  areas: KnowledgeArea[],
  allNotes: Map<string, NoteMetadata>
): RankedDoc {
  const q = new Set(queryTokens);
  const titleTokens = doc.titleTokens;
  const titleOverlap = titleTokens.filter((t) => q.has(t)).length;
  const exactTitle = titleTokens.length > 0 && q.size > 0 && titleTokens.every((t) => q.has(t)) ? 30 : 0;
  const titleScore = 50 * (titleOverlap / Math.max(1, q.size)) + exactTitle;

  const tagHits = [...new Set(doc.tags.flatMap((tag) => tokenizeText(tag)))];
  const tagScore = tagHits.filter((t) => q.has(t)).length * 15;

  let headingHits = 0;
  for (const h of doc.headings) for (const t of new Set(tokenizeText(h))) if (q.has(t)) headingHits++;
  const headingScore = Math.min(10, headingHits * 5);

  const aliasTokens = new Set(doc.aliases.flatMap((a) => tokenizeText(a)));
  const aliasScore = [...aliasTokens].filter((t) => q.has(t)).length * 8;

  const folderScore = tokenizeText(doc.folder).some((t) => q.has(t)) ? 6 : 0;

  let contentHits = 0;
  for (const t of q) if (doc.tokenMap.has(t)) contentHits++;
  const coverage = contentHits / Math.max(1, q.size);
  const contentScore = doc.bodyLength > 0 ? 4 * coverage * Math.min(1.6, 1 + Math.log(1 + contentHits)) : 0;

  let conn = 0;
  let cross = 0;
  let longTerm = 0;
  const meta = allNotes.get(doc.path);
  if (meta) {
    conn = Math.min(3, (meta.links.length + meta.backlinks.length) * 0.3);
    const a = areaOf(doc.path, areas);
    let crossCount = 0;
    for (const b of meta.backlinks) {
      const ba = areaOf(b, areas);
      if (ba && ba !== a && crossCount < 5) crossCount++;
    }
    cross = Math.min(2, crossCount * 0.4);
    const age = Math.max(0, (Date.now() - meta.modified) / 86400000);
    longTerm = Math.min(1, age / 365) * 0.15;
  }

  const score =
    titleScore + tagScore + headingScore + aliasScore + folderScore + contentScore + conn + cross + longTerm;

  return { doc, score, area: areaOf(doc.path, areas) };
}

/** 排序：相关性主导（§三十四） */
export function rankSearchResults(
  docs: import("./searchIndex").SearchDocument[],
  queryTokens: string[],
  areas: KnowledgeArea[],
  allNotes: Map<string, NoteMetadata>
): RankedDoc[] {
  return docs
    .map((d) => scoreSearchDoc(d, queryTokens, areas, allNotes))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/* ---------- 候选选择（§三十/三十三/三十四）：相关性优先 + 软多样性（区域 round-robin，不平均分配） ---------- */

export function selectQueryCandidates(
  ranked: RankedDoc[],
  count: number,
  areas: KnowledgeArea[]
): RankedDoc[] {
  const n = Math.max(1, Math.min(32, Math.floor(count) || 16));
  if (ranked.length === 0) return [];
  if (ranked.length === 1) return ranked.slice(0, n);

  const buckets = new Map<string | undefined, RankedDoc[]>();
  for (const r of ranked) {
    const list = buckets.get(r.area) ?? [];
    list.push(r);
    buckets.set(r.area, list);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.score - a.score);

  const picked: RankedDoc[] = [];
  const used = new Set<string>();
  const keys = Array.from(buckets.keys());
  while (picked.length < n) {
    let added = false;
    for (const k of keys) {
      if (picked.length >= n) break;
      const list = buckets.get(k) ?? [];
      const next = list.find((r) => !used.has(r.doc.path));
      if (next) {
        picked.push(next);
        used.add(next.doc.path);
        added = true;
      }
    }
    if (!added) break;
  }
  // 补足槽位：相关性主导，绝不硬编码平均分配（§三十四）
  while (picked.length < n) {
    const rest = ranked.find((r) => !used.has(r.doc.path));
    if (!rest) break;
    picked.push(rest);
    used.add(rest.doc.path);
  }
  return picked;
}

/* ---------- Scope（§四/六十七）：vault 或 current-discovery-scope（复用 DiscoveryScope） ---------- */

export function queryScopePaths(
  scopeMode: QueryScopeMode,
  notes: NoteMetadata[],
  discoveryScope: DiscoveryScope | undefined,
  areas: KnowledgeArea[]
): Set<string> {
  if (scopeMode === "vault" || !discoveryScope) return new Set(notes.map((n) => n.path));
  return new Set(discoveryPool(notes, discoveryScope, areas).map((n) => n.path));
}

/* ---------- AI 输出校验（§八十四/八十五/八十六 + Test 16/17/18） ---------- */

const QUERY_ROLES = new Set(["origin", "concept", "bridge", "destination"]);

function cap(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** nodes 校验：path ∈ final candidate set（§八十四）、role 白名单、去重、防御上限 30 */
export function filterQueryNodes(raw: unknown, allowed: string[]): QueryExplorationNode[] {
  if (!Array.isArray(raw)) return [];
  const allowedSet = new Set(allowed.map((p) => p.replace(/\.md$/i, "")));
  const out: QueryExplorationNode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["path"] !== "string") continue;
    const bare = rec["path"].replace(/\.md$/i, "");
    if (!allowedSet.has(bare) && !allowed.includes(rec["path"] as string)) continue;
    if (seen.has(bare)) continue;
    seen.add(bare);
    out.push({
      path: bare + ".md",
      role: QUERY_ROLES.has(rec["role"] as string) ? (rec["role"] as QueryExplorationNode["role"]) : "concept",
      label: cap(rec["label"], 40),
      reason: cap(rec["reason"], 160),
    });
    if (out.length >= 30) break;
  }
  return out;
}

function resolveNodePath(v: string, nodes: QueryExplorationNode[]): string | null {
  const bare = v.endsWith(".md") ? v.slice(0, -3) : v;
  for (const n of nodes) {
    if (n.path === v || n.path.replace(/\.md$/, "") === bare) return n.path;
  }
  return null;
}

/** edges 校验：from/to ∈ nodes、relation 非空、direction 白名单、去重、防御上限 40（§八十五） */
export function filterQueryEdges(raw: unknown, nodes: QueryExplorationNode[]): QueryExplorationEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: QueryExplorationEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["from"] !== "string" || typeof rec["to"] !== "string") continue;
    if (typeof rec["relation"] !== "string" || rec["relation"].trim().length === 0) continue;
    const from = resolveNodePath(rec["from"], nodes);
    const to = resolveNodePath(rec["to"], nodes);
    if (!from || !to || from === to) continue;
    const key = from + "|" + to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from,
      to,
      relation: cap(rec["relation"], 30),
      direction: rec["direction"] === "bidirectional" ? "bidirectional" : "forward",
      reason: cap(rec["reason"], 160),
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** 提取文本中从第一个 { 到第一个闭合 } 之间的 JSON 块（兼容 code fence，§五十三同款） */
export function extractQueryJsonBlock(text: string): string | null {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = i; k <= j; k++) {
    const ch = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(i, k + 1); }
  }
  return null;
}

function asStringArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** 解析并校验 AI 输出（Test 18：非法 JSON / 无有效节点 → null，不写 success 缓存） */
export function parseQueryExplorationText(rawText: string, allowed: string[]): QueryExplorationResult | null {
  const tryParse = (text: string): QueryExplorationResult | null => {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const nodes = filterQueryNodes(obj["nodes"], allowed);
      if (nodes.length === 0) return null;
      const edges = filterQueryEdges(obj["edges"], nodes);
      return {
        query: cap(obj["query"], 500),
        headline: cap(obj["headline"], 120) || "知识关联探索",
        summary: cap(obj["summary"], 500),
        nodes,
        edges,
        insights: asStringArr(obj["insights"], 20),
        suggestedQuestions: asStringArr(obj["suggestedQuestions"], 10),
      };
    } catch {
      return null;
    }
  };
  const direct = tryParse(rawText);
  if (direct) return direct;
  const block = extractQueryJsonBlock(rawText);
  if (block) {
    const repaired = tryParse(block);
    if (repaired) return repaired;
  }
  return null;
}

/** Query 缓存键（§四十九/五十/七十八~八十）：类型 + 归一化 query + 候选指纹 + 区域 + prompt 版本 + 配置 + scope + 选择版本 */
export function buildQueryCacheKey(
  cacheType: string,
  normalizedQuery: string,
  candidateSig: string,
  areaSig: string,
  promptVersion: string,
  configFingerprint: string,
  scopeFingerprint: string
): string {
  const parts = [
    cacheType,
    "q:" + normalizedQuery,
    candidateSig,
    areaSig,
    promptVersion,
    configFingerprint,
    "scope:" + scopeFingerprint,
    "sel:" + QUERY_SELECTION_VERSION,
  ];
  return fingerprintKey(parts);
}