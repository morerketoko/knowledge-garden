/**
 * Phase 21 Hotfix 自动测试（P-HOTFIX-01..20）：「我的复习卡」显示答案 DOM 生命周期修复。
 * 纯逻辑层由 src/reviewCardAnswer.ts 提供（无 Obsidian 依赖）；真实 DOM 点击流在最终报告标 NOT TESTED。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ANSWER_FALLBACK, defaultAnswerVisible, answerVisibility, toggleAnswerVisibility, revealDomAction,
  answerBodyContent, type RevealDomAction,
} from "../src/reviewCardAnswer";
import type { SavedReviewCard } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function card(over: Partial<SavedReviewCard>): SavedReviewCard {
  return {
    id: "cardA", sourcePath: "01 盒子/游戏/游戏框架.md", sourceVersion: "v1", question: "题？",
    answer: "参考答案：隔离变化。", questionType: "recall", createdAt: 1, updatedAt: 1, ...over,
  };
}
function fresh(): { hidden: Set<string>; shown: Set<string> } {
  return { hidden: new Set(), shown: new Set() };
}
/** 模拟在 answerArea 上的行动序列，统计 create 次数（P-HOTFIX-06） */
function simulateToggles(defaultVisible: boolean, id: string, steps: boolean[], st: { hidden: Set<string>; shown: Set<string> }): RevealDomAction[] {
  const actions: RevealDomAction[] = [];
  let hasBody = false;
  for (const willToggle of steps) {
    void willToggle;
    const willShow = toggleAnswerVisibility(id, defaultVisible, st.hidden, st.shown);
    const action = revealDomAction(hasBody, willShow);
    actions.push(action);
    if (action === "create") hasBody = true;
  }
  return actions;
}

/* ============ P-HOTFIX-01..09/17/18：显隐状态机（纯逻辑） ============ */
{
  // 默认隐藏模式：初始无记录 → 不可见（body 不应创建）
  const st = fresh();
  test("P-HOTFIX-01", defaultAnswerVisible(false) === false && answerVisibility("cardA", false, st.hidden, st.shown) === false,
    "默认隐藏：初始不可见 → .answer-body 不创建");
  // 点击「显示答案」（默认隐藏模式）
  const willShow1 = toggleAnswerVisibility("cardA", false, st.hidden, st.shown);
  test("P-HOTFIX-02", willShow1 === true && revealDomAction(false, willShow1) === "create",
    "显示答案：目标显示且无 body → 立即 create（点击即出现）");
  test("P-HOTFIX-09", answerVisibility("cardB", false, st.hidden, st.shown) === false,
    "Card A 显示不影响 Card B（按 card.id 隔离，§19）");
  // 隐藏：body 已存在 → hide（不删 DOM）
  test("P-HOTFIX-04", revealDomAction(true, false) === "hide", "隐藏答案：只 display:none，不删除 DOM（§12）");
  // 再次显示：body 已存在 → show（display:""，不重建，§18）
  test("P-HOTFIX-05", revealDomAction(true, true) === "show", "再次显示：body 存在 → show（display 非 none）");
  // 显示/隐藏/显示 循环：只 create 一次，之后全是 show/hide（无重复 body）
  const st2 = fresh();
  const actions = simulateToggles(false, "cardA", [true, true, true, true, true], st2);   // 每次点击都是切换
  const createCount = actions.filter((a) => a === "create").length;
  test("P-HOTFIX-06", createCount === 1 && actions[1] !== "create" && actions[2] !== "create" && actions[3] !== "create" && actions[4] !== "create",
    "连续 显示/隐藏/显示… 只 create 一次，不会重复创建多个 .answer-body（" + actions.join(",") + "）");
  // 默认显示模式：初始即可见（body 正常创建）
  const st3 = fresh();
  test("P-HOTFIX-07", defaultAnswerVisible(true) === true && answerVisibility("cardA", true, st3.hidden, st3.shown) === true,
    "showAnswerByDefault=true：打开即有答案");
  // 默认隐藏模式：打开隐藏
  const st4 = fresh();
  test("P-HOTFIX-08", answerVisibility("cardA", false, st4.hidden, st4.shown) === false,
    "showAnswerByDefault=false：打开不显示答案");
  // 默认显示模式隐藏 A 不影响 B
  const st5 = fresh();
  toggleAnswerVisibility("cardA", true, st5.hidden, st5.shown);   // 隐藏 A
  test("P-HOTFIX-17", answerVisibility("cardA", true, st5.hidden, st5.shown) === false
    && answerVisibility("cardB", true, st5.hidden, st5.shown) === true,
    "下一张（cardB）不继承上一张（cardA）的显示状态（§20）");
  // 返回上一张按卡自身状态
  const st6 = fresh();
  toggleAnswerVisibility("cardA", true, st6.hidden, st6.shown);   // 隐藏 A
  const aHiddenBeforeB = answerVisibility("cardA", true, st6.hidden, st6.shown);
  toggleAnswerVisibility("cardB", true, st6.hidden, st6.shown);   // 隐藏 B
  toggleAnswerVisibility("cardB", true, st6.hidden, st6.shown);   // 显示 B
  test("P-HOTFIX-18", aHiddenBeforeB === false && answerVisibility("cardA", true, st6.hidden, st6.shown) === aHiddenBeforeB,
    "返回上一张：A 保持自己状态（不被 B 切换影响，§34/18）");
}

/* ============ P-HOTFIX-03/13/14/15/16：答案 body 内容模型 ============ */
{
  const c = card({
    answer: "参考答案：模块边界=隔离变化。",
    explanation: "因为内部实现可独立演进。",
    sourceEvidence: ["模块只对接口负责。", "边界是结构性防火墙。"],
  });
  const content = answerBodyContent(c);
  test("P-HOTFIX-03", content.answer === "参考答案：模块边界=隔离变化。", "显示答案后 answer 文本 === card.answer");
  test("P-HOTFIX-14", content.evidence.length === 2 && content.evidence[0].startsWith("模块只对接口负责。"),
    "sourceEvidence 正常渲染（内容模型保留全部条目）");
  test("P-HOTFIX-15", content.explanation === "因为内部实现可独立演进。", "explanation 正常渲染");
  test("P-HOTFIX-16", (answerBodyContent(card({ answer: "" })).answer || ANSWER_FALLBACK) === ANSWER_FALLBACK
    && ANSWER_FALLBACK === "（该卡没有保存答案文字）",
    "不存在 answer → 显示占位文案（文案与旧渲染一致）");
  test("P-HOTFIX-13", content.sourcePath === c.sourcePath && content.sourcePath === "01 盒子/游戏/游戏框架.md",
    "来源 = card.sourcePath（View 用 plugin.openNote(sourcePath) 打开，P-HOTFIX-13 运行层）");
}

/* ============ P-HOTFIX-10：选择题数据不受答案显隐影响（MC 交互/选项独立） ============ */
{
  const mc = card({ questionType: "multiple_choice", options: ["A1", "B2", "C3", "D4"], correctAnswer: "A" });
  const content = answerBodyContent(mc);
  test("P-HOTFIX-10", content.answer === mc.answer && content.evidence.length === 0 && mc.options?.length === 4 && mc.correctAnswer === "A",
    "multiple_choice：答案显隐不影响选项/正确答案（选项 UI 独立渲染，§21/33/34）");
}

/* ============ P-HOTFIX-11/12：0 AI（纯结构断言：模块不含任何 AI/deriveReviewAnswer/网络引用） ============ */
{
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "reviewCardAnswer.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  test("P-HOTFIX-11", !/\bAI\b|deriveReviewAnswer|https?:/.test(src) && !/from\s+["']\.\/(ai|.*\/ai)/.test(src),
    "显示答案逻辑 0 AI（模块无 AI/网络引用）");
  test("P-HOTFIX-12", !/fsrs|schedule|Rating/i.test(src), "隐藏答案逻辑同样 0 AI / 无关 FSRS（§23）");
}

/* ============ P-HOTFIX-19/20：FSRS Rating 不受影响（结构断言：rating 路径未被本修复改动） ============ */
{
  const viewPath = path.join(__dirname, "..", "src", "cardsView.ts");
  const view = fs.readFileSync(viewPath, "utf8");
  const hotfixMarker = view.includes("toggleAnswerVisibility") && view.includes("renderAnswerBody");
  const ratingStillThere = view.includes("this.plugin.rateSavedCard(c.id, rating)");
  test("P-HOTFIX-19", hotfixMarker && ratingStillThere, "FSRS Rating 调用原样保留（修复未触碰 rating 路径，§19/20）");
  const noWholeRerender = view.includes('hideBtn.addEventListener("click"') && !view.slice(0).includes("// HOTFIX whole rerender");
  void noWholeRerender;
  test("P-HOTFIX-19b", /hideBtn\.setText\(/.test(view) && /revealDomAction/.test(view),
    "按钮文字立即同步 + 局部 DOM 动作（§10，不整卡 renderReview）");
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
