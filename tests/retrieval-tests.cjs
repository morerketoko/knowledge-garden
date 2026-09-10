"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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
var init_paths = __esm({
  "src/portable/paths.ts"() {
    "use strict";
  }
});

// src/portable/fsPortable.ts
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
var host, mirror, dirty, pendingError, flushTimer, initialized;
var init_fsPortable = __esm({
  "src/portable/fsPortable.ts"() {
    "use strict";
    host = null;
    mirror = /* @__PURE__ */ new Map();
    dirty = /* @__PURE__ */ new Set();
    pendingError = null;
    flushTimer = null;
    initialized = false;
  }
});

// tests/obsidian-stub.ts
var init_obsidian_stub = __esm({
  "tests/obsidian-stub.ts"() {
  }
});

// src/migrations.ts
var init_migrations = __esm({
  "src/migrations.ts"() {
    "use strict";
    init_fsPortable();
  }
});

// src/portable/hash.ts
var K;
var init_hash = __esm({
  "src/portable/hash.ts"() {
    "use strict";
    K = new Uint32Array([
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
  }
});

// src/ai/cache.ts
var init_cache = __esm({
  "src/ai/cache.ts"() {
    "use strict";
    init_migrations();
    init_hash();
    init_fsPortable();
    init_paths();
  }
});

// src/portable/root.ts
init_paths();
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
init_paths();
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
init_paths();
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

// tests/portable-bootstrap.ts
init_fsPortable();
init_fsPortable();
init_paths();
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

// src/searchIndex.ts
init_obsidian_stub();
init_obsidian_stub();
var CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
var LATIN_RE = /[a-z0-9]+/g;
var STOP_CHARS = /* @__PURE__ */ new Set([
  "\u7684",
  "\u4E86",
  "\u662F",
  "\u5728",
  "\u6709",
  "\u548C",
  "\u4E0E",
  "\u53CA",
  "\u6216",
  "\u4E4B",
  "\u5417",
  "\u5462",
  "\u554A",
  "\u5427",
  "\u4E2A",
  "\u79CD",
  "\u4E9B",
  "\u4E5F",
  "\u90FD",
  "\u5F88",
  "\u66F4",
  "\u6700",
  "\u5C31",
  "\u800C",
  "\u5E76",
  "\u4E14",
  "\u8FD8",
  "\u53C8",
  "\u88AB",
  "\u628A",
  "\u8BA9",
  "\u7ED9",
  "\u6211",
  "\u4F60",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4EEC",
  "\u8C01",
  "\u54EA",
  "\u600E",
  "\u4E3A",
  "\u56E0",
  "\u679C",
  "\u5982",
  "\u82E5",
  "\u867D",
  "\u7136",
  "\u4F46",
  "\u4E8E",
  "\u4EE5",
  "\u4E2D",
  "\u4E0A",
  "\u4E0B",
  "\u8FD9",
  "\u90A3",
  "\u95EE",
  "\u4EC0",
  "\u4E48",
  "\u597D",
  "\u9700",
  "\u8981",
  "\u80FD",
  "\u4F1A",
  "\u60F3",
  "\u53EF",
  "\u4EE5",
  "\u4ECE",
  "\u5230",
  "\u5BF9",
  "\u505A",
  "\u7528",
  "\u770B",
  "\u8BF4",
  "\u6765",
  "\u53BB",
  "\u65F6",
  "\u540E",
  "\u524D",
  "\u95F4",
  "\u5185",
  "\u5916"
]);
var STOP_WORDS = /* @__PURE__ */ new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "it", "this", "that"]);
function tokenizeText(text) {
  const t = (text || "").toLowerCase();
  const out = [];
  for (const m of t.matchAll(LATIN_RE)) {
    const w = m[0];
    if (w.length >= 2 || /^[0-9]{1,3}$/.test(w) || w.length > 3) {
      if (!STOP_WORDS.has(w)) out.push(w);
    }
  }
  for (const ch of t) {
    if (CJK_RE.test(ch) && !STOP_CHARS.has(ch)) out.push(ch);
  }
  return out;
}
function matchesDoc(doc2, tokens) {
  for (const t of tokens) {
    if (doc2.titleTokens.includes(t)) return true;
    if (doc2.headings.some((h) => h.includes(t))) return true;
    if (doc2.tags.some((tag) => tag.includes(t) || tokenizeText(tag).includes(t))) return true;
    if (doc2.aliases.some((a) => a.includes(t) || tokenizeText(a).includes(t))) return true;
    if (doc2.folder.includes(t) || tokenizeText(doc2.folder).includes(t)) return true;
    if (doc2.tokenMap.has(t)) return true;
  }
  return false;
}

// src/discovery.ts
init_fsPortable();

// src/portable/pathShim.ts
init_paths();
init_paths();

// src/discovery.ts
init_cache();
init_migrations();
function areaOfNote(notePath, areas, folderOf) {
  for (const a of areas) {
    if (!a.folder) continue;
    if (notePath === a.folder + ".md" || notePath.startsWith(a.folder + "/")) return a.name;
  }
  const folder = folderOf ? folderOf(notePath) : notePath.split("/")[0] ?? "";
  for (const a of areas) if (a.folder === folder) return a.name;
  return void 0;
}

// src/queryExplorer.ts
init_cache();
function areaOf(pathStr, areas) {
  return areaOfNote(pathStr, areas, (p) => p.split("/")[0] ?? "");
}
function scoreSearchDoc(doc2, queryTokens, areas, allNotes) {
  const q = new Set(queryTokens);
  const titleTokens = doc2.titleTokens;
  const titleOverlap = titleTokens.filter((t) => q.has(t)).length;
  const exactTitle = titleTokens.length > 0 && q.size > 0 && titleTokens.every((t) => q.has(t)) ? 30 : 0;
  const titleScore = 50 * (titleOverlap / Math.max(1, q.size)) + exactTitle;
  const tagHits = [...new Set(doc2.tags.flatMap((tag) => tokenizeText(tag)))];
  const tagScore = tagHits.filter((t) => q.has(t)).length * 15;
  let headingHits = 0;
  for (const h of doc2.headings) for (const t of new Set(tokenizeText(h))) if (q.has(t)) headingHits++;
  const headingScore = Math.min(10, headingHits * 5);
  const aliasTokens = new Set(doc2.aliases.flatMap((a) => tokenizeText(a)));
  const aliasScore = [...aliasTokens].filter((t) => q.has(t)).length * 8;
  const folderScore = tokenizeText(doc2.folder).some((t) => q.has(t)) ? 6 : 0;
  let contentHits = 0;
  for (const t of q) if (doc2.tokenMap.has(t)) contentHits++;
  const coverage = contentHits / Math.max(1, q.size);
  const contentScore = doc2.bodyLength > 0 ? 4 * coverage * Math.min(1.6, 1 + Math.log(1 + contentHits)) : 0;
  let conn = 0;
  let cross = 0;
  let longTerm = 0;
  const meta2 = allNotes.get(doc2.path);
  if (meta2) {
    conn = Math.min(3, (meta2.links.length + meta2.backlinks.length) * 0.3);
    const a = areaOf(doc2.path, areas);
    let crossCount = 0;
    for (const b of meta2.backlinks) {
      const ba = areaOf(b, areas);
      if (ba && ba !== a && crossCount < 5) crossCount++;
    }
    cross = Math.min(2, crossCount * 0.4);
    const age = Math.max(0, (Date.now() - meta2.modified) / 864e5);
    longTerm = Math.min(1, age / 365) * 0.15;
  }
  const score = titleScore + tagScore + headingScore + aliasScore + folderScore + contentScore + conn + cross + longTerm;
  return { doc: doc2, score, area: areaOf(doc2.path, areas) };
}
function rankSearchResults(docs, queryTokens, areas, allNotes) {
  return docs.map((d) => scoreSearchDoc(d, queryTokens, areas, allNotes)).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

// src/workbenchService.ts
init_obsidian_stub();

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

// src/workbenchService.ts
init_cache();

// src/workspace.ts
init_cache();

// src/retrieval.ts
function trimFolderRef(s) {
  let t = (s ?? "").trim();
  t = t.replace(/^["'`「」『』\s]+|["'`「」『』\s]+$/g, "");
  t = t.replace(/[\\/]+$/g, "");
  return t;
}
function normalizeFolderRef(s) {
  return trimFolderRef(s).normalize("NFKC");
}
function pathInFolder(path2, folder) {
  const f = normalizeFolderRef(folder ?? "");
  const p = normalizeFolderRef((path2 ?? "").replace(/\\/g, "/"));
  if (!f) return true;
  return p === f || p.startsWith(f + "/");
}

// src/latency.ts
init_migrations();
init_fsPortable();

// src/skills.ts
init_cache();
var BUILTIN_SKILL_IDS = [
  "academic-writing",
  "critical-analysis",
  "research-question",
  "knowledge-application",
  "knowledge-refinement"
];
var md = (lines) => lines.join("\n");
var ACADEMIC = md([
  "# Academic Writing",
  "",
  "## Process",
  "1. Identify the thesis / core claim of the material.",
  "2. Separate claims from evidence; mark which claims are the author's inference.",
  "3. Identify assumptions and unstated premises.",
  "4. Improve structure (claim -> evidence -> reasoning -> limitation).",
  "5. Mark uncertain statements; never fabricate citations (\xA7\u4E09\u5341\u4E09/\xA7\u4E5D\u5341\u4E09).",
  "6. Output in the requested format; do not claim it is academically correct (\xA7\u4E5D\u5341\u56DB)."
]);
var CRITICAL = md([
  "# Critical Analysis",
  "",
  "## Process",
  "1. Restate the position in one sentence (charitable reading).",
  "2. List supporting evidence vs unsupported assertion.",
  "3. Find counterexamples and counter-arguments.",
  "4. Assess the strength of the link between evidence and conclusion.",
  "5. Distinguish fact, inference, and value judgment.",
  "6. End with the strongest open question."
]);
var RESQ = md([
  "# Research Question",
  "",
  "## Process",
  "1. Summarize the current material into 1-3 core topics.",
  "2. Generate hierarchically structured questions (general -> specific; descriptive -> explanatory -> evaluative) (\xA7\u4E09\u5341\u4E03/\xA7\u4E09\u5341\u516B).",
  "3. For each question, list what evidence would be needed.",
  "4. Identify which questions connect to existing knowledge / known gaps.",
  "5. Output questions with a short why-it-matters line."
]);
var APPLY = md([
  "# Knowledge Application",
  "",
  "## Process",
  "1. Extract the transferable principle(s) from the source material.",
  "2. Identify target domains where the principle could apply (cross-domain transfer, \xA7\u56DB\u5341/\xA7\u56DB\u5341\u4E00).",
  "3. For each application: expected effect, precondition, limitation.",
  "4. Provide a concrete example scenario.",
  "5. Flag speculative applications explicitly as hypotheses, not facts (\xA7\u4E00\u767E\u4E94\u5341\u56DB)."
]);
var REFINE = md([
  "# Knowledge Refinement",
  "",
  "## Process",
  "1. Parse the source note into atomic claims (each claim = one sentence, traceable to the source).",
  "2. Keep the original wording where possible; only rephrase for clarity.",
  "3. Separate source-derived from your own synthesis (origin preservation, Phase 10 Provenance).",
  "4. Attach suggested wikilinks only to concepts already present in the vault.",
  "5. Output refined content as a proposal; do not overwrite the original without preview (\xA7\u516D\u5341\u4E00)."
]);
var BUILTIN_SKILL_SUMMARIES = BUILTIN_SKILL_IDS.map((id) => ({
  id,
  name: skillName(id),
  description: skillDescription(id),
  path: "builtin://" + id,
  enabled: true
}));
function skillName(id) {
  const map = {
    "academic-writing": "\u5B66\u672F\u5199\u4F5C",
    "critical-analysis": "\u6279\u5224\u6027\u5206\u6790",
    "research-question": "\u7814\u7A76\u95EE\u9898\u751F\u6210",
    "knowledge-application": "\u77E5\u8BC6\u8FC1\u79FB\u4E0E\u5E94\u7528",
    "knowledge-refinement": "\u77E5\u8BC6\u63D0\u70BC"
  };
  return map[id] ?? id;
}
function skillDescription(id) {
  const map = {
    "academic-writing": "\u628A\u7B14\u8BB0\u6539\u5199\u6210\u6709\u5B66\u672F\u7ED3\u6784\u3001\u533A\u5206\u8BBA\u636E\u4E0E\u63A8\u8BBA\u7684\u8F93\u51FA\uFF0C\u4E0D\u4F2A\u9020\u5F15\u7528\u3002",
    "critical-analysis": "\u8BC6\u522B\u8BBA\u70B9\u3001\u8BBA\u636E\u3001\u5047\u8BBE\u4E0E\u53CD\u4F8B\uFF0C\u8F93\u51FA\u6279\u5224\u6027\u5206\u6790\u3002",
    "research-question": "\u4ECE\u6750\u6599\u751F\u6210\u6709\u5C42\u6B21\u7684\u7814\u7A76\u95EE\u9898\uFF08\u63CF\u8FF0\u2192\u89E3\u91CA\u2192\u8BC4\u4EF7\uFF09\u3002",
    "knowledge-application": "\u63D0\u53D6\u53EF\u8FC1\u79FB\u539F\u5219\uFF0C\u505A\u8DE8\u9886\u57DF\u5E94\u7528\u4E0E\u53CD\u4F8B\u5206\u6790\u3002",
    "knowledge-refinement": "\u628A\u7B14\u8BB0\u63D0\u70BC\u4E3A\u53EF\u8FFD\u6EAF\u7684\u539F\u5B50\u5316\u77E5\u8BC6\uFF0C\u540C\u65F6\u4FDD\u7559\u6765\u6E90\u8FB9\u754C\u3002"
  };
  return map[id] ?? "";
}

// src/sourceLedger.ts
init_fsPortable();
init_migrations();
init_cache();

// src/workbenchSession.ts
init_fsPortable();
init_migrations();
init_cache();

// src/workbenchService.ts
var RETRIEVAL_VERSION = "v3";
function fallbackSearch(query, paths, limit, folderPrefix) {
  const tokens = tokenizeText(query || "");
  if (tokens.length === 0) return [];
  const out = [];
  const fp = normalizeFolderRef(folderPrefix ?? "");
  for (const pth of paths) {
    if (fp && !pathInFolder(pth, fp)) continue;
    const lower = pth.toLowerCase();
    if (tokens.some((t) => lower.includes(t))) {
      out.push({ path: pth, snippet: pth });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// tests/retrieval-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function doc(p, title, body, extra) {
  const tokenMap = /* @__PURE__ */ new Map();
  for (const t of tokenizeText(body)) tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
  return {
    path: p,
    title,
    folder: p.split("/")[0] ?? "",
    tags: [],
    headings: [],
    aliases: [],
    tokenMap,
    titleTokens: tokenizeText(title),
    bodyLength: body.length,
    ...extra
  };
}
function meta(p, title) {
  return { path: p, title, folder: p.split("/")[0] ?? "", tags: [], links: [], backlinks: [], created: 1, modified: Date.now(), size: 1, wordCount: 1 };
}
function notesMap(items) {
  return new Map(items.map((n) => [n.path, n]));
}
var AREAS = [];
{
  const t = tokenizeText("\u6709\u5173\u6E38\u620F\u7684\u7B14\u8BB0\u6709\u54EA\u4E9B");
  test(
    "R1",
    t.length >= 4 && t.includes("\u6E38") && t.includes("\u620F") && t.includes("\u7B14") && t.includes("\u8BB0"),
    "\u300C\u6709\u5173\u6E38\u620F\u7684\u7B14\u8BB0\u6709\u54EA\u4E9B\u300D\u2192 tokens=[" + t.join(",") + "]\uFF08\u505C\u7528\u5B57 \u6709/\u7684/\u54EA/\u4E9B \u5DF2\u8FC7\u6EE4\uFF09"
  );
  test(
    "R1b",
    !t.includes("\u6709") && !t.includes("\u7684") && !t.includes("\u54EA") && !t.includes("\u4E9B"),
    "\u9AD8\u9891\u865A\u5B57\u4E0D\u8FDB\u5165\u68C0\u7D22 token\uFF08\u9632\u6B62\u300C\u7684/\u6709/\u54EA\u300D\u6C61\u67D3\u5339\u914D\uFF09"
  );
}
{
  const d = doc("AI/\u6E38\u620F\u8BBE\u8BA1.md", "\u6E38\u620F\u8BBE\u8BA1", "\u8FD9\u662F\u4E00\u7BC7\u5173\u4E8E\u6E38\u620F\u8BBE\u8BA1\u7684\u6587\u7AE0\uFF0C\u8BB2\u4E86\u5173\u5361\u4E0E\u673A\u5236\u3002");
  const tokens = tokenizeText("\u6E38\u620F");
  test("R2", matchesDoc(d, tokens), "\u300C\u6E38\u620F\u300Dtoken \u547D\u4E2D\u6B63\u6587\u542B\u300C\u6E38\u620F\u300D\u7684\u6587\u6863\uFF08matchesDoc=true\uFF09");
  const ranked = rankSearchResults([d], tokens, AREAS, notesMap([meta(d.path, d.title)]));
  test("R2b", ranked.length === 1 && ranked[0].score > 0, "rankSearchResults \u8FD4\u56DE\u76F8\u5173\u6587\u6863\u4E14 score>0\uFF08score=" + (ranked[0]?.score ?? 0) + "\uFF09");
}
{
  const t = tokenizeText("\u6211\u4EE5\u524D\u6709\u6CA1\u6709\u5199\u8FC7\u5173\u4E8E\u6E38\u620F\u7684\u4E1C\u897F\uFF1F");
  test("R3", t.includes("\u6E38") && t.includes("\u620F"), "\u81EA\u7136\u53E3\u8BED\u300C\u6211\u4EE5\u524D\u6709\u6CA1\u6709\u5199\u8FC7\u5173\u4E8E\u6E38\u620F\u7684\u4E1C\u897F\uFF1F\u300D\u2192 tokens \u542B \u6E38/\u620F\uFF08" + t.join(",") + "\uFF09");
}
{
  const t = tokenizeText("what notes are about games");
  test("R4", t.includes("games") && t.includes("notes") && t.includes("about"), "\u82F1\u6587\u95EE\u9898\u4ECD\u4FDD\u7559\u5B9E\u8BCD\uFF08" + t.join(",") + "\uFF09");
}
{
  const t = tokenizeText("\u6709\u54EA\u4E9B AI \u76F8\u5173\u6E38\u620F\u7B14\u8BB0");
  test("R5", t.includes("ai") && t.includes("\u6E38") && t.includes("\u620F") && t.includes("\u7B14"), "\u4E2D\u82F1\u6DF7\u5408\u540C\u65F6\u4EA7\u51FA\u4E2D\u6587+\u82F1\u6587 token\uFF08" + t.join(",") + "\uFF09");
}
{
  const titleDoc = doc("AI/\u6E38\u620F\u8BBE\u8BA1.md", "\u6E38\u620F\u8BBE\u8BA1", "\u6B63\u6587\u65E0\u76F8\u5173\u5185\u5BB9\u8BCD\u3002");
  const bodyDoc = doc("\u54F2\u5B66/\u6C89\u601D.md", "\u54F2\u5B66\u6C89\u601D", "\u8FD9\u672C\u7B14\u8BB0\u5728\u6B63\u6587\u91CC\u63D0\u4E86\u4E00\u53E5\u6E38\u620F\u673A\u5236\u3002");
  const q = tokenizeText("\u6E38\u620F\u8BBE\u8BA1");
  const ranked = rankSearchResults(
    [bodyDoc, titleDoc],
    q,
    AREAS,
    notesMap([meta(titleDoc.path, titleDoc.title), meta(bodyDoc.path, bodyDoc.title)])
  );
  test("R6", ranked.length >= 1 && ranked[0].doc?.path === titleDoc.path, "\u6807\u9898\u547D\u4E2D\u6392\u5728\u6B63\u6587\u5F31\u547D\u4E2D\u4E4B\u524D\uFF08top=" + (ranked[0]?.doc?.path ?? "none") + "\uFF09");
}
{
  const tagDoc = doc("\u5B66\u672F/\u8BBA\u6587.md", "\u8BBA\u6587", "\u6B63\u6587\u4E0E\u9898\u65E0\u5173\u3002", { tags: ["\u6E38\u620F"] });
  const aliasDoc = doc("Inbox/\u672A\u547D\u540D.md", "\u672A\u547D\u540D", "\u6B63\u6587\u65E0\u5173\u3002", { aliases: ["\u6E38\u620F\u673A\u5236\u8349\u7A3F"] });
  const headDoc = doc("\u9879\u76EE/\u539F\u578B.md", "\u539F\u578B", "\u6B63\u6587\u65E0\u5173\u3002", { headings: ["\u6E38\u620F\u539F\u578B", "\u6D4B\u8BD5"] });
  const q = tokenizeText("\u6E38\u620F");
  const ranked = rankSearchResults(
    [tagDoc, aliasDoc, headDoc],
    q,
    AREAS,
    notesMap([meta(tagDoc.path, tagDoc.title), meta(aliasDoc.path, aliasDoc.title), meta(headDoc.path, headDoc.title)])
  );
  test("R7", ranked.length === 3, "tag/alias/heading \u547D\u4E2D\u5747\u53EF\u8FDB\u5165\u5019\u9009\uFF08count=" + ranked.length + "\uFF09");
}
{
  const t = tokenizeText("\u7684\u4E86\u662F\u5417\uFF1F");
  test("R8", t.length === 0, "\u300C\u7684\u4E86\u662F\u5417\uFF1F\u300Dtoken \u4E3A\u7A7A \u2192 \u68C0\u7D22\u5C42\u76F4\u63A5\u8FD4\u56DE\u7A7A\uFF08\u4E0D\u89E6\u53D1 AI \u8BF7\u6C42\uFF09");
  test("R8b", fallbackSearch("\u7684\u4E86\u662F\u5417\uFF1F", ["AI/\u6E38\u620F.md"], 5).length === 0, "fallbackSearch \u5BF9\u7EAF\u865A\u8BCD\u540C\u6837\u8FD4\u56DE\u7A7A");
}
{
  const src = fs.readFileSync(path.resolve(__dirname, "../src/workbenchService.ts"), "utf8");
  test("R9", RETRIEVAL_VERSION === "v3", "RETRIEVAL_VERSION \u5E38\u91CF = v3\uFF08\u5F53\u524D\u503C=" + RETRIEVAL_VERSION + "\uFF09");
  test("R9b", src.includes('"rv:" + RETRIEVAL_VERSION'), "Ask cache key \u5DF2\u7EB3\u5165 rv:" + RETRIEVAL_VERSION);
  const oldSplitStillThere = src.includes("u4e00-") && src.includes("split(");
  test("R9c", !oldSplitStillThere, "\u65E7 split(/[\\s\\u4e00-\\u9fff]+/) \u4E2D\u6587\u5206\u9694 bug \u5DF2\u5220\u9664");
  test("R9d", src.includes("tokenizeText(query") && src.includes("rankSearchResults(docs"), "vaultSearch \u4F7F\u7528 tokenizeText + rankSearchResults");
}
{
  const paths = ["AI/\u6E38\u620F\u8BBE\u8BA1.md", "AI/\u97F3\u6548.md", "\u54F2\u5B66/\u6C89\u601D\u5F55.md"];
  const out = fallbackSearch("\u6E38\u620F", paths, 5);
  test(
    "R10",
    out.some((r) => r.path === "AI/\u6E38\u620F\u8BBE\u8BA1.md") && !out.some((r) => r.path === "\u54F2\u5B66/\u6C89\u601D\u5F55.md"),
    "fallbackSearch \u547D\u4E2D\u6587\u4EF6\u540D\u542B\u300C\u6E38\u620F\u300D\u7684\u7B14\u8BB0\uFF08" + out.map((r) => r.path).join(",") + "\uFF09"
  );
}
{
  const docs = [];
  const metas = [];
  for (let i = 0; i < 1e3; i++) {
    const p = "AI/note-" + String(i).padStart(4, "0") + ".md";
    docs.push(doc(p, "\u7B14\u8BB0" + i, "\u4E0E\u68C0\u7D22\u65E0\u5173\u7684\u6B63\u6587\u5185\u5BB9" + i));
    metas.push(meta(p, "\u7B14\u8BB0" + i));
  }
  docs.push(doc("AI/\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0.md", "\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0", "\u8FD9\u91CC\u8BA8\u8BBA\u6E38\u620F\u673A\u5236\u4E0E\u5173\u5361\u7ED3\u6784\u3002"));
  metas.push(meta("AI/\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0.md", "\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0"));
  const q = tokenizeText("\u6E38\u620F\u8BBE\u8BA1");
  const t0 = Date.now();
  const ranked = rankSearchResults(docs, q, AREAS, notesMap(metas));
  const dt = Date.now() - t0;
  test("R11", ranked.length >= 1 && ranked[0].doc?.path === "AI/\u6E38\u620F\u8BBE\u8BA1\u7EFC\u8FF0.md", "1000 \u7B14\u8BB0\u4E0B\u6807\u9898\u547D\u4E2D\u4ECD\u5728\u9996\u4F4D\uFF08top=" + (ranked[0]?.doc?.path ?? "none") + "\uFF09");
  test("R11b", dt < 2e3, "1000 \u7B14\u8BB0\u4EC5\u626B tokenMap \u4E0D\u8BFB\u6B63\u6587\uFF0C\u8017\u65F6 " + dt + "ms");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
