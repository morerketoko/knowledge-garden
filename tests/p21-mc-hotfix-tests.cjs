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

// tests/p21-mc-hotfix-tests.ts
var fs = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));

// src/savedCardHydration.ts
function needsSavedCardHydration(card) {
  if (card.questionType !== "multiple_choice") return false;
  const optionsOk = Array.isArray(card.options) && card.options.length >= 2;
  return !optionsOk || !card.correctAnswer;
}
function questionMatchesText(a, b) {
  return (a || "").trim() === (b || "").trim();
}
function hydrateSavedReviewCardWith(card, getExam2, examsBySource) {
  if (card.questionType !== "multiple_choice") return { card, repaired: false, source: "existing" };
  const optionsOk = Array.isArray(card.options) && card.options.length >= 2;
  const needCorrect = !card.correctAnswer;
  if (optionsOk && !needCorrect) return { card, repaired: false, source: "existing" };
  if (!card.examId) return { card, repaired: false, source: "unavailable" };
  const exam = getExam2(card.examId);
  if (!exam) return { card, repaired: false, source: "unavailable" };
  let matched = null;
  const pick = (list, qid) => {
    if (qid) {
      const q2 = list.find((x) => x.id === qid);
      if (q2) return { q: q2, source: "exam" };
    }
    const exact = list.filter((x) => questionMatchesText(x.question, card.question));
    if (exact.length === 1) return { q: exact[0], source: "question-match" };
    return null;
  };
  matched = pick(exam.questions, card.examQuestionId);
  if (!matched) {
    const across = [];
    for (const e of examsBySource(card.sourcePath)) {
      if (e.questions) across.push(...e.questions);
    }
    const textMatches = across.filter((x) => questionMatchesText(x.question, card.question));
    if (textMatches.length === 1) {
      const q2 = textMatches[0];
      if (q2.type === "multiple_choice") matched = { q: q2, source: "question-match" };
    }
  }
  if (!matched || matched.q.type !== "multiple_choice") return { card, repaired: false, source: "unavailable" };
  const q = matched.q;
  const nextOptions = !optionsOk && Array.isArray(q.options) && q.options.length > 0 ? [...q.options] : card.options;
  const nextCorrect = needCorrect ? q.correctAnswer || card.correctAnswer : card.correctAnswer;
  const changed = (optionsOk ? false : JSON.stringify(nextOptions ?? null) !== JSON.stringify(card.options ?? null)) || (needCorrect ? nextCorrect !== card.correctAnswer : false);
  if (!changed) return { card, repaired: false, source: matched.source };
  return {
    card: { ...card, options: nextOptions, correctAnswer: nextCorrect },
    repaired: true,
    source: matched.source
  };
}
function hydrateSavedCardBatch(cards, examIndex, examsBySource) {
  const out = [];
  let repairedCount = 0;
  let unavailableCount = 0;
  for (const c of cards) {
    if (!needsSavedCardHydration(c)) {
      out.push(c);
      continue;
    }
    const res = hydrateSavedReviewCardWith(c, (id) => examIndex.get(id), examsBySource);
    if (res.repaired) repairedCount++;
    else if (res.source === "unavailable") unavailableCount++;
    out.push(res.card);
  }
  return { cards: out, repairedCount, unavailableCount };
}
function legacyMcCandidates(cards) {
  return cards.filter(needsSavedCardHydration);
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

// src/examStore.ts
function escYaml(s) {
  return '"' + (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function unescYaml(s) {
  const m = /^"(.*)"$/.exec(s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s;
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

// tests/p21-mc-hotfix-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function mkExam(id, qs) {
  return { id, sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u6D4B\u8BD5\u8003\u8BD5 " + id, mode: "holistic", questionCount: qs.length, answerMode: "source_only", questions: qs, examVersion: 1, createdAt: 1, updatedAt: 1 };
}
function baseCard(over) {
  return {
    id: "card1",
    sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    sourceVersion: "v1",
    examId: "e1",
    question: "\u54EA\u4E00\u9879\u6700\u80FD\u89E3\u91CA\u6A21\u5757\u5316\uFF1F",
    answer: "\u6A21\u5757\u5316\u901A\u8FC7\u9694\u79BB\u53D8\u5316\u964D\u4F4E\u8026\u5408\u3002",
    questionType: "multiple_choice",
    createdAt: 10,
    updatedAt: 10,
    reviewCount: 3,
    mastery: "good",
    masteryScore: 75,
    lastReviewedAt: 9,
    ...over
  };
}
var lookup = /* @__PURE__ */ new Map();
function getExam(id) {
  return lookup.get(id);
}
function bySource() {
  return Array.from(lookup.values());
}
{
  const q = { id: "q1", type: "multiple_choice", question: "\u54EA\u4E00\u9879\u6700\u80FD\u89E3\u91CA\u6A21\u5757\u5316\uFF1F", referenceAnswer: "A", options: ["\u964D\u4F4E\u8026\u5408", "\u589E\u52A0\u4EE3\u7801\u91CF", "\u6D88\u9664\u6240\u6709\u590D\u6742\u5EA6", "\u4E0D\u9700\u8981\u7EF4\u62A4"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" };
  const fresh = baseCard({ examQuestionId: "q1", options: [...q.options ?? []], correctAnswer: "A" });
  const parsed = parseCardMarkdown(cardMarkdown(fresh));
  test(
    "P-HF-MC-01",
    parsed.card?.options?.length === 4 && parsed.card?.correctAnswer === "A" && parsed.card?.options?.[0] === "\u964D\u4F4E\u8026\u5408",
    "\u65B0\u6536\u85CF MC \u5361\uFF1AMarkdown \u5F80\u8FD4\u4FDD\u7559 4 \u4E2A\u9009\u9879 + \u6B63\u786E\u7B54\u6848\uFF08\u6570\u636E\u5C42\uFF1BUI \u6E32\u67D3\u8FD0\u884C\u65F6\u9A8C\u8BC1\uFF09"
  );
  test("P-HF-MC-01b", needsSavedCardHydration(fresh) === false, "\u5B8C\u6574 MC \u5361\u65E0\u9700 hydration\uFF08\u4E0D\u5199\u76D8\uFF0C\xA712\uFF09");
  const h = hydrateSavedReviewCardWith(fresh, getExam, bySource);
  test(
    "P-HF-MC-01c",
    h.repaired === false && h.source === "existing" && h.card === fresh,
    "\u5B8C\u6574\u5361 hydration \u76F4\u63A5\u8FD4\u56DE\u4E14\u4E0D\u514B\u9686\uFF08\u96F6\u5F00\u9500\uFF09"
  );
}
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "qA", type: "multiple_choice", question: "\u6A21\u5757\u8FB9\u754C\u7684\u4F5C\u7528\uFF1F", referenceAnswer: "B", options: ["\u9694\u79BB\u53D8\u5316", "\u6D88\u9664\u590D\u6742\u5EA6", "\u9690\u85CF\u6D4B\u8BD5", "\u589E\u52A0\u8026\u5408"], correctAnswer: "B", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" },
    { id: "qB", type: "multiple_choice", question: "\u6A21\u5757\u8FB9\u754C\u7684\u4F5C\u7528\uFF08\u53E6\u4E00\u95EE\uFF09\uFF1F", referenceAnswer: "C", options: ["\u95191", "\u95192", "\u6B63\u786EC", "\u95194"], correctAnswer: "C", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }
  ]));
  const legacy = baseCard({ examQuestionId: "qA", options: void 0, correctAnswer: void 0 });
  const res = hydrateSavedReviewCardWith(legacy, getExam, bySource);
  test(
    "P-HF-MC-02",
    res.repaired === true && res.source === "exam" && res.card.options?.length === 4 && res.card.correctAnswer === "B",
    "\u65E7\u5361\u7F3A options\uFF1AexamId+examQuestionId \u81EA\u52A8\u6062\u590D\uFF08\xA74/7/40\uFF09"
  );
  test(
    "P-HF-MC-46",
    res.card.options?.[1] === "\u6D88\u9664\u590D\u6742\u5EA6",
    "\u9898\u5E72\u76F8\u4F3C\u7684\u4E24\u9898\uFF1AexamQuestionId \u6B63\u786E \u2192 \u6062\u590D\u6B63\u786E\u9009\u9879\uFF08\xA746\uFF09"
  );
  const snapshotSame = legacy.question === res.card.question && legacy.answer === res.card.answer && legacy.sourceEvidence === res.card.sourceEvidence && legacy.createdAt === res.card.createdAt && legacy.id === res.card.id && legacy.examId === res.card.examId && legacy.examQuestionId === res.card.examQuestionId && legacy.reviewCount === res.card.reviewCount && legacy.masteryScore === res.card.masteryScore && legacy.lastReviewedAt === res.card.lastReviewedAt;
  test("P-HF-MC-02b", snapshotSame, "\u6062\u590D\u53EA\u8865 options/correctAnswer\uFF0C\u5FEB\u7167\u5176\u4F59\u5B57\u6BB5\u4E0E FSRS/mastery/reviewCount \u4E0D\u53D8\uFF08\xA76/37/56~58\uFF09");
}
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "q0", type: "multiple_choice", question: "\u7A7A\u9009\u9879\u6D4B\u8BD5", referenceAnswer: "A", options: ["\u7532", "\u4E59", "\u4E19", "\u4E01"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }
  ]));
  const empty = baseCard({ examQuestionId: "q0", options: [] });
  const one = baseCard({ examQuestionId: "q0", options: ["\u7532"] });
  test(
    "P-HF-MC-52",
    needsSavedCardHydration(empty) === true && hydrateSavedReviewCardWith(empty, getExam, bySource).repaired === true,
    "options=[] \u4E0D\u8BEF\u8BA4\u4E3A\u6709\u6548 \u2192 \u89E6\u53D1 hydration\uFF08\xA752\uFF09"
  );
  test(
    "P-HF-MC-53",
    needsSavedCardHydration(one) === true && hydrateSavedReviewCardWith(one, getExam, bySource).repaired === true,
    "options=[1 \u9879] \u89C6\u4E3A\u5F02\u5E38 \u2192 \u4F18\u5148\u4ECE Exam \u4FEE\u590D\uFF08\xA753\uFF09"
  );
  const many = baseCard({ examQuestionId: "q0", options: ["\u4E00", "\u4E8C", "\u4E09", "\u56DB"], correctAnswer: "A" });
  test(
    "P-HF-MC-54",
    needsSavedCardHydration(many) === false && many.options?.length === 4,
    "options > 2 \u2192 \u5168\u90E8\u4FDD\u7559\u4E0D\u8986\u76D6\uFF08\xA754/17/18\uFF09"
  );
}
{
  lookup.clear();
  const noExam = baseCard({ examId: void 0 });
  const res1 = hydrateSavedReviewCardWith(noExam, getExam, bySource);
  test("P-HF-MC-42", res1.repaired === false && res1.source === "unavailable", "\u65E0 examId\uFF1A\u4E0D\u731C\u9898\uFF0Cunavailable\uFF08\xA79/42\uFF09");
  lookup.set("e1", mkExam("e1", [{ id: "qX", type: "multiple_choice", question: "\u9898", referenceAnswer: "A", options: ["a", "b", "c", "d"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }]));
  lookup.delete("e1");
  const goneExam = baseCard({ examQuestionId: "qX" });
  const res2 = hydrateSavedReviewCardWith(goneExam, getExam, bySource);
  test("P-HF-MC-43", res2.repaired === false && res2.source === "unavailable", "Exam \u5DF2\u5220\u9664\uFF1Aunavailable\uFF0C\u4E0D\u5D29\uFF08\xA78/43/70\uFF09");
}
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "u1", type: "multiple_choice", question: "\u552F\u4E00\u9898\u9762", referenceAnswer: "B", options: ["x", "B", "y", "z"], correctAnswer: "B", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }
  ]));
  const noQid = baseCard({ examQuestionId: void 0, question: "\u552F\u4E00\u9898\u9762" });
  const resU = hydrateSavedReviewCardWith(noQid, getExam, bySource);
  test(
    "P-HF-MC-44",
    resU.repaired === true && resU.source === "question-match" && resU.card.options?.length === 4 && resU.card.correctAnswer === "B",
    "\u65E0 examQuestionId\uFF1AexamId \u5185\u9898\u5E72\u552F\u4E00\u7CBE\u786E\u5339\u914D \u2192 \u6062\u590D\uFF08\xA744\uFF09"
  );
  lookup.clear();
  lookup.set("e1", mkExam("e1", [
    { id: "a", type: "multiple_choice", question: "\u76F8\u540C\u9898\u5E72", referenceAnswer: "A", options: ["A1", "A2", "A3", "A4"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" },
    { id: "b", type: "multiple_choice", question: "\u76F8\u540C\u9898\u5E72", referenceAnswer: "B", options: ["B1", "B2", "B3", "B4"], correctAnswer: "B", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }
  ]));
  const amb = baseCard({ examQuestionId: void 0, question: "\u76F8\u540C\u9898\u5E72" });
  const resA = hydrateSavedReviewCardWith(amb, getExam, bySource);
  test(
    "P-HF-MC-45",
    resA.repaired === false && resA.source === "unavailable",
    "\u9898\u5E72\u6B67\u4E49\uFF08\u4E24\u9898\u76F8\u540C\u3001\u65E0 examQuestionId\uFF09\uFF1A\u4E0D\u80FD\u731C\uFF0C\u4E0D\u81EA\u52A8\u6062\u590D\uFF08\xA745\uFF09"
  );
  lookup.clear();
  lookup.set("eA", mkExam("eA", [{ id: "s1", type: "multiple_choice", question: "\u5168\u5C40\u552F\u4E00\uFF1F", referenceAnswer: "C", options: ["p", "q", "C", "r"], correctAnswer: "C", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }]));
  lookup.set("eB", mkExam("eB", [{ id: "t1", type: "multiple_choice", question: "\u53E6\u4E00\u9898", referenceAnswer: "A", options: ["1", "2", "3", "4"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md" }]));
  const srcOnly = baseCard({ examId: "eA", examQuestionId: void 0, question: "\u5168\u5C40\u552F\u4E00\uFF1F" });
  const resS = hydrateSavedReviewCardWith(srcOnly, getExam, bySource);
  test(
    "P-HF-MC-44b",
    resS.repaired === true && resS.source === "question-match" && resS.card.correctAnswer === "C",
    "question \u6587\u672C\u552F\u4E00\u5339\u914D\uFF08\u8003\u8BD5\u5185\uFF09\u6062\u590D\u6210\u529F"
  );
}
{
  lookup.clear();
  lookup.set("e1", mkExam("e1", [{ id: "q1", type: "multiple_choice", question: "\u54EA\u4E00\u9879\u6700\u80FD\u89E3\u91CA\u6A21\u5757\u5316\uFF1F", referenceAnswer: "A", options: ["\u65B0\u7248A", "\u65B0\u7248B", "\u65B0\u7248C", "\u65B0\u7248D"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }]));
  const kept = baseCard({ examQuestionId: "q1", options: ["\u65E7\u72481", "\u65E7\u72482", "\u65E7\u72483", "\u65E7\u72484"], correctAnswer: "X" });
  const resK = hydrateSavedReviewCardWith(kept, getExam, bySource);
  test(
    "P-HF-MC-47",
    resK.repaired === false && resK.card.options?.join("|") === "\u65E7\u72481|\u65E7\u72482|\u65E7\u72483|\u65E7\u72484" && resK.card.correctAnswer === "X",
    "\u5DF2\u5B58\u5728 options/correctAnswer\uFF1A\u4FDD\u7559 card \u5FEB\u7167\uFF0C\u4E0D\u88AB Exam \u65B0\u7248\u8986\u76D6\uFF08\xA717~19/47\uFF09"
  );
  const noCorrect = baseCard({ examQuestionId: "q1", options: ["\u65E7\u72481", "\u65E7\u72482", "\u65E7\u72483", "\u65E7\u72484"], correctAnswer: void 0 });
  const resC = hydrateSavedReviewCardWith(noCorrect, getExam, bySource);
  test(
    "P-HF-MC-48",
    resC.repaired === true && resC.card.correctAnswer === "A" && resC.card.options?.length === 4,
    "\u5DF2\u6709 options \u4F46 correctAnswer \u7F3A\u5931 \u2192 \u53EA\u8865 correctAnswer\uFF08\xA748\uFF09"
  );
}
{
  const examIndex = /* @__PURE__ */ new Map();
  examIndex.set("e1", mkExam("e1", [{ id: "b1", type: "multiple_choice", question: "\u6279\u91CF\u9898", referenceAnswer: "A", options: ["1", "2", "3", "4"], correctAnswer: "A", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }]));
  const cards = [
    baseCard({ id: "ok", examQuestionId: "b1", options: ["1", "2", "3", "4"], correctAnswer: "A" }),
    baseCard({ id: "fix", examQuestionId: "b1" }),
    baseCard({ id: "nope", examId: void 0 }),
    baseCard({ id: "txt", questionType: "recall" })
  ];
  const batch = hydrateSavedCardBatch(cards, examIndex, () => Array.from(examIndex.values()));
  test(
    "P-HF-MC-02c",
    batch.cards.length === 4 && batch.repairedCount === 1 && batch.cards.find((c) => c.id === "fix")?.options?.length === 4,
    "\u6279\u91CF hydration\uFF1A\u53EA\u4FEE\u590D\u9700\u8981\u4FEE\u590D\u7684\u5361\uFF08\u5176\u4F59\u539F\u6837\uFF09\uFF0Cexam \u6309 Map \u7F13\u5B58\uFF08\xA762~64\uFF09"
  );
  test("P-HF-MC-02d", legacyMcCandidates(cards).length === 2, "legacy \u5019\u9009\u7EDF\u8BA1\uFF08MC \u4E14\u7F3A options/\u65E0 examId\uFF09");
}
{
  const withComma = baseCard({ examQuestionId: "q1", options: ["A, \u7B2C\u4E00\u79CD\u60C5\u51B5", "B, \u7B2C\u4E8C\u79CD\u60C5\u51B5", "C", "D"], correctAnswer: "A" });
  const p1 = parseCardMarkdown(cardMarkdown(withComma));
  test(
    "P-HF-MC-20",
    p1.card?.options?.length === 4 && p1.card?.options?.[0] === "A, \u7B2C\u4E00\u79CD\u60C5\u51B5" && p1.card?.options?.[1] === "B, \u7B2C\u4E8C\u79CD\u60C5\u51B5",
    "\u5E26\u9017\u53F7\u9009\u9879\uFF1AJSON \u4F18\u5148\u89E3\u6790 \u2192 \u4ECD 4 \u9879\uFF08\xA722\uFF0C\u65E7 split \u4F1A\u4E22\uFF09"
  );
  const withQuote = baseCard({ examQuestionId: "q1", options: ['\u4ED6\u8BF4"\u5BF9"', "\u666E\u901AB", "\u666E\u901AC", "\u666E\u901AD"], correctAnswer: "A" });
  const p2 = parseCardMarkdown(cardMarkdown(withQuote));
  test(
    "P-HF-MC-20b",
    p2.card?.options?.[0] === '\u4ED6\u8BF4"\u5BF9"' && p2.card?.options?.length === 4,
    "\u5E26\u5F15\u53F7\u9009\u9879\uFF1AJSON encoding/decoding \u6B63\u5E38\uFF08\xA723\uFF09"
  );
  const uni = baseCard({ examQuestionId: "q1", options: ["\uFF21\uFF0E\u4E2D\u6587\u9009\u9879", "\uFF22\uFF0E\u4EBA\u5DE5\u667A\u80FD", "\uFF23\uFF0E\u6E38\u620F\u8BBE\u8BA1", "\uFF24\uFF0E\u77E5\u8BC6\u7BA1\u7406"], correctAnswer: "\uFF21" });
  const p3 = parseCardMarkdown(cardMarkdown(uni));
  test(
    "P-HF-MC-24",
    p3.card?.options?.join("|") === "\uFF21\uFF0E\u4E2D\u6587\u9009\u9879|\uFF22\uFF0E\u4EBA\u5DE5\u667A\u80FD|\uFF23\uFF0E\u6E38\u620F\u8BBE\u8BA1|\uFF24\uFF0E\u77E5\u8BC6\u7BA1\u7406",
    "Unicode/\u5168\u89D2\u9009\u9879\u5B8C\u6574\u4FDD\u7559\uFF08\xA724/50\uFF09"
  );
  const emoji = baseCard({ examQuestionId: "q1", options: ["\u{1F600} \u8BB0\u5F97\u4F4F", "\u{1F3AE} \u6E38\u620F", "\u{1F9E0} \u8BB0\u5FC6", "\u2705 \u638C\u63E1"], correctAnswer: "D" });
  const p4 = parseCardMarkdown(cardMarkdown(emoji));
  test(
    "P-HF-MC-51",
    p4.card?.options?.includes("\u{1F600} \u8BB0\u5F97\u4F4F") && p4.card?.options?.includes("\u{1F3AE} \u6E38\u620F") && p4.card?.options?.length === 4,
    "emoji \u9009\u9879\u4E0D\u4E22\u5931\uFF08\xA751\uFF09"
  );
  const rt = parseCardMarkdown(cardMarkdown(withComma));
  test(
    "P-HF-MC-49",
    JSON.stringify(rt.card?.options) === JSON.stringify(withComma.options) && rt.card?.correctAnswer === withComma.correctAnswer,
    "cardMarkdown \u2192 parseCardMarkdown roundtrip\uFF1Aoptions/correctAnswer \u5B8C\u5168\u4E00\u81F4\uFF08\xA749\uFF09"
  );
}
{
  const dir = mkdtemp(path.join(os.tmpdir(), "kg-mc-"));
  const store = new ReviewCardStore(dir);
  store.load();
  const legacy = baseCard({ id: "p1", examQuestionId: "q1" });
  store.add(legacy);
  store.update("p1", { options: ["\u964D\u4F4E\u8026\u5408", "\u589E\u52A0\u4EE3\u7801", "\u6D88\u9664\u590D\u6742\u5EA6", "\u514D\u7EF4\u62A4"], correctAnswer: "A" });
  const reloaded = new ReviewCardStore(dir);
  reloaded.load();
  const c = reloaded.get("p1");
  test(
    "P-HF-MC-41",
    c?.options?.length === 4 && c?.correctAnswer === "A",
    "\u6062\u590D\u540E\u91CD\u65B0\u8BFB\u53D6 cards.json\uFF1Aoptions \u5B58\u5728\uFF08Review Card Markdown \u540C\u6B65\u7531 writeSavedCardMarkdown \u8D1F\u8D23\uFF0C\u8FD0\u884C\u5C42\uFF09"
  );
  const mdHas = cardMarkdown(reloaded.get("p1")).includes('options: ["\u964D\u4F4E\u8026\u5408", "\u589E\u52A0\u4EE3\u7801", "\u6D88\u9664\u590D\u6742\u5EA6", "\u514D\u7EF4\u62A4"]');
  test("P-HF-MC-41b", mdHas, "\u6062\u590D\u540E\u91CD\u65B0\u751F\u6210 Review Card Markdown\uFF1Aoptions \u5B58\u5728\uFF08\xA738/41\uFF09");
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path.join(__dirname, "..", "src", "savedCardHydration.ts");
  const src = stripComments(fs.readFileSync(srcPath, "utf8"));
  test(
    "P-HF-MC-55",
    !/\bAI\b|prompt|apiKey|generate|https?:/.test(src) && !/activity|markReviewed/.test(src),
    "hydration/repair/parse \u5168\u7A0B 0 AI\uFF0C\u4E14\u4E0D\u89E6\u53D1 Activity/markReviewed\uFF08\xA755/59/60\uFF09"
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
