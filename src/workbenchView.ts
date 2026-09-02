/**
 * Phase 17：AI Workbench View（聊天气泡 + Work Trace + Artifact 保存）。
 * - View 只调 service 方法（不发 AI 请求）。
 * - 气泡：User 右 / Assistant 左（默认折叠 trace；来源卡片；推理/不确定由正文内嵌）。
 * - AI 气泡底部 Actions：复制 / 复制含来源 / 保存 / 继续追问 / 深入分析 / 探索关联 / 提炼为知识。
 * - ⋯ 菜单：重新生成（force=true，保留旧气泡 §63/64）、删除本条显示。
 * - Artifact 保存：位置选择 → Preview → 冲突 → Diff → Apply（全程 0 AI §112）。
 * - 渲染安全：createEl / textContent / MarkdownRenderer，不用 innerHTML（§177）。
 */
import { ItemView, Notice, MarkdownRenderer, TFile, SuggestModal, Modal } from "obsidian";
import type { App } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import type { ResearchPlanParsed, ProjectDefinitionParsed } from "./workbenchParsers";
import type { WorkbenchAskOptions, WorkbenchAskResult, WorkbenchResearchResult, WorkbenchCreateResult, ResearchProgress } from "./workbenchService";
import { PromptLibraryModal } from "./promptLibraryUi";
import type { SkillSummary, AIAnswerSource, WorkbenchTraceEvent, MessageArtifact, ArtifactType } from "./types";
import type { WorkbenchSessionMessage } from "./workbenchSession";
import type { ResearchTask } from "./types";
import type { ArtifactSaveLocation } from "./artifactStore";
import { suggestArtifactTitle } from "./artifactStore";
import { saveArtifact, artifactRelPath, readExistingAt, cleanArtifactTitle, existsAt } from "./artifactSave";

export const VIEW_TYPE_AI_WORKBENCH = "knowledge-garden-ai-workbench";

type WorkbenchMode = "ask" | "research" | "project";

export class AIWorkbenchView extends ItemView {
  private mode: WorkbenchMode = "ask";
  private webChecked = false;
  private pendingPlan: ResearchPlanParsed | null = null;
  private pendingTaskId: string | null = null;
  private pendingDefinition: ProjectDefinitionParsed | null = null;
  private running = false;
  private cancelled = false;
  private progressEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  /** Phase 16 §58-64：Context Shelf（用户显式挑选；绝不偷偷添加 §64） */
  private shelf: { kind: "note" | "skill" | "prompt"; id: string; label: string }[] = [];
  /** Phase 16 §66：当前 Session（追问共用；[新会话] 清空） */
  private sessionId: string | null = null;
  private lastAskQuestion = "";
  private lastAsk: WorkbenchAskResult | null = null;
  /** Phase 17 §32-34：聊天气泡（内存视图；与 sessionStore 持久化保持一致） */
  private messages: WorkbenchSessionMessage[] = [];
  private traceBySession = new Map<string, WorkbenchTraceEvent[]>();
  private msgListEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: KnowledgeGardenPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_AI_WORKBENCH; }
  getDisplayText(): string { return "Knowledge Garden AI 工作台"; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> {
    // Phase 17 §97：恢复最近会话（messages + trace + artifact 链接）
    const recent = this.plugin.sessionStore.recent(1);
    const rec = recent[0];
    if (rec && rec.messages && rec.messages.length) {
      this.sessionId = rec.sessionId;
      this.messages = rec.messages;
      this.traceBySession.set(rec.sessionId, rec.traceEvents ?? []);
    }
    this.renderAll();
  }

  /** 外部（main 命令/右键）打开时携带初始模式与问题 */
  preset(mode: WorkbenchMode, initialText: string): void {
    this.mode = mode;
    if (this.inputEl) this.inputEl.value = initialText;
  }

  private svc() { return this.plugin.workbenchService; }

  private renderAll(): void {
    const root = this.contentEl;
    root.empty();
    root.createDiv({ cls: "kg-workbench" }, (wrap) => {
      wrap.createEl("h2", { text: "Knowledge Garden AI 工作台" });
      this.renderModeBar(wrap);
      this.msgListEl = wrap.createDiv({ cls: "kg-wb-msgs" });
      this.renderMessages();
      this.renderInput(wrap);
      this.progressEl = wrap.createDiv({ cls: "kg-wb-progress" });
      this.resultEl = wrap.createDiv({ cls: "kg-wb-result" });
      this.renderHistory(wrap);
    });
  }

  /* ================= Phase 17：聊天气泡 ================= */

  private renderMessages(): void {
    if (!this.msgListEl) return;
    this.msgListEl.empty();
    if (this.messages.length === 0) {
      this.msgListEl.createDiv({ cls: "kg-wb-empty", text: "💬 从下方提问开始。AI 的回答会显示为气泡，并可保存为笔记（Artifact）。" });
      return;
    }
    for (const m of this.messages) {
      if (m.role === "user") this.renderUserBubble(m);
      else if (m.role === "assistant") this.renderAssistantBubble(m);
    }
  }

  private renderUserBubble(m: WorkbenchSessionMessage): void {
    const row = this.msgListEl!.createDiv({ cls: "kg-wb-msg kg-wb-msg-user" });
    const bubble = row.createDiv({ cls: "kg-wb-bubble kg-wb-bubble-user" });
    bubble.createDiv({ text: m.content, cls: "kg-wb-bubble-text" });
  }

  private renderAssistantBubble(m: WorkbenchSessionMessage): void {
    const row = this.msgListEl!.createDiv({ cls: "kg-wb-msg kg-wb-msg-ai" });
    const bubble = row.createDiv({ cls: "kg-wb-bubble kg-wb-bubble-ai" });
    if (m.status === "error") {
      bubble.createEl("div", { text: "⚠ 生成失败：" + (m.errorCode || "未知错误"), cls: "kg-wb-error" });
      return;
    }
    const body = bubble.createDiv({ cls: "kg-wb-bubble-body" });
    void MarkdownRenderer.render(this.app, m.content || "", body, "", this);
    if (m.model) bubble.createDiv({ text: "模型：" + m.model, cls: "kg-wb-model" });
    // Phase 17 §4/§40：Work Trace（只来自真实动作；默认折叠，可展开）
    const traces = this.traceBySession.get(this.sessionId ?? "") ?? [];
    if (traces.length) {
      const det = bubble.createEl("details", { cls: "kg-wb-trace" });
      const running = traces.some((t) => t.status === "running");
      det.createEl("summary", { text: "🧭 工作过程" + (running ? " · ● 进行中…" : "") });
      const list = det.createDiv({ cls: "kg-wb-trace-list" });
      for (const t of traces) {
        const line = list.createDiv({ cls: "kg-wb-trace-item" + (t.status === "running" ? " is-running" : t.status === "failed" ? " is-fail" : " is-done") });
        line.createSpan({ text: (t.status === "running" ? "● " : t.status === "failed" ? "✗ " : "✓ ") + t.summary });
        if (t.tool) line.createSpan({ text: " · " + t.tool, cls: "kg-wb-trace-tool" });
        if (t.toolParamsSummary) line.createSpan({ text: " · " + t.toolParamsSummary, cls: "kg-wb-trace-param" });
        if (t.count !== undefined && t.count > 0) line.createSpan({ text: " · " + t.count + " 项", cls: "kg-wb-trace-count" });
      }
    }
    // 来源卡片（§91/92）
    if (m.sources && m.sources.length) {
      const src = bubble.createEl("details", { cls: "kg-wb-src-details" });
      src.createEl("summary", { text: "📚 来源 " + m.sources.length });
      const list = src.createDiv({ cls: "kg-wb-src-list" });
      for (const s of m.sources) {
        list.createEl("div", { cls: "kg-wb-src-item" }, (li) => {
          const tag = li.createEl("span", { text: s.type === "vault" ? "Vault" : s.type === "web" ? "Web" : "推理", cls: "kg-wb-src-tag" });
          void tag;
          const a = li.createEl("a", { text: s.title || s.path || s.url || "（无标题）", cls: "kg-wb-src-link" });
          a.addEventListener("click", () => this.openSource(s));
          if (s.reason) li.createDiv({ text: s.reason, cls: "kg-wb-src-reason" });
        });
      }
    }
    // 📎 已保存 Artifact（§84）
    if (m.artifactRefs && m.artifactRefs.length) {
      const refs = bubble.createDiv({ cls: "kg-wb-artifact-refs" });
      for (const ar of m.artifactRefs) {
        const a = refs.createEl("a", { text: "📎 已保存：[[" + ar.vaultPath + "]]", cls: "kg-wb-artifact-ref" });
        a.addEventListener("click", () => this.openVaultPath(ar.vaultPath));
      }
    }
    // Actions（§13：复制 / 复制含来源 / 保存 / 继续追问 / 深入分析 / 探索关联 / 提炼为知识）
    const acts = bubble.createDiv({ cls: "kg-wb-actions" });
    acts.createEl("button", { text: "复制", cls: "kg-btn" }).addEventListener("click", () => void this.copyMessage(m, false));
    acts.createEl("button", { text: "复制含来源", cls: "kg-btn" }).addEventListener("click", () => void this.copyMessage(m, true));
    acts.createEl("button", { text: "保存", cls: "mod-cta kg-btn" }).addEventListener("click", () => this.saveMessageAsArtifact(m));
    acts.createEl("button", { text: "继续追问", cls: "kg-btn" }).addEventListener("click", () => {
      if (this.inputEl) { this.inputEl.value = (this.questionForMessage(m) || "追问") + "：\n\n" + m.content.slice(0, 80); this.inputEl.focus(); }
    });
    acts.createEl("button", { text: "深入分析", cls: "kg-btn" }).addEventListener("click", () => {
      if (this.inputEl) { this.inputEl.value = "深入分析：" + m.content.slice(0, 80) + "\n\n从多个角度深入，指出证据冲突与缺失。"; this.inputEl.focus(); }
    });
    acts.createEl("button", { text: "探索关联", cls: "kg-btn" }).addEventListener("click", () => {
      const anchor = m.sources?.[0]?.path ?? null;
      if (this.inputEl) { this.inputEl.value = "以" + (anchor ? "[[" + anchor + "]]" : "当前话题") + "为锚点，找出与之相关的知识与跨领域连接，附真实笔记路径。"; this.inputEl.focus(); }
    });
    acts.createEl("button", { text: "提炼为知识", cls: "kg-btn" }).addEventListener("click", () => void this.saveAskExploration());
    // ⋯ 菜单（§63/64：重新生成保留旧气泡 / 删除本条显示）
    const menu = bubble.createEl("details", { cls: "kg-wb-menu" });
    menu.createEl("summary", { text: "⋯" });
    const menuBox = menu.createDiv({ cls: "kg-wb-menu-box" });
    menuBox.createEl("button", { text: "重新生成（保留本气泡）", cls: "kg-btn" }).addEventListener("click", () => void this.regenerateMessage(m));
    menuBox.createEl("button", { text: "删除本条显示", cls: "kg-btn" }).addEventListener("click", () => this.removeMessageDisplay(m));
  }

  /** 找该 assistant 气泡前一条 user 消息（重新生成/保存的题目来源） */
  private questionForMessage(m: WorkbenchSessionMessage): string | null {
    const idx = this.messages.indexOf(m);
    if (idx <= 0) return null;
    const before = this.messages.slice(0, idx);
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i].role === "user") return before[i].content;
    }
    return null;
  }

  private async copyMessage(m: WorkbenchSessionMessage, withSources: boolean): Promise<void> {
    let text = m.content || "";
    if (withSources && m.sources?.length) {
      text += "\n\n---\n\n来源：\n";
      for (const s of m.sources) {
        text += "- " + (s.title || s.path || s.url || "来源") + (s.path ? " [[" + s.path + "]]" : "") + (s.url ? " (" + s.url + ")" : "") + "\n";
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      new Notice("已复制" + (withSources ? "（含来源）" : "") + "。");
    } catch {
      new Notice("复制失败（剪贴板不可用）。");
    }
  }

  private async regenerateMessage(m: WorkbenchSessionMessage): Promise<void> {
    if (!this.sessionId) { new Notice("没有可重新生成的会话。"); return; }
    const q = this.questionForMessage(m) ?? m.content.slice(0, 200);
    if (!q) { new Notice("没有可用于重新生成的问题。"); return; }
    const opts: WorkbenchAskOptions = { sessionId: this.sessionId, force: true };
    this.running = true;
    const res = await this.svc().ask(q, opts);
    this.running = false;
    this.lastAskQuestion = q;
    this.lastAsk = res;
    if (res.ok && res.sessionId) this.sessionId = res.sessionId;
    const rec = this.plugin.sessionStore.get(this.sessionId);
    if (rec?.messages?.length) { this.messages = rec.messages; this.traceBySession.set(this.sessionId, rec.traceEvents ?? []); }
    this.renderMessages();
    if (this.resultEl) { this.resultEl.empty(); }
    this.renderResult(res);
  }

  private removeMessageDisplay(m: WorkbenchSessionMessage): void {
    this.messages = this.messages.filter((x) => x.id !== m.id);
    if (this.sessionId) {
      const rec = this.plugin.sessionStore.get(this.sessionId);
      if (rec) {
        rec.messages = (rec.messages ?? []).filter((x) => x.id !== m.id);
        this.plugin.sessionStore.put(rec);
      }
    }
    this.renderMessages();
  }

  private saveMessageAsArtifact(m: WorkbenchSessionMessage): void {
    if (!this.sessionId) { new Notice("没有会话记录。"); return; }
    const question = this.questionForMessage(m) || m.content;
    new ArtifactSaveModal(this.app, this.plugin, {
      sessionId: this.sessionId,
      messageId: m.id,
      suggestTitle: suggestArtifactTitle(question, "answer"),
      content: m.content,
      sources: m.sources ?? [],
      onSaved: (artifact) => {
        const rec = this.plugin.sessionStore.get(this.sessionId!);
        if (rec?.messages) {
          const msg = rec.messages.find((x) => x.id === m.id);
          if (msg) {
            msg.artifactRefs = msg.artifactRefs ?? [];
            msg.artifactRefs.push({ artifactId: artifact.id, title: artifact.title, vaultPath: artifact.vaultPath, createdAt: artifact.createdAt });
            this.plugin.sessionStore.put(rec);
            this.messages = rec.messages;
            this.renderMessages();
          }
        }
        new Notice("已保存：" + artifact.vaultPath + "（Dashboard「✦ 最近保存」可见）");
      },
    }).open();
  }

  private openVaultPath(rel: string): void {
    const f = this.app.vault.getAbstractFileByPath(rel);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
    else new Notice("文件不存在：" + rel);
  }  private renderModeBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "kg-wb-modes" });
    const modes: { id: WorkbenchMode; label: string }[] = [
      { id: "ask", label: "提问" },
      { id: "research", label: "研究" },
      { id: "project", label: "项目" },
    ];
    for (const m of modes) {
      const btn = bar.createEl("button", { text: m.label, cls: "kg-wb-mode" + (this.mode === m.id ? " is-active" : "") });
      btn.addEventListener("click", () => { if (this.running) return; this.mode = m.id; this.pendingPlan = null; this.pendingDefinition = null; this.renderAll(); });
    }
    if (this.mode === "research") {
      const web = bar.createEl("label", { cls: "kg-wb-web" });
      const cb = web.createEl("input", { type: "checkbox" });
      cb.checked = this.webChecked;
      cb.addEventListener("change", () => { this.webChecked = cb.checked; });
      web.createSpan({ text: " 本次启用 Web 搜索（仅本次，不改写权限）" });
    }
  }

  private renderInput(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: "kg-wb-input" });
    this.renderQuickCommands(box);
    // Phase 16 §58-64：Context Shelf（@ 笔记 / / Skill / ★Prompt；绝不偷偷添加 §64）
    const shelfBox = box.createDiv({ cls: "kg-wb-shelf" });
    shelfBox.createSpan({ cls: "kg-review-qlabel", text: "Context：" });
    if (this.shelf.length === 0) shelfBox.createSpan({ cls: "kg-toolbox-note", text: "（空）@ 笔记 / / Skill / ★ Prompt" });
    for (const s2 of this.shelf) {
      const chip = shelfBox.createEl("span", { cls: "kg-wb-shelf-chip" });
      chip.createSpan({ text: s2.label });
      const x = chip.createEl("button", { text: "×", cls: "kg-wb-shelf-x" });
      x.addEventListener("click", () => { this.shelf = this.shelf.filter((y) => y.id !== s2.id); this.renderAll(); });
    }
    shelfBox.createEl("button", { text: "@ 笔记", cls: "kg-btn kg-wb-shelf-add" }).addEventListener("click", () => {
      new NoteSuggestModal(this.app, this.plugin, (f) => this.addShelf("note", f.path, "📄 " + f.basename)).open();
    });
    shelfBox.createEl("button", { text: "/ Skill", cls: "kg-btn kg-wb-shelf-add" }).addEventListener("click", () => {
      new SkillSuggestModal(this.app, this.plugin, (sk) => this.addShelf("skill", sk.id, "⚙ " + sk.name)).open();
    });
    shelfBox.createEl("button", { text: "★ Prompt", cls: "kg-btn kg-wb-shelf-add" }).addEventListener("click", () => {
      new PromptLibraryModal(this.app, this.plugin, (id) => {
        const t = this.plugin.promptLibraryStore.templates.find((x) => x.id === id);
        if (t) { this.addShelf("prompt", t.id, "★ " + t.name); this.plugin.promptLibraryStore.touch(t.id); }
      }).open();
    });
    this.inputEl = box.createEl("textarea", { cls: "kg-wb-textarea", attr: { placeholder: this.placeholder(), rows: "6", wrap: "soft" } }) as HTMLTextAreaElement;
    this.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        void this.submit();
      }
    });
    const btns = box.createDiv({ cls: "kg-wb-actions" });
    const go = btns.createEl("button", { text: this.submitLabel(), cls: "mod-cta" });
    go.addEventListener("click", () => { void this.submit(); });
    if (this.mode === "research" && this.pendingPlan) {
      const cancel = btns.createEl("button", { text: "放弃计划" });
      cancel.addEventListener("click", () => { this.pendingPlan = null; this.pendingTaskId = null; this.renderAll(); });
    }
    if (this.running) {
      const stop = btns.createEl("button", { text: "停止" });
      stop.addEventListener("click", () => { this.cancelled = true; });
    }
  }

  /** Gemini Scribe 式「聊天指令面板」——点击指令块即填入提示词模板，不改写已有内容 */
  private readonly quickCommands: { mode: WorkbenchMode; label: string; template: string }[] = [
    { mode: "ask", label: "向知识库提问", template: "向我的知识库提问：\n\n" },
    { mode: "ask", label: "概括当前笔记", template: "请概括当前打开的笔记，提炼核心观点、关键词与未解决问题。\n\n" },
    { mode: "ask", label: "关联探索", template: "以当前笔记为锚点，找出与之相关的知识与跨领域连接，附真实笔记路径。\n\n" },
    { mode: "ask", label: "翻译选中", template: "翻译我选中的文本，保留 Markdown 与 WikiLink：\n\n" },
    { mode: "research", label: "开始研究", template: "开始研究：\n\n" },
    { mode: "project", label: "建立项目", template: "建立项目：\n\n" },
  ];

  private renderQuickCommands(parent: HTMLElement): void {
    const panel = parent.createDiv({ cls: "kg-wb-quick" });
    const header = panel.createDiv({ cls: "kg-wb-quick-header" });
    header.createSpan({ text: "⚡ 快速指令（点击填入，补充细节后提交）", cls: "kg-wb-quick-title" });
    const toggle = header.createEl("button", { text: "收起", cls: "kg-wb-quick-toggle" });
    const body = panel.createDiv({ cls: "kg-wb-quick-body" });
    const setHidden = (hidden: boolean): void => { body.hidden = hidden; toggle.setText(hidden ? "展开" : "收起"); };
    toggle.addEventListener("click", () => setHidden(!body.hidden));
    for (const c of this.quickCommands) {
      const chip = body.createEl("button", { text: c.label, cls: "kg-wb-chip" });
      chip.addEventListener("click", () => {
        if (c.mode !== this.mode) {
          this.mode = c.mode;
          this.pendingPlan = null;
          this.pendingDefinition = null;
          this.renderAll();
        }
        const el = this.inputEl;
        if (el) { el.value = c.template; el.focus(); }
      });
    }
  }

  private placeholder(): string {
    if (this.mode === "ask") return "向你的知识库提问（Ctrl/Cmd+Enter 提交）…";
    if (this.mode === "research") return "要研究的问题，例如：模块化设计对认知负荷的长期影响…";
    return "项目主题，例如：构建一个本地 RSS 知识流…";
  }

  private submitLabel(): string {
    if (this.mode === "ask") return "提问";
    if (this.mode === "research") return "生成研究计划";
    return "生成项目定义";
  }

  private addShelf(kind: "note" | "skill" | "prompt", id: string, label: string): void {
    if (this.shelf.some((x) => x.kind === kind && x.id === id)) { new Notice("已在 Context 中。"); return; }
    this.shelf.push({ kind, id, label });
    this.renderAll();
  }

  private async submit(): Promise<void> {
    const q = (this.inputEl?.value ?? "").trim();
    if (!q) { new Notice("请输入内容"); return; }
    if (this.running) return;
    this.resultEl?.empty();
    if (this.mode === "ask") await this.runAsk(q);
    else if (this.mode === "research") await this.runResearchPlan(q);
    else await this.runProjectDefinition(q);
  }

  /* ================= Ask ================= */

  private async runAsk(q: string): Promise<void> {
    if (this.resultEl) { this.resultEl.empty(); this.resultEl.createEl("div", { text: "AI 处理中…", cls: "kg-wb-pending" }); }
    this.running = true;
    this.cancelled = false;
    // Phase 17 §32：用户气泡即时显示（service 持久化后以 sessionStore 为准刷新）
    const userMsg: WorkbenchSessionMessage = { id: "msg-" + Date.now().toString(36), role: "user", content: q, createdAt: Date.now(), sources: [] };
    this.messages.push(userMsg);
    this.renderMessages();
    const opts: WorkbenchAskOptions = {
      shelfNotes: this.shelf.filter((x) => x.kind === "note").map((x) => x.id),
      shelfSkills: this.shelf.filter((x) => x.kind === "skill").map((x) => x.id),
      shelfPromptIds: this.shelf.filter((x) => x.kind === "prompt").map((x) => x.id),
      sessionId: this.sessionId ?? undefined,
    };
    const res = await this.svc().ask(q, opts);
    this.running = false;
    this.lastAskQuestion = q;
    this.lastAsk = res;
    if (res.ok && res.sessionId) this.sessionId = res.sessionId;
    // 以 sessionStore 持久化记录为准刷新气泡（ID 与 trace 保持一致）
    if (this.sessionId) {
      const rec = this.plugin.sessionStore.get(this.sessionId);
      if (rec?.messages?.length) { this.messages = rec.messages; this.traceBySession.set(this.sessionId, rec.traceEvents ?? []); }
    }
    this.renderMessages();
    this.renderResult(res);
  }  /** Phase 16 §三/§52：保存本次 Ask 为知识链路（nodes = Vault 来源；Markdown 持久化） */
  private async saveAskExploration(): Promise<void> {
    const res = this.lastAsk;
    if (!res || !res.ok) { new Notice("没有可保存的探索结果。"); return; }
    const nodes = res.sources.filter((x) => x.type === "vault" && x.path).map((x) => ({
      path: x.path!,
      label: x.title || (x.path!.split("/").pop() ?? x.path!).replace(/.md$/i, ""),
      reason: x.reason,
    }));
    try {
      await this.plugin.saveExploration({
        source: "workbench_ask",
        title: (this.lastAskQuestion || "AI 工作台探索").slice(0, 60),
        query: this.lastAskQuestion,
        summary: res.answer.slice(0, 500),
        nodes,
        edges: [],
      });
      new Notice("已保存探索链路（Knowledge Garden/Saved/）。");
    } catch (e) {
      new Notice("保存失败：" + String((e as Error)?.message || e));
    }
  }

  private renderResult(res: WorkbenchAskResult): void {
    if (!this.resultEl) return;
    this.resultEl.empty();
    if (!res.ok) {
      this.resultEl.createEl("div", { text: "提问失败：" + (res.error || "未知错误"), cls: "kg-wb-error" });
      return;
    }
    this.resultEl.createEl("div", { cls: "kg-wb-answer" }, (d) => {
      void MarkdownRenderer.render(this.app, res.answer, d, "", this);
    });
    if (res.sources.length) {
      this.resultEl.createEl("h4", { text: "来源" });
      const list = this.resultEl.createEl("ul", { cls: "kg-wb-sources" });
      for (const s of res.sources) {
        list.createEl("li", {}, (li) => {
          const tag = li.createEl("span", { text: s.type === "vault" ? "Vault" : s.type === "web" ? "Web" : "推理", cls: "kg-wb-src-tag" });
          void tag;
          const title = s.title || s.path || s.url || "（无标题）";
          const a = li.createEl("a", { text: title, cls: "kg-wb-src-link" });
          a.addEventListener("click", () => this.openSource(s));
          if (s.reason) li.createDiv({ text: s.reason, cls: "kg-wb-src-reason" });
        });
      }
    }
    if (res.unresolved.length) {
      this.resultEl.createEl("h4", { text: "未解答的问题" });
      for (const u of res.unresolved) this.resultEl.createEl("li", { text: u });
    }
    // Phase 16 §47：Answer Schema——inferences / uncertainties / followUps
    if (res.inferences && res.inferences.length) {
      this.resultEl.createEl("h4", { text: "🧠 AI 推理（无直接来源；需你自行判断）" });
      for (const inf of res.inferences) this.resultEl.createEl("li", { text: inf });
    }
    if (res.uncertainties && res.uncertainties.length) {
      this.resultEl.createEl("h4", { text: "⚠ 不确定点" });
      for (const u of res.uncertainties) this.resultEl.createEl("li", { text: u });
    }
    if (res.followUps && res.followUps.length) {
      this.resultEl.createEl("h4", { text: "💡 建议追问（点击填入输入框）" });
      const fu = this.resultEl.createEl("ul");
      for (const f of res.followUps) {
        fu.createEl("li", {}, (li) => {
          li.createEl("a", { text: f, cls: "kg-wb-followup" }).addEventListener("click", () => {
            if (this.inputEl) { this.inputEl.value = f; this.inputEl.focus(); }
          });
        });
      }
    }
    // §68：Tool Activity（只显示 Action Summary；不显示 hidden reasoning）
    const toolDetail = this.resultEl.createEl("details");
    const ttftTxt = res.ttft !== undefined ? " · 首token " + res.ttft + "ms" : "";
    const totalTxt = res.totalMs !== undefined ? " · 总耗时 " + res.totalMs + "ms" : "";
    toolDetail.createEl("summary", { text: "已执行 " + (res.toolSteps ?? 0) + " 个知识检索动作" + ttftTxt + totalTxt });
    const actList = toolDetail.createDiv({ cls: "kg-wb-shelf-note" });
    actList.createDiv({ text: "✓ Search Vault（本地检索候选）" });
    for (const src of res.sources) {
      if (src.type === "vault" && src.path) actList.createDiv({ text: "✓ Read [[" + src.path + "]]" });
    }
    // §63：本次 AI 实际读取（只显示统计；可展开）
    const totalChars = res.sources.reduce((a, b) => a + (b.snippet?.length ?? 0), 0);
    const ctxDetail = this.resultEl.createEl("details");
    ctxDetail.createEl("summary", { text: "本次 AI 实际读取：" + res.sources.length + " sources / ~" + totalChars + " chars" });
    // Actions（§3：继续追问 / 深入分析 / 开始研究 / 保存探索）
    const acts = this.resultEl.createDiv({ cls: "kg-wb-actions" });
    acts.createEl("button", { text: "继续追问", cls: "mod-cta" }).addEventListener("click", () => {
      if (this.inputEl) { this.inputEl.value = "追问：" + this.lastAskQuestion + "\n\n"; this.inputEl.focus(); }
    });
    acts.createEl("button", { text: "深入分析", cls: "mod-cta" }).addEventListener("click", () => {
      if (this.inputEl) { this.inputEl.value = "深入分析：" + this.lastAskQuestion + "\n\n从多个角度深入，指出证据冲突与缺失。"; this.inputEl.focus(); }
    });
    acts.createEl("button", { text: "开始研究" }).addEventListener("click", () => {
      this.mode = "research";
      if (this.inputEl) this.inputEl.value = "研究：" + this.lastAskQuestion + "\n\n";
      this.renderAll();
    });
    acts.createEl("button", { text: "保存探索" }).addEventListener("click", () => void this.saveAskExploration());
    acts.createEl("button", { text: "新会话" }).addEventListener("click", () => {
      this.sessionId = null;
      this.messages = [];
      this.traceBySession.clear();
      this.renderMessages();
      new Notice("已开始新会话（后续提问不再带上一轮上下文）。");
    });
  }

  private openSource(s: { type: string; path?: string; url?: string }): void {
    if (s.type === "vault" && s.path) {
      const f = this.app.vault.getAbstractFileByPath(s.path);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
      else new Notice("笔记不存在（可能已被移动/删除）：" + s.path);
    } else if (s.type === "web" && s.url) {
      window.open(s.url, "_blank");
    }
  }

  /* ================= Research ================= */

  private async runResearchPlan(q: string): Promise<void> {
    this.running = true;
    const res = await this.svc().makeResearchPlan(q);
    this.running = false;
    if (!res.ok || !res.plan) {
      this.renderPlanError(res);
      return;
    }
    this.pendingPlan = res.plan;
    this.pendingTaskId = res.taskId ?? null;
    this.renderPlanConfirm(res.plan);
  }

  private renderPlanError(res: WorkbenchResearchResult): void {
    if (!this.resultEl) return;
    this.resultEl.empty();
    this.resultEl.createEl("div", { text: "研究计划生成失败：" + (res.error || "未知错误"), cls: "kg-wb-error" });
  }

  private renderPlanConfirm(plan: ResearchPlanParsed): void {
    if (!this.resultEl) return;
    this.resultEl.empty();
    this.resultEl.createEl("div", { text: plan.title, cls: "kg-wb-plan-title" });
    this.resultEl.createEl("h4", { text: "研究计划（确认后执行，最多 8 步 / 5 次搜索 / 10 页）" });
    const ol = this.resultEl.createEl("ol", { cls: "kg-wb-plan" });
    for (const step of plan.steps) ol.createEl("li", { text: step });
    const run = this.resultEl.createEl("button", { text: "确认并开始研究", cls: "mod-cta" });
    run.addEventListener("click", () => { void this.startResearch(); });
    this.progressEl?.empty();
  }

  private async startResearch(): Promise<void> {
    if (!this.pendingTaskId) return;
    const task = this.plugin.taskStore.get(this.pendingTaskId);
    if (!task) { new Notice("任务不存在（可能已被清理）"); return; }
    this.running = true;
    this.cancelled = false;
    this.renderAll(); // 重画（操作区显示停止按钮）
    this.progressEl?.createEl("div", { text: "研究执行中…", cls: "kg-wb-running" });
    this.plugin.taskStore.put({ ...task, status: "running" });
    const done = await this.svc().executeResearch(task, {
      enableWeb: this.webChecked,
      onProgress: (p) => this.renderProgress(p),
      cancelled: () => this.cancelled,
    });
    this.running = false;
    this.pendingPlan = null;
    this.renderDone(done);
  }

  private renderProgress(p: ResearchProgress): void {
    if (!this.progressEl) return;
    const box = this.progressEl;
    box.empty();
    const line = box.createDiv({ cls: "kg-wb-progress-line" });
    line.appendText("第 " + String(Math.min(p.done + p.failed, p.total)) + " / " + String(p.total) + " 步");
    const chips = box.createDiv({ cls: "kg-wb-chips" });
    for (let i = 0; i < p.total; i++) {
      const s = p.steps.find((x) => x.stepIndex === i);
      const mark = s ? (s.error ? "✗" : "✓") : s === undefined ? "○" : "●";
      const chip = chips.createEl("span", { text: mark, cls: "kg-wb-chip" + (s && s.error ? " is-fail" : s ? " is-ok" : " is-empty") });
      if (s) chip.setAttribute("title", (s.toolId || "final") + " " + (s.toolArgsSummary || ""));
    }
    if (p.currentLabel) box.createDiv({ text: "当前：" + p.currentLabel, cls: "kg-wb-current" });
  }

  private renderDone(done: ResearchTask): void {
    if (!this.resultEl) return;
    this.resultEl.empty();
    this.progressEl?.empty();
    const statusText: Record<string, string> = { completed: "研究完成", cancelled: "已取消（未自动写草稿）", failed: "研究失败", paused: "已暂停（可在任务历史恢复）" };
    this.resultEl.createEl("div", { text: statusText[done.status] || done.status, cls: "kg-wb-status-" + done.status });
    if (done.resultSummary) {
      this.resultEl.createEl("h4", { text: "结论要点" });
      this.resultEl.createEl("div", {}, (d) => { void MarkdownRenderer.render(this.app, done.resultSummary || "", d, "", this); });
    }
    if (done.error) this.resultEl.createEl("div", { text: "错误：" + done.error, cls: "kg-wb-error" });
    if (done.steps?.length) {
      this.resultEl.createEl("h4", { text: "执行步骤" });
      const ol = this.resultEl.createEl("ol", { cls: "kg-wb-steps" });
      for (const s of done.steps) ol.createEl("li", { text: s.stepIndex + 1 + ". " + (s.tool || "final") + (s.toolArgs ? " (" + s.toolArgs + ")" : "") });
    }
  }

  /* ================= Project ================= */

  private async runProjectDefinition(topic: string): Promise<void> {
    this.running = true;
    const res = await this.svc().makeProjectDefinition(topic);
    this.running = false;
    if (!res.ok || !res.definition) {
      if (this.resultEl) { this.resultEl.empty(); this.resultEl.createEl("div", { text: "项目定义生成失败：" + (res.error || "未知错误"), cls: "kg-wb-error" }); }
      return;
    }
    this.pendingDefinition = res.definition;
    this.renderDefinitionConfirm(res.definition);
  }

  private renderDefinitionConfirm(def: ProjectDefinitionParsed): void {
    if (!this.resultEl) return;
    this.resultEl.empty();
    this.resultEl.createEl("div", { text: "项目：" + def.name, cls: "kg-wb-plan-title" });
    if (def.goal) this.resultEl.createEl("div", { text: def.goal });
    if (def.goals.length) {
      this.resultEl.createEl("h4", { text: "目标" });
      for (const g of def.goals) this.resultEl.createEl("li", { text: g });
    }
    if (def.questions.length) {
      this.resultEl.createEl("h4", { text: "核心问题" });
      for (const q of def.questions) this.resultEl.createEl("li", { text: q });
    }
    if (def.milestones.length) {
      this.resultEl.createEl("h4", { text: "里程碑" });
      for (const m of def.milestones) this.resultEl.createEl("li", { text: m });
    }
    this.resultEl.createEl("div", { text: "将创建：Knowledge Garden/Projects/" + def.name + "/（README · Questions · Sources · Notes · Drafts）", cls: "kg-wb-preview" });
    const create = this.resultEl.createEl("button", { text: "确认创建项目", cls: "mod-cta" });
    create.addEventListener("click", () => { void this.createProject(); });
  }

  private async createProject(): Promise<void> {
    if (!this.pendingDefinition) return;
    this.running = true;
    const res = await this.svc().createProject(this.pendingDefinition);
    this.running = false;
    this.pendingDefinition = null;
    this.renderCreateResult(res);
  }

  private renderCreateResult(res: WorkbenchCreateResult): void {
    if (!this.resultEl) return;
    this.resultEl.empty();
    if (res.ok) {
      this.resultEl.createEl("div", { text: "项目已创建", cls: "kg-wb-ok" });
      for (const c of res.created) this.resultEl.createEl("div", { text: "✓ " + c, cls: "kg-wb-created" });
    } else {
      this.resultEl.createEl("div", { text: "项目创建部分失败：" + (res.error || ""), cls: "kg-wb-error" });
      for (const f of res.failed) this.resultEl.createEl("div", { text: "✗ " + f, cls: "kg-wb-failed" });
    }
  }

  /* ================= 任务历史 ================= */

  private renderHistory(parent: HTMLElement): void {
    const tasks = this.plugin.taskStore.recent(10);
    if (!tasks.length) return;
    parent.createEl("h4", { text: "最近任务" });
    const list = parent.createEl("ul", { cls: "kg-wb-history" });
    for (const t of tasks) {
      list.createEl("li", {}, (li) => {
        const label = t.mode === "research" ? "研究" : "项目";
        li.createSpan({ text: "[" + label + "] " + (t.title || t.question) + " · " + t.status, cls: "kg-wb-hist-item" });
      });
    }
  }
}

/** Phase 16 §59：@ 笔记 —— Vault File Picker（加入 Context Shelf；0 AI） */
class NoteSuggestModal extends SuggestModal<TFile> {
  constructor(app: App, private plugin: KnowledgeGardenPlugin, private onPick: (f: TFile) => void) { super(app); }
  getSuggestions(query: string): TFile[] {
    const q = query.trim().toLowerCase();
    const files = this.app.vault.getMarkdownFiles().filter((f) => !f.path.includes("/.obsidian/"));
    if (!q) return files.slice(0, 50);
    return files.filter((f) => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q)).slice(0, 50);
  }
  renderSuggestion(f: TFile, el: HTMLElement): void { el.createDiv({ text: f.basename }); el.createDiv({ cls: "suggestion-note", text: f.path }); }
  onChooseSuggestion(f: TFile): void { this.onPick(f); }
}

/** Phase 16 §61：/ Skill —— 可用 Skills 选择器（加入 Context Shelf；0 AI） */
class SkillSuggestModal extends SuggestModal<SkillSummary> {
  constructor(app: App, private plugin: KnowledgeGardenPlugin, private onPick: (s: SkillSummary) => void) { super(app); }
  getSuggestions(query: string): SkillSummary[] {
    const reg = (this.plugin.settings.skillRegistry ?? []).filter((x) => x.enabled);
    const q = query.trim().toLowerCase();
    if (!q) return reg;
    return reg.filter((x) => (x.name || "").toLowerCase().includes(q) || (x.id || "").toLowerCase().includes(q));
  }
  renderSuggestion(s: SkillSummary, el: HTMLElement): void { el.createDiv({ text: s.name || s.id }); if (s.description) el.createDiv({ cls: "suggestion-note", text: s.description }); }
  onChooseSuggestion(s: SkillSummary): void { this.onPick(s); }
}/* ================= Phase 17：Artifact 保存 Modal ================= */

interface ArtifactSaveModalOptions {
  sessionId: string;
  messageId: string;
  suggestTitle: string;
  content: string;
  sources: AIAnswerSource[];
  taskId?: string;
  onSaved: (a: MessageArtifact) => void;
}

class ArtifactSaveModal extends Modal {
  private loc: ArtifactSaveLocation = { kind: "new_note", title: "" };
  private title = "";
  private previewEl: HTMLElement | null = null;
  private overwriteMode = false;
  private readonly messageId: string;
  private readonly taskId?: string;
  private readonly content: string;
  private readonly sources: AIAnswerSource[];

  constructor(app: App, private plugin: KnowledgeGardenPlugin, private opts: ArtifactSaveModalOptions) {
    super(app);
    this.title = opts.suggestTitle;
    this.loc = { kind: "new_note", title: this.title };
    this.messageId = opts.messageId;
    this.taskId = opts.taskId;
    this.content = opts.content;
    this.sources = opts.sources;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "保存 AI 产物（Artifact）" });
    contentEl.createDiv({ cls: "kg-wb-save-hint", text: "0 AI：保存只是把文本写入 Vault，不调用模型。" });
    // 位置选择（§16-24）
    const locBox = contentEl.createDiv({ cls: "kg-wb-save-locs" });
    const locs: { key: string; label: string }[] = [
      { key: "new_note", label: "✍ 新建笔记（Research）" },
      { key: "current_note", label: "📄 当前笔记（追加）" },
      { key: "research", label: "🔬 Research" },
      { key: "project", label: "📁 Project" },
      { key: "inbox", label: "📥 Inbox" },
      { key: "folder", label: "🗂 自定义目录" },
      { key: "clipboard", label: "📋 剪贴板" },
    ];
    const renderLocButtons = (): void => {
      locBox.empty();
      for (const l of locs) {
        const btn = locBox.createEl("button", { text: l.label, cls: "kg-btn kg-wb-save-loc" + (this.locKey() === l.key ? " is-active" : "") });
        btn.addEventListener("click", () => {
          const projectFolder = this.latestProjectFolder();
          const map: Record<string, ArtifactSaveLocation> = {
            new_note: { kind: "new_note", title: this.title },
            current_note: { kind: "current_note" },
            research: { kind: "folder", folder: "Knowledge Garden/Research", title: this.title },
            project: { kind: "folder", folder: projectFolder || "Knowledge Garden/Projects", title: this.title },
            inbox: { kind: "folder", folder: "Knowledge Garden/Inbox", title: this.title },
            folder: { kind: "folder", folder: "Knowledge Garden/Research", title: this.title },
            clipboard: { kind: "clipboard" },
          };
          this.loc = map[l.key];
          renderLocButtons();
          this.renderPreview();
        });
      }
    };
    renderLocButtons();
    // 标题（可编辑 §68）
    const titleRow = contentEl.createDiv({ cls: "kg-wb-save-title" });
    titleRow.createEl("label", { text: "标题：" });
    const titleInput = titleRow.createEl("input", { type: "text", attr: { value: this.title } }) as HTMLInputElement;
    titleInput.addEventListener("input", () => {
      this.title = titleInput.value;
      if (this.loc.kind === "new_note") this.loc = { kind: "new_note", title: this.title };
      else if (this.loc.kind === "folder") this.loc = { kind: "folder", folder: this.loc.folder, title: this.title };
      this.renderPreview();
    });
    // 自定义目录
    const folderRow = contentEl.createDiv({ cls: "kg-wb-save-folder" });
    folderRow.createEl("label", { text: "目录：" });
    const folderInput = folderRow.createEl("input", { type: "text", attr: { value: "Knowledge Garden/Research" } }) as HTMLInputElement;
    folderInput.addEventListener("input", () => {
      if (this.loc.kind === "folder") this.loc = { kind: "folder", folder: folderInput.value.trim() || "Knowledge Garden/Research", title: this.title };
      this.renderPreview();
    });
    this.previewEl = contentEl.createDiv({ cls: "kg-wb-save-preview" });
    this.renderPreview();
    const actions = contentEl.createDiv({ cls: "kg-wb-save-actions" });
    actions.createEl("button", { text: "取消", cls: "kg-btn" }).addEventListener("click", () => this.close());
    actions.createEl("button", { text: "保存", cls: "mod-cta" }).addEventListener("click", () => void this.doSave());
  }

  private locKey(): string {
    if (this.loc.kind === "new_note") return "new_note";
    if (this.loc.kind === "current_note") return "current_note";
    if (this.loc.kind === "clipboard") return "clipboard";
    if (this.loc.kind === "folder") {
      if (this.loc.folder === "Knowledge Garden/Research") return "research";
      if (this.loc.folder === "Knowledge Garden/Inbox") return "inbox";
      const proj = this.latestProjectFolder();
      if (proj && this.loc.folder === proj) return "project";
      return "folder";
    }
    return "new_note";
  }

  private latestProjectFolder(): string | null {
    const ps = this.plugin.projectStore.projects;
    if (!ps || ps.length === 0) return null;
    const latest = [...ps].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return latest.rootFolder ?? "Knowledge Garden/Projects/" + latest.name;
  }

  private latestProjectId(): string | undefined {
    const ps = this.plugin.projectStore.projects;
    if (!ps || ps.length === 0) return undefined;
    return [...ps].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  }

  private renderPreview(): void {
    if (!this.previewEl) return;
    this.previewEl.empty();
    const rel = artifactRelPath(this.loc);
    const pathText = this.loc.kind === "current_note" ? "（当前活动笔记，追加到末尾）" : this.loc.kind === "clipboard" ? "（剪贴板，不建索引）" : rel ?? "（非法路径）";
    this.previewEl.createDiv({ text: "📄 标题：" + cleanArtifactTitle(this.title) });
    this.previewEl.createDiv({ text: "📍 路径：" + pathText });
    const contentBox = this.previewEl.createDiv({ cls: "kg-wb-save-content" });
    contentBox.createDiv({ text: "内容预览（前 300 字）：" });
    contentBox.createDiv({ text: this.content.slice(0, 300) + (this.content.length > 300 ? " …" : ""), cls: "kg-wb-save-snippet" });
    this.previewEl.createDiv({ text: "📚 来源 " + this.sources.length + " 条（随内容一并保存）" });
    if (rel && this.loc.kind !== "current_note" && this.loc.kind !== "clipboard") {
      const exists = existsAt(this.app, rel);
      this.previewEl.createDiv({ text: exists ? "⚠ 目标已存在（默认不覆盖；可「查看 Diff 后覆盖」）" : "✓ 目标不存在，可直接创建", cls: exists ? "kg-wb-error" : "kg-wb-ok" });
    }
  }

  private async doSave(): Promise<void> {
    const projectId = this.locKey() === "project" ? this.latestProjectId() : undefined;
    const req = {
      messageId: this.messageId,
      taskId: this.taskId,
      title: this.title,
      content: this.content,
      sources: this.sources,
      artifactType: "answer" as ArtifactType,
      location: this.loc,
      workspaceId: this.plugin.currentWorkspace()?.id,
      projectId,
      overwrite: this.overwriteMode,
    };
    const res = await saveArtifact(this.app, req);
    if (res.conflict && res.conflictPath && !this.overwriteMode) {
      new DiffConfirmModal(this.app, res.conflictPath, this.content, () => {
        this.overwriteMode = true;
        void this.doSave();
      }).open();
      return;
    }
    if (!res.ok || !res.artifact) {
      new Notice("保存失败：" + (res.error || "未知错误"));
      return;
    }
    // 剪贴板不入索引（§82 Dashboard 只列 Vault 保存）
    if (res.vaultPath !== "(clipboard)") this.plugin.artifactStore.register(res.artifact);
    this.opts.onSaved(res.artifact);
    this.close();
  }
}

/** §70：覆盖必须 Diff 确认（旧内容 vs 新内容分栏展示） */
class DiffConfirmModal extends Modal {
  constructor(app: App, private relPath: string, private newContentRaw: string, private onOverwrite: () => void) {
    super(app);
  }
  onOpen(): void {
    void (async () => {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.createEl("h3", { text: "覆盖确认（Diff）" });
      contentEl.createEl("div", { text: "目标已存在：" + this.relPath, cls: "kg-wb-error" });
      contentEl.createDiv({ text: "默认不覆盖（§69）。确认旧内容后可选择覆盖写入。", cls: "kg-wb-save-hint" });
      const oldText = await readExistingAt(this.app, this.relPath);
      const cols = contentEl.createDiv({ cls: "kg-wb-diff" });
      const oldCol = cols.createDiv({ cls: "kg-wb-diff-col" });
      oldCol.createEl("h4", { text: "旧内容" });
      oldCol.createDiv({ text: (oldText ?? "").slice(0, 1500) + ((oldText ?? "").length > 1500 ? " …" : ""), cls: "kg-wb-diff-text" });
      const newCol = cols.createDiv({ cls: "kg-wb-diff-col" });
      newCol.createEl("h4", { text: "新内容（前 1500 字）" });
      newCol.createDiv({ text: this.newContentRaw.slice(0, 1500) + (this.newContentRaw.length > 1500 ? " …" : ""), cls: "kg-wb-diff-text" });
      const actions = contentEl.createDiv({ cls: "kg-wb-save-actions" });
      actions.createEl("button", { text: "取消", cls: "kg-btn" }).addEventListener("click", () => this.close());
      actions.createEl("button", { text: "确认覆盖", cls: "mod-cta" }).addEventListener("click", () => { this.onOverwrite(); this.close(); });
    })();
  }
}