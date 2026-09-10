/**
 * Phase 16 §65-67 + Phase 17 §32-34/37：Workbench Session（追问上下文持久化 + 气泡消息/Trace/Artifact 引用）。
 * - 每次 Ask 创建/续写 Session；追问保留上一轮 question + answerSnippet + sourcePaths（§66）。
 * - Phase 17 §34：Session reopen 必须恢复 User Bubble / Assistant Bubble / Sources / Trace / Artifact links。
 * - Phase 17 §37/§一百四十四：只存高层 Trace 摘要，绝不存 hidden reasoning / 原始 CoT（§五十五/§一百七十二）。
 * - 存储：cache/workbench-sessions.json 只存消息摘要与来源快照，不存 Prompt/笔记全文/Web 全文/API Key。
 */
import * as fs2 from "fs";
import * as path from "path";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import { sha256 } from "./ai/cache";
import type { AIAnswerSource, ArtifactRef, WorkbenchTraceEvent } from "./types";

/** Phase 17：Session 内持久化的消息摘要（恢复气泡所需；content 为最终答案/问题，不存 Prompt/推理） */
export interface WorkbenchSessionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  sources?: AIAnswerSource[];
  artifactRefs?: ArtifactRef[];
  model?: string;
  status?: "pending" | "streaming" | "complete" | "error";
  errorCode?: string;
}

export interface WorkbenchSessionRecord {
  sessionId: string;
  title: string;
  turnCount: number;
  question: string;
  prior?: { question: string; answerSnippet: string; sourcePaths: string[] };
  sources: AIAnswerSource[];
  workspaceName?: string;
  skillIds: string[];
  promptId?: string;
  /** Phase 16 §66：本轮结论摘要（追问时作为上一轮上下文注入） */
  answerSnippet?: string;
  createdAt: number;
  updatedAt: number;
  /** Phase 17 §32-34：消息气泡（恢复 User/Assistant Bubble） */
  messages?: WorkbenchSessionMessage[];
  /** Phase 17 §37：Trace 摘要（只存高层行为；禁止 hidden reasoning） */
  traceEvents?: WorkbenchTraceEvent[];
}

export interface WorkbenchSessionShape { formatVersion: number; sessions: WorkbenchSessionRecord[]; }

export function sessionIdFor(question: string, at: number): string {
  return "session-" + sha256(question + "|" + at).slice(0, 12);
}

/** 消息 ID（Phase 17 §66：每条 AI Message 唯一 ID） */
export function workbenchMessageId(question: string, at: number, n: number): string {
  return "msg-" + sha256(question + "|" + at + "|" + n).slice(0, 12);
}

/** Trace 事件 ID（Phase 17 §37） */
export function traceEventId(question: string, at: number, n: number): string {
  return "trace-" + sha256(question + "|" + at + "|" + n).slice(0, 12);
}
export class WorkbenchSessionStore {
  private sessions: WorkbenchSessionRecord[] = [];
  private file: string;
  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "workbench-sessions.json");
  }
  load(): boolean {
    try {
      if (!fs2.existsSync(this.file)) return false;
      const raw = JSON.parse(fs2.readFileSync(this.file, "utf8")) as WorkbenchSessionShape;
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions)) throw new Error("invalid session store");
      this.sessions = raw.sessions.slice(0, 50);
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.sessions = [];
      return isolated;
    }
  }
  get(sessionId: string): WorkbenchSessionRecord | undefined {
    return this.sessions.find((s) => s.sessionId === sessionId);
  }
  put(rec: WorkbenchSessionRecord): void {
    const i = this.sessions.findIndex((s) => s.sessionId === rec.sessionId);
    if (i >= 0) this.sessions[i] = rec; else this.sessions.push(rec);
    if (this.sessions.length > 50) this.sessions.splice(0, this.sessions.length - 50);
    this.flush();
  }
  list(): WorkbenchSessionRecord[] {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  recent(limit = 10): WorkbenchSessionRecord[] {
    return this.list().slice(0, limit);
  }
  flush(): void {
    try { atomicWriteJson(this.file, { formatVersion: 1, sessions: this.sessions }); } catch { /* 写盘失败不阻塞 */ }
  }
}
