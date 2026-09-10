/**
 * Phase 16：Latency Instrumentation（§十八~二十 / §一百四十四 / §一百二十五）。
 * - LatencyTracker：单次任务阶段计时（taskCreatedAt→contextStart→contextEnd→requestStart→firstTokenAt→requestEnd→parseEnd→renderEnd）。
 * - LatencyCollector：近期样本按 mode 汇总 Avg / P95 / TTFT。
 * - 绝不保存 Prompt / Note / Web / API Key / User Answer 全文（§二十 / §一百二十五）。
 */
import { atomicWriteJson } from "./migrations";

export type LatencyPhase =
  | "taskCreatedAt"
  | "contextStart"
  | "contextEnd"
  | "requestStart"
  | "firstTokenAt"
  | "requestEnd"
  | "parseEnd"
  | "renderEnd";

export interface LatencySummary {
  contextLatency: number | null;
  ttft: number | null;
  networkLatency: number | null;
  parseLatency: number | null;
  renderLatency: number | null;
  totalLatency: number;
}

/** 单次任务阶段计时（纯类，不依赖 Obsidian） */
export class LatencyTracker {
  private marks: Partial<Record<LatencyPhase, number>> = {};
  constructor() { this.marks.taskCreatedAt = Date.now(); }
  mark(phase: LatencyPhase): void { this.marks[phase] = Date.now(); }
  private diff(a: LatencyPhase, b: LatencyPhase): number | null {
    const va = this.marks[a];
    const vb = this.marks[b];
    if (va === undefined || vb === undefined) return null;
    return Math.max(0, vb - va);
  }
  summary(): LatencySummary {
    const now = Date.now();
    const end = this.marks.renderEnd ?? this.marks.parseEnd ?? this.marks.requestEnd ?? now;
    const start = this.marks.taskCreatedAt ?? now;
    return {
      contextLatency: this.diff("contextStart", "contextEnd"),
      ttft: this.diff("requestStart", "firstTokenAt"),
      networkLatency: this.diff("requestStart", "requestEnd"),
      parseLatency: this.diff("requestEnd", "parseEnd"),
      renderLatency: this.diff("parseEnd", "renderEnd"),
      totalLatency: Math.max(0, end - start),
    };
  }
}

export interface LatencySample {
  mode: string;      // fast | deep | ask-simple | ask-normal | ask-complex
  ttft: number | null;
  total: number;
  at: number;
}

/** P 分位（升序排序后取位置；输入空 → null） */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface LatencyCollectorShape {
  formatVersion: number;
  samples: LatencySample[];
}

/** 样本收集（cache/latency.json）：只存 mode / ttft / total / 时间戳 */
export class LatencyCollector {
  private samples: LatencySample[] = [];
  constructor(private file: string) {}
  load(): void {
    try {
      const raw = JSON.parse(require("fs").readFileSync(this.file, "utf8")) as LatencyCollectorShape;
      if (raw && Array.isArray(raw.samples)) this.samples = raw.samples.slice(0, 300);
    } catch {
      this.samples = [];
    }
  }
  record(mode: string, s: LatencySummary): void {
    this.samples.push({ mode, ttft: s.ttft, total: s.totalLatency, at: Date.now() });
    if (this.samples.length > 300) this.samples.splice(0, this.samples.length - 300);
    this.flush();
  }
  private values(mode: string, key: "ttft" | "total"): number[] {
    return this.samples.filter((x) => x.mode === mode && x[key] !== null && x[key] !== undefined).map((x) => x[key] as number);
  }
  count(mode: string): number { return this.samples.filter((x) => x.mode === mode).length; }
  avg(mode: string, key: "ttft" | "total"): number | null {
    const v = this.values(mode, key);
    if (!v.length) return null;
    return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
  }
  p95(mode: string, key: "ttft" | "total"): number | null {
    return percentile(this.values(mode, key), 95);
  }
  flush(): void {
    try { atomicWriteJson(this.file, { formatVersion: 1, samples: this.samples }); } catch { /* 写盘失败不阻塞 */ }
  }
}
