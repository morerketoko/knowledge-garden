/** Phase 13 §七十七~§八十六：统一 AI Task Engine。
 * - 统一任务生命周期（§七十九）：Created → Preparing → Context Ready → Cache Check → Queued → Running → Success / Error / Cancelled。
 * - Task ID（§八十）：用于 Diagnostics / Cancellation / Progress / Coalescing。
 * - 接口允许 foreground / background（§八十二：本阶段仍前台为主，接口保留扩展）。
 * - Cancel（§八十四）：AbortController（Provider 支持时）。
 * - 错误继续使用现有枚举（§八十五：MISSING_KEY/TIMEOUT/NETWORK/HTTP_ERROR/INVALID_JSON/EMPTY_RESPONSE），不新增第二套。
 * - Coalescing（§八十六）由 AIService 现有请求合并承担；Task Engine 只负责状态与标识。
 */
import type { AIFeature } from "./types";

export type AITaskStatus =
  | "created"
  | "preparing"
  | "context_ready"
  | "cache_check"
  | "queued"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export interface AITask {
  taskId: string;
  feature: AIFeature;
  status: AITaskStatus;
  createdAt: number;
  updatedAt: number;
  foreground: boolean;
  /** 任务描述（UI 展示用） */
  label: string;
  /** Provider 支持时用于取消（§八十四） */
  abort?: AbortController;
  /** 错误码沿用现有枚举（§八十五） */
  errorCode?: string;
}

const ERROR_CODES = ["MISSING_KEY", "TIMEOUT", "NETWORK", "HTTP_ERROR", "INVALID_JSON", "EMPTY_RESPONSE"] as const;
export type AIErrorCode = (typeof ERROR_CODES)[number];
export const AI_ERROR_CODES: readonly string[] = ERROR_CODES;

let taskSeq = 0;
function nextTaskId(feature: AIFeature): string {
  taskSeq++;
  return "kg-task-" + Date.now().toString(36) + "-" + feature + "-" + taskSeq;
}

export class AITaskEngine {
  private tasks = new Map<string, AITask>();

  create(feature: AIFeature, opts?: { foreground?: boolean; label?: string }): AITask {
    const now = Date.now();
    const task: AITask = {
      taskId: nextTaskId(feature),
      feature,
      status: "created",
      createdAt: now,
      updatedAt: now,
      foreground: opts?.foreground !== false,
      label: opts?.label || feature,
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  setStatus(taskId: string, status: AITaskStatus): AITask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.status = status;
    t.updatedAt = Date.now();
    return t;
  }

  setError(taskId: string, code?: string): AITask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.status = "error";
    t.errorCode = code;
    t.updatedAt = Date.now();
    return t;
  }

  cancel(taskId: string): AITask | undefined {
    const t = this.tasks.get(taskId);
    if (!t) return undefined;
    t.status = "cancelled";
    t.updatedAt = Date.now();
    t.abort?.abort();
    return t;
  }

  get(taskId: string): AITask | undefined {
    return this.tasks.get(taskId);
  }

  list(): AITask[] {
    return Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  running(): AITask[] {
    return this.list().filter((t) => t.status === "running" || t.status === "queued" || t.status === "preparing");
  }

  /** 最近 N 条（Diagnostics 展示，§一百二十四） */
  recent(limit = 8): AITask[] {
    return this.list().slice(-limit).reverse();
  }
}

export function taskStatusLabel(s: AITaskStatus): string {
  const map: Record<AITaskStatus, string> = {
    created: "Created",
    preparing: "Preparing",
    context_ready: "Context Ready",
    cache_check: "Cache Check",
    queued: "Queued",
    running: "Running",
    success: "Done",
    error: "Failed",
    cancelled: "Cancelled",
  };
  return map[s] ?? s;
}
