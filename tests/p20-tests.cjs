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
function readStateText(rel) {
  return readFileSync(stateKeyOf(rel), "utf8");
}
function stateList(rel = "") {
  return readdirSync(stateKeyOf(rel)).map((d) => d.name);
}
function seedStateText(rel, text) {
  writeFileSync(stateKeyOf(rel), text);
}

// tests/p20-tests.ts
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
function padZero(num2) {
  return num2 < 10 ? `0${num2}` : `${num2}`;
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
var FUZZ_RANGES = [
  {
    start: 2.5,
    end: 7,
    factor: 0.15
  },
  {
    start: 7,
    end: 20,
    factor: 0.1
  },
  {
    start: 20,
    end: Infinity,
    factor: 0.05
  }
];
function get_fuzz_range(interval, elapsed_days, maximum_interval) {
  let delta = 1;
  for (const range of FUZZ_RANGES) {
    delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
  }
  interval = Math.min(interval, maximum_interval);
  let min_ivl = Math.max(2, Math.round(interval - delta));
  const max_ivl = Math.min(Math.round(interval + delta), maximum_interval);
  if (interval > elapsed_days) {
    min_ivl = Math.max(min_ivl, elapsed_days + 1);
  }
  min_ivl = Math.min(min_ivl, max_ivl);
  return { min_ivl, max_ivl };
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function roundTo(num2, decimals) {
  const factor = 10 ** decimals;
  return Math.round(num2 * factor) / factor;
}
function dateDiffInDays(last, cur) {
  const utc1 = Date.UTC(
    last.getUTCFullYear(),
    last.getUTCMonth(),
    last.getUTCDate()
  );
  const utc2 = Date.UTC(
    cur.getUTCFullYear(),
    cur.getUTCMonth(),
    cur.getUTCDate()
  );
  return Math.floor(
    (utc2 - utc1) / 864e5
    /** 1000 * 60 * 60 * 24*/
  );
}
var ConvertStepUnitToMinutes = (step) => {
  const unit = step.slice(-1);
  const value = parseInt(step.slice(0, -1), 10);
  if (Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
    throw new FSRSValidationError(`Invalid step value: ${step}`);
  }
  switch (unit) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 1440;
    default:
      throw new FSRSValidationError(
        `Invalid step unit: ${step}, expected m/h/d`
      );
  }
};
var BasicLearningStepsStrategy = (params, state, cur_step) => {
  const learning_steps = state === State.Relearning || state === State.Review ? params.relearning_steps : params.learning_steps;
  const steps_length = learning_steps.length;
  if (steps_length === 0 || cur_step >= steps_length) return {};
  const firstStep = learning_steps[0];
  const toMinutes = ConvertStepUnitToMinutes;
  const getAgainInterval = () => {
    return toMinutes(firstStep);
  };
  const getHardInterval = () => {
    if (steps_length === 1) return Math.round(toMinutes(firstStep) * 1.5);
    const nextStep = learning_steps[1];
    return Math.round((toMinutes(firstStep) + toMinutes(nextStep)) / 2);
  };
  const getStepInfo = (index) => {
    if (index < 0 || index >= steps_length) {
      return null;
    } else {
      return learning_steps[index];
    }
  };
  const getGoodMinutes = (step) => {
    return toMinutes(step);
  };
  const result = {};
  const step_info = getStepInfo(Math.max(0, cur_step));
  if (state === State.Review) {
    result[Rating.Again] = {
      scheduled_minutes: toMinutes(step_info),
      next_step: 0
    };
    return result;
  } else {
    result[Rating.Again] = {
      scheduled_minutes: getAgainInterval(),
      next_step: 0
    };
    result[Rating.Hard] = {
      scheduled_minutes: getHardInterval(),
      next_step: cur_step
    };
    const next_info = getStepInfo(cur_step + 1);
    if (next_info) {
      const nextMin = getGoodMinutes(next_info);
      if (nextMin) {
        result[Rating.Good] = {
          scheduled_minutes: Math.round(nextMin),
          next_step: cur_step + 1
        };
      }
    }
  }
  return result;
};
function DefaultInitSeedStrategy() {
  const time = this.review_time.getTime();
  const reps = this.current.reps;
  const mul = this.current.difficulty * this.current.stability;
  return `${time}_${reps}_${mul}`;
}
var StrategyMode = /* @__PURE__ */ ((StrategyMode2) => {
  StrategyMode2["SCHEDULER"] = "Scheduler";
  StrategyMode2["LEARNING_STEPS"] = "LearningSteps";
  StrategyMode2["SEED"] = "Seed";
  return StrategyMode2;
})(StrategyMode || {});
var AbstractScheduler = class {
  last;
  current;
  review_time;
  next = /* @__PURE__ */ new Map();
  algorithm;
  strategies;
  elapsed_days = 0;
  // init
  constructor(card, now, algorithm, strategies) {
    this.algorithm = algorithm;
    this.last = TypeConvert.card(card);
    this.current = TypeConvert.card(card);
    this.review_time = TypeConvert.time(now);
    this.strategies = strategies;
    this.init();
  }
  checkGrade(grade) {
    if (!Number.isFinite(grade) || grade < 1 || grade > 4) {
      throw new FSRSValidationError(`Invalid grade "${grade}",expected 1-4`);
    }
  }
  init() {
    const { state, last_review } = this.current;
    let interval = 0;
    if (state !== State.New && last_review) {
      interval = dateDiffInDays(last_review, this.review_time);
    }
    this.current.last_review = this.review_time;
    this.elapsed_days = interval;
    this.current.elapsed_days = interval;
    this.current.reps += 1;
    let seed_strategy = DefaultInitSeedStrategy;
    if (this.strategies) {
      const custom_strategy = this.strategies.get(StrategyMode.SEED);
      if (custom_strategy) {
        seed_strategy = custom_strategy;
      }
    }
    this.algorithm.seed = seed_strategy.call(this);
  }
  preview() {
    return {
      [Rating.Again]: this.review(Rating.Again),
      [Rating.Hard]: this.review(Rating.Hard),
      [Rating.Good]: this.review(Rating.Good),
      [Rating.Easy]: this.review(Rating.Easy),
      [Symbol.iterator]: this.previewIterator.bind(this)
    };
  }
  *previewIterator() {
    for (const grade of Grades) {
      yield this.review(grade);
    }
  }
  review(grade) {
    const { state } = this.last;
    let item;
    this.checkGrade(grade);
    switch (state) {
      case State.New:
        item = this.newState(grade);
        break;
      case State.Learning:
      case State.Relearning:
        item = this.learningState(grade);
        break;
      case State.Review:
        item = this.reviewState(grade);
        break;
    }
    return item;
  }
  buildLog(rating) {
    const { last_review, due, elapsed_days } = this.last;
    return {
      rating,
      state: this.current.state,
      due: last_review || due,
      stability: this.current.stability,
      difficulty: this.current.difficulty,
      elapsed_days: this.elapsed_days,
      last_elapsed_days: elapsed_days,
      scheduled_days: this.current.scheduled_days,
      learning_steps: this.current.learning_steps,
      review: this.review_time
    };
  }
};
var Alea = class {
  c;
  s0;
  s1;
  s2;
  constructor(seed) {
    const mash = Mash();
    this.c = 1;
    this.s0 = mash(" ");
    this.s1 = mash(" ");
    this.s2 = mash(" ");
    if (seed == null) seed = Date.now();
    this.s0 -= mash(seed);
    if (this.s0 < 0) this.s0 += 1;
    this.s1 -= mash(seed);
    if (this.s1 < 0) this.s1 += 1;
    this.s2 -= mash(seed);
    if (this.s2 < 0) this.s2 += 1;
  }
  next() {
    const t = 2091639 * this.s0 + this.c * 23283064365386963e-26;
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.c = t | 0;
    this.s2 = t - this.c;
    return this.s2;
  }
  set state(state) {
    this.c = state.c;
    this.s0 = state.s0;
    this.s1 = state.s1;
    this.s2 = state.s2;
  }
  get state() {
    return {
      c: this.c,
      s0: this.s0,
      s1: this.s1,
      s2: this.s2
    };
  }
};
function Mash() {
  let n = 4022871197;
  return function mash(data) {
    data = String(data);
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 4294967296;
    }
    return (n >>> 0) * 23283064365386963e-26;
  };
}
function alea(seed) {
  const xg = new Alea(seed);
  const prng = () => xg.next();
  prng.int32 = () => xg.next() * 4294967296 | 0;
  prng.double = () => prng() + (prng() * 2097152 | 0) * 11102230246251565e-32;
  prng.state = () => xg.state;
  prng.importState = (state) => {
    xg.state = state;
    return prng;
  };
  return prng;
}
var version = "5.4.2";
var default_request_retention = 0.9;
var default_maximum_interval = 36500;
var default_enable_fuzz = false;
var default_enable_short_term = true;
var default_learning_steps = Object.freeze([
  "1m",
  "10m"
]);
var default_relearning_steps = Object.freeze([
  "10m"
]);
var FSRSVersion = `v${version} using FSRS-6.0`;
var S_MIN = 1e-3;
var INIT_S_MAX = 100;
var FSRS5_DEFAULT_DECAY = 0.5;
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
var W17_W18_Ceiling = 2;
var CLAMP_PARAMETERS = (w17_w18_ceiling, enable_short_term = default_enable_short_term) => [
  [S_MIN, INIT_S_MAX],
  [S_MIN, INIT_S_MAX],
  [S_MIN, INIT_S_MAX],
  [S_MIN, INIT_S_MAX],
  [1, 10],
  [1e-3, 4],
  [1e-3, 4],
  [1e-3, 0.75],
  [0, 4.5],
  [0, 0.8],
  [1e-3, 3.5],
  [1e-3, 5],
  [1e-3, 0.25],
  [1e-3, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, w17_w18_ceiling],
  [0, w17_w18_ceiling],
  [
    enable_short_term ? 0.01 : 0,
    0.8
  ],
  [0.1, 0.8]
];
var clipParameters = (parameters, numRelearningSteps, enableShortTerm = default_enable_short_term) => {
  const clip = CLAMP_PARAMETERS(W17_W18_Ceiling, enableShortTerm).slice(
    0,
    parameters.length
  );
  if (Math.max(0, numRelearningSteps) > 1) {
    const w11 = clamp(parameters[11] || 0, clip[11][0], clip[11][1]);
    const w13 = clamp(parameters[13] || 0, clip[13][0], clip[13][1]);
    const w14 = clamp(parameters[14] || 0, clip[14][0], clip[14][1]);
    const value = -(Math.log(w11) + Math.log(Math.pow(2, w13) - 1) + w14 * 0.3) / numRelearningSteps;
    const w17_w18_ceiling = clamp(
      roundTo(Math.sqrt(Math.max(value, 0)), 8),
      0.01,
      W17_W18_Ceiling
    );
    if (clip[17]) clip[17] = [clip[17][0], w17_w18_ceiling];
    if (clip[18]) clip[18] = [clip[18][0], w17_w18_ceiling];
  }
  return clip.map(
    ([min, max], index) => clamp(parameters[index] || 0, min, max)
  );
};
var migrateParameters = (parameters, numRelearningSteps = 0, enableShortTerm = default_enable_short_term) => {
  if (parameters === void 0) {
    return [...default_w];
  }
  switch (parameters.length) {
    case 21:
      return clipParameters(
        Array.from(parameters),
        numRelearningSteps,
        enableShortTerm
      );
    case 19:
      console.debug("[FSRS-6]auto fill w from 19 to 21 length");
      return clipParameters(
        Array.from(parameters),
        numRelearningSteps,
        enableShortTerm
      ).concat([0, FSRS5_DEFAULT_DECAY]);
    case 17: {
      const w = clipParameters(
        Array.from(parameters),
        numRelearningSteps,
        enableShortTerm
      );
      w[4] = +(w[5] * 2 + w[4]).toFixed(8);
      w[5] = +(Math.log(w[5] * 3 + 1) / 3).toFixed(8);
      w[6] = +(w[6] + 0.5).toFixed(8);
      console.debug("[FSRS-6]auto fill w from 17 to 21 length");
      return w.concat([0, 0, 0, FSRS5_DEFAULT_DECAY]);
    }
    default:
      console.warn("[FSRS]Invalid parameters length, using default parameters");
      return [...default_w];
  }
};
var generatorParameters = (props) => {
  const learning_steps = Array.isArray(props?.learning_steps) ? props.learning_steps : default_learning_steps;
  const relearning_steps = Array.isArray(props?.relearning_steps) ? props.relearning_steps : default_relearning_steps;
  const enable_short_term = props?.enable_short_term ?? default_enable_short_term;
  const w = migrateParameters(
    props?.w,
    relearning_steps.length,
    enable_short_term
  );
  return {
    request_retention: props?.request_retention || default_request_retention,
    maximum_interval: props?.maximum_interval || default_maximum_interval,
    w,
    enable_fuzz: props?.enable_fuzz ?? default_enable_fuzz,
    enable_short_term,
    learning_steps,
    relearning_steps
  };
};
function createEmptyCard(now, afterHandler) {
  const emptyCard = {
    due: now ? TypeConvert.time(now) : /* @__PURE__ */ new Date(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    state: State.New,
    last_review: void 0
  };
  if (afterHandler && typeof afterHandler === "function") {
    return afterHandler(emptyCard);
  } else {
    return emptyCard;
  }
}
var computeDecayFactor = (decayOrParams) => {
  const decay = typeof decayOrParams === "number" ? -decayOrParams : -decayOrParams[20];
  const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1;
  return { decay, factor: roundTo(factor, 8) };
};
function forgetting_curve(decayOrParams, elapsed_days, stability) {
  const { decay, factor } = computeDecayFactor(decayOrParams);
  return roundTo(Math.pow(1 + factor * elapsed_days / stability, decay), 8);
}
var FSRSAlgorithm = class {
  param;
  intervalModifier;
  _seed;
  constructor(params) {
    this.param = new Proxy(
      this.prepare_parameters(params),
      this.params_handler_proxy()
    );
    this.intervalModifier = this.calculate_interval_modifier(
      this.param.request_retention
    );
    this.forgetting_curve = forgetting_curve.bind(this, this.param.w);
  }
  get interval_modifier() {
    return this.intervalModifier;
  }
  set seed(seed) {
    this._seed = seed;
  }
  /**
   * @see https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm#fsrs-5
   *
   * The formula used is: $$I(r,s) = (r^{\frac{1}{DECAY}} - 1) / FACTOR \times s$$
   * @param request_retention 0<request_retention<=1,Requested retention rate
   * @throws {Error} Requested retention rate should be in the range (0,1]
   */
  calculate_interval_modifier(request_retention) {
    if (request_retention <= 0 || request_retention > 1) {
      throw new FSRSValidationError(
        "Requested retention rate should be in the range (0,1]"
      );
    }
    const { decay, factor } = computeDecayFactor(this.param.w);
    return roundTo((Math.pow(request_retention, 1 / decay) - 1) / factor, 8);
  }
  /**
   * Get the parameters of the algorithm.
   */
  get parameters() {
    return this.param;
  }
  /**
   * Set the parameters of the algorithm.
   * @param params Partial<FSRSParameters>
   */
  set parameters(params) {
    this.update_parameters(params);
  }
  params_handler_proxy() {
    const _this = this;
    return {
      set: function(target, prop, value) {
        if (prop === "request_retention" && Number.isFinite(value)) {
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(value)
          );
        } else if (prop === "w") {
          value = migrateParameters(
            value,
            target.relearning_steps.length,
            target.enable_short_term
          );
          value = clipParameters(
            Array.from(value),
            target.relearning_steps.length,
            target.enable_short_term
          );
          _this.forgetting_curve = forgetting_curve.bind(this, value);
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(target.request_retention)
          );
        }
        Reflect.set(target, prop, value);
        return true;
      }
    };
  }
  update_parameters(params) {
    const _params = this.prepare_parameters(params);
    for (const key2 in _params) {
      const paramKey = key2;
      this.param[paramKey] = _params[paramKey];
    }
  }
  prepare_parameters = (params) => {
    const generated = generatorParameters(params);
    generated.w = clipParameters(
      Array.from(generated.w),
      generated.relearning_steps.length,
      generated.enable_short_term
    );
    return generated;
  };
  /**
     * The formula used is :
     * $$ S_0(G) = w_{G-1}$$
     * $$S_0 = \max \lbrace S_0,0.1\rbrace $$
  
     * @param g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return Stability (interval when R=90%)
     */
  init_stability(g) {
    return Math.max(this.param.w[g - 1], 0.1);
  }
  /**
   * The formula used is :
   * $$D_0(G) = w_4 - e^{(G-1) \cdot w_5} + 1 $$
   * $$D_0 = \min \lbrace \max \lbrace D_0(G),1 \rbrace,10 \rbrace$$
   * where the $$D_0(1)=w_4$$ when the first rating is good.
   *
   * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
   * @return {number} Difficulty $$D \in [1,10]$$
   */
  init_difficulty(g) {
    const w = this.param.w;
    const d = w[4] - Math.exp((g - 1) * w[5]) + 1;
    return roundTo(d, 8);
  }
  /**
   * If fuzzing is disabled or ivl is less than 2.5, it returns the original interval.
   * @param {number} ivl - The interval to be fuzzed.
   * @param {number} elapsed_days t days since the last review
   * @return {number} - The fuzzed interval.
   **/
  apply_fuzz(ivl, elapsed_days) {
    if (!this.param.enable_fuzz || ivl < 2.5) return Math.round(ivl);
    const generator = alea(this._seed);
    const fuzz_factor = generator();
    const { min_ivl, max_ivl } = get_fuzz_range(
      ivl,
      elapsed_days,
      this.param.maximum_interval
    );
    return Math.floor(fuzz_factor * (max_ivl - min_ivl + 1) + min_ivl);
  }
  /**
   *   @see The formula used is : {@link FSRSAlgorithm.calculate_interval_modifier}
   *   @param {number} s - Stability (interval when R=90%)
   *   @param {number} elapsed_days t days since the last review
   */
  next_interval(s, elapsed_days) {
    const newInterval = Math.min(
      Math.max(1, Math.round(s * this.intervalModifier)),
      this.param.maximum_interval
    );
    return this.apply_fuzz(newInterval, elapsed_days);
  }
  /**
   * @see https://github.com/open-spaced-repetition/fsrs4anki/issues/697
   */
  linear_damping(delta_d, old_d) {
    return roundTo(delta_d * (10 - old_d) / 9, 8);
  }
  /**
   * The formula used is :
   * $$\text{delta}_d = -w_6 \cdot (g - 3)$$
   * $$\text{next}_d = D + \text{linear damping}(\text{delta}_d , D)$$
   * $$D^\prime(D,R) = w_7 \cdot D_0(4) +(1 - w_7) \cdot \text{next}_d$$
   * @param {number} d Difficulty $$D \in [1,10]$$
   * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
   * @return {number} $$\text{next}_D$$
   */
  next_difficulty(d, g) {
    const delta_d = -this.param.w[6] * (g - 3);
    const next_d = d + this.linear_damping(delta_d, d);
    return clamp(
      this.mean_reversion(this.init_difficulty(Rating.Easy), next_d),
      1,
      10
    );
  }
  /**
   * The formula used is :
   * $$w_7 \cdot \text{init} +(1 - w_7) \cdot \text{current}$$
   * @param {number} init $$w_2 : D_0(3) = w_2 + (R-2) \cdot w_3= w_2$$
   * @param {number} current $$D - w_6 \cdot (R - 2)$$
   * @return {number} difficulty
   */
  mean_reversion(init, current) {
    const w = this.param.w;
    return roundTo(w[7] * init + (1 - w[7]) * current, 8);
  }
  /**
   * The formula used is :
   * $$S^\prime_r(D,S,R,G) = S\cdot(e^{w_8}\cdot (11-D)\cdot S^{-w_9}\cdot(e^{w_{10}\cdot(1-R)}-1)\cdot w_{15}(\text{if} G=2) \cdot w_{16}(\text{if} G=4)+1)$$
   * @param {number} d Difficulty D \in [1,10]
   * @param {number} s Stability (interval when R=90%)
   * @param {number} r Retrievability (probability of recall)
   * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
   * @return {number} S^\prime_r new stability after recall
   */
  next_recall_stability(d, s, r, g) {
    const w = this.param.w;
    const hard_penalty = Rating.Hard === g ? w[15] : 1;
    const easy_bound = Rating.Easy === g ? w[16] : 1;
    return roundTo(
      clamp(
        s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard_penalty * easy_bound),
        S_MIN,
        36500
      ),
      8
    );
  }
  /**
   * The formula used is :
   * $$S^\prime_f(D,S,R) = w_{11}\cdot D^{-w_{12}}\cdot ((S+1)^{w_{13}}-1) \cdot e^{w_{14}\cdot(1-R)}$$
   * enable_short_term = true : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, \frac{S}{e^{w_{17} \cdot w_{18}}} \rbrace$$
   * enable_short_term = false : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, S \rbrace$$
   * @param {number} d Difficulty D \in [1,10]
   * @param {number} s Stability (interval when R=90%)
   * @param {number} r Retrievability (probability of recall)
   * @return {number} S^\prime_f new stability after forgetting
   */
  next_forget_stability(d, s, r) {
    const w = this.param.w;
    return roundTo(
      clamp(
        w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]),
        S_MIN,
        36500
      ),
      8
    );
  }
  /**
   * The formula used is :
   * $$S^\prime_s(S,G) = S \cdot e^{w_{17} \cdot (G-3+w_{18})}$$
   * @param {number} s Stability (interval when R=90%)
   * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
   */
  next_short_term_stability(s, g) {
    const w = this.param.w;
    const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
    const maskedSinc = g >= Rating.Hard ? Math.max(sinc, 1) : sinc;
    return roundTo(clamp(s * maskedSinc, S_MIN, 36500), 8);
  }
  /**
   * The formula used is :
   * $$R(t,S) = (1 + \text{FACTOR} \times \frac{t}{9 \cdot S})^{\text{DECAY}}$$
   * @param {number} elapsed_days t days since the last review
   * @param {number} stability Stability (interval when R=90%)
   * @return {number} r Retrievability (probability of recall)
   */
  forgetting_curve;
  /**
   * Calculates the next state of memory based on the current state, time elapsed, and grade.
   *
   * @param memory_state - The current state of memory, which can be null.
   * @param t - The time elapsed since the last review.
   * @param {Rating} g Grade (Rating[0.Manual,1.Again,2.Hard,3.Good,4.Easy])
   * @param r - Optional retrievability value. If not provided, it will be calculated.
   * @returns The next state of memory with updated difficulty and stability.
   */
  next_state(memory_state, t, g, r) {
    const { difficulty: d, stability: s } = memory_state ?? {
      difficulty: 0,
      stability: 0
    };
    if (t < 0) {
      throw new FSRSValidationError(`Invalid delta_t "${t}"`);
    }
    if (g < 0 || g > 4) {
      throw new FSRSValidationError(`Invalid grade "${g}"`);
    }
    if (d === 0 && s === 0) {
      return {
        difficulty: clamp(this.init_difficulty(g), 1, 10),
        stability: this.init_stability(g)
      };
    }
    if (g === 0) {
      return {
        difficulty: d,
        stability: s
      };
    }
    if (d < 1 || s < S_MIN) {
      throw new FSRSValidationError(
        `Invalid memory state { difficulty: ${d}, stability: ${s} }`
      );
    }
    const w = this.param.w;
    r = typeof r === "number" ? r : this.forgetting_curve(t, s);
    let new_s;
    if (t === 0 && this.param.enable_short_term) {
      new_s = this.next_short_term_stability(s, g);
    } else if (g === 1) {
      const s_after_fail = this.next_forget_stability(d, s, r);
      let [w_17, w_18] = [0, 0];
      if (this.param.enable_short_term) {
        w_17 = w[17];
        w_18 = w[18];
      }
      const next_s_min = s / Math.exp(w_17 * w_18);
      new_s = clamp(roundTo(next_s_min, 8), S_MIN, s_after_fail);
    } else {
      new_s = this.next_recall_stability(d, s, r, g);
    }
    const new_d = this.next_difficulty(d, g);
    return { difficulty: new_d, stability: new_s };
  }
};
var BasicScheduler = class extends AbstractScheduler {
  learningStepsStrategy;
  constructor(card, now, algorithm, strategies) {
    super(card, now, algorithm, strategies);
    let learningStepStrategy = BasicLearningStepsStrategy;
    if (this.strategies) {
      const custom_strategy = this.strategies.get(StrategyMode.LEARNING_STEPS);
      if (custom_strategy) {
        learningStepStrategy = custom_strategy;
      }
    }
    this.learningStepsStrategy = learningStepStrategy;
  }
  getLearningInfo(card, grade) {
    const parameters = this.algorithm.parameters;
    card.learning_steps = card.learning_steps || 0;
    const steps_strategy = this.learningStepsStrategy(
      parameters,
      card.state,
      card.learning_steps
    );
    const scheduled_minutes = Math.max(
      0,
      steps_strategy[grade]?.scheduled_minutes ?? 0
    );
    const next_steps = Math.max(0, steps_strategy[grade]?.next_step ?? 0);
    return {
      scheduled_minutes,
      next_steps
    };
  }
  /**
   * @description This function applies the learning steps based on the current card's state and grade.
   */
  applyLearningSteps(nextCard, grade, to_state) {
    const { scheduled_minutes, next_steps } = this.getLearningInfo(
      this.current,
      grade
    );
    if (scheduled_minutes > 0 && scheduled_minutes < 1440) {
      nextCard.learning_steps = next_steps;
      nextCard.scheduled_days = 0;
      nextCard.state = to_state;
      nextCard.due = date_scheduler(
        this.review_time,
        Math.round(scheduled_minutes),
        false
        /** true:days false: minute */
      );
    } else {
      nextCard.state = State.Review;
      if (scheduled_minutes >= 1440) {
        nextCard.learning_steps = next_steps;
        nextCard.due = date_scheduler(
          this.review_time,
          Math.round(scheduled_minutes),
          false
          /** true:days false: minute */
        );
        nextCard.scheduled_days = Math.floor(scheduled_minutes / 1440);
      } else {
        nextCard.learning_steps = 0;
        const interval = this.algorithm.next_interval(
          nextCard.stability,
          this.elapsed_days
        );
        nextCard.scheduled_days = interval;
        nextCard.due = date_scheduler(this.review_time, interval, true);
      }
    }
  }
  newState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const next = this.next_ds(this.elapsed_days, grade);
    this.applyLearningSteps(next, grade, State.Learning);
    const item = {
      card: next,
      log: this.buildLog(grade)
    };
    this.next.set(grade, item);
    return item;
  }
  learningState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const next = this.next_ds(this.elapsed_days, grade);
    this.applyLearningSteps(
      next,
      grade,
      this.last.state
      /** Learning or Relearning */
    );
    const item = {
      card: next,
      log: this.buildLog(grade)
    };
    this.next.set(grade, item);
    return item;
  }
  reviewState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const interval = this.elapsed_days;
    const retrievability = this.algorithm.forgetting_curve(
      interval,
      this.current.stability
    );
    const next_again = this.next_ds(interval, Rating.Again, retrievability);
    const next_hard = this.next_ds(interval, Rating.Hard, retrievability);
    const next_good = this.next_ds(interval, Rating.Good, retrievability);
    const next_easy = this.next_ds(interval, Rating.Easy, retrievability);
    this.next_interval(next_hard, next_good, next_easy, interval);
    this.next_state(next_hard, next_good, next_easy);
    this.applyLearningSteps(next_again, Rating.Again, State.Relearning);
    next_again.lapses += 1;
    const item_again = {
      card: next_again,
      log: this.buildLog(Rating.Again)
    };
    const item_hard = {
      card: next_hard,
      log: super.buildLog(Rating.Hard)
    };
    const item_good = {
      card: next_good,
      log: super.buildLog(Rating.Good)
    };
    const item_easy = {
      card: next_easy,
      log: super.buildLog(Rating.Easy)
    };
    this.next.set(Rating.Again, item_again);
    this.next.set(Rating.Hard, item_hard);
    this.next.set(Rating.Good, item_good);
    this.next.set(Rating.Easy, item_easy);
    return this.next.get(grade);
  }
  /**
   * Review next_ds
   */
  next_ds(t, g, r) {
    const next_state = this.algorithm.next_state(
      {
        difficulty: this.current.difficulty,
        stability: this.current.stability
      },
      t,
      g,
      r
    );
    const card = TypeConvert.card(this.current);
    card.difficulty = next_state.difficulty;
    card.stability = next_state.stability;
    return card;
  }
  /**
   * Review next_interval
   */
  next_interval(next_hard, next_good, next_easy, interval) {
    let hard_interval, good_interval;
    hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
    good_interval = this.algorithm.next_interval(next_good.stability, interval);
    hard_interval = Math.min(hard_interval, good_interval);
    good_interval = Math.max(good_interval, hard_interval + 1);
    const easy_interval = Math.max(
      this.algorithm.next_interval(next_easy.stability, interval),
      good_interval + 1
    );
    next_hard.scheduled_days = hard_interval;
    next_hard.due = date_scheduler(this.review_time, hard_interval, true);
    next_good.scheduled_days = good_interval;
    next_good.due = date_scheduler(this.review_time, good_interval, true);
    next_easy.scheduled_days = easy_interval;
    next_easy.due = date_scheduler(this.review_time, easy_interval, true);
  }
  /**
   * Review next_state
   */
  next_state(next_hard, next_good, next_easy) {
    next_hard.state = State.Review;
    next_hard.learning_steps = 0;
    next_good.state = State.Review;
    next_good.learning_steps = 0;
    next_easy.state = State.Review;
    next_easy.learning_steps = 0;
  }
};
var LongTermScheduler = class extends AbstractScheduler {
  newState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    this.current.scheduled_days = 0;
    this.current.elapsed_days = 0;
    const first_interval = 0;
    const next_again = this.next_ds(first_interval, Rating.Again);
    const next_hard = this.next_ds(first_interval, Rating.Hard);
    const next_good = this.next_ds(first_interval, Rating.Good);
    const next_easy = this.next_ds(first_interval, Rating.Easy);
    this.next_interval(
      next_again,
      next_hard,
      next_good,
      next_easy,
      first_interval
    );
    this.next_state(next_again, next_hard, next_good, next_easy);
    this.update_next(next_again, next_hard, next_good, next_easy);
    return this.next.get(grade);
  }
  next_ds(t, g, r) {
    const next_state = this.algorithm.next_state(
      {
        difficulty: this.current.difficulty,
        stability: this.current.stability
      },
      t,
      g,
      r
    );
    const card = TypeConvert.card(this.current);
    card.difficulty = next_state.difficulty;
    card.stability = next_state.stability;
    return card;
  }
  /**
   * @see https://github.com/open-spaced-repetition/ts-fsrs/issues/98#issuecomment-2241923194
   */
  learningState(grade) {
    return this.reviewState(grade);
  }
  reviewState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const interval = this.elapsed_days;
    const retrievability = this.algorithm.forgetting_curve(
      interval,
      this.current.stability
    );
    const next_again = this.next_ds(interval, Rating.Again, retrievability);
    const next_hard = this.next_ds(interval, Rating.Hard, retrievability);
    const next_good = this.next_ds(interval, Rating.Good, retrievability);
    const next_easy = this.next_ds(interval, Rating.Easy, retrievability);
    this.next_interval(next_again, next_hard, next_good, next_easy, interval);
    this.next_state(next_again, next_hard, next_good, next_easy);
    next_again.lapses += 1;
    this.update_next(next_again, next_hard, next_good, next_easy);
    return this.next.get(grade);
  }
  /**
   * Review/New next_interval
   */
  next_interval(next_again, next_hard, next_good, next_easy, interval) {
    let again_interval, hard_interval, good_interval, easy_interval;
    again_interval = this.algorithm.next_interval(
      next_again.stability,
      interval
    );
    hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
    good_interval = this.algorithm.next_interval(next_good.stability, interval);
    easy_interval = this.algorithm.next_interval(next_easy.stability, interval);
    again_interval = Math.min(again_interval, hard_interval);
    hard_interval = Math.max(hard_interval, again_interval + 1);
    good_interval = Math.max(good_interval, hard_interval + 1);
    easy_interval = Math.max(easy_interval, good_interval + 1);
    next_again.scheduled_days = again_interval;
    next_again.due = date_scheduler(this.review_time, again_interval, true);
    next_hard.scheduled_days = hard_interval;
    next_hard.due = date_scheduler(this.review_time, hard_interval, true);
    next_good.scheduled_days = good_interval;
    next_good.due = date_scheduler(this.review_time, good_interval, true);
    next_easy.scheduled_days = easy_interval;
    next_easy.due = date_scheduler(this.review_time, easy_interval, true);
  }
  /**
   * Review/New next_state
   */
  next_state(next_again, next_hard, next_good, next_easy) {
    next_again.state = State.Review;
    next_again.learning_steps = 0;
    next_hard.state = State.Review;
    next_hard.learning_steps = 0;
    next_good.state = State.Review;
    next_good.learning_steps = 0;
    next_easy.state = State.Review;
    next_easy.learning_steps = 0;
  }
  update_next(next_again, next_hard, next_good, next_easy) {
    const item_again = {
      card: next_again,
      log: this.buildLog(Rating.Again)
    };
    const item_hard = {
      card: next_hard,
      log: super.buildLog(Rating.Hard)
    };
    const item_good = {
      card: next_good,
      log: super.buildLog(Rating.Good)
    };
    const item_easy = {
      card: next_easy,
      log: super.buildLog(Rating.Easy)
    };
    this.next.set(Rating.Again, item_again);
    this.next.set(Rating.Hard, item_hard);
    this.next.set(Rating.Good, item_good);
    this.next.set(Rating.Easy, item_easy);
  }
};
var Reschedule = class {
  fsrs;
  /**
   * Creates an instance of the `Reschedule` class.
   * @param fsrs - An instance of the FSRS class used for scheduling.
   */
  constructor(fsrs2) {
    this.fsrs = fsrs2;
  }
  /**
   * Replays a review for a card and determines the next review date based on the given rating.
   * @param card - The card being reviewed.
   * @param reviewed - The date the card was reviewed.
   * @param rating - The grade given to the card during the review.
   * @returns A `RecordLogItem` containing the updated card and review log.
   */
  replay(card, reviewed, rating) {
    return this.fsrs.next(card, reviewed, rating);
  }
  /**
   * Processes a manual review for a card, allowing for custom state, stability, difficulty, and due date.
   * @param card - The card being reviewed.
   * @param state - The state of the card after the review.
   * @param reviewed - The date the card was reviewed.
   * @param elapsed_days - The number of days since the last review.
   * @param stability - (Optional) The stability of the card.
   * @param difficulty - (Optional) The difficulty of the card.
   * @param due - (Optional) The due date for the next review.
   * @returns A `RecordLogItem` containing the updated card and review log.
   * @throws Will throw an error if the state or due date is not provided when required.
   */
  handleManualRating(card, state, reviewed, elapsed_days, stability, difficulty, due) {
    if (typeof state === "undefined") {
      throw new FSRSValidationError(
        "reschedule: state is required for manual rating"
      );
    }
    let log;
    let next_card;
    if (state === State.New) {
      log = {
        rating: Rating.Manual,
        state,
        due: due ?? reviewed,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days,
        last_elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        review: reviewed
      };
      next_card = createEmptyCard(reviewed);
      next_card.last_review = reviewed;
    } else {
      if (typeof due === "undefined") {
        throw new FSRSValidationError(
          "reschedule: due is required for manual rating"
        );
      }
      const scheduled_days = date_diff(due, reviewed, "days");
      log = {
        rating: Rating.Manual,
        state: card.state,
        due: card.last_review || card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days,
        last_elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        review: reviewed
      };
      next_card = {
        ...card,
        state,
        due,
        last_review: reviewed,
        stability: stability || card.stability,
        difficulty: difficulty || card.difficulty,
        elapsed_days,
        scheduled_days,
        reps: card.reps + 1
      };
    }
    return { card: next_card, log };
  }
  /**
   * Reschedules a card based on its review history.
   *
   * @param current_card - The card to be rescheduled.
   * @param reviews - An array of review history objects.
   * @returns An array of record log items representing the rescheduling process.
   */
  reschedule(current_card, reviews) {
    const collections = [];
    let cur_card = createEmptyCard(current_card.due);
    for (const review of reviews) {
      let item;
      review.review = TypeConvert.time(review.review);
      if (review.rating === Rating.Manual) {
        let interval = 0;
        if (cur_card.state !== State.New && cur_card.last_review) {
          interval = date_diff(review.review, cur_card.last_review, "days");
        }
        item = this.handleManualRating(
          cur_card,
          review.state,
          review.review,
          interval,
          review.stability,
          review.difficulty,
          review.due ? TypeConvert.time(review.due) : void 0
        );
      } else {
        item = this.replay(cur_card, review.review, review.rating);
      }
      collections.push(item);
      cur_card = item.card;
    }
    return collections;
  }
  calculateManualRecord(current_card, now, record_log_item, update_memory) {
    if (!record_log_item) {
      return null;
    }
    const { card: reschedule_card, log } = record_log_item;
    const cur_card = TypeConvert.card(current_card);
    if (cur_card.due.getTime() === reschedule_card.due.getTime()) {
      return null;
    }
    cur_card.scheduled_days = date_diff(
      reschedule_card.due,
      cur_card.due,
      "days"
    );
    return this.handleManualRating(
      cur_card,
      reschedule_card.state,
      TypeConvert.time(now),
      log.elapsed_days,
      update_memory ? reschedule_card.stability : void 0,
      update_memory ? reschedule_card.difficulty : void 0,
      reschedule_card.due
    );
  }
};
function applyAfterHandler(value, afterHandler) {
  return typeof afterHandler === "function" ? afterHandler(value) : value;
}
var FSRS = class extends FSRSAlgorithm {
  strategyHandler = /* @__PURE__ */ new Map();
  Scheduler;
  constructor(param) {
    super(param);
    const { enable_short_term } = this.parameters;
    this.Scheduler = enable_short_term ? BasicScheduler : LongTermScheduler;
  }
  params_handler_proxy() {
    const _this = this;
    return {
      set: function(target, prop, value) {
        if (prop === "request_retention" && Number.isFinite(value)) {
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(value)
          );
        } else if (prop === "enable_short_term") {
          _this.Scheduler = value === true ? BasicScheduler : LongTermScheduler;
        } else if (prop === "w") {
          value = migrateParameters(
            value,
            target.relearning_steps.length,
            target.enable_short_term
          );
          value = clipParameters(
            Array.from(value),
            target.relearning_steps.length,
            target.enable_short_term
          );
          _this.forgetting_curve = forgetting_curve.bind(this, value);
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(target.request_retention)
          );
        }
        Reflect.set(target, prop, value);
        return true;
      }
    };
  }
  useStrategy(mode, handler) {
    this.strategyHandler.set(mode, handler);
    return this;
  }
  clearStrategy(mode) {
    if (mode) {
      this.strategyHandler.delete(mode);
    } else {
      this.strategyHandler.clear();
    }
    return this;
  }
  getScheduler(card, now) {
    const schedulerStrategy = this.strategyHandler.get(
      StrategyMode.SCHEDULER
    );
    const Scheduler = schedulerStrategy || this.Scheduler;
    const instance = new Scheduler(card, now, this, this.strategyHandler);
    return instance;
  }
  /**
   * Display the collection of cards and logs for the four scenarios after scheduling the card at the current time.
   * @param card Card to be processed
   * @param now Current time or scheduled time
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const card: Card = createEmptyCard(new Date());
   * const f = fsrs();
   * const recordLog = f.repeat(card, new Date());
   * ```
   * @example
   * ```typescript
   * interface RevLogUnchecked
   *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
   *   cid: string;
   *   due: Date | number;
   *   state: StateType;
   *   review: Date | number;
   *   rating: RatingType;
   * }
   *
   * interface RepeatRecordLog {
   *   card: CardUnChecked; //see method: createEmptyCard
   *   log: RevLogUnchecked;
   * }
   *
   * function repeatAfterHandler(recordLog: RecordLog) {
   *     const record: { [key in Grade]: RepeatRecordLog } = {} as {
   *       [key in Grade]: RepeatRecordLog;
   *     };
   *     for (const grade of Grades) {
   *       record[grade] = {
   *         card: {
   *           ...(recordLog[grade].card as Card & { cid: string }),
   *           due: recordLog[grade].card.due.getTime(),
   *           state: State[recordLog[grade].card.state] as StateType,
   *           last_review: recordLog[grade].card.last_review
   *             ? recordLog[grade].card.last_review!.getTime()
   *             : null,
   *         },
   *         log: {
   *           ...recordLog[grade].log,
   *           cid: (recordLog[grade].card as Card & { cid: string }).cid,
   *           due: recordLog[grade].log.due.getTime(),
   *           review: recordLog[grade].log.review.getTime(),
   *           state: State[recordLog[grade].log.state] as StateType,
   *           rating: Rating[recordLog[grade].log.rating] as RatingType,
   *         },
   *       };
   *     }
   *     return record;
   * }
   * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
   * const f = fsrs();
   * const recordLog = f.repeat(card, new Date(), repeatAfterHandler);
   * ```
   */
  repeat(card, now, afterHandler) {
    const instance = this.getScheduler(card, now);
    const recordLog = instance.preview();
    return applyAfterHandler(recordLog, afterHandler);
  }
  /**
   * Display the collection of cards and logs for the card scheduled at the current time, after applying a specific grade rating.
   * @param card Card to be processed
   * @param now Current time or scheduled time
   * @param grade Rating of the review (Again, Hard, Good, Easy)
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const card: Card = createEmptyCard(new Date());
   * const f = fsrs();
   * const recordLogItem = f.next(card, new Date(), Rating.Again);
   * ```
   * @example
   * ```typescript
   * interface RevLogUnchecked
   *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
   *   cid: string;
   *   due: Date | number;
   *   state: StateType;
   *   review: Date | number;
   *   rating: RatingType;
   * }
   *
   * interface NextRecordLog {
   *   card: CardUnChecked; //see method: createEmptyCard
   *   log: RevLogUnchecked;
   * }
   *
  function nextAfterHandler(recordLogItem: RecordLogItem) {
    const recordItem = {
      card: {
        ...(recordLogItem.card as Card & { cid: string }),
        due: recordLogItem.card.due.getTime(),
        state: State[recordLogItem.card.state] as StateType,
        last_review: recordLogItem.card.last_review
          ? recordLogItem.card.last_review!.getTime()
          : null,
      },
      log: {
        ...recordLogItem.log,
        cid: (recordLogItem.card as Card & { cid: string }).cid,
        due: recordLogItem.log.due.getTime(),
        review: recordLogItem.log.review.getTime(),
        state: State[recordLogItem.log.state] as StateType,
        rating: Rating[recordLogItem.log.rating] as RatingType,
      },
    };
    return recordItem
  }
   * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
   * const f = fsrs();
   * const recordLogItem = f.repeat(card, new Date(), Rating.Again, nextAfterHandler);
   * ```
   */
  next(card, now, grade, afterHandler) {
    const instance = this.getScheduler(card, now);
    const g = TypeConvert.rating(grade);
    if (g === Rating.Manual) {
      throw new FSRSValidationError("Cannot review a manual rating");
    }
    const recordLogItem = instance.review(g);
    return applyAfterHandler(recordLogItem, afterHandler);
  }
  /**
   * Get the retrievability of the card
   * @param card  Card to be processed
   * @param now  Current time or scheduled time
   * @param format  default:true , Convert the result to another type. (Optional)
   * @returns  The retrievability of the card,if format is true, the result is a string, otherwise it is a number
   */
  get_retrievability(card, now, format = true) {
    const processedCard = TypeConvert.card(card);
    now = now ? TypeConvert.time(now) : /* @__PURE__ */ new Date();
    const t = processedCard.state !== State.New ? Math.max(date_diff(now, processedCard.last_review, "days"), 0) : 0;
    const r = processedCard.state !== State.New ? this.forgetting_curve(t, +processedCard.stability.toFixed(8)) : 0;
    return format ? `${(r * 100).toFixed(2)}%` : r;
  }
  /**
   *
   * @param card Card to be processed
   * @param log last review log
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const now = new Date();
   * const f = fsrs();
   * const emptyCardFormAfterHandler = createEmptyCard(now);
   * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now);
   * const { card, log } = repeatFormAfterHandler[Rating.Hard];
   * const rollbackFromAfterHandler = f.rollback(card, log);
   * ```
   *
   * @example
   * ```typescript
   * const now = new Date();
   * const f = fsrs();
   * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler);  //see method: createEmptyCard
   * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
   * const { card, log } = repeatFormAfterHandler[Rating.Hard];
   * const rollbackFromAfterHandler = f.rollback(card, log, cardAfterHandler);
   * ```
   */
  rollback(card, log, afterHandler) {
    const processedCard = TypeConvert.card(card);
    const processedLog = TypeConvert.review_log(log);
    if (processedLog.rating === Rating.Manual) {
      throw new FSRSValidationError("Cannot rollback a manual rating");
    }
    let last_due;
    let last_review;
    let last_lapses;
    switch (processedLog.state) {
      case State.New:
        last_due = processedLog.due;
        last_review = void 0;
        last_lapses = 0;
        break;
      case State.Learning:
      case State.Relearning:
      case State.Review:
        last_due = processedLog.review;
        last_review = processedLog.due;
        last_lapses = processedCard.lapses - (processedLog.rating === Rating.Again && processedLog.state === State.Review ? 1 : 0);
        break;
    }
    const prevCard = {
      ...processedCard,
      due: last_due,
      stability: processedLog.stability,
      difficulty: processedLog.difficulty,
      elapsed_days: processedLog.last_elapsed_days,
      scheduled_days: processedLog.scheduled_days,
      reps: Math.max(0, processedCard.reps - 1),
      lapses: Math.max(0, last_lapses),
      learning_steps: processedLog.learning_steps,
      state: processedLog.state,
      last_review
    };
    return applyAfterHandler(prevCard, afterHandler);
  }
  /**
   *
   * @param card Card to be processed
   * @param now Current time or scheduled time
   * @param reset_count Should the review count information(reps,lapses) be reset. (Optional)
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const now = new Date();
   * const f = fsrs();
   * const emptyCard = createEmptyCard(now);
   * const scheduling_cards = f.repeat(emptyCard, now);
   * const { card, log } = scheduling_cards[Rating.Hard];
   * const forgetCard = f.forget(card, new Date(), true);
   * ```
   *
   * @example
   * ```typescript
   * interface RepeatRecordLog {
   *   card: CardUnChecked; //see method: createEmptyCard
   *   log: RevLogUnchecked; //see method: fsrs.repeat()
   * }
   *
   * function forgetAfterHandler(recordLogItem: RecordLogItem): RepeatRecordLog {
   *     return {
   *       card: {
   *         ...(recordLogItem.card as Card & { cid: string }),
   *         due: recordLogItem.card.due.getTime(),
   *         state: State[recordLogItem.card.state] as StateType,
   *         last_review: recordLogItem.card.last_review
   *           ? recordLogItem.card.last_review!.getTime()
   *           : null,
   *       },
   *       log: {
   *         ...recordLogItem.log,
   *         cid: (recordLogItem.card as Card & { cid: string }).cid,
   *         due: recordLogItem.log.due.getTime(),
   *         review: recordLogItem.log.review.getTime(),
   *         state: State[recordLogItem.log.state] as StateType,
   *         rating: Rating[recordLogItem.log.rating] as RatingType,
   *       },
   *     };
   * }
   * const now = new Date();
   * const f = fsrs();
   * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler); //see method:  createEmptyCard
   * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
   * const { card } = repeatFormAfterHandler[Rating.Hard];
   * const forgetFromAfterHandler = f.forget(card, date_scheduler(now, 1, true), false, forgetAfterHandler);
   * ```
   */
  forget(card, now, reset_count = false, afterHandler) {
    const processedCard = TypeConvert.card(card);
    now = TypeConvert.time(now);
    const scheduled_days = processedCard.state === State.New ? 0 : date_diff(now, processedCard.due, "days");
    const forget_log = {
      rating: Rating.Manual,
      state: processedCard.state,
      due: processedCard.due,
      stability: processedCard.stability,
      difficulty: processedCard.difficulty,
      elapsed_days: 0,
      last_elapsed_days: processedCard.elapsed_days,
      scheduled_days,
      learning_steps: processedCard.learning_steps,
      review: now
    };
    const forget_card = {
      ...processedCard,
      due: now,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: reset_count ? 0 : processedCard.reps,
      lapses: reset_count ? 0 : processedCard.lapses,
      learning_steps: 0,
      state: State.New,
      last_review: processedCard.last_review
    };
    const recordLogItem = { card: forget_card, log: forget_log };
    return applyAfterHandler(recordLogItem, afterHandler);
  }
  /**
   * Reschedules the current card and returns the rescheduled collections and reschedule item.
   *
   * @template T - The type of the record log item.
   * @param {CardInput | Card} current_card - The current card to be rescheduled.
   * @param {Array<FSRSHistory>} reviews - The array of FSRSHistory objects representing the reviews.
   * @param {Partial<RescheduleOptions<T>>} options - The optional reschedule options.
   * @returns {IReschedule<T>} - The rescheduled collections and reschedule item.
   *
   * @example
   * ```typescript
   * const f = fsrs()
   * const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Good, Rating.Good]
   * const reviews_at = [
   *   new Date(2024, 8, 13),
   *   new Date(2024, 8, 13),
   *   new Date(2024, 8, 17),
   *   new Date(2024, 8, 28),
   * ]
   *
   * const reviews: FSRSHistory[] = []
   * for (let i = 0; i < grades.length; i++) {
   *   reviews.push({
   *     rating: grades[i],
   *     review: reviews_at[i],
   *   })
   * }
   *
   * const results_short = scheduler.reschedule(
   *   createEmptyCard(),
   *   reviews,
   *   {
   *     skipManual: false,
   *   }
   * )
   * console.log(results_short)
   * ```
   */
  reschedule(current_card, reviews = [], options = {}) {
    const {
      recordLogHandler,
      reviewsOrderBy,
      skipManual = true,
      now = /* @__PURE__ */ new Date(),
      update_memory_state: updateMemoryState = false
    } = options;
    if (reviewsOrderBy && typeof reviewsOrderBy === "function") {
      reviews.sort(reviewsOrderBy);
    }
    if (skipManual) {
      reviews = reviews.filter((review) => review.rating !== Rating.Manual);
    }
    const rescheduleSvc = new Reschedule(this);
    const collections = rescheduleSvc.reschedule(
      options.first_card || createEmptyCard(),
      reviews
    );
    const len = collections.length;
    const cur_card = TypeConvert.card(current_card);
    const manual_item = rescheduleSvc.calculateManualRecord(
      cur_card,
      now,
      len ? collections[len - 1] : void 0,
      updateMemoryState
    );
    return {
      collections: typeof recordLogHandler === "function" ? collections.map(recordLogHandler) : collections,
      reschedule_item: manual_item ? applyAfterHandler(manual_item, recordLogHandler) : null
    };
  }
};
var fsrs = (params) => {
  return new FSRS(params || {});
};

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
    return;
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
    }
    writeFileSync(filePath, data, "utf8");
  }
}

// src/spacedReview.ts
var REVIEW_LOG_MAX = 4e3;
var CUSTOM_SCOPE_FOLDER_LIMIT = 10;
var FSRS_RATINGS = ["again", "hard", "good", "easy"];
var FSRS_RATING_SCORE = {
  again: 25,
  hard: 50,
  good: 75,
  easy: 100
};
var MASTERY_CONFIDENCE_MIN = 3;
function isValidDesiredRetention(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0.7 && v <= 0.97;
}
function isValidMaxIntervalDays(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 30 && v <= 36500;
}
function isValidDailyNewCards(v) {
  return Number.isInteger(v) && v >= 0 && v <= 100;
}
function isValidMaxReviewsPerDay(v) {
  return Number.isInteger(v) && v >= 1 && v <= 500;
}
function parseLearningSteps(text) {
  const raw = (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) return null;
  const out = [];
  for (const step of raw) {
    const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(step);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (m[2] === "d" && n > 36500) return null;
    out.push(step);
  }
  return out;
}
function schedulerConfigFingerprint(cfg) {
  const s = "ret:" + cfg.desiredRetention + "|max:" + cfg.maxIntervalDays + "|ls:" + cfg.learningSteps + "|rs:" + cfg.relearningSteps;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function toGrade(rating) {
  switch (rating) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
  }
}
var DAY_MS = 864e5;
function num(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function toTsCard(fs2) {
  const lastReview = typeof fs2.lastReview === "number" ? new Date(fs2.lastReview) : void 0;
  const dueMs = num(fs2.due, Date.now());
  const elapsedDays = lastReview ? Math.max(0, Math.round((dueMs - lastReview.getTime()) / DAY_MS)) : 0;
  return {
    due: new Date(dueMs),
    stability: Math.max(1e-3, num(fs2.stability, 0)),
    difficulty: Math.min(10, Math.max(1, num(fs2.difficulty, 5))),
    elapsed_days: elapsedDays,
    scheduled_days: Math.max(0, Math.floor((dueMs - (lastReview?.getTime() ?? dueMs)) / DAY_MS)),
    learning_steps: Math.max(0, Math.floor(num(fs2.learningSteps, 0))),
    reps: Math.max(0, Math.floor(num(fs2.reps, 0))),
    lapses: Math.max(0, Math.floor(num(fs2.lapses, 0))),
    state: fs2.state === State.Learning || fs2.state === State.Review || fs2.state === State.Relearning ? fs2.state : State.New,
    last_review: lastReview
  };
}
function fromTsCard(card) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learningSteps: card.learning_steps || 0,
    lastReview: card.last_review ? card.last_review.getTime() : void 0
  };
}
function toFSRSParameters(p) {
  return generatorParameters({
    request_retention: p.request_retention,
    maximum_interval: p.maximum_interval,
    learning_steps: p.learning_steps,
    relearning_steps: p.relearning_steps
    // enable_short_term 默认 true：学习/重学步骤生效（Anki 语义）
  });
}
var FsrsScheduler = class {
  constructor(params) {
    this.params = params;
    this.engine = fsrs(toFSRSParameters(params));
  }
  /** 新卡首次复习前的空状态（ts-fsrs createEmptyCard） */
  emptyCardState(now) {
    const card = createEmptyCard(new Date(now));
    return fromTsCard(card);
  }
  /**
   * §四十八：真实调用 FSRS scheduler.next()，保存状态由调用方负责。
   * card 为 null → 首次评分（createEmptyCard 起步，§十三）。
   */
  schedule(rating, card, now) {
    const base = card ? toTsCard(card) : createEmptyCard(new Date(now));
    const reviewTime = new Date(now);
    const preRetr = card && typeof card.lastReview === "number" ? this.retrievability(card, now) ?? 1 : 1;
    const item = this.engine.next(base, reviewTime, toGrade(rating));
    const next = fromTsCard(item.card);
    const prevDue = card ? card.due : null;
    const reviewMs = reviewTime.getTime();
    const dueMs = next.due;
    const lastReviewMs = next.lastReview ?? reviewMs;
    const intervalDays = dueMs >= lastReviewMs ? Number(((dueMs - lastReviewMs) / DAY_MS).toFixed(3)) : 0;
    const log = {
      timestamp: reviewMs,
      rating,
      previousDue: prevDue,
      nextDue: dueMs,
      intervalDays,
      stability: next.stability,
      difficulty: next.difficulty,
      retrievability: Math.max(0, Math.min(1, preRetr))
    };
    return { next, log };
  }
  /**
   * §四十九：真实预览四种评分的下次时间（绝不写死；不落盘，仅 UI 标签）。
   * 用同一当前卡分别模拟四档 → 返回各自 due/intervalDays。
   */
  previewAll(card, now) {
    const base = card ? toTsCard(card) : createEmptyCard(new Date(now));
    const reviewTime = new Date(now);
    const all = this.engine.repeat(base, reviewTime);
    const out = {};
    for (const rating of FSRS_RATINGS) {
      const item = all[toGrade(rating)];
      const dueMs = item.card.due.getTime();
      const lastReviewMs = item.card.last_review ? item.card.last_review.getTime() : reviewTime.getTime();
      const intervalDays = dueMs >= lastReviewMs ? Number(((dueMs - lastReviewMs) / DAY_MS).toFixed(3)) : 0;
      out[rating] = { due: dueMs, intervalDays };
    }
    return out;
  }
  /** 当前保持率（FSRS retrievability 0~1，format=false 取数值）。无历史/新卡 → null */
  retrievability(card, now) {
    if (!card) return null;
    if (card.state === State.New || typeof card.lastReview !== "number") return null;
    const base = toTsCard(card);
    const v = this.engine.get_retrievability(base, new Date(now), false);
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  }
};
function schedulerFromConfig(cfg) {
  const ls = parseLearningSteps(cfg.learningSteps) ?? ["10m", "1h"];
  const rs = parseLearningSteps(cfg.relearningSteps) ?? ["10m"];
  const retention = isValidDesiredRetention(cfg.desiredRetention) ? cfg.desiredRetention : 0.9;
  const maxIvl = isValidMaxIntervalDays(cfg.maxIntervalDays) ? cfg.maxIntervalDays : 3650;
  return new FsrsScheduler({
    request_retention: retention,
    maximum_interval: maxIvl,
    learning_steps: ls,
    relearning_steps: rs
  });
}
function nextMasteryPercent(prev, prevCount, rating) {
  const score = FSRS_RATING_SCORE[rating];
  const n = Math.max(0, prevCount);
  if (n === 0 || typeof prev !== "number" || !Number.isFinite(prev)) return score;
  const merged = (prev * n + score * 2) / (n + 2);
  return Math.round(Math.max(0, Math.min(100, merged)));
}
function masteryConfidence(reviewCount) {
  return reviewCount < MASTERY_CONFIDENCE_MIN ? { low: true, hint: "\u6570\u636E\u8F83\u5C11" } : { low: false, hint: "" };
}
function reviewBandOf(percent) {
  if (percent <= 39) return "relearn";
  if (percent <= 59) return "building";
  if (percent <= 79) return "basic";
  if (percent <= 94) return "proficient";
  return "mastered";
}
function canonicalScope(scope) {
  if (!scope) return '{"mode":"vault"}';
  const o = { mode: scope.mode };
  if (scope.notePath) o["notePath"] = scope.notePath;
  if (scope.folderPath) o["folderPath"] = scope.folderPath;
  if (scope.areaId) o["areaId"] = scope.areaId;
  if (scope.folders && scope.folders.length) o["folders"] = [...scope.folders].sort();
  if (scope.tags && scope.tags.length) o["tags"] = [...scope.tags].sort();
  return JSON.stringify(o);
}
function reviewScopeFingerprint(scope) {
  const s = canonicalScope(scope);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function defaultReviewScope() {
  return { mode: "vault" };
}
function queueKeyFor(periodKey, scope, schedulerFp) {
  return periodKey + "#" + reviewScopeFingerprint(scope) + "#" + (schedulerFp || "off");
}
function selectNewCardsFromRanked(ranked, hasCard, duePaths, snoozed, limit) {
  const n = Math.max(0, Math.floor(limit));
  const out = [];
  for (const c of ranked) {
    if (out.length >= n) break;
    if (hasCard(c.path)) continue;
    if (duePaths.has(c.path)) continue;
    if (snoozed.has(c.path)) continue;
    out.push(c);
  }
  return out;
}
function clampCustomFolders(folders) {
  return folders.slice(0, CUSTOM_SCOPE_FOLDER_LIMIT);
}
function noteInFolder(notePath, folderPath) {
  const fp = (folderPath || "").replace(/\/+$/, "");
  if (!fp) return true;
  if (notePath === fp || notePath === fp + ".md") return true;
  return notePath.startsWith(fp + "/");
}
function scopeNotesPaths(notes, scope) {
  if (!scope) return notes.map((n) => n.path);
  const match = (n) => {
    switch (scope.mode) {
      case "current-note":
        return !!scope.notePath && n.path === scope.notePath;
      case "folder":
        return !!scope.folderPath && noteInFolder(n.path, scope.folderPath);
      case "area":
        return !!scope.folderPath && noteInFolder(n.path, scope.folderPath);
      case "custom": {
        if (scope.folders && scope.folders.length) {
          const hit = scope.folders.some((f) => noteInFolder(n.path, f));
          if (!hit) return false;
        }
        if (scope.tags && scope.tags.length) {
          const has = scope.tags.some((t) => n.tags.includes(t));
          if (!has) return false;
        }
        return true;
      }
      default:
        return true;
    }
  };
  return notes.filter(match).map((n) => n.path);
}
function selectDueCards(cards, scheduler, now, limit, overdueFirst, sortByRetrievability) {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const due = cards.filter((c) => c.fsrsState.due <= now).map((c) => ({
    path: c.path,
    due: c.fsrsState.due,
    retrievability: scheduler.retrievability(c.fsrsState, now) ?? 1,
    overdue: c.fsrsState.due < startOfDay,
    todayDue: c.fsrsState.due >= startOfDay && c.fsrsState.due <= now
  }));
  const bucket = (c) => {
    if (overdueFirst) return c.overdue ? 0 : 1;
    return c.todayDue ? 0 : 1;
  };
  due.sort((a, b) => {
    const ba = bucket(a) - bucket(b);
    if (ba !== 0) return ba;
    if (sortByRetrievability) {
      const d2 = a.retrievability - b.retrievability;
      if (d2 !== 0) return d2;
    }
    return a.due - b.due;
  });
  const n = Math.max(0, Math.floor(limit));
  return due.slice(0, n).map((c) => ({ path: c.path, due: c.due, retrievability: c.retrievability }));
}
function mergeQueueForRefresh(freshItems, previous, relearnPaths) {
  const prevByPath = /* @__PURE__ */ new Map();
  if (previous) {
    for (const p of previous) if (p && !prevByPath.has(p.path)) prevByPath.set(p.path, p);
  }
  const out = [];
  const added = /* @__PURE__ */ new Set();
  for (const it of freshItems) {
    const prev = prevByPath.get(it.path);
    const acted = prev && (prev.status === "completed" || prev.status === "skipped");
    if (acted && !relearnPaths.has(it.path)) continue;
    out.push({ ...it });
    added.add(it.path);
  }
  for (const [p, prev] of prevByPath) {
    if (prev.status !== "completed" && prev.status !== "skipped") continue;
    if (added.has(p)) continue;
    if (relearnPaths.has(p)) {
      const base = freshItems.find((f) => f.path === p);
      if (base) out.push({ ...base, status: "pending", completedAt: void 0, snoozedUntil: void 0 });
      else out.push({ path: p, stateAtSelection: "active", priorityScore: 0, status: "pending", selectedAt: Date.now() });
    } else {
      out.push({
        path: p,
        stateAtSelection: "active",
        priorityScore: 0,
        status: prev.status === "completed" ? "completed" : "skipped",
        completedAt: prev.completedAt,
        selectedAt: Date.now()
      });
    }
    added.add(p);
  }
  return out;
}
function emptyDistribution() {
  return { relearn: 0, building: 0, basic: 0, proficient: 0, mastered: 0 };
}
function masteryDistribution(cards) {
  const dist = emptyDistribution();
  for (const c of cards) {
    if (typeof c.masteryPercent !== "number") continue;
    const band = reviewBandOf(c.masteryPercent);
    dist[band] += 1;
  }
  return dist;
}
function computeSpacedStats(cards, logs, scheduler, now) {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const retr = [];
  const mastery = [];
  let dueCount = 0;
  let lapsesTotal = 0;
  for (const c of cards) {
    if (c.fsrsState.due <= now) dueCount++;
    if (c.fsrsState.lapses > 0) lapsesTotal += c.fsrsState.lapses;
    if (typeof c.masteryPercent === "number") mastery.push(c.masteryPercent);
    const r = scheduler.retrievability(c.fsrsState, now);
    if (r !== null) retr.push(r);
  }
  const reviewsToday = logs.filter((l) => l.timestamp >= startOfDay).length;
  return {
    cardCount: cards.length,
    dueCount,
    newCount: 0,
    avgRetrievability: retr.length ? retr.reduce((a, b) => a + b, 0) / retr.length : null,
    avgMastery: mastery.length ? mastery.reduce((a, b) => a + b, 0) / mastery.length : null,
    reviewsToday,
    lapsesTotal
  };
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

// src/reviewCenter.ts
function dailyPeriodKey(now = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return "daily:" + now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
}
function stateReason(state) {
  switch (state) {
    case "forgotten":
      return "\u21BA \u53EF\u80FD\u6B63\u5728\u88AB\u9057\u5FD8";
    case "stale":
      return "\u25CB \u758F\u4E8E\u7EF4\u62A4";
    case "growing":
      return "\u{1F4C8} \u6B63\u5728\u589E\u957F\uFF0C\u503C\u5F97\u5DE9\u56FA";
    case "new":
      return "\u{1F331} \u65B0\u77E5\u8BC6\uFF0C\u503C\u5F97\u5DE9\u56FA";
    default:
      return "\u25CF \u8FD1\u671F\u6D3B\u8DC3";
  }
}
function areaOf(note, areas) {
  for (const a of areas) {
    if (!a.folder) continue;
    if (note.path === a.folder + ".md" || note.path.startsWith(a.folder + "/") || note.folder === a.folder) return a.name;
  }
  return void 0;
}
function connectCount(n) {
  return n.links.length + n.backlinks.length;
}
function buildReviewCandidate(note, act, areas, rules, now = Date.now()) {
  const state = deriveState(note, act, rules, now);
  const day = 864e5;
  const daysSinceReview = daysSince(act?.lastReviewedAt, now);
  const daysSinceAccess = daysSince(act?.lastAccessedAt, now);
  const conn = connectCount(note);
  const stateWeight = state === "forgotten" ? 0.7 : state === "stale" ? 0.55 : state === "growing" ? 0.42 : state === "new" ? 0.34 : 0.12;
  let staleness = Math.min(daysSinceReview === null ? 120 : daysSinceReview, 120) / 120 * 0.12;
  if (state === "forgotten") staleness += Math.min(daysSinceAccess === null ? 120 : daysSinceAccess, 120) / 120 * 0.1;
  const connection = Math.min(conn, 10) * 0.04;
  const crossArea = new Set(note.backlinks.map((b) => b.split("/")[0]).filter(Boolean)).size >= 2 ? 0.08 : 0;
  const growth = (now - note.modified) / day <= 3 ? 0.05 : 0;
  let recentReviewPenalty = 0;
  if (daysSinceReview !== null) {
    if (daysSinceReview <= 1) recentReviewPenalty = 0.5;
    else if (daysSinceReview <= 3) recentReviewPenalty = 0.4;
    else if (daysSinceReview <= 7) recentReviewPenalty = 0.3;
    else if (daysSinceReview <= 14) recentReviewPenalty = 0.2;
    else if (daysSinceReview <= 30) recentReviewPenalty = 0.1;
  }
  const priorities = ["forgotten", "stale", "growing", "new", "active"];
  const priorityTier = priorities.indexOf(state);
  const priorityScore = (4 - priorityTier) * 10 + stateWeight + staleness + connection + crossArea + growth - recentReviewPenalty;
  const daysTxt = daysSinceReview === null ? "\u4ECE\u672A\u590D\u4E60" : daysSinceReview < 1 ? "\u521A\u521A\u590D\u4E60" : Math.round(daysSinceReview) + " \u5929\u672A\u590D\u4E60";
  const connTxt = conn > 0 ? " \xB7 " + conn + " \u4E2A\u5173\u8054" : "";
  const reason = state === "forgotten" || state === "stale" ? stateReason(state) + " \xB7 " + daysTxt + connTxt : stateReason(state) + (daysSinceReview !== null && daysSinceReview > 1 ? " \xB7 " + daysTxt : "");
  return {
    path: note.path,
    title: note.title,
    area: areaOf(note, areas),
    state,
    lastAccessedAt: act?.lastAccessedAt,
    lastReviewedAt: act?.lastReviewedAt,
    daysSinceReview: daysSinceReview ?? void 0,
    daysSinceAccess: daysSinceAccess ?? void 0,
    reason,
    priorityScore
  };
}
function freshQuota(size) {
  return Math.max(1, Math.ceil(size * 0.3));
}
function rankReviewCandidates(notes, getAct, areas, cfg, rules, skipHistory = {}, now = Date.now()) {
  return notes.map((n) => buildReviewCandidate(n, getAct(n.path), areas, rules, now)).map((c) => skipHistory[c.path] && cfg.skipPenalty && skipHistory[c.path].consecutive >= 3 ? { ...c, priorityScore: c.priorityScore - 0.25 } : c).sort((a, b) => b.priorityScore - a.priorityScore);
}
function buildReviewCandidates(notes, getAct, areas, cfg, rules, skipHistory = {}, now = Date.now()) {
  const all = rankReviewCandidates(notes, getAct, areas, cfg, rules, skipHistory, now);
  const chosen = [];
  const used = /* @__PURE__ */ new Set();
  const freshCount = all.filter((c) => c.state !== "forgotten").length;
  const guaranteedFresh = Math.min(freshQuota(cfg.queueSize), freshCount);
  const forgottenCap = Math.max(0, cfg.queueSize - guaranteedFresh);
  let forgottenTaken = 0;
  for (const c of all) {
    if (chosen.length >= cfg.queueSize) break;
    if (c.state === "forgotten") {
      if (forgottenTaken >= forgottenCap) continue;
      forgottenTaken++;
    }
    chosen.push(c);
    used.add(c.path);
  }
  for (const c of all) {
    if (chosen.length >= cfg.queueSize) break;
    if (used.has(c.path)) continue;
    chosen.push(c);
  }
  return chosen;
}
function recount(queue) {
  return {
    ...queue,
    completedCount: queue.items.filter((i) => i.status === "completed").length,
    skippedCount: queue.items.filter((i) => i.status === "skipped").length
  };
}
function markSkipped(queue, pathKey) {
  const items = queue.items.map(
    (it) => it.path === pathKey && it.status !== "completed" && it.status !== "skipped" ? { ...it, status: "skipped" } : it
  );
  return recount({ ...queue, items });
}
function markSnoozed(queue, pathKey, until) {
  const items = queue.items.map(
    (it) => it.path === pathKey && it.status !== "completed" && it.status !== "skipped" ? { ...it, status: "skipped", snoozedUntil: until } : it
  );
  return recount({ ...queue, items });
}
function nextActiveIndex(queue, from = 0) {
  for (let i = from; i < queue.items.length; i++) {
    if (queue.items[i].status === "pending" || queue.items[i].status === "reviewing") return i;
  }
  return null;
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
function safeResumeIndex(session, queue) {
  if (!session) return 0;
  const queueKey = queue.key ?? queue.periodKey;
  if (session.queueKey !== queueKey) return 0;
  if (session.currentPath) {
    const idx = queue.items.findIndex((i) => i.path === session.currentPath);
    if (idx >= 0) return idx;
  }
  const resumed = session.currentIndex;
  if (!Number.isFinite(resumed) || resumed < 0 || resumed >= queue.items.length) return 0;
  const active = nextActiveIndex(queue, resumed);
  return active === null ? 0 : active;
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
var LIST_STATUS_RANK = { reviewing: 0, pending: 1, skipped: 2, completed: 3 };
function sortReviewQueueForList(items, mode, meta) {
  const ranked = items.map((it, idx) => ({ it, idx, m: meta(it.path) }));
  const byStatus = (x) => LIST_STATUS_RANK[x.it.status] ?? 2;
  const retr = (m) => typeof m.retrievability === "number" ? m.retrievability : Infinity;
  const mastery = (m) => typeof m.mastery === "number" ? m.mastery : Infinity;
  const recent = (m) => typeof m.lastReviewedAt === "number" ? m.lastReviewedAt : -Infinity;
  const due = (m) => typeof m.due === "number" ? m.due : Infinity;
  ranked.sort((a, b) => {
    const sa = byStatus(a) - byStatus(b);
    if (sa !== 0) return sa;
    let d = 0;
    switch (mode) {
      case "forget":
        d = retr(a.m) - retr(b.m);
        if (d !== 0) return d;
        return due(a.m) - due(b.m);
      case "mastery":
        d = mastery(a.m) - mastery(b.m);
        if (d !== 0) return d;
        return due(a.m) - due(b.m);
      case "recent":
        return recent(b.m) - recent(a.m);
      case "next":
        d = due(a.m) - due(b.m);
        if (d !== 0) return d;
        return retr(a.m) - retr(b.m);
      default:
        return a.idx - b.idx;
    }
  });
  return ranked.map((x) => x.it);
}

// src/reviewAnswer.ts
var ANSWER_MAX_CHARS = 800;
var HEADING_RE = /^#{1,6}\s+(.+)$/;
var SEP_RE = /[，。！？；;：:,.!?()（）《》「」"'“”‘’、\s#/\\|~\-—…]+/;
function stripFrontmatter(src) {
  const s = src ?? "";
  if (!s.startsWith("---")) return s;
  const end = s.indexOf("\n---", 3);
  if (end < 0) return s;
  return s.slice(end + 4);
}
function segmentMarkdown(body) {
  const out = [];
  let cur = { heading: null, text: [] };
  const flush = () => {
    const text = cur.text.join("\n").trim();
    if (text) out.push({ heading: cur.heading, text });
    cur = { heading: null, text: [] };
  };
  for (const line of (body ?? "").split("\n")) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      cur.heading = m[1].trim();
    } else {
      cur.text.push(line);
    }
  }
  flush();
  return out;
}
function questionKeywords(question) {
  if (!question) return [];
  const tokens = question.split(SEP_RE).map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const t of tokens) {
    if (/^[\u4e00-\u9fff]+$/.test(t)) {
      if (t.length >= 2) out.push(t);
    } else if (t.length >= 3) {
      out.push(t.toLowerCase());
    }
  }
  return out;
}
function countHits(text, keywords) {
  const lower = text.toLowerCase();
  let n = 0;
  for (const k of keywords) if (lower.includes(k)) n++;
  return n;
}
function sliceWindow(text, keywords, max) {
  const t = text.replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= max) return t;
  let start = 0;
  const lower = t.toLowerCase();
  for (const k of keywords) {
    const idx = lower.indexOf(k);
    if (idx >= 0) {
      start = Math.max(0, idx - Math.floor(max * 0.3));
      break;
    }
  }
  let end = Math.min(t.length, start + max);
  if (end - start < max) start = Math.max(0, end - max);
  return (start > 0 ? "\u2026" : "") + t.slice(start, end).trim() + (end < t.length ? "\u2026" : "");
}
function deriveAnswerFromMarkdown(src, question) {
  const body = stripFrontmatter(src ?? "").trim();
  if (!body) return { excerpt: "", heading: null, found: false };
  const keywords = questionKeywords(question);
  const segments = segmentMarkdown(body);
  let best = segments[0] ?? { heading: null, text: body };
  let bestScore = -1;
  for (const seg of segments) {
    const text2 = seg.text;
    if (!text2) continue;
    let score = countHits(text2, keywords);
    if (seg.heading && keywords.length) score += countHits(seg.heading, keywords) * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  const text = best.text;
  if (text.length <= ANSWER_MAX_CHARS) {
    return { excerpt: text, heading: best.heading, found: true };
  }
  return {
    excerpt: sliceWindow(text, keywords, ANSWER_MAX_CHARS),
    heading: best.heading,
    found: true
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

// tests/p20-tests.ts
if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function eqSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
function tmpRoot(tag) {
  return mkdtemp(path.join(os.tmpdir(), "kg-p20-" + tag + "-"));
}
var DAY = 864e5;
var NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
var CFG = { desiredRetention: 0.9, maxIntervalDays: 3650, learningSteps: "10m,1h", relearningSteps: "10m" };
function sched() {
  return schedulerFromConfig(CFG);
}
function makeGraduated(s, start) {
  const t0 = start;
  const r1 = s.schedule("good", null, t0);
  const t1 = r1.next.due;
  const r2 = s.schedule("good", r1.next, t1 + 6e4);
  const t2 = r2.next.due;
  const r3 = s.schedule("good", r2.next, t2 + 6e4);
  return {
    path: "p.md",
    fsrsState: r3.next,
    lastRating: "good",
    reviewCount: 3,
    lastReviewedAt: t2 + 6e4,
    masteryPercent: 75,
    createdAt: t0,
    updatedAt: t2 + 6e4
  };
}
{
  const prevItems = [
    { path: "A.md", status: "completed", completedAt: 1 },
    { path: "B.md", status: "completed", completedAt: 2 },
    { path: "C.md", status: "pending" },
    { path: "D.md", status: "pending" }
  ];
  const fresh = [
    { path: "C.md", stateAtSelection: "active", priorityScore: 1, status: "pending", selectedAt: NOW },
    { path: "D.md", stateAtSelection: "active", priorityScore: 1, status: "pending", selectedAt: NOW },
    { path: "E.md", stateAtSelection: "forgotten", priorityScore: 2, status: "pending", selectedAt: NOW, dueAt: NOW - DAY }
  ];
  const merged = mergeQueueForRefresh(fresh, prevItems, /* @__PURE__ */ new Set());
  const active = merged.filter((i) => i.status === "pending" || i.status === "reviewing");
  const kept = merged.filter((i) => i.status === "completed");
  test(
    "P20-01",
    active.length === 3 && active[0].path === "C.md" && kept.length === 2,
    "\u5237\u65B0\uFF1AC/D/E \u5F85\u590D\u4E60\u3001A/B \u5DF2\u5B8C\u6210\u72B6\u6001\u4FDD\u7559 \u2192 \u4E0D\u56DE\u5230\u7B2C 1 \u5F20"
  );
  const donePaths = merged.filter((i) => i.status === "completed").map((i) => i.path).sort();
  test(
    "P20-02",
    donePaths.join(",") === "A.md,B.md" && active[0].path === "C.md",
    "\u5DF2\u5B8C\u6210 2 \u5F20\u540E\u5237\u65B0\uFF0C\u4ECD\u4ECE\u7B2C 3 \u5F20\uFF08C\uFF09\u5F00\u59CB\uFF08completed \u4FDD\u7559\u4E8E\u5C3E\u90E8\uFF0C\u8FDB\u5EA6\u4E0D\u91CD\u7F6E\uFF09"
  );
}
{
  const prevItems = [
    { path: "L.md", status: "completed", completedAt: 1 }
  ];
  const fresh = [
    { path: "L.md", stateAtSelection: "active", priorityScore: 1, status: "pending", selectedAt: NOW, dueAt: NOW - 1e3 }
  ];
  const merged = mergeQueueForRefresh(fresh, prevItems, /* @__PURE__ */ new Set(["L.md"]));
  test(
    "P20-01b",
    merged.length === 1 && (merged[0].status === "pending" || merged[0].status === "reviewing"),
    "\u5B66\u4E60\u6B65\u9AA4\u518D\u5230\u671F\uFF08relearnPaths\uFF09\u2192 completed \u91CD\u65B0\u5165\u961F\uFF08FSRS \u5B66\u4E60\u8BED\u4E49\uFF09"
  );
}
{
  const front = "---\ntitle: \u6E38\u620F\u6846\u67B6\ntags: [\u6E38\u620F]\n---\n";
  const body = [
    "## \u4E3A\u4EC0\u4E48\u8981\u5212\u5206\u6A21\u5757\u8FB9\u754C",
    "\u6A21\u5757\u8FB9\u754C\u662F\u4E3A\u4E86\u628A\u53D8\u5316\u9694\u79BB\u5728\u5355\u4E00\u533A\u57DF\u5185\uFF1A\u6BCF\u4E2A\u6A21\u5757\u53EA\u5BF9\u63A5\u53E3\u8D1F\u8D23\uFF0C\u5185\u90E8\u5B9E\u73B0\u53EF\u4EE5\u72EC\u7ACB\u6F14\u8FDB\uFF0C",
    "\u5916\u90E8\u4F9D\u8D56\u65B9\u4E0D\u4F1A\u56E0\u4E3A\u5185\u90E8\u91CD\u6784\u800C\u88AB\u7834\u574F\u3002\u6E05\u6670\u7684\u8FB9\u754C\u8FD8\u80FD\u8BA9\u56E2\u961F\u5E76\u884C\u5F00\u53D1\u4E0D\u540C\u6A21\u5757\u800C\u4E92\u4E0D\u5E72\u6270\uFF0C",
    "\u5E76\u4E14\u4F7F\u6545\u969C\u5F71\u54CD\u9762\u53EF\u63A7\u2014\u2014\u8FB9\u754C\u662F\u7CFB\u7EDF\u7684\u7ED3\u6784\u6027\u9632\u706B\u5899\u3002"
  ].join("\n");
  const src = front + body + "\n";
  const q = "\u4E3A\u4EC0\u4E48\u8981\u5212\u5206\u6A21\u5757\u8FB9\u754C\uFF1F";
  const ans = deriveAnswerFromMarkdown(src, q);
  test("P20-03", ans.found && ans.heading === "\u4E3A\u4EC0\u4E48\u8981\u5212\u5206\u6A21\u5757\u8FB9\u754C", "\u7B54\u6848\u9ED8\u8BA4\u6765\u81EA\u771F\u5B9E\u7B14\u8BB0\u4E14\u5B9A\u4F4D\u5230\u5BF9\u5E94\u6807\u9898\uFF08deriveAnswerFromMarkdown\uFF09");
  test("P20-04", ans.excerpt.includes("\u6A21\u5757\u8FB9\u754C\u662F\u4E3A\u4E86"), "\u6458\u5F55\u547D\u4E2D\u539F\u6587\u6BB5\u843D");
  test(
    "P20-05",
    ans.found && ans.excerpt.length <= ANSWER_MAX_CHARS && src.includes(ans.excerpt.replace(/^…|…$/g, "")),
    "\u7B54\u6848\u6587\u672C\u662F\u539F\u6587\u5B50\u4E32\uFF08\u4E0D\u7F16\u9020\uFF09\uFF0C\u957F\u5EA6\u53D7\u63A7 \u2264 " + ANSWER_MAX_CHARS
  );
  const noBody = deriveAnswerFromMarkdown(front + "\n", q);
  test("P20-05b", !noBody.found && noBody.excerpt === "", "\u65E0\u6B63\u6587 \u2192 found=false\uFF08UI \u663E\u793A [[\u7B14\u8BB0]] \u94FE\u63A5\uFF0C\u7EDD\u4E0D\u7F16\u9020\uFF09");
  const shortNote = deriveAnswerFromMarkdown("\u77ED\u7B14\u8BB0\u4E00\u53E5\u8BDD\u3002", void 0);
  test("P20-05c", shortNote.found && shortNote.excerpt.includes("\u77ED\u7B14\u8BB0"), "\u77ED\u7B14\u8BB0\u5982\u5B9E\u8FD4\u56DE\u539F\u6587\uFF08\u8BC1\u636E\u5B8C\u6574\u4F18\u5148\uFF09");
}
{
  const notes = [
    { path: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", folder: "01 \u76D2\u5B50", tags: ["\u6E38\u620F"] },
    { path: "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md", folder: "01 \u76D2\u5B50", tags: ["\u6E38\u620F"] },
    { path: "01 \u76D2\u5B50/\u5176\u4ED6.md", folder: "01 \u76D2\u5B50", tags: [] },
    { path: "02 \u8D44\u6599/\u8C03\u7814.md", folder: "02 \u8D44\u6599", tags: ["\u8D44\u6599"] },
    { path: "\u6839\u7B14\u8BB0.md", folder: "", tags: [] }
  ];
  const cur = { mode: "current-note", notePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" };
  const curPaths = scopeNotesPaths(notes, cur);
  test("P20-06", curPaths.length === 1 && curPaths[0] === "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", "current-note\uFF1A\u961F\u5217\u53EA\u542B\u8BE5\u6765\u6E90\uFF08\xA722\uFF09");
  const folder = { mode: "folder", folderPath: "01 \u76D2\u5B50/\u6E38\u620F" };
  const folderPaths = scopeNotesPaths(notes, folder);
  test(
    "P20-07",
    eqSet(folderPaths, ["01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md"]),
    "folder\uFF1A\u4E0D\u542B\u6587\u4EF6\u5939\u5916\u7B14\u8BB0\uFF08\xA723\uFF0C\u9012\u5F52\u5B50\u76EE\u5F55\uFF09"
  );
  const area = { mode: "area", areaId: "a1", folderPath: "01 \u76D2\u5B50" };
  const areaPaths = scopeNotesPaths(notes, area);
  test(
    "P20-08",
    areaPaths.length === 3 && areaPaths.every((p) => p.startsWith("01 \u76D2\u5B50/")),
    "area\uFF1A\u53EA\u542B KnowledgeArea.folder \u8303\u56F4\uFF08\xA724\uFF09"
  );
  const custom = { mode: "custom", folders: ["01 \u76D2\u5B50/\u6E38\u620F", "02 \u8D44\u6599"] };
  const customPaths = scopeNotesPaths(notes, custom);
  test(
    "P20-09",
    eqSet(customPaths, ["01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md", "02 \u8D44\u6599/\u8C03\u7814.md"]),
    "custom\uFF1A\u591A\u6587\u4EF6\u5939\u53EA\u542B\u8FD9\u4E9B\u6765\u6E90\uFF08\xA725\uFF09"
  );
  const customTag = { mode: "custom", folders: ["01 \u76D2\u5B50"], tags: ["\u6E38\u620F"] };
  const tagPaths = scopeNotesPaths(notes, customTag);
  test("P20-09b", tagPaths.length === 2 && tagPaths.every((p) => p.startsWith("01 \u76D2\u5B50/\u6E38\u620F/")), "custom+tags\uFF1A\u6807\u7B7E\u8FC7\u6EE4\u751F\u6548");
  const many = Array.from({ length: 13 }, (_, i) => "f" + i);
  test("P20-09c", clampCustomFolders(many).length === CUSTOM_SCOPE_FOLDER_LIMIT, "custom\uFF1A\u6587\u4EF6\u5939\u6700\u591A 10 \u4E2A\uFF08\xA725\uFF09");
}
{
  const dir = tmpRoot("scope");
  const store = new ReviewCenterStore(dir);
  store.load();
  const q = {
    periodKey: "daily:2026-01-15",
    createdAt: NOW,
    items: [
      { path: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", stateAtSelection: "forgotten", priorityScore: 5, status: "reviewing", selectedAt: NOW, dueAt: NOW - DAY },
      { path: "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md", stateAtSelection: "forgotten", priorityScore: 4, status: "pending", selectedAt: NOW }
    ],
    completedCount: 0,
    skippedCount: 0,
    scope: { mode: "folder", folderPath: "01 \u76D2\u5B50/\u6E38\u620F" },
    key: "daily:2026-01-15#s1#f1",
    source: "spaced"
  };
  store.setQueue(q);
  store.setSession({
    periodKey: q.periodKey,
    currentIndex: 0,
    queueKey: q.key,
    updatedAt: NOW,
    scope: { mode: "folder", folderPath: "01 \u76D2\u5B50/\u6E38\u620F" },
    currentPath: "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md"
  });
  const store2 = new ReviewCenterStore(dir);
  store2.load();
  const sess = store2.getSession();
  test(
    "P20-10",
    !!sess && sess.scope?.mode === "folder" && sess.scope.folderPath === "01 \u76D2\u5B50/\u6E38\u620F" && sess.currentPath === "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md" && sess.queueKey === q.key,
    "\u5173\u95ED\u518D\u6253\u5F00\uFF1Ascope / currentPath / queueKey \u6062\u590D\uFF08\xA797\uFF09"
  );
  const resumed = safeResumeIndex(sess, q);
  test(
    "P20-10b",
    resumed === 1 && q.items[resumed].path === "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md",
    "currentPath \u4F18\u5148 \u2192 \u5237\u65B0\u91CD\u6392\u540E\u4ECD\u56DE\u5230\u540C\u4E00\u5F20\u5361\uFF08\xA734\uFF09"
  );
  const other = { ...q, key: "daily:2026-01-15#s2#f1" };
  test("P20-10c", safeResumeIndex(sess, other) === 0, "\u4E0D\u540C scope/config \u6307\u7EB9 \u2192 \u4E0D\u590D\u7528\u65E7 session\uFF08\xA731/38\uFF09");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const s = sched();
  const firstGood = s.schedule("good", null, NOW);
  test(
    "P20-11",
    firstGood.next.due > NOW && Math.abs(firstGood.next.due - (NOW + DAY)) > 30 * 6e4,
    "\u65B0\u5361\u7B2C\u4E00\u6B21 Good \u2192 FSRS \u771F\u5B9E due\uFF08\u975E\u56FA\u5B9A 1 \u5929\uFF1B\u6B64\u5904\u4E3A\u5B66\u4E60\u6B65\u9AA4\uFF0C\u8DDD 1 \u5929\u5DEE >30 \u5206\u949F\uFF09"
  );
  const four = /* @__PURE__ */ new Map();
  for (const r of ["again", "hard", "good", "easy"]) {
    four.set(r, s.schedule(r, null, NOW).next.due);
  }
  test("P20-12", four.get("again") > NOW, "Again\uFF1A\u751F\u6210 due");
  test("P20-13", four.get("hard") > NOW, "Hard\uFF1A\u751F\u6210 due");
  test("P20-14", four.get("good") > NOW, "Good\uFF1A\u751F\u6210 due");
  test("P20-15", four.get("easy") > NOW, "Easy\uFF1A\u751F\u6210 due");
  test("P20-12b", new Set(four.values()).size === 4, "\u56DB\u79CD Rating \u4EA7\u751F\u56DB\u79CD\u4E0D\u540C due\uFF08\u975E\u56FA\u5B9A 1 \u5929\uFF09");
  test("P20-12c", four.get("again") < four.get("good") && four.get("easy") > four.get("good"), "\u65B0\u5361\u6863\u4F4D\uFF1Aagain \u660E\u663E\u63D0\u524D\u3001easy \u660E\u663E\u63A8\u540E");
  const graduate = makeGraduated(s, NOW - 40 * DAY);
  const goodDue = s.schedule("good", graduate.fsrsState, NOW + DAY).next.due;
  const easyDue = s.schedule("easy", graduate.fsrsState, NOW + DAY).next.due;
  const againRes = s.schedule("again", graduate.fsrsState, NOW + DAY);
  test(
    "P20-16",
    easyDue > goodDue && againRes.next.due < goodDue,
    "Review \u6001\uFF1AEasy \u540E due \u665A\u4E8E Good\uFF1BAgain \u540E due \u660E\u663E\u63D0\u524D\uFF08\u771F\u5B9E FSRS\uFF09"
  );
  const r0 = s.retrievability(graduate.fsrsState, NOW);
  const r10 = s.retrievability(graduate.fsrsState, NOW + 10 * DAY);
  const r30 = s.retrievability(graduate.fsrsState, NOW + 30 * DAY);
  test("P20-17", r0 > r10 && r10 > r30, "retrievability \u968F\u65F6\u95F4\u5355\u8C03\u4E0B\u964D\uFF08" + r0.toFixed(3) + "\u2192" + r10.toFixed(3) + "\u2192" + r30.toFixed(3) + "\uFF09");
  const againLog = againRes.log;
  const logKeys = ["timestamp", "rating", "previousDue", "nextDue", "intervalDays", "stability", "difficulty", "retrievability"];
  test(
    "P20-17b",
    logKeys.every((k) => k in againLog) && !("apiKey" in againLog) && !("prompt" in againLog) && !("content" in againLog) && !("noteBody" in againLog),
    "Review Log \u5B57\u6BB5\u767D\u540D\u5355\uFF08\xA78\uFF1A\u7EDD\u4E0D\u8BB0\u5F55 API Key / Prompt / \u5168\u6587\uFF09"
  );
}
{
  const s = sched();
  const cards = [
    { path: "S2.md", fsrsState: { due: NOW - DAY, stability: 2, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
    { path: "S10.md", fsrsState: { due: NOW - DAY, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
    { path: "S60.md", fsrsState: { due: NOW - DAY, stability: 60, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } }
  ];
  const retr = new Map(cards.map((c) => [c.path, s.retrievability(c.fsrsState, NOW)]));
  const sorted = selectDueCards(cards, s, NOW, 10, true, true);
  test(
    "P20-18",
    sorted[0].path === "S2.md" && retr.get("S2.md") < retr.get("S10.md") && retr.get("S10.md") < retr.get("S60.md"),
    "\u6700\u53EF\u80FD\u5FD8\u8BB0\uFF08\u4FDD\u6301\u7387\u6700\u4F4E\uFF09\u7684\u5361\u6392\u6700\u524D\uFF08" + retr.get("S2.md")?.toFixed(2) + " < " + retr.get("S10.md")?.toFixed(2) + " < " + retr.get("S60.md")?.toFixed(2) + "\uFF09"
  );
  const capped = selectDueCards(cards, s, NOW, 2, true, true);
  test("P20-19", capped.length === 2 && capped[0].path === "S2.md", "\u6BCF\u65E5\u6700\u5927\u590D\u4E60\uFF1A\u8D85\u8FC7\u4E0A\u9650\u622A\u65AD\uFF08limit=2 \u2192 2 \u5F20\uFF09");
  const cards2 = [
    { path: "overdue.md", fsrsState: { due: NOW - 5 * DAY, stability: 60, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } },
    { path: "today.md", fsrsState: { due: NOW - 36e5, stability: 2, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 20 * DAY } }
  ];
  const ofFirst = selectDueCards(cards2, s, NOW, 10, true, true);
  const offFirst = selectDueCards(cards2, s, NOW, 10, false, true);
  test(
    "P20-18b",
    ofFirst[0].path === "overdue.md" && offFirst[0].path === "today.md",
    "overdueFirst=ON\uFF1A\u903E\u671F\u4F18\u5148\uFF1BOFF\uFF1A\u4ECA\u65E5\u5230\u671F\u4F18\u5148\uFF08\xA772\uFF09"
  );
}
{
  const ranked = Array.from({ length: 6 }, (_, i) => ({ path: "n" + i + ".md", priorityScore: 10 - i, state: "new" }));
  const sel = selectNewCardsFromRanked(ranked, () => false, /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set(), 3);
  test("P20-20", sel.length === 3 && sel[0].path === "n0.md", "\u8D85\u8FC7\u6BCF\u65E5\u65B0\u5361\u4E0A\u9650\u622A\u65AD\uFF08limit=3 \u2192 3 \u5F20\uFF09");
  const sel2 = selectNewCardsFromRanked(ranked, (p) => p === "n0.md", /* @__PURE__ */ new Set(["n1.md"]), /* @__PURE__ */ new Set(["n2.md"]), 10);
  test(
    "P20-20b",
    sel2.length === 3 && sel2.every((x) => !["n0.md", "n1.md", "n2.md"].includes(x.path)),
    "\u65B0\u5361\u6392\u9664\uFF1A\u5DF2\u6709 FSRS \u5361 / \u5DF2\u9009 due / snooze \u672A\u5230\u671F"
  );
}
{
  const dir = tmpRoot("neutral");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  const rc = new ReviewCenterStore(dir);
  rc.load();
  const activity = new ActivityStore(dir);
  activity.load();
  const s = sched();
  const cardA = makeGraduated(s, NOW - 40 * DAY);
  cardA.path = "A.md";
  spaced.commitReview("A.md", cardA, { timestamp: NOW, rating: "good", previousDue: NOW - DAY, nextDue: NOW + DAY, intervalDays: 1, stability: 10, difficulty: 5, retrievability: 0.9 });
  const fileBefore = readStateText(path.join(dir, "cache", "spaced-review.json"));
  const q = {
    periodKey: "daily:2026-01-15",
    createdAt: NOW,
    items: [{ path: "A.md", stateAtSelection: "forgotten", priorityScore: 5, status: "reviewing", selectedAt: NOW, dueAt: cardA.fsrsState.due }],
    completedCount: 0,
    skippedCount: 0,
    scope: defaultReviewScope(),
    key: "daily:2026-01-15#v#f",
    source: "spaced"
  };
  const freshQueue = () => JSON.parse(JSON.stringify(q));
  rc.setQueue(markSkipped(freshQueue(), "A.md"));
  test(
    "P20-21",
    readStateText(path.join(dir, "cache", "spaced-review.json")) === fileBefore && spaced.count() === 1 && spaced.get("A.md")?.fsrsState.due === cardA.fsrsState.due,
    "Skip\uFF1A\u4E0D\u8C03\u7528 FSRS\u3001\u4E0D\u6539 stability/difficulty/due\uFF08\xA710/21\uFF09"
  );
  test("P20-24", activity.get("A.md")?.reviewCount === void 0, "Skip\uFF1AreviewCount \u4E0D\u53D8\uFF08\xA724\uFF09");
  rc.setQueue(markSnoozed(freshQueue(), "A.md", NOW + 3 * DAY));
  test(
    "P20-22",
    readStateText(path.join(dir, "cache", "spaced-review.json")) === fileBefore && rc.getQueue()?.items.find((i) => i.path === "A.md")?.snoozedUntil > NOW,
    "Snooze\uFF1A\u4E0D\u8C03\u7528 FSRS\uFF0C\u53EA\u6539 session/queue\uFF08\xA711/22\uFF09"
  );
  const res = s.schedule("good", spaced.get("A.md")?.fsrsState ?? null, NOW + DAY);
  const nextCard = {
    path: "A.md",
    fsrsState: res.next,
    lastRating: "good",
    reviewCount: (spaced.get("A.md")?.reviewCount ?? 0) + 1,
    lastReviewedAt: NOW + DAY,
    masteryPercent: nextMasteryPercent(spaced.get("A.md")?.masteryPercent, spaced.get("A.md")?.reviewCount ?? 0, "good"),
    createdAt: cardA.createdAt,
    updatedAt: NOW + DAY
  };
  spaced.commitReview("A.md", nextCard, { ...res.log, path: "A.md" });
  activity.markReviewed("A.md");
  test(
    "P20-23",
    spaced.get("A.md")?.reviewCount === 4 && activity.get("A.md")?.reviewCount === 1,
    "FSRS rating \u2192 FSRS \u5361 reviewCount+1 \u4E14 activity.reviewCount+1\uFF08\xA723\uFF09"
  );
  const fileAfterRating = readStateText(path.join(dir, "cache", "spaced-review.json"));
  const activityAfter = activity.get("A.md")?.reviewCount;
  rc.setQueue(freshQueue());
  test(
    "P20-25",
    readStateText(path.join(dir, "cache", "spaced-review.json")) === fileAfterRating && activity.get("A.md")?.reviewCount === activityAfter && spaced.logsAll().length === 2,
    "Refresh\uFF1A\u4E0D\u6539 FSRS\u3001\u4E0D\u52A0 review log\u3001\u4E0D\u6539 reviewCount\uFF08\xA725/35\uFF09"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const m1 = nextMasteryPercent(80, 5, "again");
  const m2 = nextMasteryPercent(20, 5, "easy");
  test("P20-26", m1 < 80 && m2 > 20, "Again \u2192 \u638C\u63E1\u5EA6\u4E0B\u964D\uFF1BEasy \u2192 \u638C\u63E1\u5EA6\u4E0A\u5347\uFF08" + m1 + " < 80\uFF1B" + m2 + " > 20\uFF09");
  test(
    "P20-27",
    masteryConfidence(2).low && masteryConfidence(2).hint === "\u6570\u636E\u8F83\u5C11" && !masteryConfidence(5).low,
    "reviewCount<3 \u2192 \u6570\u636E\u8F83\u5C11\uFF1B\u22653 \u2192 \u4E0D\u663E\u793A\uFF08\xA757\uFF09"
  );
  test("P20-26b", nextMasteryPercent(void 0, 0, "good") === FSRS_RATING_SCORE.good, "\u9996\u6B21\u8BC4\u5206\u76F4\u63A5\u91C7\u7528\u5BF9\u5E94\u6863\u4F4D\u5206\u6570");
  const mkCard = (path2, mastery, stability) => ({
    path: path2,
    fsrsState: {
      due: NOW + 5 * DAY,
      stability,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      state: 2,
      learningSteps: 0,
      lastReview: NOW - 30 * DAY
    },
    lastRating: "good",
    reviewCount: 3,
    lastReviewedAt: NOW - 30 * DAY,
    masteryPercent: mastery,
    createdAt: NOW - 100 * DAY,
    updatedAt: NOW - 30 * DAY
  });
  const s = sched();
  const card = mkCard("a.md", 7, 60);
  const retrNow = s.retrievability(card.fsrsState, NOW);
  test(
    "P20-30",
    Math.abs(card.masteryPercent - Math.round(retrNow * 100)) > 30,
    "\u638C\u63E1\u5EA6(7) \u4E0E\u5F53\u524D\u4FDD\u6301\u7387(" + Math.round(retrNow * 100) + "%) \u663E\u8457\u5206\u79BB\uFF1A\u4E24\u6307\u6807\u72EC\u7ACB\u5B58\u50A8/\u5C55\u793A\uFF08\xA755/130\uFF09"
  );
  const dist = masteryDistribution([
    mkCard("r.md", 25, 2),
    mkCard("b.md", 45, 2),
    mkCard("ba.md", 70, 2),
    mkCard("p.md", 90, 2),
    mkCard("m.md", 98, 2),
    {}
  ]);
  test(
    "P20-28",
    dist.relearn === 1 && dist.building === 1 && dist.basic === 1 && dist.proficient === 1 && dist.mastered === 1,
    "\u638C\u63E1\u5206\u5E03\u6761\uFF1A\u4E94\u6863\u8BA1\u6570\u6B63\u786E\uFF08\xA760 \u8FB9\u754C\u4E0E examEngine \u4E00\u81F4\uFF09"
  );
  const stats = computeSpacedStats([card, mkCard("x.md", 90, 60)], [], s, NOW);
  test(
    "P20-29",
    stats.avgRetrievability !== null && stats.avgMastery !== null && stats.cardCount === 2 && stats.dueCount === 0,
    "\u4ECA\u65E5\u4FDD\u6301\u7387/\u638C\u63E1\u5EA6\u805A\u5408\u53EF\u7528\uFF08\xA729/100\uFF09"
  );
  test(
    "P20-29b",
    reviewBandOf(39) === "relearn" && reviewBandOf(40) === "building" && reviewBandOf(79) === "basic" && reviewBandOf(80) === "proficient" && reviewBandOf(95) === "mastered",
    "\u638C\u63E1\u5E26\u8FB9\u754C = 0-39/40-59/60-79/80-94/95-100\uFF08\u4E0E examEngine.masteryLabel \u540C\u754C\uFF0C\u65E0\u7B2C\u4E8C\u5957\u9608\u503C\uFF09"
  );
}
{
  test("P20-31", isValidDesiredRetention(0.9) && schedulerConfigFingerprint(CFG).length > 0, "desiredRetention=0.9 \u5408\u6CD5");
  test(
    "P20-32",
    !isValidDesiredRetention(0.69) && !isValidDesiredRetention(0.98) && isValidDesiredRetention(0.7) && isValidDesiredRetention(0.97),
    "0.69 / 0.98 \u62D2\u7EDD\uFF1B0.7 / 0.97 \u63A5\u53D7"
  );
  test(
    "P20-33",
    isValidMaxIntervalDays(30) && isValidMaxIntervalDays(36500) && !isValidMaxIntervalDays(29) && !isValidMaxIntervalDays(36501),
    "\u6700\u5927\u95F4\u9694 30~36500 \u6821\u9A8C"
  );
  test("P20-34a", parseLearningSteps("10m,1h")?.join(",") === "10m,1h", "\u5B66\u4E60\u6B65\u9AA4\u5408\u6CD5\u683C\u5F0F\u63A5\u53D7");
  test(
    "P20-34b",
    parseLearningSteps("0") === null && parseLearningSteps("") === null && parseLearningSteps(" ") === null && parseLearningSteps("-5m") === null && parseLearningSteps("1x") === null,
    "\u5B66\u4E60\u6B65\u9AA4\u62D2\u7EDD 0 / \u7A7A / \u8D1F\u6570 / \u975E\u6CD5\u5355\u4F4D"
  );
  test(
    "P20-34c",
    isValidDailyNewCards(0) && isValidDailyNewCards(100) && !isValidDailyNewCards(101) && !isValidDailyNewCards(-1),
    "\u6BCF\u65E5\u65B0\u5361 0~100"
  );
  test(
    "P20-34d",
    isValidMaxReviewsPerDay(1) && isValidMaxReviewsPerDay(500) && !isValidMaxReviewsPerDay(0) && !isValidMaxReviewsPerDay(501),
    "\u6BCF\u65E5\u6700\u5927\u590D\u4E60 1~500"
  );
}
{
  const dir = tmpRoot("legacy");
  seedStateText(path.join(dir, "cache", "review-queue.json"), JSON.stringify({
    queue: {
      periodKey: "daily:2026-01-15",
      createdAt: NOW,
      items: [
        { path: "\u65E7\u7B14\u8BB0.md", stateAtSelection: "forgotten", priorityScore: 5, status: "reviewing", selectedAt: NOW },
        { path: "\u65E7\u7B14\u8BB02.md", stateAtSelection: "new", priorityScore: 3, status: "pending", selectedAt: NOW }
      ],
      completedCount: 0,
      skippedCount: 0
    },
    skipHistory: { "\u65E7\u7B14\u8BB0.md": { consecutive: 2, lastSkippedDate: "2026-01-14" } }
  }), "utf8");
  const rc = new ReviewCenterStore(dir);
  const isolated = rc.load();
  const q = rc.getQueue();
  test(
    "P20-35",
    !isolated && q !== null && q.items.length === 2 && q.periodKey === "daily:2026-01-15" && rc.getSkipHistory()["\u65E7\u7B14\u8BB0.md"]?.consecutive === 2,
    "\u65E7 cache\uFF08\u65E0 key/scope/source \u5B57\u6BB5\uFF09\u6B63\u5E38\u52A0\u8F7D\uFF0C\u4E0D\u5220\u9664\u65E7 Review Queue\uFF08\xA714\uFF09"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpRoot("corrupt");
  seedStateText(path.join(dir, "cache", "spaced-review.json"), "{ not json !!");
  const spaced = new SpacedReviewStore(dir);
  const isolated = spaced.load();
  const corruptFiles = stateList(path.join(dir, "cache", ".corrupt"));
  test(
    "P20-36",
    isolated && corruptFiles.length === 1 && spaced.count() === 0 && spaced.logsAll().length === 0,
    "\u635F\u574F\u6587\u4EF6\u9694\u79BB\u5230 cache/.corrupt/\uFF08\u4FDD\u7559\u526F\u672C\uFF09\uFF0C\u6062\u590D\u7A7A\u72B6\u6001\uFF08\xA712/\xA736\uFF09"
  );
  const s = sched();
  const card = makeGraduated(s, NOW);
  spaced.commitReview("A.md", { ...card, path: "A.md" }, { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 10, difficulty: 5, retrievability: 0.9 });
  const files = stateList(path.join(dir, "cache"));
  test(
    "P20-37",
    files.includes("spaced-review.json") && !files.some((f) => f.endsWith(".tmp")),
    "\u539F\u5B50\u5199\uFF1A\u65E0 .tmp \u6B8B\u7559\uFF08\xA737\uFF09"
  );
  const reload = new SpacedReviewStore(dir);
  reload.load();
  test(
    "P20-37b",
    reload.count() === 1 && reload.logsAll().length === 1 && reload.get("A.md")?.fsrsState.due === card.fsrsState.due,
    "\u91CD\u542F\u6062\u590D\uFF1A\u5361 + \u65E5\u5FD7\u5B8C\u6574"
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const sA = { mode: "folder", folderPath: "01 \u76D2\u5B50" };
  const sB = { mode: "folder", folderPath: "02 \u8D44\u6599" };
  const sC = { mode: "custom", folders: ["x", "b"], tags: ["t"] };
  const sD = { mode: "custom", folders: ["b", "x"], tags: ["t"] };
  test(
    "P20-38",
    reviewScopeFingerprint(sA) !== reviewScopeFingerprint(sB) && reviewScopeFingerprint(sC) === reviewScopeFingerprint(sD) && canonicalScope(sC) === canonicalScope(sD),
    "Scope \u6307\u7EB9\uFF1A\u4E0D\u540C\u8303\u56F4\u4E0D\u540C key\uFF1B\u540C\u8303\u56F4\uFF08\u6392\u5E8F\u65E0\u5173\uFF09\u76F8\u540C\uFF08\xA729/38\uFF09"
  );
  const f1 = schedulerConfigFingerprint({ ...CFG });
  const f2 = schedulerConfigFingerprint({ ...CFG, desiredRetention: 0.85 });
  test(
    "P20-39",
    f1 !== f2 && queueKeyFor("daily:2026-01-15", sA, f1) !== queueKeyFor("daily:2026-01-15", sA, f2) && queueKeyFor("daily:2026-01-15", sA, f1) === queueKeyFor("daily:2026-01-15", sA, f1),
    "desiredRetention \u53D8\u5316 \u2192 \u65B0 scheduler config \u6307\u7EB9 \u2192 \u65B0\u961F\u5217\u952E\uFF08\xA730/39\uFF09"
  );
  const diffScope = queueKeyFor("daily:2026-01-15", sA, f1) !== queueKeyFor("daily:2026-01-15", sB, f1);
  test("P20-38b", diffScope, "Scope \u53D8\u5316 \u2192 queue key \u53D8\u5316\uFF08\u4E0D\u6CBF\u7528\u65E7 queue\uFF0C\xA731\uFF09");
}
{
  const s = sched();
  const r = s.schedule("good", null, NOW);
  const pure = r.next.due > NOW;
  test("P20-40", pure && !("ai" in r) && !("prompt" in r), "FSRS \u8C03\u5EA6\u4E3A\u672C\u5730\u7EAF\u8BA1\u7B97\uFF08ts-fsrs\uFF0C\u65E0 AI \u5B57\u6BB5/\u8C03\u7528\uFF09");
}
{
  const notes = [
    { path: "A.md", title: "A", folder: "f", tags: [], links: [], backlinks: [], created: NOW - 100 * DAY, modified: NOW - 100 * DAY, size: 100, wordCount: 200 },
    { path: "B.md", title: "B", folder: "f", tags: [], links: [], backlinks: [], created: NOW - 5 * DAY, modified: NOW - 2 * DAY, size: 100, wordCount: 200 }
  ];
  const acts = { "A.md": { lastReviewedAt: NOW - 40 * DAY } };
  const cfg = { queueSize: 5, autoQueue: true, aiQuestion: true, maxQuestions: 5, skipPenalty: true, autoOpenReview: false, showAnswerByDefault: true };
  const rules = { newDays: 7, staleDays: 14, forgottenDays: 30, recentLimit: 8 };
  const ranked = rankReviewCandidates(notes, (p) => acts[p], [], cfg, rules, {}, NOW);
  const cands = buildReviewCandidates(notes, (p) => acts[p], [], cfg, rules, {}, NOW);
  const sorted = [...ranked].sort((a, b) => b.priorityScore - a.priorityScore);
  test(
    "P20-45",
    ranked.length === 2 && ranked[0].path === sorted[0].path && cands.length === 2 && cands[0].path === ranked[0].path,
    "\u56DE\u5F52\uFF1AbuildReviewCandidates \u987A\u5E8F\u4E0E rankReviewCandidates \u4E00\u81F4\uFF08\u91CD\u6784\u65E0\u884C\u4E3A\u53D8\u5316\uFF09"
  );
}
{
  const mkItem = (path2, status) => ({
    path: path2,
    stateAtSelection: "active",
    priorityScore: 1,
    status,
    selectedAt: NOW
  });
  const meta = {
    "low.md": { due: NOW + DAY, retrievability: 0.4, mastery: 30, lastReviewedAt: NOW - 2 * DAY },
    "high.md": { due: NOW + 2 * DAY, retrievability: 0.95, mastery: 90, lastReviewedAt: NOW - 9 * DAY },
    "mid.md": { due: NOW + DAY, retrievability: 0.7, mastery: 60, lastReviewedAt: NOW - 5 * DAY },
    "done.md": { due: NOW - DAY, retrievability: 0.1, mastery: 100, lastReviewedAt: NOW }
  };
  const items = [mkItem("low.md", "pending"), mkItem("high.md", "pending"), mkItem("done.md", "completed"), mkItem("mid.md", "pending")];
  const byForget = sortReviewQueueForList(items, "forget", (p) => meta[p]);
  test(
    "P20-46",
    byForget[0].path === "low.md" && byForget[byForget.length - 1].path === "done.md",
    "\u5217\u8868\u6392\u5E8F\uFF1A\u9ED8\u8BA4\u300C\u6700\u53EF\u80FD\u5FD8\u8BB0\u300D\u2192 \u5F85\u590D\u4E60\u6309\u4FDD\u6301\u7387\u5347\u5E8F\uFF0C\u5DF2\u5B8C\u6210\u6C89\u5E95\uFF08\xA761\uFF09"
  );
  const byNext = sortReviewQueueForList(items, "next", (p) => meta[p]);
  test("P20-46b", byNext[0].path === "low.md" || byNext[0].path === "mid.md", "\u6309\u4E0B\u6B21\u590D\u4E60\u6392\u5E8F\u53EF\u7528");
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
