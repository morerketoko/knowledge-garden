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

// src/portable/paths.ts
function isUnsafeRelativePath(p) {
  if (!p || typeof p !== "string") return true;
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  const normalized = p.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const seg of segments) {
    const s = seg.trim();
    if (s === "..") return true;
    if (s.includes(":")) return true;
  }
  return false;
}
function isReservedStoragePath(p) {
  const n = normalizeVaultPath(p);
  if (!n) return true;
  const lower = n.toLowerCase();
  return lower === ".obsidian" || lower.startsWith(".obsidian/") || lower === ".trash" || lower.startsWith(".trash/") || lower.split("/").includes("node_modules");
}
function normalizeVaultPath(input) {
  if (input === null || input === void 0) return "";
  let p = String(input).replace(/\\/g, "/").trim();
  if (!p) return "";
  if (isUnsafeRelativePath(p)) return "";
  const out = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    out.push(seg);
  }
  return out.join("/");
}
function joinVaultPath(...parts) {
  const pieces = parts.filter((x) => typeof x === "string" && x.length > 0).map((x) => x.replace(/\\/g, "/")).join("/");
  return normalizeVaultPath(pieces);
}
function dirnameVaultPath(p) {
  const n = normalizeVaultPath(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? "" : n.slice(0, i);
}

// src/portable/root.ts
var MemoryRoot = class {
  constructor(seed) {
    this.kind = "memory";
    this.persistent = false;
    this.location = "memory://";
    this.files = /* @__PURE__ */ new Map();
    /** 可注入故障：写失败次数（测试损坏/降级路径） */
    this.failWrites = 0;
    if (seed) for (const [k, v] of Object.entries(seed)) this.files.set(normalizeVaultPath(k), v);
  }
  async exists(path2) {
    const p = normalizeVaultPath(path2);
    if (this.files.has(p)) return true;
    return this.hasChildren(p);
  }
  async isFile(path2) {
    return this.files.has(normalizeVaultPath(path2));
  }
  async isDirectory(path2) {
    const p = normalizeVaultPath(path2);
    if (!p) return true;
    return this.hasChildren(p);
  }
  hasChildren(p) {
    const prefix = p + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  async read(path2) {
    const v = this.files.get(normalizeVaultPath(path2));
    return v === void 0 ? null : v;
  }
  async write(path2, data) {
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("memory root: injected write failure");
    }
    this.files.set(normalizeVaultPath(path2), data);
  }
  async remove(path2) {
    const p = normalizeVaultPath(path2);
    if (this.files.delete(p)) return true;
    const prefix = p + "/";
    let removed = false;
    for (const k of Array.from(this.files.keys())) if (k.startsWith(prefix)) {
      this.files.delete(k);
      removed = true;
    }
    return removed;
  }
  async rename(from, to) {
    const f = normalizeVaultPath(from);
    const t = normalizeVaultPath(to);
    const v = this.files.get(f);
    if (v === void 0) return false;
    this.files.delete(f);
    this.files.set(t, v);
    return true;
  }
  async mkdirp() {
  }
  async list(path2) {
    const p = normalizeVaultPath(path2);
    const prefix = p ? p + "/" : "";
    const out = [];
    for (const [k, v] of this.files) {
      if (prefix && !k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      out.push({ path: k, name: rest, size: v.length, mtime: 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async prefetch() {
  }
  /** 测试辅助：全部键 */
  keys() {
    return Array.from(this.files.keys());
  }
  /** 测试辅助：目录是否为空 */
  isEmptyDir(path2) {
    const prefix = (normalizeVaultPath(path2) || "") + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return false;
    return true;
  }
};

// src/storage.ts
var PortableStorage = class {
  constructor(root) {
    this.root = root;
  }
  get backend() {
    return this.root.kind;
  }
  get location() {
    return this.root.location;
  }
  get persistent() {
    return this.root.persistent;
  }
  /** 启动前调用：让 VaultRoot 的读缓存 / PluginDataRoot 的快照就绪 */
  async init() {
    await this.root.prefetch();
  }
  async exists(path2) {
    return this.root.exists(normalizeVaultPath(path2));
  }
  async readText(path2) {
    return this.root.read(normalizeVaultPath(path2));
  }
  async readJson(path2) {
    const raw = await this.readText(path2);
    if (raw === null) return null;
    return JSON.parse(raw);
  }
  /**
   * §十三：平台无关写入。
   *
   * `atomic` 的选择依据是**后端能力**，不是 `Platform.isMobile` 的猜测：
   * - vault / plugin-data 后端：Obsidian 的 create+modify 本身不提供跨文件原子替换，
   *   因此先写 `<file>.bak` 备份，再写目标；任一步失败都会保留备份（§十二）。
   * - 桌面（调用方传入 nativeAtomic=true）：沿用 tmp + rename。
   */
  async writeText(path2, data, opts) {
    const p = normalizeVaultPath(path2);
    if (!p) return { ok: false, atomic: false, backend: this.root.kind, error: "\u975E\u6CD5\u8DEF\u5F84" };
    try {
      const dir = dirnameVaultPath(p);
      if (dir) await this.root.mkdirp(dir);
      if (opts?.nativeAtomic) {
        const tmp = p + ".tmp";
        await this.root.write(tmp, data);
        const renamed = await this.root.rename(tmp, p);
        if (renamed) return { ok: true, atomic: true, backend: this.root.kind };
        await this.root.write(p, data);
        await this.root.remove(tmp);
        return { ok: true, atomic: false, backend: this.root.kind };
      }
      const backup = p + ".bak";
      const prev = await this.root.read(p);
      if (prev !== null) await this.root.write(backup, prev);
      await this.root.write(p, data);
      return { ok: true, atomic: false, backend: this.root.kind };
    } catch (e) {
      return { ok: false, atomic: false, backend: this.root.kind, error: e?.message ?? String(e) };
    }
  }
  async writeJson(path2, value, opts) {
    return this.writeText(path2, JSON.stringify(value), opts);
  }
  async remove(path2) {
    return this.root.remove(normalizeVaultPath(path2));
  }
  async rename(from, to) {
    return this.root.rename(normalizeVaultPath(from), normalizeVaultPath(to));
  }
  /** 列出目录下的直接子项（相对 path 的名字） */
  async list(path2) {
    return this.root.list(normalizeVaultPath(path2));
  }
  async isDirectory(path2) {
    return this.root.isDirectory(normalizeVaultPath(path2));
  }
  async isFile(path2) {
    return this.root.isFile(normalizeVaultPath(path2));
  }
};

// src/portable/host.ts
var STATE_DIR_NAME = ".state";
var PortableStorageHost = class {
  constructor(opts) {
    this.opts = opts;
    /** 历史插件目录（旧 manifest.dir / getBasePath）；用于把旧路径映射到新根 */
    this.baseDir = "";
    this.stateRoot = normalizeVaultPath(opts.stateRoot);
    this.vaultMounts = (opts.vaultMounts ?? []).map((m) => normalizeVaultPath(m)).filter(Boolean);
    this.stripPrefixes = (opts.stripPrefixes ?? []).map((p) => normalizeVaultPath(p)).filter(Boolean);
    this.dataStorage = new PortableStorage(opts.pluginData);
    this.vaultStorage = opts.useVault && opts.vault ? new PortableStorage(opts.vault) : null;
    this.reasonText = opts.reason;
    this.baseDir = this.stateRoot;
  }
  /* ---------------- 后端状态 ---------------- */
  get backendKind() {
    return (this.vaultStorage ?? this.dataStorage).backend;
  }
  get vaultEnabled() {
    return this.vaultStorage !== null;
  }
  get reason() {
    return this.reasonText;
  }
  /** 诊断位置的展示名（永不返回绝对路径） */
  get location() {
    return this.vaultStorage ? this.stateRoot + "/" : "plugin-data://";
  }
  /** 能力探测后修正后端选择（只读仓库 / iCloud 只读 → 降级到 plugin-data） */
  setVaultEnabled(enabled, reason) {
    if (enabled === this.vaultEnabled) {
      if (reason) this.reasonText = reason;
      return;
    }
    this.vaultStorage = enabled && this.opts.vault ? new PortableStorage(this.opts.vault) : null;
    if (reason) this.reasonText = reason;
  }
  /** 该相对路径对应的存储 */
  backendFor(path2) {
    const p = normalizeVaultPath(path2);
    if (!p) return this.dataStorage;
    if (!this.vaultStorage) return this.dataStorage;
    return this.isVaultPath(p) ? this.vaultStorage : this.dataStorage;
  }
  isVaultPath(p) {
    if (p === this.stateRoot || p.startsWith(this.stateRoot + "/")) return true;
    for (const m of this.vaultMounts) {
      if (p === m || p.startsWith(m + "/")) return true;
    }
    return false;
  }
  /* ---------------- 路径解析 ---------------- */
  /**
   * 归一化并解析插件相对路径。
   *
   * 业务存储类历史上拿到的是**插件目录**（manifest.dir / 旧 getBasePath）并在其上
   * `join(baseDir, "cache", "x.json")`。重构后它们拿到的仍是同一个字符串，
   * 因此这里要把「以历史基开头的路径」映射到 `.state/` 之下；
   * 已经是 vault 挂载前缀或 `.state/` 的路径原样保留。
   */
  resolve(path2) {
    const raw = String(path2 ?? "").replace(/\\/g, "/");
    if (raw === "" || raw === this.baseDir) return this.stateRoot;
    if (this.baseDir && raw.startsWith(this.baseDir + "/")) {
      const rel = raw.slice(this.baseDir.length + 1);
      return joinVaultPath(this.stateRoot, rel);
    }
    if (raw === this.stateRoot || raw.startsWith(this.stateRoot + "/")) return normalizeVaultPath(raw);
    for (const m of this.vaultMounts) {
      if (raw === m || raw.startsWith(m + "/")) return normalizeVaultPath(raw);
    }
    return normalizeVaultPath(raw);
  }
  /** plugin-data 后端的存储键（剥离冗长前缀，保持 data.json 可读） */
  dataKey(target) {
    for (const pre of this.stripPrefixes) {
      if (target === pre) return "";
      if (target.startsWith(pre + "/")) return target.slice(pre.length + 1);
    }
    return target;
  }
  /* ---------------- 读写 ---------------- */
  async write(path2, data, opts) {
    const target = this.resolve(path2);
    const backend = this.backendFor(target);
    const key = backend === this.dataStorage ? this.dataKey(target) : target;
    return backend.writeText(key, data, opts);
  }
  async read(path2) {
    const target = this.resolve(path2);
    const backend = this.backendFor(target);
    return backend.readText(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async exists(path2) {
    const target = this.resolve(path2);
    const backend = this.backendFor(target);
    return backend.exists(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async remove(path2) {
    const target = this.resolve(path2);
    const backend = this.backendFor(target);
    return backend.remove(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async rename(from, to) {
    const f = this.resolve(from);
    const t = this.resolve(to);
    const bf = this.backendFor(f);
    const bt = this.backendFor(t);
    if (bf !== bt) {
      const raw = await this.read(f);
      if (raw === null) return false;
      const w = await this.write(t, raw);
      if (!w.ok) return false;
      await this.remove(f);
      return true;
    }
    const keyF = bf === this.dataStorage ? this.dataKey(f) : f;
    const keyT = bf === this.dataStorage ? this.dataKey(t) : t;
    return bf.rename(keyF, keyT);
  }
  async list(path2) {
    const target = this.resolve(path2);
    const backend = this.backendFor(target);
    return backend.list(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async isDirectory(path2) {
    const target = this.resolve(path2);
    const backend = this.backendFor(target);
    return backend.isDirectory(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  /* ---------------- 启动 ---------------- */
  /** 初始化两个后端的读缓存（同步镜像的遍历由 fsPortable.initSyncMirror 负责） */
  async init() {
    if (this.vaultStorage) await this.vaultStorage.init();
    await this.dataStorage.init();
  }
  /**
   * 后端能力探测（§七 / §九 / §一百三十七）：
   * 通过**真实写入一个探针文件**判断 Vault 是否可写，而不是猜平台 ——
   * 只读仓库、iCloud 只读、沙盒权限不足都能被正确探测出来。
   */
  async probeWritable() {
    const probe = joinVaultPath(this.stateRoot, ".kg-write-probe");
    const wasEnabled = this.vaultEnabled;
    if (!wasEnabled && this.opts.vault) this.vaultStorage = new PortableStorage(this.opts.vault);
    try {
      if (!this.vaultStorage) return false;
      const out = await this.vaultStorage.writeText(probe, String(Date.now()), { nativeAtomic: true });
      if (!out.ok) return false;
      await this.vaultStorage.remove(probe);
      return true;
    } catch {
      return false;
    } finally {
      if (!wasEnabled) this.vaultStorage = null;
    }
  }
  /** 校验任意相对路径是否安全（供 NoteIndex / 迁移使用，§十七） */
  static isSafe(path2) {
    const raw = String(path2 ?? "").replace(/\\/g, "/");
    if (!raw) return false;
    if (isUnsafeRelativePath(raw)) return false;
    const n = normalizeVaultPath(raw);
    if (!n.length) return false;
    return !isReservedStoragePath(n);
  }
  /** 某个存储路径的父目录（创建文件前用） */
  dirOf(path2) {
    return dirnameVaultPath(this.resolve(path2));
  }
};

// src/portable/fsPortable.ts
var host = null;
var mirror = /* @__PURE__ */ new Map();
var dirty = /* @__PURE__ */ new Set();
var pendingError = null;
var flushTimer = null;
var initialized = false;
function setStorageHost(h) {
  host = h;
  mirror.clear();
  dirty.clear();
  pendingError = null;
  initialized = false;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
async function initSyncMirror(h) {
  setStorageHost(h);
  try {
    const walk = async (rel, depth) => {
      if (depth > 4) return;
      const items = await h.list(rel);
      for (const it of items) {
        const child = rel ? rel + "/" + it.name : it.name;
        if (await h.isDirectory(child)) await walk(child, depth + 1);
        else {
          const raw = await h.read(child);
          if (raw !== null) mirror.set(child, raw);
        }
      }
    };
    await walk(h.stateRoot, 0);
    for (const it of await h.list("mirror")) {
      const raw = await h.read("mirror/" + it.name);
      if (raw !== null) mirror.set(it.name, raw);
    }
  } catch {
  }
  initialized = true;
}

// tests/portable-bootstrap.ts
var TEST_TMP_ROOT = ".kg-tests";
var host2 = null;
var ready = false;
function initTestStorage() {
  if (ready && host2) return host2;
  const stateRoot = joinVaultPath("Knowledge Garden", STATE_DIR_NAME);
  const h = new PortableStorageHost({
    stateRoot,
    pluginData: new MemoryRoot(),
    vault: new MemoryRoot(),
    useVault: true,
    reason: "node-test(memory)",
    stripPrefixes: [stateRoot]
  });
  h.baseDir = TEST_TMP_ROOT;
  host2 = h;
  void h.init();
  void initSyncMirror(h);
  ready = true;
  return h;
}
initTestStorage();

// src/portable/hash.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// src/workspace.ts
function workspaceScope(ws, globalScope) {
  return ws && ws.discoveryScope ? ws.discoveryScope : globalScope;
}

// src/retrieval.ts
var RETRIEVAL_VERSION = "v3";
function trimFolderRef(s) {
  let t = (s ?? "").trim();
  t = t.replace(/^["'`「」『』\s]+|["'`「」『』\s]+$/g, "");
  t = t.replace(/[\\/]+$/g, "");
  return t;
}
function normalizeFolderRef(s) {
  return trimFolderRef(s).normalize("NFKC");
}
var TAIL_WORDS_RE = /(?:有哪些(?:笔记|文件|内容)?|有哪(?:些|几个)|是什么(?:内容)?|有些什么|有什么(?:内容)?|里面有什么|里有什么|中有什么|有多少(?:篇|个)?|多少篇|统计一下?|列出来|列一下|看一下|看看|浏览一下|打开看看|全部|包含哪些|包括哪些)[。！？?！；;\s]*$/;
var TAIL_PROSPECT_RE = /(?:里的(?:所有|全部)?(?:笔记|文件)|下面的(?:所有|全部)?(?:笔记|文件)|下边的(?:所有|全部)?(?:笔记|文件)|中的所有(?:笔记|文件)|里的内容)[。！？?！；;\s]*$/;
var SCOPED_RE = /^(?:请问|请|帮我|帮我在|请在|请帮我在|在|从|请从|帮)?\s*([^，。！？?；;]{1,40}?)\s*(?:里|中|内|下面)\s*(?:搜索|查找|检索|寻找|找找|找一下?|分析|查看|统计|挖掘|浏览)\s*[:：]?\s*(.+)$/;
var ENTITY_BLOCK_RE = /(?:有关|关于|的笔记|笔记是|是什么|怎么样|如何|为什么|哪些|什么|提到|涉及|提到过|写过|有哪些|与.*相关|相关|说明一下|介绍一下|总结一下|怎么看)/;
function detectVaultLocationIntent(query) {
  const q = (query ?? "").trim();
  if (!q) return { kind: "normal-query", raw: q };
  const scoped = SCOPED_RE.exec(q);
  if (scoped && scoped[1] && scoped[2]) {
    const name = trimFolderRef(scoped[1]);
    const queryPart = scoped[2].trim();
    if (name && queryPart && !ENTITY_BLOCK_RE.test(name) && !/[\\/]/.test(name) && name.length <= 48) {
      return { kind: "scoped-query", name, query: queryPart, raw: q };
    }
  }
  let body = q.replace(TAIL_WORDS_RE, "").replace(TAIL_PROSPECT_RE, "").trim();
  if (!body) return { kind: "normal-query", raw: q };
  body = trimFolderRef(body);
  if (body.toLowerCase().endsWith(".md")) {
    return { kind: "exact-file", target: body, raw: q };
  }
  if (/[\\/]/.test(body)) {
    return { kind: "exact-folder", target: body, raw: q };
  }
  if (!ENTITY_BLOCK_RE.test(body) && body.length >= 1 && body.length <= 48 && !/[？?。！!；;，,、：:]$/.test(body)) {
    return { kind: "folder-name", name: body, raw: q };
  }
  return { kind: "normal-query", raw: q };
}
function folderBaseName(folder) {
  const segs = normalizeFolderRef(folder ?? "").split("/");
  return segs[segs.length - 1] ?? "";
}
function folderPathsFrom(allPaths) {
  const set = /* @__PURE__ */ new Set([""]);
  for (const p of allPaths ?? []) {
    const segs = p.replace(/\\/g, "/").split("/");
    segs.pop();
    let acc = "";
    for (const seg of segs) {
      if (!seg) continue;
      acc = acc ? acc + "/" + seg : seg;
      set.add(acc);
    }
  }
  return Array.from(set).sort();
}
function pathInFolder(path2, folder) {
  const f = normalizeFolderRef(folder ?? "");
  const p = normalizeFolderRef((path2 ?? "").replace(/\\/g, "/"));
  if (!f) return true;
  return p === f || p.startsWith(f + "/");
}
function resolveFolderPaths(target, allPaths) {
  const folders = folderPathsFrom(allPaths ?? []);
  const t = normalizeFolderRef(target ?? "");
  if (!t) return { matched: [], ambiguous: false };
  const key = folderKey(t);
  const exact = folders.filter((f) => folderKey(f) === key);
  if (exact.length === 1) return { folder: exact[0], matched: exact, ambiguous: false };
  if (exact.length > 1) return { folder: void 0, matched: exact, ambiguous: true };
  const hasSep = /[\\/]/.test(t);
  const matched = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (f) => {
    const k = folderKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    matched.push(f);
  };
  if (hasSep) {
    for (const f of folders) {
      if (f === "") continue;
      if (folderKey(f) === key || f.toLowerCase().startsWith(t.toLowerCase() + "/")) push(f);
    }
  } else {
    for (const f of folders) {
      if (f === "") continue;
      if (folderKey(folderBaseName(f)) === key) push(f);
    }
  }
  if (matched.length === 1) return { folder: matched[0], matched, ambiguous: false };
  return { folder: void 0, matched, ambiguous: matched.length > 1 };
}
function resolveFileNames(name, allPaths) {
  const key = folderKey(name);
  const matched = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of allPaths ?? []) {
    const base = (p.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.md$/i, "");
    if (folderKey(base) === key) {
      const k = folderKey(p);
      if (!seen.has(k)) {
        seen.add(k);
        matched.push(p);
      }
    }
  }
  if (matched.length === 1) return { path: matched[0], matched, ambiguous: false };
  return { path: void 0, matched, ambiguous: matched.length > 1 };
}
function resolveWorkbenchScope(cfg, ws, globalScope, currentNotePath) {
  const kind = cfg?.vaultScope ?? "vault";
  if (kind === "vault" || !kind) return { kind: "vault", label: "\u6574\u4E2A Vault", folders: [] };
  if (kind === "custom") {
    const folders2 = (cfg?.customFolders ?? []).map(trimFolderRef).filter(Boolean);
    return {
      kind,
      label: folders2.length ? "\u81EA\u5B9A\u4E49\u76EE\u5F55\uFF1A" + folders2.join(" / ") : "\u81EA\u5B9A\u4E49\u76EE\u5F55\uFF08\u672A\u8BBE\u7F6E\uFF0C\u56DE\u9000\u5168\u5E93\uFF09",
      folders: folders2
    };
  }
  if (kind === "current-folder") {
    const segs = (currentNotePath ?? "").replace(/\\/g, "/").split("/");
    const folder = segs.length > 1 ? segs.slice(0, -1).join("/") : "";
    return { kind, label: "\u5F53\u524D\u7B14\u8BB0\u6240\u5728\u76EE\u5F55", folders: folder ? [folder] : [] };
  }
  const sc = workspaceScope(ws, globalScope);
  const folders = (sc?.folders ?? []).map(trimFolderRef).filter(Boolean);
  return { kind: "workspace", label: "Workspace \u8303\u56F4" + (folders.length ? "" : "\uFF08\u672A\u9650\u5B9A\u76EE\u5F55\uFF0C\u56DE\u9000\u5168\u5E93\uFF09"), folders };
}
function workbenchScopeFingerprint(cfg, ws, globalScope, currentNotePath) {
  const info = resolveWorkbenchScope(cfg, ws, globalScope, currentNotePath);
  return "scope:" + info.kind + "|" + info.folders.slice().sort().join(";") + "|ws:" + (ws?.id ?? "none");
}
function folderKey(s) {
  return normalizeFolderRef(s ?? "").toLowerCase();
}

// src/workbenchTools.ts
var WORKBENCH_TOOL_IDS = [
  "vault.search",
  "vault.list_folder",
  "vault.read",
  "vault.create",
  "vault.modify",
  "vault.rename",
  "vault.move",
  "vault.delete",
  "vault.open",
  "web.search",
  "web.fetch"
];
function toolCategory(toolId) {
  const map = {
    "vault.search": "LOCAL_READ",
    "vault.list_folder": "LOCAL_READ",
    "vault.read": "LOCAL_READ",
    "vault.open": "LOCAL_READ",
    "vault.create": "LOCAL_WRITE",
    "vault.modify": "LOCAL_WRITE",
    "vault.rename": "LOCAL_WRITE",
    "vault.move": "LOCAL_WRITE",
    "vault.delete": "DESTRUCTIVE",
    "web.search": "EXTERNAL_WEB",
    "web.fetch": "EXTERNAL_WEB"
  };
  return map[toolId] ?? "LOCAL_READ";
}
function safeVaultFolderPath(path2, vaultRoot) {
  const p = (path2 ?? "").trim();
  if (!p) return "";
  if (/^[a-zA-Z]:[\\/]/.test(p)) return null;
  if (p.includes("..") && /\.\./.test(p)) return null;
  const segs = p.split(/[\\/]+/);
  for (const s of segs) {
    if (!s) return null;
    if (s === ".." || s === ".") return null;
    if (s === ".obsidian" || s === "node_modules") return null;
  }
  if (p.toLowerCase().endsWith(".md")) return null;
  const root = (vaultRoot ?? "").replace(/[\\/]+$/, "");
  if (root) {
    const joined = root.replace(/\\/g, "/") + "/" + p.replace(/\\/g, "/");
    if (!joined.startsWith(root.replace(/\\/g, "/") + "/")) return null;
  }
  return p;
}
var WORKBENCH_TOOLS = WORKBENCH_TOOL_IDS.map((id) => {
  const desc = {
    "vault.search": "\u68C0\u7D22 Vault\uFF1A\u6309\u5173\u952E\u8BCD\u8FD4\u56DE\u771F\u5B9E\u547D\u4E2D\u7B14\u8BB0\u8DEF\u5F84\u4E0E\u7247\u6BB5\uFF08\u2264500 \u5B57\u7B26/\u6761\uFF09\uFF1B\u652F\u6301 folder \u9650\u5B9A\u76EE\u5F55",
    "vault.list_folder": "\u5217\u51FA\u76EE\u5F55\uFF1A\u8FD4\u56DE\u5B50\u76EE\u5F55 / \u76F4\u63A5 Markdown \u6587\u4EF6\u4E0E\u8BA1\u6570\uFF08\u2264100 \u6761\u63D0\u793A\u622A\u65AD\uFF0C\u9012\u5F52\u53D7\u9884\u7B97\u9650\u5236\uFF09",
    "vault.read": "\u8BFB\u53D6\u4E00\u7BC7\u7B14\u8BB0\u5168\u6587\uFF08\u226412000 \u5B57\u7B26\uFF1B\u53EA\u8BFB .md\uFF09",
    "vault.create": "\u521B\u5EFA\u65B0\u7B14\u8BB0\uFF08\u5B89\u5168\u8DEF\u5F84\u6821\u9A8C\uFF1B\u9700\u7528\u6237\u786E\u8BA4\uFF09",
    "vault.modify": "\u4FEE\u6539\u5DF2\u6709\u7B14\u8BB0\uFF08Proposal\u2192Diff\u2192\u7528\u6237\u786E\u8BA4\u540E\u5E94\u7528\uFF1B\xA7\u516D\u5341\u4E5D\uFF09",
    "vault.rename": "\u91CD\u547D\u540D\u7B14\u8BB0\uFF08\u9700\u786E\u8BA4\uFF09",
    "vault.move": "\u79FB\u52A8\u7B14\u8BB0\uFF08\u9700\u786E\u8BA4\uFF09",
    "vault.delete": "\u5220\u9664\u7B14\u8BB0\uFF08\u9ED8\u8BA4 DENY\uFF1B\u4EC5\u7528\u6237\u624B\u52A8\u5141\u8BB8\u672C\u6B21\uFF09",
    "vault.open": "\u6253\u5F00\u7B14\u8BB0\uFF08\u76F4\u63A5\u5728 Obsidian \u4E2D\u6253\u5F00\uFF09",
    "web.search": "Web \u641C\u7D22\uFF08\u9700\u663E\u5F0F\u542F\u7528\uFF1B\u5355\u6761 snippet \u2264500 \u5B57\u7B26\uFF09",
    "web.fetch": "\u6293\u53D6\u7F51\u9875\u6B63\u6587\uFF08\u22648000 \u5B57\u7B26\uFF1B\u5185\u5BB9\u662F\u4E0D\u53EF\u4FE1\u8F93\u5165\uFF09"
  };
  return { id, name: id, description: desc[id] ?? id, actionCategory: toolCategory(id) };
});

// tests/retrieval-v3-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
var SAMPLE_PATHS = [
  "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09/\u53F2\u8BB0.md",
  "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09/\u6C49\u4E66.md",
  "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09/\u5B8B\u53F2/\u672C\u7EAA.md",
  "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\u526F\u7F16/\u9644\u5F55.md",
  "\u5386\u53F2/\u4E8C\u5341\u56DB\u53F2/\u7D22\u5F15.md",
  "AI/\u6E38\u620F\u8BBE\u8BA1.md",
  "Inbox/\u6E38\u620F\u673A\u5236\u8349\u7A3F.md"
];
var CFG = { vaultScope: "vault", customFolders: ["015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09"] };
{
  const a = detectVaultLocationIntent("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09");
  test("P19-01", a.kind === "exact-folder" && a.target === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "\u5B8C\u6574\u8DEF\u5F84 \u2192 exact-folder\uFF08kind=" + a.kind + " target=" + a.target + "\uFF09");
  const b = detectVaultLocationIntent("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09\u6709\u54EA\u4E9B\u7B14\u8BB0\uFF1F");
  test("P19-02", b.kind === "exact-folder" && b.target === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "\u8DEF\u5F84+\u95EE\u53E5\u540E\u7F00 \u2192 \u4ECD\u89E3\u6790\u4E3A exact-folder\uFF08" + b.target + "\uFF09");
  const c = detectVaultLocationIntent("\u4E8C\u5341\u56DB\u53F2");
  test("P19-03", c.kind === "folder-name" && c.name === "\u4E8C\u5341\u56DB\u53F2", "\u65E0\u5206\u9694\u7B26\u540D\u5B57 \u2192 folder-name\uFF08" + c.name + "\uFF09");
  const d = detectVaultLocationIntent("\u6709\u5173\u5386\u53F2\u7684\u7B14\u8BB0\u6709\u54EA\u4E9B\uFF1F");
  test("P19-04", d.kind === "normal-query", "\u666E\u901A\u95EE\u53E5 \u2192 normal-query\uFF08\u4E0D\u8BEF\u5224\u5B9E\u4F53\u540D\uFF09");
  const e = detectVaultLocationIntent("\u5728\u4E8C\u5341\u56DB\u53F2\u91CC\u641C\u7D22\u53F8\u9A6C\u8FC1");
  test("P19-05", e.kind === "scoped-query" && e.name === "\u4E8C\u5341\u56DB\u53F2" && (e.query || "").includes("\u53F8\u9A6C\u8FC1"), "\u300C\u5728 X \u91CC\u641C\u7D22 Y\u300D\u2192 scoped-query\uFF08name=" + e.name + " query=" + e.query + "\uFF09");
  const f = detectVaultLocationIntent("AI/\u6E38\u620F\u8BBE\u8BA1.md");
  test("P19-06", f.kind === "exact-file" && f.target === "AI/\u6E38\u620F\u8BBE\u8BA1.md", "\u663E\u5F0F .md \u2192 exact-file\uFF08" + f.target + "\uFF09");
  const g = detectVaultLocationIntent("\u53F8\u9A6C\u8FC1\u6709\u54EA\u4E9B\u8BB0\u5F55\uFF1F");
  test("P19-07", g.kind === "normal-query", "\u300CX \u6709\u54EA\u4E9B\u8BB0\u5F55\u300D\u2192 normal-query\uFF08\u907F\u514D\u628A\u63D0\u95EE\u8BCD\u540E\u7684\u5B9E\u4F53\u5F53\u76EE\u5F55\u540D\uFF09");
}
{
  const r1 = resolveFolderPaths("\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", SAMPLE_PATHS);
  test("P19-09", r1.ambiguous || r1.matched.length === 1, "\u6587\u4EF6\u5939\u540D\u5339\u914D\uFF08\u53EF\u80FD\u6709\u591A\u4E2A\u540C\u540D \u2192 ambiguous \u6216\u552F\u4E00\u89E3\u6790\uFF09matched=" + r1.matched.length);
  const r2 = resolveFolderPaths("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", SAMPLE_PATHS);
  test("P19-10", !r2.ambiguous && r2.folder === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "\u5B8C\u6574\u8DEF\u5F84\u7CBE\u786E\u89E3\u6790\u552F\u4E00\uFF08" + r2.folder + "\uFF09");
  const r3 = resolveFolderPaths("015 \u4E66\u5E93", SAMPLE_PATHS);
  test("P19-11", !r3.ambiguous && (r3.folder === "015 \u4E66\u5E93" || r3.matched.length >= 1 && r3.matched[0].startsWith("015 \u4E66\u5E93")), "\u591A\u7EA7\u524D\u7F00\uFF08015 \u4E66\u5E93 \u2192 \u524D\u7F00\u547D\u4E2D\uFF09=" + r3.matched.join(";"));
  const r4 = resolveFolderPaths("\u4E8C\u5341\u56DB\u53F2(\u516812\u518C)", SAMPLE_PATHS);
  test("P19-12", !r4.ambiguous && r4.folder === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "NFKC \u5168\u89D2\u62EC\u53F7\u5BB9\u9519\uFF08(\u516812\u518C) \u2192 \u547D\u4E2D\uFF08\u516812\u518C\uFF09\uFF09folder=" + r4.folder);
  const r5 = resolveFolderPaths("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\u526F\u7F16", SAMPLE_PATHS);
  test("P19-13", r5.folder === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\u526F\u7F16", "\u540C\u540D\u524D\u7F00\u4E0D\u8BEF\u914D\uFF08\u4E8C\u5341\u56DB\u53F2\u526F\u7F16 \u2260 \u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09\u5B50\u76EE\u5F55\uFF09=" + r5.folder);
  test("P19-14", pathInFolder("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09/\u53F2\u8BB0.md", "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09") && !pathInFolder("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\u526F\u7F16/\u9644\u5F55.md", "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09"), 'pathInFolder \u7528 folder+"/" \u8FB9\u754C\u9632\u540C\u540D\u8BEF\u914D');
}
{
  const n1 = resolveFileNames("\u53F2\u8BB0", SAMPLE_PATHS);
  test("P19-15", n1.path === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09/\u53F2\u8BB0.md", "\u7B14\u8BB0\u540D\u552F\u4E00\u89E3\u6790\uFF08" + n1.path + "\uFF09");
  const n2 = resolveFileNames("\u6E38\u620F\u8BBE\u8BA1", SAMPLE_PATHS);
  test("P19-16", n2.ambiguous || n2.matched.length >= 1, "\u7B14\u8BB0\u540D\u591A\u5339\u914D \u2192 ambiguous \u6216\u547D\u4E2D\uFF08matched=" + n2.matched.length + "\uFF09");
  const n3 = resolveFileNames("\u4E0D\u5B58\u5728\u540D\u5B57", SAMPLE_PATHS);
  test("P19-17", n3.matched.length === 0 && !n3.ambiguous, "\u65E0\u5339\u914D \u2192 \u7A7A\u5217\u8868\uFF08\u8C03\u7528\u65B9\u56DE\u9000\u8BED\u4E49\u68C0\u7D22\uFF09");
}
{
  test("P19-18", safeVaultFolderPath("015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "C:/vault") === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "\u6B63\u5E38\u591A\u7EA7\u76EE\u5F55\u901A\u8FC7");
  test("P19-19", safeVaultFolderPath("", "C:/vault") === "", "\u7A7A = \u6839\u76EE\u5F55\uFF08\u5168\u5E93\uFF09");
  test("P19-20", safeVaultFolderPath("C:/vault/notes", "C:/vault") === null, "\u7EDD\u5BF9\u8DEF\u5F84\u62D2\u7EDD");
  test("P19-21", safeVaultFolderPath("../secret", "C:/vault") === null, "\u8DEF\u5F84\u7A7F\u8D8A\u62D2\u7EDD");
  test("P19-22", safeVaultFolderPath(".obsidian", "C:/vault") === null && safeVaultFolderPath("node_modules", "C:/vault") === null, ".obsidian / node_modules \u62D2\u7EDD");
  test("P19-23", safeVaultFolderPath("notes.md", "C:/vault") === null, ".md \u7ED3\u5C3E\u4E0D\u662F\u76EE\u5F55 \u2192 \u62D2\u7EDD\uFF08\u8D70 vault.read\uFF09");
}
{
  const sc1 = resolveWorkbenchScope(CFG, void 0, void 0, void 0);
  test("P19-24", sc1.kind === "vault" && sc1.folders.length === 0, "\u9ED8\u8BA4 vault = \u6574\u4E2A Vault\uFF08\u641C\u7D22\u8FB9\u754C=\u5168\u5E93\uFF0C\u6743\u9650\u4ECD\u7531 Permission\uFF09");
  const sc2 = resolveWorkbenchScope({ vaultScope: "current-folder" }, void 0, void 0, "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09/\u53F2\u8BB0.md");
  test("P19-25", sc2.kind === "current-folder" && sc2.folders[0] === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "current-folder \u53D6\u5F53\u524D\u7B14\u8BB0\u6240\u5728\u76EE\u5F55\uFF08" + sc2.folders[0] + "\uFF09");
  const sc3 = resolveWorkbenchScope({ vaultScope: "custom", customFolders: ["015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09"] }, void 0, void 0, void 0);
  test("P19-26", sc3.kind === "custom" && sc3.folders[0] === "015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09", "custom \u76EE\u5F55\u767D\u540D\u5355\u751F\u6548");
  const f1 = workbenchScopeFingerprint({ vaultScope: "vault" }, void 0, void 0, void 0);
  const f2 = workbenchScopeFingerprint({ vaultScope: "custom", customFolders: ["015 \u4E66\u5E93/\u4E8C\u5341\u56DB\u53F2\uFF08\u516812\u518C\uFF09"] }, void 0, void 0, void 0);
  test("P19-27", f1 !== f2, "Workbench Scope \u53D8\u66F4 \u2192 fingerprint \u53D8\u5316\uFF08cache miss \u4F9D\u636E\uFF09");
}
{
  const srcDir = path.resolve(__dirname, "../src");
  const ws = fs.readFileSync(path.join(srcDir, "workbenchService.ts"), "utf8");
  const wt = fs.readFileSync(path.join(srcDir, "workbenchTools.ts"), "utf8");
  const si = fs.readFileSync(path.join(srcDir, "searchIndex.ts"), "utf8");
  const pr = fs.readFileSync(path.join(srcDir, "prompts.ts"), "utf8");
  const ni = fs.readFileSync(path.join(srcDir, "noteIndex.ts"), "utf8");
  test("P19-28", RETRIEVAL_VERSION === "v3" && ws.includes('"rv:" + RETRIEVAL_VERSION'), "Retrieval v3 \u5E38\u91CF\u751F\u6548\u4E14 Ask cache key \u7EB3\u5165 rv:v3");
  test("P19-29", wt.includes("vault.list_folder") && wt.includes("listFolder(") && wt.includes("safeVaultFolderPath"), "workbenchTools \u5DF2\u6CE8\u518C vault.list_folder + listFolder env + safeVaultFolderPath");
  test("P19-30", si.includes("folderPrefix?: string") || si.includes("folderPrefix"), "searchIndex.search \u652F\u6301 folder \u524D\u7F00\u8FC7\u6EE4");
  test("P19-31", pr.includes("\u5019\u9009\u6E05\u5355\u53EA\u662F\u7B2C\u4E00\u6B21\u672C\u5730\u68C0\u7D22\u7684\u7ED3\u679C") && pr.includes("\u4E0D\u662F\u8BBF\u95EE\u767D\u540D\u5355"), "Prompt \u5DF2\u660E\u786E\u5019\u9009\u6E05\u5355\u4E0D\u662F\u767D\u540D\u5355");
  test("P19-31b", ni.includes("revision"), "noteIndex \u6709 revision\uFF08\u6587\u4EF6\u53D8\u5316 \u2192 Ask cache miss\uFF09");
  test("P19-31c", ws.includes("detectVaultLocationIntent") && ws.includes("waitForIndexReady") && ws.includes("workbenchScopeFingerprint") && ws.includes("excludePaths"), "WorkbenchService \u5DF2\u63A5\u7EBF\u610F\u56FE\u89E3\u6790 / Index Ready Guard / scope \u6307\u7EB9 / \u6E10\u8FDB\u53BB\u91CD");
  test("P19-31d", ws.includes("queriesUsed") && ws.includes("QUERY_BUDGET_EXCEEDED"), "Agent \u5FAA\u73AF\u6709\u67E5\u8BE2\u9884\u7B97\uFF08maxQueries\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
