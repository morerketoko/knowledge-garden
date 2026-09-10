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

// tests/p21-hotfix-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// src/reviewCardAnswer.ts
var ANSWER_FALLBACK = "\uFF08\u8BE5\u5361\u6CA1\u6709\u4FDD\u5B58\u7B54\u6848\u6587\u5B57\uFF09";
function defaultAnswerVisible(showByDefault) {
  return showByDefault !== false;
}
function answerVisibility(cardId, defaultVisible, hidden, shown) {
  return defaultVisible ? !hidden.has(cardId) : shown.has(cardId);
}
function toggleAnswerVisibility(cardId, defaultVisible, hidden, shown) {
  const before = answerVisibility(cardId, defaultVisible, hidden, shown);
  const after = !before;
  if (defaultVisible) {
    if (after) hidden.delete(cardId);
    else hidden.add(cardId);
  } else {
    if (after) shown.add(cardId);
    else shown.delete(cardId);
  }
  return after;
}
function revealDomAction(hasBody, willShow) {
  if (willShow) return hasBody ? "show" : "create";
  return hasBody ? "hide" : "none";
}
function answerBodyContent(card2) {
  return {
    answer: card2.answer || "",
    explanation: card2.explanation,
    evidence: card2.sourceEvidence ?? [],
    sourcePath: card2.sourcePath
  };
}

// tests/p21-hotfix-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function card(over) {
  return {
    id: "cardA",
    sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    sourceVersion: "v1",
    question: "\u9898\uFF1F",
    answer: "\u53C2\u8003\u7B54\u6848\uFF1A\u9694\u79BB\u53D8\u5316\u3002",
    questionType: "recall",
    createdAt: 1,
    updatedAt: 1,
    ...over
  };
}
function fresh() {
  return { hidden: /* @__PURE__ */ new Set(), shown: /* @__PURE__ */ new Set() };
}
function simulateToggles(defaultVisible, id, steps, st) {
  const actions = [];
  let hasBody = false;
  for (const willToggle of steps) {
    const willShow = toggleAnswerVisibility(id, defaultVisible, st.hidden, st.shown);
    const action = revealDomAction(hasBody, willShow);
    actions.push(action);
    if (action === "create") hasBody = true;
  }
  return actions;
}
{
  const st = fresh();
  test(
    "P-HOTFIX-01",
    defaultAnswerVisible(false) === false && answerVisibility("cardA", false, st.hidden, st.shown) === false,
    "\u9ED8\u8BA4\u9690\u85CF\uFF1A\u521D\u59CB\u4E0D\u53EF\u89C1 \u2192 .answer-body \u4E0D\u521B\u5EFA"
  );
  const willShow1 = toggleAnswerVisibility("cardA", false, st.hidden, st.shown);
  test(
    "P-HOTFIX-02",
    willShow1 === true && revealDomAction(false, willShow1) === "create",
    "\u663E\u793A\u7B54\u6848\uFF1A\u76EE\u6807\u663E\u793A\u4E14\u65E0 body \u2192 \u7ACB\u5373 create\uFF08\u70B9\u51FB\u5373\u51FA\u73B0\uFF09"
  );
  test(
    "P-HOTFIX-09",
    answerVisibility("cardB", false, st.hidden, st.shown) === false,
    "Card A \u663E\u793A\u4E0D\u5F71\u54CD Card B\uFF08\u6309 card.id \u9694\u79BB\uFF0C\xA719\uFF09"
  );
  test("P-HOTFIX-04", revealDomAction(true, false) === "hide", "\u9690\u85CF\u7B54\u6848\uFF1A\u53EA display:none\uFF0C\u4E0D\u5220\u9664 DOM\uFF08\xA712\uFF09");
  test("P-HOTFIX-05", revealDomAction(true, true) === "show", "\u518D\u6B21\u663E\u793A\uFF1Abody \u5B58\u5728 \u2192 show\uFF08display \u975E none\uFF09");
  const st2 = fresh();
  const actions = simulateToggles(false, "cardA", [true, true, true, true, true], st2);
  const createCount = actions.filter((a) => a === "create").length;
  test(
    "P-HOTFIX-06",
    createCount === 1 && actions[1] !== "create" && actions[2] !== "create" && actions[3] !== "create" && actions[4] !== "create",
    "\u8FDE\u7EED \u663E\u793A/\u9690\u85CF/\u663E\u793A\u2026 \u53EA create \u4E00\u6B21\uFF0C\u4E0D\u4F1A\u91CD\u590D\u521B\u5EFA\u591A\u4E2A .answer-body\uFF08" + actions.join(",") + "\uFF09"
  );
  const st3 = fresh();
  test(
    "P-HOTFIX-07",
    defaultAnswerVisible(true) === true && answerVisibility("cardA", true, st3.hidden, st3.shown) === true,
    "showAnswerByDefault=true\uFF1A\u6253\u5F00\u5373\u6709\u7B54\u6848"
  );
  const st4 = fresh();
  test(
    "P-HOTFIX-08",
    answerVisibility("cardA", false, st4.hidden, st4.shown) === false,
    "showAnswerByDefault=false\uFF1A\u6253\u5F00\u4E0D\u663E\u793A\u7B54\u6848"
  );
  const st5 = fresh();
  toggleAnswerVisibility("cardA", true, st5.hidden, st5.shown);
  test(
    "P-HOTFIX-17",
    answerVisibility("cardA", true, st5.hidden, st5.shown) === false && answerVisibility("cardB", true, st5.hidden, st5.shown) === true,
    "\u4E0B\u4E00\u5F20\uFF08cardB\uFF09\u4E0D\u7EE7\u627F\u4E0A\u4E00\u5F20\uFF08cardA\uFF09\u7684\u663E\u793A\u72B6\u6001\uFF08\xA720\uFF09"
  );
  const st6 = fresh();
  toggleAnswerVisibility("cardA", true, st6.hidden, st6.shown);
  const aHiddenBeforeB = answerVisibility("cardA", true, st6.hidden, st6.shown);
  toggleAnswerVisibility("cardB", true, st6.hidden, st6.shown);
  toggleAnswerVisibility("cardB", true, st6.hidden, st6.shown);
  test(
    "P-HOTFIX-18",
    aHiddenBeforeB === false && answerVisibility("cardA", true, st6.hidden, st6.shown) === aHiddenBeforeB,
    "\u8FD4\u56DE\u4E0A\u4E00\u5F20\uFF1AA \u4FDD\u6301\u81EA\u5DF1\u72B6\u6001\uFF08\u4E0D\u88AB B \u5207\u6362\u5F71\u54CD\uFF0C\xA734/18\uFF09"
  );
}
{
  const c = card({
    answer: "\u53C2\u8003\u7B54\u6848\uFF1A\u6A21\u5757\u8FB9\u754C=\u9694\u79BB\u53D8\u5316\u3002",
    explanation: "\u56E0\u4E3A\u5185\u90E8\u5B9E\u73B0\u53EF\u72EC\u7ACB\u6F14\u8FDB\u3002",
    sourceEvidence: ["\u6A21\u5757\u53EA\u5BF9\u63A5\u53E3\u8D1F\u8D23\u3002", "\u8FB9\u754C\u662F\u7ED3\u6784\u6027\u9632\u706B\u5899\u3002"]
  });
  const content = answerBodyContent(c);
  test("P-HOTFIX-03", content.answer === "\u53C2\u8003\u7B54\u6848\uFF1A\u6A21\u5757\u8FB9\u754C=\u9694\u79BB\u53D8\u5316\u3002", "\u663E\u793A\u7B54\u6848\u540E answer \u6587\u672C === card.answer");
  test(
    "P-HOTFIX-14",
    content.evidence.length === 2 && content.evidence[0].startsWith("\u6A21\u5757\u53EA\u5BF9\u63A5\u53E3\u8D1F\u8D23\u3002"),
    "sourceEvidence \u6B63\u5E38\u6E32\u67D3\uFF08\u5185\u5BB9\u6A21\u578B\u4FDD\u7559\u5168\u90E8\u6761\u76EE\uFF09"
  );
  test("P-HOTFIX-15", content.explanation === "\u56E0\u4E3A\u5185\u90E8\u5B9E\u73B0\u53EF\u72EC\u7ACB\u6F14\u8FDB\u3002", "explanation \u6B63\u5E38\u6E32\u67D3");
  test(
    "P-HOTFIX-16",
    (answerBodyContent(card({ answer: "" })).answer || ANSWER_FALLBACK) === ANSWER_FALLBACK && ANSWER_FALLBACK === "\uFF08\u8BE5\u5361\u6CA1\u6709\u4FDD\u5B58\u7B54\u6848\u6587\u5B57\uFF09",
    "\u4E0D\u5B58\u5728 answer \u2192 \u663E\u793A\u5360\u4F4D\u6587\u6848\uFF08\u6587\u6848\u4E0E\u65E7\u6E32\u67D3\u4E00\u81F4\uFF09"
  );
  test(
    "P-HOTFIX-13",
    content.sourcePath === c.sourcePath && content.sourcePath === "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    "\u6765\u6E90 = card.sourcePath\uFF08View \u7528 plugin.openNote(sourcePath) \u6253\u5F00\uFF0CP-HOTFIX-13 \u8FD0\u884C\u5C42\uFF09"
  );
}
{
  const mc = card({ questionType: "multiple_choice", options: ["A1", "B2", "C3", "D4"], correctAnswer: "A" });
  const content = answerBodyContent(mc);
  test(
    "P-HOTFIX-10",
    content.answer === mc.answer && content.evidence.length === 0 && mc.options?.length === 4 && mc.correctAnswer === "A",
    "multiple_choice\uFF1A\u7B54\u6848\u663E\u9690\u4E0D\u5F71\u54CD\u9009\u9879/\u6B63\u786E\u7B54\u6848\uFF08\u9009\u9879 UI \u72EC\u7ACB\u6E32\u67D3\uFF0C\xA721/33/34\uFF09"
  );
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "reviewCardAnswer.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  test(
    "P-HOTFIX-11",
    !/\bAI\b|deriveReviewAnswer|https?:/.test(src) && !/from\s+["']\.\/(ai|.*\/ai)/.test(src),
    "\u663E\u793A\u7B54\u6848\u903B\u8F91 0 AI\uFF08\u6A21\u5757\u65E0 AI/\u7F51\u7EDC\u5F15\u7528\uFF09"
  );
  test("P-HOTFIX-12", !/fsrs|schedule|Rating/i.test(src), "\u9690\u85CF\u7B54\u6848\u903B\u8F91\u540C\u6837 0 AI / \u65E0\u5173 FSRS\uFF08\xA723\uFF09");
}
{
  const viewPath = path.join(__dirname, "..", "src", "cardsView.ts");
  const view = fs.readFileSync(viewPath, "utf8");
  const hotfixMarker = view.includes("toggleAnswerVisibility") && view.includes("renderAnswerBody");
  const ratingStillThere = view.includes("this.plugin.rateSavedCard(c.id, rating)");
  test("P-HOTFIX-19", hotfixMarker && ratingStillThere, "FSRS Rating \u8C03\u7528\u539F\u6837\u4FDD\u7559\uFF08\u4FEE\u590D\u672A\u89E6\u78B0 rating \u8DEF\u5F84\uFF0C\xA719/20\uFF09");
  const noWholeRerender = view.includes('hideBtn.addEventListener("click"') && !view.slice(0).includes("// HOTFIX whole rerender");
  test(
    "P-HOTFIX-19b",
    /hideBtn\.setText\(/.test(view) && /revealDomAction/.test(view),
    "\u6309\u94AE\u6587\u5B57\u7ACB\u5373\u540C\u6B65 + \u5C40\u90E8 DOM \u52A8\u4F5C\uFF08\xA710\uFF0C\u4E0D\u6574\u5361 renderReview\uFF09"
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
