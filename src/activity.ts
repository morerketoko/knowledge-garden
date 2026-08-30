import * as fs from "fs";
import * as path from "path";
import type { ActivityEntry } from "./types";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";

/**
 * ActivityStore：用户与知识的「行为数据」（打开/复习）。
 * - 独立于 NoteIndex（知识本体）与 AICache（AI 结果），生命周期完全不同（§二/§九）。
 * - 只保存每篇笔记 4 个数字字段 → O(note count)，不随打开次数无限增长（§四/§十）。
 * - 高频打开不逐次写盘：800ms debounce 批量持久化（§二十二）。
 */
export class ActivityStore {
  private data = new Map<string, ActivityEntry>();
  private file: string;
  private flushTimer: number | null = null;
  private dirty = false;

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "activity.json");
  }

  /** 启动时恢复；损坏 → 隔离 *.corrupt-* 后重建空 Activity（§十一），返回是否执行了隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, ActivityEntry>;
      if (!raw || typeof raw !== "object") throw new Error("invalid activity structure");
      for (const [p, e] of Object.entries(raw)) {
        if (!e || typeof e !== "object") continue;
        this.data.set(p, {
          lastAccessedAt: typeof e.lastAccessedAt === "number" ? e.lastAccessedAt : undefined,
          accessCount: typeof e.accessCount === "number" ? e.accessCount : undefined,
          lastReviewedAt: typeof e.lastReviewedAt === "number" ? e.lastReviewedAt : undefined,
          reviewCount: typeof e.reviewCount === "number" ? e.reviewCount : undefined,
        });
      }
      return false;
    } catch {
      /* 损坏 → 隔离原文件（保留可恢复副本）后重建空 Activity，不阻塞启动 */
      const isolated = isolateCorruptFile(this.file);
      this.data.clear();
      return isolated;
    }
  }

  get(filePath: string): ActivityEntry | undefined {
    return this.data.get(filePath);
  }

  /** file-open 事件：只更新内存 + 标记 dirty（§21：不重建 Dashboard；§23：绝不触发 AI） */
  recordAccess(filePath: string): void {
    const e = this.data.get(filePath) ?? {};
    e.lastAccessedAt = Date.now();
    e.accessCount = (e.accessCount ?? 0) + 1;
    this.data.set(filePath, e);
    this.markDirty();
  }

  /** 「标记为已复习」：绝不修改原始 Markdown（§八），只写行为数据 */
  markReviewed(filePath: string): void {
    const e = this.data.get(filePath) ?? {};
    e.lastReviewedAt = Date.now();
    e.reviewCount = (e.reviewCount ?? 0) + 1;
    this.data.set(filePath, e);
    this.markDirty();
  }

  /** 删除已不存在笔记的条目（配合索引 rescan/delete，保持 O(note count)） */
  prune(keepPaths: Set<string>): void {
    let changed = false;
    for (const p of Array.from(this.data.keys())) {
      if (!keepPaths.has(p)) {
        this.data.delete(p);
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 800);
  }

  flush(): void {
    this.flushTimer = null;
    this.dirty = false;
    try {
      const obj: Record<string, ActivityEntry> = {};
      for (const [p, e] of this.data) obj[p] = e;
      atomicWriteJson(this.file, obj);
    } catch (e) {
      console.error("[KnowledgeGarden][Activity] 持久化失败：", (e as Error).message);
    }
  }

  /** 诊断用：条目总数（§四十一） */
  count(): number { return this.data.size; }
  recent(limit: number): { path: string; entry: ActivityEntry }[] {
    return Array.from(this.data.entries())
      .filter(([, e]) => typeof e.lastAccessedAt === "number")
      .sort((a, b) => (b[1].lastAccessedAt ?? 0) - (a[1].lastAccessedAt ?? 0))
      .slice(0, limit)
      .map(([path, entry]) => ({ path, entry }));
  }

  set(path: string, entry: ActivityEntry): void {
    this.data.set(path, entry);
    this.markDirty();
  }
}