/**
 * Phase 15：AI Workbench Response Parsers（纯函数，无 Obsidian 依赖，可 Node 夹具测试）。
 * - 职责：AI raw response → 领域对象（§十三/二十一/三十一）。
 * - 非法 JSON / 缺字段 → 返回 null，由调用方决定 error cache（§一百四十七）。
 * - 不承载持久化、不写缓存；只做结构解析与基础类型校验。
 */
import type { AIAnswerSource } from "./types";

/** Ask 解析结果（§十三~十六：answer + 可溯源 sources + 未解答问题） */
export interface WorkbenchAskParsed {
  answer: string;
  sources: AIAnswerSource[];
  unresolved: string[];
}

/** Research Plan 解析结果（§二十一：title + steps） */
export interface ResearchPlanParsed {
  title: string;
  steps: string[];
}

/** Project Definition 解析结果（§三十一：name/goal/goals/questions/milestones/steps） */
export interface ProjectDefinitionParsed {
  name: string;
  goal: string;
  goals: string[];
  questions: string[];
  milestones: string[];
  steps: string[];
}

/** 从文本中提取 JSON 对象：直接 JSON.parse → 代码块内容 → 首对花括号（纯函数） */
export function extractJsonObject(content: string): unknown | null {
  const c = (content ?? "").trim();
  if (!c) return null;
  try {
    const v = JSON.parse(c);
    if (v && typeof v === "object") return v;
  } catch { /* fallthrough */ }
  const fenced = c.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      const v = JSON.parse(fenced[1].trim());
      if (v && typeof v === "object") return v;
    } catch { /* fallthrough */ }
  }
  const brace = c.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      const v = JSON.parse(brace[0]);
      if (v && typeof v === "object") return v;
    } catch { /* null */ }
  }
  return null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = asString(item);
    if (s) out.push(s);
  }
  return out;
}

/** Ask：{ answer, sources[], unresolved[] }（缺失/非法结构 → null） */
export function parseWorkbenchAskText(content: string): WorkbenchAskParsed | null {
  const obj = extractJsonObject(content);
  if (!obj) return null;
  const o = obj as Record<string, unknown>;
  const answer = asString(o.answer);
  if (answer === undefined) return null;
  const sources: AIAnswerSource[] = [];
  if (Array.isArray(o.sources)) {
    for (const raw of o.sources) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const type = s.type === "vault" || s.type === "web" || s.type === "inference" ? s.type : undefined;
      if (!type) continue;
      const path = asString(s.path);
      const url = asString(s.url);
      const title = asString(s.title);
      const snippet = asString(s.snippet);
      const reason = asString(s.reason);
      if (type === "vault" && !path) continue; // vault 必须有路径（假路径由 service 再校验 Vault 存在 §十五）
      if (type === "web" && !/^https?:\/\//i.test(url || "")) continue;
      const entry: AIAnswerSource = { type, snippet: snippet ? snippet.slice(0, 500) : undefined };
      if (path) entry.path = path;
      if (url) entry.url = url;
      if (title) entry.title = title;
      if (reason) entry.reason = reason;
      sources.push(entry);
    }
  }
  const unresolved = asStringArray(o.unresolved) ?? [];
  return { answer, sources, unresolved };
}

/** Phase 16 §47：Knowledge Agent Ask 解析结果（Answer Schema）
 *  answer + sources[]（vault|web|inference，附 evidence）+ inferences[] + uncertainties[] + followUps[]。
 *  与旧 parseWorkbenchAskText 兼容：answer/sources 都解析；新增 evidence/inferences/uncertainties/followUps。
 */
export interface KnowledgeAskParsed {
  answer: string;
  sources: AIAnswerSource[];
  inferences: string[];
  uncertainties: string[];
  followUps: string[];
}

/** Knowledge Agent Ask：{ answer, sources[], inferences[], uncertainties[], followUps[] }（缺失 answer → null；sources 校验规则与 Ask 一致） */
export function parseKnowledgeAskText(content: string): KnowledgeAskParsed | null {
  const obj = extractJsonObject(content);
  if (!obj) return null;
  const o = obj as Record<string, unknown>;
  const answer = asString(o.answer);
  if (answer === undefined) return null;
  const sources: AIAnswerSource[] = [];
  if (Array.isArray(o.sources)) {
    for (const raw of o.sources) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const type = s.type === "vault" || s.type === "web" || s.type === "inference" ? s.type : undefined;
      if (!type) continue;
      const path = asString(s.path);
      const url = asString(s.url);
      const title = asString(s.title);
      const snippet = asString(s.snippet);
      const reason = asString(s.reason);
      const evidence = asString(s.evidence);
      if (type === "vault" && !path) continue;
      if (type === "web" && !/^https?:\/\//i.test(url || "")) continue;
      const entry: AIAnswerSource = { type, snippet: snippet ? snippet.slice(0, 500) : undefined };
      if (path) entry.path = path;
      if (url) entry.url = url;
      if (title) entry.title = title;
      if (reason) entry.reason = reason;
      if (evidence) (entry as AIAnswerSource & { evidence?: string }).evidence = evidence.slice(0, 500);
      sources.push(entry);
    }
  }
  const inferences = asStringArray(o.inferences) ?? [];
  const uncertainties = asStringArray(o.uncertainties) ?? [];
  const followUps = asStringArray(o.followUps) ?? [];
  return { answer, sources, inferences, uncertainties, followUps };
}

/** Research Plan：{ title, steps[] }（非法 → null） */
export function parseResearchPlan(content: string): ResearchPlanParsed | null {
  const obj = extractJsonObject(content);
  if (!obj) return null;
  const o = obj as Record<string, unknown>;
  const title = asString(o.title);
  const steps = asStringArray(o.steps);
  if (title === undefined || !steps || steps.length === 0) return null;
  return { title, steps };
}

/** Project Definition：{ name, goal?, goals[], questions[], milestones[], steps[] }（非法 → null） */
export function parseProjectDefinition(content: string): ProjectDefinitionParsed | null {
  const obj = extractJsonObject(content);
  if (!obj) return null;
  const o = obj as Record<string, unknown>;
  const name = asString(o.name);
  if (name === undefined) return null;
  const goal = asString(o.goal) ?? "";
  const goals = asStringArray(o.goals) ?? [];
  const questions = asStringArray(o.questions) ?? [];
  const milestones = asStringArray(o.milestones) ?? [];
  const steps = asStringArray(o.steps) ?? [];
  if (!goals.length && !questions.length && !milestones.length && !steps.length) return null;
  return { name, goal, goals, questions, milestones, steps };
}