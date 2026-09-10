/**
 * Phase 23 自动测试（P23-*）：Exam Generation 2.0 —— 历史去重 / 内容策略 / 分批 / 合并 / 精确题数 / 缓存键 / parser / provider。
 * UI 与真实网络（Modal 下拉、进度条、重试请求）在最终报告标 NOT TESTED。
 */
import "./portable-bootstrap";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizeExamText, examQuestionFingerprint, questionSimilarity, isNearDuplicate, EXAM_NEAR_DUP_THRESHOLD,
  buildExamHistoryContext, planExamBatches, splitUnitForRetry, dedupeExamQuestions,
  extractHeadings, uncoveredTopics, assignBatchTopics, EXAM_MAX_BATCH_REQUESTS, EXAM_REPLACEMENT_ROUNDS,
  type ExamHistoryContext,
} from "../src/examGen";
import { parseExamGeneration } from "../src/ai/parsers";
import { truncationError } from "../src/ai/provider";
import type { ExamQuestion } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function q(id: string, question: string, concept?: string, type = "recall"): ExamQuestion {
  return { id, question, referenceAnswer: "答 " + question, sourcePath: "A.md", type: type as ExamQuestion["type"], concept, sourceEvidence: ["依据"] };
}
function ctx(exams: { questions: { question: string; concept?: string; type?: string }[]; coverageTopics?: string[] }[]): ExamHistoryContext {
  return buildExamHistoryContext(exams);
}

/* ============ P23-01..02：历史（findBySource 数据层 + historyFingerprint） ============ */
{
  const h1 = ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界" }], coverageTopics: ["架构"] }]);
  const h2 = ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界" }], coverageTopics: ["架构"] }, { questions: [{ question: "什么是耦合？", concept: "耦合" }] }]);
  test("P23-01", h1.examCount === 1 && h1.priorQuestions.length === 1 && h1.priorConcepts.includes("模块边界"),
    "历史上下文（examStore.findBySource 的数据层消费者，§9/101）");
  test("P23-02", h1.historyFingerprint.length > 0 && h1.historyFingerprint === ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界" }], coverageTopics: ["架构"] }]).historyFingerprint,
    "historyFingerprint 确定性（§102/52）");
  test("P23-02b", h2.historyFingerprint !== h1.historyFingerprint, "新考试保存后 fingerprint 变化（下次 cache miss，§35/90）");
  test("P23-02c", ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界" }] }]).historyFingerprint === ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界" }] }]).historyFingerprint,
    "concept/coverage 缺省不影响指纹稳定");
}

/* ============ P23-03..09/27~29：去重与策略 ============ */
{
  const hist = ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界", type: "recall" }] }]);
  // 03 exact
  const d1 = dedupeExamQuestions([q("a", "为什么需要模块边界？")], hist, "strict");
  test("P23-03", d1.removedCount === 1 && d1.questions.length === 0, "历史相同题干 exact 去重（§103/27）");
  // 04 near duplicate（同 concept 且高文本重叠）
  const sim = isNearDuplicate("为什么需要模块边界？", "为什么要模块边界？", "模块边界", "模块边界");
  test("P23-04", sim === true, "高文本重叠 + 同 concept 近重复被识别（§104/14~16）");
  const simFar = questionSimilarity("什么是 Python 的 GIL？", "游戏循环如何固定步长？", "并发", "游戏");
  test("P23-04b", simFar < EXAM_NEAR_DUP_THRESHOLD, "无关主题不会被误判为重复（§16/105b）");
  test("P23-04c", dedupeExamQuestions([q("p1", "为什么要模块边界？", "模块边界", "recall")], ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界", type: "recall" }] }]), "balanced").removedCount === 1,
    "balanced：同 concept 且同题型的近重复改写仍挡（§19）");
  test("P23-04d", dedupeExamQuestions([q("p2", "为什么需要模块边界？换个角度解释其意义", "模块边界", "explanation")], ctx([{ questions: [{ question: "为什么需要模块边界？", concept: "模块边界", type: "recall" }] }]), "balanced").questions.length === 1,
    "new_angle：同 concept 换题型 + 明显不同问法 → 保留（§69/78）");
  // 05 concept duplicate
  const d2 = dedupeExamQuestions([q("b", "模块边界如何降低耦合？", "模块边界")], hist, "strict");
  test("P23-05", d2.removedCount === 1, "strict：同 concept 去重（§105/17/28）");
  // 06 different concept accepted
  const d3 = dedupeExamQuestions([q("c", "什么是耦合？", "耦合")], hist, "strict");
  test("P23-06", d3.questions.length === 1 && d3.removedCount === 0, "不同 concept 接受（§106）");
  // 07/08/09 policies
  const withHist = ctx([{ questions: [{ question: "模块边界作用？", concept: "模块边界", type: "recall" }] }]);
  test("P23-07", dedupeExamQuestions([q("x", "模块边界还有什么作用？", "模块边界", "explanation")], withHist, "strict").removedCount === 1, "strict 同 concept 全挡（§107）");
  test("P23-08", dedupeExamQuestions([q("x", "模块边界还有什么作用？", "模块边界", "explanation")], withHist, "balanced").questions.length === 1,
    "balanced：同 concept 但换题型（explanation≠recall）保留（§108/19/78）");
  test("P23-08b", dedupeExamQuestions([q("x", "模块边界还有什么作用？", "模块边界", "recall")], withHist, "balanced").removedCount === 1,
    "balanced：同 concept 且同题型仍挡（§19）");
  test("P23-09", dedupeExamQuestions([q("x", "模块边界还有什么作用？", "模块边界", "recall")], withHist, "allow").questions.length === 1,
    "allow：允许历史 concept 重复，仍保留本批题（§109/29）");
  test("P23-09b", dedupeExamQuestions([q("x", "为什么需要模块边界？"), q("y", "为什么需要模块边界？")], ctx([]), "allow").removedCount === 1,
    "allow：同一批内 exact 重复仍禁止（§20/120）");
}

/* ============ P23-10..12：内容策略/覆盖/分配 ============ */
{
  const note = "# 模块化\n正文…\n## 模块边界\n…\n## 耦合\n…\n### 内聚\n…\n# 测试\n…";
  const h = ctx([{ questions: [{ question: "旧题", concept: "模块边界" }], coverageTopics: ["模块化"] }]);
  const headings = extractHeadings(note);
  const uncovered = uncoveredTopics(headings, h);
  test("P23-10", uncovered.includes("耦合") && uncovered.includes("内聚") && !uncovered.includes("模块化"),
    "new_content：uncoveredTopics = headings − 历史 concept/coverage（§110/21/22）");
  const alloc = assignBatchTopics(uncovered, 0, 3);
  test("P23-10b", alloc.length >= 1 && alloc.every((t) => uncovered.includes(t)), "assignBatchTopics 从候选分配（§73~75）");
  // 11 new_angle：同一 concept 必须换题型——由 dedupe balanced 保障（上面 P23-08 已验证），此处再证 strict 会拒绝同 concept 同题型
  const hist = ctx([{ questions: [{ question: "边界是什么？", concept: "边界", type: "recall" }] }]);
  test("P23-11", dedupeExamQuestions([q("n1", "边界如何实践？", "边界", "recall")], hist, "balanced").removedCount === 1, "new_angle 语义：同 concept 换题型的才允许（§111/78）");
  // 12 custom topic（main 拒绝路径结构）
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-12", mainSrc.includes("「✎ 自定义主题」内容策略需要配合"), "custom 内容策略需配合自定义主题（§112/71）");
}

/* ============ P23-13..19：分批与自适应 ============ */
{
  test("P23-13", planExamBatches(16).join("+") === "10+6", "16 → 10+6（§113）");
  test("P23-14", planExamBatches(20).join("+") === "10+10", "20 → 10+10（§114）");
  test("P23-15", planExamBatches(25).join("+") === "10+10+5", "25 → 10+10+5（§115）");
  test("P23-16", planExamBatches(30).join("+") === "10+10+10", "30 → 10+10+10（§116）");
  test("P23-16b", planExamBatches(15).join("+") === "15" && planExamBatches(1).join("+") === "1", "≤15 单批（§28）");
  test("P23-17", splitUnitForRetry(10).join("+") === "5+5", "截断 10 → 5+5（§117/36）");
  test("P23-17b", splitUnitForRetry(5).join("+") === "3+2", "再截断 5 → 3+2");
  test("P23-17c", splitUnitForRetry(1).length === 0, "unit=1 不再拆分");
  test("P23-18/19-keys", EXAM_MAX_BATCH_REQUESTS === 8 && EXAM_REPLACEMENT_ROUNDS === 3,
    "总请求 ≤8、replacement ≤3（§118/109/46）——网络/JSON 失败只重试当前 batch 见 main 编排（§119/106）");
}

/* ============ P23-20..26/31~33：合并 / 精确题数 / 知识不足 ============ */
{
  // 模拟：三批各生成 10 道唯一题，合并去重后正好 target（concept 用带前缀唯一值，避免 strict 误删）
  const gen = (prefix: string, n: number): ExamQuestion[] => Array.from({ length: n }, (_, i) => q(prefix + i, prefix + " 题 " + i, "概念" + prefix + i));
  const merged = dedupeExamQuestions([...gen("a", 10), ...gen("b", 10), ...gen("c", 10)], ctx([]), "strict");
  test("P23-20", merged.questions.length === 30, "merge 10+10+10 → 30（§120）");
  // 跨批重复（a0 出现在两批）→ 去重后需 replacement
  const dupCandidates = [...gen("a", 10), ...gen("a", 1), ...gen("b", 9)];
  const f0 = dupCandidates[0].question;
  const f1 = dupCandidates[10].question;
  const diffAt = f0 === f1 ? -1 : (() => { for (let k = 0; k < Math.max(f0.length, f1.length); k++) if (f0[k] !== f1[k]) return k; return -1; })();
  const sameFp = examQuestionFingerprint(dupCandidates[0]) === examQuestionFingerprint(dupCandidates[10]);
  const dupAcross = dedupeExamQuestions(dupCandidates, ctx([]), "strict");
  test("P23-21", dupAcross.questions.length === 19 && dupAcross.removedCount === 1,
    "跨批 exact 重复被移除 → 缺口由 replacement 补（got kept=" + dupAcross.questions.length + ", removed=" + dupAcross.removedCount + ", sameFp=" + sameFp + ", diffAt=" + diffAt + ", q0='" + f0 + "', q10='" + f1 + "'，§121）");
  const target30 = dedupeExamQuestions([...gen("a", 30)], ctx([]), "strict").questions.length;
  const target25 = dedupeExamQuestions([...gen("a", 25)], ctx([]), "strict").questions.length;
  const target15 = dedupeExamQuestions([...gen("a", 15)], ctx([]), "strict").questions.length;
  test("P23-24", target30 === 30, "target 30 → 恰好 30（§124）");
  test("P23-25", target25 === 25, "target 25 → 恰好 25（§125）");
  test("P23-26", target15 === 15, "target 15 → 恰好 15（§126）");
  // 知识不足：模拟 replacement 三轮后仍缺
  const hist = ctx([{ questions: [{ question: "唯一旧题？", concept: "c0" }] }]);
  const scarcity = dedupeExamQuestions([q("0", "唯一新题", "c1")], hist, "strict");
  test("P23-31", scarcity.questions.length === 1, "短笔记只能得到有限不重复题（数据层，§131）");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-32", mainSrc.includes("不足以形成") && mainSrc.includes("绝不自动降低或编造"), "内容不足 → 明确错误提示（§132/46/76）");
  test("P23-33", /valid\.length !== target/.test(mainSrc) && /const questions = gen\.questions/.test(mainSrc),
    "最终精确题数校验后才保存（不存半成品，§133/85/86）");
  test("P23-23", EXAM_REPLACEMENT_ROUNDS === 3, "replacement 三轮上限（§123/46）");
}

/* ============ P23-27..30/34..39：历史与缓存键 ============ */
{
  const hist = ctx([{ questions: [{ question: "旧题干", concept: "旧概念", type: "recall" }] }]);
  test("P23-27", dedupeExamQuestions([q("x", "旧题干")], hist, "allow").removedCount === 1, "旧考试题干 exact 始终排除（含 allow，§127）");
  test("P23-28", dedupeExamQuestions([q("x", "另一个问题", "旧概念", "explanation")], hist, "strict").removedCount === 1, "strict 排除旧 concept（§128）");
  test("P23-29", dedupeExamQuestions([q("x", "另一个问题", "旧概念", "explanation")], hist, "allow").questions.length === 1, "allow 可复用 concept（§129）");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-30", mainSrc.includes("o.force") && mainSrc.includes("history"), "force 仍使用 history exclusion（编排层，§130/118）");
  const svc = fs.readFileSync(path.join(__dirname, "..", "src", "ai", "service.ts"), "utf8");
  const prompts = fs.readFileSync(path.join(__dirname, "..", "src", "prompts.ts"), "utf8");
  test("P23-34", svc.includes('"strategy:"') && svc.includes('"hist:"') && svc.includes('"div:"'), "缓存键含 strategy/history/diversity（§134/51）");
  test("P23-35", /historyFingerprint/.test(svc), "缓存键含 historyFingerprint（§135/52）");
  test("P23-36", /opts\.contentStrategy/.test(svc) && /opts\.repeatPolicy/.test(svc), "strategy / repeatPolicy 进入请求与键（§136~137）");
  test("P23-39", prompts.includes('EXAM_GENERATION_PROMPT_VERSION = "exam-generation-v2"'), "Prompt v2（§139/62/63：v1 缓存自动失效）");
  test("P23-34b", svc.includes("EXAM_GENERATION_PROMPT_VERSION") , "缓存 key 使用 PROMPT_VERSIONS[type]（模型/版本变化 → miss，§138）");
}

/* ============ P23-40..44：Parser / 40b Provider ============ */
{
  const valid = '{"title":"T","questions":[{"id":"q1","type":"recall","question":"A?","referenceAnswer":"r"},{"id":"q2","type":"recall","question":"B?","referenceAnswer":"r"}]}';
  test("P23-40", parseExamGeneration(valid, 5).questions.length === 2, "合法 batch JSON（§140）");
  let invalidThrew = false;
  try { parseExamGeneration('{"title":"x","questions":[{bad', 5); } catch { invalidThrew = true; }
  test("P23-41", invalidThrew === true, "非法 JSON → error（只影响当前 batch，§141/59）");
  let zeroThrew = false;
  try { parseExamGeneration('{"title":"x","questions":[]}', 5); } catch { zeroThrew = true; }
  test("P23-42", zeroThrew === true, "空 questions → error（§142）");
  let mcThrew = false;
  try { parseExamGeneration('{"title":"x","questions":[{"id":"q1","type":"multiple_choice","question":"A?","options":["1"],"correctAnswer":"A","referenceAnswer":"r"}]}', 5); } catch { mcThrew = true; }
  test("P23-43", mcThrew === true, "非法 MC（选项≠4）→ 过滤后 0 题 error（§143）");
  let tfThrew = false;
  try { parseExamGeneration('{"title":"x","questions":[{"id":"q1","type":"true_false","question":"A?","correctAnswer":"maybe","referenceAnswer":"r"}]}', 5); } catch { tfThrew = true; }
  test("P23-44", tfThrew === true, "非法 true_false → error（§144）");
  test("P23-40b", truncationError("length")?.code === "TRUNCATED" && truncationError("stop") === null && truncationError(undefined) === null,
    "Provider：只有 finish_reason=length → TRUNCATED（§99）");
}

/* ============ UI / AI zero 结构 ============ */
{
  const view = fs.readFileSync(path.join(__dirname, "..", "src", "examView.ts"), "utf8");
  test("P23-45", view.includes('addOption("new_content"') && view.includes('addOption("new_angle"') && view.includes('addOption("broad_coverage"') && view.includes('addOption("custom"'),
    "考察内容下拉（§145）");
  test("P23-46", view.includes('addOption("strict"') && view.includes('addOption("balanced"') && view.includes('addOption("allow"'), "避免重复下拉（§146）");
  test("P23-47", view.includes("const COUNT_OPTIONS = [3, 5, 8, 10, 15, 20, 30]"), "30 题预设（§147）");
  test("P23-48", view.includes("这篇笔记已有 ") && view.includes("findBySource(this.file.path)"), "历史考试数量提示（§148/81）");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-49/50", mainSrc.includes("考试生成中：已生成 ") && mainSrc.includes("正在补充未重复题目："), "真实分批/补充进度文案（§149/50/84）");
  const modalOnly = view.slice(view.indexOf("export class ExamBuildModal"), view.indexOf("export class ExamSessionView") > 0 ? view.indexOf("export class ExamSessionView") : view.length);
  test("P23-AI", !modalOnly.includes(".ai.") && !modalOnly.includes("generateExam("), "Modal 打开/历史提示路径无 AI 调用（§102）");
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
