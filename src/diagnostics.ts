/** Phase 9：知识花园：诊断（§四十一~四十五）。
 * - 只读展示插件/索引/区域/Activity/AI Cache/演化/队列/调度/Hero/Music/AI 配置状态。
 * - 绝不显示 API Key / Authorization / 完整 Base URL secret（§四十二；Model 可显示，Key 显示 configured/not configured）。
 * - 「复制诊断摘要」输出纯文本摘要，不含 secret / 笔记正文（§四十三）。
 * - Repair 按钮：重建索引 / 清理失效 Activity / 重建当前 Review Queue / 清理过期缓存，全部先确认（§四十四），
 *   只操作 plugin cache / activity / schedule / queue / index，绝不删除用户 Markdown（§四十五）。
 */
import { App, Modal, Notice } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { AIFeature } from "./types";
import { DEFAULT_PROFILE_ID, allFeatures, cacheTypeForFeature, featureLabel, resolveAIFunctionRoute } from "./aiRouting";
import { webFetchCount } from "./webContext";
import { capabilitiesUnknown } from "./capabilities";
import { AI_ACTION_CATEGORIES, effectivePermission } from "./permissions";
import { taskStatusLabel } from "./taskEngine";

/** 通用确认弹窗：destructive 操作必须先确认（§四十四） */
class RepairConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: { title: string; body: string; action: () => void }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.opts.title });
    contentEl.createEl("p", { text: this.opts.body });
    const row = contentEl.createDiv({ cls: "kg-row" });
    row.createEl("button", { cls: "kg-btn", text: "取消" }).addEventListener("click", () => this.close());
    row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "确认执行" }).addEventListener("click", () => {
      this.close();
      this.opts.action();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class DiagnosticsModal extends Modal {
  constructor(app: App, private plugin: KnowledgeGardenPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("kg-dashboard");
    const inner = contentEl.createDiv({ cls: "kg-inner" });
    inner.createEl("h2", { text: "Knowledge Garden Diagnostics" });

    inner.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "状态" });
    for (const [label, value] of this.statusLines()) {
      const row = inner.createDiv({ cls: "kg-row" });
      row.createSpan({ cls: "kg-review-qlabel", text: label });
      row.createSpan({ text: value });
    }

    inner.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "AI 配置" });
    for (const [label, value] of this.aiLines()) {
      const row = inner.createDiv({ cls: "kg-row" });
      row.createSpan({ cls: "kg-review-qlabel", text: label });
      row.createSpan({ text: value });
    }

    inner.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "AI Function Routing" });
    for (const [label, value] of this.routingLines()) {
      const row = inner.createDiv({ cls: "kg-row" });
      row.createSpan({ cls: "kg-review-qlabel", text: label });
      row.createSpan({ text: value });
    }

    inner.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "Phase 13：Workspace / Skills / Context / Capability / Permission" });
    for (const [label, value] of this.p13Lines()) {
      const row = inner.createDiv({ cls: "kg-row" });
      row.createSpan({ cls: "kg-review-qlabel", text: label });
      row.createSpan({ text: value });
    }


    inner.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "AI Workbench（Phase 15）" });
    for (const [label, value] of this.workbenchLines()) {
      const row = inner.createDiv({ cls: "kg-row" });
      row.createSpan({ cls: "kg-review-qlabel", text: label });
      row.createSpan({ text: value });
    }
    inner.createDiv({ cls: "kg-section-title-row" }).createDiv({ cls: "kg-section-title", text: "操作" });
    const copyBtn = inner.createEl("button", { cls: "kg-btn", text: "复制诊断摘要" });
    copyBtn.addEventListener("click", () => this.copySummary());
    const repairRow = inner.createDiv({ cls: "kg-row" });
    this.addRepairBtn(repairRow, "重建索引", () => { void this.plugin.rescanAll(); }, "全量重新扫描 Vault 重建索引缓存。");
    this.addRepairBtn(repairRow, "重建搜索索引", () => {
      const paths = this.plugin.index.all().map((n) => n.path);
      this.plugin.searchIndex.cancel();
      void this.plugin.searchIndex.buildFromList(paths, () => { this.plugin.rerenderDashboard(); });
      new Notice("已在后台重建搜索索引（" + paths.length + " 篇，不重建 NoteIndex）。");
    }, "只重建 Search Index（Query Explorer 的本地检索层），不重建 NoteIndex、不影响 AI 缓存。");
    this.addRepairBtn(repairRow, "重新建立收藏索引", () => { void this.plugin.reindexSaved(); }, "从 Saved/*.md 的 frontmatter 重建收藏索引（只写 cache/saved-explorations.json，不调 AI）。");
    this.addRepairBtn(repairRow, "清理失效 Activity", () => {
      this.plugin.activity.prune(new Set(this.plugin.index.all().map((n) => n.path)));
      new Notice("已清理不存在的笔记对应的 Activity 条目。");
    }, "删除已不存在笔记的访问/复习记录（只动 cache/activity.json）。");
    this.addRepairBtn(repairRow, "重建当前 Review Queue", () => {
      this.plugin.ensureReviewQueue(true);
      new Notice("今日复习队列已重建（本地计算，不调用 AI）。");
      this.plugin.rerenderDashboard();
    }, "重新生成本周期复习队列（纯本地）。");
    this.addRepairBtn(repairRow, "清理过期缓存", () => {
      this.plugin.clearExpiredAICache();
    }, "只删过期/陈旧的 AI 缓存，未过期结果与 Reviews/ 保留。");
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addRepairBtn(row: HTMLElement, label: string, action: () => void, body: string): void {
    row.createEl("button", { cls: "kg-btn", text: label }).addEventListener("click", () => {
      new RepairConfirmModal(this.app, { title: label, body: body + " 确认执行？", action }).open();
    });
  }

  /** 状态行（§四十一 列表，全部只读） */
  private statusLines(): [string, string][] {
    const p = this.plugin;
    const s = p.settings;
    const queue = p.reviewCenter.getQueue();
    const evo = p.evolution;
    const sched = p.scheduler.diagnostics();
    const cacheStats = p.cache.stats();
    const relCounts = p.relationshipCounts();
    const lines: [string, string][] = [
      ["Plugin Version", p.manifest.version],
      ["Vault", this.app.vault.getName()],
      ["Indexed Notes", String(p.index.total())],
      ["Search Index", p.searchIndex.ready() ? "Indexed " + p.searchIndex.count() + " / " + p.searchIndex.getStatus().total + " · 就绪" : "Building…（" + p.searchIndex.getStatus().indexed + " / " + p.searchIndex.getStatus().total + "）"],
      ["Saved Explorations", p.saved.count() + " 条"],
      // Phase 14（§一百九十四）：Exams / Saved Review Cards / Card Reviews / Exam AI Requests / Exam Web Requests（只显示数量与状态）
      ["Exams", p.examStore.count() + " 场"],
      ["Saved Review Cards", p.cards.count() + " 张"],
      ["Card Reviews", p.cardReviews.count() + " 次"],
      ["Exam AI Requests", (cacheStats.byType["note_exam"] ?? 0) + " 次生成（缓存条目） + " + (cacheStats.byType["exam_grading"] ?? 0) + " 次评分"],
      ["Exam Web Requests", s.exam.webEnabled ? "Web 已开启（请求数并入上方 AI Requests）" : "Web 默认关闭（未启用）"],
      ["Knowledge Areas", s.knowledgeAreas.length ? s.knowledgeAreas.map((a) => a.name + (a.participateInAI ? "（AI）" : "")).join("、") : "（未配置）"],
      ["Activity Entries", String(p.activity.count())],
      ["AI Cache Entries", cacheStats.count + "（" + (cacheStats.byType["daily_curiosity"] ?? 0) + " 奇想 / " + (cacheStats.byType["connections"] ?? 0) + " 连接 / " + (cacheStats.byType["review_question"] ?? 0) + " 复习问题 / " + (cacheStats.byType["query_exploration"] ?? 0) + " 探索）"],
      ["Evolution Snapshots", String(evo.all().length) + "（持久问题 " + evo.persistentQuestions().length + "）"],
      ["Review Queue", queue ? queue.periodKey + " · " + queue.items.length + " 项（已完成 " + queue.completedCount + "）" : "（暂无）"],
      ["Scheduler", sched.enabled ? "自动复盘已启用 · 记录 " + sched.records.length + " 条" : "自动复盘未启用"],
      ["Hero", (s.hero.folder ? "图片文件夹已配置 · " : "") + (s.hero.current ? "当前有背景图" : "使用默认视觉")],
      ["Music", s.music.enabled ? "已启用 · " + (s.music.folder || "未配置文件夹") : "未启用"],
      ["Capture Notes", String(p.captureSummaryText.inbox) + " 条待处理（Inbox）"],
      ["Processing Candidates", String(p.captureSummaryText.candidates) + " 条知识候选"],
      ["Accepted Knowledge", String(p.captureSummaryText.accepted) + " 条已确认知识"],
      ["Archived Sources", String(p.captureSummaryText.archived) + " 条已归档（来源保留）"],
      ["Knowledge Relationships", "Confirmed: " + relCounts.confirmed + " · AI inferred active: " + relCounts.aiInferred + " · Dismissed: " + relCounts.dismissed + " · WikiLink evidence: " + relCounts.wikilinkEvidence],
      ["Anchor Explorations", String(p.saved.all().filter((e) => e.source === "anchor_exploration").length) + " 条收藏（已跟随 rename，§十八）"],
      ["Web Requests（会话内真实抓取）", String(webFetchCount) + " 次（缓存命中不计）"],

    ];
    return lines;
  }

  /** AI Function Routing（§一百三十一）：功能 / Provider / Model / Web / Cache Type + 今日真实调用统计。
   *  只显示路由结果与统计；绝不显示 API Key / Authorization / secret（§四十二/九十二）。 */
  private routingLines(): [string, string][] {
    const p = this.plugin;
    const s = p.settings;
    const stats = p.ai.requestStats();
    const def = (s.aiProfiles ?? []).find((x) => x.id === DEFAULT_PROFILE_ID);
    const writingFeatures: AIFeature[] = ["writing_academic", "writing_argument", "writing_critique", "writing_research", "writing_application", "writing_brainstorm", "writing_copy"];
    const writingToday = writingFeatures.reduce((sum, f) => sum + (stats.byFeature[f] ?? 0), 0);
    const lines: [string, string][] = [
      ["Default Profile", def ? (def.name + " · " + def.defaultModel + (def.apiKey ? " · Key: configured" : " · Key: not configured")) : "（未迁移，功能回退旧 ai 配置）"],
    ];
    for (const f of allFeatures()) {
      const r = resolveAIFunctionRoute(f, s.aiProfiles ?? [], s.aiFunctionConfig ?? [], s.defaultProfileId);
      lines.push([
        featureLabel(f) + "（" + f + "）",
        r.profileId + " → " + r.model + (r.webEnabled ? " · Web: On" : "") + " · Cache: " + cacheTypeForFeature(f) + " · 今日 " + (stats.byFeature[f] ?? 0) + " 次",
      ]);
    }
    lines.push(["写作助手合集（Academic / Research / Application / Brainstorm / Copy）", String(writingToday) + " 次 · 今日真实调用"]);
    lines.push(["今日 AI 请求（真实调用，缓存命中不计）", String(stats.total) + " 次"]);
    return lines;
  }

  /** AI 配置行（§四十二：绝不显示 API Key / Authorization / secret） */
  private aiLines(): [string, string][] {
    const ai = this.plugin.settings.ai;
    let host = "（未配置）";
    try {
      host = new URL(ai.baseUrl).host || "（未配置）";
    } catch { /* 非法 URL 按未配置处理 */ }
    return [
      ["Provider", ai.provider],
      ["Base URL Host", host],
      ["Model", ai.model],
      ["API Key", ai.apiKey ? "configured" : "not configured"],
    ];
  }

  /** Phase 13 §一百二十四：Workspace / Skills / Context / Model Capability / Permissions / AI Task（绝不显示 Key/Prompt/Web 全文，§一百二十五~一百二十七） */
  private p13Lines(): [string, string][] {
    const p = this.plugin;
    const s = p.settings;
    const ws = p.currentWorkspace();
    const lines: [string, string][] = [
      ["AI Profiles", (() => {
        const profs = s.aiProfiles ?? [];
        const defaultId = s.defaultProfileId || DEFAULT_PROFILE_ID;
        const defName = profs.find((x) => x.id === defaultId)?.name ?? defaultId;
        const incomplete = profs.filter((x) => !x.apiKey || !x.defaultModel).length;
        return profs.length + " 个 · 默认：" + defName + (incomplete > 0 ? " · ⚠ 不完整：" + incomplete : "");
      })()],
      ["Profiles 使用", (() => {
        const profs = s.aiProfiles ?? [];
        const defaultId = s.defaultProfileId || DEFAULT_PROFILE_ID;
        if (profs.length === 0) return "（无 Profile）";
        return profs.map((x) => {
          const usedByF = allFeatures().filter((f) => {
            const cfg = (s.aiFunctionConfig ?? []).find((c) => c?.feature === f);
            const assigned = cfg ? (cfg.profileId || defaultId) : defaultId;
            return assigned === x.id;
          }).length;
          const usedByW = (s.workspaces ?? []).filter((w) => w.defaultAIProfileId === x.id).length;
          return x.name + " → " + (usedByF + usedByW);
        }).join(" · ");
      })()],
      ["Workspaces", (s.workspaces ?? []).length ? s.workspaces.map((w) => w.name).join("、") : "（无）"],
      ["当前 Workspace", ws ? ws.name + " · Scope: " + (ws.discoveryScope ? (ws.discoveryScope.mode ?? "custom") : "跟随全局") + " · Profile: " + (ws.defaultAIProfileId || "跟随全局") : "未设置（保持原有全局行为，§九）"],
      ["Skills（Registry 已启用）", (s.skillRegistry ?? []).filter((x) => x.enabled).map((x) => x.name).join("、") || "（无）"],
      ["当前 Skill", ws && ws.skills && ws.skills.length ? ws.skills.map((id) => { const r = (s.skillRegistry ?? []).find((x) => x.id === id); return r ? r.name : id; }).join("、") : "（无）"],
      ["Skill 来源", "Knowledge Garden/Skills/<id>/SKILL.md（预读缓存；缺失回退内置，§二十三）"],
      ["Context Engine", "各 Feature 由 Context Policy 定义 required/optional/maxChars；超限显式标记截断（§三十六~四十）"],
      ["Model Capability", (s.modelMetadata ?? []).length ? s.modelMetadata.map((m) => m.modelId + (capabilitiesUnknown(m) ? "（Unknown）" : "")).join("、") : "（未配置能力元数据，按保守 Unknown 处理，§一百一十六）"],
      ["Permissions", "全局默认：" + AI_ACTION_CATEGORIES.map((a) => a + "=" + effectivePermission(a, s.permissionsPolicy ?? {})).join(" / ")],
      ["AI Task Engine", (p.taskEngine.running().length ? p.taskEngine.running().length + " 运行中 · " : "") + p.taskEngine.recent(3).map((t) => featureLabel(t.feature) + ":" + taskStatusLabel(t.status)).join(" / ") || "（无任务记录）"],
    ];
    return lines;
  }

  /** 复制摘要（§四十三）：version/notes/areas/ai-cache/scheduler… 不含 secret / 笔记正文 */
  private summaryText(): string {
    const p = this.plugin;
    const s = p.settings;
    const queue = p.reviewCenter.getQueue();
    const sched = p.scheduler.diagnostics();
    const cacheStats = p.cache.stats();
    const lines = [
      "Knowledge Garden",
      "version: " + p.manifest.version,
      "notes: " + p.index.total(),
      "search-index: " + p.searchIndex.count() + " / " + p.searchIndex.getStatus().total + (p.searchIndex.ready() ? "" : " (building)"),
      "areas: " + s.knowledgeAreas.length,
      "activity: " + p.activity.count(),
      "ai-cache: " + cacheStats.count,
      "evolution: " + p.evolution.all().length,
      "review-queue: " + (queue ? queue.items.length : 0),
      "scheduler: " + (sched.enabled ? "enabled" : "disabled") + " / records " + sched.records.length,
      "hero: " + (s.hero.current ? "image" : "default"),
      "music: " + (s.music.enabled ? "enabled" : "disabled"),
      "capture-inbox: " + p.captureSummaryText.inbox,
      "capture-candidates: " + p.captureSummaryText.candidates,
      "capture-accepted: " + p.captureSummaryText.accepted,
      "capture-archived: " + p.captureSummaryText.archived,
      "ai: model=" + s.ai.model + " key=" + (s.ai.apiKey ? "configured" : "not-configured"),
      "workspace: " + (p.currentWorkspace()?.name ?? "none"),
      "skills: " + (s.skillRegistry ?? []).filter((x) => x.enabled).length,
    ];
    return lines.join("\n");
  }


  private workbenchLines(): [string, string][] {
    const p = this.plugin;
    const tasks = p.taskStore?.list() ?? [];
    const byStatus: Record<string, number> = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const statusText = tasks.length ? Object.keys(byStatus).map((k) => k + "=" + byStatus[k]).join(" · ") : "（无）";
    const src = p.sourceLedger?.stats();
    const toolLog = p.workbenchToolLog ?? [];
    const lc = p.latencyCollector;
    const pl = p.promptLibraryStore;
    const sessions = p.sessionStore ? p.sessionStore.list() : [];
    const askStats = p.ai.requestStats();
    const askTotal = (askStats.byFeature["workbench_ask"] ?? 0) + (askStats.byFeature["workbench_deep"] ?? 0) + (askStats.byFeature["workbench_research"] ?? 0);
    const fmtLat = (mode: string, key: "ttft" | "total"): string => lc ? (lc.avg(mode, key) ?? "—") + "/" + (lc.p95(mode, key) ?? "—") : "未初始化";
    return [
      ["AI 任务数", String(tasks.length)],
      ["任务状态分布", statusText],
      ["知识项目数", String(p.projectStore?.projects?.length ?? 0)],
      ["来源台账", src ? "共 " + src.total + "（Vault " + src.vault + " / Web " + src.web + " / 项目 " + src.project + " / 用户 " + src.user + "）" : "未初始化"],
      ["工具调用总数", String(toolLog.length)],
      ["工具调用失败", String(toolLog.filter((x) => !x.ok).length)],
      ["Prompt Library", pl ? pl.count() + " 个（收藏 " + pl.templates.filter((t) => t.favorite).length + "）" : "未初始化"],
      ["最近使用 Prompt", pl && pl.templates.length ? pl.templates.slice().sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 3).map((t) => t.name).join(" / ") : "（无）"],
      ["Fast Rewrite 延迟(ms)", "Avg/P95 TTFT：" + fmtLat("fast", "ttft") + " · 请求 " + (lc ? lc.count("fast") : "未初始化")],
      ["Deep Rewrite 延迟(ms)", "Avg/P95 TTFT：" + fmtLat("deep", "ttft") + " · 请求 " + (lc ? lc.count("deep") : "未初始化")],
      ["Workbench Ask 请求", String(askTotal) + "（今日真实调用）"],
      ["Workbench Session", String(sessions.length) + " 条追问链"],
      // Phase 17 §123：Messages / Artifacts / Trace 统计（不含消息全文、API Key、reasoning §124-126）
      ["Phase 17 消息气泡", String(sessions.reduce((a, s) => a + (s.messages?.length ?? 0), 0)) + " 条（User/Assistant）"],
      ["Artifact 已保存", String(p.artifactStore?.count() ?? 0) + " 个（cache/artifacts.json）"],
      ["Trace 工具动作", String(sessions.reduce((a, s) => a + (s.traceEvents?.length ?? 0), 0)) + " 条（只看高层行为摘要）"],
    ];
  }
  private async copySummary(): Promise<void> {
    const text = this.summaryText();
    try {
      await navigator.clipboard.writeText(text);
      new Notice("诊断摘要已复制到剪贴板。");
    } catch {
      // 剪贴板 API 不可用时的降级
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      new Notice("诊断摘要已复制到剪贴板。");
    }
  }
}
