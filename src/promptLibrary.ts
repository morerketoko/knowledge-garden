/**
 * Phase 16：Prompt Library（§四~十七 / §九十九~一百零三 / §一百三十八）。
 * - Source of Truth = Markdown：Knowledge Garden/Prompts/<Category>/<name>.md（frontmatter: type/name/description/version/favorite/tags；正文 = prompt）。
 * - 缓存索引 cache/prompts.json 只存元数据 + 使用统计（usageCount/lastUsedAt），Markdown 是用户资产（§七）。
 * - Prompt = 「如何回应/风格/约束」（§五），Skill = 「工作流程/方法论」，不得混为一谈。
 * - 编辑 = update（id 不变，§十二）；Prompt 内容改变 → promptFingerprint 变化 → Cache Miss（§十三，绝不 clearType("*")）。
 * - 收藏/搜索/编辑/删除/应用：一律 0 AI（§一百三十八）；应用 = activate（填回输入框，不自动发送，§十/一百四十一）。
 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import { sha256 } from "./ai/cache";

export const PROMPTS_ROOT = "Knowledge Garden/Prompts";
export const PROMPT_CATEGORIES = ["Academic", "Research", "Writing", "Technical", "General"];

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  tags?: string[];
  category: string;
  favorite: boolean;
  usageCount: number;
  lastUsedAt?: number;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export function promptStableId(name: string, createdAt: number): string {
  return "prompt-" + sha256((name || "untitled") + "|" + createdAt).slice(0, 12);
}

/** Prompt 内容指纹：name/description/prompt 任一变化 → 指纹变化（§十三：Cache Miss 输入部件） */
export function promptFingerprint(t: { name?: string; description?: string; prompt: string }): string {
  return sha256([(t.name || ""), (t.description || ""), (t.prompt || "")].join("|"));
}

/** frontmatter 行解析（最小 YAML 子集：key: value / tags 多行 - item） */
function parseFrontmatterLines(lines: string[]): { meta: Record<string, string | number | boolean | string[]>; bodyLines: string[] } {
  if (!lines.length || lines[0].trim() !== "---") return { meta: {}, bodyLines: lines };
  const meta: Record<string, string | number | boolean | string[]> = {};
  let curKey: string | null = null;
  const tags: string[] = [];
  let i = 1;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "---") { i++; break; }
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) {
      curKey = m[1];
      const val = m[2].trim();
      if (val === "tags") continue;
      if (val === "") continue;
      if (val === "true" || val === "false") meta[curKey] = val === "true";
      else if (/^\d+$/.test(val)) meta[curKey] = parseInt(val, 10);
      else meta[curKey] = val;
    } else if (curKey === "tags" && /^-\s*(.*)$/.test(raw)) {
      tags.push(raw.replace(/^-\s*/, "").trim());
    }
  }
  if (tags.length) meta.tags = tags;
  return { meta, bodyLines: lines.slice(i) };
}

/** Markdown → PromptTemplate 元数据 + 正文（纯函数；非法文件返回 null） */
export interface PromptMarkdownParsed { template: Partial<PromptTemplate>; }
export function parsePromptMarkdown(md: string, id: string): PromptMarkdownParsed | null {
  const lines = (md || "").split(/\r?\n/);
  const { meta, bodyLines } = parseFrontmatterLines(lines);
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  const prompt = bodyLines.join("\n").trim();
  if (!name || !prompt) return null;
  const tags = Array.isArray(meta.tags) ? (meta.tags as string[]).filter((x) => x && typeof x === "string") : undefined;
  return {
    template: {
      id,
      name,
      description: typeof meta.description === "string" ? meta.description : undefined,
      prompt,
      tags: tags && tags.length ? tags : undefined,
      category: typeof meta.category === "string" ? meta.category : "General",
      favorite: meta.favorite === true,
      version: typeof meta.version === "number" ? meta.version : 1,
    },
  };
}

/** PromptTemplate → Markdown（frontmatter + 正文） */
export function buildPromptMarkdown(t: PromptTemplate): string {
  const fm: string[] = ["---", "type: kg-prompt", "name: " + t.name];
  if (t.description) fm.push("description: " + t.description);
  if (t.category) fm.push("category: " + t.category);
  fm.push("version: " + (t.version ?? 1));
  fm.push("favorite: " + (t.favorite ? "true" : "false"));
  if (t.tags && t.tags.length) { fm.push("tags:"); for (const g of t.tags) fm.push("  - " + g); }
  fm.push("---", "", t.prompt, "");
  return fm.join("\n");
}

/** 本地全文搜索（name/description/tags/body；0 AI，§十五） */
export function searchPrompts(list: PromptTemplate[], query: string): PromptTemplate[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((t) =>
    t.name.toLowerCase().includes(q) ||
    (t.description || "").toLowerCase().includes(q) ||
    (t.tags || []).some((g) => g.toLowerCase().includes(q)) ||
    t.prompt.toLowerCase().includes(q),
  );
}

export interface PromptLibraryStoreShape {
  formatVersion: number;
  templates: PromptTemplate[];
}

/** Prompt 库：Markdown = Source of Truth；cache/prompts.json = 元数据 + 统计缓存（§七） */
export class PromptLibraryStore {
  templates: PromptTemplate[] = [];
  private root: string;
  private file: string;
  constructor(pluginDir: string) {
    this.root = path.join(pluginDir, PROMPTS_ROOT);
    this.file = path.join(pluginDir, "cache", "prompts.json");
  }
  /** 启动：先扫描 Markdown（恢复源），再合并缓存统计（usageCount/lastUsedAt）；0 AI */
  load(): boolean {
    let isolated = false;
    let cached: PromptTemplate[] = [];
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as PromptLibraryStoreShape;
        if (raw && Array.isArray(raw.templates)) cached = raw.templates;
      }
    } catch {
      isolated = isolateCorruptFile(this.file);
      cached = [];
    }
    const statById = new Map<string, { usageCount: number; lastUsedAt?: number }>();
    for (const c of cached) statById.set(c.id, { usageCount: c.usageCount || 0, lastUsedAt: c.lastUsedAt });
    const next: PromptTemplate[] = [];
    if (fs.existsSync(this.root)) {
      for (const cat of PROMPT_CATEGORIES) {
        const dir = path.join(this.root, cat);
        if (!fs.existsSync(dir)) continue;
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (!e.isFile() || !/^[^\r\n]*\.md$/i.test(e.name)) continue;
          try {
            const md = fs.readFileSync(path.join(dir, e.name), "utf8");
            const id = promptStableId(e.name.replace(/\.md$/i, ""), 0);
            const parsed = parsePromptMarkdown(md, id);
            if (!parsed) continue;
            const t = parsed.template;
            const st = statById.get(id);
            next.push({
              id,
              name: t.name ?? e.name.replace(/\.md$/i, ""),
              description: t.description,
              prompt: t.prompt ?? "",
              tags: t.tags,
              category: t.category ?? cat,
              favorite: t.favorite ?? false,
              usageCount: st?.usageCount ?? 0,
              lastUsedAt: st?.lastUsedAt,
              version: t.version ?? 1,
              createdAt: 0,
              updatedAt: 0,
            } as PromptTemplate);
          } catch { /* 单个坏文件跳过 */ }
        }
      }
    }
    this.templates = next;
    return isolated;
  }
  list(): PromptTemplate[] { return [...this.templates]; }
  get(id: string): PromptTemplate | undefined { return this.templates.find((t) => t.id === id); }
  favorites(): PromptTemplate[] { return this.templates.filter((t) => t.favorite); }
  recentlyUsed(limit = 10): PromptTemplate[] {
    return [...this.templates].filter((t) => t.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, limit);
  }
  count(): number { return this.templates.length; }
  private normalizeCategory(c?: string): string { return c && PROMPT_CATEGORIES.includes(c) ? c : "General"; }
  private fileNameFor(name: string): string {
    return (name || "untitled").trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "") + ".md";
  }
  private pathFor(cat: string, name: string): string { return path.join(this.root, this.normalizeCategory(cat), this.fileNameFor(name)); }
  private writeMarkdown(t: PromptTemplate): void {
    const dir = path.join(this.root, this.normalizeCategory(t.category));
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 已存在 */ }
    const target = this.pathFor(t.category, t.name);
    try { fs.writeFileSync(target, buildPromptMarkdown(t), "utf8"); } catch { throw new Error("Prompt 写入失败：" + target); }
  }
  private deleteMarkdown(t: PromptTemplate): void {
    const target = this.pathFor(t.category, t.name);
    try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch { /* 文件已不存在 */ }
  }
  create(input: { name: string; description?: string; prompt: string; tags?: string[]; category?: string; favorite?: boolean }): PromptTemplate {
    const now = Date.now();
    const t: PromptTemplate = {
      id: promptStableId(input.name, now),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      prompt: (input.prompt || "").trim(),
      tags: input.tags && input.tags.length ? input.tags.map((x) => x.trim()).filter(Boolean) : undefined,
      category: this.normalizeCategory(input.category),
      favorite: !!input.favorite,
      usageCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.writeMarkdown(t);
    this.templates.push(t);
    this.flush();
    return t;
  }
  /** 编辑：id 不变（§十二），只更新字段并写回 Markdown；Prompt 内容变化 → Cache Miss（调用方使用 promptFingerprint） */
  update(id: string, patch: { name?: string; description?: string; prompt?: string; tags?: string[]; category?: string; favorite?: boolean }): PromptTemplate | null {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const old = this.templates[i];
    const next: PromptTemplate = {
      ...old,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() || undefined } : {}),
      ...(patch.prompt !== undefined ? { prompt: (patch.prompt || "").trim() } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags.map((x) => x.trim()).filter(Boolean) } : {}),
      ...(patch.category !== undefined ? { category: this.normalizeCategory(patch.category) } : {}),
      ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
      updatedAt: Date.now(),
    };
    if (patch.name && patch.name.trim() !== old.name) this.deleteMarkdown(old);
    this.writeMarkdown(next);
    this.templates[i] = next;
    this.flush();
    return next;
  }
  remove(id: string): boolean {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.deleteMarkdown(this.templates[i]);
    this.templates.splice(i, 1);
    this.flush();
    return true;
  }
  setFavorite(id: string, fav: boolean): PromptTemplate | null {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const next: PromptTemplate = { ...this.templates[i], favorite: fav, updatedAt: Date.now() };
    this.writeMarkdown(next);
    this.templates[i] = next;
    this.flush();
    return next;
  }
  /** 使用统计（§十四）：usageCount++ / lastUsedAt；不调用 AI；不重写 Markdown（统计只在缓存） */
  touch(id: string): PromptTemplate | null {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const next: PromptTemplate = {
      ...this.templates[i],
      usageCount: (this.templates[i].usageCount || 0) + 1,
      lastUsedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.templates[i] = next;
    this.flush();
    return next;
  }
  flush(): void {
    try { atomicWriteJson(this.file, { formatVersion: 1, templates: this.templates }); } catch { /* 写盘失败不阻塞 */ }
  }
}

/** 内置示例 Prompts（首次启动可 seed；0 AI） */
export function seedDefaultPrompts(): { name: string; description: string; prompt: string; tags?: string[]; category: string; favorite?: boolean }[] {
  return [
    { name: "Academic Precision", description: "学术化、严谨化表达：用词准确、克制、不夸张", prompt: "用严谨、克制、不夸张的学术中文表达。优先准确性，不堆砌术语；不增加原文没有的事实；明确区分事实与推断。", tags: ["academic", "writing"], category: "Academic", favorite: true },
    { name: "Critical Rewrite", description: "批判性改写：先提取论点 → 检查证据 → 分析反例 → 重组", prompt: "先提取原文核心论点，再检查证据是否支撑，接着分析可能反例，最后重组为更严谨的表述。不伪造来源。", tags: ["writing", "research"], category: "Research", favorite: true },
    { name: "Simplify", description: "把复杂内容讲清楚，面向通用读者", prompt: "把复杂内容讲清楚，面向通用读者。使用短句与具体例子，避免无意义长句与伪学术表达。", tags: ["writing"], category: "Writing", favorite: false },
    { name: "Knowledge Transfer", description: "知识迁移：把概念应用到新场景", prompt: "把源概念的核心结构提炼出来，迁移到目标场景；明确哪些是类比、哪些是直接对应；不擅自虚构应用效果。", tags: ["application"], category: "General", favorite: false },
  ];
}

/** 首次启动 seed（已有内容则跳过；0 AI） */
export function seedPromptLibrary(store: PromptLibraryStore): void {
  if (store.count() > 0) return;
  for (const d of seedDefaultPrompts()) {
    try { store.create({ ...d, favorite: d.favorite ?? false }); } catch { /* 单个失败继续 */ }
  }
}