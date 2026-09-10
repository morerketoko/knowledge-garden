"use strict";

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
  async exists(path) {
    const p = normalizeVaultPath(path);
    if (this.files.has(p)) return true;
    return this.hasChildren(p);
  }
  async isFile(path) {
    return this.files.has(normalizeVaultPath(path));
  }
  async isDirectory(path) {
    const p = normalizeVaultPath(path);
    if (!p) return true;
    return this.hasChildren(p);
  }
  hasChildren(p) {
    const prefix = p + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  async read(path) {
    const v = this.files.get(normalizeVaultPath(path));
    return v === void 0 ? null : v;
  }
  async write(path, data) {
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("memory root: injected write failure");
    }
    this.files.set(normalizeVaultPath(path), data);
  }
  async remove(path) {
    const p = normalizeVaultPath(path);
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
  async list(path) {
    const p = normalizeVaultPath(path);
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
  isEmptyDir(path) {
    const prefix = (normalizeVaultPath(path) || "") + "/";
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
  async exists(path) {
    return this.root.exists(normalizeVaultPath(path));
  }
  async readText(path) {
    return this.root.read(normalizeVaultPath(path));
  }
  async readJson(path) {
    const raw = await this.readText(path);
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
  async writeText(path, data, opts) {
    const p = normalizeVaultPath(path);
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
  async writeJson(path, value, opts) {
    return this.writeText(path, JSON.stringify(value), opts);
  }
  async remove(path) {
    return this.root.remove(normalizeVaultPath(path));
  }
  async rename(from, to) {
    return this.root.rename(normalizeVaultPath(from), normalizeVaultPath(to));
  }
  /** 列出目录下的直接子项（相对 path 的名字） */
  async list(path) {
    return this.root.list(normalizeVaultPath(path));
  }
  async isDirectory(path) {
    return this.root.isDirectory(normalizeVaultPath(path));
  }
  async isFile(path) {
    return this.root.isFile(normalizeVaultPath(path));
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
  backendFor(path) {
    const p = normalizeVaultPath(path);
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
  resolve(path) {
    const raw = String(path ?? "").replace(/\\/g, "/");
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
  async write(path, data, opts) {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    const key = backend === this.dataStorage ? this.dataKey(target) : target;
    return backend.writeText(key, data, opts);
  }
  async read(path) {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.readText(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async exists(path) {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.exists(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async remove(path) {
    const target = this.resolve(path);
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
  async list(path) {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.list(backend === this.dataStorage ? this.dataKey(target) : target);
  }
  async isDirectory(path) {
    const target = this.resolve(path);
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
  static isSafe(path) {
    const raw = String(path ?? "").replace(/\\/g, "/");
    if (!raw) return false;
    if (isUnsafeRelativePath(raw)) return false;
    const n = normalizeVaultPath(raw);
    if (!n.length) return false;
    return !isReservedStoragePath(n);
  }
  /** 某个存储路径的父目录（创建文件前用） */
  dirOf(path) {
    return dirnameVaultPath(this.resolve(path));
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

// src/workbenchLinks.ts
var BEFORE_BLOCK = /[A-Za-z0-9_-]/;
var AFTER_BLOCK = /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9_-]/;
var CJKRUN = /[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g;
function linkifyAnswerText(text, sources) {
  const vault2 = (sources ?? []).filter((s) => s.type === "vault" && s.path);
  if (vault2.length === 0) return text || "";
  const cands = [];
  const seenBases = /* @__PURE__ */ new Set();
  for (const s of vault2) {
    const p = s.path;
    const stem = p.replace(/\.md$/i, "");
    const base = stem.split("/").pop() || stem;
    cands.push({ pattern: p, link: stem });
    cands.push({ pattern: stem, link: stem });
    if (!seenBases.has(base)) {
      seenBases.add(base);
      cands.push({ pattern: base, link: stem });
    }
  }
  cands.sort((a, b) => b.pattern.length - a.pattern.length);
  const P0 = "\uE000";
  const P1 = "\uE001";
  const slots = [];
  let out = text || "";
  let n = 0;
  for (const c of cands) {
    if (c.pattern.length < 1) continue;
    const token = P0 + n + P1;
    slots.push("[[" + c.link + "]]");
    out = replaceBoundary(out, c.pattern, token);
    n++;
  }
  return out.replace(new RegExp(P0 + "(\\d+)" + P1, "g"), (_m, d) => slots[Number(d)] ?? "");
}
function replaceBoundary(text, pattern, replacement) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(pattern, i);
    if (idx < 0) {
      out += text.slice(i);
      break;
    }
    const before = idx > 0 ? text[idx - 1] : "";
    const after = text[idx + pattern.length] ?? "";
    if (!BEFORE_BLOCK.test(before) && !AFTER_BLOCK.test(after)) {
      out += text.slice(i, idx) + replacement;
      i = idx + pattern.length;
    } else {
      out += text.slice(i, idx + 1);
      i = idx + 1;
    }
  }
  return out;
}
function extractEvidenceSnippet(content, reason, limit = 500) {
  const body = (content || "").trim();
  if (!body) return "";
  const keywords = (reason || "").match(CJKRUN) ?? [];
  if (keywords.length) {
    const ordered = [...new Set(keywords)].sort((a, b) => b.length - a.length);
    for (const k of ordered) {
      const at = body.indexOf(k);
      if (at >= 0) {
        const half = Math.floor(limit / 2);
        const start = Math.max(0, at - half);
        const slice = body.slice(start, start + limit);
        return (start > 0 ? "\u2026" : "") + slice + (start + limit < body.length ? "\u2026" : "");
      }
    }
  }
  return body.slice(0, limit) + (body.length > limit ? "\u2026" : "");
}
function existingVaultSources(sources, exists) {
  return (sources ?? []).filter(
    (s) => s.type !== "vault" || !!s.path && exists(s.path)
  );
}

// tests/linkify-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
var vault = (p, title) => ({ type: "vault", path: p, title: title ?? p });
{
  const out = linkifyAnswerText("\u6839\u636E Vault \u5019\u9009\u6E05\u5355\uFF0C\u627E\u5230\u7B14\u8BB0\uFF1A01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md")]);
  test("R1", out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212]]") && !out.includes("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md"), "\u5B8C\u6574\u8DEF\u5F84\u66FF\u6362\u4E3A\u53EF\u70B9\u51FB wikilink\uFF1A" + out);
}
{
  const out = linkifyAnswerText("\u5176\u4E2D\u6700\u76F4\u63A5\u7684\u662F \u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md")]);
  test("R2", out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212]]") && !out.includes("\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212\u3002"), "\u6B63\u6587\u4E2D\u7684\u7B14\u8BB0\u540D\u81EA\u52A8\u53D8\u6210\u94FE\u63A5\uFF1A" + out);
}
{
  const out = linkifyAnswerText("\u6211\u5199\u8FC7\u4E00\u7BC7\u5173\u4E8E\u6E38\u620F\u8BBE\u8BA1\u7684\u6587\u7AE0\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F.md")]);
  test("R3", !out.includes("[["), "\u77ED\u540D\u4E0D\u8BEF\u94FE\u8FDB\u5165\u957F\u8BCD\u5185\u90E8\uFF1A" + out);
}
{
  const out = linkifyAnswerText("\u76F8\u5173\u7B14\u8BB0\uFF1A\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212\u3001\u6E38\u620F\u6846\u67B6\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md"), vault("01 \u76D2\u5B50/\u6E38\u620F\u6846\u67B6.md")]);
  test("R4", out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212]]") && out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6846\u67B6]]"), "\u591A\u6765\u6E90\u5168\u90E8\u94FE\u63A5\u5316");
}
{
  const out = linkifyAnswerText("\u53E6\u5916\u8FD8\u63D0\u5230\u4E86 \u54F2\u5B66\u6C89\u601D\u5F55\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md")]);
  test("R5", !out.includes("[[\u54F2\u5B66") && !out.includes("[["), "\u975E\u6765\u6E90\u540D\u79F0\u4FDD\u6301\u539F\u6837\uFF1A" + out);
}
{
  const srcs = [{ type: "web", url: "https://example.com", title: "Example" }, { type: "inference", snippet: "\u63A8\u7406\u5185\u5BB9" }, vault("01 \u76D2\u5B50/\u6E38\u620F.md")];
  const out = linkifyAnswerText("\u89C1 Example \u4E0E \u6E38\u620F\u3002", srcs);
  test("R6", !out.includes("[[Example") && out.includes("[[01 \u76D2\u5B50/\u6E38\u620F]]"), "\u4EC5 vault source \u53C2\u4E0E\u94FE\u63A5\u5316\uFF1A" + out);
}
{
  const src = vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md");
  const out = linkifyAnswerText("\u8DEF\u5F84\uFF1A01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md\uFF0C\u540D\u79F0\uFF1A\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212", [src]);
  test("R7", !out.includes("[[[[") && out.split("[[").length - 1 === 2 && !out.includes("\xB7md]]"), "\u957F\u4F18\u5148\u4E14\u9632\u5D4C\u5957\uFF0C\u6070\u4E24\u4E2A\u94FE\u63A5\uFF1A" + out);
}
{
  test("R8", linkifyAnswerText("", [vault("01 \u76D2\u5B50/\u6E38\u620F.md")]) === "" && linkifyAnswerText("\u6B63\u6587", []) === "\u6B63\u6587", "\u7A7A\u8F93\u5165\u5B89\u5168");
}
{
  const srcs = [vault("\u76EE\u5F55A/\u540C\u540D.md"), vault("\u76EE\u5F55B/\u540C\u540D.md")];
  const out = linkifyAnswerText("\u53C2\u89C1 \u540C\u540D\u3002", srcs);
  test("R9", out.split("[[").length - 1 === 1, "\u91CD\u590D basename \u4EC5\u751F\u6210\u4E00\u4E2A\u94FE\u63A5\uFF1A" + out);
}
{
  const body = "\u7B2C\u4E00\u6BB5\u539F\u6587\u5185\u5BB9\u3002" + "\u8865\u5145\u6587\u5B57".repeat(120);
  const snip = extractEvidenceSnippet(body);
  test("R10", snip.length <= 505 && snip.startsWith("\u7B2C\u4E00\u6BB5\u539F\u6587\u5185\u5BB9"), "\u8BC1\u636E\u7247\u6BB5\u53D6\u81EA\u771F\u5B9E\u539F\u6587\u5F00\u5934\uFF08\u975E AI \u751F\u6210\uFF09");
}
{
  const body = "\u5F00\u573A\u94FA\u57AB\u3002" + "\u5173".repeat(30) + "\u6E38\u620F\u673A\u5236\u8BBE\u8BA1\u662F\u6838\u5FC3\u3002" + "\u5C3E\u6BB5\u8865\u5145".repeat(60);
  const snip = extractEvidenceSnippet(body, "\u56E0\u4E3A\u63D0\u5230\u4E86 \u6E38\u620F\u673A\u5236\u8BBE\u8BA1");
  test("R11", snip.includes("\u6E38\u620F\u673A\u5236\u8BBE\u8BA1"), "\u8BC1\u636E\u7247\u6BB5\u4F18\u5148\u5B9A\u4F4D reason \u5173\u952E\u8BCD\u9644\u8FD1\u539F\u6587\uFF1A" + snip.slice(0, 60));
}
{
  const srcs = [vault("\u5B58\u5728.md"), vault("\u5DF2\u5220\u9664.md"), { type: "web", url: "https://x.com" }, { type: "inference", snippet: "\u63A8\u7406" }];
  const kept = existingVaultSources(srcs, (p) => p === "\u5B58\u5728.md");
  test("R12", kept.length === 3 && kept.some((s) => s.path === "\u5B58\u5728.md") && !kept.some((s) => s.path === "\u5DF2\u5220\u9664.md"), "\u5DF2\u5220\u9664 vault \u6765\u6E90\u88AB\u8FC7\u6EE4\uFF0Cweb/inference \u4FDD\u7559\uFF08count=" + kept.length + "\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
