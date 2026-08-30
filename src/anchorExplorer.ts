/** Phase 11：Anchor Knowledge Exploration（§三十~四十一）：以当前笔记为中心 → 全库/Discovey Scope 本地检索 → AI 关联。
 * - 纯函数（范围/评分/多样性/缓存键复用 Query Explorer 引擎），不新增第三套 Graph Schema（§三十七）。
 * - WikiLink/Backlink 提高分，但仍允许无 WikiLink 的知识（§三十一：不退化成 Graph View）。
 * - 只读检索；搜索绝不写 Activity / Review / Scheduler；不自动进 Query History / Saved（§一百二十九/一百三十）。
 */
import { tokenizeText } from "./searchIndex";
import { discoveryPool } from "./discovery";
import { fingerprintKey } from "./ai/cache";
import type { DiscoveryScope, KnowledgeArea } from "./types";
import type { NoteMetadata } from "./noteIndex";

export const ANCHOR_SELECTION_VERSION = "v1";
export const ANCHOR_LOCAL_LIMIT_DEFAULT = 50;
export const ANCHOR_COUNT_DEFAULT = 16;

/** Anchor 探索范围（§一百二十七：默认当前 Discovery Scope，提供「整个仓库」快捷切换） */
export type AnchorScopeMode = "vault" | "discovery";

/** 范围 → 本地候选池（只取 path；vault=全库，discovery=复用漫游 Discovery Scope） */
export function anchorScopePaths(
  scopeMode: AnchorScopeMode,
  notes: NoteMetadata[],
  discoveryScope: DiscoveryScope | undefined,
  areas: KnowledgeArea[]
): Set<string> {
  if (scopeMode === "vault" || !discoveryScope) return new Set(notes.map((n) => n.path));
  return new Set(discoveryPool(notes, discoveryScope, areas).map((n) => n.path));
}

/** Anchor 查询 tokens：标题 + 标签 + 标题行 + 别名 + 正文高频 tokens（出现≥2 次，去噪；§三十） */
export function anchorTokens(anchor: {
  title: string;
  tags: string[];
  headings: string[];
  aliases: string[];
  tokenMap: Map<string, number> | Record<string, number>;
}): string[] {
  const out = new Set<string>();
  if (anchor.title) for (const t of tokenizeText(anchor.title)) out.add(t);
  for (const tag of anchor.tags ?? []) for (const t of tokenizeText(tag)) out.add(t);
  for (const h of anchor.headings ?? []) for (const t of tokenizeText(h)) out.add(t);
  for (const a of anchor.aliases ?? []) for (const t of tokenizeText(a)) out.add(t);
  const counts = anchor.tokenMap instanceof Map
    ? anchor.tokenMap
    : new Map(Object.entries(anchor.tokenMap ?? {}));
  const body: { t: string; c: number }[] = [];
  for (const [t, c] of counts) if (c >= 2) body.push({ t, c });
  body.sort((a, b) => b.c - a.c);
  for (const { t } of body.slice(0, 60)) out.add(t);
  return [...out].slice(0, 120);
}

/** Anchor 缓存键（§八十一/一百零二：type + anchor path + scope + 候选 + 区域 + prompt 版本 + 路由指纹 + 选择版本）。
 *  路由指纹必须包含实际模型 → 换 Profile/Model 该功能 cache miss（用户特别强调）。 */
export function buildAnchorCacheKey(opts: {
  anchorPath: string;
  scopeFingerprint: string;
  candidateSig: string;
  areaSig: string;
  promptVersion: string;
  routeFingerprint: string;
}): string {
  return fingerprintKey([
    "anchor_exploration",
    "anchor:" + opts.anchorPath,
    "scope:" + opts.scopeFingerprint,
    opts.candidateSig,
    opts.areaSig,
    opts.promptVersion,
    opts.routeFingerprint,
    "sel:" + ANCHOR_SELECTION_VERSION,
  ]);
}