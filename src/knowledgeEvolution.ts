/** Phase 7：知识状态机与长期演化 —— 本地确定性统计（§二：AI 绝不负责全部判断）。
 *  纯函数为主、无 Obsidian 依赖（便于 Node 单元验证）。
 *  职责：weekly snapshot / area trend / long-term state / bridge / cross-area / question tracking / AI 摘要。
 *  不做：年度地图、热力图、向量相似度、语义聚类、自动评分、兴趣预测（§五十六，留待 Phase 8+）。
 */
import type {
  ActivityEntry,
  AreaEvolutionStat,
  ConceptStat,
  CrossAreaLinkStat,
  KnowledgeArea,
  KnowledgeEvolutionSnapshot,
  KnowledgeRelationship,
  LongTermKnowledgeState,
  PersistentQuestion,
} from "./types";
import type { NoteMetadata } from "./noteIndex";
import { deriveState, stateCounts, type KGRules } from "./knowledgeState";
import { sha256 } from "./ai/cache";

/** 区域前缀匹配：与 noteIndex.notesInArea 同一逻辑（folder 顶层前缀或该文件本身） */
function normalizeFolder(f: string): string {
  return f.replace(/\\/g, "/").replace(/\/+$/, "").trim();
}
export function noteInArea(note: NoteMetadata, area: KnowledgeArea): boolean {
  const prefix = normalizeFolder(area.folder);
  if (!prefix) return false;
  return note.path === prefix + ".md" || note.path.startsWith(prefix + "/");
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
export function isoDate(d: Date): string {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
/** 周快照周期键：snapshot:weekly:YYYY-MM-DD（周一，§九示例）；幂等 upsert 用此键 */
export function weeklySnapshotKey(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return "snapshot:weekly:" + isoDate(d);
}
/** 月度周期标签："2026-08"（与 periodKeyFor("monthly") 的 YYYY-MM 对齐） */
export function monthlyPeriodLabel(now = new Date()): string {
  return now.getFullYear() + "-" + pad2(now.getMonth() + 1);
}
/** 季度周期标签："2026-Q3" */
export function quarterlyPeriodLabel(now = new Date()): string {
  return now.getFullYear() + "-Q" + (Math.floor(now.getMonth() / 3) + 1);
}

/** topConcepts：高频 tags + wikilink 目标（概念信号，轻量） */
export function topConcepts(notes: NoteMetadata[], limit = 8): ConceptStat[] {
  const counts = new Map<string, number>();
  for (const n of notes) {
    for (const t of n.tags || []) {
      const key = t.trim().replace(/^#/, "");
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const l of n.links || []) {
      const base = l.replace(/^.*\//, "").replace(/[?#].*$/, "").trim();
      if (!base || base === n.title) continue;
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/** 单区域统计（§十二）：区域内笔记按短期状态聚合 + 行为/连接指标；纯本地计算 */
export function areaEvolutionStat(
  area: KnowledgeArea,
  notes: NoteMetadata[],
  getAct: (p: string) => ActivityEntry | undefined,
  rules: KGRules,
  now = Date.now()
): AreaEvolutionStat {
  const inArea = notes.filter((n) => noteInArea(n, area));
  let newCount = 0, activeCount = 0, growingCount = 0, staleCount = 0, forgottenCount = 0;
  let recentActivity = 0, recentReviewCount = 0, linkCount = 0;
  const since30 = now - 30 * 86400000;
  for (const n of inArea) {
    const st = deriveState(n, getAct(n.path), rules, now);
    if (st === "new") newCount++;
    else if (st === "growing") growingCount++;
    else if (st === "active") activeCount++;
    else if (st === "stale") staleCount++;
    else forgottenCount++;
    const la = getAct(n.path)?.lastAccessedAt ?? 0;
    if (la > recentActivity) recentActivity = la;
    if ((getAct(n.path)?.lastReviewedAt ?? 0) >= since30) recentReviewCount++;
    linkCount += (n.links?.length ?? 0) + (n.backlinks?.length ?? 0);
  }
  return {
    area: area.name,
    folder: area.folder,
    noteCount: inArea.length,
    newCount, activeCount, growingCount, staleCount, forgottenCount,
    recentActivity, recentReviewCount, linkCount,
    crossAreaCount: 0,
  };
}

/** growthScore（§十四）：新笔记 + 增长 + 活跃 + 复习 + 连接 + 跨区域；只用于排序/趋势，不展示成精确分数 */
export function growthScore(a: AreaEvolutionStat, now = Date.now()): number {
  const activeBoost = a.recentActivity ? Math.max(0, 14 - (now - a.recentActivity) / 86400000) : 0;
  return (
    a.newCount * 3 +
    a.growingCount * 2.5 +
    a.activeCount * 1.2 +
    Math.min(a.recentReviewCount, 8) * 1.5 +
    Math.min((a.linkCount ?? 0) / 20, 4) * 0.8 +
    Math.min(a.crossAreaCount ?? 0, 6) * 1.0 +
    (a.growthDelta !== undefined && a.growthDelta > 0 ? Math.min(a.growthDelta * 5, 2.5) : 0) +
    activeBoost
  );
}

function stripMd(p: string): string { return p.replace(/\.md$/i, ""); }
function areaOfPath(p: string, areas: KnowledgeArea[]): string | null {
  for (const a of areas) {
    const prefix = normalizeFolder(a.folder);
    if (prefix && (p === prefix + ".md" || p.startsWith(prefix + "/"))) return a.name;
  }
  return null;
}

/** 跨区域连接（§21/22）：只有真实 AI edges 或真实 WikiLinks 才计入；禁止因“笔记多”臆造连接（Test 8） */
export function crossAreaStats(
  notes: NoteMetadata[],
  areas: KnowledgeArea[],
  aiEdges: { from: string; to: string }[]
): CrossAreaLinkStat[] {
  const byBare = new Map<string, NoteMetadata>();
  const byTitle = new Map<string, NoteMetadata[]>();
  for (const n of notes) {
    if (!byBare.has(stripMd(n.path))) byBare.set(stripMd(n.path), n);
    const arr = byTitle.get(n.title);
    if (arr) arr.push(n); else byTitle.set(n.title, [n]);
  }
  const resolve = (t: string): NoteMetadata | undefined => {
    const bare = t.replace(/[?#].*$/, "").replace(/\.md$/i, "");
    const hit = byBare.get(bare) || byBare.get(bare.replace(/^.*\//, ""));
    if (hit) return hit;
    const byTitleHit = byTitle.get(bare);
    return byTitleHit && byTitleHit.length > 0 ? byTitleHit[0] : undefined;
  };

  const pairKey = (a: string, b: string) => (a < b ? a + "\u0000" + b : b + "\u0000" + a);
  const pairs = new Map<string, { a: string; b: string; count: number; wikilink: boolean; ai: boolean; samples: string[] }>();
  const bump = (a: string, b: string, kind: "wikilink" | "ai", sample: string) => {
    const x = a < b ? a : b;
    const y = a < b ? b : a;
    if (x === y) return;
    const key = pairKey(x, y);
    let rec = pairs.get(key);
    if (!rec) { rec = { a: x, b: y, count: 0, wikilink: false, ai: false, samples: [] }; pairs.set(key, rec); }
    rec.count++;
    if (kind === "wikilink") rec.wikilink = true; else rec.ai = true;
    if (rec.samples.length < 3 && !rec.samples.includes(sample)) rec.samples.push(sample);
  };

  // wikilink 证据：笔记链接目标属于另一区域
  for (const n of notes) {
    const a = areaOfPath(n.path, areas);
    if (!a) continue;
    for (const t of n.links || []) {
      const tn = resolve(t);
      if (!tn || tn.path === n.path) continue;
      const b = areaOfPath(tn.path, areas);
      if (b && b !== a) bump(a, b, "wikilink", n.path + "↔" + tn.path);
    }
    for (const t of n.backlinks || []) {
      const tn = resolve(t);
      if (!tn || tn.path === n.path) continue;
      const b = areaOfPath(tn.path, areas);
      if (b && b !== a) bump(a, b, "wikilink", tn.path + "↔" + n.path);
    }
  }
  // AI edge 证据：nodes/edges 的 from/to 属于不同区域
  for (const e of aiEdges) {
    const a = areaOfPath(e.from, areas);
    const b = areaOfPath(e.to, areas);
    if (a && b && a !== b) bump(a, b, "ai", e.from + "↔" + e.to);
  }

  return [...pairs.values()]
    .filter((r) => r.count >= 1)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      a: r.a,
      b: r.b,
      count: r.count,
      evidence: r.wikilink && r.ai ? ("both" as const) : r.wikilink ? ("wikilink" as const) : ("ai_edge" as const),
      samplePaths: r.samples,
    }));
}

/** 桥梁笔记（§23/24）：一篇笔记的链接 + AI edge 覆盖多个知识区域 */
export interface BridgeNote {
  path: string;
  title: string;
  areas: string[];
  score: number;
  linkCount: number;
  aiEdgeCount: number;
}
export function findBridgeNotes(
  notes: NoteMetadata[],
  areas: KnowledgeArea[],
  aiEdges: { from: string; to: string }[]
): BridgeNote[] {
  const byBare = new Map<string, NoteMetadata>();
  const byTitle = new Map<string, NoteMetadata[]>();
  for (const n of notes) {
    if (!byBare.has(stripMd(n.path))) byBare.set(stripMd(n.path), n);
    const arr = byTitle.get(n.title);
    if (arr) arr.push(n); else byTitle.set(n.title, [n]);
  }
  const resolve = (t: string): NoteMetadata | undefined => {
    const bare = t.replace(/[?#].*$/, "").replace(/\.md$/i, "");
    const hit = byBare.get(bare) || byBare.get(bare.replace(/^.*\//, ""));
    if (hit) return hit;
    const byTitleHit = byTitle.get(bare);
    return byTitleHit && byTitleHit.length > 0 ? byTitleHit[0] : undefined;
  };
  const aiAreas = new Map<string, Set<string>>();
  for (const e of aiEdges) {
    const aA = areaOfPath(e.from, areas);
    const aB = areaOfPath(e.to, areas);
    if (aA) {
      const s = aiAreas.get(e.from) ?? new Set<string>();
      if (aB) s.add(aB);
      aiAreas.set(e.from, s);
    }
    if (aB) {
      const s = aiAreas.get(e.to) ?? new Set<string>();
      if (aA) s.add(aA);
      aiAreas.set(e.to, s);
    }
  }
  const out: BridgeNote[] = [];
  for (const n of notes) {
    const regions = new Set<string>();
    for (const t of [...(n.links || []), ...(n.backlinks || [])]) {
      const tn = resolve(t);
      if (!tn || tn.path === n.path) continue;
      const r = areaOfPath(tn.path, areas);
      if (r) regions.add(r);
    }
    for (const r of aiAreas.get(n.path) ?? []) regions.add(r);
    const diversity = regions.size;
    if (diversity < 2) continue;
    const linkCount = (n.links?.length ?? 0) + (n.backlinks?.length ?? 0);
    const aiCnt = aiAreas.get(n.path)?.size ?? 0;
    out.push({
      path: n.path,
      title: n.title,
      areas: [...regions],
      score: diversity * 2 + Math.min(linkCount, 10) * 0.5 + Math.min(aiCnt, 10) * 0.6,
      linkCount,
      aiEdgeCount: aiCnt,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 长期状态判定（§十六/十九/二十）：跨快照窗口分类；core = 持续活跃 + 连接高 + 跨区域多 */
export function classifyLongTerm(
  snaps: KnowledgeEvolutionSnapshot[],
  areaName: string,
  now = Date.now()
): LongTermKnowledgeState {
  const stats = snaps
    .map((sn) => sn.areaStats.find((s) => s.area === areaName))
    .filter((s): s is AreaEvolutionStat => !!s);
  if (stats.length === 0) return "dormant";
  const window = stats.slice(-12);
  const n = window.length;
  const activeOf = (s: AreaEvolutionStat) => s.activeCount + s.growingCount;
  const isActive = (s: AreaEvolutionStat) =>
    activeOf(s) >= 1 || (s.recentActivity > 0 && now - s.recentActivity <= 14 * 86400000);
  const recent = window.slice(Math.max(0, n - 3));
  const past = window.slice(0, Math.max(0, n - 3));
  const recentActive = recent.filter(isActive).length;
  const pastActive = past.filter(isActive).length;
  const anyRecentActive = recentActive > 0;
  const anyPastActive = pastActive > 0;

  // dormant：窗口内无任何活跃
  if (!anyRecentActive && !anyPastActive) return "dormant";
  // fading：过去活跃但最近 2+ 快照持续不活跃（§57 Test 4：fading 而不是 forgotten）
  if (anyPastActive && !anyRecentActive) return "fading";
  // emerging：过去不活跃 → 最近开始活跃（短期快速增加）
  if (!anyPastActive && anyRecentActive) return "emerging";
  if (recent.length >= 2 && recentActive > 0) {
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];
    const lastActivity = Math.max(last.activeCount, last.growingCount);
    const prevActivity = Math.max(prev.activeCount, prev.growingCount);
    if (lastActivity < prevActivity && recentActive < pastActive) return "fading";
  }
  // core：窗口内高活跃占比 + 高连接 + 跨区域（§二十：核心知识候选）
  const activeRatio = window.filter(isActive).length / n;
  const totalLink = window.reduce((sum, s) => sum + (s.linkCount ?? 0), 0);
  const totalCross = window.reduce((sum, s) => sum + (s.crossAreaCount ?? 0), 0);
  const highConnect = totalLink >= 4 && totalCross >= 2;
  if (activeRatio >= 0.6 && highConnect) return "core";
  // sustained：连续多个快照活跃
  if (activeRatio >= 0.5) return "sustained";
  return anyRecentActive ? "emerging" : "fading";
}

/** 长期状态中文标签（Dashboard/报告文案，§十六） */
export function longTermLabel(st: LongTermKnowledgeState): string {
  return { emerging: "正在形成", sustained: "持续主题", fading: "逐渐消退", dormant: "休眠", core: "核心知识候选" }[st];
}

/** 问题规范化（§26）：小写 + 去标点 + 压缩空白；指纹 = sha256(规范化文本) */
export function normalizeQuestion(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[，。；：、？！.,;:?!()（）[\]【】"'“”‘’\-—\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function questionFingerprint(text: string): string {
  const norm = normalizeQuestion(text);
  return norm ? sha256(norm) : "";
}

/** 合并跨周期问题（§25/27）：同一指纹归并；occurrences = 出现过的周期数 */
export function mergeQuestions(
  existing: PersistentQuestion[],
  incoming: { periodLabel: string; question: string }[]
): PersistentQuestion[] {
  const map = new Map<string, PersistentQuestion>();
  for (const q of existing) map.set(q.fingerprint, { ...q, periods: [...q.periods] });
  for (const item of incoming) {
    const fp = questionFingerprint(item.question);
    if (!fp) continue;
    const norm = normalizeQuestion(item.question);
    const cur = map.get(fp);
    if (!cur) {
      map.set(fp, {
        fingerprint: fp,
        text: norm,
        firstSeen: item.periodLabel,
        lastSeen: item.periodLabel,
        occurrences: 1,
        periods: [item.periodLabel],
      });
    } else {
      cur.lastSeen = item.periodLabel;
      if (!cur.periods.includes(item.periodLabel)) cur.periods.push(item.periodLabel);
      cur.occurrences = cur.periods.length;
    }
  }
  return [...map.values()].sort((a, b) => b.occurrences - a.occurrences || b.lastSeen.localeCompare(a.lastSeen));
}

/** 每周快照（§四/五/六/十二/十四）：轻量聚合指标；prev 用于计算 growthDelta/activityDelta */
export function computeSnapshot(opts: {
  notes: NoteMetadata[];
  areas: KnowledgeArea[];
  getAct: (p: string) => ActivityEntry | undefined;
  rules: KGRules;
  aiEdges: { from: string; to: string }[];
  questions: string[];
  periodLabel: string;
  prev?: KnowledgeEvolutionSnapshot | null;
  confirmedRelationships?: KnowledgeRelationship[];  // Phase 10 §三十二：user_confirmed 关系（0 AI）
  now?: number;
}): KnowledgeEvolutionSnapshot {
  const now = opts.now ?? Date.now();
  const all = opts.notes;
  const counts = stateCounts(all, opts.getAct, opts.rules, now);
  const links = crossAreaStats(all, opts.areas, opts.aiEdges);
  const crossPerArea = new Map<string, number>();
  for (const l of links) {
    crossPerArea.set(l.a, (crossPerArea.get(l.a) ?? 0) + 1);
    crossPerArea.set(l.b, (crossPerArea.get(l.b) ?? 0) + 1);
  }
  const areaStats = opts.areas
    .map((a) => {
      const s = areaEvolutionStat(a, all, opts.getAct, opts.rules, now);
      s.crossAreaCount = crossPerArea.get(a.name) ?? 0;
      return s;
    })
    .filter((s) => s.noteCount > 0);
  if (opts.prev) {
    for (const s of areaStats) {
      const ps = opts.prev.areaStats.find((x) => x.area === s.area);
      if (ps) {
        if (ps.noteCount > 0) s.growthDelta = (s.noteCount - ps.noteCount) / ps.noteCount;
        s.activityDelta = (s.recentActivity - ps.recentActivity) / 86400000;
      }
    }
  }
  const questions: PersistentQuestion[] = [];
  for (const q of opts.questions) {
    const fp = questionFingerprint(q);
    if (!fp) continue;
    questions.push({
      fingerprint: fp,
      text: normalizeQuestion(q),
      firstSeen: opts.periodLabel,
      lastSeen: opts.periodLabel,
      occurrences: 1,
      periods: [opts.periodLabel],
    });
  }
  // Phase 10 §三十二：已确认关系统计（只计 user_confirmed，对比 prev 得 growth，0 AI）
  const confirmedRelationships = opts.confirmedRelationships ?? [];
  const confirmedRelationshipCount = confirmedRelationships.length;
  const prevConfirmed = opts.prev?.confirmedRelationshipCount;
  const relationshipGrowth = prevConfirmed && prevConfirmed > 0 ? (confirmedRelationshipCount - prevConfirmed) / prevConfirmed : undefined;
  return {
    date: isoDate(new Date(now)),
    periodKey: weeklySnapshotKey(new Date(now)),
    totalNotes: all.length,
    totalAreas: areaStats.length,
    activeNotes: counts.active + counts.growing,
    growingNotes: counts.growing,
    staleNotes: counts.stale,
    forgottenNotes: counts.forgotten,
    newNotes: counts.new,
    topConcepts: topConcepts(all, 8),
    areaStats,
    crossAreaLinks: links.slice(0, 6),
    unresolvedQuestions: questions,
    confirmedRelationshipCount,
    relationshipGrowth,
  };
}

function pct(delta: number): string {
  const v = Math.round(delta * 100);
  return v > 0 ? "+" + v + "%" : v + "%";
}
/** 最近几周的增长趋势（§五十五）：↑ / → / ↓（仅趋势符号，不展示 0~100 分数） */
export function trendArrow(cur: AreaEvolutionStat | undefined, prev: AreaEvolutionStat | undefined): "↑" | "→" | "↓" {
  if (!cur || !prev) return "→";
  const c = Math.max(cur.activeCount, cur.growingCount) + cur.newCount + Math.min((cur.linkCount ?? 0) / 20, 2);
  const p = Math.max(prev.activeCount, prev.growingCount) + prev.newCount + Math.min((prev.linkCount ?? 0) / 20, 2);
  if (c > p * 1.1) return "↑";
  if (c < p * 0.9) return "↓";
  return "→";
}

/** AI 输入摘要（§二十八/三十三）：只传聚合指标 + top areas/bridges/questions/connections，绝不传全部快照 */
export function buildEvolutionSummary(
  snaps: KnowledgeEvolutionSnapshot[],
  bridges: BridgeNote[],
  questions: PersistentQuestion[],
  now = Date.now()
): string {
  if (snaps.length === 0) return "还没有可用的本地快照。";
  const latest = snaps[snaps.length - 1];
  const lines: string[] = [];
  lines.push("最近 " + snaps.length + " 周（每周一份本地确定性快照，聚合指标）：");
  lines.push("总笔记数：" + latest.totalNotes + "（" + snaps.length + " 周前：" + snaps[0].totalNotes + "）");
  lines.push("当前短期状态：新 " + latest.newNotes + " · 增长 " + latest.growingNotes + " · 活跃 " + latest.activeNotes + " · 可能遗忘 " + latest.forgottenNotes);
  const sorted = [...latest.areaStats].sort((a, b) => growthScore(b, now) - growthScore(a, now));
  lines.push("区域活跃度（按本地 growth 排序）：");
  for (const s of sorted.slice(0, 8)) {
    const d = s.growthDelta !== undefined ? "（" + pct(s.growthDelta) + "）" : "";
    lines.push("- " + s.area + "：" + s.noteCount + " 篇笔记，近 30 天复习 " + s.recentReviewCount + " 次，跨区域连接 " + s.crossAreaCount + "，" + d);
  }
  if (bridges.length > 0) {
    lines.push("桥梁笔记（连接多个知识区域）：");
    for (const b of bridges.slice(0, 4)) {
      lines.push("- 《" + b.title + "》连接：" + b.areas.join(" / "));
    }
  }
  if (latest.crossAreaLinks.length > 0) {
    lines.push("跨区域连接（真实 wiki 链接或 AI edge）：");
    for (const l of latest.crossAreaLinks.slice(0, 5)) {
      lines.push("- " + l.a + " ↔ " + l.b + "（" + l.count + " 条证据，" + l.evidence + "）");
    }
  }
  if (questions.length > 0) {
    lines.push("反复出现的问题（同一个问题在多个复盘周期中出现）：");
    for (const q of questions.slice(0, 5)) lines.push("- " + q.text + "（出现 " + q.periods.length + " 个周期：" + q.periods.join(" / ") + "）");
  }
  return lines.join("\n");
}