/** Phase 13 §三十二~§四十二：AI Context Engine。
 * - Feature 不自己拼文本（§三十五）：统一 buildAIContext()。
 * - 每个 Feature 定义 Context Policy（§三十六：required/optional/maxChars）。
 * - Context 不得静默扩张（§三十八）：只按 policy 注入用户已提供的来源。
 * - 超限必须显示「已截断」（§四十），不静默截掉。
 * - 优先级（§四十一）：Selection > Current Note > Confirmed Relationships > Related Notes > Saved Exploration > Web。
 * - 缓存使用 contextHash（§四十二）。
 * - 纯函数，无 Obsidian 依赖。
 */
import type { AIFeature } from "./types";
import { fingerprintKey } from "./ai/cache";

export type AIContextSource =
  | "selection"
  | "current_note"
  | "related_notes"
  | "confirmed_relationships"
  | "saved_exploration"
  | "workspace"
  | "web"
  | "custom";

export interface ContextBlock {
  source: AIContextSource;
  label: string;
  content: string;
  /** 来源字符数（展示用，§三十七） */
  chars: number;
  /** 优先级：越小越优先（§四十一） */
  priority: number;
}

export interface ContextPolicy {
  required: AIContextSource[];
  optional: AIContextSource[];
  maxChars: number;
}

export const CONTEXT_PRIORITY: Record<AIContextSource, number> = {
  selection: 1,
  current_note: 2,
  confirmed_relationships: 3,
  related_notes: 4,
  saved_exploration: 5,
  web: 6,
  workspace: 7,
  custom: 8,
};

/** 各 Feature 的 Context Policy（§三十六/§三十九：数值保守，按模型上下文能力动态调整） */
export const CONTEXT_POLICIES: Partial<Record<AIFeature, ContextPolicy>> = {
  translation: { required: ["selection"], optional: ["custom"], maxChars: 12000 },
  writing_academic: { required: ["selection"], optional: ["current_note", "related_notes", "workspace", "web"], maxChars: 20000 },
  writing_argument: { required: ["selection"], optional: ["current_note", "related_notes", "workspace"], maxChars: 20000 },
  writing_critique: { required: ["selection"], optional: ["current_note", "related_notes"], maxChars: 20000 },
  writing_research: { required: ["selection"], optional: ["current_note", "related_notes", "saved_exploration", "web"], maxChars: 20000 },
  writing_application: { required: ["selection"], optional: ["current_note", "related_notes", "workspace"], maxChars: 20000 },
  writing_brainstorm: { required: ["selection"], optional: ["current_note", "workspace"], maxChars: 16000 },
  writing_copy: { required: ["selection"], optional: ["current_note"], maxChars: 16000 },
  copywriting: { required: ["selection"], optional: ["current_note"], maxChars: 16000 },
  query_exploration: { required: ["current_note"], optional: ["related_notes", "confirmed_relationships", "workspace"], maxChars: 16000 },
  anchor_exploration: { required: ["current_note"], optional: ["related_notes", "confirmed_relationships"], maxChars: 16000 },
  knowledge_refinement: { required: ["current_note"], optional: ["related_notes", "confirmed_relationships"], maxChars: 20000 },
  knowledge_processing: { required: ["current_note"], optional: [], maxChars: 20000 },
  daily_curiosity: { required: ["custom"], optional: [], maxChars: 24000 },
  knowledge_roaming: { required: ["custom"], optional: [], maxChars: 24000 },
  monthly_evolution: { required: ["custom"], optional: [], maxChars: 24000 },
  quarterly_evolution: { required: ["custom"], optional: [], maxChars: 24000 },
};

export function contextPolicy(feature: AIFeature): ContextPolicy {
  return CONTEXT_POLICIES[feature] ?? { required: [], optional: [], maxChars: 16000 };
}

export interface AIContextInput {
  feature: AIFeature;
  selection?: string;
  currentNote?: { path: string; title?: string; content: string };
  relatedNotes?: { path: string; title?: string; content?: string }[];
  confirmedRelationships?: string;
  savedExploration?: string;
  workspaceText?: string;
  web?: string;
  custom?: string;
}

export interface AIContextResult {
  blocks: ContextBlock[];
  totalChars: number;
  truncated: boolean;
  hash: string;
  selectedSources: AIContextSource[];
}

function makeBlock(source: AIContextSource, label: string, content: string): ContextBlock {
  return { source, label, content, chars: content.length, priority: CONTEXT_PRIORITY[source] };
}

/** 构建 AI 上下文（§三十五/§三十六/§三十八），按优先级填充到 maxChars，超限标记 truncated（§四十） */
export function buildAIContext(input: AIContextInput): AIContextResult {
  const policy = contextPolicy(input.feature);
  const provided = new Map<AIContextSource, () => ContextBlock>();
  if (input.selection) provided.set("selection", () => makeBlock("selection", "选中文本", input.selection as string));
  if (input.currentNote) provided.set("current_note", () => makeBlock("current_note", "当前笔记", (input.currentNote!.title ? input.currentNote!.title + "\n" : "") + input.currentNote!.content));
  if (input.confirmedRelationships) provided.set("confirmed_relationships", () => makeBlock("confirmed_relationships", "已确认关系", input.confirmedRelationships as string));
  if (input.relatedNotes && input.relatedNotes.length > 0) provided.set("related_notes", () => makeBlock("related_notes", "相关知识", input.relatedNotes!.map((n) => (n.title ?? n.path) + "\n" + (n.content ?? "")).join("\n\n")));
  if (input.savedExploration) provided.set("saved_exploration", () => makeBlock("saved_exploration", "收藏知识链路", input.savedExploration as string));
  if (input.workspaceText) provided.set("workspace", () => makeBlock("workspace", "工作空间指令", input.workspaceText as string));
  if (input.web) provided.set("web", () => makeBlock("web", "外部网页资料", input.web as string));
  if (input.custom) provided.set("custom", () => makeBlock("custom", "发现候选", input.custom as string));

  // 只允许 policy 声明的来源（§三十八：用户未勾选/未提供的上下文不能偷偷加入）
  const allowed = new Set<AIContextSource>([...policy.required, ...policy.optional]);
  const usable = [...provided.keys()].filter((s) => allowed.has(s));
  usable.sort((a, b) => CONTEXT_PRIORITY[a] - CONTEXT_PRIORITY[b]);

  const blocks: ContextBlock[] = [];
  let total = 0;
  let truncated = false;
  for (const s of usable) {
    const b = provided.get(s)!();
    if (b.chars === 0) continue;
    if (total + b.chars > policy.maxChars) {
      const remain = Math.max(0, policy.maxChars - total);
      if (remain > 200) {
        blocks.push({ ...b, content: b.content.slice(0, remain) + "…（上下文超过限制，已截断）", chars: b.chars });
        total += remain;
      }
      truncated = true;
      break;
    }
    blocks.push(b);
    total += b.chars;
  }
  const hash = contextHash(blocks);
  return { blocks, totalChars: total, truncated, hash, selectedSources: blocks.map((b) => b.source) };
}

/** Context Hash（§四十二）：label + content 组装，任何来源内容变化 → 缓存失效 */
export function contextHash(blocks: ContextBlock[]): string {
  if (blocks.length === 0) return "ctx:none";
  return fingerprintKey(blocks.map((b) => b.label + "|" + b.content));
}

/** 组装实际发送文本 */
export function contextText(blocks: ContextBlock[]): string {
  return blocks.map((b) => "【" + b.label + "】\n" + b.content).join("\n\n");
}

/** 上下文可视化摘要（§三十七）：每来源字数，供 AI Modal 展示 */
export function contextSummaryLine(blocks: ContextBlock[]): string[] {
  return blocks.map((b) => {
    const label = b.source === "workspace" ? "工作空间" : b.label;
    return label + "\t" + b.chars + " 字";
  });
}
