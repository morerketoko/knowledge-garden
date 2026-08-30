/** Phase 13 §五十七~§六十七：Safe Apply / Diff。
 * - AI Proposal → Preview → User Apply（§五十八）：写回前必须用户确认。
 * - 不直接自动写（§六十一）：Academic Rewrite / Translation Replace / Copywriting Insert / Knowledge Refinement。
 * - 整篇 Rewrite 强制 Preview（§六十二）。Create File 若目标已存在必须冲突提示（§六十五）。
 * - Apply（§六十三/§九十七）：用户点击后才 Editor.replaceSelection() / Vault.modify()，且 Apply 不重新请求 AI。
 * - 冲突检测（§六十四）：currentText != proposal.originalText → 提示重新生成/强看 Diff/取消。
 * - 不用 CodeMirror 私有 API（§六十七）：Diff 是纯文本行级说明，Apply 由调用方用 Obsidian Editor API。
 * - 纯函数、无 Obsidian 依赖（便于测试）。
 */
import type { AIFeature } from "./types";
import { sha256 } from "./ai/cache";

export type AIEditOperation = "replace_selection" | "replace_file" | "insert" | "create_file";

export interface AIEditProposal {
  filePath: string;
  originalText: string;
  proposedText: string;
  operation: AIEditOperation;
  createdAt: number;
}

export function createEditProposal(filePath: string, originalText: string, proposedText: string, operation: AIEditOperation): AIEditProposal {
  return { filePath, originalText, proposedText, operation, createdAt: Date.now() };
}

export function originalTextHash(text: string): string {
  return sha256(text);
}

/** 冲突检测（§六十四）：原文在 AI 生成期间被用户修改 → 冲突 */
export function detectConflict(proposal: AIEditProposal, currentText: string): boolean {
  return proposal.originalText !== currentText;
}

/** 必须强制 Preview 的操作（§六十二）：整篇替换 / 新建文件 */
export function requiresPreview(operation: AIEditOperation): boolean {
  return operation === "replace_file" || operation === "create_file";
}

/** 需要 Plan 的复杂 Feature（§六十九；与 plan.ts 保持一致） */
export function featureNeedsPlan(feature: AIFeature): boolean {
  return (
    feature === "knowledge_refinement" ||
    feature === "knowledge_processing" ||
    feature === "writing_research" ||
    feature === "writing_critique" ||
    feature === "writing_argument"
  );
}

/** 简单行级 Diff（纯文本，不依赖 CodeMirror 私有 API；§六十七）。返回逐行标记。 */
export interface DiffLine { type: "same" | "removed" | "added"; text: string; }
export function lineDiff(original: string, proposed: string): DiffLine[] {
  const a = (original || "").split(/\r?\n/);
  const b = (proposed || "").split(/\r?\n/);
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "removed", text: a[i] }); i++; }
    else { out.push({ type: "added", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: "removed", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "added", text: b[j] }); j++; }
  return out;
}

/** Diff 摘要（原文/改后，§六十：最小 UI 也可直接用两端文本） */
export function diffSummary(original: string, proposed: string): { changed: boolean; removed: number; added: number } {
  const lines = lineDiff(original, proposed);
  const removed = lines.filter((l) => l.type === "removed").length;
  const added = lines.filter((l) => l.type === "added").length;
  return { changed: removed > 0 || added > 0, removed, added };
}
