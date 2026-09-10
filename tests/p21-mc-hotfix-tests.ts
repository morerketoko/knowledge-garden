/**
 * Phase 21 Hotfix 自动测试（P-HF-MC-*）：「我的复习卡」选择题选项丢失。
 * 覆盖 hydration 优先级/歧义/不猜题、legacy 恢复、parser JSON 优先、中文/emoji/逗号/引号选项、
 * 快照不被覆盖、FSRS/mastery/reviewCount/Activity 不受影响；渲染与命令 UI 在报告标 NOT TESTED。
 */
import { mkdtemp } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  needsSavedCardHydration, hydrateSavedReviewCardWith, hydrateSavedCardBatch, legacyMcCandidates,
} from "../src/savedCardHydration";
import { cardMarkdown, parseCardMarkdown } from "../src/examStore";
import { ReviewCardStore } from "../src/examStore";
import type { NoteExam, SavedReviewCard } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function mkExam(id: string, qs: NoteExam["questions"]): NoteExam {
  return { id, sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", title: "测试考试 " + id, mode: "holistic", questionCount: qs.length, answerMode: "source_only", questions: qs, examVersion: 1, createdAt: 1, updatedAt: 1 };
}
function baseCard(over: Partial<SavedReviewCard>): SavedReviewCard {
  return {
    id: "card1", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", examId: "e1", question: "哪一项最能解释模块化？",
    answer: "模块化通过隔离变化降低耦合。", questionType: "multiple_choice", createdAt: 10, updatedAt: 10, reviewCount: 3, mastery: "good", masteryScore: 75, lastReviewedAt: 9, ...over,
  };
}
const lookup = new Map<string, NoteExam>();
function getExam(id: string): NoteExam | undefined { return lookup.get(id); }
function bySource(): NoteExam[] { return Array.from(lookup.values()); }

/* ============ 新卡（P-HF-MC-01） + 快照完整性 ============ */
{
  const q = { id: "q1", type: "multiple_choice" as const, question: "哪一项最能解释模块化？", referenceAnswer: "A", options: ["降低耦合", "增加代码量", "消除所有复杂度", "不需要维护"], correctAnswer: "A", sourcePath: "01 盒子/游戏/游戏框架.md" };
  const fresh = baseCard({ examQuestionId: "q1", options: [...(q.options ?? [])], correctAnswer: "A" });
  const parsed = parseCardMarkdown(cardMarkdown(fresh));
  test("P-HF-MC-01", parsed.card?.options?.length === 4 && parsed.card?.correctAnswer === "A" && parsed.card?.options?.[0] === "降低耦合",
    "新收藏 MC 卡：Markdown 往返保留 4 个选项 + 正确答案（数据层；UI 渲染运行时验证）");
  test("P-HF-MC-01b", needsSavedCardHydration(fresh) === false, "完整 MC 卡无需 hydration（不写盘，§12）");
  const h = hydrateSavedReviewCardWith(fresh, getExam, bySource);
  test("P-HF-MC-01c", h.repaired === false && h.source === "existing" && h.card === fresh,
    "完整卡 hydration 直接返回且不克隆（零开销）");
}

/* ============ 旧卡恢复：examId+examQuestionId（P-HF-MC-02/46） ============ */
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "qA", type: "multiple_choice", question: "模块边界的作用？", referenceAnswer: "B", options: ["隔离变化", "消除复杂度", "隐藏测试", "增加耦合"], correctAnswer: "B", sourcePath: "01 盒子/游戏/游戏框架.md" },
    { id: "qB", type: "multiple_choice", question: "模块边界的作用（另一问）？", referenceAnswer: "C", options: ["错1", "错2", "正确C", "错4"], correctAnswer: "C", sourcePath: "01 盒子/游戏/游戏框架.md" },
  ]));
  const legacy = baseCard({ examQuestionId: "qA", options: undefined as never, correctAnswer: undefined as never });
  const res = hydrateSavedReviewCardWith(legacy, getExam, bySource);
  test("P-HF-MC-02", res.repaired === true && res.source === "exam" && res.card.options?.length === 4 && res.card.correctAnswer === "B",
    "旧卡缺 options：examId+examQuestionId 自动恢复（§4/7/40）");
  test("P-HF-MC-46", res.card.options?.[1] === "消除复杂度",
    "题干相似的两题：examQuestionId 正确 → 恢复正确选项（§46）");
  const snapshotSame = legacy.question === res.card.question && legacy.answer === res.card.answer
    && legacy.sourceEvidence === res.card.sourceEvidence && legacy.createdAt === res.card.createdAt
    && legacy.id === res.card.id && legacy.examId === res.card.examId && legacy.examQuestionId === res.card.examQuestionId
    && legacy.reviewCount === res.card.reviewCount && legacy.masteryScore === res.card.masteryScore && legacy.lastReviewedAt === res.card.lastReviewedAt;
  test("P-HF-MC-02b", snapshotSame, "恢复只补 options/correctAnswer，快照其余字段与 FSRS/mastery/reviewCount 不变（§6/37/56~58）");
}

/* ============ 空 / 单选项（P-HF-MC-52/53） ============ */
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "q0", type: "multiple_choice", question: "空选项测试", referenceAnswer: "A", options: ["甲", "乙", "丙", "丁"], correctAnswer: "A", sourcePath: "01 盒子/游戏/游戏框架.md" },
  ]));
  const empty = baseCard({ examQuestionId: "q0", options: [] });
  const one = baseCard({ examQuestionId: "q0", options: ["甲"] });
  test("P-HF-MC-52", needsSavedCardHydration(empty) === true && hydrateSavedReviewCardWith(empty, getExam, bySource).repaired === true,
    "options=[] 不误认为有效 → 触发 hydration（§52）");
  test("P-HF-MC-53", needsSavedCardHydration(one) === true && hydrateSavedReviewCardWith(one, getExam, bySource).repaired === true,
    "options=[1 项] 视为异常 → 优先从 Exam 修复（§53）");
  const many = baseCard({ examQuestionId: "q0", options: ["一", "二", "三", "四"], correctAnswer: "A" });
  test("P-HF-MC-54", needsSavedCardHydration(many) === false && many.options?.length === 4,
    "options > 2 → 全部保留不覆盖（§54/17/18）");
}

/* ============ 无 examId / Exam 已删除（P-HF-MC-42/43/8/9） ============ */
{
  lookup.clear();
  const noExam = baseCard({ examId: undefined });
  const res1 = hydrateSavedReviewCardWith(noExam, getExam, bySource);
  test("P-HF-MC-42", res1.repaired === false && res1.source === "unavailable", "无 examId：不猜题，unavailable（§9/42）");
  lookup.set("e1", mkExam("e1", [{ id: "qX", type: "multiple_choice", question: "题", referenceAnswer: "A", options: ["a", "b", "c", "d"], correctAnswer: "A", sourcePath: "01 盒子/游戏/游戏框架.md" }]));
  lookup.delete("e1");
  const goneExam = baseCard({ examQuestionId: "qX" });
  const res2 = hydrateSavedReviewCardWith(goneExam, getExam, bySource);
  test("P-HF-MC-43", res2.repaired === false && res2.source === "unavailable", "Exam 已删除：unavailable，不崩（§8/43/70）");
}

/* ============ question 文本唯一匹配 + 歧义（P-HF-MC-44/45） ============ */
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "u1", type: "multiple_choice", question: "唯一题面", referenceAnswer: "B", options: ["x", "B", "y", "z"], correctAnswer: "B", sourcePath: "01 盒子/游戏/游戏框架.md" },
  ]));
  const noQid = baseCard({ examQuestionId: undefined, question: "唯一题面" });
  const resU = hydrateSavedReviewCardWith(noQid, getExam, bySource);
  test("P-HF-MC-44", resU.repaired === true && resU.source === "question-match" && resU.card.options?.length === 4 && resU.card.correctAnswer === "B",
    "无 examQuestionId：examId 内题干唯一精确匹配 → 恢复（§44）");
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "a", type: "multiple_choice", question: "相同题干", referenceAnswer: "A", options: ["A1", "A2", "A3", "A4"], correctAnswer: "A", sourcePath: "01 盒子/游戏/游戏框架.md" },
    { id: "b", type: "multiple_choice", question: "相同题干", referenceAnswer: "B", options: ["B1", "B2", "B3", "B4"], correctAnswer: "B", sourcePath: "01 盒子/游戏/游戏框架.md" },
  ]));
  const amb = baseCard({ examQuestionId: undefined, question: "相同题干" });
  const resA = hydrateSavedReviewCardWith(amb, getExam, bySource);
  test("P-HF-MC-45", resA.repaired === false && resA.source === "unavailable",
    "题干歧义（两题相同、无 examQuestionId）：不能猜，不自动恢复（§45）");
  // sourcePath + question 全局唯一匹配（fallback 3）
  lookup.clear();
  lookup.set("eA", mkExam("eA", [{ id: "s1", type: "multiple_choice", question: "全局唯一？", referenceAnswer: "C", options: ["p", "q", "C", "r"], correctAnswer: "C", sourcePath: "01 盒子/游戏/游戏框架.md" }]));
  lookup.set("eB", mkExam("eB", [{ id: "t1", type: "multiple_choice", question: "另一题", referenceAnswer: "A", options: ["1", "2", "3", "4"], correctAnswer: "A", sourcePath: "01 盒子/游戏/系统边界.md" }]));
  const srcOnly = baseCard({ examId: "eA", examQuestionId: undefined, question: "全局唯一？" });
  // examId eA 内找不到同题干（唯一题在 eA? eA 有 '全局唯一？' 其实在 eA 内也有）→ 已命中 question-match
  const resS = hydrateSavedReviewCardWith(srcOnly, getExam, bySource);
  test("P-HF-MC-44b", resS.repaired === true && resS.source === "question-match" && resS.card.correctAnswer === "C",
    "question 文本唯一匹配（考试内）恢复成功");
}

/* ============ 保留已存在快照 + correctAnswer 补全（P-HF-MC-47/48） ============ */
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [{ id: "q1", type: "multiple_choice", question: "哪一项最能解释模块化？", referenceAnswer: "A", options: ["新版A", "新版B", "新版C", "新版D"], correctAnswer: "A", sourcePath: "01 盒子/游戏/游戏框架.md" }]));
  const kept = baseCard({ examQuestionId: "q1", options: ["旧版1", "旧版2", "旧版3", "旧版4"], correctAnswer: "X" });
  const resK = hydrateSavedReviewCardWith(kept, getExam, bySource);
  test("P-HF-MC-47", resK.repaired === false && resK.card.options?.join("|") === "旧版1|旧版2|旧版3|旧版4" && resK.card.correctAnswer === "X",
    "已存在 options/correctAnswer：保留 card 快照，不被 Exam 新版覆盖（§17~19/47）");
  const noCorrect = baseCard({ examQuestionId: "q1", options: ["旧版1", "旧版2", "旧版3", "旧版4"], correctAnswer: undefined });
  const resC = hydrateSavedReviewCardWith(noCorrect, getExam, bySource);
  test("P-HF-MC-48", resC.repaired === true && resC.card.correctAnswer === "A" && resC.card.options?.length === 4,
    "已有 options 但 correctAnswer 缺失 → 只补 correctAnswer（§48）");
}

/* ============ 批量（缓存 + 计数；§62~64/35） ============ */
{
  const examIndex = new Map<string, NoteExam>();
  examIndex.set("e1", mkExam("e1", [{ id: "b1", type: "multiple_choice", question: "批量题", referenceAnswer: "A", options: ["1", "2", "3", "4"], correctAnswer: "A", sourcePath: "01 盒子/游戏/游戏框架.md" }]));
  const cards = [
    baseCard({ id: "ok", examQuestionId: "b1", options: ["1", "2", "3", "4"], correctAnswer: "A" }),
    baseCard({ id: "fix", examQuestionId: "b1" }),
    baseCard({ id: "nope", examId: undefined }),
    baseCard({ id: "txt", questionType: "recall" as never }),
  ];
  const batch = hydrateSavedCardBatch(cards, examIndex, () => Array.from(examIndex.values()));
  test("P-HF-MC-02c", batch.cards.length === 4 && batch.repairedCount === 1 && batch.cards.find((c) => c.id === "fix")?.options?.length === 4,
    "批量 hydration：只修复需要修复的卡（其余原样），exam 按 Map 缓存（§62~64）");
  test("P-HF-MC-02d", legacyMcCandidates(cards).length === 2, "legacy 候选统计（MC 且缺 options/无 examId）");
}

/* ============ Parser：JSON 优先（P-HF-MC-20~24/49~51） ============ */
{
  const withComma = baseCard({ examQuestionId: "q1", options: ["A, 第一种情况", "B, 第二种情况", "C", "D"], correctAnswer: "A" });
  const p1 = parseCardMarkdown(cardMarkdown(withComma));
  test("P-HF-MC-20", p1.card?.options?.length === 4 && p1.card?.options?.[0] === "A, 第一种情况" && p1.card?.options?.[1] === "B, 第二种情况",
    "带逗号选项：JSON 优先解析 → 仍 4 项（§22，旧 split 会丢）");
  const withQuote = baseCard({ examQuestionId: "q1", options: ["他说\"对\"", "普通B", "普通C", "普通D"], correctAnswer: "A" });
  const p2 = parseCardMarkdown(cardMarkdown(withQuote));
  test("P-HF-MC-20b", p2.card?.options?.[0] === "他说\"对\"" && p2.card?.options?.length === 4,
    "带引号选项：JSON encoding/decoding 正常（§23）");
  const uni = baseCard({ examQuestionId: "q1", options: ["Ａ．中文选项", "Ｂ．人工智能", "Ｃ．游戏设计", "Ｄ．知识管理"], correctAnswer: "Ａ" });
  const p3 = parseCardMarkdown(cardMarkdown(uni));
  test("P-HF-MC-24", p3.card?.options?.join("|") === "Ａ．中文选项|Ｂ．人工智能|Ｃ．游戏设计|Ｄ．知识管理",
    "Unicode/全角选项完整保留（§24/50）");
  const emoji = baseCard({ examQuestionId: "q1", options: ["😀 记得住", "🎮 游戏", "🧠 记忆", "✅ 掌握"], correctAnswer: "D" });
  const p4 = parseCardMarkdown(cardMarkdown(emoji));
  test("P-HF-MC-51", p4.card?.options?.includes("😀 记得住") && p4.card?.options?.includes("🎮 游戏") && p4.card?.options?.length === 4,
    "emoji 选项不丢失（§51）");
  const rt = parseCardMarkdown(cardMarkdown(withComma));
  test("P-HF-MC-49", JSON.stringify(rt.card?.options) === JSON.stringify(withComma.options) && rt.card?.correctAnswer === withComma.correctAnswer,
    "cardMarkdown → parseCardMarkdown roundtrip：options/correctAnswer 完全一致（§49）");
}

/* ============ 持久化到 cards.json（P-HF-MC-41 数据层） ============ */
{
  const dir = mkdtemp(path.join(os.tmpdir(), "kg-mc-"));
  const store = new ReviewCardStore(dir);
  store.load();
  const legacy = baseCard({ id: "p1", examQuestionId: "q1" });
  store.add(legacy);
  store.update("p1", { options: ["降低耦合", "增加代码", "消除复杂度", "免维护"], correctAnswer: "A" });   // 模拟 hydrate 后持久化
  const reloaded = new ReviewCardStore(dir);
  reloaded.load();
  const c = reloaded.get("p1");
  test("P-HF-MC-41", c?.options?.length === 4 && c?.correctAnswer === "A",
    "恢复后重新读取 cards.json：options 存在（Review Card Markdown 同步由 writeSavedCardMarkdown 负责，运行层）");
  const mdHas = cardMarkdown(reloaded.get("p1") as SavedReviewCard).includes('options: ["降低耦合", "增加代码", "消除复杂度", "免维护"]');
  test("P-HF-MC-41b", mdHas, "恢复后重新生成 Review Card Markdown：options 存在（§38/41）");
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ============ 0 AI 结构（P-HF-MC-55）+ 不动 Activity（P-HF-MC-59） ============ */
{
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "savedCardHydration.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  test("P-HF-MC-55", !/\bAI\b|prompt|apiKey|generate|https?:/.test(src) && !/activity|markReviewed/.test(src),
    "hydration/repair/parse 全程 0 AI，且不触发 Activity/markReviewed（§55/59/60）");
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
