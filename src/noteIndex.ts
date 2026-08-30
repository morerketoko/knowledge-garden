import { App, TFile, TFolder, normalizePath, Notice } from "obsidian";
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

/** 增量索引：首次全量扫描，之后跟随 vault 事件增量更新，并持久化缓存 */
export class NoteIndex {
  private notes = new Map<string, NoteMetadata>();
  private cacheFile: string;
  private loaded = false;

  constructor(private app: App, pluginDir: string) {
    this.cacheFile = path.join(pluginDir, "cache", "index.json");
  }

  get ready(): boolean { return this.loaded; }

  async load(): Promise<void> {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, "utf8");
        const entries = JSON.parse(raw) as CacheEntry[];
        for (const e of entries) {
          const file = this.app.vault.getAbstractFileByPath(normalizePath(e.path));
          if (!(file instanceof TFile)) continue;
          if (file.stat.size === e.size && file.stat.mtime === e.mtime) {
            this.notes.set(e.path, { ...e, backlinks: [] } as NoteMetadata);
          } else {
            await this.readFile(file);
          }
        }
      }
    } catch {
      // 缓存缺失/损坏 → 隔离损坏文件（保留可恢复副本）后直接全量扫描（index 可从 Vault 重建）
      isolateCorruptFile(this.cacheFile);
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path.startsWith(".obsidian/")) continue;
      if (!this.notes.has(file.path)) await this.readFile(file);
    }
    this.rebuildBacklinks();
    this.loaded = true;
    await this.saveCache();
  }

  private async readFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const fm = parseFrontmatter(content);
      const body = content.startsWith("---")
        ? (content.indexOf("\n---", 3) >= 0 ? content.slice(content.indexOf("\n---", 3) + 4) : content)
        : content;
      const wordCount = body.trim() ? body.trim().split(/\s+/).filter(Boolean).length : 0;
      this.notes.set(file.path, {
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
      });
    } catch {
      // 单文件读取失败不阻断索引
    }
  }

  private rebuildBacklinks(): void {
    const inverted = new Map<string, string[]>();
    for (const n of this.notes.values()) {
      for (const link of n.links) {
        if (!inverted.has(link)) inverted.set(link, []);
        inverted.get(link)!.push(n.path);
      }
    }
    for (const n of this.notes.values()) {
      const hits = new Set<string>();
      for (const name of [baseOf(n.path), n.path]) {
        for (const src of inverted.get(name) ?? []) hits.add(src);
      }
      n.backlinks = Array.from(hits).slice(0, 50);
    }
  }

  /** 更新单个文件（modify/create 事件） */
  async updateFile(file: TFile): Promise<void> {
    if (!this.loaded || file.path.startsWith(".obsidian/")) return;
    const wasNew = !this.notes.has(file.path);
    await this.readFile(file);
    this.rebuildBacklinks();
    if (wasNew) await this.saveCache();
  }

  /** 删除（事件） */
  removeFile(filePath: string): void {
    if (!this.loaded) return;
    this.notes.delete(filePath);
    for (const n of this.notes.values()) {
      n.backlinks = n.backlinks.filter((b) => b !== filePath);
    }
    void this.saveCache();
  }

  async rescanAll(): Promise<void> {
    this.notes.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path.startsWith(".obsidian/")) continue;
      await this.readFile(file);
    }
    this.rebuildBacklinks();
    this.loaded = true;
    await this.saveCache();
  }

  async saveCache(): Promise<void> {
    try {
      const dir = path.dirname(this.cacheFile);
      fs.mkdirSync(dir, { recursive: true });
      const entries: CacheEntry[] = [];
      for (const n of this.notes.values()) {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(n.path));
        if (!(file instanceof TFile)) continue;
        entries.push({
          path: n.path, title: n.title, folder: n.folder,
          tags: n.tags, links: n.links,
          created: n.created, modified: n.modified, wordCount: n.wordCount,
          size: file.stat.size, mtime: file.stat.mtime,
        });
      }
      atomicWriteJson(this.cacheFile, entries);
    } catch (err) {
      console.error("kg: 索引缓存写入失败", err);
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