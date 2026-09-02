/**
 * Phase 11：笔记右键 AI 工具箱（§十七~一百三十）。
 * - 右键菜单只是入口（§十八）：5 项 = ✦ 提炼到知识库 / 🔗 以此笔记探索关联 / 🌐 翻译 / ✎ 文案生成/改写 / ✓ 标记为已复习（§一百九十六顺序）。
 * - 不覆盖原生菜单（§一百九十五）：通过 workspace "editor-menu" / "page-menu" 事件追加菜单项。
 * - Selection snapshot 在菜单创建时捕获（§一百一十五），不事后猜 selection。
 * - Reading 模式无 Editor：用 vault.cachedRead；翻译/文案输出 Preview / 新建笔记，默认不替换阅读视图 DOM（§一百一十七/一百一十八）。
 * - 所有 AI 操作异步执行，绝不阻塞 UI（§一百零七）。
 * - 模型由 Plugin 的 AIFunctionRoute 决定，本文件不碰 settings.ai.model（§七十九）。
 * - 缓存：翻译/文案的 cache key 由调用方构造（含用户输入/路由相关部件，§八十一~一百零二）；
 *   调用 plugin.ai.generateForFeature(feature, messages, { customKeyParts, maxTokens })。
 */
import { App, Component, Editor, Menu, Modal, Notice, Setting, TFile, TFolder, MarkdownView, ToggleComponent, TextAreaComponent } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import { buildTranslationSystem, WRITING_TASKS, buildWritingAssistantSystem, WRITING_PROMPT_VERSION, writingTaskLabel } from "./prompts";
import { collectWebContext, fingerprintWeb } from "./webContext";
import { savedFingerprint } from "./savedExploration";
import { parseQuery } from "./queryExplorer";
import { QUERY_NODE_PATH, normalizeQueryResult, type GraphModel } from "./knowledgeGraph";
import { computeGraphLayout } from "./graphLayout";
import { GraphSvg } from "./graphSvg";
import { fingerprintKey } from "./ai/cache";
import { workspaceInstructions, workspaceFingerprint } from "./workspace";
import { buildSkillInstructions, skillCachePart } from "./skills";
import { resolveAIFunctionRouteWithWorkspace } from "./aiRouting";
import { requiresPlan, buildPlanSystem, buildPlanUserRequest, parsePlanText, buildPlanFinalInstruction, PLAN_PROMPT_VERSION } from "./plan";
import { createEditProposal, detectConflict, lineDiff } from "./safeApply";
import { ANCHOR_COUNT_DEFAULT, ANCHOR_LOCAL_LIMIT_DEFAULT, anchorScopePaths, anchorTokens, buildAnchorCacheKey } from "./anchorExplorer";
import type { AIFeature, QueryExplorationResult } from "./types";
import { promptFingerprint } from "./promptLibrary";
import { LatencyTracker } from "./latency";
import { PromptLibraryModal, PromptSaveModal } from "./promptLibraryUi";

/** 右键时的菜单上下文快照（§二十/一百一十五：创建菜单时捕获，点击回调只读快照） */
export interface NoteMenuContext {
  file: TFile;
  editor: Editor | null;
  selectedText: string;
  selStart?: number;
  selEnd?: number;
}

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? md.slice(m[0].length) : md;
}
function frontmatterBlock(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? m[0] : "";
}
function textHash(text: string): string {
  return fingerprintKey([text.slice(0, 4000)]);
}
function uniquePath(base: string, exists: (p: string) => boolean): string {
  if (!exists(base)) return base;
  let n = 2;
  while (exists(base.replace(/\.md$/, "-" + n + ".md"))) n++;
  return base.replace(/\.md$/, "-" + n + ".md");
}

/** Anchor 结果 → GraphModel（复用 normalizeQueryResult 校验，再剥掉「用户问题」中心节点：Anchor 中心 = 当前笔记本身，§三十九） */
function anchorGraphModel(raw: QueryExplorationResult, key: string): GraphModel | null {
  const m = normalizeQueryResult(raw, key, raw.headline ?? "以笔记探索关联");
  if (!m) return null;
  const nodes = m.nodes.filter((n) => n.id !== QUERY_NODE_PATH);
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = m.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && !e.from.startsWith(QUERY_NODE_PATH));
  return { ...m, nodes, edges };
}

export class NoteToolbox extends Component {
  private plugin: KnowledgeGardenPlugin;

  constructor(private app: App, plugin: KnowledgeGardenPlugin) {
    super();
    this.plugin = plugin;
  }

  registerMenuHandlers(): void {
    // 编辑模式：笔记内右键（§一百一十五：创建菜单时捕获 selection snapshot）
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const file = view.file;
        if (!(file instanceof TFile)) return;
        const sel = editor.getSelection() || "";
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        const ctx: NoteMenuContext = {
          file,
          editor,
          selectedText: sel,
          selStart: sel ? editor.posToOffset(from) : undefined,
          selEnd: sel ? editor.posToOffset(to) : undefined,
        };
        this.populate(menu, ctx);
      })
    );
    // 阅读模式 / 页面：无 Editor（§一百一十七）
    this.registerEvent(
      (this.app.workspace as any).on("page-menu", (menu: Menu, view: MarkdownView | null) => {
        if (!(view instanceof MarkdownView)) return;
        const file = view.file;
        if (!(file instanceof TFile)) return;
        this.populate(menu, { file, editor: null, selectedText: "" });
      })
    );
    // 文件浏览器右键（可选入口，同一菜单，§一百九十五：不覆盖原生菜单）
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile)) return;
        this.populate(menu, { file, editor: null, selectedText: "" });
      })
    );
  }

  private isInKnowledgeFolder(path: string): boolean {
    const f = this.plugin.settings.capture.knowledgeFolder.replace(/[\\/]+$/, "").toLowerCase();
    return f !== "" && path.toLowerCase().startsWith(f + "/");
  }
  private isInInboxFolder(path: string): boolean {
    const f = this.plugin.settings.capture.inboxFolder.replace(/[\\/]+$/, "").toLowerCase();
    return f !== "" && path.toLowerCase().startsWith(f + "/");
  }

  private populate(menu: Menu, ctx: NoteMenuContext): void {
    // Phase 14 §一百七十一：📝 构建知识考试（放菜单最前，符合「最终菜单」顺序；打开构建器 0 AI）
    menu.addItem((item) =>
      item
        .setTitle("📝 构建知识考试")
        .setIcon("graduation-cap")
        .onClick(() => void this.plugin.openExamBuilder(ctx.file))
    );
    const label = this.isInKnowledgeFolder(ctx.file.path) ? "✦ 整理 / 提炼此知识" : "✦ 提炼到知识库";
    menu.addItem((item) =>
      item
        .setTitle(label)
        .setIcon("pencil")
        .onClick(() => void this.runRefine(ctx))
    );
    menu.addItem((item) =>
      item
        .setTitle("🔗 以此笔记探索关联")
        .setIcon("link")
        .onClick(() => void this.runAnchor(ctx))
    );
    // Phase 12 §八十三/八十四：💡 应用构思 / ❓ 研究问题 快捷（复用写作助手，任务预设 + 默认上下文）
    menu.addItem((item) =>
      item
        .setTitle("💡 从这篇知识想想还能怎么用")
        .setIcon("lightbulb")
        .onClick(() => this.runQuickApplication(ctx))
    );
    menu.addItem((item) =>
      item
        .setTitle("❓ 从这篇知识提出更好的问题")
        .setIcon("help-circle")
        .onClick(() => this.runQuickResearchQuestion(ctx))
    );
    menu.addItem((item) =>
      item
        .setTitle("✎ AI 写作助手")
        .setIcon("pen-tool")
        .onClick(() => this.openWritingAssistantForCtx(ctx))
    );
    menu.addItem((item) =>
      item
        .setTitle("🌐 翻译")
        .setIcon("globe")
        .onClick(() => this.openTranslation(ctx))
    );
    menu.addItem((item) =>
      item
        .setTitle("✓ 标记为已复习")
        .setIcon("check-circle")
        .onClick(() => void this.markReviewed(ctx))
    );
  }

  private async readNoteBody(path: string): Promise<{ md: string; body: string; fm: string }> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error("笔记不存在：" + path);
    const md = await this.app.vault.cachedRead(f);
    return { md, body: stripFrontmatter(md), fm: frontmatterBlock(md) };
  }

  // ---------- ① 提炼到知识库（§二十三~二十九：复用 knowledgeProcessor + knowledge_processing 缓存；绝不覆盖当前笔记） ----------
  private async runRefine(ctx: NoteMenuContext): Promise<void> {
    const isKnowledge = this.isInKnowledgeFolder(ctx.file.path);
    const isInbox = this.isInInboxFolder(ctx.file.path);
    if (isInbox) {
      // §二十八：已有 Capture 时优先「处理此捕获」，但保留「提炼到知识库」快捷入口
      new Notice("当前是捕获笔记：可打开后执行「处理当前捕获」优先走 AI 提炼链路；「提炼到知识库」同样可用。");
    }
    if (isKnowledge) {
      new Notice("当前已是 Knowledge：将作为新知识的来源提炼（生成新候选，绝不覆盖当前笔记；最终目标 Area 由你在确认时决定）。");
    }
    try {
      await this.plugin.refineNoteToKnowledge(ctx.file.path, { sourceKind: isKnowledge ? "knowledge" : isInbox ? "capture" : "note" });
    } catch (e) {
      new Notice("提炼失败：" + String((e as Error)?.message || e));
    }
  }

  // ---------- ② 以笔记探索关联（§三十~四十一：Anchor → 本地产检 → AI 关联 → 图） ----------
  private runAnchor(ctx: NoteMenuContext): void {
    new AnchorExplorationModal(this.app, this.plugin, ctx.file.path).open();
  }

  private markReviewed(_ctx: NoteMenuContext): Promise<void> {
    return this.plugin.markReviewed();
  }

  /** 供命令「以当前笔记探索关联」使用（§十六） */
  openAnchor(path: string): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { new Notice("笔记不存在：" + path); return; }
    new AnchorExplorationModal(this.app, this.plugin, f.path).open();
  }

  /** Phase 12 §十五：Saved Anchor 收藏「基于此链路重新探索」——恢复起点笔记 + 范围（0 AI，不自动请求） */
  openAnchorFromSaved(path: string, scopeMode: "vault" | "discovery"): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { new Notice("起始笔记不存在：" + path); return; }
    new AnchorExplorationModal(this.app, this.plugin, f.path, scopeMode).open();
  }

  /** Phase 12 §八十七：命令面板入口——AI 写作助手（当前笔记） */
  openWritingAssistant(path: string): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { new Notice("当前没有打开的笔记。"); return; }
    new WritingAssistantModal(this.app, this.plugin, { file: f, editor: null, selectedText: "" }, { task: "custom", autoRun: false }).open();
  }

  /** Phase 12 §八十三：💡 知识应用快捷（默认当前笔记 + 相关知识，自动生成） */
  runQuickApplication(ctx: NoteMenuContext): void {
    new WritingAssistantModal(this.app, this.plugin, ctx, { task: "application", context: "note+related", autoRun: true }).open();
  }

  /** Phase 12 §八十四：❓ 研究问题快捷（有选中用选中文本，否则当前笔记；自动生成） */
  runQuickResearchQuestion(ctx: NoteMenuContext): void {
    new WritingAssistantModal(this.app, this.plugin, ctx, { task: "research_question", context: ctx.selectedText ? "selection" : "note", autoRun: true }).open();
  }

  // ---------- ③ 翻译（§四十二~五十一） ----------
  private openTranslation(ctx: NoteMenuContext): void {
    new TranslationModal(this.app, this.plugin, ctx).open();
  }

  // ---------- ④ AI 写作助手（Phase 12 §二十四~八十一） ----------
  private openWritingAssistantForCtx(ctx: NoteMenuContext): void {
    new WritingAssistantModal(this.app, this.plugin, ctx).open();
  }
}

// ================= 翻译 Modal（§四十三~五十一） =================
class TranslationModal extends Modal {
  private targetLanguage = "中文";
  private style = "自然";
  private preserveMarkdown = true;
  private keepWikiLinks = true;
  private translateCodeBlocks = false;
  private result: string | null = null;
  private busy = false;
  private boxEl!: HTMLElement;

  constructor(
    app: App,
    private plugin: KnowledgeGardenPlugin,
    private ctx: NoteMenuContext
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const hasSelection = !!this.ctx.selectedText;
    contentEl.createEl("h3", { text: "🌐 翻译" });
    if (hasSelection) {
      contentEl.createDiv({ cls: "kg-toolbox-note", text: "对象：选中文本（" + this.ctx.selectedText.length + " 字）" });
    } else {
      contentEl.createDiv({ cls: "kg-toolbox-note", text: "未检测到选中文本，将对整篇笔记执行此操作（§二十二）。" });
    }
    new Setting(contentEl).setName("目标语言").addText((t) => t.setPlaceholder("例如：中文 / English / Japanese").setValue("中文").onChange((v) => { this.targetLanguage = v.trim() || "中文"; }));
    new Setting(contentEl).setName("风格").addText((t) => t.setPlaceholder("自然 / 学术 / 口语 等").setValue("自然").onChange((v) => { this.style = v.trim() || "自然"; }));
    new Setting(contentEl).setName("保留 Markdown 结构").addToggle((t) => t.setValue(true).onChange((v) => { this.preserveMarkdown = v; }));
    new Setting(contentEl).setName("保留 WikiLink [[...]]").addToggle((t) => t.setValue(true).onChange((v) => { this.keepWikiLinks = v; }));
    new Setting(contentEl).setName("代码块不翻译").addToggle((t) => t.setValue(true).onChange((v) => { this.translateCodeBlocks = !v; })).setDesc("代码块默认保持原样（仅注释/字符串可译）");
    const runBtn = contentEl.createEl("button", { cls: "kg-btn kg-btn-primary", text: "翻译" });
    runBtn.addEventListener("click", () => void this.run(runBtn));
    this.boxEl = contentEl.createDiv({ cls: "kg-toolbox-out" });
    this.boxEl.style.display = "none";
  }

  private async run(btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const old = btn.textContent;
    btn.textContent = "进行中…";
    btn.setAttribute("disabled", "true");
    try {
      const source = this.ctx.selectedText || (await readNoteBodySafe(this.ctx.file.path, this.app)).body;
      if (!source.trim()) { new Notice("没有可翻译的内容。"); return; }
      const messages = [
        { role: "system" as const, content: buildTranslationSystem({
          source,
          targetLanguage: this.targetLanguage,
          style: this.style,
          preserveMarkdown: this.preserveMarkdown,
          keepWikiLinks: this.keepWikiLinks,
          translateCodeBlocks: this.translateCodeBlocks,
          mode: this.ctx.selectedText ? ("selection" as const) : ("full" as const),
        }) },
        { role: "user" as const, content: "请执行翻译，只输出译文本身。" },
      ];
      const customKeyParts = [
        "src-hash:" + textHash(source),
        "lang:" + this.targetLanguage,
        "style:" + this.style,
        "md:" + (this.preserveMarkdown ? "1" : "0"),
        "wiki:" + (this.keepWikiLinks ? "1" : "0"),
        "code:" + (this.translateCodeBlocks ? "1" : "0"),
      ];
      const outcome = await this.plugin.ai.generateForFeature("translation", messages, { customKeyParts, maxTokens: 2000 });
      if (!outcome.ok) { new Notice("翻译失败：" + outcome.error.message); return; }
      this.result = outcome.data;
      this.renderOutput();
    } catch (e) {
      new Notice("翻译出错：" + String((e as Error)?.message || e));
    } finally {
      this.busy = false;
      btn.textContent = old;
      btn.removeAttribute("disabled");
    }
  }

  private renderOutput(): void {
    this.boxEl.empty();
    this.boxEl.style.display = "";
    this.boxEl.createDiv({ cls: "kg-ai-label", text: "翻译结果" });
    const pre = this.boxEl.createEl("pre", { cls: "kg-toolbox-result" });
    pre.textContent = this.result ?? "";
    const row = this.boxEl.createDiv({ cls: "kg-toolbox-actions" });
    row.createEl("button", { cls: "kg-btn", text: "复制" }).addEventListener("click", () => {
      void navigator.clipboard.writeText(this.result ?? "").then(() => new Notice("已复制翻译结果。")).catch(() => new Notice("复制失败，请手动选择复制。"));
    });
    row.createEl("button", { cls: "kg-btn", text: "新建翻译笔记" }).addEventListener("click", () => void this.createNewNote());
    if (this.ctx.selectedText && this.ctx.editor && this.ctx.selStart !== undefined && this.ctx.selEnd !== undefined) {
      row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "替换选中文本" }).addEventListener("click", () => {
        // §五十：只有用户明确点击才 editor.replaceSelection（不修改阅读视图 DOM）
        const ed = this.ctx.editor;
        if (!ed) return;
        // Phase 13 §六十四：Apply 前冲突检测（AI 生成期间原文被修改 → 不直接覆盖）
        const current = ed.getSelection() || "";
        const proposal = createEditProposal(this.ctx.file.path, this.ctx.selectedText || "", this.result ?? "", "replace_selection");
        if (detectConflict(proposal, current)) {
          new ConflictModal(this.app, { original: this.ctx.selectedText || "", proposed: this.result ?? "", current }).open();
          return;
        }
        ed.replaceSelection(this.result ?? "");
        new Notice("已替换选中文本。");
      });
    }
  }

  private async createNewNote(): Promise<void> {
    const sourceBody = this.ctx.selectedText ? "" : (await readNoteBodySafe(this.ctx.file.path, this.app)).fm;
    const label = sanitizeFileName(this.targetLanguage);
    const dir = this.ctx.file.path.includes("/") ? this.ctx.file.path.slice(0, this.ctx.file.path.lastIndexOf("/")) : "";
    const base = dir ? dir + "/" : "";
    const name = (this.ctx.file.basename || "翻译") + " [Translated-" + label + "].md";
    const target = uniquePath(base + name, (p) => !!this.app.vault.getAbstractFileByPath(p));
    await this.app.vault.create(target, sourceBody + (this.result ?? "") + "\n");
    new Notice("已新建翻译笔记：" + target);
  }
}

// ================= 文案 Modal（§五十二~六十八） =================
/** ================= AI 写作助手 Modal（Phase 12 §二十四~八十一） =================
 * - 目的（§二十七 WRITING_TASKS 15 项：学术表达/论证与结构/批判性分析/文献综合/研究问题/假设构建/
 *   解释（讲清楚）/知识迁移与应用/启发式头脑风暴/反方观点/创意写作/普通改写/润色/摘要/自定义）。
 * - 上下文多选（§五十六~五十九 默认☑选中文本）：选中文本 / 当前整篇笔记 / 相关知识（≤8 篇，§五十八）/
 *   已确认关系 / 收藏链路（最近 ≤2 条，§五十九）。
 * - 受众（§四十八）/ 风格（§四十七）/ 长度（§四十九）/ 结构控制（§五十）/ 输出格式（§六十七）/ 附来源（§六十六）。
 * - 联网（§六十三 默认 OFF；网页仅参考 + SECURITY_BLOCK §九十二）；缓存 key 含 task/src/ctx/instr/模型/Web（§七十五~七十九）。
 * - 输出：复制 / 插入当前位置 / 替换选中（仅 Editor，§九十）/ 新建笔记 / 保存为研究笔记（§七十~七十三：type: research-draft，
 *   不伪造 author/publication/DOI；不进 Knowledge / Evolution / Activity）。
 */
class WritingAssistantModal extends Modal {
  private task = "academic";
  private language = "中文";
  private audience = "通用";
  private audienceCustom = "";
  private style = "研究笔记";
  private styleCustom = "";
  private length = "中";
  private lengthCustom = "";
  private structure: "keep" | "restructure" | "free" = "keep";
  private outputFormat: "markdown" | "text" | "json" = "markdown";
  private includeSources = false;
  private instruction = "";
  private ctxSel = true;
  private ctxNote = false;
  private ctxRelated = false;
  private ctxRel = false;
  private ctxSaved = false;
  private webMode: "off" | "url" | "provider" = "off";
  private urls = "";
  private result: string | null = null;
  private sourceNote: string | null = null;
  private sources: string[] = [];
  private webPages: { url: string; text: string }[] = [];
  private busy = false;
  private boxEl!: HTMLElement;
  private urlAreaEl: HTMLElement | null = null;
  private audInputEl: HTMLElement | null = null;
  private styleInputEl: HTMLElement | null = null;
  private lenInputEl: HTMLElement | null = null;
  private includeSrcEl: HTMLElement | null = null;
  private autoRun = false;
  /** Phase 13 §十/§一百零八：Workspace 选择（null = 不使用，保持现有行为） */
  private wsId: string | null = null;
  /** Phase 13 §一百零八：选中的 Skill（Manual Selection） */
  private skills: string[] = [];
  /** Phase 13 §一百三十五：复杂任务先制定计划 */
  private planOn = false;
  private planResult: { feature: AIFeature; steps: string[] } | null = null;
  private modelLabelEl: HTMLElement | null = null;
  private skillTogglesEl: HTMLElement | null = null;
  /** Phase 16 §二十五：Fast / Deep 模式（默认 Fast；Deep 才允许整篇/相关/Workspace/Skill/Web） */
  private mode: "fast" | "deep" = "fast";
  /** Phase 16 §九~十七：当前 Prompt Library 选择（null = 未使用） */
  private promptId: string | null = null;
  /** Phase 16 §二十八：取消（AbortController） */
  private abortCtrl: AbortController | null = null;
  private forceRun = false;
  private modeFastEl: HTMLElement | null = null;
  private modeDeepEl: HTMLElement | null = null;
  private promptSelEl: HTMLSelectElement | null = null;
  private promptFavBtnEl: HTMLElement | null = null;
  private deepOnlyAreaEl: HTMLElement | null = null;
  private instrInputEl: TextAreaComponent | null = null;
  private liveEl: HTMLElement | null = null;
  private runBtnEl: HTMLButtonElement | null = null;
  private cancelBtnEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: KnowledgeGardenPlugin,
    private ctx: NoteMenuContext,
    preset?: { task?: string; context?: "selection" | "note" | "note+related"; autoRun?: boolean }
  ) {
    super(app);
    if (preset && preset.task) this.task = preset.task;
    if (preset && preset.context === "selection") { this.ctxSel = true; this.ctxNote = false; this.ctxRelated = false; }
    else if (preset && preset.context === "note") { this.ctxSel = false; this.ctxNote = true; this.ctxRelated = false; }
    else if (preset && preset.context === "note+related") { this.ctxSel = false; this.ctxNote = true; this.ctxRelated = true; }
    this.autoRun = !!(preset && preset.autoRun);
    // Phase 16 §二十四：快捷入口（整篇/相关知识）默认进入深度模式；普通打开默认快速
    if (preset && preset.context && preset.context !== "selection") this.mode = "deep";
    this.wsId = plugin.settings.currentWorkspaceId;
    const curWs = plugin.currentWorkspace();
    this.skills = curWs && curWs.skills ? curWs.skills.slice() : [];
  }

  /** Phase 13 §一百零八：Skill 手动选择（仅显示 enabled） */
  private refreshSkillToggles(): void {
    if (!this.skillTogglesEl) return;
    this.skillTogglesEl.empty();
    const registry = this.plugin.settings.skillRegistry ?? [];
    for (const s of registry) {
      if (!s.enabled) continue;
      const chip = this.skillTogglesEl.createSpan({ cls: "kg-toolbox-chip" });
      const cb = chip.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = this.skills.includes(s.id);
      cb.addEventListener("change", () => {
        if (cb.checked) { if (!this.skills.includes(s.id)) this.skills.push(s.id); }
        else { this.skills = this.skills.filter((x) => x !== s.id); }
      });
      chip.createSpan({ text: s.name });
    }
    if (registry.filter((x) => x.enabled).length === 0) {
      this.skillTogglesEl.createSpan({ cls: "kg-toolbox-note", text: "（无可用 Skill，可在设置中启用内置 Skills）" });
    }
  }

  /** Phase 13 §一百二十一：Model 显示（实际路由模型，由 Profile/Workspace/Feature 决定） */
  private refreshModelLabel(): void {
    if (!this.modelLabelEl) return;
    const def = WRITING_TASKS.find((x) => x.value === this.task);
    const feature = (def?.feature ?? "writing_copy") as AIFeature;
    const ws = this.wsId ? this.plugin.settings.workspaces.find((x) => x.id === this.wsId) : undefined;
    const r = resolveAIFunctionRouteWithWorkspace(
      feature,
      this.plugin.settings.aiProfiles ?? [],
      this.plugin.settings.aiFunctionConfig ?? [],
      ws,
      undefined,
      this.plugin.settings.defaultProfileId
    );
    this.modelLabelEl.setText("Model：" + (r.model || "（未配置 AI Profile）") + " · Profile：" + r.profileId);
  }

  /** Phase 13 §一百二十二：上下文摘要（默认折叠，展示实际发送的来源） */
  private contextSummaryLine(): string {
    const parts: string[] = [];
    if (this.ctxSel && this.ctx.selectedText) parts.push("Selection " + this.ctx.selectedText.length);
    if (this.ctxNote) parts.push("Current Note");
    if (this.ctxRelated) parts.push("Related(≤8)");
    if (this.ctxRel) parts.push("Confirmed Relations");
    if (this.ctxSaved) parts.push("Saved Exploration(≤2)");
    if (this.webMode === "url") parts.push("Web");
    if (!this.ctxSel && !this.ctxNote) parts.push("（仅发送默认源：选中或整篇内容）");
    return "Context：" + (parts.length ? parts.join(" / ") : "—") + " · 默认折叠，点击展开可查看实际发送内容。";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "✎ AI 写作助手" });
    // Phase 16 §二十五~二十六：Mode 切换 + Prompt Library（§九~十七）
    const modeRow = contentEl.createDiv({ cls: "kg-toolbox-row" });
    modeRow.createSpan({ cls: "kg-review-qlabel", text: "Mode：" });
    this.modeFastEl = modeRow.createEl("button", { cls: "kg-btn kg-btn-primary", text: "⚡ 快速" });
    this.modeDeepEl = modeRow.createEl("button", { cls: "kg-btn", text: "🧠 深度" });
    this.modeFastEl.addEventListener("click", () => this.setMode("fast"));
    this.modeDeepEl.addEventListener("click", () => this.setMode("deep"));
    const promptRow = contentEl.createDiv({ cls: "kg-toolbox-row" });
    promptRow.createSpan({ cls: "kg-review-qlabel", text: "Prompt：" });
    this.promptSelEl = promptRow.createEl("select", { cls: "kg-select", attr: { "aria-label": "提示词库" } });
    this.refreshPromptSelect();
    this.promptSelEl.addEventListener("change", () => this.applyPrompt(this.promptSelEl ? this.promptSelEl.value || null : null));
    this.promptFavBtnEl = promptRow.createEl("button", { cls: "kg-btn", text: "☆ 收藏为提示词" });
    this.promptFavBtnEl.addEventListener("click", () => void this.togglePromptFavorite());
    promptRow.createEl("button", { cls: "kg-btn", text: "管理" }).addEventListener("click", () => {
      new PromptLibraryModal(this.app, this.plugin, (id) => this.applyPrompt(id)).open();
    });
    this.deepOnlyAreaEl = contentEl.createDiv();
    this.deepOnlyAreaEl.style.display = "none";
    if (this.ctx.selectedText) {
      contentEl.createDiv({ cls: "kg-toolbox-note", text: "对象：选中文本（" + this.ctx.selectedText.length + " 字）" });
    } else {
      contentEl.createDiv({ cls: "kg-toolbox-note", text: "未检测到选中文本，将使用当前笔记作为上下文（§八十八 提示：不自动覆盖原文）。" });
    }
    // Phase 13 §一百二十一：Workspace | Skill | Model 顶部统一
    const topRow = this.deepOnlyAreaEl.createDiv({ cls: "kg-toolbox-row" });
    topRow.createSpan({ cls: "kg-review-qlabel", text: "当前空间：" });
    const wsSel = topRow.createEl("select", { cls: "kg-select", attr: { "aria-label": "当前工作空间" } });
    wsSel.createEl("option", { value: "", text: "默认（不使用 Workspace）" });
    for (const w of this.plugin.settings.workspaces) wsSel.createEl("option", { value: w.id, text: w.name });
    wsSel.value = this.wsId ?? "";
    wsSel.addEventListener("change", () => {
      this.wsId = wsSel.value || null;
      const ws = this.wsId ? this.plugin.settings.workspaces.find((x) => x.id === this.wsId) : undefined;
      this.skills = ws && ws.skills ? ws.skills.slice() : [];
      this.refreshSkillToggles();
      this.refreshModelLabel();
    });
    const skillRow = this.deepOnlyAreaEl.createDiv({ cls: "kg-toolbox-row" });
    skillRow.createSpan({ cls: "kg-review-qlabel", text: "Skill：" });
    this.skillTogglesEl = skillRow.createDiv({ cls: "kg-toolbox-inline" });
    this.refreshSkillToggles();
    this.modelLabelEl = this.deepOnlyAreaEl.createDiv({ cls: "kg-toolbox-note" });
    this.refreshModelLabel();
    // Context Preview（§一百二十二~一百二十三：默认折叠）
    const ctxDetails = this.deepOnlyAreaEl.createEl("details");
    ctxDetails.createEl("summary", { text: "Context Preview（默认折叠）" });
    ctxDetails.createDiv({ cls: "kg-toolbox-note", text: this.contextSummaryLine() });
    new Setting(this.deepOnlyAreaEl).setName("先制定计划（Plan Mode）").setDesc("仅复杂任务（文献综合/研究问题/批判性分析/论证/提炼）支持；先预览计划，确认后才执行（§七十/七十二/一百三十六）。")
      .addToggle((t) => t.setValue(this.planOn).onChange((v) => { this.planOn = v; }));
    // 目的（§二十七）
    new Setting(contentEl).setName("目的").addDropdown((d) => {
      for (const x of WRITING_TASKS) d.addOption(x.value, x.label);
      d.setValue(this.task).onChange((v) => { this.task = v; this.refreshModelLabel(); });
    });
    // 上下文多选（§五十六~五十九；§一百一十：默认只发选中文本）
    new Setting(contentEl).setName("上下文").setDesc("⚡ 快速模式只发送选中文本；整篇 / 相关 / 已确认关系 / 收藏链路仅🧠深度模式可用（§二十二/二十四）。").addToggle((tg) => tg.setValue(this.ctxSel).setTooltip("选中文本").onChange((v) => { this.ctxSel = v; }));
    new Setting(this.deepOnlyAreaEl).setName("上下文（深度模式）").setDesc("整篇笔记 / 相关知识（≤8）/ 已确认关系 / 收藏链路仅在🧠深度模式发送（§二十四）。").addToggle((tg) => tg.setValue(this.ctxNote).setTooltip("当前整篇笔记").onChange((v) => { this.ctxNote = v; }))
      .addToggle((tg) => tg.setValue(this.ctxRelated).setTooltip("相关知识（≤8 篇）").onChange((v) => { this.ctxRelated = v; }))
      .addToggle((tg) => tg.setValue(this.ctxRel).setTooltip("已确认关系（user_confirmed）").onChange((v) => { this.ctxRel = v; }))
      .addToggle((tg) => tg.setValue(this.ctxSaved).setTooltip("收藏链路（最近 ≤2 条）").onChange((v) => { this.ctxSaved = v; }));
    // 受众（§四十八）
    new Setting(contentEl).setName("受众").addDropdown((d) => {
      const opts = ["通用", "研究者", "学生", "开发者", "管理者", "普通读者", "专业读者", "自定义"];
      for (const o of opts) d.addOption(o, o);
      d.setValue(this.audience).onChange((v) => {
        this.audience = v;
        if (this.audInputEl) this.audInputEl.style.display = v === "自定义" ? "" : "none";
        if (v === "自定义") this.audience = this.audienceCustom || "通用";
      });
    });
    this.audInputEl = contentEl.createDiv({ cls: "kg-toolbox-hidden" });
    this.audInputEl.style.display = "none";
    new Setting(this.audInputEl).setName("自定义受众").addText((t) => t.onChange((v) => { this.audienceCustom = v.trim(); if (this.audience === "自定义") this.audience = v.trim() || "通用"; }));
    // 风格（§四十七）
    new Setting(contentEl).setName("风格").addDropdown((d) => {
      const opts = ["学术论文", "研究笔记", "技术说明", "教学解释", "批判性文章", "科普", "思想随笔", "项目提案", "自定义"];
      for (const o of opts) d.addOption(o, o);
      d.setValue(this.style).onChange((v) => {
        this.style = v;
        if (this.styleInputEl) this.styleInputEl.style.display = v === "自定义" ? "" : "none";
        if (v === "自定义") this.style = this.styleCustom || "研究笔记";
      });
    });
    this.styleInputEl = contentEl.createDiv({ cls: "kg-toolbox-hidden" });
    this.styleInputEl.style.display = "none";
    new Setting(this.styleInputEl).setName("自定义风格").addText((t) => t.onChange((v) => { this.styleCustom = v.trim(); if (this.style === "自定义") this.style = v.trim() || "研究笔记"; }));
    // 长度（§四十九）
    new Setting(contentEl).setName("长度").addDropdown((d) => {
      const opts = ["短", "中", "长", "自定义"];
      for (const o of opts) d.addOption(o, o);
      d.setValue(this.length).onChange((v) => {
        this.length = v;
        if (this.lenInputEl) this.lenInputEl.style.display = v === "自定义" ? "" : "none";
        if (v === "自定义") this.length = this.lengthCustom || "中";
      });
    });
    this.lenInputEl = contentEl.createDiv({ cls: "kg-toolbox-hidden" });
    this.lenInputEl.style.display = "none";
    new Setting(this.lenInputEl).setName("自定义长度").addText((t) => t.setPlaceholder("例如：100 字").onChange((v) => { this.lengthCustom = v.trim(); if (this.length === "自定义") this.length = v.trim() || "中"; }));
    // 结构控制（§五十）
    new Setting(contentEl).setName("结构控制").addDropdown((d) => {
      d.addOption("keep", "保留原结构"); d.addOption("restructure", "重新组织结构"); d.addOption("free", "自由重写");
      d.setValue(this.structure).onChange((v) => { this.structure = v as typeof this.structure; });
    });
    // 输出格式（§六十七）
    new Setting(contentEl).setName("输出格式").addDropdown((d) => {
      d.addOption("markdown", "Markdown（默认）"); d.addOption("text", "纯文本"); d.addOption("json", "结构化 JSON（高级）");
      d.setValue(this.outputFormat).onChange((v) => { this.outputFormat = v as typeof this.outputFormat; });
    });
    // 附加要求（§八十一）
    new Setting(contentEl).setName("附加要求").addTextArea((t) => { this.instrInputEl = t; t.setPlaceholder("例如：只基于原文改写，不要新增观点 / 输出 3 个版本").onChange((v) => { this.instruction = v.trim(); }); });
    // 联网上下文（§六十三：默认 OFF；网页仅参考）
    new Setting(this.deepOnlyAreaEl).setName("联网上下文").setDesc("仅🧠深度模式可用（§二十四）；默认关闭；网页内容是不可信输入，仅作参考（§九十二）").addDropdown((d) => {
      const providers = (this.plugin.settings.webSearch?.providers ?? []).filter((x) => x && x.type === "api");
      d.addOption("off", "○ 关闭（默认）");
      d.addOption("url", "● 使用指定 URL");
      for (const p of providers) d.addOption("provider:" + p.id, "● " + (p.name || p.id));
      d.setValue("off").onChange((v) => {
        if (v === "off") { this.webMode = "off"; if (this.urlAreaEl) this.urlAreaEl.style.display = "none"; if (this.includeSrcEl) { this.includeSrcEl.style.display = "none"; this.includeSources = false; } return; }
        if (v === "url") { this.webMode = "url"; if (this.urlAreaEl) this.urlAreaEl.style.display = ""; if (this.includeSrcEl) this.includeSrcEl.style.display = ""; return; }
        // provider 为配置抽象（§六十三）：第一版请求回退「指定 URL」
        new Notice("Web Search Provider 为配置抽象；第一版请使用「指定 URL」。");
        this.webMode = "url";
        if (this.urlAreaEl) this.urlAreaEl.style.display = "";
        if (this.includeSrcEl) this.includeSrcEl.style.display = "";
      });
    });
    this.urlAreaEl = this.deepOnlyAreaEl.createDiv({ cls: "kg-toolbox-hidden" });
    this.urlAreaEl.style.display = "none";
    new Setting(this.urlAreaEl).setName("URL（每行一个，最多 5 个）").addTextArea((t) => t.setPlaceholder("https://example.com/article").onChange((v) => { this.urls = v; }));
    // 附来源（§六十六：Web OFF → 禁用；Web ON → 默认勾选）
    this.includeSrcEl = this.deepOnlyAreaEl.createDiv({ cls: "kg-toolbox-hidden" });
    this.includeSrcEl.style.display = "none";
    new Setting(this.includeSrcEl).setName("附来源").setDesc("勾选后：引用网页内容时附真实 URL + 检索时间（§三十四/六十四）")
      .addToggle((tg) => tg.setValue(false).onChange((v) => { this.includeSources = v; }));
    // 生成
    const runBtn = contentEl.createEl("button", { cls: "kg-btn kg-btn-primary", text: "生成" });
    this.runBtnEl = runBtn;
    runBtn.addEventListener("click", () => void this.run(runBtn));
    const cancelBtn = contentEl.createEl("button", { cls: "kg-btn", text: "取消" });
    this.cancelBtnEl = cancelBtn;
    cancelBtn.style.display = "none";
    cancelBtn.addEventListener("click", () => { this.abortCtrl?.abort(); });
    this.boxEl = contentEl.createDiv({ cls: "kg-toolbox-out" });
    this.boxEl.style.display = "none";
    if (this.autoRun) void this.run(runBtn);
  }

  /** Phase 16 §二十五：Mode 切换（默认 Fast；Deep 才显示整篇/相关/Web/Skill/Workspace 区） */
  private setMode(m: "fast" | "deep"): void {
    this.mode = m;
    if (this.modeFastEl) this.modeFastEl.className = m === "fast" ? "kg-btn kg-btn-primary" : "kg-btn";
    if (this.modeDeepEl) this.modeDeepEl.className = m === "deep" ? "kg-btn kg-btn-primary" : "kg-btn";
    if (this.deepOnlyAreaEl) this.deepOnlyAreaEl.style.display = m === "fast" ? "none" : "";
  }

  /** Phase 16 §九：Prompt 下拉填充（★ 收藏优先；0 AI） */
  private refreshPromptSelect(): void {
    if (!this.promptSelEl) return;
    const sel = this.promptSelEl;
    sel.empty();
    sel.createEl("option", { value: "", text: "（无 Prompt）" });
    const favs = this.plugin.promptLibraryStore.templates.filter((t) => t.favorite);
    const rest = this.plugin.promptLibraryStore.templates.filter((t) => !t.favorite);
    for (const t of [...favs, ...rest]) sel.createEl("option", { value: t.id, text: (t.favorite ? "★ " : "") + t.name });
    sel.value = this.promptId ?? "";
  }

  /** Phase 16 §十：应用 Prompt = activate（填回附加要求，不自动发送；§十五搜索 0 AI）；usageCount++（§十四） */
  private applyPrompt(id: string | null): void {
    this.promptId = id;
    const t = id ? this.plugin.promptLibraryStore.templates.find((x) => x.id === id) : undefined;
    if (t) {
      this.instruction = t.prompt;
      if (this.instrInputEl) this.instrInputEl.setValue(t.prompt);
      this.plugin.promptLibraryStore.touch(t.id);
      new Notice("已应用提示词「" + t.name + "」（未自动发送；可继续编辑后生成）。");
    } else {
      this.instruction = "";
      if (this.instrInputEl) this.instrInputEl.setValue("");
    }
    if (this.promptSelEl) this.promptSelEl.value = id ?? "";
    if (this.promptFavBtnEl) this.promptFavBtnEl.setText(t && t.favorite ? "★ 已收藏" : "☆ 收藏为提示词");
  }

  /** Phase 16 §十一/十六：收藏当前 Prompt；未收藏时弹窗新建（名称/描述/标签） */
  private togglePromptFavorite(): void {
    if (this.promptId) {
      const t = this.plugin.promptLibraryStore.templates.find((x) => x.id === this.promptId);
      if (!t) { new Notice("提示词不存在（可能已删除）。"); return; }
      this.plugin.promptLibraryStore.setFavorite(t.id, !t.favorite);
      this.refreshPromptSelect();
      this.applyPrompt(t.id);
      return;
    }
    new PromptSaveModal(this.app, this.plugin, (name, description, category, tags) => {
      const created = this.plugin.promptLibraryStore.create({ name, description: description || undefined, prompt: this.instruction.trim(), tags, category, favorite: true });
      if (created) {
        this.promptId = created.id;
        this.refreshPromptSelect();
        this.applyPrompt(created.id);
        new Notice("已收藏为提示词「" + created.name + "」：之后可一键应用。");
      } else {
        new Notice("保存失败：请检查名称与内容。");
      }
    }).open();
  }

  private resolvedAudience(): string { return this.audience === "自定义" ? (this.audienceCustom || "通用") : this.audience; }
  private resolvedStyle(): string { return this.style === "自定义" ? (this.styleCustom || "研究笔记") : this.style; }
  private resolvedLength(): string { return this.length === "自定义" ? (this.lengthCustom || "中") : this.length; }

  /** 相关知识（§五十八：≤8 篇，不整库；来源 = WikiLink + 已确认关系邻居，兜底最近笔记） */
  private async gatherRelatedNotes(): Promise<string[]> {
    const seen = new Set<string>([this.ctx.file.path]);
    const out: string[] = [];
    const push = (p: string): boolean => {
      if (!p || seen.has(p)) return false;
      seen.add(p); out.push(p); return true;
    };
    const byBase = new Map<string, string>();
    for (const n of this.plugin.index.all()) byBase.set(n.path.split("/").pop()!.replace(/\.md$/i, "").toLowerCase(), n.path);
    const meta = this.plugin.index.get(this.ctx.file.path);
    for (const l of meta?.links ?? []) {
      const hit = byBase.get(l.toLowerCase());
      if (hit) push(hit);
      if (out.length >= 8) break;
    }
    if (out.length < 8) {
      for (const r of this.plugin.relationships.confirmed()) {
        if (r.from !== this.ctx.file.path && r.to !== this.ctx.file.path) continue;
        push(r.from === this.ctx.file.path ? r.to : r.from);
        if (out.length >= 8) break;
      }
    }
    if (out.length < 8) {
      for (const n of [...this.plugin.index.all()].sort((a, b) => b.modified - a.modified)) {
        push(n.path);
        if (out.length >= 8) break;
      }
    }
    const res: string[] = [];
    for (const pth of out.slice(0, 8)) {
      const f = this.app.vault.getAbstractFileByPath(pth);
      if (!(f instanceof TFile)) continue;
      const body = (await this.app.vault.cachedRead(f)).replace(/^---[\s\S]*?\r?\n---\r?\n?/, "").slice(0, 1500);
      res.push("《" + f.basename + "》\n" + body);
    }
    return res;
  }

  private async run(btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    btn.textContent = "进行中…";
    btn.setAttribute("disabled", "true");
    const tracker = new LatencyTracker();
    try {
      const isFast = this.mode === "fast";
      if (isFast) { this.ctxSel = true; this.ctxNote = false; this.ctxRelated = false; this.ctxRel = false; this.ctxSaved = false; this.webMode = "off"; }
      if (isFast && !this.ctx.selectedText) { new Notice("⚡ 快速模式只处理选中文本：请先选中内容，或切换到🧠深度模式。"); return; }
      this.abortCtrl = new AbortController();
      if (this.cancelBtnEl) this.cancelBtnEl.style.display = "";
      const blocks: { label: string; content: string }[] = [];
      let source = "";
      if (this.ctx.selectedText && this.ctxSel) {
        source = this.ctx.selectedText;
        blocks.push({ label: "用户选中文本", content: source });
      }
      if (this.ctxNote || (!this.ctx.selectedText && !this.ctxSel) || !source) {
        // §五十七/一百一十：勾选「整篇笔记」才发送整篇；无选中且未勾选任何上下文时按 §八十八 回退整篇并提示
        const nb = await readNoteBodySafe(this.ctx.file.path, this.app);
        if (this.ctxNote) blocks.push({ label: "当前整篇笔记", content: nb.body });
        else if (!this.ctx.selectedText && !this.ctxSel) new Notice("未检测到选中文本，将使用当前笔记作为上下文（§八十八）。");
        if (!source) source = nb.body;
      }
      if (!source) { new Notice("没有可操作的原始内容（未勾选任何上下文）。"); return; }
      if (this.ctxRelated) {
        for (const r of await this.gatherRelatedNotes()) blocks.push({ label: "相关知识", content: r });
      }
      if (this.ctxRel) {
        const rels = this.plugin.relationships.confirmed()
          .filter((r) => r.from === this.ctx.file.path || r.to === this.ctx.file.path)
          .slice(0, 8);
        if (rels.length) blocks.push({ label: "已确认关系（user_confirmed）", content: rels.map((r) => {
          const other = r.from === this.ctx.file.path ? r.to : r.from;
          return "《" + (other.split("/").pop() ?? other).replace(/\.md$/i, "") + "》 —" + r.relation + "— 当前笔记" + (r.reason ? "（" + r.reason + "）" : "");
        }).join("\n") });
      }
      if (this.ctxSaved) {
        const saved = this.plugin.saved.all().slice(0, 2);
        if (saved.length) blocks.push({ label: "收藏链路（Saved Exploration）", content: saved.map((e) =>
          "标题：" + e.title + "\n摘要：" + (e.summary || e.headline || "（无）") + "\n路径：" + e.nodes.map((n) => n.label || (n.path.split("/").pop() ?? n.path).replace(/\.md$/i, "")).join(" → ")
        ).join("\n\n") });
      }
      let webContext = "";
      if (this.webMode === "url") {
        const urls = this.urls.split(/\r?\n/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
        if (urls.length === 0) { new Notice("请填写至少一个有效 URL（http/https）。"); return; }
        const res = await collectWebContext(urls);
        this.webPages = res.pages;
        this.sources = res.pages.map((pg) => pg.url);
        webContext = this.webPages.map((pg) => "### " + pg.url + "\n" + pg.text).join("\n\n");
      } else if (this.webMode === "provider") {
        new Notice("Web Search Provider 尚未实现请求逻辑；第一版请使用「指定 URL」。");
        return;
      }
      const taskDef = WRITING_TASKS.find((x) => x.value === this.task);
      const feature: AIFeature = taskDef?.feature ?? "writing_copy";
      // Phase 13 §十二/§一百零六：Workspace Instructions + Skill 自动加载（用户可关闭 Skill；§一百零六）
      const ws = this.wsId ? this.plugin.settings.workspaces.find((x) => x.id === this.wsId) : undefined;
      const wsInstr = workspaceInstructions(ws);
      const skillInstr = isFast ? "" : buildSkillInstructions(this.skills, this.plugin.settings.skillRegistry ?? [], (id) => this.plugin.readSkill(id));
      // Phase 13 §一百三十五：复杂任务 Plan Mode（只生成计划；确认后才执行；§七十二/一百三十六）
      let planInstr = "";
      if (this.planOn && requiresPlan(feature)) {
        const ctxHash0 = fingerprintKey(blocks.map((b) => b.label + "~" + textHash(b.content)));
        const route0 = resolveAIFunctionRouteWithWorkspace(feature, this.plugin.settings.aiProfiles ?? [], this.plugin.settings.aiFunctionConfig ?? [], ws, undefined, this.plugin.settings.defaultProfileId);
        const planTask = this.plugin.taskEngine.create(feature, { label: "计划：" + writingTaskLabel(this.task) });
        this.plugin.taskEngine.setStatus(planTask.taskId, "running");
        const po = await this.plugin.ai.generateForFeature(feature, [
          { role: "system", content: buildPlanSystem(feature, skillInstr) },
          { role: "user", content: buildPlanUserRequest(this.instruction, source) },
        ], {
          customKeyParts: ["plan:1", "ctx:" + ctxHash0, "model:" + route0.model, "pv:" + PLAN_PROMPT_VERSION],
          maxTokens: 1200,
        });
        this.plugin.taskEngine.setStatus(planTask.taskId, po.ok ? "success" : "error");
        if (!po.ok) { new Notice("计划生成失败：" + po.error.message); return; }
        const parsed = parsePlanText(po.data);
        const confirmed = await new Promise<boolean>((resolve) => {
          const m = new PlanConfirmModal(this.app, parsed.steps, (ok) => { m.close(); resolve(ok); });
          m.open();
        });
        if (!confirmed) { new Notice("已取消（计划阶段只读，未执行任何操作，§七十二）。"); return; }
        planInstr = buildPlanFinalInstruction(parsed.steps);
      }
      const messages: { role: "system" | "user"; content: string }[] = [
        { role: "system", content: buildWritingAssistantSystem({
          task: this.task,
          source: source.slice(0, 12000),
          language: this.language || "中文",
          audience: this.resolvedAudience(),
          style: this.resolvedStyle(),
          length: this.resolvedLength(),
          structure: this.structure,
          outputFormat: this.outputFormat,
          includeSources: this.includeSources && this.webPages.length > 0,
          contextBlocks: blocks,
          webContext: webContext || undefined,
          instruction: this.instruction || undefined,
          workspaceInstructions: wsInstr || undefined,
          skillInstructions: skillInstr || undefined,
        }) },
        { role: "user", content: (planInstr ? planInstr + "\n\n" : "") + (this.instruction ? "附加要求：" + this.instruction : "请按任务要求开始。") },
      ];
      // 缓存 key（§七十五~七十九：task / 上下文 / Web / 模型(配置指纹) 任一变化 → Miss；同输入 → Hit）
      const ctxHash = fingerprintKey(blocks.map((b) => b.label + "~" + textHash(b.content)));
      const customKeyParts = [
        "mode:" + this.mode,
        "prompt:" + (this.promptId ? promptFingerprint(this.plugin.promptLibraryStore.templates.find((x) => x.id === this.promptId) ?? { name: "", description: "", prompt: "" }) : "none"),
        "task:" + this.task,
        "src-hash:" + textHash(source),
        "ctx:" + ctxHash,
        "instr:" + textHash(this.instruction),
        "lang:" + (this.language || "中文"),
        "aud:" + this.resolvedAudience(),
        "style:" + this.resolvedStyle(),
        "len:" + this.resolvedLength(),
        "struct:" + this.structure,
        "fmt:" + this.outputFormat,
        "srcref:" + (this.includeSources ? "1" : "0"),
        "web:" + (this.webPages.length > 0 ? fingerprintWeb(this.webPages) : "off"),
        "pv:" + WRITING_PROMPT_VERSION,
        // Phase 13 Test 37/38/39：Workspace / Skill / Context 变化 → Cache Miss
        "ws:" + workspaceFingerprint(ws),
        "skills:" + skillCachePart(this.skills, this.plugin.settings.skillRegistry ?? [], (id) => this.plugin.readSkill(id)),
      ];
      const task = this.plugin.taskEngine.create(feature, { label: writingTaskLabel(this.task) });
      this.plugin.taskEngine.setStatus(task.taskId, "running");
      this.liveEl = this.boxEl.createEl("pre", { cls: "kg-toolbox-result" });
      this.liveEl.textContent = "生成中…（Streaming；可随时取消）";
      this.boxEl.style.display = "";
      const outcome = await this.plugin.ai.generateForFeatureStream(feature, messages, {
        customKeyParts,
        maxTokens: isFast ? 1000 : 2000,
        force: this.forceRun,
        signal: this.abortCtrl ? this.abortCtrl.signal : undefined,
        onDelta: (d) => { if (this.liveEl) this.liveEl.textContent += d; },
        onFirstToken: () => tracker.mark("firstTokenAt"),
      });
      this.plugin.taskEngine.setStatus(task.taskId, outcome.ok ? "success" : "error");
      if (!outcome.ok) { new Notice(outcome.error.code === "CANCELLED" ? "已取消。" : "写作助手失败：" + outcome.error.message); return; }
      this.result = outcome.data;
      this.sourceNote = source;
      this.renderOutput();
    } catch (e) {
      new Notice("写作助手出错：" + String((e as Error)?.message || e));
    } finally {
      this.busy = false;
      this.forceRun = false;
      if (this.cancelBtnEl) this.cancelBtnEl.style.display = "none";
      const smm = tracker.summary();
      this.plugin.latencyCollector?.record(this.mode === "fast" ? "fast" : "deep", smm);
      btn.textContent = "生成";
      btn.removeAttribute("disabled");
    }
  }

  private renderOutput(): void {
    this.boxEl.empty();
    this.boxEl.style.display = "";
    this.boxEl.createDiv({ cls: "kg-ai-label", text: "AI 输出（建议稿；不会自动覆盖原文，§六十九）" });
    const pre = this.boxEl.createEl("pre", { cls: "kg-toolbox-result" });
    pre.textContent = this.result ?? "";
    const row = this.boxEl.createDiv({ cls: "kg-toolbox-actions" });
    row.createEl("button", { cls: "kg-btn", text: "重新生成（强制）" }).addEventListener("click", () => {
      this.forceRun = true;
      if (this.runBtnEl) void this.run(this.runBtnEl);
    });
    row.createEl("button", { cls: "kg-btn", text: "复制" }).addEventListener("click", () => {
      void navigator.clipboard.writeText(this.result ?? "").then(() => new Notice("已复制。")).catch(() => new Notice("复制失败，请手动复制。"));
    });
    if (this.ctx.editor) {
      row.createEl("button", { cls: "kg-btn", text: "插入当前位置" }).addEventListener("click", () => {
        const ed = this.ctx.editor;
        if (!ed) return;
        ed.replaceRange(this.result ?? "", ed.getCursor());
        new Notice("已插入当前位置。");
      });
      if (this.ctx.selectedText && this.ctx.selStart !== undefined) {
        row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "替换选中内容" }).addEventListener("click", () => {
          const ed = this.ctx.editor;
          if (!ed) return;
          // Phase 13 §六十四：冲突检测（用户等待期间修改了选中内容 → 提示，不直接覆盖）
          const current = ed.getSelection() || "";
          const proposal = createEditProposal(this.ctx.file.path, this.ctx.selectedText, this.result ?? "", "replace_selection");
          if (detectConflict(proposal, current)) {
            new ConflictModal(this.app, { original: this.ctx.selectedText, proposed: this.result ?? "", current }).open();
            return;
          }
          ed.replaceSelection(this.result ?? "");
          new Notice("已替换选中内容（原文未改动，可撤销）。");
        });
      }
    }
    row.createEl("button", { cls: "kg-btn", text: "新建笔记" }).addEventListener("click", () => void this.createNewNote());
    row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "保存为研究笔记" }).addEventListener("click", () => void this.saveAsResearchNote());
    if (this.sources.length > 0) {
      const ref = this.boxEl.createDiv({ cls: "kg-toolbox-refs" });
      ref.createDiv({ cls: "kg-ai-label", text: "参考来源（真实 URL，§三十四/六十四）" });
      for (const u of this.sources) ref.createDiv({ cls: "kg-toolbox-ref", text: "- " + u });
    }
    if (this.sourceNote !== null) {
      this.boxEl.createDiv({ cls: "kg-toolbox-note", text: "区分：以上「AI 输出」基于「用户原始内容」" + (this.webPages.length > 0 ? " + 指定 URL 网页上下文（不可信，仅参考）" : "") + "生成，不会覆盖你的原始内容（§六十九/九十）。" });
    }
  }

  private async createNewNote(): Promise<void> {
    const dir = this.ctx.file.path.includes("/") ? this.ctx.file.path.slice(0, this.ctx.file.path.lastIndexOf("/")) : "";
    const base = dir ? dir + "/" : "";
    const label = sanitizeFileName(writingTaskLabel(this.task));
    const name = (this.ctx.file.basename || "写作") + " [写作-" + label + "].md";
    const target = uniquePath(base + name, (p) => !!this.app.vault.getAbstractFileByPath(p));
    let md = (this.result ?? "") + "\n";
    if (this.sources.length > 0) md += "\n参考来源：" + this.sources.map((u) => "\n- " + u).join("") + "\n";
    await this.app.vault.create(target, md);
    new Notice("已新建写作笔记：" + target);
  }

  /** §七十~七十三：保存为研究笔记（Knowledge Garden/Research/）；frontmatter 不伪造 author/publication/DOI；不进 Knowledge/Evolution/Activity */
  private async saveAsResearchNote(): Promise<void> {
    const dirPath = "Knowledge Garden/Research";
    const dir = this.app.vault.getAbstractFileByPath(dirPath);
    if (!(dir instanceof TFolder)) {
      try { await this.app.vault.createFolder(dirPath); } catch { /* 已存在或并发创建 */ }
    }
    const d = new Date();
    const ymd = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const label = sanitizeFileName(writingTaskLabel(this.task));
    const name = ymd + " " + (this.ctx.file.basename || "写作") + " [研究-" + label + "].md";
    const target = uniquePath(dirPath + "/" + name, (p) => !!this.app.vault.getAbstractFileByPath(p));
    const md = [
      "---",
      "type: research-draft",
      "createdAt: " + d.toISOString(),
      "sourceNote: " + this.ctx.file.path,
      "task: " + this.task,
      "---",
      "",
      "# " + name.replace(/\.md$/i, ""),
      "",
      this.result ?? "",
      "",
      ...(this.sources.length > 0 ? ["## 参考来源", ...this.sources.map((u) => "- " + u), ""] : []),
      "> 研究草稿（AI 写作助手生成）：尚未提炼为知识。需你确认后手动「提炼为知识」才能进入正式 Knowledge 流程（§七十二）；不计入知识增长与 Activity（§七十三/七十四）。",
    ].join("\n");
    await this.app.vault.create(target, md);
    new Notice("已保存研究笔记：" + target + "（草稿；不进 Knowledge / Evolution / Activity）。");
  }
}

function readNoteBodySafe(path: string, app: App): Promise<{ md: string; body: string; fm: string }> {
  return app.vault.getAbstractFileByPath(path) instanceof TFile
    ? (async () => {
        const f = app.vault.getAbstractFileByPath(path) as TFile;
        const md = await app.vault.cachedRead(f);
        return { md, body: stripFrontmatter(md), fm: frontmatterBlock(md) };
      })()
    : Promise.reject(new Error("笔记不存在：" + path));
}

type CopywritingTaskType =
  | "generate" | "rewrite" | "polish" | "compress" | "expand" | "title" | "summary"
  | "ad" | "social" | "product" | "video";

function sanitizeFileName(s: string): string {
  const r = (s || "").trim().replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 30);
  return r || "unnamed";
}

// ================= Anchor 探索 Modal（§一百二十八：范围 + 开始探索 + 结果图 + ★保存链路） =================
class AnchorExplorationModal extends Modal {
  private scopeMode: "vault" | "discovery" = "discovery";
  private statusEl!: HTMLElement;
  private resultBox!: HTMLElement;
  private graph: GraphSvg | null = null;
  private lastKey = "";
  private busy = false;

  constructor(
    app: App,
    private plugin: KnowledgeGardenPlugin,
    private anchorPath: string,
    private initialScope?: "vault" | "discovery"
  ) {
    super(app);
    if (this.initialScope === "vault" || this.initialScope === "discovery") this.scopeMode = this.initialScope;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "🔗 以此笔记探索关联" });
    contentEl.createDiv({ cls: "kg-toolbox-note", text: "当前笔记：《" + this.anchorTitle() + "》" });
    new Setting(contentEl).setName("探索范围").addDropdown((d) => {
      d.addOption("discovery", "当前 Discovery Scope（默认）");
      d.addOption("vault", "整个仓库");
      d.setValue(this.scopeMode).onChange((v) => { this.scopeMode = v === "vault" ? "vault" : "discovery"; });
    });
    const startBtn = contentEl.createEl("button", { cls: "kg-btn kg-btn-primary", text: "开始探索" });
    startBtn.addEventListener("click", () => void this.run(startBtn));
    this.statusEl = contentEl.createDiv({ cls: "kg-toolbox-note" });
    this.resultBox = contentEl.createDiv({ cls: "kg-graph-box" });
  }

  private anchorTitle(): string {
    const f = this.app.vault.getAbstractFileByPath(this.anchorPath);
    return f instanceof TFile ? f.basename : this.anchorPath;
  }

  private async run(btn: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    btn.setAttribute("disabled", "true");
    this.statusEl.setText("正在搜索候选笔记…");
    try {
      await this.plugin.runAnchorExploration(this.anchorPath, this.scopeMode, (s) => {
        if (s.status === "searching") this.statusEl.setText(s.message);
        else if (s.status === "thinking") this.statusEl.setText(s.message);
        else if (s.status === "done") {
          this.statusEl.setText(s.message || "探索完成。");
          if (s.result) this.renderResult(s.result, s.cacheKey ?? "", s.fromCache ?? false);
        } else {
          this.statusEl.setText(s.message || "探索失败。");
        }
      });
    } finally {
      this.busy = false;
      btn.textContent = "重新探索";
      btn.removeAttribute("disabled");
    }
  }

  private renderResult(result: QueryExplorationResult, key: string, fromCache: boolean): void {
    const model = anchorGraphModel(result, key || "anchor:" + this.anchorPath);
    if (!model || model.nodes.length === 0) {
      this.resultBox.empty();
      this.resultBox.createDiv({ cls: "kg-empty", text: "候选不足，无法构建知识关联图（未强行制造连接）。" });
      return;
    }
    if (key !== this.lastKey) {
      if (this.graph) { try { this.graph.destroy(); } catch { /* ignore */ } }
      this.graph = null;
      this.lastKey = key;
    }
    this.resultBox.empty();
    const meta = this.resultBox.createDiv({ cls: "kg-cache-status" });
    meta.setText(model.nodes.length + " 个笔记 · " + model.edges.length + " 个连接 · " + (fromCache ? "（复用缓存）" : "（本次生成）"));
    if (model.title) this.resultBox.createDiv({ cls: "kg-ai-title", text: model.title });
    if (model.summary) this.resultBox.createDiv({ cls: "kg-ai-body", text: model.summary });
    const box = this.resultBox.createDiv({ cls: "kg-graph-box" });
    const layout = computeGraphLayout(model, box.clientWidth || 720, box.clientHeight || 360);
    this.graph = new GraphSvg(box, model, layout, { onOpenNote: (p) => this.plugin.openNote(p) });
    const row = this.resultBox.createDiv({ cls: "kg-toolbox-actions" });
    // Phase 12 §十/二十二：★已收藏 / ☆保存链路（与 Query 收藏同指纹去重；保存 0 AI）
    const nodes = result.nodes.map((n) => ({ path: n.path, label: n.label, role: n.role, reason: n.reason }));
    const edges = result.edges.map((e) => ({ from: e.from, to: e.to, relation: e.relation, direction: e.direction, reason: e.reason }));
    const fp = savedFingerprint(
      "anchor_exploration",
      parseQuery(this.anchorTitle()).normalized,
      result.nodes.map((n) => ({ path: n.path })),
      result.edges.map((e) => ({ from: e.from, to: e.to, relation: e.relation }))
    );
    const existing = this.plugin.findSaved(fp);
    const saveBtn = row.createEl("button", { cls: "kg-btn kg-btn-primary" + (existing ? " kg-btn-minor" : ""), text: existing ? "★ 已收藏" : "☆ 保存链路" });
    saveBtn.addEventListener("click", () => {
      void this.plugin.saveExploration({
        source: "anchor_exploration",
        title: result.headline || this.anchorTitle() + " 的知识关联",
        query: this.anchorTitle(),
        scope: this.scopeMode === "vault" ? { mode: "vault" as const } : undefined,
        anchorPath: this.anchorPath,
        headline: result.headline,
        summary: result.summary,
        nodes,
        edges,
      }).then(() => { saveBtn.setText("★ 已收藏"); saveBtn.addClass("kg-btn-minor"); });
    });
  }

  onClose(): void {
    if (this.graph) { try { this.graph.destroy(); } catch { /* ignore */ } }
    this.graph = null;
  }
}

/** Phase 13 §七十一：Plan 确认弹窗（计划阶段只读，[执行] 才进入 AI Task；[取消] 不执行任何操作） */
class PlanConfirmModal extends Modal {
  constructor(
    app: App,
    private steps: string[],
    private onResult: (ok: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "AI 计划（Plan 阶段只读，不执行任何操作，§七十二/一百三十六）" });
    const ol = contentEl.createEl("ol");
    for (const s of this.steps) ol.createEl("li", { text: s });
    if (this.steps.length === 0) contentEl.createDiv({ cls: "kg-toolbox-note", text: "（未生成步骤；仍可执行，将按任务默认流程进行）" });
    const row = contentEl.createDiv({ cls: "kg-row" });
    row.createEl("button", { cls: "kg-btn", text: "取消" }).addEventListener("click", () => this.onResult(false));
    row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "执行" }).addEventListener("click", () => this.onResult(true));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Phase 13 §六十四：Conflict 提示（AI 生成期间原文被修改 → 不直接覆盖） */
class ConflictModal extends Modal {
  constructor(
    app: App,
    private data: { original: string; proposed: string; current: string }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "原文已经发生变化" });
    contentEl.createDiv({ cls: "kg-toolbox-note", text: "AI 生成期间你修改了原文。不会直接覆盖（§六十四）。" });
    const details = contentEl.createEl("details");
    details.createEl("summary", { text: "查看 Diff（原文 vs AI 建议）" });
    const pre = details.createEl("pre", { cls: "kg-toolbox-result" });
    pre.textContent = lineDiff(this.data.original, this.data.proposed)
      .map((l) => (l.type === "removed" ? "- " + l.text : l.type === "added" ? "+ " + l.text : "  " + l.text))
      .join("\n");
    const row = contentEl.createDiv({ cls: "kg-row" });
    row.createEl("button", { cls: "kg-btn", text: "取消" }).addEventListener("click", () => this.close());
    row.createEl("button", { cls: "kg-btn", text: "重新生成" }).addEventListener("click", () => {
      new Notice("请回到主窗口点击「生成」重新运行（AI 结果仍保留在缓存，§一百零一）。");
      this.close();
    });
    row.createEl("button", { cls: "kg-btn kg-btn-primary", text: "强制替换" }).addEventListener("click", () => {
      new Notice("请手动重新选择原文后点击「替换选中内容」，或复制改后文本自行处理。");
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
