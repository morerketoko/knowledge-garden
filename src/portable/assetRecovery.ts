/**
 * Phase 24.2 §三~§十六：**确定性资产索引恢复 + 索引完整性守卫**。
 *
 * 本模块刻意做成**纯函数 + 最小依赖注入**：
 * - 只依赖「枚举 Markdown / 读 Markdown / 解析 / 写索引」四个注入点；
 * - 不 import Obsidian，因此可以在 Node 里用**真实 vault 文件**跑恢复验证；
 * - 0 AI、只读 Markdown 资产、绝不改写任何用户文件（§三十四）。
 *
 * 设计口径（§二）：
 * - Review Cards / Exams：**Markdown = Source of Truth** → 从 Markdown 确定性重建索引；
 * - Activity / FSRS：**JSON = Source of Truth** → 有就读，没有就明确「不可恢复」，绝不伪造。
 */

/** 待处理/已处理的 Markdown 文件（只用到 path） */
export interface AssetFile {
  path: string;
}

/** 最小 Vault 接口（Obsidian 与 Node 测试都可实现） */
export interface AssetVault {
  /** 列出 vault 内全部 Markdown（Obsidian: app.vault.getMarkdownFiles） */
  markdownFiles(): AssetFile[];
  /** 读文件内容（Obsidian: app.vault.cachedRead） */
  read(file: AssetFile): Promise<string>;
}

export interface AssetRepairOutcome<T> {
  /** 参与扫描的 Markdown 文件数（含子目录） */
  scanned: number;
  /** 成功解析数 */
  parsed: number;
  /** 解析失败的文件（含原因，§六/§二十七：必须显式报告，不得静默） */
  broken: { path: string; reason: string }[];
  /** 写回存储后的实际条目数（从内存 store 读取，§八） */
  persisted: number;
  entries: T[];
}

/** 路径是否位于某前缀目录下（含该目录本身的文件）；大小写不敏感，兼容反斜杠 */
export function isUnderPrefix(filePath: string, prefix: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  const pre = prefix.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() + "/";
  return p.startsWith(pre);
}

/** 扫描前缀目录下的全部 Markdown（**递归**，含子目录；§三） */
export function markdownFilesUnder(vault: AssetVault, prefix: string): AssetFile[] {
  return vault.markdownFiles()
    .filter((f) => isUnderPrefix(f.path, prefix))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * §三~§九：从 Markdown 资产确定性重建一个索引。
 *
 * @param label 人类可读名（复习卡 / 考试）
 * @param folder 资产目录（如 `Knowledge Garden/Review Cards`）
 * @param parse 解析器（返回 null/undefined 视为「无法解析」）
 * @param persist 写回 store（返回写回后的**实际**条目数）
 */
export async function repairIndexFromAssets<T>(
  label: string,
  folder: string,
  vault: AssetVault,
  parse: (md: string) => T | null | undefined,
  persist: (entries: T[]) => Promise<number> | number
): Promise<AssetRepairOutcome<T>> {
  const files = markdownFilesUnder(vault, folder);
  const entries: T[] = [];
  const broken: { path: string; reason: string }[] = [];

  for (const f of files) {
    let md: string;
    try {
      md = await vault.read(f);
    } catch (e) {
      broken.push({ path: f.path, reason: "读取失败：" + errMsg(e) });
      continue;
    }
    try {
      const parsed = parse(md);
      if (parsed === null || parsed === undefined) {
        broken.push({ path: f.path, reason: "解析失败：缺少必要字段（不删除该文件）" });
        continue;
      }
      entries.push(parsed);
    } catch (e) {
      broken.push({ path: f.path, reason: "解析异常：" + errMsg(e) });
    }
  }

  // §四十二：部分成功必须保留成功部分，绝不清空
  const persisted = await persist(entries);
  return { scanned: files.length, parsed: entries.length, broken, persisted, entries };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ */
/* §十三 / §十四：索引完整性守卫                                         */
/* ------------------------------------------------------------------ */

/**
 * 资产目录：**不属于** NoteIndex 的知识笔记统计范围（§十四）。
 * Review Cards / Exams 等是插件产物，计入会稀释「笔记索引是否完整」的判断。
 */
export const ASSET_FOLDER_PREFIXES: string[] = [
  "Knowledge Garden/Exams",
  "Knowledge Garden/Review Cards",
  "Knowledge Garden/Explorations",
  "Knowledge Garden/Research",
  "Knowledge Garden/Inbox",
  "Knowledge Garden/Processing",
  "Knowledge Garden/Knowledge",
  "Knowledge Garden/Archive",
  "Knowledge Garden/Reviews",
  "Knowledge Garden/Relationships",
  "Knowledge Garden/Prompts",
  "Knowledge Garden/Projects",
  "Knowledge Garden/Skills",
];

/** 是否属于「插件资产目录」（不计入知识笔记总数） */
export function isAssetPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  if (p.startsWith(".obsidian/")) return true;
  return ASSET_FOLDER_PREFIXES.some((pre) => isUnderPrefix(p, pre));
}

/** §十四：参与 NoteIndex 统计的 vault Markdown 数量（排除 .obsidian 与插件资产目录） */
export function knowledgeMarkdownCount(files: AssetFile[]): number {
  return files.filter((f) => !isAssetPath(f.path)).length;
}

export interface IndexHealth {
  indexedCount: number;
  vaultMarkdownCount: number;
  ratio: number;
  healthy: boolean;
  /** 阈值（indexedCount >= threshold 视为健康） */
  threshold: number;
  reason: string;
}

/**
 * §十三：索引健康判定。
 * `healthy = indexedCount >= max(1, floor(vaultMarkdownCount * 0.95))`
 * —— 不要求 100%（个别文件可能临时读取失败）。
 */
export function isIndexHealthy(
  indexedCount: number,
  vaultMarkdownCount: number,
  tolerance = 0.95
): IndexHealth {
  const threshold = Math.max(1, Math.floor(vaultMarkdownCount * tolerance));
  const ratio = vaultMarkdownCount > 0 ? indexedCount / vaultMarkdownCount : (indexedCount > 0 ? 1 : 0);
  // 空 vault（没有可索引笔记）：索引为 0 也是健康的 —— 否则空仓库会永远跳过 prune 并反复全量重扫
  const healthy = vaultMarkdownCount === 0 ? true : indexedCount >= threshold;
  return {
    indexedCount,
    vaultMarkdownCount,
    ratio,
    healthy,
    threshold,
    reason: healthy
      ? (vaultMarkdownCount === 0
        ? "vault 内没有可索引笔记（0/0）→ 视为健康"
        : "索引覆盖 " + (ratio * 100).toFixed(1) + "%（阈值 " + threshold + "）→ 健康")
      : "索引只有 " + indexedCount + " / " + vaultMarkdownCount + "（"
        + (ratio * 100).toFixed(1) + "%），低于阈值 " + threshold + " → 不健康，已跳过 destructive prune",
  };
}
