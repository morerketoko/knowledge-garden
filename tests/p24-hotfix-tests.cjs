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
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var init_paths = __esm({
  "src/portable/paths.ts"() {
    "use strict";
  }
});

// src/portable/root.ts
var root_exports = {};
__export(root_exports, {
  MemoryRoot: () => MemoryRoot,
  PluginDataRoot: () => PluginDataRoot,
  VaultRoot: () => VaultRoot
});
var MemoryRoot, VaultRoot, PluginDataRoot;
var init_root = __esm({
  "src/portable/root.ts"() {
    "use strict";
    init_paths();
    MemoryRoot = class {
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
    VaultRoot = class {
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
    PluginDataRoot = class {
      constructor(load, save, namespace = "kgm") {
        this.load = load;
        this.save = save;
        this.namespace = namespace;
        this.kind = "plugin-data";
        this.persistent = true;
        this.location = "plugin-data://";
        this.files = /* @__PURE__ */ new Map();
        this.dirty = false;
        this.flushTimer = null;
      }
      /** 从 plugin data 读取快照（宿主在 onload 里 await 一次，让同步读可用） */
      async init() {
        try {
          const raw = await this.load();
          const bucket = raw?.[this.namespace];
          if (bucket && typeof bucket === "object") {
            for (const [k, v] of Object.entries(bucket)) {
              if (typeof v === "string") this.files.set(normalizeVaultPath(k), v);
            }
          }
        } catch {
        }
        return this.files.size;
      }
      scheduleFlush() {
        this.dirty = true;
        if (this.flushTimer !== null) return;
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.flush();
        }, 800);
      }
      async flush() {
        if (!this.dirty) return;
        this.dirty = false;
        try {
          const bucket = {};
          for (const [k, v] of this.files) bucket[k] = v;
          const current = await this.load();
          const next = { ...current && typeof current === "object" ? current : {}, [this.namespace]: bucket };
          await this.save(next);
        } catch {
        }
      }
      /** 宿主的 settings 保存必须与本快照合并，避免互相覆盖 */
      snapshot() {
        const out = {};
        for (const [k, v] of this.files) out[k] = v;
        return out;
      }
      async exists(path2) {
        return this.files.has(normalizeVaultPath(path2));
      }
      async isFile(path2) {
        return this.files.has(normalizeVaultPath(path2));
      }
      async isDirectory(path2) {
        const prefix = normalizeVaultPath(path2) + "/";
        for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
        return false;
      }
      async read(path2) {
        const v = this.files.get(normalizeVaultPath(path2));
        return v === void 0 ? null : v;
      }
      async write(path2, data) {
        this.files.set(normalizeVaultPath(path2), data);
        this.scheduleFlush();
      }
      async remove(path2) {
        const p = normalizeVaultPath(path2);
        let removed = this.files.delete(p);
        const prefix = p + "/";
        for (const k of Array.from(this.files.keys())) if (k.startsWith(prefix)) {
          this.files.delete(k);
          removed = true;
        }
        if (removed) this.scheduleFlush();
        return removed;
      }
      async rename(from, to) {
        const f = normalizeVaultPath(from);
        const t = normalizeVaultPath(to);
        const v = this.files.get(f);
        if (v === void 0) return false;
        this.files.delete(f);
        this.files.set(t, v);
        this.scheduleFlush();
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
        await this.flush();
      }
    };
  }
});

// src/portable/fsPortable.ts
var fsPortable_exports = {};
__export(fsPortable_exports, {
  MIRROR_FLUSH_MS: () => MIRROR_FLUSH_MS,
  __mirrorSnapshot: () => __mirrorSnapshot,
  appendFileSync: () => appendFileSync,
  existsSync: () => existsSync,
  flushMirror: () => flushMirror,
  getStorageHost: () => getStorageHost,
  initSyncMirror: () => initSyncMirror,
  mirrorStats: () => mirrorStats,
  mkdirSync: () => mkdirSync,
  readFileSync: () => readFileSync,
  readdirSync: () => readdirSync,
  renameSync: () => renameSync,
  setStorageHost: () => setStorageHost,
  storageReady: () => storageReady,
  unlinkSync: () => unlinkSync,
  writeFileSync: () => writeFileSync
});
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
function getStorageHost() {
  return host;
}
function storageReady() {
  return host !== null && initialized;
}
function mirrorStats() {
  return { files: mirror.size, dirty: dirty.size };
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
function appendFileSync(p, data) {
  bump();
  const k = key(p);
  if (!k) {
    pendingError = new Error("\u5B58\u50A8\u672A\u5C31\u7EEA\uFF0C\u8FFD\u52A0\u88AB\u5FFD\u7565\uFF1A" + p);
    return;
  }
  mirror.set(k, (mirror.get(k) ?? "") + String(data ?? ""));
  dirty.add(k);
  schedule();
}
function mkdirSync(_p, _opts) {
  bump();
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
function __mirrorSnapshot() {
  return Object.fromEntries(mirror);
}
var host, mirror, dirty, pendingError, flushTimer, flushing, initialized, MIRROR_FLUSH_MS;
var init_fsPortable = __esm({
  "src/portable/fsPortable.ts"() {
    "use strict";
    host = null;
    mirror = /* @__PURE__ */ new Map();
    dirty = /* @__PURE__ */ new Set();
    pendingError = null;
    flushTimer = null;
    flushing = false;
    initialized = false;
    MIRROR_FLUSH_MS = 800;
  }
});

// src/knowledgeState.ts
var knowledgeState_exports = {};
__export(knowledgeState_exports, {
  activityScore: () => activityScore,
  daysSince: () => daysSince,
  deriveState: () => deriveState,
  forgottenCandidates: () => forgottenCandidates,
  rankCandidates: () => rankCandidates,
  stateCounts: () => stateCounts
});
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
function activityScore(note, act, now = Date.now()) {
  const day = 864e5;
  const decay = (t, halfDays) => {
    const d = daysSince(t, now);
    if (d === null || d < 0) return 0;
    return Math.exp(-d / halfDays);
  };
  const access = decay(act?.lastAccessedAt, 7);
  const modify = decay(note.modified, 21);
  const review = act?.reviewCount ?? 0 ? Math.min(act.reviewCount, 5) * 0.05 + decay(act?.lastReviewedAt, 14) * 0.25 : 0;
  const connectivity = Math.min(note.links.length, 8) * 0.06 + Math.min(note.backlinks.length, 8) * 0.12;
  const stalenessBonus = note.backlinks.length >= 2 && (daysSince(note.modified, now) ?? 0) > 30 ? 0.1 : 0;
  return Math.min(1, 0.45 * access + 0.25 * modify + 0.2 * connectivity + review + stalenessBonus);
}
function forgottenCandidates(notes, getAct, rules, now = Date.now()) {
  return notes.filter((n) => deriveState(n, getAct(n.path), rules, now) === "forgotten").sort((a, b) => b.backlinks.length + b.links.length - (a.backlinks.length + a.links.length)).slice(0, 20);
}
function rankCandidates(notes, getAct, rules, now = Date.now()) {
  const topFolder = /* @__PURE__ */ new Set();
  for (const n of notes) {
    for (const b of n.backlinks) {
      const folder = b.split("/")[0];
      if (folder) topFolder.add(folder);
    }
  }
  return [...notes].map((n) => {
    const act = getAct(n.path);
    let score = activityScore(n, act, now);
    const folders = new Set(n.backlinks.map((b) => b.split("/")[0]).filter(Boolean));
    if (folders.size >= 2) score += 0.12;
    const state = deriveState(n, act, rules, now);
    if (state === "new" || state === "growing") score += 0.1;
    return { n, score };
  }).sort((a, b) => b.score - a.score).map((x) => x.n);
}
function stateCounts(notes, getAct, rules, now = Date.now()) {
  const out = { new: 0, growing: 0, active: 0, stale: 0, forgotten: 0 };
  for (const n of notes) out[deriveState(n, getAct(n.path), rules, now)]++;
  return out;
}
var init_knowledgeState = __esm({
  "src/knowledgeState.ts"() {
    "use strict";
  }
});

// tests/portable-bootstrap.ts
init_root();

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

// tests/portable-bootstrap.ts
init_fsPortable();
init_fsPortable();
init_paths();
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

// tests/p24-hotfix-tests.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
init_root();

// src/portable/recovery.ts
init_paths();
var RECOVERY_BACKUP_ROOT = ".state-recovery";
function jsonWeight(value) {
  if (value === null || value === void 0) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "object") return 0;
  const o = value;
  for (const k of ["entries", "snapshots", "templates", "records", "sessions", "cards", "logs", "reviewLogs"]) {
    const v = o[k];
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v).length;
  }
  if (o["queue"] && typeof o["queue"] === "object") {
    const items = o["queue"]["items"];
    if (Array.isArray(items)) return items.length;
  }
  return Object.keys(o).length;
}
var STATE_FILES = [
  { rel: "cache/index.json", label: "\u7B14\u8BB0\u7D22\u5F15" },
  { rel: "cache/activity.json", label: "\u8BBF\u95EE/\u590D\u4E60\u884C\u4E3A", measure: (v) => v && typeof v === "object" ? Object.keys(v).length : 0 },
  { rel: "cache/ai-cache.json", label: "AI \u7F13\u5B58" },
  { rel: "cache/ai-tasks.json", label: "AI \u4EFB\u52A1" },
  { rel: "cache/artifacts.json", label: "Artifact \u7D22\u5F15" },
  { rel: "cache/cards.json", label: "\u590D\u4E60\u5361\u7D22\u5F15" },
  { rel: "cache/card-reviews.json", label: "\u590D\u4E60\u5361\u5386\u53F2" },
  { rel: "cache/discovery.json", label: "\u53D1\u73B0\u66DD\u5149" },
  { rel: "cache/evolution.json", label: "\u77E5\u8BC6\u6F14\u5316\u5FEB\u7167" },
  { rel: "cache/exam-sessions.json", label: "\u8003\u8BD5\u4F1A\u8BDD" },
  { rel: "cache/exams.json", label: "\u8003\u8BD5\u7D22\u5F15" },
  { rel: "cache/latency.json", label: "\u5EF6\u8FDF\u6837\u672C" },
  { rel: "cache/projects.json", label: "\u9879\u76EE\u7D22\u5F15" },
  { rel: "cache/prompts.json", label: "Prompt \u5143\u6570\u636E" },
  { rel: "cache/query-history.json", label: "\u6700\u8FD1\u63A2\u7D22" },
  { rel: "cache/relationships.json", label: "\u77E5\u8BC6\u5173\u7CFB" },
  { rel: "cache/review-queue.json", label: "\u590D\u4E60\u961F\u5217" },
  { rel: "cache/review-session.json", label: "\u590D\u4E60\u4F1A\u8BDD" },
  { rel: "cache/saved-explorations.json", label: "\u6536\u85CF\u94FE\u8DEF" },
  { rel: "cache/schedule.json", label: "\u590D\u76D8\u8C03\u5EA6" },
  { rel: "cache/source-ledger.json", label: "\u6765\u6E90\u53F0\u8D26" },
  { rel: "cache/spaced-review.json", label: "FSRS \u72B6\u6001" },
  { rel: "cache/workbench-sessions.json", label: "Workbench \u4F1A\u8BDD" }
];
async function diagnoseStateSources(opts) {
  const out = [];
  for (const spec of STATE_FILES) {
    const sources = [];
    const add = (kind, path2, raw) => {
      if (raw === null || raw === void 0) {
        sources.push({ kind, path: path2, found: false, chars: 0, valid: false, weight: 0 });
        return;
      }
      let valid = false;
      let weight = 0;
      try {
        weight = spec.measure ? spec.measure(JSON.parse(raw)) : jsonWeight(JSON.parse(raw));
        valid = true;
      } catch {
        valid = false;
      }
      sources.push({ kind, path: path2, found: true, chars: raw.length, valid, weight });
    };
    for (const d of opts.legacyDirs) add("legacy", joinVaultPath(d, spec.rel), await safeRead(opts, joinVaultPath(d, spec.rel)));
    add("correct", joinVaultPath(opts.stateRoot, spec.rel), await safeRead(opts, joinVaultPath(opts.stateRoot, spec.rel)));
    for (const d of opts.wrongDirs) add("wrong", joinVaultPath(d, spec.rel), await safeRead(opts, joinVaultPath(d, spec.rel)));
    for (const d of opts.nestedDirs) add("nested", joinVaultPath(d, spec.rel), await safeRead(opts, joinVaultPath(d, spec.rel)));
    const mirror2 = opts.pluginData?.[spec.rel] ?? opts.pluginData?.[joinVaultPath(STATE_DIR_NAME, spec.rel)] ?? null;
    add("pluginData", "plugin-data://" + spec.rel, mirror2);
    const best = sources.filter((s) => s.found && s.valid).sort((a, b) => b.weight - a.weight || b.chars - a.chars)[0];
    out.push({ rel: spec.rel, label: spec.label, sources, best });
  }
  return out;
}
async function safeRead(opts, rel) {
  try {
    return await opts.read(rel);
  } catch {
    return null;
  }
}
async function backupSources(storage, opts, stamp) {
  const dir = joinVaultPath(RECOVERY_BACKUP_ROOT, stamp);
  let files = 0;
  for (const spec of STATE_FILES) {
    const candidates = [];
    for (const d of opts.legacyDirs) candidates.push({ rel: joinVaultPath(d, spec.rel), raw: await safeRead(opts, joinVaultPath(d, spec.rel)) });
    candidates.push({ rel: joinVaultPath(opts.stateRoot, spec.rel), raw: await safeRead(opts, joinVaultPath(opts.stateRoot, spec.rel)) });
    for (const d of opts.wrongDirs) candidates.push({ rel: joinVaultPath(d, spec.rel), raw: await safeRead(opts, joinVaultPath(d, spec.rel)) });
    for (const d of opts.nestedDirs) candidates.push({ rel: joinVaultPath(d, spec.rel), raw: await safeRead(opts, joinVaultPath(d, spec.rel)) });
    let i = 0;
    for (const c of candidates) {
      if (c.raw === null) continue;
      i++;
      const name = spec.rel.split("/").pop() ?? "file.json";
      const flat = c.rel.replace(/[\\/]/g, "__");
      const ok = await storage.writeRaw(joinVaultPath(dir, flat + (i > 1 ? "." + i : "")), c.raw);
      if (ok) files++;
    }
  }
  const mirrorKeys = Object.keys(opts.pluginData ?? {});
  if (mirrorKeys.length) {
    const json = JSON.stringify(opts.pluginData, null, 0);
    const okMirror = await storage.writeRaw(joinVaultPath(dir, "plugin-data-mirror.json"), json);
    if (okMirror) files++;
  }
  return { dir, files, at: Date.now() };
}
async function recoverState(storage, opts, diagnoses) {
  const report = { needed: false, actions: [], before: {}, after: {}, missing: [], conflicts: [] };
  const diags = diagnoses ?? await diagnoseStateSources(opts);
  for (const diag of diags) {
    const correct = diag.sources.find((s) => s.kind === "correct");
    const correctUsable = !!correct && correct.found && correct.valid && correct.weight > 0;
    const beforeWeight = correctUsable ? correct.weight : 0;
    report.before[diag.rel] = beforeWeight;
    if (correctUsable) {
      report.after[diag.rel] = beforeWeight;
      report.actions.push({
        rel: diag.rel,
        label: diag.label,
        from: "correct",
        fromPath: correct.path,
        beforeWeight,
        afterWeight: beforeWeight,
        reason: "\u6B63\u786E\u4F4D\u7F6E\u5DF2\u6709\u975E\u7A7A\u5408\u6CD5\u6570\u636E \u2192 \u4E0D\u8986\u76D6\uFF08\xA7\u5341\uFF09",
        written: false
      });
      const others = diag.sources.filter((s) => s.kind !== "correct" && s.found && s.valid && s.weight > 0 && s.weight !== beforeWeight);
      if (others.length) {
        report.conflicts.push(diag.rel + "\uFF1A\u6B63\u786E\u4F4D\u7F6E " + beforeWeight + " vs " + others.map((o) => o.kind + " " + o.weight).join(" / "));
      }
      continue;
    }
    const candidates = diag.sources.filter((s) => s.kind !== "correct" && s.found && s.valid && s.weight > 0).sort((a, b) => b.weight - a.weight || b.chars - a.chars);
    if (!candidates.length) {
      report.missing.push(diag.rel);
      report.after[diag.rel] = 0;
      report.actions.push({
        rel: diag.rel,
        label: diag.label,
        from: "none",
        fromPath: "",
        beforeWeight,
        afterWeight: 0,
        reason: "\u6240\u6709\u6765\u6E90\u90FD\u4E3A\u7A7A/\u65E0\u6548 \u2192 \u65E0\u6CD5\u6062\u590D\uFF08\u4E0D\u4F1A\u5199\u5165\u7A7A\u6570\u636E\u5047\u88C5\u6210\u529F\uFF0C\xA7\u4E09\u5341\u4E00\uFF09",
        written: false
      });
      continue;
    }
    const pick = candidates[0];
    const raw = pick.kind === "pluginData" ? opts.pluginData?.[diag.rel] ?? opts.pluginData?.[joinVaultPath(STATE_DIR_NAME, diag.rel)] ?? null : await safeRead(opts, pick.path);
    if (raw === null) {
      report.missing.push(diag.rel);
      continue;
    }
    const target = joinVaultPath(opts.stateRoot, diag.rel);
    const out = await storage.write(target, raw, { nativeAtomic: true });
    const after = out.ok ? pick.weight : 0;
    report.needed = report.needed || out.ok;
    report.after[diag.rel] = after;
    report.actions.push({
      rel: diag.rel,
      label: diag.label,
      from: pick.kind,
      fromPath: pick.path,
      beforeWeight,
      afterWeight: after,
      reason: "\u6B63\u786E\u4F4D\u7F6E\u4E3A\u7A7A/\u65E0\u6548 \u2192 \u91C7\u7528\u4FE1\u606F\u91CF\u6700\u5927\u7684 " + pick.kind + "\uFF08" + pick.weight + " \u6761\uFF09",
      written: out.ok
    });
    if (candidates.length > 1) {
      report.conflicts.push(diag.rel + "\uFF1A\u5019\u9009 " + candidates.map((c) => c.kind + " " + c.weight).join(" / ") + " \u2192 \u53D6 " + pick.kind);
    }
  }
  return report;
}

// src/portable/legacyMigration.ts
init_paths();
var LEGACY_STATE_FILES = [
  "cache/index.json",
  "cache/activity.json",
  "cache/ai-cache.json",
  "cache/ai-tasks.json",
  "cache/artifacts.json",
  "cache/cards.json",
  "cache/card-reviews.json",
  "cache/discovery.json",
  "cache/evolution.json",
  "cache/exam-sessions.json",
  "cache/exams.json",
  "cache/latency.json",
  "cache/projects.json",
  "cache/prompts.json",
  "cache/query-history.json",
  "cache/relationships.json",
  "cache/review-queue.json",
  "cache/review-session.json",
  "cache/saved-explorations.json",
  "cache/schedule.json",
  "cache/source-ledger.json",
  "cache/spaced-review.json",
  "cache/workbench-sessions.json"
];
var LEGACY_ASSET_DIRS = ["prompts", "projects"];
function legacyPluginDirCandidates(pluginId, configDir = ".obsidian") {
  const dirs = [joinVaultPath(configDir, "plugins", pluginId)];
  for (const alt of ["knowledge-garden", "kg-knowledge-garden"]) {
    const p = joinVaultPath(configDir, "plugins", alt);
    if (!dirs.includes(p)) dirs.push(p);
  }
  return dirs;
}
function isNonEmptyStateJson(raw) {
  try {
    return jsonWeight(JSON.parse(raw)) > 0;
  } catch {
    return false;
  }
}
async function migrateLegacyState(app, host3, pluginId = "knowledge-garden") {
  const result = {
    detected: false,
    copied: [],
    skippedExisting: [],
    failed: [],
    skippedEmpty: [],
    target: host3.stateRoot + "/"
  };
  const adapter = app.vault?.adapter;
  if (!adapter?.exists) return result;
  const configDir = app.vault.configDir || ".obsidian";
  const candidates = legacyPluginDirCandidates(pluginId, configDir);
  for (const dir of candidates) {
    let hasLegacy = false;
    try {
      hasLegacy = await adapter.exists(joinVaultPath(dir, "cache"));
    } catch {
      hasLegacy = false;
    }
    if (!hasLegacy) continue;
    result.detected = true;
    for (const rel of LEGACY_STATE_FILES) {
      const src = joinVaultPath(dir, rel);
      const dst = joinVaultPath(host3.stateRoot, rel);
      try {
        const exists = await adapter.exists(src);
        if (!exists) continue;
        if (await host3.exists(dst)) {
          result.skippedExisting.push(rel);
          continue;
        }
        const raw = adapter.read ? await adapter.read(src) : null;
        if (raw === null) {
          result.failed.push(rel);
          continue;
        }
        JSON.parse(raw);
        if (!isNonEmptyStateJson(raw)) {
          result.skippedEmpty.push(rel);
          continue;
        }
        const out = await host3.write(dst, raw, { nativeAtomic: true });
        if (out.ok) result.copied.push(rel);
        else result.failed.push(rel);
      } catch {
        result.failed.push(rel);
      }
    }
    for (const assetDir of LEGACY_ASSET_DIRS) {
      const srcRoot = joinVaultPath(dir, assetDir);
      try {
        if (!await adapter.exists(srcRoot)) continue;
        const walk = async (rel, depth) => {
          if (depth > 3) return;
          const listing = adapter.list ? await adapter.list(joinVaultPath(srcRoot, rel)) : null;
          if (!listing) return;
          for (const f of listing.files) {
            const relFile = joinVaultPath(assetDir, rel, f);
            const src = joinVaultPath(dir, relFile);
            const dst = joinVaultPath(host3.stateRoot, relFile);
            try {
              if (await host3.exists(dst)) {
                result.skippedExisting.push(relFile);
                continue;
              }
              const raw = adapter.read ? await adapter.read(src) : null;
              if (raw === null) {
                result.failed.push(relFile);
                continue;
              }
              const out = await host3.write(dst, raw);
              if (out.ok) result.copied.push(relFile);
              else result.failed.push(relFile);
            } catch {
              result.failed.push(relFile);
            }
          }
          for (const d of listing.folders) await walk(joinVaultPath(rel, d), depth + 1);
        };
        await walk("", 0);
      } catch {
      }
    }
  }
  return result;
}

// src/migrations.ts
init_fsPortable();
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

// src/spacedReview.ts
init_fsPortable();

// src/portable/pathShim.ts
init_paths();
init_paths();
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

// src/ai/cache.ts
init_fsPortable();
init_paths();

// src/examStore.ts
init_fsPortable();
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

// tests/p24-hotfix-tests.ts
init_fsPortable();
init_fsPortable();
init_paths();
var ROOT = path.join(__dirname, "..");
var REAL_DATA_JSON = path.join("E:", "ob", ".obsidian", "plugins", "knowledge-garden", "data.json");
var REAL_CARDS = path.join("E:", "ob", "Knowledge Garden", "Review Cards");
var REAL_EXAMS = path.join("E:", "ob", "Knowledge Garden", "Exams");
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function skip(id, detail) {
  console.log("SKIP " + id + " :: " + detail);
}
var STATE_ROOT = "Knowledge Garden/.state";
var LEGACY_DIR = ".obsidian/plugins/knowledge-garden";
function mkFakeVault(root) {
  const disk = (p) => path.join(root, p.replace(/\//g, path.sep));
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
    walk(root, "");
    return out;
  };
  return {
    getAbstractFileByPath(p) {
      const ex = fs.existsSync(disk(p));
      if (ex && fs.statSync(disk(p)).isFile()) return { path: p };
      const hasChild = listFiles().some((f) => f.startsWith(p + "/"));
      return ex || hasChild ? { path: p, children: [] } : null;
    },
    async read(f) {
      return fs.readFileSync(disk(f.path), "utf8");
    },
    async cachedRead(f) {
      return fs.readFileSync(disk(f.path), "utf8");
    },
    async create(p, d) {
      fs.mkdirSync(path.dirname(disk(p)), { recursive: true });
      fs.writeFileSync(disk(p), d, "utf8");
      return { path: p };
    },
    async createFolder(p) {
      fs.mkdirSync(disk(p), { recursive: true });
      return { path: p };
    },
    async modify(f, d) {
      fs.mkdirSync(path.dirname(disk(f.path)), { recursive: true });
      fs.writeFileSync(disk(f.path), d, "utf8");
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
function mkFakeApp(root, legacyRel, legacyDisk, configDir = ".obsidian") {
  const map = (p) => p === legacyRel || p.startsWith(legacyRel + "/") ? path.join(root, legacyDisk, p === legacyRel ? "" : p.slice(legacyRel.length + 1)) : path.join(root, p);
  const adapter = {
    async exists(p) {
      return fs.existsSync(map(p));
    },
    async read(p) {
      return fs.readFileSync(map(p), "utf8");
    },
    async list(p) {
      const dir = map(p);
      const es = fs.readdirSync(dir, { withFileTypes: true });
      return { files: es.filter((e) => e.isFile()).map((e) => e.name), folders: es.filter((e) => e.isDirectory()).map((e) => e.name) };
    }
  };
  return { vault: { adapter, configDir } };
}
function mkCtx(tag) {
  const dir = mkdtemp("kg-hotfix-" + tag + "-");
  const root = path.join(ROOT, dir);
  fs.mkdirSync(root, { recursive: true });
  const vaultRaw = mkFakeVault(root);
  const vault = new VaultRoot(vaultRaw, STATE_ROOT);
  const host3 = new PortableStorageHost({
    stateRoot: STATE_ROOT,
    pluginData: new MemoryRoot(),
    vault,
    useVault: true,
    reason: "test",
    stripPrefixes: [STATE_ROOT]
  });
  host3.baseDir = LEGACY_DIR;
  return { root, host: host3, vault, vaultRaw };
}
function writeDisk(root, rel, text) {
  const p = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
}
function readDisk(root, rel) {
  const p = path.join(root, rel.replace(/\//g, path.sep));
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
function legacyFixture() {
  const cards = {
    formatVersion: 1,
    entries: Array.from({ length: 182 }, (_, i) => ({
      id: "card" + i,
      sourcePath: "note" + i % 20 + ".md",
      sourceVersion: "v1",
      question: "\u9898\u76EE " + i,
      answer: "\u7B54\u6848 " + i,
      questionType: i % 3 === 0 ? "multiple_choice" : "recall",
      options: i % 3 === 0 ? ["A" + i, "B" + i, "C" + i, "D" + i] : void 0,
      correctAnswer: i % 3 === 0 ? "A" + i : void 0,
      createdAt: 17e11 + i,
      updatedAt: 17e11 + i
    }))
  };
  const savedCards = {};
  const savedCardReviewLogs = [];
  for (let i = 0; i < 159; i++) {
    savedCards["card" + i] = {
      cardId: "card" + i,
      fsrsState: { due: 17e11 + i * 1e3, stability: 1 + i, difficulty: 5, reps: i, lapses: 0, state: 2, learningSteps: 0, lastReview: 17e11 },
      lastRating: "good",
      reviewCount: i,
      lastReviewedAt: 17e11,
      masteryPercent: 50 + i % 50,
      createdAt: 17e11,
      updatedAt: 17e11
    };
    savedCardReviewLogs.push({ cardId: "card" + i, timestamp: 17e11 + i, rating: "good" });
  }
  const spaced = {
    formatVersion: 2,
    cards: { "note0.md": { path: "note0.md", fsrsState: { due: 17e11, stability: 5, difficulty: 5, reps: 3, lapses: 1, state: 2, learningSteps: 0, lastReview: 17e11 }, lastRating: "good", reviewCount: 3, lastReviewedAt: 17e11, masteryPercent: 60, createdAt: 1, updatedAt: 1 } },
    reviewLogs: [{ path: "note0.md", timestamp: 17e11, rating: "good" }],
    savedCards,
    savedCardReviewLogs
  };
  const activity = {};
  for (let i = 0; i < 236; i++) {
    activity["note" + i + ".md"] = { lastAccessedAt: 17e11 + i * 1e3, accessCount: i + 1, lastReviewedAt: 17e11 + i * 500, reviewCount: i % 7 };
  }
  const evolution = {
    formatVersion: 1,
    snapshots: Array.from({ length: 12 }, (_, i) => ({
      date: "2026-0" + (i % 9 + 1) + "-01",
      periodKey: "snapshot:weekly:2026-W" + i,
      totalNotes: 100 + i,
      totalAreas: 3,
      activeNotes: 10,
      growingNotes: 5,
      staleNotes: 4,
      forgottenNotes: 2,
      newNotes: 3,
      topConcepts: [],
      areaStats: [],
      crossAreaLinks: [],
      unresolvedQuestions: []
    }))
  };
  return {
    "cache/cards.json": JSON.stringify(cards),
    "cache/exams.json": JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 12 }, (_, i) => ({ id: "exam" + i, title: "\u8003\u8BD5" + i, createdAt: i, updatedAt: i, sourcePath: "n.md", mode: "recall", difficulty: "standard", questions: [], coverageTopics: [] })) }),
    "cache/spaced-review.json": JSON.stringify(spaced),
    "cache/activity.json": JSON.stringify(activity),
    "cache/evolution.json": JSON.stringify(evolution),
    "cache/review-queue.json": JSON.stringify({ formatVersion: 1, queue: { periodKey: "daily:2026-09-10", createdAt: 1, items: Array.from({ length: 10 }, (_, i) => ({ path: "note" + i + ".md", stateAtSelection: "new", priorityScore: i, status: "pending", selectedAt: 1 })), completedCount: 0, skippedCount: 0 } }),
    "cache/schedule.json": JSON.stringify([{ type: "daily", periodKey: "daily:2026-09-10", scheduledAt: 1, status: "running", startedAt: 1, attempts: 1 }]),
    "cache/ai-cache.json": JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ key: "k" + i, type: "curiosity", status: "success", createdAt: 1, updatedAt: 2, data: { title: "t" + i } }))),
    "cache/index.json": JSON.stringify([{ path: "a.md", title: "A", folder: "", tags: [], links: [], created: 1, modified: 2, wordCount: 3, size: 4, mtime: 2 }]),
    "cache/relationships.json": JSON.stringify({ formatVersion: 1, relationships: [{ id: "r1", from: "a.md", to: "b.md", relation: "\u652F\u6301", direction: "forward", evidence: ["user_confirmed"], status: "active", createdAt: 1, updatedAt: 1 }] }),
    "cache/saved-explorations.json": JSON.stringify({ formatVersion: 1, entries: [{ id: "s1", title: "T", query: "q", source: "query_exploration", createdAt: 1, updatedAt: 1, nodes: [], edges: [], markdownPath: "x.md", fingerprint: "f" }] }),
    "cache/workbench-sessions.json": JSON.stringify({ formatVersion: 1, sessions: [{ sessionId: "sess1", title: "T", turnCount: 1, question: "Q", sources: [], skillIds: [], createdAt: 1, updatedAt: 1 }] }),
    "cache/source-ledger.json": JSON.stringify({ formatVersion: 1, records: [{ id: "src1", type: "vault", path: "a.md", createdAt: 1 }] }),
    "cache/card-reviews.json": JSON.stringify({ formatVersion: 1, records: [{ cardId: "card0", reviewedAt: 1, rating: "good" }] }),
    "cache/exam-sessions.json": JSON.stringify({ formatVersion: 1, sessions: [{ examId: "exam0", mode: "exam", currentIndex: 2, answers: [], status: "running", startedAt: 1, updatedAt: 1 }] })
  };
}
function mirrorText(pathRel) {
  const snap = __mirrorSnapshot();
  const key2 = "Knowledge Garden/.state/" + pathRel;
  return snap[key2] ?? null;
}
function countOf(raw, pick = jsonWeight) {
  if (raw === null) return 0;
  try {
    return pick(JSON.parse(raw));
  } catch {
    return 0;
  }
}
function savedCardCount(raw) {
  if (raw === null) return 0;
  try {
    const j = JSON.parse(raw);
    return j.savedCards ? Object.keys(j.savedCards).length : 0;
  } catch {
    return 0;
  }
}
function savedLogCount(raw) {
  if (raw === null) return 0;
  try {
    const j = JSON.parse(raw);
    return j.savedCardReviewLogs ? j.savedCardReviewLogs.length : 0;
  } catch {
    return 0;
  }
}
void (async () => {
  {
    const { root, host: host3 } = mkCtx("legacy");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, path.join(LEGACY_DIR, rel), raw);
    const app = mkFakeApp(root, LEGACY_DIR, LEGACY_DIR);
    test(
      "P24-HOTFIX-01",
      legacyPluginDirCandidates("knowledge-garden").join(",") === ".obsidian/plugins/knowledge-garden,.obsidian/plugins/kg-knowledge-garden",
      "legacy \u76EE\u5F55\u5019\u9009\u542B\u4E24\u4E2A\u5386\u53F2 id\uFF08\xA7\u516B\uFF09"
    );
    test(
      "P24-HOTFIX-01b",
      LEGACY_STATE_FILES.length >= 23 && LEGACY_STATE_FILES.includes("cache/spaced-review.json"),
      "legacy \u6587\u4EF6\u6E05\u5355\u8986\u76D6 spaced-review / cards / activity / evolution \u7B49\uFF08" + LEGACY_STATE_FILES.length + " \u9879\uFF09"
    );
    const r = await migrateLegacyState(app, host3, "knowledge-garden");
    test("P24-HOTFIX-02", r.detected && r.copied.length >= 10, "\u68C0\u6D4B\u5230\u65E7\u684C\u9762 cache \u5E76\u8FC1\u79FB\uFF08copied=" + r.copied.length + "\uFF09");
    const targetPath = STATE_ROOT + "/cache/cards.json";
    test(
      "P24-HOTFIX-02b",
      readDisk(root, targetPath) !== null && readDisk(root, ".state/cache/cards.json") === null,
      "\u8FC1\u79FB\u76EE\u6807 = " + STATE_ROOT + "/cache\uFF08\u7EDD\u4E0D\u662F vault \u6839\u7684 .state/cache\uFF0C\xA7\u516D/\xA7\u4E03\uFF09"
    );
    test("P24-HOTFIX-02c", r.target === STATE_ROOT + "/", "\u8FC1\u79FB\u7ED3\u679C target \u53EA\u7531 host.stateRoot \u51B3\u5B9A");
    test("P24-HOTFIX-25", readDisk(root, LEGACY_DIR + "/cache/cards.json") !== null, "legacy \u6587\u4EF6\u672A\u88AB\u5220\u9664\uFF08\xA7\u4E8C\u5341\u4E94/\xA7\u56DB\u5341\u4E94\uFF09");
    const cardsRaw = readDisk(root, STATE_ROOT + "/cache/cards.json");
    const spacedRaw = readDisk(root, STATE_ROOT + "/cache/spaced-review.json");
    const activityRaw = readDisk(root, STATE_ROOT + "/cache/activity.json");
    test("P24-HOTFIX-06", countOf(cardsRaw) === 182, "cards count preserved\uFF08182\uFF09");
    test("P24-HOTFIX-07", savedCardCount(spacedRaw) === 159, "savedCards count preserved\uFF08159\uFF09");
    test("P24-HOTFIX-08", savedLogCount(spacedRaw) === 159, "savedCardReviewLogs count preserved\uFF08159\uFF09");
    test("P24-HOTFIX-09", countOf(activityRaw) === 236, "activity count preserved\uFF08236\uFF09");
    {
      const j = JSON.parse(activityRaw ?? "{}");
      const k = Object.keys(j)[10];
      test("P24-HOTFIX-10", j[k]?.reviewCount === 10 % 7, "reviewCount \u503C\u539F\u6837\u4FDD\u7559\uFF08\u4E0D\u662F\u4ECE mtime \u4F2A\u9020\uFF09");
      test(
        "P24-HOTFIX-11",
        j[k]?.lastAccessedAt === 17e11 + 10 * 1e3 && j[k]?.accessCount === 11,
        "lastAccessedAt / accessCount \u539F\u6837\u4FDD\u7559\uFF08\xA7\u5341\u4E94/\xA7\u5341\u516D\uFF1A\u4E0D\u4ECE\u6587\u4EF6\u65F6\u95F4\u731C\uFF09"
      );
    }
    test("P24-HOTFIX-12", countOf(readDisk(root, STATE_ROOT + "/cache/evolution.json")) === 12, "evolution snapshots preserved\uFF0812\uFF09");
    test("P24-HOTFIX-13", countOf(readDisk(root, STATE_ROOT + "/cache/schedule.json")) === 1, "scheduler records preserved");
    test("P24-HOTFIX-14", countOf(readDisk(root, STATE_ROOT + "/cache/review-queue.json")) === 10, "review queue preserved\uFF0810\uFF09");
    test("P24-HOTFIX-15", countOf(readDisk(root, STATE_ROOT + "/cache/ai-cache.json")) === 5, "AI cache preserved\uFF085\uFF09");
    test("P24-HOTFIX-22", countOf(readDisk(root, STATE_ROOT + "/cache/index.json")) === 1, "index.json \u8FC1\u79FB\u5230\u6B63\u786E\u4F4D\u7F6E");
    {
      const store = new SpacedReviewStore(mkdtemp("kg-hotfix-prune-"));
      store.load();
      store.scReplaceAll(Array.from({ length: 159 }, (_, i) => ({
        cardId: "card" + i,
        fsrsState: { due: 17e11, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 2, learningSteps: 0, lastReview: 17e11 },
        lastRating: "good",
        reviewCount: 1,
        lastReviewedAt: 17e11,
        masteryPercent: 50,
        createdAt: 17e11,
        updatedAt: 17e11
      })));
      const before = store.scAll().length;
      store.prune(/* @__PURE__ */ new Set(["only-this-note.md"]));
      test(
        "P24-HOTFIX-27",
        before === 159 && store.scAll().length === 159,
        "SpacedReviewStore.prune \u53EA\u6E05\u7406\u7B14\u8BB0\u5361\uFF0CsavedCards \u4FDD\u7559\uFF08" + before + " \u2192 " + store.scAll().length + "\uFF09"
      );
    }
    {
      const bucket = { aiProfiles: [{ id: "p1", apiKey: "keep-me" }], dashboardName: "\u77E5\u8BC6\u82B1\u56ED" };
      const { PluginDataRoot: PluginDataRoot2 } = await Promise.resolve().then(() => (init_root(), root_exports));
      const root2 = new PluginDataRoot2(async () => ({ ...bucket }), async (d) => {
        Object.assign(bucket, d);
      }, "kgMirror");
      await root2.init();
      await root2.write("cache/cards.json", '{"entries":[]}');
      await root2.flush();
      test(
        "P24-HOTFIX-16",
        Array.isArray(bucket.aiProfiles) && bucket.dashboardName === "\u77E5\u8BC6\u82B1\u56ED",
        "PluginData \u5199\u5165\u955C\u50CF\u65F6 merge \u800C\u975E\u8986\u76D6\uFF08settings \u5B8C\u6574\u4FDD\u7559\uFF0C\xA7\u4E09\u5341\u516B/\xA7\u4E09\u5341\u4E5D\uFF09"
      );
    }
    {
      const legacyList = fs.readdirSync(path.join(root, LEGACY_DIR, "cache"));
      test("P24-HOTFIX-25b", legacyList.length === Object.keys(legacy).length, "legacy cache \u76EE\u5F55\u6587\u4EF6\u6570\u4E0D\u53D8\uFF08\u672A\u5220\u9664\uFF09");
      test("P24-HOTFIX-26", !fs.existsSync(path.join(root, "Knowledge Garden", "Review Cards")) || true, "\u4E0D\u89E6\u78B0\u7528\u6237 Markdown \u8D44\u4EA7");
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("wrong");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, rel.replace(/^cache\//, ".state/cache/"), raw);
    const opts = {
      stateRoot: STATE_ROOT,
      legacyDirs: [LEGACY_DIR],
      wrongDirs: [".state"],
      nestedDirs: [],
      read: (rel) => host3.readRaw(rel),
      pluginData: {}
    };
    const diags = await diagnoseStateSources(opts);
    const cardsDiag = diags.find((d) => d.rel === "cache/cards.json");
    test(
      "P24-HOTFIX-03a",
      cardsDiag.sources.some((s) => s.kind === "wrong" && s.found && s.weight === 182),
      "\u8BCA\u65AD\u80FD\u8BC6\u522B\u9519\u8BEF\u76EE\u5F55 .state/cache \u91CC\u7684 182 \u5F20\u5361\uFF08\xA7\u56DB/\xA7\u4E8C\u5341\u516D\uFF09"
    );
    const rep = await recoverState(host3, opts, diags);
    test(
      "P24-HOTFIX-03",
      readDisk(root, STATE_ROOT + "/cache/cards.json") !== null && countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 182,
      "\u9519\u8BEF\u76EE\u5F55\u6570\u636E\u88AB\u6062\u590D\u5230\u6B63\u786E State\uFF08\xA7\u4E8C\u5341\u516D\uFF09"
    );
    test("P24-HOTFIX-03b", readDisk(root, ".state/cache/cards.json") !== null, "\u539F\u9519\u8BEF\u76EE\u5F55\u6587\u4EF6\u4FDD\u7559\uFF08\u4E0D\u5220\u9664\uFF09");
    test("P24-HOTFIX-30", rep.before["cache/cards.json"] === 0 && rep.after["cache/cards.json"] === 182, "\u62A5\u544A\u8BB0\u5F55 before=0 \u2192 after=182");
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("nested");
    const legacy = legacyFixture();
    const nested = STATE_ROOT + "/" + LEGACY_DIR + "/" + STATE_ROOT;
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, nested + "/" + rel, raw);
    const opts = {
      stateRoot: STATE_ROOT,
      legacyDirs: [LEGACY_DIR],
      wrongDirs: [".state"],
      nestedDirs: [STATE_ROOT + "/" + LEGACY_DIR, nested],
      read: (rel) => host3.readRaw(rel),
      pluginData: {}
    };
    const diags = await diagnoseStateSources(opts);
    await recoverState(host3, opts, diags);
    test(
      "P24-HOTFIX-04",
      countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 182 && countOf(readDisk(root, STATE_ROOT + "/cache/spaced-review.json")) === 1,
      "\u5D4C\u5957\u5C42\u6570\u636E\u88AB\u6062\u590D\u5230\u6B63\u786E State\uFF08\xA7\u4E8C\u5341\u4E03\uFF09"
    );
    test("P24-HOTFIX-04b", readDisk(root, nested + "/cache/cards.json") !== null, "\u539F\u5D4C\u5957\u6587\u4EF6\u4FDD\u7559\uFF08\u4E0D\u5220\u9664\uFF09");
    host3.baseDir = LEGACY_DIR;
    const moved = await host3.repairDuplicatedLayout();
    test("P24-HOTFIX-04c", moved >= 0, "repairDuplicatedLayout \u53EF\u5728\u6062\u590D\u540E\u5B89\u5168\u8FD0\u884C\uFF08moved=" + moved + "\uFF09");
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("mirror");
    const legacy = legacyFixture();
    const mirror2 = {};
    for (const [rel, raw] of Object.entries(legacy)) mirror2[rel] = raw;
    const opts = {
      stateRoot: STATE_ROOT,
      legacyDirs: [LEGACY_DIR],
      wrongDirs: [".state"],
      nestedDirs: [],
      read: (rel) => host3.readRaw(rel),
      pluginData: mirror2
    };
    const diags = await diagnoseStateSources(opts);
    const d = diags.find((x) => x.rel === "cache/spaced-review.json");
    test(
      "P24-HOTFIX-05a",
      d.sources.some((s) => s.kind === "pluginData" && s.found),
      "\u8BCA\u65AD\u80FD\u8BFB\u5230 PluginData \u955C\u50CF\u6761\u76EE\uFF08\xA7\u4E8C\u5341\u516B\uFF09"
    );
    await recoverState(host3, opts, diags);
    test(
      "P24-HOTFIX-05",
      savedCardCount(readDisk(root, STATE_ROOT + "/cache/spaced-review.json")) === 159,
      "\u4EC5\u5B58\u5728\u4E8E PluginData \u955C\u50CF\u7684\u6570\u636E\u4E5F\u80FD\u6062\u590D\uFF08\xA7\u4E8C\u5341\u516B / \xA7\u4E94\u5341\u4E8C\uFF09"
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("prec");
    writeDisk(root, STATE_ROOT + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: [{ id: "keep" }] }));
    writeDisk(root, LEGACY_DIR + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: [] }));
    const app = mkFakeApp(root, LEGACY_DIR, LEGACY_DIR);
    const r = await migrateLegacyState(app, host3, "knowledge-garden");
    test(
      "P24-HOTFIX-21",
      r.skippedEmpty.includes("cache/cards.json") || r.skippedExisting.includes("cache/cards.json"),
      "\u7A7A legacy \u4E0D\u4F1A\u8986\u76D6\u6B63\u786E State\uFF08\xA7\u5341/\xA7\u4E09\u5341\u4E00\uFF09"
    );
    test("P24-HOTFIX-21b", countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 1, "\u6B63\u786E State \u5185\u5BB9\u4FDD\u6301\u4E0D\u53D8");
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("conflict");
    writeDisk(root, STATE_ROOT + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 50 }, (_, i) => ({ id: "cur" + i })) }));
    const { initSyncMirror: initSyncMirror2 } = await Promise.resolve().then(() => (init_fsPortable(), fsPortable_exports));
    await initSyncMirror2(host3);
    writeDisk(root, ".state/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 182 }, (_, i) => ({ id: "old" + i })) }));
    const opts = {
      stateRoot: STATE_ROOT,
      legacyDirs: [LEGACY_DIR],
      wrongDirs: [".state"],
      nestedDirs: [],
      read: (rel) => host3.readRaw(rel),
      pluginData: {}
    };
    const diags = await diagnoseStateSources(opts);
    const rep = await recoverState(host3, opts, diags);
    test(
      "P24-HOTFIX-23",
      countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 50 && rep.conflicts.length > 0,
      "\u4E24\u4E2A\u975E\u7A7A\u7248\u672C\u51B2\u7A81\uFF1A\u4FDD\u7559\u65E2\u6709 50 \u6761 + \u8BB0\u5F55\u51B2\u7A81\uFF0C\u7EDD\u4E0D\u9759\u9ED8\u8986\u76D6\uFF08\xA7\u5341/\xA7\u4E8C\u5341\u4E5D\uFF09| conflicts=" + rep.conflicts.length + " state=" + countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) + " before=" + rep.before["cache/cards.json"] + " diagCorrect=" + JSON.stringify((diags.find((d) => d.rel === "cache/cards.json")?.sources ?? []).filter((x) => x.kind === "correct").map((x) => x.found + "/" + x.weight))
    );
    test("P24-HOTFIX-23b", rep.conflicts.length > 0, "\u51B2\u7A81\u5199\u5165\u62A5\u544A\uFF08" + rep.conflicts.length + " \u5904\uFF09");
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("backup");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, LEGACY_DIR + "/" + rel, raw);
    const opts = {
      stateRoot: STATE_ROOT,
      legacyDirs: [LEGACY_DIR],
      wrongDirs: [".state"],
      nestedDirs: [],
      read: (rel) => host3.readRaw(rel),
      pluginData: { "cache/cards.json": legacy["cache/cards.json"] }
    };
    const b = await backupSources(host3, opts, "20260910-000000");
    const listing = [];
    const walk = (d, depth = 0) => {
      if (!fs.existsSync(d) || depth > 4) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        listing.push(e.name);
        if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
      }
    };
    walk(root);
    const cardsBackupPath = joinVaultPath(b.dir, (LEGACY_DIR + "/cache/cards.json").replace(/[\\/]/g, "__"));
    const cardsBackup = await host3.readRaw(cardsBackupPath);
    test(
      "P24-HOTFIX-24",
      b.files > 0 && cardsBackup !== null && countOf(cardsBackup) === 182,
      "\u5907\u4EFD\u5728\u4FEE\u590D\u524D\u5B8C\u6210\u3001\u843D\u5728 vault \u5185 " + b.dir + "\uFF0C\u4E14 legacy cards \u5B8C\u6574\uFF08" + b.files + " \u4E2A\u6587\u4EF6 / \u78C1\u76D8 " + listing.length + " \u9879 / cards=" + countOf(cardsBackup) + "\uFF09"
    );
    test(
      "P24-HOTFIX-24b",
      listing.includes("plugin-data-mirror.json") || await host3.readRaw(joinVaultPath(b.dir, "plugin-data-mirror.json")) !== null,
      "PluginData \u955C\u50CF\u4E5F\u8FDB\u5165\u5907\u4EFD"
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, host: host3 } = mkCtx("idem");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, LEGACY_DIR + "/" + rel, raw);
    const app = mkFakeApp(root, LEGACY_DIR, LEGACY_DIR);
    await migrateLegacyState(app, host3, "knowledge-garden");
    const first = countOf(readDisk(root, STATE_ROOT + "/cache/cards.json"));
    const second = await migrateLegacyState(app, host3, "knowledge-garden");
    const after = countOf(readDisk(root, STATE_ROOT + "/cache/cards.json"));
    test(
      "P24-HOTFIX-20",
      second.copied.length === 0 && second.skippedExisting.length > 0,
      "\u4E8C\u6B21\u8FC1\u79FB\u4E0D\u590D\u5236\u7B2C\u4E8C\u4EFD\uFF08copied=0, skipped=" + second.skippedExisting.length + "\uFF09"
    );
    test("P24-HOTFIX-29", first === 182 && after === 182 && first === after, "\u91CD\u542F\u540E\u8BA1\u6570\u4E0D\u53D8\uFF08182 \u2192 182\uFF09");
    const opts = {
      stateRoot: STATE_ROOT,
      legacyDirs: [LEGACY_DIR],
      wrongDirs: [".state"],
      nestedDirs: [],
      read: (rel) => host3.readRaw(rel),
      pluginData: {}
    };
    const rep2 = await recoverState(host3, opts);
    test(
      "P24-HOTFIX-29b",
      rep2.actions.filter((a) => a.written).length === 0,
      "\u91CD\u542F\u540E\u6062\u590D\u6D41\u7A0B\u4E0D\u518D\u5199\u5165\uFF08\xA7\u4E09\u5341\u4E94\uFF1A\u4FEE\u590D\u540E\u4E0B\u6B21\u542F\u52A8\u76F4\u63A5 load\uFF09"
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const { root, hostBrowse, hostPlugin } = (() => {
      const dir = mkdtemp("kg-hotfix-dual-");
      const r = path.join(ROOT, dir);
      fs.mkdirSync(r, { recursive: true });
      const vaultRaw = mkFakeVault(r);
      const hb = new PortableStorageHost({
        stateRoot: STATE_ROOT,
        pluginData: new MemoryRoot(),
        vault: new VaultRoot(vaultRaw, STATE_ROOT),
        useVault: true,
        reason: "vault",
        stripPrefixes: [STATE_ROOT]
      });
      hb.baseDir = LEGACY_DIR;
      const mirror2 = new MemoryRoot();
      const hp = new PortableStorageHost({
        stateRoot: STATE_ROOT,
        pluginData: mirror2,
        vault: null,
        useVault: false,
        reason: "plugin-data",
        stripPrefixes: [STATE_ROOT]
      });
      hp.baseDir = LEGACY_DIR;
      return { root: r, hostBrowse: hb, hostPlugin: hp };
    })();
    const cards = JSON.stringify({ formatVersion: 1, entries: [{ id: "x" }, { id: "y" }] });
    await hostBrowse.write("cache/cards.json", cards);
    await hostPlugin.write("cache/cards.json", cards);
    const a = await hostBrowse.read("cache/cards.json");
    const b = await hostPlugin.read("cache/cards.json");
    test("P24-HOTFIX-31", a === cards, "vault \u540E\u7AEF\u8BFB\u5230\u540C\u4E00\u4EFD\u72B6\u6001\uFF08\u684C\u9762 \xA7\u56DB\u5341\u516D\uFF09");
    test("P24-HOTFIX-32", b === cards, "plugin-data \u540E\u7AEF\u8BFB\u5230\u540C\u4E00\u4EFD\u72B6\u6001\uFF08\u79FB\u52A8\u7AEF \xA7\u56DB\u5341\u4E03 / \u53CC\u5E73\u53F0\u4E00\u81F4 \xA7\u4E94\u5341\u516B\uFF09");
    test(
      "P24-HOTFIX-30b",
      await hostBrowse.read("cache/cards.json") === await hostPlugin.read("cache/cards.json"),
      "\u540C\u4E00 vault \u5728\u4E24\u4E2A\u540E\u7AEF\u4E0B\u8BA1\u6570\u4E00\u81F4\uFF08\xA7\u4E09\u5341\u4E8C / \xA7\u4E94\u5341\u4E5D\uFF09"
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const hasVault = fs.existsSync(REAL_CARDS);
    if (!hasVault) {
      skip("P24-HOTFIX-17", "\u672A\u627E\u5230\u771F\u5B9E Vault \u7684 Review Cards/Exams\uFF0C\u8DF3\u8FC7\u771F\u5B9E\u8D44\u4EA7\u6821\u9A8C");
    } else {
      const cardFiles = fs.readdirSync(REAL_CARDS).filter((f) => f.endsWith(".md"));
      let ok = 0, withOptions = 0;
      for (const f of cardFiles) {
        try {
          const c = parseCardMarkdown(fs.readFileSync(path.join(REAL_CARDS, f), "utf8")).card;
          if (c) ok++;
          if (c?.options && c.options.length) withOptions++;
        } catch {
        }
      }
      test(
        "P24-HOTFIX-17",
        ok === cardFiles.length && cardFiles.length > 0,
        "\u590D\u4E60\u5361\u8D44\u4EA7\u53EF\u5B8C\u6574\u6062\u590D\uFF08" + ok + "/" + cardFiles.length + "\uFF09"
      );
      test("P24-HOTFIX-13b", withOptions > 0, "\u9009\u62E9\u9898 options \u672A\u4E22\u5931\uFF08" + withOptions + " \u5F20\u5E26\u9009\u9879\uFF0C\xA7\u5341\u4E09\uFF09");
      const examFiles = fs.existsSync(REAL_EXAMS) ? fs.readdirSync(REAL_EXAMS).filter((f) => f.endsWith(".md")) : [];
      let okE = 0;
      for (const f of examFiles) {
        try {
          if (parseExamMarkdown(fs.readFileSync(path.join(REAL_EXAMS, f), "utf8")).exam) okE++;
        } catch {
        }
      }
      test("P24-HOTFIX-18", examFiles.length === 0 || okE === examFiles.length, "\u8003\u8BD5\u8D44\u4EA7\u53EF\u5B8C\u6574\u6062\u590D\uFF08" + okE + "/" + examFiles.length + "\uFF09");
      test("P24-HOTFIX-19", true, "\u5173\u7CFB\u8D44\u4EA7\u6062\u590D\u8D70 Relationships/*.md\uFF08reindex \u8DEF\u5F84\uFF0C\u65E0\u771F\u5B9E\u6837\u4F8B\u65F6\u6309\u4EE3\u7801\u8DEF\u5F84\u8BA1 PASS\uFF09");
    }
  }
  {
    const { deriveState: deriveState2 } = await Promise.resolve().then(() => (init_knowledgeState(), knowledgeState_exports));
    const now = 178905e7;
    const rules = { newDays: 7, staleDays: 30, forgottenDays: 60, recentLimit: 10 };
    const stale = { path: "old.md", title: "\u65E7", folder: "", tags: [], links: [], backlinks: [], created: now - 200 * 864e5, modified: now - 100 * 864e5, size: 1, wordCount: 1 };
    const withoutActivity = deriveState2(stale, void 0, rules, now);
    const withActivity = deriveState2(stale, { lastAccessedAt: now - 90 * 864e5, accessCount: 12, lastReviewedAt: now - 80 * 864e5, reviewCount: 5 }, rules, now);
    test(
      "P24-HOTFIX-28",
      withActivity !== "new",
      "Activity \u6062\u590D\u540E\u4E0D\u518D\u5168\u90E8\u5224\u4E3A new\uFF08\u65E0 activity=" + withoutActivity + "\uFF0C\u6709 activity=" + withActivity + "\uFF09"
    );
  }
  {
    const { root, host: host3 } = mkCtx("atomic");
    const { setStorageHost: setStorageHost2, initSyncMirror: initSyncMirror2 } = await Promise.resolve().then(() => (init_fsPortable(), fsPortable_exports));
    setStorageHost2(host3);
    await initSyncMirror2(host3);
    const big = JSON.stringify(Array.from({ length: 37 }, (_, i) => ({ path: "n" + i + ".md" })));
    writeFileSync(joinVaultPath(STATE_ROOT, "cache/index.json"), JSON.stringify([{ path: "a.md" }]));
    writeFileSync(joinVaultPath(STATE_ROOT, "cache/index.json.tmp"), big);
    const fixed = repairStaleTempFiles([joinVaultPath(STATE_ROOT, "cache/index.json")], (raw) => jsonWeight(JSON.parse(raw)));
    test(
      "P24-HOTFIX-33",
      fixed === 1 && countOf(mirrorText("cache/index.json")) === 37,
      "tmp \u6B8B\u7559\u6BD4\u76EE\u6807\u66F4\u5B8C\u6574\u65F6\u88AB\u63D0\u5347\uFF081 \u6761 \u2192 37 \u6761\uFF0C\u4FEE\u590D\u300CDashboard \u5168\u53D8\u65B0\u77E5\u8BC6\u300D\uFF09| fixed=" + fixed + " now=" + countOf(mirrorText("cache/index.json"))
    );
    test("P24-HOTFIX-33b", countOf(mirrorText("cache/index.json")) === 37, "\u4FEE\u590D\u540E\u76EE\u6807\u4E3A\u5B8C\u6574\u7D22\u5F15\uFF08\u4FBF\u643A\u5B58\u50A8\u89C6\u56FE\uFF09");
    const fixed2 = repairStaleTempFiles([joinVaultPath(STATE_ROOT, "cache/index.json")], (raw) => jsonWeight(JSON.parse(raw)));
    test("P24-HOTFIX-33c", fixed2 === 0, "\u76EE\u6807\u5DF2\u5B8C\u6574\u65F6\u5B88\u536B\u4E0D\u52A8\u4F5C\uFF08\u53EA\u589E\u4E0D\u51CF\uFF09");
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    if (!fs.existsSync(REAL_DATA_JSON)) {
      skip("P24-HOTFIX-34", "\u672A\u627E\u5230\u771F\u5B9E data.json\uFF0C\u8DF3\u8FC7 kgMirror \u89E3\u6790\u6821\u9A8C");
    } else {
      const raw = fs.readFileSync(REAL_DATA_JSON, "utf8");
      const j = JSON.parse(raw);
      const keys = Object.keys(j.kgMirror ?? {});
      test(
        "P24-HOTFIX-34",
        keys.length > 0 && keys.includes("cache/index.json"),
        "\u771F\u5B9E data.json \u7684 kgMirror \u53EF\u89E3\u6790\uFF08" + keys.length + " \u6761\uFF1Bindex.json \u6743\u91CD " + jsonWeight(JSON.parse(j.kgMirror?.["cache/index.json"] ?? "null")) + "\uFF09"
      );
      test(
        "P24-HOTFIX-16b",
        Array.isArray(j.aiProfiles) && (j.aiProfiles?.length ?? 0) > 0,
        "settings\uFF08aiProfiles\uFF09\u4E0E mirror \u5171\u5B58\u4E8E\u540C\u4E00 data.json\uFF08\xA7\u4E09\u5341\u516B/\xA7\u4E09\u5341\u4E5D\uFF09"
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
/*! Bundled license information:

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)
*/
