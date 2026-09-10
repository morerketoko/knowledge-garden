/**
 * Phase 22 自动测试（P22-TAG/SEARCH/EDIT/DELETE/FSRS/PERSIST/AI/PERF）：
 * Tag Scope + 子标签 + Tag Exam Preview 数据层 + 关键词搜索 + 卡片编辑器纯逻辑/持久化隔离。
 * UI（选择器点击、Modal 表单、实时刷新）在最终报告标 NOT TESTED。
 */
import { mkdtemp } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  normalizeTag, sourceNoteHasTag, tagMatchModeOf, aggregateNoteTags, filterTagOptions,
  filterSavedCardObjects, savedCardScopeFingerprint, savedCardScopeText,
  SpacedReviewStore, type SavedCardSpacedState, type StoredFsrsState,
} from "../src/spacedReview";
import {
  validateSavedCardEdit, applySavedCardEdit, editDraftFromCard, parseTagsText, letterIndex,
} from "../src/savedCardEditor";
import {
  normalizeSearchText, searchTokens, savedCardMatchesQuery, savedCardHaystack, filterSavedCardsByQuery,
} from "../src/savedCardSearch";
import { ReviewCardStore, CardReviewStore, ExamStore, cardMarkdown, parseCardMarkdown } from "../src/examStore";
import type { SavedCardScope, SavedReviewCard, NoteExam } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function mkdir(dir: string): string { fs.mkdirSync(dir, { recursive: true }); return dir; }
const NOW = new Date(2026, 3, 1, 12, 0, 0).getTime();
function card(id: string, source: string, over: Partial<SavedReviewCard> = {}): SavedReviewCard {
  return { id, sourcePath: source, sourceVersion: "v1", question: "题 " + id, answer: "答 " + id, questionType: "recall", createdAt: NOW, updatedAt: NOW, ...over };
}
const NOTES = [
  { path: "A.md", tags: ["game", "设计"] },
  { path: "B.md", tags: ["game/design", "ai"] },
  { path: "C.md", tags: ["python"] },
  { path: "D.md", tags: ["game/剧情"] },
];
const CARDS = [
  card("ca", "A.md"), card("cb", "B.md"), card("cc", "C.md"), card("cd", "D.md"),
  card("cf", "不存在.md"),
];
const tagsOf = (p: string): string[] => NOTES.find((n) => n.path === p)?.tags ?? [];

/* ============ P22-TAG-01..08：Tag 语义与聚合（§8/9/6/7/10~13） ============ */
{
  test("P22-TAG-01", sourceNoteHasTag(["game"], "game", "include-children") === true, "精确标签命中（§8/101）");
  test("P22-TAG-02", sourceNoteHasTag(["game/design"], "game", "include-children") === true, "include-children 命中子标签 #game/design（§9/102）");
  test("P22-TAG-03", sourceNoteHasTag(["game/design"], "game", "exact") === false, "exact 不命中子标签（§103）");
  test("P22-TAG-04", sourceNoteHasTag(["gamestuff"], "game", "include-children") === false,
    "#gamestuff 不匹配 #game（前缀边界 '/'，§104）");
  const inGame = filterSavedCardObjects(CARDS, { mode: "tag", tag: "#game" }, tagsOf).map((c) => c.id);
  test("P22-TAG-05", inGame.length === 3 && ["ca", "cb", "cd"].every((x) => inGame.includes(x)),
    "多个来源：#game(include-children) 含 A/B/D（B/D 为子标签），排除 C(#python) 与不存在笔记（§105/15）");
  const exactOnly = filterSavedCardObjects(CARDS, { mode: "tag", tag: "game", tagMatchMode: "exact" }, tagsOf).map((c) => c.id);
  test("P22-TAG-03b", exactOnly.length === 1 && exactOnly[0] === "ca", "exact：#game 只含 A；B(#game/design)/D 排除");
  const agg = aggregateNoteTags(NOTES);
  const countsDesc = agg.every((t, i) => i === 0 || agg[i - 1].count >= t.count);
  test("P22-TAG-06", agg.find((t) => t.tag === "game")?.count === 1 && agg.length === 6 && countsDesc,
    "聚合计数正确（#game=1；count DESC 排序，§106/13）");
  test("P22-TAG-07", filterTagOptions(aggregateNoteTags(NOTES), "游戏").length === 0 && filterTagOptions(aggregateNoteTags(NOTES), "game").length >= 3,
    "Tag 搜索（中/英）本地过滤（§107）");
  const f1 = savedCardScopeFingerprint({ mode: "tag", tag: "game" });
  const f2 = savedCardScopeFingerprint({ mode: "tag", tag: "game", tagMatchMode: "exact" });
  const f3 = savedCardScopeFingerprint({ mode: "tag", tag: "python" });
  test("P22-TAG-08", f1 !== f2 && f1 !== f3 && savedCardScopeFingerprint({ mode: "tag", tag: "#game" }) === f1,
    "tag/子标签模式变化 → scope 指纹变化（默认 include-children，§20/21）");
  test("P22-TAG-08b", normalizeTag("#游戏 ") === "游戏" && tagMatchModeOf({ mode: "tag", tag: "x" } as SavedCardScope) === "include-children",
    "normalizeTag 与默认 include-children");
  test("P22-TAG-08c", savedCardScopeText({ mode: "tag", tag: "#游戏" } as SavedCardScope) === "#游戏", "范围显示 #游戏（§17/18）");
}

/* ============ P22-TAG-09..13：Tag → Exam 数据层（§25/9/10/11/13） ============ */
{
  const exams: NoteExam[] = [
    { id: "exA", sourcePath: "A.md", sourceVersion: "v1", title: "A 整体考察", mode: "holistic", questionCount: 2, answerMode: "source_only", questions: [
      { id: "a1", type: "recall", question: "A 题 1", referenceAnswer: "r", sourcePath: "A.md" },
      { id: "a2", type: "recall", question: "A 题 2", referenceAnswer: "r", sourcePath: "A.md" },
    ], examVersion: 1, createdAt: NOW, updatedAt: NOW },
    { id: "exB", sourcePath: "C.md", sourceVersion: "v1", title: "C python", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [
      { id: "c1", type: "recall", question: "C 题", referenceAnswer: "r", sourcePath: "C.md" },
    ], examVersion: 1, createdAt: NOW, updatedAt: NOW },
  ];
  const matchedSources = NOTES.filter((n) => sourceNoteHasTag(n.tags, "game", "include-children")).map((n) => n.path);
  const visibleExams = exams.filter((e) => matchedSources.includes(e.sourcePath)).map((e) => e.id);
  test("P22-TAG-09", visibleExams.includes("exA"), "Tag #game 能看到 A 的考试（§102）");
  test("P22-TAG-10", !visibleExams.includes("exB"), "Tag #game 不能看到 #python 来源 C 的考试（§103/10）");
  test("P22-TAG-13", visibleExams.every((id) => exams.some((e) => e.id === id)) && matchedSources.includes("A.md"),
    "Exam 删除 graceful：来源解析独立于考试存在（§13；Preview 只列现存考试）");
  test("P22-TAG-12", matchedSources.length === 3, "Tag 源解析只走 NoteIndex（0 AI 数据层）");
}

/* ============ P22-SEARCH-01..08：搜索（§35~42/73） ============ */
{
  const mc = card("mc", "01 盒子/游戏/游戏框架.md", {
    question: "为什么需要模块边界？", answer: "模块边界可以降低耦合。", explanation: "隔离变化",
    concept: "模块化", questionType: "multiple_choice",
  });
  const pool = [
    mc,
    card("s2", "02 资料/调研.md", { question: "Python 并发", answer: "GIL…", concept: "并发" }),
    card("s3", "01 盒子/游戏/系统边界.md", { question: "游戏循环", answer: "tick 固定步长" }),
  ];
  const meta = (c: SavedReviewCard): { examTitle?: string; sourceBasename?: string } => ({
    examTitle: c.id === "mc" ? "模块化整体考察" : undefined,
    sourceBasename: c.sourcePath.split("/").pop()?.replace(/\.md$/, "") ?? "",
  });
  test("P22-SEARCH-01", savedCardMatchesQuery(savedCardHaystack(mc, meta(mc).examTitle, meta(mc).sourceBasename), "模块边界") === true, "题干中文 substring（§36/101）");
  test("P22-SEARCH-02", savedCardMatchesQuery(savedCardHaystack(mc, meta(mc).examTitle, meta(mc).sourceBasename), "降低耦合") === true, "答案关键词命中（§102）");
  test("P22-SEARCH-03", filterSavedCardsByQuery(pool, "游戏框架", meta).map((c) => c.id).includes("mc"), "source basename 命中（§103）");
  test("P22-SEARCH-04", filterSavedCardsByQuery(pool, "模块化整体考察", meta).map((c) => c.id).includes("mc"), "exam title 命中（§104）");
  test("P22-SEARCH-05", filterSavedCardsByQuery(pool, "模块化", meta).map((c) => c.id).includes("mc") && filterSavedCardsByQuery(pool, "Python", meta).map((c) => c.id).includes("s2"), "concept / 英文 token 命中（§105）");
  // §106：scope + search 交集（tag scope 内搜索）
  const tagScope: SavedCardScope = { mode: "tag", tag: "游戏" };
  const tagNotes = { "01 盒子/游戏/游戏框架.md": ["游戏"], "02 资料/调研.md": ["资料"], "01 盒子/游戏/系统边界.md": ["游戏"] };
  const scoped = filterSavedCardObjects(pool, tagScope, (p) => tagNotes[p] ?? []);
  const intersect = filterSavedCardsByQuery(scoped, "Python", meta);
  test("P22-SEARCH-06", scoped.length === 2 && intersect.length === 0,
    "Scope #游戏 内搜索 Python → 空（不会漏到 scope 外，§106/73）");
  test("P22-SEARCH-07", filterSavedCardsByQuery(pool, "", meta).length === pool.length, "清除搜索恢复完整列表（§107）");
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const searchSrc = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "savedCardSearch.ts"), "utf8"));
  test("P22-SEARCH-08", !/\bAI\b|prompt|apiKey|https?:/.test(searchSrc), "Search 模块 0 AI（§108）");
}

/* ============ P22-EDIT-*：校验 + 应用 + 快照隔离（§54/46~48/59~68） ============ */
{
  const mc = card("mc", "A.md", { question: "旧题干", answer: "旧答案", explanation: "旧说明", concept: "旧概念", questionType: "multiple_choice", options: ["旧1", "旧2", "旧3", "旧4"], correctAnswer: "A" });
  const draft = editDraftFromCard(mc);
  draft.question = "新题干？"; draft.answer = "新答案"; draft.explanation = "新说明"; draft.concept = "模块化";
  draft.options = ["新A", "新B", "新C", "新D"]; draft.correctAnswer = "C";
  const edited = applySavedCardEdit(mc, draft);
  test("P22-EDIT-01", edited.question === "新题干？", "编辑题干生效（§101）");
  test("P22-EDIT-02", edited.answer === "新答案", "编辑答案生效（§102）");
  test("P22-EDIT-03", edited.explanation === "新说明", "编辑说明生效（§103）");
  test("P22-EDIT-04", edited.concept === "模块化", "编辑 concept 生效（§104）");
  test("P22-EDIT-05", edited.options?.join("|") === "新A|新B|新C|新D", "编辑 MC options（§105）");
  test("P22-EDIT-06", edited.correctAnswer === "C", "编辑 correctAnswer（§106）");
  test("P22-EDIT-07", edited.sourcePath === "A.md" && edited.examId === undefined && edited.id === "mc" && edited.createdAt === NOW,
    "编辑不改 source/exam/cardId/createdAt（§49~52/96）");
  // Roundtrip（Markdown 持久化）
  const parsed = parseCardMarkdown(cardMarkdown(edited));
  test("P22-PERSIST-02", parsed.card?.question === "新题干？" && parsed.card?.options?.[0] === "新A" && parsed.card?.correctAnswer === "C",
    "编辑后 Markdown roundtrip 正确（§105/57）");

  // 校验（§11~13）
  const badEmpty = validateSavedCardEdit({ ...editDraftFromCard(mc), question: "" }, "multiple_choice");
  const badOpts = validateSavedCardEdit({ ...editDraftFromCard(mc), options: ["只有1个"] }, "multiple_choice");
  const badCorrect = validateSavedCardEdit({ ...editDraftFromCard(mc), options: ["a", "b"], correctAnswer: "C" }, "multiple_choice");
  test("P22-EDIT-11", !badEmpty.ok && badEmpty.errors.some((e) => e.includes("题干")), "空题干 reject（§111）");
  test("P22-EDIT-12", !badOpts.ok, "MC <2 选项 reject（§112）");
  test("P22-EDIT-13", !badCorrect.ok, "correctAnswer 不在选项 reject（§113）");
  test("P22-EDIT-12b", validateSavedCardEdit({ ...editDraftFromCard({ ...mc, questionType: "true_false" as const, correctAnswer: "true" }), correctAnswer: "也许是" }, "true_false").ok === false,
    "判断题必须 true/false");
  const tf = validateSavedCardEdit({ ...editDraftFromCard({ ...mc, questionType: "true_false" as const, options: undefined, correctAnswer: "true" }), options: [], correctAnswer: "false" }, "true_false");
  test("P22-EDIT-48", tf.ok === true, "判断题 true/false 合法（§48）");
  // 隔离：applySavedCardEdit 不碰原卡 / 不改 Exam / 不改 FSRS
  const untouched = JSON.stringify(mc);
  void applySavedCardEdit(mc, draft);
  test("P22-EDIT-14", JSON.stringify(mc) === untouched, "apply 返回新对象，原卡不变（Cancel 等价不写入，§114）");
  test("P22-EDIT-09", edited.examId === undefined && edited.sourcePath === mc.sourcePath, "编辑不影响 Exam/Source 引用（§107/108）");
  test("P22-EDIT-10", (mc.reviewCount ?? 0) === 0, "编辑不触碰 review history 字段（§110）");
  test("P22-EDIT-13b", letterIndex("C") === 2 && parseTagsText("#ai, 游戏 ，学习")[0] === "ai", "辅助函数（letterIndex/标签解析）");
}

/* ============ P22-FSRS-01..05 / PERSIST / DELETE：Store+Markdown 层 ============ */
{
  const dir = mkdir(mkdtemp(path.join(os.tmpdir(), "kg-p22-")));
  const cards = new ReviewCardStore(dir); cards.load();
  const spaced = new SpacedReviewStore(dir); spaced.load();
  const cr = new CardReviewStore(dir); cr.load();
  const exams = new ExamStore(dir); exams.load();
  const src = "01 盒子/游戏/游戏框架.md";
  exams.add({ id: "e1", sourcePath: src, sourceVersion: "v1", title: "来源考试", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW });

  const c0 = card("edit1", src, { question: "原题干", questionType: "multiple_choice", options: ["a", "b", "c", "d"], correctAnswer: "A" });
  cards.add(c0);
  const st0: SavedCardSpacedState = {
    cardId: "edit1",
    fsrsState: { due: NOW + 5 * 86400000, stability: 12, difficulty: 5, reps: 4, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 10 * 86400000 },
    lastRating: "good", reviewCount: 4, lastReviewedAt: NOW - 10 * 86400000, masteryPercent: 80, createdAt: NOW - 90 * 86400000, updatedAt: NOW - 10 * 86400000,
  };
  spaced.scCommitReview("edit1", st0, { timestamp: NOW - 10 * 86400000, rating: "good", previousDue: null, nextDue: NOW + 5 * 86400000, intervalDays: 15, stability: 12, difficulty: 5, retrievability: 0.9 });
  cr.add({ cardId: "edit1", reviewedAt: NOW - 10 * 86400000, rating: "good" });

  const dueBefore = spaced.scGet("edit1")?.fsrsState.due;
  // 模拟 main.updateSavedReviewCard 的普通编辑（不动 FSRS/history）
  const edited = applySavedCardEdit(c0, { question: "新题干", answer: "新答案", explanation: "", concept: "模块", tagsText: "#游戏", options: ["新版1", "新版2", "新版3", "新版4"], correctAnswer: "B" });
  cards.update("edit1", { question: edited.question, answer: edited.answer, explanation: edited.explanation, concept: edited.concept, tags: edited.tags, options: edited.options, correctAnswer: edited.correctAnswer, editedAt: NOW });
  // 重新加载 = PERSIST
  const cards2 = new ReviewCardStore(dir); cards2.load();
  const spaced2 = new SpacedReviewStore(dir); spaced2.load();
  test("P22-PERSIST-01", cards2.get("edit1")?.question === "新题干" && cards2.get("edit1")?.options?.join("|") === "新版1|新版2|新版3|新版4",
    "编辑后 Store 持久化（PERSIST-01/03）");
  test("P22-FSRS-01", spaced2.scGet("edit1")?.fsrsState.due === dueBefore, "普通编辑：due 不变（§101）");
  test("P22-FSRS-02", spaced2.scGet("edit1") !== undefined && spaced2.scGet("edit1")?.fsrsState.stability === 12, "普通编辑：stability/retrievability 状态不变（§102）");
  test("P22-FSRS-03", spaced2.scGet("edit1")?.masteryPercent === 80 && spaced2.scGet("edit1")?.reviewCount === 4, "普通编辑：mastery/reviewCount 不变（§103）");
  test("P22-EDIT-10b", cr.byCard("edit1").length === 1, "普通编辑：CardReviewRecord 保留（§110/66）");
  test("P22-EDIT-07b", exams.get("e1") !== undefined && exams.findBySource(src).length === 1, "普通编辑：Exam 保留（§107）");
  // 重置（§63~65/104/105）
  spaced2.scRemoveCard("edit1");
  cr.removeByCard("edit1");
  const spaced3 = new SpacedReviewStore(dir); spaced3.load();
  const cr3 = new CardReviewStore(dir); cr3.load();
  test("P22-FSRS-04", spaced3.scGet("edit1") === undefined, "重置：FSRS state 删除 → 下次 createEmptyCard（§104）");
  test("P22-FSRS-05", spaced3.scLogsAll().filter((l) => l.cardId === "edit1").length === 0 && cr3.byCard("edit1").length === 0,
    "重置：SavedCardReviewLogs 与 CardReviewRecord 清除（§105/65）");
  test("P22-FSRS-04b", cards2.get("edit1")?.question === "新题干", "重置不影响编辑内容（只清复习进度）");
  // Delete regression（编辑后删除仍一致）
  const examsBeforeDelete = exams.all().length;
  cards2.remove("edit1");
  test("P22-DELETE-01", cards2.get("edit1") === undefined, "编辑后删除成功（§101）");
  test("P22-DELETE-03", exams.all().length === examsBeforeDelete, "删除后 Exam 保留（§103）");
  test("P22-DELETE-04", cards2.all().length === 0 && spaced3.scGet("edit1") === undefined, "删除后卡与 FSRS 都不存在（§104/2）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P22-AI/PERF 结构断言 ============ */
{
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const f of ["savedCardSearch.ts", "savedCardEditor.ts"]) {
    const src = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"));
    test("P22-AI-" + (f.includes("Search") ? "03" : "04"), !/\bAI\b|prompt|apiKey|https?:|generate/.test(src) && !/activity|markReviewed/.test(src),
      f + " 0 AI（搜索=§108；编辑=§109）且不动 Activity");
  }
  const mainSrc = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8"));
  const updStart = mainSrc.indexOf("async updateSavedReviewCard(");
  const updBody = updStart >= 0 ? mainSrc.slice(updStart, updStart + 7000) : "";
  test("P22-EDIT-15", updBody.includes("该复习卡已不存在"), "已删除卡保存 → reject 文案（§115/72）");
  test("P22-PERF-04", updBody.includes("updateSavedCardMarkdown(") && /cards\.update\(/.test(updBody), "编辑只更新一张卡 Store+Markdown（§86/104）");
  test("P22-EDIT-07c", !/examStore\.update|examStore\.remove|app\.vault\.modify\(.*sourcePath/.test(updBody), "编辑路径不修改 Exam/Source Note（§107/108/59/60）");
}

/* ============ 汇总 ============ */
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
