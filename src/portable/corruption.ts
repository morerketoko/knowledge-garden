/**
 * Phase 24 §十二：便携损坏恢复策略（替代 fs.renameSync 的 isolateCorruptFile）。
 *
 * 桌面旧实现：`fs.renameSync(file, file + ".corrupt-<stamp>")` —— 移动端不可用。
 *
 * 新策略按后端区分：
 * - vault 后端：`Vault.rename()` 把损坏文件挪到 `<dir>/.corrupt/<name>.<stamp>`，
 *   保留可恢复副本（§十一：不直接删除旧文件）。
 * - plugin-data 后端：把损坏内容备份到 `dataBackup/<name>.<stamp>` 这个虚拟路径，
 *   再清空原键（§十二「备份旧对象到 dataBackup」）。
 * - 内存（测试）：直接把内容复制到 `.corrupt/` 虚拟路径。
 *
 * 返回值语义与旧实现保持一致：true = 确实隔离了损坏文件。
 */
import type { PortableStorage } from "../storage";
import { basenameVaultPath, dirnameVaultPath, joinVaultPath } from "./paths";

export const CORRUPT_DIR = ".corrupt";

function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** 损坏文件时间戳：YYYYMMDD-HHmmss（§九） */
export function corruptStamp(now = new Date()): string {
  return (
    String(now.getFullYear()) + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
    "-" + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds())
  );
}

/** 损坏副本目标路径：<dir>/.corrupt/<name>.<stamp> */
export function corruptTargetPath(path: string, now = new Date()): string {
  const dir = dirnameVaultPath(path);
  const name = basenameVaultPath(path) || "unknown";
  return joinVaultPath(dir, CORRUPT_DIR, name + "." + corruptStamp(now));
}

/**
 * 隔离损坏文件：**保留副本**，且不依赖 Node fs。
 * 失败一律不抛错（不阻塞插件启动），返回是否隔离成功。
 */
export async function isolateCorrupt(storage: PortableStorage, path: string): Promise<boolean> {
  try {
    const exists = await storage.exists(path);
    if (!exists) return false;
    const target = corruptTargetPath(path);
    // 优先 rename（vault / plugin-data / memory 均支持）；rename 失败则退回复制 + 清空
    if (await storage.rename(path, target)) return true;
    const raw = await storage.readText(path);
    if (raw === null) return false;
    const written = await storage.writeText(target, raw);
    if (!written.ok) return false;
    await storage.remove(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 旧的绝对路径注释名保留（`*.corrupt-<stamp>`）用于 README / Notice 文案一致性：
 * 新实现把副本放在 `.corrupt/` 子目录内，Notice 文案统一走这里。
 */
export function corruptNoticeTail(): string {
  return "原文件已保留在 .corrupt/ 目录。";
}
