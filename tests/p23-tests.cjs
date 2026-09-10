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

// tests/p23-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

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
function examQuestionFingerprint(q2) {
  return hashText(normalizeExamText(q2.question));
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
    for (const q2 of e.questions ?? []) {
      if (!q2.question) continue;
      fpParts.push(examQuestionFingerprint(q2));
      if (prior.length < 100) prior.push({ question: String(q2.question).slice(0, 240), concept: q2.concept, type: q2.type });
      const c = (q2.concept ?? "").trim();
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
function planExamBatches(count) {
  const n = Math.max(1, Math.floor(count));
  if (n <= 15) return [n];
  const out = [];
  let rest = n;
  while (rest > 0) {
    const take = Math.min(10, rest);
    out.push(take);
    rest -= take;
  }
  return out;
}
function splitUnitForRetry(unit) {
  if (unit <= 1) return [];
  if (unit === 10) return [5, 5];
  if (unit === 5) return [3, 2];
  if (unit === 3) return [2, 1];
  const half = Math.ceil(unit / 2);
  return [half, unit - half];
}
var EXAM_MAX_BATCH_REQUESTS = 8;
var EXAM_REPLACEMENT_ROUNDS = 3;
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
  for (const q2 of candidates) {
    const fp = examQuestionFingerprint(q2);
    if (fpSeen.has(fp)) {
      duplicates.push(q2);
      continue;
    }
    const conceptN = normalizeExamText(q2.concept ?? "");
    if (policy !== "allow") {
      const nearWith = (otherQ, otherC, otherType) => {
        if (policy === "balanced" && q2.type && otherType && q2.type !== otherType) return false;
        return isNearDuplicate(otherQ, q2.question, otherC, q2.concept);
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
        duplicates.push(q2);
        continue;
      }
    }
    if (q2.concept) {
      const types = conceptTypeSeen.get(conceptN);
      const qtype = q2.type ?? "";
      const conflict = policy === "strict" ? historyConceptSet.has(conceptN) || !!types : policy === "balanced" ? !!types && types.has(qtype) : false;
      if (policy !== "allow" && conflict) {
        duplicates.push(q2);
        continue;
      }
      const set = conceptTypeSeen.get(conceptN) ?? /* @__PURE__ */ new Set();
      set.add(qtype);
      conceptTypeSeen.set(conceptN, set);
    }
    kept.push(q2);
    fpSeen.add(fp);
  }
  return { questions: kept, removedCount: duplicates.length, duplicates };
}
function extractHeadings(md, limit = 50) {
  const out = [];
  for (const line of (md ?? "").split("\n")) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (m) {
      const h = m[1].trim().replace(/[#*_`]/g, "").trim();
      if (h && !out.includes(h)) out.push(h);
      if (out.length >= limit) break;
    }
  }
  return out;
}
function uncoveredTopics(headings, history) {
  const covered = /* @__PURE__ */ new Set();
  for (const c of history.priorConcepts) covered.add(normalizeExamText(c));
  for (const t of history.priorCoverageTopics) covered.add(normalizeExamText(t));
  return headings.filter((h) => {
    const n = normalizeExamText(h);
    if (!n) return false;
    if (covered.has(n)) return false;
    return ![...covered].some((c) => c.includes(n) || n.includes(c));
  });
}
function assignBatchTopics(candidates, batchIndex, batchCount) {
  if (!candidates.length || batchCount <= 1) return candidates.slice(0, 6);
  const per = Math.max(1, Math.ceil(candidates.length / batchCount));
  const start = Math.min(candidates.length, batchIndex * per);
  const slice = candidates.slice(start, start + per);
  if (slice.length < 3) {
    for (const c of candidates) {
      if (slice.length >= 3) break;
      if (!slice.includes(c)) slice.push(c);
    }
  }
  return slice.slice(0, 6);
}

// src/ai/provider.ts
var AIError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
function truncationError(finishReason) {
  if (finishReason === "length") {
    return new AIError(
      "\u5F53\u524D\u6279\u6B21\u8F93\u51FA\u88AB\u957F\u5EA6\u4E0A\u9650\u622A\u65AD\uFF08finish_reason=length\uFF09\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5C1D\u8BD5\u62C6\u5206/\u91CD\u8BD5\u8BE5\u6279\u6B21\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u8BF7\u964D\u4F4E\u603B\u9898\u6570\u6216\u68C0\u67E5\u6A21\u578B\u8F93\u51FA\u7A97\u53E3\u3002",
      "TRUNCATED"
    );
  }
  return null;
}

// src/examEngine.ts
var VALID_EXAM_TYPES = [
  "recall",
  "explanation",
  "comparison",
  "application",
  "true_false",
  "multiple_choice",
  "counterexample"
];
function normalizedExamQuestion(q2) {
  return (q2 || "").replace(/[ \t\u3000]+/g, " ").replace(/[。．.!！?？;；,，]/g, " ").toLowerCase().trim().slice(0, 160);
}
function filterValidExamQuestions(raw, maxCount) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    if (out.length >= maxCount) break;
    if (!item || typeof item !== "object") continue;
    const rec = item;
    const type = rec["type"];
    if (!VALID_EXAM_TYPES.includes(type)) continue;
    const question = typeof rec["question"] === "string" ? rec["question"].trim().slice(0, 300) : "";
    if (!question) continue;
    const norm = normalizedExamQuestion(question);
    if (seen.has(norm)) continue;
    const referenceAnswer = typeof rec["referenceAnswer"] === "string" ? rec["referenceAnswer"].trim().slice(0, 1200) : "";
    if (!referenceAnswer) continue;
    if (type === "multiple_choice") {
      const opts = Array.isArray(rec["options"]) ? rec["options"].map((o) => String(o)).filter(Boolean).slice(0, 6) : [];
      if (opts.length !== 4) continue;
    }
    if (type === "true_false") {
      const ca = String(rec["correctAnswer"] ?? "").toLowerCase();
      if (ca !== "true" && ca !== "false") continue;
    }
    seen.add(norm);
    const evidence = Array.isArray(rec["sourceEvidence"]) ? rec["sourceEvidence"].map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 6) : [];
    out.push({
      id: typeof rec["id"] === "string" && rec["id"] ? String(rec["id"]).slice(0, 40) : "q" + (out.length + 1),
      type,
      question,
      options: type === "multiple_choice" ? Array.isArray(rec["options"]) ? rec["options"].map((o) => String(o)).slice(0, 4) : void 0 : void 0,
      correctAnswer: type === "true_false" || type === "multiple_choice" ? String(rec["correctAnswer"] ?? "").slice(0, 120) : void 0,
      referenceAnswer,
      explanation: typeof rec["explanation"] === "string" ? rec["explanation"].trim().slice(0, 600) : void 0,
      sourceEvidence: evidence,
      sourcePath: typeof rec["sourcePath"] === "string" ? String(rec["sourcePath"]).slice(0, 400) : "",
      difficulty: rec["difficulty"] === "easy" || rec["difficulty"] === "hard" ? rec["difficulty"] : rec["difficulty"] === "medium" ? "medium" : void 0,
      concept: typeof rec["concept"] === "string" ? String(rec["concept"]).trim().slice(0, 80) : void 0
    });
  }
  return out;
}

// src/ai/parsers.ts
function extractJsonBlockText(text) {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = i; k <= j; k++) {
    const ch = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(i, k + 1);
    }
  }
  return null;
}
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function parseJsonObject(content, label) {
  const text = content.trim();
  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const direct = tryJson(text);
  if (direct) {
    if (isObj(direct)) return direct;
    throw new AIError("AI \u8FD4\u56DE\u7684" + label + " JSON \u4E0D\u662F\u5408\u6CD5\u5BF9\u8C61\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const block = extractJsonBlockText(text);
  if (block) {
    const repaired = tryJson(block);
    if (repaired && isObj(repaired)) return repaired;
  }
  throw new AIError("AI \u8FD4\u56DE\u7684" + label + " JSON \u975E\u6CD5\uFF08\u65E0\u6CD5\u89E3\u6790\uFF09\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
}
function parseExamGeneration(content, maxCount) {
  const rec = parseJsonObject(content, "\u8003\u8BD5");
  if (typeof rec["title"] !== "string" || !rec["title"] || !Array.isArray(rec["questions"])) {
    throw new AIError("AI \u8FD4\u56DE\u7684\u8003\u8BD5\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5\uFF08title/questions\uFF09\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const questions = filterValidExamQuestions(rec["questions"], Math.max(1, maxCount ?? 50));
  if (!questions.length) {
    throw new AIError("AI \u8FD4\u56DE\u7684\u8003\u8BD5\u9898\u76EE\u5168\u90E8\u65E0\u6548\uFF08\u8FC7\u6EE4\u540E\u65E0\u6709\u6548\u9898\u76EE\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u7F13\u5B58\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const coverage = rec["coverageTopics"];
  return {
    title: String(rec["title"]).trim().slice(0, 200),
    coverageTopics: Array.isArray(coverage) ? coverage.map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 12) : void 0,
    questions
  };
}

// tests/p23-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function q(id, question, concept, type = "recall") {
  return { id, question, referenceAnswer: "\u7B54 " + question, sourcePath: "A.md", type, concept, sourceEvidence: ["\u4F9D\u636E"] };
}
function ctx(exams) {
  return buildExamHistoryContext(exams);
}
{
  const h1 = ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C" }], coverageTopics: ["\u67B6\u6784"] }]);
  const h2 = ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C" }], coverageTopics: ["\u67B6\u6784"] }, { questions: [{ question: "\u4EC0\u4E48\u662F\u8026\u5408\uFF1F", concept: "\u8026\u5408" }] }]);
  test(
    "P23-01",
    h1.examCount === 1 && h1.priorQuestions.length === 1 && h1.priorConcepts.includes("\u6A21\u5757\u8FB9\u754C"),
    "\u5386\u53F2\u4E0A\u4E0B\u6587\uFF08examStore.findBySource \u7684\u6570\u636E\u5C42\u6D88\u8D39\u8005\uFF0C\xA79/101\uFF09"
  );
  test(
    "P23-02",
    h1.historyFingerprint.length > 0 && h1.historyFingerprint === ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C" }], coverageTopics: ["\u67B6\u6784"] }]).historyFingerprint,
    "historyFingerprint \u786E\u5B9A\u6027\uFF08\xA7102/52\uFF09"
  );
  test("P23-02b", h2.historyFingerprint !== h1.historyFingerprint, "\u65B0\u8003\u8BD5\u4FDD\u5B58\u540E fingerprint \u53D8\u5316\uFF08\u4E0B\u6B21 cache miss\uFF0C\xA735/90\uFF09");
  test(
    "P23-02c",
    ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C" }] }]).historyFingerprint === ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C" }] }]).historyFingerprint,
    "concept/coverage \u7F3A\u7701\u4E0D\u5F71\u54CD\u6307\u7EB9\u7A33\u5B9A"
  );
}
{
  const hist = ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C", type: "recall" }] }]);
  const d1 = dedupeExamQuestions([q("a", "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F")], hist, "strict");
  test("P23-03", d1.removedCount === 1 && d1.questions.length === 0, "\u5386\u53F2\u76F8\u540C\u9898\u5E72 exact \u53BB\u91CD\uFF08\xA7103/27\uFF09");
  const sim = isNearDuplicate("\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", "\u4E3A\u4EC0\u4E48\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", "\u6A21\u5757\u8FB9\u754C", "\u6A21\u5757\u8FB9\u754C");
  test("P23-04", sim === true, "\u9AD8\u6587\u672C\u91CD\u53E0 + \u540C concept \u8FD1\u91CD\u590D\u88AB\u8BC6\u522B\uFF08\xA7104/14~16\uFF09");
  const simFar = questionSimilarity("\u4EC0\u4E48\u662F Python \u7684 GIL\uFF1F", "\u6E38\u620F\u5FAA\u73AF\u5982\u4F55\u56FA\u5B9A\u6B65\u957F\uFF1F", "\u5E76\u53D1", "\u6E38\u620F");
  test("P23-04b", simFar < EXAM_NEAR_DUP_THRESHOLD, "\u65E0\u5173\u4E3B\u9898\u4E0D\u4F1A\u88AB\u8BEF\u5224\u4E3A\u91CD\u590D\uFF08\xA716/105b\uFF09");
  test(
    "P23-04c",
    dedupeExamQuestions([q("p1", "\u4E3A\u4EC0\u4E48\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", "\u6A21\u5757\u8FB9\u754C", "recall")], ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C", type: "recall" }] }]), "balanced").removedCount === 1,
    "balanced\uFF1A\u540C concept \u4E14\u540C\u9898\u578B\u7684\u8FD1\u91CD\u590D\u6539\u5199\u4ECD\u6321\uFF08\xA719\uFF09"
  );
  test(
    "P23-04d",
    dedupeExamQuestions([q("p2", "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F\u6362\u4E2A\u89D2\u5EA6\u89E3\u91CA\u5176\u610F\u4E49", "\u6A21\u5757\u8FB9\u754C", "explanation")], ctx([{ questions: [{ question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C", type: "recall" }] }]), "balanced").questions.length === 1,
    "new_angle\uFF1A\u540C concept \u6362\u9898\u578B + \u660E\u663E\u4E0D\u540C\u95EE\u6CD5 \u2192 \u4FDD\u7559\uFF08\xA769/78\uFF09"
  );
  const d2 = dedupeExamQuestions([q("b", "\u6A21\u5757\u8FB9\u754C\u5982\u4F55\u964D\u4F4E\u8026\u5408\uFF1F", "\u6A21\u5757\u8FB9\u754C")], hist, "strict");
  test("P23-05", d2.removedCount === 1, "strict\uFF1A\u540C concept \u53BB\u91CD\uFF08\xA7105/17/28\uFF09");
  const d3 = dedupeExamQuestions([q("c", "\u4EC0\u4E48\u662F\u8026\u5408\uFF1F", "\u8026\u5408")], hist, "strict");
  test("P23-06", d3.questions.length === 1 && d3.removedCount === 0, "\u4E0D\u540C concept \u63A5\u53D7\uFF08\xA7106\uFF09");
  const withHist = ctx([{ questions: [{ question: "\u6A21\u5757\u8FB9\u754C\u4F5C\u7528\uFF1F", concept: "\u6A21\u5757\u8FB9\u754C", type: "recall" }] }]);
  test("P23-07", dedupeExamQuestions([q("x", "\u6A21\u5757\u8FB9\u754C\u8FD8\u6709\u4EC0\u4E48\u4F5C\u7528\uFF1F", "\u6A21\u5757\u8FB9\u754C", "explanation")], withHist, "strict").removedCount === 1, "strict \u540C concept \u5168\u6321\uFF08\xA7107\uFF09");
  test(
    "P23-08",
    dedupeExamQuestions([q("x", "\u6A21\u5757\u8FB9\u754C\u8FD8\u6709\u4EC0\u4E48\u4F5C\u7528\uFF1F", "\u6A21\u5757\u8FB9\u754C", "explanation")], withHist, "balanced").questions.length === 1,
    "balanced\uFF1A\u540C concept \u4F46\u6362\u9898\u578B\uFF08explanation\u2260recall\uFF09\u4FDD\u7559\uFF08\xA7108/19/78\uFF09"
  );
  test(
    "P23-08b",
    dedupeExamQuestions([q("x", "\u6A21\u5757\u8FB9\u754C\u8FD8\u6709\u4EC0\u4E48\u4F5C\u7528\uFF1F", "\u6A21\u5757\u8FB9\u754C", "recall")], withHist, "balanced").removedCount === 1,
    "balanced\uFF1A\u540C concept \u4E14\u540C\u9898\u578B\u4ECD\u6321\uFF08\xA719\uFF09"
  );
  test(
    "P23-09",
    dedupeExamQuestions([q("x", "\u6A21\u5757\u8FB9\u754C\u8FD8\u6709\u4EC0\u4E48\u4F5C\u7528\uFF1F", "\u6A21\u5757\u8FB9\u754C", "recall")], withHist, "allow").questions.length === 1,
    "allow\uFF1A\u5141\u8BB8\u5386\u53F2 concept \u91CD\u590D\uFF0C\u4ECD\u4FDD\u7559\u672C\u6279\u9898\uFF08\xA7109/29\uFF09"
  );
  test(
    "P23-09b",
    dedupeExamQuestions([q("x", "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F"), q("y", "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F")], ctx([]), "allow").removedCount === 1,
    "allow\uFF1A\u540C\u4E00\u6279\u5185 exact \u91CD\u590D\u4ECD\u7981\u6B62\uFF08\xA720/120\uFF09"
  );
}
{
  const note = "# \u6A21\u5757\u5316\n\u6B63\u6587\u2026\n## \u6A21\u5757\u8FB9\u754C\n\u2026\n## \u8026\u5408\n\u2026\n### \u5185\u805A\n\u2026\n# \u6D4B\u8BD5\n\u2026";
  const h = ctx([{ questions: [{ question: "\u65E7\u9898", concept: "\u6A21\u5757\u8FB9\u754C" }], coverageTopics: ["\u6A21\u5757\u5316"] }]);
  const headings = extractHeadings(note);
  const uncovered = uncoveredTopics(headings, h);
  test(
    "P23-10",
    uncovered.includes("\u8026\u5408") && uncovered.includes("\u5185\u805A") && !uncovered.includes("\u6A21\u5757\u5316"),
    "new_content\uFF1AuncoveredTopics = headings \u2212 \u5386\u53F2 concept/coverage\uFF08\xA7110/21/22\uFF09"
  );
  const alloc = assignBatchTopics(uncovered, 0, 3);
  test("P23-10b", alloc.length >= 1 && alloc.every((t) => uncovered.includes(t)), "assignBatchTopics \u4ECE\u5019\u9009\u5206\u914D\uFF08\xA773~75\uFF09");
  const hist = ctx([{ questions: [{ question: "\u8FB9\u754C\u662F\u4EC0\u4E48\uFF1F", concept: "\u8FB9\u754C", type: "recall" }] }]);
  test("P23-11", dedupeExamQuestions([q("n1", "\u8FB9\u754C\u5982\u4F55\u5B9E\u8DF5\uFF1F", "\u8FB9\u754C", "recall")], hist, "balanced").removedCount === 1, "new_angle \u8BED\u4E49\uFF1A\u540C concept \u6362\u9898\u578B\u7684\u624D\u5141\u8BB8\uFF08\xA7111/78\uFF09");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-12", mainSrc.includes("\u300C\u270E \u81EA\u5B9A\u4E49\u4E3B\u9898\u300D\u5185\u5BB9\u7B56\u7565\u9700\u8981\u914D\u5408"), "custom \u5185\u5BB9\u7B56\u7565\u9700\u914D\u5408\u81EA\u5B9A\u4E49\u4E3B\u9898\uFF08\xA7112/71\uFF09");
}
{
  test("P23-13", planExamBatches(16).join("+") === "10+6", "16 \u2192 10+6\uFF08\xA7113\uFF09");
  test("P23-14", planExamBatches(20).join("+") === "10+10", "20 \u2192 10+10\uFF08\xA7114\uFF09");
  test("P23-15", planExamBatches(25).join("+") === "10+10+5", "25 \u2192 10+10+5\uFF08\xA7115\uFF09");
  test("P23-16", planExamBatches(30).join("+") === "10+10+10", "30 \u2192 10+10+10\uFF08\xA7116\uFF09");
  test("P23-16b", planExamBatches(15).join("+") === "15" && planExamBatches(1).join("+") === "1", "\u226415 \u5355\u6279\uFF08\xA728\uFF09");
  test("P23-17", splitUnitForRetry(10).join("+") === "5+5", "\u622A\u65AD 10 \u2192 5+5\uFF08\xA7117/36\uFF09");
  test("P23-17b", splitUnitForRetry(5).join("+") === "3+2", "\u518D\u622A\u65AD 5 \u2192 3+2");
  test("P23-17c", splitUnitForRetry(1).length === 0, "unit=1 \u4E0D\u518D\u62C6\u5206");
  test(
    "P23-18/19-keys",
    EXAM_MAX_BATCH_REQUESTS === 8 && EXAM_REPLACEMENT_ROUNDS === 3,
    "\u603B\u8BF7\u6C42 \u22648\u3001replacement \u22643\uFF08\xA7118/109/46\uFF09\u2014\u2014\u7F51\u7EDC/JSON \u5931\u8D25\u53EA\u91CD\u8BD5\u5F53\u524D batch \u89C1 main \u7F16\u6392\uFF08\xA7119/106\uFF09"
  );
}
{
  const gen = (prefix, n) => Array.from({ length: n }, (_, i) => q(prefix + i, prefix + " \u9898 " + i, "\u6982\u5FF5" + prefix + i));
  const merged = dedupeExamQuestions([...gen("a", 10), ...gen("b", 10), ...gen("c", 10)], ctx([]), "strict");
  test("P23-20", merged.questions.length === 30, "merge 10+10+10 \u2192 30\uFF08\xA7120\uFF09");
  const dupCandidates = [...gen("a", 10), ...gen("a", 1), ...gen("b", 9)];
  const f0 = dupCandidates[0].question;
  const f1 = dupCandidates[10].question;
  const diffAt = f0 === f1 ? -1 : (() => {
    for (let k = 0; k < Math.max(f0.length, f1.length); k++) if (f0[k] !== f1[k]) return k;
    return -1;
  })();
  const sameFp = examQuestionFingerprint(dupCandidates[0]) === examQuestionFingerprint(dupCandidates[10]);
  const dupAcross = dedupeExamQuestions(dupCandidates, ctx([]), "strict");
  test(
    "P23-21",
    dupAcross.questions.length === 19 && dupAcross.removedCount === 1,
    "\u8DE8\u6279 exact \u91CD\u590D\u88AB\u79FB\u9664 \u2192 \u7F3A\u53E3\u7531 replacement \u8865\uFF08got kept=" + dupAcross.questions.length + ", removed=" + dupAcross.removedCount + ", sameFp=" + sameFp + ", diffAt=" + diffAt + ", q0='" + f0 + "', q10='" + f1 + "'\uFF0C\xA7121\uFF09"
  );
  const target30 = dedupeExamQuestions([...gen("a", 30)], ctx([]), "strict").questions.length;
  const target25 = dedupeExamQuestions([...gen("a", 25)], ctx([]), "strict").questions.length;
  const target15 = dedupeExamQuestions([...gen("a", 15)], ctx([]), "strict").questions.length;
  test("P23-24", target30 === 30, "target 30 \u2192 \u6070\u597D 30\uFF08\xA7124\uFF09");
  test("P23-25", target25 === 25, "target 25 \u2192 \u6070\u597D 25\uFF08\xA7125\uFF09");
  test("P23-26", target15 === 15, "target 15 \u2192 \u6070\u597D 15\uFF08\xA7126\uFF09");
  const hist = ctx([{ questions: [{ question: "\u552F\u4E00\u65E7\u9898\uFF1F", concept: "c0" }] }]);
  const scarcity = dedupeExamQuestions([q("0", "\u552F\u4E00\u65B0\u9898", "c1")], hist, "strict");
  test("P23-31", scarcity.questions.length === 1, "\u77ED\u7B14\u8BB0\u53EA\u80FD\u5F97\u5230\u6709\u9650\u4E0D\u91CD\u590D\u9898\uFF08\u6570\u636E\u5C42\uFF0C\xA7131\uFF09");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-32", mainSrc.includes("\u4E0D\u8DB3\u4EE5\u5F62\u6210") && mainSrc.includes("\u7EDD\u4E0D\u81EA\u52A8\u964D\u4F4E\u6216\u7F16\u9020"), "\u5185\u5BB9\u4E0D\u8DB3 \u2192 \u660E\u786E\u9519\u8BEF\u63D0\u793A\uFF08\xA7132/46/76\uFF09");
  test(
    "P23-33",
    /valid\.length !== target/.test(mainSrc) && /const questions = gen\.questions/.test(mainSrc),
    "\u6700\u7EC8\u7CBE\u786E\u9898\u6570\u6821\u9A8C\u540E\u624D\u4FDD\u5B58\uFF08\u4E0D\u5B58\u534A\u6210\u54C1\uFF0C\xA7133/85/86\uFF09"
  );
  test("P23-23", EXAM_REPLACEMENT_ROUNDS === 3, "replacement \u4E09\u8F6E\u4E0A\u9650\uFF08\xA7123/46\uFF09");
}
{
  const hist = ctx([{ questions: [{ question: "\u65E7\u9898\u5E72", concept: "\u65E7\u6982\u5FF5", type: "recall" }] }]);
  test("P23-27", dedupeExamQuestions([q("x", "\u65E7\u9898\u5E72")], hist, "allow").removedCount === 1, "\u65E7\u8003\u8BD5\u9898\u5E72 exact \u59CB\u7EC8\u6392\u9664\uFF08\u542B allow\uFF0C\xA7127\uFF09");
  test("P23-28", dedupeExamQuestions([q("x", "\u53E6\u4E00\u4E2A\u95EE\u9898", "\u65E7\u6982\u5FF5", "explanation")], hist, "strict").removedCount === 1, "strict \u6392\u9664\u65E7 concept\uFF08\xA7128\uFF09");
  test("P23-29", dedupeExamQuestions([q("x", "\u53E6\u4E00\u4E2A\u95EE\u9898", "\u65E7\u6982\u5FF5", "explanation")], hist, "allow").questions.length === 1, "allow \u53EF\u590D\u7528 concept\uFF08\xA7129\uFF09");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-30", mainSrc.includes("o.force") && mainSrc.includes("history"), "force \u4ECD\u4F7F\u7528 history exclusion\uFF08\u7F16\u6392\u5C42\uFF0C\xA7130/118\uFF09");
  const svc = fs.readFileSync(path.join(__dirname, "..", "src", "ai", "service.ts"), "utf8");
  const prompts = fs.readFileSync(path.join(__dirname, "..", "src", "prompts.ts"), "utf8");
  test("P23-34", svc.includes('"strategy:"') && svc.includes('"hist:"') && svc.includes('"div:"'), "\u7F13\u5B58\u952E\u542B strategy/history/diversity\uFF08\xA7134/51\uFF09");
  test("P23-35", /historyFingerprint/.test(svc), "\u7F13\u5B58\u952E\u542B historyFingerprint\uFF08\xA7135/52\uFF09");
  test("P23-36", /opts\.contentStrategy/.test(svc) && /opts\.repeatPolicy/.test(svc), "strategy / repeatPolicy \u8FDB\u5165\u8BF7\u6C42\u4E0E\u952E\uFF08\xA7136~137\uFF09");
  test("P23-39", prompts.includes('EXAM_GENERATION_PROMPT_VERSION = "exam-generation-v2"'), "Prompt v2\uFF08\xA7139/62/63\uFF1Av1 \u7F13\u5B58\u81EA\u52A8\u5931\u6548\uFF09");
  test("P23-34b", svc.includes("EXAM_GENERATION_PROMPT_VERSION"), "\u7F13\u5B58 key \u4F7F\u7528 PROMPT_VERSIONS[type]\uFF08\u6A21\u578B/\u7248\u672C\u53D8\u5316 \u2192 miss\uFF0C\xA7138\uFF09");
}
{
  const valid = '{"title":"T","questions":[{"id":"q1","type":"recall","question":"A?","referenceAnswer":"r"},{"id":"q2","type":"recall","question":"B?","referenceAnswer":"r"}]}';
  test("P23-40", parseExamGeneration(valid, 5).questions.length === 2, "\u5408\u6CD5 batch JSON\uFF08\xA7140\uFF09");
  let invalidThrew = false;
  try {
    parseExamGeneration('{"title":"x","questions":[{bad', 5);
  } catch {
    invalidThrew = true;
  }
  test("P23-41", invalidThrew === true, "\u975E\u6CD5 JSON \u2192 error\uFF08\u53EA\u5F71\u54CD\u5F53\u524D batch\uFF0C\xA7141/59\uFF09");
  let zeroThrew = false;
  try {
    parseExamGeneration('{"title":"x","questions":[]}', 5);
  } catch {
    zeroThrew = true;
  }
  test("P23-42", zeroThrew === true, "\u7A7A questions \u2192 error\uFF08\xA7142\uFF09");
  let mcThrew = false;
  try {
    parseExamGeneration('{"title":"x","questions":[{"id":"q1","type":"multiple_choice","question":"A?","options":["1"],"correctAnswer":"A","referenceAnswer":"r"}]}', 5);
  } catch {
    mcThrew = true;
  }
  test("P23-43", mcThrew === true, "\u975E\u6CD5 MC\uFF08\u9009\u9879\u22604\uFF09\u2192 \u8FC7\u6EE4\u540E 0 \u9898 error\uFF08\xA7143\uFF09");
  let tfThrew = false;
  try {
    parseExamGeneration('{"title":"x","questions":[{"id":"q1","type":"true_false","question":"A?","correctAnswer":"maybe","referenceAnswer":"r"}]}', 5);
  } catch {
    tfThrew = true;
  }
  test("P23-44", tfThrew === true, "\u975E\u6CD5 true_false \u2192 error\uFF08\xA7144\uFF09");
  test(
    "P23-40b",
    truncationError("length")?.code === "TRUNCATED" && truncationError("stop") === null && truncationError(void 0) === null,
    "Provider\uFF1A\u53EA\u6709 finish_reason=length \u2192 TRUNCATED\uFF08\xA799\uFF09"
  );
}
{
  const view = fs.readFileSync(path.join(__dirname, "..", "src", "examView.ts"), "utf8");
  test(
    "P23-45",
    view.includes('addOption("new_content"') && view.includes('addOption("new_angle"') && view.includes('addOption("broad_coverage"') && view.includes('addOption("custom"'),
    "\u8003\u5BDF\u5185\u5BB9\u4E0B\u62C9\uFF08\xA7145\uFF09"
  );
  test("P23-46", view.includes('addOption("strict"') && view.includes('addOption("balanced"') && view.includes('addOption("allow"'), "\u907F\u514D\u91CD\u590D\u4E0B\u62C9\uFF08\xA7146\uFF09");
  test("P23-47", view.includes("const COUNT_OPTIONS = [3, 5, 8, 10, 15, 20, 30]"), "30 \u9898\u9884\u8BBE\uFF08\xA7147\uFF09");
  test("P23-48", view.includes("\u8FD9\u7BC7\u7B14\u8BB0\u5DF2\u6709 ") && view.includes("findBySource(this.file.path)"), "\u5386\u53F2\u8003\u8BD5\u6570\u91CF\u63D0\u793A\uFF08\xA7148/81\uFF09");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  test("P23-49/50", mainSrc.includes("\u8003\u8BD5\u751F\u6210\u4E2D\uFF1A\u5DF2\u751F\u6210 ") && mainSrc.includes("\u6B63\u5728\u8865\u5145\u672A\u91CD\u590D\u9898\u76EE\uFF1A"), "\u771F\u5B9E\u5206\u6279/\u8865\u5145\u8FDB\u5EA6\u6587\u6848\uFF08\xA7149/50/84\uFF09");
  const modalOnly = view.slice(view.indexOf("export class ExamBuildModal"), view.indexOf("export class ExamSessionView") > 0 ? view.indexOf("export class ExamSessionView") : view.length);
  test("P23-AI", !modalOnly.includes(".ai.") && !modalOnly.includes("generateExam("), "Modal \u6253\u5F00/\u5386\u53F2\u63D0\u793A\u8DEF\u5F84\u65E0 AI \u8C03\u7528\uFF08\xA7102\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
