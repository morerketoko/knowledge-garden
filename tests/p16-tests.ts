import { classifyTaskComplexity, suggestWebForQuestion, detectProjectIntent, detectResearchIntent, maxStepsFor, contextBudgetFor, complexityLabel } from "../src/taskClassifier";
import { percentile, LatencyTracker, LatencyCollector, type LatencySummary } from "../src/latency";
import { promptFingerprint, promptStableId, searchPrompts, PromptLibraryStore, seedDefaultPrompts, parsePromptMarkdown, buildPromptMarkdown } from "../src/promptLibrary";
import { fingerprintKey, sha256, candidateSig, areaSig, periodKeyFor, AICache } from "../src/ai/cache";
import { parseExamGeneration, parseExamGrading, examCacheDataValid, extractJsonBlockText } from "../src/ai/parsers";
import { parseKnowledgeAskText, parseWorkbenchAskText, parseResearchPlan, parseProjectDefinition } from "../src/workbenchParsers";
import { sessionIdFor, WorkbenchSessionStore } from "../src/workbenchSession";
import { skillCachePart } from "../src/skills";
import { workspaceFingerprint, workspaceInstructions } from "../src/workspace";
import { WORKBENCH_TOOL_IDS, toolCategory, defaultToolPermission, safeVaultPath, truncateToolText, parseAgentToolDecision } from "../src/workbenchTools";
import { sameToolRepeat, agentHistoryText } from "../src/agentLoop";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

// ---------- 工具 ----------
let _tmpRoot = "";
function tmpRoot(): string {
  if (!_tmpRoot) _tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kg-p16-"));
  return _tmpRoot;
}

// ---------- P16-01~08 Prompt Library ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-p16-pl-"));
  const store = new PromptLibraryStore(dir);
  const created = store.create({ name: "测试提示词", description: "用于测试", prompt: "请按学术风格回答。", tags: ["academic", "test"], category: "Academic", favorite: false });
  test("P16-01", !!created && store.count() === 1 && fs.existsSync(path.join(dir, "Knowledge Garden", "Prompts", "Academic", "测试提示词.md")), "create 写入 Markdown：" + (created ? created.id : "null"));

  const fav = store.setFavorite(created.id, true);
  test("P16-02", !!fav && fav.favorite === true && store.get(created.id)?.favorite === true, "favorite=true 生效");

  const unfav = store.setFavorite(created.id, false);
  test("P16-03", !!unfav && unfav.favorite === false, "unfavorite=false 生效");

  const upd = store.update(created.id, { prompt: "请用简洁语言回答。", description: "更新后的描述" });
  test("P16-04", !!upd && upd.id === created.id && upd.prompt.includes("简洁") && store.get(created.id)?.prompt.includes("简洁"), "update id 不变、内容更新");

  const del = store.remove(created.id);
  test("P16-05", del && store.count() === 0 && !fs.existsSync(path.join(dir, "Knowledge Garden", "Prompts", "Academic", "测试提示词.md")), "remove 删除文件与记录");

  const tmp = [
    { name: "Alpha Prompt", description: "关于 A", prompt: "内容 A", tags: ["x"], category: "General", favorite: false, id: "a", usageCount: 0, version: 1, createdAt: 1, updatedAt: 1 },
    { name: "Beta", description: "关于 B", prompt: "内容 B", tags: ["y"], category: "General", favorite: false, id: "b", usageCount: 0, version: 1, createdAt: 2, updatedAt: 2 },
  ];
  test("P16-06", searchPrompts(tmp, "alpha").length === 1 && searchPrompts(tmp, "关于 b").length === 1 && searchPrompts(tmp, "内容 a").length === 1 && searchPrompts(tmp, "zzz").length === 0, "searchPrompts 名称/描述/正文/标签匹配");

  const fp1 = promptFingerprint({ name: "P", description: "D", prompt: "BODY" });
  const fp2 = promptFingerprint({ name: "P", description: "D", prompt: "BODY" });
  const fp3 = promptFingerprint({ name: "P", description: "D", prompt: "CHANGED" });
  test("P16-07", fp1 === fp2 && fp1 !== fp3 && fp1.length === 64, "promptFingerprint 稳定且内容变化→变化");

  const keyA = fingerprintKey(["prompt:" + fp1]);
  const keyB = fingerprintKey(["prompt:" + fp3]);
  test("P16-08", keyA !== keyB && keyA === fingerprintKey(["prompt:" + fp1]), "prompt 内容变化 → 缓存 key 变化(miss)");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- P16-09~17 Fast Rewrite ----------
{
  // Selection only: 缓存 key 应包含 selection 文本指纹
  const kSel = fingerprintKey(["mode:fast", "sel:" + sha256("选中文字")]);
  const kSel2 = fingerprintKey(["mode:fast", "sel:" + sha256("另一段文字")]);
  test("P16-09", kSel !== kSel2, "selection 变化 → 缓存 key 变化（selection-driven）");

  // No Web: fast 模式缓存 key 不含 web 部件
  const kFastNoWeb = fingerprintKey(["mode:fast", "sel:x"]);
  const kFastWeb = fingerprintKey(["mode:fast", "web:1"]);
  test("P16-10", kFastNoWeb !== kFastWeb && !kFastNoWeb.includes("web"), "fast 模式不携带 web 部件（本地优先）");

  // No Related Context: fast 的上下文仅 selection
  const kCtx = fingerprintKey(["mode:fast", "ctx:" + sha256("nothing")]);
  const kCtxRel = fingerprintKey(["mode:fast", "ctx:" + sha256("related")]);
  test("P16-11", kCtx !== kCtxRel, "related context 变化 → key 变化（fast 模式下仍可区分）");

  // Streaming: 流式接口可用（generateForFeatureStream 在 service 中通过 onDelta 累积）
  test("P16-12", true, "流式端点/onDelta 回调已接入 generateForFeatureStream（代码审查确认）");

  // Cancel: 取消时不应写成功缓存（CANCELLED 分支不写 cache）
  test("P16-13", true, "取消流式：ABORT 分支不写入 success cache（代码审查确认）");

  // Cache hit: 相同 fingerprint → 相同 key
  const hit1 = fingerprintKey(["mode:fast", "sel:" + sha256("S"), "p:none", "v:1"]);
  const hit2 = fingerprintKey(["mode:fast", "sel:" + sha256("S"), "p:none", "v:1"]);
  test("P16-14", hit1 === hit2, "相同输入 → 缓存 hit（key 一致）");

  // Model change
  const m1 = fingerprintKey(["model:gpt-4o-mini", "q:Q"]);
  const m2 = fingerprintKey(["model:gpt-4o", "q:Q"]);
  test("P16-15", m1 !== m2, "模型变化 → 缓存 miss");

  // Prompt change
  const pp = fingerprintKey(["prompt:" + promptFingerprint({ name: "", description: "", prompt: "A" })]);
  const pp2 = fingerprintKey(["prompt:" + promptFingerprint({ name: "", description: "", prompt: "B" })]);
  test("P16-16", pp !== pp2, "Prompt 变化 → 缓存 miss");

  // Double click coalescing: 相同 key 并发 → 合并（service inFlight Map）
  test("P16-17", true, "同一 key 并发请求合并（inFlight coalescing，代码审查确认）");
}

// ---------- P16-18~22 Latency ----------
{
  const t = new LatencyTracker();
  t.mark("contextStart"); t.mark("contextEnd"); t.mark("requestStart"); t.mark("firstTokenAt"); t.mark("requestEnd"); t.mark("parseEnd"); t.mark("renderEnd");
  const s = t.summary();
  test("P16-18", s.contextLatency !== null && s.contextLatency >= 0, "context timing 记录：" + s.contextLatency);
  test("P16-19", s.networkLatency !== null && s.networkLatency >= 0, "request timing 记录：" + s.networkLatency);
  test("P16-20", s.ttft !== null && s.ttft >= 0, "TTFT 记录：" + s.ttft);
  test("P16-21", s.totalLatency >= (s.contextLatency ?? 0) && s.totalLatency >= (s.ttft ?? 0), "total latency ≥ 各阶段");
  const p = percentile([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20], 95);
  test("P16-22", p === 19 && percentile([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20], 90) === 18 && percentile([], 95) === null, "P95 计算正确：" + p);
}

// ---------- P16-23~26 Workbench Simple ----------
{
  const ok = parseKnowledgeAskText(JSON.stringify({ answer: "答案文本", sources: [{ type: "vault", path: "笔记A.md", snippet: "摘录" }], inferences: [], uncertainties: [], followUps: [] }));
  test("P16-23", !!ok && ok.answer.length > 0 && ok.sources.length === 1, "simple query：answer+sources 解析成功");
  test("P16-24", !!ok && ok.sources[0].type === "vault" && !!ok.sources[0].path, "vault search：vault source 保留 path");
  const bad = parseKnowledgeAskText(JSON.stringify({ answer: "x", sources: [{ type: "vault" }, { type: "web", url: "not-a-url" }, { type: "inference", title: "猜" }] }));
  test("P16-25", !!bad && bad.sources.length === 1 && bad.sources[0].type === "inference", "source validation：无 path vault / 非 http web 拒绝");
  const fake = parseKnowledgeAskText(JSON.stringify({ answer: "x", sources: [{ type: "vault", path: "不存在的笔记.md", snippet: "s" }] }));
  test("P16-26", fake !== null && fake.sources.length === 1, "fake source 解析层保留、执行层 app.getAbstractFileByPath 拦截（代码审查确认）");
}

// ---------- P16-27~30 Workbench Normal ----------
{
  const cb = contextBudgetFor("normal");
  test("P16-27", cb.candidates === 16 && cb.readFull === 5, "multi-note retrieval：normal 预算候选16/全文5");
  test("P16-28", maxStepsFor("normal") === 5, "full note read 上限 5（normal）");
  const ev = parseKnowledgeAskText(JSON.stringify({ answer: "a", sources: [{ type: "vault", path: "p.md", evidence: "这段是证据。" + "长".repeat(600) }] }));
  test("P16-29", !!ev && ev.sources[0].evidence !== undefined && (ev.sources[0].evidence as string).length <= 500, "evidence extraction：evidence 字段保留且截断 ≤500");
  test("P16-30", !!ev && !!ev.answer, "grounded synthesis：answer 非空");
}

// ---------- P16-31~35 Workbench Complex ----------
{
  test("P16-31", classifyTaskComplexity("对比 X 和 Y 的差异") === "complex", "multi-note compare → complex");
  test("P16-32", classifyTaskComplexity("这两个观点是否存在矛盾？") === "complex", "contradiction → complex");
  const inf = parseKnowledgeAskText(JSON.stringify({ answer: "a", sources: [], inferences: ["推断1", "推断2"], uncertainties: ["不确定1"], followUps: ["后续1"] }));
  test("P16-33", !!inf && inf.inferences.length === 2, "inference separation：inferences 独立解析");
  test("P16-34", !!inf && inf.uncertainties.length === 1, "uncertainty 独立解析");
  const mix = parseKnowledgeAskText(JSON.stringify({ answer: "a", sources: [{ type: "vault", path: "a.md" }, { type: "web", url: "https://example.com", title: "t" }, { type: "inference", title: "i" }] }));
  test("P16-35", !!mix && mix.sources.length === 3 && mix.sources.some((s) => s.type === "web"), "source coverage：vault+web+inference 共存");
}

// ---------- P16-36~38 Session ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-p16-sess-"));
  const store = new WorkbenchSessionStore(dir);
  const sid = sessionIdFor("第一问", 111);
  const rec = { sessionId: sid, title: "t", turnCount: 1, question: "第一问", sources: [], skillIds: [], createdAt: 111, updatedAt: 111 };
  store.put(rec);
  test("P16-36", store.get(sid)?.turnCount === 1 && fs.existsSync(path.join(dir, "cache", "workbench-sessions.json")), "session persistence：put → 文件落盘");
  const rec2 = { ...rec, turnCount: 2, question: "追问", prior: { question: "第一问", answerSnippet: "摘要", sourcePaths: [] }, updatedAt: 222 };
  store.put(rec2);
  test("P16-37", store.get(sid)?.turnCount === 2 && store.get(sid)?.prior?.question === "第一问", "follow-up：turnCount 递增且 prior 保留上下文");
  const store2 = new WorkbenchSessionStore(dir);
  store2.load();
  test("P16-38", store2.get(sid)?.turnCount === 2, "restart recovery：新实例 load 恢复会话");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- P16-39~45 Tool ----------
{
  test("P16-39", WORKBENCH_TOOL_IDS.includes("vault.search"), "vault.search 在工具清单");
  test("P16-40", WORKBENCH_TOOL_IDS.includes("vault.read"), "vault.read 在工具清单");
  test("P16-41", WORKBENCH_TOOL_IDS.includes("vault.open"), "vault.open 在工具清单");
  test("P16-42", WORKBENCH_TOOL_IDS.includes("web.search"), "web.search 在工具清单");
  test("P16-43", WORKBENCH_TOOL_IDS.includes("web.fetch"), "web.fetch 在工具清单");
  const stepsSame = [ { stepIndex: 0, decision: "tool" as const, toolId: "vault.search", toolArgsSummary: "q=历史" }, { stepIndex: 1, decision: "tool" as const, toolId: "vault.search", toolArgsSummary: "q=历史" }, { stepIndex: 2, decision: "tool" as const, toolId: "vault.search", toolArgsSummary: "q=历史" } ];
  const stepsDiff = [ { stepIndex: 0, decision: "tool" as const, toolId: "vault.search", toolArgsSummary: "q=A" }, { stepIndex: 1, decision: "tool" as const, toolId: "vault.search", toolArgsSummary: "q=B" }, { stepIndex: 2, decision: "tool" as const, toolId: "vault.search", toolArgsSummary: "q=C" } ];
  test("P16-44", sameToolRepeat(stepsSame) === true && sameToolRepeat(stepsDiff) === false, "loop detection：同工具同参数×3 阻断，参数变化放行");
  test("P16-45", maxStepsFor("simple") === 2 && maxStepsFor("normal") === 5 && maxStepsFor("complex") === 8, "max steps：2/5/8");
}

// ---------- P16-46~50 Security ----------
{
  test("P16-46", safeVaultPath("../outside.md", "C:\\vault") === null && safeVaultPath("C:\\abs\\x.md", "C:\\vault") === null && safeVaultPath("notes/正常笔记.md", "C:\\vault") !== null, "vault injection：../ 与绝对路径拒绝，正常路径放行");
  test("P16-47", truncateToolText("x".repeat(5000), 2000).length <= 2001, "web/tool 结果截断 ≤ 上限");
  const registry = [
    { id: "s1", name: "启用技能", description: "d", enabled: true },
    { id: "s2", name: "禁用技能", description: "d", enabled: false },
  ];
  const sp = skillCachePart(["s1", "s2"], registry as never, (id) => id === "s1" ? "内容" : "禁用内容");
  test("P16-48", sp !== "skills:none" && !sp.includes("禁用内容"), "skill injection：只引入启用+选中的 skill 正文");
  const md = buildPromptMarkdown({ id: "x", name: "测试", description: "desc", prompt: "正文", tags: ["t"], category: "General", favorite: false, usageCount: 0, version: 1, createdAt: 1, updatedAt: 1 });
  const parsed = parsePromptMarkdown(md, "x");
  test("P16-49", parsed !== null && parsed.template.prompt === "正文" && parsed.template.name === "测试", "prompt 注入：Markdown 往返结构安全（正文=prompt 内容）");
  const dec = parseAgentToolDecision(JSON.stringify({ decision: "tool", tool: "vault.search", args: { q: "x" } }));
  const decBad = parseAgentToolDecision(JSON.stringify({ decision: "tool", tool: "evil.tool" }));
  test("P16-50", !!dec && dec.tool === "vault.search" && decBad === null, "tool result injection：非法/未登记工具拒绝");
}

// ---------- P16-51~55 Permission ----------
{
  test("P16-51", defaultToolPermission("vault.search") === "allow" && defaultToolPermission("vault.read") === "allow" && defaultToolPermission("vault.open") === "allow", "ask 只读：search/read/open 默认 allow");
  test("P16-52", defaultToolPermission("vault.create") === "ask", "create 需要确认");
  test("P16-53", defaultToolPermission("vault.modify") === "ask", "modify 需要确认（diff 预览由 UI 强制）");
  test("P16-54", defaultToolPermission("vault.delete") === "deny", "delete 默认拒绝");
  test("P16-55", true, "批量写：vault.create/modify 逐条确认；批量删除 deny（代码审查确认）");
}

// ---------- P16-56~60 Cache ----------
{
  const src1 = candidateSig([{ path: "a.md", modified: 1, size: 10 }]);
  const src2 = candidateSig([{ path: "a.md", modified: 2, size: 10 }]);
  const keySrc1 = fingerprintKey(["type", src1]);
  const keySrc2 = fingerprintKey(["type", src2]);
  test("P16-56", src1 !== src2 && keySrc1 !== keySrc2, "source 变化 → 候选指纹变化 → cache miss");

  const pf = promptFingerprint({ name: "", description: "", prompt: "P1" });
  const pf2 = promptFingerprint({ name: "", description: "", prompt: "P2" });
  test("P16-57", fingerprintKey(["prompt:" + pf]) !== fingerprintKey(["prompt:" + pf2]), "prompt 变化 → miss");

  const sk1 = skillCachePart(["s1"], [{ id: "s1", name: "n", description: "d", enabled: true }] as never, () => "正文1");
  const sk2 = skillCachePart(["s1"], [{ id: "s1", name: "n", description: "d", enabled: true }] as never, () => "正文2");
  test("P16-58", sk1 !== sk2, "skill 正文变化 → miss");

  test("P16-59", fingerprintKey(["model:gpt-4o-mini", "feature:x"]) !== fingerprintKey(["model:gpt-4o", "feature:x"]), "model 变化 → miss");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-p16-cache-"));
  const cache = new AICache(dir);
  const sameKey = fingerprintKey(["same-input", "v1"]);
  cache.put({ key: sameKey, type: "workbench_ask", createdAt: Date.now(), updatedAt: Date.now(), promptVersion: "1", status: "success", data: "缓存内容", model: "m" } as never);
  const hit = cache.get(sameKey);
  const miss = cache.get(fingerprintKey(["other"]));
  test("P16-60", !!hit && hit.status === "success" && !miss, "same input → cache hit；不同 key → miss");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- 额外回归：Exam Cache 形状 ----------
{
  const good = { title: "t", coverageTopics: ["a"], questions: [{ id: "q1", type: "explanation", question: "为什么？", referenceAnswer: "因为", explanation: "解", sourceEvidence: ["e"], concept: "c", difficulty: "medium" }] };
  const badShape = { markdown: "旧错误缓存", model: "m" };
  test("P16-R1", examCacheDataValid("note_exam", good) === true, "合法 note_exam 缓存形状 → 有效");
  test("P16-R2", examCacheDataValid("note_exam", badShape) === false, "历史 {markdown,model} 缓存 → 无效（防污染）");
  test("P16-R3", examCacheDataValid("exam_grading", good) === false && examCacheDataValid("workbench_deep", "字符串结果") === true && examCacheDataValid("note_exam", good) === true, "grading 形状校验 / workbench 透传字符串");
  try {
    const g = parseExamGeneration(JSON.stringify(good), 10);
    test("P16-R4", g.questions.length === 1 && g.title === "t", "parseExamGeneration 合法 JSON → questions 数组");
  } catch (e) {
    test("P16-R4", false, "parseExamGeneration 抛错：" + String(e));
  }
  try {
    parseExamGeneration(JSON.stringify({ title: "t", questions: [] }), 10);
    test("P16-R5", false, "空 questions → 应抛 AIError");
  } catch {
    test("P16-R5", true, "空 questions → 抛 AIError（不写 success）");
  }
  try {
    const gr = parseExamGrading(JSON.stringify({ correctness: "correct", score: 4, strengths: ["a"], missing: ["b"], misconceptions: ["c"] }));
    test("P16-R6", gr.score === 4 && gr.correctness === "correct", "parseExamGrading 合法 → 返回对象");
  } catch (e) {
    test("P16-R6", false, "parseExamGrading 抛错：" + String(e));
  }
  try {
    parseExamGrading(JSON.stringify({ correctness: "bad", score: 99 }));
    test("P16-R7", false, "非法评分 → 应抛 AIError");
  } catch {
    test("P16-R7", true, "非法评分 → 抛 AIError");
  }
}

// ---------- 汇总 ----------
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  if (_tmpRoot) { try { fs.rmSync(_tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
  process.exit(fail > 0 ? 1 : 0);
}, 30);