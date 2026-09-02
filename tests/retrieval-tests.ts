/**
 * Workbench Retrieval v2 自动测试（R1~R11）：
 * - 中文自然语言检索：tokenizeText unigram + SearchIndex 命中 + rankSearchResults 排序。
 * - 只测纯函数（tokenize / matchesDoc / rankSearchResults / fallbackSearch），不依赖 Obsidian 运行时。
 * - 禁止向量库 / embedding / 全库读入 AI（指令约束）。
 */
import { tokenizeText, matchesDoc, type SearchDocument } from "../src/searchIndex";
import { rankSearchResults } from "../src/queryExplorer";
import type { NoteMetadata } from "../src/noteIndex";
import type { KnowledgeArea } from "../src/types";
import { RETRIEVAL_VERSION, fallbackSearch } from "../src/workbenchService";
import * as fs from "node:fs";
import * as path from "node:path";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

/** 构造仅含元数据 + tokenMap 的 SearchDocument（不读正文，R11 依赖此约束） */
function doc(p: string, title: string, body: string, extra?: Partial<SearchDocument>): SearchDocument {
  const tokenMap = new Map<string, number>();
  for (const t of tokenizeText(body)) tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
  return {
    path: p, title, folder: p.split("/")[0] ?? "", tags: [], headings: [], aliases: [],
    tokenMap, titleTokens: tokenizeText(title), bodyLength: body.length, ...extra,
  };
}
function meta(p: string, title: string): NoteMetadata {
  return { path: p, title, folder: p.split("/")[0] ?? "", tags: [], links: [], backlinks: [], created: 1, modified: Date.now(), size: 1, wordCount: 1 };
}
function notesMap(items: NoteMetadata[]): Map<string, NoteMetadata> {
  return new Map(items.map((n) => [n.path, n]));
}
const AREAS: KnowledgeArea[] = [];

// ---------- R1：中文问题 token 化 ----------
{
  const t = tokenizeText("有关游戏的笔记有哪些");
  test("R1", t.length >= 4 && t.includes("游") && t.includes("戏") && t.includes("笔") && t.includes("记"),
    "「有关游戏的笔记有哪些」→ tokens=[" + t.join(",") + "]（停用字 有/的/哪/些 已过滤）");
  test("R1b", !t.includes("有") && !t.includes("的") && !t.includes("哪") && !t.includes("些"),
    "高频虚字不进入检索 token（防止「的/有/哪」污染匹配）");
}

// ---------- R2：中文 token 能命中含「游戏」的文档 ----------
{
  const d = doc("AI/游戏设计.md", "游戏设计", "这是一篇关于游戏设计的文章，讲了关卡与机制。");
  const tokens = tokenizeText("游戏");
  test("R2", matchesDoc(d, tokens), "「游戏」token 命中正文含「游戏」的文档（matchesDoc=true）");
  const ranked = rankSearchResults([d], tokens, AREAS, notesMap([meta(d.path, d.title)]));
  test("R2b", ranked.length === 1 && ranked[0].score > 0, "rankSearchResults 返回相关文档且 score>0（score=" + (ranked[0]?.score ?? 0) + "）");
}

// ---------- R3：自然语言提问提取游戏相关 token ----------
{
  const t = tokenizeText("我以前有没有写过关于游戏的东西？");
  test("R3", t.includes("游") && t.includes("戏"), "自然口语「我以前有没有写过关于游戏的东西？」→ tokens 含 游/戏（" + t.join(",") + "）");
}

// ---------- R4：英文检索不退化 ----------
{
  const t = tokenizeText("what notes are about games");
  test("R4", t.includes("games") && t.includes("notes") && t.includes("about"), "英文问题仍保留实词（" + t.join(",") + "）");
}

// ---------- R5：中英混合 ----------
{
  const t = tokenizeText("有哪些 AI 相关游戏笔记");
  test("R5", t.includes("ai") && t.includes("游") && t.includes("戏") && t.includes("笔"), "中英混合同时产出中文+英文 token（" + t.join(",") + "）");
}

// ---------- R6：标题命中优先于正文弱命中 ----------
{
  const titleDoc = doc("AI/游戏设计.md", "游戏设计", "正文无相关内容词。");
  const bodyDoc = doc("哲学/沉思.md", "哲学沉思", "这本笔记在正文里提了一句游戏机制。");
  const q = tokenizeText("游戏设计");
  const ranked = rankSearchResults([bodyDoc, titleDoc], q, AREAS,
    notesMap([meta(titleDoc.path, titleDoc.title), meta(bodyDoc.path, bodyDoc.title)]));
  test("R6", ranked.length >= 1 && ranked[0].doc?.path === titleDoc.path, "标题命中排在正文弱命中之前（top=" + (ranked[0]?.doc?.path ?? "none") + "）");
}

// ---------- R7：tag / alias / heading 命中进入候选 ----------
{
  const tagDoc = doc("学术/论文.md", "论文", "正文与题无关。", { tags: ["游戏"] });
  const aliasDoc = doc("Inbox/未命名.md", "未命名", "正文无关。", { aliases: ["游戏机制草稿"] });
  const headDoc = doc("项目/原型.md", "原型", "正文无关。", { headings: ["游戏原型", "测试"] });
  const q = tokenizeText("游戏");
  const ranked = rankSearchResults([tagDoc, aliasDoc, headDoc], q, AREAS,
    notesMap([meta(tagDoc.path, tagDoc.title), meta(aliasDoc.path, aliasDoc.title), meta(headDoc.path, headDoc.title)]));
  test("R7", ranked.length === 3, "tag/alias/heading 命中均可进入候选（count=" + ranked.length + "）");
}

// ---------- R8：纯虚词问题安全返回空（不触发 AI） ----------
{
  const t = tokenizeText("的了是吗？");
  test("R8", t.length === 0, "「的了是吗？」token 为空 → 检索层直接返回空（不触发 AI 请求）");
  test("R8b", fallbackSearch("的了是吗？", ["AI/游戏.md"], 5).length === 0, "fallbackSearch 对纯虚词同样返回空");
}

// ---------- R9：Retrieval v2 缓存版本生效 ----------
{
  const src = fs.readFileSync(path.resolve(__dirname, "../src/workbenchService.ts"), "utf8");
  test("R9", RETRIEVAL_VERSION === "v2", "RETRIEVAL_VERSION 常量 = v2（当前值=" + RETRIEVAL_VERSION + "）");
  test("R9b", src.includes('"rv:" + RETRIEVAL_VERSION'), "Ask cache key 已纳入 rv:" + RETRIEVAL_VERSION);
  const oldSplitStillThere = src.includes("u4e00-") && src.includes("split(");
  test("R9c", !oldSplitStillThere, "旧 split(/[\\s\\u4e00-\\u9fff]+/) 中文分隔 bug 已删除");
  test("R9d", src.includes("tokenizeText(query") && src.includes("rankSearchResults(docs"), "vaultSearch 使用 tokenizeText + rankSearchResults");
}

// ---------- R10：SearchIndex 不可用时 fallbackSearch 按文件名命中 ----------
{
  const paths = ["AI/游戏设计.md", "AI/音效.md", "哲学/沉思录.md"];
  const out = fallbackSearch("游戏", paths, 5);
  test("R10", out.some((r) => r.path === "AI/游戏设计.md") && !out.some((r) => r.path === "哲学/沉思录.md"),
    "fallbackSearch 命中文件名含「游戏」的笔记（" + out.map((r) => r.path).join(",") + "）");
}

// ---------- R11：1000 笔记候选 O(N×tokenMap) 不读正文 ----------
{
  const docs: SearchDocument[] = [];
  const metas: NoteMetadata[] = [];
  for (let i = 0; i < 1000; i++) {
    const p = "AI/note-" + String(i).padStart(4, "0") + ".md";
    docs.push(doc(p, "笔记" + i, "与检索无关的正文内容" + i));
    metas.push(meta(p, "笔记" + i));
  }
  docs.push(doc("AI/游戏设计综述.md", "游戏设计综述", "这里讨论游戏机制与关卡结构。"));
  metas.push(meta("AI/游戏设计综述.md", "游戏设计综述"));
  const q = tokenizeText("游戏设计");
  const t0 = Date.now();
  const ranked = rankSearchResults(docs, q, AREAS, notesMap(metas));
  const dt = Date.now() - t0;
  test("R11", ranked.length >= 1 && ranked[0].doc?.path === "AI/游戏设计综述.md", "1000 笔记下标题命中仍在首位（top=" + (ranked[0]?.doc?.path ?? "none") + "）");
  test("R11b", dt < 2000, "1000 笔记仅扫 tokenMap 不读正文，耗时 " + dt + "ms");
}

// ---------- 汇总 ----------
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);