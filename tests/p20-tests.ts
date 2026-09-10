/**
 * Phase 20 自动测试（Review Center 2.0：Refresh / FSRS / Scope / Mastery / 原文摘录 / 持久化）。
 * 不能实测 Obsidian 运行时的部分（§101-105/142-168 的 UI/AI 类）在最终报告标 NOT TESTED。
 * 本文件只依赖 Node 可跑的纯模块（spacedReview / reviewCenter / reviewAnswer / activity / migrations / ts-fsrs）。
 */
import { mkdtemp, stateExists, readStateText, seedStateText, stateList } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  SpacedReviewStore, FsrsScheduler, schedulerFromConfig, schedulerConfigFingerprint, reviewScopeFingerprint,
  queueKeyFor, selectDueCards, selectNewCardsFromRanked, mergeQueueForRefresh, defaultReviewScope,
  scopeNotesPaths, clampCustomFolders, CUSTOM_SCOPE_FOLDER_LIMIT,
  parseLearningSteps, isValidDesiredRetention, isValidMaxIntervalDays, isValidDailyNewCards, isValidMaxReviewsPerDay,
  nextMasteryPercent, masteryConfidence, masteryDistribution, computeSpacedStats, reviewBandOf, canonicalScope,
  FSRS_RATING_SCORE, type SpacedReviewCard, type StoredFsrsState, type ReviewLogEntry, type DueSelection,
} from "../src/spacedReview";
import {
  ReviewCenterStore, buildReviewCandidates, rankReviewCandidates, markCompleted, markSkipped, markSnoozed,
  safeResumeIndex, sortReviewQueueForList, dailyPeriodKey, nextActiveIndex, type ReviewListMeta,
} from "../src/reviewCenter";
import { deriveAnswerFromMarkdown, stripFrontmatter, questionKeywords, ANSWER_MAX_CHARS } from "../src/reviewAnswer";
import { ActivityStore } from "../src/activity";
import type { ReviewQueue, ReviewQueueItem, ReviewScope, FsrsRating } from "../src/types";

// ActivityStore 的 800ms debounce 使用 window.setTimeout（Obsidian 环境才有）；Node 下用全局对象垫片
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

function eqSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function tmpRoot(tag: string): string {
  return mkdtemp(path.join(os.tmpdir(), "kg-p20-" + tag + "-"));
}

const DAY = 86400000;
const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();  // 本地正午（bucket 判定稳定）

const CFG = { desiredRetention: 0.9, maxIntervalDays: 3650, learningSteps: "10m,1h", relearningSteps: "10m" };
function sched(): FsrsScheduler { return schedulerFromConfig(CFG); }

function reviewCardOf(res: { next: StoredFsrsState }): StoredFsrsState {
  return res.next;
}

/** 造一张处于 Review 态、有历史复习的卡（学习步骤走完） */
function makeGraduated(s: FsrsScheduler, start: number): SpacedReviewCard {
  const t0 = start;
  const r1 = s.schedule("good", null, t0);
  const t1 = r1.next.due;
  const r2 = s.schedule("good", r1.next, t1 + 60000);
  const t2 = r2.next.due;
  const r3 = s.schedule("good", r2.next, t2 + 60000);
  return {
    path: "p.md",
    fsrsState: r3.next,
    lastRating: "good",
    reviewCount: 3,
    lastReviewedAt: t2 + 60000,
    masteryPercent: 75,
    createdAt: t0,
    updatedAt: t2 + 60000,
  };
}

/* ============ P20-01/02：Refresh 保留已完成进度（mergeQueueForRefresh） ============ */
{
  const prevItems: { path: string; status: string; completedAt?: number }[] = [
    { path: "A.md", status: "completed", completedAt: 1 },
    { path: "B.md", status: "completed", completedAt: 2 },
    { path: "C.md", status: "pending" },
    { path: "D.md", status: "pending" },
  ];
  const fresh: ReviewQueueItem[] = [
    { path: "C.md", stateAtSelection: "active", priorityScore: 1, status: "pending", selectedAt: NOW },
    { path: "D.md", stateAtSelection: "active", priorityScore: 1, status: "pending", selectedAt: NOW },
    { path: "E.md", stateAtSelection: "forgotten", priorityScore: 2, status: "pending", selectedAt: NOW, dueAt: NOW - DAY },
  ];
  const merged = mergeQueueForRefresh(fresh, prevItems, new Set());
  const active = merged.filter((i) => i.status === "pending" || i.status === "reviewing");
  const kept = merged.filter((i) => i.status === "completed");
  test("P20-01", active.length === 3 && active[0].path === "C.md" && kept.length === 2,
    "刷新：C/D/E 待复习、A/B 已完成状态保留 → 不回到第 1 张");
  const donePaths = merged.filter((i) => i.status === "completed").map((i) => i.path).sort();
  test("P20-02", donePaths.join(",") === "A.md,B.md" && active[0].path === "C.md",
    "已完成 2 张后刷新，仍从第 3 张（C）开始（completed 保留于尾部，进度不重置）");
}
// 学习步骤/重学再到期 → 重新入队
{
  const prevItems: { path: string; status: string; completedAt?: number }[] = [
    { path: "L.md", status: "completed", completedAt: 1 },
  ];
  const fresh: ReviewQueueItem[] = [
    { path: "L.md", stateAtSelection: "active", priorityScore: 1, status: "pending", selectedAt: NOW, dueAt: NOW - 1000 },
  ];
  const merged = mergeQueueForRefresh(fresh, prevItems, new Set(["L.md"]));
  test("P20-01b", merged.length === 1 && (merged[0].status === "pending" || merged[0].status === "reviewing"),
    "学习步骤再到期（relearnPaths）→ completed 重新入队（FSRS 学习语义）");
}

/* ============ P20-03/04/05：自动答案 = 真实原文摘录（0 AI 纯函数） ============ */
{
  const front = "---\ntitle: 游戏框架\ntags: [游戏]\n---\n";
  const body = [
    "## 为什么要划分模块边界",
    "模块边界是为了把变化隔离在单一区域内：每个模块只对接口负责，内部实现可以独立演进，",
    "外部依赖方不会因为内部重构而被破坏。清晰的边界还能让团队并行开发不同模块而互不干扰，",
    "并且使故障影响面可控——边界是系统的结构性防火墙。",
  ].join("\n");
  const src = front + body + "\n";
  const q = "为什么要划分模块边界？";
  const ans = deriveAnswerFromMarkdown(src, q);
  test("P20-03", ans.found && ans.heading === "为什么要划分模块边界", "答案默认来自真实笔记且定位到对应标题（deriveAnswerFromMarkdown）");
  test("P20-04", ans.excerpt.includes("模块边界是为了"), "摘录命中原文段落");
  test("P20-05", ans.found && ans.excerpt.length <= ANSWER_MAX_CHARS && src.includes(ans.excerpt.replace(/^…|…$/g, "")),
    "答案文本是原文子串（不编造），长度受控 ≤ " + ANSWER_MAX_CHARS);
  const noBody = deriveAnswerFromMarkdown(front + "\n", q);
  test("P20-05b", !noBody.found && noBody.excerpt === "", "无正文 → found=false（UI 显示 [[笔记]] 链接，绝不编造）");
  const shortNote = deriveAnswerFromMarkdown("短笔记一句话。", undefined);
  test("P20-05c", shortNote.found && shortNote.excerpt.includes("短笔记"), "短笔记如实返回原文（证据完整优先）");
}

/* ============ P20-06..09：Scope 过滤（纯 NoteIndex 元数据，0 AI） ============ */
{
  const notes = [
    { path: "01 盒子/游戏/游戏框架.md", folder: "01 盒子", tags: ["游戏"] },
    { path: "01 盒子/游戏/系统边界.md", folder: "01 盒子", tags: ["游戏"] },
    { path: "01 盒子/其他.md", folder: "01 盒子", tags: [] },
    { path: "02 资料/调研.md", folder: "02 资料", tags: ["资料"] },
    { path: "根笔记.md", folder: "", tags: [] },
  ];
  const cur: ReviewScope = { mode: "current-note", notePath: "01 盒子/游戏/游戏框架.md" };
  const curPaths = scopeNotesPaths(notes, cur);
  test("P20-06", curPaths.length === 1 && curPaths[0] === "01 盒子/游戏/游戏框架.md", "current-note：队列只含该来源（§22）");

  const folder: ReviewScope = { mode: "folder", folderPath: "01 盒子/游戏" };
  const folderPaths = scopeNotesPaths(notes, folder);
  test("P20-07", eqSet(folderPaths, ["01 盒子/游戏/游戏框架.md", "01 盒子/游戏/系统边界.md"]),
    "folder：不含文件夹外笔记（§23，递归子目录）");

  const area: ReviewScope = { mode: "area", areaId: "a1", folderPath: "01 盒子" };
  const areaPaths = scopeNotesPaths(notes, area);
  test("P20-08", areaPaths.length === 3 && areaPaths.every((p) => p.startsWith("01 盒子/")),
    "area：只含 KnowledgeArea.folder 范围（§24）");

  const custom: ReviewScope = { mode: "custom", folders: ["01 盒子/游戏", "02 资料"] };
  const customPaths = scopeNotesPaths(notes, custom);
  test("P20-09", eqSet(customPaths, ["01 盒子/游戏/游戏框架.md", "01 盒子/游戏/系统边界.md", "02 资料/调研.md"]),
    "custom：多文件夹只含这些来源（§25）");

  const customTag: ReviewScope = { mode: "custom", folders: ["01 盒子"], tags: ["游戏"] };
  const tagPaths = scopeNotesPaths(notes, customTag);
  test("P20-09b", tagPaths.length === 2 && tagPaths.every((p) => p.startsWith("01 盒子/游戏/")), "custom+tags：标签过滤生效");
  const many = Array.from({ length: 13 }, (_, i) => "f" + i);
  test("P20-09c", clampCustomFolders(many).length === CUSTOM_SCOPE_FOLDER_LIMIT, "custom：文件夹最多 10 个（§25）");
}

/* ============ P20-10：Scope 持久化（review-session 恢复 scope / currentPath） ============ */
{
  const dir = tmpRoot("scope");
  const store = new ReviewCenterStore(dir);
  store.load();
  const q: ReviewQueue = {
    periodKey: "daily:2026-01-15", createdAt: NOW,
    items: [
      { path: "01 盒子/游戏/游戏框架.md", stateAtSelection: "forgotten", priorityScore: 5, status: "reviewing", selectedAt: NOW, dueAt: NOW - DAY },
      { path: "01 盒子/游戏/系统边界.md", stateAtSelection: "forgotten", priorityScore: 4, status: "pending", selectedAt: NOW },
    ],
    completedCount: 0, skippedCount: 0,
    scope: { mode: "folder", folderPath: "01 盒子/游戏" }, key: "daily:2026-01-15#s1#f1", source: "spaced",
  };
  store.setQueue(q);
  store.setSession({
    periodKey: q.periodKey, currentIndex: 0, queueKey: q.key as string, updatedAt: NOW,
    scope: { mode: "folder", folderPath: "01 盒子/游戏" }, currentPath: "01 盒子/游戏/系统边界.md",
  });
  const store2 = new ReviewCenterStore(dir);
  store2.load();
  const sess = store2.getSession();
  test("P20-10", !!sess && sess.scope?.mode === "folder" && (sess.scope as ReviewScope).folderPath === "01 盒子/游戏"
    && sess.currentPath === "01 盒子/游戏/系统边界.md" && sess.queueKey === q.key,
    "关闭再打开：scope / currentPath / queueKey 恢复（§97）");
  const resumed = safeResumeIndex(sess, q);
  test("P20-10b", resumed === 1 && q.items[resumed].path === "01 盒子/游戏/系统边界.md",
    "currentPath 优先 → 刷新重排后仍回到同一张卡（§34）");
  const other = { ...q, key: "daily:2026-01-15#s2#f1" };
  test("P20-10c", safeResumeIndex(sess, other) === 0, "不同 scope/config 指纹 → 不复用旧 session（§31/38）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P20-11..17：FSRS 调度 ============ */
{
  const s = sched();
  const firstGood = s.schedule("good", null, NOW);
  test("P20-11", firstGood.next.due > NOW && Math.abs(firstGood.next.due - (NOW + DAY)) > 30 * 60000,
    "新卡第一次 Good → FSRS 真实 due（非固定 1 天；此处为学习步骤，距 1 天差 >30 分钟）");
  const four = new Map<FsrsRating, number>();
  for (const r of ["again", "hard", "good", "easy"] as FsrsRating[]) {
    four.set(r, s.schedule(r, null, NOW).next.due);
  }
  test("P20-12", (four.get("again") as number) > NOW, "Again：生成 due");
  test("P20-13", (four.get("hard") as number) > NOW, "Hard：生成 due");
  test("P20-14", (four.get("good") as number) > NOW, "Good：生成 due");
  test("P20-15", (four.get("easy") as number) > NOW, "Easy：生成 due");
  test("P20-12b", new Set(four.values()).size === 4, "四种 Rating 产生四种不同 due（非固定 1 天）");
  test("P20-12c", (four.get("again") as number) < (four.get("good") as number)
    && (four.get("easy") as number) > (four.get("good") as number), "新卡档位：again 明显提前、easy 明显推后");

  const graduate = makeGraduated(s, NOW - 40 * DAY);
  const goodDue = s.schedule("good", graduate.fsrsState, NOW + DAY).next.due;
  const easyDue = s.schedule("easy", graduate.fsrsState, NOW + DAY).next.due;
  const againRes = s.schedule("again", graduate.fsrsState, NOW + DAY);
  test("P20-16", easyDue > goodDue && againRes.next.due < goodDue,
    "Review 态：Easy 后 due 晚于 Good；Again 后 due 明显提前（真实 FSRS）");

  const r0 = s.retrievability(graduate.fsrsState, NOW) as number;
  const r10 = s.retrievability(graduate.fsrsState, NOW + 10 * DAY) as number;
  const r30 = s.retrievability(graduate.fsrsState, NOW + 30 * DAY) as number;
  test("P20-17", r0 > r10 && r10 > r30, "retrievability 随时间单调下降（" + r0.toFixed(3) + "→" + r10.toFixed(3) + "→" + r30.toFixed(3) + "）");

  const againLog = againRes.log;
  const logKeys = ["timestamp", "rating", "previousDue", "nextDue", "intervalDays", "stability", "difficulty", "retrievability"];
  test("P20-17b", logKeys.every((k) => k in againLog) && !("apiKey" in againLog) && !("prompt" in againLog) && !("content" in againLog) && !("noteBody" in againLog),
    "Review Log 字段白名单（§8：绝不记录 API Key / Prompt / 全文）");
}

/* ============ P20-18/19：Due 选择（保持率升序 + 每日上限） ============ */
{
  const s = sched();
  const cards = [
    { path: "S2.md", fsrsState: { due: NOW - DAY, stability: 2, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
    { path: "S10.md", fsrsState: { due: NOW - DAY, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
    { path: "S60.md", fsrsState: { due: NOW - DAY, stability: 60, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
  ];
  const retr = new Map(cards.map((c) => [c.path, s.retrievability(c.fsrsState as StoredFsrsState, NOW) as number]));
  const sorted = selectDueCards(cards, s, NOW, 10, true, true);
  test("P20-18", sorted[0].path === "S2.md" && (retr.get("S2.md") as number) < (retr.get("S10.md") as number)
    && (retr.get("S10.md") as number) < (retr.get("S60.md") as number),
    "最可能忘记（保持率最低）的卡排最前（" + retr.get("S2.md")?.toFixed(2) + " < " + retr.get("S10.md")?.toFixed(2) + " < " + retr.get("S60.md")?.toFixed(2) + "）");
  const capped = selectDueCards(cards, s, NOW, 2, true, true);
  test("P20-19", capped.length === 2 && capped[0].path === "S2.md", "每日最大复习：超过上限截断（limit=2 → 2 张）");
  // overdueFirst：逾期 bucket 优先于今日到期（即使今日到期保持率更低）
  const cards2 = [
    { path: "overdue.md", fsrsState: { due: NOW - 5 * DAY, stability: 60, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
    { path: "today.md", fsrsState: { due: NOW - 3600000, stability: 2, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
  ];
  const ofFirst = selectDueCards(cards2, s, NOW, 10, true, true);
  const offFirst = selectDueCards(cards2, s, NOW, 10, false, true);
  test("P20-18b", ofFirst[0].path === "overdue.md" && offFirst[0].path === "today.md",
    "overdueFirst=ON：逾期优先；OFF：今日到期优先（§72）");
}

/* ============ P20-20：每日新卡上限 ============ */
{
  const ranked = Array.from({ length: 6 }, (_, i) => ({ path: "n" + i + ".md", priorityScore: 10 - i, state: "new" as const }));
  const sel = selectNewCardsFromRanked(ranked, () => false, new Set(), new Set(), 3);
  test("P20-20", sel.length === 3 && sel[0].path === "n0.md", "超过每日新卡上限截断（limit=3 → 3 张）");
  const sel2 = selectNewCardsFromRanked(ranked, (p) => p === "n0.md", new Set(["n1.md"]), new Set(["n2.md"]), 10);
  test("P20-20b", sel2.length === 3 && sel2.every((x) => !["n0.md", "n1.md", "n2.md"].includes(x.path)),
    "新卡排除：已有 FSRS 卡 / 已选 due / snooze 未到期");
}

/* ============ P20-21..25：Skip / Snooze / Refresh / Rating 对 FSRS+Activity 的影响 ============ */
{
  const dir = tmpRoot("neutral");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  const rc = new ReviewCenterStore(dir);
  rc.load();
  const activity = new ActivityStore(dir);
  activity.load();

  const s = sched();
  const cardA = makeGraduated(s, NOW - 40 * DAY);
  cardA.path = "A.md";
  spaced.commitReview("A.md", cardA, { timestamp: NOW, rating: "good", previousDue: NOW - DAY, nextDue: NOW + DAY, intervalDays: 1, stability: 10, difficulty: 5, retrievability: 0.9 });
  const fileBefore = readStateText(path.join(dir, "cache", "spaced-review.json"));

  const q: ReviewQueue = {
    periodKey: "daily:2026-01-15", createdAt: NOW,
    items: [{ path: "A.md", stateAtSelection: "forgotten", priorityScore: 5, status: "reviewing", selectedAt: NOW, dueAt: cardA.fsrsState.due }],
    completedCount: 0, skippedCount: 0, scope: defaultReviewScope(), key: "daily:2026-01-15#v#f", source: "spaced",
  };
  const freshQueue = (): ReviewQueue => JSON.parse(JSON.stringify(q)) as ReviewQueue;
  // Skip：只改 queue（markSkipped），spaced 文件不变（P20-21/24）
  rc.setQueue(markSkipped(freshQueue(), "A.md"));
  test("P20-21", readStateText(path.join(dir, "cache", "spaced-review.json")) === fileBefore
    && spaced.count() === 1 && spaced.get("A.md")?.fsrsState.due === cardA.fsrsState.due,
    "Skip：不调用 FSRS、不改 stability/difficulty/due（§10/21）");
  test("P20-24", activity.get("A.md")?.reviewCount === undefined, "Skip：reviewCount 不变（§24）");
  // Snooze：只改 queue（markSnoozed），spaced 文件不变（P20-22）
  rc.setQueue(markSnoozed(freshQueue(), "A.md", NOW + 3 * DAY));
  test("P20-22", readStateText(path.join(dir, "cache", "spaced-review.json")) === fileBefore
    && (rc.getQueue()?.items.find((i) => i.path === "A.md")?.snoozedUntil as number) > NOW,
    "Snooze：不调用 FSRS，只改 session/queue（§11/22）");
  // Rating（FSRS）→ 只有真正评分才更新 FSRS + Activity.reviewCount+1（P20-23）
  const res = s.schedule("good", spaced.get("A.md")?.fsrsState ?? null, NOW + DAY);
  const nextCard: SpacedReviewCard = {
    path: "A.md", fsrsState: res.next, lastRating: "good",
    reviewCount: (spaced.get("A.md")?.reviewCount ?? 0) + 1,
    lastReviewedAt: NOW + DAY,
    masteryPercent: nextMasteryPercent(spaced.get("A.md")?.masteryPercent, spaced.get("A.md")?.reviewCount ?? 0, "good"),
    createdAt: cardA.createdAt, updatedAt: NOW + DAY,
  };
  spaced.commitReview("A.md", nextCard, { ...res.log, path: "A.md" });
  activity.markReviewed("A.md");
  test("P20-23", spaced.get("A.md")?.reviewCount === 4 && activity.get("A.md")?.reviewCount === 1,
    "FSRS rating → FSRS 卡 reviewCount+1 且 activity.reviewCount+1（§23）");
  // Refresh（重算队列）= 只写 review-queue；spaced 文件与 activity 不变（P20-25）
  const fileAfterRating = readStateText(path.join(dir, "cache", "spaced-review.json"));
  const activityAfter = activity.get("A.md")?.reviewCount;
  rc.setQueue(freshQueue());
  test("P20-25", readStateText(path.join(dir, "cache", "spaced-review.json")) === fileAfterRating
    && activity.get("A.md")?.reviewCount === activityAfter && spaced.logsAll().length === 2,
    "Refresh：不改 FSRS、不加 review log、不改 reviewCount（§25/35）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P20-26..30：掌握度（历史表现）≠ 保持率（FSRS） ============ */
{
  const m1 = nextMasteryPercent(80, 5, "again");
  const m2 = nextMasteryPercent(20, 5, "easy");
  test("P20-26", m1 < 80 && m2 > 20, "Again → 掌握度下降；Easy → 掌握度上升（" + m1 + " < 80；" + m2 + " > 20）");
  test("P20-27", masteryConfidence(2).low && masteryConfidence(2).hint === "数据较少" && !masteryConfidence(5).low,
    "reviewCount<3 → 数据较少；≥3 → 不显示（§57）");
  // 第一次评分 = 该档分数；加权平均保留历史稳定表现
  test("P20-26b", nextMasteryPercent(undefined, 0, "good") === FSRS_RATING_SCORE.good, "首次评分直接采用对应档位分数");

  // 手工卡：高稳定性 → 30 天未复习仍高保持率；掌握度 = 历史评分（独立指标）
  const mkCard = (path: string, mastery: number, stability: number): SpacedReviewCard => ({
    path,
    fsrsState: {
      due: NOW + 5 * DAY, stability, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 30 * DAY,
    },
    lastRating: "good", reviewCount: 3, lastReviewedAt: NOW - 30 * DAY, masteryPercent: mastery,
    createdAt: NOW - 100 * DAY, updatedAt: NOW - 30 * DAY,
  });
  const s = sched();
  const card = mkCard("a.md", 7, 60);
  const retrNow = s.retrievability(card.fsrsState, NOW) as number;
  test("P20-30", Math.abs(card.masteryPercent as number - Math.round(retrNow * 100)) > 30,
    "掌握度(7) 与当前保持率(" + Math.round(retrNow * 100) + "%) 显著分离：两指标独立存储/展示（§55/130）");
  const dist = masteryDistribution([
    mkCard("r.md", 25, 2), mkCard("b.md", 45, 2), mkCard("ba.md", 70, 2),
    mkCard("p.md", 90, 2), mkCard("m.md", 98, 2), {},
  ]);
  test("P20-28", dist.relearn === 1 && dist.building === 1 && dist.basic === 1 && dist.proficient === 1 && dist.mastered === 1,
    "掌握分布条：五档计数正确（§60 边界与 examEngine 一致）");
  const stats = computeSpacedStats([card, mkCard("x.md", 90, 60)], [], s, NOW);
  test("P20-29", stats.avgRetrievability !== null && stats.avgMastery !== null && stats.cardCount === 2 && stats.dueCount === 0,
    "今日保持率/掌握度聚合可用（§29/100）");
  test("P20-29b", reviewBandOf(39) === "relearn" && reviewBandOf(40) === "building" && reviewBandOf(79) === "basic"
    && reviewBandOf(80) === "proficient" && reviewBandOf(95) === "mastered",
    "掌握带边界 = 0-39/40-59/60-79/80-94/95-100（与 examEngine.masteryLabel 同界，无第二套阈值）");
}

/* ============ P20-31..34：设置校验 ============ */
{
  test("P20-31", isValidDesiredRetention(0.9) && schedulerConfigFingerprint(CFG).length > 0, "desiredRetention=0.9 合法");
  test("P20-32", !isValidDesiredRetention(0.69) && !isValidDesiredRetention(0.98) && isValidDesiredRetention(0.7) && isValidDesiredRetention(0.97),
    "0.69 / 0.98 拒绝；0.7 / 0.97 接受");
  test("P20-33", isValidMaxIntervalDays(30) && isValidMaxIntervalDays(36500) && !isValidMaxIntervalDays(29) && !isValidMaxIntervalDays(36501),
    "最大间隔 30~36500 校验");
  test("P20-34a", parseLearningSteps("10m,1h")?.join(",") === "10m,1h", "学习步骤合法格式接受");
  test("P20-34b", parseLearningSteps("0") === null && parseLearningSteps("") === null && parseLearningSteps(" ") === null
    && parseLearningSteps("-5m") === null && parseLearningSteps("1x") === null,
    "学习步骤拒绝 0 / 空 / 负数 / 非法单位");
  test("P20-34c", isValidDailyNewCards(0) && isValidDailyNewCards(100) && !isValidDailyNewCards(101) && !isValidDailyNewCards(-1),
    "每日新卡 0~100");
  test("P20-34d", isValidMaxReviewsPerDay(1) && isValidMaxReviewsPerDay(500) && !isValidMaxReviewsPerDay(0) && !isValidMaxReviewsPerDay(501),
    "每日最大复习 1~500");
}

/* ============ P20-35：旧 cache（legacy review-queue.json）加载 ============ */
{
  const dir = tmpRoot("legacy");
  seedStateText(path.join(dir, "cache", "review-queue.json"), JSON.stringify({
    queue: {
      periodKey: "daily:2026-01-15", createdAt: NOW,
      items: [
        { path: "旧笔记.md", stateAtSelection: "forgotten", priorityScore: 5, status: "reviewing", selectedAt: NOW },
        { path: "旧笔记2.md", stateAtSelection: "new", priorityScore: 3, status: "pending", selectedAt: NOW },
      ],
      completedCount: 0, skippedCount: 0,
    },
    skipHistory: { "旧笔记.md": { consecutive: 2, lastSkippedDate: "2026-01-14" } },
  }), "utf8");
  const rc = new ReviewCenterStore(dir);
  const isolated = rc.load();
  const q = rc.getQueue();
  test("P20-35", !isolated && q !== null && q.items.length === 2 && q.periodKey === "daily:2026-01-15" && rc.getSkipHistory()["旧笔记.md"]?.consecutive === 2,
    "旧 cache（无 key/scope/source 字段）正常加载，不删除旧 Review Queue（§14）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P20-36/37：损坏隔离 + 原子写 ============ */
{
  const dir = tmpRoot("corrupt");
  seedStateText(path.join(dir, "cache", "spaced-review.json"), "{ not json !!");
  const spaced = new SpacedReviewStore(dir);
  const isolated = spaced.load();
  // Phase 24 §十二：损坏隔离不再是 *.corrupt-* 文件，而是 cache/.corrupt/ 目录里的副本
  const corruptFiles = (stateList(path.join(dir, "cache", ".corrupt")));
  test("P20-36", isolated && corruptFiles.length === 1 && spaced.count() === 0 && spaced.logsAll().length === 0,
    "损坏文件隔离到 cache/.corrupt/（保留副本），恢复空状态（§12/§36）");
  const s = sched();
  const card = makeGraduated(s, NOW);
  spaced.commitReview("A.md", { ...card, path: "A.md" }, { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 10, difficulty: 5, retrievability: 0.9 });
  const files = stateList(path.join(dir, "cache"));
  test("P20-37", files.includes("spaced-review.json") && !files.some((f) => f.endsWith(".tmp")),
    "原子写：无 .tmp 残留（§37）");
  const reload = new SpacedReviewStore(dir);
  reload.load();
  test("P20-37b", reload.count() === 1 && reload.logsAll().length === 1 && reload.get("A.md")?.fsrsState.due === card.fsrsState.due,
    "重启恢复：卡 + 日志完整");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ P20-38/39：Scope / FSRS Config 指纹 → queue key ============ */
{
  const sA: ReviewScope = { mode: "folder", folderPath: "01 盒子" };
  const sB: ReviewScope = { mode: "folder", folderPath: "02 资料" };
  const sC: ReviewScope = { mode: "custom", folders: ["x", "b"], tags: ["t"] };
  const sD: ReviewScope = { mode: "custom", folders: ["b", "x"], tags: ["t"] };
  test("P20-38", reviewScopeFingerprint(sA) !== reviewScopeFingerprint(sB) && reviewScopeFingerprint(sC) === reviewScopeFingerprint(sD)
    && canonicalScope(sC) === canonicalScope(sD),
    "Scope 指纹：不同范围不同 key；同范围（排序无关）相同（§29/38）");
  const f1 = schedulerConfigFingerprint({ ...CFG });
  const f2 = schedulerConfigFingerprint({ ...CFG, desiredRetention: 0.85 });
  test("P20-39", f1 !== f2 && queueKeyFor("daily:2026-01-15", sA, f1) !== queueKeyFor("daily:2026-01-15", sA, f2)
    && queueKeyFor("daily:2026-01-15", sA, f1) === queueKeyFor("daily:2026-01-15", sA, f1),
    "desiredRetention 变化 → 新 scheduler config 指纹 → 新队列键（§30/39）");
  const diffScope = queueKeyFor("daily:2026-01-15", sA, f1) !== queueKeyFor("daily:2026-01-15", sB, f1);
  test("P20-38b", diffScope, "Scope 变化 → queue key 变化（不沿用旧 queue，§31）");
}

/* ============ P20-40：FSRS 调度 0 AI ============ */
{
  const s = sched();
  const r = s.schedule("good", null, NOW);
  const pure = r.next.due > NOW;
  test("P20-40", pure && !("ai" in r) && !("prompt" in r), "FSRS 调度为本地纯计算（ts-fsrs，无 AI 字段/调用）");
}

/* ============ 回归：legacy 候选排序逻辑未被 rank 重构破坏 ============ */
{
  const notes = [
    { path: "A.md", title: "A", folder: "f", tags: [], links: [], backlinks: [], created: NOW - 100 * DAY, modified: NOW - 100 * DAY, size: 100, wordCount: 200 },
    { path: "B.md", title: "B", folder: "f", tags: [], links: [], backlinks: [], created: NOW - 5 * DAY, modified: NOW - 2 * DAY, size: 100, wordCount: 200 },
  ];
  const acts: Record<string, { lastReviewedAt: number }> = { "A.md": { lastReviewedAt: NOW - 40 * DAY } };
  const cfg = { queueSize: 5, autoQueue: true, aiQuestion: true, maxQuestions: 5, skipPenalty: true, autoOpenReview: false, showAnswerByDefault: true };
  const rules = { newDays: 7, staleDays: 14, forgottenDays: 30, recentLimit: 8 };
  const ranked = rankReviewCandidates(notes as never, (p) => acts[p], [], cfg as never, rules as never, {}, NOW);
  const cands = buildReviewCandidates(notes as never, (p) => acts[p], [], cfg as never, rules as never, {}, NOW);
  const sorted = [...ranked].sort((a, b) => b.priorityScore - a.priorityScore);
  test("P20-45", ranked.length === 2 && ranked[0].path === sorted[0].path && cands.length === 2 && cands[0].path === ranked[0].path,
    "回归：buildReviewCandidates 顺序与 rankReviewCandidates 一致（重构无行为变化）");
}

/* ============ 列表排序（§61：默认最可能忘记） ============ */
{
  const mkItem = (path: string, status: ReviewQueueItem["status"]): ReviewQueueItem => ({
    path, stateAtSelection: "active", priorityScore: 1, status, selectedAt: NOW,
  });
  const meta: Record<string, ReviewListMeta> = {
    "low.md": { due: NOW + DAY, retrievability: 0.4, mastery: 30, lastReviewedAt: NOW - 2 * DAY },
    "high.md": { due: NOW + 2 * DAY, retrievability: 0.95, mastery: 90, lastReviewedAt: NOW - 9 * DAY },
    "mid.md": { due: NOW + DAY, retrievability: 0.7, mastery: 60, lastReviewedAt: NOW - 5 * DAY },
    "done.md": { due: NOW - DAY, retrievability: 0.1, mastery: 100, lastReviewedAt: NOW },
  };
  const items = [mkItem("low.md", "pending"), mkItem("high.md", "pending"), mkItem("done.md", "completed"), mkItem("mid.md", "pending")];
  const byForget = sortReviewQueueForList(items, "forget", (p) => meta[p]);
  test("P20-46", byForget[0].path === "low.md" && byForget[byForget.length - 1].path === "done.md",
    "列表排序：默认「最可能忘记」→ 待复习按保持率升序，已完成沉底（§61）");
  const byNext = sortReviewQueueForList(items, "next", (p) => meta[p]);
  test("P20-46b", byNext[0].path === "low.md" || byNext[0].path === "mid.md", "按下次复习排序可用");
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
