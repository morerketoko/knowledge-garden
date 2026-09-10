/**
 * Phase 24 §六 / §九 / §十三：统一便携存储（PortableStorage）。
 *
 * 这一层把「业务要一个 JSON 持久化对象」和「平台到底怎么写磁盘」彻底分开：
 *
 *   ActivityStore / AICache / EvolutionStore / Scheduler / ReviewCenterStore /
 *   SpacedReviewStore / ExamStore / CardStore / WorkbenchStore / ...
 *        ↓  PortableJsonStore<T>（load / save / remove / exists / list）
 *   PortableStorage（Root 路由：plugin-relative ↔ vault-relative）
 *        ↓  StorageRoot
 *   VaultRoot（Obsidian Vault API，移动端可用） | PluginDataRoot（Plugin Data API）
 *
 * 关键不变量：
 * - 本模块**没有任何** Node fs / path / crypto import（§三 / §一百三十六）。
 * - 写入走 `atomicSave()`：桌面可 tmp+rename；移动端用平台能力（Vault create/modify），
 *   不假装移动端存在 fs atomic rename（§十三）。
 * - 损坏恢复不依赖 fs.renameSync：见 corruption.ts（§十二）。
 */
import type { StorageRoot } from "./portable/root";
import { dirnameVaultPath, joinVaultPath, normalizeVaultPath } from "./portable/paths";

/** 一次写入后的落盘状态（诊断展示：移动端可据此提示「原子性由平台决定」） */
export interface SaveOutcome {
  ok: boolean;
  /** true = 使用了 tmp+rename 的原子替换；false = 退化为平台直接写 */
  atomic: boolean;
  backend: StorageRoot["kind"];
  error?: string;
}

/** 统一的便携存储外观 */
export class PortableStorage {
  constructor(readonly root: StorageRoot) {}

  get backend(): StorageRoot["kind"] { return this.root.kind; }
  get location(): string { return this.root.location; }
  get persistent(): boolean { return this.root.persistent; }

  /** 启动前调用：让 VaultRoot 的读缓存 / PluginDataRoot 的快照就绪 */
  async init(): Promise<void> { await this.root.prefetch(); }

  async exists(path: string): Promise<boolean> { return this.root.exists(normalizeVaultPath(path)); }

  async readText(path: string): Promise<string | null> { return this.root.read(normalizeVaultPath(path)); }

  async readJson<T>(path: string): Promise<T | null> {
    const raw = await this.readText(path);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  /**
   * §十三：平台无关写入。
   *
   * `atomic` 的选择依据是**后端能力**，不是 `Platform.isMobile` 的猜测：
   * - vault / plugin-data 后端：Obsidian 的 create+modify 本身不提供跨文件原子替换，
   *   因此先写 `<file>.bak` 备份，再写目标；任一步失败都会保留备份（§十二）。
   * - 桌面（调用方传入 nativeAtomic=true）：沿用 tmp + rename。
   */
  async writeText(path: string, data: string, opts?: { nativeAtomic?: boolean }): Promise<SaveOutcome> {
    const p = normalizeVaultPath(path);
    if (!p) return { ok: false, atomic: false, backend: this.root.kind, error: "非法路径" };
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
      // 平台非原子路径：先备份，再写
      const backup = p + ".bak";
      const prev = await this.root.read(p);
      if (prev !== null) await this.root.write(backup, prev);
      await this.root.write(p, data);
      return { ok: true, atomic: false, backend: this.root.kind };
    } catch (e) {
      return { ok: false, atomic: false, backend: this.root.kind, error: (e as Error)?.message ?? String(e) };
    }
  }

  async writeJson(path: string, value: unknown, opts?: { nativeAtomic?: boolean }): Promise<SaveOutcome> {
    return this.writeText(path, JSON.stringify(value), opts);
  }

  async remove(path: string): Promise<boolean> { return this.root.remove(normalizeVaultPath(path)); }

  async rename(from: string, to: string): Promise<boolean> { return this.root.rename(normalizeVaultPath(from), normalizeVaultPath(to)); }

  /** 列出目录下的直接子项（相对 path 的名字） */
  async list(path: string): Promise<{ name: string; path: string; size: number; mtime: number }[]> {
    return this.root.list(normalizeVaultPath(path));
  }

  async isDirectory(path: string): Promise<boolean> { return this.root.isDirectory(normalizeVaultPath(path)); }
  async isFile(path: string): Promise<boolean> { return this.root.isFile(normalizeVaultPath(path)); }

  /**
   * 列出后端内的全部文件（若后端支持文件树）。
   * 供布局修复使用：Obsidian 只有 getFiles()（文件清单，不含目录），
   * 目录驱动遍历不可靠，所以修复必须按文件路径处理。
   */
  listAllFiles(): string[] {
    const root = this.root as unknown as { listAllFilesSync?: () => string[] };
    return typeof root.listAllFilesSync === "function" ? root.listAllFilesSync() : [];
  }

  /**
   * **原位读**：按给定路径直接读后端，不做任何前缀重写。
   * 迁移 / 诊断要读 `.obsidian/plugins/<id>/cache/…`、`.state/cache/…`、嵌套层文件，
   * 这些路径必须保持原样读取（而 `host.resolve` 会把 store 路径重定向到状态根）。
   */
  async readRaw(path: string): Promise<string | null> {
    return this.root.read(normalizeVaultPath(path));
  }

  /** **原位写**：按给定路径直接写后端，绝不做前缀重写（备份 / 恢复目标以外用） */
  async writeRaw(path: string, data: string): Promise<boolean> {
    const p = normalizeVaultPath(path);
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
}

/**
 * §六 统一接口：PortableJsonStore<T>
 *
 * 业务存储类（ActivityStore 等）在重构后都把「文件」概念收敛到这里；
 * 迁移期为了不破坏既有同步调用点，另见 fsPortable.ts 的同步外观（同一语义）。
 */
export interface PortableJsonStoreLike<T> {
  load(): Promise<T | null>;
  save(value: T): Promise<SaveOutcome>;
  remove(): Promise<boolean>;
  exists(): Promise<boolean>;
  list(): Promise<string[]>;
}

export class PortableJsonStore<T> implements PortableJsonStoreLike<T> {
  constructor(private storage: PortableStorage, private path: string, private opts?: { nativeAtomic?: boolean }) {}

  get filePath(): string { return normalizeVaultPath(this.path); }

  async load(): Promise<T | null> {
    try {
      return await this.storage.readJson<T>(this.path);
    } catch {
      return null; // 损坏 → 由 corruption 策略处理，不在这里吞掉
    }
  }

  async save(value: T): Promise<SaveOutcome> { return this.storage.writeJson(this.path, value, this.opts); }
  async remove(): Promise<boolean> { return this.storage.remove(this.path); }
  async exists(): Promise<boolean> { return this.storage.exists(this.path); }
  /** 「list」= 同目录同后缀的兄弟文件（用于多分片存储与诊断） */
  async list(): Promise<string[]> {
    const dir = dirnameVaultPath(this.path);
    const items = await this.storage.list(dir);
    const base = this.filePath;
    return items.map((i) => joinVaultPath(dir, i.name)).filter((p) => p !== base);
  }
}
