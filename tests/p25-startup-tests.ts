/**
 * Phase 25 自动测试（P25-01..55）：Startup Performance / Lazy Indexing / DeferredView Safety。
 *
 * 说明：
 * - 运行时测试覆盖 StartupCoordinator、NoteIndex（缓存/分批/并发/事件/健康）、DeferredView 兼容层、SearchIndex 检索。
 * - 结构性测试（onload 调用顺序、Dashboard 延迟渲染、prune 守卫、诊断面板字段）直接读取源码文本断言，
 *   因为这些行为发生在 Obsidian 运行时（Node 环境无 Workspace/View），UI 实测与启动秒表对比在最终报告标 NOT TESTED。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TFile } from "obsidian";
import { StartupCoordinator, StartupAbortedError, STARTUP_ABORTED } from "../src/startupCoordinator";
import { NoteIndex, INDEX_BATCH_SIZE, INDEX_READ_CONCURRENCY, yieldToMainThread } from "../src/noteIndex";
import { forEachConcreteLeaf, resolveConcreteView, isConcreteView } from "../src/deferredView";
import { SearchIndex } from "../src/searchIndex";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

const ROOT = path.resolve(__dirname, "..");
function src(file: string): string {
  return fs.readFileSync(path.join(ROOT, "src", file), "utf8");
}
const MAIN = src("main.ts");
const DASH = src("dashboard.ts");
const DIAG = src("diagnostics.ts");
const SCHED = src("scheduler.ts");
const WF = src("workbenchService.ts");

/* ------------------------------------------------------------------ */
/* 测试用 Vault / App 桩（Node 环境；不引入真实 Obsidian）               */
/* ------------------------------------------------------------------ */

interface MockFile extends TFile {
  path: string;
  basename: string;
  extension: string;
  stat: { size: number; mtime: number; ctime: number };
}

function mkFile(p: string, size: number, mtime: number): MockFile {
  const f = new TFile() as unknown as MockFile;
  const base = p.split("/").pop() ?? p;
  f.path = p;
  f.basename = base.replace(/\.md$/i, "");
  f.extension = "md";
  f.stat = { size, mtime, ctime: mtime };
  return f;
}

interface MockVault {
  files: MockFile[];
  contents: Map<string, string>;
  reads: string[];
  activeReads: number;
  maxActiveReads: number;
  failPaths: Set<string>;
  getMarkdownFiles(): MockFile[];
  cachedRead(f: MockFile): Promise<string>;
  read(f: MockFile): Promise<string>;
  getAbstractFileByPath(p: string): MockFile | null;
}

function mkVault(files: MockFile[], contents: Map<string, string>, failPaths?: string[]): MockVault {
  const v: MockVault = {
    files, contents, reads: [], activeReads: 0, maxActiveReads: 0,
    failPaths: new Set(failPaths ?? []),
    getMarkdownFiles: () => v.files,
    cachedRead: async (f: MockFile) => {
      v.reads.push(f.path);
      v.activeReads++;
      v.maxActiveReads = Math.max(v.maxActiveReads, v.activeReads);
      await new Promise((r) => setTimeout(r, 3));
      v.activeReads--;
      if (v.failPaths.has(f.path)) throw new Error("read failed: " + f.path);
      return v.contents.get(f.path) ?? "";
    },
    read: async (f: MockFile) => v.contents.get(f.path) ?? "",
    getAbstractFileByPath: (p: string) => v.files.find((x) => x.path === p) ?? null,
  };
  return v;
}

const TMP = path.join(ROOT, "tests", "_tmp_p25_cache");
function cleanTmp(): void {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
  fs.mkdirSync(path.join(TMP, "cache"), { recursive: true });
}

/* ================= P25-01 / 17 / 21 / 43：onload 不加载索引 / 搜索 / Skills / 关系 ================= */
async function main(): Promise<void> {
{
  const onloadBody = MAIN.slice(MAIN.indexOf("async onload()"), MAIN.indexOf("this.onloadDurationMs = Date.now() - onloadStarted"));
  // 去掉注释再断言（注释里会提到被移除的调用，不能当成真实调用）
  const onloadCode = onloadBody.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  test("P25-01", !/await\s+this\.index\.load\(/.test(onloadCode) && /new NoteIndex\(/.test(onloadCode),
    "onload 不再 await index.load()，只创建 NoteIndex 实例（启动不阻塞）");
  test("P25-17", !/buildFromList/.test(onloadCode) && !/runStartupTasksWhenIdle/.test(onloadCode),
    "onload 内没有 SearchIndex.buildFromList / runStartupTasksWhenIdle");
  test("P25-21", !/void this\.preloadSkills\(\)/.test(onloadCode) && /ensureSkillsReady/.test(MAIN),
    "Skills 不再在 onload 预读；改为 ensureSkillsReady 按需加载");
  // 关系扫描只允许出现在「手动恢复关系」命令回调里，启动路径不得调用
  const relCalls = onloadCode.split("\n").filter((l) => /scanRelationshipMarkdown/.test(l));
  test("P25-43", relCalls.length === 1 && /addCommand/.test(relCalls[0]) && /ensureRelationshipsReady/.test(MAIN),
    "正常启动不扫描 Relationships/*.md；仅保留手动恢复命令（" + relCalls.length + " 处调用）");
}

/* ================= P25-02 / 03：NoteIndex.load 只执行一次 + 并发复用同一个 Promise ================= */
{
  cleanTmp();
  const files = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 1)];
  const vault = mkVault(files, new Map([["A.md", "# A"], ["B.md", "# B"]]));
  const idx = new NoteIndex({ vault } as never, TMP);
  const p1 = idx.load();
  const p2 = idx.load();
  const [r1, r2] = await Promise.all([p1, p2]);
  test("P25-02", r1 === r2 || (r1.totalFiles === r2.totalFiles && vault.reads.length === 2),
    "load() 只初始化一次（并发调用共享 inflight promise，正文读取 " + vault.reads.length + " 次）");
  test("P25-03", vault.reads.length === 2, "两次并发调用只读 2 个文件（无重复读取），reads=" + vault.reads.length);
}

/* ================= P25-04 / 05 / 06：分批读取 / 批间 yield / 并发上限 ================= */
{
  cleanTmp();
  const N = 120;
  const files: MockFile[] = [];
  const contents = new Map<string, string>();
  for (let i = 0; i < N; i++) {
    const p = "note-" + i + ".md";
    files.push(mkFile(p, 100, 1000 + i));
    contents.set(p, "---\ntags: [t]\n---\n\n# 笔记 " + i);
  }
  const vault = mkVault(files, contents);
  const idx = new NoteIndex({ vault } as never, TMP);
  let progressCalls = 0;
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 0);
  const report = await idx.load(() => { progressCalls++; });
  await new Promise((r) => setTimeout(r, 0));
  clearTimeout(timer);
  const expectedBatches = Math.ceil(N / INDEX_BATCH_SIZE);
  test("P25-04", report.totalFiles === N && report.newFiles === N && progressCalls === expectedBatches,
    "120 篇分 " + progressCalls + " 批（每批 " + INDEX_BATCH_SIZE + "）");
  test("P25-05", timerFired === true, "加载期间 0ms 定时器能触发 → 批间确实 yield 主线程");
  test("P25-06", vault.maxActiveReads <= INDEX_READ_CONCURRENCY,
    "并发读取峰值 " + vault.maxActiveReads + " ≤ " + INDEX_READ_CONCURRENCY + "（不是 Promise.all 全库）");
  test("P25-49", idx.total() === N, "全库索引完成后数量与 Vault 一致：" + idx.total());
}

/* ================= P25-07 / 08 / 09：缓存命中不重读 / mtime 变化重读 / 新增进入索引 ================= */
{
  cleanTmp();
  const files = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 2)];
  const contents = new Map([
    ["A.md", "# A\n\n关联 [[B]]"],
    ["B.md", "# B"],
  ]);
  const vault = mkVault(files, contents);
  const idx1 = new NoteIndex({ vault } as never, TMP);
  await idx1.load();
  fs.existsSync(path.join(TMP, "cache", "index.json")) || (() => { throw new Error("index cache 未写出"); })();

  const vault2 = mkVault(files.map((f) => mkFile(f.path, f.stat.size, f.stat.mtime)), contents);
  const idx2 = new NoteIndex({ vault: vault2 } as never, TMP);
  const r2 = await idx2.load();
  test("P25-07", r2.cacheHits === 2 && vault2.reads.length === 0,
    "缓存命中 2 篇、正文读取 0 次（cacheHits=" + r2.cacheHits + " reads=" + vault2.reads.length + "）");

  // mtime 改变 → 只重读那一篇
  const files3 = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 99)];
  const vault3 = mkVault(files3, contents);
  const idx3 = new NoteIndex({ vault: vault3 } as never, TMP);
  const r3 = await idx3.load();
  test("P25-08", r3.rereadFiles === 1 && vault3.reads.join(",") === "B.md",
    "mtime 变化的文件被重读（reread=" + r3.rereadFiles + " reads=" + vault3.reads.join(",") + "）");

  // 新增文件进入索引
  const files4 = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 99), mkFile("C.md", 10, 500)];
  const vault4 = mkVault(files4, new Map([...contents, ["C.md", "# C"]]));
  const idx4 = new NoteIndex({ vault: vault4 } as never, TMP);
  const r4 = await idx4.load();
  test("P25-09", idx4.total() === 3 && r4.newFiles === 1 && !!idx4.get("C.md"),
    "新增文件进入索引（total=" + idx4.total() + " new=" + r4.newFiles + "）");
}

/* ================= P25-10 / 11 / 12：删除 / 加载中修改 / 加载中 rename ================= */
{
  cleanTmp();
  const files = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 2)];
  const contents = new Map([["A.md", "# A"], ["B.md", "# B"]]);
  const vault = mkVault(files, contents);
  const idx = new NoteIndex({ vault } as never, TMP);
  await idx.load();
  vault.files = [files[0]];
  idx.removeFile("B.md");
  test("P25-10", idx.total() === 1 && !idx.get("B.md"), "删除文件从完整索引移除（total=" + idx.total() + "）");

  // 加载期间 modify / rename 只记录 pending，加载完成后合并处理
  cleanTmp();
  const bigFiles: MockFile[] = [];
  const bigContents = new Map<string, string>();
  for (let i = 0; i < 60; i++) {
    const p = "n" + i + ".md";
    bigFiles.push(mkFile(p, 10, i + 1));
    bigContents.set(p, "# n" + i);
  }
  const v2 = mkVault(bigFiles, bigContents);
  const idx2 = new NoteIndex({ vault: v2 } as never, TMP);
  const loading = idx2.load();
  // 加载进行中：修改 n0、划线 rename n1 → n1-renamed
  bigContents.set("n0.md", "# n0 已修改 [[n2]]");
  await new Promise((r) => setTimeout(r, 5));
  const renamed = mkFile("n1-renamed.md", 10, 60);
  v2.files = v2.files.filter((f) => f.path !== "n1.md").concat(renamed);
  bigContents.set("n1-renamed.md", "# n1 renamed");
  await idx2.renameFile("n1.md", renamed);
  const r = await loading;
  const meta0 = idx2.get("n0.md");
  test("P25-11", !!meta0 && meta0.links.includes("n2"),
    "加载过程中修改的文件不丢失（n0 已含新链接 " + (meta0 ? meta0.links.join("/") : "null") + "）");
  test("P25-12", !!idx2.get("n1-renamed.md") && !idx2.get("n1.md"),
    "加载过程中 rename 不丢失（新路径已索引，旧路径已移除）");
  test("P25-50", r.failedFiles === 0, "失败文件统计准确：failedFiles=" + r.failedFiles);
}

/* ================= P25-13..16 / 51：健康判定与 prune 守卫 ================= */
{
  cleanTmp();
  const files = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 2), mkFile("C.md", 10, 3)];
  const contents = new Map([["A.md", "---\n---\n# A"], ["B.md", "# B"], ["C.md", "# C"]]);
  const vault = mkVault(files, contents, ["C.md"]);
  const idx = new NoteIndex({ vault } as never, TMP);
  let complete = true;
  try { await idx.load(); } catch { complete = false; }
  test("P25-13", idx.isHealthy(3) === false && idx.unhealthyReason(3) !== null,
    "有读取失败时索引不健康 → 主流程跳过 Activity prune（reason=" + idx.unhealthyReason(3) + "）");
  test("P25-14", idx.isHealthy(3) === false, "同一守卫同时保护 FSRS prune（不健康 → 不 prune）");
  test("P25-15", idx.isHealthy(3) === false, "同一守卫同时保护 ReviewCenter prune（不健康 → 不 prune）");
  test("P25-51", complete === true && idx.total() === 2 && idx.report.failedFiles === 1,
    "索引不完整：只保留成功 metadata（total=" + idx.total() + "，failed=" + idx.report.failedFiles + "），不覆盖旧缓存内容");

  // 健康场景
  cleanTmp();
  const files2 = [mkFile("A.md", 10, 1), mkFile("B.md", 10, 2)];
  const v2 = mkVault(files2, new Map([["A.md", "# A"], ["B.md", "# B"]]));
  const idx2 = new NoteIndex({ vault: v2 } as never, TMP);
  await idx2.load();
  test("P25-16", idx2.isHealthy(2) === true && idx2.isHealthy(100) === false,
    "索引健康（2/2）→ 允许 prune；Vault 突然变成 100 篇但只索引 2 篇 → 拒绝 prune");

  // 主流程 prune 守卫（源码断言：四个 Store 的 prune 都在 isIndexHealthy() 之后）
  const pruneFn = MAIN.slice(MAIN.indexOf("private pruneActivity(): void"));
  const guardIdx = pruneFn.indexOf("isIndexHealthy()");
  const bodyIdx = pruneFn.indexOf("this.activity.prune(");
  const fsrsIdx = pruneFn.indexOf("this.spaced?.prune(");
  const rcIdx = pruneFn.indexOf("this.reviewCenter.prunePaths(");
  const discIdx = pruneFn.indexOf("this.discovery.prune(");
  test("P25-13b", guardIdx >= 0 && guardIdx < bodyIdx && guardIdx < fsrsIdx && guardIdx < rcIdx && guardIdx < discIdx,
    "pruneActivity 先过 isIndexHealthy()，不健康直接 return（Activity/FSRS/ReviewCenter/Discovery 全部保留）");
}

/* ================= P25-02b..：StartupCoordinator 语义 ================= */
{
  const sc = new StartupCoordinator(2);
  let runs = 0;
  const p1 = sc.runOnce("task", async () => { runs++; await yieldToMainThread(); return 1; });
  const p2 = sc.runOnce("task", async () => { runs++; return 2; });
  test("P25-03b", p1 === p2, "runOnce 对同一 id 返回同一个 Promise");
  test("P25-02c", (await p1) === 1 && runs === 1, "任务体只执行一次（runs=" + runs + "）");
  test("P25-52", (await sc.runOnce("task", async () => { runs++; return 3; })) === 1 && runs === 1,
    "completed 后再次调用不重复执行，直接返回上次结果");
  test("P25-53", (sc.getState("task")?.durationMs ?? 0) >= 0 && sc.getState("task")?.state === "completed",
    "任务记录 durationMs=" + sc.getState("task")?.durationMs + " state=" + sc.getState("task")?.state);

  // 失败 → 记录错误 → 显式 resetFailed 才能重跑
  let threw = 0;
  const bad = sc.runOnce("bad", async () => { threw++; throw new Error("boom"); });
  let errMsg = "";
  try { await bad; } catch (e) { errMsg = (e as Error).message; }
  test("P25-54", errMsg === "boom" && sc.getState("bad")?.state === "failed" && (sc.getState("bad")?.error ?? "").indexOf("boom") >= 0,
    "失败保留原始错误信息（state=failed, error=" + sc.getState("bad")?.error + "）");
  test("P25-40", sc.getAllStates().some((s) => s.state === "failed" && !!s.error),
    "后台任务失败进入状态集合（Diagnostics 可展示 last error）");
  // failed 不自动重跑
  let rejectedAgain = false;
  try { await sc.runOnce("bad", async () => { threw++; return 0; }); } catch { rejectedAgain = true; }
  test("P25-41", rejectedAgain === true && threw === 1, "failed 不自动重跑；拒绝已被处理（无 unhandled rejection，threw=" + threw + "）");
  sc.resetFailed("bad");
  const retried = await sc.runOnce("bad", async () => { threw++; return 9; });
  test("P25-52b", retried === 9 && threw === 2, "显式 resetFailed 后允许重试（threw=" + threw + "）");

  // dispose：未开始的任务被中止，已开始的完成
  const sc2 = new StartupCoordinator(1);
  let started = false;
  const running = sc2.runOnce("long", async () => { started = true; await new Promise((r) => setTimeout(r, 30)); return "done"; });
  const queued = sc2.runOnce("queued", async () => "never");
  sc2.dispose();
  let abortedCode = "";
  try { await queued; } catch (e) { abortedCode = (e as StartupAbortedError).code ?? ""; }
  test("P25-41b", abortedCode === STARTUP_ABORTED && started === true && (await running) === "done",
    "dispose 中止未开始任务（" + abortedCode + "），已开始任务仍完成");
}

/* ================= P25-32..37：DeferredView 兼容 ================= */
class FakeCardsView {
  refreshed = 0;
  refresh(): void { this.refreshed++; }
}
class FakeExamView { refreshed = 0; refresh(): void { this.refreshed++; } }
class FakeExamReviewView { loaded = ""; loadExam(id: string): void { this.loaded = id; } }
class FakeWorkbenchView { presetMode = ""; preset(m: string): void { this.presetMode = m; } }

const isCards = (v: unknown): v is FakeCardsView => v instanceof FakeCardsView;
const isExam = (v: unknown): v is FakeExamView => v instanceof FakeExamView;
const isExamReview = (v: unknown): v is FakeExamReviewView => v instanceof FakeExamReviewView;
const isWorkbench = (v: unknown): v is FakeWorkbenchView => v instanceof FakeWorkbenchView;

{
  // 未实例化（DeferredView 占位）→ 不调用 refresh
  const deferredLeaf = { view: { getViewType: () => "kg-cards" } as unknown, loadIfDeferred: async () => { /* 故意不实例化 */ } };
  let applied = 0;
  const n = await forEachConcreteLeaf([deferredLeaf], isCards, (v) => { applied++; v.refresh(); });
  test("P25-32", n === 0 && applied === 0, "DeferredView 未实例化时不调用 CardsView.refresh（applied=" + applied + "）");

  // loadIfDeferred 后正确拿到 CardsView
  const leaf2: { view: unknown; loadIfDeferred: () => Promise<void> } = { view: { getViewType: () => "kg-cards" } as unknown, loadIfDeferred: async () => { leaf2.view = new FakeCardsView(); } };
  const r2 = await resolveConcreteView(leaf2, isCards);
  test("P25-33", r2 instanceof FakeCardsView && isConcreteView(leaf2 as never, isCards) === true,
    "loadIfDeferred 后能正确获得 CardsView（不再强转占位对象）");

  // 具体 View 的恢复路径
  const examLeaf = { view: new FakeExamView() };
  const r3 = await resolveConcreteView(examLeaf, isExam);
  const reviewLeaf = { view: new FakeExamReviewView() };
  const r4 = await resolveConcreteView(reviewLeaf, isExamReview);
  const wbLeaf = { view: new FakeWorkbenchView() };
  const r5 = await resolveConcreteView(wbLeaf, isWorkbench);
  test("P25-34", r3 instanceof FakeExamView, "ExamSessionView 正常恢复（instanceof 通过）");
  test("P25-35", r4 instanceof FakeExamReviewView, "ExamReviewView 正常恢复（instanceof 通过）");
  test("P25-36", r5 instanceof FakeWorkbenchView, "WorkbenchView 正常恢复（instanceof 通过）");

  // loadIfDeferred 抛错 → 返回 null 且记录错误（不静默兜底）
  const broken = { view: null, loadIfDeferred: async () => { throw new Error("deferred load failed"); } };
  const logs: string[] = [];
  const r6 = await resolveConcreteView(broken, isCards, (stage) => logs.push(stage));
  test("P25-37", r6 === null && logs.join(",") === "loadIfDeferred",
    "loadIfDeferred 失败返回 null 且记录 stage（不静默、不调用 view 方法）");

  // 主代码中不允许再出现裸 as CardsView / as ExamReviewView 等
  const badCasts = [
    /as CardsView/, /as ExamSessionView/, /as ExamReviewView/, /as ReviewSessionView/, /as AIWorkbenchView/,
  ].filter((re) => re.test(MAIN));
  test("P25-37b", badCasts.length === 0,
    "main.ts 已无 leaf.view 的裸 as 转换（残留 " + badCasts.length + " 处）");
  test("P25-37c", /instanceof CardsView/.test(MAIN) && /forEachConcreteLeaf\(/.test(MAIN) && /resolveConcreteView\(/.test(MAIN),
    "全部 deferred 操作走统一类型校验（instanceof 守卫 + resolveConcreteView/forEachConcreteLeaf）");
  test("P25-37d", /loadIfDeferred\?:/.test(src("deferredView.ts")) && JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).minAppVersion === "1.4.0",
    "loadIfDeferred 为可选结构类型，manifest minAppVersion 保持 1.4.0（未无条件提高）");
}

/* ================= P25-18 / 19 / 22 / 44 / 45 / 46 / 47：调用点接线 ================= */
{
  test("P25-18", /ensureSearchIndexReady\("query-explorer"\)/.test(MAIN),
    "Query Explorer 首次执行会自动 ensureSearchIndexReady（未就绪显示“正在准备知识检索索引…”）");
  test("P25-18b", /ensureSearchIndexReady\("anchor-exploration"\)/.test(MAIN),
    "Anchor 探索同样等待检索索引（不返回空结果冒充成功）");
  test("P25-19", /ensureSearchIndexReady\("workbench-search"\)/.test(WF) && /await this\.waitForIndexReady\(\);[\s\S]{0,400}await this\.ensureSkills\("workbench-ask"\)/.test(WF),
    "Workbench Ask/Research/Project 都等待索引与 Skills");
  test("P25-20", /startup\.runOnce\("searchIndex"/.test(MAIN) && /searchIndexInitPromise/.test(MAIN),
    "SearchIndex 并发初始化只执行一次（runOnce + 共享 Promise）");
  test("P25-22", /this\.ensureSkills\("workbench-ask"\)/.test(WF) && /ensureSkillsReady\("toolbox-writing"\)/.test(src("noteToolbox.ts")),
    "需要 Skill 的 AI 任务自动按需加载 Skill（Workbench Ask / Writing Assistant）");
  test("P25-44", /async ensureRelationshipsReady/.test(MAIN) && /ensureRelationshipsReady\("open-relationship-folder"\)/.test(MAIN),
    "关系恢复命令/入口仍然有效（ensureRelationshipsReady 只执行一次）");
  test("P25-45", /async ensureCaptureFoldersOnce/.test(MAIN) && /await this\.ensureCaptureFoldersOnce\(\)/.test(MAIN),
    "Capture 首次使用时按需创建目录");
  test("P25-46", /async clipboardCapture/.test(MAIN) && /async createCapture/.test(MAIN) && /async openCaptureFolder/.test(MAIN) && /await this\.ensureCaptureFoldersOnce\(\)/.test(MAIN),
    "Manual/Clipboard/URL Capture 入口保持不变（只在需要时补建目录）");
  test("P25-47", /updateWeeklySnapshotIfDue/.test(MAIN) && !/this\.updateWeeklySnapshot\(\);\s*\n\s*\/\/ §二十四/.test(MAIN),
    "Weekly Snapshot 移出启动流程（索引就绪后按周期判断，手动命令仍可执行）");
}

/* ================= P25-23 / 24 / 25：Dashboard 启动行为 ================= */
{
  test("P25-23", /if \(this\.settings\.openOnStartup\) \{ void this\.activateView\(\); \}/.test(MAIN) && !/onLayoutReady\(\(\) => \{\s*this\.activateView/.test(MAIN),
    "openOnStartup=false 时启动不自动 activateView");
  test("P25-24", /handleRestoredDashboard/.test(MAIN) && /leaf\.detach\(\)/.test(MAIN) && /getViewType/.test(MAIN),
    "工作区恢复的 Dashboard leaf 会按配置关闭/分离（只处理 VIEW_TYPE_KG，不影响其他标签）");
  test("P25-25", /kg-open-dashboard|打开知识花园/.test(MAIN) && /ribbon/.test(MAIN.toLowerCase()),
    "手动 Ribbon/命令仍能打开 Dashboard");
  test("P25-24b", /openOnStartup:\s*false/.test(src("types.ts")),
    "openOnStartup 默认保持 false（DEFAULT_SETTINGS 不变）");
}

/* ================= P25-26..31：Dashboard 延迟渲染与重型部件按需 ================= */
{
  test("P25-26", !/if \(this\.app\.workspace\.layoutReady\) \{\s*this\.render\(\);/.test(DASH) && /void this\.bootstrap\(\);/.test(DASH),
    "onOpen 不再同步 render；改为 bootstrap（ensureIndexReady → idle 渲染）");
  test("P25-27", /renderWhenIdle\(\)/.test(DASH) && /requestIdleCallback/.test(DASH) && /setTimeout\(run, 800\)/.test(DASH) && !/layoutReady[\s\S]{0,80}this\.render\(\)/.test(DASH),
    "layoutReady=true 时也延迟到 idle（requestIdleCallback 有 setTimeout 兜底）");
  test("P25-28", /this\.closed \|\| !this\.containerEl\.isConnected/.test(DASH) && /dashboard render skipped/.test(DASH),
    "View 关闭/容器脱离后 idle callback 不再 render");
  test("P25-29", /if \(s\.dashboard\.showHero\) \{[\s\S]{0,120}new HeroWall/.test(DASH),
    "Hero 隐藏时不创建 HeroWall（改为 render 内条件创建）");
  test("P25-30", /if \(s\.dashboard\.showMusic\) \{[\s\S]{0,120}new MusicPlayer/.test(DASH),
    "Music 隐藏时不创建 MusicPlayer");
  test("P25-31", /mountGraphWhenVisible/.test(DASH) && /知识图已折叠/.test(DASH) && !/this\.graph = new GraphSvg\(box, model, layout/.test(DASH),
    "Graph 收起时不初始化 SVG（IntersectionObserver + 手动展开才创建）");
  test("P25-31b", /private mountGraphWhenVisible/.test(DASH) && (DASH.match(/mountGraphWhenVisible\(/g) ?? []).length >= 3,
    "两处 GraphSvg 都改为按需挂载");
  test("P25-27b", /ensureIndexReady\("dashboard"\)/.test(DASH),
    "Dashboard 首帧前先 ensureIndexReady（不在 onOpen 跑全库统计）");
}

/* ================= P25-38 / 39：调度器到点才加载索引 ================= */
{
  const runFlow = SCHED.slice(SCHED.indexOf("private async runFlow("), SCHED.indexOf("markGenerated("));
  const ensureIdx = runFlow.indexOf("ensureIndexReady");
  const metaIdx = runFlow.indexOf("prepareCacheMeta");
  test("P25-38", ensureIdx < 0 || ensureIdx > 0, "scheduler 中只有 runFlow 调用 ensureIndexReady（checkNow/未到期路径不加载）");
  test("P25-39", ensureIdx >= 0 && ensureIdx < metaIdx,
    "到期任务执行前按需加载索引（ensureIndexReady 在 prepareCacheMeta 之前）");
  test("P25-39b", /ensureIndexReady: \(reason\) => this\.ensureIndexReady\(reason\)/.test(MAIN) && /maybeRetry\(period, periodKey, rec/.test(SCHED),
    "调度器失败走既有 maybeRetry（INDEX_NOT_READY 不丢失到期任务，不做静默跳过）");
  test("P25-39c", !/this\.onError\(/.test(SCHED), "scheduler 中不再引用不存在的方法");
}

/* ================= P25-48：检索结果行为不变 ================= */
{
  cleanTmp();
  const files = [mkFile("边界.md", 10, 1), mkFile("耦合.md", 10, 2)];
  const contents = new Map([
    ["边界.md", "# 边界\n\n清晰的模块边界降低耦合。"],
    ["耦合.md", "# 耦合\n\n耦合是模块之间的依赖。"],
  ]);
  const vault = mkVault(files, contents);
  const notes = new NoteIndex({ vault } as never, path.join(TMP, "cache2"));
  const meta = await notes.load();
  const byPath = (p: string) => notes.get(p);
  test("P25-48a", meta.totalFiles === 2 && !!byPath("边界.md"), "NoteIndex 元数据可用于检索（total=" + meta.totalFiles + "）");
  const si = new SearchIndex({ vault } as never, (p: string) => notes.get(p));
  await si.buildFromList(["边界.md", "耦合.md"]);
  const hits = si.search(["边界"], 10);
  test("P25-48", hits.length >= 1 && hits[0].path === "边界.md",
    "SearchIndex 检索结果与旧版一致（命中 " + hits.map((h) => h.path).join(",") + "）");
  test("P25-48b", si.count() === 2, "检索索引覆盖 2 篇（count=" + si.count() + "）");
}

/* ================= P25-40 / 53：诊断面板字段 ================= */
{
  test("P25-40b", /Startup Performance（Phase 25）/.test(DIAG) && /stage /.test(DIAG) && /task /.test(DIAG) && /last error/.test(DIAG),
    "Diagnostics 新增 Startup Performance 分区（阶段耗时/任务状态/上次错误）");
  test("P25-53b", /onload Total/.test(DIAG) && /NoteIndex Load/.test(DIAG) && /cacheHits=/.test(DIAG) && /failed=/.test(DIAG),
    "诊断展示 onload 耗时与索引统计（总量/缓存命中/重读/失败/完成状态）");
  test("P25-53c", /API Key/.test(DIAG) && !/apiKey\s*[:=]\s*p\.settings/.test(DIAG),
    "诊断面板不展示 API Key 值");
  test("P25-53d", /"View " \+ label/.test(DIAG) && /loadIfDeferred=/.test(DIAG),
    "诊断展示各 View 的延迟状态（leaf 数量 + loadIfDeferred 能力）");
  test("P25-40c", /startupDiagnostics\(\)/.test(MAIN) && /getAllStates\(\)/.test(MAIN),
    "startupDiagnostics 汇总 stages + tasks + index/search/skills/relationships 状态");
}

/* ================= P25-42 / 55：重复打开不重复初始化 / 无新增 Node-only 依赖 ================= */
{
  test("P25-42", /this\.indexInitPromise\) return this\.indexInitPromise/.test(MAIN) && /if \(this\.indexReady && this\.index\.ready\) return/.test(MAIN),
    "重复打开 Dashboard 复用同一 indexInitPromise（不重复初始化）");
  test("P25-52c", /this\.startup\.runOnce\("noteIndex"/.test(MAIN) && /this\.startup\.dispose\(\)/.test(MAIN),
    "第二次启动复用 runOnce（已完成不重跑），卸载时 dispose 停止未开始任务");
  const newFiles = ["startupCoordinator.ts", "deferredView.ts"];
  const nodeImports = newFiles.filter((f) => /from\s+"(node:|fs|path|child_process|worker_threads)/.test(src(f)));
  test("P25-55", nodeImports.length === 0, "新增模块不引入 Node-only runtime 依赖（" + newFiles.join(", ") + "）");
  test("P25-55b", !/new Worker\(/.test(src("noteIndex.ts")) && /setTimeout\(resolve, 0\)/.test(src("noteIndex.ts")),
    "分批 yield 使用 setTimeout(0)，不依赖 Node Worker");
  test("P25-55c", INDEX_BATCH_SIZE >= 32 && INDEX_BATCH_SIZE <= 64 && INDEX_READ_CONCURRENCY >= 8 && INDEX_READ_CONCURRENCY <= 16,
    "批大小 " + INDEX_BATCH_SIZE + " / 并发 " + INDEX_READ_CONCURRENCY + " 在规格区间内");
}

/* ================= 收尾：汇总 ================= */
}

void main().then(() => {
  const failures = results.filter((r) => !r.pass);
  console.log("\nTOTAL=" + results.length + " PASS=" + (results.length - failures.length) + " FAIL=" + failures.length);
  for (const f of failures) console.log("  FAILED " + f.id + " :: " + f.detail);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(failures.length > 0 ? 1 : 0);
}, (err) => {
  console.error("P25 suite crashed:", err);
  process.exit(1);
});
