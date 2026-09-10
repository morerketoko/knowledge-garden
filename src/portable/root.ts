/**
 * Phase 24 §六 / §七 / §十：存储后端（Root）抽象。
 *
 * 设计目标：把「文件读写」从 Node `fs` 解耦成可替换后端，使同一份业务代码
 * 在桌面上写真实文件、在移动端写 Obsidian Vault API 或 plugin data。
 *
 * 三个实现：
 * - MemoryRoot：纯内存，供 Node 自动测试（无 Obsidian 依赖）。
 * - VaultRoot：Obsidian Vault API（Vault.create / Vault.modify / Vault.delete /
 *   Vault.rename / Vault.getAbstractFileByPath ...）。移动端可用，**不使用 Node fs**。
 * - PluginDataRoot：Obsidian Plugin Data API（loadData / saveData）上的虚拟文件系统，
 *   当 Vault 写入不可用（只读仓库 / iCloud 只读等）时作为最终兜底（§九）。
 *
 * 所有路径都是 **root 相对路径**（POSIX `/` 分隔，无前导 `/`）。
 */
import { dirnameVaultPath, normalizeVaultPath } from "./paths";

export interface RootFileInfo {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

/** 存储后端：只提供最小原语，语义与 Node fs 的同步版一一对应（见 fsPortable.ts） */
export interface StorageRoot {
  /** 后端标识，诊断/测试用 */
  readonly kind: "memory" | "vault" | "plugin-data";
  /** 该后端是否能把数据持久化到磁盘（false = 内存，仅测试/降级） */
  readonly persistent: boolean;
  /** 数据落地的可读位置（诊断展示用，不含绝对路径） */
  readonly location: string;

  exists(path: string): Promise<boolean>;
  isFile(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<boolean>;
  mkdirp(path: string): Promise<void>;
  list(path: string): Promise<RootFileInfo[]>;
  /** 是否需要（且在何时）刷新读缓存 */
  prefetch(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* MemoryRoot：Node 自动测试 / 极端降级                                */
/* ------------------------------------------------------------------ */

export class MemoryRoot implements StorageRoot {
  readonly kind = "memory" as const;
  readonly persistent = false;
  readonly location = "memory://";
  private files = new Map<string, string>();
  /** 可注入故障：写失败次数（测试损坏/降级路径） */
  failWrites = 0;

  constructor(seed?: Record<string, string>) {
    if (seed) for (const [k, v] of Object.entries(seed)) this.files.set(normalizeVaultPath(k), v);
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizeVaultPath(path);
    if (this.files.has(p)) return true;
    return this.hasChildren(p);
  }
  async isFile(path: string): Promise<boolean> { return this.files.has(normalizeVaultPath(path)); }
  async isDirectory(path: string): Promise<boolean> {
    const p = normalizeVaultPath(path);
    if (!p) return true;
    return this.hasChildren(p);
  }
  private hasChildren(p: string): boolean {
    const prefix = p + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  async read(path: string): Promise<string | null> {
    const v = this.files.get(normalizeVaultPath(path));
    return v === undefined ? null : v;
  }
  async write(path: string, data: string): Promise<void> {
    if (this.failWrites > 0) { this.failWrites--; throw new Error("memory root: injected write failure"); }
    this.files.set(normalizeVaultPath(path), data);
  }
  async remove(path: string): Promise<boolean> {
    const p = normalizeVaultPath(path);
    if (this.files.delete(p)) return true;
    const prefix = p + "/";
    let removed = false;
    for (const k of Array.from(this.files.keys())) if (k.startsWith(prefix)) { this.files.delete(k); removed = true; }
    return removed;
  }
  async rename(from: string, to: string): Promise<boolean> {
    const f = normalizeVaultPath(from);
    const t = normalizeVaultPath(to);
    const v = this.files.get(f);
    if (v === undefined) return false;
    this.files.delete(f);
    this.files.set(t, v);
    return true;
  }
  async mkdirp(): Promise<void> { /* 内存后端不需要目录 */ }
  async list(path: string): Promise<RootFileInfo[]> {
    const p = normalizeVaultPath(path);
    const prefix = p ? p + "/" : "";
    const out: RootFileInfo[] = [];
    for (const [k, v] of this.files) {
      if (prefix && !k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (!rest || rest.includes("/")) continue; // 只列直接子项
      out.push({ path: k, name: rest, size: v.length, mtime: 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async prefetch(): Promise<void> { /* 无缓存 */ }
  /** 测试辅助：全部键 */
  keys(): string[] { return Array.from(this.files.keys()); }
  /** 测试辅助：目录是否为空 */
  isEmptyDir(path: string): boolean {
    const prefix = (normalizeVaultPath(path) || "") + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return false;
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* VaultRoot：Obsidian Vault API（移动端主存储）                        */
/* ------------------------------------------------------------------ */

/** 只声明用到的 Obsidian 结构，避免为测试引入 obsidian 运行时依赖 */
interface VaultLikeFile { path: string; stat?: { size?: number; mtime?: number; ctime?: number }; children?: unknown[] }
interface VaultLike {
  getAbstractFileByPath(path: string): VaultLikeFile | null;
  read(file: VaultLikeFile): Promise<string>;
  cachedRead(file: VaultLikeFile): Promise<string>;
  create(path: string, data: string): Promise<VaultLikeFile>;
  createFolder(path: string): Promise<unknown>;
  modify(file: VaultLikeFile, data: string): Promise<void>;
  delete(file: VaultLikeFile, force?: boolean): Promise<void>;
  trash(file: VaultLikeFile, system: boolean): Promise<void>;
  rename(file: VaultLikeFile, newPath: string): Promise<void>;
  getFiles?(): VaultLikeFile[];
  getMarkdownFiles?(): VaultLikeFile[];
}

export class VaultRoot implements StorageRoot {
  readonly kind = "vault" as const;
  readonly persistent = true;
  private fileCache = new Map<string, string>();

  constructor(private vault: VaultLike, private basePath: string) {}

  get location(): string { return this.basePath + "/"; }

  /**
   * 合并 basePath 后交给 Obsidian（Obsidian 只接受 vault 相对路径）。
   *
   * **幂等**：如果传入路径已经是「带 basePath 前缀的完整 vault 路径」，直接返回，
   * 绝不再加一次前缀。历史上这里是无条件拼接，导致
   * `.state/Knowledge Garden/.state/cache/...` 这种重复嵌套目录 —— 存储写到了
   * 嵌套位置，而读取走的是 `.state/cache/...`，于是所有状态都「看起来消失了」。
   */
  private full(path: string): string {
    return this.vaultPathFor(path);
  }

  /**
   * 统一的「相对路径 → 完整 vault 路径」映射（幂等）。
   *
   * 所有内部调用（mkdirp / write / rename / list）都必须用它，
   * 否则逐段拼接出来的前缀会被二次加前缀 —— 这正是
   * `.state-recovery/…` 被写到 `Knowledge Garden/.state/.state-recovery/…` 的原因。
   */
  private vaultPathFor(path: string): string {
    const p = normalizeVaultPath(path);
    if (!p) return "";
    if (!this.basePath) return p;
    if (p === this.basePath || p.startsWith(this.basePath + "/")) return p;
    return this.basePath + "/" + p;
  }

  private abstractFile(path: string): VaultLikeFile | null {
    const f = this.full(path);
    if (!f) return null;
    try { return this.vault.getAbstractFileByPath(f); } catch { return null; }
  }

  async exists(path: string): Promise<boolean> { return this.abstractFile(path) !== null; }
  async isFile(path: string): Promise<boolean> {
    const f = this.abstractFile(path);
    return !!f && (f as { children?: unknown }).children === undefined;
  }
  async isDirectory(path: string): Promise<boolean> {
    const f = this.abstractFile(path);
    return !!f && Array.isArray((f as { children?: unknown }).children);
  }

  /**
   * 读取文件内容。
   *
   * 刻意**不经过 `full()`**：raw / 业务两种写法都要能读。
   * - 传入「完整 vault 路径」（如 `.state/cache/cards.json` 或 `Knowledge Garden/.state/cache/…`）→ 直接按该路径读；
   * - 传入「相对 basePath 的路径」（如 `cache/cards.json`）→ 补上 basePath 再读。
   * 两条都失败时再退回 `getAbstractFileByPath`（覆盖 Obsidian 内部路径归一化的差异）。
   */
  async read(path: string): Promise<string | null> {
    const p = normalizeVaultPath(path);
    if (!p) return null;
    const cached = this.fileCache.get(p);
    if (cached !== undefined) return cached;

    const attempts = p.startsWith(this.basePath + "/") || p === this.basePath
      ? [p]
      : [this.basePath ? this.basePath + "/" + p : p, p];
    for (const abs of attempts) {
      const f = this.abstractFileByExactPath(abs);
      if (!f) continue;
      try {
        const text = this.vault.cachedRead ? await this.vault.cachedRead(f) : await this.vault.read(f);
        this.fileCache.set(p, text);
        return text;
      } catch { /* 换下一种写法 */ }
    }
    return null;
  }

  /** 精确路径查找（不走 full()，避免任何再次拼接） */
  private abstractFileByExactPath(abs: string): VaultLikeFile | null {
    try {
      const hit = this.vault.getAbstractFileByPath(abs);
      if (hit) return hit;
    } catch { /* 忽略：退回 getFiles 扫描 */ }
    const all = this.vault.getFiles ? this.vault.getFiles() : [];
    return all.find((f) => f.path === abs) ?? null;
  }

  async write(path: string, data: string): Promise<void> {
    const p = normalizeVaultPath(path);
    const dir = dirnameVaultPath(p);
    if (dir) await this.mkdirp(dir);
    const existing = this.abstractFile(p);
    if (existing && (existing as { children?: unknown }).children !== undefined) {
      throw new Error("vault root: 目标是目录，无法写入：" + p);
    }
    if (existing) {
      await this.vault.modify(existing, data);
    } else {
      try {
        await this.vault.create(this.full(p), data);
      } catch (e) {
        // Obsidian 对「父目录缺失 / 已存在」都抛错：区分后自愈一次（避免移动端 iCloud 竞态导致写失败）
        const msg = String((e as Error)?.message ?? e);
        if (/exist/i.test(msg)) {
          const f = this.abstractFile(p);
          if (f) await this.vault.modify(f, data);
          else throw e;
        } else {
          if (dir) {
            try { await this.vault.createFolder(this.full(dir)); } catch { /* 已存在 */ }
          }
          const again = this.abstractFile(p);
          if (again) await this.vault.modify(again, data);
          else await this.vault.create(this.full(p), data);
        }
      }
    }
    this.fileCache.set(p, data);
  }

  async remove(path: string): Promise<boolean> {
    const p = normalizeVaultPath(path);
    const f = this.abstractFile(p);
    this.fileCache.delete(p);
    if (!f) {
      // 目录型删除：逐个删子项（state 目录内容由本插件管理）
      const children = await this.list(p);
      if (!children.length) return false;
      for (const c of children) await this.remove(c.path);
      return true;
    }
    try { await this.vault.delete(f, true); return true; } catch {
      try { await this.vault.trash(f, false); return true; } catch { return false; }
    }
  }

  async rename(from: string, to: string): Promise<boolean> {
    const f = this.abstractFile(from);
    if (!f) return false;
    const t = normalizeVaultPath(to);
    const dir = dirnameVaultPath(t);
    if (dir) await this.mkdirp(dir);
    try {
      await this.vault.rename(f, this.full(t));
      const c = this.fileCache.get(normalizeVaultPath(from));
      this.fileCache.delete(normalizeVaultPath(from));
      if (c !== undefined) this.fileCache.set(t, c);
      return true;
    } catch { return false; }
  }

  async mkdirp(path: string): Promise<void> {
    const p = normalizeVaultPath(path);
    if (!p) return;
    const segments = p.split("/");
    let acc = "";
    for (const seg of segments) {
      acc = acc ? acc + "/" + seg : seg;
      if (this.abstractFile(acc)) continue;
      try { await this.vault.createFolder(this.vaultPathFor(acc)); } catch { /* 并发/已存在 */ }
    }
  }

  async list(path: string): Promise<RootFileInfo[]> {
    const p = normalizeVaultPath(path);
    const prefix = this.full(p);
    const prefixSlash = prefix ? prefix + "/" : "";
    const out: RootFileInfo[] = [];
    const all = this.vault.getFiles ? this.vault.getFiles() : [];
    for (const f of all) {
      if (prefixSlash && !f.path.startsWith(prefixSlash)) continue;
      const rest = f.path.slice(prefixSlash.length);
      if (!rest || rest.includes("/")) continue; // 只列直接子项
      out.push({ path: rest, name: rest, size: f.stat?.size ?? 0, mtime: f.stat?.mtime ?? 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 同步列出 vault 内全部文件（相对 vault 根）。
   * 供布局修复使用：Obsidian 只有 getFiles()（文件列表，不含目录），
   * 因此修复必须文件驱动，而不是逐层 list 目录。
   */
  listAllFilesSync(): string[] {
    const all = this.vault.getFiles ? this.vault.getFiles() : [];
    return all.map((f) => f.path);
  }

  async prefetch(): Promise<void> {
    // VaultRoot 读路径是异步的（obsidian API 限制），首屏读在上层用 loadData 快速路径前置，
    // 这里只做一次轻量预热：把静态小文件放进内存，避免首帧 await。
    for (const rel of this.warmup) {
      void this.read(rel);
    }
  }

  /** 上层可注入需要预热的相对路径（启动时已知的固定文件） */
  warmup: string[] = [];
  /** 释放读缓存（写后由自身维护，测试/降级时可手动清空） */
  clearCache(): void { this.fileCache.clear(); }
}

/* ------------------------------------------------------------------ */
/* PluginDataRoot：Plugin Data API 上的虚拟文件系统                    */
/* ------------------------------------------------------------------ */

/** 数据快照：相对路径 → 文本 */
export type PluginDataSnapshot = Record<string, string>;

export class PluginDataRoot implements StorageRoot {
  readonly kind = "plugin-data" as const;
  readonly persistent = true;
  readonly location = "plugin-data://";

  private files = new Map<string, string>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private load: () => Promise<unknown>,
    private save: (data: unknown) => Promise<void>,
    private namespace = "kgm"
  ) {}

  /** 从 plugin data 读取快照（宿主在 onload 里 await 一次，让同步读可用） */
  async init(): Promise<number> {
    try {
      const raw = await this.load();
      const bucket = (raw as Record<string, unknown> | null)?.[this.namespace];
      if (bucket && typeof bucket === "object") {
        for (const [k, v] of Object.entries(bucket as Record<string, unknown>)) {
          if (typeof v === "string") this.files.set(normalizeVaultPath(k), v);
        }
      }
    } catch { /* 首次运行 / data.json 损坏：从空开始（settings 侧另有备份策略） */ }
    return this.files.size;
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer !== null) return;
    // 与 Activity 一致：批量合并写，避免移动端频繁 saveData 造成的卡顿
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, 800);
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const bucket: PluginDataSnapshot = {};
      for (const [k, v] of this.files) bucket[k] = v;
      const current = (await this.load()) as Record<string, unknown> | null;
      const next = { ...(current && typeof current === "object" ? current : {}), [this.namespace]: bucket };
      await this.save(next);
    } catch { /* 写失败不阻塞运行；下次 flush 会重试 */ }
  }

  /** 宿主的 settings 保存必须与本快照合并，避免互相覆盖 */
  snapshot(): PluginDataSnapshot {
    const out: PluginDataSnapshot = {};
    for (const [k, v] of this.files) out[k] = v;
    return out;
  }

  async exists(path: string): Promise<boolean> { return this.files.has(normalizeVaultPath(path)); }
  async isFile(path: string): Promise<boolean> { return this.files.has(normalizeVaultPath(path)); }
  async isDirectory(path: string): Promise<boolean> {
    const prefix = normalizeVaultPath(path) + "/";
    for (const k of this.files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  async read(path: string): Promise<string | null> {
    const v = this.files.get(normalizeVaultPath(path));
    return v === undefined ? null : v;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(normalizeVaultPath(path), data);
    this.scheduleFlush();
  }
  async remove(path: string): Promise<boolean> {
    const p = normalizeVaultPath(path);
    let removed = this.files.delete(p);
    const prefix = p + "/";
    for (const k of Array.from(this.files.keys())) if (k.startsWith(prefix)) { this.files.delete(k); removed = true; }
    if (removed) this.scheduleFlush();
    return removed;
  }
  async rename(from: string, to: string): Promise<boolean> {
    const f = normalizeVaultPath(from);
    const t = normalizeVaultPath(to);
    const v = this.files.get(f);
    if (v === undefined) return false;
    this.files.delete(f);
    this.files.set(t, v);
    this.scheduleFlush();
    return true;
  }
  async mkdirp(): Promise<void> { /* 虚拟文件系统无目录 */ }
  async list(path: string): Promise<RootFileInfo[]> {
    const p = normalizeVaultPath(path);
    const prefix = p ? p + "/" : "";
    const out: RootFileInfo[] = [];
    for (const [k, v] of this.files) {
      if (prefix && !k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      out.push({ path: k, name: rest, size: v.length, mtime: 0 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async prefetch(): Promise<void> { await this.flush(); }
}
