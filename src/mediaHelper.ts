/** Phase 6：本地媒体工具——Vault 内图片/音频列表与随机选择（纯 Utils，不创建 DOM，不触发 AI）。 */
import { App, TFile, normalizePath } from "obsidian";

/** 支持的图片格式（§10） */
export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
/** 支持的音频格式（§16，以浏览器实际能力为准） */
export const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "aac"];

function normFolder(folder: string): string {
  return normalizePath((folder || "").trim()).replace(/\/+$/, "");
}

/** 列出 folder（空 = 整个 Vault）内指定扩展名的文件；每次调用直接读 Vault，调用方负责缓存（§12/§59） */
export function listMediaFiles(app: App, folder: string, exts: string[]): TFile[] {
  const f = normFolder(folder);
  const set = new Set(exts.map((e) => e.toLowerCase()));
  const prefix = f ? f + "/" : "";
  return app.vault.getFiles().filter(
    (file) =>
      file.extension &&
      set.has(file.extension.toLowerCase()) &&
      (f === "" || file.path.startsWith(prefix))
  );
}

/** 随机选一个（folder 为空时回退 background 单图语义；返回 null 表示没有可用图片） */
export function pickRandomImage(app: App, folder: string): TFile | null {
  const list = listMediaFiles(app, folder, IMAGE_EXTS);
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/** 把 Vault 路径解析为浏览器可加载的资源 URI（优先 getResourcePath，缺失时返回空） */
export function resourceUrl(app: App, path: string): string {
  if (!path) return "";
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!(file instanceof TFile)) return "";
  try {
    return app.vault.getResourcePath(file);
  } catch {
    return "";
  }
}
