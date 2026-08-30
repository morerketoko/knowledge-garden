/**
 * Phase 9：统一数据版本化 / 损坏隔离 / 原子写（§三~五 / §八~十三 / §七十）。
 * - FORMAT_VERSION：持久化文件顶层版本号（未知字段一律保留，绝不 parse→rewrite 删字段）。
 * - isolateCorruptFile：损坏的 cache 文件隔离重命名为 *.corrupt-YYYYMMDD-HHmmss，不直接覆盖（§九：不能丢唯一原文件）。
 * - atomicWriteJson：写 .tmp 后 rename 原子替换，避免崩溃留下半截文件（§七十 Crash Consistency）。
 * 本模块不依赖 Obsidian API，便于 Node 自动测试。
 */
import * as fs from "fs";
import * as path from "path";

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

/**
 * 损坏文件隔离：<file> → <file>.corrupt-<stamp>。
 * 返回是否真的执行了隔离（文件存在且 rename 成功）。失败不抛错（不阻塞启动）。
 */
export function isolateCorruptFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.renameSync(filePath, filePath + ".corrupt-" + corruptStamp());
    return true;
  } catch {
    return false;
  }
}

/**
 * 原子写 JSON：先写 <file>.tmp 再 rename 覆盖。
 * - mkdir 父目录（递归）
 * - 写失败/rename 失败时抛错由调用方捕获（与原有 writeFileSync 错误处理一致）
 */
export function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, filePath);
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