/** Saved Exploration / 收藏知识链路（Saved Exploration 阶段）。
 * - 收藏 = 用户主动保存的 AI 探索结果快照（§二：绝不只存 cacheKey）。
 * - Markdown 是用户可读资产 + 恢复源（§四/四十/四十三）；JSON 是快速索引（§五）。
 * - 保存/打开/删除 全部 0 AI 请求（§五十二~五十四）。
 * - 纯函数（fingerprint / Markdown 生成与解析）无 Obsidian DOM 依赖，便于 Node 测试。
 */
import type { DiscoveryScope, SavedExploration, SavedExplorationEdge, SavedExplorationNode, SavedExplorationSource } from "./types";
import { fingerprintKey } from "./ai/cache";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import * as fs from "fs";

/** 收藏文件名安全化（§十五：YYYY-MM-DD <title>.md；防路径注入） */
export function safeTitle(text: string, max = 48): string {
  return (text || "知识探索")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || "知识探索";
}

/** 收藏 ID（§十四 示意 saved-202608291230） */
export function savedId(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return "saved-" + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + p(now.getHours()) + p(now.getMinutes());
}

/** §十二/四十八：fingerprint = sha256(source + normalizedQuery + nodePaths + edgeDefs) */
export function savedFingerprint(
  source: SavedExplorationSource,
  normalizedQuery: string,
  nodes: { path: string }[],
  edges: { from: string; to: string; relation: string }[]
): string {
  const nodePaths = nodes.map((n) => n.path.replace(/\.md$/i, "")).sort().join(",");
  const edgeDefs = edges.map((e) => e.from.replace(/\.md$/i, "") + "~" + e.to.replace(/\.md$/i, "") + "~" + e.relation).sort().join(",");
  return fingerprintKey([source, normalizedQuery || "", nodePaths, edgeDefs]);
}

/* ---------- Markdown 生成（§十五）与 frontmatter 解析（§四十二/四十三 恢复源） ---------- */

function escYaml(s: string): string {
  return '"' + (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function unescYaml(s: string): string {
  const m = /^"(.*)"$/.exec(s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s;
}

function yamlNodesBlock(nodes: SavedExplorationNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push("  - path: " + escYaml(n.path));
    if (n.label) out.push("    label: " + escYaml(n.label));
    if (n.role) out.push("    role: " + escYaml(n.role));
    if (n.reason) out.push("    reason: " + escYaml(n.reason));
  }
  return out;
}
function yamlEdgesBlock(edges: SavedExplorationEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    out.push("  - from: " + escYaml(e.from));
    out.push("    to: " + escYaml(e.to));
    out.push("    relation: " + escYaml(e.relation));
    if (e.direction) out.push("    direction: " + escYaml(e.direction));
    if (e.reason) out.push("    reason: " + escYaml(e.reason));
  }
  return out;
}

/** 收藏 Markdown 全文（§十五 结构：frontmatter 含 nodes/edges 快照，供 reindex 精确恢复 §四十二） */
export function savedMarkdown(entry: SavedExploration): string {
  const dateStr = new Date(entry.createdAt).toISOString().slice(0, 10);
  const srcLabel: Record<string, string> = {
    daily_curiosity: "今日知识奇想",
    query_exploration: "主动探索",
    connection: "知识连接",
    manual: "手动整理",
    anchor_exploration: "从笔记探索",
  };
  const wiki = (p: string): string => "[["
    + (p.split("/").pop() ?? p).replace(/\.md$/i, "")
    + "]]";
  const pathLine = entry.nodes.map((n) => wiki(n.path)).join(" → ") || "（暂无节点）";
  const edges: string[] = [];
  for (const e of entry.edges) {
    const from = entry.nodes.find((n) => n.path === e.from);
    const to = entry.nodes.find((n) => n.path === e.to);
    edges.push(
      "",
      "### " + (from?.label || wiki(e.from)) + " → " + (to?.label || wiki(e.to)),
      "",
      "关系：" + e.relation,
      "",
      "说明：" + (e.reason || "（无）"),
    );
  }
  return [
    "---",
    "type: knowledge-exploration",
    "saved: true",
    'savedId: "' + entry.id + '"',
    "source: " + entry.source,
    "date: " + dateStr,
    "title: " + escYaml(entry.title || "知识收藏"),
    ...(entry.query ? ["query: " + escYaml(entry.query)] : []),
    ...(entry.scope ? ["scope: " + escYaml(JSON.stringify(entry.scope))] : []),
    ...(entry.anchorPath ? ["anchorPath: " + escYaml(entry.anchorPath)] : []),
    ...(entry.tags && entry.tags.length ? ["tags:", ...entry.tags.map((tg) => "  - " + escYaml(tg))] : []),
    ...(entry.nodes.length ? ["nodes:", ...yamlNodesBlock(entry.nodes)] : []),
    ...(entry.edges.length ? ["edges:", ...yamlEdgesBlock(entry.edges)] : []),
    "---",
    "",
    "# " + entry.title || "# 知识收藏",
    "",
    ...(entry.anchorPath
      ? ["## 起点", "", "从《" + (entry.anchorPath.split("/").pop() ?? entry.anchorPath).replace(/.md$/i, "") + "》发起关联探索。", ""]
      : []),
    ...(entry.query ? ["> 用户问题：", "> " + entry.query, ""] : []),
    "## AI 观察",
    "",
    ...(entry.headline ? [entry.headline, ""] : []),
    entry.summary || "（无摘要）",
    "",
    "## 知识路径",
    "",
    pathLine,
    "",
    "## 关系",
    ...(edges.length ? edges : ["", "（无）"]),
    "",
    "## 值得继续思考",
    "",
    "- 见「AI 观察」中的问题线索（保存的是当时的探索路径）",
    "",
    "## 来源",
    "",
    "来源：" + (srcLabel[entry.source] ?? entry.source),
    ...(entry.scope ? ["知识发现范围：" + (entry.scope as DiscoveryScope).mode] : []),
    "生成时间：" + new Date(entry.createdAt).toLocaleString("zh-CN"),
    "",
    "> 收藏快照（Saved Exploration）：保存的是 AI 结果与当时的知识链路，不随 AI Cache 过期而失效。",
  ].join("\n");
}

/** 解析 frontmatter 中的列表块（"- 条目" 缩进），返回条目 map 数组与下一个顶层键下标 */
function parseYamlList(lines: string[], keyIdx: number): { items: Record<string, string>[]; next: number } {
  const items: Record<string, string>[] = [];
  let i = keyIdx + 1;
  let cur: Record<string, string> | null = null;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[A-Za-z]+:/.test(line)) break;
    const dash = /^  - (.+)$/.exec(line);
    if (dash) {
      cur = {};
      items.push(cur);
      const kv = /^([A-Za-z]+):(.*)$/.exec(dash[1]);
      if (kv) cur[kv[1]] = unescYaml(kv[2].trim());
      i++;
      continue;
    }
    const kvLine = /^    ([A-Za-z]+):(.*)$/.exec(line);
    if (kvLine && cur) { cur[kvLine[1]] = unescYaml(kvLine[2].trim()); i++; continue; }
    if (!line.trim()) { i++; continue; }
    break;
  }
  return { items, next: i };
}

/** 解析收藏 Markdown frontmatter（§四十二/四十三：reindex / 恢复用；无 savedId → null） */
export function parseSavedFrontmatter(md: string): {
  id: string; title: string; source: SavedExplorationSource; query?: string;
  scope?: string; date?: string; tags?: string[]; anchorPath?: string; nodes: SavedExplorationNode[]; edges: SavedExplorationEdge[];
} | null {
  if (!md || !md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end < 0) return null;
  const fm = md.slice(3, end);
  const lines = fm.split("\n");
  let saved = false;
  let id = ""; let title = ""; let source = "query_exploration"; let query = ""; let scope = "";
  let date = ""; let tags: string[] = []; let anchorPath = "";
  const nodes: SavedExplorationNode[] = [];
  const edges: SavedExplorationEdge[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = /^([A-Za-z]+): ?(.*)$/.exec(line);
    if (!kv) { i++; continue; }
    const k = kv[1]; const v = kv[2].trim();
    if (k === "saved" && v === "true") saved = true;
    else if (k === "savedId") id = unescYaml(v);
    else if (k === "title") title = unescYaml(v);
    else if (k === "source") source = v || "query_exploration";
    else if (k === "query") query = unescYaml(v);
    else if (k === "scope") scope = v;
    else if (k === "anchorPath") anchorPath = unescYaml(v);
    else if (k === "date") date = v;
    else if (k === "tags") {
      const tagList: string[] = []; let j = i + 1; while (j < lines.length) { const line = lines[j]; if (/^[A-Za-z]+:/.test(line)) break; const dm = /^  - (.+)$/.exec(line); if (dm) { tagList.push(unescYaml(dm[1].trim())); j++; continue; } if (!line.trim()) { j++; continue; } break; } tags = tagList.filter((t) => t !== ""); i = j; continue;
    }
    else if (k === "nodes") {
      const r = parseYamlList(lines, i);
      for (const it of r.items) nodes.push({ path: it["path"] ?? "", label: it["label"], role: it["role"], reason: it["reason"] });
      i = r.next; continue;
    }
    else if (k === "edges") {
      const r = parseYamlList(lines, i);
      for (const it of r.items) edges.push({
        from: it["from"] ?? "", to: it["to"] ?? "", relation: it["relation"] ?? "",
        direction: it["direction"] === "bidirectional" ? "bidirectional" : "forward",
        reason: it["reason"],
      });
      i = r.next; continue;
    }
    i++;
  }
  if (!saved || !id) return null;
  return {
    id, title: title || "知识收藏",
    source: (["daily_curiosity", "query_exploration", "connection", "manual", "anchor_exploration", "workbench_ask"] as const).includes(source as SavedExplorationSource) ? source as SavedExplorationSource : "query_exploration",
    query: query || undefined, scope: scope || undefined, date: date || undefined, tags, nodes, edges,
    anchorPath: anchorPath || undefined,
  };
}

/* ---------- Store（cache/saved-explorations.json） ---------- */

const SAVED_FILE = "saved-explorations.json";

/** 收藏索引 + 快照存储（JSON = 快速索引；快照完整；Markdown = 恢复源 §四/四十） */
export class SavedExplorationStore {
  private entries: SavedExploration[] = [];
  private dirty = false;

  constructor(private baseDir: string) {}

  private file(): string { return this.baseDir + "/cache/" + SAVED_FILE; }

  /** 损坏 → isolateCorruptFile（保留原文件）+ 空索引；返回是否损坏 */
  load(): boolean {
    try {
      const raw = fs.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw) as { entries?: SavedExploration[] };
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

  all(): SavedExploration[] { return [...this.entries].sort((a, b) => b.createdAt - a.createdAt); }
  count(): number { return this.entries.length; }
  get(id: string): SavedExploration | undefined { return this.entries.find((e) => e.id === id); }
  findByFingerprint(fp: string): SavedExploration | undefined { return this.entries.find((e) => e.fingerprint === fp); }

  /** 新增（§十二：同 fingerprint 已存在 → 不重复添加，返回已有条目） */
  add(entry: SavedExploration): SavedExploration {
    const existing = this.findByFingerprint(entry.fingerprint);
    if (existing) return existing;
    this.entries.push(entry);
    this.dirty = true;
    this.flush();
    return entry;
  }

  /** 标题/标签更新（§三十二：同步 JSON；Markdown 同步由调用方负责） */
  update(id: string, patch: { title?: string; tags?: string[] }): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    if (patch.title !== undefined && patch.title.trim()) e.title = patch.title.trim();
    if (patch.tags !== undefined) e.tags = patch.tags;
    e.updatedAt = Date.now();
    this.dirty = true;
    this.flush();
  }

  /** 删除 JSON 条目（§三十六：绝不删除原始笔记；Markdown 删除由调用方决定） */
  remove(id: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) { this.dirty = true; this.flush(); }
  }

  /** §十八 rename：更新快照内引用（nodes[].path / edges from/to） */
  migratePaths(oldPath: string, newPath: string): void {
    const nOld = oldPath.replace(/\.md$/i, "");
    const nNew = newPath.replace(/\.md$/i, "");
    let changed = false;
    for (const e of this.entries) {
      if (e.anchorPath) {
        if (e.anchorPath === oldPath) { e.anchorPath = newPath; changed = true; }
        else if (e.anchorPath.replace(/.md$/i, "") === nOld) { e.anchorPath = nNew + ".md"; changed = true; }
      }
      for (const n of e.nodes) {
        if (n.path === oldPath) { n.path = newPath; changed = true; }
        else if (n.path.replace(/\.md$/i, "") === nOld) { n.path = nNew + ".md"; changed = true; }
      }
      for (const ed of e.edges) {
        if (ed.from === oldPath) { ed.from = newPath; changed = true; }
        else if (ed.from.replace(/\.md$/i, "") === nOld) { ed.from = nNew + ".md"; changed = true; }
        if (ed.to === oldPath) { ed.to = newPath; changed = true; }
        else if (ed.to.replace(/\.md$/i, "") === nOld) { ed.to = nNew + ".md"; changed = true; }
      }
    }
    if (changed) { this.dirty = true; this.flush(); }
  }

  /** §四十二：reindex 用——整体替换索引（从 Markdown 恢复后调用） */
  replaceAll(entries: SavedExploration[]): void {
    this.entries = entries;
    this.dirty = true;
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries } as never);
    this.dirty = false;
  }
}