/** Review Center：主动复习闭环的本地核心（§六十五）。
 * - 纯函数 + 本地 JSON 存储，绝无 Obsidian / AI 依赖：队列是「本地可执行状态」，AI 只是增强问题的增强层（§十一/六十四）。
 * - 系统建议 ≠ 用户完成：只有用户点「✓ 已复习」才 markReviewed（§三/六十九/七十）。
 * - file-open / AI 复习问题绝不写 lastReviewedAt（§六十七/六十八/六十九）。 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import type { NoteMetadata } from "./noteIndex";
import type {
  ActivityEntry, KGState, KnowledgeArea, ReviewCandidate, ReviewCenterConfig,
  ReviewQuestion, ReviewQuestionPurpose, ReviewSessionState, ReviewQueue, ReviewQueueItem,
} from "./types";
import { deriveState, daysSince, type KGRules } from "./knowledgeState";

/** 每日队列周期键（§十二：daily:YYYY-MM-DD） */
export function dailyPeriodKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return "daily:" + now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate());
}

/** 状态文案（§七十五）：「可能正在被遗忘」是 Reason，不是与今日复习平行的大区块 */
export function stateReason(state: KGState): string {
  switch (state) {
    case "forgotten": return "↺ 可能正在被遗忘";
    case "stale": return "○ 疏于维护";
    case "growing": return "📈 正在增长，值得巩固";
    case "new": return "🌱 新知识，值得巩固";
    default: return "● 近期活跃";
  }
}

const VALID_PURPOSES: ReviewQuestionPurpose[] = ["recall", "connection", "application", "contrast"];

/** AI 问题失败/未开启时的系统 fallback（§二十五/五十七）：AI 是增强层，不是复习的基础依赖 */
export function fallbackReviewQuestion(): string {
  return "在打开笔记前，先试着回忆：这篇笔记最核心的观点是什么？";
}

/** 取某篇笔记的问题（无则 fallback，§五十七） */
export function resolveQuestion(map: Map<string, ReviewQuestion>, pathKey: string): string {
  return map.get(pathKey)?.question || fallbackReviewQuestion();
}

/** AI 问题 path 校验（§五十三/五十四）：编造路径删除；purpose 非法归为 recall；最多 maxQuestions 条 */
export function filterValidQuestions(raw: unknown, allowedPaths: string[], maxQuestions: number): ReviewQuestion[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(allowedPaths.map((p) => p.replace(/\.md$/i, "")));
  const out: ReviewQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["path"] !== "string" || typeof rec["question"] !== "string") continue;
    const bare = rec["path"].replace(/\.md$/i, "");
    if (!allowed.has(bare) && !allowedPaths.includes(rec["path"])) continue;
    const question = rec["question"].trim().slice(0, 240);
    if (!question) continue;
    if (out.some((x) => x.path === bare + ".md")) continue; // 每篇笔记最多 1 个问题（§五十六/二十）
    out.push({
      path: bare + ".md",
      question,
      purpose: VALID_PURPOSES.includes(rec["purpose"] as ReviewQuestionPurpose) ? (rec["purpose"] as ReviewQuestionPurpose) : "recall",
      answerHint: typeof rec["answerHint"] === "string" ? rec["answerHint"].trim().slice(0, 240) : undefined,
    });
    if (out.length >= maxQuestions) break;
  }
  return out;
}

/** 连续跳过历史（§三十二）：只记「连续被跳过」计数与日期，不记每次点击（§三十四） */
export interface SkipInfo { consecutive: number; lastSkippedDate: string; }
export type SkipHistory = Record<string, SkipInfo>;

function areaOf(note: NoteMetadata, areas: KnowledgeArea[]): string | undefined {
  for (const a of areas) {
    if (!a.folder) continue;
    if (note.path === a.folder + ".md" || note.path.startsWith(a.folder + "/") || note.folder === a.folder) return a.name;
  }
  return undefined;
}

function connectCount(n: NoteMetadata): number {
  return n.links.length + n.backlinks.length;
}

/**
 * 单条候选评分（§五/三十三/四十八）：priorityScore 只是排序依据。
 * score = 状态 + 陈旧度 + 连接 + 跨区域 + 增长 − 最近复习惩罚 − 连续跳过惩罚（§七：防高连接永远霸榜）。
 */
export function buildReviewCandidate(
  note: NoteMetadata,
  act: ActivityEntry | undefined,
  areas: KnowledgeArea[],
  rules: KGRules,
  now = Date.now()
): ReviewCandidate {
  const state = deriveState(note, act, rules, now);
  const day = 86400000;
  const daysSinceReview = daysSince(act?.lastReviewedAt, now);
  const daysSinceAccess = daysSince(act?.lastAccessedAt, now);
  const conn = connectCount(note);
  const stateWeight = state === "forgotten" ? 0.7 : state === "stale" ? 0.55 : state === "growing" ? 0.42 : state === "new" ? 0.34 : 0.12;
  // 陈旧度：越久未复习/未访问越值得（forgotten 额外加长时间未访问）
  let staleness = Math.min(daysSinceReview === null ? 120 : daysSinceReview, 120) / 120 * 0.12;
  if (state === "forgotten") staleness += Math.min(daysSinceAccess === null ? 120 : daysSinceAccess, 120) / 120 * 0.1;
  // 连接度（§七：封顶 10，避免高连接笔记永远霸榜）
  const connection = Math.min(conn, 10) * 0.04;
  // 跨区域：backlinks 分散在 ≥2 个顶层文件夹 → 有跨领域价值
  const crossArea = new Set(note.backlinks.map((b) => b.split("/")[0]).filter(Boolean)).size >= 2 ? 0.08 : 0;
  // 增长：近 3 天仍在改的笔记
  const growth = ((now - note.modified) / day) <= 3 ? 0.05 : 0;
  // 最近复习惩罚（§七）：刚复习过的笔记必须暂时下降，给其他笔记机会
  let recentReviewPenalty = 0;
  if (daysSinceReview !== null) {
    if (daysSinceReview <= 1) recentReviewPenalty = 0.5;
    else if (daysSinceReview <= 3) recentReviewPenalty = 0.4;
    else if (daysSinceReview <= 7) recentReviewPenalty = 0.3;
    else if (daysSinceReview <= 14) recentReviewPenalty = 0.2;
    else if (daysSinceReview <= 30) recentReviewPenalty = 0.1;
  }
  const priorities = ["forgotten", "stale", "growing", "new", "active"] as const;
  const priorityTier = priorities.indexOf(state);
  // §四十八 默认优先级：forgotten > stale > growing > new > active（tier 越小越优先）
  const priorityScore = (4 - priorityTier) * 10 + stateWeight + staleness + connection + crossArea + growth - recentReviewPenalty;

  const daysTxt = daysSinceReview === null ? "从未复习" : daysSinceReview < 1 ? "刚刚复习" : Math.round(daysSinceReview) + " 天未复习";
  const connTxt = conn > 0 ? " · " + conn + " 个关联" : "";
  const reason = state === "forgotten" || state === "stale"
    ? stateReason(state) + " · " + daysTxt + connTxt
    : stateReason(state) + (daysSinceReview !== null && daysSinceReview > 1 ? " · " + daysTxt : "");

  return {
    path: note.path,
    title: note.title,
    area: areaOf(note, areas),
    state,
    lastAccessedAt: act?.lastAccessedAt,
    lastReviewedAt: act?.lastReviewedAt,
    daysSinceReview: daysSinceReview ?? undefined,
    daysSinceAccess: daysSinceAccess ?? undefined,
    reason,
    priorityScore,
  };
}

/** 保证新增长知识有机会：至少预留 ceil(30%) 名额给 growing/new/stale/active（§四十八：不要只复习旧知识） */
export function freshQuota(size: number): number {
  return Math.max(1, Math.ceil(size * 0.3));
}

/** 构建每日候选（§六/四十七）：forgotten 优先但受配额封顶（防垄断，§七/六）；
 *  连续跳过 ≥3 次降优先级但绝不排除（§三十二）。 */
export function buildReviewCandidates(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  areas: KnowledgeArea[],
  cfg: ReviewCenterConfig,
  rules: KGRules,
  skipHistory: SkipHistory = {},
  now = Date.now()
): ReviewCandidate[] {
  const all = notes
    .map((n) => buildReviewCandidate(n, getAct(n.path), areas, rules, now))
    .map((c) => (skipHistory[c.path] && cfg.skipPenalty && skipHistory[c.path].consecutive >= 3
      ? { ...c, priorityScore: c.priorityScore - 0.25 }
      : c))
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const chosen: ReviewCandidate[] = [];
  const used = new Set<string>();
  // fresh 名额按实际可用 fresh 候选封顶：没有 fresh 时 forgotten 可以填满队列（§八：5 篇完整任务）
  const freshCount = all.filter((c) => c.state !== "forgotten").length;
  const guaranteedFresh = Math.min(freshQuota(cfg.queueSize), freshCount);
  const forgottenCap = Math.max(0, cfg.queueSize - guaranteedFresh);
  let forgottenTaken = 0;
  for (const c of all) {
    if (chosen.length >= cfg.queueSize) break;
    if (c.state === "forgotten") {
      if (forgottenTaken >= forgottenCap) continue;
      forgottenTaken++;
    }
    chosen.push(c);
    used.add(c.path);
  }
  for (const c of all) {
    if (chosen.length >= cfg.queueSize) break;
    if (used.has(c.path)) continue;
    chosen.push(c);
  }
  return chosen;
}

/** 构建每日队列（§九/十/四十二）：纯本地计算，绝不需要 API（§六十四）。幂等由 store 按 periodKey 复用保证（§十）。 */
export function buildReviewQueue(
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  areas: KnowledgeArea[],
  cfg: ReviewCenterConfig,
  rules: KGRules,
  skipHistory: SkipHistory = {},
  now = Date.now()
): ReviewQueue {
  const candidates = buildReviewCandidates(notes, getAct, areas, cfg, rules, skipHistory, now);
  const items: ReviewQueueItem[] = candidates.map((c, i) => ({
    path: c.path,
    stateAtSelection: c.state,
    priorityScore: c.priorityScore,
    status: i === 0 ? "reviewing" : "pending",
    selectedAt: now,
  }));
  return {
    periodKey: dailyPeriodKey(new Date(now)),
    createdAt: now,
    items,
    completedCount: 0,
    skippedCount: 0,
  };
}

function recount(queue: ReviewQueue): ReviewQueue {
  return {
    ...queue,
    completedCount: queue.items.filter((i) => i.status === "completed").length,
    skippedCount: queue.items.filter((i) => i.status === "skipped").length,
  };
}

/** ✓ 已复习（§二十六/五十八）：只更新 queue item + completedCount；Activity 由调用方 markReviewed（§七十） */
export function markCompleted(queue: ReviewQueue, pathKey: string): ReviewQueue {
  const items = queue.items.map((it) =>
    it.path === pathKey && it.status !== "completed" && it.status !== "skipped"
      ? { ...it, status: "completed" as const, completedAt: Date.now() }
      : it
  );
  return recount({ ...queue, items });
}

/** 跳过（§二十九）：status=skipped，绝不更新 lastReviewedAt/reviewCount（§二十九/三十一） */
export function markSkipped(queue: ReviewQueue, pathKey: string): ReviewQueue {
  const items = queue.items.map((it) =>
    it.path === pathKey && it.status !== "completed" && it.status !== "skipped" ? { ...it, status: "skipped" as const } : it
  );
  return recount({ ...queue, items });
}

/** 稍后再看（§三十/三十一）：置为 skipped（计入 session 完成条件 §六十）+ snoozedUntil；不更新 Activity */
export function markSnoozed(queue: ReviewQueue, pathKey: string, until: number): ReviewQueue {
  const items = queue.items.map((it) =>
    it.path === pathKey && it.status !== "completed" && it.status !== "skipped"
      ? { ...it, status: "skipped" as const, snoozedUntil: until }
      : it
  );
  return recount({ ...queue, items });
}

/** 下一个待复习下标（§三十八/五十九：恢复不丢进度；由用户选择进入下一项） */
export function nextActiveIndex(queue: ReviewQueue, from = 0): number | null {
  for (let i = from; i < queue.items.length; i++) {
    if (queue.items[i].status === "pending" || queue.items[i].status === "reviewing") return i;
  }
  return null;
}

/** Session 是否完成（§六十：completed + skipped == items.length） */
export function sessionFinished(queue: ReviewQueue): boolean {
  return queue.items.every((i) => i.status === "completed" || i.status === "skipped");
}

/** 删除笔记后，队列中已不存在的 item 安全移除（§六十六 Test 18）；计数重算保持一致 */
export function pruneQueue(queue: ReviewQueue, existingPaths: Set<string>): ReviewQueue {
  const items = queue.items.filter((i) => existingPaths.has(i.path));
  return recount({ ...queue, items });
}

/** 笔记 rename 后队列 path 随行更新，不能变成假死路径（§六十六 Test 19） */
export function migrateQueuePaths(queue: ReviewQueue, oldPath: string, newPath: string): ReviewQueue {
  if (queue.items.every((i) => i.path !== oldPath)) return queue;
  return { ...queue, items: queue.items.map((i) => (i.path === oldPath ? { ...i, path: newPath } : i)) };
}

export function migrateSkipHistory(h: SkipHistory, oldPath: string, newPath: string): SkipHistory {
  if (!h[oldPath]) return h;
  const out = { ...h };
  const v = out[oldPath];
  delete out[oldPath];
  out[newPath] = v;
  return out;
}

/** 恢复 session（§三十八/三十九/四十）：同 periodKey → 复用同一 active session；clamp 到有效范围 */
export function safeResumeIndex(session: ReviewSessionState | null, queue: ReviewQueue): number {
  if (!session || session.queueKey !== queue.periodKey) return 0;
  const resumed = session.currentIndex;
  if (!Number.isFinite(resumed) || resumed < 0 || resumed >= queue.items.length) return 0;
  const active = nextActiveIndex(queue, resumed);
  return active === null ? 0 : active;
}

/* ---------------- 本地持久化（§十一/三十九）：cache/review-queue.json + cache/review-session.json ---------------- */

interface QueueFile {
  queue: ReviewQueue | null;
  skipHistory: SkipHistory;
}

/** Review Center 本地存储：队列 + 连续跳过历史 + session 指针（不存 AI prompt/笔记全文，§七十四） */
export class ReviewCenterStore {
  private queueFile: string;
  private sessionFile: string;
  private queue: ReviewQueue | null = null;
  private skipHistory: SkipHistory = {};
  private session: ReviewSessionState | null = null;

  constructor(pluginDir: string) {
    this.queueFile = path.join(pluginDir, "cache", "review-queue.json");
    this.sessionFile = path.join(pluginDir, "cache", "review-session.json");
  }

  /** 启动时恢复；损坏文件隔离 *.corrupt-* 后置空（§十三：queue 重建由调用方生成当前周期队列；session 置空）。
   *  返回是否执行了隔离。 */
  load(): boolean {
    let isolated = false;
    try {
      if (fs.existsSync(this.queueFile)) {
        const raw = JSON.parse(fs.readFileSync(this.queueFile, "utf8")) as QueueFile;
        if (!raw || typeof raw !== "object") throw new Error("invalid queue structure");
        if (raw.queue && typeof raw.queue === "object" && Array.isArray(raw.queue.items)) {
          this.queue = {
            periodKey: typeof raw.queue.periodKey === "string" ? raw.queue.periodKey : "",
            createdAt: typeof raw.queue.createdAt === "number" ? raw.queue.createdAt : 0,
            items: raw.queue.items.filter((i) => i && typeof i.path === "string"),
            completedCount: 0,
            skippedCount: 0,
          };
          this.queue = recount(this.queue);
        }
        if (raw.skipHistory && typeof raw.skipHistory === "object") this.skipHistory = raw.skipHistory;
      }
    } catch {
      isolated = isolateCorruptFile(this.queueFile) || isolated;
      this.queue = null;
    }
    try {
      if (fs.existsSync(this.sessionFile)) {
        const s = JSON.parse(fs.readFileSync(this.sessionFile, "utf8")) as ReviewSessionState;
        if (s && typeof s.periodKey === "string" && typeof s.currentIndex === "number") {
          this.session = {
            periodKey: s.periodKey,
            currentIndex: Number.isFinite(s.currentIndex) ? s.currentIndex : 0,
            queueKey: typeof s.queueKey === "string" ? s.queueKey : s.periodKey,
            updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
          };
        } else {
          throw new Error("invalid session structure");
        }
      }
    } catch {
      isolated = isolateCorruptFile(this.sessionFile) || isolated;
      this.session = null;
    }
    return isolated;
  }

  getQueue(): ReviewQueue | null { return this.queue; }
  getSkipHistory(): SkipHistory { return this.skipHistory; }
  getSession(): ReviewSessionState | null { return this.session; }

  setQueue(q: ReviewQueue | null): void {
    this.queue = q;
    this.writeQueue();
  }

  /** 连续跳过登记（§三十二）：同一天重复跳只 +1；跨天重新计数 */
  recordSkip(pathKey: string, now = Date.now()): number {
    const today = dailyPeriodKey(new Date(now));
    const prev = this.skipHistory[pathKey];
    const consecutive = prev && prev.lastSkippedDate === today ? prev.consecutive + 1 : 1;
    this.skipHistory[pathKey] = { consecutive, lastSkippedDate: today };
    this.writeQueue();
    return consecutive;
  }

  /** 真正完成复习后清除该笔记的连续跳过历史（§三十二：不永久排除） */
  resetSkip(pathKey: string): void {
    if (!this.skipHistory[pathKey]) return;
    delete this.skipHistory[pathKey];
    this.writeQueue();
  }

  setSession(s: ReviewSessionState | null): void { this.session = s; this.writeSession(); }

  /** 删除笔记后合并清理（§六十六 Test 18）：队列移除不存在的 item；skipHistory 清掉 */
  prunePaths(existing: Set<string>): void {
    if (this.queue) this.queue = pruneQueue(this.queue, existing);
    let dirty = false;
    for (const k of Object.keys(this.skipHistory)) {
      if (!existing.has(k)) { delete this.skipHistory[k]; dirty = true; }
    }
    if (dirty || this.queue) this.writeQueue();
  }

  /** 笔记 rename 后队列与跳过历史随行更新（§六十六 Test 19），不产生假死路径 */
  migratePaths(oldPath: string, newPath: string): void {
    if (this.queue) this.queue = migrateQueuePaths(this.queue, oldPath, newPath);
    const h = migrateSkipHistory(this.skipHistory, oldPath, newPath);
    if (h !== this.skipHistory) this.skipHistory = h;
    this.writeQueue();
  }

  private writeQueue(): void {
    try {
      const obj: QueueFile = { queue: this.queue, skipHistory: this.skipHistory };
      atomicWriteJson(this.queueFile, obj);
    } catch (e) {
      console.error("[KnowledgeGarden][ReviewCenter] 队列持久化失败：", (e as Error).message);
    }
  }

  private writeSession(): void {
    try {
      atomicWriteJson(this.sessionFile, this.session);
    } catch (e) {
      console.error("[KnowledgeGarden][ReviewCenter] session 持久化失败：", (e as Error).message);
    }
  }
}

/** 同周期只允许一个 active session（§四十）：重新进入直接恢复 */
export function sameActiveSession(session: ReviewSessionState | null, queueKey: string): boolean {
  return !!session && session.queueKey === queueKey;
}