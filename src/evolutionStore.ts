/** Phase 7：EvolutionStore —— 本地快照/问题的持久化（cache/evolution.json，§七/十一）。
 *  与 AI Cache 严格分离（§十一）：这里只存本地统计快照与反复问题，不存 AI 输出。
 *  快照幂等（§九）：同一 periodKey 重复 upsert 为覆盖，绝不 append 相同快照。
 *  生命周期（§四十三）：只保留最近 keepWeeks（默认 52）个快照；历史快照不因删除/改名而篡改（§四十四）。
 */
import * as fs from "fs";
import * as path from "path";
import type { KnowledgeEvolutionSnapshot, PersistentQuestion } from "./types";
import { mergeQuestions } from "./knowledgeEvolution";
import { atomicWriteJson, isolateCorruptFile, withFormatVersion } from "./migrations";

interface EvolutionStoreData {
  snapshots: KnowledgeEvolutionSnapshot[];
  persistentQuestions: PersistentQuestion[];
}

const EMPTY: EvolutionStoreData = { snapshots: [], persistentQuestions: [] };

function sanitize(raw: unknown): EvolutionStoreData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const snapshots: KnowledgeEvolutionSnapshot[] = [];
  if (Array.isArray(data["snapshots"])) {
    for (const s of data["snapshots"]) {
      if (!s || typeof s !== "object") continue;
      const rec = s as Record<string, unknown>;
      if (typeof rec["periodKey"] !== "string" || typeof rec["date"] !== "string") continue;
      snapshots.push(rec as unknown as KnowledgeEvolutionSnapshot);
    }
  }
  const questions: PersistentQuestion[] = [];
  if (Array.isArray(data["persistentQuestions"])) {
    for (const q of data["persistentQuestions"]) {
      if (!q || typeof q !== "object") continue;
      const rec = q as Record<string, unknown>;
      if (typeof rec["fingerprint"] !== "string") continue;
      questions.push(rec as unknown as PersistentQuestion);
    }
  }
  const out = { snapshots, persistentQuestions: questions } as EvolutionStoreData & { formatVersion?: number };
  if (typeof (data as Record<string, unknown>)["formatVersion"] === "number") {
    (out as unknown as Record<string, unknown>)["formatVersion"] = data["formatVersion"];
  }
  return out;
}

export class EvolutionStore {
  private file: string;
  private data: EvolutionStoreData = { snapshots: [], persistentQuestions: [] };
  private dirty = false;
  private flushTimer: number | null = null;

  constructor(pluginDir: string, private keepWeeks = 52) {
    this.file = path.join(pluginDir, "cache", "evolution.json");
  }

  /** 启动时恢复；损坏 → 隔离 *.corrupt-* 后重建空结构（§九），返回是否执行了隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      this.data = sanitize(JSON.parse(fs.readFileSync(this.file, "utf8")));
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.data = { snapshots: [], persistentQuestions: [] };
      return isolated;
    }
  }

  setKeepWeeks(n: number): void { this.keepWeeks = Math.max(4, Math.min(208, n)); }

  all(): KnowledgeEvolutionSnapshot[] { return this.data.snapshots; }
  latest(n: number): KnowledgeEvolutionSnapshot[] { return this.data.snapshots.slice(-n); }
  getSnapshot(periodKey: string): KnowledgeEvolutionSnapshot | undefined {
    return this.data.snapshots.find((s) => s.periodKey === periodKey);
  }

  upsertSnapshot(snap: KnowledgeEvolutionSnapshot): void {
    const i = this.data.snapshots.findIndex((s) => s.periodKey === snap.periodKey);
    if (i >= 0) this.data.snapshots[i] = snap;
    else this.data.snapshots.push(snap);
    this.data.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    this.prune();
    this.markDirty();
  }

  prune(): void {
    if (this.data.snapshots.length > this.keepWeeks) {
      this.data.snapshots = this.data.snapshots.slice(-this.keepWeeks);
    }
  }

  persistentQuestions(): PersistentQuestion[] { return this.data.persistentQuestions; }

  addQuestions(incoming: { periodLabel: string; question: string }[]): void {
    if (!incoming || incoming.length === 0) return;
    this.data.persistentQuestions = mergeQuestions(this.data.persistentQuestions, incoming);
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => { this.flush(); }, 800) as unknown as number;
  }

  flush(): void {
    if (this.flushTimer !== null) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      atomicWriteJson(this.file, withFormatVersion(this.data));
    } catch { /* 写盘失败不阻塞运行 */ }
  }
}