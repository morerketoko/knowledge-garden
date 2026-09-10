/**
 * Phase 15：Source Ledger（§一百零五~一百零八 / §二百八十一）。
 * - 统一登记 vault / web / project / user 来源，稳定 ID（§一百零七：避免每次显示重复来源）。
 * - 去重规则（§一百一十三）：web 同 URL、vault/project 同 path，绝不重复。
 * - 持久化 cache/source-ledger.json；保存最小字段（§二百八十一）。
 * - Tool Result 不写 AICache（§二百六十五）；来源是证据登记，不是 AI 缓存。
 * - I/O 与 discovery.ts 一致：import * as fs + migrations.atomicWriteJson / isolateCorruptFile。
 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, FORMAT_VERSION, isolateCorruptFile } from "./migrations";
import { sha256 } from "./ai/cache";
import type { SourceRecord } from "./types";

export interface SourceLedgerStore {
  records: SourceRecord[];
}

export function emptySourceLedger(): SourceLedgerStore {
  return { records: [] };
}

/** 稳定 ID：type + 唯一键（web=url、vault/project=path、user=date+title）→ sha256 前 12 位 */
export function sourceStableId(type: SourceRecord["type"], key: string): string {
  return sha256(type + "|" + (key || "")).slice(0, 12);
}

/** 是否同一条来源（§一百一十三：web 同 URL、vault/project 同 path） */
export function sameSource(a: SourceRecord, b: SourceRecord): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "web") return !!a.url && a.url === b.url;
  if (a.type === "vault" || a.type === "project") return !!a.path && a.path === b.path;
  return a.id === b.id;
}

/** upsert：同 URL/path 已存在 → 更新 snippet/retrievedAt 并返回既有记录；否则新增稳定 ID */
export function ledgerUpsert(ledger: SourceLedgerStore, rec: SourceRecord): SourceRecord {
  const existing = ledger.records.find((r) => sameSource(r, rec));
  if (existing) {
    if (rec.snippet && rec.snippet !== existing.snippet) existing.snippet = rec.snippet;
    if (rec.retrievedAt) existing.retrievedAt = rec.retrievedAt;
    if (rec.title && !existing.title) existing.title = rec.title;
    return existing;
  }
  const id = rec.id || sourceStableId(rec.type, rec.type === "web" ? (rec.url || "") : (rec.path || rec.title || ""));
  const entry: SourceRecord = { ...rec, id };
  ledger.records.push(entry);
  return entry;
}

/** 来源统计（§二百八十一：只保留必要字段） */
export function ledgerStats(ledger: SourceLedgerStore): { total: number; vault: number; web: number; project: number; user: number } {
  const s = { total: ledger.records.length, vault: 0, web: 0, project: 0, user: 0 };
  for (const r of ledger.records) {
    if (r.type === "vault") s.vault++;
    else if (r.type === "web") s.web++;
    else if (r.type === "project") s.project++;
    else s.user++;
  }
  return s;
}

/** 与 discovery.ts 同构的存储类：构造传入插件根目录，缓存文件 cache/source-ledger.json */
export class SourceLedger {
  store: SourceLedgerStore = emptySourceLedger();
  private file: string;

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "source-ledger.json");
  }

  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后重建空结构（§九 通用策略），返回是否隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { records?: SourceRecord[] };
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.records)) throw new Error("invalid source ledger");
      this.store = { records: raw.records };
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.store = emptySourceLedger();
      return isolated;
    }
  }

  upsert(rec: SourceRecord): SourceRecord {
    const out = ledgerUpsert(this.store, rec);
    this.flush();
    return out;
  }

  stats(): { total: number; vault: number; web: number; project: number; user: number } {
    return ledgerStats(this.store);
  }

  flush(): void {
    try {
      atomicWriteJson(this.file, { formatVersion: FORMAT_VERSION, records: this.store.records });
    } catch { /* 写盘失败不阻塞运行 */ }
  }
}