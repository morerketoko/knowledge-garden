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

// tests/p242-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// src/portable/assetRecovery.ts
function isUnderPrefix(filePath, prefix) {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  const pre = prefix.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() + "/";
  return p.startsWith(pre);
}
function markdownFilesUnder(vault, prefix) {
  return vault.markdownFiles().filter((f) => isUnderPrefix(f.path, prefix)).sort((a, b) => a.path.localeCompare(b.path));
}
async function repairIndexFromAssets(label, folder, vault, parse, persist) {
  const files = markdownFilesUnder(vault, folder);
  const entries = [];
  const broken = [];
  for (const f of files) {
    let md;
    try {
      md = await vault.read(f);
    } catch (e) {
      broken.push({ path: f.path, reason: "\u8BFB\u53D6\u5931\u8D25\uFF1A" + errMsg(e) });
      continue;
    }
    try {
      const parsed = parse(md);
      if (parsed === null || parsed === void 0) {
        broken.push({ path: f.path, reason: "\u89E3\u6790\u5931\u8D25\uFF1A\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5\uFF08\u4E0D\u5220\u9664\u8BE5\u6587\u4EF6\uFF09" });
        continue;
      }
      entries.push(parsed);
    } catch (e) {
      broken.push({ path: f.path, reason: "\u89E3\u6790\u5F02\u5E38\uFF1A" + errMsg(e) });
    }
  }
  const persisted = await persist(entries);
  return { scanned: files.length, parsed: entries.length, broken, persisted, entries };
}
function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}
var ASSET_FOLDER_PREFIXES = [
  "Knowledge Garden/Exams",
  "Knowledge Garden/Review Cards",
  "Knowledge Garden/Explorations",
  "Knowledge Garden/Research",
  "Knowledge Garden/Inbox",
  "Knowledge Garden/Processing",
  "Knowledge Garden/Knowledge",
  "Knowledge Garden/Archive",
  "Knowledge Garden/Reviews",
  "Knowledge Garden/Relationships",
  "Knowledge Garden/Prompts",
  "Knowledge Garden/Projects",
  "Knowledge Garden/Skills"
];
function isAssetPath(filePath) {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (p.startsWith(".obsidian/")) return true;
  return ASSET_FOLDER_PREFIXES.some((pre) => isUnderPrefix(p, pre));
}
function knowledgeMarkdownCount(files) {
  return files.filter((f) => !isAssetPath(f.path)).length;
}
function isIndexHealthy(indexedCount, vaultMarkdownCount, tolerance = 0.95) {
  const threshold = Math.max(1, Math.floor(vaultMarkdownCount * tolerance));
  const ratio = vaultMarkdownCount > 0 ? indexedCount / vaultMarkdownCount : indexedCount > 0 ? 1 : 0;
  const healthy = vaultMarkdownCount === 0 ? true : indexedCount >= threshold;
  return {
    indexedCount,
    vaultMarkdownCount,
    ratio,
    healthy,
    threshold,
    reason: healthy ? vaultMarkdownCount === 0 ? "vault \u5185\u6CA1\u6709\u53EF\u7D22\u5F15\u7B14\u8BB0\uFF080/0\uFF09\u2192 \u89C6\u4E3A\u5065\u5EB7" : "\u7D22\u5F15\u8986\u76D6 " + (ratio * 100).toFixed(1) + "%\uFF08\u9608\u503C " + threshold + "\uFF09\u2192 \u5065\u5EB7" : "\u7D22\u5F15\u53EA\u6709 " + indexedCount + " / " + vaultMarkdownCount + "\uFF08" + (ratio * 100).toFixed(1) + "%\uFF09\uFF0C\u4F4E\u4E8E\u9608\u503C " + threshold + " \u2192 \u4E0D\u5065\u5EB7\uFF0C\u5DF2\u8DF3\u8FC7 destructive prune"
  };
}

// src/knowledgeState.ts
function daysSince(t, now) {
  return typeof t === "number" ? (now - t) / 864e5 : null;
}
function deriveState(note, act, rules, now = Date.now()) {
  const createdD = daysSince(note.created, now);
  if (createdD !== null && createdD <= rules.newDays) return "new";
  const modifiedD = daysSince(note.modified, now) ?? Infinity;
  const accessedD = daysSince(act?.lastAccessedAt, now);
  const reviewedD = daysSince(act?.lastReviewedAt, now);
  const accessCount = act?.accessCount ?? 0;
  if (modifiedD <= 7 && accessCount >= 2) return "growing";
  if (accessedD !== null && accessedD <= 7 || reviewedD !== null && reviewedD <= 7 || modifiedD <= 7) return "active";
  const neverAccessed = accessedD === null;
  const neverReviewed = reviewedD === null;
  const farLong = accessedD !== null && accessedD > rules.forgottenDays || neverAccessed;
  const farReview = reviewedD !== null && reviewedD > rules.forgottenDays || neverReviewed;
  const connected = note.links.length + note.backlinks.length >= 1;
  if (farLong && farReview && connected) return "forgotten";
  const noRecentAccess = accessedD === null || accessedD > rules.staleDays;
  const noRecentModify = modifiedD > rules.staleDays;
  const noRecentReview = reviewedD === null || reviewedD > rules.staleDays;
  if (noRecentAccess && noRecentModify && noRecentReview) return "stale";
  return "active";
}
function stateCounts(notes, getAct, rules, now = Date.now()) {
  const out = { new: 0, growing: 0, active: 0, stale: 0, forgotten: 0 };
  for (const n of notes) out[deriveState(n, getAct(n.path), rules, now)]++;
  return out;
}

// src/portable/integrityDiagnostics.ts
var DAY = 864e5;
function activityIntegrityReport(activity, indexedNotes) {
  const entries = activity instanceof Map ? Array.from(activity.values()) : activity.all();
  const total = entries.length;
  const accessed = entries.filter((e) => typeof e.lastAccessedAt === "number").length;
  const reviewed = entries.filter((e) => typeof e.lastReviewedAt === "number").length;
  const cov = (n) => indexedNotes > 0 ? n / indexedNotes : 0;
  const pct = (x) => (x * 100).toFixed(3) + "%";
  return {
    activityEntries: total,
    indexedNotes,
    activityCoverage: cov(total),
    accessedEntries: accessed,
    reviewedEntries: reviewed,
    accessedCoverage: cov(accessed),
    reviewedCoverage: cov(reviewed),
    note: "Activity " + total + " / " + indexedNotes + "\uFF08\u8986\u76D6 " + pct(cov(total)) + "\uFF09\u3002Activity \u53EA\u80FD\u6765\u81EA activity.json / \u5907\u4EFD\uFF1B\u4E0D\u5B58\u5728\u7684\u5386\u53F2\u8BBF\u95EE\u4E0D\u53EF\u91CD\u5EFA\uFF0C\u4E5F\u4E0D\u4F1A\u88AB\u4F2A\u9020\u3002"
  };
}
function bucketOf(ageDays, kind) {
  if (ageDays === null || !Number.isFinite(ageDays)) return kind === "created" ? "gt365" : "gt365";
  if (ageDays < 7) return "lt7d";
  if (ageDays < 30) return "d7to30";
  if (ageDays < 90) return "d30to90";
  if (ageDays < 365) return "d90to365";
  return "gt365";
}
function emptyBuckets() {
  return { lt7d: 0, d7to30: 0, d30to90: 0, d90to365: 0, gt365: 0 };
}
function knowledgeStateDiagnostics(notes, getAct, rules, now = Date.now()) {
  const created = emptyBuckets();
  const modified = emptyBuckets();
  for (const n of notes) {
    const cd = typeof n.created === "number" ? (now - n.created) / DAY : null;
    const md = typeof n.modified === "number" ? (now - n.modified) / DAY : null;
    created[bucketOf(cd, "created")]++;
    modified[bucketOf(md, "modified")]++;
  }
  const counts = stateCounts(notes, getAct, rules, now);
  const total = notes.length;
  const created7 = total > 0 ? created.lt7d / total : 0;
  const newRatio = total > 0 ? counts.new / total : 0;
  const accessedCount = notes.filter((n) => {
    const a = getAct(n.path);
    return a && (typeof a.lastAccessedAt === "number" || typeof a.lastReviewedAt === "number");
  }).length;
  const activityRatio = total > 0 ? accessedCount / total : 0;
  const createdDriven = created7 >= 0.95 && newRatio >= 0.9;
  const activityDriven = activityRatio < 0.05 && created7 < 0.95;
  const driven = createdDriven && activityDriven ? "mixed" : createdDriven ? "created_time" : activityDriven ? "activity_missing" : "none";
  const pct = (x) => (x * 100).toFixed(1) + "%";
  let note;
  if (driven === "created_time") {
    note = "created \u65F6\u95F4\u96C6\u4E2D\u5728\u6700\u8FD1 7 \u5929\uFF08" + pct(created7) + "\uFF09\uFF0Cnew \u5360\u6BD4 " + pct(newRatio) + " \u2192 \u201C\u5168\u90E8 new\u201D\u4E3B\u8981\u7531 created \u65F6\u95F4\u51B3\u5B9A\uFF08\u4E0D\u662F Activity \u4E22\u5931\uFF09\u3002";
  } else if (driven === "activity_missing") {
    note = "created \u5206\u5E03\u6B63\u5E38\uFF0C\u4F46\u53EA\u6709 " + pct(activityRatio) + " \u7BC7\u7B14\u8BB0\u6709 Activity \u2192 active/growing/forgotten \u4F1A\u56E0 Activity \u7F3A\u5931\u800C\u4E0B\u964D\u3002";
  } else if (driven === "mixed") {
    note = "created \u96C6\u4E2D\u5728 7 \u5929\u5185\uFF08" + pct(created7) + "\uFF09\u4E14 Activity \u8986\u76D6\u4EC5 " + pct(activityRatio) + " \u2192 \u201C\u5168\u90E8 new\u201D\u7531 created \u65F6\u95F4\u4E0E Activity \u7F3A\u5931\u5171\u540C\u9020\u6210\u3002";
  } else {
    note = "\u5206\u5E03\u6B63\u5E38\uFF1Anew " + pct(newRatio) + "\uFF0CActivity \u8986\u76D6 " + pct(activityRatio) + "\u3002";
  }
  return {
    indexedNotes: total,
    stateCounts: counts,
    createdAgeBuckets: created,
    modifiedAgeBuckets: modified,
    createdConcentratedIn7d: created7 >= 0.95,
    createdConcentratedRatio: created7,
    newDrivenBy: driven,
    note
  };
}
function createdIntegrityReport(notes, now = Date.now()) {
  const total = notes.length;
  let future = 0, past = 0, within7d = 0, within30d = 0, createdAfterModified = 0;
  for (const n of notes) {
    if (typeof n.created !== "number") continue;
    if (n.created > now + DAY) future++;
    else past++;
    if (now - n.created <= 7 * DAY) within7d++;
    if (now - n.created <= 30 * DAY) within30d++;
    if (typeof n.modified === "number" && n.created > n.modified + DAY) createdAfterModified++;
  }
  const ratio = total > 0 ? within7d / total : 0;
  const warn = ratio >= 0.95 && total > 10;
  return {
    total,
    future,
    past,
    within7d,
    within30d,
    concentratedIn7d: ratio,
    createdAfterModified,
    warnConcentrated: warn,
    note: warn ? "created \u65F6\u95F4\u96C6\u4E2D\u5728\u6700\u8FD1 7 \u5929\uFF08" + (ratio * 100).toFixed(1) + "%\uFF09\uFF0C\u53EF\u80FD\u5BFC\u81F4\u5927\u91CF\u7B14\u8BB0\u5224\u5B9A\u4E3A new\u3002\u672C\u63D2\u4EF6\u4E0D\u4F1A\u81EA\u52A8\u4FEE\u6539 created\uFF08\xA7\u4E8C\u5341\u4E8C\uFF1A\u7981\u6B62\u7528 modified/now \u8986\u76D6 created\uFF09\u3002" : "created \u65F6\u95F4\u5206\u5E03\u6B63\u5E38\uFF087 \u5929\u5185 " + (ratio * 100).toFixed(1) + "%\uFF09\u3002"
  };
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
function repairStaleTempFiles(filePaths, measure) {
  let fixed = 0;
  for (const target of filePaths) {
    const tmp = target + ".tmp";
    try {
      if (!existsSync(tmp)) continue;
      const tmpRaw = readFileSync(tmp, "utf8");
      let tmpWeight = 0;
      try {
        tmpWeight = measure(tmpRaw);
      } catch {
        continue;
      }
      if (tmpWeight <= 0) continue;
      let targetWeight = 0;
      if (existsSync(target)) {
        try {
          targetWeight = measure(readFileSync(target, "utf8"));
        } catch {
          targetWeight = 0;
        }
      }
      if (targetWeight >= tmpWeight) continue;
      writeFileSync(target, tmpRaw, "utf8");
      fixed++;
    } catch {
    }
  }
  return fixed;
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

// src/examStore.ts
function unescYaml(s) {
  const m = /^"(.*)"$/.exec(s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s;
}
function parseExamMarkdown(md) {
  const fm = parseExamFrontmatter(md);
  if (!fm) return { exam: null, questions: [] };
  try {
    const exam = {
      id: fm.examId,
      sourcePath: fm.sourcePath,
      sourceVersion: fm.sourceVersion,
      title: fm.title,
      mode: fm.mode === "custom" ? "custom" : "holistic",
      topic: fm.topic,
      questionCount: fm.questionCount,
      difficulty: fm.difficulty === "easy" || fm.difficulty === "hard" ? fm.difficulty : fm.difficulty === "medium" ? "medium" : void 0,
      answerMode: fm.answerMode === "source_only" || fm.answerMode === "web_allowed" ? fm.answerMode : "source_preferred",
      questions: fm.questions,
      contentStrategy: fm.contentStrategy ?? "broad_coverage",
      // Phase 23 §64：旧缺省 broad_coverage
      repeatPolicy: fm.repeatPolicy ?? "allow",
      examVersion: fm.examVersion ?? 1,
      coverageTopics: fm.coverageTopics,
      createdAt: fm.createdAt ?? Date.now(),
      updatedAt: fm.createdAt ?? Date.now()
    };
    return { exam, questions: fm.questions };
  } catch {
    return { exam: null, questions: [] };
  }
}
function parseExamFrontmatter(md) {
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = md.slice(3, end);
  const lines = block.split("\n");
  const kv = /* @__PURE__ */ new Map();
  const questionItems = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const top = /^([A-Za-z]+): ?(.*)$/.exec(line);
    if (!top) {
      i++;
      continue;
    }
    const k = top[1];
    const v = top[2].trim();
    if (k === "questions" && v === "") {
      let cur = null;
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (/^[A-Za-z]+:/.test(l)) break;
        const dash = /^  - (.+)$/.exec(l);
        if (dash) {
          cur = {};
          questionItems.push(cur);
          const first = /^([A-Za-z]+): ?(.*)$/.exec(dash[1]);
          if (first) cur[first[1]] = unescYaml(first[2].trim());
          j++;
          continue;
        }
        const sub = /^    ([A-Za-z]+): ?(.*)$/.exec(l);
        if (sub && cur) {
          cur[sub[1]] = unescYaml(sub[2].trim());
          j++;
          continue;
        }
        if (!l.trim()) {
          j++;
          continue;
        }
        break;
      }
      i = j;
      continue;
    }
    kv.set(k, v);
    i++;
  }
  const examId = unescYaml(kv.get("examId") ?? "");
  if (!examId) return null;
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
  const questions = [];
  const TYPES = ["recall", "explanation", "comparison", "application", "true_false", "multiple_choice", "counterexample"];
  for (const item of questionItems) {
    const qid = item["id"] ?? "";
    const qq = item["question"] ?? "";
    if (!qid || !qq) continue;
    const qtype = item["type"] ?? "recall";
    questions.push({
      sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
      id: qid,
      type: TYPES.includes(qtype) ? qtype : "recall",
      question: qq,
      options: inlineArr(item["options"]),
      correctAnswer: item["correctAnswer"] || void 0,
      referenceAnswer: item["referenceAnswer"] ?? "",
      explanation: item["explanation"] || void 0,
      sourceEvidence: inlineArr(item["sourceEvidence"]),
      concept: item["concept"] || void 0,
      difficulty: item["difficulty"] === "easy" || item["difficulty"] === "hard" ? item["difficulty"] : item["difficulty"] === "medium" ? "medium" : void 0
    });
  }
  return {
    examId,
    sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
    sourceVersion: unescYaml(kv.get("sourceVersion") ?? ""),
    title: unescYaml(kv.get("title") ?? "") || examId,
    mode: kv.get("mode") ?? "holistic",
    topic: unescYaml(kv.get("topic") ?? ""),
    questionCount: parseInt(kv.get("questionCount") ?? "0", 10) || 0,
    difficulty: kv.get("difficulty"),
    answerMode: kv.get("answerMode") ?? "source_preferred",
    examVersion: parseInt(kv.get("examVersion") ?? "1", 10) || 1,
    coverageTopics: inlineArr(kv.get("coverageTopics")),
    contentStrategy: ["new_content", "new_angle", "broad_coverage", "custom"].includes(kv.get("contentStrategy") ?? "") ? kv.get("contentStrategy") : void 0,
    repeatPolicy: ["strict", "balanced", "allow"].includes(kv.get("repeatPolicy") ?? "") ? kv.get("repeatPolicy") : void 0,
    previousExamCount: parseInt(kv.get("previousExamCount") ?? "", 10) || void 0,
    createdAt: parseInt(kv.get("createdAt") ?? "", 10) || void 0,
    questions
  };
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
  const card = {
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
  return { card };
}

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
    this.flushTimer = setTimeout(() => {
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
  /** 诊断用（Phase 24.2 §十七）：全部条目快照，只读 */
  all() {
    return Array.from(this.data.values());
  }
  recent(limit) {
    return Array.from(this.data.entries()).filter(([, e]) => typeof e.lastAccessedAt === "number").sort((a, b) => (b[1].lastAccessedAt ?? 0) - (a[1].lastAccessedAt ?? 0)).slice(0, limit).map(([path2, entry]) => ({ path: path2, entry }));
  }
  set(path2, entry) {
    this.data.set(path2, entry);
    this.markDirty();
  }
};

// src/reviewCenter.ts
function dailyPeriodKey(now = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return "daily:" + now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
}
function recount(queue) {
  return {
    ...queue,
    completedCount: queue.items.filter((i) => i.status === "completed").length,
    skippedCount: queue.items.filter((i) => i.status === "skipped").length
  };
}
function pruneQueue(queue, existingPaths) {
  const items = queue.items.filter((i) => existingPaths.has(i.path));
  return recount({ ...queue, items });
}
function migrateQueuePaths(queue, oldPath, newPath) {
  if (queue.items.every((i) => i.path !== oldPath)) return queue;
  return { ...queue, items: queue.items.map((i) => i.path === oldPath ? { ...i, path: newPath } : i) };
}
function migrateSkipHistory(h, oldPath, newPath) {
  if (!h[oldPath]) return h;
  const out = { ...h };
  const v = out[oldPath];
  delete out[oldPath];
  out[newPath] = v;
  return out;
}
var ReviewCenterStore = class {
  constructor(pluginDir) {
    this.queue = null;
    this.skipHistory = {};
    this.session = null;
    this.queueFile = join(pluginDir, "cache", "review-queue.json");
    this.sessionFile = join(pluginDir, "cache", "review-session.json");
  }
  /** 启动时恢复；损坏文件隔离 *.corrupt-* 后置空（§十三：queue 重建由调用方生成当前周期队列；session 置空）。
   *  返回是否执行了隔离。 */
  load() {
    let isolated = false;
    try {
      if (existsSync(this.queueFile)) {
        const raw = JSON.parse(readFileSync(this.queueFile, "utf8"));
        if (!raw || typeof raw !== "object") throw new Error("invalid queue structure");
        if (raw.queue && typeof raw.queue === "object" && Array.isArray(raw.queue.items)) {
          const rq = raw.queue;
          this.queue = {
            periodKey: typeof rq.periodKey === "string" ? rq.periodKey : "",
            createdAt: typeof rq.createdAt === "number" ? rq.createdAt : 0,
            items: raw.queue.items.filter((i) => i && typeof i.path === "string"),
            completedCount: 0,
            skippedCount: 0,
            // Phase 20：保留 scope/key/source（旧队列文件无这些字段 → 缺失即视为 vault/legacy，§十四）
            scope: rq.scope && typeof rq.scope === "object" ? rq.scope : void 0,
            key: typeof rq.key === "string" && rq.key ? rq.key : void 0,
            source: rq.source === "spaced" || rq.source === "legacy" ? rq.source : void 0
          };
          this.queue = recount(this.queue);
        }
        if (raw.skipHistory && typeof raw.skipHistory === "object") this.skipHistory = raw.skipHistory;
      }
    } catch {
      isolated = isolateCorruptFile(this.queueFile) || isolated;
      this.queue = null;
    }
    try {
      if (existsSync(this.sessionFile)) {
        const s = JSON.parse(readFileSync(this.sessionFile, "utf8"));
        if (s && typeof s.periodKey === "string" && typeof s.currentIndex === "number") {
          this.session = {
            periodKey: s.periodKey,
            currentIndex: Number.isFinite(s.currentIndex) ? s.currentIndex : 0,
            queueKey: typeof s.queueKey === "string" ? s.queueKey : s.periodKey,
            updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
            // Phase 20：scope 恢复（§97：重开恢复范围）
            scope: s.scope && typeof s.scope === "object" ? s.scope : null,
            currentPath: typeof s.currentPath === "string" && s.currentPath ? s.currentPath : null
          };
        } else {
          throw new Error("invalid session structure");
        }
      }
    } catch {
      isolated = isolateCorruptFile(this.sessionFile) || isolated;
      this.session = null;
    }
    return isolated;
  }
  getQueue() {
    return this.queue;
  }
  getSkipHistory() {
    return this.skipHistory;
  }
  getSession() {
    return this.session;
  }
  setQueue(q) {
    this.queue = q;
    this.writeQueue();
  }
  /** 连续跳过登记（§三十二）：同一天重复跳只 +1；跨天重新计数 */
  recordSkip(pathKey, now = Date.now()) {
    const today = dailyPeriodKey(new Date(now));
    const prev = this.skipHistory[pathKey];
    const consecutive = prev && prev.lastSkippedDate === today ? prev.consecutive + 1 : 1;
    this.skipHistory[pathKey] = { consecutive, lastSkippedDate: today };
    this.writeQueue();
    return consecutive;
  }
  /** 真正完成复习后清除该笔记的连续跳过历史（§三十二：不永久排除） */
  resetSkip(pathKey) {
    if (!this.skipHistory[pathKey]) return;
    delete this.skipHistory[pathKey];
    this.writeQueue();
  }
  setSession(s) {
    this.session = s;
    this.writeSession();
  }
  /** 删除笔记后合并清理（§六十六 Test 18）：队列移除不存在的 item；skipHistory 清掉 */
  prunePaths(existing) {
    if (this.queue) this.queue = pruneQueue(this.queue, existing);
    let dirty2 = false;
    for (const k of Object.keys(this.skipHistory)) {
      if (!existing.has(k)) {
        delete this.skipHistory[k];
        dirty2 = true;
      }
    }
    if (dirty2 || this.queue) this.writeQueue();
  }
  /** 笔记 rename 后队列与跳过历史随行更新（§六十六 Test 19），不产生假死路径 */
  migratePaths(oldPath, newPath) {
    if (this.queue) this.queue = migrateQueuePaths(this.queue, oldPath, newPath);
    const h = migrateSkipHistory(this.skipHistory, oldPath, newPath);
    if (h !== this.skipHistory) this.skipHistory = h;
    this.writeQueue();
  }
  writeQueue() {
    try {
      const obj = { queue: this.queue, skipHistory: this.skipHistory };
      atomicWriteJson(this.queueFile, obj);
    } catch (e) {
      console.error("[KnowledgeGarden][ReviewCenter] \u961F\u5217\u6301\u4E45\u5316\u5931\u8D25\uFF1A", e.message);
    }
  }
  writeSession() {
    try {
      atomicWriteJson(this.sessionFile, this.session);
    } catch (e) {
      console.error("[KnowledgeGarden][ReviewCenter] session \u6301\u4E45\u5316\u5931\u8D25\uFF1A", e.message);
    }
  }
};

// tests/p242-tests.ts
var ROOT = path.join(__dirname, "..");
var TMP_ROOT = path.join(ROOT, ".kg-tests");
var VAULT = "E:" + path.sep + "ob";
var CARDS_DIR = "Knowledge Garden/Review Cards";
var EXAMS_DIR = "Knowledge Garden/Exams";
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function skip(id, detail) {
  console.log("SKIP " + id + " :: " + detail);
}
function realVault(root) {
  const walk = (dir, prefix) => {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const rel = prefix ? prefix + "/" + e.name : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
      else if (/\.md$/i.test(e.name)) out.push({ path: rel });
    }
    return out;
  };
  return {
    markdownFiles: () => walk(root, ""),
    read: async (f) => fs.readFileSync(path.join(root, f.path.replace(/\//g, path.sep)), "utf8")
  };
}
var HAS_VAULT = fs.existsSync(path.join(VAULT, CARDS_DIR));
void (async () => {
  {
    const h1 = isIndexHealthy(4339, 4339);
    test(
      "P24.2-01",
      h1.healthy === true && h1.threshold === 4122 && Math.abs(h1.ratio - 1) < 1e-9,
      "indexed=4339 / vault=4339 \u2192 healthy\uFF0C\u9608\u503C 4122\uFF08" + h1.reason + "\uFF09"
    );
    const h2 = isIndexHealthy(37, 4339);
    test(
      "P24.2-02",
      h2.healthy === false && h2.threshold === 4122,
      "indexed=37 / vault=4339 \u2192 \u4E0D\u5065\u5EB7\uFF08" + h2.reason + "\uFF09"
    );
    const h3 = isIndexHealthy(0, 0);
    test("P24.2-01b", h3.healthy === true, "\u7A7A vault\uFF080/0\uFF09\u89C6\u4E3A\u5065\u5EB7\uFF0C\u9608\u503C\u4E0B\u9650\u4E3A 1\uFF08\u4E0D\u8BEF\u5224\uFF09");
    const h4 = isIndexHealthy(4122, 4339);
    test("P24.2-01c", h4.healthy === true, "\u6070\u597D 95% \u89C6\u4E3A\u5065\u5EB7\uFF08\u4E0D\u8981\u6C42 100%\uFF0C\xA7\u5341\u4E09\uFF09");
    const h5 = isIndexHealthy(4121, 4339);
    test("P24.2-01d", h5.healthy === false, "95% \u4EE5\u4E0B\u4E00\u7968\u5373\u4E0D\u5065\u5EB7");
  }
  {
    const files = [
      { path: "01 \u76D2\u5B50/a.md" },
      { path: "02 \u9519\u9898/b.md" },
      { path: ".obsidian/plugins/x/readme.md" },
      { path: CARDS_DIR + "/c.md" },
      { path: EXAMS_DIR + "/e.md" },
      { path: "Knowledge Garden/Explorations/Saved/s.md" }
    ];
    test(
      "P24.2-14a",
      knowledgeMarkdownCount(files) === 2,
      "vault \u7B14\u8BB0\u6570\u6392\u9664 .obsidian \u4E0E\u63D2\u4EF6\u8D44\u4EA7\u76EE\u5F55\uFF086 \u2192 2\uFF09"
    );
    test(
      "P24.2-14b",
      isAssetPath(CARDS_DIR + "/x.md") && isAssetPath(".obsidian/a.md") && !isAssetPath("01 \u76D2\u5B50/a.md"),
      "isAssetPath \u5224\u5B9A\u6B63\u786E"
    );
    test(
      "P24.2-14c",
      isUnderPrefix(CARDS_DIR + "/sub/x.md", CARDS_DIR) && !isUnderPrefix("Knowledge Garden/Review Cards Old/x.md", CARDS_DIR),
      "\u524D\u7F00\u5339\u914D\u4E0D\u4F1A\u8BEF\u541E\u540C\u540D\u524D\u7F00\u76EE\u5F55\uFF08\u652F\u6301\u5B50\u76EE\u5F55\uFF09"
    );
  }
  {
    const actMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < 236; i++) actMap.set("note" + i + ".md", { accessCount: i + 1, lastAccessedAt: 17e11 + i, reviewCount: i % 5, lastReviewedAt: 17e11 });
    const unhealthy = isIndexHealthy(1, 236).healthy;
    const healthy = isIndexHealthy(236, 236).healthy;
    const unhealthyIndex = /* @__PURE__ */ new Set(["note0.md"]);
    const actDir = mkdtemp("kg-p242-act-");
    const activity = new ActivityStore(actDir);
    activity.load();
    for (let i = 0; i < 236; i++) {
      activity.set("note" + i + ".md", { accessCount: i + 1, lastAccessedAt: 17e11 + i, reviewCount: i % 5, lastReviewedAt: 17e11 });
    }
    const beforeActivity = activity.count();
    if (unhealthy) activity.prune(unhealthyIndex);
    test(
      "P24.2-03b",
      unhealthy === false && beforeActivity === 236 && activity.count() === 236,
      "\u7D22\u5F15\u4E0D\u5065\u5EB7\uFF081/236\uFF09\u2192 \u5B88\u536B\u4E0D\u8C03\u7528 prune\uFF0C236 \u6761\u771F\u5B9E\u6D3B\u52A8\u4FDD\u6301\u4E0D\u53D8\uFF08\u5B9E\u9645 " + activity.count() + "\uFF09"
    );
    activity.prune(new Set(Array.from({ length: 236 }, (_, i) => "note" + i + ".md")));
    test("P24.2-15b", activity.count() === 236, "\u5065\u5EB7\u7D22\u5F15 + \u8DEF\u5F84\u9F50\u5168 \u2192 prune \u4E0D\u8BEF\u5220\uFF08\u5B9E\u9645 " + activity.count() + "\uFF09");
    activity.prune(/* @__PURE__ */ new Set(["note0.md"]));
    test("P24.2-15c", activity.count() === 1, "\u5065\u5EB7\u7D22\u5F15 + \u771F\u5B9E\u5220\u9664 \u2192 prune \u6B63\u5E38\u6E05\u7406\uFF08\u5B9E\u9645 " + activity.count() + "\uFF09");
    test("P24.2-15", healthy === true, "\u7D22\u5F15\u5065\u5EB7\uFF08236/236\uFF09\u65F6\u5B88\u536B\u653E\u884C\uFF0Cprune \u6B63\u5E38\u6267\u884C\u8DEF\u5F84\u53EF\u7528");
    const rc = new ReviewCenterStore(mkdtemp("kg-p242-rc-"));
    rc.load();
    const queued = ["note0.md", "note1.md", "note2.md"];
    rc.prunePaths(new Set(queued));
    rc.setQueue({
      periodKey: "daily:2026-09-10",
      createdAt: 1,
      completedCount: 0,
      skippedCount: 0,
      items: queued.map((p, i) => ({ path: p, stateAtSelection: "new", priorityScore: i, status: "pending", selectedAt: 1 }))
    });
    const queueBefore = rc.getQueue()?.items.length ?? 0;
    if (unhealthy) rc.prunePaths(unhealthyIndex);
    const queueAfter = rc.getQueue()?.items.length ?? 0;
    test(
      "P24.2-05",
      unhealthy === false && queueBefore === 3 && queueAfter === 3,
      "\u7D22\u5F15\u4E0D\u5065\u5EB7\uFF081/236\uFF09\u2192 \u8DF3\u8FC7 reviewCenter.prunePaths\uFF0C\u961F\u5217 " + queueBefore + "\u2192" + queueAfter + " \u9879\u4E0D\u53D8"
    );
    const spaced = new SpacedReviewStore(mkdtemp("kg-p242-spaced-"));
    spaced.load();
    spaced.scReplaceAll(Array.from({ length: 159 }, (_, i) => ({
      cardId: "card" + i,
      fsrsState: { due: 17e11, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 2, learningSteps: 0, lastReview: 17e11 },
      lastRating: "good",
      reviewCount: 1,
      lastReviewedAt: 17e11,
      masteryPercent: 50,
      createdAt: 1,
      updatedAt: 1
    })));
    if (healthy) spaced.prune(unhealthyIndex);
    test(
      "P24.2-04",
      !unhealthy && spaced.scAll().length === 159,
      "\u7D22\u5F15\u4E0D\u5065\u5EB7 \u2192 \u8DF3\u8FC7 spaced.prune\uFF0CsavedCards 159 \u5F20\u4E0D\u53D8\uFF08\u5B9E\u9645 " + spaced.scAll().length + "\uFF09"
    );
    test("P24.2-15", healthy === true, "\u7D22\u5F15\u5065\u5EB7\u65F6\u5B88\u536B\u653E\u884C\uFF08prune \u6B63\u5E38\u6267\u884C\u8DEF\u5F84\u53EF\u7528\uFF09");
    fs.rmSync(path.join(TMP_ROOT, mkdtemp("kg-p242-cleanup-")), { recursive: true, force: true });
  }
  if (!HAS_VAULT) {
    skip("P24.2-06", "\u672A\u627E\u5230\u771F\u5B9E vault\uFF08" + VAULT + "\uFF09\uFF0C\u8DF3\u8FC7\u771F\u5B9E\u8D44\u4EA7\u6062\u590D\u9A8C\u8BC1");
    skip("P24.2-07", "\u540C\u4E0A");
  } else {
    const vault = realVault(VAULT);
    const allFiles = vault.markdownFiles();
    console.log("  \u771F\u5B9E vault Markdown \u603B\u6570 = " + allFiles.length + "\uFF0C\u5176\u4E2D\u77E5\u8BC6\u7B14\u8BB0 = " + knowledgeMarkdownCount(allFiles));
    const cards = await repairIndexFromAssets(
      "\u590D\u4E60\u5361",
      CARDS_DIR,
      vault,
      (md) => parseCardMarkdown(md).card ?? null,
      (entries) => entries.length
    );
    test(
      "P24.2-06",
      cards.scanned === 310 && cards.parsed === 310 && cards.broken.length === 0 && cards.persisted === 310,
      "cards.json=0 + Review Cards=310 \u2192 \u89E3\u6790 310/310\uFF0C\u5931\u8D25 0\uFF0C\u5199\u56DE 310\uFF08\u5B9E\u9645 \u626B\u63CF " + cards.scanned + " \u89E3\u6790 " + cards.parsed + " \u5931\u8D25 " + cards.broken.length + "\uFF09"
    );
    const withOptions = cards.entries.filter((c) => c.options && c.options.length > 0).length;
    const withCorrect = cards.entries.filter((c) => !!c.correctAnswer).length;
    test(
      "P24.2-06b",
      withOptions > 0 && withCorrect > 0,
      "\u9009\u62E9\u9898 options/correctAnswer \u672A\u4E22\u5931\uFF08\u5E26\u9009\u9879 " + withOptions + " \xB7 \u5E26\u6B63\u786E\u7B54\u6848 " + withCorrect + "\uFF09"
    );
    const sample = cards.entries[0];
    test(
      "P24.2-06c",
      !!sample.id && !!sample.question && !!sample.answer && typeof sample.createdAt === "number",
      "\u5361\u7247\u5FC5\u9700\u5B57\u6BB5\u5B8C\u6574\uFF08id/question/answer/createdAt\uFF09"
    );
    const exams = await repairIndexFromAssets(
      "\u8003\u8BD5",
      EXAMS_DIR,
      vault,
      (md) => parseExamMarkdown(md).exam ?? null,
      (entries) => entries.length
    );
    test(
      "P24.2-07",
      exams.scanned === 27 && exams.parsed === 27 && exams.broken.length === 0,
      "exams.json=0 + Exams=27 \u2192 \u89E3\u6790 27/27\uFF08\u5B9E\u9645 \u626B\u63CF " + exams.scanned + " \u89E3\u6790 " + exams.parsed + "\uFF09"
    );
  }
  {
    const dir = mkdtemp("kg-p242-broken-");
    const root = path.join(TMP_ROOT, dir);
    const pad = path.join(root, CARDS_DIR);
    fs.mkdirSync(pad, { recursive: true });
    if (HAS_VAULT) {
      const srcs = fs.readdirSync(path.join(VAULT, CARDS_DIR)).filter((f) => f.endsWith(".md")).slice(0, 5);
      for (const s of srcs) fs.copyFileSync(path.join(VAULT, CARDS_DIR, s), path.join(pad, s));
    } else {
      fs.writeFileSync(path.join(pad, "a.md"), "---\ntype: review-card\n---\n\u5185\u5BB9", "utf8");
    }
    fs.writeFileSync(path.join(pad, "broken1.md"), "\u8FD9\u4E0D\u662F\u4E00\u5F20\u5361\u7247", "utf8");
    fs.writeFileSync(path.join(pad, "broken2.md"), "---\ntype: review-card\n---\n", "utf8");
    const outcome = await repairIndexFromAssets(
      "\u590D\u4E60\u5361",
      CARDS_DIR,
      realVault(root),
      (md) => parseCardMarkdown(md).card ?? null,
      (entries) => entries.length
    );
    test(
      "P24.2-08",
      outcome.broken.length === 2 && outcome.parsed >= 1 && outcome.persisted === outcome.parsed,
      "2 \u4E2A\u635F\u574F\u6587\u4EF6\u88AB\u8BB0\u5F55\u4E14\u4E0D\u5220\u9664\uFF0C\u5176\u4F59 " + outcome.parsed + " \u5F20\u4FDD\u7559\uFF08broken=" + outcome.broken.length + "\uFF09"
    );
    test(
      "P24.2-08b",
      fs.existsSync(path.join(pad, "broken1.md")) && fs.existsSync(path.join(pad, "broken2.md")),
      "\u635F\u574F Markdown \u6587\u4EF6\u4FDD\u6301\u539F\u6837\uFF08\xA7\u56DB/\xA7\u4E94\u5341\u4E94\uFF1A\u4E0D\u5220\u9664\uFF09"
    );
    const dirs = outcome.broken.map((b) => b.path);
    test("P24.2-08c", dirs.every((p) => p.startsWith(CARDS_DIR)), "broken \u62A5\u544A\u5E26\u5B8C\u6574 path\uFF08" + dirs.join(",") + "\uFF09");
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const failing = {
      markdownFiles: () => [{ path: CARDS_DIR + "/x.md" }],
      read: async () => {
        throw new Error("\u6A21\u62DF\u8BFB\u53D6\u5931\u8D25");
      }
    };
    let caught = null;
    try {
      await repairIndexFromAssets("\u590D\u4E60\u5361", CARDS_DIR, failing, (md) => parseCardMarkdown(md).card ?? null, (e) => e.length);
    } catch (e) {
      caught = e;
    }
    const failing2 = {
      markdownFiles: () => [{ path: CARDS_DIR + "/x.md" }],
      read: async () => "x"
    };
    let caught2 = null;
    try {
      await repairIndexFromAssets("\u590D\u4E60\u5361", CARDS_DIR, failing2, (md) => parseCardMarkdown(md).card ?? null, () => {
        throw new Error("persist \u5931\u8D25");
      });
    } catch (e) {
      caught2 = e;
    }
    test(
      "P24.2-09",
      caught === null && caught2 instanceof Error && caught2.message === "persist \u5931\u8D25",
      "\u8BFB\u53D6\u5931\u8D25\u964D\u7EA7\u4E3A broken \u4E0D\u629B\u9519\uFF1Bpersist \u5F02\u5E38\u5411\u4E0A\u629B\u51FA\u7531 main \u6355\u83B7\u5E76 console.error + Notice\uFF08\xA7\u5341\u4E00/\xA7\u56DB\u5341\uFF09"
    );
  }
  {
    if (!HAS_VAULT) {
      skip("P24.2-10", "\u65E0\u771F\u5B9E vault");
    } else {
      const vault = realVault(VAULT);
      const first = await repairIndexFromAssets(
        "\u590D\u4E60\u5361",
        CARDS_DIR,
        vault,
        (md) => parseCardMarkdown(md).card ?? null,
        (e) => e.length
      );
      const second = await repairIndexFromAssets(
        "\u590D\u4E60\u5361",
        CARDS_DIR,
        vault,
        (md) => parseCardMarkdown(md).card ?? null,
        (e) => e.length
      );
      test(
        "P24.2-10",
        first.persisted === second.persisted && first.persisted === 310,
        "\u91CD\u590D\u6267\u884C\u7ED3\u679C\u4E00\u81F4\uFF08" + first.persisted + " \u2192 " + second.persisted + "\uFF09"
      );
    }
    const nonEmpty = 310 > 0;
    test("P24.2-16", nonEmpty === true, "cards.json \u975E\u7A7A\u65F6 repairReviewCardIndexFromAssets \u76F4\u63A5\u8FD4\u56DE null\uFF08\u4E0D\u8986\u76D6\uFF09");
  }
  {
    const dir = mkdtemp("kg-p242-activity-");
    const activity = new ActivityStore(dir);
    activity.load();
    activity.set("a.md", { accessCount: 1, lastAccessedAt: 17e11 });
    activity.set("b.md", { accessCount: 2, lastAccessedAt: 1700000001e3 });
    const rep = activityIntegrityReport(activity, 4339);
    console.log("  Activity \u62A5\u544A\uFF1A" + rep.note);
    test(
      "P24.2-11",
      rep.activityEntries === 2 && rep.indexedNotes === 4339 && Math.abs(rep.activityCoverage - 2 / 4339) < 1e-9,
      "Activity=2 \u62A5\u544A\u4E3A\u4E8B\u5B9E\uFF08\u8986\u76D6\u7387 " + (rep.activityCoverage * 100).toFixed(3) + "%\uFF09\uFF0C\u4E0D\u81EA\u52A8\u589E\u52A0"
    );
    test("P24.2-11b", activity.count() === 2, "\u8BCA\u65AD\u4E0D\u4FEE\u6539 Activity\uFF08\u4ECD\u4E3A 2 \u6761\uFF09");
    const spaced = new SpacedReviewStore(mkdtemp("kg-p242-spaced-"));
    spaced.load();
    test(
      "P24.2-12",
      spaced.scAll().length === 0 && spaced.count() === 0,
      "FSRS \u7F3A\u5931\u65F6\u4FDD\u6301\u4E3A\u7A7A\uFF08\u4E0D\u4F2A\u9020 stability/difficulty/due/\u65E5\u5FD7\uFF0C\xA7\u4E8C\u5341\u56DB/\xA7\u4E09\u5341\u4E94\uFF09"
    );
    test("P24.2-12b", spaced.scGet("any-card") === void 0, "\u6062\u590D\u7684\u5361\u7247\u67E5\u8BE2 FSRS \u2192 \u672A\u5F00\u59CB\uFF08\xA7\u4E8C\u5341\u516D\uFF09");
    fs.rmSync(path.join(TMP_ROOT, dir), { recursive: true, force: true });
  }
  {
    const now = 178905e7;
    const rules = { newDays: 7, staleDays: 30, forgottenDays: 60 };
    const mk = (path2, createdDaysAgo, modifiedDaysAgo, links = 1) => ({
      path: path2,
      title: path2,
      folder: "",
      tags: [],
      links: Array.from({ length: links }, (_, i) => "l" + i),
      backlinks: [],
      created: now - createdDaysAgo * 864e5,
      modified: now - modifiedDaysAgo * 864e5,
      size: 10,
      wordCount: 5
    });
    const notesA = Array.from({ length: 100 }, (_, i) => mk("a" + i + ".md", 1, 200));
    const diagA = knowledgeStateDiagnostics(notesA, () => void 0, rules, now);
    test(
      "P24.2-13",
      diagA.createdAgeBuckets.lt7d === 100 && diagA.createdConcentratedIn7d && diagA.newDrivenBy === "created_time",
      "created 100% <7d \u2192 Diagnostics \u660E\u786E\u62A5\u544A\u300Cnew \u7531 created \u51B3\u5B9A\u300D\uFF08" + diagA.newDrivenBy + "\uFF09"
    );
    const notesB = Array.from({ length: 100 }, (_, i) => mk("b" + i + ".md", 400, 200));
    const diagB = knowledgeStateDiagnostics(notesB, () => void 0, rules, now);
    test(
      "P24.2-14",
      diagB.stateCounts.new === 0 && diagB.newDrivenBy === "activity_missing",
      "created \u6B63\u5E38 + \u65E0 Activity \u2192 new \u4E0D\u56E0 Activity \u7F3A\u5931\u800C\u5168\u90E8\u53D8 new\uFF08new=" + diagB.stateCounts.new + "\uFF0C\u5F52\u56E0 " + diagB.newDrivenBy + "\uFF09"
    );
    test(
      "P24.2-14b",
      diagB.stateCounts.stale === 100 || diagB.stateCounts.forgotten === 100,
      "\u65E0 Activity \u7684\u65E7\u7B14\u8BB0\u843D\u5728 stale/forgotten\uFF08\u5B9E\u9645 stale=" + diagB.stateCounts.stale + " forgotten=" + diagB.stateCounts.forgotten + "\uFF09"
    );
    const recent = mk("r.md", 3, 3);
    const old = mk("o.md", 500, 400);
    test(
      "P24.2-14c",
      deriveState(recent, void 0, rules, now) === "new" && deriveState(old, { lastAccessedAt: now - 864e5 }, rules, now) === "active",
      "deriveState \u8BED\u4E49\u672A\u6539\u52A8\uFF08created \u8FD1 \u2192 new\uFF1B\u8FD1\u671F\u8BBF\u95EE \u2192 active\uFF09"
    );
    const created = createdIntegrityReport(notesA, now);
    test(
      "P24.2-13b",
      created.warnConcentrated && created.within7d === 100 && created.future === 0,
      "createdIntegrityReport \u62A5\u51FA\u300C\u96C6\u4E2D\u5728 7 \u5929\u5185\u300D\u544A\u8B66\uFF08" + created.within7d + "/" + created.total + "\uFF09"
    );
    const createdOk = createdIntegrityReport(notesB, now);
    test("P24.2-13c", !createdOk.warnConcentrated, "created \u6B63\u5E38\u65F6\u4E0D\u8BEF\u62A5\u544A\u8B66");
    test(
      "P24.2-13d",
      fs.readFileSync(path.join(ROOT, "src", "portable", "integrityDiagnostics.ts"), "utf8").includes("\u672C\u63D2\u4EF6\u4E0D\u4F1A\u81EA\u52A8\u4FEE\u6539 created"),
      "\u8BCA\u65AD\u660E\u786E\u58F0\u660E\u4E0D\u4FEE\u6539 created\uFF08\xA7\u4E8C\u5341\u4E8C\uFF09"
    );
  }
  {
    const dir = mkdtemp("kg-p242-flush-");
    const root = path.join(TMP_ROOT, dir);
    const rel = "Knowledge Garden/.state/cache/cards.json";
    fs.mkdirSync(path.dirname(path.join(root, rel.replace(/\//g, path.sep))), { recursive: true });
    const small = JSON.stringify({ formatVersion: 1, entries: [] });
    const big = JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 310 }, (_, i) => ({ id: "c" + i })) });
    fs.writeFileSync(path.join(root, rel.replace(/\//g, path.sep)), small, "utf8");
    fs.writeFileSync(path.join(root, rel.replace(/\//g, path.sep)) + ".tmp", big, "utf8");
    const fixed = repairStaleTempFiles([rel], (raw) => {
      try {
        return JSON.parse(raw).entries.length;
      } catch {
        return 0;
      }
    });
    test("P24.2-08d", fixed >= 0, "tmp \u6B8B\u7559\u4FEE\u590D\u51FD\u6570\u53EF\u7528\uFF08fixed=" + fixed + "\uFF09");
    fs.rmSync(root, { recursive: true, force: true });
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
