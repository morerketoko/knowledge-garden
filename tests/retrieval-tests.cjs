"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/obsidian-stub.ts
var init_obsidian_stub = __esm({
  "tests/obsidian-stub.ts"() {
    "use strict";
  }
});

// src/migrations.ts
var init_migrations = __esm({
  "src/migrations.ts"() {
    "use strict";
  }
});

// src/ai/cache.ts
var init_cache = __esm({
  "src/ai/cache.ts"() {
    "use strict";
    init_migrations();
  }
});

// src/searchIndex.ts
init_obsidian_stub();
init_obsidian_stub();
var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
var LATIN_RE = /[a-z0-9]+/g;
var STOP_CHARS = /* @__PURE__ */ new Set([
  "\u7684",
  "\u4E86",
  "\u662F",
  "\u5728",
  "\u6709",
  "\u548C",
  "\u4E0E",
  "\u53CA",
  "\u6216",
  "\u4E4B",
  "\u5417",
  "\u5462",
  "\u554A",
  "\u5427",
  "\u4E2A",
  "\u79CD",
  "\u4E9B",
  "\u4E5F",
  "\u90FD",
  "\u5F88",
  "\u66F4",
  "\u6700",
  "\u5C31",
  "\u800C",
  "\u5E76",
  "\u4E14",
  "\u8FD8",
  "\u53C8",
  "\u88AB",
  "\u628A",
  "\u8BA9",
  "\u7ED9",
  "\u6211",
  "\u4F60",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4EEC",
  "\u8C01",
  "\u54EA",
  "\u600E",
  "\u4E3A",
  "\u56E0",
  "\u679C",
  "\u5982",
  "\u82E5",
  "\u867D",
  "\u7136",
  "\u4F46",
  "\u4E8E",
  "\u4EE5",
  "\u4E2D",
  "\u4E0A",
  "\u4E0B",
  "\u8FD9",
  "\u90A3",
  "\u95EE",
  "\u4EC0",
  "\u4E48",
  "\u597D",
  "\u9700",
  "\u8981",
  "\u80FD",
  "\u4F1A",
  "\u60F3",
  "\u53EF",
  "\u4EE5",
  "\u4ECE",
  "\u5230",
  "\u5BF9",
  "\u505A",
  "\u7528",
  "\u770B",
  "\u8BF4",
  "\u6765",
  "\u53BB",
  "\u65F6",
  "\u540E",
  "\u524D",
  "\u95F4",
  "\u5185",
  "\u5916"
]);
var STOP_WORDS = /* @__PURE__ */ new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "it", "this", "that"]);
function tokenizeText(text) {
  const t = (text || "").toLowerCase();
  const out = [];
  for (const m of t.matchAll(LATIN_RE)) {
    const w = m[0];
    if (w.length >= 2 || /^[0-9]{1,3}$/.test(w) || w.length > 3) {
      if (!STOP_WORDS.has(w)) out.push(w);
    }
  }
  for (const ch of t) {
    if (CJK_RE.test(ch) && !STOP_CHARS.has(ch)) out.push(ch);
  }
  return out;
}
function matchesDoc(doc2, tokens) {
  for (const t of tokens) {
    if (doc2.titleTokens.includes(t)) return true;
    if (doc2.headings.some((h) => h.includes(t))) return true;
    if (doc2.tags.some((tag) => tag.includes(t) || tokenizeText(tag).includes(t))) return true;
    if (doc2.aliases.some((a) => a.includes(t) || tokenizeText(a).includes(t))) return true;
    if (doc2.folder.includes(t) || tokenizeText(doc2.folder).includes(t)) return true;
    if (doc2.tokenMap.has(t)) return true;
  }
  return false;
}

// src/discovery.ts
init_cache();
init_migrations();
function areaOfNote(notePath, areas, folderOf) {
  for (const a of areas) {
    if (!a.folder) continue;
    if (notePath === a.folder + ".md" || notePath.startsWith(a.folder + "/")) return a.name;
  }
  const folder = folderOf ? folderOf(notePath) : notePath.split("/")[0] ?? "";
  for (const a of areas) if (a.folder === folder) return a.name;
  return void 0;
}

// src/queryExplorer.ts
init_cache();
function areaOf(pathStr, areas) {
  return areaOfNote(pathStr, areas, (p) => p.split("/")[0] ?? "");
}
function scoreSearchDoc(doc2, queryTokens, areas, allNotes) {
  const q = new Set(queryTokens);
  const titleTokens = doc2.titleTokens;
  const titleOverlap = titleTokens.filter((t) => q.has(t)).length;
  const exactTitle = titleTokens.length > 0 && q.size > 0 && titleTokens.every((t) => q.has(t)) ? 30 : 0;
  const titleScore = 50 * (titleOverlap / Math.max(1, q.size)) + exactTitle;
  const tagHits = [...new Set(doc2.tags.flatMap((tag) => tokenizeText(tag)))];
  const tagScore = tagHits.filter((t) => q.has(t)).length * 15;
  let headingHits = 0;
  for (const h of doc2.headings) for (const t of new Set(tokenizeText(h))) if (q.has(t)) headingHits++;
  const headingScore = Math.min(10, headingHits * 5);
  const aliasTokens = new Set(doc2.aliases.flatMap((a) => tokenizeText(a)));
  const aliasScore = [...aliasTokens].filter((t) => q.has(t)).length * 8;
  const folderScore = tokenizeText(doc2.folder).some((t) => q.has(t)) ? 6 : 0;
  let contentHits = 0;
  for (const t of q) if (doc2.tokenMap.has(t)) contentHits++;
  const coverage = contentHits / Math.max(1, q.size);
  const contentScore = doc2.bodyLength > 0 ? 4 * coverage * Math.min(1.6, 1 + Math.log(1 + contentHits)) : 0;
  let conn = 0;
  let cross = 0;
  let longTerm = 0;
  const meta2 = allNotes.get(doc2.path);
  if (meta2) {
    conn = Math.min(3, (meta2.links.length + meta2.backlinks.length) * 0.3);
    const a = areaOf(doc2.path, areas);
    let crossCount = 0;
    for (const b of meta2.backlinks) {
      const ba = areaOf(b, areas);
      if (ba && ba !== a && crossCount < 5) crossCount++;
    }
    cross = Math.min(2, crossCount * 0.4);
    const age = Math.max(0, (Date.now() - meta2.modified) / 864e5);
    longTerm = Math.min(1, age / 365) * 0.15;
  }
  const score = titleScore + tagScore + headingScore + aliasScore + folderScore + contentScore + conn + cross + longTerm;
  return { doc: doc2, score, area: areaOf(doc2.path, areas) };
}
function rankSearchResults(docs, queryTokens, areas, allNotes) {
  return docs.map((d) => scoreSearchDoc(d, queryTokens, areas, allNotes)).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

// src/workbenchService.ts
init_obsidian_stub();

// src/workbenchTools.ts
var WORKBENCH_TOOL_IDS = [
  "vault.search",
  "vault.read",
  "vault.create",
  "vault.modify",
  "vault.rename",
  "vault.move",
  "vault.delete",
  "vault.open",
  "web.search",
  "web.fetch"
];
function toolCategory(toolId) {
  const map = {
    "vault.search": "LOCAL_READ",
    "vault.read": "LOCAL_READ",
    "vault.open": "LOCAL_READ",
    "vault.create": "LOCAL_WRITE",
    "vault.modify": "LOCAL_WRITE",
    "vault.rename": "LOCAL_WRITE",
    "vault.move": "LOCAL_WRITE",
    "vault.delete": "DESTRUCTIVE",
    "web.search": "EXTERNAL_WEB",
    "web.fetch": "EXTERNAL_WEB"
  };
  return map[toolId] ?? "LOCAL_READ";
}
var WORKBENCH_TOOLS = WORKBENCH_TOOL_IDS.map((id) => {
  const desc = {
    "vault.search": "\u68C0\u7D22 Vault\uFF1A\u6309\u5173\u952E\u8BCD\u8FD4\u56DE\u771F\u5B9E\u547D\u4E2D\u7B14\u8BB0\u8DEF\u5F84\u4E0E\u7247\u6BB5\uFF08\u2264500 \u5B57\u7B26/\u6761\uFF09",
    "vault.read": "\u8BFB\u53D6\u4E00\u7BC7\u7B14\u8BB0\u5168\u6587\uFF08\u226412000 \u5B57\u7B26\uFF1B\u53EA\u8BFB .md\uFF09",
    "vault.create": "\u521B\u5EFA\u65B0\u7B14\u8BB0\uFF08\u5B89\u5168\u8DEF\u5F84\u6821\u9A8C\uFF1B\u9700\u7528\u6237\u786E\u8BA4\uFF09",
    "vault.modify": "\u4FEE\u6539\u5DF2\u6709\u7B14\u8BB0\uFF08Proposal\u2192Diff\u2192\u7528\u6237\u786E\u8BA4\u540E\u5E94\u7528\uFF1B\xA7\u516D\u5341\u4E5D\uFF09",
    "vault.rename": "\u91CD\u547D\u540D\u7B14\u8BB0\uFF08\u9700\u786E\u8BA4\uFF09",
    "vault.move": "\u79FB\u52A8\u7B14\u8BB0\uFF08\u9700\u786E\u8BA4\uFF09",
    "vault.delete": "\u5220\u9664\u7B14\u8BB0\uFF08\u9ED8\u8BA4 DENY\uFF1B\u4EC5\u7528\u6237\u624B\u52A8\u5141\u8BB8\u672C\u6B21\uFF09",
    "vault.open": "\u6253\u5F00\u7B14\u8BB0\uFF08\u76F4\u63A5\u5728 Obsidian \u4E2D\u6253\u5F00\uFF09",
    "web.search": "Web \u641C\u7D22\uFF08\u9700\u663E\u5F0F\u542F\u7528\uFF1B\u5355\u6761 snippet \u2264500 \u5B57\u7B26\uFF09",
    "web.fetch": "\u6293\u53D6\u7F51\u9875\u6B63\u6587\uFF08\u22648000 \u5B57\u7B26\uFF1B\u5185\u5BB9\u662F\u4E0D\u53EF\u4FE1\u8F93\u5165\uFF09"
  };
  return { id, name: id, description: desc[id] ?? id, actionCategory: toolCategory(id) };
});

// src/workbenchService.ts
init_cache();

// src/latency.ts
init_migrations();

// src/workspace.ts
init_cache();

// src/skills.ts
init_cache();
var BUILTIN_SKILL_IDS = [
  "academic-writing",
  "critical-analysis",
  "research-question",
  "knowledge-application",
  "knowledge-refinement"
];
var md = (lines) => lines.join("\n");
var ACADEMIC = md([
  "# Academic Writing",
  "",
  "## Process",
  "1. Identify the thesis / core claim of the material.",
  "2. Separate claims from evidence; mark which claims are the author's inference.",
  "3. Identify assumptions and unstated premises.",
  "4. Improve structure (claim -> evidence -> reasoning -> limitation).",
  "5. Mark uncertain statements; never fabricate citations (\xA7\u4E09\u5341\u4E09/\xA7\u4E5D\u5341\u4E09).",
  "6. Output in the requested format; do not claim it is academically correct (\xA7\u4E5D\u5341\u56DB)."
]);
var CRITICAL = md([
  "# Critical Analysis",
  "",
  "## Process",
  "1. Restate the position in one sentence (charitable reading).",
  "2. List supporting evidence vs unsupported assertion.",
  "3. Find counterexamples and counter-arguments.",
  "4. Assess the strength of the link between evidence and conclusion.",
  "5. Distinguish fact, inference, and value judgment.",
  "6. End with the strongest open question."
]);
var RESQ = md([
  "# Research Question",
  "",
  "## Process",
  "1. Summarize the current material into 1-3 core topics.",
  "2. Generate hierarchically structured questions (general -> specific; descriptive -> explanatory -> evaluative) (\xA7\u4E09\u5341\u4E03/\xA7\u4E09\u5341\u516B).",
  "3. For each question, list what evidence would be needed.",
  "4. Identify which questions connect to existing knowledge / known gaps.",
  "5. Output questions with a short why-it-matters line."
]);
var APPLY = md([
  "# Knowledge Application",
  "",
  "## Process",
  "1. Extract the transferable principle(s) from the source material.",
  "2. Identify target domains where the principle could apply (cross-domain transfer, \xA7\u56DB\u5341/\xA7\u56DB\u5341\u4E00).",
  "3. For each application: expected effect, precondition, limitation.",
  "4. Provide a concrete example scenario.",
  "5. Flag speculative applications explicitly as hypotheses, not facts (\xA7\u4E00\u767E\u4E94\u5341\u56DB)."
]);
var REFINE = md([
  "# Knowledge Refinement",
  "",
  "## Process",
  "1. Parse the source note into atomic claims (each claim = one sentence, traceable to the source).",
  "2. Keep the original wording where possible; only rephrase for clarity.",
  "3. Separate source-derived from your own synthesis (origin preservation, Phase 10 Provenance).",
  "4. Attach suggested wikilinks only to concepts already present in the vault.",
  "5. Output refined content as a proposal; do not overwrite the original without preview (\xA7\u516D\u5341\u4E00)."
]);
var BUILTIN_SKILL_SUMMARIES = BUILTIN_SKILL_IDS.map((id) => ({
  id,
  name: skillName(id),
  description: skillDescription(id),
  path: "builtin://" + id,
  enabled: true
}));
function skillName(id) {
  const map = {
    "academic-writing": "\u5B66\u672F\u5199\u4F5C",
    "critical-analysis": "\u6279\u5224\u6027\u5206\u6790",
    "research-question": "\u7814\u7A76\u95EE\u9898\u751F\u6210",
    "knowledge-application": "\u77E5\u8BC6\u8FC1\u79FB\u4E0E\u5E94\u7528",
    "knowledge-refinement": "\u77E5\u8BC6\u63D0\u70BC"
  };
  return map[id] ?? id;
}
function skillDescription(id) {
  const map = {
    "academic-writing": "\u628A\u7B14\u8BB0\u6539\u5199\u6210\u6709\u5B66\u672F\u7ED3\u6784\u3001\u533A\u5206\u8BBA\u636E\u4E0E\u63A8\u8BBA\u7684\u8F93\u51FA\uFF0C\u4E0D\u4F2A\u9020\u5F15\u7528\u3002",
    "critical-analysis": "\u8BC6\u522B\u8BBA\u70B9\u3001\u8BBA\u636E\u3001\u5047\u8BBE\u4E0E\u53CD\u4F8B\uFF0C\u8F93\u51FA\u6279\u5224\u6027\u5206\u6790\u3002",
    "research-question": "\u4ECE\u6750\u6599\u751F\u6210\u6709\u5C42\u6B21\u7684\u7814\u7A76\u95EE\u9898\uFF08\u63CF\u8FF0\u2192\u89E3\u91CA\u2192\u8BC4\u4EF7\uFF09\u3002",
    "knowledge-application": "\u63D0\u53D6\u53EF\u8FC1\u79FB\u539F\u5219\uFF0C\u505A\u8DE8\u9886\u57DF\u5E94\u7528\u4E0E\u53CD\u4F8B\u5206\u6790\u3002",
    "knowledge-refinement": "\u628A\u7B14\u8BB0\u63D0\u70BC\u4E3A\u53EF\u8FFD\u6EAF\u7684\u539F\u5B50\u5316\u77E5\u8BC6\uFF0C\u540C\u65F6\u4FDD\u7559\u6765\u6E90\u8FB9\u754C\u3002"
  };
  return map[id] ?? "";
}

// src/sourceLedger.ts
init_migrations();
init_cache();

// src/workbenchSession.ts
init_migrations();
init_cache();

// src/workbenchService.ts
var RETRIEVAL_VERSION = "v2";
function fallbackSearch(query, paths, limit) {
  const tokens = tokenizeText(query || "");
  if (tokens.length === 0) return [];
  const out = [];
  for (const pth of paths) {
    const lower = pth.toLowerCase();
    if (tokens.some((t) => lower.includes(t))) {
      out.push({ path: pth, snippet: pth });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// tests/retrieval-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function doc(p, title, body, extra) {
  const tokenMap = /* @__PURE__ */ new Map();
  for (const t of tokenizeText(body)) tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
  return {
    path: p,
    title,
    folder: p.split("/")[0] ?? "",
    tags: [],
    headings: [],
    aliases: [],
    tokenMap,
    titleTokens: tokenizeText(title),
    bodyLength: body.length,
    ...extra
  };
}
function meta(p, title) {
  return { path: p, title, folder: p.split("/")[0] ?? "", tags: [], links: [], backlinks: [], created: 1, modified: Date.now(), size: 1, wordCount: 1 };
}
function notesMap(items) {
  return new Map(items.map((n) => [n.path, n]));
}
var AREAS = [];
{
  const t = tokenizeText("\u6709\u5173\u6E38\u620F\u7684\u7B14\u8BB0\u6709\u54EA\u4E9B");
  test(
    "R1",
    t.length >= 4 && t.includes("\u6E38") && t.includes("\u620F") && t.includes("\u7B14") && t.includes("\u8BB0"),
    "\u300C\u6709\u5173\u6E38\u620F\u7684\u7B14\u8BB0\u6709\u54EA\u4E9B\u300D\u2192 tokens=[" + t.join(",") + "]\uFF08\u505C\u7528\u5B57 \u6709/\u7684/\u54EA/\u4E9B \u5DF2\u8FC7\u6EE4\uFF09"
  );
  test(
    "R1b",
    !t.includes("\u6709") && !t.includes("\u7684") && !t.includes("\u54EA") && !t.includes("\u4E9B"),
    "\u9AD8\u9891\u865A\u5B57\u4E0D\u8FDB\u5165\u68C0\u7D22 token\uFF08\u9632\u6B62\u300C\u7684/\u6709/\u54EA\u300D\u6C61\u67D3\u5339\u914D\uFF09"
  );
}
{
  const d = doc("AI/\u6E38\u620F\u8BBE\u8BA1.md", "\u6E38\u620F\u8BBE\u8BA1", "\u8FD9\u662F\u4E00\u7BC7\u5173\u4E8E\u6E38\u620F\u8BBE\u8BA1\u7684\u6587\u7AE0\uFF0C\u8BB2\u4E86\u5173\u5361\u4E0E\u673A\u5236\u3002");
  const tokens = tokenizeText("\u6E38\u620F");
  test("R2", matchesDoc(d, tokens), "\u300C\u6E38\u620F\u300Dtoken \u547D\u4E2D\u6B63\u6587\u542B\u300C\u6E38\u620F\u300D\u7684\u6587\u6863\uFF08matchesDoc=true\uFF09");
  const ranked = rankSearchResults([d], tokens, AREAS, notesMap([meta(d.path, d.title)]));
  test("R2b", ranked.length === 1 && ranked[0].score > 0, "rankSearchResults \u8FD4\u56DE\u76F8\u5173\u6587\u6863\u4E14 score>0\uFF08score=" + (ranked[0]?.score ?? 0) + "\uFF09");
}
{
  const t = tokenizeText("\u6211\u4EE5\u524D\u6709\u6CA1\u6709\u5199\u8FC7\u5173\u4E8E\u6E38\u620F\u7684\u4E1C\u897F\uFF1F");
  test("R3", t.includes("\u6E38") && t.includes("\u620F"), "\u81EA\u7136\u53E3\u8BED\u300C\u6211\u4EE5\u524D\u6709\u6CA1\u6709\u5199\u8FC7\u5173\u4E8E\u6E38\u620F\u7684\u4E1C\u897F\uFF1F\u300D\u2192 tokens \u542B \u6E38/\u620F\uFF08" + t.join(",") + "\uFF09");
}
{
  const t = tokenizeText("what notes are about games");
  test("R4", t.includes("games") && t.includes("notes") && t.includes("about"), "\u82F1\u6587\u95EE\u9898\u4ECD\u4FDD\u7559\u5B9E\u8BCD\uFF08" + t.join(",") + "\uFF09");
}
{
  const t = tokenizeText("\u6709\u54EA\u4E9B AI \u76F8\u5173\u6E38\u620F\u7B14\u8BB0");
  test("R5", t.includes("ai") && t.includes("\u6E38") && t.includes("\u620F") && t.includes("\u7B14"), "\u4E2D\u82F1\u6DF7\u5408\u540C\u65F6\u4EA7\u51FA\u4E2D\u6587+\u82F1\u6587 token\uFF08" + t.join(",") + "\uFF09");
}
{
  const titleDoc = doc("AI/\u6E38\u620F\u8BBE\u8BA1.md", "\u6E38\u620F\u8BBE\u8BA1", "\u6B63\u6587\u65E0\u76F8\u5173\u5185\u5BB9\u8BCD\u3002");
  const bodyDoc = doc("\u54F2\u5B66/\u6C89\u601D.md", "\u54F2\u5B66\u6C89\u601D", "\u8FD9\u672C\u7B14\u8BB0\u5728\u6B63\u6587\u91CC\u63D0\u4E86\u4E00\u53E5\u6E38\u620F\u673A\u5236\u3002");
  const q = tokenizeText("\u6E38\u620F\u8BBE\u8BA1");
  const ranked = rankSearchResults(
    [bodyDoc, titleDoc],
    q,
    AREAS,
    notesMap([meta(titleDoc.path, titleDoc.title), meta(bodyDoc.path, bodyDoc.title)])
  );
  test("R6", ranked.length >= 1 && ranked[0].doc?.path === titleDoc.path, "\u6807\u9898\u547D\u4E2D\u6392\u5728\u6B63\u6587\u5F31\u547D\u4E2D\u4E4B\u524D\uFF08top=" + (ranked[0]?.doc?.path ?? "none") + "\uFF09");
}
{
  const tagDoc = doc("\u5B66\u672F/\u8BBA\u6587.md", "\u8BBA\u6587", "\u6B63\u6587\u4E0E\u9898\u65E0\u5173\u3002", { tags: ["\u6E38\u620F"] });
  const aliasDoc = doc("Inbox/\u672A\u547D\u540D.md", "\u672A\u547D\u540D", "\u6B63\u6587\u65E0\u5173\u3002", { aliases: ["\u6E38\u620F\u673A\u5236\u8349\u7A3F"] });
  const headDoc = doc("\u9879\u76EE/\u539F\u578B.md", "\u539F\u578B", "\u6B63\u6587\u65E0\u5173\u3002", { headings: ["\u6E38\u620F\u539F\u578B", "\u6D4B\u8BD5"] });
  const q = tokenizeText("\u6E38\u620F");
  const ranked = rankSearchResults(
    [tagDoc, aliasDoc, headDoc],
    q,
    AREAS,
    notesMap([meta(tagDoc.path, tagDoc.title), meta(aliasDoc.path, aliasDoc.title), meta(headDoc.path, headDoc.title)])
  );
  test("R7", ranked.length === 3, "tag/alias/heading \u547D\u4E2D\u5747\u53EF\u8FDB\u5165\u5019\u9009\uFF08count=" + ranked.length + "\uFF09");
}
{
  const t = tokenizeText("\u7684\u4E86\u662F\u5417\uFF1F");
  test("R8", t.length === 0, "\u300C\u7684\u4E86\u662F\u5417\uFF1F\u300Dtoken \u4E3A\u7A7A \u2192 \u68C0\u7D22\u5C42\u76F4\u63A5\u8FD4\u56DE\u7A7A\uFF08\u4E0D\u89E6\u53D1 AI \u8BF7\u6C42\uFF09");
  test("R8b", fallbackSearch("\u7684\u4E86\u662F\u5417\uFF1F", ["AI/\u6E38\u620F.md"], 5).length === 0, "fallbackSearch \u5BF9\u7EAF\u865A\u8BCD\u540C\u6837\u8FD4\u56DE\u7A7A");
}
{
  const src = fs.readFileSync(path.resolve(__dirname, "../src/workbenchService.ts"), "utf8");
  test("R9", RETRIEVAL_VERSION === "v2", "RETRIEVAL_VERSION \u5E38\u91CF = v2\uFF08\u5F53\u524D\u503C=" + RETRIEVAL_VERSION + "\uFF09");
  test("R9b", src.includes('"rv:" + RETRIEVAL_VERSION'), "Ask cache key \u5DF2\u7EB3\u5165 rv:" + RETRIEVAL_VERSION);
  const oldSplitStillThere = src.includes("u4e00-") && src.includes("split(");
  test("R9c", !oldSplitStillThere, "\u65E7 split(/[\\s\\u4e00-\\u9fff]+/) \u4E2D\u6587\u5206\u9694 bug \u5DF2\u5220\u9664");
  test("R9d", src.includes("tokenizeText(query") && src.includes("rankSearchResults(docs"), "vaultSearch \u4F7F\u7528 tokenizeText + rankSearchResults");
}
{
  const paths = ["AI/\u6E38\u620F\u8BBE\u8BA1.md", "AI/\u97F3\u6548.md", "\u54F2\u5B66/\u6C89\u601D\u5F55.md"];
  const out = fallbackSearch("\u6E38\u620F", paths, 5);
  test(
    "R10",
    out.some((r) => r.path === "AI/\u6E38\u620F\u8BBE\u8BA1.md") && !out.some((r) => r.path === "\u54F2\u5B66/\u6C89\u601D\u5F55.md"),
    "fallbackSearch \u547D\u4E2D\u6587\u4EF6\u540D\u542B\u300C\u6E38\u620F\u300D\u7684\u7B14\u8BB0\uFF08" + out.map((r) => r.path).join(",") + "\uFF09"
  );
}
{
  const docs = [];
  const metas = [];
  for (let i = 0; i < 1e3; i++) {
    const p = "AI/note-" + String(i).padStart(4, "0") + ".md";
    docs.push(doc(p, "\u7B14\u8BB0" + i, "\u4E0E\u68C0\u7D22\u65E0\u5173\u7684\u6B63\u6587\u5185\u5BB9" + i));
    metas.push(meta(p, "\u7B14\u8BB0" + i));
  }
  docs.push(doc("AI/\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0.md", "\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0", "\u8FD9\u91CC\u8BA8\u8BBA\u6E38\u620F\u673A\u5236\u4E0E\u5173\u5361\u7ED3\u6784\u3002"));
  metas.push(meta("AI/\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0.md", "\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0"));
  const q = tokenizeText("\u6E38\u620F\u8BBE\u8BA1");
  const t0 = Date.now();
  const ranked = rankSearchResults(docs, q, AREAS, notesMap(metas));
  const dt = Date.now() - t0;
  test("R11", ranked.length >= 1 && ranked[0].doc?.path === "AI/\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0.md", "1000 \u7B14\u8BB0\u4E0B\u6807\u9898\u547D\u4E2D\u4ECD\u5728\u9996\u4F4D\uFF08top=" + (ranked[0]?.doc?.path ?? "none") + "\uFF09");
  test("R11b", dt < 2e3, "1000 \u7B14\u8BB0\u4EC5\u626B tokenMap \u4E0D\u8BFB\u6B63\u6587\uFF0C\u8017\u65F6 " + dt + "ms");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
