import { App, TFile, TFolder, normalizePath } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import type { KnowledgeArea } from "./types";

/** 本地笔记元数据（不存正文，正文只在 AI 候选时按需读取） */
export interface NoteMetadata {
  path: string;
  title: string;
  folder: string;      // 顶层文件夹或 ""（根目录）
  tags: string[];
  links: string[];     // 归一化链接目标（去 .md）
  backlinks: string[]; // 计算后回填
  created: number;
  modified: number;
  size: number;
  wordCount: number;
}

interface CacheEntry {
  path: string; title: string; folder: string;
  tags: string[]; links: string[];
  created: number; modified: number; wordCount: number;
  size: number; mtime: number;
}

interface CandidateOptions {
  limit: number;
  minDays: number;          // 至少考虑的最小修改时间窗口（天）
  area?: KnowledgeArea | null;
  excludePaths?: Set<string>;
}

/** Phase 25：一次索引加载的可观测报告（Diagnostics 展示；不吞失败） */
export interface IndexLoadReport {
  totalFiles: number;
  cacheHits: number;
  rereadFiles: number;
  newFiles: number;
  skippedFiles: number;
  failedFiles: number;
  completed: boolean;
  durationMs: number;
}

export interface IndexLoadProgress {
  processed: number;
  total: number;
  cacheHits: number;
  rereadFiles: number;
  newFiles: number;
  failedFiles: number;
}

/** Phase 25：索引加载期间发生的 Vault 事件（延迟合并处理，绝不丢用户改动） */
export type PendingIndexEventType = "create" | "modify" | "delete" | "rename";

export interface PendingIndexEvent {
  path: string;
  type: PendingIndexEventType;
  /** rename 时的旧路径 */
  oldPath?: string;
  at: number;
}

/** 每批处理的文件数（32~64） */
export const INDEX_BATCH_SIZE = 48;
/** 每批内最大并发读取（8~16，绝不 Promise.all 全库） */
export const INDEX_READ_CONCURRENCY = 8;

const BACKLINK_RE = /\[\[([^\[\]#|]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

function stripMd(p: string): string {
  return p.replace(/\.md$/i, "");
}
function baseOf(p: string): string {
  const b = p.replace(/\\/g, "/").split("/").pop() ?? p;
  return stripMd(b);
}
function folderOf(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts.length > 1 ? parts[0] : "";
}

/** 让出主线程（Obsidian 环境下 setTimeout(0) 足够；不依赖 Node Worker） */
export function yieldToMainThread(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof setTimeout === "function") setTimeout(resolve, 0);
    else resolve();
  });
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = content.slice(3, end);
  const out: Record<string, unknown> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let v: string = m[2].trim();
    if (v === "true") out[m[1]] = true;
    else if (v === "false") out[m[1]] = false;
    else if (/^-?\d+$/.test(v)) out[m[1]] = Number(v);
    else if (v.startsWith("[") && v.endsWith("]"))
      out[m[1]] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    else out[m[1]] = v;
  }
  return out;
}

function tagsFrom(fm: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();
  const fmTags = fm["tags"];
  if (typeof fmTags === "string" && fmTags) {
    fmTags.split(/[\s,]+/).filter(Boolean).forEach((t) => tags.add(t.replace(/^#/, "")));
  } else if (Array.isArray(fmTags)) {
    fmTags.filter((t): t is string => typeof t === "string" && !!t)
      .forEach((t) => tags.add(t.replace(/^#/, "")));
  }
  const re = /#([\p{L}\p{N}_\-/]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body.replace(/^```[\s\S]*?^```/gm, "")))) {
    tags.add(m[1]);
  }
  return Array.from(tags).slice(0, 50);
}

function linksFrom(body: string): string[] {
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = BACKLINK_RE.exec(body))) {
    const t = m[1].trim();
    if (t) links.add(stripMd(t));
  }
  return Array.from(links).slice(0, 100);
}

function titleFrom(fm: Record<string, unknown>, filePath: string): string {
  if (typeof fm["title"] === "string" && fm["title"]) return fm["title"];
  const aliases = fm["aliases"];
  if (Array.isArray(aliases) && typeof aliases[0] === "string" && aliases[0]) return aliases[0];
  return baseOf(filePath);
}

function emptyReport(): IndexLoadReport {
  return { totalFiles: 0, cacheHits: 0, rereadFiles: 0, newFiles: 0, skippedFiles: 0, failedFiles: 0, completed: false, durationMs: 0 };
}

/**
 * 增量索引（Phase 25 起改为分批异步加载）。
 *
 * 关键保证：
 * - 缓存优先：index.json 里 path+size+mtime 全匹配的文件不重新读取正文。
 * - 单次 vault.getMarkdownFiles() 拿候选列表（不再逐个 getAbstractFileByPath）。
 * - 每批 INDEX_BATCH_SIZE 篇，批内并发 ≤ INDEX_READ_CONCURRENCY，批间 yield 主线程。
 * - 原子替换：先构建 nextNotes，完整扫描成功后才替换 this.notes（绝不让半成品冒充完整索引）。
 * - 加载期间的 create/modify/delete/rename 记入 pendingIndexEvents，加载完成后合并处理。
 * - 单篇失败只计数不终止；failedFiles 会阻止破坏性 prune（见 isHealthy）。
 */
export class NoteIndex {
  /** Retrieval v3：文件新增/修改/删除计数器（参与 Ask cache key，文件变化 → cache miss） */
  revision = 0;
  private notes = new Map<string, NoteMetadata>();
  private cacheFile: string;
  private loaded = false;
  private inflight: Promise<IndexLoadReport> | null = null;
  private lastReport: IndexLoadReport = emptyReport();
  private pending = new Map<string, PendingIndexEvent>();
  private lastPendingAffected: string[] = [];
  private saveTimer: number | null = null;

  constructor(private app: App, pluginDir: string) {
    this.cacheFile = path.join(pluginDir, "cache", "index.json");
  }

  get ready(): boolean { return this.loaded; }
  get report(): IndexLoadReport { return { ...this.lastReport }; }
  get pendingCount(): number { return this.pending.size; }

  /**
   * 加载索引（并发调用复用同一个 Promise）。
   * 失败不伪装成功：completed=false 且抛出异常，已加载数据保持原状（下次可重试）。
   */
  async load(onProgress?: (p: IndexLoadProgress) => void): Promise<IndexLoadReport> {
    if (this.loaded) return this.report;
    if (this.inflight) return this.inflight;
    this.inflight = this.loadInternal(onProgress).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async loadInternal(onProgress?: (p: IndexLoadProgress) => void): Promise<IndexLoadReport> {
    const startedAt = Date.now();
    const report = emptyReport();
    let cacheDirty = false;
    const next = new Map<string, NoteMetadata>();

    // 1) 先读缓存（缺失/损坏 → 隔离坏文件后全量重建，绝不静默清空用户数据）
    let cacheEntries: CacheEntry[] = [];
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) cacheEntries = parsed.filter((e): e is CacheEntry => !!e && typeof (e as CacheEntry).path === "string");
        else throw new Error("index cache 结构异常");
      }
    } catch (err) {
      console.error("[KnowledgeGarden][Lazy] noteIndex cache unreadable, isolating", err);
      isolateCorruptFile(this.cacheFile);
      cacheEntries = [];
      cacheDirty = true;
    }
    const cacheByPath = new Map(cacheEntries.map((e) => [e.path, e]));

    // 2) 一次 getMarkdownFiles() 拿候选（过滤 .obsidian/）
    const allFiles = this.app.vault.getMarkdownFiles();
    const files = allFiles.filter((f) => !f.path.startsWith(".obsidian/"));
    report.totalFiles = files.length;

    const livePaths = new Set(files.map((f) => f.path));
    for (const e of cacheEntries) {
      if (!livePaths.has(e.path)) { report.skippedFiles++; cacheDirty = true; }
    }

    // 3) 逐文件对比缓存（只 stat，不读正文）
    const toRead: { file: TFile; isNew: boolean }[] = [];
    for (const file of files) {
      const e = cacheByPath.get(file.path);
      if (!e) { toRead.push({ file, isNew: true }); continue; }
      if (e.size === file.stat.size && e.mtime === file.stat.mtime) {
        next.set(file.path, { ...e, backlinks: [] } as NoteMetadata);
        report.cacheHits++;
      } else {
        toRead.push({ file, isNew: false });
      }
    }

    // 4) 分批读取（批内有限并发，批间 yield）
    let processed = report.cacheHits;
    for (let i = 0; i < toRead.length; i += INDEX_BATCH_SIZE) {
      const batch = toRead.slice(i, i + INDEX_BATCH_SIZE);
      await this.readBatch(batch, next, report);
      processed = Math.min(report.totalFiles, processed + batch.length);
      onProgress?.({
        processed, total: report.totalFiles,
        cacheHits: report.cacheHits, rereadFiles: report.rereadFiles,
        newFiles: report.newFiles, failedFiles: report.failedFiles,
      });
      // 每批结束主动让出事件循环（不阻塞 Obsidian 交互）
      await yieldToMainThread();
    }

    // 5) 全部成功扫描后才替换（原子一致性）
    this.rebuildBacklinksOn(next);
    this.notes = next;
    this.loaded = true;
    this.revision++;
    report.completed = report.failedFiles === 0;
    report.durationMs = Date.now() - startedAt;
    this.lastReport = { ...report };

    // 6) 缓存无变化不写回；有新读/失败/删除才修复写回
    if (cacheDirty || report.rereadFiles > 0 || report.newFiles > 0 || report.failedFiles > 0) {
      await this.saveCache();
    }

    // 7) 处理加载期间积压的 Vault 事件（用户刚改的文件不会丢）
    await this.applyPendingEvents();

    return this.report;
  }

  /** 批内有限并发：每批最多 INDEX_READ_CONCURRENCY 个 cachedRead 同时进行 */
  private async readBatch(items: { file: TFile; isNew: boolean }[], target: Map<string, NoteMetadata>, report: IndexLoadReport): Promise<void> {
    const queue = items.slice();
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(INDEX_READ_CONCURRENCY, queue.length);
    for (let w = 0; w < workerCount; w++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const meta = await this.buildMetadata(item.file);
          if (!meta) { report.failedFiles++; continue; }
          target.set(meta.path, meta);
          if (item.isNew) report.newFiles++; else report.rereadFiles++;
        }
      })());
    }
    await Promise.all(workers);
  }

  /** 读取单个文件 → NoteMetadata（失败返回 null，由调用方计数，不静默） */
  private async buildMetadata(file: TFile): Promise<NoteMetadata | null> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const fm = parseFrontmatter(content);
      const body = content.startsWith("---")
        ? (content.indexOf("\n---", 3) >= 0 ? content.slice(content.indexOf("\n---", 3) + 4) : content)
        : content;
      const wordCount = body.trim() ? body.trim().split(/\s+/).filter(Boolean).length : 0;
      return {
        path: file.path,
        title: titleFrom(fm, file.path),
        folder: folderOf(file.path),
        tags: tagsFrom(fm, body),
        links: linksFrom(body),
        backlinks: [],
        created: file.stat.ctime || file.stat.mtime || Date.now(),
        modified: file.stat.mtime || Date.now(),
        size: file.stat.size || 0,
        wordCount,
      };
    } catch (err) {
      console.warn("[KnowledgeGarden][Lazy] noteIndex read failed path=" + file.path, err);
      return null;
    }
  }

  private rebuildBacklinksOn(map: Map<string, NoteMetadata>): void {
    const inverted = new Map<string, string[]>();
    for (const n of map.values()) {
      for (const link of n.links) {
        if (!inverted.has(link)) inverted.set(link, []);
        inverted.get(link)!.push(n.path);
      }
    }
    for (const n of map.values()) {
      const hits = new Set<string>();
      for (const name of [baseOf(n.path), n.path]) {
        for (const src of inverted.get(name) ?? []) hits.add(src);
      }
      n.backlinks = Array.from(hits).slice(0, 50);
    }
  }

  private rebuildBacklinks(): void {
    this.rebuildBacklinksOn(this.notes);
  }

  /* ---------------- Phase 25：加载期间的 Vault 事件 ---------------- */

  /** 记录最新事件（同一路径多次变化只保留最终状态，避免重复读取） */
  private recordPending(ev: PendingIndexEvent): void {
    const prev = this.pending.get(ev.path);
    if (prev && prev.type === "delete" && (ev.type === "create" || ev.type === "modify")) {
      // 删除后又出现 → 最终状态是“存在”
      this.pending.set(ev.path, { path: ev.path, type: "create", at: ev.at });
      return;
    }
    if (ev.type === "delete") {
      this.pending.set(ev.path, { path: ev.path, type: "delete", at: ev.at });
      return;
    }
    if (ev.type === "rename") {
      this.pending.set(ev.path, { path: ev.path, type: "rename", oldPath: ev.oldPath, at: ev.at });
      return;
    }
    // create/modify 合并：已存在 create 保留 create
    const type: PendingIndexEventType = prev?.type === "create" ? "create" : ev.type;
    this.pending.set(ev.path, { path: ev.path, type, at: ev.at });
  }

  /** 加载完成后按最终状态处理积压事件；返回受影响路径（供 SearchIndex 增量同步） */
  async applyPendingEvents(): Promise<string[]> {
    if (!this.loaded || this.pending.size === 0) {
      this.lastPendingAffected = [];
      return [];
    }
    const events = Array.from(this.pending.values()).sort((a, b) => a.at - b.at);
    this.pending.clear();
    const affected = new Set<string>();

    for (const ev of events) {
      try {
        if (ev.type === "delete") {
          this.notes.delete(ev.path);
          affected.add(ev.path);
          for (const n of this.notes.values()) n.backlinks = n.backlinks.filter((b) => b !== ev.path);
          continue;
        }
        if (ev.type === "rename") {
          const oldPath = ev.oldPath ?? "";
          if (oldPath) {
            const oldMeta = this.notes.get(oldPath);
            this.notes.delete(oldPath);
            affected.add(oldPath);
            const file = this.app.vault.getAbstractFileByPath(normalizePath(ev.path));
            if (file instanceof TFile) {
              const meta = await this.buildMetadata(file);
              if (meta) this.notes.set(meta.path, meta);
            } else if (oldMeta) {
              this.notes.set(ev.path, { ...oldMeta, path: ev.path });
            }
            affected.add(ev.path);
          }
          continue;
        }
        const file = this.app.vault.getAbstractFileByPath(normalizePath(ev.path));
        if (file instanceof TFile) {
          const meta = await this.buildMetadata(file);
          if (meta) { this.notes.set(meta.path, meta); affected.add(meta.path); }
        } else {
          // 已经消失（合并后又被删除）
          this.notes.delete(ev.path);
          affected.add(ev.path);
        }
      } catch (err) {
        console.error("[KnowledgeGarden][Lazy] noteIndex applyPending failed path=" + ev.path, err);
      }
    }

    this.rebuildBacklinks();
    this.revision++;
    this.lastPendingAffected = Array.from(affected);
    if (affected.size > 0) await this.saveCache();
    return this.lastPendingAffected;
  }

  /** 取走最近一次 applyPendingEvents 的受影响路径 */
  takePendingAffected(): string[] {
    const out = this.lastPendingAffected;
    this.lastPendingAffected = [];
    return out;
  }

  /** 更新单个文件（modify/create 事件）：索引未就绪时只记录事件，不做破坏性动作 */
  async updateFile(file: TFile): Promise<void> {
    if (file.path.startsWith(".obsidian/")) return;
    if (!this.loaded) {
      this.recordPending({ path: file.path, type: "modify", at: Date.now() });
      return;
    }
    const wasNew = !this.notes.has(file.path);
    const meta = await this.buildMetadata(file);
    if (!meta) return;    // 单文件失败：保留旧 metadata，不删除
    this.notes.set(meta.path, meta);
    this.rebuildBacklinks();
    this.revision++;
    if (wasNew) this.scheduleSaveCache();
  }

  /** 删除（事件）：索引未就绪时只记录，绝不触发全库 prune */
  removeFile(filePath: string): void {
    if (!this.loaded) {
      this.recordPending({ path: filePath, type: "delete", at: Date.now() });
      return;
    }
    if (!this.notes.has(filePath)) return;
    this.notes.delete(filePath);
    this.revision++;
    for (const n of this.notes.values()) {
      n.backlinks = n.backlinks.filter((b) => b !== filePath);
    }
    this.scheduleSaveCache();
  }

  /** 重命名（事件）：索引未就绪时记录 pending，就绪时先移除旧路径再读新文件 */
  async renameFile(oldPath: string, file: TFile): Promise<void> {
    if (!this.loaded) {
      this.recordPending({ path: file.path, type: "rename", oldPath, at: Date.now() });
      return;
    }
    this.notes.delete(oldPath);
    for (const n of this.notes.values()) n.backlinks = n.backlinks.filter((b) => b !== oldPath);
    const meta = await this.buildMetadata(file);
    if (meta) this.notes.set(meta.path, meta);
    this.rebuildBacklinks();
    this.revision++;
    this.scheduleSaveCache();
  }

  /** 全量重建（手动命令）：同样分批 + yield，绝不一次性同步读全库 */
  async rescanAll(onProgress?: (p: IndexLoadProgress) => void): Promise<IndexLoadReport> {
    this.loaded = false;
    this.notes.clear();
    this.lastReport = emptyReport();
    try {
      if (fs.existsSync(this.cacheFile)) fs.rmSync(this.cacheFile, { force: true });
    } catch { /* 缓存删不掉也要继续重建 */ }
    return this.load(onProgress);
  }

  /* ---------------- 健康判定（破坏性 prune 的前置条件） ---------------- */

  /**
   * 索引是否健康到可以执行破坏性清理：
   * - 已加载且本次加载 completed
   * - 失败文件数为 0
   * - 索引数量 ≥ max(1, floor(vaultMarkdownCount * 0.95))
   */
  isHealthy(vaultMarkdownCount: number): boolean {
    if (!this.loaded) return false;
    if (this.lastReport.completed !== true) return false;
    if (this.lastReport.failedFiles > 0) return false;
    const indexed = this.notes.size;
    const floor = Math.max(1, Math.floor(vaultMarkdownCount * 0.95));
    return indexed >= floor;
  }

  /** 不健康的原因（Diagnostics 展示；健康 → null） */
  unhealthyReason(vaultMarkdownCount: number): string | null {
    if (!this.loaded) return "索引尚未加载完成";
    if (this.lastReport.completed !== true) return "上次索引加载未完整完成（failedFiles=" + this.lastReport.failedFiles + "）";
    if (this.lastReport.failedFiles > 0) return "有 " + this.lastReport.failedFiles + " 篇读取失败";
    const indexed = this.notes.size;
    const floor = Math.max(1, Math.floor(vaultMarkdownCount * 0.95));
    if (indexed < floor) return "索引数量不足（" + indexed + " / 至少 " + floor + "）";
    return null;
  }

  /* ---------------- 缓存写回 ---------------- */

  /** 事件驱动的写回做 2s 防抖，避免连续改文件时反复序列化 4600 条缓存 */
  private scheduleSaveCache(): void {
    if (this.saveTimer !== null) return;
    const w = globalThis as unknown as { setTimeout?: (cb: () => void, ms: number) => number };
    if (typeof w.setTimeout !== "function") { void this.saveCache(); return; }
    this.saveTimer = w.setTimeout(() => {
      this.saveTimer = null;
      void this.saveCache();
    }, 2000);
  }

  async saveCache(): Promise<void> {
    try {
      const dir = path.dirname(this.cacheFile);
      fs.mkdirSync(dir, { recursive: true });
      const entries: CacheEntry[] = [];
      // 一次 getMarkdownFiles() 建 stat 表（避免每条 getAbstractFileByPath）
      const stats = new Map<string, TFile>();
      for (const f of this.app.vault.getMarkdownFiles()) stats.set(f.path, f);
      for (const n of this.notes.values()) {
        const file = stats.get(n.path);
        if (!file) continue;
        entries.push({
          path: n.path, title: n.title, folder: n.folder,
          tags: n.tags, links: n.links,
          created: n.created, modified: n.modified, wordCount: n.wordCount,
          size: file.stat.size, mtime: file.stat.mtime,
        });
      }
      atomicWriteJson(this.cacheFile, entries);
    } catch (err) {
      console.error("[KnowledgeGarden] 索引缓存写入失败", err);
    }
  }

  total(): number { return this.notes.size; }
  all(): NoteMetadata[] { return Array.from(this.notes.values()); }
  get(path: string): NoteMetadata | undefined { return this.notes.get(path); }

  notesInArea(area: KnowledgeArea): NoteMetadata[] {
    const prefix = normalizePath(area.folder).replace(/\/+$/, "");
    if (!prefix) return [];
    return this.all().filter((n) => n.path === prefix + ".md" || n.path.startsWith(prefix + "/"));
  }

  recent(limit: number): NoteMetadata[] {
    return this.all().sort((a, b) => b.modified - a.modified).slice(0, limit);
  }

  recentInArea(area: KnowledgeArea, limit: number): NoteMetadata[] {
    return this.notesInArea(area).sort((a, b) => b.modified - a.modified).slice(0, limit);
  }

  /** 被遗忘的知识：长期未修改的笔记（提醒复盘，纯本地信号） */
  stale(days: number, limit: number): NoteMetadata[] {
    const cutoff = Date.now() - days * 86400000;
    return this.all().filter((n) => n.modified < cutoff)
      .sort((a, b) => a.modified - b.modified).slice(0, limit);
  }

  areaStats(area: KnowledgeArea) {
    const notes = this.notesInArea(area);
    let lastModified = 0;
    let lastCreated = 0;
    for (const n of notes) {
      if (n.modified > lastModified) lastModified = n.modified;
      if (n.created > lastCreated) lastCreated = n.created;
    }
    return { count: notes.length, lastModified, lastCreated };
  }

  /** 候选笔记打分：近期修改 + 连接度（in/out links）+ 被遗忘度。只用于喂给 AI。 */
  candidates(opts: CandidateOptions): NoteMetadata[] {
    const pool = opts.area ? this.notesInArea(opts.area) : this.all();
    const now = Date.now();
    const scored = pool
      .filter((n) => {
        if (opts.excludePaths && opts.excludePaths.has(n.path)) return false;
        const ageDays = (now - n.modified) / 86400000;
        return ageDays <= Math.max(opts.minDays, 7);
      })
      .map((n) => {
        const ageDays = Math.max((now - n.modified) / 86400000, 0.1);
        const recency = 1 / (1 + ageDays * 0.35);
        const linkCount = n.links.length;
        const backlinkCount = n.backlinks.length;
        const connected = Math.min(linkCount, 8) * 0.12 + Math.min(backlinkCount, 8) * 0.15;
        const sizeBonus = n.wordCount >= 200 && n.wordCount <= 3000 ? 0.15 : 0;
        return { note: n, score: recency * 0.6 + connected + sizeBonus };
      })
      .filter((s) => s.score > 0.25)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.limit).map((s) => s.note);
  }

  /** 生成带上下文摘要的候选（供 AI 只看到相关内容，不发送整个 Vault） */
  async candidatePayload(notes: NoteMetadata[], maxCharsPerNote = 1200): Promise<string[]> {
    const out: string[] = [];
    for (const n of notes) {
      try {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(n.path));
        if (!(file instanceof TFile)) continue;
        const content = await this.app.vault.cachedRead(file);
        const body = content.startsWith("---")
          ? (content.indexOf("\n---", 3) >= 0 ? content.slice(content.indexOf("\n---", 3) + 4) : content)
          : content;
        const snippet = body.replace(/```[\s\S]*?```/g, "（代码块省略）")
          .replace(/[#>*|`~\-=\n]/g, " ").replace(/\s+/g, " ").trim()
          .slice(0, maxCharsPerNote);
        if (!snippet) continue;
        out.push(`[path] ${n.path} | [title] ${n.title} | [tags] ${n.tags.join(",") || "无"} | [摘要] ${snippet}`);
      } catch {
        // 跳过读取失败的候选
      }
    }
    return out;
  }
}
