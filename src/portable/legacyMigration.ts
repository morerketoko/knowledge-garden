/**
 * Phase 24 §十一：旧桌面缓存 → 便携存储的一次性迁移。
 * Phase 24.x Hotfix（§六 / §七）：迁移**目标只能来自 `host.stateRoot`**。
 *
 * 事故回顾：本文件曾用 `joinVaultPath(STATE_DIR_NAME, rel)`（即字面 `.state/cache/…`）
 * 组装目标路径。虽然 host.resolve 通常能把它解析到正确的
 * `Knowledge Garden/.state/cache/…`，但只要 host 的 baseDir / stateRoot 组合稍有变化
 * （或未来有人改动状态根），字面路径就会写到 vault 根下的 `.state/`，业务却读
 * `Knowledge Garden/.state/` —— 旧数据就等于没迁移。因此这里改为直接用
 * `host.stateRoot`，不再让任何代码「猜」状态根（§七）。
 *
 * 迁移策略（严格遵守 §十一 / §十二 / §四十五）：
 *   Old Desktop Cache → read → validate → Portable Storage → write → **保留旧文件**
 *
 * - **只读不删**：旧文件永久保留（用户可自行清理），迁移只是「复制一份到新位置」。
 * - **只补缺失**：新位置已有该文件时绝不覆盖（避免覆盖新版本刚写的数据）。
 * - **空不算成功**：旧文件为空（0 条目）时不写空数据到正确位置（§三十一）。
 * - **坏文件跳过**：JSON 解析失败只记日志，不隔离、不删除（迁移不是恢复流程）。
 * - 同时支持 `knowledge-garden` 与 `kg-knowledge-garden` 两个旧目录名（§八）。
 */
import type { App } from "obsidian";
import type { PortableStorageHost } from "./host";
import { joinVaultPath } from "./paths";
import { jsonWeight } from "./recovery";

/** 需要迁移的状态文件（相对插件目录） */
export const LEGACY_STATE_FILES: string[] = [
  "cache/index.json",
  "cache/activity.json",
  "cache/ai-cache.json",
  "cache/ai-tasks.json",
  "cache/artifacts.json",
  "cache/cards.json",
  "cache/card-reviews.json",
  "cache/discovery.json",
  "cache/evolution.json",
  "cache/exam-sessions.json",
  "cache/exams.json",
  "cache/latency.json",
  "cache/projects.json",
  "cache/prompts.json",
  "cache/query-history.json",
  "cache/relationships.json",
  "cache/review-queue.json",
  "cache/review-session.json",
  "cache/saved-explorations.json",
  "cache/schedule.json",
  "cache/source-ledger.json",
  "cache/spaced-review.json",
  "cache/workbench-sessions.json",
];

/** 旧版目录内的 Markdown 资产（用户可见资产，同样复制不移动） */
export const LEGACY_ASSET_DIRS: string[] = ["prompts", "projects"];

export interface LegacyMigrationResult {
  /** 是否检测到旧桌面缓存目录 */
  detected: boolean;
  copied: string[];
  skippedExisting: string[];
  failed: string[];
  /** 旧文件存在但内容为空（0 条）→ 不写入，避免用空数据覆盖（§三十一） */
  skippedEmpty: string[];
  /** 迁移目标（人类可读，用于 Notice / Diagnostics） */
  target: string;
}

/** 旧插件目录在 vault 内的默认位置（按插件 id 推导，避免依赖 manifest.dir） */
export function legacyPluginDirCandidates(pluginId: string, configDir = ".obsidian"): string[] {
  const dirs = [joinVaultPath(configDir, "plugins", pluginId)];
  // §八：同时支持历史 id（旧版本曾用 kg-knowledge-garden）
  for (const alt of ["knowledge-garden", "kg-knowledge-garden"]) {
    const p = joinVaultPath(configDir, "plugins", alt);
    if (!dirs.includes(p)) dirs.push(p);
  }
  return dirs;
}

interface AdapterLike {
  exists?(path: string): Promise<boolean>;
  read?(path: string): Promise<string>;
  list?(path: string): Promise<{ files: string[]; folders: string[] }>;
}

/** 判断一段 JSON 文本是否「非空」（数组/集合字段有内容）——空数据不算迁移成功（§三十一） */
export function isNonEmptyStateJson(raw: string): boolean {
  try {
    return jsonWeight(JSON.parse(raw)) > 0;
  } catch {
    return false;
  }
}

/**
 * 执行迁移。返回结果供 Notice / Diagnostics 展示；任何异常都被吞掉（不阻塞启动）。
 */
export async function migrateLegacyState(
  app: App,
  host: PortableStorageHost,
  pluginId = "knowledge-garden"
): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = {
    detected: false, copied: [], skippedExisting: [], failed: [], skippedEmpty: [],
    target: host.stateRoot + "/",
  };
  const adapter = app.vault?.adapter as unknown as AdapterLike | undefined;
  if (!adapter?.exists) return result;

  const configDir = (app.vault as unknown as { configDir?: string }).configDir || ".obsidian";
  const candidates = legacyPluginDirCandidates(pluginId, configDir);

  for (const dir of candidates) {
    let hasLegacy = false;
    try { hasLegacy = await adapter.exists(joinVaultPath(dir, "cache")); } catch { hasLegacy = false; }
    if (!hasLegacy) continue;
    result.detected = true;

    for (const rel of LEGACY_STATE_FILES) {
      const src = joinVaultPath(dir, rel);
      // §六/§七：目标必须由 host.stateRoot 决定，绝不用字面 `.state`
      const dst = joinVaultPath(host.stateRoot, rel);
      try {
        const exists = await adapter.exists(src);
        if (!exists) continue;
        if (await host.exists(dst)) { result.skippedExisting.push(rel); continue; }
        const raw = adapter.read ? await adapter.read(src) : null;
        if (raw === null) { result.failed.push(rel); continue; }
        JSON.parse(raw); // validate：坏文件跳过（不隔离，§十二 只针对运行时损坏）
        if (!isNonEmptyStateJson(raw)) { result.skippedEmpty.push(rel); continue; } // §三十一
        const out = await host.write(dst, raw, { nativeAtomic: true });
        if (out.ok) result.copied.push(rel); else result.failed.push(rel);
      } catch {
        result.failed.push(rel);
      }
    }

    // Markdown 资产目录：逐文件复制（旧 prompts/projects → 状态根下同名目录）
    for (const assetDir of LEGACY_ASSET_DIRS) {
      const srcRoot = joinVaultPath(dir, assetDir);
      try {
        if (!(await adapter.exists(srcRoot))) continue;
        const walk = async (rel: string, depth: number): Promise<void> => {
          if (depth > 3) return;
          const listing = adapter.list ? await adapter.list(joinVaultPath(srcRoot, rel)) : null;
          if (!listing) return;
          for (const f of listing.files) {
            const relFile = joinVaultPath(assetDir, rel, f);
            const src = joinVaultPath(dir, relFile);
            const dst = joinVaultPath(host.stateRoot, relFile);
            try {
              if (await host.exists(dst)) { result.skippedExisting.push(relFile); continue; }
              const raw = adapter.read ? await adapter.read(src) : null;
              if (raw === null) { result.failed.push(relFile); continue; }
              const out = await host.write(dst, raw);
              if (out.ok) result.copied.push(relFile); else result.failed.push(relFile);
            } catch { result.failed.push(relFile); }
          }
          for (const d of listing.folders) await walk(joinVaultPath(rel, d), depth + 1);
        };
        await walk("", 0);
      } catch { /* 资产目录迁移失败不影响状态迁移 */ }
    }
  }
  return result;
}

/** 迁移结果的人类可读摘要（Notice 用；不暴露绝对路径） */
export function describeMigration(r: LegacyMigrationResult): string {
  if (!r.detected) return "未检测到旧版桌面缓存。";
  const parts = ["已迁移 " + r.copied.length + " 个状态文件到 " + r.target];
  if (r.skippedExisting.length) parts.push("跳过已存在 " + r.skippedExisting.length + " 个");
  if (r.skippedEmpty.length) parts.push("跳过空数据 " + r.skippedEmpty.length + " 个");
  if (r.failed.length) parts.push("失败 " + r.failed.length + " 个（旧文件已保留）");
  parts.push("旧文件未删除。");
  return parts.join("；");
}
