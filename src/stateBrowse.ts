/** Phase 11：状态随机浏览（State Browse，§四~十六 / §一百二十四~一百二十六）。纯函数引擎，0 AI。
 * - 范围解析复用 DiscoveryScope（discoveryPool）；discovery 模式 = 当前 Discovery Scope（漫游范围）。
 * - 只在本地按 KnowledgeState 五态筛选；绝不调用 AI（§一百二十六）。
 * - 随机：Math.floor(Math.random()*len)；候选>1 时排除上次随机打开的笔记（§一百四十五/一百八十九：只保存 last path）。
 * - 只读 NoteMetadata + Activity + KnowledgeState + Scope，不读正文全文（§四）。
 */
import { discoveryPool } from "./discovery";
import { deriveState } from "./knowledgeState";
import type { ActivityEntry, DiscoveryScope, KGState, KnowledgeArea, StateBrowseConfig } from "./types";
import type { NoteMetadata } from "./noteIndex";

/** 状态浏览范围 → 候选笔记池（0 AI；复用 Discovery Scope 过滤逻辑，§一百二十四） */
export function resolveStateBrowseScope(
  config: StateBrowseConfig | undefined,
  notes: NoteMetadata[],
  areas: KnowledgeArea[],
  currentDiscoveryScope: DiscoveryScope | undefined
): NoteMetadata[] {
  const cfg = config ?? { mode: "vault" as const };
  const mode = cfg.mode ?? "vault";
  if (mode === "vault") return notes;
  if (mode === "discovery") {
    // 「当前 Discovery Scope」：复用今日知识漫游的探索范围（§三/一百二十六）
    return currentDiscoveryScope ? discoveryPool(notes, currentDiscoveryScope, areas) : notes;
  }
  const scope: DiscoveryScope = {
    mode, // areas | folders | tags | recent | custom（与 DiscoveryScopeMode 兼容）
    areaNames: cfg.areaNames,
    folders: cfg.folders,
    tags: cfg.tags,
    recentDays: cfg.recentDays,
    includeSubfolders: cfg.includeSubfolders,
  } as DiscoveryScope;
  return discoveryPool(notes, scope, areas);
}

/** 五态筛选（§一百四十二：纯本地规则，0 AI；复用 knowledgeState.deriveState） */
export function getNotesByState(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  rules: { newDays: number; staleDays: number; forgottenDays: number },
  state: KGState,
  now = Date.now()
): NoteMetadata[] {
  return notes.filter((n) => deriveState(n, getAct(n.path), rules, now) === state);
}

/** 随机选一篇；候选>1 且 lastPath 存在时优先排除上次（§一百四十五/一百八十九：只保存 last path） */
export function pickRandomNote(candidates: NoteMetadata[], lastPath: string | undefined): NoteMetadata | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  const pick = (pool: NoteMetadata[]): NoteMetadata | undefined => {
    const i = Math.floor(Math.random() * pool.length);
    return pool[i] ?? pool[0];
  };
  if (candidates.length === 1 || !lastPath) return pick(candidates);
  const others = candidates.filter((n) => n.path !== lastPath);
  return pick(others.length > 0 ? others : candidates);
}

/** 状态显示名（与 Dashboard 状态卡一致） */
export function stateBrowseLabel(state: KGState): string {
  const map: Record<KGState, string> = {
    new: "🌱 新知识",
    growing: "📈 正在增长",
    active: "● 活跃",
    stale: "○ 疏于维护",
    forgotten: "↺ 可能正在被遗忘",
  };
  return map[state] ?? state;
}