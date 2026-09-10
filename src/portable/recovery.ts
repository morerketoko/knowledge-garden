/**
 * Phase 24.x Critical Data Recovery（§一 / §八~§三十七）：状态发现、备份、选择与恢复。
 *
 * 背景：v1.0.x 桌面版把插件状态写在 `.obsidian/plugins/knowledge-garden/cache/`。
 * Phase 24 改为 `Knowledge Garden/.state/`，期间出现两类缺陷，导致「数据看起来消失」：
 *
 *  1. `VaultRoot.full()` 重复拼接 → 状态被写到 `<stateRoot>/<baseDir>/<stateRoot>/…` 嵌套层，
 *     而读取走 `<stateRoot>/cache/…`（已修复并新增 repairDuplicatedLayout）。
 *  2. `atomicWriteJson` 的 tmp→rename 只更新内存镜像，目标文件常常仍是**旧字节**
 *     （典型：index.json 507B = 1 条笔记，index.json.tmp 12.7KB = 37 条）。
 *     读取因此只能看到残缺状态。
 *
 * 本模块只做两件事，都严格遵守「先备份、只复制、绝不静默覆盖」：
 *  - `diagnoseStateSources()`：列出每个状态文件在 legacy / correct / wrong / nested /
 *    plugin-data 五个来源里的存在性与规模（§三 / §四）。
 *  - `recoverState()`：按信息量选择最佳候选并写入正确位置，冲突一律记录（§九 / §十 / §二十九
 *    ~§三十二）。空数据永远不被当作「迁移成功」（§三十一）。
 *
 * 本模块不依赖 Obsidian API（只依赖 host / root），便于 Node 自动测试。
 */
import type { PortableStorageHost } from "./host";
import { STATE_DIR_NAME } from "./host";
import { joinVaultPath } from "./paths";

/** 恢复备份根目录（vault 根下，独立于状态根） */
export const RECOVERY_BACKUP_ROOT = ".state-recovery";

/** 状态文件注册表：相对状态根（cache/ 下），并给出「信息量」估算器（§四 / §三十二） */
export interface StateFileSpec {
  /** 状态根下的相对路径，例如 cache/cards.json */
  rel: string;
  /** 人类可读名（诊断展示） */
  label: string;
  /** 从解析后的 JSON 估算条目数（用于冲突比较，§二十九） */
  measure?: (v: unknown) => number;
}

/** 通用 JSON 规模估算：优先数组长度，其次常见集合字段，最后键数（§二十九） */
export function jsonWeight(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "object") return 0;
  const o = value as Record<string, unknown>;
  for (const k of ["entries", "snapshots", "templates", "records", "sessions", "cards", "logs", "reviewLogs"]) {
    const v = o[k];
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v as object).length;
  }
  if (o["queue"] && typeof o["queue"] === "object") {
    const items = (o["queue"] as Record<string, unknown>)["items"];
    if (Array.isArray(items)) return items.length;
  }
  return Object.keys(o).length;
}

export const STATE_FILES: StateFileSpec[] = [
  { rel: "cache/index.json", label: "笔记索引" },
  { rel: "cache/activity.json", label: "访问/复习行为", measure: (v) => (v && typeof v === "object" ? Object.keys(v as object).length : 0) },
  { rel: "cache/ai-cache.json", label: "AI 缓存" },
  { rel: "cache/ai-tasks.json", label: "AI 任务" },
  { rel: "cache/artifacts.json", label: "Artifact 索引" },
  { rel: "cache/cards.json", label: "复习卡索引" },
  { rel: "cache/card-reviews.json", label: "复习卡历史" },
  { rel: "cache/discovery.json", label: "发现曝光" },
  { rel: "cache/evolution.json", label: "知识演化快照" },
  { rel: "cache/exam-sessions.json", label: "考试会话" },
  { rel: "cache/exams.json", label: "考试索引" },
  { rel: "cache/latency.json", label: "延迟样本" },
  { rel: "cache/projects.json", label: "项目索引" },
  { rel: "cache/prompts.json", label: "Prompt 元数据" },
  { rel: "cache/query-history.json", label: "最近探索" },
  { rel: "cache/relationships.json", label: "知识关系" },
  { rel: "cache/review-queue.json", label: "复习队列" },
  { rel: "cache/review-session.json", label: "复习会话" },
  { rel: "cache/saved-explorations.json", label: "收藏链路" },
  { rel: "cache/schedule.json", label: "复盘调度" },
  { rel: "cache/source-ledger.json", label: "来源台账" },
  { rel: "cache/spaced-review.json", label: "FSRS 状态" },
  { rel: "cache/workbench-sessions.json", label: "Workbench 会话" },
];

/* ------------------------------------------------------------------ */
/* 诊断（§三 / §四）                                                    */
/* ------------------------------------------------------------------ */

export type SourceKind = "legacy" | "correct" | "wrong" | "nested" | "pluginData" | "legacyBak";

export interface SourceInfo {
  kind: SourceKind;
  path: string;
  found: boolean;
  chars: number;
  valid: boolean;
  weight: number;
}

export interface FileDiagnosis {
  rel: string;
  label: string;
  sources: SourceInfo[];
  /** 各来源里信息量最大的那个（用于报告「恢复前」规模） */
  best?: SourceInfo;
}

export interface StateSourceOptions {
  /** 状态根（host.stateRoot），例如 Knowledge Garden/.state */
  stateRoot: string;
  /** 旧插件目录候选（vault 相对） */
  legacyDirs: string[];
  /** 错误迁移目录候选（vault 相对，例如 `.state`） */
  wrongDirs: string[];
  /** 嵌套层候选（vault 相对） */
  nestedDirs: string[];
  /** 读取某个 vault 相对路径的文本（null = 不存在） */
  read: (rel: string) => Promise<string | null>;
  /** Plugin Data 镜像快照：镜像键 → 文本（键形如 cache/cards.json） */
  pluginData?: Record<string, string>;
}

/** 探测所有来源；只读，不做任何写入（§三） */
export async function diagnoseStateSources(opts: StateSourceOptions): Promise<FileDiagnosis[]> {
  const out: FileDiagnosis[] = [];
  for (const spec of STATE_FILES) {
    const sources: SourceInfo[] = [];
    const add = (kind: SourceKind, path: string, raw: string | null): void => {
      if (raw === null || raw === undefined) {
        sources.push({ kind, path, found: false, chars: 0, valid: false, weight: 0 });
        return;
      }
      let valid = false;
      let weight = 0;
      try {
        weight = spec.measure ? spec.measure(JSON.parse(raw)) : jsonWeight(JSON.parse(raw));
        valid = true;
      } catch { valid = false; }
      sources.push({ kind, path, found: true, chars: raw.length, valid, weight });
    };

    for (const d of opts.legacyDirs) add("legacy", joinVaultPath(d, spec.rel), await safeRead(opts, joinVaultPath(d, spec.rel)));
    add("correct", joinVaultPath(opts.stateRoot, spec.rel), await safeRead(opts, joinVaultPath(opts.stateRoot, spec.rel)));
    for (const d of opts.wrongDirs) add("wrong", joinVaultPath(d, spec.rel), await safeRead(opts, joinVaultPath(d, spec.rel)));
    for (const d of opts.nestedDirs) add("nested", joinVaultPath(d, spec.rel), await safeRead(opts, joinVaultPath(d, spec.rel)));
    const mirror = opts.pluginData?.[spec.rel] ?? opts.pluginData?.[joinVaultPath(STATE_DIR_NAME, spec.rel)] ?? null;
    add("pluginData", "plugin-data://" + spec.rel, mirror);

    const best = sources.filter((s) => s.found && s.valid).sort((a, b) => b.weight - a.weight || b.chars - a.chars)[0];
    out.push({ rel: spec.rel, label: spec.label, sources, best });
  }
  return out;
}

async function safeRead(opts: StateSourceOptions, rel: string): Promise<string | null> {
  try { return await opts.read(rel); } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* 备份（§五 / §六十）                                                  */
/* ------------------------------------------------------------------ */

export interface BackupResult {
  dir: string;
  files: number;
  at: number;
}

/**
 * 只读备份：把所有已发现的来源原样复制到 `<stateRoot>-recovery/<stamp>/`。
 * 绝不删除、绝不改写任何原文件。
 */
export async function backupSources(
  storage: PortableStorageHost,
  opts: StateSourceOptions,
  stamp: string
): Promise<BackupResult> {
  // 备份目录放在 vault 根的 `.state-recovery/<stamp>/`：完全独立于状态根，
  // 不会被当成状态文件，也不会与用户的 Knowledge Garden/ 目录混在一起。
  const dir = joinVaultPath(RECOVERY_BACKUP_ROOT, stamp);
  let files = 0;
  for (const spec of STATE_FILES) {
    const candidates: { rel: string; raw: string | null }[] = [];
    for (const d of opts.legacyDirs) candidates.push({ rel: joinVaultPath(d, spec.rel), raw: await safeRead(opts, joinVaultPath(d, spec.rel)) });
    candidates.push({ rel: joinVaultPath(opts.stateRoot, spec.rel), raw: await safeRead(opts, joinVaultPath(opts.stateRoot, spec.rel)) });
    for (const d of opts.wrongDirs) candidates.push({ rel: joinVaultPath(d, spec.rel), raw: await safeRead(opts, joinVaultPath(d, spec.rel)) });
    for (const d of opts.nestedDirs) candidates.push({ rel: joinVaultPath(d, spec.rel), raw: await safeRead(opts, joinVaultPath(d, spec.rel)) });

    let i = 0;
    for (const c of candidates) {
      if (c.raw === null) continue;
      i++;
      const name = spec.rel.split("/").pop() ?? "file.json";
      const flat = c.rel.replace(/[\\/]/g, "__");
      const ok = await storage.writeRaw(joinVaultPath(dir, flat + (i > 1 ? "." + i : "")), c.raw);
      if (ok) files++;
    }
  }
  const mirrorKeys = Object.keys(opts.pluginData ?? {});
  if (mirrorKeys.length) {
    const json = JSON.stringify(opts.pluginData, null, 0);
    const okMirror = await storage.writeRaw(joinVaultPath(dir, "plugin-data-mirror.json"), json);
    if (okMirror) files++;
  }
  return { dir, files, at: Date.now() };
}

/* ------------------------------------------------------------------ */
/* 恢复（§九 / §十 / §二十九~§三十七）                                   */
/* ------------------------------------------------------------------ */

export interface RecoveryAction {
  rel: string;
  label: string;
  /** 采用的来源 */
  from: SourceKind | "none";
  fromPath: string;
  /** 该文件在正确位置原本的信息量 */
  beforeWeight: number;
  /** 恢复后的信息量 */
  afterWeight: number;
  /** 判定说明（人类可读） */
  reason: string;
  /** 是否发生了写入 */
  written: boolean;
}

export interface RecoveryReport {
  /** 是否需要恢复（false = 已有正确数据，仅做一致性检查） */
  needed: boolean;
  actions: RecoveryAction[];
  /** 恢复前各文件最大信息量（报告用） */
  before: Record<string, number>;
  /** 恢复后各文件信息量 */
  after: Record<string, number>;
  /** 无法恢复（所有来源都为空/无效） */
  missing: string[];
  /** 冲突（两个非空来源不同）：已保留信息量更大者，并记录（§二十九） */
  conflicts: string[];
}

/**
 * 选择并恢复：正确位置为空/无效时，按 legacy → wrong → nested → pluginData 的顺序，
 * 采用**信息量最大**的合法候选；正确位置已有非空合法数据时绝不覆盖（§十）。
 */
export async function recoverState(
  storage: PortableStorageHost,
  opts: StateSourceOptions,
  diagnoses?: FileDiagnosis[]
): Promise<RecoveryReport> {
  const report: RecoveryReport = { needed: false, actions: [], before: {}, after: {}, missing: [], conflicts: [] };
  const diags = diagnoses ?? (await diagnoseStateSources(opts));

  for (const diag of diags) {
    const correct = diag.sources.find((s) => s.kind === "correct");
    const correctUsable = !!correct && correct.found && correct.valid && correct.weight > 0;
    const beforeWeight = correctUsable ? (correct as SourceInfo).weight : 0;
    report.before[diag.rel] = beforeWeight;

    if (correctUsable) {
      report.after[diag.rel] = beforeWeight;
      report.actions.push({
        rel: diag.rel, label: diag.label, from: "correct", fromPath: (correct as SourceInfo).path,
        beforeWeight, afterWeight: beforeWeight, reason: "正确位置已有非空合法数据 → 不覆盖（§十）", written: false,
      });
      // 冲突记录：其他来源存在且信息量不同（不覆盖，仅报告，§二十九）
      const others = diag.sources.filter((s) => s.kind !== "correct" && s.found && s.valid && s.weight > 0 && s.weight !== beforeWeight);
      if (others.length) {
        report.conflicts.push(diag.rel + "：正确位置 " + beforeWeight + " vs " + others.map((o) => o.kind + " " + o.weight).join(" / "));
      }
      continue;
    }

    // 正确位置为空/无效/缺失 → 选最佳候选
    const candidates = diag.sources
      .filter((s) => s.kind !== "correct" && s.found && s.valid && s.weight > 0)
      .sort((a, b) => b.weight - a.weight || b.chars - a.chars);
    if (!candidates.length) {
      report.missing.push(diag.rel);
      report.after[diag.rel] = 0;
      report.actions.push({
        rel: diag.rel, label: diag.label, from: "none", fromPath: "",
        beforeWeight, afterWeight: 0, reason: "所有来源都为空/无效 → 无法恢复（不会写入空数据假装成功，§三十一）", written: false,
      });
      continue;
    }
    const pick = candidates[0];
    const raw = pick.kind === "pluginData"
      ? (opts.pluginData?.[diag.rel] ?? opts.pluginData?.[joinVaultPath(STATE_DIR_NAME, diag.rel)] ?? null)
      : await safeRead(opts, pick.path);
    if (raw === null) {
      report.missing.push(diag.rel);
      continue;
    }
    const target = joinVaultPath(opts.stateRoot, diag.rel);
    const out = await storage.write(target, raw, { nativeAtomic: true });
    const after = out.ok ? pick.weight : 0;
    report.needed = report.needed || out.ok;
    report.after[diag.rel] = after;
    report.actions.push({
      rel: diag.rel, label: diag.label, from: pick.kind, fromPath: pick.path,
      beforeWeight, afterWeight: after,
      reason: "正确位置为空/无效 → 采用信息量最大的 " + pick.kind + "（" + pick.weight + " 条）",
      written: out.ok,
    });
    if (candidates.length > 1) {
      report.conflicts.push(diag.rel + "：候选 " + candidates.map((c) => c.kind + " " + c.weight).join(" / ") + " → 取 " + pick.kind);
    }
  }
  return report;
}

/** 恢复摘要（Notice / Diagnostics 用） */
export function describeRecovery(r: RecoveryReport): string {
  const written = r.actions.filter((a) => a.written);
  if (!written.length) {
    return r.missing.length
      ? "未恢复任何状态（" + r.missing.length + " 个文件在所有来源都为空）"
      : "状态已是最新，无需恢复";
  }
  const gained = written.reduce((a, x) => a + Math.max(0, x.afterWeight - x.beforeWeight), 0);
  const parts = ["已恢复 " + written.length + " 个状态文件（新增 " + gained + " 条记录）"];
  if (r.conflicts.length) parts.push("冲突 " + r.conflicts.length + " 处已取信息量更大者");
  if (r.missing.length) parts.push(r.missing.length + " 个文件无可用数据");
  return parts.join("；");
}
