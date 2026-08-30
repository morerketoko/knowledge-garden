/** Query History：cache/query-history.json（§五十五）。只存 query/时间/范围/缓存键/标题（§五十四）。 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, FORMAT_VERSION, isolateCorruptFile } from "./migrations";
import type { QueryHistoryEntry } from "./types";

export const QUERY_HISTORY_MAX = 100;

/** 最近探索存储：独立于 Activity / Review / AI Cache（§五十五）。搜索不污染任何行为数据（§八十七~八十九）。 */
export class QueryHistoryStore {
  private file: string;
  private entries: QueryHistoryEntry[] = [];

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "query-history.json");
  }

  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后重建空结构（§九 通用策略），返回是否隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { entries?: QueryHistoryEntry[] };
      if (!raw || typeof raw !== "object") throw new Error("invalid query-history structure");
      if (Array.isArray(raw.entries)) {
        this.entries = raw.entries
          .filter((e) => e && typeof e.query === "string")
          .slice(0, QUERY_HISTORY_MAX);
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.entries = [];
      return isolated;
    }
  }

  all(): QueryHistoryEntry[] {
    return this.entries;
  }

  recent(n: number): QueryHistoryEntry[] {
    return this.entries.slice(0, Math.max(1, Math.floor(n)));
  }

  /** 记录（§五十三/五十四）：相同 query+scope 视为同一次，移到最前并更新 headline/cacheKey；按 limit 截断 */
  add(entry: QueryHistoryEntry, limit: number): void {
    const i = this.entries.findIndex((e) => e.query === entry.query && e.scope === entry.scope);
    if (i >= 0) this.entries.splice(i, 1);
    this.entries.unshift(entry);
    const cap = Math.max(1, Math.min(QUERY_HISTORY_MAX, Math.floor(limit) || 20));
    if (this.entries.length > cap) this.entries.length = cap;
    this.flush();
  }

  /** 清空最近探索（§九十五：只删 query-history.json，不删 AI Cache） */
  clear(): void {
    this.entries = [];
    this.flush();
  }

  flush(): void {
    try {
      atomicWriteJson(this.file, { formatVersion: FORMAT_VERSION, entries: this.entries });
    } catch {
      // 写盘失败不阻塞运行
    }
  }
}