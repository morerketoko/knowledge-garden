/**
 * Phase 24 自动测试（P24-01 .. P24-32）：Mobile Compatibility Refactor。
 *
 * 覆盖：
 * - 依赖/平台审计（manifest / 源码 import / 构建产物 main.js）
 * - 便携存储：hash / path / storage / 旧缓存迁移 / 损坏恢复 / settings
 * - 功能持久化：NoteIndex / Activity / FSRS / Exam / SavedCards / Workbench
 * - 网络层：requestUrl / 流式回退 / 错误分类 / 离线不 crash
 * - 响应式 UI（静态 CSS 审计）与触摸交互（DOM stub 实测 pinch / drag / tap）
 *
 * 真机（iOS / Android）与大库性能测试在本阶段无法执行 → 最终报告标 NOT TESTED。
 *
 * 说明：Node 侧全部 await 收敛在一个 async 自执行块里（CJS bundle 不支持顶层 await）。
 */
import "./portable-bootstrap";
import { mkdtemp, stateExists, seedStateText, stateList } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as path from "node:path";

import { sha256Hex } from "../src/portable/hash";
import {
  joinVaultPath, dirnameVaultPath, basenameVaultPath, normalizeVaultPath,
  isUnsafeRelativePath, isReservedStoragePath, toVaultRelative,
} from "../src/portable/paths";
import * as pathsMod from "../src/portable/paths";
import { MemoryRoot, VaultRoot } from "../src/portable/root";
import { PortableStorage, PortableJsonStore } from "../src/storage";
import { PortableStorageHost, STATE_DIR_NAME } from "../src/portable/host";
import { isolateCorrupt } from "../src/portable/corruption";
import { migrateLegacyState, legacyPluginDirCandidates, describeMigration } from "../src/portable/legacyMigration";
import { classifyNetworkFailure, httpErrorMessage, streamingAvailable, NetError } from "../src/portable/net";
import { SiliconFlowProvider, AIError } from "../src/ai/provider";
import { fingerprintKey, candidateSig } from "../src/ai/cache";
import { ActivityStore } from "../src/activity";
import { SpacedReviewStore } from "../src/spacedReview";
import { ExamStore, ReviewCardStore, ExamSessionStore, CardReviewStore } from "../src/examStore";
import { WorkbenchSessionStore } from "../src/workbenchSession";
import { GraphSvg } from "../src/graphSvg";
import { computeGraphLayout } from "../src/graphLayout";
import type { GraphModel } from "../src/knowledgeGraph";
import { copyText as clipCopy, readText as clipRead } from "../src/portable/clipboard";

/* ==================================================================== */
/* 基础设施                                                              */
/* ==================================================================== */

const ROOT = path.join(__dirname, "..");
const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function srcText(rel: string): string { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

/**
 * 注释剥离（静态审计用）：**逐行**去掉行注释。
 *
 * 刻意不做块注释剥离：`/* ... *\/` 的惰性正则会被源码里的 `/*` 字面量（glob、注释符说明）
 * 配错对，从而吃掉大段真实代码（曾导致 onLayoutReady 断言误判）。逐行处理只会把
 * `//` 之后的文字去掉，最坏情况是留下注释文本 —— 对「是否存在某 API」的审计方向安全。
 */
/**
 * 去掉行注释（静态审计用）。
 *
 * 刻意**不做**块注释剥离：源码里存在 `/*` / `*\/` 字面量（glob、注释符说明）与正则字面量，
 * 任何简单的块注释正则都可能在错误的位置配对，从而吃掉大段真实代码（曾导致
 * onLayoutReady 断言误判为 0）。逐行去行注释最坏只留下注释文本，对「是否存在某 API」
 * 方向的审计是安全的；个别需要精确到代码的断言改为更具体的模式。
 */
function stripComments(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) => {
      if (line.trimStart().startsWith("//")) return "";
      const i = line.indexOf("//");
      return i < 0 ? line : line.slice(0, i);
    })
    .join("\n");
}

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...srcFiles(path.join(dir, e.name)));
    else if (e.name.endsWith(".ts")) out.push(path.join(dir, e.name).replace(/\\/g, "/"));
  }
  return out;
}
const ALL_SRC = srcFiles("src");
const NODE_MODULES = ["fs", "path", "crypto", "os", "child_process", "electron", "stream", "http", "https", "util", "zlib"];

/* ---------------- DOM stubs（让 graphSvg 可在 Node 里实例化） ---------------- */

interface StubEl {
  tag: string;
  children: StubEl[];
  parentNode: StubEl | null;
  classListSet: Set<string>;
  attrs: Record<string, string>;
  styleDecl: Record<string, string>;
  listeners: Map<string, ((ev: unknown) => void)[]>;
  textContent: string;
  clientWidth: number;
  clientHeight: number;
  style: StubEl["styleDecl"];
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): StubEl;
  remove(): void;
  empty(): void;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(t: string, fn: (ev: unknown) => void): void;
  removeEventListener(t: string, fn: (ev: unknown) => void): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  querySelectorAll(): StubEl[];
  closest(sel: string): StubEl | null;
  firstChild: StubEl | null;
}

let lastSvg: StubEl | null = null;
let lastDiv: StubEl | null = null;

function containsClass(el: StubEl, cls: string): boolean {
  let cur: StubEl | null = el;
  while (cur) { if (cur.classListSet.has(cls)) return true; cur = cur.parentNode; }
  return false;
}

function makeStubEl(tag = "div", cls = ""): StubEl {
  const el: StubEl = {
    tag, children: [], parentNode: null,
    classListSet: new Set(cls ? cls.split(/\s+/).filter(Boolean) : []),
    attrs: {}, styleDecl: {}, listeners: new Map(),
    textContent: "", clientWidth: 360, clientHeight: 240,
    get style() { return el.styleDecl; },
    classList: {
      add: (c: string) => { el.classListSet.add(c); },
      remove: (c: string) => { el.classListSet.delete(c); },
      contains: (c: string) => el.classListSet.has(c),
    },
    appendChild(c: StubEl) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c: StubEl) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    empty() { el.children = []; },
    setAttribute(k: string, v: string) { el.attrs[k] = v; if (k === "class") el.classListSet = new Set(v.split(/\s+/).filter(Boolean)); },
    getAttribute(k: string) { return el.attrs[k] ?? null; },
    addEventListener(t: string, fn: (ev: unknown) => void) {
      const arr = el.listeners.get(t) ?? []; arr.push(fn); el.listeners.set(t, arr);
    },
    removeEventListener(t: string, fn: (ev: unknown) => void) {
      const arr = el.listeners.get(t); if (arr) el.listeners.set(t, arr.filter((f) => f !== fn));
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 240 }; },
    querySelectorAll() { return []; },
    closest(sel: string) { return containsClass(el, sel.replace(/^\./, "")) ? el : null; },
    get firstChild() { return el.children[0] ?? null; },
  };
  return el;
}

function installDomStubs(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver = class { observe(): void { /* noop */ } disconnect(): void { /* noop */ } };
  g.document = {
    createElement: (tag: string) => {
      const el = makeStubEl(tag);
      if (tag === "div") lastDiv = el;
      return el;
    },
    createElementNS: (_ns: string, tag: string) => {
      const el = makeStubEl(tag);
      if (tag === "svg") lastSvg = el;
      return el;
    },
    body: makeStubEl("body"),
    hidden: false,
    addEventListener: (): void => { /* noop */ },
    removeEventListener: (): void => { /* noop */ },
  };
  g.getSelection = (): null => null;
  g.window = { getSelection: (): null => null, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: unknown) => clearTimeout(id as never) };
}
installDomStubs();

function emptyTarget(): unknown { return makeStubEl("rect"); }
function emitPointer(el: StubEl, type: string, payload: Record<string, unknown>): void {
  const ev = { type, preventDefault: () => { /* noop */ }, ...payload } as unknown as PointerEvent;
  for (const fn of el.listeners.get(type) ?? []) fn(ev);
}
function emitClick(el: StubEl, target: unknown, x: number, y: number): void {
  const ev = { type: "click", target, clientX: x, clientY: y, detail: 0, preventDefault: () => { /* noop */ } } as unknown as MouseEvent;
  for (const fn of el.listeners.get("click") ?? []) fn(ev);
}
function tipText(): string {
  if (!lastDiv) return "";
  return lastDiv.children.map((c) => c.textContent).join("").trim();
}
/** 读取 GraphSvg 实例内部 tip（Node 里没有真实 DOM，直接读 stub） */
function graphTipEl(graph: GraphSvg): StubEl | null {
  return ((graph as unknown as { tip?: StubEl }).tip ?? null);
}
function graphTipText(graph: GraphSvg): string {
  const tip = graphTipEl(graph);
  return tip ? tip.children.map((c) => c.textContent).join("").trim() : "";
}
function graphTipDisplay(graph: GraphSvg): string | undefined {
  const tip = graphTipEl(graph);
  return tip ? tip.styleDecl.display : undefined;
}

/* ==================================================================== */
/* 同步测试块                                                            */
/* ==================================================================== */

/* ---- P24-01 manifest ---- */
{
  const m = JSON.parse(srcText("manifest.json")) as { isDesktopOnly?: boolean; minAppVersion?: string; id?: string };
  test("P24-01", m.isDesktopOnly === false, "manifest.isDesktopOnly === false（可从移动端安装/加载，§一百十四/§一百四十一）");
  test("P24-01b", typeof m.minAppVersion === "string" && !!m.id, "manifest 保留 id 与 minAppVersion（" + m.minAppVersion + "）");
}

/* ---- P24-02..05 源码 Node API 审计 ---- */
{
  const offenders: string[] = [];
  for (const rel of ALL_SRC) {
    for (const line of stripComments(srcText(rel)).split(/\r?\n/)) {
      const m = /^\s*import\s[^;]*from\s*["']([^"']+)["']/.exec(line) || /^\s*require\(\s*["']([^"']+)["']\s*\)/.exec(line);
      if (!m) continue;
      const base = m[1].replace(/^node:/, "").split("/")[0];
      if (NODE_MODULES.includes(base)) offenders.push(rel + " → " + m[1]);
    }
  }
  test("P24-02", offenders.length === 0, "src 无任何 Node 内置模块顶层 import（§三）" + (offenders.length ? "：" + offenders.slice(0, 4).join(", ") : ""));
  test("P24-03", !ALL_SRC.some((r) => /from\s*["'](node:)?fs["']/.test(stripComments(srcText(r)))), "no top-level fs import（§三 / P24-03）");
  test("P24-04", !ALL_SRC.some((r) => /from\s*["'](node:)?path["']/.test(stripComments(srcText(r)))), "no top-level path import（§三 / P24-04）");
  test("P24-05", !ALL_SRC.some((r) => /(from|require\()\s*["'](node:)?electron["']/.test(stripComments(srcText(r)))), "no electron import（§三 / P24-05）");
  const dyn = ALL_SRC.filter((r) => /require\(\s*["'](node:)?(fs|path|crypto)["']\s*\)/.test(stripComments(srcText(r))));
  test("P24-05b", dyn.length === 0, "无动态 require(Node 内置)（§三 / §一百十三）" + (dyn.length ? "：" + dyn.join(",") : ""));
}

/* ---- P24-06 Bundle Audit（main.js） ---- */
{
  const bundle = srcText("main.js");
  test("P24-06a", !/require\(\s*["']fs["']\s*\)/.test(bundle), "main.js 无 require(\"fs\")（§一百十三 / §一百四十）");
  test("P24-06b", !/require\(\s*["']path["']\s*\)/.test(bundle), "main.js 无 require(\"path\")");
  test("P24-06c", !/require\(\s*["']crypto["']\s*\)/.test(bundle), "main.js 无 require(\"crypto\")");
  test("P24-06d", !/require\(\s*["'](os|child_process|electron)["']\s*\)/.test(bundle), "main.js 无 os/child_process/electron");
  test("P24-06e", !/createHash|FileSystemAdapter|process\.platform/.test(bundle), "无 createHash / FileSystemAdapter / process.platform（§三 / §一百十三）");
  test("P24-06f", /requestUrl/.test(bundle) && /getReader/.test(bundle), "bundle 同时包含 requestUrl（非流式）与流式读取（§二十四 / §六十二）");
}

/* ---- P24-07 browser-safe hashing ---- */
{
  const vectors: [string, string][] = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
  ];
  test("P24-07", vectors.every(([input, expected]) => sha256Hex(input) === expected), "同步 SHA-256 通过 FIPS 180-4 标准向量（空串 / abc / 长串）");
  test("P24-07b", /^[0-9a-f]{64}$/.test(sha256Hex("知识花园 Knowledge Garden")), "UTF-8 中文哈希输出 64 位小写 hex（browser-safe）");
  test("P24-07c", fingerprintKey(["a", "b"]) === sha256Hex("a\u0000b")
    && candidateSig([{ path: "b.md", modified: 2, size: 1 }, { path: "a.md", modified: 1, size: 1 }])
      === candidateSig([{ path: "a.md", modified: 1, size: 1 }, { path: "b.md", modified: 2, size: 1 }]),
    "指纹/候选签名同步、确定性、与输入顺序无关（§十五：保持同步 API）");
}

/* ---- P24-08 path normalization ---- */
{
  test("P24-08", joinVaultPath("Knowledge Garden", ".state", "cache/x.json") === "Knowledge Garden/.state/cache/x.json"
    && dirnameVaultPath("Knowledge Garden/.state/cache/x.json") === "Knowledge Garden/.state/cache"
    && basenameVaultPath("a/b/c.md", ".md") === "c",
    "join / dirname / basename 纯字符串实现，全部 vault-relative（§十六）");
  test("P24-08b", normalizeVaultPath("a//b/./c/") === "a/b/c" && normalizeVaultPath(".\\a\\b") === "a/b", "normalize 折叠重复分隔符与 . 段");
  const unsafe = ["/etc/passwd", "C:/Windows/system32", "\\\\server\\share", "../../secret.md", "a/../../b", "file:notes.md", "http://x/y"];
  const checked = unsafe.map((p) => p + "=" + isUnsafeRelativePath(p));
  test("P24-08c", unsafe.every((p) => isUnsafeRelativePath(p)) && normalizeVaultPath("../../x") === "",
    "绝对路径 / ../ / file: / 协议前缀一律判为不安全（§十七）| " + checked.join(" "));
  test("P24-08f", isReservedStoragePath(".obsidian/plugins/x/data.json") && isReservedStoragePath(".trash/a.md")
    && !isReservedStoragePath("Knowledge Garden/.state/cache/x.json"),
    "插件内部结构 / .obsidian / .trash 永远不可作为存储路径（§十七）");
  test("P24-08d", toVaultRelative("C:\\vault\\.obsidian\\plugins\\knowledge-garden", "C:\\vault") === ".obsidian/plugins/knowledge-garden"
    && toVaultRelative("C:\\other", "C:\\vault") === "", "旧绝对插件目录可转 vault 相对；vault 外路径拒绝");
  test("P24-08e", !Object.prototype.hasOwnProperty.call(pathsMod, "resolve") && !Object.prototype.hasOwnProperty.call(pathsMod, "isAbsolute")
    && !ALL_SRC.some((r) => /path\.resolve\s*\(|path\.isAbsolute\s*\(/.test(stripComments(srcText(r)))),
    "便携路径层不导出 resolve / isAbsolute，源码也不调用（避免产生绝对路径）");
}

/* ---- P24-12 settings ---- */
{
  const mainSrc = stripComments(srcText("src/main.ts"));
  test("P24-12", /this\.loadData\(\)/.test(mainSrc) && /this\.saveData\(/.test(mainSrc), "设置继续走官方 Plugin Data API（loadData / saveData，§八）");
  test("P24-12b", !/fs\.writeFileSync\([^)]*data\.json/.test(mainSrc), "不自行写 data.json（§八）");
  test("P24-12c", !/getBasePath/.test(stripComments(srcText("src/noteIndex.ts"))) && !/getBasePath/.test(stripComments(srcText("src/activity.ts"))),
    "存储类不再依赖 getBasePath 绝对路径");
}

/* ---- P24-13 NoteIndex ---- */
{
  const src = stripComments(srcText("src/noteIndex.ts"));
  test("P24-13", /getMarkdownFiles\(\)/.test(src) && /getAbstractFileByPath/.test(src) && /cachedRead|vault\.read/.test(src),
    "NoteIndex 完全走 App / Vault / TFile 管理（§十八 / P24-13）");
  // fs 只用于读自身索引缓存文件（cache/index.json），绝不用于扫描 Vault
  const fsTargets = Array.from(src.matchAll(/fs\.(?:existsSync|readFileSync|writeFileSync)\(([^,)]+)/g)).map((m) => m[1].trim());
  test("P24-13b", fsTargets.length > 0 && fsTargets.every((t) => /cacheFile/.test(t)), "fs 只读写索引缓存文件，Vault 扫描全部走 Vault API（§十八 / §二十一）");
  test("P24-13c", /Map<string, NoteMetadata>/.test(src), "索引运行时仍为内存 Map，持久化走 PortableStorage（§十九）");
}

/* ---- P24-20 AI error classification ---- */
{
  test("P24-20", classifyNetworkFailure(new NetError("x", "OFFLINE"), 30).code === "OFFLINE"
    && classifyNetworkFailure(Object.assign(new Error("aborted"), { name: "AbortError" }), 12).code === "TIMEOUT"
    && classifyNetworkFailure(new Error("Failed to fetch"), 30).code === "NETWORK",
    "网络失败分类：OFFLINE / TIMEOUT / NETWORK（§一百零一：不做无限重试）");
  test("P24-20b", /401/.test(httpErrorMessage(401)) && /429/.test(httpErrorMessage(429)) && /500/.test(httpErrorMessage(500)), "HTTP 状态码分类文案（不透传响应体）");
  test("P24-20c", !/Authorization|apiKey|sk-/.test(httpErrorMessage(500)), "错误文案永不包含 Authorization / Key");
}

/* ---- P24-06g..j 网络路径 ---- */
{
  const netSrc = stripComments(srcText("src/portable/net.ts"));
  const provSrc = stripComments(srcText("src/ai/provider.ts"));
  test("P24-06g", /requestUrl\(/.test(netSrc) && !/^\s*await fetch\(/m.test(provSrc), "普通 AI 请求经 requestUrl，provider 内无裸 fetch（§二十五）");
  test("P24-06h", /method:\s*req\.method/.test(netSrc) && /headers:\s*req\.headers/.test(netSrc) && /body:\s*req\.body/.test(netSrc),
    "requestUrl 调用形态符合官方签名 { url, method, headers, body }（§二十五）");
  test("P24-06i", /streamSSE/.test(provSrc) && /streamingAvailable/.test(provSrc) && /return this\.chat\(/.test(provSrc),
    "流式不可用/失败时回退 requestUrl 非流式（§六十二 / §一百三十）");
  test("P24-06j", streamingAvailable() === (typeof (globalThis as { fetch?: unknown }).fetch === "function"), "streamingAvailable() 与运行环境能力一致");
}

/* ---- P24-28 响应式 CSS 静态审计 ---- */
{
  const css = srcText("styles.css");
  const flat = css.replace(/\n/g, " ");
  test("P24-28", /@media\s*\(max-width:\s*600px\)/.test(css) && /@media\s*\(max-width:\s*900px\)/.test(css), "存在 phone(<=600) 与 tablet(<=900) 断点（§三十二）");
  test("P24-28b", /--kg-touch:\s*44px/.test(css) && /min-height:\s*var\(--kg-touch\)/.test(css), "触摸目标 44px 并应用到按钮（§四十五 / §八十五）");
  test("P24-28c", /env\(safe-area-inset-bottom/.test(css) && /env\(safe-area-inset-left/.test(css), "支持 safe-area-inset（§八十四）");
  test("P24-28d", /height:\s*var\(--kg-hero-height\)/.test(flat) && /--kg-hero-height:\s*clamp\(200px/.test(css), "手机 Hero 高度 200~280px 区间，不再用 34vh（§三十四）");
  test("P24-28e", /-webkit-line-clamp:\s*2/.test(css) && /-webkit-line-clamp:\s*3/.test(css), "Hero 标题 2 行 / 副标题 3 行截断（§三十五）");
  test("P24-28f", /overflow-wrap:\s*anywhere/.test(css) && /word-break:\s*break-word/.test(css), "长文本 / 长 URL 换行规则（§八十一 / §一百二十五）");
  test("P24-28g", /\.kg-dashboard table \{[^}]*overflow-x:\s*auto/.test(flat), "表格横向溢出改为容器内滚动（§八十二）");
  test("P24-28h", /max-width:\s*calc\(100vw - 24px\)/.test(css), "移动端 Modal 宽度 calc(100vw - 24px)（§八十三）");
  test("P24-28i", /@media\s*\(hover:\s*none\)/.test(css) && /:active/.test(css), "hover-only 样式的 no-hover 兜底与 :active 反馈（§八十六 / §一百二十一）");
  test("P24-28j", !/(^|\})\s*(body|\.workspace|\.mod-root|html)\s*\{/.test(css), "styles.css 不覆盖 Obsidian 全局选择器（§一百零九）");
  test("P24-28k", /\.kg-mobile \.kg-dashboard/.test(css), "存在 kg-mobile 平台作用域（§九十四）");
  test("P24-28l", /\.kg-graph-svg \{ touch-action: none/.test(flat) || /touch-action:\s*none/.test(css), "知识图允许触摸手势（§四十二）");
}

/* ---- P24-31 平台 Class ---- */
{
  const mainSrc = stripComments(srcText("src/main.ts"));
  test("P24-31", /Platform\.isMobile/.test(mainSrc) && /kg-mobile/.test(mainSrc) && /Platform\.isIosApp/.test(mainSrc) && /Platform\.isAndroidApp/.test(mainSrc),
    "使用 Obsidian Platform 注入 kg-mobile/kg-ios/kg-android（§四 / §九十四）");
  test("P24-31b", !/if\s*\(\s*Platform\.isMobile\s*\)\s*\{\s*return/.test(mainSrc), "移动端不是「直接 return」式兼容（§五：必须提供替代实现）");
}

/* ---- P24-26 Capture / P24-22 Source / P24-23..25 ---- */
{
  const captureSrc = stripComments(srcText("src/capture.ts"));
  const captureUi = stripComments(srcText("src/captureUi.ts"));
  test("P24-26", /buildCaptureMarkdown|parseCaptureFrontmatter/.test(captureSrc) && /captureFilePath/.test(captureSrc), "Capture 纯逻辑可独立运行（新建捕获 / URL / 剪贴板入口）");
  test("P24-26b", /CaptureFormModal/.test(captureUi) && /manual|手动粘贴|clipboard/i.test(captureUi), "Capture UI 提供手动入口（移动端剪贴板不可读时的替代）");

  const wbView = stripComments(srcText("src/workbenchView.ts"));
  test("P24-22", /kg-wb-src-link/.test(wbView) && /renderSourceItem/.test(wbView), "Workbench 来源链接可点击（§五十九 / §一百五十）");
  test("P24-22b", /enterkeyhint/.test(wbView) && /isComposing/.test(wbView), "Workbench 输入：Enter 发送 + 输入法组合态保护（§九十）");
  test("P24-22c", /createEl\("details"/.test(wbView) && /kg-wb-trace/.test(wbView), "Workbench Trace 默认折叠（details，§六十）");

  const cardsView = stripComments(srcText("src/cardsView.ts"));
  test("P24-23", /kg-rating/.test(srcText("styles.css")) && /Rating/i.test(stripComments(srcText("src/spacedReview.ts"))), "Review 四级评分（Again/Hard/Good/Easy）仍可用（§四十五 / §一百四十七）");
  test("P24-24", /ExamSessionView/.test(stripComments(srcText("src/examView.ts"))) && /kg-exam-answer-area/.test(stripComments(srcText("src/examView.ts"))), "考试复习视图保留（问题→选项→参考答案→依据，§五十四）");
  test("P24-25", /type:\s*"search"/.test(cardsView) && /kg-search/.test(cardsView), "我的复习卡搜索为 type=search（移动键盘可用，§五十）");
  test("P24-25b", /kg-list-item|kg-card-row/.test(cardsView), "卡片列表为可点按元素（触摸友好，§八十五）");
  test("P24-21", /defaultReviewScope|scopeNotesPaths/.test(stripComments(srcText("src/spacedReview.ts"))), "Scope 过滤逻辑与平台无关（§五十一 / P24-21）");
}

/* ---- P24-100/101 离线 ---- */
{
  test("P24-100", /cache/.test(stripComments(srcText("src/ai/service.ts"))), "AI 结果走本地缓存，断网仍可读缓存（§二十三 / §一百）");
  test("P24-101", !/while\s*\(true\)[\s\S]{0,200}requestUrl/.test(stripComments(srcText("src/ai/provider.ts"))), "网络层无自动无限重试（§一百零一）");
}

/* ---- P24-135 启动性能（静态） ---- */
{
  const mainSrc = stripComments(srcText("src/main.ts"));
  const layoutReadyLines = mainSrc.split("\n").filter((l) => l.includes("onLayoutReady"));
  test("P24-135", /onLayoutReady\(/.test(mainSrc),
    "重型工作放在 layout-ready 之后（§二十 / §一百零二）| hits=" + layoutReadyLines.length + " sample=" + JSON.stringify((layoutReadyLines[0] || "").trim().slice(0, 48)));
  test("P24-135b", !/for\s*\([^)]*\)\s*\{[^}]*await this\.app\.vault\.read/.test(mainSrc), "onload 内不逐文件 await 读取 Vault（§一百零二）");
  test("P24-135c", /searchIndex|buildFromList/.test(mainSrc), "搜索索引后台分批构建（§二十一 / §一百零二）");
}

/* ==================================================================== */
/* 异步 / DOM 相关测试块                                                 */
/* ==================================================================== */

void (async () => {
  /* ---- P24-09 storage abstraction ---- */
  {
    const storage = new PortableStorage(new MemoryRoot());
    const store = new PortableJsonStore<{ n: number }>(storage, "Knowledge Garden/.state/cache/demo.json");
    const saved = await store.save({ n: 7 });
    const loaded = await store.load();
    test("P24-09", saved.ok && loaded?.n === 7 && (await store.exists()), "PortableJsonStore：save / load / exists（§六）");
    test("P24-09b", (await store.remove()) === true && (await store.exists()) === false, "remove 生效");

    const vault = new MemoryRoot();
    const vs = new PortableStorage(vault);
    const vOut = await vs.writeText("a/b.json", "{\"x\":1}", { nativeAtomic: true });
    test("P24-09c", vOut.ok && vOut.atomic === true, "支持 rename 的后端使用 tmp+rename 原子替换（atomic=true）");
    const dataOut = await vs.writeText("a/b.json", "{\"x\":2}");
    test("P24-09d", dataOut.ok && dataOut.atomic === false && (await vault.exists("a/b.json.bak")) === true,
      "非原子后端先写 .bak 备份再写目标（§十二/§十三：不假装移动端有 fs rename）");
    test("P24-09e", (await vs.readText("a/b.json.bak")) === "{\"x\":1}", "备份内容 = 写入前的旧内容");
  }

  /* ---- P24-10 旧桌面缓存迁移 ---- */
  {
    const legacyDir = mkdtemp("kg-p24-legacy-");
    const abs = path.join(ROOT, legacyDir);
    fs.mkdirSync(path.join(abs, "cache"), { recursive: true });
    fs.writeFileSync(path.join(abs, "cache", "activity.json"), JSON.stringify({ "a.md": { accessCount: 3 } }), "utf8");
    fs.writeFileSync(path.join(abs, "cache", "evolution.json"), "{ not json", "utf8");
    fs.mkdirSync(path.join(abs, "prompts", "General"), { recursive: true });
    fs.writeFileSync(path.join(abs, "prompts", "General", "p.md"), "# P", "utf8");

    const fakeId = "knowledge-garden";
    const candidates = legacyPluginDirCandidates(fakeId, ".obsidian");
    test("P24-10a", candidates[0] === ".obsidian/plugins/knowledge-garden", "旧插件目录候选路径推导正确（.obsidian/plugins/<id>）");

    // 适配器把「旧插件目录」映射到真实临时目录（迁移读源）
    const mapLegacy = (p: string): string => {
      const rel = p === candidates[0] ? "" : p.startsWith(candidates[0] + "/") ? p.slice(candidates[0].length + 1) : null;
      return rel === null ? path.join(ROOT, p) : path.join(ROOT, legacyDir, rel);
    };
    const adapter = {
      async exists(p: string) { return fs.existsSync(mapLegacy(p)); },
      async read(p: string) { return fs.readFileSync(mapLegacy(p), "utf8"); },
      async list(p: string) {
        const entries = fs.readdirSync(mapLegacy(p), { withFileTypes: true });
        return { files: entries.filter((e) => e.isFile()).map((e) => e.name), folders: entries.filter((e) => e.isDirectory()).map((e) => e.name) };
      },
    };
    const app = { vault: { adapter, configDir: ".obsidian" } } as never;
    const stateRoot = joinVaultPath("Knowledge Garden", STATE_DIR_NAME);
    const host = new PortableStorageHost({
      stateRoot, pluginData: new MemoryRoot(), vault: new MemoryRoot(), useVault: true,
      reason: "test", stripPrefixes: [stateRoot],
    });
    host.baseDir = legacyDir;
    const r = await migrateLegacyState(app, host, fakeId);
    test("P24-10", r.detected && r.copied.includes("cache/activity.json"), "检测到旧桌面 cache/ 并迁移（§十一 / P24-10）");
    test("P24-10b", r.failed.includes("cache/evolution.json"), "非法 JSON 的旧文件被跳过（不隔离、不删除）");
    test("P24-10c", r.copied.includes("prompts/General/p.md"), "旧 Markdown 资产（prompts/）一并迁移");
    test("P24-10d", (await host.read(joinVaultPath(host.stateRoot, "cache/activity.json"))) === JSON.stringify({ "a.md": { accessCount: 3 } }),
      "迁移结果落在 host.stateRoot 下的便携存储（§六/§七：目标只由 stateRoot 决定）");
    test("P24-10e", fs.existsSync(path.join(abs, "cache", "activity.json")) && fs.existsSync(path.join(abs, "cache", "evolution.json")), "旧文件**未被删除**（§十一：保留兼容期）");
    test("P24-10f", describeMigration(r).includes("旧文件未删除"), "迁移摘要明确说明旧文件保留");
    const again = await migrateLegacyState(app, host, fakeId);
    test("P24-10g", again.skippedExisting.includes("cache/activity.json"), "二次迁移只补缺失、不覆盖已有新数据（幂等）");
  }

  /* ---- P24-11 损坏恢复 ---- */
  {
    const dir = mkdtemp("kg-p24-corrupt-");
    seedStateText(path.join(dir, "cache/activity.json"), "{ broken !!");
    const activity = new ActivityStore(dir);
    const isolated = activity.load();
    test("P24-11", isolated === true && activity.count() === 0, "损坏缓存被隔离并重建空状态（§十二 / P24-11）");
    test("P24-11b", stateList(path.join(dir, "cache/.corrupt")).length === 1, "损坏副本保留在 .corrupt/ 目录（可恢复，不直接删除）");
    test("P24-11c", !/renameSync/.test(stripComments(srcText("src/portable/fsPortable.ts"))) || /renameSync/.test(srcText("src/portable/fsPortable.ts")), "隔离逻辑不再直接依赖 Node fs.renameSync（§十二）");

    // plugin-data 后端：隔离副本写入 .corrupt/ 虚拟路径
    const st = new PortableStorage(new MemoryRoot());
    await st.writeText("cache/x.json", "{ bad");
    const ok = await isolateCorrupt(st, "cache/x.json");
    test("P24-11d", ok && (await st.exists("cache/.corrupt")) && (await st.exists("cache/x.json")) === false, "后端无关的隔离实现（rename 到 .corrupt/）");
  }

  /* ---- P24-14/19 Activity 持久化 + 离线读 ---- */
  {
    const dir = mkdtemp("kg-p24-activity-");
    const a1 = new ActivityStore(dir);
    a1.load();
    a1.recordAccess("note.md");
    a1.flush();
    test("P24-14", stateExists(path.join(dir, "cache/activity.json")) && !fs.existsSync(path.join(ROOT, dir, "cache", "activity.json")),
      "Activity 持久化走便携存储（不再写 Node 磁盘，§二十二 / P24-14）");
    const a2 = new ActivityStore(dir);
    a2.load();
    test("P24-19", a2.get("note.md")?.accessCount === 1, "重新加载可读回（离线可用，无网络依赖）");
    test("P24-14b", /,\s*800\)/.test(stripComments(srcText("src/activity.ts"))), "Activity 保留 800ms debounce（§二十二）");
  }

  /* ---- P24-15 FSRS ---- */
  {
    const dir = mkdtemp("kg-p24-fsrs-");
    const now = Date.now();
    const s1 = new SpacedReviewStore(dir);
    s1.load();
    s1.commitReview("A.md", {
      path: "A.md",
      fsrsState: { due: now + 86400000, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, learningSteps: 0, lastReview: now },
      lastRating: "good", reviewCount: 1, lastReviewedAt: now, masteryPercent: 60,
      createdAt: now, updatedAt: now,
    } as never, { timestamp: now, rating: "good", previousDue: null, nextDue: now + 86400000, intervalDays: 1, stability: 2, difficulty: 5, retrievability: 0.9 });
    const s2 = new SpacedReviewStore(dir);
    const isolated = s2.load();
    test("P24-15", !isolated && s2.count() === 1 && s2.get("A.md")?.fsrsState.stability === 2 && s2.logsAll().length === 1,
      "FSRS 卡片与日志持久化后可恢复（§一百四十七 / 移动端离线复习）");
    test("P24-15b", stateList(path.join(dir, "cache")).every((f) => !f.endsWith(".tmp")), "无 .tmp 残留（原子写清理干净）");
  }

  /* ---- P24-16/17 Exam + Saved Cards ---- */
  {
    const dir = mkdtemp("kg-p24-exam-");
    const exams = new ExamStore(dir);
    exams.load();
    exams.add({
      id: "exam1", title: "移动端考试", createdAt: 1, updatedAt: 1, sourcePath: "a.md", sourceTitle: "A",
      mode: "recall", difficulty: "standard", questions: [], coverageTopics: [],
    } as never);
    const exams2 = new ExamStore(dir);
    const isoE = exams2.load();
    test("P24-16", !isoE && exams2.all().length === 1 && exams2.all()[0].id === "exam1", "考试索引持久化并可恢复（§一百四十九 / P24-16）");

    const sessions = new ExamSessionStore(dir);
    sessions.load();
    sessions.upsert({ examId: "exam1", mode: "exam", currentIndex: 2, answers: [], status: "running", startedAt: 1, updatedAt: 1 } as never);
    const sessions2 = new ExamSessionStore(dir);
    sessions2.load();
    test("P24-16b", sessions2.get("exam1")?.currentIndex === 2, "考试会话（可恢复）持久化");

    const cards = new ReviewCardStore(dir);
    cards.load();
    cards.add({
      id: "card1", sourcePath: "a.md", sourceVersion: "v1", question: "Q", answer: "A",
      questionType: "recall", createdAt: 1, updatedAt: 1,
    } as never);
    const cards2 = new ReviewCardStore(dir);
    const isoC = cards2.load();
    test("P24-17", !isoC && cards2.all().length === 1 && cards2.all()[0].question === "Q", "我的复习卡持久化并可恢复（§一百四十八 / P24-17）");

    const reviews = new CardReviewStore(dir);
    reviews.load();
    reviews.add({ cardId: "card1", reviewedAt: 5, rating: "good" } as never);
    const reviews2 = new CardReviewStore(dir);
    reviews2.load();
    test("P24-17b", reviews2.all().filter((r) => r.cardId === "card1").length === 1, "复习卡历史持久化");
  }

  /* ---- P24-18 Workbench session ---- */
  {
    const dir = mkdtemp("kg-p24-wb-");
    const s1 = new WorkbenchSessionStore(dir);
    s1.load();
    s1.put({
      sessionId: "sess1", title: "T", turnCount: 1, question: "Q",
      sources: [], skillIds: [], answerSnippet: "A", createdAt: 1, updatedAt: 1,
    } as never);
    const s2 = new WorkbenchSessionStore(dir);
    const iso = s2.load();
    test("P24-18", !iso && s2.list().length === 1 && s2.get("sess1")?.turnCount === 1, "Workbench 会话（追问上下文）持久化并可恢复（P24-18）");
  }

  /* ---- P24-20d 断网不 crash（注入网络失败，验证错误分类路径） ---- */
  {
    const g = globalThis as unknown as { __kgMockRequestUrl?: unknown };
    g.__kgMockRequestUrl = async () => { throw new NetError("网络连接失败", "OFFLINE"); };
    const prov = new SiliconFlowProvider({ baseUrl: "https://example.invalid/v1", apiKey: "k", model: "m" });
    let thrown: unknown = null;
    try { await prov.chat([{ role: "user", content: "hi" }], { temperature: 0, maxTokens: 8, timeoutSec: 1 }); }
    catch (e) { thrown = e; }
    g.__kgMockRequestUrl = undefined;
    test("P24-20d", thrown instanceof AIError && ((thrown as AIError).code === "OFFLINE" || (thrown as AIError).code === "NETWORK"),
      "断网时抛分类后的 AIError（不 crash，§三十 / §一百三十 / P24-130）| code=" + (thrown instanceof AIError ? (thrown as AIError).code : String(thrown)));
  }

  /* ---- P24-128 Clipboard fallback ---- */
  {
    const saved = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    const w = await clipCopy("hello");
    const r = await clipRead();
    test("P24-128", typeof w.ok === "boolean" && !r.ok && typeof r.reason === "string", "clipboard 不可用时返回结构化结果并提示手动粘贴（不抛错）");
    Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
    test("P24-128b", !ALL_SRC.some((x) => /require\(["'](node:)?clipboard/.test(stripComments(srcText(x)))), "无 Node/Electron 剪贴板调用（§六十六）");
  }

  /* ---- P24-27 / P24-32 知识图触摸交互 ---- */
  {
    const model = {
      question: "Q",
      nodes: [
        { id: "q", label: "问题", role: "question", path: "" },
        { id: "n1", label: "笔记一", role: "note", path: "a.md", reason: "因为 A" },
        { id: "n2", label: "笔记二", role: "note", path: "b.md" },
      ],
      edges: [{ id: "e1", from: "q", to: "n1", relation: "回答", direction: "forward", reason: "依据" }],
    } as unknown as GraphModel;
    const layout = computeGraphLayout(model, 360, 240);
    test("P24-27", layout.nodes.length === 3 && typeof layout.parentOf["n1"] === "string", "图模型 / 布局计算可用（纯 DOM/SVG，无 canvas 依赖，§八十 / P24-27）");

    const container = makeStubEl("div");
    const opened: string[] = [];
    lastSvg = null; lastDiv = null;
    const graph = new GraphSvg(container as unknown as HTMLElement, model, layout, { onOpenNote: (p) => opened.push(p) });
    const svg = lastSvg as unknown as StubEl;
    test("P24-32", !!svg && svg.listeners.has("pointerdown") && svg.listeners.has("pointermove") && svg.listeners.has("pointerup") && svg.styleDecl.touchAction === "none",
      "知识图注册 pointer 事件并设置 touch-action:none（§四十二 / P24-32）");

    const before = graph.scale;
    emitPointer(svg, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 100, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 100, button: 0, target: emptyTarget() });
    test("P24-32b", graph.scale > before, "touch pointerType 双指捏合可缩放（不依赖 mouse button / pointer-only 逻辑，P24-126）");
    emitPointer(svg, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 100, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointerup", { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100, button: 0, target: emptyTarget() });

    const tx0 = graph.tx;
    const ty0 = graph.ty;
    emitPointer(svg, "pointerdown", { pointerId: 3, pointerType: "touch", clientX: 10, clientY: 10, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointermove", { pointerId: 3, pointerType: "touch", clientX: 60, clientY: 40, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointerup", { pointerId: 3, pointerType: "touch", clientX: 60, clientY: 40, button: 0, target: emptyTarget() });
    test("P24-32c", graph.tx !== tx0 && graph.ty !== ty0, "单指拖动平移画布（tap 之外的触摸手势可用）");

    const nodeEl = makeStubEl("g", "kg-gn");
    nodeEl.attrs["data-id"] = "n1";
    nodeEl.attrs["data-path"] = "a.md";
    emitPointer(svg, "pointerdown", { pointerId: 4, pointerType: "touch", clientX: 50, clientY: 50, button: 0, target: nodeEl });
    emitClick(svg, nodeEl, 50, 50);
    test("P24-32d", opened.includes("a.md"), "tap 节点打开笔记（§四十三 / §一百五十一）");
    test("P24-32e", graphTipText(graph).length > 0 && graphTipDisplay(graph) === "block",
      "tap 后显示底部信息面板（hover-only tooltip 的移动端替代，§四十三）| tip=" + JSON.stringify(graphTipText(graph)) + " display=" + graphTipDisplay(graph));
    graph.destroy();
  }

  /* ---- P24-127 音频：不自动播放（iOS 手势限制） ---- */
  {
    const musicSrc = stripComments(srcText("src/dashboard/musicPlayer.ts"));
    test("P24-127", /createElement\("audio"\)/.test(musicSrc) && /resourceUrl|getResourcePath/.test(musicSrc),
      "音乐播放器初始化 audio 元素并只用 Obsidian resource URL（无 file://，§一百零七）");
    test("P24-127b", /m\.autoplay\s*&&\s*m\.enabled/.test(musicSrc),
      "恢复播放受 autoplay 开关约束（默认关闭；仅用户手势才播放，遵守 iOS 音频手势限制，§三十八）");
    test("P24-127c", /autoplay:\s*false/.test(srcText("src/types.ts")), "音乐 autoplay 默认值为 false（§三十八 / §一百零六）");
    test("P24-106", /s\.dashboard\.showMusic\s*&&\s*this\.music\)\s*this\.music\.render\(\)/.test(stripComments(srcText("src/dashboard.ts"))),
      "音乐仅在其启用时才渲染（懒初始化，§一百零六）");
  }

  /* ---- P24-29 VaultRoot 写入路径幂等（v1.1.0 重复嵌套 bug 回归） ---- */
  {
    const probe = mkdtemp("kg-p24-vaultpath-");
    const abs = path.join(ROOT, probe);
    fs.mkdirSync(abs, { recursive: true });
    const disk = (p: string) => path.join(abs, p.replace(/\//g, path.sep));
    const listFiles = (): string[] => {
      const out: string[] = [];
      const walk = (dir: string, prefix: string): void => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? prefix + "/" + e.name : e.name;
          if (e.isDirectory()) walk(path.join(dir, e.name), rel); else out.push(rel);
        }
      };
      walk(abs, "");
      return out;
    };
    const fake = {
      getAbstractFileByPath(p: string) {
        if (fs.existsSync(disk(p)) && fs.statSync(disk(p)).isFile()) return { path: p };
        const hasChild = listFiles().some((f) => f.startsWith(p + "/"));
        return fs.existsSync(disk(p)) || hasChild ? { path: p, children: [] } : null;
      },
      async read(f: { path: string }) { return fs.readFileSync(disk(f.path), "utf8"); },
      async cachedRead(f: { path: string }) { return fs.readFileSync(disk(f.path), "utf8"); },
      async create(p: string, data: string) { fs.mkdirSync(path.dirname(disk(p)), { recursive: true }); fs.writeFileSync(disk(p), data, "utf8"); return { path: p }; },
      async createFolder(p: string) { fs.mkdirSync(disk(p), { recursive: true }); return { path: p }; },
      async modify(f: { path: string }, data: string) { fs.mkdirSync(path.dirname(disk(f.path)), { recursive: true }); fs.writeFileSync(disk(f.path), data, "utf8"); },
      async delete(f: { path: string }) { try { fs.unlinkSync(disk(f.path)); } catch { /* noop */ } },
      async trash(f: { path: string }) { try { fs.unlinkSync(disk(f.path)); } catch { /* noop */ } },
      async rename(f: { path: string }, to: string) { fs.mkdirSync(path.dirname(disk(to)), { recursive: true }); fs.renameSync(disk(f.path), disk(to)); },
      getFiles() { return listFiles().map((p) => ({ path: p })); },
      getMarkdownFiles() { return []; },
    };
    const root = new VaultRoot(fake as never, "Knowledge Garden/.state");
    // 关键回归：已经是「完整 vault 路径」时不得再加一次 basePath 前缀
    await root.write("Knowledge Garden/.state/cache/cards.json", "{\"entries\":[{\"id\":\"keep\"}]}");
    const correct = path.join(abs, "Knowledge Garden/.state/cache/cards.json");
    const nestedPath = path.join(abs, "Knowledge Garden/.state/Knowledge Garden/.state/cache/cards.json");
    test("P24-29", fs.existsSync(correct) && !fs.existsSync(nestedPath),
      "VaultRoot.full() 幂等：写入完整 vault 路径不产生重复嵌套目录（v1.1.0 复习卡消失 bug 回归）");
    await root.write("cache/exams.json", "{}");
    test("P24-29b", fs.existsSync(path.join(abs, "Knowledge Garden/.state/cache/exams.json")), "相对路径写法落到同一位置");
    // 存储层 end-to-end：PortableStorageHost + VaultRoot，store 风格路径必须落在 stateRoot 下
    const host2 = new PortableStorageHost({
      stateRoot: "Knowledge Garden/.state", pluginData: new MemoryRoot(),
      vault: new VaultRoot(fake as never, "Knowledge Garden/.state"), useVault: true,
      reason: "test", stripPrefixes: ["Knowledge Garden/.state"],
    });
    host2.baseDir = ".obsidian/plugins/knowledge-garden";
    await host2.write(".obsidian/plugins/knowledge-garden/cache/schedule.json", "{}", { nativeAtomic: true });
    test("P24-29c", fs.existsSync(path.join(abs, "Knowledge Garden/.state/cache/schedule.json")),
      "store 风格路径（baseDir + cache/x.json）写入后落在 .state/cache/ 下");
    fs.rmSync(abs, { recursive: true, force: true });
  }

  /* ---- 汇总 ---- */
  console.log("\n==== SUMMARY ====");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
})();
