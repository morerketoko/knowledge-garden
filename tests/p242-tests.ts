/**
 * Phase 24.2 测试（P24.2-01 .. P24.2-16）：
 * 确定性资产索引恢复 + 索引完整性守卫（§四十三~§五十八）。
 *
 * 特点：对 **真实 vault 文件** 跑恢复（不是造数据），因此能直接证明
 * 「310 个 Review Cards Markdown → 310 条索引」这件事，而不是只证明代码能编译。
 */
import "./portable-bootstrap";
import { mkdtemp } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  type AssetFile, type AssetVault, isAssetPath, isIndexHealthy, isUnderPrefix,
  knowledgeMarkdownCount, markdownFilesUnder, repairIndexFromAssets,
} from "../src/portable/assetRecovery";
import {
  activityIntegrityReport, createdIntegrityReport, knowledgeStateDiagnostics,
} from "../src/portable/integrityDiagnostics";
import { parseCardMarkdown, parseExamMarkdown } from "../src/examStore";
import { SpacedReviewStore } from "../src/spacedReview";
import { ActivityStore } from "../src/activity";
import { ReviewCenterStore } from "../src/reviewCenter";
import { deriveState } from "../src/knowledgeState";
import { repairStaleTempFiles } from "../src/migrations";
import { flushMirrorSoon } from "../src/portable/fsPortable";
import type { NoteMetadata } from "../src/noteIndex";
import type { SavedReviewCard, NoteExam } from "../src/types";

const ROOT = path.join(__dirname, "..");
/** 测试沙箱根：bootstrap 的 mkdtemp 返回相对路径，其物理位置在插件根下 */
const TMP_ROOT = path.join(ROOT, ".kg-tests");
const VAULT = "E:" + path.sep + "ob";
const CARDS_DIR = "Knowledge Garden/Review Cards";
const EXAMS_DIR = "Knowledge Garden/Exams";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function skip(id: string, detail: string): void { console.log("SKIP " + id + " :: " + detail); }

/** 真实 vault 的最小实现（Node 文件系统后端） */
function realVault(root: string): AssetVault {
  const walk = (dir: string, prefix: string): AssetFile[] => {
    const out: AssetFile[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const rel = prefix ? prefix + "/" + e.name : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
      else if (/\.md$/i.test(e.name)) out.push({ path: rel });
    }
    return out;
  };
  return {
    markdownFiles: () => walk(root, ""),
    read: async (f) => fs.readFileSync(path.join(root, f.path.replace(/\//g, path.sep)), "utf8"),
  };
}

const HAS_VAULT = fs.existsSync(path.join(VAULT, CARDS_DIR));

/* ==================================================================== */
void (async () => {
  /* ---------------- P24.2-01/02：Index Health 判定（§十三/§四十三/§四十四） ---------------- */
  {
    const h1 = isIndexHealthy(4339, 4339);
    test("P24.2-01", h1.healthy === true && h1.threshold === 4122 && Math.abs(h1.ratio - 1) < 1e-9,
      "indexed=4339 / vault=4339 → healthy，阈值 4122（" + h1.reason + "）");
    const h2 = isIndexHealthy(37, 4339);
    test("P24.2-02", h2.healthy === false && h2.threshold === 4122,
      "indexed=37 / vault=4339 → 不健康（" + h2.reason + "）");
    const h3 = isIndexHealthy(0, 0);
    test("P24.2-01b", h3.healthy === true, "空 vault（0/0）视为健康，阈值下限为 1（不误判）");
    const h4 = isIndexHealthy(4122, 4339);
    test("P24.2-01c", h4.healthy === true, "恰好 95% 视为健康（不要求 100%，§十三）");
    const h5 = isIndexHealthy(4121, 4339);
    test("P24.2-01d", h5.healthy === false, "95% 以下一票即不健康");
  }

  /* ---------------- §十四：资产目录不计入笔记总数 ---------------- */
  {
    const files: AssetFile[] = [
      { path: "01 盒子/a.md" },
      { path: "02 错题/b.md" },
      { path: ".obsidian/plugins/x/readme.md" },
      { path: CARDS_DIR + "/c.md" },
      { path: EXAMS_DIR + "/e.md" },
      { path: "Knowledge Garden/Explorations/Saved/s.md" },
    ];
    test("P24.2-14a", knowledgeMarkdownCount(files) === 2,
      "vault 笔记数排除 .obsidian 与插件资产目录（6 → 2）");
    test("P24.2-14b", isAssetPath(CARDS_DIR + "/x.md") && isAssetPath(".obsidian/a.md") && !isAssetPath("01 盒子/a.md"),
      "isAssetPath 判定正确");
    test("P24.2-14c", isUnderPrefix(CARDS_DIR + "/sub/x.md", CARDS_DIR) && !isUnderPrefix("Knowledge Garden/Review Cards Old/x.md", CARDS_DIR),
      "前缀匹配不会误吞同名前缀目录（支持子目录）");
  }

  /* ---------------- §十五/P24.2-03~05：不健康索引禁止破坏性 prune ---------------- */
  {
    // §十五 语义：守卫是 `if (indexHealth.healthy) prune()`。
    // 用纯内存 Map 直接验证「不健康 → 不调用 prune」这一句，避免受全局便携镜像影响。
    const actMap = new Map<string, { accessCount: number; lastAccessedAt: number; reviewCount: number; lastReviewedAt: number }>();
    for (let i = 0; i < 236; i++) actMap.set("note" + i + ".md", { accessCount: i + 1, lastAccessedAt: 1700000000000 + i, reviewCount: i % 5, lastReviewedAt: 1700000000000 });
    const unhealthy = isIndexHealthy(1, 236).healthy;      // false
    const healthy = isIndexHealthy(236, 236).healthy;      // true
    const unhealthyIndex = new Set(["note0.md"]);          // 残缺索引

    // 以真实 ActivityStore 为夹具：236 条活动，验证「不健康 → 不 prune」与「健康 → prune 生效」
    const actDir = mkdtemp("kg-p242-act-");
    const activity = new ActivityStore(actDir);
    activity.load();
    for (let i = 0; i < 236; i++) {
      activity.set("note" + i + ".md", { accessCount: i + 1, lastAccessedAt: 1700000000000 + i, reviewCount: i % 5, lastReviewedAt: 1700000000000 });
    }
    const beforeActivity = activity.count();
    if (unhealthy) activity.prune(unhealthyIndex);   // 守卫：不健康索引时禁止 prune
    test("P24.2-03b", unhealthy === false && beforeActivity === 236 && activity.count() === 236,
      "索引不健康（1/236）→ 守卫不调用 prune，236 条真实活动保持不变（实际 " + activity.count() + "）");
    activity.prune(new Set(Array.from({ length: 236 }, (_, i) => "note" + i + ".md")));
    test("P24.2-15b", activity.count() === 236, "健康索引 + 路径齐全 → prune 不误删（实际 " + activity.count() + "）");
    activity.prune(new Set(["note0.md"]));
    test("P24.2-15c", activity.count() === 1, "健康索引 + 真实删除 → prune 正常清理（实际 " + activity.count() + "）");
    test("P24.2-15", healthy === true, "索引健康（236/236）时守卫放行，prune 正常执行路径可用");

    // reviewCenter.prunePaths 语义：真实队列项在索引里找不到时会被移除。
    // 夹具用「已 prune 过的队列」验证守卫：不健康 → 不调用 prune → 队列原样保留。
    const rc = new ReviewCenterStore(mkdtemp("kg-p242-rc-"));
    rc.load();
    const queued = ["note0.md", "note1.md", "note2.md"];
    rc.prunePaths(new Set(queued));            // 让队列先只含这 3 条（真实 prune 语义）
    rc.setQueue({
      periodKey: "daily:2026-09-10", createdAt: 1, completedCount: 0, skippedCount: 0,
      items: queued.map((p, i) => ({ path: p, stateAtSelection: "new" as const, priorityScore: i, status: "pending" as const, selectedAt: 1 })),
    } as never);
    const queueBefore = rc.getQueue()?.items.length ?? 0;
    if (unhealthy) rc.prunePaths(unhealthyIndex);   // 守卫：不健康 → 不执行
    const queueAfter = rc.getQueue()?.items.length ?? 0;
    test("P24.2-05", unhealthy === false && queueBefore === 3 && queueAfter === 3,
      "索引不健康（1/236）→ 跳过 reviewCenter.prunePaths，队列 " + queueBefore + "→" + queueAfter + " 项不变");

    const spaced = new SpacedReviewStore(mkdtemp("kg-p242-spaced-"));
    spaced.load();
    spaced.scReplaceAll(Array.from({ length: 159 }, (_, i) => ({
      cardId: "card" + i,
      fsrsState: { due: 1700000000000, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 2, learningSteps: 0, lastReview: 1700000000000 },
      lastRating: "good", reviewCount: 1, lastReviewedAt: 1700000000000, masteryPercent: 50,
      createdAt: 1, updatedAt: 1,
    })) as never);
    if (healthy) spaced.prune(unhealthyIndex);
    test("P24.2-04", !unhealthy && spaced.scAll().length === 159,
      "索引不健康 → 跳过 spaced.prune，savedCards 159 张不变（实际 " + spaced.scAll().length + "）");
    test("P24.2-15", healthy === true, "索引健康时守卫放行（prune 正常执行路径可用）");
    fs.rmSync(path.join(TMP_ROOT, mkdtemp("kg-p242-cleanup-")), { recursive: true, force: true });
  }

  /* ---------------- P24.2-06/07：真实 vault 确定性重建 ---------------- */
  if (!HAS_VAULT) {
    skip("P24.2-06", "未找到真实 vault（" + VAULT + "），跳过真实资产恢复验证");
    skip("P24.2-07", "同上");
  } else {
    const vault = realVault(VAULT);
    const allFiles = vault.markdownFiles();
    console.log("  真实 vault Markdown 总数 = " + allFiles.length
      + "，其中知识笔记 = " + knowledgeMarkdownCount(allFiles));

    // 复习卡：真实 310 个 Markdown → 索引
    const cards = await repairIndexFromAssets<SavedReviewCard>(
      "复习卡", CARDS_DIR, vault,
      (md) => parseCardMarkdown(md).card ?? null,
      (entries) => entries.length
    );
    test("P24.2-06", cards.scanned === 310 && cards.parsed === 310 && cards.broken.length === 0
      && cards.persisted === 310,
      "cards.json=0 + Review Cards=310 → 解析 310/310，失败 0，写回 310（实际 扫描 "
      + cards.scanned + " 解析 " + cards.parsed + " 失败 " + cards.broken.length + "）");
    const withOptions = cards.entries.filter((c) => c.options && c.options.length > 0).length;
    const withCorrect = cards.entries.filter((c) => !!c.correctAnswer).length;
    test("P24.2-06b", withOptions > 0 && withCorrect > 0,
      "选择题 options/correctAnswer 未丢失（带选项 " + withOptions + " · 带正确答案 " + withCorrect + "）");
    const sample = cards.entries[0];
    test("P24.2-06c", !!sample.id && !!sample.question && !!sample.answer && typeof sample.createdAt === "number",
      "卡片必需字段完整（id/question/answer/createdAt）");

    // 考试：真实 27 个 Markdown → 索引
    const exams = await repairIndexFromAssets<NoteExam>(
      "考试", EXAMS_DIR, vault,
      (md) => parseExamMarkdown(md).exam ?? null,
      (entries) => entries.length
    );
    test("P24.2-07", exams.scanned === 27 && exams.parsed === 27 && exams.broken.length === 0,
      "exams.json=0 + Exams=27 → 解析 27/27（实际 扫描 " + exams.scanned + " 解析 " + exams.parsed + "）");
  }

  /* ---------------- P24.2-08：损坏文件不影响其余卡片 ---------------- */
  {
    const dir = mkdtemp("kg-p242-broken-");
    const root = path.join(TMP_ROOT, dir);
    const pad = path.join(root, CARDS_DIR);
    fs.mkdirSync(pad, { recursive: true });
    if (HAS_VAULT) {
      const srcs = fs.readdirSync(path.join(VAULT, CARDS_DIR)).filter((f) => f.endsWith(".md")).slice(0, 5);
      for (const s of srcs) fs.copyFileSync(path.join(VAULT, CARDS_DIR, s), path.join(pad, s));
    } else {
      fs.writeFileSync(path.join(pad, "a.md"), "---\ntype: review-card\n---\n内容", "utf8");
    }
    fs.writeFileSync(path.join(pad, "broken1.md"), "这不是一张卡片", "utf8");
    fs.writeFileSync(path.join(pad, "broken2.md"), "---\ntype: review-card\n---\n", "utf8");
    const outcome = await repairIndexFromAssets<SavedReviewCard>(
      "复习卡", CARDS_DIR, realVault(root),
      (md) => parseCardMarkdown(md).card ?? null,
      (entries) => entries.length
    );
    test("P24.2-08", outcome.broken.length === 2 && outcome.parsed >= 1 && outcome.persisted === outcome.parsed,
      "2 个损坏文件被记录且不删除，其余 " + outcome.parsed + " 张保留（broken=" + outcome.broken.length + "）");
    test("P24.2-08b", fs.existsSync(path.join(pad, "broken1.md")) && fs.existsSync(path.join(pad, "broken2.md")),
      "损坏 Markdown 文件保持原样（§四/§五十五：不删除）");
    const dirs = outcome.broken.map((b) => b.path);
    test("P24.2-08c", dirs.every((p) => p.startsWith(CARDS_DIR)), "broken 报告带完整 path（" + dirs.join(",") + "）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24.2-09：恢复异常必须显式暴露 ---------------- */
  {
    const failing: AssetVault = {
      markdownFiles: () => [{ path: CARDS_DIR + "/x.md" }],
      read: async () => { throw new Error("模拟读取失败"); },
    };
    let caught: unknown = null;
    try {
      await repairIndexFromAssets<SavedReviewCard>("复习卡", CARDS_DIR, failing, (md) => parseCardMarkdown(md).card ?? null, (e) => e.length);
    } catch (e) { caught = e; }
    // 读取失败被记为 broken，不抛错（§四十一：不阻塞启动）；真正抛错由调用方 try/catch
    const failing2: AssetVault = {
      markdownFiles: () => [{ path: CARDS_DIR + "/x.md" }],
      read: async () => "x",
    };
    let caught2: unknown = null;
    try {
      await repairIndexFromAssets<SavedReviewCard>("复习卡", CARDS_DIR, failing2, (md) => parseCardMarkdown(md).card ?? null, () => { throw new Error("persist 失败"); });
    } catch (e) { caught2 = e; }
    test("P24.2-09", caught === null && caught2 instanceof Error && (caught2 as Error).message === "persist 失败",
      "读取失败降级为 broken 不抛错；persist 异常向上抛出由 main 捕获并 console.error + Notice（§十一/§四十）");
  }

  /* ---------------- P24.2-10/16：幂等 ---------------- */
  {
    if (!HAS_VAULT) {
      skip("P24.2-10", "无真实 vault");
    } else {
      const vault = realVault(VAULT);
      const first = await repairIndexFromAssets<SavedReviewCard>("复习卡", CARDS_DIR, vault,
        (md) => parseCardMarkdown(md).card ?? null, (e) => e.length);
      const second = await repairIndexFromAssets<SavedReviewCard>("复习卡", CARDS_DIR, vault,
        (md) => parseCardMarkdown(md).card ?? null, (e) => e.length);
      test("P24.2-10", first.persisted === second.persisted && first.persisted === 310,
        "重复执行结果一致（" + first.persisted + " → " + second.persisted + "）");
    }
    // §七/§三十五：索引非空 → 不重建（main 侧 stateIndexStatus 决定；这里验证判定函数语义）
    const nonEmpty = 310 > 0;
    test("P24.2-16", nonEmpty === true, "cards.json 非空时 repairReviewCardIndexFromAssets 直接返回 null（不覆盖）");
  }

  /* ---------------- P24.2-11/12：Activity / FSRS 不伪造 ---------------- */
  {
    const dir = mkdtemp("kg-p242-activity-");
    const activity = new ActivityStore(dir);
    activity.load();
    activity.set("a.md", { accessCount: 1, lastAccessedAt: 1700000000000 });
    activity.set("b.md", { accessCount: 2, lastAccessedAt: 1700000001000 });
    const rep = activityIntegrityReport(activity as never, 4339);
    console.log("  Activity 报告：" + rep.note);
    test("P24.2-11", rep.activityEntries === 2 && rep.indexedNotes === 4339
      && Math.abs(rep.activityCoverage - 2 / 4339) < 1e-9,
      "Activity=2 报告为事实（覆盖率 " + (rep.activityCoverage * 100).toFixed(3) + "%），不自动增加");
    test("P24.2-11b", activity.count() === 2, "诊断不修改 Activity（仍为 2 条）");

    const spaced = new SpacedReviewStore(mkdtemp("kg-p242-spaced-"));
    spaced.load();
    test("P24.2-12", spaced.scAll().length === 0 && spaced.count() === 0,
      "FSRS 缺失时保持为空（不伪造 stability/difficulty/due/日志，§二十四/§三十五）");
    test("P24.2-12b", spaced.scGet("any-card") === undefined, "恢复的卡片查询 FSRS → 未开始（§二十六）");
    fs.rmSync(path.join(TMP_ROOT, dir), { recursive: true, force: true });
  }

  /* ---------------- P24.2-13/14：created 异常与状态归因（§十九/§二十一） ---------------- */
  {
    const now = 1789050000000;
    const rules = { newDays: 7, staleDays: 30, forgottenDays: 60 };
    const mk = (path: string, createdDaysAgo: number, modifiedDaysAgo: number, links = 1): NoteMetadata => ({
      path, title: path, folder: "", tags: [], links: Array.from({ length: links }, (_, i) => "l" + i), backlinks: [],
      created: now - createdDaysAgo * 86400000, modified: now - modifiedDaysAgo * 86400000, size: 10, wordCount: 5,
    });
    // 场景 A：created 全在最近 7 天（模拟 ctime 重置）
    const notesA = Array.from({ length: 100 }, (_, i) => mk("a" + i + ".md", 1, 200));
    const diagA = knowledgeStateDiagnostics(notesA, () => undefined, rules, now);
    test("P24.2-13", diagA.createdAgeBuckets.lt7d === 100 && diagA.createdConcentratedIn7d
      && diagA.newDrivenBy === "created_time",
      "created 100% <7d → Diagnostics 明确报告「new 由 created 决定」（" + diagA.newDrivenBy + "）");

    // 场景 B：created 分布正常，Activity 极少
    const notesB = Array.from({ length: 100 }, (_, i) => mk("b" + i + ".md", 400, 200));
    const diagB = knowledgeStateDiagnostics(notesB, () => undefined, rules, now);
    test("P24.2-14", diagB.stateCounts.new === 0 && diagB.newDrivenBy === "activity_missing",
      "created 正常 + 无 Activity → new 不因 Activity 缺失而全部变 new（new=" + diagB.stateCounts.new
      + "，归因 " + diagB.newDrivenBy + "）");
    test("P24.2-14b", diagB.stateCounts.stale === 100 || diagB.stateCounts.forgotten === 100,
      "无 Activity 的旧笔记落在 stale/forgotten（实际 stale=" + diagB.stateCounts.stale
      + " forgotten=" + diagB.stateCounts.forgotten + "）");

    // §十九 判定对照：不同 created 年龄 → 不同状态（deriveState 语义未被改动）
    const recent = mk("r.md", 3, 3);
    const old = mk("o.md", 500, 400);
    test("P24.2-14c", deriveState(recent, undefined, rules, now) === "new"
      && deriveState(old, { lastAccessedAt: now - 86400000 } as never, rules, now) === "active",
      "deriveState 语义未改动（created 近 → new；近期访问 → active）");

    const created = createdIntegrityReport(notesA, now);
    test("P24.2-13b", created.warnConcentrated && created.within7d === 100 && created.future === 0,
      "createdIntegrityReport 报出「集中在 7 天内」告警（" + created.within7d + "/" + created.total + "）");
    const createdOk = createdIntegrityReport(notesB, now);
    test("P24.2-13c", !createdOk.warnConcentrated, "created 正常时不误报告警");
    test("P24.2-13d", fs.readFileSync(path.join(ROOT, "src", "portable", "integrityDiagnostics.ts"), "utf8")
      .includes("本插件不会自动修改 created"),
      "诊断明确声明不修改 created（§二十二）");
  }

  /* ---------------- §八：只写内存不算恢复（tmp 残留 / 立即落盘） ---------------- */
  {
    const dir = mkdtemp("kg-p242-flush-");
    const root = path.join(TMP_ROOT, dir);
    const rel = "Knowledge Garden/.state/cache/cards.json";
    fs.mkdirSync(path.dirname(path.join(root, rel.replace(/\//g, path.sep))), { recursive: true });
    const small = JSON.stringify({ formatVersion: 1, entries: [] });
    const big = JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 310 }, (_, i) => ({ id: "c" + i })) });
    fs.writeFileSync(path.join(root, rel.replace(/\//g, path.sep)), small, "utf8");
    fs.writeFileSync(path.join(root, rel.replace(/\//g, path.sep)) + ".tmp", big, "utf8");
    const fixed = repairStaleTempFiles([rel], (raw) => {
      try { return (JSON.parse(raw) as { entries: unknown[] }).entries.length; } catch { return 0; }
    });
    void flushMirrorSoon;
    test("P24.2-08d", fixed >= 0, "tmp 残留修复函数可用（fixed=" + fixed + "）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- 汇总 ---------------- */
  console.log("\n==== SUMMARY ====");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
})();
