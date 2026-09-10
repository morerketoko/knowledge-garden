/**
 * Phase 24 §六 / §九 / §十：便携存储宿主（routing）。
 *
 * 职责边界：
 * - `PortableStorageHost` 决定「某个相对路径落在哪个后端」，业务代码只拿相对路径。
 * - 后端两种：
 *     1. **vault 后端**（默认）：`Knowledge Garden/.state/...` 与
 *        `Knowledge Garden/Prompts|Projects/...`（Obsidian Vault API，移动端可用）
 *     2. **plugin-data 后端**（兜底）：Obsidian Plugin Data API（Vault 不可写时，§九）
 *
 * 为什么统一收敛到 vault 内的 `.state/`，而不是继续写
 * `.obsidian/plugins/knowledge-garden/cache/`（§七 / §十）：
 * - `.obsidian` 在 Obsidian 移动端被 Vault API 排除，读写都不可靠；
 * - `manifest.dir` 在移动端拿不到绝对路径（没有 Node path/fs）。
 *   把插件私有状态放进 Vault 内的一个隐藏目录，是唯一在所有平台都成立的方案。
 */
import { PortableStorage } from "../storage";
import type { StorageRoot } from "./root";
import { dirnameVaultPath, isReservedStoragePath, isUnsafeRelativePath, joinVaultPath, normalizeVaultPath } from "./paths";

/** Vault 内插件私有状态根目录（§十：Knowledge Garden/.state） */
export const STATE_DIR_NAME = ".state";

export interface PortableHostOptions {
  /** Vault 内的插件状态根目录（默认 `Knowledge Garden/.state`） */
  stateRoot: string;
  /** Plugin Data 后端（Vault 不可写 / 只读仓库时的兜底） */
  pluginData: StorageRoot;
  /** Vault 后端；为 null 时全部走 pluginData */
  vault: StorageRoot | null;
  /** 是否初始启用 Vault 后端（之后可用 setVaultEnabled 按探测结果修正） */
  useVault: boolean;
  /** 诊断：后端选择原因 */
  reason: string;
  /**
   * 其它 vault 挂载前缀（用户可见资产）。
   * 这些目录与 stateRoot 平级，例如 Prompt Library 的 Markdown、Workbench 项目 README。
   */
  vaultMounts?: string[];
  /**
   * 插件数据后端的前缀剥离表：命中前缀的路径在 plugin-data 里存为去掉前缀的相对键。
   * 避免兜底后端里出现 `<vault 名>/.state/cache/...` 这种又长又重复的键。
   */
  stripPrefixes?: string[];
}

/**
 * 便携存储宿主：路径 → 后端。
 *
 * 路由规则（确定性，便于测试）：
 * - 路径先过 `resolve()` 归一化（拒绝绝对路径 / `..`，§十七）。
 * - 命中 `stateRoot` 或 `vaultMounts` 前缀 → vault 后端（未启用则 plugin-data）。
 * - 其余相对路径 → plugin-data（插件私有、不进 Vault 索引，也不污染用户 Vault）。
 */
export class PortableStorageHost {
  private vaultStorage: PortableStorage | null;
  private dataStorage: PortableStorage;
  private reasonText: string;
  readonly stateRoot: string;
  readonly vaultMounts: string[];
  private stripPrefixes: string[];
  /** 历史插件目录（旧 manifest.dir / getBasePath）；用于把旧路径映射到新根 */
  baseDir = "";

  constructor(private opts: PortableHostOptions) {
    this.stateRoot = normalizeVaultPath(opts.stateRoot);
    this.vaultMounts = (opts.vaultMounts ?? []).map((m) => normalizeVaultPath(m)).filter(Boolean);
    this.stripPrefixes = (opts.stripPrefixes ?? []).map((p) => normalizeVaultPath(p)).filter(Boolean);
    this.dataStorage = new PortableStorage(opts.pluginData);
    this.vaultStorage = opts.useVault && opts.vault ? new PortableStorage(opts.vault) : null;
    this.reasonText = opts.reason;
    this.baseDir = this.stateRoot;
  }

  /* ---------------- 后端状态 ---------------- */

  get backendKind(): StorageRoot["kind"] {
    return (this.vaultStorage ?? this.dataStorage).backend;
  }
  get vaultEnabled(): boolean { return this.vaultStorage !== null; }
  get reason(): string { return this.reasonText; }
  /** 诊断位置的展示名（永不返回绝对路径） */
  get location(): string {
    return this.vaultStorage ? this.stateRoot + "/" : "plugin-data://";
  }

  /** 能力探测后修正后端选择（只读仓库 / iCloud 只读 → 降级到 plugin-data） */
  setVaultEnabled(enabled: boolean, reason?: string): void {
    if (enabled === this.vaultEnabled) { if (reason) this.reasonText = reason; return; }
    this.vaultStorage = enabled && this.opts.vault ? new PortableStorage(this.opts.vault) : null;
    if (reason) this.reasonText = reason;
  }

  /** 该相对路径对应的存储 */
  backendFor(path: string): PortableStorage {
    const p = normalizeVaultPath(path);
    if (!p) return this.dataStorage;
    if (!this.vaultStorage) return this.dataStorage;
    return this.isVaultPath(p) ? this.vaultStorage : this.dataStorage;
  }

  private isVaultPath(p: string): boolean {
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
  resolve(path: string): string {
    const raw = String(path ?? "").replace(/\\/g, "/");
    if (raw === "" || raw === this.baseDir) return this.stateRoot;
    if (this.baseDir && raw.startsWith(this.baseDir + "/")) {
      const rel = raw.slice(this.baseDir.length + 1);
      return joinVaultPath(this.stateRoot, rel);
    }
    // 已经是 .state/ 或某个 vault 挂载前缀 → 原样（避免二次加前缀）
    if (raw === this.stateRoot || raw.startsWith(this.stateRoot + "/")) return normalizeVaultPath(raw);
    for (const m of this.vaultMounts) {
      if (raw === m || raw.startsWith(m + "/")) return normalizeVaultPath(raw);
    }
    return normalizeVaultPath(raw);
  }

  /** plugin-data 后端的存储键（剥离冗长前缀，保持 data.json 可读） */
  dataKey(target: string): string {
    for (const pre of this.stripPrefixes) {
      if (target === pre) return "";
      if (target.startsWith(pre + "/")) return target.slice(pre.length + 1);
    }
    return target;
  }

  /* ---------------- 读写 ---------------- */

  async write(path: string, data: string, opts?: { nativeAtomic?: boolean }) {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    const key = backend === this.dataStorage ? this.dataKey(target) : target;
    return backend.writeText(key, data, opts);
  }

  async read(path: string): Promise<string | null> {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.readText(backend === this.dataStorage ? this.dataKey(target) : target);
  }

  async exists(path: string): Promise<boolean> {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.exists(backend === this.dataStorage ? this.dataKey(target) : target);
  }

  async remove(path: string): Promise<boolean> {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.remove(backend === this.dataStorage ? this.dataKey(target) : target);
  }

  async rename(from: string, to: string): Promise<boolean> {
    const f = this.resolve(from);
    const t = this.resolve(to);
    const bf = this.backendFor(f);
    const bt = this.backendFor(t);
    if (bf !== bt) {
      // 跨后端：读 → 写 → 删（迁移用，§十一）
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

  async list(path: string) {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.list(backend === this.dataStorage ? this.dataKey(target) : target);
  }

  async isDirectory(path: string): Promise<boolean> {
    const target = this.resolve(path);
    const backend = this.backendFor(target);
    return backend.isDirectory(backend === this.dataStorage ? this.dataKey(target) : target);
  }

  /* ---------------- 启动 ---------------- */

  /** 初始化两个后端的读缓存（同步镜像的遍历由 fsPortable.initSyncMirror 负责） */
  async init(): Promise<void> {
    if (this.vaultStorage) await this.vaultStorage.init();
    await this.dataStorage.init();
  }

  /**
   * 后端能力探测（§七 / §九 / §一百三十七）：
   * 通过**真实写入一个探针文件**判断 Vault 是否可写，而不是猜平台 ——
   * 只读仓库、iCloud 只读、沙盒权限不足都能被正确探测出来。
   */
  async probeWritable(): Promise<boolean> {
    const probe = joinVaultPath(this.stateRoot, ".kg-write-probe");
    // 先确保后端已启用（探测需要真实后端）
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
      if (!wasEnabled) this.vaultStorage = null; // 探测失败不留下半启用状态；成功由调用方 setVaultEnabled(true)
    }
  }

  /** 校验任意相对路径是否安全（供 NoteIndex / 迁移使用，§十七） */
  static isSafe(path: string): boolean {
    const raw = String(path ?? "").replace(/\\/g, "/");
    if (!raw) return false;
    if (isUnsafeRelativePath(raw)) return false;
    const n = normalizeVaultPath(raw);
    if (!n.length) return false;
    return !isReservedStoragePath(n);
  }

  /** 某个存储路径的父目录（创建文件前用） */
  dirOf(path: string): string {
    return dirnameVaultPath(this.resolve(path));
  }

  /* ---------------- 布局修复 ---------------- */

  /** 需要巡检修复的目录名（状态目录 / 资产目录） */
  private static readonly REPAIR_DIRS = ["cache", "prompts", "projects", ".corrupt"];
  /** 布局修复轨迹（诊断用） */
  repairTrace: string[] = [];

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
  async repairDuplicatedLayout(): Promise<number> {
    this.repairTrace = [];
    if (!this.vaultStorage || !this.baseDir) return 0;
    const v = this.vaultStorage;
    const nestedBase = joinVaultPath(this.stateRoot, this.baseDir);
    const files = this.listAllFiles();
    if (!files.length) return 0;    let moved = 0;
    for (const rel of files) {
      if (!rel.startsWith(nestedBase + "/")) continue;
      const to = this.repairTargetFor(rel);
      if (!to) continue;
      if (await v.exists(to)) { this.repairTrace.push("skip(dst存在) " + to); continue; }
      const raw = await v.readText(rel);
      if (raw === null) { this.repairTrace.push("skip(读不到) " + rel); continue; }
      const out = await v.writeText(to, raw, { nativeAtomic: true });
      this.repairTrace.push("move " + rel + " → " + to + " ok=" + out.ok);
      if (out.ok) { await v.remove(rel); moved++; }
    }
    if (moved === 0) this.repairTrace.push("未发现需要修复的嵌套状态（正常）");
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
  private repairTargetFor(rel: string): string | null {
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
  private listAllFiles(): string[] {
    return this.vaultStorage ? this.vaultStorage.listAllFiles() : [];
  }
}
