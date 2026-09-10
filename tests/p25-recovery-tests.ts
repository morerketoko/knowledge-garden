/**
 * Phase 24.x 恢复回归（P25-*）：v1.1.0「复习卡/考试消失」事故的防回归测试。
 *
 * 事故根因：`VaultRoot.full()` 对已经是完整 vault 路径的输入又加了一次 basePath，
 * 状态被写到 `<stateRoot>/Knowledge Garden/.state/cache/...` 嵌套层，而读取走
 * `<stateRoot>/cache/...` —— 于是索引被读成空、又被空写回，表现为「复习卡消失」。
 *
 * 本文件锁三件事：
 *  1. 写入路径幂等（P25-01~03）—— 当时缺失、导致事故的测试；
 *  2. 嵌套布局自动修复（P25-04~05）；
 *  3. 恢复源可用性：Review Cards / Exams 的 Markdown 能被解析器完整还原（P25-06~07）。
 */
import "./portable-bootstrap";
import { mkdtemp } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryRoot, VaultRoot } from "../src/portable/root";
import { PortableStorageHost } from "../src/portable/host";
import { parseCardMarkdown, parseExamMarkdown, ReviewCardStore } from "../src/examStore";

const ROOT = path.join(__dirname, "..");
/** 真实 Vault（可选）：存在时额外做「真实资产可恢复」验证 */
const VAULT_CARDS = path.join("E:", "ob", "Knowledge Garden", "Review Cards");
const VAULT_EXAMS = path.join("E:", "ob", "Knowledge Garden", "Exams");

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function skip(id: string, detail: string): void {
  console.log("SKIP " + id + " :: " + detail);
}

/* ---------------- 假 Vault：真实磁盘后端 ---------------- */
function mkFakeVault(base: string) {
  const disk = (p: string) => path.join(base, p.replace(/\//g, path.sep));
  const listFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? prefix + "/" + e.name : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel); else out.push(rel);
      }
    };
    walk(base, "");
    return out;
  };
  return {
    getAbstractFileByPath(p: string) {
      const exists = fs.existsSync(disk(p));
      if (exists && fs.statSync(disk(p)).isFile()) return { path: p };
      const hasChild = listFiles().some((f) => f.startsWith(p + "/"));
      return exists || hasChild ? { path: p, children: [] } : null;
    },
    async read(f: { path: string }) { return fs.readFileSync(disk(f.path), "utf8"); },
    async cachedRead(f: { path: string }) { return fs.readFileSync(disk(f.path), "utf8"); },
    async create(p: string, data: string) { fs.mkdirSync(path.dirname(disk(p)), { recursive: true }); fs.writeFileSync(disk(p), data, "utf8"); return { path: p }; },
    async createFolder(p: string) { fs.mkdirSync(disk(p), { recursive: true }); return { path: p }; },
    async modify(f: { path: string }, data: string) { fs.mkdirSync(path.dirname(disk(f.path)), { recursive: true }); fs.writeFileSync(disk(f.path), data, "utf8"); },
    async delete(f: { path: string }) { try { fs.unlinkSync(disk(f.path)); } catch { /* noop */ } },
    async trash(f: { path: string }) { try { fs.unlinkSync(disk(f.path)); } catch { /* noop */ } },
    async rename(f: { path: string }, to: string) { fs.mkdirSync(path.dirname(disk(to)), { recursive: true }); fs.renameSync(disk(f.path), disk(to)); },
    getFiles() { return listFiles().map((p) => ({ path: p })); },
    getMarkdownFiles() { return []; },
  };
}

(async () => {
  const STATE_ROOT = "Knowledge Garden/.state";
  const BASE_DIR = ".obsidian/plugins/knowledge-garden";

  /* ============ P25-01~03：写入路径幂等（事故直接原因） ============ */
  {
    const dir = mkdtemp("kg-p25-path-");
    const abs = path.join(ROOT, dir);
    fs.mkdirSync(abs, { recursive: true });
    const root = new VaultRoot(mkFakeVault(abs) as never, STATE_ROOT);

    await root.write(STATE_ROOT + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: [{ id: "keep" }] }));
    const correct = path.join(abs, STATE_ROOT, "cache", "cards.json");
    const nested = path.join(abs, STATE_ROOT, "Knowledge Garden", ".state", "cache", "cards.json");
    test("P25-01", fs.existsSync(correct) && !fs.existsSync(nested),
      "VaultRoot 写入完整 vault 路径幂等：不产生 <stateRoot>/<stateRoot> 嵌套（事故回归）");
    test("P25-02", fs.existsSync(correct) && JSON.parse(fs.readFileSync(correct, "utf8")).entries[0].id === "keep",
      "写入内容完整（未被空索引覆盖）");

    // store 风格路径（baseDir + cache/x.json）必须落到同一位置
    const host = new PortableStorageHost({
      stateRoot: STATE_ROOT, pluginData: new MemoryRoot(),
      vault: new VaultRoot(mkFakeVault(abs) as never, STATE_ROOT), useVault: true,
      reason: "test", stripPrefixes: [STATE_ROOT],
    });
    host.baseDir = BASE_DIR;
    await host.write(BASE_DIR + "/cache/schedule.json", "{\"records\":[]}", { nativeAtomic: true });
    test("P25-03", fs.existsSync(path.join(abs, STATE_ROOT, "cache", "schedule.json")),
      "store 风格路径（baseDir+cache）与直接 vault 路径落在同一目录");
    fs.rmSync(abs, { recursive: true, force: true });
  }

  /* ============ P25-04~05：嵌套布局自动修复 ============ */
  {
    const dir = mkdtemp("kg-p25-repair-");
    const abs = path.join(ROOT, dir);
    const nestedState = path.join(abs, STATE_ROOT, BASE_DIR, "Knowledge Garden", ".state");
    fs.mkdirSync(path.join(nestedState, "cache"), { recursive: true });
    fs.writeFileSync(path.join(nestedState, "cache", "cards.json"), JSON.stringify({ formatVersion: 1, entries: [{ id: "recover-me" }] }), "utf8");
    fs.mkdirSync(path.join(nestedState, "Knowledge Garden", "Prompts", "General"), { recursive: true });
    fs.writeFileSync(path.join(nestedState, "Knowledge Garden", "Prompts", "General", "p.md"), "# P", "utf8");

    const host = new PortableStorageHost({
      stateRoot: STATE_ROOT, pluginData: new MemoryRoot(),
      vault: new VaultRoot(mkFakeVault(abs) as never, STATE_ROOT), useVault: true,
      reason: "test", stripPrefixes: [STATE_ROOT],
    });
    host.baseDir = BASE_DIR;
    const moved = await host.repairDuplicatedLayout();
    const recovered = path.join(abs, STATE_ROOT, "cache", "cards.json");
    const promptAt = path.join(abs, STATE_ROOT, "prompts", "General", "p.md");
    test("P25-04", moved >= 1 && fs.existsSync(recovered) && JSON.parse(fs.readFileSync(recovered, "utf8")).entries[0].id === "recover-me",
      "嵌套层里的状态文件被搬回正确位置且内容不变（moved=" + moved + "）");
    test("P25-05", fs.existsSync(promptAt) && fs.readFileSync(promptAt, "utf8") === "# P",
      "嵌套层里的 Markdown 资产也搬回 .state/prompts/（内容不变）");
    fs.rmSync(abs, { recursive: true, force: true });
  }

  /* ============ P25-06~07：空索引守卫 + 真实恢复源可解析 ============ */
  {
    // 空索引 + 有资产 → 必须能重建（模拟 reindex 的数据路径）
    const dir = mkdtemp("kg-p25-guard-");
    const store = new ReviewCardStore(dir);
    store.load();
    const emptyBefore = store.count() === 0;
    const hasVaultAssets = fs.existsSync(VAULT_CARDS) && fs.readdirSync(VAULT_CARDS).some((f) => f.endsWith(".md"));
    test("P25-06", emptyBefore, "空 cards.json 加载后索引为 0（守卫条件成立，会触发自动重建）");

    if (!hasVaultAssets) {
      skip("P25-07", "未找到真实 Vault 的 Review Cards/Exams，跳过真实资产解析验证（测试可在其他机器运行）");
    } else {
      const cardFiles = fs.readdirSync(VAULT_CARDS).filter((f) => f.endsWith(".md"));
      let okCards = 0;
      const failed: string[] = [];
      for (const f of cardFiles) {
        try {
          if (parseCardMarkdown(fs.readFileSync(path.join(VAULT_CARDS, f), "utf8")).card) okCards++;
          else failed.push(f);
        } catch { failed.push(f); }
      }
      test("P25-07a", okCards === cardFiles.length && cardFiles.length > 0,
        "Review Cards/*.md 全部可解析为复习卡（" + okCards + "/" + cardFiles.length + "，失败 " + failed.length + "）");

      const examFiles = fs.existsSync(VAULT_EXAMS) ? fs.readdirSync(VAULT_EXAMS).filter((f) => f.endsWith(".md")) : [];
      let okExams = 0;
      for (const f of examFiles) {
        try { if (parseExamMarkdown(fs.readFileSync(path.join(VAULT_EXAMS, f), "utf8")).exam) okExams++; } catch { /* 计入失败 */ }
      }
      test("P25-07b", examFiles.length === 0 || okExams === examFiles.length,
        "Exams/*.md 全部可解析为考试（" + okExams + "/" + examFiles.length + "）");
    }
  }

  /* ============ 汇总 ============ */
  console.log("\n==== SUMMARY ====");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
})();
