/**
 * Phase 16：Task Classification（§三十四~三十八）。
 * - 纯本地规则：输入长度 + 问句类型 + compare/why/summarize/research 关键词 + 是否要求整个 Vault / Web / 行动。
 * - 禁止「先 AI 分类再 AI 回答」（§三十八），零成本、可单元测试。
 */

export type TaskComplexity = "simple" | "normal" | "complex";

/** 复杂度：complex（跨领域比较/冲突/长输入）> normal（why/how/关系/分析）> simple（事实确认/短问） */
export function classifyTaskComplexity(question: string): TaskComplexity {
  const q = (question || "").trim().toLowerCase();
  const len = q.length;
  if (
    len > 140 ||
    /compare|comparison|对比|比较|共同结构|共同点|冲突|矛盾|一致|不一致|difference|差异|过去.{0,6}年|近.{0,4}年|整个 ?vault|整个知识库|全库|跨领域/.test(q)
  ) return "complex";
  if (
    /\bwhy\b|为什么|\bhow\b|如何|怎样|关系|关联|影响|summar|概括|总结|分析|解释|explain|\bcompare\b|对比|比较|原理|机制/.test(q) ||
    len > 60
  ) return "normal";
  return "simple";
}

/** 是否需要最新资料（检测时间敏感词；仅提示，绝不偷偷发请求 §七十四） */
export function suggestWebForQuestion(question: string): boolean {
  const q = (question || "").toLowerCase();
  return /\b(latest|current|today|recent|now)\b|最新|当前|今年|最近|现在|趋势|新闻|发布/.test(q);
}

/** Project Escalation（用户输入「帮我建…项目」→ 直接进入 Project Planning §七十六） */
export function detectProjectIntent(question: string): boolean {
  const q = (question || "").toLowerCase();
  return /项目|project|建一个|创建.{0,4}项目/.test(q);
}

/** Research Escalation（用户主动要求「研究」或长任务） */
export function detectResearchIntent(question: string): boolean {
  const q = (question || "").toLowerCase();
  return /研究|research|调研|文献|综述/.test(q);
}

/** Agent 步数上限（§三十五~三十七：simple≤2 / normal≤5 / complex≤8） */
export function maxStepsFor(c: TaskComplexity): number {
  return c === "simple" ? 2 : c === "normal" ? 5 : 8;
}

/** Context / 阅读预算（§四十三：候选≤20、进 AI 上下文 8~12、真正全文读取≤5；§一百六十九：Simple 小 / Normal 中 / Complex 大） */
export interface ContextBudget {
  candidates: number;
  readFull: number;
  evidenceChars: number;
}

export function contextBudgetFor(c: TaskComplexity): ContextBudget {
  if (c === "simple") return { candidates: 12, readFull: 1, evidenceChars: 4000 };
  if (c === "normal") return { candidates: 16, readFull: 5, evidenceChars: 10000 };
  return { candidates: 20, readFull: 5, evidenceChars: 16000 };
}

/** 复杂度标签（诊断 / UI） */
export function complexityLabel(c: TaskComplexity): string {
  return c === "simple" ? "simple" : c === "normal" ? "normal" : "complex";
}
