import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { AICacheEntry, AICacheType } from "../types";
import { atomicWriteJson, isolateCorruptFile } from "../migrations";

/** ---------- 纯函数：指纹与周期键（无 Obsidian 依赖，便于验证） ---------- */

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** 稳定 key：按给定部件组合后 sha256 */
export function fingerprintKey(parts: string[]): string {
  return sha256(parts.join("\u0000"));
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function fmtIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** 周期键：与 Phase 2.5 保持一致，Scheduler 与 AI Cache 必须复用同一实现（§13/42）。
 *  daily=daily:当日  weekly=weekly:本周一  monthly=monthly:YYYY-MM  quarterly=quarterly:YYYY-QN  custom=custom:到期日 */
export function periodKeyFor(period: "daily" | "weekly" | "monthly" | "quarterly" | "custom", now = new Date()): string {
  if (period === "weekly") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return "weekly:" + fmtIso(d);
  }
  if (period === "monthly") {
    return "monthly:" + now.getFullYear() + "-" + pad2(now.getMonth() + 1);
  }
  if (period === "quarterly") {
    return "quarterly:" + now.getFullYear() + "-Q" + (Math.floor(now.getMonth() / 3) + 1);
  }
  if (period === "custom") {
    return "custom:" + fmtIso(now);
  }
  return "daily:" + fmtIso(now);
}

/** 候选指纹：path + modified + size。参与 AI 的笔记只要发生变化就自动失效；不需要全文 hash。 */
export function candidateSig(notes: { path: string; modified: number; size: number }[]): string {
  const lines = [...notes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((n) => n.path + "|" + n.modified + "|" + n.size);
  return sha256(lines.join("\n"));
}

/** 区域指纹：参与 AI 的知识区域（名称/文件夹/参与开关）变化会使候选语义变化，必须失效。 */
export function areaSig(areaLines: string[]): string {
  return sha256([...areaLines].sort().join("\n"));
}

/** ---------- AICache：cache/ai-cache.json 单文件持久化 ---------- */

export interface AICacheStats {
  count: number;
  bytes: number;
  lastUpdated: number;
  byType: Record<string, number>;
}

export class AICache {
  private file: string;
  private entries = new Map<string, AICacheEntry>();

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "ai-cache.json");
  }

  /** 启动时恢复（离线可读）。损坏/结构非法 → 隔离 *.corrupt-* 后重建空缓存（§九/§十），返回是否执行了隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      if (!Array.isArray(raw)) throw new Error("invalid cache structure");
      const now = Date.now();
      for (const e of raw) {
        if (!e || typeof e.key !== "string" || !e.type) continue;
        if (e.status !== "success" && e.status !== "error") continue;
        if (e.expiresAt && e.expiresAt <= now) continue;
        this.entries.set(e.key, e as AICacheEntry);
      }
      return false;
    } catch {
      // 损坏缓存：隔离原文件（保留可恢复副本）后置空，不阻塞插件启动
      const isolated = isolateCorruptFile(this.file);
      this.entries.clear();
      return isolated;
    }
  }

  get(key: string): AICacheEntry | undefined {
    return this.entries.get(key);
  }

  /** 只缓存「有效结果」+ 元数据；绝不写入 API Key / header / 原始 prompt / 笔记全文 */
  put(entry: AICacheEntry): void {
    this.entries.set(entry.key, { ...entry, updatedAt: Date.now() });
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] 缓存写入失败：", (e as Error).message);
    }
  }

  byType(type: AICacheType): AICacheEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.type === type);
  }

  stats(): AICacheStats {
    const all = Array.from(this.entries.values());
    let bytes = 0;
    let last = 0;
    const byType: Record<string, number> = {};
    for (const e of all) {
      try { bytes += JSON.stringify(e).length; } catch { /* 忽略 */ }
      if (e.updatedAt > last) last = e.updatedAt;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { count: all.length, bytes, lastUpdated: last, byType };
  }

  /** 清理过期 AI 缓存（§四十六）：只删 expiresAt 已过 + 超过 7 天的 error 缓存；success 未过期完整保留 */
  clearExpired(): number {
    const now = Date.now();
    const ERROR_TTL_MS = 7 * 86400000;
    let removed = 0;
    for (const [k, e] of this.entries) {
      const expired = typeof e.expiresAt === "number" && e.expiresAt <= now;
      const staleError = e.status === "error" && now - (e.updatedAt ?? e.createdAt ?? 0) > ERROR_TTL_MS;
      if (expired || staleError) {
        this.entries.delete(k);
        removed++;
      }
    }
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] 缓存清理写入失败：", (e as Error).message);
    }
    return removed;
  }
  /** 清空：* 删除全部 AI 缓存（只动 cache/，绝不触碰 Reviews/） */
  clearType(type: AICacheType | "*"): number {
    let removed = 0;
    for (const [k, e] of this.entries) {
      if (type === "*" || e.type === type) {
        this.entries.delete(k);
        removed++;
      }
    }
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] 缓存清理写入失败：", (e as Error).message);
    }
    return removed;
  }
}