/**
 * Discovery Scope：全库知识奇想 + 可调节知识漫游范围（Discovery Scope 阶段）。
 * - 纯函数引擎（Scope 过滤 / 评分 / 多样性选择 / 确定性随机），无 Obsidian 依赖，便于 Node 自动测试。
 * - Discovery 与 Review Candidate 完全分离（§三十三）：不复用 buildReviewQueue，可复用 NoteMetadata / Activity。
 * - Exposure（§二十一~二十三）：AI Discovery 行为 ≠ 用户行为，只更新 cache/discovery.json，绝不写 activity。
 */
import * as fs from "fs";
import * as path from "path";
import { fingerprintKey } from "./ai/cache";
import { atomicWriteJson, FORMAT_VERSION, isolateCorruptFile } from "./migrations";
import type { ActivityEntry, DiscoveryMetaEntry, DiscoveryScope, KnowledgeArea } from "./types";
import type { NoteMetadata } from "./noteIndex";

/** 候选选择版本（§四十二）：diversity/scoring/exploration 变化时 v1 → v2，旧缓存自动失效 */
export const DISCOVERY_SELECTION_VERSION = "v1";

export type DiscoveryFeature = "curiosity" | "roaming";

export interface DiscoverySelectOpts {
  feature: DiscoveryFeature;
  count: number;
  dateKey: string;                 // YYYY-MM-DD（§二十八 seed 组成部分）
  scopeFingerprint: string;        // §二十八 seed 组成部分 + §四十 缓存指纹
  exploreOld?: boolean;            // 奇想：探索旧知识（§二十七 探索槽 10~20%）
  preferCrossArea?: boolean;       // 漫游：优先跨领域 / 图连接性（§三十五）
  getAct?: (path: string) => ActivityEntry | undefined;
  meta: Record<string, DiscoveryMetaEntry>;
  areas: KnowledgeArea[];
  now?: number;
}

/* ---------- Scope 指纹 / 过滤 ---------- */

/** Scope 规范串 → 独立指纹（§四十/四十一）：vault 与 areas 即使选出相同候选，Discovery Context 也不同 */
export function discoveryScopeFingerprint(scope: DiscoveryScope): string {
  const join = (v: string[] | undefined): string => (v ?? []).slice().sort().join("\u0000");
  return fingerprintKey([
    scope.mode,
    join(scope.areaNames),
    join(scope.folders),
    join(scope.tags),
    String(scope.recentDays ?? 0),
    String(scope.includeSubfolders ?? false),
    String(scope.includeUntagged ?? false),
    String(scope.includeUncategorized ?? false),
  ]);
}

/** 日期键（§二十八 seed 组成部分）：YYYY-MM-DD */
export function discoveryDateKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
}

/** 笔记属于哪个知识区域（与 review.main 的 reviewAreaOf 逻辑一致；无区域 → undefined） */
export function areaOfNote(
  notePath: string,
  areas: KnowledgeArea[],
  folderOf?: (p: string) => string
): string | undefined {
  for (const a of areas) {
    if (!a.folder) continue;
    if (notePath === a.folder + ".md" || notePath.startsWith(a.folder + "/")) return a.name;
  }
  const folder = folderOf ? folderOf(notePath) : (notePath.split("/")[0] ?? "");
  for (const a of areas) if (a.folder === folder) return a.name;
  return undefined;
}

/** 本地 Scope 过滤（§十七）：完全本地、零 AI 请求；大 Vault 只做 O(N) 元数据遍历 */
export function discoveryPool(
  notes: NoteMetadata[],
  scope: DiscoveryScope,
  areas: KnowledgeArea[]
): NoteMetadata[] {
  const mode = scope?.mode ?? "vault";
  const now = Date.now();
  const areaSet = new Set(scope?.areaNames ?? []);
  const folders = (scope?.folders ?? []).map((f) => f.replace(/\/+$/, ""));
  const tags = (scope?.tags ?? []).slice().sort();
  const recentDays = scope?.recentDays ?? 7;
  const includeSub = scope?.includeSubfolders ?? true;

  const matchesArea = (n: NoteMetadata): boolean => {
    const nm = areaOfNote(n.path, areas, (p) => p.split("/")[0] ?? "");
    return !!nm && (areaSet.size === 0 || areaSet.has(nm));
  };
  const matchesFolder = (n: NoteMetadata): boolean => {
    if (folders.length === 0) return true;
    return folders.some((f) =>
      includeSub ? n.path === f + ".md" || n.path.startsWith(f + "/") : n.folder === f
    );
  };
  const matchesTags = (n: NoteMetadata): boolean => {
    if (tags.length === 0) return true;
    return tags.some((t) => (n.tags ?? []).includes(t));
  };
  const matchesRecent = (n: NoteMetadata): boolean => {
    const ageDays = (now - n.modified) / 86400000;
    return ageDays <= recentDays;
  };

  return notes.filter((n) => {
    switch (mode) {
      case "vault":
        return true;
      case "areas":
        return matchesArea(n);
      case "folders":
        return matchesFolder(n);
      case "tags":
        return matchesTags(n);
      case "recent":
        return matchesRecent(n);
      case "custom":
        return (!areaSet.size || matchesArea(n)) && matchesFolder(n) && matchesTags(n)
          && (recentDays <= 0 || matchesRecent(n));
      default:
        return true;
    }
  });
}

/** Scope 显示标签（§六十八/六十九/四十九） */
export function discoveryScopeLabel(scope: DiscoveryScope, areas: KnowledgeArea[]): string {
  const s = scope ?? { mode: "vault" as const };
  switch (s.mode) {
    case "areas": {
      const names = (s.areaNames ?? []).filter((x) => areas.some((a) => a.name === x));
      return names.length ? "知识奇想 · " + names.join(" + ") : "指定知识区域";
    }
    case "folders":
      return "文件夹 · " + (s.folders ?? []).join(" + ");
    case "tags":
      return "标签 · " + (s.tags ?? []).join(" + ");
    case "recent":
      return "最近 " + (s.recentDays ?? 7) + " 天";
    case "custom":
      return "自定义范围";
    default:
      return "整个仓库";
  }
}

/* ---------- 确定性随机（§二十八）：seed = date + scopeFingerprint + feature，当天同 Scope 结果稳定 ---------- */

/** 哈希串 → [0,1) 确定性浮点（不依赖 Math.random） */
export function seededFloat(seedStr: string): number {
  const hex = fingerprintKey([seedStr]).slice(0, 8);
  return parseInt(hex, 16) / 0x100000000;
}

/* ---------- 候选选择（§十八/十九/二十五/二十六/二十七/三十四/三十五/八十三） ---------- */

interface ScoredNote {
  note: NoteMetadata;
  score: number;
  area: string | undefined;
  ageDays: number;
  exposure: DiscoveryMetaEntry;
}

function scoreDiscovery(ctx: DiscoverySelectOpts, n: NoteMetadata, now: number): ScoredNote {
  const area = areaOfNote(n.path, ctx.areas, (p) => p.split("/")[0] ?? "");
  const ageDays = Math.max(0, (now - n.modified) / 86400000);
  const act = ctx.getAct?.(n.path);
  const meta = ctx.meta[n.path] ?? {};
  const lastSeen = ctx.feature === "curiosity" ? meta.lastCuriositySeenAt : meta.lastRoamingSeenAt;
  const exposureCount = ctx.feature === "curiosity" ? (meta.curiosityExposureCount ?? 0) : (meta.roamingExposureCount ?? 0);

  // 连接潜力（§十八：connections 优先于 recency）
  const linkCount = Math.min(n.links.length, 10);
  const backlinkCount = Math.min(n.backlinks.length, 10);
  const connectionPotential = linkCount * 0.10 + backlinkCount * 0.12;

  // 跨区域优先（§二十六）：与其它知识区域的笔记有链接 → 更值得进入 Discovery
  let cross = 0;
  for (const b of n.backlinks) {
    const a = areaOfNote(b, ctx.areas, (p) => p.split("/")[0] ?? "");
    if (a && a !== area) cross++;
  }
  const crossArea = Math.min(cross, 5) / 5;

  // 少曝光（§二十）：很久没被 AI Discovery 看过 → 加分；从没看过 → 满值
  const underexposed = lastSeen ? Math.min((now - lastSeen) / 86400000, 90) / 90 : 1;

  // 长期价值（§十八 long-term importance）：老且仍有连接的知识
  const longTerm = Math.min(ageDays, 365) / 365 * 0.30 * (ctx.exploreOld !== false ? 1 : 0.4);

  // 适度最近活动（§十九/八十二：降权，不为主）
  const recentActivity =
    (1 / (1 + ageDays * 0.2)) * 0.25 +
    (act && typeof act.accessCount === "number" ? Math.min(act.accessCount, 20) / 20 * 0.10 : 0);

  // 过度曝光惩罚（§八十三 overexposurePenalty）
  const overExposurePenalty = Math.min(exposureCount, 10) * 0.08;

  // 确定性探索扰动（§二十八）：同一天同 Scope 稳定；不随刷新变化
  const exploration = seededFloat(ctx.feature + "\u0000" + ctx.dateKey + "\u0000" + ctx.scopeFingerprint + "\u0000" + n.path) * 0.35;

  const crossWeight = ctx.feature === "roaming" || ctx.preferCrossArea ? 0.60 : 0.40;
  const score =
    connectionPotential
    + crossArea * crossWeight
    + underexposed * 0.40
    + longTerm
    + recentActivity
    + exploration
    - overExposurePenalty;

  return { note: n, score, area, ageDays, exposure: meta };
}

/** 分区多样性（§二十五）：按区域分桶 round-robin，避免一个区域垄断；剩余槽位全局补齐 */
function diversify(scored: ScoredNote[], count: number): ScoredNote[] {
  if (scored.length <= count) return scored;
  const buckets = new Map<string | undefined, ScoredNote[]>();
  for (const s of scored) {
    const list = buckets.get(s.area) ?? [];
    list.push(s);
    buckets.set(s.area, list);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.score - a.score);
  const picked: ScoredNote[] = [];
  const used = new Set<string>();
  const keys = Array.from(buckets.keys());
  while (picked.length < count) {
    let added = false;
    for (const k of keys) {
      if (picked.length >= count) break;
      const list = buckets.get(k) ?? [];
      const next = list.find((s) => !used.has(s.note.path));
      if (next) {
        picked.push(next);
        used.add(next.note.path);
        added = true;
      }
    }
    if (!added) break;
  }
  if (picked.length < count) {
    for (const s of scored) {
      if (!used.has(s.note.path)) {
        picked.push(s);
        used.add(s.note.path);
        if (picked.length >= count) break;
      }
    }
  }
  return picked;
}

/** 探索槽（§二十七）：约 15% 来自「old / underexposed / low access」，不全部来自 forgotten，且不过度 */
function explorationSlots(
  pool: NoteMetadata[],
  ctx: DiscoverySelectOpts,
  now: number,
  slotCount: number
): ScoredNote[] {
  const scored = pool
    .map((n) => scoreDiscovery(ctx, n, now))
    .filter((s) => {
      if (s.ageDays < 60) return false;                    // 老知识
      const act = ctx.getAct?.(s.note.path);
      const access = typeof act?.accessCount === "number" ? act.accessCount : 0;
      const lastSeen = ctx.feature === "curiosity" ? s.exposure.lastCuriositySeenAt : s.exposure.lastRoamingSeenAt;
      return access <= 2 && (lastSeen === undefined || now - lastSeen > 14 * 86400000); // 低曝光
    })
    .sort((a, b) => {
      const u = (s: ScoredNote): number => {
        const lastSeen = ctx.feature === "curiosity" ? s.exposure.lastCuriositySeenAt : s.exposure.lastRoamingSeenAt;
        return lastSeen === undefined ? Number.MAX_SAFE_INTEGER : now - lastSeen;
      };
      return u(b) - u(a);
    })
    .map((s, i) => ({ s, r: seededFloat(ctx.feature + ":slot:" + ctx.dateKey + ":" + ctx.scopeFingerprint + ":" + i) }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.s);
  return scored.slice(0, slotCount);
}

/** Discovery Candidate Selection（§三十四/三十五）：本地排序 + 多样性 + 探索槽 → 固定数量候选 */
export function selectCandidates(pool: NoteMetadata[], opts: DiscoverySelectOpts): NoteMetadata[] {
  const now = opts.now ?? Date.now();
  const count = Math.max(1, Math.min(32, Math.floor(opts.count) || 16));
  if (pool.length === 0) return [];
  if (pool.length === 1) return pool;

  const scored = pool
    .map((n) => scoreDiscovery(opts, n, now))
    .sort((a, b) => b.score - a.score);

  const slotCount = opts.exploreOld !== false ? Math.max(1, Math.round(count * 0.15)) : 0;
  const slots = slotCount > 0 ? explorationSlots(pool, opts, now, slotCount) : [];

  const mainCount = Math.max(0, count - slots.length);
  let main = diversify(scored, Math.min(mainCount, scored.length));
  const used = new Set(main.map((s) => s.note.path));
  for (const s of slots) {
    if (used.has(s.note.path)) continue;
    main.push(s);
    used.add(s.note.path);
  }
  while (main.length < count) {
    const rest = scored.find((s) => !used.has(s.note.path));
    if (!rest) break;
    main.push(rest);
    used.add(rest.note.path);
  }
  return main.slice(0, count).map((s) => s.note);
}

/* ---------- DiscoveryScore 不导出；这里只导出给 Dashboard 的统计 ---------- */

export function discoveryPoolCount(pool: NoteMetadata[]): number {
  return pool.length;
}

/* ---------- DiscoveryStore：cache/discovery.json（§二十二/四十四/四十五） ---------- */

export class DiscoveryStore {
  private file: string;
  private data: Record<string, DiscoveryMetaEntry> = {};

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "discovery.json");
  }

  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后重建空结构（§九 通用策略），返回是否隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { entries?: Record<string, DiscoveryMetaEntry> };
      if (!raw || typeof raw !== "object") throw new Error("invalid discovery structure");
      if (raw.entries && typeof raw.entries === "object") this.data = raw.entries;
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.data = {};
      return isolated;
    }
  }

  get(path: string): DiscoveryMetaEntry | undefined {
    return this.data[path];
  }

  allEntries(): Record<string, DiscoveryMetaEntry> {
    return this.data;
  }

  /**
   * 曝光记录（§二十三/四十五）：只在「真正生成/确认使用候选集」时调用（非缓存命中）。
   * 同一 Feature 重复记录 → lastSeenAt 更新 + count 累加（真实多次曝光）；Dashboard 刷新绝不触发。
   */
  recordExposure(paths: string[], feature: DiscoveryFeature, now = Date.now()): void {
    let changed = false;
    for (const p of paths) {
      const e = this.data[p] ?? {};
      if (feature === "curiosity") {
        e.lastCuriositySeenAt = now;
        e.curiosityExposureCount = (e.curiosityExposureCount ?? 0) + 1;
      } else {
        e.lastRoamingSeenAt = now;
        e.roamingExposureCount = (e.roamingExposureCount ?? 0) + 1;
      }
      this.data[p] = e;
      changed = true;
    }
    if (changed) this.flush();
  }

  /** 删除已不存在笔记的曝光条目（配合 pruneActivity 生命周期） */
  prune(existingPaths: Set<string>): void {
    let changed = false;
    for (const p of Object.keys(this.data)) {
      if (!existingPaths.has(p)) {
        delete this.data[p];
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  flush(): void {
    try {
      atomicWriteJson(this.file, { formatVersion: FORMAT_VERSION, entries: this.data });
    } catch { /* 写盘失败不阻塞运行 */ }
  }
}