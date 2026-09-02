/**
 * Phase 17：Artifact 保存服务（§16-26 / §69-75 / §112-114）。
 * - 位置：当前笔记 append / 新建笔记 / 自定义目录 / 剪贴板（Research/Project/Inbox 由调用方映射为 folder）。
 * - 冲突：默认不覆盖（§69）；覆盖必须先 Diff 确认（§70），此处只负责写入与返回 conflict。
 * - 写盘：仅 App（Vault API），全程 0 AI（§112：保存是移动文本，绝不调模型）。
 * - 安全：路径经 safeArtifactPath（绝对路径 / .. / .obsidian / cache / node_modules / .git / .trash 拒绝）。
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { AIAnswerSource, ArtifactType, MessageArtifact } from "./types";
import { safeArtifactPath, buildArtifactMarkdown, snapshotSources, type ArtifactSaveLocation } from "./artifactStore";

/** §68/§16：保存请求（title 用户可改；overwrite 默认 false） */
export interface ArtifactSaveRequest {
  messageId: string;
  taskId?: string;
  title: string;
  content: string;
  sources: AIAnswerSource[];
  artifactType: ArtifactType;
  location: ArtifactSaveLocation;
  workspaceId?: string;
  projectId?: string;
  overwrite?: boolean;
}

export interface ArtifactSaveResult {
  ok: boolean;
  artifact?: MessageArtifact;
  vaultPath?: string;
  conflict?: boolean;
  conflictPath?: string;
  error?: string;
}

/** 标题清洗（文件名安全；保留中文） */
export function cleanArtifactTitle(title: string): string {
  const t = (title || "").trim().replace(/[\\/:*?"<>|\n\r]/g, "-").slice(0, 80);
  return t || "AI 产物";
}

/** new_note / folder → vault-relative 路径（纯函数，可测试 §134 P17-21~25） */
export function artifactRelPath(loc: ArtifactSaveLocation): string | null {
  if (loc.kind === "new_note") {
    return safeArtifactPath("Knowledge Garden/Research/" + cleanArtifactTitle(loc.title) + ".md");
  }
  if (loc.kind === "folder") {
    const folder = (loc.folder || "Knowledge Garden/Research").replace(/[\\/]+$/, "");
    return safeArtifactPath(folder + "/" + cleanArtifactTitle(loc.title) + ".md");
  }
  return null;
}

/** 完整文档 Markdown（frontmatter + 正文 + 来源；new_note/folder 用） */
export function artifactFullMarkdown(a: MessageArtifact): string {
  return buildArtifactMarkdown(a);
}

/** 追加块（current_note 用：无 frontmatter，正文 + 来源；§26 来源区分 Vault/Web/推断） */
export function artifactAppendBlock(a: MessageArtifact): string {
  const lines: string[] = ["", "---", "## ✦ " + a.title, ""];
  lines.push((a.content || "").trim());
  const vaultSrcs = (a.sources ?? []).filter((s) => s.type === "vault" && s.path);
  const webSrcs = (a.sources ?? []).filter((s) => s.type === "web" && /^https?:\/\//i.test(s.url || ""));
  const infs = (a.sources ?? []).filter((s) => s.type === "inference");
  if (vaultSrcs.length || webSrcs.length || infs.length) lines.push("", "### 来源");
  if (vaultSrcs.length) {
    lines.push("", "#### Vault");
    for (const s of vaultSrcs) lines.push("- [[" + s.path + "]]" + (s.reason ? " — " + s.reason : ""));
  }
  if (webSrcs.length) {
    lines.push("", "#### Web");
    for (const s of webSrcs) lines.push("- [" + (s.title || s.url) + "](" + s.url + ")");
  }
  if (infs.length) {
    lines.push("", "#### AI 推断");
    for (const s of infs) lines.push("- " + (s.snippet || s.title || "（推断）"));
    lines.push("", "> 以上为 AI 基于来源做出的推断，并非来源原文。");
  }
  return lines.join("\n");
}

/** 目标是否已存在（纯函数） */
export function existsAt(app: App, rel: string): boolean {
  return !!app.vault.getAbstractFileByPath(rel);
}

/** 读取目标现有内容（Diff / 覆盖拼接用；不存在返回 null） */
export async function readExistingAt(app: App, rel: string): Promise<string | null> {
  const f = app.vault.getAbstractFileByPath(rel);
  if (f instanceof TFile) return await app.vault.cachedRead(f);
  return null;
}

/** 主保存入口（0 AI；冲突默认不覆盖；§21-22 / §69-70） */
export async function saveArtifact(app: App, req: ArtifactSaveRequest): Promise<ArtifactSaveResult> {
  const artifact: MessageArtifact = {
    id: "artifact-" + req.messageId + "-" + Date.now().toString(36),
    messageId: req.messageId,
    taskId: req.taskId,
    title: cleanArtifactTitle(req.title),
    content: req.content || "",
    artifactType: req.artifactType,
    sources: snapshotSources(req.sources ?? []),
    workspaceId: req.workspaceId,
    projectId: req.projectId,
    vaultPath: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    if (req.location.kind === "clipboard") {
      // 剪贴板：完整文档 Markdown；不建索引（§82 Dashboard 只列 Vault 保存）
      artifact.vaultPath = "(clipboard)";
      const md = artifactFullMarkdown(artifact);
      await navigator.clipboard.writeText(md);
      return { ok: true, artifact, vaultPath: "(clipboard)" };
    }
    if (req.location.kind === "current_note") {
      const f = app.workspace.getActiveFile();
      if (!(f instanceof TFile)) return { ok: false, error: "当前没有打开的 Markdown 笔记" };
      artifact.vaultPath = f.path;
      const existing = await app.vault.cachedRead(f);
      const block = artifactAppendBlock(artifact);
      await app.vault.modify(f, existing.replace(/\s+$/, "") + "\n" + block);
      return { ok: true, artifact, vaultPath: f.path };
    }
    const rel = artifactRelPath(req.location);
    if (!rel) return { ok: false, error: "保存路径非法（含受保护目录或非法字符）" };
    artifact.vaultPath = rel;
    if (existsAt(app, rel)) {
      if (req.overwrite !== true) {
        return { ok: false, conflict: true, conflictPath: rel, error: "目标已存在：" + rel };
      }
      const existing = await readExistingAt(app, rel);
      const md = artifactFullMarkdown(artifact);
      const newContent = existing !== null ? existing.replace(/\s+$/, "") + "\n\n---\n\n" + md : md;
      await app.vault.modify(app.vault.getAbstractFileByPath(rel) as TFile, newContent);
      return { ok: true, artifact, vaultPath: rel };
    }
    await app.vault.create(rel, artifactFullMarkdown(artifact));
    return { ok: true, artifact, vaultPath: rel };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}