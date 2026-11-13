/**
 * Phase 25：启动任务协调器（Startup Performance）。
 *
 * 目标：
 * - 区分「必要初始化」与「按需初始化」：重活只在真正需要时执行一次。
 * - 同一任务重复调用返回同一个 Promise（并发去重，绝不二次初始化）。
 * - 状态机 idle → scheduled → running → completed / failed，并记录 durationMs。
 * - failed 后允许显式重试（resetFailed），completed 后绝不重复执行。
 * - 后台任务并发上限（默认 2），防止一次性把主线程/磁盘 IO 打满。
 * - 插件卸载时停止「尚未开始」的任务；已经开始的任务允许跑完（持久化操作不半途而废）。
 * - 绝不吞异常：失败一定 console.error 并返回 reject，由上层决定 UI 与重试。
 *
 * 注意：状态存在实例内（不是全局变量），插件重载即重置。
 */

export type StartupTaskState = "idle" | "scheduled" | "running" | "completed" | "failed";

export interface StartupTaskInfo {
  id: string;
  state: StartupTaskState;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
}

interface TaskEntry {
  info: StartupTaskInfo;
  promise: Promise<unknown> | null;
  result?: unknown;
}

interface QueuedJob {
  id: string;
  entry: TaskEntry;
  task: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/** 任务被 dispose（插件卸载）中断时的错误码，便于上层区分“卸载”与“真失败” */
export const STARTUP_ABORTED = "STARTUP_ABORTED";

export class StartupAbortedError extends Error {
  readonly code = STARTUP_ABORTED;
  constructor(id: string) {
    super("启动任务已停止（插件卸载）：" + id);
    this.name = "StartupAbortedError";
  }
}

export class StartupCoordinator {
  private entries = new Map<string, TaskEntry>();
  private queue: QueuedJob[] = [];
  private running = 0;
  private disposed = false;

  constructor(
    /** 后台任务最大并发（默认 2：索引 + 搜索/其他，避免无限并发） */
    private readonly maxConcurrent = 2,
    /** 状态变化回调（Diagnostics / 日志用；不抛错） */
    private readonly onStateChange?: (info: StartupTaskInfo) => void
  ) {}

  /** 同一个任务重复调用 → 同一个 Promise；completed → 直接返回已完成结果 */
  runOnce<T>(id: string, task: () => Promise<T>): Promise<T> {
    const entry = this.requireEntry(id);
    const st = entry.info.state;

    if (st === "running" || st === "scheduled") return entry.promise as Promise<T>;
    if (st === "completed") return Promise.resolve(entry.result as T);
    if (st === "failed") {
      // failed 不自动重跑：必须显式 resetFailed（避免被动触发陷入失败循环）
      return Promise.reject(new Error(entry.info.error ?? ("任务失败：" + id)));
    }

    if (this.disposed) {
      const err = new StartupAbortedError(id);
      entry.info.state = "failed";
      entry.info.error = err.message;
      this.emit(entry.info);
      return Promise.reject(err);
    }

    entry.info.state = "scheduled";
    entry.info.error = undefined;
    entry.info.startedAt = undefined;
    entry.info.finishedAt = undefined;
    entry.info.durationMs = undefined;
    this.emit(entry.info);

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({
        id,
        entry: entry as TaskEntry,
        task: task as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.pump();
    });
    entry.promise = promise;
    // 后台任务拒绝不形成 unhandled rejection（调用方仍拿到同一个 rejected promise）
    promise.catch(() => { /* 由调用方处理；此处仅标记已处理 */ });
    return promise;
  }

  /** 记录一段同步阶段的耗时（onload 内的必要初始化，例如 loadSettings / storesInit） */
  recordStage(id: string, durationMs: number, error?: unknown): void {
    const entry = this.requireEntry(id);
    entry.info.state = error ? "failed" : "completed";
    entry.info.startedAt = entry.info.startedAt ?? Date.now() - durationMs;
    entry.info.finishedAt = Date.now();
    entry.info.durationMs = durationMs;
    entry.info.error = error ? errorText(error) : undefined;
    this.emit(entry.info);
  }

  /** 标记某任务正在运行（用于外部自行启动的任务，例如手动 rescan） */
  markRunning(id: string): void {
    const entry = this.requireEntry(id);
    entry.info.state = "running";
    entry.info.startedAt = Date.now();
    this.emit(entry.info);
  }

  getState(id: string): StartupTaskInfo | undefined {
    const e = this.entries.get(id);
    return e ? { ...e.info } : undefined;
  }

  getAllStates(): StartupTaskInfo[] {
    return Array.from(this.entries.values())
      .map((e) => ({ ...e.info }))
      .sort((a, b) => (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER));
  }

  /** failed → idle，允许下一次 runOnce 重新执行 */
  resetFailed(id: string): void {
    const e = this.entries.get(id);
    if (!e || e.info.state !== "failed") return;
    e.info.state = "idle";
    e.info.error = undefined;
    e.info.startedAt = undefined;
    e.info.finishedAt = undefined;
    e.info.durationMs = undefined;
    e.promise = null;
    e.result = undefined;
    this.emit(e.info);
  }

  /** 已开始的任务数量（Diagnostics 用） */
  runningCount(): number { return this.running; }
  pendingCount(): number { return this.queue.length; }
  isDisposed(): boolean { return this.disposed; }

  /** 插件卸载：停止尚未开始的任务（已开始的允许完成） */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const aborted = this.queue.splice(0, this.queue.length);
    for (const job of aborted) {
      const err = new StartupAbortedError(job.id);
      job.entry.info.state = "failed";
      job.entry.info.error = err.message;
      job.entry.info.finishedAt = Date.now();
      this.emit(job.entry.info);
      job.reject(err);
    }
  }

  /* ---------------- 内部 ---------------- */

  private requireEntry(id: string): TaskEntry {
    let e = this.entries.get(id);
    if (!e) {
      e = { info: { id, state: "idle" }, promise: null };
      this.entries.set(id, e);
    }
    return e;
  }

  private pump(): void {
    while (!this.disposed && this.running < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      const entry = job.entry;
      entry.info.state = "running";
      entry.info.startedAt = Date.now();
      this.emit(entry.info);

      const startedAt = entry.info.startedAt;
      Promise.resolve()
        .then(() => job.task())
        .then(
          (res) => {
            entry.result = res;
            entry.info.state = "completed";
            entry.info.finishedAt = Date.now();
            entry.info.durationMs = entry.info.finishedAt - startedAt;
            this.emit(entry.info);
            job.resolve(res);
          },
          (err) => {
            entry.info.state = "failed";
            entry.info.finishedAt = Date.now();
            entry.info.durationMs = entry.info.finishedAt - startedAt;
            entry.info.error = errorText(err);
            // 绝不静默：完整异常交给 console（上层再决定 Notice / Diagnostics）
            console.error("[KnowledgeGarden][Startup] task=" + job.id + " failed", err);
            this.emit(entry.info);
            job.reject(err);
          }
        )
        .then(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private emit(info: StartupTaskInfo): void {
    if (!this.onStateChange) return;
    try { this.onStateChange({ ...info }); } catch { /* 回调不得影响任务本身 */ }
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}
