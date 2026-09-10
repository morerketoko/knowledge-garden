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
var VaultRoot = class {
  constructor(vault, basePath) {
    this.vault = vault;
    this.basePath = basePath;
    this.kind = "vault";
    this.persistent = true;
    this.fileCache = /* @__PURE__ */ new Map();
    /** 上层可注入需要预热的相对路径（启动时已知的固定文件） */
    this.warmup = [];
  }
  get location() {
    return this.basePath + "/";
  }
  /**
   * 合并 basePath 后交给 Obsidian（Obsidian 只接受 vault 相对路径）。
   *
   * **幂等**：如果传入路径已经是「带 basePath 前缀的完整 vault 路径」，直接返回，
   * 绝不再加一次前缀。历史上这里是无条件拼接，导致
   * `.state/Knowledge Garden/.state/cache/...` 这种重复嵌套目录 —— 存储写到了
   * 嵌套位置，而读取走的是 `.state/cache/...`，于是所有状态都「看起来消失了」。
   */
  full(path2) {
    return this.vaultPathFor(path2);
  }
  /**
   * 统一的「相对路径 → 完整 vault 路径」映射（幂等）。
   *
   * 所有内部调用（mkdirp / write / rename / list）都必须用它，
   * 否则逐段拼接出来的前缀会被二次加前缀 —— 这正是
   * `.state-recovery/…` 被写到 `Knowledge Garden/.state/.state-recovery/…` 的原因。
   */
  vaultPathFor(path2) {
    const p = normalizeVaultPath(path2);
    if (!p) return "";
    if (!this.basePath) return p;
    if (p === this.basePath || p.startsWith(this.basePath + "/")) return p;
    return this.basePath + "/" + p;
  }
  abstractFile(path2) {
    const f = this.full(path2);
    if (!f) return null;
    try {
      return this.vault.getAbstractFileByPath(f);
    } catch {
      return null;
    }
  }
  async exists(path2) {
    return this.abstractFile(path2) !== null;
  }
  async isFile(path2) {
    const f = this.abstractFile(path2);
    return !!f && f.children === void 0;
  }
  async isDirectory(path2) {
    const f = this.abstractFile(path2);
    return !!f && Array.isArray(f.children);
  }
  /**
   * 读取文件内容。
   *
   * 刻意**不经过 `full()`**：raw / 业务两种写法都要能读。
   * - 传入「完整 vault 路径」（如 `.state/cache/cards.json` 或 `Knowledge Garden/.state/cache/…`）→ 直接按该路径读；
   * - 传入「相对 basePath 的路径」（如 `cache/cards.json`）→ 补上 basePath 再读。
   * 两条都失败时再退回 `getAbstractFileByPath`（覆盖 Obsidian 内部路径归一化的差异）。
   */
  async read(path2) {
    const p = normalizeVaultPath(path2);
    if (!p) return null;
    const cached = this.fileCache.get(p);
    if (cached !== void 0) return cached;
    const attempts = p.startsWith(this.basePath + "/") || p === this.basePath ? [p] : [this.basePath ? this.basePath + "/" + p : p, p];
    for (const abs of attempts) {
      const f = this.abstractFileByExactPath(abs);
      if (!f) continue;
      try {
        const text = this.vault.cachedRead ? await this.vault.cachedRead(f) : await this.vault.read(f);
        this.fileCache.set(p, text);
        return text;
      } catch {
      }
    }
    return null;
  }
  /** 精确路径查找（不走 full()，避免任何再次拼接） */
  abstractFileByExactPath(abs) {
    try {
      const hit = this.vault.getAbstractFileByPath(abs);
      if (hit) return hit;
    } catch {
    }
    const all = this.vault.getFiles ? this.vault.getFiles() : [];
    return all.find((f) => f.path === abs) ?? null;
  }
  async write(path2, data) {
    const p = normalizeVaultPath(path2);
    const dir = dirnameVaultPath(p);
    if (dir) await this.mkdirp(dir);
    const existing = this.abstractFile(p);
    if (existing && existing.children !== void 0) {
      throw new Error("vault root: \u76EE\u6807\u662F\u76EE\u5F55\uFF0C\u65E0\u6CD5\u5199\u5165\uFF1A" + p);
    }
    if (existing) {
      await this.vault.modify(existing, data);
    } else {
      try {
        await this.vault.create(this.full(p), data);
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (/exist/i.test(msg)) {
          const f = this.abstractFile(p);
          if (f) await this.vault.modify(f, data);
          else throw e;
        } else {
          if (dir) {
            try {
              await this.vault.createFolder(this.full(dir));
            } catch {
            }
          }
          const again = this.abstractFile(p);
          if (again) await this.vault.modify(again, data);
          else await this.vault.create(this.full(p), data);
        }
      }
    }
    this.fileCache.set(p, data);
  }
  async remove(path2) {
    const p = normalizeVaultPath(path2);
    const f = this.abstractFile(p);
    this.fileCache.delete(p);
    if (!f) {
      const children = await this.list(p);
      if (!children.length) return false;
      for (const c of children) await this.remove(c.path);
      return true;
    }
    try {
      await this.vault.delete(f, true);
      return true;
    } catch {
      try {
        await this.vault.trash(f, false);
        return true;
      } catch {
        return false;
      }
    }
  }
  async rename(from, to) {
    const f = this.abstractFile(from);
    if (!f) return false;
    const t = normalizeVaultPath(to);
    const dir = dirnameVaultPath(t);
    if (dir) await this.mkdirp(dir);
    try {
      await this.vault.rename(f, this.full(t));
      const c = this.fileCache.get(normalizeVaultPath(from));
      this.fileCache.delete(normalizeVaultPath(from));
      if (c !== void 0) this.fileCache.set(t, c);
      return true;
    } catch {
      return false;
    }
  }
  async mkdirp(path2) {
    const p = normalizeVaultPath(path2);
    if (!p) return;
    const segments = p.split("/");
    let acc = "";
    for (const seg of segments) {
      acc = acc ? acc + "/" + seg : seg;
      if (this.abstractFile(acc)) continue;
      try {
        await this.vault.createFolder(this.vaultPathFor(acc));
      } catch {
      }
    }
  }
  async list(path2) {
    const p = normalizeVaultPath(path2);
    const prefix = this.full(p);
    const prefixSlash = prefix ? prefix + "/" : "";
    const out = [];
    const all = this.vault.getFiles ? this.vault.getFiles() : [];
    for (const f of all) {
      if (prefixSlash && !f.path.startsWith(prefixSlash)) continue;
      const rest = f.path.slice(prefixSlash.length);
      if (!rest || rest.includes("/")) continue;
      out.push({ path: rest, name: rest, size: f.stat?.size ?? 0, mtime: f.stat?.mtime ?? 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * 同步列出 vault 内全部文件（相对 vault 根）。
   * 供布局修复使用：Obsidian 只有 getFiles()（文件列表，不含目录），
   * 因此修复必须文件驱动，而不是逐层 list 目录。
   */
  listAllFilesSync() {
    const all = this.vault.getFiles ? this.vault.getFiles() : [];
    return all.map((f) => f.path);
  }
  async prefetch() {
    for (const rel of this.warmup) {
      void this.read(rel);
    }
  }
  /** 释放读缓存（写后由自身维护，测试/降级时可手动清空） */
  clearCache() {
    this.fileCache.clear();
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

// tests/p25-recovery-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

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

// tests/p25-recovery-tests.ts
var ROOT = path.join(__dirname, "..");
var VAULT_CARDS = path.join("E:", "ob", "Knowledge Garden", "Review Cards");
var VAULT_EXAMS = path.join("E:", "ob", "Knowledge Garden", "Exams");
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function skip(id, detail) {
  console.log("SKIP " + id + " :: " + detail);
}
function mkFakeVault(base) {
  const disk = (p) => path.join(base, p.replace(/\//g, path.sep));
  const listFiles = () => {
    const out = [];
    const walk = (dir, prefix) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? prefix + "/" + e.name : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel);
        else out.push(rel);
      }
    };
    walk(base, "");
    return out;
  };
  return {
    getAbstractFileByPath(p) {
      const exists = fs.existsSync(disk(p));
      if (exists && fs.statSync(disk(p)).isFile()) return { path: p };
      const hasChild = listFiles().some((f) => f.startsWith(p + "/"));
      return exists || hasChild ? { path: p, children: [] } : null;
    },
    async read(f) {
      return fs.readFileSync(disk(f.path), "utf8");
    },
    async cachedRead(f) {
      return fs.readFileSync(disk(f.path), "utf8");
    },
    async create(p, data) {
      fs.mkdirSync(path.dirname(disk(p)), { recursive: true });
      fs.writeFileSync(disk(p), data, "utf8");
      return { path: p };
    },
    async createFolder(p) {
      fs.mkdirSync(disk(p), { recursive: true });
      return { path: p };
    },
    async modify(f, data) {
      fs.mkdirSync(path.dirname(disk(f.path)), { recursive: true });
      fs.writeFileSync(disk(f.path), data, "utf8");
    },
    async delete(f) {
      try {
        fs.unlinkSync(disk(f.path));
      } catch {
      }
    },
    async trash(f) {
      try {
        fs.unlinkSync(disk(f.path));
      } catch {
      }
    },
    async rename(f, to) {
      fs.mkdirSync(path.dirname(disk(to)), { recursive: true });
      fs.renameSync(disk(f.path), disk(to));
    },
    getFiles() {
      return listFiles().map((p) => ({ path: p }));
    },
    getMarkdownFiles() {
      return [];
    }
  };
}
(async () => {
  const STATE_ROOT = "Knowledge Garden/.state";
  const BASE_DIR = ".obsidian/plugins/knowledge-garden";
  {
    const dir = mkdtemp("kg-p25-path-");
    const abs = path.join(ROOT, dir);
    fs.mkdirSync(abs, { recursive: true });
    const root = new VaultRoot(mkFakeVault(abs), STATE_ROOT);
    await root.write(STATE_ROOT + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: [{ id: "keep" }] }));
    const correct = path.join(abs, STATE_ROOT, "cache", "cards.json");
    const nested = path.join(abs, STATE_ROOT, "Knowledge Garden", ".state", "cache", "cards.json");
    test(
      "P25-01",
      fs.existsSync(correct) && !fs.existsSync(nested),
      "VaultRoot \u5199\u5165\u5B8C\u6574 vault \u8DEF\u5F84\u5E42\u7B49\uFF1A\u4E0D\u4EA7\u751F <stateRoot>/<stateRoot> \u5D4C\u5957\uFF08\u4E8B\u6545\u56DE\u5F52\uFF09"
    );
    test(
      "P25-02",
      fs.existsSync(correct) && JSON.parse(fs.readFileSync(correct, "utf8")).entries[0].id === "keep",
      "\u5199\u5165\u5185\u5BB9\u5B8C\u6574\uFF08\u672A\u88AB\u7A7A\u7D22\u5F15\u8986\u76D6\uFF09"
    );
    const host3 = new PortableStorageHost({
      stateRoot: STATE_ROOT,
      pluginData: new MemoryRoot(),
      vault: new VaultRoot(mkFakeVault(abs), STATE_ROOT),
      useVault: true,
      reason: "test",
      stripPrefixes: [STATE_ROOT]
    });
    host3.baseDir = BASE_DIR;
    await host3.write(BASE_DIR + "/cache/schedule.json", '{"records":[]}', { nativeAtomic: true });
    test(
      "P25-03",
      fs.existsSync(path.join(abs, STATE_ROOT, "cache", "schedule.json")),
      "store \u98CE\u683C\u8DEF\u5F84\uFF08baseDir+cache\uFF09\u4E0E\u76F4\u63A5 vault \u8DEF\u5F84\u843D\u5728\u540C\u4E00\u76EE\u5F55"
    );
    fs.rmSync(abs, { recursive: true, force: true });
  }
  {
    const dir = mkdtemp("kg-p25-repair-");
    const abs = path.join(ROOT, dir);
    const nestedState = path.join(abs, STATE_ROOT, BASE_DIR, "Knowledge Garden", ".state");
    fs.mkdirSync(path.join(nestedState, "cache"), { recursive: true });
    fs.writeFileSync(path.join(nestedState, "cache", "cards.json"), JSON.stringify({ formatVersion: 1, entries: [{ id: "recover-me" }] }), "utf8");
    fs.mkdirSync(path.join(nestedState, "Knowledge Garden", "Prompts", "General"), { recursive: true });
    fs.writeFileSync(path.join(nestedState, "Knowledge Garden", "Prompts", "General", "p.md"), "# P", "utf8");
    const host3 = new PortableStorageHost({
      stateRoot: STATE_ROOT,
      pluginData: new MemoryRoot(),
      vault: new VaultRoot(mkFakeVault(abs), STATE_ROOT),
      useVault: true,
      reason: "test",
      stripPrefixes: [STATE_ROOT]
    });
    host3.baseDir = BASE_DIR;
    const moved = await host3.repairDuplicatedLayout();
    const recovered = path.join(abs, STATE_ROOT, "cache", "cards.json");
    const promptAt = path.join(abs, STATE_ROOT, "prompts", "General", "p.md");
    test(
      "P25-04",
      moved >= 1 && fs.existsSync(recovered) && JSON.parse(fs.readFileSync(recovered, "utf8")).entries[0].id === "recover-me",
      "\u5D4C\u5957\u5C42\u91CC\u7684\u72B6\u6001\u6587\u4EF6\u88AB\u642C\u56DE\u6B63\u786E\u4F4D\u7F6E\u4E14\u5185\u5BB9\u4E0D\u53D8\uFF08moved=" + moved + "\uFF09"
    );
    test(
      "P25-05",
      fs.existsSync(promptAt) && fs.readFileSync(promptAt, "utf8") === "# P",
      "\u5D4C\u5957\u5C42\u91CC\u7684 Markdown \u8D44\u4EA7\u4E5F\u642C\u56DE .state/prompts/\uFF08\u5185\u5BB9\u4E0D\u53D8\uFF09"
    );
    fs.rmSync(abs, { recursive: true, force: true });
  }
  {
    const dir = mkdtemp("kg-p25-guard-");
    const store = new ReviewCardStore(dir);
    store.load();
    const emptyBefore = store.count() === 0;
    const hasVaultAssets = fs.existsSync(VAULT_CARDS) && fs.readdirSync(VAULT_CARDS).some((f) => f.endsWith(".md"));
    test("P25-06", emptyBefore, "\u7A7A cards.json \u52A0\u8F7D\u540E\u7D22\u5F15\u4E3A 0\uFF08\u5B88\u536B\u6761\u4EF6\u6210\u7ACB\uFF0C\u4F1A\u89E6\u53D1\u81EA\u52A8\u91CD\u5EFA\uFF09");
    if (!hasVaultAssets) {
      skip("P25-07", "\u672A\u627E\u5230\u771F\u5B9E Vault \u7684 Review Cards/Exams\uFF0C\u8DF3\u8FC7\u771F\u5B9E\u8D44\u4EA7\u89E3\u6790\u9A8C\u8BC1\uFF08\u6D4B\u8BD5\u53EF\u5728\u5176\u4ED6\u673A\u5668\u8FD0\u884C\uFF09");
    } else {
      const cardFiles = fs.readdirSync(VAULT_CARDS).filter((f) => f.endsWith(".md"));
      let okCards = 0;
      const failed = [];
      for (const f of cardFiles) {
        try {
          if (parseCardMarkdown(fs.readFileSync(path.join(VAULT_CARDS, f), "utf8")).card) okCards++;
          else failed.push(f);
        } catch {
          failed.push(f);
        }
      }
      test(
        "P25-07a",
        okCards === cardFiles.length && cardFiles.length > 0,
        "Review Cards/*.md \u5168\u90E8\u53EF\u89E3\u6790\u4E3A\u590D\u4E60\u5361\uFF08" + okCards + "/" + cardFiles.length + "\uFF0C\u5931\u8D25 " + failed.length + "\uFF09"
      );
      const examFiles = fs.existsSync(VAULT_EXAMS) ? fs.readdirSync(VAULT_EXAMS).filter((f) => f.endsWith(".md")) : [];
      let okExams = 0;
      for (const f of examFiles) {
        try {
          if (parseExamMarkdown(fs.readFileSync(path.join(VAULT_EXAMS, f), "utf8")).exam) okExams++;
        } catch {
        }
      }
      test(
        "P25-07b",
        examFiles.length === 0 || okExams === examFiles.length,
        "Exams/*.md \u5168\u90E8\u53EF\u89E3\u6790\u4E3A\u8003\u8BD5\uFF08" + okExams + "/" + examFiles.length + "\uFF09"
      );
    }
  }
  console.log("\n==== SUMMARY ====");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
})();
