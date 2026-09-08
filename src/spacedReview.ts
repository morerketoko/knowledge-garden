/**
 * Phase 20：FSRS 间隔重复（Review System 专属，§四~§一百四十八）。
 *
 * 职责边界（§三/五十二）：
 * - Activity（activity.ts）       = 行为记录（lastReviewedAt/reviewCount，§九十四/一百六十七）
 * - Review Queue（reviewCenter）  = 今天复习什么（§五十二：本地可执行状态）
 * - FSRS State（本文件）          = 这个复习项目应该什么时候再出现（独立于 Activity / AI 问题）
 * - Exam Mastery（examEngine）    = 考试结果（不混入本模块）
 * - Knowledge State（knowledgeState）= 知识整体状态
 *
 * 原则：
 * - 只调用 ts-fsrs@5.4.2 调度（createEmptyCard/fsrs/Rating/State），绝不自行重实现 FSRS 数学公式（§七十九）。
 * - 掌握度（历史评分表现，EWMA）与「当前保持率」（FSRS retrievability）是两个指标，绝不混用（§五十五）。
 * - 本文件不依赖 Obsidian API（便于 Node 自动测试）；持久化独立于 AI Cache（cache/spaced-review.json，§七）。
 * - 绝不记录 API Key / Prompt / 笔记全文（§八）。
 */
import * as fs from "fs";
import * as path from "path";
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type FSRSParameters,
  type Grade,
  type RecordLogItem,
  type Steps,
} from "ts-fsrs";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import type { FsrsRating, SavedCardScope, SavedCardScopeMode } from "./types";
import type { ReviewQueueItem, ReviewScope } from "./types";

/* ================= 版本与常量 ================= */

/** ts-fsrs 依赖版本（最终报告 §171 用；来自 ts-fsrs 运行时常量） */
export const TS_FSRS_VERSION = "5.4.2";

export const REVIEW_LOG_MAX = 4000;          // 日志环形上限（只记元数据，防无限增长）
export const CUSTOM_SCOPE_FOLDER_LIMIT = 10; // §25：自定义范围最多 10 个文件夹

export const FSRS_RATINGS: FsrsRating[] = ["again", "hard", "good", "easy"];

export const FSRS_RATING_LABEL: Record<FsrsRating, string> = {
  again: "忘记", hard: "困难", good: "掌握", easy: "熟练",
};
export const FSRS_RATING_EMOJI: Record<FsrsRating, string> = {
  again: "😵", hard: "😕", good: "🙂", easy: "😎",
};
/** §五十六：Again=25 / Hard=50 / Good=75 / Easy=100 */
export const FSRS_RATING_SCORE: Record<FsrsRating, number> = {
  again: 25, hard: 50, good: 75, easy: 100,
};

/** 掌握度置信：reviewCount < 3 时提示「数据较少」（§五十七） */
export const MASTERY_CONFIDENCE_MIN = 3;

/* ================= 持久化数据形态（§六，按 ts-fsrs Card 结构调整） ================= */

/** FSRS 卡核心状态（归一化为 JSON 安全数字；state = ts-fsrs State 数值） */
export interface StoredFsrsState {
  due: number;            // epoch ms：下次到期时间
  stability: number;      // 稳定性（R=90% 时区间天数）
  difficulty: number;     // 难度 1~10
  reps: number;           // ts-fsrs 复习次数（与业务 reviewCount 一致增长，来自 ts-fsrs 结果卡）
  lapses: number;         // 遗忘次数
  state: number;          // State.New=0 / Learning=1 / Review=2 / Relearning=3
  learningSteps: number;  // ts-fsrs 学习步骤下标（跨会话保持学习步骤推进）
  lastReview?: number;    // epoch ms
}

/** 单篇笔记 = 一个 review unit（§八十）；未来多卡 = 每卡独立 state 对象（§八十一，本阶段一笔记一卡） */
export interface SpacedReviewCard {
  path: string;
  fsrsState: StoredFsrsState;
  lastRating?: FsrsRating;
  reviewCount: number;        // 业务复习次数（§十三：兼容旧 reviewCount 语义）
  lastReviewedAt?: number;
  masteryPercent?: number;    // 历史评分表现（EWMA，0~100；≠ retrievability，§五十五）
  createdAt: number;
  updatedAt: number;
}

/* ---------- Phase 21：Saved Review Card 的 FSRS 状态（§三/五：主键 savedCard:<cardId>，与笔记卡分离） ---------- */

/** 「我的复习卡」独立 FSRS 状态：cardId = SavedReviewCard.id（主键保存，不随 sourcePath 变，§85）。
 *  不把 fsrsState 塞进 SavedReviewCard / 不写进卡片 Markdown（§八：Markdown 资产保持干净）。 */
export interface SavedCardSpacedState {
  cardId: string;
  fsrsState: StoredFsrsState;
  lastRating?: FsrsRating;
  reviewCount: number;        // 与 SavedReviewCard.reviewCount 同步增长
  lastReviewedAt?: number;
  masteryPercent?: number;    // 历史评分 EWMA（0~100；§23；≠ retrievability §24）
  createdAt: number;
  updatedAt: number;
}

/** Saved Card Review Log（§七）：只记调度元数据；绝不记录 Prompt / API Key / 正文全文 / Web 正文 */
export interface SavedCardReviewLogEntry {
  cardId: string;
  timestamp: number;
  rating: FsrsRating;
  previousDue?: number | null;
  nextDue: number;
  intervalDays: number;
  stability: number;
  difficulty: number;
  retrievability: number;
}

/** Review Log（§八）：每次 FSRS 评分至少记录以下字段；绝不记录 API Key / Prompt / 全文 / Web 内容 */
export interface ReviewLogEntry {
  path: string;
  timestamp: number;
  rating: FsrsRating;
  previousDue?: number | null;
  nextDue: number;
  intervalDays: number;       // 距上次复习的新间隔（天；学习步骤为不足 1 天的小数）
  stability: number;
  difficulty: number;
  retrievability: number;     // 评分瞬间该卡的当前保持率（0~1；新卡首次为 1）
}

export interface SpacedReviewFile {
  formatVersion: number;
  cards: Record<string, SpacedReviewCard>;
  reviewLogs: ReviewLogEntry[];
  /** Phase 21（formatVersion 2）：Saved Card FSRS 状态与日志（同一 FSRS State Store，§六/一百二十三） */
  savedCards?: Record<string, SavedCardSpacedState>;
  savedCardReviewLogs?: SavedCardReviewLogEntry[];
}

/* ================= 设置校验（§六十六~七十一；P20-31~34） ================= */

export function isValidDesiredRetention(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0.7 && v <= 0.97;
}
export function isValidMaxIntervalDays(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 30 && v <= 36500;
}
export function isValidDailyNewCards(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 100;
}
export function isValidMaxReviewsPerDay(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= 500;
}
/** Phase 21 §67：每日「我的复习卡」处理上限（0~500；与笔记复习限额独立） */
export function isValidSavedCardsDailyLimit(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 500;
}

/** 解析学习步骤文本（如 "10m,1h"）→ ts-fsrs Steps；非法（0/空/负数/坏单位）返回 null（P20-34） */
export function parseLearningSteps(text: string): string[] | null {
  const raw = (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) return null;
  const out: string[] = [];
  for (const step of raw) {
    const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(step);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;   // 拒绝 0 / 负数 / 非数字
    if (m[2] === "d" && n > 36500) return null;
    out.push(step);
  }
  return out;
}

/**
 * Scheduler 配置指纹（§三十：queue 缓存键的一部分 = FSRS config fingerprint）。
 * 只包含真正影响调度数学的参数：desiredRetention / maxIntervalDays / learningSteps / relearningSteps。
 * 逾期优先 / 排序 / 每日限额只影响「今天选哪些」，不改变 FSRS 状态 → 不进指纹（§五十二：Queue 与 FSRS 解耦）。
 */
export function schedulerConfigFingerprint(cfg: {
  desiredRetention: number;
  maxIntervalDays: number;
  learningSteps: string;
  relearningSteps: string;
}): string {
  const s = "ret:" + cfg.desiredRetention + "|max:" + cfg.maxIntervalDays + "|ls:" + cfg.learningSteps + "|rs:" + cfg.relearningSteps;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ================= ts-fsrs 包装（§四十八/四十九/七十九：真实调度，不做假 FSRS） ================= */

function toGrade(rating: FsrsRating): Grade {
  switch (rating) {
    case "again": return Rating.Again;
    case "hard": return Rating.Hard;
    case "good": return Rating.Good;
    case "easy": return Rating.Easy;
  }
}

function toFsrsRating(r: Rating): FsrsRating {
  switch (r) {
    case Rating.Again: return "again";
    case Rating.Hard: return "hard";
    case Rating.Good: return "good";
    case Rating.Easy: return "easy";
    default: return "good";
  }
}

const DAY_MS = 86400000;

/** 归一化读取（容错旧/脏数据） */
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 把存储的 FSRS 状态转回 ts-fsrs Card（只读转换，不修改算法语义） */
export function toTsCard(fs: StoredFsrsState): Card {
  const lastReview = typeof fs.lastReview === "number" ? new Date(fs.lastReview) : undefined;
  const dueMs = num(fs.due, Date.now());
  const elapsedDays = lastReview ? Math.max(0, Math.round((dueMs - lastReview.getTime()) / DAY_MS)) : 0;
  return {
    due: new Date(dueMs),
    stability: Math.max(1e-3, num(fs.stability, 0)),
    difficulty: Math.min(10, Math.max(1, num(fs.difficulty, 5))),
    elapsed_days: elapsedDays,
    scheduled_days: Math.max(0, Math.floor((dueMs - (lastReview?.getTime() ?? dueMs)) / DAY_MS)),
    learning_steps: Math.max(0, Math.floor(num(fs.learningSteps, 0))),
    reps: Math.max(0, Math.floor(num(fs.reps, 0))),
    lapses: Math.max(0, Math.floor(num(fs.lapses, 0))),
    state: (fs.state === State.Learning || fs.state === State.Review || fs.state === State.Relearning ? fs.state : State.New) as State,
    last_review: lastReview,
  };
}

/** ts-fsrs 结果卡 → 存储态（ts-fsrs 已负责 reps+1 / lapses+1 等语义） */
export function fromTsCard(card: Card): StoredFsrsState {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learningSteps: card.learning_steps || 0,
    lastReview: card.last_review ? card.last_review.getTime() : undefined,
  };
}

export interface SchedulerParams {
  request_retention: number;
  maximum_interval: number;
  learning_steps: string[];
  relearning_steps: string[];
}

export function toFSRSParameters(p: SchedulerParams): FSRSParameters {
  return generatorParameters({
    request_retention: p.request_retention,
    maximum_interval: p.maximum_interval,
    learning_steps: p.learning_steps as Steps,
    relearning_steps: p.relearning_steps as Steps,
    // enable_short_term 默认 true：学习/重学步骤生效（Anki 语义）
  });
}

/** 一次评分的完整结果（供 store 持久化与 UI 展示） */
export interface ScheduleResult {
  next: StoredFsrsState;
  log: Omit<ReviewLogEntry, "path">;
}

/** FSRS 调度器：纯 ts-fsrs 包装；创建后不可变（设置变化 → 新实例 → 只影响未来调度，§74/一百六十二） */
export class FsrsScheduler {
  private engine: ReturnType<typeof fsrs>;
  readonly params: SchedulerParams;

  constructor(params: SchedulerParams) {
    this.params = params;
    this.engine = fsrs(toFSRSParameters(params));
  }

  /** 新卡首次复习前的空状态（ts-fsrs createEmptyCard） */
  emptyCardState(now: number): StoredFsrsState {
    const card = createEmptyCard(new Date(now));
    return fromTsCard(card);
  }

  /**
   * §四十八：真实调用 FSRS scheduler.next()，保存状态由调用方负责。
   * card 为 null → 首次评分（createEmptyCard 起步，§十三）。
   */
  schedule(rating: FsrsRating, card: StoredFsrsState | null, now: number): ScheduleResult {
    const base = card ? toTsCard(card) : createEmptyCard(new Date(now));
    const reviewTime = new Date(now);
    // 评分瞬间旧卡保持率（日志记录用；新卡无历史 → 1）
    const preRetr = card && typeof card.lastReview === "number"
      ? (this.retrievability(card, now) ?? 1)
      : 1;
    const item: RecordLogItem = this.engine.next(base, reviewTime, toGrade(rating));
    const next = fromTsCard(item.card);
    const prevDue = card ? card.due : null;
    const reviewMs = reviewTime.getTime();
    const dueMs = next.due;
    const lastReviewMs = next.lastReview ?? reviewMs;
    const intervalDays = dueMs >= lastReviewMs
      ? Number(((dueMs - lastReviewMs) / DAY_MS).toFixed(3))
      : 0;
    const log: Omit<ReviewLogEntry, "path"> = {
      timestamp: reviewMs,
      rating,
      previousDue: prevDue,
      nextDue: dueMs,
      intervalDays,
      stability: next.stability,
      difficulty: next.difficulty,
      retrievability: Math.max(0, Math.min(1, preRetr)),
    };
    return { next, log };
  }

  /**
   * §四十九：真实预览四种评分的下次时间（绝不写死；不落盘，仅 UI 标签）。
   * 用同一当前卡分别模拟四档 → 返回各自 due/intervalDays。
   */
  previewAll(card: StoredFsrsState | null, now: number): Record<FsrsRating, { due: number; intervalDays: number }> {
    const base = card ? toTsCard(card) : createEmptyCard(new Date(now));
    const reviewTime = new Date(now);
    const all = this.engine.repeat(base, reviewTime);
    const out = {} as Record<FsrsRating, { due: number; intervalDays: number }>;
    for (const rating of FSRS_RATINGS) {
      const item = all[toGrade(rating)];
      const dueMs = item.card.due.getTime();
      const lastReviewMs = item.card.last_review ? item.card.last_review.getTime() : reviewTime.getTime();
      const intervalDays = dueMs >= lastReviewMs ? Number(((dueMs - lastReviewMs) / DAY_MS).toFixed(3)) : 0;
      out[rating] = { due: dueMs, intervalDays };
    }
    return out;
  }

  /** 当前保持率（FSRS retrievability 0~1，format=false 取数值）。无历史/新卡 → null */
  retrievability(card: StoredFsrsState | null, now: number): number | null {
    if (!card) return null;
    if (card.state === State.New || typeof card.lastReview !== "number") return null;
    const base = toTsCard(card);
    const v = this.engine.get_retrievability(base, new Date(now), false);
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  }
}

/** 需要调度参数时从设置构造（ts-fsrs 参数已由 generatorParameters 补默认；本阶段禁止直接编辑 w，§77） */
export function schedulerFromConfig(cfg: {
  desiredRetention: number;
  maxIntervalDays: number;
  learningSteps: string;
  relearningSteps: string;
}): FsrsScheduler {
  const ls = parseLearningSteps(cfg.learningSteps) ?? ["10m", "1h"];
  const rs = parseLearningSteps(cfg.relearningSteps) ?? ["10m"];
  const retention = isValidDesiredRetention(cfg.desiredRetention) ? cfg.desiredRetention : 0.9;
  const maxIvl = isValidMaxIntervalDays(cfg.maxIntervalDays) ? cfg.maxIntervalDays : 3650;
  return new FsrsScheduler({
    request_retention: retention,
    maximum_interval: maxIvl,
    learning_steps: ls,
    relearning_steps: rs,
  });
}

/* ================= 掌握度（历史评分表现，EWMA；§五十五/五十六/五十七） ================= */

/** 结合历史的掌握度更新：最近表现权重高，历史稳定表现保留（非「最近一次简单平均」） */
export function nextMasteryPercent(prev: number | undefined, prevCount: number, rating: FsrsRating): number {
  const score = FSRS_RATING_SCORE[rating];
  const n = Math.max(0, prevCount);
  if (n === 0 || typeof prev !== "number" || !Number.isFinite(prev)) return score;
  // 加权平均：历史按 n 次计入，最近一次双倍权重 → 收敛且对近况敏感
  const merged = (prev * n + score * 2) / (n + 2);
  return Math.round(Math.max(0, Math.min(100, merged)));
}

export function masteryConfidence(reviewCount: number): { low: boolean; hint: string } {
  return reviewCount < MASTERY_CONFIDENCE_MIN
    ? { low: true, hint: "数据较少" }
    : { low: false, hint: "" };
}

/**
 * 掌握分布带（§六十）：沿用 examEngine.masteryLabel() 的同一套边界（0-39/40-59/60-79/80-94/95-100）。
 * 这里只做带索引与文案映射，阈值不重复定义——见 reviewBandOf。
 */
export type MasteryBand = "relearn" | "building" | "basic" | "proficient" | "mastered";

export function reviewBandOf(percent: number): MasteryBand {
  if (percent <= 39) return "relearn";
  if (percent <= 59) return "building";
  if (percent <= 79) return "basic";
  if (percent <= 94) return "proficient";
  return "mastered";
}

/* ================= Scope（§十九~三十：决定选哪些卡；不是 Permission） ================= */

/** 规范化为稳定排序字符串（用于指纹，§二十九） */
export function canonicalScope(scope: ReviewScope | null | undefined): string {
  if (!scope) return '{"mode":"vault"}';
  const o = { mode: scope.mode };
  if (scope.notePath) (o as Record<string, unknown>)["notePath"] = scope.notePath;
  if (scope.folderPath) (o as Record<string, unknown>)["folderPath"] = scope.folderPath;
  if (scope.areaId) (o as Record<string, unknown>)["areaId"] = scope.areaId;
  if (scope.folders && scope.folders.length) (o as Record<string, unknown>)["folders"] = [...scope.folders].sort();
  if (scope.tags && scope.tags.length) (o as Record<string, unknown>)["tags"] = [...scope.tags].sort();
  return JSON.stringify(o);
}

/** Scope fingerprint（§二十九：mode/notePath/folderPath/areaId/folders/tags 排序后 hash） */
export function reviewScopeFingerprint(scope: ReviewScope | null | undefined): string {
  const s = canonicalScope(scope);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function defaultReviewScope(): ReviewScope {
  return { mode: "vault" };
}

/** §十八/三十：queue 缓存键 = periodKey#scopeFingerprint#schedulerConfigFingerprint */
export function queueKeyFor(periodKey: string, scope: ReviewScope | null | undefined, schedulerFp: string): string {
  return periodKey + "#" + reviewScopeFingerprint(scope) + "#" + (schedulerFp || "off");
}

/** §16.5/二十：新卡补充池——从 priorityScore 排序结果里挑「无 FSRS 卡 + 未选 due + 未 snooze」的前 limit 个 */
export function selectNewCardsFromRanked<T extends { path: string }>(
  ranked: ReadonlyArray<T>,
  hasCard: (p: string) => boolean,
  duePaths: ReadonlySet<string>,
  snoozed: ReadonlySet<string>,
  limit: number
): T[] {
  const n = Math.max(0, Math.floor(limit));
  const out: T[] = [];
  for (const c of ranked) {
    if (out.length >= n) break;
    if (hasCard(c.path)) continue;
    if (duePaths.has(c.path)) continue;
    if (snoozed.has(c.path)) continue;
    out.push(c);
  }
  return out;
}

/** 自定义文件夹上限（§25：最多 10 个） */
export function clampCustomFolders(folders: string[]): string[] {
  return folders.slice(0, CUSTOM_SCOPE_FOLDER_LIMIT);
}

/** 判定笔记是否落在某 folder 前缀内（folder 模式与 custom 共用；递归包含子目录，§23） */
export function noteInFolder(notePath: string, folderPath: string): boolean {
  const fp = (folderPath || "").replace(/\/+$/, "");
  if (!fp) return true;
  if (notePath === fp || notePath === fp + ".md") return true;
  return notePath.startsWith(fp + "/");
}

/** 本地 NoteIndex 元数据过滤候选（§87：只读 path/folder/tags/链接，绝不调 AI） */
export function scopeNotesPaths(notes: ReadonlyArray<{ path: string; folder: string; tags: string[] }>, scope: ReviewScope): string[] {
  if (!scope) return notes.map((n) => n.path);
  const match = (n: { path: string; folder: string; tags: string[] }): boolean => {
    switch (scope.mode) {
      case "current-note":
        return !!scope.notePath && n.path === scope.notePath;
      case "folder":
        return !!scope.folderPath && noteInFolder(n.path, scope.folderPath);
      case "area":
        // area 由调用方解析为 folderPath 后复用 folder 语义（§24：KnowledgeArea.folder 作为范围）
        return !!scope.folderPath && noteInFolder(n.path, scope.folderPath);
      case "custom": {
        if (scope.folders && scope.folders.length) {
          const hit = scope.folders.some((f) => noteInFolder(n.path, f));
          if (!hit) return false;
        }
        if (scope.tags && scope.tags.length) {
          const has = scope.tags.some((t) => n.tags.includes(t));
          if (!has) return false;
        }
        return true;
      }
      default: // vault
        return true;
    }
  };
  return notes.filter(match).map((n) => n.path);
}

/** 人类可读范围（§27：始终显示，避免误以为整个 Vault；具体标题由 View 补充） */
export function reviewScopeText(scope: ReviewScope | null | undefined, areaName?: string): string {
  if (!scope || scope.mode === "vault") return "整个 Vault";
  switch (scope.mode) {
    case "current-note": return scope.notePath ? scope.notePath.replace(/\.md$/i, "") : "当前笔记";
    case "folder": return scope.folderPath || "（未选文件夹）";
    case "area": return areaName || scope.areaId || "（未选区域）";
    case "custom": {
      const folders = (scope.folders ?? []).slice(0, 2);
      const more = (scope.folders ?? []).length > 2 ? " 等 " + (scope.folders ?? []).length + " 个" : "";
      const tag = scope.tags && scope.tags.length ? " · #" + scope.tags.join(" #") : "";
      return (folders.length ? folders.join("、") : "（未选文件夹）") + more + tag;
    }
  }
}

/* ================= 队列选择（§十六/十七/十八：FSRS due 优先，剩余名额给新卡） ================= */

export interface DueSelection {
  path: string;
  due: number;
  retrievability: number;   // 0~1，越低越可能忘记
}

/**
 * §十六/十七：due<=now 的卡 → 逾期优先（overdueFirst）→ 按 retrievability 升序（sortByRetrievability）
 * 或 due 升序；达到 limit 停止（每日最大复习量，§十九）。
 */
export function selectDueCards(
  cards: ReadonlyArray<{ path: string; fsrsState: StoredFsrsState }>,
  scheduler: FsrsScheduler,
  now: number,
  limit: number,
  overdueFirst: boolean,
  sortByRetrievability: boolean
): DueSelection[] {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const due = cards
    .filter((c) => c.fsrsState.due <= now)
    .map((c) => ({
      path: c.path,
      due: c.fsrsState.due,
      retrievability: scheduler.retrievability(c.fsrsState, now) ?? 1,
      overdue: c.fsrsState.due < startOfDay,
      todayDue: c.fsrsState.due >= startOfDay && c.fsrsState.due <= now,
    }));
  const bucket = (c: { overdue: boolean; todayDue: boolean }): number => {
    if (overdueFirst) return c.overdue ? 0 : 1;
    return c.todayDue ? 0 : 1;
  };
  due.sort((a, b) => {
    const ba = bucket(a) - bucket(b);
    if (ba !== 0) return ba;
    if (sortByRetrievability) {
      const d2 = a.retrievability - b.retrievability;   // 最可能忘记在前（P20-18/60）
      if (d2 !== 0) return d2;
    }
    return a.due - b.due;
  });
  const n = Math.max(0, Math.floor(limit));
  return due.slice(0, n).map((c) => ({ path: c.path, due: c.due, retrievability: c.retrievability }));
}

/**
 * §三十三/三十四：刷新（同周期同指纹重算）时保留已完成/已跳过项，避免回退到第 1 张。
 * - freshActive：新算出的待复习项（pending/reviewing 顺序即复习顺序）
 * - carried：旧队列里已完成/已跳过的项（保持 completed/skipped 状态，追加在列表尾部，不计入待复习）
 * - relearnPaths：已完成/已跳过但 FSRS 已再到期（学习/重学步骤）→ 重新 pending（true FSRS 语义）
 */
export function mergeQueueForRefresh(
  freshItems: ReviewQueueItem[],
  previous: { path: string; status: string; completedAt?: number }[] | null,
  relearnPaths: Set<string>
): ReviewQueueItem[] {
  const prevByPath = new Map<string, { path: string; status: string; completedAt?: number }>();
  if (previous) for (const p of previous) if (p && !prevByPath.has(p.path)) prevByPath.set(p.path, p);
  const out: ReviewQueueItem[] = [];
  const added = new Set<string>();
  // 1) fresh 待复习项（已完成/已跳过且未再到期 → 稍后尾部保留，不进待复习）
  for (const it of freshItems) {
    const prev = prevByPath.get(it.path);
    const acted = prev && (prev.status === "completed" || prev.status === "skipped");
    if (acted && !relearnPaths.has(it.path)) continue;
    out.push({ ...it });
    added.add(it.path);
  }
  // 2) 旧已完成/已跳过项追加在尾部（§34：刷新不重置进度）
  for (const [p, prev] of prevByPath) {
    if (prev.status !== "completed" && prev.status !== "skipped") continue;
    if (added.has(p)) continue;
    if (relearnPaths.has(p)) {
      const base = freshItems.find((f) => f.path === p);
      if (base) out.push({ ...base, status: "pending", completedAt: undefined, snoozedUntil: undefined });
      else out.push({ path: p, stateAtSelection: "active", priorityScore: 0, status: "pending", selectedAt: Date.now() });
    } else {
      out.push({
        path: p,
        stateAtSelection: "active",
        priorityScore: 0,
        status: prev.status === "completed" ? "completed" as const : "skipped" as const,
        completedAt: prev.completedAt,
        selectedAt: Date.now(),
      });
    }
    added.add(p);
  }
  return out;
}

/* ================= 掌握度聚合 / 统计（§58/59/60/100/148：渲染不再全量重算历史日志） ================= */

export interface MasteryDistribution {
  relearn: number; building: number; basic: number; proficient: number; mastered: number;
}

export function emptyDistribution(): MasteryDistribution {
  return { relearn: 0, building: 0, basic: 0, proficient: 0, mastered: 0 };
}

export function masteryDistribution(cards: ReadonlyArray<{ masteryPercent?: number }>): MasteryDistribution {
  const dist = emptyDistribution();
  for (const c of cards) {
    if (typeof c.masteryPercent !== "number") continue;
    const band = reviewBandOf(c.masteryPercent);
    dist[band] += 1;
  }
  return dist;
}

export interface SpacedStats {
  cardCount: number;
  dueCount: number;          // due <= now（当前范围）
  newCount: number;          // 无 FSRS 卡的笔记数由调用方统计（需要 NoteIndex）
  avgRetrievability: number | null;
  avgMastery: number | null;
  reviewsToday: number;
  lapsesTotal: number;
}

/**
 * §100：聚合统计（O(card count)，不读全文；平均保持率/掌握度只在需要时算一次并缓存于 UI 层）
 * reviewsToday 由日志按本地日计数（日志已限制只存元数据）。
 */
export function computeSpacedStats(
  cards: ReadonlyArray<SpacedReviewCard>,
  logs: ReadonlyArray<ReviewLogEntry>,
  scheduler: FsrsScheduler,
  now: number
): SpacedStats {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const retr: number[] = [];
  const mastery: number[] = [];
  let dueCount = 0;
  let lapsesTotal = 0;
  for (const c of cards) {
    if (c.fsrsState.due <= now) dueCount++;
    if (c.fsrsState.lapses > 0) lapsesTotal += c.fsrsState.lapses;
    if (typeof c.masteryPercent === "number") mastery.push(c.masteryPercent);
    const r = scheduler.retrievability(c.fsrsState, now);
    if (r !== null) retr.push(r);
  }
  const reviewsToday = logs.filter((l) => l.timestamp >= startOfDay).length;
  return {
    cardCount: cards.length,
    dueCount,
    newCount: 0,
    avgRetrievability: retr.length ? retr.reduce((a, b) => a + b, 0) / retr.length : null,
    avgMastery: mastery.length ? mastery.reduce((a, b) => a + b, 0) / mastery.length : null,
    reviewsToday,
    lapsesTotal,
  };
}

/* ================= 本地持久化（§七/14/35/36/37/六：cache/spaced-review.json 一个 FSRS State Store） =================
 * formatVersion 2：Phase 21 起同文件保存 savedCards / savedCardReviewLogs（§六/一百二十三）。
 * 旧 v1 文件（cards/reviewLogs）容错加载；绝不另建 saved-card-fsrs.json（§一百二十四）。 */

export class SpacedReviewStore {
  private file: string;
  private cards = new Map<string, SpacedReviewCard>();
  private logs: ReviewLogEntry[] = [];
  private savedCards = new Map<string, SavedCardSpacedState>();
  private savedLogs: SavedCardReviewLogEntry[] = [];
  private static readonly FORMAT_VERSION = 2;

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "spaced-review.json");
  }

  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后置空（§36，不阻塞启动） */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as SpacedReviewFile;
      if (!raw || typeof raw !== "object") throw new Error("invalid spaced-review structure");
      if (raw.cards && typeof raw.cards === "object") {
        for (const [p, c] of Object.entries(raw.cards)) {
          const card = sanitizeCard(p, c);
          if (card) this.cards.set(p, card);
        }
      }
      if (Array.isArray(raw.reviewLogs)) {
        this.logs = raw.reviewLogs
          .filter((l) => l && typeof l === "object" && typeof l.path === "string" && typeof l.timestamp === "number")
          .slice(-REVIEW_LOG_MAX);
      }
      // Phase 21：savedCards（v1 文件缺失 → 空，兼容旧数据 §38/53）
      if (raw.savedCards && typeof raw.savedCards === "object") {
        for (const [id, c] of Object.entries(raw.savedCards)) {
          const card = sanitizeSavedCard(id, c);
          if (card) this.savedCards.set(id, card);
        }
      }
      if (Array.isArray(raw.savedCardReviewLogs)) {
        this.savedLogs = raw.savedCardReviewLogs
          .filter((l) => l && typeof l === "object" && typeof l.cardId === "string" && typeof l.timestamp === "number")
          .slice(-REVIEW_LOG_MAX);
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.cards.clear();
      this.logs = [];
      this.savedCards.clear();
      this.savedLogs = [];
      return isolated;
    }
  }

  /* ---------- Note-based FSRS（Phase 20 原 API，不变） ---------- */
  get(pathKey: string): SpacedReviewCard | undefined { return this.cards.get(pathKey); }
  all(): SpacedReviewCard[] { return Array.from(this.cards.values()); }
  count(): number { return this.cards.size; }
  logsAll(): ReviewLogEntry[] { return this.logs.slice(); }
  logsSince(ts: number): ReviewLogEntry[] { return this.logs.filter((l) => l.timestamp >= ts); }

  /**
   * 提交一次评分（§九十五：FSRS save 成功才算完成，失败抛错 → 调用方绝不 markReviewed）。
   * 先原子写盘再更新内存（写失败不产生半状态）；失败抛错由调用方提示并保留原 UI。
   */
  commitReview(pathKey: string, next: SpacedReviewCard, log: Omit<ReviewLogEntry, "path">): void {
    const card: SpacedReviewCard = { ...next, path: pathKey, updatedAt: Date.now() };
    const entry: ReviewLogEntry = { ...log, path: pathKey };
    const nextCards = new Map(this.cards);
    nextCards.set(pathKey, card);
    const nextLogs = this.logs.concat(entry).slice(-REVIEW_LOG_MAX);
    this.persist(nextCards, nextLogs, this.savedCards, this.savedLogs);      // 抛错则内存不变
    this.cards = nextCards;
    this.logs = nextLogs;
  }

  /** 删除笔记后清理（Test 18 语义）；Saved Card 状态不随 sourcePath 删除（§141） */
  prune(existing: Set<string>): void {
    let changed = false;
    for (const k of Array.from(this.cards.keys())) {
      if (!existing.has(k)) { this.cards.delete(k); changed = true; }
    }
    const kept = this.logs.filter((l) => existing.has(l.path));
    if (kept.length !== this.logs.length) { this.logs = kept; changed = true; }
    if (changed) this.persist(this.cards, this.logs, this.savedCards, this.savedLogs);
  }

  /** 笔记 rename 后 path 随行更新（不产生假死路径）；saved 主键 cardId 不变（§85） */
  migratePaths(oldPath: string, newPath: string): void {
    if (!this.cards.has(oldPath) && !this.logs.some((l) => l.path === oldPath)) return;
    const cards = new Map(this.cards);
    if (cards.has(oldPath)) {
      const c = cards.get(oldPath)!;
      cards.delete(oldPath);
      cards.set(newPath, { ...c, path: newPath, updatedAt: Date.now() });
    }
    const logs = this.logs.map((l) => (l.path === oldPath ? { ...l, path: newPath } : l));
    this.persist(cards, logs, this.savedCards, this.savedLogs);
    this.cards = cards;
    this.logs = logs;
  }

  /** §七十五/七十六：立即重排（笔记卡；备份 → 批量替换 → 失败恢复由调用方以 fileBackup 回滚） */
  replaceAllCards(nextCards: SpacedReviewCard[]): void {
    const cards = new Map<string, SpacedReviewCard>();
    for (const c of nextCards) if (c && c.path) cards.set(c.path, { ...c, updatedAt: Date.now() });
    this.persist(cards, this.logs, this.savedCards, this.savedLogs);
    this.cards = cards;
  }

  /* ---------- Saved Card FSRS（Phase 21：savedCard:<cardId> 主键，§三/五） ---------- */
  scGet(cardId: string): SavedCardSpacedState | undefined { return this.savedCards.get(cardId); }
  scAll(): SavedCardSpacedState[] { return Array.from(this.savedCards.values()); }
  scCount(): number { return this.savedCards.size; }
  scLogsAll(): SavedCardReviewLogEntry[] { return this.savedLogs.slice(); }

  /** §28/二十九：保存卡评分（FSRS save 成功才算完成，失败抛错 → 调用方不标已复习）。 */
  scCommitReview(cardId: string, next: SavedCardSpacedState, log: Omit<SavedCardReviewLogEntry, "cardId">): void {
    const state: SavedCardSpacedState = { ...next, cardId, updatedAt: Date.now() };
    const entry: SavedCardReviewLogEntry = { ...log, cardId };
    const nextStates = new Map(this.savedCards);
    nextStates.set(cardId, state);
    const nextLogs = this.savedLogs.concat(entry).slice(-REVIEW_LOG_MAX);
    this.persist(this.cards, this.logs, nextStates, nextLogs);      // 抛错则内存不变
    this.savedCards = nextStates;
    this.savedLogs = nextLogs;
  }

  /** §三十九：删除卡 → 同时删 Saved Card FSRS 状态与日志（不动 Exam/Source/AI Cache §39） */
  scRemoveCard(cardId: string): void {
    if (!this.savedCards.has(cardId) && !this.savedLogs.some((l) => l.cardId === cardId)) return;
    const states = new Map(this.savedCards);
    states.delete(cardId);
    const logs = this.savedLogs.filter((l) => l.cardId !== cardId);
    this.persist(this.cards, this.logs, states, logs);
    this.savedCards = states;
    this.savedLogs = logs;
  }

  /** §147：Saved Card 全部重排（与 Note 一起由 main 调用；本方法失败抛错内存不变） */
  scReplaceAll(nextStates: SavedCardSpacedState[]): void {
    const states = new Map<string, SavedCardSpacedState>();
    for (const s of nextStates) if (s && s.cardId) states.set(s.cardId, { ...s, updatedAt: Date.now() });
    this.persist(this.cards, this.logs, states, this.savedLogs);
    this.savedCards = states;
  }

  /** 文件原文备份（§76：重排前备份，失败 rollback） */
  fileSnapshot(): string | null {
    try { return fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : null; } catch { return null; }
  }

  /** 从备份恢复（§76 rollback）：写回后重载内存 */
  restoreSnapshot(snapshot: string | null): boolean {
    try {
      if (snapshot === null) {
        this.cards.clear();
        this.logs = [];
        this.savedCards.clear();
        this.savedLogs = [];
        this.persist(this.cards, this.logs, this.savedCards, this.savedLogs);
        return true;
      }
      fs.writeFileSync(this.file, snapshot, "utf8");
      this.load();
      return true;
    } catch {
      return false;
    }
  }

  private persist(
    cards: Map<string, SpacedReviewCard>,
    logs: ReviewLogEntry[],
    savedCards: Map<string, SavedCardSpacedState>,
    savedLogs: SavedCardReviewLogEntry[]
  ): void {
    const obj: SpacedReviewFile = {
      formatVersion: SpacedReviewStore.FORMAT_VERSION,
      cards: Object.fromEntries(cards),
      reviewLogs: logs,
      savedCards: Object.fromEntries(savedCards),
      savedCardReviewLogs: savedLogs,
    };
    atomicWriteJson(this.file, obj);   // 抛错向上传播
  }
}

function sanitizeCard(p: string, c: unknown): SpacedReviewCard | null {
  if (!c || typeof c !== "object") return null;
  const rec = c as Record<string, unknown>;
  const fsState = rec["fsrsState"] as Record<string, unknown> | undefined;
  if (!fsState || typeof fsState !== "object") return null;
  const f = (v: unknown, fb: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const due = f(fsState["due"], Date.now());
  const lastReviewRaw = fsState["lastReview"];
  const lastReview = typeof lastReviewRaw === "number" && Number.isFinite(lastReviewRaw) ? lastReviewRaw : undefined;
  return {
    path: p,
    fsrsState: {
      due,
      stability: Math.max(0.001, f(fsState["stability"], 1)),
      difficulty: Math.min(10, Math.max(1, f(fsState["difficulty"], 5))),
      reps: Math.max(0, Math.floor(f(fsState["reps"], 0))),
      lapses: Math.max(0, Math.floor(f(fsState["lapses"], 0))),
      state: Number(fsState["state"]) === State.Learning || Number(fsState["state"]) === State.Review || Number(fsState["state"]) === State.Relearning ? Number(fsState["state"]) : State.New,
      learningSteps: Math.max(0, Math.floor(f(fsState["learningSteps"], 0))),
      lastReview,
    },
    lastRating: FSRS_RATINGS.includes(rec["lastRating"] as FsrsRating) ? rec["lastRating"] as FsrsRating : undefined,
    reviewCount: Math.max(0, Math.floor(f(rec["reviewCount"], 0))),
    lastReviewedAt: typeof rec["lastReviewedAt"] === "number" ? rec["lastReviewedAt"] : undefined,
    masteryPercent: typeof rec["masteryPercent"] === "number" ? Math.max(0, Math.min(100, rec["masteryPercent"])) : undefined,
    createdAt: f(rec["createdAt"], Date.now()),
    updatedAt: f(rec["updatedAt"], Date.now()),
  };
}

function sanitizeSavedCard(id: string, c: unknown): SavedCardSpacedState | null {
  if (!c || typeof c !== "object") return null;
  const rec = c as Record<string, unknown>;
  const fsState = rec["fsrsState"] as Record<string, unknown> | undefined;
  if (!fsState || typeof fsState !== "object") return null;
  const f = (v: unknown, fb: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const lastReviewRaw = fsState["lastReview"];
  const lastReview = typeof lastReviewRaw === "number" && Number.isFinite(lastReviewRaw) ? lastReviewRaw : undefined;
  return {
    cardId: id,
    fsrsState: {
      due: f(fsState["due"], Date.now()),
      stability: Math.max(0.001, f(fsState["stability"], 1)),
      difficulty: Math.min(10, Math.max(1, f(fsState["difficulty"], 5))),
      reps: Math.max(0, Math.floor(f(fsState["reps"], 0))),
      lapses: Math.max(0, Math.floor(f(fsState["lapses"], 0))),
      state: Number(fsState["state"]) === State.Learning || Number(fsState["state"]) === State.Review || Number(fsState["state"]) === State.Relearning ? Number(fsState["state"]) : State.New,
      learningSteps: Math.max(0, Math.floor(f(fsState["learningSteps"], 0))),
      lastReview,
    },
    lastRating: FSRS_RATINGS.includes(rec["lastRating"] as FsrsRating) ? rec["lastRating"] as FsrsRating : undefined,
    reviewCount: Math.max(0, Math.floor(f(rec["reviewCount"], 0))),
    lastReviewedAt: typeof rec["lastReviewedAt"] === "number" ? rec["lastReviewedAt"] : undefined,
    masteryPercent: typeof rec["masteryPercent"] === "number" ? Math.max(0, Math.min(100, rec["masteryPercent"])) : undefined,
    createdAt: f(rec["createdAt"], Date.now()),
    updatedAt: f(rec["updatedAt"], Date.now()),
  };
}

/* ================= Phase 21：Saved Card 范围 / 队列 / 统计（纯函数；0 AI） ================= */

/** 同一 folder 前缀判断（saved card 按 sourcePath 过滤，§20/21） */
export function savedCardInFolder(sourcePath: string, folderPath: string): boolean {
  const fp = (folderPath || "").replace(/\/+$/, "");
  if (!fp) return true;
  if (sourcePath === fp || sourcePath === fp + ".md") return true;
  return sourcePath.startsWith(fp + "/");
}

/** §17~22：Saved Card Scope 过滤（按 SavedReviewCard.sourcePath / examId；只读索引元数据，0 AI） */
export function filterSavedCardObjects<T extends { sourcePath: string; examId?: string }>(
  cards: ReadonlyArray<T>,
  scope: SavedCardScope | null | undefined
): T[] {
  if (!scope || scope.mode === "vault") return cards as T[];
  const match = (c: { sourcePath: string; examId?: string }): boolean => {
    switch (scope.mode) {
      case "current-note":
        return !!scope.notePath && c.sourcePath === scope.notePath;
      case "folder":
        return !!scope.folderPath && savedCardInFolder(c.sourcePath, scope.folderPath);
      case "area":
        return !!scope.folderPath && savedCardInFolder(c.sourcePath, scope.folderPath);
      case "exam":
        return !!scope.examId && c.examId === scope.examId;
      case "custom": {
        if (scope.folders && scope.folders.length) {
          if (!scope.folders.some((f) => savedCardInFolder(c.sourcePath, f))) return false;
        }
        return true;
      }
      default:
        return true;
    }
  };
  return (cards as unknown as { sourcePath: string; examId?: string }[]).filter(match) as T[];
}

/** §17/29：Saved Card scope fingerprint（排序后 hash；exam 模式含 examId） */
export function savedCardScopeFingerprint(scope: SavedCardScope | null | undefined): string {
  const o: Record<string, unknown> = { mode: scope?.mode ?? "vault" };
  if (scope?.notePath) o["notePath"] = scope.notePath;
  if (scope?.folderPath) o["folderPath"] = scope.folderPath;
  if (scope?.areaId) o["areaId"] = scope.areaId;
  if (scope?.examId) o["examId"] = scope.examId;
  if (scope?.folders && scope.folders.length) o["folders"] = [...scope.folders].sort();
  const s = JSON.stringify(o);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function defaultSavedCardScope(): SavedCardScope {
  return { mode: "vault" };
}

/** §17 范围显示名（View 用） */
export function savedCardScopeText(scope: SavedCardScope | null | undefined, examTitle?: string): string {
  if (!scope || scope.mode === "vault") return "整个 Vault";
  switch (scope.mode) {
    case "current-note": return scope.notePath ? scope.notePath.replace(/\.md$/i, "") : "当前笔记";
    case "folder": return scope.folderPath || "（未选文件夹）";
    case "area": return scope.areaId || "（未选区域）";
    case "exam": return examTitle || scope.examId || "（未选考试）";
    case "custom": {
      const folders = (scope.folders ?? []).slice(0, 2);
      const more = (scope.folders ?? []).length > 2 ? " 等 " + (scope.folders?.length ?? 0) + " 个" : "";
      return (folders.length ? folders.join("、") : "（未选文件夹）") + more;
    }
  }
}

/** 本地日键（与 reviewCenter.dailyPeriodKey 同格式；避免循环依赖） */
function savedDayKey(now: number): string {
  const d = new Date(now);
  const p = (n: number): string => String(n).padStart(2, "0");
  return "daily:" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/**
 * §70/71：Saved Card 每日复习队列（纯函数；独立于 Note Queue §68/72，但共用 FsrsScheduler §69）。
 * 顺序：due<=now 卡按保持率升序（最可能忘记在前）→ 无 FSRS 状态的卡（首次复习/新）按 createdAt 升序；
 * 上限 = dailySavedCardsLimit（与笔记每日限额分别计数 §67）。
 */
export interface SavedCardQueueItem {
  cardId: string;
  state: SavedCardSpacedState | null;   // null = 尚无 FSRS 状态（首次评分时 createEmptyCard，§38/55）
  due?: number;
  retrievability?: number;
}

export interface SavedCardReviewQueue {
  periodKey: string;
  items: SavedCardQueueItem[];
  completedCount: number;
  skippedCount: number;
}

export function buildSavedCardReviewQueue(
  cards: ReadonlyArray<{ id: string; sourcePath: string; createdAt: number; examId?: string }>,
  states: ReadonlyArray<SavedCardSpacedState>,
  scheduler: FsrsScheduler,
  now: number,
  dailySavedCardsLimit: number,
  scope?: SavedCardScope | null
): SavedCardReviewQueue {
  const scoped = filterSavedCardObjects(cards, scope);
  const stateById = new Map(states.map((s) => [s.cardId, s] as const));
  const limit = Math.max(0, Math.floor(dailySavedCardsLimit));
  if (limit <= 0) return { periodKey: savedDayKey(now), items: [], completedCount: 0, skippedCount: 0 };
  const due = scoped
    .map((c) => ({ c, st: stateById.get(c.id) }))
    .filter((x): x is { c: typeof scoped[number]; st: SavedCardSpacedState } => !!x.st && x.st.fsrsState.due <= now)
    .map((x) => ({ id: x.c.id, state: x.st, retr: scheduler.retrievability(x.st.fsrsState, now) ?? 1 }))
    .sort((a, b) => a.retr - b.retr || a.state.fsrsState.due - b.state.fsrsState.due)
    .map((x) => ({ id: x.id, state: x.state }));
  const fresh = scoped
    .filter((c) => !stateById.has(c.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((c) => ({ id: c.id, state: null as SavedCardSpacedState | null }));
  const selected = [...due, ...fresh].slice(0, limit);
  return {
    periodKey: savedDayKey(now),
    items: selected.map((x) => ({
      cardId: x.id,
      state: x.state,
      due: x.state ? x.state.fsrsState.due : undefined,
      retrievability: x.state ? (scheduler.retrievability(x.state.fsrsState, now) ?? undefined) : undefined,
    })),
    completedCount: 0,
    skippedCount: 0,
  };
}

/** 掌握分布（Saved Card；复用掌握带边界 §23/61，0 AI） */
export function savedMasteryDistribution(states: ReadonlyArray<{ masteryPercent?: number }>): MasteryDistribution {
  const dist = emptyDistribution();
  for (const s of states) if (typeof s.masteryPercent === "number") dist[reviewBandOf(s.masteryPercent)]++;
  return dist;
}

/** §60/62：Saved Card 概况（本地计算；due = 今天到期卡数用于概览；忘记/稳定/总数/掌握分布） */
export interface SavedCardOverview {
  total: number;
  due: number;            // due <= now（含已到期）
  forgetting: number;     // due<=now 且保持率 <0.7（即将遗忘）
  stable: number;         // masteryPercent >= 80（稳定掌握）
  reviewsToday: number;
  avgRetrievability: number | null;
  avgMastery: number | null;
  dist: MasteryDistribution;
}

export function savedCardOverview(
  states: ReadonlyArray<SavedCardSpacedState>,
  logs: ReadonlyArray<SavedCardReviewLogEntry>,
  scheduler: FsrsScheduler,
  now: number
): SavedCardOverview {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let due = 0, forgetting = 0, stable = 0;
  const retr: number[] = [];
  const mastery: number[] = [];
  for (const s of states) {
    const r = scheduler.retrievability(s.fsrsState, now);
    if (s.fsrsState.due <= now) {
      due++;
      if (r !== null && r < 0.7) forgetting++;
    }
    if (r !== null) retr.push(r);
    if (typeof s.masteryPercent === "number") {
      mastery.push(s.masteryPercent);
      if (s.masteryPercent >= 80) stable++;
    }
  }
  return {
    total: states.length,
    due,
    forgetting,
    stable,
    reviewsToday: logs.filter((l) => l.timestamp >= startOfDay).length,
    avgRetrievability: retr.length ? retr.reduce((a, b) => a + b, 0) / retr.length : null,
    avgMastery: mastery.length ? mastery.reduce((a, b) => a + b, 0) / mastery.length : null,
    dist: savedMasteryDistribution(states),
  };
}
