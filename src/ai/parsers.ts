/** Phase 14 Hotfix：Exam / Grading AI Response Parser 层。
 * - AI raw response 仅作不可信输入：JSON parse → schema 校验 → 复用 filterValidExamQuestions → Domain Object。
 * - 不做 Exam/ReviewCard persistence（那是 examStore 的职责）。
 * - 无 Obsidian / 网络依赖：可独立做固定 fixture 回归（P14-HF）。
 * - 非法输入一律抛 AIError → 只进 error 缓存，绝不 success 污染。
 */
import { AIError } from "./provider";
import { filterValidExamQuestions } from "../examEngine";
import type { AICacheType, ExamQuestion } from "../types";

/** 提取文本中从第一个 { 到第一个闭合 } 之间的 JSON 块（兼容 code fence 包裹，§五十三）。
 *  原位于 service.ts，Hotfix 移入 parser 层统一复用（service.ts 改为从这里导入）。 */
export function extractJsonBlockText(text: string): string | null {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = i; k <= j; k++) {
    const ch = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(i, k + 1); }
  }
  return null;
}

/** 合法 Exam payload（main.ts / AIService 消费的形状）：必须含非空 questions */
export interface ExamGenerationResult {
  title: string;
  coverageTopics?: string[];
  questions: ExamQuestion[];
}

/** 合法 Grading payload（§一百五十九/一百六十二） */
export interface ExamGradingResult {
  correctness: "correct" | "partial" | "wrong";
  score: number;
  strengths: string[];
  missing: string[];
  misconceptions: string[];
}

function tryJson(text: string): unknown | null {
  try { return JSON.parse(text); } catch { return null; }
}

/** JSON.parse 直接 → 失败用 extractJsonBlockText（剥 code fence）→ 仍失败抛 AIError */
function parseJsonObject(content: string, label: string): unknown {
  const text = content.trim();
  const isObj = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);
  const direct = tryJson(text);
  if (direct) {
    if (isObj(direct)) return direct;
    throw new AIError("AI 返回的" + label + " JSON 不是合法对象，已校验拒绝。请重试。");
  }
  const block = extractJsonBlockText(text);
  if (block) {
    const repaired = tryJson(block);
    if (repaired && isObj(repaired)) return repaired;
  }
  throw new AIError("AI 返回的" + label + " JSON 非法（无法解析），已校验拒绝。请重试。");
}

/** 生成考试（Hotfix 五/六）：schema → filterValidExamQuestions → 至少 1 题才返回；否则抛 AIError */
export function parseExamGeneration(content: string, maxCount?: number): ExamGenerationResult {
  const rec = parseJsonObject(content, "考试") as Record<string, unknown>;
  if (typeof rec["title"] !== "string" || !rec["title"] || !Array.isArray(rec["questions"])) {
    throw new AIError("AI 返回的考试缺少必要字段（title/questions），已校验拒绝。请重试。");
  }
  const questions = filterValidExamQuestions(rec["questions"], Math.max(1, maxCount ?? 50));
  if (!questions.length) {
    throw new AIError("AI 返回的考试题目全部无效（过滤后无有效题目），已拒绝缓存。请重试。");
  }
  const coverage = rec["coverageTopics"];
  return {
    title: String(rec["title"]).trim().slice(0, 200),
    coverageTopics: Array.isArray(coverage)
      ? coverage.map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 12)
      : undefined,
    questions,
  };
}

/** 评分（Hotfix 八/九/十）：correctness 严格枚举；score 0~5；三个数组字段强制存在 */
export function parseExamGrading(content: string): ExamGradingResult {
  const rec = parseJsonObject(content, "评分") as Record<string, unknown>;
  const correctness = rec["correctness"];
  if (correctness !== "correct" && correctness !== "partial" && correctness !== "wrong") {
    throw new AIError("AI 返回的评分缺少合法 correctness（correct/partial/wrong），已校验拒绝。请重试。");
  }
  const score = rec["score"];
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 5) {
    throw new AIError("AI 返回的评分 score 非法（须为 0~5 数值），已校验拒绝。请重试。");
  }
  const arr = (v: unknown, label: string): string[] => {
    if (!Array.isArray(v)) {
      throw new AIError("AI 返回的评分缺少数组字段 " + label + "，已校验拒绝。请重试。");
    }
    return v.map((s) => String(s).trim().slice(0, 800)).filter(Boolean);
  };
  return {
    correctness,
    score,
    strengths: arr(rec["strengths"], "strengths"),
    missing: arr(rec["missing"], "missing"),
    misconceptions: arr(rec["misconceptions"], "misconceptions"),
  };
}

/** 历史坏缓存形状守卫（Hotfix 十三/十四）：note_exam 必须含非空 questions；exam_grading 必须含合法 correctness/score/数组。
 * 形状非法 → 不作为 success 命中（当作 miss 重新请求，成功后同 key 覆盖修复）；其他 type 一律放行（不影响其他 feature）。
 * P16 修复：Workbench 系列缓存为原始 AI 文本(string)，必须先于 object 检查放行；{markdown,model} 旧形状仍视为 miss。 */
export function examCacheDataValid(type: AICacheType, data: unknown): boolean {
  // Phase 15/16 Workbench 系列：缓存存的是「原样透传的原始 AI 文本」（string）。
  // 历史错误形状 {markdown, model} 对象不是合法缓存 → 视为 miss 重新生成，避免修复后仍命中脏缓存再次触发 .trim 崩溃。
  if (type === "workbench_ask" || type === "workbench_deep" || type === "workbench_research" || type === "research_plan" || type === "research_search"
    || type === "agent_tool_call") {
    return typeof data === "string" && data.trim().length > 0;
  }
  const rec = data as Record<string, unknown> | null;
  if (!rec || typeof rec !== "object") return false;
  if (type === "note_exam") {
    return Array.isArray(rec["questions"]) && rec["questions"].length > 0;
  }
  if (type === "exam_grading") {
    const c = rec["correctness"];
    const s = rec["score"];
    return (c === "correct" || c === "partial" || c === "wrong") &&
      typeof s === "number" && s >= 0 && s <= 5 &&
      Array.isArray(rec["strengths"]) && Array.isArray(rec["missing"]) && Array.isArray(rec["misconceptions"]);
  }

  return true;
}
