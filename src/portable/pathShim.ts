/**
 * Phase 24 §十六 / §一百三十六：`path` 的便携替代。
 *
 * 为什么还要导出 `join` / `dirname` 这两个旧名字：
 * 现有 16 个模块里写的是 `path.join(baseDir, "cache", "x.json")`，
 * 保留同义别名可以让 diff 只改 import 行（零行为改动、零风险），
 * 同时**不会**引入 `path.resolve` 这类会产生绝对路径的 API —— 本模块刻意不提供 resolve。
 */
export {
  type PluginPath,
  isUnsafeRelativePath,
  isReservedStoragePath,
  normalizeVaultPath,
  joinVaultPath,
  dirnameVaultPath,
  basenameVaultPath,
  extnameVaultPath,
  isAbsolutePath,
  toVaultRelative,
} from "./paths";

import { joinVaultPath, dirnameVaultPath, basenameVaultPath, normalizeVaultPath } from "./paths";

/** 等价 `path.join`，但结果一定是 vault/存储根相对路径（不含前导 `/`） */
export function join(...parts: (string | undefined | null)[]): string {
  return joinVaultPath(...parts);
}

/** 等价 `path.dirname`（相对路径版本） */
export function dirname(p: string): string {
  return dirnameVaultPath(p);
}

/** 等价 `path.basename`（相对路径版本） */
export function basename(p: string, ext?: string): string {
  return basenameVaultPath(p, ext);
}

/** 等价 `path.normalize`（注意：拒绝 `..`，与 Node 语义不同 —— 这是刻意的安全收紧，§十七） */
export function normalize(p: string): string {
  return normalizeVaultPath(p);
}

/**
 * 刻意 **不** 导出 `resolve` / `isAbsolute` / `sep` / `posix`：
 * 它们会诱导写出绝对路径或平台相关分隔符。若源码仍引用这些名字，
 * TypeScript 与 esbuild 都会在构建期报错（而不是在移动端运行时才炸）。
 */
export const sep = "/";
