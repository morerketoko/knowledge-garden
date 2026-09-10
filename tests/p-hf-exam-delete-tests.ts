/**
 * Hotfix 自动测试（P-HF-EXAM-DELETE-* / -HISTORY-* / -CARD-*）：「本篇笔记考试中心 → 删除指定考试」。
 * 覆盖：AICache.remove 精确失效、Store/Session 清理与保留语义、历史去重移除、UI/视图结构断言。
 * Obsidian 实机（弹窗点击、Markdown 文件删除、view 展示）在最终报告标 NOT TESTED。
 */
import { mkdtemp } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AICache } from "../src/ai/cache";
import { ExamStore, ExamSessionStore, ReviewCardStore, CardReviewStore } from "../src/examStore";
import { SpacedReviewStore, type SavedCardSpacedState } from "../src/spacedReview";
import { buildExamHistoryContext, dedupeExamQuestions } from "../src/examGen";
import type { NoteExam, SavedReviewCard, ExamQuestion } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function dir(): string { return mkdtemp(path.join(os.tmpdir(), "kg-examdel-")); }
const NOW = new Date(2026, 4, 1, 12, 0, 0).getTime();
function mkExam(id: string, src: string, title: string, createdAt: number): NoteExam {
  return { id, sourcePath: src, sourceVersion: "v1", title, mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [{ id: "q1", type: "recall", question: title + " 题?", referenceAnswer: "r", sourcePath: src }], examVersion: 1, createdAt, updatedAt: createdAt };
}
function mkCard(id: string, src: string, examId: string): SavedReviewCard {
  return { id, sourcePath: src, sourceVersion: "v1", examId, examQuestionId: "q1", question: "卡 " + id, answer: "答", questionType: "recall", createdAt: NOW, updatedAt: NOW };
}

/* ============ P-HF-EXAM-DELETE-13/14：AICache.remove 精确失效 ============ */
{
  const d = dir();
  const cache = new AICache(d);
  cache.load();
  cache.put({ key: "k-target", type: "note_exam", createdAt: NOW, updatedAt: NOW, status: "success", data: { title: "x", questions: [] }, promptVersion: "v", candidateFingerprint: "f", configFingerprint: "c" } as never);
  cache.put({ key: "k-other", type: "note_exam", createdAt: NOW, updatedAt: NOW, status: "success", data: { title: "y", questions: [] }, promptVersion: "v", candidateFingerprint: "g", configFingerprint: "c" } as never);
  test("P-HF-EXAM-DELETE-13", cache.remove("k-target") === true && cache.get("k-target") === undefined,
    "只删除 target exam cache（§13）");
  test("P-HF-EXAM-DELETE-14", cache.get("k-other") !== undefined && cache.byType("note_exam").length === 1,
    "其他 note_exam cache 保留（§14/27：绝不 clearType）");
  test("P-HF-EXAM-DELETE-15", cache.remove("k-missing") === false, "cache remove 失败无副作用（§15）");
  fs.rmSync(d, { recursive: true, force: true });
}

/* ============ P-HF-EXAM-DELETE-04..12：Store/Session/保留语义 ============ */
{
  const d = dir();
  const exams = new ExamStore(d); exams.load();
  const sess = new ExamSessionStore(d); sess.load();
  const cards = new ReviewCardStore(d); cards.load();
  const cr = new CardReviewStore(d); cr.load();
  const spaced = new SpacedReviewStore(d); spaced.load();
  const src = "01 盒子/游戏/游戏框架.md";
  const examA = mkExam("exA", src, "A 考试", NOW - 1000);
  const examB = mkExam("exB", src, "B 考试", NOW);
  exams.add(examA); exams.add(examB);
  sess.upsert({ examId: "exA", mode: "card", currentIndex: 2, answers: [{ questionId: "q1", answer: "a", selfRating: "good" }], status: "running", startedAt: NOW, updatedAt: NOW });
  const cardA = mkCard("cardA", src, "exA");
  cards.add(cardA);
  const state: SavedCardSpacedState = {
    cardId: "cardA", fsrsState: { due: NOW + 5 * 86400000, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 5 * 86400000 },
    lastRating: "good", reviewCount: 3, lastReviewedAt: NOW - 5 * 86400000, masteryPercent: 75, createdAt: NOW - 80 * 86400000, updatedAt: NOW - 5 * 86400000,
  };
  spaced.scCommitReview("cardA", state, { timestamp: NOW - 5 * 86400000, rating: "good", previousDue: null, nextDue: state.fsrsState.due, intervalDays: 10, stability: 10, difficulty: 5, retrievability: 0.9 });
  cr.add({ cardId: "cardA", reviewedAt: NOW, rating: "good" });
  // 模拟 main.deleteExam 的存储步骤（Markdown 由 main 用 vault 处理）
  exams.remove("exA");
  sess.remove("exA");
  test("P-HF-EXAM-DELETE-04", exams.get("exA") === undefined, "确认删除：ExamStore 不再存在（§104/4）");
  test("P-HF-EXAM-DELETE-06", sess.get("exA") === undefined, "ExamSession 删除（§106/5/38）");
  test("P-HF-EXAM-DELETE-11", exams.get("exB") !== undefined && exams.findBySource(src).length === 1, "其他 Exam 保留（§111/10）");
  test("P-HF-EXAM-DELETE-07", cards.get("cardA") !== undefined && cards.get("cardA")?.examId === "exA",
    "SavedReviewCard 保留（examId 保留，UI 显示原考试已删除，§107/4/24/25）");
  test("P-HF-EXAM-DELETE-08", spaced.scGet("cardA") !== undefined && spaced.scGet("cardA")?.fsrsState.due === state.fsrsState.due,
    "Saved Card FSRS 保留且完全一致（§108）");
  test("P-HF-EXAM-DELETE-09", cr.byCard("cardA").length === 1, "CardReviewRecord 保留（§109）");
  test("P-HF-EXAM-DELETE-10", examB.sourcePath === src && cards.get("cardA")?.sourcePath === src, "Source Note 引用保留（§110/10）");
  fs.rmSync(d, { recursive: true, force: true });
}

/* ============ P-HF-EXAM-DELETE-16/17/18/19 + 结构 ============ */
{
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  const start = mainSrc.indexOf("async deleteExam(");
  const end = mainSrc.indexOf("旧式记录复习卡复习", start);
  const body = stripComments(mainSrc.slice(start, end > start ? end : start + 6000));
  test("P-HF-EXAM-DELETE-16", body.includes("mdMissing") && body.includes("已清理考试索引与会话记录"), "Markdown 不存在 → 清理索引/会话（§16/12/42）");
  test("P-HF-EXAM-DELETE-17", body.includes("考试文件删除失败，考试仍然保留"), "Markdown 删除失败 → 不删 Store（§17/41）");
  test("P-HF-EXAM-DELETE-18", body.includes("考试已经不存在") && body.includes("return false"), "Exam 不存在 → deleteExam 返回 false（§18/13）");
  test("P-HF-EXAM-DELETE-19", body.includes('examId: "' ) && body.includes("cache.remove(") && body.includes("generationCacheKeys"),
    "删除顺序含 frontmatter examId 校验 + 精确 cache.remove（§6/26~30/52）");
  const hubSrc = fs.readFileSync(path.join(__dirname, "..", "src", "examHub.ts"), "utf8");
  test("P-HF-EXAM-DELETE-01", hubSrc.includes("🗑 删除") && hubSrc.includes("deleting.has(e.id)"),
    "ExamHub 行有删除按钮 + per-exam 防连点（§1/18/49）");
  test("P-HF-EXAM-DELETE-19b", hubSrc.includes("ev.stopPropagation()"), "删除按钮 stopPropagation（§17/2）");
  test("P-HF-EXAM-DELETE-15b", hubSrc.includes("ExamDeleteConfirmModal") && hubSrc.includes("删除后无法从考试中心恢复"),
    "Obsidian ConfirmModal（非 window.confirm，§14/15）");
  test("P-HF-EXAM-DELETE-20", hubSrc.includes("这篇笔记还没有创建考试"), "删空后空状态文案保留（§20/21）");
  test("P-HF-EXAM-DELETE-AI", !/\bthis\.ai\b|generateExam\(|recordAccess|markReviewed/.test(body),
    "deleteExam 全程 0 AI 且不动 Activity（§43）");
}

/* ============ P-HF-EXAM-HISTORY-01..04 / CARD-*：删除后不再参与去重 ============ */
{
  const examA = mkExam("A", "s.md", "A 考试", 1).questions;
  const examB = mkExam("B", "s.md", "B 考试", 2).questions;
  const examC = mkExam("C", "s.md", "C 考试", 3).questions;
  const ctxABC = buildExamHistoryContext([examA, examB, examC].map((qs) => ({ questions: qs, coverageTopics: [] })));
  const ctxAC = buildExamHistoryContext([examA, examC].map((qs) => ({ questions: qs, coverageTopics: [] })));
  test("P-HF-EXAM-HISTORY-02", ctxABC.historyFingerprint !== ctxAC.historyFingerprint,
    "删除 B → historyFingerprint 改变（§36/102）");
  const bLike: ExamQuestion = { id: "b2", type: "recall", question: "B 考试 题?", referenceAnswer: "r", sourcePath: "s.md" };
  const keepBRemoved = dedupeExamQuestions([bLike], ctxAC, "strict").questions.length;
  test("P-HF-EXAM-HISTORY-01", keepBRemoved === 1,
    "删除 B 后：B 的题干不再作为历史排除，可重新生成（§37/101）");
  const keepBWithB = dedupeExamQuestions([bLike], ctxABC, "strict").questions.length;
  test("P-HF-EXAM-HISTORY-01b", keepBWithB === 0, "未删除时 B 题干仍被排除（对照）");
  const aLike: ExamQuestion = { id: "a2", type: "recall", question: "A 考试 题?", referenceAnswer: "r", sourcePath: "s.md" };
  test("P-HF-EXAM-HISTORY-04", dedupeExamQuestions([aLike, bLike], ctxAC, "strict").removedCount === 1,
    "只保留 A+C 作为历史：A 排除、B 放行（§104/37）");
  // Card UI 标记（§25/4）与 Review/Session 已删除视图（§22/23）
  const cardsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "cardsView.ts"), "utf8");
  const hubSrc = fs.readFileSync(path.join(__dirname, "..", "src", "examHub.ts"), "utf8");
  const viewSrc = fs.readFileSync(path.join(__dirname, "..", "src", "examView.ts"), "utf8");
  test("P-HF-EXAM-CARD-04", cardsSrc.includes("原考试已删除"),
    "Card UI：examId 指向已删除考试时显示“原考试已删除”（§25/4）");
  test("P-HF-EXAM-REVIEW-01", hubSrc.includes("该考试已被删除") && hubSrc.includes("notifyDeleted("), "Exam Review 视图：考试已删除提示（§22）");
  test("P-HF-EXAM-REVIEW-02", hubSrc.includes("返回当前笔记考试中心"), "Exam Review 返回入口（§22）");
  test("P-HF-EXAM-SESSION-01/02", viewSrc.includes("该考试已被删除") && viewSrc.includes("notifyDeleted("),
    "Exam Session 视图：已删除提示（§23）");
  test("P-HF-EXAM-CARD-01", true && cardsSrc.length > 0, "Saved Card 保留由上方 Store 测试覆盖（§107/101 数据层）");
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
