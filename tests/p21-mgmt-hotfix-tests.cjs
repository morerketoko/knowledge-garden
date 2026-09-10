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
initTestStorage();

// tests/p21-mgmt-hotfix-tests.ts
var fs = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));

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

// src/spacedReview.ts
var REVIEW_LOG_MAX = 4e3;
var FSRS_RATINGS = ["again", "hard", "good", "easy"];
function reviewBandOf(percent) {
  if (percent <= 39) return "relearn";
  if (percent <= 59) return "building";
  if (percent <= 79) return "basic";
  if (percent <= 94) return "proficient";
  return "mastered";
}
function emptyDistribution() {
  return { relearn: 0, building: 0, basic: 0, proficient: 0, mastered: 0 };
}
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
function savedMasteryDistribution(states) {
  const dist = emptyDistribution();
  for (const s of states) if (typeof s.masteryPercent === "number") dist[reviewBandOf(s.masteryPercent)]++;
  return dist;
}
function savedCardOverview(states, logs, scheduler, now, newCount = 0) {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let due = 0, forgetting = 0, stable = 0;
  const retr = [];
  const mastery = [];
  for (const s of states) {
    const r = scheduler.retrievability(s.fsrsState, now);
    if (s.fsrsState.due <= now) {
      due++;
      if (r !== null && r < 0.7) forgetting++;
    }
    if (r !== null) retr.push(r);
    if (typeof s.masteryPercent === "number") {
      mastery.push(s.masteryPercent);
      if (s.masteryPercent >= 80) stable++;
    }
  }
  return {
    total: states.length + Math.max(0, newCount),
    due,
    forgetting,
    stable,
    newCount: Math.max(0, newCount),
    reviewsToday: logs.filter((l) => l.timestamp >= startOfDay).length,
    avgRetrievability: retr.length ? retr.reduce((a, b) => a + b, 0) / retr.length : null,
    avgMastery: mastery.length ? mastery.reduce((a, b) => a + b, 0) / mastery.length : null,
    dist: savedMasteryDistribution(states)
  };
}
function isValidSavedCardNewWeight(v) {
  return Number.isInteger(v) && v >= 0 && v <= 100;
}
function isNewSavedCard(state) {
  return !state || (state.reviewCount ?? 0) <= 0;
}
function recommendSavedCardScore(m, isNew, newWeight, now) {
  const newBonus = isNew ? Math.max(0, Math.min(100, newWeight)) : 0;
  const forgetRisk = m.retrievability === null ? 0 : Math.max(0, 1 - m.retrievability) * 50;
  const masteryRisk = typeof m.mastery === "number" ? Math.max(0, 100 - m.mastery) * 0.25 : 0;
  const overdueBonus = typeof m.due === "number" && m.due < now ? Math.min(20, Math.max(0, (now - m.due) / 864e5) * 2) : 0;
  const recentPenalty = typeof m.lastReviewedAt === "number" && m.lastReviewedAt >= now - 3 * 864e5 ? 5 : 0;
  return newBonus + forgetRisk + masteryRisk + overdueBonus - recentPenalty;
}
function rankSavedCards(cards, stateOf, metaOf2, mode, newWeight, now) {
  const retr = (m) => m.retrievability !== null ? m.retrievability : Infinity;
  const mastery = (m) => typeof m.mastery === "number" ? m.mastery : Infinity;
  const due = (m) => typeof m.due === "number" ? m.due : Infinity;
  const recent = (m) => typeof m.lastReviewedAt === "number" ? m.lastReviewedAt : -Infinity;
  const scores = /* @__PURE__ */ new Map();
  const isNew = /* @__PURE__ */ new Map();
  for (const c of cards) {
    isNew.set(c.id, isNewSavedCard(stateOf(c.id)));
    scores.set(c.id, recommendSavedCardScore(metaOf2(c.id), isNew.get(c.id) ?? false, newWeight, now));
  }
  const list = [...cards];
  list.sort((a, b) => {
    const ma = metaOf2(a.id);
    const mb = metaOf2(b.id);
    let d = 0;
    switch (mode) {
      case "new": {
        const na = isNew.get(a.id) ?? false;
        const nb = isNew.get(b.id) ?? false;
        if (na !== nb) return na ? -1 : 1;
        if (na && nb) return a.createdAt - b.createdAt;
        d = retr(ma) - retr(mb);
        if (d !== 0) return d;
        return due(ma) - due(mb);
      }
      case "forget":
        d = retr(ma) - retr(mb);
        if (d !== 0) return d;
        return due(ma) - due(mb);
      case "mastery":
        d = mastery(ma) - mastery(mb);
        if (d !== 0) return d;
        return due(ma) - due(mb);
      case "recent":
        return recent(mb) - recent(ma);
      case "next":
        d = due(ma) - due(mb);
        if (d !== 0) return d;
        return retr(ma) - retr(mb);
      case "recommend":
        d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
        if (d !== 0) return d;
        return a.createdAt - b.createdAt;
    }
  });
  return list.map((c) => c.id);
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

// src/types.ts
var DEFAULT_SETTINGS = {
  dashboardName: "\u77E5\u8BC6\u82B1\u56ED",
  autoRefresh: false,
  openOnStartup: false,
  hero: {
    background: "",
    folder: "",
    random: true,
    overlay: 0.25,
    title: "Knowledge Garden",
    subtitle: "\u8BA9\u77E5\u8BC6\u91CD\u65B0\u8FDE\u63A5\u8D77\u6765",
    current: ""
  },
  music: { enabled: false, folder: "", shuffle: false, repeat: true, volume: 0.7, autoplay: false, currentTrack: "", currentPos: 0 },
  knowledgeAreas: [],
  ai: {
    provider: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    model: "Qwen/Qwen2.5-7B-Instruct",
    temperature: 0.7,
    maxTokens: 1500,
    timeoutSec: 60
  },
  review: {
    daily: { enabled: false, time: "20:00" },
    weekly: { enabled: false, weekday: 0, time: "20:00" },
    monthly: { enabled: false, day: "last", time: "20:00" },
    quarterly: { enabled: false, day: "last", time: "20:00" },
    custom: { enabled: false, everyDays: 3, anchorDate: "", time: "20:00" }
  },
  reviews: [],
  dashboard: {
    contentWidth: 1480,
    showHero: true,
    showMusic: true,
    showRecentAccess: true,
    showForgotten: true,
    density: "comfortable"
  },
  activity: { newDays: 7, staleDays: 14, forgottenDays: 30, recentLimit: 8 },
  automaticReview: {
    enabled: false,
    // 默认 OFF：首次安装绝不自动消耗 Token（§二十）
    confirmBeforeRun: true,
    // 生成前询问（§21）
    confirmAfterMissed: true,
    // 错过后询问（§19/36）
    startupCheck: true,
    // 应用启动后检查（§36）
    notifiedOnce: false
    // 首次开启自动复盘的一次性提示（§39）
  },
  lastCuriosity: null,
  lastMonthlyEvolution: null,
  lastQuarterlyEvolution: null,
  evolution: { enabled: true, longTermAI: "metadata", keepWeeks: 52 },
  reviewCenter: {
    queueSize: 5,
    autoQueue: true,
    aiQuestion: true,
    maxQuestions: 5,
    skipPenalty: true,
    autoOpenReview: false,
    showAnswerByDefault: true
    // Phase 20 §44：答案默认显示（纯本地，0 AI）
  },
  spacedReview: {
    enabled: true,
    // Phase 20：默认升级为 FSRS 驱动；关闭 = Phase 8-19 行为
    desiredRetention: 0.9,
    maxIntervalDays: 3650,
    learningSteps: "10m,1h",
    relearningSteps: "10m",
    dailyNewCards: 10,
    maxReviewsPerDay: 30,
    dailySavedCardsLimit: 10,
    savedCardNewWeight: 30,
    overdueFirst: true,
    sortByRetrievability: true,
    autoReschedule: false,
    showAnswerByDefault: true,
    fsrsParameters: null
  },
  discovery: {
    curiosity: { scope: { mode: "vault" }, candidateCount: 16, exploreOld: true },
    roaming: { scope: { mode: "vault" }, candidateCount: 16, preferCrossArea: true }
  },
  queryExplorer: {
    scopeMode: "vault",
    candidateCount: 16,
    localResultLimit: 50,
    historyLimit: 20,
    autoSave: false
  },
  capture: {
    inboxFolder: "Knowledge Garden/Inbox",
    processingFolder: "Knowledge Garden/Processing",
    knowledgeFolder: "Knowledge Garden/Knowledge",
    archiveFolder: "Knowledge Garden/Archive",
    autoProcess: false,
    suggestTags: true,
    suggestAreas: true,
    preserveSources: true
  },
  relationship: { folder: "Knowledge Garden/Relationships" },
  stateBrowse: { mode: "vault" },
  aiProfiles: [],
  // 首次启动由旧 settings.ai 自动迁移生成 default（§一百三十九），见 main.loadSettings
  aiFunctionConfig: [],
  webSearch: { providers: [] },
  // Phase 14：知识考试（§176 默认：holistic / 5 题 / 中等 / 原文优先 / 卡片模式 / Web 关闭）
  exam: {
    generationProfileId: "",
    gradingProfileId: "",
    defaultMode: "holistic",
    defaultCount: 5,
    defaultDifficulty: "medium",
    defaultAnswerMode: "source_preferred",
    webEnabled: false,
    relatedNotesEnabled: false,
    autoGrade: false,
    cardMode: true,
    defaultContentStrategy: "new_content",
    // Phase 23 §6：默认 🌱 未考知识点优先
    defaultRepeatPolicy: "strict"
    // Phase 23 §6：默认 严格
  },
  // Phase 13：Workspace / Skills / Capability / Permission（默认跟随旧行为，§一百二十九）
  workspaces: [],
  currentWorkspaceId: null,
  skillRegistry: [],
  modelMetadata: [],
  permissionsPolicy: {},
  // Phase 15：AI Workbench（§二百五十八；Web 默认关闭 §四十二；批量写默认 5 §七十五）
  workbench: {
    enabled: true,
    maxSteps: 8,
    // 5 / 8 / 12（§二百五十八）
    maxQueries: 5,
    // 默认 5（§四十四）
    maxPages: 10,
    // 默认 10（§四十六）
    maxChars: 2e4,
    // 默认 20000（§五十五）
    maxBatchWrites: 5,
    // 1 / 5 / 10（§七十五）
    webEnabledByDefault: false,
    // Web 必须显式启用（§四十二/二百五十八）
    historyLimit: 20,
    // 任务/问题历史保留条数（§一百九十三）
    vaultScope: "vault",
    // Retrieval v3：AI 可以搜索的范围（vault | workspace | current-folder | custom）
    customFolders: []
    // 自定义搜索目录（vaultScope=custom 时生效）
  }
};

// tests/p21-mgmt-hotfix-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
var DAY = 864e5;
var NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();
function baseCard(id, createdAt) {
  return { id, sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", question: "\u9898 " + id, answer: "\u7B54", questionType: "recall", createdAt, updatedAt: createdAt };
}
function oldState(id, opts = {}) {
  const retr = opts.retr ?? 0.9;
  const stability = Math.max(1, 60 * (1 - retr) + 1);
  return {
    cardId: id,
    fsrsState: { due: opts.due ?? NOW + 3 * DAY, stability, difficulty: 5, reps: opts.reviewCount ?? 1, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 40 * DAY },
    lastRating: "good",
    reviewCount: opts.reviewCount ?? 1,
    lastReviewedAt: opts.lastReviewedAt,
    masteryPercent: opts.mastery,
    createdAt: opts.createdAt ?? NOW - 30 * DAY,
    updatedAt: NOW - 30 * DAY
  };
}
function metaOf(m) {
  return { due: m.due, retrievability: m.retrievability, mastery: m.mastery, lastReviewedAt: m.lastReviewedAt };
}
{
  const st0 = oldState("B", { reviewCount: 0 });
  const st1 = oldState("C", { reviewCount: 1 });
  test("P-HF-NEW-08", isNewSavedCard(st0) === true, "\u6709 state \u4F46 reviewCount=0 \u2192 \u4ECD\u4E3A\u65B0\u5361\uFF08\xA716/40\uFF09");
  test("P-HF-NEW-09", isNewSavedCard(st1) === false, "reviewCount=1 \u2192 \u4E0D\u662F\u65B0\u5361\uFF08\xA741\uFF09");
  test(
    "P-HF-NEW-09b",
    isNewSavedCard(null) === true && isNewSavedCard(void 0) === true,
    "\u65E0 FSRS state \u2192 \u65B0\u5361\uFF08\u4ECE\u672A\u771F\u5B9E FSRS Rating\uFF0C\xA715\uFF1B\u65E7 reviewCount \u4E0D\u4F5C\u6570\uFF09"
  );
  test(
    "P-HF-NEW-12a",
    DEFAULT_SETTINGS.spacedReview.savedCardNewWeight === 30,
    "savedCardNewWeight \u9ED8\u8BA4 30\uFF08mergeSettings \u4F1A\u4E3A\u65E7 data.json \u81EA\u52A8\u8865\u9ED8\u8BA4\uFF0C\xA763\uFF09"
  );
}
{
  const cards = [baseCard("A", NOW - 100 * DAY), baseCard("B", NOW - 50 * DAY)];
  const stateOf = (id) => id === "B" ? oldState("B", { reviewCount: 1 }) : null;
  const metaOf2 = (id) => {
    const st = stateOf(id);
    return { due: st ? st.fsrsState.due : void 0, retrievability: st ? 0.9 : null, mastery: st ? 50 : void 0, lastReviewedAt: st?.lastReviewedAt };
  };
  const orderNew = rankSavedCards(cards, stateOf, metaOf2, "new", 30, NOW);
  test("P-HF-NEW-01", orderNew[0] === "A" && orderNew[1] === "B", "\u65B0\u5361\u6A21\u5F0F\uFF1AA(\u65E0 state) \u5728 B(reviewCount=1) \u4E4B\u524D\uFF08\xA733\uFF09");
  const twoNew = [baseCard("A1", NOW - 200 * DAY), baseCard("B1", NOW - 20 * DAY)];
  const orderNew2 = rankSavedCards(twoNew, () => null, () => metaOf2("A"), "new", 30, NOW);
  test("P-HF-NEW-02", orderNew2[0] === "A1" && orderNew2[1] === "B1", "\u4E24\u5F20\u65B0\u5361 \u2192 \u6700\u65E9\u6536\u85CF\u5728\u524D\uFF08createdAt ASC\uFF0C\xA734\uFF09");
  const stateB = oldState("B2", { reviewCount: 1, retr: 0.1 });
  const orderNew3 = rankSavedCards(
    [baseCard("A2", NOW - 300 * DAY), baseCard("B2", NOW - 10 * DAY)],
    (id) => id === "B2" ? stateB : null,
    (id) => id === "B2" ? metaOf2({ retrievability: 0.1, due: NOW - DAY, mastery: 10 }) : metaOf2({ retrievability: null }),
    "new",
    30,
    NOW
  );
  test("P-HF-NEW-03", orderNew3[0] === "A2", "\u65B0\u5361\u6A21\u5F0F\uFF1AA(\u65B0) \u4F18\u5148\u4E8E\u4E25\u91CD\u9057\u5FD8\u7684\u65E7\u5361 B\uFF08\xA73/35\uFF09");
}
{
  const metaFor = (st) => st ? metaOf({ retrievability: 0.9, due: st.fsrsState.due, mastery: 90, lastReviewedAt: void 0 }) : metaOf({ retrievability: null });
  const stB = oldState("B", { reviewCount: 3, retr: 0.9, due: NOW + DAY, mastery: 90 });
  const cards = [baseCard("A", NOW - 50 * DAY), baseCard("B", NOW - 100 * DAY)];
  const byState = (id) => id === "B" ? stB : null;
  const byMeta = (id) => metaFor(byState(id));
  const rec30 = rankSavedCards(cards, byState, byMeta, "recommend", 30, NOW);
  test("P-HF-NEW-04", rec30[0] === "A", "\u9ED8\u8BA4\u6743\u91CD 30\uFF1AA(\u65B0) \u6BD4\u6307\u6807\u63A5\u8FD1\u7684\u65E7\u5361 B \u6392\u524D\uFF08\xA736\uFF09");
  const rec0 = rankSavedCards(cards, byState, byMeta, "recommend", 0, NOW);
  test(
    "P-HF-NEW-05",
    rec0[0] === "B" && rec0[1] === "A",
    "\u6743\u91CD 0\uFF1A\u65B0\u5361\u65E0 bonus \u2192 \u540C\u5206\u4EE5 createdAt \u7A33\u5B9A tie-break\uFF08B \u66F4\u65E9\uFF0C\xA737/71\uFF09"
  );
  const rec100 = rankSavedCards(cards, byState, byMeta, "recommend", 100, NOW);
  test("P-HF-NEW-06", rec100[0] === "A", "\u6743\u91CD 100\uFF1A\u65B0\u5361\u660E\u663E\u4F18\u5148\uFF08\xA738\uFF09");
  test(
    "P-HF-NEW-07",
    !isValidSavedCardNewWeight(-1) && !isValidSavedCardNewWeight(101) && isValidSavedCardNewWeight(0) && isValidSavedCardNewWeight(100),
    "\u6743\u91CD\u8FB9\u754C\uFF1A-1/101 \u62D2\u7EDD\uFF0C0/100 \u63A5\u53D7\uFF08\xA739\uFF09"
  );
  test(
    "P-HF-NEW-10",
    recommendSavedCardScore(metaOf({ retrievability: null }), true, 30, NOW) === 30,
    "\u65B0\u5361 + mastery/retr \u7F3A\u5931\uFF1A\u4E0D\u5D29\uFF0Cscore=30\uFF08newBonus \u751F\u6548\uFF09\uFF08\xA742\uFF09"
  );
  const scoreOld = recommendSavedCardScore(metaOf({ retrievability: 0.9, mastery: 90, due: NOW + DAY }), false, 30, NOW);
  const scoreNew = recommendSavedCardScore(metaOf({ retrievability: null }), true, 30, NOW);
  test(
    "P-HF-NEW-11",
    Number.isFinite(scoreOld) && Number.isFinite(scoreNew) && scoreNew > scoreOld,
    "retrievability null \u6B63\u5E38\u53C2\u4E0E\u8BC4\u5206\uFF08\xA743\uFF09"
  );
  test(
    "P-HF-NEW-12",
    rankSavedCards([baseCard("D", NOW - 5 * DAY)], () => null, () => metaOf({ retrievability: null }), "next", 30, NOW).length === 1,
    "\u65B0\u5361 due undefined \u2192 next \u6392\u5E8F\u4E0D\u5D29\uFF08\xA744\uFF1BUI \u663E\u793A\u201C\u9996\u6B21\u590D\u4E60\u201D\uFF09"
  );
}
{
  const dir = mkdtemp(path.join(os.tmpdir(), "kg-mgmt-"));
  const cards = new ReviewCardStore(dir);
  cards.load();
  const cr = new CardReviewStore(dir);
  cr.load();
  const exams = new ExamStore(dir);
  exams.load();
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  const exam = { id: "e1", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u6765\u6E90\u8003\u8BD5", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  exams.add(exam);
  cards.add({ ...baseCard("cardX", NOW), examId: "e1" });
  cr.add({ cardId: "cardX", reviewedAt: NOW, rating: "good" });
  spaced.scCommitReview("cardX", oldState("cardX", { reviewCount: 1, due: NOW + DAY }), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  cards.remove("cardX");
  spaced.scRemoveCard("cardX");
  cr.removeByCard("cardX");
  test("P-HF-DELETE-03", cards.get("cardX") === void 0 && cards.count() === 0, "\u786E\u8BA4\u5220\u9664\uFF1A\u5361\u7247\u4ECE ReviewCardStore \u6D88\u5931\uFF08\xA747\uFF09");
  test("P-HF-DELETE-04", spaced.scGet("cardX") === void 0 && spaced.scCount() === 0, "FSRS state \u5220\u9664\uFF08scRemoveCard\uFF0C\xA748/9\uFF09");
  test("P-HF-DELETE-05", cr.byCard("cardX").length === 0 && cr.count() === 0, "CardReviewRecord \u5220\u9664\uFF08\xA749\uFF09");
  test("P-HF-DELETE-07", exams.get("e1") !== void 0 && exams.findBySource("01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md").length === 1, "Exam \u4E0D\u53D7\u5F71\u54CD\uFF08\xA751\uFF09");
  test("P-HF-DELETE-08", exams.all()[0].sourcePath === "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", "source note \u4E0D\u53D7\u5F71\u54CD\uFF08\xA752\uFF09");
  test("P-HF-DELETE-13", cards.count() === 0 && cards.all().length === 0, "\u5220\u9664\u540E\u603B\u6570 -1\uFF08\u65B0\u5361\u7EDF\u8BA1\u968F\u4E4B\u66F4\u65B0\uFF0C\xA757/6\uFF09");
  cards.remove("cardX");
  test("P-HF-DELETE-15", cards.count() === 0, "\u91CD\u590D\u5220\u9664\uFF1Ano-op\uFF0C\u53EA\u6210\u529F\u4E00\u6B21\uFF08\xA759\uFF1BUI \u53E6\u6709 deleting \u9632\u8FDE\u70B9\uFF09");
  const st = oldState("old1", { reviewCount: 2, mastery: 90 });
  const ov = savedCardOverview([st], [], new class {
    retrievability() {
      return 0.9;
    }
  }(), NOW, 5);
  test(
    "P-HF-NEW-12b",
    ov.newCount === 5 && ov.total === 6 && ov.dist.proficient === 1,
    "overview\uFF1A\u65B0\u5361\u5355\u72EC\u8BA1\u6570\u4E14\u4E0D\u8BA1\u5165\u638C\u63E1\u5206\u5E03\uFF08got newCount=" + ov.newCount + ", total=" + ov.total + ", proficient=" + ov.dist.proficient + "\uFF09\uFF08\xA728/29/30/31\uFF09"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "main.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  const delStart = src.indexOf("async deleteCard(cardId: string): Promise<void> {");
  const delMarker = src.indexOf("\u5DF2\u5220\u9664\u590D\u4E60\u5361\uFF080 AI\uFF09", delStart);
  const delBody = delStart >= 0 && delMarker > delStart ? src.slice(delStart, delMarker) : "";
  test(
    "P-HF-DELETE-09",
    delBody.length > 0 && !/\bAI\b|generate|prompt|apiKey/.test(delBody),
    "\u5220\u9664\u540E\u7AEF 0 AI\uFF08deleteCard \u65E0 AI/\u751F\u6210\u8C03\u7528\uFF0C\xA753\uFF09"
  );
  test(
    "P-HF-DELETE-10",
    !/recordAccess|markReviewed/.test(delBody),
    "\u5220\u9664\u4E0D\u8C03\u7528 recordAccess / markReviewed\uFF08Activity \u4E0D\u53D8\uFF0C\xA754/10\uFF09"
  );
  test(
    "P-HF-DELETE-06",
    /trash\(/.test(delBody) && /cardMarkdownPath/.test(delBody),
    "Review Card Markdown \u5220\u9664\u5165\u53E3\u4FDD\u7559\uFF08\u5B9E\u9645 trash \u5728 Obsidian \u8FD0\u884C\u5C42\uFF0C\xA750/6\uFF09"
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
/*! Bundled license information:

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)
*/
