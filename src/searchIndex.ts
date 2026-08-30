/** Search Index：Query Explorer 的轻量本地搜索层（§十四/十五）。
 * - 内存索引：绝不持久化正文（§十五）；SearchDocument 只保存 token 计数与 metadata。
 * - 与 NoteIndex 完全独立（§一百一十五）：Search=内容层，NoteIndex=元数据层，共享 Vault 事件。
 * - 搜索绝不写 Activity / Review / Scheduler（§二十三/二十四/八十七~八十九）。
 * - tokenize / extract / buildDocument 为纯函数（无 Obsidian 依赖，便于 Node 测试）。
 */
import { normalizePath } from "obsidian";
import { App, TFile } from "obsidian";
import type { NoteMetadata } from "./noteIndex";

/* ---------- 纯函数：tokenize / 标题与别名提取 ---------- */

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const LATIN_RE = /[a-z0-9]+/g;
/** 中文高频虚字（§二十八：过短停用词/虚词过滤；第一版简单集合足够） */
const STOP_CHARS = new Set([
  "的", "了", "是", "在", "有", "和", "与", "及", "或", "之", "吗", "呢", "啊", "吧",
  "个", "种", "些", "也", "都", "很", "更", "最", "就", "而", "并", "且", "还", "又",
  "被", "把", "让", "给", "我", "你", "他", "她", "它", "们", "谁", "哪", "怎",
  "为", "因", "果", "如", "若", "虽", "然", "但", "于", "以", "中", "上", "下",
  "这", "那", "问", "什", "么", "好", "需", "要", "能", "会", "想", "可", "以",
  "从", "到", "对", "做", "用", "看", "说", "来", "去", "时", "后", "前", "间", "内", "外",
]);
/** 英文停用词（极短集合） */
const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "it", "this", "that"]);

/** 中文连续字符 unigram + 英文/数字 token（§二十八/二十九；不做完整 NLP） */
export function tokenizeText(text: string): string[] {
  const t = (text || "").toLowerCase();
  const out: string[] = [];
  for (const m of t.matchAll(LATIN_RE)) {
    const w = m[0];
    if (w.length >= 2 || /^[0-9]{1,3}$/.test(w) || w.length > 3) {
      if (!STOP_WORDS.has(w)) out.push(w);
    }
  }
  for (const ch of t) {
    if (CJK_RE.test(ch) && !STOP_CHARS.has(ch)) out.push(ch);
  }
  return out;
}

/** Markdown 标题行提取（§十二 headings 字段；防御上限 40） */
export function extractHeadings(md: string): string[] {
  const out: string[] = [];
  for (const line of (md || "").split("\n")) {
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1].trim());
    if (out.length >= 40) break;
  }
  return out;
}

/** frontmatter aliases 提取（§十二：NoteMetadata 无 aliases 时从 MetadataCache/正文获取；第一版解析正文 frontmatter） */
export function extractAliases(md: string): string[] {
  const out: string[] = [];
  if (!md || !md.startsWith("---")) return out;
  const end = md.indexOf("\n---", 3);
  const fm = end >= 0 ? md.slice(0, end) : "";
  if (!fm) return out;
  const inline = /^aliases:\s*\[(.*)\]$/m.exec(fm);
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
      .slice(0, 20);
  }
  const lines = fm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^aliases:\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*-\s+/.test(l)) out.push(l.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      else break;
      if (out.length >= 20) break;
    }
    break;
  }
  return out;
}

function stripFrontmatter(md: string): string {
  if (!md || !md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  return end >= 0 ? md.slice(end + 4) : md;
}

/* ---------- SearchDocument / SearchIndex ---------- */

export interface SearchDocument {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  headings: string[];
  aliases: string[];
  /** 正文 token → 词频（内存；§十五：不保存全文） */
  tokenMap: Map<string, number>;
  titleTokens: string[];
  bodyLength: number;
}

export interface SearchStatus {
  building: boolean;
  indexed: number;
  total: number;
}

/** 由 NoteMetadata + 正文构建 SearchDocument（纯函数，可测） */
export function buildDocument(meta: NoteMetadata, content: string): SearchDocument {
  const body = stripFrontmatter(content);
  const tokenMap = new Map<string, number>();
  for (const t of tokenizeText(body)) tokenMap.set(t, (tokenMap.get(t) ?? 0) + 1);
  return {
    path: meta.path,
    title: meta.title,
    folder: meta.folder,
    tags: meta.tags ?? [],
    headings: extractHeadings(body),
    aliases: extractAliases(content),
    tokenMap,
    titleTokens: tokenizeText(meta.title),
    bodyLength: body.length,
  };
}

/** 布尔检索匹配（§十一）：query 任一 token 命中 title/tags/headings/aliases/folder/正文 即算命中 */
export function matchesDoc(doc: SearchDocument, tokens: string[]): boolean {
  for (const t of tokens) {
    if (doc.titleTokens.includes(t)) return true;
    if (doc.headings.some((h) => h.includes(t))) return true;
    if (doc.tags.some((tag) => tag.includes(t) || tokenizeText(tag).includes(t))) return true;
    if (doc.aliases.some((a) => a.includes(t) || tokenizeText(a).includes(t))) return true;
    if (doc.folder.includes(t) || tokenizeText(doc.folder).includes(t)) return true;
    if (doc.tokenMap.has(t)) return true;
  }
  return false;
}

export class SearchIndex {
  private docs = new Map<string, SearchDocument>();
  private status: SearchStatus = { building: false, indexed: 0, total: 0 };
  private cancelFlag = false;

  constructor(private app: App, private getMeta: (path: string) => NoteMetadata | undefined) {}

  getStatus(): SearchStatus { return { ...this.status }; }
  count(): number { return this.docs.size; }
  get(path: string): SearchDocument | undefined { return this.docs.get(path); }
  ready(): boolean { return !this.status.building; }
  reset(): void {
    this.docs.clear();
    this.status.indexed = 0;
    this.status.total = 0;
  }

  /** 后台分批构建（§十六/十七）：决不  Promise.all(全量 cachedRead)；
   *  单篇失败跳过（§一百一十三），分批让出主线程不阻塞 Obsidian。 */
  async buildFromList(paths: string[], onProgress?: (s: SearchStatus) => void): Promise<void> {
    this.cancelFlag = false;
    this.status.building = true;
    this.status.total = paths.length;
    this.status.indexed = 0;
    const CHUNK = 50;
    for (let i = 0; i < paths.length; i += CHUNK) {
      if (this.cancelFlag) break;
      const slice = paths.slice(i, i + CHUNK);
      await Promise.all(slice.map((pathStr) => this.readOne(pathStr)));
      this.status.indexed = Math.min(this.status.total, i + slice.length);
      onProgress?.(this.getStatus());
      await new Promise((r) => setTimeout(r, 0));
    }
    this.status.building = false;
    onProgress?.(this.getStatus());
  }

  cancel(): void { this.cancelFlag = true; }

  private async readOne(pathStr: string): Promise<void> {
    try {
      const meta = this.getMeta(pathStr);
      if (!meta) return;
      const file = this.app.vault.getAbstractFileByPath(normalizePath(pathStr));
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const content = await this.app.vault.cachedRead(file);
      this.docs.set(pathStr, buildDocument(meta, content));
    } catch {
      // §一百一十三：单篇读取失败跳过
    }
  }

  /** 增量更新（§二十）：modify / create 事件 */
  async updateFile(pathStr: string): Promise<void> {
    const meta = this.getMeta(pathStr);
    if (!meta) return;
    try {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(pathStr));
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const content = await this.app.vault.cachedRead(file);
      this.docs.set(pathStr, buildDocument(meta, content));
      this.status.total = Math.max(this.status.total, this.docs.size);
    } catch { /* 跳过 */ }
  }

  /** 删除（§二十一） */
  remove(pathStr: string): void { this.docs.delete(pathStr); }

  /** 重命名（§二十二）：复制文档并改 path，不重新读取 */
  rename(oldPath: string, newPath: string): void {
    const doc = this.docs.get(oldPath);
    if (doc) {
      this.docs.delete(oldPath);
      this.docs.set(newPath, { ...doc, path: newPath });
    }
  }

  /** 布尔检索（§十一/十五）：返回命中文档（调用方再 Ranking/选候选）；不写 Activity/Review */
  search(tokens: string[], limit = 500): SearchDocument[] {
    if (tokens.length === 0) return [];
    const out: SearchDocument[] = [];
    for (const doc of this.docs.values()) {
      if (matchesDoc(doc, tokens)) out.push(doc);
    }
    return out.slice(0, limit);
  }
}