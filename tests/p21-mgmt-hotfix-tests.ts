/**
 * Phase 21.x 自动测试（P-HF-NEW-* / P-HF-DELETE-*）：「我的复习卡」管理增强——
 * 删除卡后端语义、新卡定义、🌱新卡优先排序、推荐权重(savedCardNewWeight 默认 30)、统计/分布边界。
 * UI（确认框出现、点击流、review 删卡进下一张等）在最终报告标 NOT TESTED。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacedReviewStore, type SavedCardSpacedState, type StoredFsrsState } from "../src/spacedReview";
import {
  isNewSavedCard, rankSavedCards, recommendSavedCardScore, isValidSavedCardNewWeight, savedCardOverview,
  type SavedCardSortMeta,
} from "../src/spacedReview";
import { ReviewCardStore, CardReviewStore, ExamStore } from "../src/examStore";
import { DEFAULT_SETTINGS } from "../src/types";
import type { NoteExam, SavedReviewCard } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
const DAY = 86400000;
const NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();

function baseCard(id: string, createdAt: number): SavedReviewCard {
  return { id, sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", question: "题 " + id, answer: "答", questionType: "recall", createdAt, updatedAt: createdAt };
}
function oldState(id: string, opts: { retr?: number; due?: number; mastery?: number; reviewCount?: number; lastReviewedAt?: number; createdAt?: number } = {}): SavedCardSpacedState {
  // 构造 retr 近似目标：稳定性越大 → 保持率越高（同 elapsed）
  const retr = opts.retr ?? 0.9;
  const stability = Math.max(1, 60 * (1 - retr) + 1);   // retr 0.9→~7；0.1→~55
  return {
    cardId: id,
    fsrsState: { due: opts.due ?? NOW + 3 * DAY, stability, difficulty: 5, reps: opts.reviewCount ?? 1, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 40 * DAY },
    lastRating: "good",
    reviewCount: opts.reviewCount ?? 1,
    lastReviewedAt: opts.lastReviewedAt,
    masteryPercent: opts.mastery,
    createdAt: opts.createdAt ?? NOW - 30 * DAY,
    updatedAt: NOW - 30 * DAY,
  };
}
function metaOf(m: Partial<SavedCardSortMeta> & { retrievability: number | null }): SavedCardSortMeta {
  return { due: m.due, retrievability: m.retrievability, mastery: m.mastery, lastReviewedAt: m.lastReviewedAt };
}

/* ============ 新卡定义（§15/16） ============ */
{
  const st0 = oldState("B", { reviewCount: 0 });
  const st1 = oldState("C", { reviewCount: 1 });
  test("P-HF-NEW-08", isNewSavedCard(st0) === true, "有 state 但 reviewCount=0 → 仍为新卡（§16/40）");
  test("P-HF-NEW-09", isNewSavedCard(st1) === false, "reviewCount=1 → 不是新卡（§41）");
  test("P-HF-NEW-09b", isNewSavedCard(null) === true && isNewSavedCard(undefined) === true,
    "无 FSRS state → 新卡（从未真实 FSRS Rating，§15；旧 reviewCount 不作数）");
  test("P-HF-NEW-12a", DEFAULT_SETTINGS.spacedReview.savedCardNewWeight === 30,
    "savedCardNewWeight 默认 30（mergeSettings 会为旧 data.json 自动补默认，§63）");
}

/* ============ 🌱 新卡优先排序（§14/17/18/34/35） ============ */
{
  const cards = [baseCard("A", NOW - 100 * DAY), baseCard("B", NOW - 50 * DAY)];
  const stateOf = (id: string) => (id === "B" ? oldState("B", { reviewCount: 1 }) : null);
  const metaOf = (id: string): SavedCardSortMeta => {
    const st = stateOf(id);
    return { due: st ? st.fsrsState.due : undefined, retrievability: st ? 0.9 : null, mastery: st ? 50 : undefined, lastReviewedAt: st?.lastReviewedAt };
  };
  const orderNew = rankSavedCards(cards, stateOf, metaOf, "new", 30, NOW);
  test("P-HF-NEW-01", orderNew[0] === "A" && orderNew[1] === "B", "新卡模式：A(无 state) 在 B(reviewCount=1) 之前（§33）");

  const twoNew = [baseCard("A1", NOW - 200 * DAY), baseCard("B1", NOW - 20 * DAY)];
  const orderNew2 = rankSavedCards(twoNew, () => null, () => metaOf("A"), "new", 30, NOW);
  test("P-HF-NEW-02", orderNew2[0] === "A1" && orderNew2[1] === "B1", "两张新卡 → 最早收藏在前（createdAt ASC，§34）");

  // P-HF-NEW-03：新卡模式不受 retrievability 影响（B 即使 retr 极低也在新卡后）
  const stateB = oldState("B2", { reviewCount: 1, retr: 0.1 });
  const orderNew3 = rankSavedCards([baseCard("A2", NOW - 300 * DAY), baseCard("B2", NOW - 10 * DAY)],
    (id) => (id === "B2" ? stateB : null),
    (id) => (id === "B2" ? metaOf({ retrievability: 0.1, due: NOW - DAY, mastery: 10 }) : metaOf({ retrievability: null })),
    "new", 30, NOW);
  test("P-HF-NEW-03", orderNew3[0] === "A2", "新卡模式：A(新) 优先于严重遗忘的旧卡 B（§3/35）");
}

/* ============ 推荐权重（§20~24/36~38） ============ */
{
  const metaFor = (st: SavedCardSpacedState | null): SavedCardSortMeta =>
    st ? metaOf({ retrievability: 0.9, due: st.fsrsState.due, mastery: 90, lastReviewedAt: undefined }) : metaOf({ retrievability: null });
  const stB = oldState("B", { reviewCount: 3, retr: 0.9, due: NOW + DAY, mastery: 90 });
  const cards = [baseCard("A", NOW - 50 * DAY), baseCard("B", NOW - 100 * DAY)];
  const byState = (id: string) => (id === "B" ? stB : null);
  const byMeta = (id: string) => metaFor(byState(id));

  const rec30 = rankSavedCards(cards, byState, byMeta, "recommend", 30, NOW);
  test("P-HF-NEW-04", rec30[0] === "A", "默认权重 30：A(新) 比指标接近的旧卡 B 排前（§36）");
  const rec0 = rankSavedCards(cards, byState, byMeta, "recommend", 0, NOW);
  test("P-HF-NEW-05", rec0[0] === "B" && rec0[1] === "A",
    "权重 0：新卡无 bonus → 同分以 createdAt 稳定 tie-break（B 更早，§37/71）");
  const rec100 = rankSavedCards(cards, byState, byMeta, "recommend", 100, NOW);
  test("P-HF-NEW-06", rec100[0] === "A", "权重 100：新卡明显优先（§38）");
  test("P-HF-NEW-07", !isValidSavedCardNewWeight(-1) && !isValidSavedCardNewWeight(101) && isValidSavedCardNewWeight(0) && isValidSavedCardNewWeight(100),
    "权重边界：-1/101 拒绝，0/100 接受（§39）");
  test("P-HF-NEW-10", recommendSavedCardScore(metaOf({ retrievability: null }), true, 30, NOW) === 30,
    "新卡 + mastery/retr 缺失：不崩，score=30（newBonus 生效）（§42）");
  const scoreOld = recommendSavedCardScore(metaOf({ retrievability: 0.9, mastery: 90, due: NOW + DAY }), false, 30, NOW);
  const scoreNew = recommendSavedCardScore(metaOf({ retrievability: null }), true, 30, NOW);
  test("P-HF-NEW-11", Number.isFinite(scoreOld) && Number.isFinite(scoreNew) && scoreNew > scoreOld,
    "retrievability null 正常参与评分（§43）");
  test("P-HF-NEW-12", rankSavedCards([baseCard("D", NOW - 5 * DAY)], () => null, () => metaOf({ retrievability: null }), "next", 30, NOW).length === 1,
    "新卡 due undefined → next 排序不崩（§44；UI 显示“首次复习”）");
}

/* ============ 删除后端语义（P-HF-DELETE-03/04/05/07/08/13/15，模拟 main.deleteCard 存储步骤） ============ */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-mgmt-"));
  const cards = new ReviewCardStore(dir); cards.load();
  const cr = new CardReviewStore(dir); cr.load();
  const exams = new ExamStore(dir); exams.load();
  const spaced = new SpacedReviewStore(dir); spaced.load();

  const exam: NoteExam = { id: "e1", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", title: "来源考试", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  exams.add(exam);
  cards.add({ ...baseCard("cardX", NOW), examId: "e1" });
  cr.add({ cardId: "cardX", reviewedAt: NOW, rating: "good" });
  spaced.scCommitReview("cardX", oldState("cardX", { reviewCount: 1, due: NOW + DAY }), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  // 模拟 main.deleteCard 的后端步骤（跳过 vault trash，§6 由 main 处理）
  cards.remove("cardX");
  spaced.scRemoveCard("cardX");
  cr.removeByCard("cardX");

  test("P-HF-DELETE-03", cards.get("cardX") === undefined && cards.count() === 0, "确认删除：卡片从 ReviewCardStore 消失（§47）");
  test("P-HF-DELETE-04", spaced.scGet("cardX") === undefined && spaced.scCount() === 0, "FSRS state 删除（scRemoveCard，§48/9）");
  test("P-HF-DELETE-05", cr.byCard("cardX").length === 0 && cr.count() === 0, "CardReviewRecord 删除（§49）");
  test("P-HF-DELETE-07", exams.get("e1") !== undefined && exams.findBySource("01 盒子/游戏/游戏框架.md").length === 1, "Exam 不受影响（§51）");
  test("P-HF-DELETE-08", exams.all()[0].sourcePath === "01 盒子/游戏/游戏框架.md", "source note 不受影响（§52）");
  test("P-HF-DELETE-13", cards.count() === 0 && cards.all().length === 0, "删除后总数 -1（新卡统计随之更新，§57/6）");
  cards.remove("cardX");   // 再次删除为 no-op（P-HF-DELETE-15 防重 + main 的 guard 语义）
  test("P-HF-DELETE-15", cards.count() === 0, "重复删除：no-op，只成功一次（§59；UI 另有 deleting 防连点）");
  // 统计：newCount 与分布分离
  const st = oldState("old1", { reviewCount: 2, mastery: 90 });
  const ov = savedCardOverview([st], [], new (class { retrievability(): number | null { return 0.9; } } as never), NOW, 5);
  test("P-HF-NEW-12b", ov.newCount === 5 && ov.total === 6 && ov.dist.proficient === 1,
    "overview：新卡单独计数且不计入掌握分布（got newCount=" + ov.newCount + ", total=" + ov.total + ", proficient=" + ov.dist.proficient + "）（§28/29/30/31）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ 0 AI + Activity（P-HF-DELETE-09/10） ============ */
{
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "main.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  const delStart = src.indexOf("async deleteCard(cardId: string): Promise<void> {");
  const delMarker = src.indexOf("已删除复习卡（0 AI）", delStart);
  const delBody = delStart >= 0 && delMarker > delStart ? src.slice(delStart, delMarker) : "";
  test("P-HF-DELETE-09", delBody.length > 0 && !/\bAI\b|generate|prompt|apiKey/.test(delBody),
    "删除后端 0 AI（deleteCard 无 AI/生成调用，§53）");
  test("P-HF-DELETE-10", !/recordAccess|markReviewed/.test(delBody),
    "删除不调用 recordAccess / markReviewed（Activity 不变，§54/10）");
  test("P-HF-DELETE-06", /trash\(/.test(delBody) && /cardMarkdownPath/.test(delBody),
    "Review Card Markdown 删除入口保留（实际 trash 在 Obsidian 运行层，§50/6）");
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
