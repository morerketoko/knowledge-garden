/**
 * Capture Manager（§十三）：createCapture / createFromClipboard / createFromUrl / openInbox。
 * 纯函数（无 Obsidian 运行时依赖，便于 node 测试）：
 *   - §九：来源信息与知识正文分离（全部放 frontmatter，不混入正文）
 *   - §二十二：Capture 不触发 AI（AI request = 0，只有用户点「处理」才进入 AI）
 *   - §一百一十六：URL 归一化 + 指纹仅作 duplicate hint，不作绝对唯一键
 */
import { sha256 } from "./ai/cache";
import type { CaptureMeta, CaptureType } from "./types";

/** Capture 文件标题安全化（§六：YYYY-MM-DD-<title>.md；防路径注入） */
export function captureSafeTitle(text: string, max = 60): string {
  return (text || "untitled")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || "untitled";
}

/** 本地日期 YYYY-MM-DD（§八：capturedAt） */
export function captureDate(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
}

/** Capture 输入（§二十一：标题/内容/来源/标签；标签暂存 frontmatter 供后续 Processing） */
export interface CaptureInput {
  captureType: CaptureType;
  title: string;
  body: string;
  sourceUrl?: string;
  sourceTitle?: string;
  /** 可选：来源日期，默认今天 */
  capturedAt?: string;
}

/** §九：生成 Capture Markdown（frontmatter 与正文分离）。sourceUrl/sourceTitle 由捕获来源填入，AI 0 参与。 */
export function buildCaptureMarkdown(input: CaptureInput): string {
  const fm: string[] = ["---", "type: capture", "captureType: " + input.captureType, "sourceType: " + input.captureType];
  if (input.sourceUrl) fm.push("sourceUrl: " + input.sourceUrl.trim());
  if (input.sourceTitle) fm.push("sourceTitle: " + input.sourceTitle.replace(/[\r\n]+/g, " ").trim());
  fm.push("capturedAt: " + (input.capturedAt ?? captureDate()));
  fm.push("---");
  const body = (input.body || "").trim();
  const lines = [...fm, "", "# " + (input.title.trim() || "未命名捕获"), ""];
  if (body) lines.push(body);
  return lines.join("\n") + "\n";
}

/** §九/八：解析 Capture frontmatter（提取 provenance；供 Processing/Dashboard 复用）。非 capture 文件返回 null。 */
export function parseCaptureFrontmatter(md: string): CaptureMeta | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  if (!/^type:\s*capture\s*$/m.test(m[1])) return null;
  const get = (k: string): string | undefined => {
    const line = m[1].split(/\r?\n/).find((l) => l.startsWith(k + ":"));
    return line ? line.slice(k.length + 1).trim() : undefined;
  };
  const isType = (v: string | undefined): v is CaptureType =>
    v === "note" || v === "clipboard" || v === "url" || v === "import";
  const tags = (get("tags") || "").split(/[,，\s]+/).filter(Boolean);
  return {
    captureType: isType(get("captureType")) ? get("captureType") as CaptureType : "note",
    sourceType: isType(get("sourceType")) ? get("sourceType") as CaptureType : "note",
    sourceUrl: get("sourceUrl"),
    sourceTitle: get("sourceTitle"),
    capturedAt: get("capturedAt"),
    ...(get("origin") ? { origin: get("origin") as CaptureMeta["origin"] } : {}),
    ...(get("status") ? { status: get("status") as CaptureMeta["status"] } : {}),
    ...(get("area") ? { area: get("area") } : {}),
    tags,
  };
}

/** §一百零一：提取正文（frontmatter 之后的内容；Processing 只取正文，来源信息在 frontmatter） */
export function captureBody(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return m ? m[1].trim() : md.trim();
}

/** §一百一十六：URL 归一化（去 fragment、www、尾斜杠；query 键排序）——仅作重复提示，不做绝对唯一键 */
export function normalizeUrlForFingerprint(url: string): string {
  let u = (url || "").trim();
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    const keys = Array.from(parsed.searchParams.keys()).sort();
    const qs = new URLSearchParams();
    for (const k of keys) qs.set(k, parsed.searchParams.get(k) ?? "");
    parsed.search = qs.toString();
    parsed.host = parsed.host.replace(/^www\./, "");
    u = parsed.toString();
  } catch {
    // 非 URL 文本：原样 trim，不强行解析
  }
  return u.replace(/\/+$/, "");
}

/** §一百一十六：URL 指纹（sha256 归一化结果；duplicate hint） */
export function urlFingerprint(url: string): string {
  return sha256(normalizeUrlForFingerprint(url));
}

/** Capture 文件路径：<folder>/YYYY-MM-DD-<safeTitle>.md（§六/一百零一） */
export function captureFilePath(folder: string, date: string, title: string): string {
  const f = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  return f + "/" + date + "-" + captureSafeTitle(title) + ".md";
}