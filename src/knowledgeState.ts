import type { ActivityEntry, KGState } from "./types";
import type { NoteMetadata } from "./noteIndex";

/**
 * KnowledgeState：本地规则推导的「知识状态」层（§十一~十七）。
 * - 纯函数、无 Obsidian 依赖（便于验证）。
 * - AI 绝不参与判定：本地规则定候选，AI 只负责解释“为什么值得回顾”（§十七）。
 * - UI 文案一律“可能正在被遗忘”，绝不写“你已经忘记”（§十二）。
 */
export interface KGRules {
  newDays: number;
  staleDays: number;
  forgottenDays: number;
}

export function daysSince(t: number | undefined, now: number): number | null {
  return typeof t === "number" ? (now - t) / 86400000 : null;
}

/** 五态判定（§十二/十三），按优先级：new > growing > active > forgotten > stale */
export function deriveState(
  note: NoteMetadata,
  act: ActivityEntry | undefined,
  rules: KGRules,
  now = Date.now()
): KGState {
  const createdD = daysSince(note.created, now);
  if (createdD !== null && createdD <= rules.newDays) return "new";

  const modifiedD = daysSince(note.modified, now) ?? Infinity;
  const accessedD = daysSince(act?.lastAccessedAt, now);
  const reviewedD = daysSince(act?.lastReviewedAt, now);
  const accessCount = act?.accessCount ?? 0;

  // growing：近 7 天持续修改 + 至少 2 次访问（§十二）
  if (modifiedD <= 7 && accessCount >= 2) return "growing";

  // active：近期有 访问/复习/修改 任一（§十二；§十三：40 天未改但昨天读过 → active）
  if (
    (accessedD !== null && accessedD <= 7) ||
    (reviewedD !== null && reviewedD <= 7) ||
    modifiedD <= 7
  ) return "active";

  // forgotten：>forgottenDays 未访问 + 未复习 + 存在知识连接（≥1 条 in/out 链）（§十二/十六）
  const neverAccessed = accessedD === null;
  const neverReviewed = reviewedD === null;
  const farLong = (accessedD !== null && accessedD > rules.forgottenDays) || neverAccessed;
  const farReview = (reviewedD !== null && reviewedD > rules.forgottenDays) || neverReviewed;
  const connected = note.links.length + note.backlinks.length >= 1;
  if (farLong && farReview && connected) return "forgotten";

  // stale：>staleDays 三无（无访问/无修改/无复习）
  const noRecentAccess = accessedD === null || accessedD > rules.staleDays;
  const noRecentModify = modifiedD > rules.staleDays;
  const noRecentReview = reviewedD === null || reviewedD > rules.staleDays;
  if (noRecentAccess && noRecentModify && noRecentReview) return "stale";

  return "active";
}

/** 内部活动评分：只用于候选排序（§十四）。时间衰减 > 访问次数，避免“打开 1000 次永远第一”。 */
export function activityScore(
  note: NoteMetadata,
  act: ActivityEntry | undefined,
  now = Date.now()
): number {
  const day = 86400000;
  const decay = (t: number | undefined, halfDays: number): number => {
    const d = daysSince(t, now);
    if (d === null || d < 0) return 0;
    return Math.exp(-d / halfDays);
  };
  const access = decay(act?.lastAccessedAt, 7);
  const modify = decay(note.modified, 21);
  const review = (act?.reviewCount ?? 0) ? Math.min(act!.reviewCount!, 5) * 0.05 + decay(act?.lastReviewedAt, 14) * 0.25 : 0;
  const connectivity = Math.min(note.links.length, 8) * 0.06 + Math.min(note.backlinks.length, 8) * 0.12;
  const stalenessBonus = note.backlinks.length >= 2 && (daysSince(note.modified, now) ?? 0) > 30 ? 0.1 : 0;
  return Math.min(1, 0.45 * access + 0.25 * modify + 0.2 * connectivity + review + stalenessBonus);
}

/** 遗忘候选池（§十六）：forgottenDays 未访问 + 未复习 + ≥1 条 wiki 连接 */
export function forgottenCandidates(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  rules: KGRules,
  now = Date.now()
): NoteMetadata[] {
  return notes
    .filter((n) => deriveState(n, getAct(n.path), rules, now) === "forgotten")
    .sort((a, b) => (b.backlinks.length + b.links.length) - (a.backlinks.length + a.links.length))
    .slice(0, 20);
}

/** 排序候选（§十五）：Recent modification + Recent access + Review relevance + Link connectivity + Staleness + Cross-area potential */
export function rankCandidates(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  rules: KGRules,
  now = Date.now()
): NoteMetadata[] {
  const topFolder = new Set<string>();
  for (const n of notes) {
    for (const b of n.backlinks) {
      const folder = b.split("/")[0];
      if (folder) topFolder.add(folder);
    }
  }
  return [...notes]
    .map((n) => {
      const act = getAct(n.path);
      let score = activityScore(n, act, now);
      // cross-area potential：backlinks 分散在不同顶层文件夹 → 加分（§十五）
      const folders = new Set(n.backlinks.map((b) => b.split("/")[0]).filter(Boolean));
      if (folders.size >= 2) score += 0.12;
      const state = deriveState(n, act, rules, now);
      if (state === "new" || state === "growing") score += 0.1;
      return { n, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.n);
}

/** Dashboard 状态计数（§十八）：完全本地，数字来自索引+活动，无 AI */
export function stateCounts(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  rules: KGRules,
  now = Date.now()
): Record<KGState, number> {
  const out: Record<KGState, number> = { new: 0, growing: 0, active: 0, stale: 0, forgotten: 0 };
  for (const n of notes) out[deriveState(n, getAct(n.path), rules, now)]++;
  return out;
}