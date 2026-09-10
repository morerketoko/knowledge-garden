/**
 * Phase 24 §十一：旧桌面缓存 → 便携存储的一次性迁移。
 *
 * 背景：Phase 9–23 的桌面版本把插件状态写在
 *   `.obsidian/plugins/knowledge-garden/cache/*.json`
 * （Node fs 直接落盘）。移动端既没有 Node fs，也不能稳定读写 `.obsidian`，
 * 因此新版本把状态写到 `Knowledge Garden/.state/`（Obsidian Vault API）。
 *
 * 迁移策略（严格遵守 §十一 / §十二）：
 *   Old Desktop Cache → read → validate → Portable Storage → write → **保留旧文件**
 *
 * - **只读不删**：旧文件永久保留（用户可自行清理），迁移只是「复制一份到新位置」。
 * - **只补缺失**：新位置已有该文件时绝不覆盖（避免覆盖新版本刚写的数据）。
 * - **坏文件跳过**：JSON 解析失败只记日志，不隔离、不删除（迁移不是恢复流程）。
 * - 迁移只在有旧目录时执行，失败不阻塞插件启动。
 */
import type { App } from "obsidian";
import type { PortableStorageHost } from "./host";
import { STATE_DIR_NAME } from "./host";
import { joinVaultPath } from "./paths";

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
  /** 迁移目标（人类可读，用于 Notice / Diagnostics） */
  target: string;
}

/** 旧插件目录在 vault 内的默认位置（按插件 id 推导，避免依赖 manifest.dir） */
export function legacyPluginDirCandidates(pluginId: string, configDir = ".obsidian"): string[] {
  return [joinVaultPath(configDir, "plugins", pluginId), joinVaultPath(configDir, "plugins", "kg-knowledge-garden")];
}

interface AdapterLike {
  exists?(path: string): Promise<boolean>;
  read?(path: string): Promise<string>;
  list?(path: string): Promise<{ files: string[]; folders: string[] }>;
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
    detected: false, copied: [], skippedExisting: [], failed: [],
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
      const dst = joinVaultPath(STATE_DIR_NAME, rel); // host.resolve 会补上 stateRoot 前缀
      try {
        const exists = await adapter.exists(src);
        if (!exists) continue;
        if (await host.exists(dst)) { result.skippedExisting.push(rel); continue; }
        const raw = adapter.read ? await adapter.read(src) : null;
        if (raw === null) { result.failed.push(rel); continue; }
        JSON.parse(raw); // validate：坏文件跳过（不隔离，§十二 只针对运行时损坏）
        const out = await host.write(dst, raw, { nativeAtomic: true });
        if (out.ok) result.copied.push(rel); else result.failed.push(rel);
      } catch {
        result.failed.push(rel);
      }
    }

    // Markdown 资产目录：逐文件复制（旧 prompts/projects → .state 下同名目录）
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
            const dst = joinVaultPath(STATE_DIR_NAME, relFile);
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
    break; // 只处理第一个命中的旧目录
  }
  return result;
}

/** 迁移结果的人类可读摘要（Notice 用；不暴露绝对路径） */
export function describeMigration(r: LegacyMigrationResult): string {
  if (!r.detected) return "未检测到旧版桌面缓存。";
  const parts = ["已迁移 " + r.copied.length + " 个状态文件到 " + r.target];
  if (r.skippedExisting.length) parts.push("跳过已存在 " + r.skippedExisting.length + " 个");
  if (r.failed.length) parts.push("失败 " + r.failed.length + " 个（旧文件已保留）");
  parts.push("旧文件未删除。");
  return parts.join("；");
}
