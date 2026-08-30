/** Saved Exploration View（§二十三/二十六~三十三）：★ 我的知识收藏。
 * - 列表：搜索（title/query/summary/node labels/tags §二十四）+ Filter（全部/奇想/探索/连接 §二十五）。
 * - 详情：只读 Graph（§二十七/二十八：复用 GraphSvg；只 Zoom/Pan/Hover/Click）、标题与标签编辑（§三十一~三十三）、
 *   [基于此探索重新探索]（§二十九：恢复 query/scope，不自动调 AI）、[删除]（§三十五确认；0 AI，§五十四）。
 * - 打开/删除/编辑绝不调用 AI（§五十三/五十四）。
 */
import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import { computeGraphLayout } from "./graphLayout";
import { GraphSvg } from "./graphSvg";
import { normalizeQueryResult } from "./knowledgeGraph";
import type { SavedExploration } from "./types";

export const VIEW_TYPE_SAVED = "knowledge-garden-saved";

const SOURCE_LABEL: Record<string, string> = {
  daily_curiosity: "今日知识奇想",
  query_exploration: "主动探索",
  connection: "知识连接",
  manual: "手动整理",
  anchor_exploration: "从笔记探索",
};

/** 删除确认（§三十五 文案；0 AI） */
class ConfirmModal {
  private overlay: HTMLElement | null = null;
  constructor(
    private opts: { title: string; body: string; action: () => void }
  ) {}
  open(): void {
    const overlay = document.createElement("div");
    overlay.addClass("modal-container");
    overlay.addClass("kg-modal");
    const content = overlay.createDiv({ cls: "modal" });
    content.addClass("kg-modal-card");
    this.overlay = overlay;
    content.createEl("h3", { text: this.opts.title });
    content.createEl("p", { text: this.opts.body });
    const row = content.createDiv({ cls: "kg-row" });
    row.createEl("button", { cls: "kg-btn", text: "取消" }).addEventListener("click", () => this.close());
    row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "确认删除" }).addEventListener("click", () => { this.close(); this.opts.action(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this.close(); });
    document.body.appendChild(overlay);
  }
  close(): void {
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
  }
}

/** 收藏中心：列表 + 详情（只读图）。渲染由 plugin.saved 数据驱动，0 AI。 */
export class SavedExplorationView extends ItemView {
  private inner!: HTMLElement;
  private mode: "list" | "detail" = "list";
  private currentId: string | null = null;
  private filter: "all" | "daily_curiosity" | "query_exploration" | "connection" | "anchor_exploration" | "manual" = "all";
  private searchQuery = "";
  private graph: GraphSvg | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_SAVED; }
  getDisplayText(): string { return "★ 我的知识收藏"; }
  getIcon(): string { return "star"; }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("kg-dashboard");
    this.inner = this.containerEl.createDiv({ cls: "kg-inner" });
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.graph) { this.graph.destroy(); this.graph = null; }
    this.containerEl.empty();
  }

  private render(): void {
    if (this.graph) { this.graph.destroy(); this.graph = null; }
    const inner = this.inner;
    inner.empty();
    inner.style.maxWidth = String(this.plugin.settings.dashboard.contentWidth) + "px";
    if (this.mode === "detail" && this.currentId) {
      const entry = this.plugin.saved.get(this.currentId);
      if (entry) { this.renderDetail(inner, entry); return; }
      this.mode = "list";
    }
    this.renderList(inner);
  }

  /** 列表（§二十三/二十四/二十五） */
  private renderList(inner: HTMLElement): void {
    const head = inner.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "★ 我的知识收藏" });
    const all = this.plugin.saved.all();
    const bar = inner.createDiv({ cls: "kg-query-bar" });
    const input = bar.createEl("input", { cls: "kg-query-input", attr: { type: "text", placeholder: "🔎 搜索收藏……（标题 / 问题 / 摘要 / 节点 / 标签）", "aria-label": "搜索收藏" } });
    input.value = this.searchQuery;
    input.addEventListener("input", () => { this.searchQuery = input.value.trim(); this.render(); });
    const sel = bar.createEl("select", { cls: "kg-select", attr: { "aria-label": "筛选来源" } });
    sel.createEl("option", { value: "all", text: "全部" });
    sel.createEl("option", { value: "daily_curiosity", text: "今日奇想" });
    sel.createEl("option", { value: "query_exploration", text: "主动探索" });
    sel.createEl("option", { value: "connection", text: "知识连接" });
    sel.createEl("option", { value: "anchor_exploration", text: "笔记关联探索" });
    sel.createEl("option", { value: "manual", text: "手动整理" });
    sel.value = this.filter;
    sel.addEventListener("change", () => { this.filter = sel.value as typeof this.filter; this.render(); });

    const filtered = all.filter((e) => {
      if (this.filter !== "all" && e.source !== this.filter) return false;
      if (!this.searchQuery) return true;
      const q = this.searchQuery.toLowerCase();
      const hay = [
        e.title, e.query || "", e.headline || "", e.summary || "",
        ...e.nodes.map((n) => n.label || n.path),
        ...(e.tags ?? []),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
    const list = inner.createDiv({ cls: "kg-saved-list" });
    if (filtered.length === 0) {
      list.createDiv({ cls: "kg-empty", text: all.length === 0 ? "还没有收藏。在 今日知识奇想 / Query Explorer / 今日知识漫游 结果上点「☆ 保存链路」即可收藏；或右键笔记 →「🔗 以此笔记探索关联」→ 保存。" : "没有匹配的收藏。" });
    }
    for (const e of filtered) {
      const card = list.createDiv({ cls: "kg-saved-card" });
      card.createDiv({ cls: "kg-saved-title", text: e.title || "知识收藏" });
      const meta = card.createDiv({ cls: "kg-review-meta" });
      meta.createSpan({ text: (SOURCE_LABEL[e.source] ?? e.source) + " · " + this.fmtDate(new Date(e.createdAt)) });
      if (e.tags && e.tags.length) meta.createSpan({ text: " · " + e.tags.join(" / ") });
      if (e.anchorPath) meta.createSpan({ text: " · 起点：《" + this.basename(e.anchorPath) + "》" });
      if (e.nodes.length) {
        card.createDiv({ cls: "kg-saved-path", text: e.nodes.map((n) => n.label || this.basename(n.path)).join(" → ") });
      }
      const row = card.createDiv({ cls: "kg-row" });
      const open = row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "打开" });
      open.addEventListener("click", () => { this.currentId = e.id; this.mode = "detail"; this.render(); });
      const del = row.createEl("button", { cls: "kg-btn", text: "删除" });
      del.addEventListener("click", () => this.confirmDelete(e));
    }
  }

  /** §二十六：点击收藏 → 展示保存时 Graph（0 AI，§五十三） */
  private renderDetail(inner: HTMLElement, entry: SavedExploration): void {
    const head = inner.createDiv({ cls: "kg-section-title-row" });
    head.createDiv({ cls: "kg-section-title", text: "★ " + entry.title });
    const back = head.createEl("button", { cls: "kg-btn", text: "← 返回收藏列表" });
    back.addEventListener("click", () => { this.mode = "list"; this.currentId = null; this.render(); });

    // 标题 / 标签编辑（§三十一~三十三：只改收藏，绝不修改原始笔记）
    const editor = inner.createDiv({ cls: "kg-saved-editor" });
    const titleRow = editor.createDiv({ cls: "kg-query-bar" });
    const titleInput = titleRow.createEl("input", { cls: "kg-query-input", attr: { type: "text", placeholder: "收藏标题", "aria-label": "收藏标题" } });
    titleInput.value = entry.title || "";
    const tagInput = titleRow.createEl("input", { cls: "kg-query-input kg-saved-tags", attr: { type: "text", placeholder: "标签（逗号分隔，如 系统设计, 知识管理）", "aria-label": "标签" } });
    tagInput.value = (entry.tags ?? []).join(", ");
    const saveMeta = titleRow.createEl("button", { cls: "kg-btn", text: "保存标题/标签" });
    saveMeta.addEventListener("click", () => {
      const title = titleInput.value.trim();
      const tags = tagInput.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      if (!title) { new Notice("标题不能为空。"); return; }
      void this.plugin.updateSavedMeta(entry.id, { title, tags }).then(() => this.render());
    });

    if (entry.anchorPath) {
      const aRow = inner.createDiv({ cls: "kg-review-meta" });
      const aFile = this.app.vault.getAbstractFileByPath(entry.anchorPath);
      if (aFile instanceof TFile) {
        const openBtn = aRow.createEl("button", { cls: "kg-btn", text: "起点：《" + aFile.basename + "》" });
        openBtn.addEventListener("click", () => this.openNote(entry.anchorPath as string));
      } else {
        aRow.createSpan({ text: "起点：《" + this.basename(entry.anchorPath) + "》 · 起始笔记已删除（收藏快照仍可查看，§十九）" });
      }
    }
    const meta = inner.createDiv({ cls: "kg-review-meta" });
    meta.createSpan({ text: (SOURCE_LABEL[entry.source] ?? entry.source) + " · 收藏于 " + this.fmtDate(new Date(entry.createdAt)) });
    if (entry.scope) meta.createSpan({ text: " · 范围：" + ((entry.scope as { mode?: string }).mode ?? "vault") });
    if (entry.query) meta.createSpan({ text: " · 问题：" + entry.query });
    // Phase 13 §一百零二：打开收藏时显示当时所处的 Workspace（历史 Snapshot，不改旧收藏）
    if (entry.workspaceSnapshot && entry.workspaceSnapshot.name) {
      meta.createSpan({ text: " · Workspace：" + entry.workspaceSnapshot.name });
    }

    // 只读 Graph（§二十七/二十八：复用现有图；不保存/不修改收藏本身）
    const model = normalizeQueryResult(
      {
        query: entry.query || "", headline: entry.headline || "", summary: entry.summary || "",
        nodes: entry.nodes as never, edges: entry.edges as never, insights: [], suggestedQuestions: [],
      } as never,
      entry.id,
      entry.query || entry.title || ""
    );
    if (model && model.nodes.length > 1) {
      const box = inner.createDiv({ cls: "kg-graph-box" });
      const layout = computeGraphLayout(model, box.clientWidth || 760, box.clientHeight || 380);
      this.graph = new GraphSvg(box, model, layout, { onOpenNote: (p) => this.openNote(p) });
    } else if (entry.nodes.length > 0) {
      const list = inner.createDiv({ cls: "kg-note-list" });
      list.createDiv({ cls: "kg-ai-label", text: "收藏的知识路径" });
      for (const n of entry.nodes) {
        const row = list.createDiv({ cls: "kg-note-item" });
        row.createSpan({ cls: "kg-note-title", text: n.label || this.basename(n.path) });
        row.createSpan({ cls: "kg-note-meta", text: (n.reason || n.path) + (this.app.vault.getAbstractFileByPath(n.path) instanceof TFile ? "" : "（原笔记已删除）") });
        row.addEventListener("click", () => this.openNote(n.path));
      }
    }

    // 关系列表（只读）
    if (entry.edges.length) {
      const rel = inner.createDiv({ cls: "kg-note-list" });
      rel.createDiv({ cls: "kg-ai-label", text: "保存的关系" });
      for (const e of entry.edges) {
        const from = entry.nodes.find((n) => n.path === e.from);
        const to = entry.nodes.find((n) => n.path === e.to);
        const row = rel.createDiv({ cls: "kg-note-item" });
        row.createSpan({ cls: "kg-note-title", text: (from?.label || this.basename(e.from)) + " → " + (to?.label || this.basename(e.to)) });
        row.createSpan({ cls: "kg-note-meta", text: e.relation + (e.reason ? " · " + e.reason : "") });
      }
    }

    // AI 观察（快照展示，不重新生成 §十九）
    const panel = inner.createDiv({ cls: "kg-graph-insight" });
    panel.createDiv({ cls: "kg-ai-label", text: "✦ 当时的 AI 观察" });
    if (entry.headline) panel.createDiv({ cls: "kg-ai-title", text: entry.headline });
    if (entry.summary) panel.createDiv({ cls: "kg-ai-body", text: entry.summary });

    // 操作（§二十九/三十五/五十四：全部 0 AI）
    const ops = inner.createDiv({ cls: "kg-row" });
    const resume = ops.createEl("button", { cls: "kg-btn kg-btn-primary", text: entry.source === "anchor_exploration" ? "基于此链路重新探索（恢复起始笔记）" : "基于此探索重新探索" });
    resume.addEventListener("click", () => {
      if (entry.source === "anchor_exploration") void this.plugin.resumeAnchorExploration(entry);
      else void this.plugin.resumeQueryExploration(entry);
    });
    const del = ops.createEl("button", { cls: "kg-btn", text: "删除收藏" });
    del.addEventListener("click", () => this.confirmDelete(entry));
    inner.createDiv({ cls: "kg-section-desc", text: "这是收藏时的知识链路快照：不依赖 AI Cache，也不会随缓存过期失效（§三十八）。打开/删除不调用 AI。" });
  }

  /** §三十五：删除确认（只删收藏 Markdown + 索引，不动原始笔记） */
  private confirmDelete(entry: SavedExploration): void {
    new ConfirmModal({
      title: "删除这个收藏？",
      body: "这只会删除收藏记录和对应 Exploration Markdown，不会删除任何原始笔记。",
      action: () => {
        void this.plugin.deleteSaved(entry.id).then(() => {
          if (this.currentId === entry.id) { this.currentId = null; this.mode = "list"; }
          this.render();
        });
      },
    }).open();
  }

  private openNote(pathStr: string): void {
    const file = this.app.vault.getAbstractFileByPath(pathStr);
    if (!(file instanceof TFile)) {
      new Notice("笔记不存在或已删除：" + pathStr);
      return;
    }
    void this.app.workspace.openLinkText(file.basename, file.path, false);
  }

  private basename(p: string): string {
    return (p.split("/").pop() ?? p).replace(/\.md$/i, "");
  }

  private fmtDate(d: Date): string {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
}
