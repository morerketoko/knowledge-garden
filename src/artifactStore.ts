/**
 * Phase 17：Message Artifact 系统（§十四~三十一 / §一百三十二~一百四十五）。
 * - Artifact = 用户决定长期保存的 AI 产物（§79：清 AI Cache 不删 Artifact；§80：用户编辑不改 Cache）。
 * - 纯函数（标题建议 / Markdown 构建 / 路径安全 / 位置解析）+ 轻量索引（cache/artifacts.json 只存元数据）。
 * - 写 Vault 由调用方（main）执行（Permission=ask / Safe Apply / Preview，§20-21）。
 * - 绝不保存 hidden reasoning（§一百四十四 / §176）：本模块只处理 final answer + sources 摘要。
 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import { sha256 } from "./ai/cache";
import type { AIAnswerSource, ArtifactIndexEntry, ArtifactRef, ArtifactType, MessageArtifact } from "./types";

/** §68：自动建议标题（用户可修改） */
export function suggestArtifactTitle(question: string, artifactType: ArtifactType): string {
  const base = (question || "").trim().replace(/\s+/g, " ").slice(0, 24);
  const typeLabel: Record<ArtifactType, string> = {
    answer: "AI 分析",
    research: "研究笔记",
    summary: "AI 提炼",
    draft: "AI 草稿",
    analysis: "AI 分析",
    outline: "大纲",
  };
  return typeLabel[artifactType] + (base ? "：" + base : "");
}

/** 保存位置（§16-24）：当前笔记 append / 新建笔记 / Research / Project / Inbox / 剪贴板 */
export type ArtifactSaveLocation =
  | { kind: "current_note" }
  | { kind: "new_note"; title: string }
  | { kind: "folder"; folder: string; title: string }
  | { kind: "clipboard" };

/** §72：禁止保存到受保护目录（沿用已有 Path Safety） */
const BLOCKED_DIRS = [".obsidian", "cache", "node_modules", ".git", ".trash"];

export function safeArtifactPath(candidate: string): string | null {
  const p = (candidate ?? "").trim();
  if (!p) return null;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return null;      // 绝对路径
  if (/\.\./.test(p)) return null;                  // 路径穿越
  const segs = p.split(/[\\/]+/);
  for (const s of segs) {
    if (!s || s === "." || s === "..") return null;
    if (BLOCKED_DIRS.includes(s.toLowerCase().trim())) return null;
  }
  if (!p.endsWith(".md")) return null;              // §73：第一版只创建 .md
  return p.split(/[\\/]+/).map((s) => s.replace(/[\\/:*?"<>|]/g, "-")).join("/");
}

/** 默认目录（§17/22-24）：Research / Project（当前项目）/ Inbox；不存在 Research2 */
export function defaultArtifactFolder(kind: ArtifactType, projectRoot?: string): string {
  if (kind === "research") return "Knowledge Garden/Research";
  if (kind === "outline" || kind === "draft") return projectRoot ? projectRoot.replace(/\/+$/, "") + "/Notes" : "Knowledge Garden/Inbox";
  return projectRoot ? projectRoot.replace(/\/+$/, "") + "/Research" : "Knowledge Garden/Research";
}

/** §20-21：Preview 元数据（Title / Path / Content / Sources） */
export interface ArtifactPreview {
  title: string;
  path: string;
  content: string;
  sources: AIAnswerSource[];
  artifactType: ArtifactType;
}

/** 构建最终 Markdown（§74-75：frontmatter + 正文 + 来源；frontmatter 含 type/artifactType/sourceTaskId/workspace/createdAt） */
export function buildArtifactMarkdown(a: MessageArtifact): string {
  const fm: string[] = [
    "---",
    "type: ai-artifact",
    "artifactType: " + a.artifactType,
    "title: " + a.title.replace(/[:\n]/g, " "),
    "messageId: " + a.messageId,
  ];
  if (a.taskId) fm.push("sourceTaskId: " + a.taskId);
  if (a.workspaceId) fm.push("workspace: " + a.workspaceId);
  if (a.projectId) fm.push("project: " + a.projectId);
  fm.push("createdAt: " + a.createdAt);
  fm.push("updatedAt: " + a.updatedAt);
  fm.push("---", "");
  const body: string[] = [a.content.trim()];
  const vaultSources = (a.sources ?? []).filter((s) => s.type === "vault" && s.path);
  const webSources = (a.sources ?? []).filter((s) => s.type === "web" && /^https?:\/\//i.test(s.url || ""));
  const inferences = (a.sources ?? []).filter((s) => s.type === "inference");
  if (vaultSources.length || webSources.length || inferences.length) body.push("", "## 来源");
  if (vaultSources.length) {
    body.push("", "### Vault");
    for (const s of vaultSources) body.push("- [[" + s.path + "]]" + (s.reason ? " — " + s.reason : ""));
  }
  if (webSources.length) {
    body.push("", "### Web");
    for (const s of webSources) body.push("- [" + (s.title || s.url) + "](" + s.url + ")");
  }
  if (inferences.length) {
    body.push("", "### AI 推断");
    for (const s of inferences) body.push("- " + (s.snippet || s.title || "（推断）"));
    body.push("", "> 以上为 AI 基于来源做出的推断，并非来源原文。");
  }
  body.push("");
  return fm.join("\n") + body.join("\n");
}

/** §120-122：Source Snapshot → Artifact 快照（原笔记变化不自动更新 Artifact §81） */
export function snapshotSources(sources: AIAnswerSource[], maxSnippet = 500): AIAnswerSource[] {
  return (sources ?? []).slice(0, 20).map((s) => ({
    type: s.type,
    ...(s.path ? { path: s.path } : {}),
    ...(s.title ? { title: s.title.slice(0, 200) } : {}),
    ...(s.url ? { url: s.url.slice(0, 500) } : {}),
    ...(s.snippet ? { snippet: s.snippet.slice(0, maxSnippet) } : {}),
    ...(s.reason ? { reason: s.reason.slice(0, 300) } : {}),
  }));
}

/** §62：位置解析 → 最终 Vault 路径（纯函数；冲突由调用方检测） */
export function resolveArtifactPath(loc: ArtifactSaveLocation, vaultRoot: string): string | null {
  const root = (vaultRoot ?? "").replace(/[\\/]+$/, "");
  let rel: string;
  if (loc.kind === "new_note") rel = "Knowledge Garden/Research/" + loc.title.replace(/[\\/:*?"<>|]/g, "-") + ".md";
  else if (loc.kind === "folder") rel = (loc.folder || "Knowledge Garden/Research").replace(/[\\/]+$/, "") + "/" + loc.title.replace(/[\\/:*?"<>|]/g, "-") + ".md";
  else return null;
  const safe = safeArtifactPath(rel);
  if (!safe) return null;
  return root ? root + "/" + safe : safe;
}

/** Phase 17 索引存储（cache/artifacts.json；只存元数据，不存正文/推理） */
export interface ArtifactStoreShape { formatVersion: number; entries: ArtifactIndexEntry[]; }

export function artifactIdFor(messageId: string, at: number): string {
  return "artifact-" + sha256(messageId + "|" + at).slice(0, 12);
}

export class ArtifactStore {
  private entries: ArtifactIndexEntry[] = [];
  private file: string;
  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "artifacts.json");
  }
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as ArtifactStoreShape;
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) throw new Error("invalid artifacts store");
      this.entries = raw.entries.slice(0, 200);
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.entries = [];
      return isolated;
    }
  }
  get(id: string): ArtifactIndexEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }
  /** 登记已保存的 Artifact（写索引，不写文件本体） */
  register(a: MessageArtifact): ArtifactIndexEntry {
    const entry: ArtifactIndexEntry = {
      id: a.id,
      messageId: a.messageId,
      taskId: a.taskId,
      title: a.title,
      artifactType: a.artifactType,
      vaultPath: a.vaultPath,
      workspaceId: a.workspaceId,
      projectId: a.projectId,
      sourceCount: (a.sources ?? []).length,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
    const i = this.entries.findIndex((e) => e.id === entry.id);
    if (i >= 0) this.entries[i] = entry; else this.entries.push(entry);
    if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
    this.flush();
    return entry;
  }
  recent(limit = 5): ArtifactIndexEntry[] {
    return [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
  toRefs(messageId: string): ArtifactRef[] {
    return this.entries
      .filter((e) => e.messageId === messageId)
      .map((e) => ({ artifactId: e.id, title: e.title, vaultPath: e.vaultPath, createdAt: e.createdAt }));
  }
  count(): number { return this.entries.length; }
  flush(): void {
    try { atomicWriteJson(this.file, { formatVersion: 1, entries: this.entries }); } catch { /* 写盘失败不阻塞 */ }
  }
}