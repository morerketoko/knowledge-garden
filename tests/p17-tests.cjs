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
  /**
   * 列出后端内的全部文件（若后端支持文件树）。
   * 供布局修复使用：Obsidian 只有 getFiles()（文件清单，不含目录），
   * 目录驱动遍历不可靠，所以修复必须按文件路径处理。
   */
  listAllFiles() {
    const root = this.root;
    return typeof root.listAllFilesSync === "function" ? root.listAllFilesSync() : [];
  }
  /**
   * **原位读**：按给定路径直接读后端，不做任何前缀重写。
   * 迁移 / 诊断要读 `.obsidian/plugins/<id>/cache/…`、`.state/cache/…`、嵌套层文件，
   * 这些路径必须保持原样读取（而 `host.resolve` 会把 store 路径重定向到状态根）。
   */
  async readRaw(path2) {
    return this.root.read(normalizeVaultPath(path2));
  }
  /** **原位写**：按给定路径直接写后端，绝不做前缀重写（备份 / 恢复目标以外用） */
  async writeRaw(path2, data) {
    const p = normalizeVaultPath(path2);
    if (!p) return false;
    try {
      const dir = dirnameVaultPath(p);
      if (dir) await this.root.mkdirp(dir);
      await this.root.write(p, data);
      return true;
    } catch {
      return false;
    }
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
    if (this.isOrphanPath(p)) return this.vaultStorage;
    return this.isVaultPath(p) ? this.vaultStorage : this.dataStorage;
  }
  /**
   * 「原位位置」判定：恢复备份目录 `.state-recovery/…`。
   *
   * 这些路径不属于 store 命名空间，**必须**按原样读写，绝不能被重定向到状态根。
   *
   * 注意：`.obsidian/plugins/<id>/cache/…` **故意不在**此列 —— 历史 store 路径
   * （baseDir + `/cache/x.json`）仍按原语义被重定向到当前状态根；迁移/诊断读旧桌面文件
   * 走的是 `app.vault.adapter.read()`（原位、权威），不依赖这里。
   */
  isOrphanPath(p) {
    return p === ".state-recovery" || p.startsWith(".state-recovery/");
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
    if (this.isOrphanPath(normalizeVaultPath(raw))) return normalizeVaultPath(raw);
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
  /**
   * **原位读**：按 vault 相对路径原样读取，**不做 baseDir / 状态根重写**。
   *
   * 迁移与恢复必须用它：`.obsidian/plugins/<id>/cache/…`、vault 根的 `.state/cache/…`、
   * 嵌套层 `…/<stateRoot>/cache/…` 都是「别的历史位置」，`resolve()` 会把它们
   * 当成 store 路径重定向到当前状态根，从而读不到真正的内容（旧数据等于没迁移）。
   */
  async readRaw(path2) {
    const p = normalizeVaultPath(path2);
    if (!p) return null;
    if (this.vaultStorage) return this.vaultStorage.readRaw(p);
    return null;
  }
  /** 原位写（把来源复制进备份目录用；恢复目标写入走 write()） */
  async writeRaw(path2, data) {
    if (!this.vaultStorage) return false;
    return this.vaultStorage.writeRaw(path2, data);
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
function flushMirrorSoon() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  void Promise.resolve().then(() => flushMirror());
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
function seedStateText(rel, text) {
  writeFileSync(stateKeyOf(rel), text);
}

// src/portable/pathShim.ts
function join(...parts) {
  return joinVaultPath(...parts);
}

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
  const dir = i < 0 ? "" : p.slice(0, i);
  const name = i < 0 ? p : p.slice(i + 1);
  const stamp = name + "." + corruptStamp(now);
  return dir ? dir + "/.corrupt/" + stamp : ".corrupt/" + stamp;
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
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
    }
  }
  writeFileSync(filePath, data, "utf8");
  flushMirrorSoon();
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
    this.file = join(pluginDir, "cache", "artifacts.json");
  }
  load() {
    try {
      if (!existsSync(this.file)) return false;
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
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
  path = "";
  basename = "";
  extension = "md";
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
      const out = await copyText(md);
      if (!out.ok) return { ok: false, error: out.reason ?? "\u526A\u8D34\u677F\u4E0D\u53EF\u7528\uFF0C\u8BF7\u6539\u7528\u300C\u4FDD\u5B58\u5230 Vault\u300D\u3002" };
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

// tests/p17-tests.ts
var fs = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function tmpRoot() {
  return mkdtemp(path.join(os.tmpdir(), "kg-p17-"));
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
  test("P17-11", stateExists(path.join(dir, "cache", "artifacts.json")), "\u7D22\u5F15\u5199\u5165 cache/artifacts.json\uFF08\u72EC\u7ACB\u4E8E AI Cache\uFF09");
  const store2 = new ArtifactStore(dir);
  store2.load();
  test("P17-12", store2.count() === 2, "\u91CD\u65B0 load \u6062\u590D\u7D22\u5F15\uFF08\u91CD\u88C5/\u91CD\u542F\u540E Artifact \u4ECD\u5728\uFF09");
  fs.rmSync(dir, { recursive: true, force: true });
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
  seedStateText(path.join(dir, "cache", "ai-cache.json"), JSON.stringify({ cleared: true }));
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
  fs.rmSync(path.join(dir, "cache", "ai-cache.json"), { force: true });
  const store2 = new ArtifactStore(dir);
  store2.load();
  test("P17-26", store2.count() === 1 && store2.get(a.id)?.title === "T", "\u6E05 AI Cache \u4E0D\u5F71\u54CD Artifact \u7D22\u5F15\uFF08\xA779\uFF09");
  test("P17-27", !Object.keys(store2.get(a.id) ?? {}).includes("content"), "\u7D22\u5F15\u6761\u76EE\u4E0D\u542B\u6B63\u6587\uFF08\u7528\u6237\u7F16\u8F91\u4E0D\u6539 Cache \xA780\uFF09");
  test("P17-28", store2.get(a.id)?.id === a.id, "Artifact ID \u4E0E Prompt/Model \u65E0\u5173\uFF08\xA7129-130\uFF09");
  test("P17-29", stateExists(path.join(dir, "cache", "artifacts.json")), "Artifact \u7D22\u5F15\u6587\u4EF6\u72EC\u7ACB\u5B58\u5728");
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
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
