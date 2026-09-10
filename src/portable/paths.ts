/**
 * Phase 24：平台无关路径工具（替代 Node `path`）。
 *
 * 约束（§十六 / §十七 / §一百三十六）：
 * - 禁止 `path.join` / `path.dirname` / `path.resolve` / Node `path` 模块；
 * - 所有路径均为 **vault-relative**（POSIX 风格，`/` 分隔，无前导 `/`）；
 * - 纯字符串实现，可在桌面 / iOS / Android 的 JS runtime 中运行。
 *
 * 为什么不用 esbuild 别名替换 `path`：别名只改打包结果，源码仍会写出
 * `path.resolve` 这类会产生绝对路径的调用；显式函数名让「路径语义」在
 * 源码层可见，配合类型别名 PluginPath 可在编译期拦住绝对路径。
 */

/** 插件私有存储空间（plugin dir / plugin data）中的路径 —— 不暴露给 Vault */
export type PluginPath = string & { readonly __pluginPath?: unique symbol };

/** 非法路径视为不安全的输入（§十七：禁止绝对路径 / ../ / 插件内部结构 / .obsidian） */
export function isUnsafeRelativePath(p: string): boolean {
  if (!p || typeof p !== "string") return true;
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  const normalized = p.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const seg of segments) {
    const s = seg.trim();
    if (s === "..") return true;
    // Windows 驱动器相对路径（C:foo）与协议前缀（file: / http: / data:）一律拒绝：
    // 合法文件名不需要冒号，看到冒号就按「可能是绝对路径 / 协议」处理（fail-closed）
    if (s.includes(":")) return true;
  }
  return false;
}

/**
 * §十七：插件内部结构与仓库元数据目录永远不许作为存储路径。
 * 之前这些路径虽然在便携存储里是「相对路径」，但写进 `.obsidian/` 在移动端既不可靠
 * 也不符合规范；这里集中拒绝。
 */
export function isReservedStoragePath(p: string): boolean {
  const n = normalizeVaultPath(p);
  if (!n) return true;
  const lower = n.toLowerCase();
  return lower === ".obsidian" || lower.startsWith(".obsidian/")
    || lower === ".trash" || lower.startsWith(".trash/")
    || lower.split("/").includes("node_modules");
}

/**
 * 规范化 vault/插件相对路径：折叠 `//`、去除首尾 `/`、解析 `.`、拒绝 `..`（返回 ""）。
 * 与 Obsidian 的 normalizePath 语义一致，但不依赖 obsidian 模块（便于 Node 测试）。
 */
export function normalizeVaultPath(input: string): string {
  if (input === null || input === undefined) return "";
  let p = String(input).replace(/\\/g, "/").trim();
  if (!p) return "";
  if (isUnsafeRelativePath(p)) return "";
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    out.push(seg);
  }
  return out.join("/");
}

/** 拼接相对路径片段（等价 path.join，但只产生相对路径） */
export function joinVaultPath(...parts: (string | undefined | null)[]): string {
  const pieces = parts
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .map((x) => x.replace(/\\/g, "/"))
    .join("/");
  return normalizeVaultPath(pieces);
}

/** 等价 path.dirname（相对路径版本） */
export function dirnameVaultPath(p: string): string {
  const n = normalizeVaultPath(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? "" : n.slice(0, i);
}

/** 等价 path.basename（相对路径版本；ext 传入时去掉该后缀） */
export function basenameVaultPath(p: string, ext?: string): string {
  const n = normalizeVaultPath(p);
  const i = n.lastIndexOf("/");
  const base = i < 0 ? n : n.slice(i + 1);
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) return base.slice(0, base.length - ext.length);
  return base;
}

/** 补全扩展名（等价 path.extname 的存在性判断之外的唯一常用场景） */
export function extnameVaultPath(p: string): string {
  const base = basenameVaultPath(p);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i);
}

/** 绝对路径判定（用于把 manifest.dir 之类的历史绝对路径转成相对路径） */
export function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(String(p ?? ""));
}

/**
 * 把可能的历史绝对插件目录转成 vault 相对目录。
 * - 输入 `C:\\vault\\.obsidian\\plugins\\knowledge-garden` + vault 根 → `.obsidian/plugins/knowledge-garden`
 * - 输入已是相对（`.obsidian/plugins/knowledge-garden`）→ 原样规范化
 * - 无法转换（不在 vault 内）→ ""，调用方据此退回 plugin data 后端。
 */
export function toVaultRelative(absoluteOrRelative: string, vaultBasePath?: string | null): string {
  const raw = String(absoluteOrRelative ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!raw) return "";
  if (!isAbsolutePath(raw)) return normalizeVaultPath(raw);
  const base = String(vaultBasePath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return "";
  if (raw === base) return "";
  if (raw.startsWith(base + "/")) return normalizeVaultPath(raw.slice(base.length + 1));
  return "";
}
