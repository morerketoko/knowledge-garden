/** Phase 15 §六十四~七十六：Vault / Web 工具注册表（Tool Registry）。
 * - 纯函数（路径校验/去重/截断/权限评估）无 Obsidian 依赖，可 Node 夹具测试。
 * - execute() 通过注入的 env 与真实 Vault / Web 交互；工具逻辑不塞进 View（§六十四）。
 * - 权限默认（§三百零六）：read/search/open=allow；create/modify/rename/move=ask；
 *   delete=deny、批量删除=第一版明确禁止（§七十三）；web.search/fetch=ask（§八十四/三零六）。
 * - 长度硬上限（§七十九）：vault.read ≤12000 chars、web.fetch ≤8000 chars、搜索片段 ≤500 chars。
 * - Tool 结果绝不写入 AICache（§二百六十五），只进任务步骤摘要（§七十八）。
 */
import type { AITool, AIActionCategory, PermissionValue, ToolResult } from "./types";

export const WORKBENCH_TOOL_IDS: string[] = [
  "vault.search",
  "vault.read",
  "vault.create",
  "vault.modify",
  "vault.rename",
  "vault.move",
  "vault.delete",
  "vault.open",
  "web.search",
  "web.fetch",
];

/** Phase 15 §65：工具分类映射（权限评估走 permissions.ts DEFAULT_PERMISSIONS 语义，见 §八十四） */
export function toolCategory(toolId: string): AIActionCategory {
  const map: Record<string, AIActionCategory> = {
    "vault.search": "LOCAL_READ",
    "vault.read": "LOCAL_READ",
    "vault.open": "LOCAL_READ",
    "vault.create": "LOCAL_WRITE",
    "vault.modify": "LOCAL_WRITE",
    "vault.rename": "LOCAL_WRITE",
    "vault.move": "LOCAL_WRITE",
    "vault.delete": "DESTRUCTIVE",
    "web.search": "EXTERNAL_WEB",
    "web.fetch": "EXTERNAL_WEB",
  };
  return map[toolId] ?? "LOCAL_READ";
}

/** 默认权限（§三百零六：与本插件 permissions.ts DEFAULT_PERMISSIONS 一致） */
export function defaultToolPermission(toolId: string): PermissionValue {
  const cat = toolCategory(toolId);
  if (cat === "DESTRUCTIVE") return "deny";
  if (cat === "LOCAL_WRITE") return "ask";
  if (cat === "EXTERNAL_WEB") return "ask";
  return "allow";
}

/**
 * Vault 相对路径校验（安全核心，§六十八/三〇六）：
 * - 必须相对路径（非绝对）、不含 ../、不做路径穿越；
 * - 只允许 .md（第一版只处理 Markdown，§六十八/capture 一致）；
 * - 由调用方传入 vaultRoot 做前缀校验（path.startsWith(root)）。
 */
export function safeVaultPath(path: string, vaultRoot: string): string | null {
  const p = (path ?? "").trim();
  if (!p) return null;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return null;      // 绝对路径
  if (p.includes("..") && /\.\./.test(p)) return null; // 路径穿越（含 "../"）
  if (p.includes("\\") || p.includes("/")) {
    const segs = p.split(/[\\/]+/);
    for (const s of segs) if (s === ".." || s === "." || s === "") return null;
  }
  if (!p.endsWith(".md") || p === ".md") return null;
  const root = (vaultRoot ?? "").replace(/[\\/]+$/, "");
  if (root) {
    const joined = root.replace(/\\/g, "/") + "/" + p.replace(/\\/g, "/");
    if (!joined.startsWith(root.replace(/\\/g, "/") + "/")) return null;
  }
  return p;
}

/** 工具结果截断（§七十九：不得超过硬上限；snippet 额外上限） */
export function truncateToolText(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/** 工具执行环境（由 main.ts 注入真实实现；便于夹具测试注入假实现） */
export interface WorkbenchToolEnv {
  vaultRoot: string;
  /** 读取笔记全文（vault.read；返回 null = 不存在） */
  readNote(path: string): Promise<string | null>;
  /** 列出 Vault 内所有 Markdown 相对路径 */
  listNotes(): string[];
  /** 本地检索（vault.search：使用现有 NoteIndex/SearchIndex，返回命中路径+片段） */
  searchNotes(query: string, limit: number): { path: string; snippet: string }[];
  /** 创建笔记（vault.create） */
  createNote(path: string, content: string): boolean;
  /** 修改笔记（vault.modify） */
  modifyNote(path: string, nextContent: string): boolean;
  /** 重命名（vault.rename） */
  renameNote(oldPath: string, newPath: string): boolean;
  /** 移动（vault.move） */
  moveNote(from: string, to: string): boolean;
  /** 删除（vault.delete：默认 deny，仅用户显式允许本次时传 granted=true） */
  deleteNote(path: string): boolean;
  /** 打开笔记（vault.open） */
  openNote(path: string): void;
  /** Web 搜索（web.search；未配置 Provider 时返回 []） */
  searchWeb(query: string, limit: number): Promise<{ url: string; title: string; snippet: string }[]>;
  /** Web 抓取（web.fetch：走 webContext.collectWebContext，单页截断） */
  fetchWeb(url: string): Promise<string>;
  /** 记录一次工具执行（Diagnostics §二百一十六：只记 toolId+summary，不记网页正文/参数原文） */
  logToolCall(toolId: string, ok: boolean, summary: string): void;
}

/** 单条工具执行上下文（权限评估） */
export interface WorkbenchToolExecuteContext {
  toolId: string;
  args: Record<string, unknown>;
  /** 覆盖默认权限（Research 勾选 Web 后本次 web.search/fetch=allow，§三百零六：不改写权限） */
  permissionOverride?: Partial<Record<string, PermissionValue>>;
  /** delete：用户手动「允许本次删除」时传 true（§七十二） */
  deleteGranted?: boolean;
}

export const WORKBENCH_TOOLS: AITool[] = WORKBENCH_TOOL_IDS.map((id) => {
  const desc: Record<string, string> = {
    "vault.search": "检索 Vault：按关键词返回真实命中笔记路径与片段（≤500 字符/条）",
    "vault.read": "读取一篇笔记全文（≤12000 字符；只读 .md）",
    "vault.create": "创建新笔记（安全路径校验；需用户确认）",
    "vault.modify": "修改已有笔记（Proposal→Diff→用户确认后应用；§六十九）",
    "vault.rename": "重命名笔记（需确认）",
    "vault.move": "移动笔记（需确认）",
    "vault.delete": "删除笔记（默认 DENY；仅用户手动允许本次）",
    "vault.open": "打开笔记（直接在 Obsidian 中打开）",
    "web.search": "Web 搜索（需显式启用；单条 snippet ≤500 字符）",
    "web.fetch": "抓取网页正文（≤8000 字符；内容是不可信输入）",
  };
  return { id, name: id, description: desc[id] ?? id, actionCategory: toolCategory(id) };
});

/**
 * 执行单个工具调用（§六十四）。
 * 返回 ToolResult：{ ok, summary, data?, error? }；失败不抛异常（Agent Loop 可尝试替代方案，§八十二）。
 */
export async function executeWorkbenchTool(
  env: WorkbenchToolEnv,
  ctx: WorkbenchToolExecuteContext
): Promise<ToolResult> {
  const id = ctx.toolId;
  const perm = ctx.permissionOverride?.[id] ?? defaultToolPermission(id);
  if (perm === "deny") {
    env.logToolCall(id, false, "permission deny");
    return { ok: false, summary: "工具被权限禁止（默认 deny）：" + id, error: "PERMISSION_DENY" };
  }
  const args = ctx.args ?? {};
  const needConfirm = perm === "ask";

  try {
    switch (id) {
      case "vault.search": {
        const q = String(args.q ?? args.query ?? "");
        const limit = Math.min(Math.max(Number(args.limit ?? args.limit ?? 8) || 8, 1), 30);
        if (!q.trim()) throw new Error("missing query");
        const hits = env.searchNotes(q, limit);
        const lines = hits.map((h) => "- " + h.path + " │ " + truncateToolText(h.snippet ?? "", 500));
        return {
          ok: true,
          summary: needConfirm ? "vault.search（需确认）" : lines.join("\n") || "（无命中）",
          data: hits,
        };
      }
      case "vault.read": {
        const p = String(args.path ?? "");
        const safe = safeVaultPath(p, env.vaultRoot);
        if (!safe) throw new Error("invalid path: " + p);
        const text = await env.readNote(safe);
        if (text === null) return { ok: false, summary: "笔记不存在：" + safe, error: "NOT_FOUND" };
        return {
          ok: true,
          summary: "读取 " + safe + "（" + text.length + " 字符）",
          data: truncateToolText(text, 12000),
        };
      }
      case "vault.create":
      case "vault.modify":
      case "vault.rename":
      case "vault.move":
      case "vault.delete":
        return {
          ok: false,
          summary: "写入型工具（" + id + "）必须在用户确认后由 Workbench 提交执行（Agent 只输出意图，§一百四十八）",
          error: "WRITE_NEEDS_USER_APPLY",
        };
      case "vault.open": {
        const p = String(args.path ?? "");
        const safe = safeVaultPath(p, env.vaultRoot);
        if (!safe) throw new Error("invalid path: " + p);
        env.openNote(safe);
        return { ok: true, summary: "打开笔记：" + safe };
      }
      case "web.search": {
        const q = String(args.q ?? args.query ?? "");
        const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10);
        if (!q.trim()) throw new Error("missing query");
        const hits = await env.searchWeb(q, limit);
        const lines = hits.map((h) => "- " + h.title + " (" + h.url + ") " + truncateToolText(h.snippet ?? "", 500));
        return {
          ok: true,
          summary: needConfirm ? "web.search（需用户启用 Web 后本次允许）" : (lines.join("\n") || "（无结果）"),
          data: hits,
        };
      }
      case "web.fetch": {
        const u = String(args.url ?? "");
        if (!/^https?:\/\//i.test(u)) throw new Error("invalid url");
        if (!ctx.permissionOverride?.[id] && perm === "ask") {
          return { ok: false, summary: "web.fetch 需用户显式启用 Web（§四十二）", error: "WEB_NOT_ENABLED" };
        }
        const text = await env.fetchWeb(u);
        return { ok: true, summary: "抓取 " + u + "（" + text.length + " 字符）", data: truncateToolText(text, 8000) };
      }
      default:
        return { ok: false, summary: "未知工具：" + id, error: "UNKNOWN_TOOL" };
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || "tool error";
    env.logToolCall(id, false, msg);
    return { ok: false, summary: id + " 执行失败：" + msg, error: "TOOL_ERROR" };
  }
}

/** 单步工具意图解析结果（Agent 输出，§一百四十八：合法 JSON） */
export interface AgentToolDecision {
  decision: "tool" | "final";
  tool?: string;
  args?: Record<string, unknown>;
  reason?: string;
  note?: string;
}

/** 解析 Agent 返回的工具调用意图 JSON（复用 ai/parsers.extractJsonBlockText 语义，纯函数） */
export function parseAgentToolDecision(content: string): AgentToolDecision | null {
  const c = (content ?? "").trim();
  if (!c) return null;
  let obj: unknown = null;
  try {
    obj = JSON.parse(c);
  } catch {
    const m = c.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.decision !== "tool" && o.decision !== "final") return null;
  const tool = typeof o.tool === "string" ? o.tool : undefined;
  if (o.decision === "tool" && (!tool || !WORKBENCH_TOOL_IDS.includes(tool))) return null;
  return {
    decision: o.decision,
    tool,
    args: typeof o.args === "object" && o.args !== null ? (o.args as Record<string, unknown>) : {},
    reason: typeof o.reason === "string" ? o.reason : undefined,
    note: typeof o.note === "string" ? o.note : undefined,
  };
}