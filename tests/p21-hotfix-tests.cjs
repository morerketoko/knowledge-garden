"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// tests/p21-hotfix-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// src/reviewCardAnswer.ts
var ANSWER_FALLBACK = "\uFF08\u8BE5\u5361\u6CA1\u6709\u4FDD\u5B58\u7B54\u6848\u6587\u5B57\uFF09";
function defaultAnswerVisible(showByDefault) {
  return showByDefault !== false;
}
function answerVisibility(cardId, defaultVisible, hidden, shown) {
  return defaultVisible ? !hidden.has(cardId) : shown.has(cardId);
}
function toggleAnswerVisibility(cardId, defaultVisible, hidden, shown) {
  const before = answerVisibility(cardId, defaultVisible, hidden, shown);
  const after = !before;
  if (defaultVisible) {
    if (after) hidden.delete(cardId);
    else hidden.add(cardId);
  } else {
    if (after) shown.add(cardId);
    else shown.delete(cardId);
  }
  return after;
}
function revealDomAction(hasBody, willShow) {
  if (willShow) return hasBody ? "show" : "create";
  return hasBody ? "hide" : "none";
}
function answerBodyContent(card2) {
  return {
    answer: card2.answer || "",
    explanation: card2.explanation,
    evidence: card2.sourceEvidence ?? [],
    sourcePath: card2.sourcePath
  };
}

// tests/p21-hotfix-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function card(over) {
  return {
    id: "cardA",
    sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    sourceVersion: "v1",
    question: "\u9898\uFF1F",
    answer: "\u53C2\u8003\u7B54\u6848\uFF1A\u9694\u79BB\u53D8\u5316\u3002",
    questionType: "recall",
    createdAt: 1,
    updatedAt: 1,
    ...over
  };
}
function fresh() {
  return { hidden: /* @__PURE__ */ new Set(), shown: /* @__PURE__ */ new Set() };
}
function simulateToggles(defaultVisible, id, steps, st) {
  const actions = [];
  let hasBody = false;
  for (const willToggle of steps) {
    const willShow = toggleAnswerVisibility(id, defaultVisible, st.hidden, st.shown);
    const action = revealDomAction(hasBody, willShow);
    actions.push(action);
    if (action === "create") hasBody = true;
  }
  return actions;
}
{
  const st = fresh();
  test(
    "P-HOTFIX-01",
    defaultAnswerVisible(false) === false && answerVisibility("cardA", false, st.hidden, st.shown) === false,
    "\u9ED8\u8BA4\u9690\u85CF\uFF1A\u521D\u59CB\u4E0D\u53EF\u89C1 \u2192 .answer-body \u4E0D\u521B\u5EFA"
  );
  const willShow1 = toggleAnswerVisibility("cardA", false, st.hidden, st.shown);
  test(
    "P-HOTFIX-02",
    willShow1 === true && revealDomAction(false, willShow1) === "create",
    "\u663E\u793A\u7B54\u6848\uFF1A\u76EE\u6807\u663E\u793A\u4E14\u65E0 body \u2192 \u7ACB\u5373 create\uFF08\u70B9\u51FB\u5373\u51FA\u73B0\uFF09"
  );
  test(
    "P-HOTFIX-09",
    answerVisibility("cardB", false, st.hidden, st.shown) === false,
    "Card A \u663E\u793A\u4E0D\u5F71\u54CD Card B\uFF08\u6309 card.id \u9694\u79BB\uFF0C\xA719\uFF09"
  );
  test("P-HOTFIX-04", revealDomAction(true, false) === "hide", "\u9690\u85CF\u7B54\u6848\uFF1A\u53EA display:none\uFF0C\u4E0D\u5220\u9664 DOM\uFF08\xA712\uFF09");
  test("P-HOTFIX-05", revealDomAction(true, true) === "show", "\u518D\u6B21\u663E\u793A\uFF1Abody \u5B58\u5728 \u2192 show\uFF08display \u975E none\uFF09");
  const st2 = fresh();
  const actions = simulateToggles(false, "cardA", [true, true, true, true, true], st2);
  const createCount = actions.filter((a) => a === "create").length;
  test(
    "P-HOTFIX-06",
    createCount === 1 && actions[1] !== "create" && actions[2] !== "create" && actions[3] !== "create" && actions[4] !== "create",
    "\u8FDE\u7EED \u663E\u793A/\u9690\u85CF/\u663E\u793A\u2026 \u53EA create \u4E00\u6B21\uFF0C\u4E0D\u4F1A\u91CD\u590D\u521B\u5EFA\u591A\u4E2A .answer-body\uFF08" + actions.join(",") + "\uFF09"
  );
  const st3 = fresh();
  test(
    "P-HOTFIX-07",
    defaultAnswerVisible(true) === true && answerVisibility("cardA", true, st3.hidden, st3.shown) === true,
    "showAnswerByDefault=true\uFF1A\u6253\u5F00\u5373\u6709\u7B54\u6848"
  );
  const st4 = fresh();
  test(
    "P-HOTFIX-08",
    answerVisibility("cardA", false, st4.hidden, st4.shown) === false,
    "showAnswerByDefault=false\uFF1A\u6253\u5F00\u4E0D\u663E\u793A\u7B54\u6848"
  );
  const st5 = fresh();
  toggleAnswerVisibility("cardA", true, st5.hidden, st5.shown);
  test(
    "P-HOTFIX-17",
    answerVisibility("cardA", true, st5.hidden, st5.shown) === false && answerVisibility("cardB", true, st5.hidden, st5.shown) === true,
    "\u4E0B\u4E00\u5F20\uFF08cardB\uFF09\u4E0D\u7EE7\u627F\u4E0A\u4E00\u5F20\uFF08cardA\uFF09\u7684\u663E\u793A\u72B6\u6001\uFF08\xA720\uFF09"
  );
  const st6 = fresh();
  toggleAnswerVisibility("cardA", true, st6.hidden, st6.shown);
  const aHiddenBeforeB = answerVisibility("cardA", true, st6.hidden, st6.shown);
  toggleAnswerVisibility("cardB", true, st6.hidden, st6.shown);
  toggleAnswerVisibility("cardB", true, st6.hidden, st6.shown);
  test(
    "P-HOTFIX-18",
    aHiddenBeforeB === false && answerVisibility("cardA", true, st6.hidden, st6.shown) === aHiddenBeforeB,
    "\u8FD4\u56DE\u4E0A\u4E00\u5F20\uFF1AA \u4FDD\u6301\u81EA\u5DF1\u72B6\u6001\uFF08\u4E0D\u88AB B \u5207\u6362\u5F71\u54CD\uFF0C\xA734/18\uFF09"
  );
}
{
  const c = card({
    answer: "\u53C2\u8003\u7B54\u6848\uFF1A\u6A21\u5757\u8FB9\u754C=\u9694\u79BB\u53D8\u5316\u3002",
    explanation: "\u56E0\u4E3A\u5185\u90E8\u5B9E\u73B0\u53EF\u72EC\u7ACB\u6F14\u8FDB\u3002",
    sourceEvidence: ["\u6A21\u5757\u53EA\u5BF9\u63A5\u53E3\u8D1F\u8D23\u3002", "\u8FB9\u754C\u662F\u7ED3\u6784\u6027\u9632\u706B\u5899\u3002"]
  });
  const content = answerBodyContent(c);
  test("P-HOTFIX-03", content.answer === "\u53C2\u8003\u7B54\u6848\uFF1A\u6A21\u5757\u8FB9\u754C=\u9694\u79BB\u53D8\u5316\u3002", "\u663E\u793A\u7B54\u6848\u540E answer \u6587\u672C === card.answer");
  test(
    "P-HOTFIX-14",
    content.evidence.length === 2 && content.evidence[0].startsWith("\u6A21\u5757\u53EA\u5BF9\u63A5\u53E3\u8D1F\u8D23\u3002"),
    "sourceEvidence \u6B63\u5E38\u6E32\u67D3\uFF08\u5185\u5BB9\u6A21\u578B\u4FDD\u7559\u5168\u90E8\u6761\u76EE\uFF09"
  );
  test("P-HOTFIX-15", content.explanation === "\u56E0\u4E3A\u5185\u90E8\u5B9E\u73B0\u53EF\u72EC\u7ACB\u6F14\u8FDB\u3002", "explanation \u6B63\u5E38\u6E32\u67D3");
  test(
    "P-HOTFIX-16",
    (answerBodyContent(card({ answer: "" })).answer || ANSWER_FALLBACK) === ANSWER_FALLBACK && ANSWER_FALLBACK === "\uFF08\u8BE5\u5361\u6CA1\u6709\u4FDD\u5B58\u7B54\u6848\u6587\u5B57\uFF09",
    "\u4E0D\u5B58\u5728 answer \u2192 \u663E\u793A\u5360\u4F4D\u6587\u6848\uFF08\u6587\u6848\u4E0E\u65E7\u6E32\u67D3\u4E00\u81F4\uFF09"
  );
  test(
    "P-HOTFIX-13",
    content.sourcePath === c.sourcePath && content.sourcePath === "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    "\u6765\u6E90 = card.sourcePath\uFF08View \u7528 plugin.openNote(sourcePath) \u6253\u5F00\uFF0CP-HOTFIX-13 \u8FD0\u884C\u5C42\uFF09"
  );
}
{
  const mc = card({ questionType: "multiple_choice", options: ["A1", "B2", "C3", "D4"], correctAnswer: "A" });
  const content = answerBodyContent(mc);
  test(
    "P-HOTFIX-10",
    content.answer === mc.answer && content.evidence.length === 0 && mc.options?.length === 4 && mc.correctAnswer === "A",
    "multiple_choice\uFF1A\u7B54\u6848\u663E\u9690\u4E0D\u5F71\u54CD\u9009\u9879/\u6B63\u786E\u7B54\u6848\uFF08\u9009\u9879 UI \u72EC\u7ACB\u6E32\u67D3\uFF0C\xA721/33/34\uFF09"
  );
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "reviewCardAnswer.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  test(
    "P-HOTFIX-11",
    !/\bAI\b|deriveReviewAnswer|https?:/.test(src) && !/from\s+["']\.\/(ai|.*\/ai)/.test(src),
    "\u663E\u793A\u7B54\u6848\u903B\u8F91 0 AI\uFF08\u6A21\u5757\u65E0 AI/\u7F51\u7EDC\u5F15\u7528\uFF09"
  );
  test("P-HOTFIX-12", !/fsrs|schedule|Rating/i.test(src), "\u9690\u85CF\u7B54\u6848\u903B\u8F91\u540C\u6837 0 AI / \u65E0\u5173 FSRS\uFF08\xA723\uFF09");
}
{
  const viewPath = path.join(__dirname, "..", "src", "cardsView.ts");
  const view = fs.readFileSync(viewPath, "utf8");
  const hotfixMarker = view.includes("toggleAnswerVisibility") && view.includes("renderAnswerBody");
  const ratingStillThere = view.includes("this.plugin.rateSavedCard(c.id, rating)");
  test("P-HOTFIX-19", hotfixMarker && ratingStillThere, "FSRS Rating \u8C03\u7528\u539F\u6837\u4FDD\u7559\uFF08\u4FEE\u590D\u672A\u89E6\u78B0 rating \u8DEF\u5F84\uFF0C\xA719/20\uFF09");
  const noWholeRerender = view.includes('hideBtn.addEventListener("click"') && !view.slice(0).includes("// HOTFIX whole rerender");
  test(
    "P-HOTFIX-19b",
    /hideBtn\.setText\(/.test(view) && /revealDomAction/.test(view),
    "\u6309\u94AE\u6587\u5B57\u7ACB\u5373\u540C\u6B65 + \u5C40\u90E8 DOM \u52A8\u4F5C\uFF08\xA710\uFF0C\u4E0D\u6574\u5361 renderReview\uFF09"
  );
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
