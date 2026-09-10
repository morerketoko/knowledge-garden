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

// tests/p22-tests.ts
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
  static card(card2) {
    return {
      ...card2,
      state: _TypeConvert.state(card2.state),
      due: _TypeConvert.time(card2.due),
      last_review: card2.last_review ? _TypeConvert.time(card2.last_review) : void 0
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
          const card2 = sanitizeCard(p, c);
          if (card2) this.cards.set(p, card2);
        }
      }
      if (Array.isArray(raw.reviewLogs)) {
        this.logs = raw.reviewLogs.filter((l) => l && typeof l === "object" && typeof l.path === "string" && typeof l.timestamp === "number").slice(-REVIEW_LOG_MAX);
      }
      if (raw.savedCards && typeof raw.savedCards === "object") {
        for (const [id, c] of Object.entries(raw.savedCards)) {
          const card2 = sanitizeSavedCard(id, c);
          if (card2) this.savedCards.set(id, card2);
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
    const card2 = { ...next, path: pathKey, updatedAt: Date.now() };
    const entry = { ...log, path: pathKey };
    const nextCards = new Map(this.cards);
    nextCards.set(pathKey, card2);
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
function savedCardInFolder(sourcePath, folderPath) {
  const fp = (folderPath || "").replace(/\/+$/, "");
  if (!fp) return true;
  if (sourcePath === fp || sourcePath === fp + ".md") return true;
  return sourcePath.startsWith(fp + "/");
}
function normalizeTag(tag) {
  return (tag ?? "").replace(/^#+/, "").trim();
}
function tagMatchModeOf(scope) {
  return scope?.tagMatchMode === "exact" ? "exact" : "include-children";
}
function sourceNoteHasTag(noteTags, tag, mode) {
  const want = normalizeTag(tag);
  if (!want) return false;
  const normTags = (noteTags ?? []).map(normalizeTag).filter(Boolean);
  if (mode === "exact") return normTags.includes(want);
  const prefix = want + "/";
  return normTags.some((t) => t === want || t.startsWith(prefix));
}
function aggregateNoteTags(notes) {
  const counts = /* @__PURE__ */ new Map();
  for (const n of notes) {
    for (const raw of n.tags ?? []) {
      const t = normalizeTag(raw);
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
function filterTagOptions(options, query) {
  const q = normalizeTag(query).toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.tag.toLowerCase().includes(q));
}
function filterSavedCardObjects(cards, scope, noteTagsOf) {
  if (!scope || scope.mode === "vault") return cards;
  const match = (c) => {
    switch (scope.mode) {
      case "current-note":
        return !!scope.notePath && c.sourcePath === scope.notePath;
      case "folder":
        return !!scope.folderPath && savedCardInFolder(c.sourcePath, scope.folderPath);
      case "area":
        return !!scope.folderPath && savedCardInFolder(c.sourcePath, scope.folderPath);
      case "exam":
        return !!scope.examId && c.examId === scope.examId;
      case "tag": {
        if (!noteTagsOf) return false;
        return sourceNoteHasTag(noteTagsOf(c.sourcePath), scope.tag, tagMatchModeOf(scope));
      }
      case "custom": {
        if (scope.folders && scope.folders.length) {
          if (!scope.folders.some((f) => savedCardInFolder(c.sourcePath, f))) return false;
        }
        return true;
      }
      default:
        return true;
    }
  };
  return cards.filter(match);
}
function savedCardScopeFingerprint(scope) {
  const o = { mode: scope?.mode ?? "vault" };
  if (scope?.notePath) o["notePath"] = scope.notePath;
  if (scope?.folderPath) o["folderPath"] = scope.folderPath;
  if (scope?.areaId) o["areaId"] = scope.areaId;
  if (scope?.examId) o["examId"] = scope.examId;
  if (scope?.tag) {
    o["tag"] = normalizeTag(scope.tag);
    o["tagMatchMode"] = tagMatchModeOf(scope);
  }
  if (scope?.folders && scope.folders.length) o["folders"] = [...scope.folders].sort();
  const s = JSON.stringify(o);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function savedCardScopeText(scope, examTitle) {
  if (!scope || scope.mode === "vault") return "\u6574\u4E2A Vault";
  switch (scope.mode) {
    case "current-note":
      return scope.notePath ? scope.notePath.replace(/\.md$/i, "") : "\u5F53\u524D\u7B14\u8BB0";
    case "folder":
      return scope.folderPath || "\uFF08\u672A\u9009\u6587\u4EF6\u5939\uFF09";
    case "area":
      return scope.areaId || "\uFF08\u672A\u9009\u533A\u57DF\uFF09";
    case "exam":
      return examTitle || scope.examId || "\uFF08\u672A\u9009\u8003\u8BD5\uFF09";
    case "tag":
      return scope.tag ? "#" + normalizeTag(scope.tag) : "\uFF08\u672A\u9009\u6807\u7B7E\uFF09";
    case "custom": {
      const folders = (scope.folders ?? []).slice(0, 2);
      const more = (scope.folders ?? []).length > 2 ? " \u7B49 " + (scope.folders?.length ?? 0) + " \u4E2A" : "";
      return (folders.length ? folders.join("\u3001") : "\uFF08\u672A\u9009\u6587\u4EF6\u5939\uFF09") + more;
    }
  }
}

// src/savedCardEditor.ts
function isTrueFalseValue(v) {
  const t = (v ?? "").trim().toLowerCase();
  return t === "true" || t === "false";
}
function letterIndex(letter) {
  const t = (letter ?? "").trim().toUpperCase();
  if (t.length !== 1 || t < "A" || t > "Z") return -1;
  return t.charCodeAt(0) - 65;
}
function validateSavedCardEdit(input, questionType) {
  const errors = [];
  const question = (input.question ?? "").trim();
  if (!question) errors.push("\u9898\u5E72\u4E0D\u80FD\u4E3A\u7A7A");
  const options = (input.options ?? []).map((o) => (o ?? "").trim());
  if (questionType === "multiple_choice") {
    const filled = options.filter(Boolean);
    if (filled.length < 2) errors.push("\u9009\u62E9\u9898\u81F3\u5C11\u9700\u8981 2 \u4E2A\u9009\u9879");
    else {
      const ca = (input.correctAnswer ?? "").trim().toUpperCase();
      const idx = letterIndex(ca);
      if (idx < 0 || idx >= options.length || !options[idx]) {
        errors.push("\u6B63\u786E\u7B54\u6848\u5FC5\u987B\u5BF9\u5E94\u67D0\u4E2A\u9009\u9879");
      }
    }
  } else if (questionType === "true_false") {
    if (!isTrueFalseValue(input.correctAnswer)) errors.push("\u5224\u65AD\u9898\u6B63\u786E\u7B54\u6848\u5FC5\u987B\u662F true \u6216 false");
  }
  return { ok: errors.length === 0, errors };
}
function parseTagsText(text) {
  return (text ?? "").split(/[,，、\s]+/).map((t) => t.trim().replace(/^#+/, "")).filter(Boolean).slice(0, 20);
}
function applySavedCardEdit(card2, input) {
  const options = (input.options ?? []).map((o) => (o ?? "").trim());
  const next = {
    ...card2,
    question: (input.question ?? "").trim().slice(0, 240),
    answer: (input.answer ?? "").trim().slice(0, 3e3),
    explanation: (input.explanation ?? "").trim().slice(0, 1200) || void 0,
    concept: (input.concept ?? "").trim().slice(0, 80) || void 0,
    tags: parseTagsText(input.tagsText)
  };
  if (card2.questionType === "multiple_choice") {
    next.options = options.length ? options.slice(0, 8) : void 0;
    next.correctAnswer = options.length ? (input.correctAnswer ?? "").trim().toUpperCase() : void 0;
  } else if (card2.questionType === "true_false") {
    next.correctAnswer = (input.correctAnswer ?? "").trim().toLowerCase() || void 0;
  }
  return next;
}
function editDraftFromCard(card2) {
  const ca = card2.correctAnswer ?? "";
  return {
    question: card2.question ?? "",
    answer: card2.answer ?? "",
    explanation: card2.explanation ?? "",
    concept: card2.concept ?? "",
    tagsText: (card2.tags ?? []).join(", "),
    options: card2.options ? [...card2.options] : [],
    correctAnswer: ca
  };
}

// src/savedCardSearch.ts
function normalizeSearchText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
function searchTokens(query) {
  const q = normalizeSearchText(query);
  if (!q) return [];
  return q.split(/[，。！？；;：:,.!?()（）《》「」"'“”‘’、_\-—…\s#/\\|~]+/).map((t) => t.trim()).filter(Boolean);
}
function savedCardMatchesQuery(haystack, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const hay = normalizeSearchText(haystack);
  if (hay.includes(q)) return true;
  const tokens = searchTokens(query);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}
function savedCardHaystack(card2, examTitle, sourceBasename) {
  return [
    card2.question ?? "",
    card2.answer ?? "",
    card2.explanation ?? "",
    card2.concept ?? "",
    (card2.tags ?? []).join(" "),
    card2.sourcePath ?? "",
    sourceBasename ?? "",
    examTitle ?? ""
  ].join(" \n ");
}
function filterSavedCardsByQuery(cards, query, meta) {
  const q = normalizeSearchText(query);
  if (!q) return cards;
  return cards.filter((c) => savedCardMatchesQuery(savedCardHaystack(c, meta(c).examTitle, meta(c).sourceBasename), q));
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
function escYaml(s) {
  return '"' + (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function unescYaml(s) {
  const m = /^"(.*)"$/.exec(s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s;
}
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
function cardMarkdown(c) {
  const dateStr = new Date(c.createdAt).toISOString().slice(0, 10);
  const wiki = (p) => "[[" + (p.split("/").pop() ?? p).replace(/\.md$/i, "") + "]]";
  return [
    "---",
    "type: review-card",
    'cardId: "' + c.id + '"',
    'sourcePath: "' + c.sourcePath + '"',
    'sourceVersion: "' + c.sourceVersion + '"',
    ...c.examId ? ['examId: "' + c.examId + '"'] : [],
    ...c.examQuestionId ? ['examQuestionId: "' + c.examQuestionId + '"'] : [],
    'questionType: "' + c.questionType + '"',
    ...c.options && c.options.length ? ["options: [" + c.options.map(escYaml).join(", ") + "]"] : [],
    ...c.correctAnswer ? ["correctAnswer: " + escYaml(c.correctAnswer)] : [],
    ...c.concept ? ['concept: "' + c.concept + '"'] : [],
    ...c.tags && c.tags.length ? ["tags: [" + c.tags.map(escYaml).join(", ") + "]"] : [],
    "createdAt: " + c.createdAt,
    "---",
    "",
    "# " + c.question,
    "",
    "## \u7B54\u6848",
    "",
    c.answer,
    "",
    ...c.explanation ? ["## \u89E3\u91CA", "", c.explanation, ""] : [],
    ...c.sourceEvidence && c.sourceEvidence.length ? ["## \u539F\u6587\u4F9D\u636E", "", ...c.sourceEvidence.map((s) => "- " + s), ""] : [],
    "",
    "## \u6765\u6E90",
    "",
    wiki(c.sourcePath),
    "",
    "<!-- " + dateStr + " -->"
  ].join("\n");
}
function parseCardMarkdown(md) {
  if (!md.startsWith("---")) return { card: null };
  const end = md.indexOf("\n---", 3);
  if (end < 0) return { card: null };
  const block = md.slice(3, end);
  const kv = /* @__PURE__ */ new Map();
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (v === "") continue;
    kv.set(k, v);
  }
  const inlineArr = (v) => {
    if (!v) return void 0;
    const t = v.trim();
    if (t.startsWith("[") && t.endsWith("]")) {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
      } catch {
      }
      return t.slice(1, -1).split(",").map((s) => unescYaml(s.trim())).filter(Boolean);
    }
    return void 0;
  };
  const id = unescYaml(kv.get("cardId") ?? "");
  if (!id) return { card: null };
  const qtypeRaw = unescYaml(kv.get("questionType") ?? "");
  const hashIdx = md.indexOf("# ", end);
  const q = hashIdx >= 0 ? md.slice(hashIdx + 2, md.indexOf("\n", hashIdx)).trim() || id : id;
  const ansM = /^## 答案[\s\S]*?\n\n([\s\S]*?)\n\n## /m.exec(md.slice(end));
  const expM = /^## 解释[\s\S]*?\n\n([\s\S]*?)\n\n## /m.exec(md.slice(end));
  const card2 = {
    id,
    sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
    sourceVersion: unescYaml(kv.get("sourceVersion") ?? ""),
    examId: unescYaml(kv.get("examId") ?? ""),
    examQuestionId: unescYaml(kv.get("examQuestionId") ?? ""),
    question: q,
    answer: ansM ? ansM[1].trim() : "",
    explanation: expM ? expM[1].trim() : void 0,
    questionType: ["recall", "explanation", "comparison", "application", "true_false", "multiple_choice", "counterexample"].includes(qtypeRaw) ? qtypeRaw : "recall",
    options: inlineArr(kv.get("options")),
    correctAnswer: unescYaml(kv.get("correctAnswer") ?? ""),
    concept: unescYaml(kv.get("concept") ?? ""),
    tags: inlineArr(kv.get("tags")),
    createdAt: parseInt(kv.get("createdAt") ?? "", 10) || Date.now(),
    updatedAt: Date.now()
  };
  return { card: card2 };
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
  add(card2) {
    this.entries.push(card2);
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

// tests/p22-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
var NOW = new Date(2026, 3, 1, 12, 0, 0).getTime();
function card(id, source, over = {}) {
  return { id, sourcePath: source, sourceVersion: "v1", question: "\u9898 " + id, answer: "\u7B54 " + id, questionType: "recall", createdAt: NOW, updatedAt: NOW, ...over };
}
var NOTES = [
  { path: "A.md", tags: ["game", "\u8BBE\u8BA1"] },
  { path: "B.md", tags: ["game/design", "ai"] },
  { path: "C.md", tags: ["python"] },
  { path: "D.md", tags: ["game/\u5267\u60C5"] }
];
var CARDS = [
  card("ca", "A.md"),
  card("cb", "B.md"),
  card("cc", "C.md"),
  card("cd", "D.md"),
  card("cf", "\u4E0D\u5B58\u5728.md")
];
var tagsOf = (p) => NOTES.find((n) => n.path === p)?.tags ?? [];
{
  test("P22-TAG-01", sourceNoteHasTag(["game"], "game", "include-children") === true, "\u7CBE\u786E\u6807\u7B7E\u547D\u4E2D\uFF08\xA78/101\uFF09");
  test("P22-TAG-02", sourceNoteHasTag(["game/design"], "game", "include-children") === true, "include-children \u547D\u4E2D\u5B50\u6807\u7B7E #game/design\uFF08\xA79/102\uFF09");
  test("P22-TAG-03", sourceNoteHasTag(["game/design"], "game", "exact") === false, "exact \u4E0D\u547D\u4E2D\u5B50\u6807\u7B7E\uFF08\xA7103\uFF09");
  test(
    "P22-TAG-04",
    sourceNoteHasTag(["gamestuff"], "game", "include-children") === false,
    "#gamestuff \u4E0D\u5339\u914D #game\uFF08\u524D\u7F00\u8FB9\u754C '/'\uFF0C\xA7104\uFF09"
  );
  const inGame = filterSavedCardObjects(CARDS, { mode: "tag", tag: "#game" }, tagsOf).map((c) => c.id);
  test(
    "P22-TAG-05",
    inGame.length === 3 && ["ca", "cb", "cd"].every((x) => inGame.includes(x)),
    "\u591A\u4E2A\u6765\u6E90\uFF1A#game(include-children) \u542B A/B/D\uFF08B/D \u4E3A\u5B50\u6807\u7B7E\uFF09\uFF0C\u6392\u9664 C(#python) \u4E0E\u4E0D\u5B58\u5728\u7B14\u8BB0\uFF08\xA7105/15\uFF09"
  );
  const exactOnly = filterSavedCardObjects(CARDS, { mode: "tag", tag: "game", tagMatchMode: "exact" }, tagsOf).map((c) => c.id);
  test("P22-TAG-03b", exactOnly.length === 1 && exactOnly[0] === "ca", "exact\uFF1A#game \u53EA\u542B A\uFF1BB(#game/design)/D \u6392\u9664");
  const agg = aggregateNoteTags(NOTES);
  const countsDesc = agg.every((t, i) => i === 0 || agg[i - 1].count >= t.count);
  test(
    "P22-TAG-06",
    agg.find((t) => t.tag === "game")?.count === 1 && agg.length === 6 && countsDesc,
    "\u805A\u5408\u8BA1\u6570\u6B63\u786E\uFF08#game=1\uFF1Bcount DESC \u6392\u5E8F\uFF0C\xA7106/13\uFF09"
  );
  test(
    "P22-TAG-07",
    filterTagOptions(aggregateNoteTags(NOTES), "\u6E38\u620F").length === 0 && filterTagOptions(aggregateNoteTags(NOTES), "game").length >= 3,
    "Tag \u641C\u7D22\uFF08\u4E2D/\u82F1\uFF09\u672C\u5730\u8FC7\u6EE4\uFF08\xA7107\uFF09"
  );
  const f1 = savedCardScopeFingerprint({ mode: "tag", tag: "game" });
  const f2 = savedCardScopeFingerprint({ mode: "tag", tag: "game", tagMatchMode: "exact" });
  const f3 = savedCardScopeFingerprint({ mode: "tag", tag: "python" });
  test(
    "P22-TAG-08",
    f1 !== f2 && f1 !== f3 && savedCardScopeFingerprint({ mode: "tag", tag: "#game" }) === f1,
    "tag/\u5B50\u6807\u7B7E\u6A21\u5F0F\u53D8\u5316 \u2192 scope \u6307\u7EB9\u53D8\u5316\uFF08\u9ED8\u8BA4 include-children\uFF0C\xA720/21\uFF09"
  );
  test(
    "P22-TAG-08b",
    normalizeTag("#\u6E38\u620F ") === "\u6E38\u620F" && tagMatchModeOf({ mode: "tag", tag: "x" }) === "include-children",
    "normalizeTag \u4E0E\u9ED8\u8BA4 include-children"
  );
  test("P22-TAG-08c", savedCardScopeText({ mode: "tag", tag: "#\u6E38\u620F" }) === "#\u6E38\u620F", "\u8303\u56F4\u663E\u793A #\u6E38\u620F\uFF08\xA717/18\uFF09");
}
{
  const exams = [
    { id: "exA", sourcePath: "A.md", sourceVersion: "v1", title: "A \u6574\u4F53\u8003\u5BDF", mode: "holistic", questionCount: 2, answerMode: "source_only", questions: [
      { id: "a1", type: "recall", question: "A \u9898 1", referenceAnswer: "r", sourcePath: "A.md" },
      { id: "a2", type: "recall", question: "A \u9898 2", referenceAnswer: "r", sourcePath: "A.md" }
    ], examVersion: 1, createdAt: NOW, updatedAt: NOW },
    { id: "exB", sourcePath: "C.md", sourceVersion: "v1", title: "C python", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [
      { id: "c1", type: "recall", question: "C \u9898", referenceAnswer: "r", sourcePath: "C.md" }
    ], examVersion: 1, createdAt: NOW, updatedAt: NOW }
  ];
  const matchedSources = NOTES.filter((n) => sourceNoteHasTag(n.tags, "game", "include-children")).map((n) => n.path);
  const visibleExams = exams.filter((e) => matchedSources.includes(e.sourcePath)).map((e) => e.id);
  test("P22-TAG-09", visibleExams.includes("exA"), "Tag #game \u80FD\u770B\u5230 A \u7684\u8003\u8BD5\uFF08\xA7102\uFF09");
  test("P22-TAG-10", !visibleExams.includes("exB"), "Tag #game \u4E0D\u80FD\u770B\u5230 #python \u6765\u6E90 C \u7684\u8003\u8BD5\uFF08\xA7103/10\uFF09");
  test(
    "P22-TAG-13",
    visibleExams.every((id) => exams.some((e) => e.id === id)) && matchedSources.includes("A.md"),
    "Exam \u5220\u9664 graceful\uFF1A\u6765\u6E90\u89E3\u6790\u72EC\u7ACB\u4E8E\u8003\u8BD5\u5B58\u5728\uFF08\xA713\uFF1BPreview \u53EA\u5217\u73B0\u5B58\u8003\u8BD5\uFF09"
  );
  test("P22-TAG-12", matchedSources.length === 3, "Tag \u6E90\u89E3\u6790\u53EA\u8D70 NoteIndex\uFF080 AI \u6570\u636E\u5C42\uFF09");
}
{
  const mc = card("mc", "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", {
    question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F",
    answer: "\u6A21\u5757\u8FB9\u754C\u53EF\u4EE5\u964D\u4F4E\u8026\u5408\u3002",
    explanation: "\u9694\u79BB\u53D8\u5316",
    concept: "\u6A21\u5757\u5316",
    questionType: "multiple_choice"
  });
  const pool = [
    mc,
    card("s2", "02 \u8D44\u6599/\u8C03\u7814.md", { question: "Python \u5E76\u53D1", answer: "GIL\u2026", concept: "\u5E76\u53D1" }),
    card("s3", "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md", { question: "\u6E38\u620F\u5FAA\u73AF", answer: "tick \u56FA\u5B9A\u6B65\u957F" })
  ];
  const meta = (c) => ({
    examTitle: c.id === "mc" ? "\u6A21\u5757\u5316\u6574\u4F53\u8003\u5BDF" : void 0,
    sourceBasename: c.sourcePath.split("/").pop()?.replace(/\.md$/, "") ?? ""
  });
  test("P22-SEARCH-01", savedCardMatchesQuery(savedCardHaystack(mc, meta(mc).examTitle, meta(mc).sourceBasename), "\u6A21\u5757\u8FB9\u754C") === true, "\u9898\u5E72\u4E2D\u6587 substring\uFF08\xA736/101\uFF09");
  test("P22-SEARCH-02", savedCardMatchesQuery(savedCardHaystack(mc, meta(mc).examTitle, meta(mc).sourceBasename), "\u964D\u4F4E\u8026\u5408") === true, "\u7B54\u6848\u5173\u952E\u8BCD\u547D\u4E2D\uFF08\xA7102\uFF09");
  test("P22-SEARCH-03", filterSavedCardsByQuery(pool, "\u6E38\u620F\u6846\u67B6", meta).map((c) => c.id).includes("mc"), "source basename \u547D\u4E2D\uFF08\xA7103\uFF09");
  test("P22-SEARCH-04", filterSavedCardsByQuery(pool, "\u6A21\u5757\u5316\u6574\u4F53\u8003\u5BDF", meta).map((c) => c.id).includes("mc"), "exam title \u547D\u4E2D\uFF08\xA7104\uFF09");
  test("P22-SEARCH-05", filterSavedCardsByQuery(pool, "\u6A21\u5757\u5316", meta).map((c) => c.id).includes("mc") && filterSavedCardsByQuery(pool, "Python", meta).map((c) => c.id).includes("s2"), "concept / \u82F1\u6587 token \u547D\u4E2D\uFF08\xA7105\uFF09");
  const tagScope = { mode: "tag", tag: "\u6E38\u620F" };
  const tagNotes = { "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md": ["\u6E38\u620F"], "02 \u8D44\u6599/\u8C03\u7814.md": ["\u8D44\u6599"], "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md": ["\u6E38\u620F"] };
  const scoped = filterSavedCardObjects(pool, tagScope, (p) => tagNotes[p] ?? []);
  const intersect = filterSavedCardsByQuery(scoped, "Python", meta);
  test(
    "P22-SEARCH-06",
    scoped.length === 2 && intersect.length === 0,
    "Scope #\u6E38\u620F \u5185\u641C\u7D22 Python \u2192 \u7A7A\uFF08\u4E0D\u4F1A\u6F0F\u5230 scope \u5916\uFF0C\xA7106/73\uFF09"
  );
  test("P22-SEARCH-07", filterSavedCardsByQuery(pool, "", meta).length === pool.length, "\u6E05\u9664\u641C\u7D22\u6062\u590D\u5B8C\u6574\u5217\u8868\uFF08\xA7107\uFF09");
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const searchSrc = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "savedCardSearch.ts"), "utf8"));
  test("P22-SEARCH-08", !/\bAI\b|prompt|apiKey|https?:/.test(searchSrc), "Search \u6A21\u5757 0 AI\uFF08\xA7108\uFF09");
}
{
  const mc = card("mc", "A.md", { question: "\u65E7\u9898\u5E72", answer: "\u65E7\u7B54\u6848", explanation: "\u65E7\u8BF4\u660E", concept: "\u65E7\u6982\u5FF5", questionType: "multiple_choice", options: ["\u65E71", "\u65E72", "\u65E73", "\u65E74"], correctAnswer: "A" });
  const draft = editDraftFromCard(mc);
  draft.question = "\u65B0\u9898\u5E72\uFF1F";
  draft.answer = "\u65B0\u7B54\u6848";
  draft.explanation = "\u65B0\u8BF4\u660E";
  draft.concept = "\u6A21\u5757\u5316";
  draft.options = ["\u65B0A", "\u65B0B", "\u65B0C", "\u65B0D"];
  draft.correctAnswer = "C";
  const edited = applySavedCardEdit(mc, draft);
  test("P22-EDIT-01", edited.question === "\u65B0\u9898\u5E72\uFF1F", "\u7F16\u8F91\u9898\u5E72\u751F\u6548\uFF08\xA7101\uFF09");
  test("P22-EDIT-02", edited.answer === "\u65B0\u7B54\u6848", "\u7F16\u8F91\u7B54\u6848\u751F\u6548\uFF08\xA7102\uFF09");
  test("P22-EDIT-03", edited.explanation === "\u65B0\u8BF4\u660E", "\u7F16\u8F91\u8BF4\u660E\u751F\u6548\uFF08\xA7103\uFF09");
  test("P22-EDIT-04", edited.concept === "\u6A21\u5757\u5316", "\u7F16\u8F91 concept \u751F\u6548\uFF08\xA7104\uFF09");
  test("P22-EDIT-05", edited.options?.join("|") === "\u65B0A|\u65B0B|\u65B0C|\u65B0D", "\u7F16\u8F91 MC options\uFF08\xA7105\uFF09");
  test("P22-EDIT-06", edited.correctAnswer === "C", "\u7F16\u8F91 correctAnswer\uFF08\xA7106\uFF09");
  test(
    "P22-EDIT-07",
    edited.sourcePath === "A.md" && edited.examId === void 0 && edited.id === "mc" && edited.createdAt === NOW,
    "\u7F16\u8F91\u4E0D\u6539 source/exam/cardId/createdAt\uFF08\xA749~52/96\uFF09"
  );
  const parsed = parseCardMarkdown(cardMarkdown(edited));
  test(
    "P22-PERSIST-02",
    parsed.card?.question === "\u65B0\u9898\u5E72\uFF1F" && parsed.card?.options?.[0] === "\u65B0A" && parsed.card?.correctAnswer === "C",
    "\u7F16\u8F91\u540E Markdown roundtrip \u6B63\u786E\uFF08\xA7105/57\uFF09"
  );
  const badEmpty = validateSavedCardEdit({ ...editDraftFromCard(mc), question: "" }, "multiple_choice");
  const badOpts = validateSavedCardEdit({ ...editDraftFromCard(mc), options: ["\u53EA\u67091\u4E2A"] }, "multiple_choice");
  const badCorrect = validateSavedCardEdit({ ...editDraftFromCard(mc), options: ["a", "b"], correctAnswer: "C" }, "multiple_choice");
  test("P22-EDIT-11", !badEmpty.ok && badEmpty.errors.some((e) => e.includes("\u9898\u5E72")), "\u7A7A\u9898\u5E72 reject\uFF08\xA7111\uFF09");
  test("P22-EDIT-12", !badOpts.ok, "MC <2 \u9009\u9879 reject\uFF08\xA7112\uFF09");
  test("P22-EDIT-13", !badCorrect.ok, "correctAnswer \u4E0D\u5728\u9009\u9879 reject\uFF08\xA7113\uFF09");
  test(
    "P22-EDIT-12b",
    validateSavedCardEdit({ ...editDraftFromCard({ ...mc, questionType: "true_false", correctAnswer: "true" }), correctAnswer: "\u4E5F\u8BB8\u662F" }, "true_false").ok === false,
    "\u5224\u65AD\u9898\u5FC5\u987B true/false"
  );
  const tf = validateSavedCardEdit({ ...editDraftFromCard({ ...mc, questionType: "true_false", options: void 0, correctAnswer: "true" }), options: [], correctAnswer: "false" }, "true_false");
  test("P22-EDIT-48", tf.ok === true, "\u5224\u65AD\u9898 true/false \u5408\u6CD5\uFF08\xA748\uFF09");
  const untouched = JSON.stringify(mc);
  void applySavedCardEdit(mc, draft);
  test("P22-EDIT-14", JSON.stringify(mc) === untouched, "apply \u8FD4\u56DE\u65B0\u5BF9\u8C61\uFF0C\u539F\u5361\u4E0D\u53D8\uFF08Cancel \u7B49\u4EF7\u4E0D\u5199\u5165\uFF0C\xA7114\uFF09");
  test("P22-EDIT-09", edited.examId === void 0 && edited.sourcePath === mc.sourcePath, "\u7F16\u8F91\u4E0D\u5F71\u54CD Exam/Source \u5F15\u7528\uFF08\xA7107/108\uFF09");
  test("P22-EDIT-10", (mc.reviewCount ?? 0) === 0, "\u7F16\u8F91\u4E0D\u89E6\u78B0 review history \u5B57\u6BB5\uFF08\xA7110\uFF09");
  test("P22-EDIT-13b", letterIndex("C") === 2 && parseTagsText("#ai, \u6E38\u620F \uFF0C\u5B66\u4E60")[0] === "ai", "\u8F85\u52A9\u51FD\u6570\uFF08letterIndex/\u6807\u7B7E\u89E3\u6790\uFF09");
}
{
  const dir = mkdir(mkdtemp(path.join(os.tmpdir(), "kg-p22-")));
  const cards = new ReviewCardStore(dir);
  cards.load();
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  const cr = new CardReviewStore(dir);
  cr.load();
  const exams = new ExamStore(dir);
  exams.load();
  const src = "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md";
  exams.add({ id: "e1", sourcePath: src, sourceVersion: "v1", title: "\u6765\u6E90\u8003\u8BD5", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW });
  const c0 = card("edit1", src, { question: "\u539F\u9898\u5E72", questionType: "multiple_choice", options: ["a", "b", "c", "d"], correctAnswer: "A" });
  cards.add(c0);
  const st0 = {
    cardId: "edit1",
    fsrsState: { due: NOW + 5 * 864e5, stability: 12, difficulty: 5, reps: 4, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 10 * 864e5 },
    lastRating: "good",
    reviewCount: 4,
    lastReviewedAt: NOW - 10 * 864e5,
    masteryPercent: 80,
    createdAt: NOW - 90 * 864e5,
    updatedAt: NOW - 10 * 864e5
  };
  spaced.scCommitReview("edit1", st0, { timestamp: NOW - 10 * 864e5, rating: "good", previousDue: null, nextDue: NOW + 5 * 864e5, intervalDays: 15, stability: 12, difficulty: 5, retrievability: 0.9 });
  cr.add({ cardId: "edit1", reviewedAt: NOW - 10 * 864e5, rating: "good" });
  const dueBefore = spaced.scGet("edit1")?.fsrsState.due;
  const edited = applySavedCardEdit(c0, { question: "\u65B0\u9898\u5E72", answer: "\u65B0\u7B54\u6848", explanation: "", concept: "\u6A21\u5757", tagsText: "#\u6E38\u620F", options: ["\u65B0\u72481", "\u65B0\u72482", "\u65B0\u72483", "\u65B0\u72484"], correctAnswer: "B" });
  cards.update("edit1", { question: edited.question, answer: edited.answer, explanation: edited.explanation, concept: edited.concept, tags: edited.tags, options: edited.options, correctAnswer: edited.correctAnswer, editedAt: NOW });
  const cards2 = new ReviewCardStore(dir);
  cards2.load();
  const spaced2 = new SpacedReviewStore(dir);
  spaced2.load();
  test(
    "P22-PERSIST-01",
    cards2.get("edit1")?.question === "\u65B0\u9898\u5E72" && cards2.get("edit1")?.options?.join("|") === "\u65B0\u72481|\u65B0\u72482|\u65B0\u72483|\u65B0\u72484",
    "\u7F16\u8F91\u540E Store \u6301\u4E45\u5316\uFF08PERSIST-01/03\uFF09"
  );
  test("P22-FSRS-01", spaced2.scGet("edit1")?.fsrsState.due === dueBefore, "\u666E\u901A\u7F16\u8F91\uFF1Adue \u4E0D\u53D8\uFF08\xA7101\uFF09");
  test("P22-FSRS-02", spaced2.scGet("edit1") !== void 0 && spaced2.scGet("edit1")?.fsrsState.stability === 12, "\u666E\u901A\u7F16\u8F91\uFF1Astability/retrievability \u72B6\u6001\u4E0D\u53D8\uFF08\xA7102\uFF09");
  test("P22-FSRS-03", spaced2.scGet("edit1")?.masteryPercent === 80 && spaced2.scGet("edit1")?.reviewCount === 4, "\u666E\u901A\u7F16\u8F91\uFF1Amastery/reviewCount \u4E0D\u53D8\uFF08\xA7103\uFF09");
  test("P22-EDIT-10b", cr.byCard("edit1").length === 1, "\u666E\u901A\u7F16\u8F91\uFF1ACardReviewRecord \u4FDD\u7559\uFF08\xA7110/66\uFF09");
  test("P22-EDIT-07b", exams.get("e1") !== void 0 && exams.findBySource(src).length === 1, "\u666E\u901A\u7F16\u8F91\uFF1AExam \u4FDD\u7559\uFF08\xA7107\uFF09");
  spaced2.scRemoveCard("edit1");
  cr.removeByCard("edit1");
  const spaced3 = new SpacedReviewStore(dir);
  spaced3.load();
  const cr3 = new CardReviewStore(dir);
  cr3.load();
  test("P22-FSRS-04", spaced3.scGet("edit1") === void 0, "\u91CD\u7F6E\uFF1AFSRS state \u5220\u9664 \u2192 \u4E0B\u6B21 createEmptyCard\uFF08\xA7104\uFF09");
  test(
    "P22-FSRS-05",
    spaced3.scLogsAll().filter((l) => l.cardId === "edit1").length === 0 && cr3.byCard("edit1").length === 0,
    "\u91CD\u7F6E\uFF1ASavedCardReviewLogs \u4E0E CardReviewRecord \u6E05\u9664\uFF08\xA7105/65\uFF09"
  );
  test("P22-FSRS-04b", cards2.get("edit1")?.question === "\u65B0\u9898\u5E72", "\u91CD\u7F6E\u4E0D\u5F71\u54CD\u7F16\u8F91\u5185\u5BB9\uFF08\u53EA\u6E05\u590D\u4E60\u8FDB\u5EA6\uFF09");
  const examsBeforeDelete = exams.all().length;
  cards2.remove("edit1");
  test("P22-DELETE-01", cards2.get("edit1") === void 0, "\u7F16\u8F91\u540E\u5220\u9664\u6210\u529F\uFF08\xA7101\uFF09");
  test("P22-DELETE-03", exams.all().length === examsBeforeDelete, "\u5220\u9664\u540E Exam \u4FDD\u7559\uFF08\xA7103\uFF09");
  test("P22-DELETE-04", cards2.all().length === 0 && spaced3.scGet("edit1") === void 0, "\u5220\u9664\u540E\u5361\u4E0E FSRS \u90FD\u4E0D\u5B58\u5728\uFF08\xA7104/2\uFF09");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const f of ["savedCardSearch.ts", "savedCardEditor.ts"]) {
    const src = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"));
    test(
      "P22-AI-" + (f.includes("Search") ? "03" : "04"),
      !/\bAI\b|prompt|apiKey|https?:|generate/.test(src) && !/activity|markReviewed/.test(src),
      f + " 0 AI\uFF08\u641C\u7D22=\xA7108\uFF1B\u7F16\u8F91=\xA7109\uFF09\u4E14\u4E0D\u52A8 Activity"
    );
  }
  const mainSrc = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8"));
  const updStart = mainSrc.indexOf("async updateSavedReviewCard(");
  const updBody = updStart >= 0 ? mainSrc.slice(updStart, updStart + 7e3) : "";
  test("P22-EDIT-15", updBody.includes("\u8BE5\u590D\u4E60\u5361\u5DF2\u4E0D\u5B58\u5728"), "\u5DF2\u5220\u9664\u5361\u4FDD\u5B58 \u2192 reject \u6587\u6848\uFF08\xA7115/72\uFF09");
  test("P22-PERF-04", updBody.includes("updateSavedCardMarkdown(") && /cards\.update\(/.test(updBody), "\u7F16\u8F91\u53EA\u66F4\u65B0\u4E00\u5F20\u5361 Store+Markdown\uFF08\xA786/104\uFF09");
  test("P22-EDIT-07c", !/examStore\.update|examStore\.remove|app\.vault\.modify\(.*sourcePath/.test(updBody), "\u7F16\u8F91\u8DEF\u5F84\u4E0D\u4FEE\u6539 Exam/Source Note\uFF08\xA7107/108/59/60\uFF09");
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
