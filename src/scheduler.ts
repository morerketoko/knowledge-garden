import { App, Modal, Notice } from "obsidian";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import * as fs from "fs";
import * as path from "path";
import type { Period, PluginSettings, ScheduleRecord, ScheduleStatus } from "./types";
import type { AIService } from "./ai/service";
import type { ReviewManager } from "./review";
import { periodKeyFor } from "./ai/cache";

/**
 * Phase 4：自动周期调度（§一~四十六）
 * - Scheduler 每分钟只判断“该不该运行”（§九/§十），绝不每分钟触发 AI。
 * - ScheduleState 存 cache/schedule.json，与 AI Cache、Activity 生命周期分离（§六）。
 * - 唯一执行由 periodKey + ScheduleState + AI Cache + executing 锁四者共同保证（§40）。
 * - 系统自动生成复盘 == ScheduleState done；绝不自动写 lastReviewedAt（§三/§三十一）。
 */

const TICK_MS = 60000;
const MISSED_GRACE_MIN = 15;   // 超过 15 分钟才判定为“错过”（正常到点后 60s 内会命中）
const MAX_ATTEMPTS = 3;        // 每周期最多 3 次（§27）
const RETRY_DELAYS_MIN = [10, 30]; // 第 1 次失败 → 10min；第 2 次 → 30min；第 3 次停止
const PROMPT_COOLDOWN_MS = 30 * 60000; // 弹窗关闭后 30 分钟内不再重复弹（避免每分钟骚扰）
const RETRYABLE = new Set(["TIMEOUT", "NETWORK", "HTTP_ERROR"]);

export type SchedulerReviewResult = { path: string; offline: boolean; fromCache: boolean };

export interface SchedulerHost {
  app: App;
  getSettings(): PluginSettings;
  reviews: ReviewManager;
  ai: AIService;
  runReview(period: Period, force: boolean, periodKeyOverride?: string): Promise<SchedulerReviewResult | null>;
  rerenderDashboard(): void;
}

/** 任意周期配置的公共形态（用于统一读取） */
export interface AnySchedule {
  enabled: boolean;
  time: string;
  weekday?: number;
  day?: string;
  everyDays?: number;
  anchorDate?: string;
}

export function periodCn(period: Period): string {
  return { daily: "日", weekly: "周", monthly: "月", quarterly: "季", custom: "自定义" }[period];
}

/* ---------- 纯周期计算（无 Obsidian 依赖，便于验证） ---------- */

function pad(n: number): string { return String(n).padStart(2, "0"); }
function todayBase(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function weekStart(d: Date): Date { const x = todayBase(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function parseTime(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || "20:00").trim());
  return m ? { h: Number(m[1]), m: Number(m[2]) } : { h: 20, m: 0 };
}
function atTime(d: Date, t: string): Date {
  const { h, m } = parseTime(t);
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
}
function lastDayOfMonth(y: number, m0: number): number { return new Date(y, m0 + 1, 0).getDate(); }
function monthDay(d: Date, day: string | number): number {
  if (day === "last") return lastDayOfMonth(d.getFullYear(), d.getMonth());
  const n = Number(day);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, lastDayOfMonth(d.getFullYear(), d.getMonth())) : lastDayOfMonth(d.getFullYear(), d.getMonth());
}
function quarterOf(d: Date): number { return Math.floor(d.getMonth() / 3) + 1; }
function quarterEndMonth0(q: number): number { return [2, 5, 8, 11][q - 1]; }
function quarterDay(d: Date, day: string | number): number {
  const m0 = quarterEndMonth0(quarterOf(d));
  if (day === "last") return lastDayOfMonth(d.getFullYear(), m0);
  const n = Number(day);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, lastDayOfMonth(d.getFullYear(), m0)) : lastDayOfMonth(d.getFullYear(), m0);
}
function dateKey(d: Date): string { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

/** custom：最近一次到期日（≤ 今天）；若锚点在将来，则返回锚点本身 */
export function customDueDate(cfg: AnySchedule, now = new Date()): Date {
  const every = Math.max(1, cfg.everyDays || 3);
  let base = cfg.anchorDate ? new Date(cfg.anchorDate + "T00:00:00") : new Date(NaN);
  if (isNaN(base.getTime())) base = todayBase(now);
  const today = todayBase(now);
  const diff = Math.floor((today.getTime() - base.getTime()) / 86400000);
  if (diff < 0) return base;
  return new Date(base.getTime() + Math.floor(diff / every) * every * 86400000);
}

/** 当前周期“本应执行”的调度时间（本地时间） */
export function scheduledAtFor(period: Period, cfg: AnySchedule, now = new Date()): Date | null {
  if (!cfg?.enabled) return null;
  switch (period) {
    case "daily": return atTime(now, cfg.time);
    case "weekly": {
      const ws = weekStart(now);
      const wd = ((cfg.weekday ?? 0) + 6) % 7;
      return atTime(addDays(ws, wd), cfg.time);
    }
    case "monthly": return atTime(new Date(now.getFullYear(), now.getMonth(), monthDay(now, cfg.day ?? "last")), cfg.time);
    case "quarterly": {
      const m0 = quarterEndMonth0(quarterOf(now));
      return atTime(new Date(now.getFullYear(), m0, quarterDay(now, cfg.day ?? "last")), cfg.time);
    }
    case "custom": return atTime(customDueDate(cfg, now), cfg.time);
  }
}

/** 下一次未来的调度时间（严格晚于 from；按周期精确推进，不偏移日号） */
export function getNextOccurrence(period: Period, cfg: AnySchedule, from = new Date()): Date | null {
  if (!cfg?.enabled) return null;
  switch (period) {
    case "daily": {
      let cand = atTime(from, cfg.time);
      if (cand.getTime() <= from.getTime()) cand = addDays(cand, 1);
      return cand;
    }
    case "weekly": {
      const ws = weekStart(from);
      let cand = atTime(addDays(ws, ((cfg.weekday ?? 0) + 6) % 7), cfg.time);
      if (cand.getTime() <= from.getTime()) cand = addDays(cand, 7);
      return cand;
    }
    case "monthly": {
      let cand = atTime(new Date(from.getFullYear(), from.getMonth(), monthDay(from, cfg.day ?? "last")), cfg.time);
      if (cand.getTime() <= from.getTime()) {
        const nd = new Date(from.getFullYear(), from.getMonth() + 1, 1);
        cand = atTime(new Date(nd.getFullYear(), nd.getMonth(), monthDay(nd, cfg.day ?? "last")), cfg.time);
      }
      return cand;
    }
    case "quarterly": {
      const q = quarterOf(from);
      const m0 = quarterEndMonth0(q);
      let cand = atTime(new Date(from.getFullYear(), m0, quarterDay(from, cfg.day ?? "last")), cfg.time);
      if (cand.getTime() <= from.getTime()) {
        const nq = q === 4 ? 1 : q + 1;
        const ny = q === 4 ? from.getFullYear() + 1 : from.getFullYear();
        const nm0 = quarterEndMonth0(nq);
        cand = atTime(new Date(ny, nm0, quarterDay(new Date(ny, nm0, 1), cfg.day ?? "last")), cfg.time);
      }
      return cand;
    }
    case "custom": {
      const every = Math.max(1, cfg.everyDays || 3);
      let base = cfg.anchorDate ? new Date(cfg.anchorDate + "T00:00:00") : new Date(NaN);
      if (isNaN(base.getTime())) base = todayBase(from);
      const anchorTs = todayBase(base).getTime();
      const diff = Math.floor((todayBase(from).getTime() - anchorTs) / 86400000);
      let k = Math.max(0, Math.ceil(diff / every));
      let due = new Date(anchorTs + k * every * 86400000);
      if (due.getTime() <= from.getTime()) due = new Date(due.getTime() + every * 86400000);
      return atTime(due, cfg.time);
    }
  }
}

/** 当前周期 key：与 Phase 2.5 periodKeyFor 完全一致；custom 用到期日（§13/16/42） */
export function currentPeriodKey(period: Period, cfg: AnySchedule, now = new Date()): string {
  if (period === "custom") return "custom:" + dateKey(customDueDate(cfg, now));
  return periodKeyFor(period, now);
}

export function nextLabel(d: Date, now = new Date()): string {
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  const today = todayBase(now);
  const dayDiff = Math.round((todayBase(d).getTime() - today.getTime()) / 86400000);
  const weekCn = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  const head = dayDiff === 0 ? "今天" : dayDiff === 1 ? "明天" : dayDiff === -1 ? "昨天" : (dayDiff > 1 && dayDiff < 7) ? weekCn : (d.getMonth() + 1) + "月" + d.getDate() + "日";
  const ms = d.getTime() - now.getTime();
  const rel = ms <= 0 ? "已到时间" : ms < 60000 ? "不足 1 分钟" : ms < 3600000 ? Math.ceil(ms / 60000) + " 分钟后" : (Math.floor(ms / 3600000) + " 小时后");
  return head + " " + hm + "（" + rel + "）";
}

/* ---------- ScheduleStore：cache/schedule.json（§六） ---------- */

export class ScheduleStore {
  private file: string;
  private records = new Map<string, ScheduleRecord>();

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "schedule.json");
  }

  /** 启动时恢复；损坏 → 隔离 *.corrupt-* 后重建空 schedule（§十二），返回是否执行了隔离 */
  load(): boolean {
    let corrupt = false;
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as ScheduleRecord[];
      if (!Array.isArray(raw)) throw new Error("invalid schedule structure");
      const now = Date.now();
      const CUTOFF = now - 60 * 86400000; // 60 天前归档（当前周期永远保留）
      for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        if (typeof r.type !== "string" || typeof r.periodKey !== "string") continue;
        if (!["pending", "queued", "running", "done", "skipped", "missed"].includes(r.status)) continue;
        const key = r.type + ":" + r.periodKey;
        const old = this.records.get(key);
        if (old && (old.completedAt ?? old.scheduledAt) > (r.completedAt ?? r.scheduledAt)) continue;
        if (r.status === "done" || r.status === "skipped") {
          if ((r.completedAt ?? r.skippedAt ?? r.scheduledAt) < CUTOFF) continue;
        }
        this.records.set(key, r);
      }
    } catch {
      // 损坏 → 隔离原文件（保留可恢复副本）+ 重建空 schedule（§十二：自动复盘状态需要重新计算）
      corrupt = isolateCorruptFile(this.file);
      this.records.clear();
    }
    this.flush();
    return corrupt;
  }

  /** 诊断用：只读轻量快照（不含任何敏感内容） */
  allRecords(): { type: string; periodKey: string; status: string }[] {
    return Array.from(this.records.values()).map((r) => ({
      type: r.type,
      periodKey: r.periodKey,
      status: r.status,
    }));
  }

  get(type: Period, periodKey: string): ScheduleRecord | undefined {
    return this.records.get(type + ":" + periodKey);
  }

  upsert(rec: ScheduleRecord): void {
    this.records.set(rec.type + ":" + rec.periodKey, rec);
    this.flush();
  }

  flush(): void {
    try {
      atomicWriteJson(this.file, Array.from(this.records.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][Scheduler] schedule 写入失败：", (e as Error).message);
    }
  }
}

/* ---------- 确认弹窗（§21/22/23） ---------- */

export class ConfirmReviewModal extends Modal {
  constructor(
    app: App,
    private opts: {
      title: string;
      body: string;
      onRun: () => void;
      onSkip: () => void;
      onSnooze: (minutes: number) => void;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kg-sched-modal");
    contentEl.createEl("h3", { text: this.opts.title });
    contentEl.createEl("p", { text: this.opts.body });

    const btnRow = contentEl.createDiv({ cls: "kg-modal-actions" });
    const runBtn = btnRow.createEl("button", { cls: "mod-cta", text: "生成复盘" });
    runBtn.addEventListener("click", () => { this.close(); this.opts.onRun(); });
    const skipBtn = btnRow.createEl("button", { cls: "mod-secondary", text: "跳过本次" });
    skipBtn.addEventListener("click", () => { this.close(); this.opts.onSkip(); });

    contentEl.createDiv({ cls: "kg-modal-hint", text: "稍后提醒：" });
    const snoozeRow = contentEl.createDiv({ cls: "kg-modal-actions" });
    for (const min of [10, 30, 60]) {
      const b = snoozeRow.createEl("button", { cls: "mod-secondary", text: min + " 分钟" });
      b.addEventListener("click", () => { this.close(); this.opts.onSnooze(min); });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/* ---------- ReviewScheduler（§七） ---------- */

export class ReviewScheduler {
  private store: ScheduleStore;
  private executing = new Set<string>();      // §28 锁
  private prompting = new Map<Period, number>(); // 弹窗冷却
  private lastStatus = new Map<Period, ScheduleStatus | "disabled">();

  constructor(private host: SchedulerHost, pluginDir: string) {
    this.store = new ScheduleStore(pluginDir);
  }

  /** §36：加载 + 启动检查（启动检查绝不直接无提示消耗 AI） */
  start(): void {
    const corrupt = this.store.load();
    if (corrupt) {
      // §十二：schedule 损坏重建后，本次启动不自动触发复盘，避免突然连续执行多个 missed
      new Notice("自动复盘调度数据已损坏，已隔离并重建。本次启动不自动触发复盘。");
      return;
    }
    if (this.host.getSettings().automaticReview.startupCheck) void this.checkNow();
  }

  stop(): void {
    this.executing.clear();
    this.store.flush();
  }

  private scheduleFor(period: Period): AnySchedule | undefined {
    const cfg = this.host.getSettings().review[period] as unknown as AnySchedule;
    return cfg?.enabled ? cfg : undefined;
  }

  /** 每分钟只判断“该不该运行”（§九/十/三十五）：只读 ScheduleState + 时间 + 配置 + Cache 元数据 */
  async checkNow(onlyType?: Period): Promise<void> {
    const types: Period[] = onlyType ? [onlyType] : ["daily", "weekly", "monthly", "quarterly", "custom"];
    for (const period of types) {
      try {
        await this.checkType(period);
      } catch (e) {
        console.error("[KnowledgeGarden][Scheduler] check " + period + " 失败：", (e as Error)?.message || e);
      }
    }
  }

  private async checkType(period: Period): Promise<void> {
    const cfg = this.scheduleFor(period);
    if (!cfg) return;
    const now = new Date();
    const periodKey = currentPeriodKey(period, cfg, now);
    const ts = scheduledAtFor(period, cfg, now)?.getTime();
    if (!ts) return;
    let rec = this.store.get(period, periodKey);

    if (rec?.snoozedUntil && now.getTime() < rec.snoozedUntil) return;
    if (rec && (rec.status === "done" || rec.status === "skipped")) return;

    // 中断恢复：上一会话 running 但本进程无锁 → 先查缓存再决定（§43 Test 12）
    if (rec?.status === "running" && !this.executing.has(period + ":" + periodKey)) {
      rec = { ...rec, status: "pending", lastError: { code: "INTERRUPTED", message: "上次执行中断，等待重新检查" } };
      this.store.upsert(rec);
      this.onChange(period);
    }
    if (rec?.retryAt && now.getTime() < rec.retryAt) return;

    if (!rec) {
      rec = { type: period, periodKey, scheduledAt: ts, status: "pending" };
      this.store.upsert(rec);
      this.onChange(period);
    }
    if (ts > now.getTime()) return; // 未到点

    const auto = this.host.getSettings().automaticReview;
    const missed = now.getTime() - ts > MISSED_GRACE_MIN * 60000;

    if (missed) {
      // §19/36：错过的任务绝不无提示直接运行
      if (!auto.enabled) return;
      if (auto.confirmAfterMissed) { this.prompt(period, periodKey, rec, true); return; }
      const rec2 = { ...rec, status: "skipped" as ScheduleStatus, skippedAt: now.getTime() };
      this.store.upsert(rec2);
      this.onChange(period);
      new Notice("自动复盘：上次" + periodCn(period) + "复盘已错过，按设置跳过（可在设置开启「错过后询问」）。");
      return;
    }

    if (!auto.enabled) return;
    if (auto.confirmBeforeRun) { this.prompt(period, periodKey, rec, false); return; }
    await this.runFlow(period, cfg, periodKey, rec);
  }

  private prompt(period: Period, periodKey: string, rec: ScheduleRecord, missed: boolean): void {
    const now = Date.now();
    const last = this.prompting.get(period);
    if (last && now - last < PROMPT_COOLDOWN_MS) return;
    this.prompting.set(period, now);
    const cn = periodCn(period);
    new ConfirmReviewModal(this.host.app, {
      title: "Knowledge Garden",
      body: missed
        ? "上次" + cn + "复盘已错过。" + "将分析最近的知识状态并生成" + cn + "复盘。会自动检查本周期缓存，已有结果直接复用。"
        : cn + "复盘时间到了。" + "将分析最近的知识状态并生成" + cn + "复盘。会自动检查本周期缓存，已有结果直接复用。",
      onRun: () => { void this.runFlow(period, this.scheduleFor(period)!, periodKey, rec); },
      onSkip: () => this.skipCurrent(period),
      onSnooze: (min) => this.snoozeCurrent(period, min),
    }).open();
  }

  /** §24/25/40：自动模式执行（四重校验：periodKey + ScheduleState + executing + AI Cache） */
  private async runFlow(period: Period, cfg: AnySchedule, periodKey: string, rec: ScheduleRecord): Promise<void> {
    const key = period + ":" + periodKey;
    if (this.executing.has(key)) return;
    const auto = this.host.getSettings().automaticReview;
    if (!auto.enabled) return;
    const cur = this.store.get(period, periodKey);
    if (cur && (cur.status === "done" || cur.status === "skipped")) return;
    const now = Date.now();

    // §25：缓存预检（只算指纹元数据，不读笔记内容）
    const meta = this.host.reviews.prepareCacheMeta(period, periodKey);
    const cacheHit = meta ? this.host.ai.cacheStatus(reviewCacheType(period), meta.periodKey, meta.candidateSig, meta.areaSig) : "none";
    if (cacheHit === "success") {
      this.markDone(period, periodKey, null, undefined);
      new Notice("本周期" + periodCn(period) + "复盘已存在（AI 缓存命中），无需重新生成。");
      return;
    }
    if (cacheHit === "error") {
      // §26：error 缓存不得写 done；按重试策略（§27）
      this.maybeRetry(period, periodKey, rec, (rec.attempts ?? 0) + 1, { code: "AI_ERROR_CACHED", message: "上次 AI 请求失败（错误缓存）" });
      return;
    }

    this.executing.add(key);
    const running: ScheduleRecord = { ...rec, status: "running", startedAt: now, attempts: (rec.attempts ?? 0) + 1 };
    this.store.upsert(running);
    this.onChange(period);
    try {
      const result = await this.host.runReview(period, false, periodKey);
      // runReview 内部会 markGenerated → done；兜底 null（无候选）也标记完成，避免每分钟重试
      if (result === null) this.markDone(period, periodKey, null, { code: "EMPTY_VAULT", message: "没有可复盘的候选笔记" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.maybeRetry(period, periodKey, running, running.attempts ?? 1, { code: "UNEXPECTED", message: msg }, true);
    } finally {
      this.executing.delete(key);
    }
  }

  /** §29/30：手动 / 强制生成成功后同样写 ScheduleState=done（Scheduler 到点会直接跳过） */
  markGenerated(period: Period, result: SchedulerReviewResult | null): void {
    const cfg = this.scheduleFor(period);
    if (!cfg) return;
    const now = new Date();
    const periodKey = currentPeriodKey(period, cfg, now);
    this.markDone(period, periodKey, result, result ? undefined : { code: "EMPTY_VAULT", message: "没有可复盘的候选笔记" });
  }

  /** 用户跳过当前周期（§23） */
  skipCurrent(period: Period): void {
    const cfg = this.scheduleFor(period);
    if (!cfg) return;
    const now = Date.now();
    const periodKey = currentPeriodKey(period, cfg, new Date());
    const prev = this.store.get(period, periodKey);
    const rec: ScheduleRecord = { type: period, periodKey, scheduledAt: prev?.scheduledAt ?? now, status: "skipped", skippedAt: now };
    this.store.upsert(rec);
    this.onChange(period);
    new Notice("已跳过本次" + periodCn(period) + "复盘；本周期不再自动触发，仍可手动生成。");
  }

  /** §22：稍后提醒（只加 snoozedUntil，不新建周期） */
  snoozeCurrent(period: Period, minutes: number): void {
    const cfg = this.scheduleFor(period);
    if (!cfg) return;
    const now = Date.now();
    const periodKey = currentPeriodKey(period, cfg, new Date());
    const prev = this.store.get(period, periodKey) ?? { type: period, periodKey, scheduledAt: now, status: "pending" as ScheduleStatus };
    const rec: ScheduleRecord = { ...prev, status: "pending", snoozedUntil: now + minutes * 60000, retryAt: undefined };
    this.store.upsert(rec);
    this.onChange(period);
    new Notice("已设为 " + minutes + " 分钟后提醒。");
  }

  private markDone(period: Period, periodKey: string, result: SchedulerReviewResult | null, lastError?: { code: string; message: string }): void {
    const now = Date.now();
    const prev = this.store.get(period, periodKey);
    const rec: ScheduleRecord = {
      type: period,
      periodKey,
      scheduledAt: prev?.scheduledAt ?? now,
      status: "done",
      completedAt: now,
      attempts: prev?.attempts ?? 1,
      lastError: lastError ?? (result?.offline ? { code: "AI_UNAVAILABLE", message: "本轮复盘以本地降级生成" } : undefined),
    };
    this.store.upsert(rec);
    this.onChange(period);
  }

  /** §26/27：有限重试（TIMEOUT/NETWORK/HTTP_ERROR 才重试，最多 3 次；MISSING_KEY/INVALID_JSON 停止） */
  private maybeRetry(period: Period, periodKey: string, rec: ScheduleRecord, attempts: number, err: { code: string; message: string }, unexpected = false): void {
    const now = Date.now();
    const retryable = unexpected || RETRYABLE.has(err.code) || /timeout|超时|网络|TIMEOUT|NETWORK/i.test(err.code + " " + err.message);
    if (retryable && attempts < MAX_ATTEMPTS) {
      const delayMin = RETRY_DELAYS_MIN[Math.min(attempts - 1, RETRY_DELAYS_MIN.length - 1)];
      const rec2: ScheduleRecord = { ...rec, status: "pending", attempts, retryAt: now + delayMin * 60000, lastError: err };
      this.store.upsert(rec2);
      this.onChange(period);
      new Notice("自动复盘失败（" + err.code + "），将在 " + delayMin + " 分钟后重试（" + attempts + "/" + MAX_ATTEMPTS + "）。");
      return;
    }
    const rec2: ScheduleRecord = { ...rec, status: "missed", attempts, lastError: err };
    this.store.upsert(rec2);
    this.onChange(period);
    new Notice("自动复盘失败（" + err.code + "），已停止自动重试。可在命令面板手动生成。");
  }

  /** Dashboard：下次复盘（未启用 → null） */
  getNextReviewInfo(): { type: Period; date: number; label: string } | null {
    const auto = this.host.getSettings().automaticReview;
    if (!auto.enabled) return null;
    const now = new Date();
    let best: { type: Period; d: Date } | null = null;
    for (const period of ["daily", "weekly", "monthly", "quarterly", "custom"] as Period[]) {
      const cfg = this.scheduleFor(period);
      if (!cfg) continue;
      const d = getNextOccurrence(period, cfg, now);
      if (d && (!best || d.getTime() < best.d.getTime())) best = { type: period, d };
    }
    return best ? { type: best.type, date: best.d.getTime(), label: nextLabel(best.d, now) } : null;
  }

  /** Dashboard：当前周期状态行（§33） */
  getStatusLines(): { type: Period; status: ScheduleStatus | "disabled"; text: string }[] {
    const now = new Date();
    const out: { type: Period; status: ScheduleStatus | "disabled"; text: string }[] = [];
    for (const period of ["daily", "weekly", "monthly", "quarterly", "custom"] as Period[]) {
      const cfg = this.scheduleFor(period);
      const cn = periodCn(period);
      if (!cfg) { out.push({ type: period, status: "disabled", text: "○ " + cn + "复盘 未启用自动调度" }); continue; }
      const rec = this.store.get(period, currentPeriodKey(period, cfg, now));
      const status: ScheduleStatus = rec?.status ?? "pending";
      const icon = status === "done" ? "●" : status === "running" || status === "queued" ? "◷" : status === "skipped" ? "—" : status === "missed" ? "!" : "○";
      const text = icon + " " + cn + "复盘 " + (status === "done" ? "已完成" : status === "running" ? "运行中" : status === "skipped" ? "已跳过" : status === "missed" ? "上次失败" : "待生成");
      out.push({ type: period, status, text });
    }
    return out;
  }

  /** Phase 9 诊断（§四十一）：只读状态摘要，不含任何敏感内容 */
  diagnostics(): { enabled: boolean; records: { type: string; periodKey: string; status: string }[] } {
    return {
      enabled: this.host.getSettings().automaticReview.enabled,
      records: this.store.allRecords(),
    };
  }
  /** 状态总览（命令面板：查看自动复盘调度状态） */
  showStatus(): void {
    const auto = this.host.getSettings().automaticReview;
    if (!auto.enabled) { new Notice("自动复盘未启用（设置 → Automatic Review）。", 8000); return; }
    const next = this.getNextReviewInfo();
    const lines = this.getStatusLines().filter((l) => l.status !== "disabled").map((l) => l.text);
    new Notice(("下次复盘：" + (next ? next.label : "暂无")) + "\n" + lines.join("\n"), 10000);
  }

  /** §34：只在状态变化时刷新 Dashboard */
  private onChange(period: Period): void {
    const cfg = this.scheduleFor(period);
    const status: ScheduleStatus | "disabled" = cfg
      ? (this.store.get(period, currentPeriodKey(period, cfg, new Date()))?.status ?? "pending")
      : "disabled";
    const prev = this.lastStatus.get(period);
    if (prev === status) return;
    this.lastStatus.set(period, status);
    this.host.rerenderDashboard();
  }
}

/** 复盘缓存类型（§42：Scheduler 与 AI Cache 共用） */
export function reviewCacheType(period: Period): "daily_review" | "weekly_review" | "monthly_review" | "quarterly_review" {
  return period === "daily" ? "daily_review" : period === "monthly" ? "monthly_review" : period === "quarterly" ? "quarterly_review" : "weekly_review";
}