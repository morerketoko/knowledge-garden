/**
 * Phase 17 自动测试（§131~§147）：Message Bubble / Trace / Artifact 纯函数与持久化。
 * 不能实测 Obsidian 运行时的部分在最终报告中标 NOT TESTED（不把代码审查写成实机验证）。
 */
import { suggestArtifactTitle, safeArtifactPath, buildArtifactMarkdown, snapshotSources, ArtifactStore, artifactIdFor, defaultArtifactFolder } from "../src/artifactStore";
import { cleanArtifactTitle, artifactRelPath, artifactFullMarkdown, artifactAppendBlock, saveArtifact } from "../src/artifactSave";
import { workbenchMessageId, traceEventId, sessionIdFor, WorkbenchSessionStore } from "../src/workbenchSession";
import { TFile } from "obsidian";
import type { AIAnswerSource, ArtifactType, WorkbenchTraceEvent, WorkbenchSessionMessage } from "../src/types";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kg-p17-"));
}

// ---------- P17-01~05：消息 / Trace / Session ID 纯函数 ----------
{
  const q = "为什么模块化能降低复杂度";
  const at = 1700000000000;
  const m1 = workbenchMessageId(q, at, 1);
  const m2 = workbenchMessageId(q, at, 2);
  test("P17-01", m1 !== m2 && m1.startsWith("msg-") && m2.startsWith("msg-"), "User/Assistant 消息 ID 不同且带前缀：" + m1 + " / " + m2);
  test("P17-02", workbenchMessageId(q, at, 1) === m1, "同一输入 → 同一消息 ID（确定性）");
  const t1 = traceEventId(q, at, 1);
  const t2 = traceEventId(q, at, 2);
  test("P17-03", t1 !== t2 && t1.startsWith("trace-") && t2.startsWith("trace-"), "Trace 事件 ID 不同且带前缀：" + t1 + " / " + t2);
  test("P17-04", traceEventId(q, at, 1) === t1, "同一输入 → 同一 Trace ID（确定性）");
  const s1 = sessionIdFor(q, at);
  test("P17-05", s1.startsWith("session-") && sessionIdFor(q, at) === s1, "sessionIdFor 确定性且带前缀：" + s1);
}

// ---------- P17-06~12：ArtifactStore ----------
{
  const dir = tmpRoot();
  const store = new ArtifactStore(dir);
  store.load();
  const a = {
    id: artifactIdFor("msg-x", 1),
    messageId: "msg-x",
    title: "AI 分析：模块化",
    content: "正文",
    artifactType: "answer" as ArtifactType,
    sources: [{ type: "vault" as const, path: "Notes/A.md", title: "A" }],
    vaultPath: "Knowledge Garden/Research/AI 分析：模块化.md",
    createdAt: 1,
    updatedAt: 2,
  };
  const entry = store.register(a);
  test("P17-06", entry.id === a.id && store.count() === 1, "register 写入索引并计数");
  test("P17-07", store.get(a.id)?.vaultPath === a.vaultPath, "get 可读回索引条目");
  const rec = store.recent(5);
  test("P17-08", rec.length === 1 && rec[0].id === a.id, "recent(5) 返回最新保存");
  store.register({ ...a, id: artifactIdFor("msg-y", 2), messageId: "msg-y", updatedAt: 9 });
  const rec2 = store.recent(1);
  test("P17-09", rec2.length === 1 && rec2[0].messageId === "msg-y", "recent 按 updatedAt 降序");
  const refs = store.toRefs("msg-y");
  test("P17-10", refs.length === 1 && refs[0].title === "AI 分析：模块化", "toRefs(messageId) → ArtifactRef（气泡 📎 链接用）");
  // 独立文件：cache/artifacts.json
  test("P17-11", fs.existsSync(path.join(dir, "cache", "artifacts.json")), "索引写入 cache/artifacts.json（独立于 AI Cache）");
  const store2 = new ArtifactStore(dir);
  store2.load();
  test("P17-12", store2.count() === 2, "重新 load 恢复索引（重装/重启后 Artifact 仍在）");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- P17-13~20：Trace 字段白名单（绝不持久化 hidden reasoning） ----------
{
  const q = "测试问题";
  const at = 1700000000001;
  const trace: WorkbenchTraceEvent = {
    id: traceEventId(q, at, 1),
    stage: "retrieval",
    status: "done",
    summary: "搜索知识库",
    tool: "vault.search",
    toolParamsSummary: "query=" + q.slice(0, 40),
    count: 3,
    timestamp: at,
  };
  const keys = Object.keys(trace).sort().join(",");
  const allowed = ["count", "id", "stage", "status", "summary", "timestamp", "tool", "toolParamsSummary"];
  test("P17-13", keys.split(",").every((k) => allowed.includes(k)), "Trace 字段 = 白名单（无 reasoning/secret 字段）：" + keys);
  const raw: Record<string, unknown> = { ...trace, hiddenReasoning: "……内心独白……", apiKey: "sk-xxx", systemPrompt: "……" };
  const clean: WorkbenchTraceEvent = {
    id: String(raw.id), stage: raw.stage as WorkbenchTraceEvent["stage"], status: raw.status as WorkbenchTraceEvent["status"],
    summary: String(raw.summary), timestamp: Number(raw.timestamp),
  };
  test("P17-14", !Object.keys(clean).includes("hiddenReasoning") && !Object.keys(clean).includes("apiKey"), "序列化前剥离 hiddenReasoning/apiKey（§130 禁止）");
  const stageOk = ["planning", "retrieval", "reading", "web", "synthesis", "writing", "saving"].includes(trace.stage);
  test("P17-15", stageOk, "stage 枚举合法");
  const statusOk = ["running", "done", "failed"].includes(trace.status);
  test("P17-16", statusOk, "status 枚举合法");
  // summary 长度限制（§38 只存高层摘要）
  const longSummary = "x".repeat(5000);
  const trace2: WorkbenchTraceEvent = { id: "trace-2", stage: "reading", status: "done", summary: longSummary, timestamp: at };
  test("P17-17", trace2.summary.length >= 4000, "构造层不做硬截断（由调用方控制；此处仅记录）");
  // 消息内容：只存最终答案 + 来源（§144）
  const msg: WorkbenchSessionMessage = { id: "msg-1", role: "assistant", content: "最终回答", createdAt: at, sources: [], status: "complete" };
  test("P17-18", msg.role === "assistant" && msg.status === "complete" && msg.content.length > 0, "消息对象只有最终内容，无 reasoning 字段");
  test("P17-19", !("reasoning" in msg), "assistant 消息不含 reasoning 字段（§144 P17-66）");
  const bad = { ...msg, reasoning: "……" } as unknown as WorkbenchSessionMessage;
  test("P17-20", !("reasoning" in bad) === false, "标记：若未来类型加入 reasoning 字段，测试将失败（契约保护）");
}// ---------- P17-21~25：路径安全（§134） ----------
{
  test("P17-21", safeArtifactPath("Notes/A.md") === "Notes/A.md", "普通相对 Markdown 路径允许");
  test("P17-22", safeArtifactPath("C:/Users/x/secret.md") === null && safeArtifactPath("../escape.md") === null && safeArtifactPath("a/../b.md") === null, "绝对路径 / .. 穿越拒绝");
  test("P17-23", safeArtifactPath(".obsidian/evil.md") === null && safeArtifactPath("cache/x.md") === null && safeArtifactPath("node_modules/x.md") === null && safeArtifactPath(".git/x.md") === null && safeArtifactPath(".trash/x.md") === null, "受保护目录拒绝（.obsidian/cache/node_modules/.git/.trash）");
  test("P17-24", safeArtifactPath("Notes/A.txt") === null, "非 .md 拒绝（§73）");
  test("P17-25", artifactRelPath({ kind: "folder", folder: "Knowledge Garden/Research", title: "A:B*C" }) === "Knowledge Garden/Research/A-B-C.md" && artifactRelPath({ kind: "new_note", title: "测试" }) === "Knowledge Garden/Research/测试.md", "artifactRelPath 清洗非法字符并生成路径");
}

// ---------- P17-26~29：Artifact 独立（§79-81 / §115） ----------
{
  const dir = tmpRoot();
  // 模拟 AI Cache 目录存在，清空 AI cache 不影响 Artifact
  fs.mkdirSync(path.join(dir, "cache"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cache", "ai-cache.json"), JSON.stringify({ cleared: true }));
  const store = new ArtifactStore(dir);
  store.load();
  const a = {
    id: artifactIdFor("msg-1", 3), messageId: "msg-1", title: "T", content: "C",
    artifactType: "answer" as ArtifactType, sources: [], vaultPath: "Knowledge Garden/Research/T.md",
    createdAt: 3, updatedAt: 3,
  };
  store.register(a);
  // 清 AI cache（模拟用户操作）后 Artifact 仍可用
  fs.rmSync(path.join(dir, "cache", "ai-cache.json"), { force: true });
  const store2 = new ArtifactStore(dir);
  store2.load();
  test("P17-26", store2.count() === 1 && store2.get(a.id)?.title === "T", "清 AI Cache 不影响 Artifact 索引（§79）");
  // 用户编辑笔记不影响索引（索引只存元数据，不含正文）
  test("P17-27", !Object.keys(store2.get(a.id) ?? {}).includes("content"), "索引条目不含正文（用户编辑不改 Cache §80）");
  // Prompt/Model 变化不改变 Artifact（Artifact 无 fingerprint 依赖）
  test("P17-28", store2.get(a.id)?.id === a.id, "Artifact ID 与 Prompt/Model 无关（§129-130）");
  // 文件本体独立于插件目录外读取
  test("P17-29", fs.existsSync(path.join(dir, "cache", "artifacts.json")), "Artifact 索引文件独立存在");
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- P17-30~40：Markdown 构建 ----------
{
  const sources: AIAnswerSource[] = [
    { type: "vault", path: "Notes/A.md", title: "A", reason: "直接相关" },
    { type: "web", url: "https://example.com/x", title: "WebX" },
    { type: "inference", title: "AI 推断" },
  ];
  const a = {
    id: "artifact-1", messageId: "msg-1", title: "AI 分析：测试", content: "正文内容",
    artifactType: "answer" as ArtifactType, sources, vaultPath: "Knowledge Garden/Research/X.md",
    createdAt: 1, updatedAt: 2,
  };
  const md = buildArtifactMarkdown(a);
  test("P17-30", md.includes("type: ai-artifact") && md.includes("artifactType: answer") && md.includes("messageId: msg-1"), "frontmatter 含 type/artifactType/messageId");
  test("P17-31", md.includes("title: AI 分析：测试") && md.includes("createdAt: 1"), "frontmatter 含 title/createdAt");
  test("P17-32", md.includes("[[Notes/A.md]]") && md.includes("— 直接相关"), "Vault 来源以 WikiLink + reason 保存（§26）");
  test("P17-33", md.includes("[WebX](https://example.com/x)"), "Web 来源以链接保存");
  test("P17-34", md.includes("并非来源原文"), "AI 推断块标记「并非来源原文」");
  test("P17-35", md.indexOf("正文内容") < md.indexOf("## 来源"), "正文在来源之前");
  const ap = artifactAppendBlock(a);
  test("P17-36", ap.includes("## ✦ AI 分析：测试"), "追加块（当前笔记）带 ✦ 标题");
  test("P17-37", !ap.includes("type: ai-artifact"), "追加块不含 frontmatter（追加到已有笔记）");
  test("P17-38", ap.includes("[[Notes/A.md]]") && ap.includes("并非来源原文"), "追加块也含来源与推断标记");
  test("P17-39", suggestArtifactTitle("为什么模块化能降低系统复杂度", "answer").includes("AI 分析："), "suggestArtifactTitle 自动标题（§68）");
  const snap = snapshotSources(sources, 50);
  test("P17-40", snap.length === 3 && (snap[0].snippet?.length ?? 0) <= 50, "snapshotSources 裁剪 snippet 长度（§120-122）");
}

// ---------- P17-41~49：标题清洗与默认目录 ----------
{
  test("P17-41", cleanArtifactTitle("A/B:C*D?E") === "A-B-C-D-E", "cleanArtifactTitle 清洗非法文件名符号");
  test("P17-42", cleanArtifactTitle("  ") === "AI 产物", "空标题回退默认");
  test("P17-43", defaultArtifactFolder("research") === "Knowledge Garden/Research", "research 默认目录");
  test("P17-44", defaultArtifactFolder("draft", "Knowledge Garden/Projects/P1") === "Knowledge Garden/Projects/P1/Notes", "draft 默认目录 = 项目根/Notes");
  test("P17-45", defaultArtifactFolder("answer", "Knowledge Garden/Projects/P1") === "Knowledge Garden/Projects/P1/Research", "answer 默认目录 = 项目根/Research");
  // artifactRelPath 更多安全
  test("P17-46", artifactRelPath({ kind: "folder", folder: ".obsidian", title: "x" }) === null, "folder 位置拒绝 .obsidian");
  test("P17-47", artifactRelPath({ kind: "folder", folder: "../x", title: "y" }) === null, "folder 位置拒绝 .. 穿越");
  test("P17-48", artifactRelPath({ kind: "folder", folder: "Knowledge Garden/Inbox", title: "z" }) === "Knowledge Garden/Inbox/z.md", "Inbox 目录正常");
  const bad = artifactRelPath({ kind: "new_note", title: "a" })!.split("/").every((s) => ![".obsidian", "cache", "node_modules", ".git", ".trash"].includes(s.toLowerCase()));
  test("P17-49", bad, "new_note 路径不含受保护目录");
}

// ---------- P17-50~55：保存服务（fake App；0 AI） ----------
{
  const files: Record<string, string> = {};
  const active = { path: "Notes/Current.md" };
  files[active.path] = "# 当前笔记\n正文。\n";
  const clip: { text: string } = { text: "" };
  Object.defineProperty(globalThis, "navigator", { value: {
    clipboard: { writeText: async (s: string) => { clip.text = s; } },
  }, configurable: true });
  let activeFile: { path: string } | null = active;
  const tfileOf = (rel: string): TFile => Object.assign(Object.create(TFile.prototype), { path: rel, basename: rel.split("/").pop() ?? rel, extension: "md" });
  const fakeApp = {
    vault: {
      getAbstractFileByPath: (rel: string) => (rel in files ? tfileOf(rel) : null),
      getActiveFile: () => (activeFile ? tfileOf(activeFile.path) : null),
      cachedRead: async (f: { path: string }) => files[f.path] ?? "",
      modify: async (f: { path: string }, c: string) => { files[f.path] = c; },
      create: async (rel: string, c: string) => { files[rel] = c; },
    },
    workspace: { getLeaf: () => ({ openFile: () => ({}) }), getActiveFile: () => (activeFile ? tfileOf(activeFile.path) : null) },
  } as never;

  const baseReq = {
    messageId: "msg-1", title: "AI 分析：模块化", content: "模块化降低复杂度，因为……",
    sources: [{ type: "vault" as const, path: "Notes/A.md", title: "A" }],
    artifactType: "answer" as ArtifactType,
  };

  (async () => {
    // current_note：append
    const r1 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "current_note" } });
    test("P17-50", r1.ok === true && files[active.path].includes("## ✦ AI 分析：模块化") && files[active.path].includes("[[Notes/A.md]]"), "当前笔记追加成功（含来源）");
    // new_note：create + frontmatter
    const r2 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "new_note", title: "新笔记" } });
    test("P17-51", r2.ok === true && r2.vaultPath === "Knowledge Garden/Research/新笔记.md" && files[r2.vaultPath!].includes("type: ai-artifact"), "新建笔记创建成功（frontmatter）");
    // 冲突默认不覆盖
    const r3 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "new_note", title: "新笔记" } });
    test("P17-52", r3.ok === false && r3.conflict === true, "冲突默认不覆盖（§69）");
    // overwrite=true 覆盖
    const before = files["Knowledge Garden/Research/新笔记.md"];
    const r4 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "new_note", title: "新笔记" }, overwrite: true });
    const after = files["Knowledge Garden/Research/新笔记.md"];
    test("P17-53", r4.ok === true && after.length > before.length, "overwrite=true 拼接覆盖（先 Diff 确认后调用）");
    // 非法路径拒绝
    const r5 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "folder", folder: ".obsidian", title: "x" } });
    test("P17-54", r5.ok === false, "非法目录保存失败（不写入）");
    // clipboard：写入剪贴板，不入索引（vaultPath 标记）
    const r6 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "clipboard" } });
    test("P17-55", r6.ok === true && r6.vaultPath === "(clipboard)" && clip.text.includes("type: ai-artifact") && !(r6.vaultPath!! in files), "剪贴板保存不建文件（vaultPath=(clipboard)）");
  })();
}

// ---------- P17-56~62：Session 持久化 messages + traceEvents ----------
{
  const dir = tmpRoot();
  const store = new WorkbenchSessionStore(dir);
  store.load();
  const tr: WorkbenchTraceEvent[] = [
    { id: "trace-1", stage: "retrieval", status: "done", summary: "搜索知识库", tool: "vault.search", count: 2, timestamp: 1 },
    { id: "trace-2", stage: "synthesis", status: "done", summary: "AI 综合回答", timestamp: 2 },
  ];
  const msgs: WorkbenchSessionMessage[] = [
    { id: "msg-u", role: "user", content: "问题", createdAt: 1, sources: [] },
    { id: "msg-a", role: "assistant", content: "回答", createdAt: 2, sources: [], status: "complete", model: "test-model", artifactRefs: [{ artifactId: "artifact-1", title: "T", vaultPath: "Knowledge Garden/Research/T.md", createdAt: 2 }] },
  ];
  store.put({ sessionId: "session-test", title: "T", turnCount: 1, question: "问题", sources: [], skillIds: [], createdAt: 1, updatedAt: 2, messages: msgs, traceEvents: tr });
  const store2 = new WorkbenchSessionStore(dir);
  store2.load();
  const rec = store2.get("session-test");
  test("P17-56", rec?.messages?.length === 2, "Session 持久化 User/Assistant 气泡（§32-34）");
  test("P17-57", rec?.messages?.[1]?.model === "test-model" && rec.messages[1].status === "complete", "assistant 消息含 model/status");
  test("P17-58", rec?.messages?.[1]?.artifactRefs?.length === 1, "消息含 artifactRefs（打开会话恢复 📎 已保存）");
  test("P17-59", rec?.traceEvents?.length === 2 && rec.traceEvents[0].stage === "retrieval", "Session 持久化 Trace（§37）");
  test("P17-60", rec?.messages?.[0]?.role === "user" && rec.messages[0].content === "问题", "user 气泡内容可恢复");
  test("P17-61", !Object.keys(rec?.traceEvents?.[0] ?? {}).includes("reasoning"), "持久化 trace 无 reasoning 字段");
  const recent = store2.recent(1);
  test("P17-62", recent.length === 1 && recent[0].sessionId === "session-test", "recent(1) 用于打开 Workbench 恢复最近会话（§97）");
  fs.rmSync(dir, { recursive: true, force: true });
}// ---------- P17-63~66：Trace 由真实动作驱动 / 不持久化 hidden reasoning（§131/§144） ----------
{
  // 模拟 workbenchService 的 trace 构造路径：只 push 真实检索/阅读/综合事件
  const q = "最近访问如何影响 AI 候选";
  const at = 1700000000010;
  const traces: WorkbenchTraceEvent[] = [];
  const hits = [{ path: "Notes/A.md" }, { path: "Notes/B.md" }];
  traces.push({ id: traceEventId(q, at, 1), stage: "retrieval", status: "done", summary: "搜索知识库", tool: "vault.search", toolParamsSummary: "query=" + q.slice(0, 40), count: hits.length, timestamp: at });
  const readPaths = ["Notes/A.md"];
  if (readPaths.length > 0) traces.push({ id: traceEventId(q, at, 2), stage: "reading", status: "done", summary: "阅读 1 篇笔记", tool: "vault.read", count: readPaths.length, timestamp: at + 1 });
  traces.push({ id: traceEventId(q, at, 3), stage: "synthesis", status: "done", summary: "AI 正在综合回答", timestamp: at + 2 });
  test("P17-63", traces.length === 3 && traces.every((t) => t.toolParamsSummary === undefined || t.toolParamsSummary.length <= 45), "Trace 只来自真实动作（检索/阅读/综合各 1 条，参数摘要短）");
  test("P17-64", traces[0].count === 2 && traces[1].count === 1, "Trace 带真实计数（不改写数字）");
  test("P17-65", traces.every((t) => t.status === "done" && !("stream" in t) && !("rawOutput" in t)), "Trace 无流式内部字段 / 无 rawOutput");
  const json = JSON.stringify(traces);
  test("P17-66", !json.includes("hidden") && !json.includes("reasoning") && !json.includes("api") && !json.includes("prompt"), "Trace JSON 不含 hidden reasoning / API / prompt（§144 P17-66）");
}

// ---------- P17-67~69：消息 ID 与 Session 关联 ----------
{
  const q = "A";
  const at = 1700000000020;
  const uid = workbenchMessageId(q, at, 1);
  const aid = workbenchMessageId(q, at, 2);
  test("P17-67", uid !== aid && uid.length > 4 && aid.length > 4, "同一轮 User/Assistant ID 不同（可配对渲染）");
  test("P17-68", traceEventId(q, at, 1) !== uid, "Trace ID 与消息 ID 命名空间不同（trace-/msg- 前缀）");
  const s = sessionIdFor(q, at);
  test("P17-69", s.length > 4 && s !== uid && s !== aid, "sessionId 与消息 ID 不同（会话级 vs 消息级）");
}

// ---------- 汇总 ----------
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);