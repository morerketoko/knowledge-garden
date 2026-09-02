/**
 * Phase 15：AI Workbench 编排服务（§一~七 / §十一~十九 / §二十~二十九 / §三十~三十八）。
 * - 把 Workbench View（UI）与 AI / 工具 / 存储解耦：View 只调 service 方法。
 * - Ask：本地检索 → AI 生成带来源回答（§十三：假路径丢弃；§十八：Grounding 区分 Vault/Web/推理）。
 * - Research：先出研究计划（§二十一~二十四）→ 用户确认（§六百二十三式：planConfirmed）→ Agent 执行（§七十七）。
 * - Project：生成项目定义（§三十一）→ Preview 文件树 → 用户确认后建目录（§三十五/三十六）。
 * - Web：默认 ASK（§四十二：显式启用），Research 勾选后本次 allow（§八十五：不改写权限）。
 * - 安全：SECURITY_BLOCK 由 prompts 注入；工具权限走 workbenchTools（§八十四/三百零六）。
 * - 缓存：Ask / Research 各环节走 AIFeature 独立缓存（§一百四十七/四十八/二百五十九~二百六十五）。
 */
import type { App } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import { TFile } from "obsidian";
import {
  WORKBENCH_TOOL_IDS,
  executeWorkbenchTool,
  type WorkbenchToolEnv,
  type WorkbenchToolExecuteContext,
} from "./workbenchTools";
import { runAgentLoop, type AgentStepRecord, type AgentLoopResult } from "./agentLoop";
import type { AIService, AIOutcome } from "./ai/service";
import { parseResearchPlan, parseProjectDefinition, parseWorkbenchAskText, parseKnowledgeAskText, type ResearchPlanParsed, type ProjectDefinitionParsed, type KnowledgeAskParsed } from "./workbenchParsers";
import { classifyTaskComplexity, contextBudgetFor, maxStepsFor, type TaskComplexity } from "./taskClassifier";
import { fingerprintKey } from "./ai/cache";
import { LatencyTracker } from "./latency";
import { workspaceFingerprint } from "./workspace";
import { skillCachePart } from "./skills";
import type { PromptTemplate } from "./promptLibrary";
import { ledgerUpsert, type SourceLedgerStore } from "./sourceLedger";
import type { AIAnswerSource, KnowledgeProject, ResearchTask, SourceRecord, WorkbenchTraceEvent } from "./types";
import { sessionIdFor, workbenchMessageId, traceEventId, type WorkbenchSessionRecord } from "./workbenchSession";

/** Phase 16 §58-64/66：Ask 附加选项（Context Shelf + Session 追问） */
export interface WorkbenchAskOptions {
  /** Context Shelf：用户显式挑选的笔记（强制读取进证据；不算偷偷添加 §64） */
  shelfNotes?: string[];
  /** Context Shelf：用户显式挑选的 Skill（合并进启用 Skills） */
  shelfSkills?: string[];
  /** Context Shelf：用户显式挑选的 ★Prompt（追加为指令，不覆盖安全规则 §62） */
  shelfPromptIds?: string[];
  /** Session 追问（§66）：上一轮 sessionId；服务端自动带上 prior 上下文 */
  sessionId?: string;
  /** Phase 17 §63：强制重新生成（绕过 success/error cache；保留旧消息展示） */
  force?: boolean;
}

/** 请求结果（统一返回，View 直接渲染） */
export interface WorkbenchAskResult {
  ok: boolean;
  answer: string;
  sources: AIAnswerSource[];
  unresolved: string[];
  /** Phase 16 §47 Answer Schema */
  inferences: string[];
  uncertainties: string[];
  followUps: string[];
  /** Knowledge Agent 统计（§33-37 / §125） */
  taskComplexity?: TaskComplexity;
  toolSteps?: number;
  /** Phase 17 §37/§65：本轮消息 ID 与可见 Work Trace（只来自真实动作） */
  messageId?: string;
  traceEvents?: WorkbenchTraceEvent[];
  sessionId?: string;
  ttft?: number;
  totalMs?: number;
  error?: string;
}

export interface WorkbenchResearchResult {
  ok: boolean;
  plan: ResearchPlanParsed | null;
  taskId?: string;
  error?: string;
}

export interface WorkbenchProjectFormResult {
  ok: boolean;
  definition: ProjectDefinitionParsed | null;
  error?: string;
}

export interface WorkbenchCreateResult {
  ok: boolean;
  created: string[];
  failed: string[];
  error?: string;
}

/** Research Agent 执行进度回调（View 展示步骤，不给伪造百分比 §二十七） */
export interface ResearchProgress {
  total: number;
  done: number;
  failed: number;
  currentLabel: string;
  steps: AgentStepRecord[];
}

/** 编排服务（main 注入 plugin 引用；可被 Node 夹具用轻量宿主测试纯函数部分） */
export class WorkbenchService {
  constructor(private plugin: KnowledgeGardenPlugin) {}

  private ai(): AIService {
    return this.plugin.ai;
  }

  private settings() {
    return this.plugin.settings;
  }

  private app(): App {
    return this.plugin.app;
  }

  private aiErrorText(out: AIOutcome<string>): string {
    if (!out.ok) return out.error?.message || "AI 无返回";
    return "AI 无返回";
  }

  private enableWeb(): boolean {
    return !!this.settings().workbench?.webEnabledByDefault;
  }

  /** 本地检索（vault.search 用 SearchIndex / NoteIndex，§六十六：不整库读 Markdown） */
  private vaultSearch(query: string, limit: number): { path: string; snippet: string }[] {
    const idx = this.plugin.searchIndex;
    try {
      if (idx && typeof idx.search === "function") {
        const tokens = (query || "").toLowerCase().split(/[\s\u4e00-\u9fff]+/).filter((t) => t.length >= 2);
        const docs = idx.search(tokens, limit);
        return (docs || []).map((d) => ({
          path: d.path,
          snippet: (d.title || d.path) + " … " + (d.headings?.join(" / ") || ""),
        }));
      }
    } catch { /* 索引不可用时退回文件名匹配 */ }
    const paths = this.plugin.index.all().map((n) => n.path);
    const q = (query || "").toLowerCase();
    return paths
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, limit)
      .map((p) => ({ path: p, snippet: p }));
  }

  /** 读取笔记（vault.read） */
  private async readNote(path: string): Promise<string | null> {
    const f = this.app().vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return await this.app().vault.cachedRead(f);
    return null;
  }

  /** 打开笔记（vault.open） */
  private openNote(path: string): void {
    const f = this.app().vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      void this.app().workspace.getLeaf(false).openFile(f);
    }
  }

  /** Web 抓取（web.fetch，走 webContext） */
  private async fetchWeb(url: string): Promise<string> {
    const { collectWebContext } = await import("./webContext");
    const res = await collectWebContext([url]);
    return res.pages[0]?.text ?? "";
  }

  /** Web 搜索（web.search；未配置 Provider 时返回空；§一百 无 Provider → 空） */
  private async searchWeb(query: string, limit: number): Promise<{ url: string; title: string; snippet: string }[]> {
    const cfg = this.settings().webSearch?.providers || [];
    const provider = cfg.find((p) => p.type === "api" && p.id);
    if (!provider) return [];
    try {
      const { url, apiKey, name } = provider as { url?: string; apiKey?: string; name?: string };
      const base = url || "https://api.search.brave.com";
      void name;
      // 通用 OpenAI-compatible 检索端点不可假设；第一版仅占位（§一百：Provider 抽象，不强绑）。
      if (!apiKey) return [];
      return [];
    } catch {
      return [];
    }
  }

  /** 构建工具 env（§六十四：工具逻辑在 workbenchTools，env 由 main 注入真实实现） */
  private makeToolEnv(): WorkbenchToolEnv {
    const p = this.plugin;
    const settings = this.settings();
    const base = (this.app().vault.adapter as unknown as { getBasePath?: () => string })?.getBasePath?.() ?? "";
    return {
      vaultRoot: base,
      readNote: (path) => this.readNote(path),
      listNotes: () => p.index.all().map((n) => n.path),
      searchNotes: (q, limit) => this.vaultSearch(q, limit),
      createNote: (path, content) => { void path; void content; return false; },
      modifyNote: (path, content) => { void path; void content; return false; },
      renameNote: (oldPath, newPath) => { void oldPath; void newPath; return false; },
      moveNote: (from, to) => { void from; void to; return false; },
      deleteNote: (path) => { void path; return false; },
      openNote: (path) => this.openNote(path),
      searchWeb: (q, limit) => this.searchWeb(q, limit),
      fetchWeb: (url) => this.fetchWeb(url),
      logToolCall: (toolId, ok, summary) => p.logWorkbenchToolCall(toolId, ok, summary),
    };
  }

  /** 构建权限提示（§八十四/三百零六） */
  private permissionPromptText(enableWeb: boolean): string {
    const lines = [
      "vault.search / vault.read / vault.open = allow",
      "vault.create / vault.modify / vault.rename / vault.move = ask（需用户确认）",
      "vault.delete = deny（第一版禁用；仅用户手动允许本次）",
      "批量删除 = deny（第一版明确禁止 §七十三）",
    ];
    lines.push(enableWeb ? "web.search / web.fetch = allow（本次会话用户已启用）" : "web.search / web.fetch = ask（需用户显式启用 §四十二）");
    return lines.join("\n");
  }

  private toolListText(): string {
    return WORKBENCH_TOOL_IDS.map((id) => "- " + id).join("\n");
  }

  /* ================= Ask（§十一~十九） ================= */

  async ask(question: string, opts?: WorkbenchAskOptions): Promise<WorkbenchAskResult> {
    // Phase 16 §33-38：Knowledge Agent——本地分类（不先调 AI）→ 检索 → 阅读 → 证据 → 综合 → 校验
    const complexity = classifyTaskComplexity(question);
    const budget = contextBudgetFor(complexity);
    const maxSteps = maxStepsFor(complexity);
    const tracker = new LatencyTracker();
    // Phase 17 §37/§42：Trace 只来自真实动作，绝不伪造 hidden reasoning
    const traces: WorkbenchTraceEvent[] = [];
    const traceAt = Date.now();
    tracker.mark("contextStart");
    // 1) 检索候选（§三十五~三十七：按复杂度决定候选规模）
    const hits = this.vaultSearch(question, budget.candidates);
    traces.push({
      id: traceEventId(question, traceAt, 1),
      stage: "retrieval",
      status: "done",
      summary: "搜索知识库",
      tool: "vault.search",
      toolParamsSummary: "query=" + question.slice(0, 40),
      count: hits.length,
      timestamp: Date.now(),
    });
    // Phase 16 §58-64：Context Shelf 显式笔记（用户挑选 → 强制读取进证据；不算偷偷添加）
    const shelfNotes = opts?.shelfNotes ?? [];
    const shelfRead: string[] = [];
    const shelfEvidence: string[] = [];
    for (const pth of shelfNotes) {
      const body = await this.readNote(pth);
      if (!body) continue;
      shelfRead.push(pth);
      const snip = body.replace(/^---[\s\S]*?\r?\n---\r?\n?/, "").slice(0, 900);
      shelfEvidence.push("[" + pth + "]\n" + snip);
    }
    const vaultCtx = hits.map((h) => h.path + " | " + h.snippet).concat(shelfRead.map((pth) => pth + " | （用户显式加入 Context Shelf）")).join("\n");
    // 2) 阅读预算内笔记全文（§四十三：normal/complex 才读全文，读取数量 ≤ readFull）
    const readPaths: string[] = [];
    const evidenceParts: string[] = [];
    let evidenceChars = 0;
    for (const h of hits.slice(0, budget.readFull)) {
      const body = await this.readNote(h.path);
      if (!body) continue;
      readPaths.push(h.path);
      const snip = body.replace(/^---[\s\S]*?\r?\n---\r?\n?/, "").slice(0, 900);
      evidenceParts.push("[" + h.path + "]\n" + snip);
      evidenceChars += snip.length;
      if (evidenceChars >= budget.evidenceChars) break;
    }
    const evidenceCtx = evidenceParts.concat(shelfEvidence).join("\n\n");
    if (readPaths.length > 0) {
      traces.push({
        id: traceEventId(question, traceAt, 2),
        stage: "reading",
        status: "done",
        summary: "阅读 " + readPaths.length + " 篇笔记",
        tool: "vault.read",
        toolParamsSummary: readPaths.slice(0, 3).join(", ") + (readPaths.length > 3 ? " …" : ""),
        count: readPaths.length,
        timestamp: Date.now(),
      });
    }
    tracker.mark("contextEnd");
    const enableWeb = this.enableWeb();
    const { buildKnowledgeAskSystem } = await import("./prompts");
    const workspaceText = this.plugin.currentWorkspace()?.name ? "当前 Workspace：" + this.plugin.currentWorkspace()!.name : "";
    const skillText = this.plugin.selectedSkillsText();
    const skillIds = Array.from(new Set([...this.plugin.selectedSkillIds(), ...(opts?.shelfSkills ?? [])]));
    const shelfPrompts = (opts?.shelfPromptIds ?? []).map((id) => this.plugin.promptLibraryStore.templates.find((t) => t.id === id)).filter((t) => !!t) as PromptTemplate[];
    const shelfPromptText = shelfPrompts.map((t) => "【" + t.name + "】" + t.prompt).join("\n\n");
    const prevRec = opts?.sessionId ? this.plugin.sessionStore.get(opts.sessionId) : undefined;
    const priorContext = prevRec
      ? "上一轮问题：" + prevRec.question + " | 上一轮结论摘要：" + (prevRec.answerSnippet ?? "") + " | 上一轮来源：" + prevRec.sources.map((x) => x.path || x.url || x.title).filter(Boolean).join("；")
      : undefined;
    const sys = buildKnowledgeAskSystem({
      question,
      taskComplexity: complexity,
      vaultContext: vaultCtx,
      webContext: "",
      evidenceContext: evidenceCtx,
      workspaceContext: workspaceText,
      skillInstructions: skillText + (shelfPromptText ? "\n\n用户显式选择的 Prompt：\n" + shelfPromptText : ""),
      enableWeb,
      readPaths: readPaths.concat(shelfRead),
      priorContext,
    });
    traces.push({
      id: traceEventId(question, traceAt, 3),
      stage: "synthesis",
      status: "running",
      summary: "AI 正在综合回答",
      timestamp: Date.now(),
    });
    tracker.mark("requestStart");
    try {
      // §九十四~九十九：按复杂度走 Feature Route（simple→workbench_ask 快模型；normal/complex→workbench_deep）
      const feature = complexity === "simple" ? "workbench_ask" : "workbench_deep";
      const out = await this.ai().generateForFeature(feature, [
        { role: "system", content: sys },
        { role: "user", content: question },
      ], { maxTokens: complexity === "simple" ? 1200 : 2200, customKeyParts: ["ask", "cx:" + complexity, fingerprintKey(["q", question]), fingerprintKey(["ctx", vaultCtx, evidenceCtx]), fingerprintKey(["cv", readPaths.join(",")]), workspaceFingerprint(this.plugin.currentWorkspace() ?? undefined), skillCachePart(skillIds, this.plugin.settings?.skillRegistry ?? [], (id) => this.plugin.readSkill?.(id) ?? null)], force: opts?.force ?? false });
      tracker.mark("requestEnd");
      if (!out.ok || !out.data) {
        const s = tracker.summary();
        return { ok: false, answer: "", sources: [], unresolved: [], inferences: [], uncertainties: [], followUps: [], taskComplexity: complexity, toolSteps: readPaths.length, messageId: workbenchMessageId(question, traceAt, 2), traceEvents: traces, ttft: s.ttft ?? undefined, totalMs: s.totalLatency, error: this.aiErrorText(out) };
      }
      const parsed = parseKnowledgeAskText(out.data);
      const synTrace = traces.find((tr) => tr.stage === "synthesis" && tr.status === "running");
      if (synTrace) { synTrace.status = "done"; synTrace.timestamp = Date.now(); }
      tracker.mark("parseEnd");
      if (!parsed) return { ok: false, answer: "", sources: [], unresolved: [], inferences: [], uncertainties: [], followUps: [], taskComplexity: complexity, toolSteps: readPaths.length, messageId: workbenchMessageId(question, traceAt, 2), traceEvents: traces, ttft: tracker.summary().ttft ?? undefined, totalMs: tracker.summary().totalLatency, error: "AI 返回无法解析（格式不符）" };
      // §四十八：假路径丢弃——只保留真实存在于 Vault 的 vault 来源
      const sources = parsed.sources.filter((s) => {
        if (s.type === "vault") return s.path ? this.app().vault.getAbstractFileByPath(s.path) instanceof TFile : false;
        if (s.type === "web") return /^https?:///i.test(s.url || "");
        return true;
      });
      // 登记来源（§一百零五/一百零七：稳定 ID 去重）
      this.recordSources(sources);
      // §六十五~六十七：写入 Workbench Session（追问上下文；同一 sessionId 递增 turnCount）
      const sessionId = opts?.sessionId ?? sessionIdFor(question, Date.now());
      const prev = opts?.sessionId ? this.plugin.sessionStore.get(opts.sessionId) : undefined;
      const rec: WorkbenchSessionRecord = {
        sessionId,
        title: prev ? prev.title : question.slice(0, 40),
        turnCount: (prev?.turnCount ?? 0) + 1,
        question,
        prior: prev ? { question: prev.question, answerSnippet: prev.answerSnippet ?? "", sourcePaths: prev.sources.map((x) => x.path || x.url || "").filter(Boolean) } : undefined,
        answerSnippet: parsed.answer.slice(0, 600),
        sources,
        workspaceName: this.plugin.currentWorkspace()?.name,
        skillIds,
        createdAt: prev?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        messages: [
          { id: workbenchMessageId(question, traceAt, 1), role: "user", content: question, createdAt: traceAt, sources: [] },
          { id: workbenchMessageId(question, traceAt, 2), role: "assistant", content: parsed.answer, createdAt: Date.now(), sources, status: "complete", model: out.model ?? undefined },
        ],
        traceEvents: traces,
      };
      if (this.plugin.sessionStore) this.plugin.sessionStore.put(rec);
      const s = tracker.summary();
      return { ok: true, answer: parsed.answer, sources, unresolved: [], inferences: parsed.inferences, uncertainties: parsed.uncertainties, followUps: parsed.followUps, taskComplexity: complexity, toolSteps: readPaths.length + 1, sessionId, messageId: workbenchMessageId(question, traceAt, 2), traceEvents: traces, ttft: s.ttft ?? undefined, totalMs: s.totalLatency };
    } catch (e) {
      const s = tracker.summary();
      return { ok: false, answer: "", sources: [], unresolved: [], inferences: [], uncertainties: [], followUps: [], taskComplexity: complexity, toolSteps: readPaths.length, messageId: workbenchMessageId(question, traceAt, 2), traceEvents: traces, ttft: s.ttft ?? undefined, totalMs: s.totalLatency, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private recordSources(sources: AIAnswerSource[]): void {
    const ledger = this.plugin.sourceLedger;
    for (const s of sources) {
      const rec: SourceRecord = {
        id: "",
        type: s.type === "web" ? "web" : s.type === "inference" ? "user" : "vault",
        title: s.title,
        path: s.path,
        url: s.url,
        snippet: s.snippet,
        retrievedAt: Date.now(),
      };
      ledgerUpsert(ledger.store, rec);
    }
    ledger.flush();
  }

  /* ================= Research（§二十~二十九） ================= */

  /** 第一步：生成研究计划（不搜索、不执行，§二十一/二十二） */
  async makeResearchPlan(question: string): Promise<WorkbenchResearchResult> {
    const enableWeb = this.enableWeb();
    const vaultCtx = this.vaultSearch(question, 10)
      .map((h) => h.path + " | " + h.snippet)
      .join("\n");
    const { buildResearchPlanSystem } = await import("./prompts");
    const ws = this.plugin.currentWorkspace()?.name ? "当前 Workspace：" + this.plugin.currentWorkspace()!.name : "";
    const skillText = this.plugin.selectedSkillsText();
    const sys = buildResearchPlanSystem({
      question,
      vaultContext: vaultCtx,
      projectContext: "",
      workspaceContext: ws,
      skillInstructions: skillText,
      enableWeb,
    });
    try {
      const out = await this.ai().generateForFeature("research_planning", [
        { role: "system", content: sys },
        { role: "user", content: question },
      ], { maxTokens: 2000, customKeyParts: ["plan", question] });
      if (!out.ok || !out.data) {
        return { ok: false, plan: null, error: this.aiErrorText(out) };
      }
      const plan = parseResearchPlan(out.data);
      if (!plan) return { ok: false, plan: null, error: "研究计划无法解析" };
      // 保存为 planning 任务（§二十八：planning / 待确认）
      const taskId = "task-" + Date.now();
      const task: ResearchTask = {
        taskId,
        title: plan.title,
        mode: "research",
        status: "planning",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workspaceId: this.plugin.currentWorkspace()?.id,
        question,
        plan: plan.steps,
        planConfirmed: false,
        maxSteps: this.settings().workbench?.maxSteps || 8,
      };
      this.plugin.taskStore.put(task);
      return { ok: true, plan, taskId };
    } catch (e) {
      return { ok: false, plan: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 第二步：用户确认后执行 Agent（§二十三/二十五；Web 勾选 → 本次 allow，不改写权限） */
  async executeResearch(task: ResearchTask, opts: { enableWeb: boolean; onProgress?: (p: ResearchProgress) => void; cancelled?: () => boolean }): Promise<ResearchTask> {
    const taskId = task.taskId;
    const enableWeb = opts.enableWeb;
    const env = this.makeToolEnv();
    const permissionPrompt = this.permissionPromptText(enableWeb);
    const toolList = this.toolListText();
    const settings = this.settings();
    const wb = settings.workbench || { maxSteps: 8, maxQueries: 5, maxPages: 10, maxChars: 20000, maxBatchWrites: 5, webEnabledByDefault: false, historyLimit: 20 };
    const maxSteps = wb.maxSteps > 0 ? wb.maxSteps : 8;
    const stepsSnapshot: AgentStepRecord[] = [];
    const progressCb = opts.onProgress;
    const startStep = task.steps?.length ?? 0;
    const completedWith = task.resultSummary;

    const loopInput = {
      taskId,
      title: task.title || task.question,
      goal: task.plan?.join("；") || task.question,
      maxSteps,
      permissionPrompt,
      toolList,
      enableWeb,
      decide: async (historyText: string): Promise<{ content: string }> => {
        const { buildAgentToolCallSystem } = await import("./prompts");
        const sys = buildAgentToolCallSystem({
          taskTitle: task.title || task.question,
          goal: task.question,
          stepIndex: stepsSnapshot.length,
          maxSteps,
          history: historyText,
          permissions: permissionPrompt,
          toolList,
          enableWeb,
        });
        const out = await this.ai().generateForFeature("research_execution", [
          { role: "system", content: sys },
          { role: "user", content: "根据研究目标与进展，决定下一步（仅输出意图 JSON）" },
        ], { maxTokens: 1200, customKeyParts: ["agent", taskId, String(stepsSnapshot.length)] });
        return { content: out.ok ? (out.data || "") : "" };
      },
      executeTool: async (ctx: WorkbenchToolExecuteContext) => {
        const perm: Record<string, "allow" | "ask" | "deny"> = {};
        if (enableWeb) { perm["web.search"] = "allow"; perm["web.fetch"] = "allow"; }
        const r = await executeWorkbenchTool(env, { ...ctx, permissionOverride: perm });
        return r;
      },
      isCancelled: opts.cancelled,
      existingSteps: task.steps ? task.steps.map((s) => ({ stepIndex: s.stepIndex, decision: "tool" as const, toolId: s.tool, toolArgsSummary: s.toolArgs, toolResultSummary: s.toolResultSummary, at: s.at })) : undefined,
      onCheckpoint: (step: AgentStepRecord) => {
        stepsSnapshot.push(step);
        progressCb?.({
          total: maxSteps,
          done: stepsSnapshot.filter((s) => !s.error).length,
          failed: stepsSnapshot.filter((s) => !!s.error).length,
          currentLabel: step.toolId || (step.decision === "final" ? "完成" : ""),
          steps: [...stepsSnapshot],
        });
        // §一百二十五：每步 checkpoint 持久化
        task.steps = stepsSnapshot.map((s) => ({
          stepIndex: s.stepIndex,
          tool: s.toolId || "",
          toolArgs: s.toolArgsSummary,
          toolResultSummary: s.toolResultSummary,
          at: s.at,
        }));
        task.updatedAt = Date.now();
        task.status = "running";
        this.plugin.taskStore.put(task);
      },
    };
    const result = await runAgentLoop(loopInput);
    task.steps = stepsSnapshot.map((s) => ({ stepIndex: s.stepIndex, tool: s.toolId || "", toolArgs: s.toolArgsSummary, toolResultSummary: s.toolResultSummary, at: s.at }));
    task.updatedAt = Date.now();
    task.resultSummary = result.finalNote || completedWith;
    task.status = result.stoppedReason === "final" ? "completed" : result.stoppedReason === "cancelled" ? "cancelled" : "failed";
    task.error = result.error || (result.stoppedReason !== "final" && result.stoppedReason !== "cancelled" ? "Agent 停止：" + result.stoppedReason : undefined);
    this.plugin.taskStore.put(task);
    return task;
  }

  /* ================= Project（§三十~三十八） ================= */

  /** 生成项目定义（§三十一：先出定义 → Preview → 用户确认 → 建目录） */
  async makeProjectDefinition(topic: string): Promise<WorkbenchProjectFormResult> {
    const vaultCtx = this.vaultSearch(topic, 8)
      .map((h) => h.path + " | " + h.snippet)
      .join("\n");
    const { buildProjectDefinitionSystem } = await import("./prompts");
    const ws = this.plugin.currentWorkspace()?.name ? "当前 Workspace：" + this.plugin.currentWorkspace()!.name : "";
    const skillText = this.plugin.selectedSkillsText();
    const sys = buildProjectDefinitionSystem({
      topic,
      vaultContext: vaultCtx,
      workspaceContext: ws,
      skillInstructions: skillText,
    });
    try {
      const out = await this.ai().generateForFeature("project_planning", [
        { role: "system", content: sys },
        { role: "user", content: topic },
      ], { maxTokens: 1800, customKeyParts: ["project", topic] });
      if (!out.ok || !out.data) {
        return { ok: false, definition: null, error: this.aiErrorText(out) };
      }
      const definition = parseProjectDefinition(out.data);
      if (!definition) return { ok: false, definition: null, error: "项目定义无法解析" };
      return { ok: true, definition };
    } catch (e) {
      return { ok: false, definition: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 用户确认后创建项目骨架（§三十五/三十六：README + Questions + Sources/Notes/Drafts） */
  async createProject(definition: ProjectDefinitionParsed, workspaceId?: string): Promise<WorkbenchCreateResult> {
    const project: KnowledgeProject = {
      id: "proj-" + Date.now(),
      name: definition.name,
      description: definition.goal || "",
      rootFolder: "Knowledge Garden/Projects/" + definition.name,
      workspaceId,
      goals: definition.goals,
      questions: definition.questions,
      milestones: definition.milestones.map((m) => ({ title: m, status: "todo" as const })),
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const created: string[] = [];
    const failed: string[] = [];
    try {
      const base = this.app().vault.getRoot();
      const folder = "Knowledge Garden/Projects/" + definition.name;
      await this.app().vault.createFolder(folder);
      created.push(folder + "/");
      const folders = ["Sources", "Notes", "Drafts"];
      for (const f of folders) {
        try { await this.app().vault.createFolder(folder + "/" + f); created.push(folder + "/" + f); }
        catch { failed.push(folder + "/" + f); }
      }
      const readme = [
        "# " + definition.name,
        "",
        "> " + (definition.goal || ""),
        "",
        "## 目标",
        ...definition.goals.map((g) => "- " + g),
        "",
        "## 核心问题",
        ...definition.questions.map((q) => "- " + q),
        "",
        "## 研究范围",
        "",
        "## 计划",
        ...definition.steps.map((s) => "- [ ] " + s),
        "",
        "## 来源",
        "",
        "## 当前结论",
        "",
        "## 待解决问题",
        "",
      ].join("\n");
      await this.app().vault.create(folder + "/README.md", readme);
      created.push(folder + "/README.md");
      await this.app().vault.create(folder + "/Questions.md", definition.questions.map((q) => "- " + q).join("\n"));
      created.push(folder + "/Questions.md");
      this.plugin.projectStore.upsert(project);
    } catch (e) {
      failed.push("项目创建异常：" + (e instanceof Error ? e.message : String(e)));
    }
    return { ok: failed.length === 0, created, failed };
  }
}
