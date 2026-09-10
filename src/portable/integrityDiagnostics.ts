/**
 * Phase 24.2 §十七~§二十二：**只报告、不伪造**的完整性诊断。
 *
 * 三个纯函数：
 * - `activityIntegrityReport()`   —— Activity 覆盖率事实（§十七）
 * - `knowledgeStateDiagnostics()` —— 五态分布 + created/modified 年龄桶（§十八）
 * - `createdIntegrityReport()`    —— created 时间是否异常集中（§二十一/§二十二）
 *
 * 原则：这些函数**只统计与说明**，绝不修改 `created`、绝不从 modified 伪造 created、
 * 也绝不为了让 Dashboard「看起来正常」而改动 `deriveState` 的阈值（§二十/§二十二）。
 */
import type { ActivityEntry, KGState } from "../types";
import type { NoteMetadata } from "../noteIndex";
import { deriveState, stateCounts, type KGRules } from "../knowledgeState";

const DAY = 86400000;

/* ---------------- §十七：Activity 诊断 ---------------- */

export interface ActivityIntegrityReport {
  activityEntries: number;
  indexedNotes: number;
  /** activity / indexed，0..1；indexed=0 时为 0 */
  activityCoverage: number;
  accessedEntries: number;
  reviewedEntries: number;
  /** 有 lastAccessedAt 的比例 */
  accessedCoverage: number;
  reviewedCoverage: number;
  /** 只解释事实，不声称「已恢复」（§十七） */
  note: string;
}

export function activityIntegrityReport(
  activity: Map<string, ActivityEntry> | { all(): ActivityEntry[] },
  indexedNotes: number
): ActivityIntegrityReport {
  const entries: ActivityEntry[] = activity instanceof Map
    ? Array.from(activity.values())
    : activity.all();
  const total = entries.length;
  const accessed = entries.filter((e) => typeof e.lastAccessedAt === "number").length;
  const reviewed = entries.filter((e) => typeof e.lastReviewedAt === "number").length;
  const cov = (n: number): number => (indexedNotes > 0 ? n / indexedNotes : 0);
  const pct = (x: number): string => (x * 100).toFixed(3) + "%";
  return {
    activityEntries: total,
    indexedNotes,
    activityCoverage: cov(total),
    accessedEntries: accessed,
    reviewedEntries: reviewed,
    accessedCoverage: cov(accessed),
    reviewedCoverage: cov(reviewed),
    note: "Activity " + total + " / " + indexedNotes + "（覆盖 " + pct(cov(total))
      + "）。Activity 只能来自 activity.json / 备份；不存在的历史访问不可重建，也不会被伪造。",
  };
}

/* ---------------- §十八：Knowledge State 诊断 ---------------- */

export interface AgeBuckets {
  lt7d: number;
  d7to30: number;
  d30to90: number;
  d90to365: number;
  gt365: number;
}

export interface KnowledgeStateDiagnostics {
  indexedNotes: number;
  stateCounts: Record<KGState, number>;
  createdAgeBuckets: AgeBuckets;
  modifiedAgeBuckets: AgeBuckets;
  /** §二十一：created 是否异常集中在最近 7 天 */
  createdConcentratedIn7d: boolean;
  createdConcentratedRatio: number;
  /** 明确结论：new 主要由什么决定（§十九） */
  newDrivenBy: "created_time" | "activity_missing" | "mixed" | "none";
  note: string;
}

function bucketOf(ageDays: number | null, kind: "created" | "modified"): keyof AgeBuckets {
  if (ageDays === null || !Number.isFinite(ageDays)) return kind === "created" ? "gt365" : "gt365";
  if (ageDays < 7) return "lt7d";
  if (ageDays < 30) return "d7to30";
  if (ageDays < 90) return "d30to90";
  if (ageDays < 365) return "d90to365";
  return "gt365";
}

function emptyBuckets(): AgeBuckets {
  return { lt7d: 0, d7to30: 0, d30to90: 0, d90to365: 0, gt365: 0 };
}

/**
 * §十八/§十九：状态分布 + 年龄桶；并给出「全部 new 的原因」判断。
 *
 * 判定逻辑（§十九）：
 * - created <7d ≈ indexedCount 且 new ≈ indexedCount → `created_time`
 * - created 分布正常，但 activity 覆盖极低 → `activity_missing`
 * - 两者都成立 → `mixed`
 */
export function knowledgeStateDiagnostics(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  rules: KGRules,
  now = Date.now()
): KnowledgeStateDiagnostics {
  const created = emptyBuckets();
  const modified = emptyBuckets();
  for (const n of notes) {
    const cd = typeof n.created === "number" ? (now - n.created) / DAY : null;
    const md = typeof n.modified === "number" ? (now - n.modified) / DAY : null;
    created[bucketOf(cd, "created")]++;
    modified[bucketOf(md, "modified")]++;
  }
  const counts = stateCounts(notes, getAct, rules, now);
  const total = notes.length;
  const created7 = total > 0 ? created.lt7d / total : 0;
  const newRatio = total > 0 ? counts.new / total : 0;

  const accessedCount = notes.filter((n) => {
    const a = getAct(n.path);
    return a && (typeof a.lastAccessedAt === "number" || typeof a.lastReviewedAt === "number");
  }).length;
  const activityRatio = total > 0 ? accessedCount / total : 0;

  const createdDriven = created7 >= 0.95 && newRatio >= 0.9;
  const activityDriven = activityRatio < 0.05 && created7 < 0.95;
  const driven: KnowledgeStateDiagnostics["newDrivenBy"] =
    createdDriven && activityDriven ? "mixed" : createdDriven ? "created_time" : activityDriven ? "activity_missing" : "none";

  const pct = (x: number): string => (x * 100).toFixed(1) + "%";
  let note: string;
  if (driven === "created_time") {
    note = "created 时间集中在最近 7 天（" + pct(created7) + "），new 占比 " + pct(newRatio)
      + " → “全部 new”主要由 created 时间决定（不是 Activity 丢失）。";
  } else if (driven === "activity_missing") {
    note = "created 分布正常，但只有 " + pct(activityRatio) + " 篇笔记有 Activity → "
      + "active/growing/forgotten 会因 Activity 缺失而下降。";
  } else if (driven === "mixed") {
    note = "created 集中在 7 天内（" + pct(created7) + "）且 Activity 覆盖仅 " + pct(activityRatio)
      + " → “全部 new”由 created 时间与 Activity 缺失共同造成。";
  } else {
    note = "分布正常：new " + pct(newRatio) + "，Activity 覆盖 " + pct(activityRatio) + "。";
  }
  return {
    indexedNotes: total,
    stateCounts: counts,
    createdAgeBuckets: created,
    modifiedAgeBuckets: modified,
    createdConcentratedIn7d: created7 >= 0.95,
    createdConcentratedRatio: created7,
    newDrivenBy: driven,
    note,
  };
}

/* ---------------- §二十一/§二十二：created 完整性 ---------------- */

export interface CreatedIntegrityReport {
  total: number;
  /** created > now + 1 天（明显异常） */
  future: number;
  /** created <= now */
  past: number;
  within7d: number;
  within30d: number;
  /** within7d / total */
  concentratedIn7d: number;
  /** created 早于 modified 的数量（正常应为绝大多数） */
  createdAfterModified: number;
  /** 是否触发「可能大量判为 new」告警 */
  warnConcentrated: boolean;
  note: string;
}

export function createdIntegrityReport(notes: NoteMetadata[], now = Date.now()): CreatedIntegrityReport {
  const total = notes.length;
  let future = 0, past = 0, within7d = 0, within30d = 0, createdAfterModified = 0;
  for (const n of notes) {
    if (typeof n.created !== "number") continue;
    if (n.created > now + DAY) future++;
    else past++;
    if (now - n.created <= 7 * DAY) within7d++;
    if (now - n.created <= 30 * DAY) within30d++;
    if (typeof n.modified === "number" && n.created > n.modified + DAY) createdAfterModified++;
  }
  const ratio = total > 0 ? within7d / total : 0;
  const warn = ratio >= 0.95 && total > 10;
  return {
    total, future, past, within7d, within30d,
    concentratedIn7d: ratio,
    createdAfterModified,
    warnConcentrated: warn,
    note: warn
      ? "created 时间集中在最近 7 天（" + (ratio * 100).toFixed(1) + "%），可能导致大量笔记判定为 new。"
        + "本插件不会自动修改 created（§二十二：禁止用 modified/now 覆盖 created）。"
      : "created 时间分布正常（7 天内 " + (ratio * 100).toFixed(1) + "%）。",
  };
}
