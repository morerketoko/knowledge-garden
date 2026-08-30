/** Phase 13 §十六~§三十一：Knowledge Garden Skills。
 * - Skill = 工作流程（AI 按什么流程完成任务），不是单纯人格 Prompt（§二十）。
 * - Progressive Disclosure（§二十一/§二十二/§二十三）：Registry 只保存 name/description/path/enabled，
 *   执行时才 loadSkill() 读取正文。
 * - Skill 不拥有 API Key / Model / Provider（§二十九）；不得覆盖系统安全规则（§二十六）。
 * - 目录：Knowledge Garden/Skills/<id>/SKILL.md（frontmatter: name/description + Markdown 正文），
 *   第一版同时内置 Built-in Skills（§一百三十二/§一百三十三）。
 * - scripts/ 仅作为参考文本，绝不自动执行（§二十五）。
 * - 纯函数 + 可注入读取器（异步读取由调用方预读后以同步缓存注入）。
 */
import { fingerprintKey } from "./ai/cache";
import type { SkillFrontmatter, SkillSummary } from "./types";

export interface SkillBody {
  /** SKILL.md 正文（流程指令） */
  instructions: string;
  /** 资源引用（references/templates/examples，§二十四）：仅作为参考文本加入上下文 */
  resources: { label: string; content: string }[];
  /** 来源：用户目录 or 内置 */
  source: "user" | "builtin";
}

/** 简化 YAML frontmatter 解析：name / description（含 > 多行块）/ requiresPlan（§十九） */
export function parseSkillFrontmatter(frontmatter: string): SkillFrontmatter {
  const out: SkillFrontmatter = {};
  const lines = (frontmatter || "").split(/[\r\n]+/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(raw.trim());
    if (!m) { i++; continue; }
    const key = m[1];
    const val = m[2].trim();
    if (key === "description" && val === ">") {
      const parts: string[] = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) { parts.push(lines[i].trim()); i++; }
      out.description = parts.join(" ");
      continue;
    }
    if (key === "name") out.name = val || undefined;
    else if (key === "description") out.description = val || undefined;
    else if (key === "requiresPlan") out.requiresPlan = val === "true";
    i++;
  }
  return out;
}

/** 从 SKILL.md 全文提取 frontmatter 与正文（§十九） */
export function splitSkillFile(text: string): { frontmatter: SkillFrontmatter; body: string } {
  const t = (text || "").replace(/^\uFEFF/, "");
  const m = /^---[\r\n]+([\s\S]*?)[\r\n]+---[\r\n]*([\s\S]*)$/.exec(t);
  if (!m) return { frontmatter: {}, body: t.trim() };
  return { frontmatter: parseSkillFrontmatter(m[1]), body: m[2].trim() };
}

export function skillSummary(id: string, fm: SkillFrontmatter, path: string): SkillSummary {
  return { id, name: fm.name || id, description: fm.description || "", path, enabled: true };
}

/** ---- Built-in Skills（§一百三十三）---- */
export const BUILTIN_SKILL_IDS = [
  "academic-writing",
  "critical-analysis",
  "research-question",
  "knowledge-application",
  "knowledge-refinement",
] as const;

const md = (lines: string[]): string => lines.join("\n");

const ACADEMIC = md([
  "# Academic Writing",
  "",
  "## Process",
  "1. Identify the thesis / core claim of the material.",
  "2. Separate claims from evidence; mark which claims are the author's inference.",
  "3. Identify assumptions and unstated premises.",
  "4. Improve structure (claim -> evidence -> reasoning -> limitation).",
  "5. Mark uncertain statements; never fabricate citations (§三十三/§九十三).",
  "6. Output in the requested format; do not claim it is academically correct (§九十四).",
]);

const CRITICAL = md([
  "# Critical Analysis",
  "",
  "## Process",
  "1. Restate the position in one sentence (charitable reading).",
  "2. List supporting evidence vs unsupported assertion.",
  "3. Find counterexamples and counter-arguments.",
  "4. Assess the strength of the link between evidence and conclusion.",
  "5. Distinguish fact, inference, and value judgment.",
  "6. End with the strongest open question.",
]);

const RESQ = md([
  "# Research Question",
  "",
  "## Process",
  "1. Summarize the current material into 1-3 core topics.",
  "2. Generate hierarchically structured questions (general -> specific; descriptive -> explanatory -> evaluative) (§三十七/§三十八).",
  "3. For each question, list what evidence would be needed.",
  "4. Identify which questions connect to existing knowledge / known gaps.",
  "5. Output questions with a short why-it-matters line.",
]);

const APPLY = md([
  "# Knowledge Application",
  "",
  "## Process",
  "1. Extract the transferable principle(s) from the source material.",
  "2. Identify target domains where the principle could apply (cross-domain transfer, §四十/§四十一).",
  "3. For each application: expected effect, precondition, limitation.",
  "4. Provide a concrete example scenario.",
  "5. Flag speculative applications explicitly as hypotheses, not facts (§一百五十四).",
]);

const REFINE = md([
  "# Knowledge Refinement",
  "",
  "## Process",
  "1. Parse the source note into atomic claims (each claim = one sentence, traceable to the source).",
  "2. Keep the original wording where possible; only rephrase for clarity.",
  "3. Separate source-derived from your own synthesis (origin preservation, Phase 10 Provenance).",
  "4. Attach suggested wikilinks only to concepts already present in the vault.",
  "5. Output refined content as a proposal; do not overwrite the original without preview (§六十一).",
]);

const BUILTIN_BODIES: Record<string, string> = {
  "academic-writing": ACADEMIC,
  "critical-analysis": CRITICAL,
  "research-question": RESQ,
  "knowledge-application": APPLY,
  "knowledge-refinement": REFINE,
};

export function builtinSkillBody(id: string): string {
  return BUILTIN_BODIES[id] || "";
}

export const BUILTIN_SKILL_SUMMARIES: SkillSummary[] = BUILTIN_SKILL_IDS.map((id) => ({
  id,
  name: skillName(id),
  description: skillDescription(id),
  path: "builtin://" + id,
  enabled: true,
}));

function skillName(id: string): string {
  const map: Record<string, string> = {
    "academic-writing": "学术写作",
    "critical-analysis": "批判性分析",
    "research-question": "研究问题生成",
    "knowledge-application": "知识迁移与应用",
    "knowledge-refinement": "知识提炼",
  };
  return map[id] ?? id;
}
function skillDescription(id: string): string {
  const map: Record<string, string> = {
    "academic-writing": "把笔记改写成有学术结构、区分论据与推论的输出，不伪造引用。",
    "critical-analysis": "识别论点、论据、假设与反例，输出批判性分析。",
    "research-question": "从材料生成有层次的研究问题（描述→解释→评价）。",
    "knowledge-application": "提取可迁移原则，做跨领域应用与反例分析。",
    "knowledge-refinement": "把笔记提炼为可追溯的原子化知识，同时保留来源边界。",
  };
  return map[id] ?? "";
}

/** 技能是否启用（§三十一/Test 9：disabled 不参与加载与缓存） */
export function skillEnabled(id: string, registry: SkillSummary[]): boolean {
  const s = registry.find((r) => r.id === id);
  return s ? s.enabled : false;
}

/** 从用户目录读取 SKILL.md（可注入读取器；未找到 → 内置正文）（§二十三） */
export function resolveSkillBody(id: string, readUserSkill: (id: string) => string | null, registry: SkillSummary[]): SkillBody {
  if (!skillEnabled(id, registry)) return { instructions: "", resources: [], source: "builtin" };
  const userText = readUserSkill(id);
  if (userText !== null) {
    const { body } = splitSkillFile(userText);
    const resources = collectSkillResources(id, readUserSkill);
    return { instructions: body, resources, source: "user" };
  }
  return { instructions: builtinSkillBody(id), resources: [], source: "builtin" };
}

/** Skill 资源（§二十四）：references/templates/examples 作为参考文本，仅加入上下文 */
function collectSkillResources(id: string, readUserSkill: (id: string) => string | null): { label: string; content: string }[] {
  const subDirs = ["references", "templates", "examples"];
  const names = ["style-guide.md", "citation-rules.md", "research-note.md", "template.md", "example.md", "prompts.md", "guide.md", "notes.md", "samples.md", "instructions.md"];
  const out: { label: string; content: string }[] = [];
  for (const d of subDirs) {
    for (const n of names) {
      const txt = readUserSkill(id + "/" + d + "/" + n);
      if (txt !== null) { out.push({ label: id + "/" + d + "/" + n, content: txt.trim() }); break; }
    }
  }
  return out;
}

/** Skill 摘要文本：仅提供给 AI 的「可用 Skill 摘要」（progressive disclosure，§二十一） */
export function skillSummaryText(registry: SkillSummary[], selected: string[]): string {
  const active = registry.filter((s) => selected.includes(s.id) && s.enabled);
  if (active.length === 0) return "";
  return active.map((s) => "- " + s.name + "（" + s.id + "）：" + (s.description || "（无描述）")).join("\n");
}

/** 加载指定 Skill 正文并组装注入文本（§二十三） */
export function buildSkillInstructions(selected: string[], registry: SkillSummary[], readUserSkill: (id: string) => string | null): string {
  const parts: string[] = [];
  for (const id of selected) {
    const b = resolveSkillBody(id, readUserSkill, registry);
    if (!b.instructions) continue;
    parts.push(b.instructions);
    for (const r of b.resources) parts.push("【Skill 资源 " + r.label + "】\n" + r.content);
  }
  return parts.join("\n\n");
}

/** Skill 缓存指纹（Test 38：Skill 变化 → Cache Miss）：选中的启用 Skill + 正文 hash */
export function skillCachePart(selected: string[], registry: SkillSummary[], readUserSkill: (id: string) => string | null): string {
  const applied = selected.filter((id) => skillEnabled(id, registry));
  if (applied.length === 0) return "skills:none";
  const bodies = applied.map((id) => resolveSkillBody(id, readUserSkill, registry).instructions);
  return fingerprintKey(["skills:" + applied.slice().sort().join(","), ...bodies]);
}
