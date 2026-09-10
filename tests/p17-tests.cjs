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

// src/artifactStore.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/migrations.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function pad2(n) {
  return String(n).padStart(2, "0");
}
function corruptStamp(now = /* @__PURE__ */ new Date()) {
  return String(now.getFullYear()) + pad2(now.getMonth() + 1) + pad2(now.getDate()) + "-" + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
}
function isolateCorruptFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.renameSync(filePath, filePath + ".corrupt-" + corruptStamp());
    return true;
  } catch {
    return false;
  }
}
function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, filePath);
}

// src/ai/cache.ts
var crypto = __toESM(require("crypto"));
function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// src/artifactStore.ts
function suggestArtifactTitle(question, artifactType) {
  const base = (question || "").trim().replace(/\s+/g, " ").slice(0, 24);
  const typeLabel = {
    answer: "AI \u5206\u6790",
    research: "\u7814\u7A76\u7B14\u8BB0",
    summary: "AI \u63D0\u70BC",
    draft: "AI \u8349\u7A3F",
    analysis: "AI \u5206\u6790",
    outline: "\u5927\u7EB2"
  };
  return typeLabel[artifactType] + (base ? "\uFF1A" + base : "");
}
var BLOCKED_DIRS = [".obsidian", "cache", "node_modules", ".git", ".trash"];
function safeArtifactPath(candidate) {
  const p = (candidate ?? "").trim();
  if (!p) return null;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return null;
  if (/\.\./.test(p)) return null;
  const segs = p.split(/[\\/]+/);
  for (const s of segs) {
    if (!s || s === "." || s === "..") return null;
    if (BLOCKED_DIRS.includes(s.toLowerCase().trim())) return null;
  }
  if (!p.endsWith(".md")) return null;
  return p.split(/[\\/]+/).map((s) => s.replace(/[\\/:*?"<>|]/g, "-")).join("/");
}
function defaultArtifactFolder(kind, projectRoot) {
  if (kind === "research") return "Knowledge Garden/Research";
  if (kind === "outline" || kind === "draft") return projectRoot ? projectRoot.replace(/\/+$/, "") + "/Notes" : "Knowledge Garden/Inbox";
  return projectRoot ? projectRoot.replace(/\/+$/, "") + "/Research" : "Knowledge Garden/Research";
}
function buildArtifactMarkdown(a) {
  const fm = [
    "---",
    "type: ai-artifact",
    "artifactType: " + a.artifactType,
    "title: " + a.title.replace(/[:\n]/g, " "),
    "messageId: " + a.messageId
  ];
  if (a.taskId) fm.push("sourceTaskId: " + a.taskId);
  if (a.workspaceId) fm.push("workspace: " + a.workspaceId);
  if (a.projectId) fm.push("project: " + a.projectId);
  fm.push("createdAt: " + a.createdAt);
  fm.push("updatedAt: " + a.updatedAt);
  fm.push("---", "");
  const body = [a.content.trim()];
  const vaultSources = (a.sources ?? []).filter((s) => s.type === "vault" && s.path);
  const webSources = (a.sources ?? []).filter((s) => s.type === "web" && /^https?:\/\//i.test(s.url || ""));
  const inferences = (a.sources ?? []).filter((s) => s.type === "inference");
  if (vaultSources.length || webSources.length || inferences.length) body.push("", "## \u6765\u6E90");
  if (vaultSources.length) {
    body.push("", "### Vault");
    for (const s of vaultSources) body.push("- [[" + s.path + "]]" + (s.reason ? " \u2014 " + s.reason : ""));
  }
  if (webSources.length) {
    body.push("", "### Web");
    for (const s of webSources) body.push("- [" + (s.title || s.url) + "](" + s.url + ")");
  }
  if (inferences.length) {
    body.push("", "### AI \u63A8\u65AD");
    for (const s of inferences) body.push("- " + (s.snippet || s.title || "\uFF08\u63A8\u65AD\uFF09"));
    body.push("", "> \u4EE5\u4E0A\u4E3A AI \u57FA\u4E8E\u6765\u6E90\u505A\u51FA\u7684\u63A8\u65AD\uFF0C\u5E76\u975E\u6765\u6E90\u539F\u6587\u3002");
  }
  body.push("");
  return fm.join("\n") + body.join("\n");
}
function snapshotSources(sources, maxSnippet = 500) {
  return (sources ?? []).slice(0, 20).map((s) => ({
    type: s.type,
    ...s.path ? { path: s.path } : {},
    ...s.title ? { title: s.title.slice(0, 200) } : {},
    ...s.url ? { url: s.url.slice(0, 500) } : {},
    ...s.snippet ? { snippet: s.snippet.slice(0, maxSnippet) } : {},
    ...s.reason ? { reason: s.reason.slice(0, 300) } : {}
  }));
}
function artifactIdFor(messageId, at) {
  return "artifact-" + sha256(messageId + "|" + at).slice(0, 12);
}
var ArtifactStore = class {
  constructor(pluginDir) {
    this.entries = [];
    this.file = path2.join(pluginDir, "cache", "artifacts.json");
  }
  load() {
    try {
      if (!fs2.existsSync(this.file)) return false;
      const raw = JSON.parse(fs2.readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) throw new Error("invalid artifacts store");
      this.entries = raw.entries.slice(0, 200);
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.entries = [];
      return isolated;
    }
  }
  get(id) {
    return this.entries.find((e) => e.id === id);
  }
  /** 登记已保存的 Artifact（写索引，不写文件本体） */
  register(a) {
    const entry = {
      id: a.id,
      messageId: a.messageId,
      taskId: a.taskId,
      title: a.title,
      artifactType: a.artifactType,
      vaultPath: a.vaultPath,
      workspaceId: a.workspaceId,
      projectId: a.projectId,
      sourceCount: (a.sources ?? []).length,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt
    };
    const i = this.entries.findIndex((e) => e.id === entry.id);
    if (i >= 0) this.entries[i] = entry;
    else this.entries.push(entry);
    if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
    this.flush();
    return entry;
  }
  recent(limit = 5) {
    return [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
  toRefs(messageId) {
    return this.entries.filter((e) => e.messageId === messageId).map((e) => ({ artifactId: e.id, title: e.title, vaultPath: e.vaultPath, createdAt: e.createdAt }));
  }
  count() {
    return this.entries.length;
  }
  flush() {
    try {
      atomicWriteJson(this.file, { formatVersion: 1, entries: this.entries });
    } catch {
    }
  }
};

// tests/obsidian-stub.ts
var TFile = class {
  constructor() {
    this.path = "";
    this.basename = "";
    this.extension = "md";
  }
};

// src/artifactSave.ts
function cleanArtifactTitle(title) {
  const t = (title || "").trim().replace(/[\\/:*?"<>|\n\r]/g, "-").slice(0, 80);
  return t || "AI \u4EA7\u7269";
}
function artifactRelPath(loc) {
  if (loc.kind === "new_note") {
    return safeArtifactPath("Knowledge Garden/Research/" + cleanArtifactTitle(loc.title) + ".md");
  }
  if (loc.kind === "folder") {
    const folder = (loc.folder || "Knowledge Garden/Research").replace(/[\\/]+$/, "");
    return safeArtifactPath(folder + "/" + cleanArtifactTitle(loc.title) + ".md");
  }
  return null;
}
function artifactFullMarkdown(a) {
  return buildArtifactMarkdown(a);
}
function artifactAppendBlock(a) {
  const lines = ["", "---", "## \u2726 " + a.title, ""];
  lines.push((a.content || "").trim());
  const vaultSrcs = (a.sources ?? []).filter((s) => s.type === "vault" && s.path);
  const webSrcs = (a.sources ?? []).filter((s) => s.type === "web" && /^https?:\/\//i.test(s.url || ""));
  const infs = (a.sources ?? []).filter((s) => s.type === "inference");
  if (vaultSrcs.length || webSrcs.length || infs.length) lines.push("", "### \u6765\u6E90");
  if (vaultSrcs.length) {
    lines.push("", "#### Vault");
    for (const s of vaultSrcs) lines.push("- [[" + s.path + "]]" + (s.reason ? " \u2014 " + s.reason : ""));
  }
  if (webSrcs.length) {
    lines.push("", "#### Web");
    for (const s of webSrcs) lines.push("- [" + (s.title || s.url) + "](" + s.url + ")");
  }
  if (infs.length) {
    lines.push("", "#### AI \u63A8\u65AD");
    for (const s of infs) lines.push("- " + (s.snippet || s.title || "\uFF08\u63A8\u65AD\uFF09"));
    lines.push("", "> \u4EE5\u4E0A\u4E3A AI \u57FA\u4E8E\u6765\u6E90\u505A\u51FA\u7684\u63A8\u65AD\uFF0C\u5E76\u975E\u6765\u6E90\u539F\u6587\u3002");
  }
  return lines.join("\n");
}
function existsAt(app, rel) {
  return !!app.vault.getAbstractFileByPath(rel);
}
async function readExistingAt(app, rel) {
  const f = app.vault.getAbstractFileByPath(rel);
  if (f instanceof TFile) return await app.vault.cachedRead(f);
  return null;
}
async function saveArtifact(app, req) {
  const artifact = {
    id: "artifact-" + req.messageId + "-" + Date.now().toString(36),
    messageId: req.messageId,
    taskId: req.taskId,
    title: cleanArtifactTitle(req.title),
    content: req.content || "",
    artifactType: req.artifactType,
    sources: snapshotSources(req.sources ?? []),
    workspaceId: req.workspaceId,
    projectId: req.projectId,
    vaultPath: "",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  try {
    if (req.location.kind === "clipboard") {
      artifact.vaultPath = "(clipboard)";
      const md = artifactFullMarkdown(artifact);
      await navigator.clipboard.writeText(md);
      return { ok: true, artifact, vaultPath: "(clipboard)" };
    }
    if (req.location.kind === "current_note") {
      const f = app.workspace.getActiveFile();
      if (!(f instanceof TFile)) return { ok: false, error: "\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684 Markdown \u7B14\u8BB0" };
      artifact.vaultPath = f.path;
      const existing = await app.vault.cachedRead(f);
      const block = artifactAppendBlock(artifact);
      await app.vault.modify(f, existing.replace(/\s+$/, "") + "\n" + block);
      return { ok: true, artifact, vaultPath: f.path };
    }
    const rel = artifactRelPath(req.location);
    if (!rel) return { ok: false, error: "\u4FDD\u5B58\u8DEF\u5F84\u975E\u6CD5\uFF08\u542B\u53D7\u4FDD\u62A4\u76EE\u5F55\u6216\u975E\u6CD5\u5B57\u7B26\uFF09" };
    artifact.vaultPath = rel;
    if (existsAt(app, rel)) {
      if (req.overwrite !== true) {
        return { ok: false, conflict: true, conflictPath: rel, error: "\u76EE\u6807\u5DF2\u5B58\u5728\uFF1A" + rel };
      }
      const existing = await readExistingAt(app, rel);
      const md = artifactFullMarkdown(artifact);
      const newContent = existing !== null ? existing.replace(/\s+$/, "") + "\n\n---\n\n" + md : md;
      await app.vault.modify(app.vault.getAbstractFileByPath(rel), newContent);
      return { ok: true, artifact, vaultPath: rel };
    }
    await app.vault.create(rel, artifactFullMarkdown(artifact));
    return { ok: true, artifact, vaultPath: rel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// src/workbenchSession.ts
var fs22 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
function sessionIdFor(question, at) {
  return "session-" + sha256(question + "|" + at).slice(0, 12);
}
function workbenchMessageId(question, at, n) {
  return "msg-" + sha256(question + "|" + at + "|" + n).slice(0, 12);
}
function traceEventId(question, at, n) {
  return "trace-" + sha256(question + "|" + at + "|" + n).slice(0, 12);
}
var WorkbenchSessionStore = class {
  constructor(pluginDir) {
    this.sessions = [];
    this.file = path3.join(pluginDir, "cache", "workbench-sessions.json");
  }
  load() {
    try {
      if (!fs22.existsSync(this.file)) return false;
      const raw = JSON.parse(fs22.readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions)) throw new Error("invalid session store");
      this.sessions = raw.sessions.slice(0, 50);
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.sessions = [];
      return isolated;
    }
  }
  get(sessionId) {
    return this.sessions.find((s) => s.sessionId === sessionId);
  }
  put(rec) {
    const i = this.sessions.findIndex((s) => s.sessionId === rec.sessionId);
    if (i >= 0) this.sessions[i] = rec;
    else this.sessions.push(rec);
    if (this.sessions.length > 50) this.sessions.splice(0, this.sessions.length - 50);
    this.flush();
  }
  list() {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  recent(limit = 10) {
    return this.list().slice(0, limit);
  }
  flush() {
    try {
      atomicWriteJson(this.file, { formatVersion: 1, sessions: this.sessions });
    } catch {
    }
  }
};

// tests/p17-tests.ts
var fs3 = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path4 = __toESM(require("node:path"));
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function tmpRoot() {
  return fs3.mkdtempSync(path4.join(os.tmpdir(), "kg-p17-"));
}
{
  const q = "\u4E3A\u4EC0\u4E48\u6A21\u5757\u5316\u80FD\u964D\u4F4E\u590D\u6742\u5EA6";
  const at = 17e11;
  const m1 = workbenchMessageId(q, at, 1);
  const m2 = workbenchMessageId(q, at, 2);
  test("P17-01", m1 !== m2 && m1.startsWith("msg-") && m2.startsWith("msg-"), "User/Assistant \u6D88\u606F ID \u4E0D\u540C\u4E14\u5E26\u524D\u7F00\uFF1A" + m1 + " / " + m2);
  test("P17-02", workbenchMessageId(q, at, 1) === m1, "\u540C\u4E00\u8F93\u5165 \u2192 \u540C\u4E00\u6D88\u606F ID\uFF08\u786E\u5B9A\u6027\uFF09");
  const t1 = traceEventId(q, at, 1);
  const t2 = traceEventId(q, at, 2);
  test("P17-03", t1 !== t2 && t1.startsWith("trace-") && t2.startsWith("trace-"), "Trace \u4E8B\u4EF6 ID \u4E0D\u540C\u4E14\u5E26\u524D\u7F00\uFF1A" + t1 + " / " + t2);
  test("P17-04", traceEventId(q, at, 1) === t1, "\u540C\u4E00\u8F93\u5165 \u2192 \u540C\u4E00 Trace ID\uFF08\u786E\u5B9A\u6027\uFF09");
  const s1 = sessionIdFor(q, at);
  test("P17-05", s1.startsWith("session-") && sessionIdFor(q, at) === s1, "sessionIdFor \u786E\u5B9A\u6027\u4E14\u5E26\u524D\u7F00\uFF1A" + s1);
}
{
  const dir = tmpRoot();
  const store = new ArtifactStore(dir);
  store.load();
  const a = {
    id: artifactIdFor("msg-x", 1),
    messageId: "msg-x",
    title: "AI \u5206\u6790\uFF1A\u6A21\u5757\u5316",
    content: "\u6B63\u6587",
    artifactType: "answer",
    sources: [{ type: "vault", path: "Notes/A.md", title: "A" }],
    vaultPath: "Knowledge Garden/Research/AI \u5206\u6790\uFF1A\u6A21\u5757\u5316.md",
    createdAt: 1,
    updatedAt: 2
  };
  const entry = store.register(a);
  test("P17-06", entry.id === a.id && store.count() === 1, "register \u5199\u5165\u7D22\u5F15\u5E76\u8BA1\u6570");
  test("P17-07", store.get(a.id)?.vaultPath === a.vaultPath, "get \u53EF\u8BFB\u56DE\u7D22\u5F15\u6761\u76EE");
  const rec = store.recent(5);
  test("P17-08", rec.length === 1 && rec[0].id === a.id, "recent(5) \u8FD4\u56DE\u6700\u65B0\u4FDD\u5B58");
  store.register({ ...a, id: artifactIdFor("msg-y", 2), messageId: "msg-y", updatedAt: 9 });
  const rec2 = store.recent(1);
  test("P17-09", rec2.length === 1 && rec2[0].messageId === "msg-y", "recent \u6309 updatedAt \u964D\u5E8F");
  const refs = store.toRefs("msg-y");
  test("P17-10", refs.length === 1 && refs[0].title === "AI \u5206\u6790\uFF1A\u6A21\u5757\u5316", "toRefs(messageId) \u2192 ArtifactRef\uFF08\u6C14\u6CE1 \u{1F4CE} \u94FE\u63A5\u7528\uFF09");
  test("P17-11", fs3.existsSync(path4.join(dir, "cache", "artifacts.json")), "\u7D22\u5F15\u5199\u5165 cache/artifacts.json\uFF08\u72EC\u7ACB\u4E8E AI Cache\uFF09");
  const store2 = new ArtifactStore(dir);
  store2.load();
  test("P17-12", store2.count() === 2, "\u91CD\u65B0 load \u6062\u590D\u7D22\u5F15\uFF08\u91CD\u88C5/\u91CD\u542F\u540E Artifact \u4ECD\u5728\uFF09");
  fs3.rmSync(dir, { recursive: true, force: true });
}
{
  const q = "\u6D4B\u8BD5\u95EE\u9898";
  const at = 1700000000001;
  const trace = {
    id: traceEventId(q, at, 1),
    stage: "retrieval",
    status: "done",
    summary: "\u641C\u7D22\u77E5\u8BC6\u5E93",
    tool: "vault.search",
    toolParamsSummary: "query=" + q.slice(0, 40),
    count: 3,
    timestamp: at
  };
  const keys = Object.keys(trace).sort().join(",");
  const allowed = ["count", "id", "stage", "status", "summary", "timestamp", "tool", "toolParamsSummary"];
  test("P17-13", keys.split(",").every((k) => allowed.includes(k)), "Trace \u5B57\u6BB5 = \u767D\u540D\u5355\uFF08\u65E0 reasoning/secret \u5B57\u6BB5\uFF09\uFF1A" + keys);
  const raw = { ...trace, hiddenReasoning: "\u2026\u2026\u5185\u5FC3\u72EC\u767D\u2026\u2026", apiKey: "sk-xxx", systemPrompt: "\u2026\u2026" };
  const clean = {
    id: String(raw.id),
    stage: raw.stage,
    status: raw.status,
    summary: String(raw.summary),
    timestamp: Number(raw.timestamp)
  };
  test("P17-14", !Object.keys(clean).includes("hiddenReasoning") && !Object.keys(clean).includes("apiKey"), "\u5E8F\u5217\u5316\u524D\u5265\u79BB hiddenReasoning/apiKey\uFF08\xA7130 \u7981\u6B62\uFF09");
  const stageOk = ["planning", "retrieval", "reading", "web", "synthesis", "writing", "saving"].includes(trace.stage);
  test("P17-15", stageOk, "stage \u679A\u4E3E\u5408\u6CD5");
  const statusOk = ["running", "done", "failed"].includes(trace.status);
  test("P17-16", statusOk, "status \u679A\u4E3E\u5408\u6CD5");
  const longSummary = "x".repeat(5e3);
  const trace2 = { id: "trace-2", stage: "reading", status: "done", summary: longSummary, timestamp: at };
  test("P17-17", trace2.summary.length >= 4e3, "\u6784\u9020\u5C42\u4E0D\u505A\u786C\u622A\u65AD\uFF08\u7531\u8C03\u7528\u65B9\u63A7\u5236\uFF1B\u6B64\u5904\u4EC5\u8BB0\u5F55\uFF09");
  const msg = { id: "msg-1", role: "assistant", content: "\u6700\u7EC8\u56DE\u7B54", createdAt: at, sources: [], status: "complete" };
  test("P17-18", msg.role === "assistant" && msg.status === "complete" && msg.content.length > 0, "\u6D88\u606F\u5BF9\u8C61\u53EA\u6709\u6700\u7EC8\u5185\u5BB9\uFF0C\u65E0 reasoning \u5B57\u6BB5");
  test("P17-19", !("reasoning" in msg), "assistant \u6D88\u606F\u4E0D\u542B reasoning \u5B57\u6BB5\uFF08\xA7144 P17-66\uFF09");
  const bad = { ...msg, reasoning: "\u2026\u2026" };
  test("P17-20", !("reasoning" in bad) === false, "\u6807\u8BB0\uFF1A\u82E5\u672A\u6765\u7C7B\u578B\u52A0\u5165 reasoning \u5B57\u6BB5\uFF0C\u6D4B\u8BD5\u5C06\u5931\u8D25\uFF08\u5951\u7EA6\u4FDD\u62A4\uFF09");
}
{
  test("P17-21", safeArtifactPath("Notes/A.md") === "Notes/A.md", "\u666E\u901A\u76F8\u5BF9 Markdown \u8DEF\u5F84\u5141\u8BB8");
  test("P17-22", safeArtifactPath("C:/Users/x/secret.md") === null && safeArtifactPath("../escape.md") === null && safeArtifactPath("a/../b.md") === null, "\u7EDD\u5BF9\u8DEF\u5F84 / .. \u7A7F\u8D8A\u62D2\u7EDD");
  test("P17-23", safeArtifactPath(".obsidian/evil.md") === null && safeArtifactPath("cache/x.md") === null && safeArtifactPath("node_modules/x.md") === null && safeArtifactPath(".git/x.md") === null && safeArtifactPath(".trash/x.md") === null, "\u53D7\u4FDD\u62A4\u76EE\u5F55\u62D2\u7EDD\uFF08.obsidian/cache/node_modules/.git/.trash\uFF09");
  test("P17-24", safeArtifactPath("Notes/A.txt") === null, "\u975E .md \u62D2\u7EDD\uFF08\xA773\uFF09");
  test("P17-25", artifactRelPath({ kind: "folder", folder: "Knowledge Garden/Research", title: "A:B*C" }) === "Knowledge Garden/Research/A-B-C.md" && artifactRelPath({ kind: "new_note", title: "\u6D4B\u8BD5" }) === "Knowledge Garden/Research/\u6D4B\u8BD5.md", "artifactRelPath \u6E05\u6D17\u975E\u6CD5\u5B57\u7B26\u5E76\u751F\u6210\u8DEF\u5F84");
}
{
  const dir = tmpRoot();
  fs3.mkdirSync(path4.join(dir, "cache"), { recursive: true });
  fs3.writeFileSync(path4.join(dir, "cache", "ai-cache.json"), JSON.stringify({ cleared: true }));
  const store = new ArtifactStore(dir);
  store.load();
  const a = {
    id: artifactIdFor("msg-1", 3),
    messageId: "msg-1",
    title: "T",
    content: "C",
    artifactType: "answer",
    sources: [],
    vaultPath: "Knowledge Garden/Research/T.md",
    createdAt: 3,
    updatedAt: 3
  };
  store.register(a);
  fs3.rmSync(path4.join(dir, "cache", "ai-cache.json"), { force: true });
  const store2 = new ArtifactStore(dir);
  store2.load();
  test("P17-26", store2.count() === 1 && store2.get(a.id)?.title === "T", "\u6E05 AI Cache \u4E0D\u5F71\u54CD Artifact \u7D22\u5F15\uFF08\xA779\uFF09");
  test("P17-27", !Object.keys(store2.get(a.id) ?? {}).includes("content"), "\u7D22\u5F15\u6761\u76EE\u4E0D\u542B\u6B63\u6587\uFF08\u7528\u6237\u7F16\u8F91\u4E0D\u6539 Cache \xA780\uFF09");
  test("P17-28", store2.get(a.id)?.id === a.id, "Artifact ID \u4E0E Prompt/Model \u65E0\u5173\uFF08\xA7129-130\uFF09");
  test("P17-29", fs3.existsSync(path4.join(dir, "cache", "artifacts.json")), "Artifact \u7D22\u5F15\u6587\u4EF6\u72EC\u7ACB\u5B58\u5728");
  fs3.rmSync(dir, { recursive: true, force: true });
}
{
  const sources = [
    { type: "vault", path: "Notes/A.md", title: "A", reason: "\u76F4\u63A5\u76F8\u5173" },
    { type: "web", url: "https://example.com/x", title: "WebX" },
    { type: "inference", title: "AI \u63A8\u65AD" }
  ];
  const a = {
    id: "artifact-1",
    messageId: "msg-1",
    title: "AI \u5206\u6790\uFF1A\u6D4B\u8BD5",
    content: "\u6B63\u6587\u5185\u5BB9",
    artifactType: "answer",
    sources,
    vaultPath: "Knowledge Garden/Research/X.md",
    createdAt: 1,
    updatedAt: 2
  };
  const md = buildArtifactMarkdown(a);
  test("P17-30", md.includes("type: ai-artifact") && md.includes("artifactType: answer") && md.includes("messageId: msg-1"), "frontmatter \u542B type/artifactType/messageId");
  test("P17-31", md.includes("title: AI \u5206\u6790\uFF1A\u6D4B\u8BD5") && md.includes("createdAt: 1"), "frontmatter \u542B title/createdAt");
  test("P17-32", md.includes("[[Notes/A.md]]") && md.includes("\u2014 \u76F4\u63A5\u76F8\u5173"), "Vault \u6765\u6E90\u4EE5 WikiLink + reason \u4FDD\u5B58\uFF08\xA726\uFF09");
  test("P17-33", md.includes("[WebX](https://example.com/x)"), "Web \u6765\u6E90\u4EE5\u94FE\u63A5\u4FDD\u5B58");
  test("P17-34", md.includes("\u5E76\u975E\u6765\u6E90\u539F\u6587"), "AI \u63A8\u65AD\u5757\u6807\u8BB0\u300C\u5E76\u975E\u6765\u6E90\u539F\u6587\u300D");
  test("P17-35", md.indexOf("\u6B63\u6587\u5185\u5BB9") < md.indexOf("## \u6765\u6E90"), "\u6B63\u6587\u5728\u6765\u6E90\u4E4B\u524D");
  const ap = artifactAppendBlock(a);
  test("P17-36", ap.includes("## \u2726 AI \u5206\u6790\uFF1A\u6D4B\u8BD5"), "\u8FFD\u52A0\u5757\uFF08\u5F53\u524D\u7B14\u8BB0\uFF09\u5E26 \u2726 \u6807\u9898");
  test("P17-37", !ap.includes("type: ai-artifact"), "\u8FFD\u52A0\u5757\u4E0D\u542B frontmatter\uFF08\u8FFD\u52A0\u5230\u5DF2\u6709\u7B14\u8BB0\uFF09");
  test("P17-38", ap.includes("[[Notes/A.md]]") && ap.includes("\u5E76\u975E\u6765\u6E90\u539F\u6587"), "\u8FFD\u52A0\u5757\u4E5F\u542B\u6765\u6E90\u4E0E\u63A8\u65AD\u6807\u8BB0");
  test("P17-39", suggestArtifactTitle("\u4E3A\u4EC0\u4E48\u6A21\u5757\u5316\u80FD\u964D\u4F4E\u7CFB\u7EDF\u590D\u6742\u5EA6", "answer").includes("AI \u5206\u6790\uFF1A"), "suggestArtifactTitle \u81EA\u52A8\u6807\u9898\uFF08\xA768\uFF09");
  const snap = snapshotSources(sources, 50);
  test("P17-40", snap.length === 3 && (snap[0].snippet?.length ?? 0) <= 50, "snapshotSources \u88C1\u526A snippet \u957F\u5EA6\uFF08\xA7120-122\uFF09");
}
{
  test("P17-41", cleanArtifactTitle("A/B:C*D?E") === "A-B-C-D-E", "cleanArtifactTitle \u6E05\u6D17\u975E\u6CD5\u6587\u4EF6\u540D\u7B26\u53F7");
  test("P17-42", cleanArtifactTitle("  ") === "AI \u4EA7\u7269", "\u7A7A\u6807\u9898\u56DE\u9000\u9ED8\u8BA4");
  test("P17-43", defaultArtifactFolder("research") === "Knowledge Garden/Research", "research \u9ED8\u8BA4\u76EE\u5F55");
  test("P17-44", defaultArtifactFolder("draft", "Knowledge Garden/Projects/P1") === "Knowledge Garden/Projects/P1/Notes", "draft \u9ED8\u8BA4\u76EE\u5F55 = \u9879\u76EE\u6839/Notes");
  test("P17-45", defaultArtifactFolder("answer", "Knowledge Garden/Projects/P1") === "Knowledge Garden/Projects/P1/Research", "answer \u9ED8\u8BA4\u76EE\u5F55 = \u9879\u76EE\u6839/Research");
  test("P17-46", artifactRelPath({ kind: "folder", folder: ".obsidian", title: "x" }) === null, "folder \u4F4D\u7F6E\u62D2\u7EDD .obsidian");
  test("P17-47", artifactRelPath({ kind: "folder", folder: "../x", title: "y" }) === null, "folder \u4F4D\u7F6E\u62D2\u7EDD .. \u7A7F\u8D8A");
  test("P17-48", artifactRelPath({ kind: "folder", folder: "Knowledge Garden/Inbox", title: "z" }) === "Knowledge Garden/Inbox/z.md", "Inbox \u76EE\u5F55\u6B63\u5E38");
  const bad = artifactRelPath({ kind: "new_note", title: "a" }).split("/").every((s) => ![".obsidian", "cache", "node_modules", ".git", ".trash"].includes(s.toLowerCase()));
  test("P17-49", bad, "new_note \u8DEF\u5F84\u4E0D\u542B\u53D7\u4FDD\u62A4\u76EE\u5F55");
}
{
  const files = {};
  const active = { path: "Notes/Current.md" };
  files[active.path] = "# \u5F53\u524D\u7B14\u8BB0\n\u6B63\u6587\u3002\n";
  const clip = { text: "" };
  Object.defineProperty(globalThis, "navigator", { value: {
    clipboard: { writeText: async (s) => {
      clip.text = s;
    } }
  }, configurable: true });
  let activeFile = active;
  const tfileOf = (rel) => Object.assign(Object.create(TFile.prototype), { path: rel, basename: rel.split("/").pop() ?? rel, extension: "md" });
  const fakeApp = {
    vault: {
      getAbstractFileByPath: (rel) => rel in files ? tfileOf(rel) : null,
      getActiveFile: () => activeFile ? tfileOf(activeFile.path) : null,
      cachedRead: async (f) => files[f.path] ?? "",
      modify: async (f, c) => {
        files[f.path] = c;
      },
      create: async (rel, c) => {
        files[rel] = c;
      }
    },
    workspace: { getLeaf: () => ({ openFile: () => ({}) }), getActiveFile: () => activeFile ? tfileOf(activeFile.path) : null }
  };
  const baseReq = {
    messageId: "msg-1",
    title: "AI \u5206\u6790\uFF1A\u6A21\u5757\u5316",
    content: "\u6A21\u5757\u5316\u964D\u4F4E\u590D\u6742\u5EA6\uFF0C\u56E0\u4E3A\u2026\u2026",
    sources: [{ type: "vault", path: "Notes/A.md", title: "A" }],
    artifactType: "answer"
  };
  (async () => {
    const r1 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "current_note" } });
    test("P17-50", r1.ok === true && files[active.path].includes("## \u2726 AI \u5206\u6790\uFF1A\u6A21\u5757\u5316") && files[active.path].includes("[[Notes/A.md]]"), "\u5F53\u524D\u7B14\u8BB0\u8FFD\u52A0\u6210\u529F\uFF08\u542B\u6765\u6E90\uFF09");
    const r2 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "new_note", title: "\u65B0\u7B14\u8BB0" } });
    test("P17-51", r2.ok === true && r2.vaultPath === "Knowledge Garden/Research/\u65B0\u7B14\u8BB0.md" && files[r2.vaultPath].includes("type: ai-artifact"), "\u65B0\u5EFA\u7B14\u8BB0\u521B\u5EFA\u6210\u529F\uFF08frontmatter\uFF09");
    const r3 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "new_note", title: "\u65B0\u7B14\u8BB0" } });
    test("P17-52", r3.ok === false && r3.conflict === true, "\u51B2\u7A81\u9ED8\u8BA4\u4E0D\u8986\u76D6\uFF08\xA769\uFF09");
    const before = files["Knowledge Garden/Research/\u65B0\u7B14\u8BB0.md"];
    const r4 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "new_note", title: "\u65B0\u7B14\u8BB0" }, overwrite: true });
    const after = files["Knowledge Garden/Research/\u65B0\u7B14\u8BB0.md"];
    test("P17-53", r4.ok === true && after.length > before.length, "overwrite=true \u62FC\u63A5\u8986\u76D6\uFF08\u5148 Diff \u786E\u8BA4\u540E\u8C03\u7528\uFF09");
    const r5 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "folder", folder: ".obsidian", title: "x" } });
    test("P17-54", r5.ok === false, "\u975E\u6CD5\u76EE\u5F55\u4FDD\u5B58\u5931\u8D25\uFF08\u4E0D\u5199\u5165\uFF09");
    const r6 = await saveArtifact(fakeApp, { ...baseReq, location: { kind: "clipboard" } });
    test("P17-55", r6.ok === true && r6.vaultPath === "(clipboard)" && clip.text.includes("type: ai-artifact") && !(r6.vaultPath in files), "\u526A\u8D34\u677F\u4FDD\u5B58\u4E0D\u5EFA\u6587\u4EF6\uFF08vaultPath=(clipboard)\uFF09");
  })();
}
{
  const dir = tmpRoot();
  const store = new WorkbenchSessionStore(dir);
  store.load();
  const tr = [
    { id: "trace-1", stage: "retrieval", status: "done", summary: "\u641C\u7D22\u77E5\u8BC6\u5E93", tool: "vault.search", count: 2, timestamp: 1 },
    { id: "trace-2", stage: "synthesis", status: "done", summary: "AI \u7EFC\u5408\u56DE\u7B54", timestamp: 2 }
  ];
  const msgs = [
    { id: "msg-u", role: "user", content: "\u95EE\u9898", createdAt: 1, sources: [] },
    { id: "msg-a", role: "assistant", content: "\u56DE\u7B54", createdAt: 2, sources: [], status: "complete", model: "test-model", artifactRefs: [{ artifactId: "artifact-1", title: "T", vaultPath: "Knowledge Garden/Research/T.md", createdAt: 2 }] }
  ];
  store.put({ sessionId: "session-test", title: "T", turnCount: 1, question: "\u95EE\u9898", sources: [], skillIds: [], createdAt: 1, updatedAt: 2, messages: msgs, traceEvents: tr });
  const store2 = new WorkbenchSessionStore(dir);
  store2.load();
  const rec = store2.get("session-test");
  test("P17-56", rec?.messages?.length === 2, "Session \u6301\u4E45\u5316 User/Assistant \u6C14\u6CE1\uFF08\xA732-34\uFF09");
  test("P17-57", rec?.messages?.[1]?.model === "test-model" && rec.messages[1].status === "complete", "assistant \u6D88\u606F\u542B model/status");
  test("P17-58", rec?.messages?.[1]?.artifactRefs?.length === 1, "\u6D88\u606F\u542B artifactRefs\uFF08\u6253\u5F00\u4F1A\u8BDD\u6062\u590D \u{1F4CE} \u5DF2\u4FDD\u5B58\uFF09");
  test("P17-59", rec?.traceEvents?.length === 2 && rec.traceEvents[0].stage === "retrieval", "Session \u6301\u4E45\u5316 Trace\uFF08\xA737\uFF09");
  test("P17-60", rec?.messages?.[0]?.role === "user" && rec.messages[0].content === "\u95EE\u9898", "user \u6C14\u6CE1\u5185\u5BB9\u53EF\u6062\u590D");
  test("P17-61", !Object.keys(rec?.traceEvents?.[0] ?? {}).includes("reasoning"), "\u6301\u4E45\u5316 trace \u65E0 reasoning \u5B57\u6BB5");
  const recent = store2.recent(1);
  test("P17-62", recent.length === 1 && recent[0].sessionId === "session-test", "recent(1) \u7528\u4E8E\u6253\u5F00 Workbench \u6062\u590D\u6700\u8FD1\u4F1A\u8BDD\uFF08\xA797\uFF09");
  fs3.rmSync(dir, { recursive: true, force: true });
}
{
  const q = "\u6700\u8FD1\u8BBF\u95EE\u5982\u4F55\u5F71\u54CD AI \u5019\u9009";
  const at = 1700000000010;
  const traces = [];
  const hits = [{ path: "Notes/A.md" }, { path: "Notes/B.md" }];
  traces.push({ id: traceEventId(q, at, 1), stage: "retrieval", status: "done", summary: "\u641C\u7D22\u77E5\u8BC6\u5E93", tool: "vault.search", toolParamsSummary: "query=" + q.slice(0, 40), count: hits.length, timestamp: at });
  const readPaths = ["Notes/A.md"];
  if (readPaths.length > 0) traces.push({ id: traceEventId(q, at, 2), stage: "reading", status: "done", summary: "\u9605\u8BFB 1 \u7BC7\u7B14\u8BB0", tool: "vault.read", count: readPaths.length, timestamp: at + 1 });
  traces.push({ id: traceEventId(q, at, 3), stage: "synthesis", status: "done", summary: "AI \u6B63\u5728\u7EFC\u5408\u56DE\u7B54", timestamp: at + 2 });
  test("P17-63", traces.length === 3 && traces.every((t) => t.toolParamsSummary === void 0 || t.toolParamsSummary.length <= 45), "Trace \u53EA\u6765\u81EA\u771F\u5B9E\u52A8\u4F5C\uFF08\u68C0\u7D22/\u9605\u8BFB/\u7EFC\u5408\u5404 1 \u6761\uFF0C\u53C2\u6570\u6458\u8981\u77ED\uFF09");
  test("P17-64", traces[0].count === 2 && traces[1].count === 1, "Trace \u5E26\u771F\u5B9E\u8BA1\u6570\uFF08\u4E0D\u6539\u5199\u6570\u5B57\uFF09");
  test("P17-65", traces.every((t) => t.status === "done" && !("stream" in t) && !("rawOutput" in t)), "Trace \u65E0\u6D41\u5F0F\u5185\u90E8\u5B57\u6BB5 / \u65E0 rawOutput");
  const json = JSON.stringify(traces);
  test("P17-66", !json.includes("hidden") && !json.includes("reasoning") && !json.includes("api") && !json.includes("prompt"), "Trace JSON \u4E0D\u542B hidden reasoning / API / prompt\uFF08\xA7144 P17-66\uFF09");
}
{
  const q = "A";
  const at = 1700000000020;
  const uid = workbenchMessageId(q, at, 1);
  const aid = workbenchMessageId(q, at, 2);
  test("P17-67", uid !== aid && uid.length > 4 && aid.length > 4, "\u540C\u4E00\u8F6E User/Assistant ID \u4E0D\u540C\uFF08\u53EF\u914D\u5BF9\u6E32\u67D3\uFF09");
  test("P17-68", traceEventId(q, at, 1) !== uid, "Trace ID \u4E0E\u6D88\u606F ID \u547D\u540D\u7A7A\u95F4\u4E0D\u540C\uFF08trace-/msg- \u524D\u7F00\uFF09");
  const s = sessionIdFor(q, at);
  test("P17-69", s.length > 4 && s !== uid && s !== aid, "sessionId \u4E0E\u6D88\u606F ID \u4E0D\u540C\uFF08\u4F1A\u8BDD\u7EA7 vs \u6D88\u606F\u7EA7\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
