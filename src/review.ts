import { App, normalizePath, Notice, TFile } from "obsidian";
import type { AICacheType, Period, PluginSettings, ReviewRecord } from "./types";
import { NoteIndex, type NoteMetadata } from "./noteIndex";
import { ActivityStore } from "./activity";
import { AIService, type AICallOpts } from "./ai/service";
import { areaSig, candidateSig, periodKeyFor } from "./ai/cache";
import { deriveState, forgottenCandidates, rankCandidates } from "./knowledgeState";

const REVIEW_ROOT = "Knowledge Garden/Reviews";

function pad(n: number): string { return String(n).padStart(2, "0"); }
function fmtDate(d: Date): string { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function fmtCn(d: Date): string { return (d.getMonth() + 1) + "月" + d.getDate() + "日"; }
function weekStart(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function dateLabelFor(period: Period, now = new Date()): string {
  if (period === "daily") return fmtDate(now);
  if (period === "weekly") return fmtCn(weekStart(now)) + "–" + fmtCn(now);
  if (period === "monthly") return now.getFullYear() + "年" + (now.getMonth() + 1) + "月";
  if (period === "quarterly") return now.getFullYear() + "年第" + (Math.floor(now.getMonth() / 3) + 1) + "季度";
  return fmtCn(now);
}
function periodCnFor(period: Period): string {
  return { daily: "日", weekly: "周", monthly: "月", quarterly: "季", custom: "自定义" }[period];
}
/** 每周期候选上限（Scheduler 缓存预检必须与生成时一致，否则缓存 key 不同步） */
export function reviewLimit(period: Period): number {
  return period === "daily" ? 12 : 24;
}
function relTime(t: number | undefined, now: number): string {
  if (!t) return "从未";
  const mins = Math.floor((now - t) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return mins + " 分钟前";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + " 小时前";
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 7) return days + " 天前";
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks + " 周前";
  return Math.floor(days / 30) + " 个月前";
}

export interface AIPrep {
  candidateLines: string[];
  candidatePaths: string[];
  areaLines: string[];
  dateLabel: string;
  candidateSig: string;
  areaSig: string;
  periodKey: string;
}

export class ReviewManager {
  /** §28：按 periodKey 的执行锁（Scheduler / Dashboard / 命令面板并发触发只产生一次真实执行） */
  private executing = new Map<string, Promise<{ path: string; offline: boolean; fromCache: boolean } | null>>();

  constructor(
    private app: App,
    private getSettings: () => PluginSettings,
    private index: NoteIndex,
    private ai: AIService,
    private activity: ActivityStore,
    private onDataChange: () => void
  ) {}

  private rules() {
    return this.getSettings().activity;
  }

  private getAct = (p: string) => this.activity.get(p);

  areaLines(): string[] {
    return this.getSettings().knowledgeAreas
      .filter((a) => a.participateInAI)
      .map((a) => a.icon + " " + a.name + "（文件夹：" + a.folder + "）");
  }

  private pickCandidates(period: Period): NoteMetadata[] {
    const minDays = period === "weekly" || period === "monthly" || period === "quarterly" ? 90 : 7;
    const base = this.index.candidates({ limit: 64, minDays });
    return rankCandidates(base, this.getAct, this.rules());
  }

  /** §25/42：Scheduler 触发前只算缓存指纹元数据（不读笔记内容、不扫描 Vault） */
  prepareCacheMeta(period: Period, periodKeyOverride?: string): { periodKey: string; candidateSig: string; areaSig: string } {
    const candidates = this.pickCandidates(period).slice(0, reviewLimit(period));
    const areaLines = this.areaLines();
    return {
      periodKey: periodKeyOverride ?? periodKeyFor(period),
      candidateSig: candidateSig(candidates.map((n) => ({ path: n.path, modified: n.modified, size: n.size }))),
      areaSig: areaSig(areaLines),
    };
  }

  async prepareAI(limit: number, period: Period, periodKeyOverride?: string): Promise<AIPrep> {
    // §十五：候选排序并入 最近访问/最近复习/连接度/遗忘度/跨区域潜力；排序不进入指纹（§25）
    const candidates = this.pickCandidates(period).slice(0, limit);
    const lines = await this.index.candidatePayload(candidates, limit <= 12 ? 900 : 700);
    const areaLines = this.areaLines();
    return {
      candidateLines: lines,
      candidatePaths: candidates.map((c) => c.path),
      areaLines,
      dateLabel: dateLabelFor(period),
      candidateSig: candidateSig(candidates.map((n) => ({ path: n.path, modified: n.modified, size: n.size }))),
      areaSig: areaSig(areaLines),
      periodKey: periodKeyOverride ?? periodKeyFor(period),
    };
  }

  toCallOpts(prep: AIPrep): AICallOpts {
    return {
      candidateLines: prep.candidateLines,
      candidatePaths: prep.candidatePaths,
      areaLines: prep.areaLines,
      dateLabel: prep.dateLabel,
      candidateSig: prep.candidateSig,
      areaSig: prep.areaSig,
      periodKey: prep.periodKey,
    };
  }

  /** 生成日/周/月/季/自定义复盘；同周期默认复用缓存；force 强制；AI 失败本地降级（§28/29 每周增补 structured 输入） */
  async generateReview(period: Period, force = false, periodKeyOverride?: string): Promise<{ path: string; offline: boolean; fromCache: boolean } | null> {
    const lockKey = (periodKeyOverride ?? periodKeyFor(period)) + (force ? ":force" : "");
    const pending = this.executing.get(lockKey);
    if (pending) return pending;
    const p = this.generateReviewInner(period, force, periodKeyOverride);
    this.executing.set(lockKey, p);
    void p.then(() => this.executing.delete(lockKey), () => this.executing.delete(lockKey));
    return p;
  }

  private async generateReviewInner(period: Period, force: boolean, periodKeyOverride?: string): Promise<{ path: string; offline: boolean; fromCache: boolean } | null> {
    const prep = await this.prepareAI(reviewLimit(period), period, periodKeyOverride);
    if (prep.candidatePaths.length === 0) {
      new Notice("Vault 中还没有可复盘的笔记。");
      return null;
    }
    const callOpts = this.toCallOpts(prep);
    const now = Date.now();
    const structured = {
      ...callOpts,
      periodLabel: periodCnFor(period),
      recentLines: this.recentAccessLines(now),
      reviewedLines: this.recentlyReviewedLines(now),
      staleLines: this.staleLines(now),
      forgottenLines: this.forgottenLines(now),
    };
    const outcome = period === "daily"
      ? await this.ai.generateDailyReview(callOpts, force)
      : period === "weekly"
        ? await this.ai.generateWeeklyReview(structured, force)
        : period === "monthly"
          ? await this.ai.generateMonthlyReview(structured, force)
          : period === "quarterly"
            ? await this.ai.generateQuarterlyReview(structured, force)
            : await this.ai.generateCustomReview(structured, force);
    if (outcome.ok) {
      const path = await this.writeReview(period, outcome.data.markdown, outcome.data.model);
      new Notice("已生成" + (period === "daily" ? "日复盘" : periodCnFor(period) + "复盘") + (outcome.fromCache ? "（复用缓存）" : "（" + outcome.data.model + "）"));
      return { path, offline: false, fromCache: outcome.fromCache };
    }
    const offlineMd = this.localReview(period, prep);
    const path = await this.writeReview(period, offlineMd, "local");
    new Notice("AI 不可用（" + outcome.error.message + "），已生成本地降级复盘。");
    return { path, offline: true, fromCache: false };
  }

  /** §28：最近访问（时间衰减展示） */
  private recentAccessLines(now: number): string[] {
    return this.activity.recent(this.rules().recentLimit).map(({ path, entry }) => {
      const title = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
      return "[[title]]（" + relTime(entry.lastAccessedAt, now) + "）".replace("title", title);
    });
  }

  /** §28：最近复习 */
  private recentlyReviewedLines(now: number): string[] {
    return this.index.all()
      .map((n) => ({ n, a: this.getAct(n.path) }))
      .filter((x) => x.a?.lastReviewedAt)
      .sort((a, b) => (b.a!.lastReviewedAt!) - (a.a!.lastReviewedAt!))
      .slice(0, 3)
      .map((x) => "[[title]]（" + relTime(x.a!.lastReviewedAt, now) + "）".replace("title", x.n.title));
  }

  /** §27/29：疏于维护（staleDays 三无） */
  private staleLines(now: number): string[] {
    const rules = this.rules();
    return this.index.all()
      .filter((n) => deriveState(n, this.getAct(n.path), rules, now) === "stale")
      .slice(0, 5)
      .map((n) => "[[title]]（" + Math.max(1, Math.round((now - n.modified) / 86400000)) + " 天未修改）".replace("title", n.title));
  }

  /** §16/29：遗忘候选池（可能正在被遗忘，非用户已遗忘；只有本地规则决定谁进池，AI 不决定） */
  private forgottenLines(now: number): string[] {
    return forgottenCandidates(this.index.all(), this.getAct, this.rules(), now)
      .slice(0, 6)
      .map((n) => {
        const days = Math.max(1, Math.round((now - n.modified) / 86400000));
        return "[[title]]（" + days + " 天未修改 · 关联 " + (n.links.length + n.backlinks.length) + " 篇）".replace("title", n.title);
      });
  }

  /** 离线降级：只用本地索引事实（不依赖 AI） */
  private localReview(period: Period, prep: AIPrep): string {
    const today = fmtDate(new Date());
    const recent = this.index.recent(8).map((n) => "- " + n.title + "（" + n.wordCount + " 字，文件夹 " + n.folder + "）").join("\n");
    const areas = this.getSettings().knowledgeAreas;
    const areaStats = areas.map((a) => {
      const s = this.index.areaStats(a);
      return "- " + a.icon + " " + a.name + "：" + s.count + " 篇" + (s.lastModified ? "，最近修改 " + fmtDate(new Date(s.lastModified)) : "");
    }).join("\n");
    const forgotten = forgottenCandidates(this.index.all(), this.getAct, this.rules(), Date.now()).slice(0, 5).map((n) => "- " + n.title).join("\n");
    return [
      "# " + today + " " + (period === "daily" ? "日" : periodCnFor(period)) + "复盘（本地降级）",
      "",
      "> 本次未连接 AI，内容仅来自本地索引。配置 SiliconFlow API Key 后重新生成可获得「知识连接」洞察。",
      "",
      "## 今日学习",
      recent || "（今日没有修改记录）",
      "",
      "## 知识区域状态",
      areaStats || "（尚未配置知识区域：设置 → Knowledge Areas）",
      "",
      "## 可能正在被遗忘的知识（本地规则候选，仅表示“值得重新看看”，不代表你真忘记）",
      forgotten || "（暂无）",
      "",
      "## AI 发现",
      "（AI 连接器未启用。启用后此处会输出跨领域连接、观点冲突、值得追问的问题。）",
      "",
      "## 今日问题",
      "（暂无）",
      "",
      "## 值得继续探索",
      "- 在 设置 → AI 中填入 SiliconFlow API Key 并测试连接",
      "- 在 设置 → Knowledge Areas 中定义你的知识区域",
      "",
    ].join("\n");
  }

  async writeReview(period: Period, markdown: string, generatedBy: string): Promise<string> {
    const sub = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", custom: "Custom" }[period];
    const fileName = fmtDate(new Date()) + ".md";
    const full = normalizePath(REVIEW_ROOT + "/" + sub + "/" + fileName);
    await this.ensureFolder(normalizePath(REVIEW_ROOT + "/" + sub));
    const fm = [
      "---",
      "type: review",
      "period: " + period,
      "date: " + fmtDate(new Date()),
      "generatedBy: " + generatedBy,
      "---",
      "",
    ].join("\n");
    const content = fm + "\n" + markdown.trim() + "\n";
    const existing = this.app.vault.getAbstractFileByPath(full);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(full, content);
    }
    const rec: ReviewRecord = { period, date: Date.now(), path: full, generatedBy };
    const settings = this.getSettings();
    settings.reviews = [rec, ...settings.reviews].slice(0, 60);
    this.onDataChange();
    return full;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? cur + "/" + part : part;
      const f = this.app.vault.getAbstractFileByPath(cur);
      if (f) continue;
      try { await this.app.vault.createFolder(cur); } catch { /* 并发已创建等场景忽略 */ }
    }
  }
}