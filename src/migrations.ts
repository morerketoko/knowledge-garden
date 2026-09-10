/**
 * Phase 9：统一数据版本化 / 损坏隔离 / 原子写（§三~五 / §八~十三 / §七十）。
 * Phase 24：改为平台无关实现 —— 不再 import Node fs/path，改用 portable 存储层：
 * 桌面与 iOS/Android 走同一套代码，路径一律是存储根相对路径，绝不产生绝对路径。
 *
 * - FORMAT_VERSION：持久化文件顶层版本号（未知字段一律保留，绝不 parse→rewrite 删字段）。
 * - isolateCorruptFile：损坏文件移入 `.corrupt/` 并保留可恢复副本（§九/§十二）。
 * - atomicWriteJson：写 `.tmp` 后 rename 原子替换；rename 不可用时退化为直接写（§十三：
 *   原子性以平台能力为准，不假装移动端存在 fs atomic rename）。
 * 本模块不依赖 Obsidian API（只依赖 portable 层），便于 Node 自动测试。
 */
import * as fs from "./portable/fsPortable";

/** 当前持久化格式版本 */
export const FORMAT_VERSION = 1;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 损坏文件时间戳：YYYYMMDD-HHmmss（§九） */
export function corruptStamp(now = new Date()): string {
  return (
    String(now.getFullYear()) +
    pad2(now.getMonth() + 1) +
    pad2(now.getDate()) +
    "-" +
    pad2(now.getHours()) +
    pad2(now.getMinutes()) +
    pad2(now.getSeconds())
  );
}

/** 损坏副本目标路径：<dir>/.corrupt/<name>.<stamp>（纯字符串，无 Node path） */
export function corruptTargetPath(filePath: string, now = new Date()): string {
  const p = String(filePath).replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  const dir = i < 0 ? "" : p.slice(0, i);
  const name = i < 0 ? p : p.slice(i + 1);
  const stamp = name + "." + corruptStamp(now);
  return dir ? dir + "/.corrupt/" + stamp : ".corrupt/" + stamp;
}

/**
 * 损坏文件隔离：<file> → <dir>/.corrupt/<name>.<stamp>（保留可恢复副本，不直接删除）。
 * 返回是否真的执行了隔离（文件存在且移动成功）。失败不抛错（不阻塞启动）。
 */
export function isolateCorruptFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.renameSync(filePath, corruptTargetPath(filePath));
    return true;
  } catch {
    // rename 不可用（后端不支持）→ 读出来写到副本再删原文件，语义等价
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(corruptTargetPath(filePath), raw);
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 原子写 JSON（平台无关）：
 * - 优先 `.tmp` → rename；rename 抛错时退化为直接写目标文件。
 * - 写失败时抛错由调用方捕获（与原有 writeFileSync 错误处理一致）。
 */
export function atomicWriteJson(filePath: string, value: unknown): void {
  const data = JSON.stringify(value);
  const tmp = filePath + ".tmp";
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, filePath);
    return;
  } catch {
    // tmp+rename 不可用：清理临时文件后直接写（移动端 Vault API 的 create/modify 本身
    // 不提供跨文件原子替换；此处如实退化，不伪装成原子写）
    try { fs.unlinkSync(tmp); } catch { /* 临时文件可能不存在 */ }
    fs.writeFileSync(filePath, data, "utf8");
  }
}

/**
 * 给持久化对象补 formatVersion（若缺失，视为历史版本一次迁移；未知字段保留）。
 * 数组形态的历史文件（如 ai-cache.json 旧数组）不需要版本号，load 侧按结构兼容。
 */
export function withFormatVersion<T extends object>(obj: T): T & { formatVersion: number } {
  const rec = obj as Record<string, unknown>;
  if (typeof rec["formatVersion"] !== "number") rec["formatVersion"] = FORMAT_VERSION;
  return rec as T & { formatVersion: number };
}

/** 读取持久化对象的 formatVersion（缺失按 0 处理 = 历史版本） */
export function readFormatVersion(value: unknown): number {
  if (value && typeof value === "object") {
    const v = (value as Record<string, unknown>)["formatVersion"];
    if (typeof v === "number") return v;
  }
  return 0;
}
