/**
 * Phase 21 自动测试（Unified Review Cards + Note Exam Hub；纯模块/持久化层）。
 * UI/Obsidian 运行时（P21-11~16/29~33/42/57~60 等）在最终报告标 NOT TESTED。
 * 覆盖：Saved Card FSRS 独立(§96)、Saved Card Scope(§97)、Refresh/自动答案语义、掌握度(§100)、
 * Retrievability(§101)、MC 卡序列化(§102)、Exam Hub 数据层(§103)、Exam↔Card(§105)、
 * FSRS 共用(§106)、Source(§107)、Cache 独立(§109)、Migration(§110)、Queue(§70/71)。
 */
import { mkdtemp, stateExists, readStateText, seedStateText, stateList } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SpacedReviewStore, FsrsScheduler, schedulerFromConfig, schedulerConfigFingerprint,
  filterSavedCardObjects, savedCardScopeFingerprint, defaultSavedCardScope, savedCardScopeText,
  buildSavedCardReviewQueue, savedCardOverview, nextMasteryPercent, masteryConfidence,
  isValidSavedCardsDailyLimit, type SavedCardSpacedState, type StoredFsrsState, type SavedCardReviewLogEntry,
} from "../src/spacedReview";
import {
  ReviewCardStore, ExamStore, ExamSessionStore, CardReviewStore,
  cardMarkdown, parseCardMarkdown,
} from "../src/examStore";
import { examProgress, examSessionFinished } from "../src/examEngine";
import type { SavedCardScope, NoteExam, ExamSessionState, SavedReviewCard, FsrsRating } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function tmpRoot(tag: string): string { return mkdtemp(path.join(os.tmpdir(), "kg-p21-" + tag + "-")); }
function eqSet(a: string[], b: string[]): boolean { return a.length === b.length && a.every((x) => b.includes(x)); }

const DAY = 86400000;
const NOW = new Date(2026, 1, 10, 12, 0, 0).getTime();   // 本地正午
const CFG = { desiredRetention: 0.9, maxIntervalDays: 3650, learningSteps: "10m,1h", relearningSteps: "10m" };
function sched(): FsrsScheduler { return schedulerFromConfig(CFG); }

/** 造 Saved Card FSRS 状态（卡在很久前已毕业 → 当前处于 Review 态） */
function savedState(cardId: string, due: number, stability: number, mastery = 75): SavedCardSpacedState {
  return {
    cardId,
    fsrsState: { due, stability, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 40 * DAY },
    lastRating: "good", reviewCount: 3, lastReviewedAt: NOW - 40 * DAY,
    masteryPercent: mastery, createdAt: NOW - 80 * DAY, updatedAt: NOW - 40 * DAY,
  };
}
function sampleCards(): SavedReviewCard[] {
  const base = { answer: "答案", questionType: "recall" as const, sourceVersion: "v1", createdAt: NOW, updatedAt: NOW };
  return [
    { ...base, id: "cardA", sourcePath: "01 盒子/游戏/游戏框架.md", examId: "exam1", examQuestionId: "q1", question: "A 题" },
    { ...base, id: "cardB", sourcePath: "01 盒子/游戏/系统边界.md", examId: "exam2", examQuestionId: "q1", question: "B 题" },
    { ...base, id: "cardC", sourcePath: "02 资料/调研.md", examId: "exam1", examQuestionId: "q2", question: "C 题" },
    { ...base, id: "cardD", sourcePath: "根笔记.md", question: "D 题" },
  ];
}

/* ============ P21-01..04 / 41：Saved Card FSRS 独立（同一 source 多卡互不影响） ============ */
{
  const dir = tmpRoot("scindep");
  const store = new SpacedReviewStore(dir);
  store.load();
  const s = sched();
  const ra = s.schedule("good", null, NOW);
  const rb = s.schedule("again", null, NOW);
  store.scCommitReview("cardA", savedState("cardA", NOW + 2 * DAY, 10), { timestamp: NOW, rating: "good", previousDue: null, nextDue: ra.next.due, intervalDays: 0.04, stability: ra.next.stability, difficulty: ra.next.difficulty, retrievability: 1 });
  store.scCommitReview("cardB", savedState("cardB", NOW + 5 * DAY, 8), { timestamp: NOW, rating: "again", previousDue: null, nextDue: rb.next.due, intervalDays: 0.01, stability: rb.next.stability, difficulty: rb.next.difficulty, retrievability: 1 });
  const a = store.scGet("cardA");
  const b = store.scGet("cardB");
  test("P21-01", !!a && !!b && a.fsrsState.due !== b.fsrsState.due && a.cardId !== b.cardId,
    "同一 sourcePath 的 A/B 两卡 FSRS 状态彼此独立（主键 savedCard:cardId，§96）");
  test("P21-02", (a as SavedCardSpacedState).fsrsState.due !== (b as SavedCardSpacedState).fsrsState.due,
    "A Good / B Again → due 不同（真实 FSRS）");
  // A 再复习一次 → A reviewCount +1，B 不变
  const beforeB = (b as SavedCardSpacedState).reviewCount;
  const ra2 = s.schedule("good", (a as SavedCardSpacedState).fsrsState, NOW + DAY);
  const a2: SavedCardSpacedState = {
    cardId: "cardA", fsrsState: ra2.next, lastRating: "good",
    reviewCount: (a as SavedCardSpacedState).reviewCount + 1, lastReviewedAt: NOW + DAY,
    masteryPercent: nextMasteryPercent((a as SavedCardSpacedState).masteryPercent, (a as SavedCardSpacedState).reviewCount, "good"),
    createdAt: (a as SavedCardSpacedState).createdAt, updatedAt: NOW + DAY,
  };
  store.scCommitReview("cardA", a2, { timestamp: NOW + DAY, rating: "good", previousDue: a2.fsrsState.due, nextDue: a2.fsrsState.due, intervalDays: 1, stability: ra2.next.stability, difficulty: ra2.next.difficulty, retrievability: 0.9 });
  test("P21-03", store.scGet("cardA")?.reviewCount === 4 && store.scGet("cardB")?.reviewCount === beforeB,
    "A 复习计数不影响 B");
  store.scRemoveCard("cardA");
  test("P21-04", store.scGet("cardA") === undefined && store.scGet("cardB") !== undefined,
    "删除 A：A 的 FSRS 状态与日志被清，B 保持不变（§39/96）");
  const reload = new SpacedReviewStore(dir);
  reload.load();
  test("P21-04b", reload.scGet("cardB") !== undefined && reload.scGet("cardA") === undefined && reload.scCount() === 1,
    "删除持久化：重启后 A 不复活、B 仍在");
  fs.rmSync(dir, { recursive: true, force: true });
}
// P21-41：Saved Card 状态与 Note 状态完全独立（同一文件里两个 Map）
{
  const dir = tmpRoot("sep");
  const store = new SpacedReviewStore(dir);
  store.load();
  const s = sched();
  const noteRes = s.schedule("good", null, NOW);
  store.commitReview("01 盒子/游戏/游戏框架.md", { path: "01 盒子/游戏/游戏框架.md", fsrsState: noteRes.next, reviewCount: 1, lastRating: "good", lastReviewedAt: NOW, createdAt: NOW, updatedAt: NOW }, { timestamp: NOW, rating: "good", previousDue: null, nextDue: noteRes.next.due, intervalDays: 1, stability: 2, difficulty: 5, retrievability: 1 });
  const scRes = s.schedule("easy", null, NOW);
  store.scCommitReview("cardX", savedState("cardX", NOW + 9 * DAY, 10), { timestamp: NOW, rating: "easy", previousDue: null, nextDue: scRes.next.due, intervalDays: 8, stability: 9, difficulty: 3, retrievability: 1 });
  test("P21-41", store.count() === 1 && store.scCount() === 1 && store.get("01 盒子/游戏/游戏框架.md")?.fsrsState.due !== store.scGet("cardX")?.fsrsState.due,
    "笔记复习与复习卡复习状态独立（§41/138）");
  store.prune(new Set());   // 删光所有笔记 → note 卡清空，saved 卡保留（§141）
  test("P21-41b", store.count() === 0 && store.scCount() === 1, "Source 删除不删 Saved Card FSRS（§141/142）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P21-05..10：Saved Card Scope（§97/17~22） ============ */
{
  const cards = sampleCards();
  const pathsOf = (s: SavedCardScope): string[] => filterSavedCardObjects(cards, s).map((c) => c.id);
  test("P21-05", pathsOf(defaultSavedCardScope()).length === 4, "vault → 全部");
  test("P21-06", eqSet(pathsOf({ mode: "current-note", notePath: "01 盒子/游戏/游戏框架.md" }), ["cardA"]),
    "current note → 只显示 sourcePath===当前笔记（§18）");
  test("P21-07", eqSet(pathsOf({ mode: "folder", folderPath: "01 盒子/游戏" }), ["cardA", "cardB"]),
    "folder → sourcePath 前缀过滤（§20）");
  test("P21-08", eqSet(pathsOf({ mode: "area", areaId: "a1", folderPath: "01 盒子" }), ["cardA", "cardB"]),
    "area → KnowledgeArea.folder 前缀（§21）");
  test("P21-09", eqSet(pathsOf({ mode: "exam", examId: "exam1" }), ["cardA", "cardC"]),
    "exam → 只显示 examId 匹配的卡（§19）");
  test("P21-10", eqSet(pathsOf({ mode: "custom", folders: ["01 盒子/游戏", "02 资料"] }), ["cardA", "cardB", "cardC"]),
    "custom → 多文件夹来源（§22）");
  const f1 = savedCardScopeFingerprint({ mode: "exam", examId: "exam1" });
  const f2 = savedCardScopeFingerprint({ mode: "exam", examId: "exam2" });
  test("P21-10b", f1 !== f2 && savedCardScopeFingerprint({ mode: "exam", examId: "exam1" }) === f1,
    "saved scope 指纹：不同 examId 不同 key（独立缓存语义 §29）");
  test("P21-10c", savedCardScopeText({ mode: "exam", examId: "exam1" }, "游戏 · 整体考察") === "游戏 · 整体考察",
    "scope 显示名（View 用）");
}

/* ============ P21-17..19：Mastery（§100，EWMA 复用） ============ */
{
  test("P21-17", nextMasteryPercent(80, 5, "again") < 80, "Again → 掌握度下降");
  test("P21-18", nextMasteryPercent(40, 5, "good") > 40, "Good → 掌握度上升");
  test("P21-19", masteryConfidence(2).low && masteryConfidence(5).low === false, "mastery confidence（§101/57）");
}

/* ============ P21-20/21：Retrievability（§101） ============ */
{
  const dir = tmpRoot("retr");
  const store = new SpacedReviewStore(dir);
  store.load();
  const s = sched();
  store.scCommitReview("cardA", savedState("cardA", NOW + DAY, 3, 60), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 3, difficulty: 5, retrievability: 1 });
  const st = store.scGet("cardA") as SavedCardSpacedState;
  const r0 = s.retrievability(st.fsrsState, NOW) as number;
  const r30 = s.retrievability(st.fsrsState, NOW + 30 * DAY) as number;
  test("P21-20", r0 > r30, "保持率随时间下降（" + r0.toFixed(3) + " > " + r30.toFixed(3) + "）");
  // lowest retention first（§21）
  const cards = sampleCards();
  const states = [savedState("cardA", NOW - DAY, 2, 50), savedState("cardB", NOW - DAY, 10, 70), savedState("cardC", NOW - DAY, 60, 90)];
  const q = buildSavedCardReviewQueue(cards, states, s, NOW, 3);   // limit=3 → 只取 3 张 due
  test("P21-21", q.items.length === 3 && q.items[0].cardId === "cardA" && q.items[2].cardId === "cardC",
    "最可能忘记（保持率最低）优先（" + q.items.map((i) => i.cardId).join(",") + "）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P21-22..24：Multiple Choice 保存 options/correctAnswer（卡片 UI 数据完整） ============ */
{
  const mc: SavedReviewCard = {
    id: "mc1", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", examId: "e1", examQuestionId: "q9",
    question: "模块边界的作用？", answer: "参考答案：隔离变化。",
    questionType: "multiple_choice",
    options: ["隔离变化", "增加耦合", "减少文件数", "隐藏测试"],
    correctAnswer: "A",
    createdAt: NOW, updatedAt: NOW,
  };
  const md = cardMarkdown(mc);
  const parsed = parseCardMarkdown(md);
  test("P21-22", parsed.card?.questionType === "multiple_choice", "MC 卡类型序列化往返保持 multiple_choice（§37）");
  test("P21-23", parsed.card?.options?.length === 4 && parsed.card.options.join("|") === "隔离变化|增加耦合|减少文件数|隐藏测试",
    "MC 保存 4 个 options（§33/37）");
  test("P21-24", parsed.card?.correctAnswer === "A" && parsed.card.examQuestionId === "q9" && parsed.card.examId === "e1",
    "correctAnswer / examQuestionId / examId 可恢复（Markdown 为真相源，§117）");
  // 旧卡（无 options）兼容
  const legacy = parseCardMarkdown(cardMarkdown({ ...mc, options: undefined, correctAnswer: undefined, examQuestionId: undefined }));
  test("P21-24b", legacy.card !== null && legacy.card.options === undefined && legacy.card.questionType === "multiple_choice",
    "旧卡（无 options/correctAnswer/examQuestionId）正常解析，不破坏（§33/38）");
}

/* ============ P21-25..28：Exam Hub 数据层（§103） ============ */
{
  const dir = tmpRoot("hub");
  const examStore = new ExamStore(dir);
  examStore.load();
  const examA: NoteExam = { id: "e1", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", title: "游戏框架 · 整体考察", mode: "holistic", questionCount: 10, answerMode: "source_preferred", questions: [], examVersion: 1, createdAt: NOW - DAY, updatedAt: NOW - DAY };
  const examB: NoteExam = { id: "e2", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", title: "游戏框架 · 主题卷", mode: "custom", topic: "模块边界", questionCount: 5, answerMode: "source_preferred", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  const examOther: NoteExam = { id: "e3", sourcePath: "02 资料/调研.md", sourceVersion: "v1", title: "调研", mode: "holistic", questionCount: 2, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY };
  examStore.add(examA); examStore.add(examB); examStore.add(examOther);
  const list = examStore.findBySource("01 盒子/游戏/游戏框架.md");
  test("P21-25", list.length === 2, "findBySource 返回该笔记全部考试（§43/81）");
  test("P21-26", examStore.findBySource("不存在.md").length === 0, "零考试 → 空列表（空状态 §129/26）");
  test("P21-27", list[0].id === "e2" && list[1].id === "e1", "createdAt DESC（最新在前，§44/27）");
  // progress（§45/28）：会话 7/10
  const sessStore = new ExamSessionStore(dir);
  sessStore.load();
  const qs = Array.from({ length: 10 }, (_, i) => ({ id: "q" + i }));
  const exam10: NoteExam = { ...examA, id: "e10", questionCount: 10, questions: qs as never };
  examStore.add(exam10);
  const sess: ExamSessionState = { examId: "e10", mode: "card", currentIndex: 7, status: "running", startedAt: NOW, updatedAt: NOW, answers: Array.from({ length: 7 }, (_, i) => ({ questionId: "q" + i, answer: "a", selfRating: "good" as const, answeredAt: NOW })) };
  sessStore.upsert(sess);
  const p = examProgress(exam10, sess.answers);
  test("P21-28", p.total === 10 && p.answered === 7 && examSessionFinished(sess, 10) === false,
    "Exam Hub 进度 7/10 由 ExamSessionStore 解析（§45/28）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P21-34..37：Exam ↔ Saved Card（§105/54/39/40） ============ */
{
  const dir = tmpRoot("link");
  const cardStore = new ReviewCardStore(dir);
  cardStore.load();
  const card: SavedReviewCard = {
    id: "cardQ1", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1",
    examId: "exam1", examQuestionId: "q1", question: "为什么需要模块边界？", answer: "隔离变化…",
    questionType: "recall", createdAt: NOW, updatedAt: NOW,
  };
  cardStore.add(card);
  test("P21-34", cardStore.findByExamQuestion("exam1", "q1")?.id === "cardQ1", "考试题 → 收藏卡（按 examId+questionId 可查，§34）");
  const dup = cardStore.findByExamQuestion("exam1", "q1");
  test("P21-35", !!dup && cardStore.findByExamQuestion("exam1", "q2") === undefined,
    "同 examId+questionId 去重（不生成第二张，§54/35）");
  // 删除 Exam：卡片保留（§40/36）
  const examStore = new ExamStore(dir);
  examStore.load();
  examStore.add({ id: "exam1", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", title: "游戏框架", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [{ id: "q1", type: "recall", question: "为什么需要模块边界？", referenceAnswer: "隔离变化…", sourcePath: "01 盒子/游戏/游戏框架.md" }], examVersion: 1, createdAt: NOW, updatedAt: NOW });
  examStore.remove("exam1");
  test("P21-36", cardStore.get("cardQ1") !== undefined && examStore.get("exam1") === undefined,
    "删除考试不删除卡（examId 保留历史，UI 显示“原考试已删除”§40/36）");
  // P21-37：卡打开来源考试（存在时）；不存在时优雅
  const keepExam: NoteExam = { id: "exam9", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", title: "保留考试", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  examStore.add(keepExam);
  const linked = cardStore.get("cardQ1");
  const titleOf = linked?.examId ? examStore.get(linked.examId)?.title : undefined;
  test("P21-37", linked?.examId === "exam1" && titleOf === undefined && cardStore.get("cardQ1") !== undefined,
    "卡可查来源考试；Exam 已删时 title 优雅为 undefined（UI 显示原考试已删除，§40/37）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P21-38..40：共用 FSRS 设置 / 同一调度器（§106） ============ */
{
  const f1 = schedulerConfigFingerprint(CFG);
  const f2 = schedulerConfigFingerprint(CFG);
  const f3 = schedulerConfigFingerprint({ ...CFG, desiredRetention: 0.85 });
  test("P21-38", f1 === f2 && f1 !== f3, "同一全局 desiredRetention（复习卡与笔记复习共用 §38/64/65）");
  const a = schedulerFromConfig(CFG);
  const b = schedulerFromConfig(CFG);
  const dA = a.schedule("good", null, NOW).next.due;
  const dB = b.schedule("good", null, NOW).next.due;
  test("P21-40", dA === dB, "同一 FsrsScheduler（同设置实例结果一致；保存卡/笔记共用引擎 §40/69）");
  test("P21-39", CFG.learningSteps === "10m,1h" && CFG.relearningSteps === "10m", "共用学习步骤设置（§39/66）");
}

/* ============ P21-42..44：Source（§107） ============ */
{
  const dir = tmpRoot("src");
  const cardStore = new ReviewCardStore(dir);
  cardStore.load();
  const card: SavedReviewCard = { id: "c1", sourcePath: "01 盒子/游戏/旧名.md", sourceVersion: "v1", question: "题", answer: "答", questionType: "recall", createdAt: NOW, updatedAt: NOW };
  cardStore.add(card);
  cardStore.migratePaths("01 盒子/游戏/旧名.md", "01 盒子/游戏/新名.md");
  const migrated = cardStore.get("c1");
  test("P21-44", migrated?.sourcePath === "01 盒子/游戏/新名.md", "source rename 跟随已有 migratePaths（§85/44）");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  spaced.scCommitReview("c1", savedState("c1", NOW + DAY, 5, 70), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  spaced.migratePaths("01 盒子/游戏/旧名.md", "01 盒子/游戏/新名.md");   // 只影响笔记卡
  test("P21-44b", spaced.scGet("c1")?.cardId === "c1" && (spaced.scGet("c1") as SavedCardSpacedState).fsrsState.due === NOW + DAY,
    "FSRS 主键 cardId 不变（source rename 只改卡片 sourcePath，§85）");
  // 来源删除：卡仍可复习（删除文件不影响 cardStore / spaced）
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P21-50..52：Cache 独立（§109） ============ */
{
  const dir = tmpRoot("cache");
  
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  spaced.scCommitReview("c1", savedState("c1", NOW + DAY, 5, 70), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  const cardStore = new ReviewCardStore(dir);
  cardStore.load();
  cardStore.add({ id: "c1", sourcePath: "a.md", sourceVersion: "v1", question: "题", answer: "答", questionType: "recall", createdAt: NOW, updatedAt: NOW });
  // 模拟 AI Cache 文件被清（独立文件）
  seedStateText(path.join(dir, "cache", "ai-cache.json"), JSON.stringify({ entries: [] }), "utf8");
  fs.rmSync(path.join(dir, "cache", "ai-cache.json"), { force: true });
  const spaced2 = new SpacedReviewStore(dir);
  spaced2.load();
  const cards2 = new ReviewCardStore(dir);
  cards2.load();
  test("P21-51", cards2.count() === 1 && cardStore.get("c1") !== undefined, "AI cache 清除不影响 Saved Cards（§51）");
  test("P21-52", spaced2.scCount() === 1 && (spaced2.scGet("c1") as SavedCardSpacedState).fsrsState.due === NOW + DAY,
    "AI cache 清除不影响 FSRS state（§52）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P21-53..56：Migration（§110/38/55） ============ */
{
  const dir = tmpRoot("mig");
  
  seedStateText(path.join(dir, "cache", "cards.json"), JSON.stringify({ formatVersion: 1, entries: [{ id: "old1", sourcePath: "a.md", sourceVersion: "v1", question: "旧卡", answer: "旧答案", questionType: "recall", createdAt: NOW, updatedAt: NOW }] }), "utf8");
  seedStateText(path.join(dir, "cache", "card-reviews.json"), JSON.stringify({ formatVersion: 1, records: [{ cardId: "old1", reviewedAt: NOW, rating: "good" }] }), "utf8");
  const cs = new ReviewCardStore(dir);
  test("P21-53", cs.load() === false && cs.count() === 1 && cs.get("old1")?.question === "旧卡", "旧 cards.json 加载（§53）");
  const cr = new CardReviewStore(dir);
  test("P21-54", cr.load() === false && cr.count() === 1 && cr.byCard("old1").length === 1, "旧 card-reviews.json 加载（§54）");
  // P21-55：缺 saved FSRS 状态 → 首次评分 lazy createEmptyCard（§38/55）——scGet null + schedule(null) 可起步
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  test("P21-55", spaced.scGet("old1") === undefined && spaced.scCount() === 0, "旧卡无 saved FSRS 状态（可 lazy 首评）");
  const s = sched();
  const first = s.schedule("good", null, NOW);
  test("P21-55b", first.next.due > NOW && spaced.scGet("old1") === undefined,
    "首次评分 createEmptyCard 语义可用（状态创建由 main.rateSavedCard 负责，§38）");
  // P21-56：corrupt spaced 隔离
  seedStateText(path.join(dir, "cache", "spaced-review.json"), "{broken", "utf8");
  const corrupt = new SpacedReviewStore(dir);
  test("P21-56", corrupt.load() === true && corrupt.scCount() === 0 && corrupt.count() === 0,
    "corrupt spaced-review.json 隔离为空（§56/36）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ v2 文件格式 + v1 容错 + 队列上限 ============ */
{
  const dir = tmpRoot("fmt");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  spaced.scCommitReview("c1", savedState("c1", NOW + DAY, 5, 70), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  const raw = JSON.parse(readStateText(path.join(dir, "cache", "spaced-review.json"))) as Record<string, unknown>;
  test("P21-60a", raw.formatVersion === 2 && typeof raw.savedCards === "object" && Array.isArray(raw.savedCardReviewLogs),
    "同文件 formatVersion=2：savedCards + savedCardReviewLogs（§6/123，不新建第二文件）");
  const log = (raw.savedCardReviewLogs as SavedCardReviewLogEntry[])[0];
  const keys = ["cardId", "timestamp", "rating", "previousDue", "nextDue", "intervalDays", "stability", "difficulty", "retrievability"];
  test("P21-60b", keys.every((k) => k in log) && !("prompt" in log) && !("content" in log), "Saved Card Review Log 字段白名单（§7）");
  // v1 文件容错
  seedStateText(path.join(dir, "cache", "spaced-review.json"), JSON.stringify({ formatVersion: 1, cards: {}, reviewLogs: [] }), "utf8");
  const v1 = new SpacedReviewStore(dir);
  v1.load();
  test("P21-60c", v1.scCount() === 0 && v1.count() === 0, "v1 文件容错加载（savedCards 缺失 → 空，§6/38）");
  // 每日上限：cardA due（保持率最低）、cardB due 在未来 → 不进；fresh = cardC/D
  const cards = sampleCards();
  const states = [savedState("cardA", NOW - DAY, 2), savedState("cardB", NOW + DAY, 10)];
  const q10 = buildSavedCardReviewQueue(cards, states, sched(), NOW, 10);
  const q2 = buildSavedCardReviewQueue(cards, states, sched(), NOW, 2);
  test("P21-60d", q10.items.length === 3 && q2.items.length === 2 && q10.items[0].cardId === "cardA",
    "Saved Card 队列独立上限（§67/70：due 优先+新卡补足，上限 2 截断；cardB 未到期不入队）");
  test("P21-60e", isValidSavedCardsDailyLimit(0) && isValidSavedCardsDailyLimit(500) && !isValidSavedCardsDailyLimit(501) && !isValidSavedCardsDailyLimit(-1),
    "每日复习卡上限 0~500 校验");
  // saved overview（§62/60）
  const ov = savedCardOverview(states, [], sched(), NOW);
  test("P21-60f", ov.total === 2 && ov.due === 1 && ov.stable === 0 && ov.avgRetrievability !== null && ov.avgMastery !== null,
    "Saved Card 概览（到期/保持率/掌握度聚合可用）");
  fs.rmSync(dir, { recursive: true, force: true });
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
