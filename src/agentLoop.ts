/**
 * Phase 15：Research Agent Loop（§七十七~八十七 / §一百二十一~一百二十七）。
 * - 循环：Observe → Plan → Tool → Result → Think → (Tool…|Final)。
 * - 守卫（§八十一）：maxSteps 上限；同一工具+同一参数连续 3 次 → 停止。
 * - 工具失败（§八十二）：AI 可尝试替代方案；最多 2 次连续失败即收尾。
 * - 不可信输入：工具结果（Vault/Web）只作资料，SECURITY_BLOCK 由调用方注入提示（prompts.ts）。
 * - Agent 不得自行扩大权限（§八十三）：权限字符串由调用方生成，Agent 只读。
 * - 每步 checkpoint 由 onCheckpoint 回调落盘（§一百二十五：只存步骤摘要，不存网页全文/推理）。
 * - 取消（§一百二十三/一百二十四）：isCancelled 每步检查；取消后不自动写草稿（调用方决定）。
 * - 本模块无 Obsidian 依赖（纯逻辑 + 注入执行器），便于 Node 夹具测试。
 */
import { parseAgentToolDecision, type AgentToolDecision } from "./workbenchTools";
import type { WorkbenchToolEnv, WorkbenchToolExecuteContext } from "./workbenchTools";
import type { ToolResult } from "./types";

/** 单步记录（§七十八：taskId/stepIndex/tool/toolArgs/toolResultSummary） */
export interface AgentStepRecord {
  stepIndex: number;
  decision: "tool" | "final";
  toolId?: string;
  toolArgsSummary?: string;   // 参数摘要（不存敏感内容）
  toolResultSummary?: string; // 截断后的结果摘要
  error?: string;
  note?: string;              // final 时的结论要点
  at: number;
}

/** 一次 Agent 执行的输入 */
export interface AgentLoopInput {
  taskId: string;
  title: string;
  goal: string;
  maxSteps: number;           // 5 / 8 / 12（§二百五十八）
  permissionPrompt: string;   // 工具权限提示（main 用 permissions.ts featureActionPrompt 生成，§八十四）
  toolList: string;           // 可用工具说明（workbenchTools.WORKBENCH_TOOLS 生成）
  enableWeb: boolean;
  /** AI 决策回调（service.generateForFeature("agent_tool_call") 的真实/测试实现） */
  decide: (contextText: string) => Promise<{ content: string }>;
  /** 工具执行器（main 注入 WorkbenchToolEnv，测试注入假实现） */
  executeTool: (ctx: WorkbenchToolExecuteContext) => Promise<ToolResult>;
  /** 权限覆盖：Research 勾选 Web 后本次 web.search/fetch=allow（§八十五），不改写权限 */
  permissionOverride?: Partial<Record<string, "allow" | "ask" | "deny">>;
  /** 每步 checkpoint（§一百二十五：持久化） */
  onCheckpoint?: (step: AgentStepRecord, totalSteps: number) => void;
  /** 取消检查（§一百二十三） */
  isCancelled?: () => boolean;
  /** 当前已有步骤历史（恢复继续时传入，§一百二十六） */
  existingSteps?: AgentStepRecord[];
}

export interface AgentLoopResult {
  steps: AgentStepRecord[];
  finalNote?: string;
  stoppedReason: "final" | "max_steps" | "repeat_guard" | "tool_fail" | "cancelled" | "error";
  error?: string;
  fromCache: boolean;
}

/** 同一工具+同一参数连续出现 n 次（§八十一：n=3 停止） */
export function sameToolRepeat(all: AgentStepRecord[], threshold = 3): boolean {
  const recent = all.filter((s) => s.decision === "tool");
  if (recent.length < threshold) return false;
  const last = recent.slice(-threshold);
  const first = last[0];
  return last.every((s) => s.toolId === first.toolId && s.toolArgsSummary === first.toolArgsSummary);
}

/** 连续工具失败计数（§八十二：>2 即收尾） */
function consecutiveToolFailures(all: AgentStepRecord[]): number {
  let n = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s.decision !== "tool") break;
    if (s.error) n++; else break;
  }
  return n;
}

/** 步骤历史 → 上下文文本（只放摘要；不含推理/敏感内容） */
export function agentHistoryText(steps: AgentStepRecord[]): string {
  if (!steps.length) return "（尚无步骤）";
  return steps
    .map((s) => {
      if (s.decision === "final") return "step " + s.stepIndex + ": final → " + (s.note || "");
      const args = s.toolArgsSummary ? " args=" + s.toolArgsSummary : "";
      const res = s.toolResultSummary ? " → " + s.toolResultSummary : "";
      const err = s.error ? " [失败:" + s.error + "]" : "";
      return "step " + s.stepIndex + ": " + (s.toolId || "") + args + res + err;
    })
    .join("\n");
}

/** 生成工具清单文本（main 可复用） */
export function toolListText(ids: string[], describe: (id: string) => string): string {
  return ids.map((id) => "- " + id + "：" + describe(id)).join("\n");
}

/**
 * 运行一次 Agent Loop（§七十七）。同步顺序执行，单线程；长任务不阻塞 UI 由调用方用 setInterval/异步分片处理。
 * 返回步骤记录；绝不自动执行写入型工具（写操作由 executeWorkbenchTool 返回 WRITE_NEEDS_USER_APPLY，等待用户确认）。
 */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const steps = [...(input.existingSteps ?? [])];
  const maxSteps = input.maxSteps > 0 ? input.maxSteps : 8;

  for (let step = steps.filter((s) => s.decision === "tool" || s.decision === "final").length; step < maxSteps; step++) {
    if (input.isCancelled?.()) {
      return { steps, stoppedReason: "cancelled", fromCache: false };
    }
    // 守卫：同工具+同参数连续 3 次（§八十一）
    if (sameToolRepeat(steps, 3)) {
      return { steps, stoppedReason: "repeat_guard", fromCache: false };
    }
    // 守卫：连续失败 ≥2 次（§八十二）
    if (consecutiveToolFailures(steps) >= 2) {
      return { steps, stoppedReason: "tool_fail", fromCache: false };
    }

    const history = agentHistoryText(steps);
    let content = "";
    try {
      const res = await input.decide(history);
      content = res?.content ?? "";
    } catch (e) {
      return { steps, stoppedReason: "error", error: e instanceof Error ? e.message : String(e), fromCache: false };
    }

    const decision = parseAgentToolDecision(content) as AgentToolDecision | null;
    if (!decision) {
      // 无法解析 → 视为该步失败一次（不反复烧 token；调用方可在 UI 显示原始错误，这里不落日志原文）
      const rec: AgentStepRecord = {
        stepIndex: step, decision: "tool", toolId: "parse", error: "AI 决策无法解析", at: Date.now(),
      };
      steps.push(rec);
      input.onCheckpoint?.(rec, steps.length);
      continue;
    }

    if (decision.decision === "final") {
      const rec: AgentStepRecord = {
        stepIndex: step, decision: "final", note: decision.note || "", at: Date.now(),
      };
      steps.push(rec);
      input.onCheckpoint?.(rec, steps.length);
      return { steps, finalNote: decision.note, stoppedReason: "final", fromCache: false };
    }

    const toolId = decision.tool ?? "";
    const argsSummary = Object.keys(decision.args ?? {})
      .map((k) => k + "=" + String((decision.args ?? {})[k] ?? "").slice(0, 60))
      .join(",");
    const result = await input.executeTool({
      toolId,
      args: decision.args ?? {},
      permissionOverride: input.permissionOverride,
    });

    const rec: AgentStepRecord = {
      stepIndex: step,
      decision: "tool",
      toolId,
      toolArgsSummary: argsSummary.slice(0, 200),
      toolResultSummary: result.summary.slice(0, 500),
      error: result.ok ? undefined : (result.error || "tool failed"),
      at: Date.now(),
    };
    steps.push(rec);
    input.onCheckpoint?.(rec, steps.length);
  }

  return { steps, stoppedReason: "max_steps", fromCache: false };
}