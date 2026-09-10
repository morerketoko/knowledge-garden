/**
 * Workbench Retrieval v3 自动测试（P19-01~40）：
 * - detectVaultLocationIntent / resolveFolderPaths / resolveFileNames / pathInFolder / Scope / fingerprint（纯函数）。
 * - safeVaultFolderPath 安全校验。
 * - 静态接线断言：vault.list_folder 工具、search folder 参数、Index Ready Guard、v3 cache key、Prompt 边界修正。
 * - 只测纯函数与源码接线，不依赖 Obsidian 运行时（实机行为在最终报告标 NOT TESTED）。
 */
import "./portable-bootstrap";
import {
  detectVaultLocationIntent,
  resolveFolderPaths,
  resolveFileNames,
  folderPathsFrom,
  pathInFolder,
  resolveWorkbenchScope,
  workbenchScopeFingerprint,
  RETRIEVAL_VERSION,
} from "../src/retrieval";
import { safeVaultFolderPath } from "../src/workbenchTools";
import type { WorkbenchConfig } from "../src/types";
import * as fs from "node:fs";
import * as path from "node:path";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

const SAMPLE_PATHS = [
  "015 书库/二十四史（全12册）/史记.md",
  "015 书库/二十四史（全12册）/汉书.md",
  "015 书库/二十四史（全12册）/宋史/本纪.md",
  "015 书库/二十四史副编/附录.md",
  "历史/二十四史/索引.md",
  "AI/游戏设计.md",
  "Inbox/游戏机制草稿.md",
];
const CFG = { vaultScope: "vault" as const, customFolders: ["015 书库/二十四史（全12册）"] };

// ---------- P19-01~08：意图识别 ----------
{
  const a = detectVaultLocationIntent("015 书库/二十四史（全12册）");
  test("P19-01", a.kind === "exact-folder" && a.target === "015 书库/二十四史（全12册）", "完整路径 → exact-folder（kind=" + a.kind + " target=" + a.target + "）");
  const b = detectVaultLocationIntent("015 书库/二十四史（全12册）有哪些笔记？");
  test("P19-02", b.kind === "exact-folder" && b.target === "015 书库/二十四史（全12册）", "路径+问句后缀 → 仍解析为 exact-folder（" + b.target + "）");
  const c = detectVaultLocationIntent("二十四史");
  test("P19-03", c.kind === "folder-name" && c.name === "二十四史", "无分隔符名字 → folder-name（" + c.name + "）");
  const d = detectVaultLocationIntent("有关历史的笔记有哪些？");
  test("P19-04", d.kind === "normal-query", "普通问句 → normal-query（不误判实体名）");
  const e = detectVaultLocationIntent("在二十四史里搜索司马迁");
  test("P19-05", e.kind === "scoped-query" && e.name === "二十四史" && (e.query || "").includes("司马迁"), "「在 X 里搜索 Y」→ scoped-query（name=" + e.name + " query=" + e.query + "）");
  const f = detectVaultLocationIntent("AI/游戏设计.md");
  test("P19-06", f.kind === "exact-file" && f.target === "AI/游戏设计.md", "显式 .md → exact-file（" + f.target + "）");
  const g = detectVaultLocationIntent("司马迁有哪些记录？");
  test("P19-07", g.kind === "normal-query", "「X 有哪些记录」→ normal-query（避免把提问词后的实体当目录名）");
}

// ---------- P19-09~14：目录解析 ----------
{
  const r1 = resolveFolderPaths("二十四史（全12册）", SAMPLE_PATHS);
  test("P19-09", r1.ambiguous || r1.matched.length === 1, "文件夹名匹配（可能有多个同名 → ambiguous 或唯一解析）matched=" + r1.matched.length);
  const r2 = resolveFolderPaths("015 书库/二十四史（全12册）", SAMPLE_PATHS);
  test("P19-10", !r2.ambiguous && r2.folder === "015 书库/二十四史（全12册）", "完整路径精确解析唯一（" + r2.folder + "）");
  const r3 = resolveFolderPaths("015 书库", SAMPLE_PATHS);
  test("P19-11", !r3.ambiguous && (r3.folder === "015 书库" || (r3.matched.length >= 1 && r3.matched[0].startsWith("015 书库"))), "多级前缀（015 书库 → 前缀命中）=" + r3.matched.join(";"));
  const r4 = resolveFolderPaths("二十四史(全12册)", SAMPLE_PATHS);
  test("P19-12", !r4.ambiguous && r4.folder === "015 书库/二十四史（全12册）", "NFKC 全角括号容错（(全12册) → 命中（全12册））folder=" + r4.folder);
  const r5 = resolveFolderPaths("015 书库/二十四史副编", SAMPLE_PATHS);
  test("P19-13", r5.folder === "015 书库/二十四史副编", "同名前缀不误配（二十四史副编 ≠ 二十四史（全12册）子目录）=" + r5.folder);
  test("P19-14", pathInFolder("015 书库/二十四史（全12册）/史记.md", "015 书库/二十四史（全12册）") && !pathInFolder("015 书库/二十四史副编/附录.md", "015 书库/二十四史（全12册）"), "pathInFolder 用 folder+\"/\" 边界防同名误配");
}

// ---------- P19-15~17：笔记名解析 ----------
{
  const n1 = resolveFileNames("史记", SAMPLE_PATHS);
  test("P19-15", n1.path === "015 书库/二十四史（全12册）/史记.md", "笔记名唯一解析（" + n1.path + "）");
  const n2 = resolveFileNames("游戏设计", SAMPLE_PATHS);
  test("P19-16", n2.ambiguous || n2.matched.length >= 1, "笔记名多匹配 → ambiguous 或命中（matched=" + n2.matched.length + "）");
  const n3 = resolveFileNames("不存在名字", SAMPLE_PATHS);
  test("P19-17", n3.matched.length === 0 && !n3.ambiguous, "无匹配 → 空列表（调用方回退语义检索）");
}

// ---------- P19-18~23：safeVaultFolderPath 安全 ----------
{
  test("P19-18", safeVaultFolderPath("015 书库/二十四史（全12册）", "C:/vault") === "015 书库/二十四史（全12册）", "正常多级目录通过");
  test("P19-19", safeVaultFolderPath("", "C:/vault") === "", "空 = 根目录（全库）");
  test("P19-20", safeVaultFolderPath("C:/vault/notes", "C:/vault") === null, "绝对路径拒绝");
  test("P19-21", safeVaultFolderPath("../secret", "C:/vault") === null, "路径穿越拒绝");
  test("P19-22", safeVaultFolderPath(".obsidian", "C:/vault") === null && safeVaultFolderPath("node_modules", "C:/vault") === null, ".obsidian / node_modules 拒绝");
  test("P19-23", safeVaultFolderPath("notes.md", "C:/vault") === null, ".md 结尾不是目录 → 拒绝（走 vault.read）");
}

// ---------- P19-24~27：Scope ----------
{
  const sc1 = resolveWorkbenchScope(CFG as WorkbenchConfig, undefined, undefined, undefined);
  test("P19-24", sc1.kind === "vault" && sc1.folders.length === 0, "默认 vault = 整个 Vault（搜索边界=全库，权限仍由 Permission）");
  const sc2 = resolveWorkbenchScope({ vaultScope: "current-folder" } as WorkbenchConfig, undefined, undefined, "015 书库/二十四史（全12册）/史记.md");
  test("P19-25", sc2.kind === "current-folder" && sc2.folders[0] === "015 书库/二十四史（全12册）", "current-folder 取当前笔记所在目录（" + sc2.folders[0] + "）");
  const sc3 = resolveWorkbenchScope({ vaultScope: "custom", customFolders: ["015 书库/二十四史（全12册）"] } as WorkbenchConfig, undefined, undefined, undefined);
  test("P19-26", sc3.kind === "custom" && sc3.folders[0] === "015 书库/二十四史（全12册）", "custom 目录白名单生效");
  const f1 = workbenchScopeFingerprint({ vaultScope: "vault" } as WorkbenchConfig, undefined, undefined, undefined);
  const f2 = workbenchScopeFingerprint({ vaultScope: "custom", customFolders: ["015 书库/二十四史（全12册）"] } as WorkbenchConfig, undefined, undefined, undefined);
  test("P19-27", f1 !== f2, "Workbench Scope 变更 → fingerprint 变化（cache miss 依据）");
}

// ---------- P19-28~31：v3 版本与静态接线 ----------
{
  const srcDir = path.resolve(__dirname, "../src");
  const ws = fs.readFileSync(path.join(srcDir, "workbenchService.ts"), "utf8");
  const wt = fs.readFileSync(path.join(srcDir, "workbenchTools.ts"), "utf8");
  const si = fs.readFileSync(path.join(srcDir, "searchIndex.ts"), "utf8");
  const pr = fs.readFileSync(path.join(srcDir, "prompts.ts"), "utf8");
  const ni = fs.readFileSync(path.join(srcDir, "noteIndex.ts"), "utf8");
  test("P19-28", RETRIEVAL_VERSION === "v3" && ws.includes('"rv:" + RETRIEVAL_VERSION'), "Retrieval v3 常量生效且 Ask cache key 纳入 rv:v3");
  test("P19-29", wt.includes("vault.list_folder") && wt.includes("listFolder(") && wt.includes("safeVaultFolderPath"), "workbenchTools 已注册 vault.list_folder + listFolder env + safeVaultFolderPath");
  test("P19-30", si.includes("folderPrefix?: string") || si.includes("folderPrefix"), "searchIndex.search 支持 folder 前缀过滤");
  test("P19-31", pr.includes("候选清单只是第一次本地检索的结果") && pr.includes("不是访问白名单"), "Prompt 已明确候选清单不是白名单");
  test("P19-31b", ni.includes("revision"), "noteIndex 有 revision（文件变化 → Ask cache miss）");
  test("P19-31c", ws.includes("detectVaultLocationIntent") && ws.includes("waitForIndexReady") && ws.includes("workbenchScopeFingerprint") && ws.includes("excludePaths"), "WorkbenchService 已接线意图解析 / Index Ready Guard / scope 指纹 / 渐进去重");
  test("P19-31d", ws.includes("queriesUsed") && ws.includes("QUERY_BUDGET_EXCEEDED"), "Agent 循环有查询预算（maxQueries）");
}

setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);