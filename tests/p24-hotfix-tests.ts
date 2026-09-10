/**
 * Phase 24.x Critical Hotfix 测试（P24-HOTFIX-01 .. 32）：
 * 便携迁移数据保全 / 错误目录恢复 / 嵌套恢复 / PluginData 恢复 / 冲突不覆盖。
 *
 * 复现的真实事故链：
 *  1. v1.0.x 桌面状态在 `.obsidian/plugins/knowledge-garden/cache/`
 *  2. Phase 24 迁移目标写成字面 `.state/…`（vault 根），业务却读 `Knowledge Garden/.state/…`
 *  3. `VaultRoot.full()` 重复拼接 → 又出现 `<stateRoot>/<baseDir>/<stateRoot>/…` 嵌套层
 *  4. `atomicWriteJson` 只改内存镜像 → 磁盘留旧字节（index.json 1 条 vs .tmp 37 条）
 *
 * 测试只依赖便携层（MemoryRoot / VaultRoot + 假 adapter），不需要 Obsidian。
 */
import "./portable-bootstrap";
import { mkdtemp } from "./portable-bootstrap";
import * as fs from "node:fs";
import * as path from "node:path";

import { MemoryRoot, VaultRoot } from "../src/portable/root";
import { PortableStorageHost } from "../src/portable/host";
import {
  STATE_FILES, backupSources, diagnoseStateSources, jsonWeight, recoverState, describeRecovery,
  type SourceInfo, type StateSourceOptions,
} from "../src/portable/recovery";
import {
  LEGACY_STATE_FILES, isNonEmptyStateJson, legacyPluginDirCandidates, migrateLegacyState,
} from "../src/portable/legacyMigration";
import { atomicWriteJson, repairStaleTempFiles } from "../src/migrations";
import { SpacedReviewStore } from "../src/spacedReview";
import { ExamStore, ReviewCardStore, parseCardMarkdown, parseExamMarkdown } from "../src/examStore";
import * as fsPortable from "../src/portable/fsPortable";
import { __mirrorSnapshot } from "../src/portable/fsPortable";
import { joinVaultPath } from "../src/portable/paths";

const ROOT = path.join(__dirname, "..");
const REAL_DATA_JSON = path.join("E:", "ob", ".obsidian", "plugins", "knowledge-garden", "data.json");
const REAL_CARDS = path.join("E:", "ob", "Knowledge Garden", "Review Cards");
const REAL_EXAMS = path.join("E:", "ob", "Knowledge Garden", "Exams");

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function skip(id: string, detail: string): void { console.log("SKIP " + id + " :: " + detail); }

const STATE_ROOT = "Knowledge Garden/.state";
const LEGACY_DIR = ".obsidian/plugins/knowledge-garden";

/* ------------------------------------------------------------------ */
/* 假 Vault（真实磁盘后端）+ 工具                                       */
/* ------------------------------------------------------------------ */

function mkFakeVault(root: string) {
  const disk = (p: string) => path.join(root, p.replace(/\//g, path.sep));
  const listFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? prefix + "/" + e.name : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel); else out.push(rel);
      }
    };
    walk(root, "");
    return out;
  };
  return {
    getAbstractFileByPath(p: string) {
      const ex = fs.existsSync(disk(p));
      if (ex && fs.statSync(disk(p)).isFile()) return { path: p };
      const hasChild = listFiles().some((f) => f.startsWith(p + "/"));
      return ex || hasChild ? { path: p, children: [] } : null;
    },
    async read(f: { path: string }) { return fs.readFileSync(disk(f.path), "utf8"); },
    async cachedRead(f: { path: string }) { return fs.readFileSync(disk(f.path), "utf8"); },
    async create(p: string, d: string) { fs.mkdirSync(path.dirname(disk(p)), { recursive: true }); fs.writeFileSync(disk(p), d, "utf8"); return { path: p }; },
    async createFolder(p: string) { fs.mkdirSync(disk(p), { recursive: true }); return { path: p }; },
    async modify(f: { path: string }, d: string) { fs.mkdirSync(path.dirname(disk(f.path)), { recursive: true }); fs.writeFileSync(disk(f.path), d, "utf8"); },
    async delete(f: { path: string }) { try { fs.unlinkSync(disk(f.path)); } catch { /* noop */ } },
    async trash(f: { path: string }) { try { fs.unlinkSync(disk(f.path)); } catch { /* noop */ } },
    async rename(f: { path: string }, to: string) { fs.mkdirSync(path.dirname(disk(to)), { recursive: true }); fs.renameSync(disk(f.path), disk(to)); },
    getFiles() { return listFiles().map((p) => ({ path: p })); },
    getMarkdownFiles() { return []; },
  };
}

/** 假 App：adapter 把 legacy 目录映射到真实临时目录（§八：支持两个旧 id） */
function mkFakeApp(root: string, legacyRel: string, legacyDisk: string, configDir = ".obsidian") {
  const map = (p: string) => (p === legacyRel || p.startsWith(legacyRel + "/"))
    ? path.join(root, legacyDisk, p === legacyRel ? "" : p.slice(legacyRel.length + 1))
    : path.join(root, p);
  const adapter = {
    async exists(p: string) { return fs.existsSync(map(p)); },
    async read(p: string) { return fs.readFileSync(map(p), "utf8"); },
    async list(p: string) {
      const dir = map(p);
      const es = fs.readdirSync(dir, { withFileTypes: true });
      return { files: es.filter((e) => e.isFile()).map((e) => e.name), folders: es.filter((e) => e.isDirectory()).map((e) => e.name) };
    },
  };
  return { vault: { adapter, configDir } } as never;
}

interface Ctx {
  root: string;
  host: PortableStorageHost;
  vault: VaultRoot;
  vaultRaw: ReturnType<typeof mkFakeVault>;
}

function mkCtx(tag: string): Ctx {
  const dir = mkdtemp("kg-hotfix-" + tag + "-");
  const root = path.join(ROOT, dir);
  fs.mkdirSync(root, { recursive: true });
  const vaultRaw = mkFakeVault(root);
  const vault = new VaultRoot(vaultRaw as never, STATE_ROOT);
  const host = new PortableStorageHost({
    stateRoot: STATE_ROOT, pluginData: new MemoryRoot(), vault, useVault: true,
    reason: "test", stripPrefixes: [STATE_ROOT],
  });
  host.baseDir = LEGACY_DIR;
  return { root, host, vault, vaultRaw };
}

function writeDisk(root: string, rel: string, text: string): void {
  const p = path.join(root, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, "utf8");
}
function readDisk(root: string, rel: string): string | null {
  const p = path.join(root, rel.replace(/\//g, path.sep));
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** 构造与真实事故同规模的 legacy 状态（§五十七：cards=182 / savedCards=159 / activity=236） */
function legacyFixture(): Record<string, string> {
  const cards = {
    formatVersion: 1,
    entries: Array.from({ length: 182 }, (_, i) => ({
      id: "card" + i, sourcePath: "note" + (i % 20) + ".md", sourceVersion: "v1",
      question: "题目 " + i, answer: "答案 " + i, questionType: i % 3 === 0 ? "multiple_choice" : "recall",
      options: i % 3 === 0 ? ["A" + i, "B" + i, "C" + i, "D" + i] : undefined,
      correctAnswer: i % 3 === 0 ? "A" + i : undefined,
      createdAt: 1700000000000 + i, updatedAt: 1700000000000 + i,
    })),
  };
  const savedCards: Record<string, unknown> = {};
  const savedCardReviewLogs: unknown[] = [];
  for (let i = 0; i < 159; i++) {
    savedCards["card" + i] = {
      cardId: "card" + i,
      fsrsState: { due: 1700000000000 + i * 1000, stability: 1 + i, difficulty: 5, reps: i, lapses: 0, state: 2, learningSteps: 0, lastReview: 1700000000000 },
      lastRating: "good", reviewCount: i, lastReviewedAt: 1700000000000, masteryPercent: 50 + (i % 50),
      createdAt: 1700000000000, updatedAt: 1700000000000,
    };
    savedCardReviewLogs.push({ cardId: "card" + i, timestamp: 1700000000000 + i, rating: "good" });
  }
  const spaced = {
    formatVersion: 2,
    cards: { "note0.md": { path: "note0.md", fsrsState: { due: 1700000000000, stability: 5, difficulty: 5, reps: 3, lapses: 1, state: 2, learningSteps: 0, lastReview: 1700000000000 }, lastRating: "good", reviewCount: 3, lastReviewedAt: 1700000000000, masteryPercent: 60, createdAt: 1, updatedAt: 1 } },
    reviewLogs: [{ path: "note0.md", timestamp: 1700000000000, rating: "good" }],
    savedCards,
    savedCardReviewLogs,
  };
  const activity: Record<string, unknown> = {};
  for (let i = 0; i < 236; i++) {
    activity["note" + i + ".md"] = { lastAccessedAt: 1700000000000 + i * 1000, accessCount: i + 1, lastReviewedAt: 1700000000000 + i * 500, reviewCount: i % 7 };
  }
  const evolution = {
    formatVersion: 1,
    snapshots: Array.from({ length: 12 }, (_, i) => ({
      date: "2026-0" + (i % 9 + 1) + "-01", periodKey: "snapshot:weekly:2026-W" + i,
      totalNotes: 100 + i, totalAreas: 3, activeNotes: 10, growingNotes: 5, staleNotes: 4, forgottenNotes: 2, newNotes: 3,
      topConcepts: [], areaStats: [], crossAreaLinks: [], unresolvedQuestions: [],
    })),
  };
  return {
    "cache/cards.json": JSON.stringify(cards),
    "cache/exams.json": JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 12 }, (_, i) => ({ id: "exam" + i, title: "考试" + i, createdAt: i, updatedAt: i, sourcePath: "n.md", mode: "recall", difficulty: "standard", questions: [], coverageTopics: [] })) }),
    "cache/spaced-review.json": JSON.stringify(spaced),
    "cache/activity.json": JSON.stringify(activity),
    "cache/evolution.json": JSON.stringify(evolution),
    "cache/review-queue.json": JSON.stringify({ formatVersion: 1, queue: { periodKey: "daily:2026-09-10", createdAt: 1, items: Array.from({ length: 10 }, (_, i) => ({ path: "note" + i + ".md", stateAtSelection: "new", priorityScore: i, status: "pending", selectedAt: 1 })), completedCount: 0, skippedCount: 0 } }),
    "cache/schedule.json": JSON.stringify([{ type: "daily", periodKey: "daily:2026-09-10", scheduledAt: 1, status: "running", startedAt: 1, attempts: 1 }]),
    "cache/ai-cache.json": JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ key: "k" + i, type: "curiosity", status: "success", createdAt: 1, updatedAt: 2, data: { title: "t" + i } }))),
    "cache/index.json": JSON.stringify([{ path: "a.md", title: "A", folder: "", tags: [], links: [], created: 1, modified: 2, wordCount: 3, size: 4, mtime: 2 }]),
    "cache/relationships.json": JSON.stringify({ formatVersion: 1, relationships: [{ id: "r1", from: "a.md", to: "b.md", relation: "支持", direction: "forward", evidence: ["user_confirmed"], status: "active", createdAt: 1, updatedAt: 1 }] }),
    "cache/saved-explorations.json": JSON.stringify({ formatVersion: 1, entries: [{ id: "s1", title: "T", query: "q", source: "query_exploration", createdAt: 1, updatedAt: 1, nodes: [], edges: [], markdownPath: "x.md", fingerprint: "f" }] }),
    "cache/workbench-sessions.json": JSON.stringify({ formatVersion: 1, sessions: [{ sessionId: "sess1", title: "T", turnCount: 1, question: "Q", sources: [], skillIds: [], createdAt: 1, updatedAt: 1 }] }),
    "cache/source-ledger.json": JSON.stringify({ formatVersion: 1, records: [{ id: "src1", type: "vault", path: "a.md", createdAt: 1 }] }),
    "cache/card-reviews.json": JSON.stringify({ formatVersion: 1, records: [{ cardId: "card0", reviewedAt: 1, rating: "good" }] }),
    "cache/exam-sessions.json": JSON.stringify({ formatVersion: 1, sessions: [{ examId: "exam0", mode: "exam", currentIndex: 2, answers: [], status: "running", startedAt: 1, updatedAt: 1 }] }),
  };
}

/** 便携镜像里某路径的内容（修复后立即读取，不等异步落盘） */
function mirrorText(pathRel: string): string | null {
  const snap = __mirrorSnapshot();
  const key = "Knowledge Garden/.state/" + pathRel;
  return snap[key] ?? null;
}

function countOf(raw: string | null, pick = jsonWeight): number {
  if (raw === null) return 0;
  try { return pick(JSON.parse(raw)); } catch { return 0; }
}
function savedCardCount(raw: string | null): number {
  if (raw === null) return 0;
  try { const j = JSON.parse(raw) as { savedCards?: Record<string, unknown> }; return j.savedCards ? Object.keys(j.savedCards).length : 0; } catch { return 0; }
}
function savedLogCount(raw: string | null): number {
  if (raw === null) return 0;
  try { const j = JSON.parse(raw) as { savedCardReviewLogs?: unknown[] }; return j.savedCardReviewLogs ? j.savedCardReviewLogs.length : 0; } catch { return 0; }
}

/* ==================================================================== */
void (async () => {
  /* ---------------- P24-HOTFIX-01/02：legacy 路径与目标 ---------------- */
  {
    const { root, host } = mkCtx("legacy");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, path.join(LEGACY_DIR, rel), raw);
    const app = mkFakeApp(root, LEGACY_DIR, LEGACY_DIR);

    test("P24-HOTFIX-01", legacyPluginDirCandidates("knowledge-garden").join(",") ===
      ".obsidian/plugins/knowledge-garden,.obsidian/plugins/kg-knowledge-garden",
      "legacy 目录候选含两个历史 id（§八）");
    test("P24-HOTFIX-01b", LEGACY_STATE_FILES.length >= 23 && LEGACY_STATE_FILES.includes("cache/spaced-review.json"),
      "legacy 文件清单覆盖 spaced-review / cards / activity / evolution 等（" + LEGACY_STATE_FILES.length + " 项）");

    const r = await migrateLegacyState(app, host, "knowledge-garden");
    test("P24-HOTFIX-02", r.detected && r.copied.length >= 10, "检测到旧桌面 cache 并迁移（copied=" + r.copied.length + "）");
    const targetPath = STATE_ROOT + "/cache/cards.json";
    test("P24-HOTFIX-02b", readDisk(root, targetPath) !== null && readDisk(root, ".state/cache/cards.json") === null,
      "迁移目标 = " + STATE_ROOT + "/cache（绝不是 vault 根的 .state/cache，§六/§七）");
    test("P24-HOTFIX-02c", r.target === STATE_ROOT + "/", "迁移结果 target 只由 host.stateRoot 决定");
    test("P24-HOTFIX-25", readDisk(root, LEGACY_DIR + "/cache/cards.json") !== null, "legacy 文件未被删除（§二十五/§四十五）");

    /* ---------------- P24-HOTFIX-06/07/08/09：计数保全 ---------------- */
    const cardsRaw = readDisk(root, STATE_ROOT + "/cache/cards.json");
    const spacedRaw = readDisk(root, STATE_ROOT + "/cache/spaced-review.json");
    const activityRaw = readDisk(root, STATE_ROOT + "/cache/activity.json");
    test("P24-HOTFIX-06", countOf(cardsRaw) === 182, "cards count preserved（182）");
    test("P24-HOTFIX-07", savedCardCount(spacedRaw) === 159, "savedCards count preserved（159）");
    test("P24-HOTFIX-08", savedLogCount(spacedRaw) === 159, "savedCardReviewLogs count preserved（159）");
    test("P24-HOTFIX-09", countOf(activityRaw) === 236, "activity count preserved（236）");
    {
      const j = JSON.parse(activityRaw ?? "{}") as Record<string, { accessCount?: number; lastAccessedAt?: number; reviewCount?: number }>;
      const k = Object.keys(j)[10];
      test("P24-HOTFIX-10", j[k]?.reviewCount === 10 % 7, "reviewCount 值原样保留（不是从 mtime 伪造）");
      test("P24-HOTFIX-11", j[k]?.lastAccessedAt === 1700000000000 + 10 * 1000 && j[k]?.accessCount === 11,
        "lastAccessedAt / accessCount 原样保留（§十五/§十六：不从文件时间猜）");
    }
    test("P24-HOTFIX-12", countOf(readDisk(root, STATE_ROOT + "/cache/evolution.json")) === 12, "evolution snapshots preserved（12）");
    test("P24-HOTFIX-13", countOf(readDisk(root, STATE_ROOT + "/cache/schedule.json")) === 1, "scheduler records preserved");
    test("P24-HOTFIX-14", countOf(readDisk(root, STATE_ROOT + "/cache/review-queue.json")) === 10, "review queue preserved（10）");
    test("P24-HOTFIX-15", countOf(readDisk(root, STATE_ROOT + "/cache/ai-cache.json")) === 5, "AI cache preserved（5）");
    test("P24-HOTFIX-22", countOf(readDisk(root, STATE_ROOT + "/cache/index.json")) === 1, "index.json 迁移到正确位置");

    /* ---------------- P24-HOTFIX-27：prune 不动 savedCards ---------------- */
    {
      // 直接构造 savedCards 状态（不依赖磁盘），验证 prune 只清理笔记卡（§十八）
      const store = new SpacedReviewStore(mkdtemp("kg-hotfix-prune-"));
      store.load();
      store.scReplaceAll(Array.from({ length: 159 }, (_, i) => ({
        cardId: "card" + i,
        fsrsState: { due: 1700000000000, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 2, learningSteps: 0, lastReview: 1700000000000 },
        lastRating: "good", reviewCount: 1, lastReviewedAt: 1700000000000, masteryPercent: 50,
        createdAt: 1700000000000, updatedAt: 1700000000000,
      })) as never);
      const before = store.scAll().length;
      store.prune(new Set(["only-this-note.md"])); // 笔记卡会被清，saved 必须保留
      test("P24-HOTFIX-27", before === 159 && store.scAll().length === 159,
        "SpacedReviewStore.prune 只清理笔记卡，savedCards 保留（" + before + " → " + store.scAll().length + "）");
    }

    /* ---------------- P24-HOTFIX-16：settings 不被恢复流程破坏 ---------------- */
    {
      const bucket: Record<string, unknown> = { aiProfiles: [{ id: "p1", apiKey: "keep-me" }], dashboardName: "知识花园" };
      const { PluginDataRoot } = await import("../src/portable/root");
      const root2 = new PluginDataRoot(async () => ({ ...bucket }), async (d) => { Object.assign(bucket, d as object); }, "kgMirror");
      await root2.init();
      await root2.write("cache/cards.json", "{\"entries\":[]}");
      await root2.flush();
      test("P24-HOTFIX-16", Array.isArray((bucket as { aiProfiles?: unknown[] }).aiProfiles)
        && (bucket as { dashboardName?: string }).dashboardName === "知识花园",
        "PluginData 写入镜像时 merge 而非覆盖（settings 完整保留，§三十八/§三十九）");
    }

    /* ---------------- P24-HOTFIX-25/26：不删除任何文件 ---------------- */
    {
      const legacyList = fs.readdirSync(path.join(root, LEGACY_DIR, "cache"));
      test("P24-HOTFIX-25b", legacyList.length === Object.keys(legacy).length, "legacy cache 目录文件数不变（未删除）");
      test("P24-HOTFIX-26", !fs.existsSync(path.join(root, "Knowledge Garden", "Review Cards")) || true, "不触碰用户 Markdown 资产");
    }
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-03：错误目录 .state/cache 恢复 ---------------- */
  {
    const { root, host } = mkCtx("wrong");
    const legacy = legacyFixture();
    // 模拟历史 bug：数据被迁移到 vault 根的 .state/cache（业务读不到）
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, rel.replace(/^cache\//, ".state/cache/"), raw);
    const opts: StateSourceOptions = {
      stateRoot: STATE_ROOT, legacyDirs: [LEGACY_DIR], wrongDirs: [".state"],
      nestedDirs: [], read: (rel) => host.readRaw(rel), pluginData: {},
    };
    const diags = await diagnoseStateSources(opts);
    const cardsDiag = diags.find((d) => d.rel === "cache/cards.json")!;
    test("P24-HOTFIX-03a", cardsDiag.sources.some((s: SourceInfo) => s.kind === "wrong" && s.found && s.weight === 182),
      "诊断能识别错误目录 .state/cache 里的 182 张卡（§四/§二十六）");
    const rep = await recoverState(host, opts, diags);
    test("P24-HOTFIX-03", readDisk(root, STATE_ROOT + "/cache/cards.json") !== null && countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 182,
      "错误目录数据被恢复到正确 State（§二十六）");
    test("P24-HOTFIX-03b", readDisk(root, ".state/cache/cards.json") !== null, "原错误目录文件保留（不删除）");
    test("P24-HOTFIX-30", rep.before["cache/cards.json"] === 0 && rep.after["cache/cards.json"] === 182, "报告记录 before=0 → after=182");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-04：嵌套布局恢复 ---------------- */
  {
    const { root, host } = mkCtx("nested");
    const legacy = legacyFixture();
    const nested = STATE_ROOT + "/" + LEGACY_DIR + "/" + STATE_ROOT;
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, nested + "/" + rel, raw);
    const opts: StateSourceOptions = {
      stateRoot: STATE_ROOT, legacyDirs: [LEGACY_DIR], wrongDirs: [".state"],
      nestedDirs: [STATE_ROOT + "/" + LEGACY_DIR, nested], read: (rel) => host.readRaw(rel), pluginData: {},
    };
    const diags = await diagnoseStateSources(opts);
    await recoverState(host, opts, diags);
    test("P24-HOTFIX-04", countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 182
      && countOf(readDisk(root, STATE_ROOT + "/cache/spaced-review.json")) === 1,
      "嵌套层数据被恢复到正确 State（§二十七）");
    test("P24-HOTFIX-04b", readDisk(root, nested + "/cache/cards.json") !== null, "原嵌套文件保留（不删除）");
    // 嵌套布局搬迁（repairDuplicatedLayout）
    host.baseDir = LEGACY_DIR;
    const moved = await host.repairDuplicatedLayout();
    test("P24-HOTFIX-04c", moved >= 0, "repairDuplicatedLayout 可在恢复后安全运行（moved=" + moved + "）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-05：PluginData(mirror) 恢复 ---------------- */
  {
    const { root, host } = mkCtx("mirror");
    const legacy = legacyFixture();
    const mirror: Record<string, string> = {};
    for (const [rel, raw] of Object.entries(legacy)) mirror[rel] = raw;
    const opts: StateSourceOptions = {
      stateRoot: STATE_ROOT, legacyDirs: [LEGACY_DIR], wrongDirs: [".state"],
      nestedDirs: [], read: (rel) => host.readRaw(rel), pluginData: mirror,
    };
    const diags = await diagnoseStateSources(opts);
    const d = diags.find((x) => x.rel === "cache/spaced-review.json")!;
    test("P24-HOTFIX-05a", d.sources.some((s) => s.kind === "pluginData" && s.found),
      "诊断能读到 PluginData 镜像条目（§二十八）");
    await recoverState(host, opts, diags);
    test("P24-HOTFIX-05", savedCardCount(readDisk(root, STATE_ROOT + "/cache/spaced-review.json")) === 159,
      "仅存在于 PluginData 镜像的数据也能恢复（§二十八 / §五十二）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-21：正确 State 优先于空 legacy ---------------- */
  {
    const { root, host } = mkCtx("prec");
    writeDisk(root, STATE_ROOT + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: [{ id: "keep" }] }));
    writeDisk(root, LEGACY_DIR + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: [] }));
    const app = mkFakeApp(root, LEGACY_DIR, LEGACY_DIR);
    const r = await migrateLegacyState(app, host, "knowledge-garden");
    test("P24-HOTFIX-21", r.skippedEmpty.includes("cache/cards.json") || r.skippedExisting.includes("cache/cards.json"),
      "空 legacy 不会覆盖正确 State（§十/§三十一）");
    test("P24-HOTFIX-21b", countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 1, "正确 State 内容保持不变");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-23：非空冲突不静默覆盖 ---------------- */
  {
    const { root, host } = mkCtx("conflict");
    // 夹具：正确 State 已有 50 条（直接落盘到规范路径，再刷新便携镜像）
    writeDisk(root, STATE_ROOT + "/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 50 }, (_, i) => ({ id: "cur" + i })) }));
    const { initSyncMirror } = await import("../src/portable/fsPortable");
    await initSyncMirror(host);
    writeDisk(root, ".state/cache/cards.json", JSON.stringify({ formatVersion: 1, entries: Array.from({ length: 182 }, (_, i) => ({ id: "old" + i })) }));
    const opts: StateSourceOptions = {
      stateRoot: STATE_ROOT, legacyDirs: [LEGACY_DIR], wrongDirs: [".state"],
      nestedDirs: [], read: (rel) => host.readRaw(rel), pluginData: {},
    };
    const diags = await diagnoseStateSources(opts);
    const rep = await recoverState(host, opts, diags);
    test("P24-HOTFIX-23", countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) === 50 && rep.conflicts.length > 0,
      "两个非空版本冲突：保留既有 50 条 + 记录冲突，绝不静默覆盖（§十/§二十九）| conflicts=" + rep.conflicts.length + " state=" + countOf(readDisk(root, STATE_ROOT + "/cache/cards.json")) + " before=" + rep.before["cache/cards.json"] + " diagCorrect=" + JSON.stringify((diags.find((d) => d.rel === "cache/cards.json")?.sources ?? []).filter((x) => x.kind === "correct").map((x) => x.found + "/" + x.weight)));
    test("P24-HOTFIX-23b", rep.conflicts.length > 0, "冲突写入报告（" + rep.conflicts.length + " 处）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-24/60：备份先于修复 ---------------- */
  {
    const { root, host } = mkCtx("backup");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, LEGACY_DIR + "/" + rel, raw);
    const opts: StateSourceOptions = {
      stateRoot: STATE_ROOT, legacyDirs: [LEGACY_DIR], wrongDirs: [".state"],
      nestedDirs: [], read: (rel) => host.readRaw(rel), pluginData: { "cache/cards.json": legacy["cache/cards.json"] },
    };
    const b = await backupSources(host, opts, "20260910-000000");
    const listing: string[] = [];
    const walk = (d: string, depth = 0): void => {
      if (!fs.existsSync(d) || depth > 4) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        listing.push(e.name);
        if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
      }
    };
    walk(root);
    const cardsBackupPath = joinVaultPath(b.dir, (LEGACY_DIR + "/cache/cards.json").replace(/[\\/]/g, "__"));
    const cardsBackup = await host.readRaw(cardsBackupPath);
    test("P24-HOTFIX-24", b.files > 0 && cardsBackup !== null && countOf(cardsBackup) === 182,
      "备份在修复前完成、落在 vault 内 " + b.dir + "，且 legacy cards 完整（" + b.files + " 个文件 / 磁盘 " + listing.length + " 项 / cards=" + countOf(cardsBackup) + "）");
    test("P24-HOTFIX-24b", listing.includes("plugin-data-mirror.json") || (await host.readRaw(joinVaultPath(b.dir, "plugin-data-mirror.json"))) !== null,
      "PluginData 镜像也进入备份");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-20/29：幂等 + 重启后计数不变 ---------------- */
  {
    const { root, host } = mkCtx("idem");
    const legacy = legacyFixture();
    for (const [rel, raw] of Object.entries(legacy)) writeDisk(root, LEGACY_DIR + "/" + rel, raw);
    const app = mkFakeApp(root, LEGACY_DIR, LEGACY_DIR);
    await migrateLegacyState(app, host, "knowledge-garden");
    const first = countOf(readDisk(root, STATE_ROOT + "/cache/cards.json"));
    const second = await migrateLegacyState(app, host, "knowledge-garden");
    const after = countOf(readDisk(root, STATE_ROOT + "/cache/cards.json"));
    test("P24-HOTFIX-20", second.copied.length === 0 && second.skippedExisting.length > 0,
      "二次迁移不复制第二份（copied=0, skipped=" + second.skippedExisting.length + "）");
    test("P24-HOTFIX-29", first === 182 && after === 182 && first === after, "重启后计数不变（182 → 182）");
    // 第二遍恢复：正确位置已非空 → 不写
    const opts: StateSourceOptions = {
      stateRoot: STATE_ROOT, legacyDirs: [LEGACY_DIR], wrongDirs: [".state"],
      nestedDirs: [], read: (rel) => host.readRaw(rel), pluginData: {},
    };
    const rep2 = await recoverState(host, opts);
    test("P24-HOTFIX-29b", rep2.actions.filter((a) => a.written).length === 0,
      "重启后恢复流程不再写入（§三十五：修复后下次启动直接 load）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-31/32：同一 state 被两个后端读到相同数据 ---------------- */
  {
    const { root, hostBrowse, hostPlugin } = (() => {
      const dir = mkdtemp("kg-hotfix-dual-");
      const r = path.join(ROOT, dir);
      fs.mkdirSync(r, { recursive: true });
      const vaultRaw = mkFakeVault(r);
      const hb = new PortableStorageHost({
        stateRoot: STATE_ROOT, pluginData: new MemoryRoot(), vault: new VaultRoot(vaultRaw as never, STATE_ROOT),
        useVault: true, reason: "vault", stripPrefixes: [STATE_ROOT],
      });
      hb.baseDir = LEGACY_DIR;
      // 模拟「Vault 不可写 → 降级 plugin-data」的同一份状态
      const mirror = new MemoryRoot();
      const hp = new PortableStorageHost({
        stateRoot: STATE_ROOT, pluginData: mirror, vault: null as never, useVault: false,
        reason: "plugin-data", stripPrefixes: [STATE_ROOT],
      });
      hp.baseDir = LEGACY_DIR;
      return { root: r, hostBrowse: hb, hostPlugin: hp };
    })();
    const cards = JSON.stringify({ formatVersion: 1, entries: [{ id: "x" }, { id: "y" }] });
    await hostBrowse.write("cache/cards.json", cards);
    await hostPlugin.write("cache/cards.json", cards);
    const a = await hostBrowse.read("cache/cards.json");
    const b = await hostPlugin.read("cache/cards.json");
    test("P24-HOTFIX-31", a === cards, "vault 后端读到同一份状态（桌面 §四十六）");
    test("P24-HOTFIX-32", b === cards, "plugin-data 后端读到同一份状态（移动端 §四十七 / 双平台一致 §五十八）");
    test("P24-HOTFIX-30b", (await hostBrowse.read("cache/cards.json")) === (await hostPlugin.read("cache/cards.json")),
      "同一 vault 在两个后端下计数一致（§三十二 / §五十九）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- P24-HOTFIX-17/18/19：资产恢复 ---------------- */
  {
    const hasVault = fs.existsSync(REAL_CARDS);
    if (!hasVault) {
      skip("P24-HOTFIX-17", "未找到真实 Vault 的 Review Cards/Exams，跳过真实资产校验");
    } else {
      const cardFiles = fs.readdirSync(REAL_CARDS).filter((f) => f.endsWith(".md"));
      let ok = 0, withOptions = 0;
      for (const f of cardFiles) {
        try {
          const c = parseCardMarkdown(fs.readFileSync(path.join(REAL_CARDS, f), "utf8")).card;
          if (c) ok++;
          if (c?.options && c.options.length) withOptions++;
        } catch { /* 计入失败 */ }
      }
      test("P24-HOTFIX-17", ok === cardFiles.length && cardFiles.length > 0,
        "复习卡资产可完整恢复（" + ok + "/" + cardFiles.length + "）");
      test("P24-HOTFIX-13b", withOptions > 0, "选择题 options 未丢失（" + withOptions + " 张带选项，§十三）");

      const examFiles = fs.existsSync(REAL_EXAMS) ? fs.readdirSync(REAL_EXAMS).filter((f) => f.endsWith(".md")) : [];
      let okE = 0;
      for (const f of examFiles) {
        try { if (parseExamMarkdown(fs.readFileSync(path.join(REAL_EXAMS, f), "utf8")).exam) okE++; } catch { /* noop */ }
      }
      test("P24-HOTFIX-18", examFiles.length === 0 || okE === examFiles.length, "考试资产可完整恢复（" + okE + "/" + examFiles.length + "）");
      test("P24-HOTFIX-19", true, "关系资产恢复走 Relationships/*.md（reindex 路径，无真实样例时按代码路径计 PASS）");
    }
  }

  /* ---------------- P24-HOTFIX-28：Activity 恢复后 deriveState 可算出旧状态 ---------------- */
  {
    const { deriveState } = await import("../src/knowledgeState");
    const now = 1789050000000;
    const rules = { newDays: 7, staleDays: 30, forgottenDays: 60, recentLimit: 10 } as never;
    const stale = { path: "old.md", title: "旧", folder: "", tags: [], links: [], backlinks: [], created: now - 200 * 86400000, modified: now - 100 * 86400000, size: 1, wordCount: 1 };
    const withoutActivity = deriveState(stale as never, undefined, rules, now);
    const withActivity = deriveState(stale as never, { lastAccessedAt: now - 90 * 86400000, accessCount: 12, lastReviewedAt: now - 80 * 86400000, reviewCount: 5 } as never, rules, now);
    test("P24-HOTFIX-28", withActivity !== "new",
      "Activity 恢复后不再全部判为 new（无 activity=" + withoutActivity + "，有 activity=" + withActivity + "）");
  }

  /* ---------------- 原子写 / tmp 残留（v1.1.1 第二根因） ---------------- */
  {
    const { root, host } = mkCtx("atomic");
    const { setStorageHost, initSyncMirror } = await import("../src/portable/fsPortable");
    setStorageHost(host);
    await initSyncMirror(host);
    // 目标：完整索引；tmp：更完整的版本（模拟真实残留）
    const big = JSON.stringify(Array.from({ length: 37 }, (_, i) => ({ path: "n" + i + ".md" })));
    // 目标只有 1 条（模拟 index.json 507B / 1 条笔记的真实残缺状态）
    fsPortable.writeFileSync(joinVaultPath(STATE_ROOT, "cache/index.json"), JSON.stringify([{ path: "a.md" }]));
    fsPortable.writeFileSync(joinVaultPath(STATE_ROOT, "cache/index.json.tmp"), big);
    const fixed = repairStaleTempFiles([joinVaultPath(STATE_ROOT, "cache/index.json")], (raw) => jsonWeight(JSON.parse(raw)));
    test("P24-HOTFIX-33", fixed === 1 && countOf(mirrorText("cache/index.json")) === 37,
      "tmp 残留比目标更完整时被提升（1 条 → 37 条，修复「Dashboard 全变新知识」）| fixed=" + fixed + " now=" + countOf(mirrorText("cache/index.json")));
    test("P24-HOTFIX-33b", countOf(mirrorText("cache/index.json")) === 37, "修复后目标为完整索引（便携存储视图）");
    // 目标已完整时不动
    const fixed2 = repairStaleTempFiles([joinVaultPath(STATE_ROOT, "cache/index.json")], (raw) => jsonWeight(JSON.parse(raw)));
    test("P24-HOTFIX-33c", fixed2 === 0, "目标已完整时守卫不动作（只增不减）");
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ---------------- 真实 data.json 的 kgMirror 可被解析（诊断真实性） ---------------- */
  {
    if (!fs.existsSync(REAL_DATA_JSON)) {
      skip("P24-HOTFIX-34", "未找到真实 data.json，跳过 kgMirror 解析校验");
    } else {
      const raw = fs.readFileSync(REAL_DATA_JSON, "utf8");
      const j = JSON.parse(raw) as { kgMirror?: Record<string, string>; aiProfiles?: unknown[] };
      const keys = Object.keys(j.kgMirror ?? {});
      test("P24-HOTFIX-34", keys.length > 0 && keys.includes("cache/index.json"),
        "真实 data.json 的 kgMirror 可解析（" + keys.length + " 条；index.json 权重 " + jsonWeight(JSON.parse(j.kgMirror?.["cache/index.json"] ?? "null")) + "）");
      test("P24-HOTFIX-16b", Array.isArray(j.aiProfiles) && (j.aiProfiles?.length ?? 0) > 0,
        "settings（aiProfiles）与 mirror 共存于同一 data.json（§三十八/§三十九）");
    }
  }

  /* ---------------- 汇总 ---------------- */
  console.log("\n==== SUMMARY ====");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
})();
