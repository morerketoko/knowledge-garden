/**
 * Knowledge Processor（§十二）：extractMetadata / summarize / extractConcepts / extractClaims /
 * extractQuestions / suggestLinks / buildKnowledgeCandidate。
 * 纯函数（无 Obsidian 运行时依赖，便于 node 测试）。职责边界：
 *   - §十四：不自动修改原始 Capture（AI 处理后生成 Processing 笔记，不覆盖 Inbox 原件）
 *   - §九十六：JSON parse → Schema 校验 → Path 校验 → 缓存；校验失败不写 success 缓存
 *   - §一百零一/一百零二：AI 结果写入 <!-- KG:AI_START -->...<!-- KG:AI_END --> 独立区域，
 *     重新处理只更新该区域，绝不覆盖用户文字（§一百零二）
 */
import { fingerprintKey, sha256 } from "./ai/cache";
import type { CurationStatus, KnowledgeCandidate, KnowledgeOrigin, SuggestedLink, SuggestedRelationship } from "./types";

/** §一百：Processing 版本 —— Prompt / 输出 Schema 语义变化必须提升版本，旧缓存自动失效 */
export const PROCESSING_VERSION = "v1";

/** §九十八：默认 Processing Type（cache key 部件；未来 capture/url/rss 可扩展独立类型） */
export const PROCESSING_TYPE_CAPTURE = "capture_processing";

/** §二十七：AI 建议价值（「AI 建议价值」，不是「客观知识价值」） */
export type KnowledgeValue = "low" | "medium" | "high";

export function valueLabel(v: KnowledgeValue): string {
  return v === "high" ? "高" : v === "medium" ? "中" : "低";
}

/** 本地日期 YYYY-MM-DD */
export function kgDate(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
}

/** §九十八：Processing Cache Key —— processingType/sourcePath/sourceVersion/promptVersion/configFingerprint
 *  （model 已含于 configFingerprint；「无关笔记修改」不进入 key，Test 10 保证） */
export function buildProcessingCacheKey(opts: {
  processingType: string;
  sourcePath: string;
  sourceVersion: string;
  promptVersion: string;
  configFingerprint: string;
}): string {
  return fingerprintKey([
    "knowledge_processing",
    opts.processingType,
    opts.sourcePath,
    opts.sourceVersion,
    opts.promptVersion,
    opts.configFingerprint,
  ]);
}

/** sourceVersion：仅由 mtime + size 决定（与 path 无关；同内容同版本命中，修改后 miss —— Test 8/9） */
export function sourceVersionFor(mtime: number, size: number): string {
  return String(mtime) + "|" + String(size);
}

/** §三十一：Link Validation —— AI 建议标题 → 本地校验 Vault 真实存在后才生成 WikiLink。
 *  不存在：path 留空（显示「建议建立新概念」），绝不自动创建。 */
export function resolveSuggestedLinks(
  suggestions: { title: string; reason?: string }[],
  vaultPaths: string[]
): SuggestedLink[] {
  const lower = new Set(vaultPaths.map((p) => p.replace(/\.md$/i, "").toLowerCase()));
  const out: SuggestedLink[] = [];
  for (const s of suggestions) {
    const title = (s.title || "").trim();
    const bare = title.replace(/\.md$/i, "").trim();
    if (!bare) continue;
    const hit = vaultPaths.find((p) => {
      const pb = p.replace(/\.md$/i, "").toLowerCase();
      return pb === bare.toLowerCase() || pb.endsWith("/" + bare.toLowerCase()) || lower.has(bare.toLowerCase());
    });
    out.push(hit ? { title, path: hit, reason: s.reason } : { title, reason: s.reason });
  }
  return out;
}

/** Phase 10 §四十三/四十四：AI 建议关系解析 —— from/to 必须解析到真实 Vault 路径（带 .md），
 *  解析失败丢弃该条（§四十四：不自动写 Markdown、不进 cache success；0 AI）。 */
export function resolveSuggestedRelationships(
  raw: unknown[],
  vaultPaths: string[]
): SuggestedRelationship[] {
  const out: SuggestedRelationship[] = [];
  const resolveRef = (ref: unknown): string | null => {
    const rawName = typeof ref === "string" ? ref.trim() : "";
    if (!rawName) return null;
    const bare = rawName.replace(/\.md$/i, "").trim();
    if (!bare) return null;
    const lowerBare = bare.toLowerCase();
    const hit = vaultPaths.find((p) => {
      const pb = p.replace(/\.md$/i, "");
      const base = pb.split("/").pop() ?? "";
      return pb.toLowerCase() === lowerBare || base.toLowerCase() === lowerBare || pb.toLowerCase().endsWith("/" + lowerBare);
    });
    return hit ?? null;
  };
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    const from = resolveRef(r["from"]);
    const to = resolveRef(r["to"]);
    if (!from || !to) continue;
    const relation = typeof r["relation"] === "string" ? r["relation"].trim().slice(0, 120) : "";
    if (!relation) continue;
    const reason = typeof r["reason"] === "string" ? r["reason"].trim().slice(0, 240) : undefined;
    out.push({ from, to, relation, ...(reason ? { reason } : {}) });
  }
  return out;
}

/** §九十六：Processing Result 解析与校验。JSON 非法 / 缺必填字段 → null（AI 只进 error 缓存）。 */
export function parseProcessingResult(raw: string, vaultPaths: string[], sourcePath?: string): KnowledgeCandidate | null {
  const tryParse = (text: string): KnowledgeCandidate | null => {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const arr = (v: unknown, max = 200): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim().slice(0, max)).filter(Boolean).slice(0, 12) : [];
      const title = str(obj["title"], 120);
      const summary = str(obj["summary"], 800);
      if (!title || !summary) return null;
      const kv = obj["knowledgeValue"];
      const knowledgeValue: KnowledgeValue = kv === "low" || kv === "medium" || kv === "high" ? kv : "medium";
      const rawLinks = Array.isArray(obj["suggestedLinks"]) ? obj["suggestedLinks"] : [];
      const rawRelationships = Array.isArray(obj["suggestedRelationships"]) ? obj["suggestedRelationships"] : [];
      const suggestions = rawLinks
        .map((l) => {
          const r = (l ?? {}) as Record<string, unknown>;
          const t = typeof r["title"] === "string" ? r["title"].trim() : typeof r["path"] === "string" ? r["path"].trim() : "";
          return { title: t, reason: typeof r["reason"] === "string" ? r["reason"].trim().slice(0, 160) : undefined };
        })
        .filter((s) => s.title);
      const confidence = obj["confidence"];
      const conf = typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : undefined;
      const suggestedArea = str(obj["suggestedArea"], 60) || undefined;
      const suggestedTags = arr(obj["suggestedTags"], 40);
      return {
        sourcePath: sourcePath ?? str(obj["sourcePath"], 200),
        title,
        summary,
        concepts: arr(obj["concepts"]),
        claims: arr(obj["claims"]),
        questions: arr(obj["questions"]),
        suggestedLinks: resolveSuggestedLinks(suggestions, vaultPaths),
        suggestedRelationships: resolveSuggestedRelationships(rawRelationships, vaultPaths),
        knowledgeValue,
        ...(confidence !== undefined ? { confidence: conf } : {}),
        ...(suggestedArea ? { suggestedArea } : {}),
        ...(suggestedTags.length ? { suggestedTags } : {}),
      };
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  if (i >= 0 && j > i) return tryParse(raw.slice(i, j + 1));
  return null;
}

function bulletLines(title: string, items: string[], empty = "- （无）"): string[] {
  return [title, "", ...(items.length ? items.map((x) => "- " + x) : [empty]), ""];
}

/** §一百零一：AI 结果独立区域（含 ## AI 提炼 标题 + START/END 标记）。用户「我的理解」不在其中。 */
export function processingAiRegion(c: KnowledgeCandidate): string {
  const lines = [
    "## AI 提炼",
    "",
    "<!-- KG:AI_START -->",
    "",
    "### 摘要",
    "",
    c.summary,
    "",
    ...bulletLines("### 核心概念", c.concepts),
    ...bulletLines("### 来源观点", c.claims),
    ...bulletLines("### 值得思考", c.questions),
    "### 建议关联",
    "",
    ...(c.suggestedLinks.length
      ? c.suggestedLinks.map((l) => "- " + (l.path ? "[[" + l.path.replace(/\.md$/i, "") + "]]" : "（建议建立新概念）" + l.title) + (l.reason ? " — " + l.reason : ""))
      : ["- （暂无建议）"]),
    ...(c.suggestedRelationships && c.suggestedRelationships.length
      ? ["### 建议关系", "", ...c.suggestedRelationships.map((rel) => "- 可能与 [[" + rel.from.replace(/\.md$/i, "") + "]] ↔ [[" + rel.to.replace(/\.md$/i, "") + "]] 存在「" + rel.relation + "」关系" + (rel.reason ? " — " + rel.reason : ""))]
      : []),
    "",
    "AI 建议价值：" + valueLabel(c.knowledgeValue) + (c.confidence !== undefined ? "（置信度 " + Math.round(c.confidence * 100) + "%）" : ""),
  ];
  if (c.suggestedArea) lines.push("", "建议知识区域：" + c.suggestedArea);
  if (c.suggestedTags && c.suggestedTags.length) lines.push("", "建议标签：" + c.suggestedTags.map((t) => "#" + t.replace(/^#/, "")).join(" "));
  lines.push("", "<!-- KG:AI_END -->", "");
  return lines.join("\n");
}

/** §一百零一/一百零二：只更新 AI 区域（START~END 之间；无旧区域时整体追加），绝不覆盖用户文字。 */
export function replaceProcessingAiRegion(md: string, newRegion: string): string {
  const startM = md.match(/<!--\s*KG:AI_START\s*-->/);
  if (!startM) {
    return md.replace(/\s*$/, "\n\n") + newRegion.trimEnd() + "\n";
  }
  const endM = md.match(/<!--\s*KG:AI_END\s*-->/);
  let startIdx = startM.index ?? 0;
  const before = md.slice(0, startIdx);
  // START 前若紧邻「## AI 提炼」标题，标题一起替换（标题属于 AI 区）
  const titleM = before.match(/##\s*AI\s*提炼\s*$/m);
  if (titleM) startIdx = titleM.index ?? 0;
  const endIdx = endM ? (endM.index ?? 0) + endM[0].length : md.length;
  const prefix = md.slice(0, startIdx).trimEnd();
  const suffix = md.slice(endIdx).trimStart();
  return prefix + "\n\n" + newRegion.trimEnd() + (suffix ? "\n" + suffix : "") + "\n";
}

/** §二十九 + §一百零一：新 Processing 笔记整篇（frontmatter 只标 status/knowledgeValue，AI 区独立，含「我的理解」占位 §四十） */
export function buildProcessingMarkdown(opts: {
  candidate: KnowledgeCandidate;
  origin: KnowledgeOrigin;
  sourcePath: string;
  sourceTitle?: string;
  processedAt?: string;
}): string {
  const head = [
    "---",
    "type: knowledge-candidate",
    "origin: " + opts.origin,
    "sourceNote: " + opts.sourcePath.replace(/\.md$/i, ""),
    "knowledgeValue: " + opts.candidate.knowledgeValue,
    "processedAt: " + (opts.processedAt ?? kgDate()),
    "status: candidate",
    ...(opts.sourceTitle ? ["sourceTitle: " + opts.sourceTitle.replace(/[\r\n]+/g, " ").trim()] : []),
    "---",
    "",
    "# " + opts.candidate.title,
    "",
  ].join("\n");
  const mine = [
    "## 我的理解",
    "",
    "> 这里留给你：",
    "> 你认为这个资料最值得注意的地方是什么？（AI 不代笔，§四十）",
    "",
    "## 来源",
    "",
    "- [[" + opts.sourcePath.replace(/\.md$/i, "") + "]]",
    "",
  ].join("\n");
  return head + processingAiRegion(opts.candidate).trimEnd() + "\n\n" + mine;
}

/** §一百零三：Accepted Knowledge（Provenance 保留：origin/source 多来源 §四十七；用户「我的理解」不被 AI 覆盖） */
export function buildKnowledgeMarkdown(opts: {
  title: string;
  origin: KnowledgeOrigin;
  sourcePaths: string[];
  area?: string;
  concepts?: string[];
  createdAt?: string;
}): string {
  const sources = opts.sourcePaths.map((p) => p.replace(/\.md$/i, ""));
  const head = [
    "---",
    "type: knowledge",
    "origin: " + opts.origin,
    ...(opts.area ? ["area: " + opts.area] : []),
    "createdAt: " + (opts.createdAt ?? kgDate()),
    "source:",
    ...sources.map((s) => "  - \"[[" + s + "]]\""),
    "---",
    "",
    "# " + opts.title,
    "",
  ].join("\n");
  const body = [
    "## 我的理解",
    "",
    "> 在这里写下你对这条知识的理解（AI 只生成待填写占位，不伪造你的观点，§四十/一百零三）。",
    "",
    ...(opts.concepts && opts.concepts.length ? bulletLines("## 核心概念", opts.concepts) : []),
    "## 来源",
    "",
    ...sources.map((s) => "- [[" + s + "]]"),
    "",
  ].join("\n");
  return head + body;
}

/** Processing 候选 frontmatter（§二十九：type: knowledge-candidate；供「提炼为知识」复用 provenance） */
export interface CandidateFrontmatter {
  origin?: KnowledgeOrigin;
  sourceNote?: string;      // 不带 .md 的 Inbox 路径
  sourceTitle?: string;
  knowledgeValue?: KnowledgeValue;
  processedAt?: string;
  status?: CurationStatus;
  area?: string;
}

export function parseCandidateFrontmatter(md: string): CandidateFrontmatter | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  if (!/^type:\s*knowledge-candidate\s*$/m.test(m[1])) return null;
  const get = (k: string): string | undefined => {
    const line = m[1].split(/\r?\n/).find((l) => l.startsWith(k + ":"));
    return line ? line.slice(k.length + 1).trim() : undefined;
  };
  const o = get("origin");
  const origin: KnowledgeOrigin | undefined =
    o === "source" || o === "derived" || o === "personal" || o === "synthesis" ? o : undefined;
  const kv = get("knowledgeValue");
  const knowledgeValue: KnowledgeValue | undefined = kv === "low" || kv === "medium" || kv === "high" ? kv : undefined;
  const st = get("status");
  const status: CurationStatus | undefined =
    st === "inbox" || st === "processing" || st === "candidate" || st === "accepted" || st === "archived" ? st : undefined;
  return {
    ...(origin ? { origin } : {}),
    ...(get("sourceNote") ? { sourceNote: get("sourceNote") } : {}),
    ...(get("sourceTitle") ? { sourceTitle: get("sourceTitle") } : {}),
    ...(knowledgeValue ? { knowledgeValue } : {}),
    ...(get("processedAt") ? { processedAt: get("processedAt") } : {}),
    ...(status ? { status } : {}),
    ...(get("area") ? { area: get("area") } : {}),
  };
}

/** §一百零七：给 frontmatter 写/替换 status（幂等；无 status 行则在捕获区末尾追加；不碰正文） */
export function setFrontmatterStatus(md: string, status: CurationStatus): string {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return md;
  const fmLines = m[1].split(/\r?\n/);
  const idx = fmLines.findIndex((l) => l.startsWith("status:"));
  const nl = "status: " + status;
  if (idx >= 0) {
    fmLines[idx] = nl;
  } else {
    fmLines.push(nl);
  }
  return "---\n" + fmLines.join("\n") + "\n---\n" + m[2];
}

/** §一百零六：Archive 保留 provenance —— 只改状态/移动，不删除来源信息（纯校验辅助） */
export function isArchivableStatus(status: CurationStatus | undefined): boolean {
  return status === undefined || status === "inbox" || status === "processing" || status === "candidate" || status === "accepted";
}
