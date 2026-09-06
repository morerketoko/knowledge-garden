/**
 * Workbench Retrieval v3：检索意图 / 目录解析 / Scope 计算（纯函数，无 Obsidian 依赖，可 Node 测试）。
 * - 原则：Exact Path > Semantic Search；Folder Scope = 搜索边界；Permission = 动作边界；
 *   Candidate ≠ Access；Search Result ≠ Vault Boundary。
 * - detectVaultLocationIntent：exact-file / exact-folder / folder-name / file-name / scoped-query / normal-query。
 * - resolveFolderPaths：完整路径 / 前缀 / 文件夹名 / 大小写 / NFKC / 中文括号容错；多匹配不猜 → 返回列表让用户选择。
 */
import type { WorkbenchConfig, KnowledgeWorkspace, DiscoveryScope } from "./types";
import { workspaceScope } from "./workspace";

export type LocationIntentKind =
  | "exact-file"
  | "exact-folder"
  | "folder-name"
  | "file-name"
  | "scoped-query"
  | "normal-query";

/** 检索意图（保守：不确定一律 normal-query，避免把普通问题当成实体名） */
export interface LocationIntent {
  kind: LocationIntentKind;
  /** 规范化完整路径（exact-file / exact-folder；无尾部 /） */
  target?: string;
  /** 无分隔符的名字（folder-name / file-name / scoped-query 的目录提示） */
  name?: string;
  /** scoped-query：真正的检索词 */
  query?: string;
  raw: string;
}

export interface FolderResolution {
  /** 唯一确定的完整文件夹路径（无尾部 /；根目录为 ""） */
  folder?: string;
  matched: string[];
  ambiguous: boolean;
}

export interface FileNameResolution {
  path?: string;
  matched: string[];
  ambiguous: boolean;
}

/** Workbench Vault Scope 信息（搜索边界；权限仍由 Permission 决定） */
export interface WorkbenchScopeInfo {
  kind: WorkbenchConfig["vaultScope"];
  label: string;
  /** 搜索边界目录（无尾部 /；空数组 = 全库） */
  folders: string[];
}

export const RETRIEVAL_VERSION = "v3";

/** 轻量清理：trim + 剥引号 + 去尾部斜杠（保留原始字符宽度，不 NFKC） */
export function trimFolderRef(s: string): string {
  let t = (s ?? "").trim();
  t = t.replace(/^["'`「」『』\s]+|["'`「」『』\s]+$/g, "");
  t = t.replace(/[\\/]+$/g, "");
  return t;
}

/** 归一化：NFKC + trimFolderRef（全角括号等由 NFKC 转半角；只用于比较键/容错解析，不用于真实路径） */
export function normalizeFolderRef(s: string): string {
  return trimFolderRef(s).normalize("NFKC");
}

/* ---------- 意图识别 ---------- */

/** 尾部问句/清单动词（剥除后剩下的应是路径/名字本体） */
const TAIL_WORDS_RE =
  /(?:有哪些(?:笔记|文件|内容)?|有哪(?:些|几个)|是什么(?:内容)?|有些什么|有什么(?:内容)?|里面有什么|里有什么|中有什么|有多少(?:篇|个)?|多少篇|统计一下?|列出来|列一下|看一下|看看|浏览一下|打开看看|全部|包含哪些|包括哪些)[。！？?！；;\s]*$/;
const TAIL_PROSPECT_RE =
  /(?:里的(?:所有|全部)?(?:笔记|文件)|下面的(?:所有|全部)?(?:笔记|文件)|下边的(?:所有|全部)?(?:笔记|文件)|中的所有(?:笔记|文件)|里的内容)[。！？?！；;\s]*$/;

/** 「(请)(在|从) X 里/中/内 搜索/查找 Y」：scoped-query */
const SCOPED_RE =
  /^(?:请问|请|帮我|帮我在|请在|请帮我在|在|从|请从|帮)?\s*([^，。！？?；;]{1,40}?)\s*(?:里|中|内|下面)\s*(?:搜索|查找|检索|寻找|找找|找一下?|分析|查看|统计|挖掘|浏览)\s*[:：]?\s*(.+)$/;

/** 句子残留词：命中则不应判为实体名（folder-name / file-name） */
const ENTITY_BLOCK_RE =
  /(?:有关|关于|的笔记|笔记是|是什么|怎么样|如何|为什么|哪些|什么|提到|涉及|提到过|写过|有哪些|与.*相关|相关|说明一下|介绍一下|总结一下|怎么看)/;

/** 检索意图识别 */
export function detectVaultLocationIntent(query: string): LocationIntent {
  const q = (query ?? "").trim();
  if (!q) return { kind: "normal-query", raw: q };

  // 1) scoped-query：在 <目录> 里搜索 <词>
  const scoped = SCOPED_RE.exec(q);
  if (scoped && scoped[1] && scoped[2]) {
    const name = trimFolderRef(scoped[1]);
    const queryPart = scoped[2].trim();
    if (name && queryPart && !ENTITY_BLOCK_RE.test(name) && !/[\\/]/.test(name) && name.length <= 48) {
      return { kind: "scoped-query", name, query: queryPart, raw: q };
    }
  }

  // 2) 剥问句/清单尾部词
  let body = q.replace(TAIL_WORDS_RE, "").replace(TAIL_PROSPECT_RE, "").trim();
  if (!body) return { kind: "normal-query", raw: q };
  body = trimFolderRef(body);

  // 3) 明确 .md 文件
  if (body.toLowerCase().endsWith(".md")) {
    return { kind: "exact-file", target: body, raw: q };
  }

  // 4) 多段路径 = exact-folder
  if (/[\\/]/.test(body)) {
    return { kind: "exact-folder", target: body, raw: q };
  }

  // 5) 无分隔符：仅当剩余是干净实体名（无句子残留）
  if (
    !ENTITY_BLOCK_RE.test(body) &&
    body.length >= 1 &&
    body.length <= 48 &&
    !/[？?。！!；;，,、：:]$/.test(body)
  ) {
    return { kind: "folder-name", name: body, raw: q };
  }

  return { kind: "normal-query", raw: q };
}

/** 提取文件夹名（末段；根为 ""） */
export function folderBaseName(folder: string): string {
  const segs = normalizeFolderRef(folder ?? "").split("/");
  return segs[segs.length - 1] ?? "";
}

/** 从笔记路径列表提取所有文件夹路径（含根 ""；按层级排序，去重） */
export function folderPathsFrom(allPaths: string[]): string[] {
  const set = new Set<string>([""]);
  for (const p of allPaths ?? []) {
    const segs = p.replace(/\\/g, "/").split("/");
    segs.pop(); // 文件名
    let acc = "";
    for (const seg of segs) {
      if (!seg) continue;
      acc = acc ? acc + "/" + seg : seg;
      set.add(acc);
    }
  }
  return Array.from(set).sort();
}

/** 文件是否位于目录内（folder="" 表示全库；用 folder + "/" 前缀防同名误配） */
export function pathInFolder(path: string, folder: string): boolean {
  const f = normalizeFolderRef(folder ?? "");
    const p = normalizeFolderRef((path ?? "").replace(/\\/g, "/"));
  if (!f) return true;
  return p === f || p.startsWith(f + "/");
}

/** 目录解析：完整路径 / 前缀 / 文件夹名 / 大小写 / NFKC / 中文括号容错 */
export function resolveFolderPaths(target: string, allPaths: string[]): FolderResolution {
  const folders = folderPathsFrom(allPaths ?? []);
  const t = normalizeFolderRef(target ?? "");
  if (!t) return { matched: [], ambiguous: false };

  const key = folderKey(t);
  const exact = folders.filter((f) => folderKey(f) === key);
  if (exact.length === 1) return { folder: exact[0], matched: exact, ambiguous: false };
  if (exact.length > 1) return { folder: undefined, matched: exact, ambiguous: true };

  const hasSep = /[\\/]/.test(t);
  const matched: string[] = [];
  const seen = new Set<string>();
  const push = (f: string): void => {
    const k = folderKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    matched.push(f);
  };
  if (hasSep) {
    for (const f of folders) {
      if (f === "") continue;
      if (folderKey(f) === key || f.toLowerCase().startsWith(t.toLowerCase() + "/")) push(f);
    }
  } else {
    for (const f of folders) {
      if (f === "") continue;
      if (folderKey(folderBaseName(f)) === key) push(f);
    }
  }
  if (matched.length === 1) return { folder: matched[0], matched, ambiguous: false };
  return { folder: undefined, matched, ambiguous: matched.length > 1 };
}

/** 笔记名解析（匹配 basename，去 .md；大小写 / NFKC 容错） */
export function resolveFileNames(name: string, allPaths: string[]): FileNameResolution {
  const key = folderKey(name);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const p of allPaths ?? []) {
    const base = (p.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.md$/i, "");
    if (folderKey(base) === key) {
      const k = folderKey(p);
      if (!seen.has(k)) { seen.add(k); matched.push(p); }
    }
  }
  if (matched.length === 1) return { path: matched[0], matched, ambiguous: false };
  return { path: undefined, matched, ambiguous: matched.length > 1 };
}

/* ---------- Scope ---------- */

/** Scope 解析（搜索边界；权限由 permissionPrompt 单独表达） */
export function resolveWorkbenchScope(
  cfg: WorkbenchConfig | undefined,
  ws: KnowledgeWorkspace | undefined,
  globalScope: DiscoveryScope | undefined,
  currentNotePath?: string
): WorkbenchScopeInfo {
  const kind = cfg?.vaultScope ?? "vault";
  if (kind === "vault" || !kind) return { kind: "vault", label: "整个 Vault", folders: [] };
  if (kind === "custom") {
    const folders = (cfg?.customFolders ?? []).map(trimFolderRef).filter(Boolean);
    return {
      kind,
      label: folders.length ? "自定义目录：" + folders.join(" / ") : "自定义目录（未设置，回退全库）",
      folders,
    };
  }
  if (kind === "current-folder") {
    const segs = (currentNotePath ?? "").replace(/\\/g, "/").split("/");
    const folder = segs.length > 1 ? segs.slice(0, -1).join("/") : "";
    return { kind, label: "当前笔记所在目录", folders: folder ? [folder] : [] };
  }
  const sc = workspaceScope(ws, globalScope);
  const folders = (sc?.folders ?? []).map(trimFolderRef).filter(Boolean);
  return { kind: "workspace", label: "Workspace 范围" + (folders.length ? "" : "（未限定目录，回退全库）"), folders };
}

/** Scope 指纹：Workbench Scope / 自定义目录 / Workspace 变更 → cache miss */
export function workbenchScopeFingerprint(
  cfg: WorkbenchConfig | undefined,
  ws: KnowledgeWorkspace | undefined,
  globalScope: DiscoveryScope | undefined,
  currentNotePath?: string
): string {
  const info = resolveWorkbenchScope(cfg, ws, globalScope, currentNotePath);
  return "scope:" + info.kind + "|" + info.folders.slice().sort().join(";") + "|ws:" + (ws?.id ?? "none");
}

/** 规范化比较键：NFKC + 小写 */
export function folderKey(s: string): string {
  return normalizeFolderRef(s ?? "").toLowerCase();
}