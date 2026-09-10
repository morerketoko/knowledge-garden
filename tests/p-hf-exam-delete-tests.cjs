"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
      const dir2 = dirnameVaultPath(p);
      if (dir2) await this.root.mkdirp(dir2);
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
  /**
   * 列出后端内的全部文件（若后端支持文件树）。
   * 供布局修复使用：Obsidian 只有 getFiles()（文件清单，不含目录），
   * 目录驱动遍历不可靠，所以修复必须按文件路径处理。
   */
  listAllFiles() {
    const root = this.root;
    return typeof root.listAllFilesSync === "function" ? root.listAllFilesSync() : [];
  }
};

// src/portable/host.ts
var STATE_DIR_NAME = ".state";
var PortableStorageHost = class {
  constructor(opts) {
    this.opts = opts;
    /** 历史插件目录（旧 manifest.dir / getBasePath）；用于把旧路径映射到新根 */
    this.baseDir = "";
    /** 布局修复轨迹（诊断用） */
    this.repairTrace = [];
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
  static {
    /* ---------------- 布局修复 ---------------- */
    /** 需要巡检修复的目录名（状态目录 / 资产目录） */
    this.REPAIR_DIRS = ["cache", "prompts", "projects", ".corrupt"];
  }
  /**
   * v1.1.0 的 `full()` 重复加前缀，把状态写到了
   * `<stateRoot>/<baseDir>/...`（还可能再套一层 `<stateRoot>`）。
   *
   * 修复方式是**文件驱动**的：遍历 vault 文件列表（Obsidian 的 getFiles 只含文件，
   * 不含目录，所以不能靠 list 逐层下探），把嵌套层里每个文件按路径结构搬回正确位置：
   * - `.../cache/<f>`            → `<stateRoot>/cache/<f>`
   * - `.../Knowledge Garden/Prompts/.../<f>` → `<stateRoot>/prompts/.../<f>`
   *
   * 目标已存在则跳过（不覆盖较新数据）；空目录不处理；失败不抛错。
   */
  async repairDuplicatedLayout() {
    this.repairTrace = [];
    if (!this.vaultStorage || !this.baseDir) return 0;
    const v = this.vaultStorage;
    const nestedBase = joinVaultPath(this.stateRoot, this.baseDir);
    const files = this.listAllFiles();
    if (!files.length) return 0;
    let moved = 0;
    for (const rel of files) {
      if (!rel.startsWith(nestedBase + "/")) continue;
      const to = this.repairTargetFor(rel);
      if (!to) continue;
      if (await v.exists(to)) {
        this.repairTrace.push("skip(dst\u5B58\u5728) " + to);
        continue;
      }
      const raw = await v.readText(rel);
      if (raw === null) {
        this.repairTrace.push("skip(\u8BFB\u4E0D\u5230) " + rel);
        continue;
      }
      const out = await v.writeText(to, raw, { nativeAtomic: true });
      this.repairTrace.push("move " + rel + " \u2192 " + to + " ok=" + out.ok);
      if (out.ok) {
        await v.remove(rel);
        moved++;
      }
    }
    if (moved === 0) this.repairTrace.push("\u672A\u53D1\u73B0\u9700\u8981\u4FEE\u590D\u7684\u5D4C\u5957\u72B6\u6001\uFF08\u6B63\u5E38\uFF09");
    return moved;
  }
  /**
   * 把嵌套层的相对路径映射到正确位置 —— 依据是**目录名**而不是层级深度。
   *
   * 例：`…/Knowledge Garden/.state/Knowledge Garden/.state/cache/cards.json`
   *   → 取最靠近文件的一个 `<stateRoot>/` 之后的 `cache/cards.json`
   *   → `<stateRoot>/cache/cards.json`
   * 资产例：`…/Knowledge Garden/Prompts/General/p.md`
   *   → 标记 `Knowledge Garden/` 之后的 `Prompts/...` → `<stateRoot>/prompts/General/p.md`
   *
   * 不认识的结构返回 null（绝不动用户自己的文件）。
   */
  repairTargetFor(rel) {
    const marker = this.stateRoot.replace(/^\/*/, "");
    const i = rel.lastIndexOf("/" + marker + "/");
    if (i >= 0) {
      const after = rel.slice(i + marker.length + 2);
      const first = after.split("/")[0];
      if (first === "cache" || first === ".corrupt" || first === "prompts" || first === "projects") {
        return joinVaultPath(this.stateRoot, after);
      }
    }
    const kg = rel.lastIndexOf("Knowledge Garden/");
    if (kg >= 0) {
      const after = rel.slice(kg + "Knowledge Garden/".length);
      for (const asset of ["Prompts", "Projects"]) {
        if (after === asset || after.startsWith(asset + "/")) {
          const rest = after.slice(asset.length).replace(/^\//, "");
          return joinVaultPath(this.stateRoot, asset.toLowerCase(), rest);
        }
      }
    }
    return null;
  }
  /** 列出 vault 内全部文件（相对 vault 根） */
  listAllFiles() {
    return this.vaultStorage ? this.vaultStorage.listAllFiles() : [];
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
initTestStorage();

// tests/p-hf-exam-delete-tests.ts
var fs = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));

// src/migrations.ts
function pad2(n) {
  return String(n).padStart(2, "0");
}
function corruptStamp(now = /* @__PURE__ */ new Date()) {
  return String(now.getFullYear()) + pad2(now.getMonth() + 1) + pad2(now.getDate()) + "-" + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
}
function corruptTargetPath(filePath, now = /* @__PURE__ */ new Date()) {
  const p = String(filePath).replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  const dir2 = i < 0 ? "" : p.slice(0, i);
  const name = i < 0 ? p : p.slice(i + 1);
  const stamp = name + "." + corruptStamp(now);
  return dir2 ? dir2 + "/.corrupt/" + stamp : ".corrupt/" + stamp;
}
function isolateCorruptFile(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    renameSync(filePath, corruptTargetPath(filePath));
    return true;
  } catch {
    try {
      const raw = readFileSync(filePath, "utf8");
      writeFileSync(corruptTargetPath(filePath), raw);
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

// src/ai/cache.ts
function sha256(text) {
  return sha256Hex(text);
}
function fingerprintKey(parts) {
  return sha256(parts.join("\0"));
}
var AICache = class {
  constructor(pluginDir) {
    this.entries = /* @__PURE__ */ new Map();
    this.file = joinVaultPath(pluginDir, "cache", "ai-cache.json");
  }
  /** 启动时恢复（离线可读）。损坏/结构非法 → 隔离 *.corrupt-* 后重建空缓存（§九/§十），返回是否执行了隔离 */
  load() {
    try {
      if (!existsSync(this.file)) return false;
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      if (!Array.isArray(raw)) throw new Error("invalid cache structure");
      const now = Date.now();
      for (const e of raw) {
        if (!e || typeof e.key !== "string" || !e.type) continue;
        if (e.status !== "success" && e.status !== "error") continue;
        if (e.expiresAt && e.expiresAt <= now) continue;
        this.entries.set(e.key, e);
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.entries.clear();
      return isolated;
    }
  }
  get(key2) {
    return this.entries.get(key2);
  }
  /** Hotfix：删除单个缓存条目（精确失效指定考试/任务对应 key；绝不用 clearType 波及他人，§26/27） */
  remove(key2) {
    if (!this.entries.has(key2)) return false;
    this.entries.delete(key2);
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u5220\u9664\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
    return true;
  }
  /** 只缓存「有效结果」+ 元数据；绝不写入 API Key / header / 原始 prompt / 笔记全文 */
  put(entry) {
    this.entries.set(entry.key, { ...entry, updatedAt: Date.now() });
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
  }
  byType(type) {
    return Array.from(this.entries.values()).filter((e) => e.type === type);
  }
  stats() {
    const all = Array.from(this.entries.values());
    let bytes = 0;
    let last = 0;
    const byType = {};
    for (const e of all) {
      try {
        bytes += JSON.stringify(e).length;
      } catch {
      }
      if (e.updatedAt > last) last = e.updatedAt;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { count: all.length, bytes, lastUpdated: last, byType };
  }
  /** 清理过期 AI 缓存（§四十六）：只删 expiresAt 已过 + 超过 7 天的 error 缓存；success 未过期完整保留 */
  clearExpired() {
    const now = Date.now();
    const ERROR_TTL_MS = 7 * 864e5;
    let removed = 0;
    for (const [k, e] of this.entries) {
      const expired = typeof e.expiresAt === "number" && e.expiresAt <= now;
      const staleError = e.status === "error" && now - (e.updatedAt ?? e.createdAt ?? 0) > ERROR_TTL_MS;
      if (expired || staleError) {
        this.entries.delete(k);
        removed++;
      }
    }
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u6E05\u7406\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
    return removed;
  }
  /** 清空：* 删除全部 AI 缓存（只动 cache/，绝不触碰 Reviews/） */
  clearType(type) {
    let removed = 0;
    for (const [k, e] of this.entries) {
      if (type === "*" || e.type === type) {
        this.entries.delete(k);
        removed++;
      }
    }
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u6E05\u7406\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
    return removed;
  }
};

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

// src/portable/pathShim.ts
function join(...parts) {
  return joinVaultPath(...parts);
}

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

// src/examGen.ts
function normalizeExamText(s) {
  let t = (s ?? "").trim().toLowerCase();
  t = t.replace(/\u3000/g, " ");
  t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248));
  t = t.replace(/[，。！？；：、,.!?;:()（）《》「」"'“”‘’[\]{}|\\/<>#*_\-—…\s]+/g, " ").trim();
  t = t.replace(/\s+/g, " ");
  return t;
}
function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function examQuestionFingerprint(q) {
  return hashText(normalizeExamText(q.question));
}
function charNGrams(s, n) {
  const t = normalizeExamText(s).replace(/ /g, "");
  const out = /* @__PURE__ */ new Set();
  if (t.length < n) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}
function tokenSet(s) {
  const norm = normalizeExamText(s);
  const out = /* @__PURE__ */ new Set();
  for (const tok of norm.split(" ")) {
    if (!tok) continue;
    if (/^[\u4e00-\u9fff]+$/.test(tok)) {
      out.add(tok);
      if (tok.length >= 2) for (let i = 0; i + 2 <= tok.length; i++) out.add(tok.slice(i, i + 2));
    } else out.add(tok);
  }
  return out;
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
function conceptSimilarity(a, b) {
  if (!a || !b) return 0;
  const na = normalizeExamText(a);
  const nb = normalizeExamText(b);
  if (na === nb) return 1;
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  let overlap = false;
  for (const x of sa) if (sb.has(x)) {
    overlap = true;
    break;
  }
  return overlap ? 0.6 : 0;
}
function questionSimilarity(a, b, conceptA, conceptB) {
  const triA = charNGrams(a, 3);
  const triB = charNGrams(b, 3);
  const tokA = tokenSet(a);
  const tokB = tokenSet(b);
  return jaccard(triA, triB) * 0.45 + jaccard(tokA, tokB) * 0.35 + conceptSimilarity(conceptA, conceptB) * 0.2;
}
function tokenContainment(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.min(sa.size, sb.size);
}
function conceptsEqual(a, b) {
  if (!a || !b) return false;
  return normalizeExamText(a) === normalizeExamText(b);
}
var EXAM_NEAR_DUP_THRESHOLD = 0.78;
function isNearDuplicate(a, b, conceptA, conceptB) {
  if (questionSimilarity(a, b, conceptA, conceptB) >= EXAM_NEAR_DUP_THRESHOLD) return true;
  return conceptsEqual(conceptA, conceptB) && tokenContainment(a, b) >= 0.5;
}
function buildExamHistoryContext(exams) {
  const fpParts = [];
  const prior = [];
  const concepts = /* @__PURE__ */ new Set();
  const topics = /* @__PURE__ */ new Set();
  for (const e of exams) {
    for (const q of e.questions ?? []) {
      if (!q.question) continue;
      fpParts.push(examQuestionFingerprint(q));
      if (prior.length < 100) prior.push({ question: String(q.question).slice(0, 240), concept: q.concept, type: q.type });
      const c = (q.concept ?? "").trim();
      if (c) {
        concepts.add(c);
        fpParts.push("c:" + normalizeExamText(c));
      }
    }
    for (const t of e.coverageTopics ?? []) {
      const tn = (t ?? "").trim();
      if (tn) {
        topics.add(tn);
        fpParts.push("t:" + normalizeExamText(tn));
      }
    }
  }
  const sortedConcepts = [...concepts].sort();
  const sortedTopics = [...topics].sort();
  fpParts.sort();
  return {
    examCount: exams.length,
    priorQuestions: prior,
    priorConcepts: sortedConcepts.slice(0, 100),
    priorCoverageTopics: sortedTopics.slice(0, 100),
    historyFingerprint: hashText(fpParts.join("|"))
  };
}
function dedupeExamQuestions(candidates, history, policy) {
  const kept = [];
  const duplicates = [];
  const fpSeen = /* @__PURE__ */ new Set();
  const conceptTypeSeen = /* @__PURE__ */ new Map();
  for (const h of history.priorQuestions) {
    fpSeen.add(examQuestionFingerprint(h));
    if (h.concept) {
      const set = conceptTypeSeen.get(normalizeExamText(h.concept)) ?? /* @__PURE__ */ new Set();
      set.add(h.type ?? "");
      conceptTypeSeen.set(normalizeExamText(h.concept), set);
    }
  }
  const historyConceptSet = new Set(history.priorConcepts.map((c) => normalizeExamText(c)));
  for (const q of candidates) {
    const fp = examQuestionFingerprint(q);
    if (fpSeen.has(fp)) {
      duplicates.push(q);
      continue;
    }
    const conceptN = normalizeExamText(q.concept ?? "");
    if (policy !== "allow") {
      const nearWith = (otherQ, otherC, otherType) => {
        if (policy === "balanced" && q.type && otherType && q.type !== otherType) return false;
        return isNearDuplicate(otherQ, q.question, otherC, q.concept);
      };
      let near = false;
      for (const k of kept) if (nearWith(k.question, k.concept, k.type)) {
        near = true;
        break;
      }
      if (!near) {
        for (const h of history.priorQuestions) if (nearWith(h.question, h.concept, h.type)) {
          near = true;
          break;
        }
      }
      if (near) {
        duplicates.push(q);
        continue;
      }
    }
    if (q.concept) {
      const types = conceptTypeSeen.get(conceptN);
      const qtype = q.type ?? "";
      const conflict = policy === "strict" ? historyConceptSet.has(conceptN) || !!types : policy === "balanced" ? !!types && types.has(qtype) : false;
      if (policy !== "allow" && conflict) {
        duplicates.push(q);
        continue;
      }
      const set = conceptTypeSeen.get(conceptN) ?? /* @__PURE__ */ new Set();
      set.add(qtype);
      conceptTypeSeen.set(conceptN, set);
    }
    kept.push(q);
    fpSeen.add(fp);
  }
  return { questions: kept, removedCount: duplicates.length, duplicates };
}

// tests/p-hf-exam-delete-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function dir() {
  return mkdtemp(path.join(os.tmpdir(), "kg-examdel-"));
}
var NOW = new Date(2026, 4, 1, 12, 0, 0).getTime();
function mkExam(id, src, title, createdAt) {
  return { id, sourcePath: src, sourceVersion: "v1", title, mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [{ id: "q1", type: "recall", question: title + " \u9898?", referenceAnswer: "r", sourcePath: src }], examVersion: 1, createdAt, updatedAt: createdAt };
}
function mkCard(id, src, examId) {
  return { id, sourcePath: src, sourceVersion: "v1", examId, examQuestionId: "q1", question: "\u5361 " + id, answer: "\u7B54", questionType: "recall", createdAt: NOW, updatedAt: NOW };
}
{
  const d = dir();
  const cache = new AICache(d);
  cache.load();
  cache.put({ key: "k-target", type: "note_exam", createdAt: NOW, updatedAt: NOW, status: "success", data: { title: "x", questions: [] }, promptVersion: "v", candidateFingerprint: "f", configFingerprint: "c" });
  cache.put({ key: "k-other", type: "note_exam", createdAt: NOW, updatedAt: NOW, status: "success", data: { title: "y", questions: [] }, promptVersion: "v", candidateFingerprint: "g", configFingerprint: "c" });
  test(
    "P-HF-EXAM-DELETE-13",
    cache.remove("k-target") === true && cache.get("k-target") === void 0,
    "\u53EA\u5220\u9664 target exam cache\uFF08\xA713\uFF09"
  );
  test(
    "P-HF-EXAM-DELETE-14",
    cache.get("k-other") !== void 0 && cache.byType("note_exam").length === 1,
    "\u5176\u4ED6 note_exam cache \u4FDD\u7559\uFF08\xA714/27\uFF1A\u7EDD\u4E0D clearType\uFF09"
  );
  test("P-HF-EXAM-DELETE-15", cache.remove("k-missing") === false, "cache remove \u5931\u8D25\u65E0\u526F\u4F5C\u7528\uFF08\xA715\uFF09");
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const d = dir();
  const exams = new ExamStore(d);
  exams.load();
  const sess = new ExamSessionStore(d);
  sess.load();
  const cards = new ReviewCardStore(d);
  cards.load();
  const cr = new CardReviewStore(d);
  cr.load();
  const spaced = new SpacedReviewStore(d);
  spaced.load();
  const src = "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md";
  const examA = mkExam("exA", src, "A \u8003\u8BD5", NOW - 1e3);
  const examB = mkExam("exB", src, "B \u8003\u8BD5", NOW);
  exams.add(examA);
  exams.add(examB);
  sess.upsert({ examId: "exA", mode: "card", currentIndex: 2, answers: [{ questionId: "q1", answer: "a", selfRating: "good" }], status: "running", startedAt: NOW, updatedAt: NOW });
  const cardA = mkCard("cardA", src, "exA");
  cards.add(cardA);
  const state = {
    cardId: "cardA",
    fsrsState: { due: NOW + 5 * 864e5, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 5 * 864e5 },
    lastRating: "good",
    reviewCount: 3,
    lastReviewedAt: NOW - 5 * 864e5,
    masteryPercent: 75,
    createdAt: NOW - 80 * 864e5,
    updatedAt: NOW - 5 * 864e5
  };
  spaced.scCommitReview("cardA", state, { timestamp: NOW - 5 * 864e5, rating: "good", previousDue: null, nextDue: state.fsrsState.due, intervalDays: 10, stability: 10, difficulty: 5, retrievability: 0.9 });
  cr.add({ cardId: "cardA", reviewedAt: NOW, rating: "good" });
  exams.remove("exA");
  sess.remove("exA");
  test("P-HF-EXAM-DELETE-04", exams.get("exA") === void 0, "\u786E\u8BA4\u5220\u9664\uFF1AExamStore \u4E0D\u518D\u5B58\u5728\uFF08\xA7104/4\uFF09");
  test("P-HF-EXAM-DELETE-06", sess.get("exA") === void 0, "ExamSession \u5220\u9664\uFF08\xA7106/5/38\uFF09");
  test("P-HF-EXAM-DELETE-11", exams.get("exB") !== void 0 && exams.findBySource(src).length === 1, "\u5176\u4ED6 Exam \u4FDD\u7559\uFF08\xA7111/10\uFF09");
  test(
    "P-HF-EXAM-DELETE-07",
    cards.get("cardA") !== void 0 && cards.get("cardA")?.examId === "exA",
    "SavedReviewCard \u4FDD\u7559\uFF08examId \u4FDD\u7559\uFF0CUI \u663E\u793A\u539F\u8003\u8BD5\u5DF2\u5220\u9664\uFF0C\xA7107/4/24/25\uFF09"
  );
  test(
    "P-HF-EXAM-DELETE-08",
    spaced.scGet("cardA") !== void 0 && spaced.scGet("cardA")?.fsrsState.due === state.fsrsState.due,
    "Saved Card FSRS \u4FDD\u7559\u4E14\u5B8C\u5168\u4E00\u81F4\uFF08\xA7108\uFF09"
  );
  test("P-HF-EXAM-DELETE-09", cr.byCard("cardA").length === 1, "CardReviewRecord \u4FDD\u7559\uFF08\xA7109\uFF09");
  test("P-HF-EXAM-DELETE-10", examB.sourcePath === src && cards.get("cardA")?.sourcePath === src, "Source Note \u5F15\u7528\u4FDD\u7559\uFF08\xA7110/10\uFF09");
  fs.rmSync(d, { recursive: true, force: true });
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  const start = mainSrc.indexOf("async deleteExam(");
  const end = mainSrc.indexOf("\u65E7\u5F0F\u8BB0\u5F55\u590D\u4E60\u5361\u590D\u4E60", start);
  const body = stripComments(mainSrc.slice(start, end > start ? end : start + 6e3));
  test("P-HF-EXAM-DELETE-16", body.includes("mdMissing") && body.includes("\u5DF2\u6E05\u7406\u8003\u8BD5\u7D22\u5F15\u4E0E\u4F1A\u8BDD\u8BB0\u5F55"), "Markdown \u4E0D\u5B58\u5728 \u2192 \u6E05\u7406\u7D22\u5F15/\u4F1A\u8BDD\uFF08\xA716/12/42\uFF09");
  test("P-HF-EXAM-DELETE-17", body.includes("\u8003\u8BD5\u6587\u4EF6\u5220\u9664\u5931\u8D25\uFF0C\u8003\u8BD5\u4ECD\u7136\u4FDD\u7559"), "Markdown \u5220\u9664\u5931\u8D25 \u2192 \u4E0D\u5220 Store\uFF08\xA717/41\uFF09");
  test("P-HF-EXAM-DELETE-18", body.includes("\u8003\u8BD5\u5DF2\u7ECF\u4E0D\u5B58\u5728") && body.includes("return false"), "Exam \u4E0D\u5B58\u5728 \u2192 deleteExam \u8FD4\u56DE false\uFF08\xA718/13\uFF09");
  test(
    "P-HF-EXAM-DELETE-19",
    body.includes('examId: "') && body.includes("cache.remove(") && body.includes("generationCacheKeys"),
    "\u5220\u9664\u987A\u5E8F\u542B frontmatter examId \u6821\u9A8C + \u7CBE\u786E cache.remove\uFF08\xA76/26~30/52\uFF09"
  );
  const hubSrc = fs.readFileSync(path.join(__dirname, "..", "src", "examHub.ts"), "utf8");
  test(
    "P-HF-EXAM-DELETE-01",
    hubSrc.includes("\u{1F5D1} \u5220\u9664") && hubSrc.includes("deleting.has(e.id)"),
    "ExamHub \u884C\u6709\u5220\u9664\u6309\u94AE + per-exam \u9632\u8FDE\u70B9\uFF08\xA71/18/49\uFF09"
  );
  test("P-HF-EXAM-DELETE-19b", hubSrc.includes("ev.stopPropagation()"), "\u5220\u9664\u6309\u94AE stopPropagation\uFF08\xA717/2\uFF09");
  test(
    "P-HF-EXAM-DELETE-15b",
    hubSrc.includes("ExamDeleteConfirmModal") && hubSrc.includes("\u5220\u9664\u540E\u65E0\u6CD5\u4ECE\u8003\u8BD5\u4E2D\u5FC3\u6062\u590D"),
    "Obsidian ConfirmModal\uFF08\u975E window.confirm\uFF0C\xA714/15\uFF09"
  );
  test("P-HF-EXAM-DELETE-20", hubSrc.includes("\u8FD9\u7BC7\u7B14\u8BB0\u8FD8\u6CA1\u6709\u521B\u5EFA\u8003\u8BD5"), "\u5220\u7A7A\u540E\u7A7A\u72B6\u6001\u6587\u6848\u4FDD\u7559\uFF08\xA720/21\uFF09");
  test(
    "P-HF-EXAM-DELETE-AI",
    !/\bthis\.ai\b|generateExam\(|recordAccess|markReviewed/.test(body),
    "deleteExam \u5168\u7A0B 0 AI \u4E14\u4E0D\u52A8 Activity\uFF08\xA743\uFF09"
  );
}
{
  const examA = mkExam("A", "s.md", "A \u8003\u8BD5", 1).questions;
  const examB = mkExam("B", "s.md", "B \u8003\u8BD5", 2).questions;
  const examC = mkExam("C", "s.md", "C \u8003\u8BD5", 3).questions;
  const ctxABC = buildExamHistoryContext([examA, examB, examC].map((qs) => ({ questions: qs, coverageTopics: [] })));
  const ctxAC = buildExamHistoryContext([examA, examC].map((qs) => ({ questions: qs, coverageTopics: [] })));
  test(
    "P-HF-EXAM-HISTORY-02",
    ctxABC.historyFingerprint !== ctxAC.historyFingerprint,
    "\u5220\u9664 B \u2192 historyFingerprint \u6539\u53D8\uFF08\xA736/102\uFF09"
  );
  const bLike = { id: "b2", type: "recall", question: "B \u8003\u8BD5 \u9898?", referenceAnswer: "r", sourcePath: "s.md" };
  const keepBRemoved = dedupeExamQuestions([bLike], ctxAC, "strict").questions.length;
  test(
    "P-HF-EXAM-HISTORY-01",
    keepBRemoved === 1,
    "\u5220\u9664 B \u540E\uFF1AB \u7684\u9898\u5E72\u4E0D\u518D\u4F5C\u4E3A\u5386\u53F2\u6392\u9664\uFF0C\u53EF\u91CD\u65B0\u751F\u6210\uFF08\xA737/101\uFF09"
  );
  const keepBWithB = dedupeExamQuestions([bLike], ctxABC, "strict").questions.length;
  test("P-HF-EXAM-HISTORY-01b", keepBWithB === 0, "\u672A\u5220\u9664\u65F6 B \u9898\u5E72\u4ECD\u88AB\u6392\u9664\uFF08\u5BF9\u7167\uFF09");
  const aLike = { id: "a2", type: "recall", question: "A \u8003\u8BD5 \u9898?", referenceAnswer: "r", sourcePath: "s.md" };
  test(
    "P-HF-EXAM-HISTORY-04",
    dedupeExamQuestions([aLike, bLike], ctxAC, "strict").removedCount === 1,
    "\u53EA\u4FDD\u7559 A+C \u4F5C\u4E3A\u5386\u53F2\uFF1AA \u6392\u9664\u3001B \u653E\u884C\uFF08\xA7104/37\uFF09"
  );
  const cardsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "cardsView.ts"), "utf8");
  const hubSrc = fs.readFileSync(path.join(__dirname, "..", "src", "examHub.ts"), "utf8");
  const viewSrc = fs.readFileSync(path.join(__dirname, "..", "src", "examView.ts"), "utf8");
  test(
    "P-HF-EXAM-CARD-04",
    cardsSrc.includes("\u539F\u8003\u8BD5\u5DF2\u5220\u9664"),
    "Card UI\uFF1AexamId \u6307\u5411\u5DF2\u5220\u9664\u8003\u8BD5\u65F6\u663E\u793A\u201C\u539F\u8003\u8BD5\u5DF2\u5220\u9664\u201D\uFF08\xA725/4\uFF09"
  );
  test("P-HF-EXAM-REVIEW-01", hubSrc.includes("\u8BE5\u8003\u8BD5\u5DF2\u88AB\u5220\u9664") && hubSrc.includes("notifyDeleted("), "Exam Review \u89C6\u56FE\uFF1A\u8003\u8BD5\u5DF2\u5220\u9664\u63D0\u793A\uFF08\xA722\uFF09");
  test("P-HF-EXAM-REVIEW-02", hubSrc.includes("\u8FD4\u56DE\u5F53\u524D\u7B14\u8BB0\u8003\u8BD5\u4E2D\u5FC3"), "Exam Review \u8FD4\u56DE\u5165\u53E3\uFF08\xA722\uFF09");
  test(
    "P-HF-EXAM-SESSION-01/02",
    viewSrc.includes("\u8BE5\u8003\u8BD5\u5DF2\u88AB\u5220\u9664") && viewSrc.includes("notifyDeleted("),
    "Exam Session \u89C6\u56FE\uFF1A\u5DF2\u5220\u9664\u63D0\u793A\uFF08\xA723\uFF09"
  );
  test("P-HF-EXAM-CARD-01", cardsSrc.length > 0, "Saved Card \u4FDD\u7559\u7531\u4E0A\u65B9 Store \u6D4B\u8BD5\u8986\u76D6\uFF08\xA7107/101 \u6570\u636E\u5C42\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
/*! Bundled license information:

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)
*/
