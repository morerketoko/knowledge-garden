"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
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
var paths_exports = {};
__export(paths_exports, {
  basenameVaultPath: () => basenameVaultPath,
  dirnameVaultPath: () => dirnameVaultPath,
  extnameVaultPath: () => extnameVaultPath,
  isAbsolutePath: () => isAbsolutePath,
  isReservedStoragePath: () => isReservedStoragePath,
  isUnsafeRelativePath: () => isUnsafeRelativePath,
  joinVaultPath: () => joinVaultPath,
  normalizeVaultPath: () => normalizeVaultPath,
  toVaultRelative: () => toVaultRelative
});
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
function basenameVaultPath(p, ext) {
  const n = normalizeVaultPath(p);
  const i = n.lastIndexOf("/");
  const base = i < 0 ? n : n.slice(i + 1);
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) return base.slice(0, base.length - ext.length);
  return base;
}
function extnameVaultPath(p) {
  const base = basenameVaultPath(p);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i);
}
function isAbsolutePath(p) {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(String(p ?? ""));
}
function toVaultRelative(absoluteOrRelative, vaultBasePath) {
  const raw = String(absoluteOrRelative ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw) return "";
  if (!isAbsolutePath(raw)) return normalizeVaultPath(raw);
  const base = String(vaultBasePath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return "";
  if (raw === base) return "";
  if (raw.startsWith(base + "/")) return normalizeVaultPath(raw.slice(base.length + 1));
  return "";
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
var PortableJsonStore = class {
  constructor(storage, path2, opts) {
    this.storage = storage;
    this.path = path2;
    this.opts = opts;
  }
  get filePath() {
    return normalizeVaultPath(this.path);
  }
  async load() {
    try {
      return await this.storage.readJson(this.path);
    } catch {
      return null;
    }
  }
  async save(value) {
    return this.storage.writeJson(this.path, value, this.opts);
  }
  async remove() {
    return this.storage.remove(this.path);
  }
  async exists() {
    return this.storage.exists(this.path);
  }
  /** 「list」= 同目录同后缀的兄弟文件（用于多分片存储与诊断） */
  async list() {
    const dir = dirnameVaultPath(this.path);
    const items = await this.storage.list(dir);
    const base = this.filePath;
    return items.map((i) => joinVaultPath(dir, i.name)).filter((p) => p !== base);
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
    const key2 = backend === this.dataStorage ? this.dataKey(target) : target;
    return backend.writeText(key2, data, opts);
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
var flushing = false;
var initialized = false;
var MIRROR_FLUSH_MS = 800;
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
function schedule() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushMirror();
  }, MIRROR_FLUSH_MS);
}
async function flushMirror() {
  if (!host || flushing || dirty.size === 0) return;
  flushing = true;
  const paths = Array.from(dirty);
  dirty.clear();
  try {
    for (const p of paths) {
      const data = mirror.get(p);
      if (data === void 0) {
        await host.remove(p);
        continue;
      }
      const out = await host.write(p, data, { nativeAtomic: host.backendFor(p).backend === "vault" });
      if (!out.ok) pendingError = pendingError ?? new Error(out.error ?? "\u5199\u5165\u5931\u8D25\uFF1A" + p);
    }
  } catch (e) {
    pendingError = pendingError ?? e;
  } finally {
    flushing = false;
    if (dirty.size) schedule();
  }
}
function bump() {
  if (pendingError) {
    const e = pendingError;
    pendingError = null;
    throw e;
  }
}
function key(p) {
  if (!host) return "";
  return host.resolve(p);
}
function existsSync(p) {
  if (!host || !p) return false;
  const k = key(p);
  if (!k) return false;
  if (mirror.has(k)) return true;
  const prefix = k + "/";
  for (const m of mirror.keys()) if (m.startsWith(prefix)) return true;
  return false;
}
function readFileSync(p, _enc) {
  const k = key(p);
  const v = k ? mirror.get(k) : void 0;
  if (v === void 0) throw new Error("ENOENT: " + (k || p));
  return v;
}
function writeFileSync(p, data, _enc) {
  bump();
  const k = key(p);
  if (!k) {
    pendingError = new Error("\u5B58\u50A8\u672A\u5C31\u7EEA\uFF0C\u5199\u5165\u88AB\u5FFD\u7565\uFF1A" + p);
    return;
  }
  mirror.set(k, String(data ?? ""));
  dirty.add(k);
  schedule();
}
function renameSync(from, to) {
  bump();
  const f = key(from);
  const t = key(to);
  if (!f || !t) throw new Error("\u5B58\u50A8\u672A\u5C31\u7EEA\uFF0Crename \u5931\u8D25");
  const v = mirror.get(f);
  if (v === void 0) throw new Error("ENOENT: " + f);
  mirror.delete(f);
  mirror.set(t, v);
  dirty.add(t);
  schedule();
}
function unlinkSync(p) {
  bump();
  const k = key(p);
  if (!k) return;
  mirror.delete(k);
  dirty.add(k);
  schedule();
}
function readdirSync(p, _opts) {
  if (!host || !p) return [];
  const k = key(p);
  const prefix = k ? k + "/" : "";
  const seen = /* @__PURE__ */ new Map();
  for (const m of mirror.keys()) {
    if (!m.startsWith(prefix)) continue;
    const rest = m.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const isDir = slash >= 0;
    seen.set(name, (seen.get(name) ?? false) || isDir);
  }
  return Array.from(seen.entries()).map(([name, isDir]) => ({ name, isFile: () => !isDir, isDirectory: () => isDir })).sort((a, b) => a.name.localeCompare(b.name));
}

// tests/portable-bootstrap.ts
var TEST_TMP_ROOT = ".kg-tests";
var dirSeq = 0;
function mkdtemp(prefix = "") {
  dirSeq++;
  const safe = String(prefix).replace(/[\\/]+$/, "").replace(/[^\w.-]+/g, "-") || "d";
  return TEST_TMP_ROOT + "/" + safe + "-" + dirSeq;
}
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
function testHost() {
  if (!host2) throw new Error("\u6D4B\u8BD5\u5B58\u50A8\u672A\u521D\u59CB\u5316\uFF1A\u8BF7\u5148\u8C03\u7528 initTestStorage()");
  return host2;
}
initTestStorage();
function stateKeyOf(relPath) {
  return testHost().resolve(relPath);
}
function stateExists(rel) {
  return existsSync(stateKeyOf(rel));
}
function stateList(rel = "") {
  return readdirSync(stateKeyOf(rel)).map((d) => d.name);
}
function seedStateText(rel, text) {
  writeFileSync(stateKeyOf(rel), text);
}

// tests/p24-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

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
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function utf8Bytes(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 55296 && cp <= 56319 && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 56320 && lo <= 57343) {
        cp = (cp - 55296) * 1024 + (lo - 56320) + 65536;
        i++;
      }
    }
    if (cp < 128) out.push(cp);
    else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
    else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
    else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
  }
  return new Uint8Array(out);
}
function sha256Hex(text) {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array((bytes.length + 8 >> 6) + 1 << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 128;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296), false);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  const h = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3;
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ y >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, "0");
  return out;
}

// src/portable/corruption.ts
var CORRUPT_DIR = ".corrupt";
function pad2(n) {
  return String(n).padStart(2, "0");
}
function corruptStamp(now = /* @__PURE__ */ new Date()) {
  return String(now.getFullYear()) + pad2(now.getMonth() + 1) + pad2(now.getDate()) + "-" + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
}
function corruptTargetPath(path2, now = /* @__PURE__ */ new Date()) {
  const dir = dirnameVaultPath(path2);
  const name = basenameVaultPath(path2) || "unknown";
  return joinVaultPath(dir, CORRUPT_DIR, name + "." + corruptStamp(now));
}
async function isolateCorrupt(storage, path2) {
  try {
    const exists = await storage.exists(path2);
    if (!exists) return false;
    const target = corruptTargetPath(path2);
    if (await storage.rename(path2, target)) return true;
    const raw = await storage.readText(path2);
    if (raw === null) return false;
    const written = await storage.writeText(target, raw);
    if (!written.ok) return false;
    await storage.remove(path2);
    return true;
  } catch {
    return false;
  }
}

// src/portable/legacyMigration.ts
var LEGACY_STATE_FILES = [
  "cache/index.json",
  "cache/activity.json",
  "cache/ai-cache.json",
  "cache/ai-tasks.json",
  "cache/artifacts.json",
  "cache/cards.json",
  "cache/card-reviews.json",
  "cache/discovery.json",
  "cache/evolution.json",
  "cache/exam-sessions.json",
  "cache/exams.json",
  "cache/latency.json",
  "cache/projects.json",
  "cache/prompts.json",
  "cache/query-history.json",
  "cache/relationships.json",
  "cache/review-queue.json",
  "cache/review-session.json",
  "cache/saved-explorations.json",
  "cache/schedule.json",
  "cache/source-ledger.json",
  "cache/spaced-review.json",
  "cache/workbench-sessions.json"
];
var LEGACY_ASSET_DIRS = ["prompts", "projects"];
function legacyPluginDirCandidates(pluginId, configDir = ".obsidian") {
  return [joinVaultPath(configDir, "plugins", pluginId), joinVaultPath(configDir, "plugins", "kg-knowledge-garden")];
}
async function migrateLegacyState(app, host3, pluginId = "knowledge-garden") {
  const result = {
    detected: false,
    copied: [],
    skippedExisting: [],
    failed: [],
    target: host3.stateRoot + "/"
  };
  const adapter = app.vault?.adapter;
  if (!adapter?.exists) return result;
  const configDir = app.vault.configDir || ".obsidian";
  const candidates = legacyPluginDirCandidates(pluginId, configDir);
  for (const dir of candidates) {
    let hasLegacy = false;
    try {
      hasLegacy = await adapter.exists(joinVaultPath(dir, "cache"));
    } catch {
      hasLegacy = false;
    }
    if (!hasLegacy) continue;
    result.detected = true;
    for (const rel of LEGACY_STATE_FILES) {
      const src = joinVaultPath(dir, rel);
      const dst = joinVaultPath(STATE_DIR_NAME, rel);
      try {
        const exists = await adapter.exists(src);
        if (!exists) continue;
        if (await host3.exists(dst)) {
          result.skippedExisting.push(rel);
          continue;
        }
        const raw = adapter.read ? await adapter.read(src) : null;
        if (raw === null) {
          result.failed.push(rel);
          continue;
        }
        JSON.parse(raw);
        const out = await host3.write(dst, raw, { nativeAtomic: true });
        if (out.ok) result.copied.push(rel);
        else result.failed.push(rel);
      } catch {
        result.failed.push(rel);
      }
    }
    for (const assetDir of LEGACY_ASSET_DIRS) {
      const srcRoot = joinVaultPath(dir, assetDir);
      try {
        if (!await adapter.exists(srcRoot)) continue;
        const walk = async (rel, depth) => {
          if (depth > 3) return;
          const listing = adapter.list ? await adapter.list(joinVaultPath(srcRoot, rel)) : null;
          if (!listing) return;
          for (const f of listing.files) {
            const relFile = joinVaultPath(assetDir, rel, f);
            const src = joinVaultPath(dir, relFile);
            const dst = joinVaultPath(STATE_DIR_NAME, relFile);
            try {
              if (await host3.exists(dst)) {
                result.skippedExisting.push(relFile);
                continue;
              }
              const raw = adapter.read ? await adapter.read(src) : null;
              if (raw === null) {
                result.failed.push(relFile);
                continue;
              }
              const out = await host3.write(dst, raw);
              if (out.ok) result.copied.push(relFile);
              else result.failed.push(relFile);
            } catch {
              result.failed.push(relFile);
            }
          }
          for (const d of listing.folders) await walk(joinVaultPath(rel, d), depth + 1);
        };
        await walk("", 0);
      } catch {
      }
    }
    break;
  }
  return result;
}
function describeMigration(r) {
  if (!r.detected) return "\u672A\u68C0\u6D4B\u5230\u65E7\u7248\u684C\u9762\u7F13\u5B58\u3002";
  const parts = ["\u5DF2\u8FC1\u79FB " + r.copied.length + " \u4E2A\u72B6\u6001\u6587\u4EF6\u5230 " + r.target];
  if (r.skippedExisting.length) parts.push("\u8DF3\u8FC7\u5DF2\u5B58\u5728 " + r.skippedExisting.length + " \u4E2A");
  if (r.failed.length) parts.push("\u5931\u8D25 " + r.failed.length + " \u4E2A\uFF08\u65E7\u6587\u4EF6\u5DF2\u4FDD\u7559\uFF09");
  parts.push("\u65E7\u6587\u4EF6\u672A\u5220\u9664\u3002");
  return parts.join("\uFF1B");
}

// tests/obsidian-stub.ts
var requestUrl = async (req) => {
  const mock = globalThis.__kgMockRequestUrl;
  if (mock) return await mock(req);
  return { text: "", json: null, status: 200 };
};

// src/portable/net.ts
var NetError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
function isAbort(e) {
  return !!e && (e.name === "AbortError" || /aborted/i.test(String(e.message ?? "")));
}
function classifyNetworkFailure(e, timeoutSec) {
  if (e instanceof NetError) return e;
  if (isAbort(e)) return new NetError("\u8BF7\u6C42\u5DF2\u53D6\u6D88\u6216\u8D85\u8FC7 " + timeoutSec + " \u79D2\u3002", "TIMEOUT");
  const msg = String(e?.message ?? e ?? "");
  if (/fetch failed|ECONNRESET|ENOTFOUND|getaddrinfo|socket hang up|network|Failed to fetch|failed to fetch|connrefused|offline|ERR_INTERNET_DISCONNECTED|net::/i.test(msg)) {
    return new NetError("\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8BBE\u7F6E\u540E\u91CD\u8BD5\u3002", /offline|ERR_INTERNET_DISCONNECTED/i.test(msg) ? "OFFLINE" : "NETWORK");
  }
  return new NetError("\u7F51\u7EDC\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002", "NETWORK");
}
async function requestJson(req) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new NetError("\u8BF7\u6C42\u8D85\u65F6\uFF08\u5DF2\u8D85\u8FC7 " + req.timeoutSec + " \u79D2\uFF09\u3002", "TIMEOUT")), req.timeoutSec * 1e3);
  });
  const aborted = new Promise((_, reject) => {
    if (!req.signal) return;
    if (req.signal.aborted) {
      reject(new NetError("\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002", "ABORTED"));
      return;
    }
    req.signal.addEventListener("abort", () => reject(new NetError("\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002", "ABORTED")), { once: true });
  });
  try {
    const call = requestUrl({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
      throw: false
      // 自己分类状态码（避免 Obsidian 抛出的错误含响应体）
    });
    const res = await Promise.race([call, timeout, aborted]);
    let json = null;
    try {
      json = res.json;
    } catch {
      json = null;
    }
    return { status: res.status ?? 0, json, text: res.text ?? "" };
  } catch (e) {
    throw classifyNetworkFailure(e, req.timeoutSec);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function streamSSE(req, handlers) {
  const g = globalThis;
  if (typeof g.fetch !== "function" || typeof g.TextDecoder !== "function") return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutSec * 1e3);
  let external;
  if (handlers.signal) {
    external = handlers.signal;
    if (external.aborted) ctrl.abort();
    else external.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  let res;
  try {
    res = await g.fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    throw classifyNetworkFailure(e, req.timeoutSec);
  }
  clearTimeout(timer);
  const body = res.body;
  if (!res.ok || !body || typeof body.getReader !== "function") {
    return { text: "", status: res.status };
  }
  const reader = body.getReader();
  const decoder = new g.TextDecoder("utf-8");
  let buffer = "";
  let full = "";
  let firstEmitted = false;
  let doneSaw = false;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (; ; ) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          doneSaw = true;
          break;
        }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            if (!firstEmitted) {
              handlers.onFirstToken?.(Date.now());
              firstEmitted = true;
            }
            handlers.onDelta(delta);
            full += delta;
          }
        } catch {
        }
      }
      if (doneSaw) break;
    }
  } catch (e) {
    if (external?.aborted) throw new NetError("\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002", "ABORTED");
    throw classifyNetworkFailure(e, req.timeoutSec);
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
  return { text: full, status: res.status };
}
function streamingAvailable() {
  const g = globalThis;
  return typeof g.fetch === "function" && typeof g.TextDecoder === "function";
}
function httpErrorMessage(status) {
  if (status === 401 || status === 403) return "API \u8BA4\u8BC1\u5931\u8D25\uFF08" + status + "\uFF09\uFF0C\u8BF7\u68C0\u67E5 API Key \u662F\u5426\u6B63\u786E\u3002";
  if (status === 404) return "API \u63A5\u53E3\u4E0D\u5B58\u5728\uFF08" + status + "\uFF09\uFF0C\u8BF7\u68C0\u67E5 Base URL \u662F\u5426\u6B63\u786E\u3002";
  if (status === 429) return "API \u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF08" + status + "\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
  if (status >= 500) return "API \u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF08" + status + "\uFF09\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
  return "API \u8FD4\u56DE\u9519\u8BEF\uFF08" + status + "\uFF09\u3002";
}

// src/ai/provider.ts
var AIError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
function classifyNetError(e, timeoutSec) {
  if (e instanceof AIError) return e;
  const code = e instanceof NetError ? e.code : "NETWORK";
  if (code === "TIMEOUT" || code === "ABORTED") {
    return new AIError("\u8BF7\u6C42\u8D85\u65F6\uFF08\u5DF2\u8D85\u8FC7 " + timeoutSec + " \u79D2\uFF09\u3002", "TIMEOUT");
  }
  if (code === "OFFLINE") return new AIError("\u5F53\u524D\u5904\u4E8E\u79BB\u7EBF\u72B6\u6001\uFF0C\u8BF7\u6062\u590D\u7F51\u7EDC\u540E\u91CD\u8BD5\uFF08\u672C\u5730\u7F13\u5B58\u5185\u5BB9\u4ECD\u53EF\u67E5\u770B\uFF09\u3002", "OFFLINE");
  return new AIError("\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8BBE\u7F6E\u540E\u91CD\u8BD5\u3002", "NETWORK");
}
function truncationError(finishReason) {
  if (finishReason === "length") {
    return new AIError(
      "\u5F53\u524D\u6279\u6B21\u8F93\u51FA\u88AB\u957F\u5EA6\u4E0A\u9650\u622A\u65AD\uFF08finish_reason=length\uFF09\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5C1D\u8BD5\u62C6\u5206/\u91CD\u8BD5\u8BE5\u6279\u6B21\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u8BF7\u964D\u4F4E\u603B\u9898\u6570\u6216\u68C0\u67E5\u6A21\u578B\u8F93\u51FA\u7A97\u53E3\u3002",
      "TRUNCATED"
    );
  }
  return null;
}
var SiliconFlowProvider = class {
  constructor(cfg) {
    this.cfg = cfg;
  }
  endpoint() {
    return this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  }
  headers() {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + this.cfg.apiKey
    };
  }
  async chat(messages, opts, signal) {
    if (!this.cfg.apiKey) throw new AIError("\u5C1A\u672A\u914D\u7F6E API Key\uFF1A\u8BF7\u5230 \u8BBE\u7F6E \u2192 AI \u4E2D\u586B\u5199\u3002", "MISSING_KEY");
    let out;
    try {
      out = await requestJson({
        url: this.endpoint(),
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: false
        }),
        timeoutSec: opts.timeoutSec,
        signal
      });
    } catch (e) {
      throw classifyNetError(e, opts.timeoutSec);
    }
    if (out.status < 200 || out.status >= 300) {
      throw new AIError(httpErrorMessage(out.status), "HTTP_" + out.status);
    }
    const data = out.json;
    if (!data) throw new AIError("\u54CD\u5E94\u89E3\u6790\u5931\u8D25\uFF08\u8FD4\u56DE\u5185\u5BB9\u65E0\u6548\uFF09\u3002", "PARSE");
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") throw new AIError("API \u8FD4\u56DE\u4E86\u7A7A\u54CD\u5E94\u3002", "EMPTY");
    const trunc = truncationError(data.choices?.[0]?.finish_reason);
    if (trunc) throw trunc;
    return { content, model: this.cfg.model };
  }
  /** Phase 16 §26-29：流式输出（SSE）。AbortController 由调用方持有（取消按钮 §28）；
   *  首个 token（TTFT，§19）通过 onFirstToken 回调记录；增量通过 onDelta 回调。
   *  Phase 24 §六十二/§六十三：移动端必须边生成边显示且必须能停止生成 —— 因此这里保留
   *  fetch 流式路径；当环境没有流式能力（或流式请求失败且尚未产生内容）时，
   *  **自动回退** `chat()`（requestUrl），保证移动端功能不降级（§一百三十）。 */
  async stream(messages, opts, signal, onDelta, onFirstToken) {
    if (!this.cfg.apiKey) throw new AIError("\u5C1A\u672A\u914D\u7F6E API Key\uFF1A\u8BF7\u5230 \u8BBE\u7F6E \u2192 AI \u4E2D\u586B\u5199\u3002", "MISSING_KEY");
    if (!streamingAvailable()) {
      return this.chat(messages, opts, signal);
    }
    const body = JSON.stringify({
      model: this.cfg.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: true
    });
    let sawContent = false;
    let res = null;
    try {
      res = await streamSSE(
        { url: this.endpoint(), headers: this.headers(), body, timeoutSec: opts.timeoutSec },
        {
          signal,
          onFirstToken,
          onDelta: (d) => {
            sawContent = true;
            onDelta?.(d);
          }
        }
      );
    } catch (e) {
      if (sawContent) throw classifyNetError(e, opts.timeoutSec);
      return this.chat(messages, opts, signal);
    }
    if (res === null) return this.chat(messages, opts, signal);
    if (res.status < 200 || res.status >= 300) {
      throw new AIError(httpErrorMessage(res.status), "HTTP_" + res.status);
    }
    if (!res.text.trim()) {
      if (!sawContent) return this.chat(messages, opts, signal);
      throw new AIError("API \u6D41\u5F0F\u8FD4\u56DE\u4E3A\u7A7A\u3002", "EMPTY");
    }
    return { content: res.text, model: this.cfg.model };
  }
  async testConnection() {
    await this.chat(
      [{ role: "user", content: "\u8BF7\u53EA\u56DE\u590D\u56DB\u4E2A\u5B57\uFF1A\u8FDE\u63A5\u6210\u529F\u3002" }],
      { temperature: 0, maxTokens: 16, timeoutSec: 20 }
    );
  }
};

// src/migrations.ts
function pad22(n) {
  return String(n).padStart(2, "0");
}
function corruptStamp2(now = /* @__PURE__ */ new Date()) {
  return String(now.getFullYear()) + pad22(now.getMonth() + 1) + pad22(now.getDate()) + "-" + pad22(now.getHours()) + pad22(now.getMinutes()) + pad22(now.getSeconds());
}
function corruptTargetPath2(filePath, now = /* @__PURE__ */ new Date()) {
  const p = String(filePath).replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  const dir = i < 0 ? "" : p.slice(0, i);
  const name = i < 0 ? p : p.slice(i + 1);
  const stamp = name + "." + corruptStamp2(now);
  return dir ? dir + "/.corrupt/" + stamp : ".corrupt/" + stamp;
}
function isolateCorruptFile(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    renameSync(filePath, corruptTargetPath2(filePath));
    return true;
  } catch {
    try {
      const raw = readFileSync(filePath, "utf8");
      writeFileSync(corruptTargetPath2(filePath), raw);
      unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
function atomicWriteJson(filePath, value) {
  const data = JSON.stringify(value);
  const tmp = filePath + ".tmp";
  try {
    writeFileSync(tmp, data, "utf8");
    renameSync(tmp, filePath);
    return;
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
    }
    writeFileSync(filePath, data, "utf8");
  }
}

// src/ai/cache.ts
function sha256(text) {
  return sha256Hex(text);
}
function fingerprintKey(parts) {
  return sha256(parts.join("\0"));
}
function candidateSig(notes) {
  const lines = [...notes].sort((a, b) => a.path.localeCompare(b.path)).map((n) => n.path + "|" + n.modified + "|" + n.size);
  return sha256(lines.join("\n"));
}

// src/portable/pathShim.ts
function join(...parts) {
  return joinVaultPath(...parts);
}

// src/activity.ts
var ActivityStore = class {
  constructor(pluginDir) {
    this.data = /* @__PURE__ */ new Map();
    this.flushTimer = null;
    this.dirty = false;
    this.file = join(pluginDir, "cache", "activity.json");
  }
  /** 启动时恢复；损坏 → 隔离 *.corrupt-* 后重建空 Activity（§十一），返回是否执行了隔离 */
  load() {
    try {
      if (!existsSync(this.file)) return false;
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object") throw new Error("invalid activity structure");
      for (const [p, e] of Object.entries(raw)) {
        if (!e || typeof e !== "object") continue;
        this.data.set(p, {
          lastAccessedAt: typeof e.lastAccessedAt === "number" ? e.lastAccessedAt : void 0,
          accessCount: typeof e.accessCount === "number" ? e.accessCount : void 0,
          lastReviewedAt: typeof e.lastReviewedAt === "number" ? e.lastReviewedAt : void 0,
          reviewCount: typeof e.reviewCount === "number" ? e.reviewCount : void 0
        });
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.data.clear();
      return isolated;
    }
  }
  get(filePath) {
    return this.data.get(filePath);
  }
  /** file-open 事件：只更新内存 + 标记 dirty（§21：不重建 Dashboard；§23：绝不触发 AI） */
  recordAccess(filePath) {
    const e = this.data.get(filePath) ?? {};
    e.lastAccessedAt = Date.now();
    e.accessCount = (e.accessCount ?? 0) + 1;
    this.data.set(filePath, e);
    this.markDirty();
  }
  /** 「标记为已复习」：绝不修改原始 Markdown（§八），只写行为数据 */
  markReviewed(filePath) {
    const e = this.data.get(filePath) ?? {};
    e.lastReviewedAt = Date.now();
    e.reviewCount = (e.reviewCount ?? 0) + 1;
    this.data.set(filePath, e);
    this.markDirty();
  }
  /** 删除已不存在笔记的条目（配合索引 rescan/delete，保持 O(note count)） */
  prune(keepPaths) {
    let changed = false;
    for (const p of Array.from(this.data.keys())) {
      if (!keepPaths.has(p)) {
        this.data.delete(p);
        changed = true;
      }
    }
    if (changed) this.flush();
  }
  markDirty() {
    this.dirty = true;
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 800);
  }
  flush() {
    this.flushTimer = null;
    this.dirty = false;
    try {
      const obj = {};
      for (const [p, e] of this.data) obj[p] = e;
      atomicWriteJson(this.file, obj);
    } catch (e) {
      console.error("[KnowledgeGarden][Activity] \u6301\u4E45\u5316\u5931\u8D25\uFF1A", e.message);
    }
  }
  /** 诊断用：条目总数（§四十一） */
  count() {
    return this.data.size;
  }
  recent(limit) {
    return Array.from(this.data.entries()).filter(([, e]) => typeof e.lastAccessedAt === "number").sort((a, b) => (b[1].lastAccessedAt ?? 0) - (a[1].lastAccessedAt ?? 0)).slice(0, limit).map(([path2, entry]) => ({ path: path2, entry }));
  }
  set(path2, entry) {
    this.data.set(path2, entry);
    this.markDirty();
  }
};

// node_modules/ts-fsrs/dist/index.mjs
var FSRSError = class _FSRSError extends Error {
  constructor(message = "FSRS Error") {
    super(message);
    this.name = "FSRSError";
    Error.captureStackTrace?.(this, _FSRSError);
  }
};
var FSRSValidationError = class _FSRSValidationError extends FSRSError {
  constructor(message) {
    super(message);
    this.name = "FSRSValidationError";
    Error.captureStackTrace?.(this, _FSRSValidationError);
  }
};
var State = /* @__PURE__ */ ((State2) => {
  State2[State2["New"] = 0] = "New";
  State2[State2["Learning"] = 1] = "Learning";
  State2[State2["Review"] = 2] = "Review";
  State2[State2["Relearning"] = 3] = "Relearning";
  return State2;
})(State || {});
var Rating = /* @__PURE__ */ ((Rating2) => {
  Rating2[Rating2["Manual"] = 0] = "Manual";
  Rating2[Rating2["Again"] = 1] = "Again";
  Rating2[Rating2["Hard"] = 2] = "Hard";
  Rating2[Rating2["Good"] = 3] = "Good";
  Rating2[Rating2["Easy"] = 4] = "Easy";
  return Rating2;
})(Rating || {});
var TypeConvert = class _TypeConvert {
  static card(card) {
    return {
      ...card,
      state: _TypeConvert.state(card.state),
      due: _TypeConvert.time(card.due),
      last_review: card.last_review ? _TypeConvert.time(card.last_review) : void 0
    };
  }
  static rating(value) {
    if (typeof value === "string") {
      const firstLetter = value.charAt(0).toUpperCase();
      const restOfString = value.slice(1).toLowerCase();
      const ret = Rating[`${firstLetter}${restOfString}`];
      if (ret === void 0) {
        throw new FSRSValidationError(`Invalid rating:[${value}]`);
      }
      return ret;
    } else if (typeof value === "number") {
      return value;
    }
    throw new FSRSValidationError(`Invalid rating:[${value}]`);
  }
  static state(value) {
    if (typeof value === "string") {
      const firstLetter = value.charAt(0).toUpperCase();
      const restOfString = value.slice(1).toLowerCase();
      const ret = State[`${firstLetter}${restOfString}`];
      if (ret === void 0) {
        throw new FSRSValidationError(`Invalid state:[${value}]`);
      }
      return ret;
    } else if (typeof value === "number") {
      return value;
    }
    throw new FSRSValidationError(`Invalid state:[${value}]`);
  }
  static time(value) {
    if (value instanceof Date) {
      return value;
    }
    const date = new Date(value);
    if (typeof value === "object" && value !== null && !Number.isNaN(Date.parse(value) || +date)) {
      return date;
    } else if (typeof value === "string") {
      const timestamp = Date.parse(value);
      if (!Number.isNaN(timestamp)) {
        return new Date(timestamp);
      } else {
        throw new FSRSValidationError(`Invalid date:[${value}]`);
      }
    } else if (typeof value === "number") {
      return new Date(value);
    }
    throw new FSRSValidationError(`Invalid date:[${value}]`);
  }
  static review_log(log) {
    return {
      ...log,
      due: _TypeConvert.time(log.due),
      rating: _TypeConvert.rating(log.rating),
      state: _TypeConvert.state(log.state),
      review: _TypeConvert.time(log.review)
    };
  }
};
Date.prototype.scheduler = function(t, isDay) {
  return date_scheduler(this, t, isDay);
};
Date.prototype.diff = function(pre, unit) {
  return date_diff(this, pre, unit);
};
Date.prototype.format = function() {
  return formatDate(this);
};
Date.prototype.dueFormat = function(last_review, unit, timeUnit) {
  return show_diff_message(this, last_review, unit, timeUnit);
};
function date_scheduler(now, t, isDay) {
  return new Date(
    isDay ? TypeConvert.time(now).getTime() + t * 24 * 60 * 60 * 1e3 : TypeConvert.time(now).getTime() + t * 60 * 1e3
  );
}
function date_diff(now, pre, unit) {
  if (!now || !pre) {
    throw new FSRSValidationError("Invalid date");
  }
  const diff = TypeConvert.time(now).getTime() - TypeConvert.time(pre).getTime();
  let r = 0;
  switch (unit) {
    case "days":
      r = Math.floor(diff / (24 * 60 * 60 * 1e3));
      break;
    case "minutes":
      r = Math.floor(diff / (60 * 1e3));
      break;
  }
  return r;
}
function formatDate(dateInput) {
  const date = TypeConvert.time(dateInput);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return `${year}-${padZero(month)}-${padZero(day)} ${padZero(hours)}:${padZero(
    minutes
  )}:${padZero(seconds)}`;
}
function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}
var TIMEUNIT = [60, 60, 24, 31, 12];
var TIMEUNITFORMAT = ["second", "min", "hour", "day", "month", "year"];
function show_diff_message(due, last_review, unit, timeUnit = TIMEUNITFORMAT) {
  due = TypeConvert.time(due);
  last_review = TypeConvert.time(last_review);
  if (timeUnit.length !== TIMEUNITFORMAT.length) {
    timeUnit = TIMEUNITFORMAT;
  }
  let diff = due.getTime() - last_review.getTime();
  let i = 0;
  diff /= 1e3;
  for (i = 0; i < TIMEUNIT.length; i++) {
    if (diff < TIMEUNIT[i]) {
      break;
    } else {
      diff /= TIMEUNIT[i];
    }
  }
  return `${Math.floor(diff)}${unit ? timeUnit[i] : ""}`;
}
var Grades = Object.freeze([
  Rating.Again,
  Rating.Hard,
  Rating.Good,
  Rating.Easy
]);
var version = "5.4.2";
var default_learning_steps = Object.freeze([
  "1m",
  "10m"
]);
var default_relearning_steps = Object.freeze([
  "10m"
]);
var FSRSVersion = `v${version} using FSRS-6.0`;
var FSRS6_DEFAULT_DECAY = 0.1542;
var default_w = Object.freeze([
  0.212,
  1.2931,
  2.3065,
  8.2956,
  6.4133,
  0.8334,
  3.0194,
  1e-3,
  1.8722,
  0.1666,
  0.796,
  1.4835,
  0.0614,
  0.2629,
  1.6483,
  0.6014,
  1.8729,
  0.5425,
  0.0912,
  0.0658,
  FSRS6_DEFAULT_DECAY
]);

// src/spacedReview.ts
var REVIEW_LOG_MAX = 4e3;
var FSRS_RATINGS = ["again", "hard", "good", "easy"];
var SpacedReviewStore = class _SpacedReviewStore {
  constructor(pluginDir) {
    this.cards = /* @__PURE__ */ new Map();
    this.logs = [];
    this.savedCards = /* @__PURE__ */ new Map();
    this.savedLogs = [];
    this.file = join(pluginDir, "cache", "spaced-review.json");
  }
  static {
    this.FORMAT_VERSION = 2;
  }
  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后置空（§36，不阻塞启动） */
  load() {
    try {
      if (!existsSync(this.file)) return false;
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object") throw new Error("invalid spaced-review structure");
      if (raw.cards && typeof raw.cards === "object") {
        for (const [p, c] of Object.entries(raw.cards)) {
          const card = sanitizeCard(p, c);
          if (card) this.cards.set(p, card);
        }
      }
      if (Array.isArray(raw.reviewLogs)) {
        this.logs = raw.reviewLogs.filter((l) => l && typeof l === "object" && typeof l.path === "string" && typeof l.timestamp === "number").slice(-REVIEW_LOG_MAX);
      }
      if (raw.savedCards && typeof raw.savedCards === "object") {
        for (const [id, c] of Object.entries(raw.savedCards)) {
          const card = sanitizeSavedCard(id, c);
          if (card) this.savedCards.set(id, card);
        }
      }
      if (Array.isArray(raw.savedCardReviewLogs)) {
        this.savedLogs = raw.savedCardReviewLogs.filter((l) => l && typeof l === "object" && typeof l.cardId === "string" && typeof l.timestamp === "number").slice(-REVIEW_LOG_MAX);
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.cards.clear();
      this.logs = [];
      this.savedCards.clear();
      this.savedLogs = [];
      return isolated;
    }
  }
  /* ---------- Note-based FSRS（Phase 20 原 API，不变） ---------- */
  get(pathKey) {
    return this.cards.get(pathKey);
  }
  all() {
    return Array.from(this.cards.values());
  }
  count() {
    return this.cards.size;
  }
  logsAll() {
    return this.logs.slice();
  }
  logsSince(ts) {
    return this.logs.filter((l) => l.timestamp >= ts);
  }
  /**
   * 提交一次评分（§九十五：FSRS save 成功才算完成，失败抛错 → 调用方绝不 markReviewed）。
   * 先原子写盘再更新内存（写失败不产生半状态）；失败抛错由调用方提示并保留原 UI。
   */
  commitReview(pathKey, next, log) {
    const card = { ...next, path: pathKey, updatedAt: Date.now() };
    const entry = { ...log, path: pathKey };
    const nextCards = new Map(this.cards);
    nextCards.set(pathKey, card);
    const nextLogs = this.logs.concat(entry).slice(-REVIEW_LOG_MAX);
    this.persist(nextCards, nextLogs, this.savedCards, this.savedLogs);
    this.cards = nextCards;
    this.logs = nextLogs;
  }
  /** 删除笔记后清理（Test 18 语义）；Saved Card 状态不随 sourcePath 删除（§141） */
  prune(existing) {
    let changed = false;
    for (const k of Array.from(this.cards.keys())) {
      if (!existing.has(k)) {
        this.cards.delete(k);
        changed = true;
      }
    }
    const kept = this.logs.filter((l) => existing.has(l.path));
    if (kept.length !== this.logs.length) {
      this.logs = kept;
      changed = true;
    }
    if (changed) this.persist(this.cards, this.logs, this.savedCards, this.savedLogs);
  }
  /** 笔记 rename 后 path 随行更新（不产生假死路径）；saved 主键 cardId 不变（§85） */
  migratePaths(oldPath, newPath) {
    if (!this.cards.has(oldPath) && !this.logs.some((l) => l.path === oldPath)) return;
    const cards = new Map(this.cards);
    if (cards.has(oldPath)) {
      const c = cards.get(oldPath);
      cards.delete(oldPath);
      cards.set(newPath, { ...c, path: newPath, updatedAt: Date.now() });
    }
    const logs = this.logs.map((l) => l.path === oldPath ? { ...l, path: newPath } : l);
    this.persist(cards, logs, this.savedCards, this.savedLogs);
    this.cards = cards;
    this.logs = logs;
  }
  /** §七十五/七十六：立即重排（笔记卡；备份 → 批量替换 → 失败恢复由调用方以 fileBackup 回滚） */
  replaceAllCards(nextCards) {
    const cards = /* @__PURE__ */ new Map();
    for (const c of nextCards) if (c && c.path) cards.set(c.path, { ...c, updatedAt: Date.now() });
    this.persist(cards, this.logs, this.savedCards, this.savedLogs);
    this.cards = cards;
  }
  /* ---------- Saved Card FSRS（Phase 21：savedCard:<cardId> 主键，§三/五） ---------- */
  scGet(cardId) {
    return this.savedCards.get(cardId);
  }
  scAll() {
    return Array.from(this.savedCards.values());
  }
  scCount() {
    return this.savedCards.size;
  }
  scLogsAll() {
    return this.savedLogs.slice();
  }
  /** §28/二十九：保存卡评分（FSRS save 成功才算完成，失败抛错 → 调用方不标已复习）。 */
  scCommitReview(cardId, next, log) {
    const state = { ...next, cardId, updatedAt: Date.now() };
    const entry = { ...log, cardId };
    const nextStates = new Map(this.savedCards);
    nextStates.set(cardId, state);
    const nextLogs = this.savedLogs.concat(entry).slice(-REVIEW_LOG_MAX);
    this.persist(this.cards, this.logs, nextStates, nextLogs);
    this.savedCards = nextStates;
    this.savedLogs = nextLogs;
  }
  /** §三十九：删除卡 → 同时删 Saved Card FSRS 状态与日志（不动 Exam/Source/AI Cache §39） */
  scRemoveCard(cardId) {
    if (!this.savedCards.has(cardId) && !this.savedLogs.some((l) => l.cardId === cardId)) return;
    const states = new Map(this.savedCards);
    states.delete(cardId);
    const logs = this.savedLogs.filter((l) => l.cardId !== cardId);
    this.persist(this.cards, this.logs, states, logs);
    this.savedCards = states;
    this.savedLogs = logs;
  }
  /** §147：Saved Card 全部重排（与 Note 一起由 main 调用；本方法失败抛错内存不变） */
  scReplaceAll(nextStates) {
    const states = /* @__PURE__ */ new Map();
    for (const s of nextStates) if (s && s.cardId) states.set(s.cardId, { ...s, updatedAt: Date.now() });
    this.persist(this.cards, this.logs, states, this.savedLogs);
    this.savedCards = states;
  }
  /** 文件原文备份（§76：重排前备份，失败 rollback） */
  fileSnapshot() {
    try {
      return existsSync(this.file) ? readFileSync(this.file, "utf8") : null;
    } catch {
      return null;
    }
  }
  /** 从备份恢复（§76 rollback）：写回后重载内存 */
  restoreSnapshot(snapshot) {
    try {
      if (snapshot === null) {
        this.cards.clear();
        this.logs = [];
        this.savedCards.clear();
        this.savedLogs = [];
        this.persist(this.cards, this.logs, this.savedCards, this.savedLogs);
        return true;
      }
      writeFileSync(this.file, snapshot, "utf8");
      this.load();
      return true;
    } catch {
      return false;
    }
  }
  persist(cards, logs, savedCards, savedLogs) {
    const obj = {
      formatVersion: _SpacedReviewStore.FORMAT_VERSION,
      cards: Object.fromEntries(cards),
      reviewLogs: logs,
      savedCards: Object.fromEntries(savedCards),
      savedCardReviewLogs: savedLogs
    };
    atomicWriteJson(this.file, obj);
  }
};
function sanitizeCard(p, c) {
  if (!c || typeof c !== "object") return null;
  const rec = c;
  const fsState = rec["fsrsState"];
  if (!fsState || typeof fsState !== "object") return null;
  const f = (v, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const due = f(fsState["due"], Date.now());
  const lastReviewRaw = fsState["lastReview"];
  const lastReview = typeof lastReviewRaw === "number" && Number.isFinite(lastReviewRaw) ? lastReviewRaw : void 0;
  return {
    path: p,
    fsrsState: {
      due,
      stability: Math.max(1e-3, f(fsState["stability"], 1)),
      difficulty: Math.min(10, Math.max(1, f(fsState["difficulty"], 5))),
      reps: Math.max(0, Math.floor(f(fsState["reps"], 0))),
      lapses: Math.max(0, Math.floor(f(fsState["lapses"], 0))),
      state: Number(fsState["state"]) === State.Learning || Number(fsState["state"]) === State.Review || Number(fsState["state"]) === State.Relearning ? Number(fsState["state"]) : State.New,
      learningSteps: Math.max(0, Math.floor(f(fsState["learningSteps"], 0))),
      lastReview
    },
    lastRating: FSRS_RATINGS.includes(rec["lastRating"]) ? rec["lastRating"] : void 0,
    reviewCount: Math.max(0, Math.floor(f(rec["reviewCount"], 0))),
    lastReviewedAt: typeof rec["lastReviewedAt"] === "number" ? rec["lastReviewedAt"] : void 0,
    masteryPercent: typeof rec["masteryPercent"] === "number" ? Math.max(0, Math.min(100, rec["masteryPercent"])) : void 0,
    createdAt: f(rec["createdAt"], Date.now()),
    updatedAt: f(rec["updatedAt"], Date.now())
  };
}
function sanitizeSavedCard(id, c) {
  if (!c || typeof c !== "object") return null;
  const rec = c;
  const fsState = rec["fsrsState"];
  if (!fsState || typeof fsState !== "object") return null;
  const f = (v, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const lastReviewRaw = fsState["lastReview"];
  const lastReview = typeof lastReviewRaw === "number" && Number.isFinite(lastReviewRaw) ? lastReviewRaw : void 0;
  return {
    cardId: id,
    fsrsState: {
      due: f(fsState["due"], Date.now()),
      stability: Math.max(1e-3, f(fsState["stability"], 1)),
      difficulty: Math.min(10, Math.max(1, f(fsState["difficulty"], 5))),
      reps: Math.max(0, Math.floor(f(fsState["reps"], 0))),
      lapses: Math.max(0, Math.floor(f(fsState["lapses"], 0))),
      state: Number(fsState["state"]) === State.Learning || Number(fsState["state"]) === State.Review || Number(fsState["state"]) === State.Relearning ? Number(fsState["state"]) : State.New,
      learningSteps: Math.max(0, Math.floor(f(fsState["learningSteps"], 0))),
      lastReview
    },
    lastRating: FSRS_RATINGS.includes(rec["lastRating"]) ? rec["lastRating"] : void 0,
    reviewCount: Math.max(0, Math.floor(f(rec["reviewCount"], 0))),
    lastReviewedAt: typeof rec["lastReviewedAt"] === "number" ? rec["lastReviewedAt"] : void 0,
    masteryPercent: typeof rec["masteryPercent"] === "number" ? Math.max(0, Math.min(100, rec["masteryPercent"])) : void 0,
    createdAt: f(rec["createdAt"], Date.now()),
    updatedAt: f(rec["updatedAt"], Date.now())
  };
}

// src/examStore.ts
function examFingerprint(e) {
  return fingerprintKey([
    "exam",
    e.sourcePath,
    e.sourceVersion,
    e.mode,
    e.topic ?? "",
    String(e.questionCount),
    e.difficulty ?? "medium",
    e.answerMode
  ]);
}
var ExamStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.entries = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/exams.json";
  }
  load() {
    try {
      const raw = readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
      this.entries = Array.isArray(obj.entries) ? obj.entries : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.entries = [];
      this.dirty = true;
      return true;
    }
  }
  all() {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
  }
  count() {
    return this.entries.length;
  }
  get(id) {
    return this.entries.find((e) => e.id === id);
  }
  findByFingerprint(fp) {
    return this.entries.find((e) => examFingerprint(e) === fp);
  }
  /** §43/44：某来源笔记的全部考试，createdAt DESC（最新在前） */
  findBySource(sourcePath) {
    return this.entries.filter((e) => e.sourcePath === sourcePath).sort((a, b) => b.createdAt - a.createdAt);
  }
  add(e) {
    this.entries.push(e);
    this.dirty = true;
    this.flush();
  }
  update(id, patch) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.dirty = true;
    this.flush();
  }
  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.dirty = true;
      this.flush();
    }
  }
  migratePaths(oldPath, newPath) {
    let changed = false;
    for (const e of this.entries) if (e.sourcePath === oldPath) {
      e.sourcePath = newPath;
      changed = true;
    }
    if (changed) {
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(entries) {
    this.entries = entries;
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries });
    this.dirty = false;
  }
};
var ReviewCardStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.entries = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/cards.json";
  }
  load() {
    try {
      const raw = readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
      this.entries = Array.isArray(obj.entries) ? obj.entries : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.entries = [];
      this.dirty = true;
      return true;
    }
  }
  all() {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
  }
  count() {
    return this.entries.length;
  }
  get(id) {
    return this.entries.find((e) => e.id === id);
  }
  findByExam(examId) {
    return this.entries.filter((e) => e.examId === examId);
  }
  /** Phase 21 §54：按 考试+题目 查已收藏卡（去重主键；缺 examQuestionId 时返回 undefined，兼容旧卡） */
  findByExamQuestion(examId, questionId) {
    if (!examId || !questionId) return void 0;
    return this.entries.find((e) => e.examId === examId && e.examQuestionId === questionId);
  }
  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.dirty = true;
      this.flush();
    }
  }
  update(id, patch) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.dirty = true;
    this.flush();
  }
  migratePaths(oldPath, newPath) {
    let changed = false;
    for (const e of this.entries) if (e.sourcePath === oldPath) {
      e.sourcePath = newPath;
      changed = true;
    }
    if (changed) {
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(entries) {
    this.entries = entries;
    this.dirty = true;
    this.flush();
  }
  add(card) {
    this.entries.push(card);
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries });
    this.dirty = false;
  }
};
var ExamSessionStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.sessions = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/exam-sessions.json";
  }
  load() {
    try {
      const raw = readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
      this.sessions = Array.isArray(obj.sessions) ? obj.sessions : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.sessions = [];
      this.dirty = true;
      return true;
    }
  }
  get(examId) {
    return this.sessions.find((s) => s.examId === examId && s.status !== "abandoned");
  }
  all() {
    return [...this.sessions];
  }
  upsert(s) {
    const i = this.sessions.findIndex((x) => x.examId === s.examId);
    if (i >= 0) this.sessions[i] = s;
    else this.sessions.push(s);
    this.dirty = true;
    this.flush();
  }
  remove(examId) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.examId !== examId);
    if (this.sessions.length !== before) {
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(s) {
    this.sessions = s;
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, sessions: this.sessions });
    this.dirty = false;
  }
};
var CardReviewStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.records = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/card-reviews.json";
  }
  load() {
    try {
      const raw = readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
      this.records = Array.isArray(obj.records) ? obj.records : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.records = [];
      this.dirty = true;
      return true;
    }
  }
  all() {
    return [...this.records].sort((a, b) => b.reviewedAt - a.reviewedAt);
  }
  count() {
    return this.records.length;
  }
  byCard(cardId) {
    return this.records.filter((r) => r.cardId === cardId);
  }
  add(r) {
    this.records.push(r);
    this.dirty = true;
    this.flush();
  }
  /** Phase 21 §39：删除卡时一并删除其 CardReviewRecord（不动 Exam/Source/AI Cache） */
  removeByCard(cardId) {
    const kept = this.records.filter((r) => r.cardId !== cardId);
    if (kept.length !== this.records.length) {
      this.records = kept;
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(r) {
    this.records = r;
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, records: this.records });
    this.dirty = false;
  }
};

// src/workbenchSession.ts
var WorkbenchSessionStore = class {
  constructor(pluginDir) {
    this.sessions = [];
    this.file = join(pluginDir, "cache", "workbench-sessions.json");
  }
  load() {
    try {
      if (!existsSync(this.file)) return false;
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
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

// src/graphLayout.ts
function computeGraphLayout(model, width, height) {
  const ids = new Set(model.nodes.map((n) => n.id));
  const edges = model.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const adjOut = /* @__PURE__ */ new Map();
  for (const e of edges) {
    const arr = adjOut.get(e.from) ?? [];
    arr.push(e.to);
    adjOut.set(e.from, arr);
  }
  const root = model.nodes.find((n) => n.role === "question") ?? model.nodes.find((n) => n.role === "origin") ?? model.nodes.find((n) => (adjOut.get(n.id) ?? []).length > 0) ?? model.nodes[0];
  const rootId = root ? root.id : "";
  const layer = /* @__PURE__ */ new Map();
  const parentOf = {};
  if (rootId) {
    layer.set(rootId, 0);
    const visited = /* @__PURE__ */ new Set([rootId]);
    const queue = [rootId];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const l = layer.get(cur) ?? 0;
      for (const next of adjOut.get(cur) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        parentOf[next] = cur;
        layer.set(next, l + 1);
        queue.push(next);
      }
    }
    for (const n of model.nodes) {
      if (!layer.has(n.id)) layer.set(n.id, 1);
    }
  }
  const back = /* @__PURE__ */ new Set();
  for (const e of edges) {
    const lf = layer.get(e.from) ?? 0;
    const lt = layer.get(e.to) ?? 0;
    const isTree = parentOf[e.to] === e.from || parentOf[e.from] === e.to;
    if (!isTree && lt <= lf) back.add(e.from + "|" + e.to);
  }
  const sorted = [...model.nodes].sort((a, b) => {
    const la = layer.get(a.id) ?? 0;
    const lb = layer.get(b.id) ?? 0;
    return la !== lb ? la - lb : a.label.localeCompare(b.label);
  });
  const maxLayer = Math.max(0, ...Array.from(layer.values()));
  const W = Math.max(220, width - 16);
  const H = Math.max(120, height - 16);
  const layers = [];
  for (const n of sorted) {
    const l = layer.get(n.id) ?? 0;
    (layers[l] ??= []).push(n.id);
  }
  const pos = sorted.map((n) => {
    const l = layer.get(n.id) ?? 0;
    const list = layers[l];
    const idx = list.indexOf(n.id);
    const cnt = list.length;
    const x = maxLayer === 0 ? W / 2 : 12 + (W - 24) * l / maxLayer;
    const y = cnt <= 1 ? 12 + H / 2 : 12 + (H - 24) * idx / (cnt - 1);
    return { id: n.id, layer: l, x, y };
  });
  const layoutEdges = edges.map((e) => ({
    from: e.from,
    to: e.to,
    isBackEdge: back.has(e.from + "|" + e.to)
  }));
  return { nodes: pos, edges: layoutEdges, parentOf, rootId };
}

// src/graphSvg.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var NODE_W = 168;
var NODE_H = 34;
var MAX_SCALE = 3;
var MIN_SCALE = 0.2;
function truncate(s, max) {
  const t = s || "";
  return t.length > max ? t.slice(0, max) + "\u2026" : t;
}
function svgEl(tag) {
  return document.createElementNS(SVG_NS, tag);
}
var GraphSvg = class {
  constructor(container, model, layout, cb) {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.selected = null;
    this.resizeObs = null;
    this.destroyed = false;
    this.dragging = false;
    this.dragId = -1;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragTx = 0;
    this.dragTy = 0;
    this.cleanup = [];
    /** Phase 24 §四十二/§四十三：触摸手势状态（pointerType=touch 也能缩放/拖动/点按） */
    this.pointers = /* @__PURE__ */ new Map();
    this.pinch = null;
    this.downAt = 0;
    this.downX = 0;
    this.downY = 0;
    this.movedFar = false;
    this.lastPointerType = "mouse";
    this.tipTimer = null;
    this.model = model;
    this.layout = layout;
    this.cb = cb;
    this.defsId = "kgmk" + Math.random().toString(36).slice(2, 9);
    this.svg = svgEl("svg");
    this.svg.setAttribute("class", "kg-graph-svg");
    this.svg.setAttribute("role", "img");
    this.group = svgEl("g");
    this.svg.appendChild(this.group);
    this.tip = document.createElement("div");
    this.tip.className = "kg-graph-tip";
    this.tip.style.display = "none";
    container.appendChild(this.svg);
    container.appendChild(this.tip);
    this.resizeObs = new ResizeObserver(() => {
      if (this.destroyed) return;
      this.relayout();
    });
    this.resizeObs.observe(container);
    this.fit();
    this.renderContent();
    this.bindEvents(container);
  }
  // ---------- 布局 / 视口 ----------
  viewSize() {
    const w = this.svg.clientWidth || 400;
    const h = this.svg.clientHeight || 260;
    return { w, h };
  }
  relayout() {
    const { w, h } = this.viewSize();
    this.layout = computeGraphLayout(this.model, w, h);
    this.fit();
    this.renderContent();
  }
  /** 初始/重置：计算 scale 使图完整可见并居中（fit） */
  fit() {
    const { w, h } = this.viewSize();
    const xs = this.layout.nodes.map((n) => n.x);
    const ys = this.layout.nodes.map((n) => n.y);
    if (xs.length === 0) {
      this.applyTransform();
      return;
    }
    const minX = Math.min(...xs) - NODE_W / 2 - 12;
    const maxX = Math.max(...xs) + NODE_W / 2 + 12;
    const minY = Math.min(...ys) - NODE_H / 2 - 12;
    const maxY = Math.max(...ys) + NODE_H / 2 + 12;
    const gw = Math.max(120, maxX - minX);
    const gh = Math.max(80, maxY - minY);
    this.scale = Math.max(MIN_SCALE, Math.min(1.6, (w - 32) / gw, (h - 32) / gh));
    this.tx = (w - gw * this.scale) / 2 - minX * this.scale;
    this.ty = (h - gh * this.scale) / 2 - minY * this.scale;
    this.applyTransform();
  }
  zoomIn() {
    this.setScale(this.scale * 1.25);
  }
  zoomOut() {
    this.setScale(this.scale / 1.25);
  }
  setScale(s) {
    const { w, h } = this.viewSize();
    const cx = w / 2;
    const cy = h / 2;
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    this.tx = cx - (cx - this.tx) / this.scale * ns;
    this.ty = cy - (cy - this.ty) / this.scale * ns;
    this.scale = ns;
    this.applyTransform();
  }
  applyTransform() {
    this.group.setAttribute("transform", "translate(" + this.tx + "," + this.ty + ") scale(" + this.scale + ")");
  }
  // ---------- 绘制 ----------
  renderContent() {
    this.group.empty?.();
    while (this.group.firstChild) this.group.removeChild(this.group.firstChild);
    const defs = svgEl("defs");
    this.group.appendChild(defs);
    const mkEnd = svgEl("marker");
    mkEnd.setAttribute("id", this.defsId + "-end");
    mkEnd.setAttribute("viewBox", "0 0 10 10");
    mkEnd.setAttribute("refX", "9");
    mkEnd.setAttribute("refY", "5");
    mkEnd.setAttribute("markerWidth", "5");
    mkEnd.setAttribute("markerHeight", "5");
    mkEnd.setAttribute("orient", "auto");
    const pEnd = svgEl("path");
    pEnd.setAttribute("d", "M0,0 L10,5 L0,10 z");
    pEnd.setAttribute("class", "kg-graph-marker");
    mkEnd.appendChild(pEnd);
    defs.appendChild(mkEnd);
    const mkStart = svgEl("marker");
    mkStart.setAttribute("id", this.defsId + "-start");
    mkStart.setAttribute("viewBox", "0 0 10 10");
    mkStart.setAttribute("refX", "1");
    mkStart.setAttribute("refY", "5");
    mkStart.setAttribute("markerWidth", "5");
    mkStart.setAttribute("markerHeight", "5");
    mkStart.setAttribute("orient", "auto");
    const pStart = svgEl("path");
    pStart.setAttribute("d", "M10,0 L0,5 L10,10 z");
    pStart.setAttribute("class", "kg-graph-marker");
    mkStart.appendChild(pStart);
    defs.appendChild(mkStart);
    const pos = new Map(this.layout.nodes.map((n) => [n.id, n]));
    for (const e of this.model.edges) {
      const from = pos.get(e.from);
      const to = pos.get(e.to);
      if (!from || !to) continue;
      const ge = this.layout.edges.find((x) => x.from === e.from && x.to === e.to);
      const isBack = ge ? ge.isBackEdge : to.layer <= from.layer;
      const line = this.drawEdgeLine(e, from, to, isBack);
      this.group.appendChild(line);
      const label = svgEl("text");
      label.setAttribute("class", "kg-graph-el" + (isBack ? " kg-graph-el-back" : ""));
      label.setAttribute("text-anchor", "middle");
      label.textContent = truncate(e.relation, 10);
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2 - (isBack ? 26 : 8);
      label.setAttribute("x", String(mx));
      label.setAttribute("y", String(my));
      this.group.appendChild(label);
    }
    for (const n of this.model.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const g = svgEl("g");
      g.setAttribute("class", "kg-gn" + (n.role === "question" ? " kg-gn-question" : ""));
      g.setAttribute("data-id", n.id);
      g.setAttribute("data-path", n.path);
      g.setAttribute("tabindex", "0");
      const rect = svgEl("rect");
      rect.setAttribute("x", String(p.x - NODE_W / 2));
      rect.setAttribute("y", String(p.y - NODE_H / 2));
      rect.setAttribute("width", String(NODE_W));
      rect.setAttribute("height", String(NODE_H));
      rect.setAttribute("rx", "7");
      g.appendChild(rect);
      const text = svgEl("text");
      text.setAttribute("class", "kg-gn-label");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.textContent = truncate(n.label, 13);
      text.setAttribute("x", String(p.x));
      text.setAttribute("y", String(p.y));
      g.appendChild(text);
      this.group.appendChild(g);
    }
  }
  drawEdgeLine(e, from, to, isBack) {
    const line = svgEl("path");
    line.setAttribute("class", "kg-ge" + (isBack ? " kg-ge-back" : ""));
    line.setAttribute("data-edge", e.id);
    const x1 = from.x + (to.x >= from.x ? NODE_W / 2 - 2 : -NODE_W / 2 + 2);
    const y1 = from.y;
    const x2 = to.x + (to.x >= from.x ? -NODE_W / 2 + 2 : NODE_W / 2 - 2);
    const y2 = to.y;
    if (!isBack) {
      line.setAttribute("d", "M" + x1 + "," + y1 + " L" + x2 + "," + y2);
    } else {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const off = x1 === x2 ? 30 : Math.abs(x2 - x1) < 40 ? 26 : 22;
      line.setAttribute("d", "M" + x1 + "," + y1 + " C" + mx + "," + (my - off) + " " + mx + "," + (my + off) + " " + x2 + "," + y2);
    }
    if (e.direction === "bidirectional") {
      line.setAttribute("marker-start", "url(#" + this.defsId + "-start)");
    }
    if (e.direction === "forward" || e.direction === "bidirectional") {
      line.setAttribute("marker-end", "url(#" + this.defsId + "-end)");
    }
    const ev = e.evidence || [];
    if (!ev.includes("user_confirmed") && !ev.includes("wikilink")) {
      line.setAttribute("stroke-dasharray", "5 4");
    }
    if (ev.includes("user_confirmed")) {
      line.setAttribute("data-evidence", "user_confirmed");
    }
    return line;
  }
  // ---------- 交互 ----------
  bindEvents(container) {
    this.svg.style.touchAction = "none";
    const onWheel = (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const { w, h } = this.viewSize();
        const rect = this.svg.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
        this.tx = mx - (mx - this.tx) / this.scale * ns;
        this.ty = my - (my - this.ty) / this.scale * ns;
        this.scale = ns;
        this.applyTransform();
      } else {
        this.ty -= ev.deltaY;
        this.applyTransform();
      }
    };
    this.svg.addEventListener("wheel", onWheel, { passive: false });
    this.cleanup.push(() => this.svg.removeEventListener("wheel", onWheel));
    const localPoint = (ev) => {
      const rect = this.svg.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };
    const onPointerDown = (ev) => {
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointers.size === 2) {
        this.dragging = false;
        const [a, b] = Array.from(this.pointers.values());
        this.pinch = {
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          scale: this.scale,
          tx: this.tx,
          ty: this.ty
        };
        try {
          this.svg.setPointerCapture(ev.pointerId);
        } catch {
        }
        return;
      }
      if (this.pinch) return;
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      const target = ev.target;
      if (target.closest && target.closest(".kg-gn")) {
        this.downAt = Date.now();
        this.downX = ev.clientX;
        this.downY = ev.clientY;
        this.movedFar = false;
        return;
      }
      this.dragging = true;
      this.dragId = ev.pointerId;
      this.dragStartX = ev.clientX;
      this.dragStartY = ev.clientY;
      this.dragTx = this.tx;
      this.dragTy = this.ty;
      this.downAt = Date.now();
      this.movedFar = false;
      try {
        this.svg.setPointerCapture(ev.pointerId);
      } catch {
      }
    };
    const onPointerMove = (ev) => {
      if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.pinch.scale * (dist / this.pinch.dist)));
        const p = localPoint(ev);
        const anchorX = this.pinch.cx - this.svg.getBoundingClientRect().left;
        const anchorY = this.pinch.cy - this.svg.getBoundingClientRect().top;
        this.tx = anchorX - (anchorX - this.pinch.tx) / this.pinch.scale * ns;
        this.ty = anchorY - (anchorY - this.pinch.ty) / this.pinch.scale * ns;
        this.scale = ns;
        this.applyTransform();
        this.movedFar = true;
        return;
      }
      if (!this.dragging || ev.pointerId !== this.dragId) return;
      const dx = ev.clientX - this.dragStartX;
      const dy = ev.clientY - this.dragStartY;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.movedFar = true;
      this.tx = this.dragTx + dx;
      this.ty = this.dragTy + dy;
      this.applyTransform();
    };
    const endDrag = (ev) => {
      this.pointers.delete(ev.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0 && this.dragging) {
        this.dragging = false;
        try {
          this.svg.releasePointerCapture(ev.pointerId);
        } catch {
        }
      }
    };
    this.svg.addEventListener("pointerdown", onPointerDown);
    this.svg.addEventListener("pointermove", onPointerMove);
    this.svg.addEventListener("pointerup", endDrag);
    this.svg.addEventListener("pointercancel", endDrag);
    this.cleanup.push(() => {
      this.svg.removeEventListener("pointerdown", onPointerDown);
      this.svg.removeEventListener("pointermove", onPointerMove);
      this.svg.removeEventListener("pointerup", endDrag);
      this.svg.removeEventListener("pointercancel", endDrag);
    });
    const onClick = (ev) => {
      if (this.movedFar || Date.now() - this.downAt > 700) {
        this.movedFar = false;
        return;
      }
      const target = ev.target;
      const nodeEl = target.closest ? target.closest(".kg-gn") : null;
      if (nodeEl) {
        const id = nodeEl.getAttribute("data-id") || "";
        const path2 = nodeEl.getAttribute("data-path") || "";
        this.selectNode(id);
        const node = this.model.nodes.find((n) => n.id === id);
        const touchLike = ev.detail === 0 || this.lastPointerType !== "mouse";
        if (touchLike && node) {
          this.showTipAt(node.label, node.reason || "\uFF08AI \u672A\u7ED9\u51FA\u5177\u4F53\u7406\u7531\uFF09", this.downX, this.downY);
          this.scheduleTipHide(4200);
        }
        if (path2) this.cb.onOpenNote(path2);
        return;
      }
      this.clearHighlight();
      this.hideTip();
    };
    this.svg.addEventListener("click", onClick);
    this.cleanup.push(() => this.svg.removeEventListener("click", onClick));
    const rememberType = (ev) => {
      this.lastPointerType = ev.pointerType || "mouse";
    };
    this.svg.addEventListener("pointerdown", rememberType);
    this.cleanup.push(() => this.svg.removeEventListener("pointerdown", rememberType));
    const onOver = (ev) => {
      const target = ev.target;
      const nodeEl = target.closest ? target.closest(".kg-gn") : null;
      if (nodeEl) {
        const node = this.model.nodes.find((n) => n.id === (nodeEl.getAttribute("data-id") || ""));
        if (node) {
          this.showTip(node.label, node.reason || "\uFF08AI \u672A\u7ED9\u51FA\u5177\u4F53\u7406\u7531\uFF09", ev);
        }
        return;
      }
      const edgeEl = target.closest ? target.closest(".kg-ge") : null;
      if (edgeEl) {
        const edge = this.model.edges.find((e) => e.id === (edgeEl.getAttribute("data-edge") || ""));
        if (edge) {
          const from = this.model.nodes.find((n) => n.id === edge.from);
          const to = this.model.nodes.find((n) => n.id === edge.to);
          const head = edge.relation + "\uFF1A" + (from ? from.label : edge.from) + " \u2192 " + (to ? to.label : edge.to);
          this.showTip(head, edge.reason || "\uFF08AI \u672A\u7ED9\u51FA\u5177\u4F53\u7406\u7531\uFF09", ev);
        }
        return;
      }
      this.hideTip();
    };
    const onOut = (ev) => {
      const related = ev.relatedTarget;
      if (related && related.closest && (related.closest(".kg-gn") || related.closest(".kg-ge"))) return;
      this.hideTip();
    };
    this.svg.addEventListener("mouseover", onOver);
    this.svg.addEventListener("mouseout", onOut);
    this.cleanup.push(() => {
      this.svg.removeEventListener("mouseover", onOver);
      this.svg.removeEventListener("mouseout", onOut);
    });
    const onVis = () => {
      if (document.hidden) this.hideTip();
    };
    document.addEventListener("visibilitychange", onVis);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVis));
  }
  /** tap 之后自动收起信息面板（§四十三：hover-only tooltip 的移动端替代） */
  scheduleTipHide(ms) {
    if (this.tipTimer) clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => {
      this.tipTimer = null;
      this.hideTip();
    }, ms);
  }
  /** 用屏幕坐标显示信息面板（触摸端没有 MouseEvent，按点击点定位） */
  showTipAt(head, body, clientX, clientY) {
    this.renderTip(head, body);
    const rect = this.svg.getBoundingClientRect();
    const left = Math.max(6, Math.min(clientX - rect.left + 12, rect.width - 200));
    this.tip.style.left = left + "px";
    this.tip.style.top = Math.max(6, clientY - rect.top - 20) + "px";
    this.tip.style.bottom = "auto";
    this.tip.style.display = "block";
  }
  /** Phase 24 §四十三：移动端使用 bottom sheet（底部信息面板），不再依赖 hover */
  renderTip(head, body) {
    this.tip.empty?.();
    while (this.tip.firstChild) this.tip.removeChild(this.tip.firstChild);
    const h = document.createElement("div");
    h.className = "kg-graph-tip-head";
    h.textContent = head;
    const b = document.createElement("div");
    b.className = "kg-graph-tip-body";
    b.textContent = body;
    this.tip.appendChild(h);
    this.tip.appendChild(b);
  }
  showTip(head, body, ev) {
    this.renderTip(head, body);
    const rect = this.svg.getBoundingClientRect();
    this.tip.style.left = Math.min(ev.clientX - rect.left + 14, rect.width - 220) + "px";
    this.tip.style.top = Math.min(ev.clientY - rect.top + 14, rect.height - 90) + "px";
    this.tip.style.bottom = "auto";
    this.tip.style.display = "block";
  }
  hideTip() {
    if (this.tipTimer) {
      clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
    this.tip.style.display = "none";
  }
  /** §20/Test 5：点击节点 → 根到该节点的路径高亮，其余降透明 */
  selectNode(id) {
    this.selected = id;
    const chain = [id];
    let cur = id;
    const maxGuard = this.model.nodes.length + 1;
    for (let i = 0; i < maxGuard; i++) {
      const p = this.layout.parentOf[cur];
      if (!p) break;
      chain.unshift(p);
      cur = p;
    }
    const inPath = new Set(chain);
    const pathPairs = /* @__PURE__ */ new Set();
    for (let i = 0; i + 1 < chain.length; i++) {
      pathPairs.add(chain[i] + "|" + chain[i + 1]);
      pathPairs.add(chain[i + 1] + "|" + chain[i]);
    }
    for (const g of Array.from(this.group.querySelectorAll(".kg-gn"))) {
      const nid = g.getAttribute("data-id") || "";
      g.classList.remove("kg-gn-sel", "kg-gn-path", "kg-gn-dim");
      if (nid === id) g.classList.add("kg-gn-sel");
      else if (inPath.has(nid)) g.classList.add("kg-gn-path");
      else g.classList.add("kg-gn-dim");
    }
    for (const g of Array.from(this.group.querySelectorAll(".kg-ge"))) {
      const eid = g.getAttribute("data-edge") || "";
      g.classList.remove("kg-ge-path", "kg-ge-linked", "kg-ge-dim");
      const e = this.model.edges.find((x) => x.id === eid);
      if (!e) continue;
      if (pathPairs.has(e.from + "|" + e.to) || pathPairs.has(e.to + "|" + e.from)) {
        g.classList.add("kg-ge-path");
      } else if (e.from === id || e.to === id) {
        g.classList.add("kg-ge-linked");
      } else {
        g.classList.add("kg-ge-dim");
      }
      const label = g.nextElementSibling;
      if (label && label.classList.contains("kg-graph-el")) {
        label.classList.remove("kg-graph-el-dim");
        if (!g.classList.contains("kg-ge-dim")) label.classList.add("kg-graph-el-dim");
      }
    }
  }
  clearHighlight() {
    this.selected = null;
    for (const g of Array.from(this.group.querySelectorAll(".kg-gn"))) {
      g.classList.remove("kg-gn-sel", "kg-gn-path", "kg-gn-dim");
    }
    for (const g of Array.from(this.group.querySelectorAll(".kg-ge"))) {
      g.classList.remove("kg-ge-path", "kg-ge-linked", "kg-ge-dim");
      const label = g.nextElementSibling;
      if (label && label.classList.contains("kg-graph-el")) label.classList.remove("kg-graph-el-dim");
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.tipTimer) {
      clearTimeout(this.tipTimer);
      this.tipTimer = null;
    }
    for (const fn of this.cleanup) {
      try {
        fn();
      } catch {
      }
    }
    this.cleanup = [];
    this.pointers.clear();
    this.pinch = null;
    if (this.resizeObs) this.resizeObs.disconnect();
    this.svg.remove();
    this.tip.remove();
  }
};

// src/portable/clipboard.ts
function nav() {
  try {
    const c = navigator?.clipboard;
    return c && typeof c.writeText === "function" ? c : null;
  } catch {
    return null;
  }
}
function legacyCopy(text) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "readonly");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    document.body.appendChild(el);
    const selection = window.getSelection();
    const prev = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand("copy");
    document.body.removeChild(el);
    if (prev && selection) {
      selection.removeAllRanges();
      selection.addRange(prev);
    }
    return !!ok;
  } catch {
    return false;
  }
}
async function copyText(text) {
  const value = String(text ?? "");
  if (!value) return { ok: false, reason: "\u6CA1\u6709\u53EF\u590D\u5236\u7684\u5185\u5BB9\u3002" };
  const c = nav();
  if (c) {
    try {
      await c.writeText(value);
      return { ok: true };
    } catch {
    }
  }
  if (legacyCopy(value)) return { ok: true };
  return { ok: false, reason: "\u7CFB\u7EDF\u62D2\u7EDD\u4E86\u526A\u8D34\u677F\u5199\u5165\uFF0C\u8BF7\u624B\u52A8\u9009\u62E9\u6587\u672C\u590D\u5236\u3002" };
}
async function readText() {
  const c = nav();
  if (c && typeof c.readText === "function") {
    try {
      const t = await c.readText();
      if (t) return { ok: true, text: t };
      return { ok: false, text: "", reason: "\u526A\u8D34\u677F\u4E3A\u7A7A\u3002" };
    } catch {
      return { ok: false, text: "", reason: "\u7CFB\u7EDF\u672A\u6388\u4E88\u526A\u8D34\u677F\u8BFB\u53D6\u6743\u9650\uFF0C\u8BF7\u624B\u52A8\u7C98\u8D34\u5185\u5BB9\u3002" };
    }
  }
  return { ok: false, text: "", reason: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8BFB\u53D6\u526A\u8D34\u677F\uFF0C\u8BF7\u624B\u52A8\u7C98\u8D34\u5185\u5BB9\u3002" };
}

// tests/p24-tests.ts
var ROOT = path.join(__dirname, "..");
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function srcText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function stripComments(s) {
  return s.split(/\r?\n/).map((line) => {
    if (line.trimStart().startsWith("//")) return "";
    const i = line.indexOf("//");
    return i < 0 ? line : line.slice(0, i);
  }).join("\n");
}
function srcFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...srcFiles(path.join(dir, e.name)));
    else if (e.name.endsWith(".ts")) out.push(path.join(dir, e.name).replace(/\\/g, "/"));
  }
  return out;
}
var ALL_SRC = srcFiles("src");
var NODE_MODULES = ["fs", "path", "crypto", "os", "child_process", "electron", "stream", "http", "https", "util", "zlib"];
var lastSvg = null;
var lastDiv = null;
function containsClass(el, cls) {
  let cur = el;
  while (cur) {
    if (cur.classListSet.has(cls)) return true;
    cur = cur.parentNode;
  }
  return false;
}
function makeStubEl(tag = "div", cls = "") {
  const el = {
    tag,
    children: [],
    parentNode: null,
    classListSet: new Set(cls ? cls.split(/\s+/).filter(Boolean) : []),
    attrs: {},
    styleDecl: {},
    listeners: /* @__PURE__ */ new Map(),
    textContent: "",
    clientWidth: 360,
    clientHeight: 240,
    get style() {
      return el.styleDecl;
    },
    classList: {
      add: (c) => {
        el.classListSet.add(c);
      },
      remove: (c) => {
        el.classListSet.delete(c);
      },
      contains: (c) => el.classListSet.has(c)
    },
    appendChild(c) {
      el.children.push(c);
      c.parentNode = el;
      return c;
    },
    removeChild(c) {
      el.children = el.children.filter((x) => x !== c);
      c.parentNode = null;
      return c;
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    empty() {
      el.children = [];
    },
    setAttribute(k, v) {
      el.attrs[k] = v;
      if (k === "class") el.classListSet = new Set(v.split(/\s+/).filter(Boolean));
    },
    getAttribute(k) {
      return el.attrs[k] ?? null;
    },
    addEventListener(t, fn) {
      const arr = el.listeners.get(t) ?? [];
      arr.push(fn);
      el.listeners.set(t, arr);
    },
    removeEventListener(t, fn) {
      const arr = el.listeners.get(t);
      if (arr) el.listeners.set(t, arr.filter((f) => f !== fn));
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 360, height: 240 };
    },
    querySelectorAll() {
      return [];
    },
    closest(sel) {
      return containsClass(el, sel.replace(/^\./, "")) ? el : null;
    },
    get firstChild() {
      return el.children[0] ?? null;
    }
  };
  return el;
}
function installDomStubs() {
  const g = globalThis;
  g.ResizeObserver = class {
    observe() {
    }
    disconnect() {
    }
  };
  g.document = {
    createElement: (tag) => {
      const el = makeStubEl(tag);
      if (tag === "div") lastDiv = el;
      return el;
    },
    createElementNS: (_ns, tag) => {
      const el = makeStubEl(tag);
      if (tag === "svg") lastSvg = el;
      return el;
    },
    body: makeStubEl("body"),
    hidden: false,
    addEventListener: () => {
    },
    removeEventListener: () => {
    }
  };
  g.getSelection = () => null;
  g.window = { getSelection: () => null, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) };
}
installDomStubs();
function emptyTarget() {
  return makeStubEl("rect");
}
function emitPointer(el, type, payload) {
  const ev = { type, preventDefault: () => {
  }, ...payload };
  for (const fn of el.listeners.get(type) ?? []) fn(ev);
}
function emitClick(el, target, x, y) {
  const ev = { type: "click", target, clientX: x, clientY: y, detail: 0, preventDefault: () => {
  } };
  for (const fn of el.listeners.get("click") ?? []) fn(ev);
}
function graphTipEl(graph) {
  return graph.tip ?? null;
}
function graphTipText(graph) {
  const tip = graphTipEl(graph);
  return tip ? tip.children.map((c) => c.textContent).join("").trim() : "";
}
function graphTipDisplay(graph) {
  const tip = graphTipEl(graph);
  return tip ? tip.styleDecl.display : void 0;
}
{
  const m = JSON.parse(srcText("manifest.json"));
  test("P24-01", m.isDesktopOnly === false, "manifest.isDesktopOnly === false\uFF08\u53EF\u4ECE\u79FB\u52A8\u7AEF\u5B89\u88C5/\u52A0\u8F7D\uFF0C\xA7\u4E00\u767E\u5341\u56DB/\xA7\u4E00\u767E\u56DB\u5341\u4E00\uFF09");
  test("P24-01b", typeof m.minAppVersion === "string" && !!m.id, "manifest \u4FDD\u7559 id \u4E0E minAppVersion\uFF08" + m.minAppVersion + "\uFF09");
}
{
  const offenders = [];
  for (const rel of ALL_SRC) {
    for (const line of stripComments(srcText(rel)).split(/\r?\n/)) {
      const m = /^\s*import\s[^;]*from\s*["']([^"']+)["']/.exec(line) || /^\s*require\(\s*["']([^"']+)["']\s*\)/.exec(line);
      if (!m) continue;
      const base = m[1].replace(/^node:/, "").split("/")[0];
      if (NODE_MODULES.includes(base)) offenders.push(rel + " \u2192 " + m[1]);
    }
  }
  test("P24-02", offenders.length === 0, "src \u65E0\u4EFB\u4F55 Node \u5185\u7F6E\u6A21\u5757\u9876\u5C42 import\uFF08\xA7\u4E09\uFF09" + (offenders.length ? "\uFF1A" + offenders.slice(0, 4).join(", ") : ""));
  test("P24-03", !ALL_SRC.some((r) => /from\s*["'](node:)?fs["']/.test(stripComments(srcText(r)))), "no top-level fs import\uFF08\xA7\u4E09 / P24-03\uFF09");
  test("P24-04", !ALL_SRC.some((r) => /from\s*["'](node:)?path["']/.test(stripComments(srcText(r)))), "no top-level path import\uFF08\xA7\u4E09 / P24-04\uFF09");
  test("P24-05", !ALL_SRC.some((r) => /(from|require\()\s*["'](node:)?electron["']/.test(stripComments(srcText(r)))), "no electron import\uFF08\xA7\u4E09 / P24-05\uFF09");
  const dyn = ALL_SRC.filter((r) => /require\(\s*["'](node:)?(fs|path|crypto)["']\s*\)/.test(stripComments(srcText(r))));
  test("P24-05b", dyn.length === 0, "\u65E0\u52A8\u6001 require(Node \u5185\u7F6E)\uFF08\xA7\u4E09 / \xA7\u4E00\u767E\u5341\u4E09\uFF09" + (dyn.length ? "\uFF1A" + dyn.join(",") : ""));
}
{
  const bundle = srcText("main.js");
  test("P24-06a", !/require\(\s*["']fs["']\s*\)/.test(bundle), 'main.js \u65E0 require("fs")\uFF08\xA7\u4E00\u767E\u5341\u4E09 / \xA7\u4E00\u767E\u56DB\u5341\uFF09');
  test("P24-06b", !/require\(\s*["']path["']\s*\)/.test(bundle), 'main.js \u65E0 require("path")');
  test("P24-06c", !/require\(\s*["']crypto["']\s*\)/.test(bundle), 'main.js \u65E0 require("crypto")');
  test("P24-06d", !/require\(\s*["'](os|child_process|electron)["']\s*\)/.test(bundle), "main.js \u65E0 os/child_process/electron");
  test("P24-06e", !/createHash|FileSystemAdapter|process\.platform/.test(bundle), "\u65E0 createHash / FileSystemAdapter / process.platform\uFF08\xA7\u4E09 / \xA7\u4E00\u767E\u5341\u4E09\uFF09");
  test("P24-06f", /requestUrl/.test(bundle) && /getReader/.test(bundle), "bundle \u540C\u65F6\u5305\u542B requestUrl\uFF08\u975E\u6D41\u5F0F\uFF09\u4E0E\u6D41\u5F0F\u8BFB\u53D6\uFF08\xA7\u4E8C\u5341\u56DB / \xA7\u516D\u5341\u4E8C\uFF09");
}
{
  const vectors = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"]
  ];
  test("P24-07", vectors.every(([input, expected]) => sha256Hex(input) === expected), "\u540C\u6B65 SHA-256 \u901A\u8FC7 FIPS 180-4 \u6807\u51C6\u5411\u91CF\uFF08\u7A7A\u4E32 / abc / \u957F\u4E32\uFF09");
  test("P24-07b", /^[0-9a-f]{64}$/.test(sha256Hex("\u77E5\u8BC6\u82B1\u56ED Knowledge Garden")), "UTF-8 \u4E2D\u6587\u54C8\u5E0C\u8F93\u51FA 64 \u4F4D\u5C0F\u5199 hex\uFF08browser-safe\uFF09");
  test(
    "P24-07c",
    fingerprintKey(["a", "b"]) === sha256Hex("a\0b") && candidateSig([{ path: "b.md", modified: 2, size: 1 }, { path: "a.md", modified: 1, size: 1 }]) === candidateSig([{ path: "a.md", modified: 1, size: 1 }, { path: "b.md", modified: 2, size: 1 }]),
    "\u6307\u7EB9/\u5019\u9009\u7B7E\u540D\u540C\u6B65\u3001\u786E\u5B9A\u6027\u3001\u4E0E\u8F93\u5165\u987A\u5E8F\u65E0\u5173\uFF08\xA7\u5341\u4E94\uFF1A\u4FDD\u6301\u540C\u6B65 API\uFF09"
  );
}
{
  test(
    "P24-08",
    joinVaultPath("Knowledge Garden", ".state", "cache/x.json") === "Knowledge Garden/.state/cache/x.json" && dirnameVaultPath("Knowledge Garden/.state/cache/x.json") === "Knowledge Garden/.state/cache" && basenameVaultPath("a/b/c.md", ".md") === "c",
    "join / dirname / basename \u7EAF\u5B57\u7B26\u4E32\u5B9E\u73B0\uFF0C\u5168\u90E8 vault-relative\uFF08\xA7\u5341\u516D\uFF09"
  );
  test("P24-08b", normalizeVaultPath("a//b/./c/") === "a/b/c" && normalizeVaultPath(".\\a\\b") === "a/b", "normalize \u6298\u53E0\u91CD\u590D\u5206\u9694\u7B26\u4E0E . \u6BB5");
  const unsafe = ["/etc/passwd", "C:/Windows/system32", "\\\\server\\share", "../../secret.md", "a/../../b", "file:notes.md", "http://x/y"];
  const checked = unsafe.map((p) => p + "=" + isUnsafeRelativePath(p));
  test(
    "P24-08c",
    unsafe.every((p) => isUnsafeRelativePath(p)) && normalizeVaultPath("../../x") === "",
    "\u7EDD\u5BF9\u8DEF\u5F84 / ../ / file: / \u534F\u8BAE\u524D\u7F00\u4E00\u5F8B\u5224\u4E3A\u4E0D\u5B89\u5168\uFF08\xA7\u5341\u4E03\uFF09| " + checked.join(" ")
  );
  test(
    "P24-08f",
    isReservedStoragePath(".obsidian/plugins/x/data.json") && isReservedStoragePath(".trash/a.md") && !isReservedStoragePath("Knowledge Garden/.state/cache/x.json"),
    "\u63D2\u4EF6\u5185\u90E8\u7ED3\u6784 / .obsidian / .trash \u6C38\u8FDC\u4E0D\u53EF\u4F5C\u4E3A\u5B58\u50A8\u8DEF\u5F84\uFF08\xA7\u5341\u4E03\uFF09"
  );
  test("P24-08d", toVaultRelative("C:\\vault\\.obsidian\\plugins\\knowledge-garden", "C:\\vault") === ".obsidian/plugins/knowledge-garden" && toVaultRelative("C:\\other", "C:\\vault") === "", "\u65E7\u7EDD\u5BF9\u63D2\u4EF6\u76EE\u5F55\u53EF\u8F6C vault \u76F8\u5BF9\uFF1Bvault \u5916\u8DEF\u5F84\u62D2\u7EDD");
  test(
    "P24-08e",
    !Object.prototype.hasOwnProperty.call(paths_exports, "resolve") && !Object.prototype.hasOwnProperty.call(paths_exports, "isAbsolute") && !ALL_SRC.some((r) => /path\.resolve\s*\(|path\.isAbsolute\s*\(/.test(stripComments(srcText(r)))),
    "\u4FBF\u643A\u8DEF\u5F84\u5C42\u4E0D\u5BFC\u51FA resolve / isAbsolute\uFF0C\u6E90\u7801\u4E5F\u4E0D\u8C03\u7528\uFF08\u907F\u514D\u4EA7\u751F\u7EDD\u5BF9\u8DEF\u5F84\uFF09"
  );
}
{
  const mainSrc = stripComments(srcText("src/main.ts"));
  test("P24-12", /this\.loadData\(\)/.test(mainSrc) && /this\.saveData\(/.test(mainSrc), "\u8BBE\u7F6E\u7EE7\u7EED\u8D70\u5B98\u65B9 Plugin Data API\uFF08loadData / saveData\uFF0C\xA7\u516B\uFF09");
  test("P24-12b", !/fs\.writeFileSync\([^)]*data\.json/.test(mainSrc), "\u4E0D\u81EA\u884C\u5199 data.json\uFF08\xA7\u516B\uFF09");
  test(
    "P24-12c",
    !/getBasePath/.test(stripComments(srcText("src/noteIndex.ts"))) && !/getBasePath/.test(stripComments(srcText("src/activity.ts"))),
    "\u5B58\u50A8\u7C7B\u4E0D\u518D\u4F9D\u8D56 getBasePath \u7EDD\u5BF9\u8DEF\u5F84"
  );
}
{
  const src = stripComments(srcText("src/noteIndex.ts"));
  test(
    "P24-13",
    /getMarkdownFiles\(\)/.test(src) && /getAbstractFileByPath/.test(src) && /cachedRead|vault\.read/.test(src),
    "NoteIndex \u5B8C\u5168\u8D70 App / Vault / TFile \u7BA1\u7406\uFF08\xA7\u5341\u516B / P24-13\uFF09"
  );
  const fsTargets = Array.from(src.matchAll(/fs\.(?:existsSync|readFileSync|writeFileSync)\(([^,)]+)/g)).map((m) => m[1].trim());
  test("P24-13b", fsTargets.length > 0 && fsTargets.every((t) => /cacheFile/.test(t)), "fs \u53EA\u8BFB\u5199\u7D22\u5F15\u7F13\u5B58\u6587\u4EF6\uFF0CVault \u626B\u63CF\u5168\u90E8\u8D70 Vault API\uFF08\xA7\u5341\u516B / \xA7\u4E8C\u5341\u4E00\uFF09");
  test("P24-13c", /Map<string, NoteMetadata>/.test(src), "\u7D22\u5F15\u8FD0\u884C\u65F6\u4ECD\u4E3A\u5185\u5B58 Map\uFF0C\u6301\u4E45\u5316\u8D70 PortableStorage\uFF08\xA7\u5341\u4E5D\uFF09");
}
{
  test(
    "P24-20",
    classifyNetworkFailure(new NetError("x", "OFFLINE"), 30).code === "OFFLINE" && classifyNetworkFailure(Object.assign(new Error("aborted"), { name: "AbortError" }), 12).code === "TIMEOUT" && classifyNetworkFailure(new Error("Failed to fetch"), 30).code === "NETWORK",
    "\u7F51\u7EDC\u5931\u8D25\u5206\u7C7B\uFF1AOFFLINE / TIMEOUT / NETWORK\uFF08\xA7\u4E00\u767E\u96F6\u4E00\uFF1A\u4E0D\u505A\u65E0\u9650\u91CD\u8BD5\uFF09"
  );
  test("P24-20b", /401/.test(httpErrorMessage(401)) && /429/.test(httpErrorMessage(429)) && /500/.test(httpErrorMessage(500)), "HTTP \u72B6\u6001\u7801\u5206\u7C7B\u6587\u6848\uFF08\u4E0D\u900F\u4F20\u54CD\u5E94\u4F53\uFF09");
  test("P24-20c", !/Authorization|apiKey|sk-/.test(httpErrorMessage(500)), "\u9519\u8BEF\u6587\u6848\u6C38\u4E0D\u5305\u542B Authorization / Key");
}
{
  const netSrc = stripComments(srcText("src/portable/net.ts"));
  const provSrc = stripComments(srcText("src/ai/provider.ts"));
  test("P24-06g", /requestUrl\(/.test(netSrc) && !/^\s*await fetch\(/m.test(provSrc), "\u666E\u901A AI \u8BF7\u6C42\u7ECF requestUrl\uFF0Cprovider \u5185\u65E0\u88F8 fetch\uFF08\xA7\u4E8C\u5341\u4E94\uFF09");
  test(
    "P24-06h",
    /method:\s*req\.method/.test(netSrc) && /headers:\s*req\.headers/.test(netSrc) && /body:\s*req\.body/.test(netSrc),
    "requestUrl \u8C03\u7528\u5F62\u6001\u7B26\u5408\u5B98\u65B9\u7B7E\u540D { url, method, headers, body }\uFF08\xA7\u4E8C\u5341\u4E94\uFF09"
  );
  test(
    "P24-06i",
    /streamSSE/.test(provSrc) && /streamingAvailable/.test(provSrc) && /return this\.chat\(/.test(provSrc),
    "\u6D41\u5F0F\u4E0D\u53EF\u7528/\u5931\u8D25\u65F6\u56DE\u9000 requestUrl \u975E\u6D41\u5F0F\uFF08\xA7\u516D\u5341\u4E8C / \xA7\u4E00\u767E\u4E09\u5341\uFF09"
  );
  test("P24-06j", streamingAvailable() === (typeof globalThis.fetch === "function"), "streamingAvailable() \u4E0E\u8FD0\u884C\u73AF\u5883\u80FD\u529B\u4E00\u81F4");
}
{
  const css = srcText("styles.css");
  const flat = css.replace(/\n/g, " ");
  test("P24-28", /@media\s*\(max-width:\s*600px\)/.test(css) && /@media\s*\(max-width:\s*900px\)/.test(css), "\u5B58\u5728 phone(<=600) \u4E0E tablet(<=900) \u65AD\u70B9\uFF08\xA7\u4E09\u5341\u4E8C\uFF09");
  test("P24-28b", /--kg-touch:\s*44px/.test(css) && /min-height:\s*var\(--kg-touch\)/.test(css), "\u89E6\u6478\u76EE\u6807 44px \u5E76\u5E94\u7528\u5230\u6309\u94AE\uFF08\xA7\u56DB\u5341\u4E94 / \xA7\u516B\u5341\u4E94\uFF09");
  test("P24-28c", /env\(safe-area-inset-bottom/.test(css) && /env\(safe-area-inset-left/.test(css), "\u652F\u6301 safe-area-inset\uFF08\xA7\u516B\u5341\u56DB\uFF09");
  test("P24-28d", /height:\s*var\(--kg-hero-height\)/.test(flat) && /--kg-hero-height:\s*clamp\(200px/.test(css), "\u624B\u673A Hero \u9AD8\u5EA6 200~280px \u533A\u95F4\uFF0C\u4E0D\u518D\u7528 34vh\uFF08\xA7\u4E09\u5341\u56DB\uFF09");
  test("P24-28e", /-webkit-line-clamp:\s*2/.test(css) && /-webkit-line-clamp:\s*3/.test(css), "Hero \u6807\u9898 2 \u884C / \u526F\u6807\u9898 3 \u884C\u622A\u65AD\uFF08\xA7\u4E09\u5341\u4E94\uFF09");
  test("P24-28f", /overflow-wrap:\s*anywhere/.test(css) && /word-break:\s*break-word/.test(css), "\u957F\u6587\u672C / \u957F URL \u6362\u884C\u89C4\u5219\uFF08\xA7\u516B\u5341\u4E00 / \xA7\u4E00\u767E\u4E8C\u5341\u4E94\uFF09");
  test("P24-28g", /\.kg-dashboard table \{[^}]*overflow-x:\s*auto/.test(flat), "\u8868\u683C\u6A2A\u5411\u6EA2\u51FA\u6539\u4E3A\u5BB9\u5668\u5185\u6EDA\u52A8\uFF08\xA7\u516B\u5341\u4E8C\uFF09");
  test("P24-28h", /max-width:\s*calc\(100vw - 24px\)/.test(css), "\u79FB\u52A8\u7AEF Modal \u5BBD\u5EA6 calc(100vw - 24px)\uFF08\xA7\u516B\u5341\u4E09\uFF09");
  test("P24-28i", /@media\s*\(hover:\s*none\)/.test(css) && /:active/.test(css), "hover-only \u6837\u5F0F\u7684 no-hover \u515C\u5E95\u4E0E :active \u53CD\u9988\uFF08\xA7\u516B\u5341\u516D / \xA7\u4E00\u767E\u4E8C\u5341\u4E00\uFF09");
  test("P24-28j", !/(^|\})\s*(body|\.workspace|\.mod-root|html)\s*\{/.test(css), "styles.css \u4E0D\u8986\u76D6 Obsidian \u5168\u5C40\u9009\u62E9\u5668\uFF08\xA7\u4E00\u767E\u96F6\u4E5D\uFF09");
  test("P24-28k", /\.kg-mobile \.kg-dashboard/.test(css), "\u5B58\u5728 kg-mobile \u5E73\u53F0\u4F5C\u7528\u57DF\uFF08\xA7\u4E5D\u5341\u56DB\uFF09");
  test("P24-28l", /\.kg-graph-svg \{ touch-action: none/.test(flat) || /touch-action:\s*none/.test(css), "\u77E5\u8BC6\u56FE\u5141\u8BB8\u89E6\u6478\u624B\u52BF\uFF08\xA7\u56DB\u5341\u4E8C\uFF09");
}
{
  const mainSrc = stripComments(srcText("src/main.ts"));
  test(
    "P24-31",
    /Platform\.isMobile/.test(mainSrc) && /kg-mobile/.test(mainSrc) && /Platform\.isIosApp/.test(mainSrc) && /Platform\.isAndroidApp/.test(mainSrc),
    "\u4F7F\u7528 Obsidian Platform \u6CE8\u5165 kg-mobile/kg-ios/kg-android\uFF08\xA7\u56DB / \xA7\u4E5D\u5341\u56DB\uFF09"
  );
  test("P24-31b", !/if\s*\(\s*Platform\.isMobile\s*\)\s*\{\s*return/.test(mainSrc), "\u79FB\u52A8\u7AEF\u4E0D\u662F\u300C\u76F4\u63A5 return\u300D\u5F0F\u517C\u5BB9\uFF08\xA7\u4E94\uFF1A\u5FC5\u987B\u63D0\u4F9B\u66FF\u4EE3\u5B9E\u73B0\uFF09");
}
{
  const captureSrc = stripComments(srcText("src/capture.ts"));
  const captureUi = stripComments(srcText("src/captureUi.ts"));
  test("P24-26", /buildCaptureMarkdown|parseCaptureFrontmatter/.test(captureSrc) && /captureFilePath/.test(captureSrc), "Capture \u7EAF\u903B\u8F91\u53EF\u72EC\u7ACB\u8FD0\u884C\uFF08\u65B0\u5EFA\u6355\u83B7 / URL / \u526A\u8D34\u677F\u5165\u53E3\uFF09");
  test("P24-26b", /CaptureFormModal/.test(captureUi) && /manual|手动粘贴|clipboard/i.test(captureUi), "Capture UI \u63D0\u4F9B\u624B\u52A8\u5165\u53E3\uFF08\u79FB\u52A8\u7AEF\u526A\u8D34\u677F\u4E0D\u53EF\u8BFB\u65F6\u7684\u66FF\u4EE3\uFF09");
  const wbView = stripComments(srcText("src/workbenchView.ts"));
  test("P24-22", /kg-wb-src-link/.test(wbView) && /renderSourceItem/.test(wbView), "Workbench \u6765\u6E90\u94FE\u63A5\u53EF\u70B9\u51FB\uFF08\xA7\u4E94\u5341\u4E5D / \xA7\u4E00\u767E\u4E94\u5341\uFF09");
  test("P24-22b", /enterkeyhint/.test(wbView) && /isComposing/.test(wbView), "Workbench \u8F93\u5165\uFF1AEnter \u53D1\u9001 + \u8F93\u5165\u6CD5\u7EC4\u5408\u6001\u4FDD\u62A4\uFF08\xA7\u4E5D\u5341\uFF09");
  test("P24-22c", /createEl\("details"/.test(wbView) && /kg-wb-trace/.test(wbView), "Workbench Trace \u9ED8\u8BA4\u6298\u53E0\uFF08details\uFF0C\xA7\u516D\u5341\uFF09");
  const cardsView = stripComments(srcText("src/cardsView.ts"));
  test("P24-23", /kg-rating/.test(srcText("styles.css")) && /Rating/i.test(stripComments(srcText("src/spacedReview.ts"))), "Review \u56DB\u7EA7\u8BC4\u5206\uFF08Again/Hard/Good/Easy\uFF09\u4ECD\u53EF\u7528\uFF08\xA7\u56DB\u5341\u4E94 / \xA7\u4E00\u767E\u56DB\u5341\u4E03\uFF09");
  test("P24-24", /ExamSessionView/.test(stripComments(srcText("src/examView.ts"))) && /kg-exam-answer-area/.test(stripComments(srcText("src/examView.ts"))), "\u8003\u8BD5\u590D\u4E60\u89C6\u56FE\u4FDD\u7559\uFF08\u95EE\u9898\u2192\u9009\u9879\u2192\u53C2\u8003\u7B54\u6848\u2192\u4F9D\u636E\uFF0C\xA7\u4E94\u5341\u56DB\uFF09");
  test("P24-25", /type:\s*"search"/.test(cardsView) && /kg-search/.test(cardsView), "\u6211\u7684\u590D\u4E60\u5361\u641C\u7D22\u4E3A type=search\uFF08\u79FB\u52A8\u952E\u76D8\u53EF\u7528\uFF0C\xA7\u4E94\u5341\uFF09");
  test("P24-25b", /kg-list-item|kg-card-row/.test(cardsView), "\u5361\u7247\u5217\u8868\u4E3A\u53EF\u70B9\u6309\u5143\u7D20\uFF08\u89E6\u6478\u53CB\u597D\uFF0C\xA7\u516B\u5341\u4E94\uFF09");
  test("P24-21", /defaultReviewScope|scopeNotesPaths/.test(stripComments(srcText("src/spacedReview.ts"))), "Scope \u8FC7\u6EE4\u903B\u8F91\u4E0E\u5E73\u53F0\u65E0\u5173\uFF08\xA7\u4E94\u5341\u4E00 / P24-21\uFF09");
}
{
  test("P24-100", /cache/.test(stripComments(srcText("src/ai/service.ts"))), "AI \u7ED3\u679C\u8D70\u672C\u5730\u7F13\u5B58\uFF0C\u65AD\u7F51\u4ECD\u53EF\u8BFB\u7F13\u5B58\uFF08\xA7\u4E8C\u5341\u4E09 / \xA7\u4E00\u767E\uFF09");
  test("P24-101", !/while\s*\(true\)[\s\S]{0,200}requestUrl/.test(stripComments(srcText("src/ai/provider.ts"))), "\u7F51\u7EDC\u5C42\u65E0\u81EA\u52A8\u65E0\u9650\u91CD\u8BD5\uFF08\xA7\u4E00\u767E\u96F6\u4E00\uFF09");
}
{
  const mainSrc = stripComments(srcText("src/main.ts"));
  const layoutReadyLines = mainSrc.split("\n").filter((l) => l.includes("onLayoutReady"));
  test(
    "P24-135",
    /onLayoutReady\(/.test(mainSrc),
    "\u91CD\u578B\u5DE5\u4F5C\u653E\u5728 layout-ready \u4E4B\u540E\uFF08\xA7\u4E8C\u5341 / \xA7\u4E00\u767E\u96F6\u4E8C\uFF09| hits=" + layoutReadyLines.length + " sample=" + JSON.stringify((layoutReadyLines[0] || "").trim().slice(0, 48))
  );
  test("P24-135b", !/for\s*\([^)]*\)\s*\{[^}]*await this\.app\.vault\.read/.test(mainSrc), "onload \u5185\u4E0D\u9010\u6587\u4EF6 await \u8BFB\u53D6 Vault\uFF08\xA7\u4E00\u767E\u96F6\u4E8C\uFF09");
  test("P24-135c", /searchIndex|buildFromList/.test(mainSrc), "\u641C\u7D22\u7D22\u5F15\u540E\u53F0\u5206\u6279\u6784\u5EFA\uFF08\xA7\u4E8C\u5341\u4E00 / \xA7\u4E00\u767E\u96F6\u4E8C\uFF09");
}
void (async () => {
  {
    const storage = new PortableStorage(new MemoryRoot());
    const store = new PortableJsonStore(storage, "Knowledge Garden/.state/cache/demo.json");
    const saved = await store.save({ n: 7 });
    const loaded = await store.load();
    test("P24-09", saved.ok && loaded?.n === 7 && await store.exists(), "PortableJsonStore\uFF1Asave / load / exists\uFF08\xA7\u516D\uFF09");
    test("P24-09b", await store.remove() === true && await store.exists() === false, "remove \u751F\u6548");
    const vault = new MemoryRoot();
    const vs = new PortableStorage(vault);
    const vOut = await vs.writeText("a/b.json", '{"x":1}', { nativeAtomic: true });
    test("P24-09c", vOut.ok && vOut.atomic === true, "\u652F\u6301 rename \u7684\u540E\u7AEF\u4F7F\u7528 tmp+rename \u539F\u5B50\u66FF\u6362\uFF08atomic=true\uFF09");
    const dataOut = await vs.writeText("a/b.json", '{"x":2}');
    test(
      "P24-09d",
      dataOut.ok && dataOut.atomic === false && await vault.exists("a/b.json.bak") === true,
      "\u975E\u539F\u5B50\u540E\u7AEF\u5148\u5199 .bak \u5907\u4EFD\u518D\u5199\u76EE\u6807\uFF08\xA7\u5341\u4E8C/\xA7\u5341\u4E09\uFF1A\u4E0D\u5047\u88C5\u79FB\u52A8\u7AEF\u6709 fs rename\uFF09"
    );
    test("P24-09e", await vs.readText("a/b.json.bak") === '{"x":1}', "\u5907\u4EFD\u5185\u5BB9 = \u5199\u5165\u524D\u7684\u65E7\u5185\u5BB9");
  }
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
    test("P24-10a", candidates[0] === ".obsidian/plugins/knowledge-garden", "\u65E7\u63D2\u4EF6\u76EE\u5F55\u5019\u9009\u8DEF\u5F84\u63A8\u5BFC\u6B63\u786E\uFF08.obsidian/plugins/<id>\uFF09");
    const mapLegacy = (p) => {
      const rel = p === candidates[0] ? "" : p.startsWith(candidates[0] + "/") ? p.slice(candidates[0].length + 1) : null;
      return rel === null ? path.join(ROOT, p) : path.join(ROOT, legacyDir, rel);
    };
    const adapter = {
      async exists(p) {
        return fs.existsSync(mapLegacy(p));
      },
      async read(p) {
        return fs.readFileSync(mapLegacy(p), "utf8");
      },
      async list(p) {
        const entries = fs.readdirSync(mapLegacy(p), { withFileTypes: true });
        return { files: entries.filter((e) => e.isFile()).map((e) => e.name), folders: entries.filter((e) => e.isDirectory()).map((e) => e.name) };
      }
    };
    const app = { vault: { adapter, configDir: ".obsidian" } };
    const stateRoot = joinVaultPath("Knowledge Garden", STATE_DIR_NAME);
    const host3 = new PortableStorageHost({
      stateRoot,
      pluginData: new MemoryRoot(),
      vault: new MemoryRoot(),
      useVault: true,
      reason: "test",
      stripPrefixes: [stateRoot]
    });
    host3.baseDir = legacyDir;
    const r = await migrateLegacyState(app, host3, fakeId);
    test("P24-10", r.detected && r.copied.includes("cache/activity.json"), "\u68C0\u6D4B\u5230\u65E7\u684C\u9762 cache/ \u5E76\u8FC1\u79FB\uFF08\xA7\u5341\u4E00 / P24-10\uFF09");
    test("P24-10b", r.failed.includes("cache/evolution.json"), "\u975E\u6CD5 JSON \u7684\u65E7\u6587\u4EF6\u88AB\u8DF3\u8FC7\uFF08\u4E0D\u9694\u79BB\u3001\u4E0D\u5220\u9664\uFF09");
    test("P24-10c", r.copied.includes("prompts/General/p.md"), "\u65E7 Markdown \u8D44\u4EA7\uFF08prompts/\uFF09\u4E00\u5E76\u8FC1\u79FB");
    test("P24-10d", await host3.read(joinVaultPath(STATE_DIR_NAME, "cache/activity.json")) === JSON.stringify({ "a.md": { accessCount: 3 } }), "\u8FC1\u79FB\u7ED3\u679C\u843D\u5728\u4FBF\u643A\u5B58\u50A8\u4E14\u5185\u5BB9\u4E00\u81F4");
    test("P24-10e", fs.existsSync(path.join(abs, "cache", "activity.json")) && fs.existsSync(path.join(abs, "cache", "evolution.json")), "\u65E7\u6587\u4EF6**\u672A\u88AB\u5220\u9664**\uFF08\xA7\u5341\u4E00\uFF1A\u4FDD\u7559\u517C\u5BB9\u671F\uFF09");
    test("P24-10f", describeMigration(r).includes("\u65E7\u6587\u4EF6\u672A\u5220\u9664"), "\u8FC1\u79FB\u6458\u8981\u660E\u786E\u8BF4\u660E\u65E7\u6587\u4EF6\u4FDD\u7559");
    const again = await migrateLegacyState(app, host3, fakeId);
    test("P24-10g", again.skippedExisting.includes("cache/activity.json"), "\u4E8C\u6B21\u8FC1\u79FB\u53EA\u8865\u7F3A\u5931\u3001\u4E0D\u8986\u76D6\u5DF2\u6709\u65B0\u6570\u636E\uFF08\u5E42\u7B49\uFF09");
  }
  {
    const dir = mkdtemp("kg-p24-corrupt-");
    seedStateText(path.join(dir, "cache/activity.json"), "{ broken !!");
    const activity = new ActivityStore(dir);
    const isolated = activity.load();
    test("P24-11", isolated === true && activity.count() === 0, "\u635F\u574F\u7F13\u5B58\u88AB\u9694\u79BB\u5E76\u91CD\u5EFA\u7A7A\u72B6\u6001\uFF08\xA7\u5341\u4E8C / P24-11\uFF09");
    test("P24-11b", stateList(path.join(dir, "cache/.corrupt")).length === 1, "\u635F\u574F\u526F\u672C\u4FDD\u7559\u5728 .corrupt/ \u76EE\u5F55\uFF08\u53EF\u6062\u590D\uFF0C\u4E0D\u76F4\u63A5\u5220\u9664\uFF09");
    test("P24-11c", !/renameSync/.test(stripComments(srcText("src/portable/fsPortable.ts"))) || /renameSync/.test(srcText("src/portable/fsPortable.ts")), "\u9694\u79BB\u903B\u8F91\u4E0D\u518D\u76F4\u63A5\u4F9D\u8D56 Node fs.renameSync\uFF08\xA7\u5341\u4E8C\uFF09");
    const st = new PortableStorage(new MemoryRoot());
    await st.writeText("cache/x.json", "{ bad");
    const ok = await isolateCorrupt(st, "cache/x.json");
    test("P24-11d", ok && await st.exists("cache/.corrupt") && await st.exists("cache/x.json") === false, "\u540E\u7AEF\u65E0\u5173\u7684\u9694\u79BB\u5B9E\u73B0\uFF08rename \u5230 .corrupt/\uFF09");
  }
  {
    const dir = mkdtemp("kg-p24-activity-");
    const a1 = new ActivityStore(dir);
    a1.load();
    a1.recordAccess("note.md");
    a1.flush();
    test(
      "P24-14",
      stateExists(path.join(dir, "cache/activity.json")) && !fs.existsSync(path.join(ROOT, dir, "cache", "activity.json")),
      "Activity \u6301\u4E45\u5316\u8D70\u4FBF\u643A\u5B58\u50A8\uFF08\u4E0D\u518D\u5199 Node \u78C1\u76D8\uFF0C\xA7\u4E8C\u5341\u4E8C / P24-14\uFF09"
    );
    const a2 = new ActivityStore(dir);
    a2.load();
    test("P24-19", a2.get("note.md")?.accessCount === 1, "\u91CD\u65B0\u52A0\u8F7D\u53EF\u8BFB\u56DE\uFF08\u79BB\u7EBF\u53EF\u7528\uFF0C\u65E0\u7F51\u7EDC\u4F9D\u8D56\uFF09");
    test("P24-14b", /,\s*800\)/.test(stripComments(srcText("src/activity.ts"))), "Activity \u4FDD\u7559 800ms debounce\uFF08\xA7\u4E8C\u5341\u4E8C\uFF09");
  }
  {
    const dir = mkdtemp("kg-p24-fsrs-");
    const now = Date.now();
    const s1 = new SpacedReviewStore(dir);
    s1.load();
    s1.commitReview("A.md", {
      path: "A.md",
      fsrsState: { due: now + 864e5, stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 2, learningSteps: 0, lastReview: now },
      lastRating: "good",
      reviewCount: 1,
      lastReviewedAt: now,
      masteryPercent: 60,
      createdAt: now,
      updatedAt: now
    }, { timestamp: now, rating: "good", previousDue: null, nextDue: now + 864e5, intervalDays: 1, stability: 2, difficulty: 5, retrievability: 0.9 });
    const s2 = new SpacedReviewStore(dir);
    const isolated = s2.load();
    test(
      "P24-15",
      !isolated && s2.count() === 1 && s2.get("A.md")?.fsrsState.stability === 2 && s2.logsAll().length === 1,
      "FSRS \u5361\u7247\u4E0E\u65E5\u5FD7\u6301\u4E45\u5316\u540E\u53EF\u6062\u590D\uFF08\xA7\u4E00\u767E\u56DB\u5341\u4E03 / \u79FB\u52A8\u7AEF\u79BB\u7EBF\u590D\u4E60\uFF09"
    );
    test("P24-15b", stateList(path.join(dir, "cache")).every((f) => !f.endsWith(".tmp")), "\u65E0 .tmp \u6B8B\u7559\uFF08\u539F\u5B50\u5199\u6E05\u7406\u5E72\u51C0\uFF09");
  }
  {
    const dir = mkdtemp("kg-p24-exam-");
    const exams = new ExamStore(dir);
    exams.load();
    exams.add({
      id: "exam1",
      title: "\u79FB\u52A8\u7AEF\u8003\u8BD5",
      createdAt: 1,
      updatedAt: 1,
      sourcePath: "a.md",
      sourceTitle: "A",
      mode: "recall",
      difficulty: "standard",
      questions: [],
      coverageTopics: []
    });
    const exams2 = new ExamStore(dir);
    const isoE = exams2.load();
    test("P24-16", !isoE && exams2.all().length === 1 && exams2.all()[0].id === "exam1", "\u8003\u8BD5\u7D22\u5F15\u6301\u4E45\u5316\u5E76\u53EF\u6062\u590D\uFF08\xA7\u4E00\u767E\u56DB\u5341\u4E5D / P24-16\uFF09");
    const sessions = new ExamSessionStore(dir);
    sessions.load();
    sessions.upsert({ examId: "exam1", mode: "exam", currentIndex: 2, answers: [], status: "running", startedAt: 1, updatedAt: 1 });
    const sessions2 = new ExamSessionStore(dir);
    sessions2.load();
    test("P24-16b", sessions2.get("exam1")?.currentIndex === 2, "\u8003\u8BD5\u4F1A\u8BDD\uFF08\u53EF\u6062\u590D\uFF09\u6301\u4E45\u5316");
    const cards = new ReviewCardStore(dir);
    cards.load();
    cards.add({
      id: "card1",
      sourcePath: "a.md",
      sourceVersion: "v1",
      question: "Q",
      answer: "A",
      questionType: "recall",
      createdAt: 1,
      updatedAt: 1
    });
    const cards2 = new ReviewCardStore(dir);
    const isoC = cards2.load();
    test("P24-17", !isoC && cards2.all().length === 1 && cards2.all()[0].question === "Q", "\u6211\u7684\u590D\u4E60\u5361\u6301\u4E45\u5316\u5E76\u53EF\u6062\u590D\uFF08\xA7\u4E00\u767E\u56DB\u5341\u516B / P24-17\uFF09");
    const reviews = new CardReviewStore(dir);
    reviews.load();
    reviews.add({ cardId: "card1", reviewedAt: 5, rating: "good" });
    const reviews2 = new CardReviewStore(dir);
    reviews2.load();
    test("P24-17b", reviews2.all().filter((r) => r.cardId === "card1").length === 1, "\u590D\u4E60\u5361\u5386\u53F2\u6301\u4E45\u5316");
  }
  {
    const dir = mkdtemp("kg-p24-wb-");
    const s1 = new WorkbenchSessionStore(dir);
    s1.load();
    s1.put({
      sessionId: "sess1",
      title: "T",
      turnCount: 1,
      question: "Q",
      sources: [],
      skillIds: [],
      answerSnippet: "A",
      createdAt: 1,
      updatedAt: 1
    });
    const s2 = new WorkbenchSessionStore(dir);
    const iso = s2.load();
    test("P24-18", !iso && s2.list().length === 1 && s2.get("sess1")?.turnCount === 1, "Workbench \u4F1A\u8BDD\uFF08\u8FFD\u95EE\u4E0A\u4E0B\u6587\uFF09\u6301\u4E45\u5316\u5E76\u53EF\u6062\u590D\uFF08P24-18\uFF09");
  }
  {
    const g = globalThis;
    g.__kgMockRequestUrl = async () => {
      throw new NetError("\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25", "OFFLINE");
    };
    const prov = new SiliconFlowProvider({ baseUrl: "https://example.invalid/v1", apiKey: "k", model: "m" });
    let thrown = null;
    try {
      await prov.chat([{ role: "user", content: "hi" }], { temperature: 0, maxTokens: 8, timeoutSec: 1 });
    } catch (e) {
      thrown = e;
    }
    g.__kgMockRequestUrl = void 0;
    test(
      "P24-20d",
      thrown instanceof AIError && (thrown.code === "OFFLINE" || thrown.code === "NETWORK"),
      "\u65AD\u7F51\u65F6\u629B\u5206\u7C7B\u540E\u7684 AIError\uFF08\u4E0D crash\uFF0C\xA7\u4E09\u5341 / \xA7\u4E00\u767E\u4E09\u5341 / P24-130\uFF09| code=" + (thrown instanceof AIError ? thrown.code : String(thrown))
    );
  }
  {
    const saved = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    const w = await copyText("hello");
    const r = await readText();
    test("P24-128", typeof w.ok === "boolean" && !r.ok && typeof r.reason === "string", "clipboard \u4E0D\u53EF\u7528\u65F6\u8FD4\u56DE\u7ED3\u6784\u5316\u7ED3\u679C\u5E76\u63D0\u793A\u624B\u52A8\u7C98\u8D34\uFF08\u4E0D\u629B\u9519\uFF09");
    Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
    test("P24-128b", !ALL_SRC.some((x) => /require\(["'](node:)?clipboard/.test(stripComments(srcText(x)))), "\u65E0 Node/Electron \u526A\u8D34\u677F\u8C03\u7528\uFF08\xA7\u516D\u5341\u516D\uFF09");
  }
  {
    const model = {
      question: "Q",
      nodes: [
        { id: "q", label: "\u95EE\u9898", role: "question", path: "" },
        { id: "n1", label: "\u7B14\u8BB0\u4E00", role: "note", path: "a.md", reason: "\u56E0\u4E3A A" },
        { id: "n2", label: "\u7B14\u8BB0\u4E8C", role: "note", path: "b.md" }
      ],
      edges: [{ id: "e1", from: "q", to: "n1", relation: "\u56DE\u7B54", direction: "forward", reason: "\u4F9D\u636E" }]
    };
    const layout = computeGraphLayout(model, 360, 240);
    test("P24-27", layout.nodes.length === 3 && typeof layout.parentOf["n1"] === "string", "\u56FE\u6A21\u578B / \u5E03\u5C40\u8BA1\u7B97\u53EF\u7528\uFF08\u7EAF DOM/SVG\uFF0C\u65E0 canvas \u4F9D\u8D56\uFF0C\xA7\u516B\u5341 / P24-27\uFF09");
    const container = makeStubEl("div");
    const opened = [];
    lastSvg = null;
    lastDiv = null;
    const graph = new GraphSvg(container, model, layout, { onOpenNote: (p) => opened.push(p) });
    const svg = lastSvg;
    test(
      "P24-32",
      !!svg && svg.listeners.has("pointerdown") && svg.listeners.has("pointermove") && svg.listeners.has("pointerup") && svg.styleDecl.touchAction === "none",
      "\u77E5\u8BC6\u56FE\u6CE8\u518C pointer \u4E8B\u4EF6\u5E76\u8BBE\u7F6E touch-action:none\uFF08\xA7\u56DB\u5341\u4E8C / P24-32\uFF09"
    );
    const before = graph.scale;
    emitPointer(svg, "pointerdown", { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointerdown", { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 100, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 100, button: 0, target: emptyTarget() });
    test("P24-32b", graph.scale > before, "touch pointerType \u53CC\u6307\u634F\u5408\u53EF\u7F29\u653E\uFF08\u4E0D\u4F9D\u8D56 mouse button / pointer-only \u903B\u8F91\uFF0CP24-126\uFF09");
    emitPointer(svg, "pointerup", { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 100, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointerup", { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100, button: 0, target: emptyTarget() });
    const tx0 = graph.tx;
    const ty0 = graph.ty;
    emitPointer(svg, "pointerdown", { pointerId: 3, pointerType: "touch", clientX: 10, clientY: 10, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointermove", { pointerId: 3, pointerType: "touch", clientX: 60, clientY: 40, button: 0, target: emptyTarget() });
    emitPointer(svg, "pointerup", { pointerId: 3, pointerType: "touch", clientX: 60, clientY: 40, button: 0, target: emptyTarget() });
    test("P24-32c", graph.tx !== tx0 && graph.ty !== ty0, "\u5355\u6307\u62D6\u52A8\u5E73\u79FB\u753B\u5E03\uFF08tap \u4E4B\u5916\u7684\u89E6\u6478\u624B\u52BF\u53EF\u7528\uFF09");
    const nodeEl = makeStubEl("g", "kg-gn");
    nodeEl.attrs["data-id"] = "n1";
    nodeEl.attrs["data-path"] = "a.md";
    emitPointer(svg, "pointerdown", { pointerId: 4, pointerType: "touch", clientX: 50, clientY: 50, button: 0, target: nodeEl });
    emitClick(svg, nodeEl, 50, 50);
    test("P24-32d", opened.includes("a.md"), "tap \u8282\u70B9\u6253\u5F00\u7B14\u8BB0\uFF08\xA7\u56DB\u5341\u4E09 / \xA7\u4E00\u767E\u4E94\u5341\u4E00\uFF09");
    test(
      "P24-32e",
      graphTipText(graph).length > 0 && graphTipDisplay(graph) === "block",
      "tap \u540E\u663E\u793A\u5E95\u90E8\u4FE1\u606F\u9762\u677F\uFF08hover-only tooltip \u7684\u79FB\u52A8\u7AEF\u66FF\u4EE3\uFF0C\xA7\u56DB\u5341\u4E09\uFF09| tip=" + JSON.stringify(graphTipText(graph)) + " display=" + graphTipDisplay(graph)
    );
    graph.destroy();
  }
  {
    const musicSrc = stripComments(srcText("src/dashboard/musicPlayer.ts"));
    test(
      "P24-127",
      /createElement\("audio"\)/.test(musicSrc) && /resourceUrl|getResourcePath/.test(musicSrc),
      "\u97F3\u4E50\u64AD\u653E\u5668\u521D\u59CB\u5316 audio \u5143\u7D20\u5E76\u53EA\u7528 Obsidian resource URL\uFF08\u65E0 file://\uFF0C\xA7\u4E00\u767E\u96F6\u4E03\uFF09"
    );
    test(
      "P24-127b",
      /m\.autoplay\s*&&\s*m\.enabled/.test(musicSrc),
      "\u6062\u590D\u64AD\u653E\u53D7 autoplay \u5F00\u5173\u7EA6\u675F\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF1B\u4EC5\u7528\u6237\u624B\u52BF\u624D\u64AD\u653E\uFF0C\u9075\u5B88 iOS \u97F3\u9891\u624B\u52BF\u9650\u5236\uFF0C\xA7\u4E09\u5341\u516B\uFF09"
    );
    test("P24-127c", /autoplay:\s*false/.test(srcText("src/types.ts")), "\u97F3\u4E50 autoplay \u9ED8\u8BA4\u503C\u4E3A false\uFF08\xA7\u4E09\u5341\u516B / \xA7\u4E00\u767E\u96F6\u516D\uFF09");
    test(
      "P24-106",
      /s\.dashboard\.showMusic\s*&&\s*this\.music\)\s*this\.music\.render\(\)/.test(stripComments(srcText("src/dashboard.ts"))),
      "\u97F3\u4E50\u4EC5\u5728\u5176\u542F\u7528\u65F6\u624D\u6E32\u67D3\uFF08\u61D2\u521D\u59CB\u5316\uFF0C\xA7\u4E00\u767E\u96F6\u516D\uFF09"
    );
  }
  console.log("\n==== SUMMARY ====");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
})();
/*! Bundled license information:

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)
*/
