import { App, Modal, PluginSettingTab, Setting, normalizePath, Notice } from "obsidian";
import { pickRandomImage } from "./mediaHelper";
import type KnowledgeGardenPlugin from "./main";
import type { DiscoveryScopeMode, KnowledgeArea, QueryScopeMode, ReviewQueueSize } from "./types";
import type { AIFeature, AIActionCategory, AIFunctionConfig, AIProfile, KnowledgeWorkspace, ModelMetadata, PermissionValue, PluginSettings, ProfileDraft, SkillSummary, StateBrowseScopeMode } from "./types";
import { allFeatures, featureLabel, resolveAIFunctionRoute, DEFAULT_PROFILE_ID, applyProfileDraft, copyProfileTemplate, createProfileFromDraft, draftFromProfile, profileUsage, validateProfileDraft } from "./aiRouting";
import { defaultWorkspace, workspaceInstructions } from "./workspace";
import { BUILTIN_SKILL_SUMMARIES } from "./skills";
import { capabilityLabel, recommendModels, scoreModelFor, mergedCapabilities } from "./capabilities";
import { AI_ACTION_CATEGORIES, DEFAULT_PERMISSIONS, actionLabel, effectivePermission } from "./permissions";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 设置页：数据结构完整可配置；Appearance 视觉项仅保留数据字段（视觉迭代后置）。 */
export class KnowledgeGardenSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KnowledgeGardenPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    // ---------- General ----------
    new Setting(containerEl).setName("General").setHeading();
    new Setting(containerEl).setName("Dashboard 名称")
      .setDesc("显示在 Dashboard 标签页上的标题。")
      .addText((t) => t.setValue(s.dashboardName).onChange(async (v) => {
        s.dashboardName = v || "知识花园";
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("启动 Obsidian 时打开")
      .setDesc("打开 Obsidian 后自动打开知识花园 Dashboard。")
      .addToggle((t) => t.setValue(s.openOnStartup).onChange(async (v) => {
        s.openOnStartup = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("打开 Dashboard")
      .addButton((b) => b.setButtonText("打开").onClick(() => { void this.plugin.activateView(); }));

    // ---------- Knowledge Areas ----------
    new Setting(containerEl).setName("Knowledge Areas 知识区域")
      .setHeading()
      .setDesc("核心结构：每个区域对应 Vault 内一个文件夹。笔记数量、最近修改/新增由插件实时统计，不手动填写。");
    const topFolders = Array.from(new Set(this.plugin.index.all().map((n) => n.folder).filter(Boolean))).slice(0, 24);
    new Setting(containerEl).setName("Vault 现有顶层文件夹")
      .setDesc(topFolders.length ? topFolders.join("  ·  ") : "（Vault 中还没有 Markdown 笔记）");

    const areaList = containerEl.createDiv({ cls: "kg-settings-area-list" });
    const refreshAreas = (): void => {
      areaList.empty();
      for (const area of s.knowledgeAreas) {
        const row = new Setting(areaList);
        row.setName((area.icon || "📁") + " " + area.name)
          .setDesc(area.folder + (area.participateInAI ? " · 参与 AI" : " · 不参与 AI"));
        row.addToggle((t) => t.setValue(area.participateInAI).onChange(async (v) => {
          area.participateInAI = v;
          await this.plugin.saveSettings();
          this.refreshDashboard();
        }));
        row.addButton((b) => b.setButtonText("删除").onClick(async () => {
          s.knowledgeAreas = s.knowledgeAreas.filter((x) => x.id !== area.id);
          await this.plugin.saveSettings();
          refreshAreas();
          this.refreshDashboard();
        }));
      }
    };
    refreshAreas();

    let name = "";
    let folder = "";
    let icon = "";

    new Setting(containerEl).setName("添加知识区域")
      .setDesc("名称 + Vault 内文件夹路径（可填写顶层文件夹名，如 01 盒子）。图标可选，一个 emoji。")
      .addText((t) => { t.setPlaceholder("名称，如：AI"); t.onChange((v) => { name = v.trim(); }); })
      .addText((t) => { t.setPlaceholder("文件夹路径，如 08 参考资料"); t.onChange((v) => { folder = v.trim(); }); })
      .addText((t) => { t.setPlaceholder("图标，如 🧠"); t.onChange((v) => { icon = v.trim(); }); })
      .addButton((b) => b.setButtonText("添加").onClick(async () => {
        if (!name) { new Notice("请填写区域名称。"); return; }
        const area: KnowledgeArea = {
          id: uid(),
          name,
          folder: folder ? normalizePath(folder).replace(/\/+$/, "") : "",
          icon: icon || "📁",
          participateInAI: true,
        };
        s.knowledgeAreas.push(area);
        await this.plugin.saveSettings();
        name = folder = icon = "";
        refreshAreas();
        this.refreshDashboard();
      }));

    // ---------- Phase 11/13.5：AI Profiles（功能级模型路由，含 编辑/复制/设为默认/删除保护） ----------
    new Setting(containerEl).setName("AI Profiles（功能级模型路由）").setHeading()
      .setDesc("每个功能可独立指定 Profile/Model（§七十三）；换 Profile/换 Model → 该功能 Cache Miss（§八十二/八十三），互不影响（§八十五）。API Key 只存 data.json，编辑时不回显真实 Key（§六/§九十八）。");
    const profList = containerEl.createDiv({ cls: "kg-settings-area-list" });
    const refreshProfiles = (): void => {
      profList.empty();
      const defaultId = s.defaultProfileId || DEFAULT_PROFILE_ID;
      const usageOf = (id: string): ReturnType<typeof profileUsage> => profileUsage(id, s.aiFunctionConfig ?? [], s.workspaces ?? [], s.defaultProfileId);
      for (const p of s.aiProfiles ?? []) {
        const isDefault = p.id === defaultId;
        const featureUsers = usageOf(p.id).features;
        const wsUsers = usageOf(p.id).workspaces;
        const missing: string[] = [];
        if (!p.apiKey) missing.push("API Key");
        if (!p.defaultModel) missing.push("Model");
        const meta = (s.modelMetadata ?? []).find((mm) => mm.modelId === p.defaultModel);
        const caps = meta ? capabilityLabel(mergedCapabilities(meta)).slice(0, 4) : [];
        const capsText = caps.length ? caps.map((c) => c.label + (c.value ? " ✓" : " ✗")).join(" ") : "Capabilities: Unknown";
        const descParts = [
          "Provider: OpenAI-compatible",
          "Model: " + (p.defaultModel || "（未设置）"),
          "使用: " + featureUsers.length + " 个功能 · " + wsUsers.length + " 个 Workspace",
          capsText,
        ];
        if (missing.length) descParts.push("⚠ 配置不完整（缺少：" + missing.join("、") + "）");
        const row = new Setting(profList)
          .setName((p.name || p.id) + (isDefault ? "  ★ 默认" : ""))
          .setDesc(descParts.join(" · "));
        row.addButton((b) => b.setButtonText("编辑").onClick(() => new ProfileEditModal(this.app, this.plugin, p, refreshProfiles).open()));
        row.addButton((b) => b.setButtonText("测试连接").onClick(async () => {
          const res = await this.plugin.testProfileConnection(p.id);
          new Notice(res.ok ? "连接成功\n模型：" + res.message : "连接失败\n类型：" + (res.code ?? "UNKNOWN") + "\n说明：无法连接当前 AI Profile。" + (res.message ? "\n" + res.message : ""));
        }));
        if (!isDefault) {
          row.addButton((b) => b.setButtonText("设为默认").onClick(async () => {
            s.defaultProfileId = p.id;
            await this.plugin.saveSettings();
            refreshProfiles();
            new Notice("已将「" + p.name + "」设为默认 Profile（§十五：只修改 defaultProfileId，不修改其他 Feature Route）。");
          }));
        }
        row.addButton((b) => b.setButtonText("复制").onClick(async () => {
          const t = copyProfileTemplate(p);
          s.aiProfiles = [...(s.aiProfiles ?? []), t];
          await this.plugin.saveSettings();
          refreshProfiles();
          new Notice("已复制为「" + t.name + "」。（API Key 未复制，§四十八；新 ID，§九十七）");
        }));
        row.addButton((b) => b.setButtonText("删除").onClick(async () => {
          if (featureUsers.length > 0 || wsUsers.length > 0) {
            new Notice("不能删除「" + p.name + "」：仍被 " + featureUsers.length + " 个功能 / " + wsUsers.length + " 个 Workspace 使用" +
              (featureUsers.length ? "（" + featureUsers.map(featureLabel).join(" / ") + "）" : "") +
              (wsUsers.length > 0 ? "（" + wsUsers.join(" / ") + "）" : "") +
              "。请先重新分配这些功能的 Profile（§五十/§一百三十七）。");
            return;
          }
          if (isDefault) {
            new Notice("「" + p.name + "」是默认 Profile，请先「设为默认」指定其他 Profile 后再删除（§六十三）。");
            return;
          }
          s.aiProfiles = (s.aiProfiles ?? []).filter((x) => x.id !== p.id);
          await this.plugin.saveSettings();
          refreshProfiles();
          new Notice("已删除 Profile「" + p.name + "」。（不影响 AI 缓存，§四十五）");
        }));
      }
    };
    refreshProfiles();
    new Setting(containerEl).setName("添加 AI Profile").addButton((b) => b.setButtonText("+ 添加").onClick(() => new ProfileEditModal(this.app, this.plugin, null, refreshProfiles).open()));
    new Setting(containerEl).setName("Feature → Profile → Model").setHeading()
      .setDesc("未显式配置的功能回退 Default Profile；Model 留空 = Profile 默认模型（§一百九十八/一百三十八）。");
    for (const f of allFeatures()) {
      const cfg = (s.aiFunctionConfig ?? []).find((c) => c?.feature === f);
      const route = resolveAIFunctionRoute(f, s.aiProfiles ?? [], s.aiFunctionConfig ?? [], s.defaultProfileId);
      // Phase 13 §一百一十一：推荐原因（Capability 匹配优先；推荐 ≠ 自动切换，§一百一十二）
      const rec = recommendModels(s.modelMetadata ?? [], f);
      new Setting(containerEl).setName(featureLabel(f))
        .setDesc("当前：Profile " + route.profileId + " → Model " + route.model + (route.webEnabled ? " · Web: On" : "") + (rec.length > 0 && rec[0].modelId !== route.model ? " · 推荐：" + rec[0].modelId : ""))
        .addDropdown((d) => {
          d.addOption("", "Profile Default（未指定）");
          for (const p of s.aiProfiles ?? []) d.addOption(p.id, p.name || p.id);
          d.setValue(cfg?.profileId ?? "").onChange(async (v) => {
            if (!v) stripFunctionConfig(s, f, "profileId");
            else upsertFunctionConfig(s, f, { profileId: v });
            await this.plugin.saveSettings();
            void this.display();
          });
        })
        .addText((t) => t.setPlaceholder("临时模型（留空 = Profile 默认模型）")
          .setValue(cfg?.modelOverride ?? "")
          .onChange(async (v) => {
            upsertFunctionConfig(s, f, { modelOverride: v.trim() || undefined });
            await this.plugin.saveSettings();
          }));
      if (f === "copywriting") {
        new Setting(containerEl).setName("文案 · 联网能力").setDesc("ON：允许在用户明确提供 URL 时读取网页上下文（§九十二）").addToggle((t) => t.setValue(route.webEnabled).onChange(async (v) => {
          upsertFunctionConfig(s, f, { webEnabled: v });
          await this.plugin.saveSettings();
        }));
      }
    }
    new Setting(containerEl).setName("保护规则").setDesc("仍被功能使用的 Profile 禁止删除（§一百三十七）。")

    // ---------- Phase 13：Workspaces / Skills / Models & Capabilities / Permissions / Context ----------
    new Setting(containerEl).setName("AI Workspaces（知识工作空间）").setHeading()
      .setDesc("Workspace = 当前进行某一类知识活动时的稳定 AI 上下文（Scope + Instructions + Skills + 默认 Profile，§二~§十五）。只创建数据，不改变全局 Discovery Scope（§七）。");
    new Setting(containerEl).setName("当前工作空间")
      .addDropdown((d) => {
        d.addOption("", "默认（不使用 Workspace，保持现有行为）");
        for (const w of s.workspaces ?? []) d.addOption(w.id, w.name);
        d.setValue(s.currentWorkspaceId ?? "").onChange(async (v) => {
          s.currentWorkspaceId = v || null;
          await this.plugin.saveSettings();
        });
      });
    const wsList = containerEl.createDiv({ cls: "kg-settings-area-list" });
    const refreshWorkspaces = (): void => {
      wsList.empty();
      for (const w of s.workspaces ?? []) {
        const row = new Setting(wsList);
        row.setName(w.name || w.id)
          .setDesc("Scope: " + (w.discoveryScope ? (w.discoveryScope.mode ?? "custom") : "跟随全局") + " · Profile: " + (w.defaultAIProfileId || "跟随全局") + " · Skills: " + (w.skills?.length ?? 0) + " · 指令 " + workspaceInstructions(w).length + " 字");
        row.addButton((b) => b.setButtonText("编辑").onClick(() => new WorkspaceEditModal(this.app, this.plugin, w).open()));
        row.addButton((b) => b.setButtonText("删除").onClick(async () => {
          s.workspaces = (s.workspaces ?? []).filter((x) => x.id !== w.id);
          if (s.currentWorkspaceId === w.id) s.currentWorkspaceId = null;
          await this.plugin.saveSettings();
          refreshWorkspaces();
        }));
      }
    };
    refreshWorkspaces();
    new Setting(containerEl).setName("添加 Workspace").addButton((b) => b.setButtonText("+ 添加").onClick(() => new WorkspaceEditModal(this.app, this.plugin, null).open()));

    new Setting(containerEl).setName("Skills（技能）").setHeading()
      .setDesc("Skill = 可复用工作流程，不是单纯人格 Prompt（§十六~三十一）。目录：Knowledge Garden/Skills/<id>/SKILL.md；未提供时使用内置。正文按需加载（§二十三）。");
    const skillsList = containerEl.createDiv({ cls: "kg-settings-area-list" });
    for (const sk of s.skillRegistry ?? []) {
      new Setting(skillsList)
        .setName(sk.name + "（" + sk.id + "）")
        .setDesc(sk.description || "（无描述）")
        .addToggle((t) => t.setValue(sk.enabled).onChange(async (v) => {
          sk.enabled = v;
          await this.plugin.saveSettings();
        }));
    }
    new Setting(containerEl).setName("刷新 Skill 预读缓存").setDesc("重新读取 Knowledge Garden/Skills 目录（正文按需加载；0 AI）")
      .addButton((b) => b.setButtonText("刷新").onClick(async () => { await this.plugin.preloadSkills(); new Notice("Skills 预读缓存已刷新。"); }));

    new Setting(containerEl).setName("Models & Capabilities（模型能力注册表）").setHeading()
      .setDesc("能力来源：用户配置 > Provider metadata > 保守默认（§一百一十五）。未知能力显示 Unknown，绝不当作全部支持（§一百一十六）；不猜价格（§四十六）。");
    const modList = containerEl.createDiv({ cls: "kg-settings-area-list" });
    for (const m of s.modelMetadata ?? []) {
      new Setting(modList).setName(m.modelId)
        .setDesc("Provider: " + m.provider + " · " + capabilityText(m) + (m.pricingHint ? " · Cost: " + m.pricingHint : "") + (m.contextWindow ? " · Context: " + m.contextWindow : ""))
        .addButton((b) => b.setButtonText("编辑").onClick(() => new ModelEditModal(this.app, this.plugin, m).open()))
        .addButton((b) => b.setButtonText("删除").onClick(async () => {
          s.modelMetadata = (s.modelMetadata ?? []).filter((x) => x.modelId !== m.modelId);
          await this.plugin.saveSettings();
          void this.display();
        }));
    }
    new Setting(containerEl).setName("添加模型元数据").addButton((b) => b.setButtonText("+ 添加").onClick(() => new ModelEditModal(this.app, this.plugin, null).open()));

    new Setting(containerEl).setName("Permissions（AI 权限策略）").setHeading()
      .setDesc("allow 允许 / ask 询问 / deny 禁止；默认：本地读 allow、修改/关系/外网 ask、删除 deny（§九十）。全局 deny 不可被任何 Workspace / Feature 绕过（§九十二/Test 36）。");
    for (const a of AI_ACTION_CATEGORIES) {
      const cur = s.permissionsPolicy?.[a] ?? DEFAULT_PERMISSIONS[a];
      new Setting(containerEl).setName(actionLabel(a))
        .addDropdown((d) => {
          for (const v of ["allow", "ask", "deny"] as PermissionValue[]) {
            d.addOption(v, (v === "allow" ? "允许" : v === "ask" ? "询问" : "禁止") + (a === "DESTRUCTIVE" && v === "allow" ? "（全局安全固定，不会生效）" : ""));
          }
          d.setValue(cur).onChange(async (v) => {
            s.permissionsPolicy = { ...(s.permissionsPolicy ?? {}), [a]: v as PermissionValue };
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl).setName("Context（上下文策略）").setHeading()
      .setDesc("Context Engine 统一控制每个 AI 功能看到什么（§三十二~四十二）：Selection > Current Note > Confirmed Relations > Related Notes > Saved Exploration > Web。只发送用户勾选的内容，超限显式标记「已截断」。");

    // ---------- AI ----------
    new Setting(containerEl).setName("AI — 知识连接器")
      .setHeading()
      .setDesc("AI 只做分析：发现跨领域连接、提问、找冲突。绝不自动总结并覆盖、修改、移动、删除你的笔记。");
    new Setting(containerEl).setName("Provider")
      .setDesc("当前版本仅支持 SiliconFlow（OpenAI-compatible API）。未来可替换 Provider 而不改 UI。")
      .addText((t) => { t.setValue(s.ai.provider).setDisabled(true); });
    new Setting(containerEl).setName("Base URL")
      .addText((t) => t.setValue(s.ai.baseUrl).onChange(async (v) => { s.ai.baseUrl = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("API Key")
      .setDesc("只保存在本插件 data.json（已加入 .gitignore），绝不写入笔记、日志或错误提示。")
      .addText((t) => t.setValue(s.ai.apiKey).onChange(async (v) => { s.ai.apiKey = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Model")
      .setDesc("SiliconFlow 模型 ID，例如 Qwen/Qwen2.5-7B-Instruct。")
      .addText((t) => t.setValue(s.ai.model).onChange(async (v) => { s.ai.model = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Temperature")
      .setDesc("0 表示更保守，1 表示更有想象力。")
      .addSlider((sl) => sl.setLimits(0, 1, 0.05).setValue(s.ai.temperature).setDynamicTooltip().onChange(async (v) => { s.ai.temperature = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Max Tokens")
      .setDesc("单次 AI 请求最大输出 token 数。")
      .addText((t) => t.setValue(String(s.ai.maxTokens)).onChange(async (v) => { const n = Number(v); if (n > 0) { s.ai.maxTokens = n; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Timeout（秒）")
      .addText((t) => t.setValue(String(s.ai.timeoutSec)).onChange(async (v) => { const n = Number(v); if (n >= 5) { s.ai.timeoutSec = n; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("连接测试")
      .setDesc("验证 API Key、Base URL 与模型。")
      .addButton((b) => b.setButtonText("测试连接").onClick(async () => {
        b.setDisabled(true);
        b.setButtonText("测试中…");
        try {
          await this.plugin.ai.testConnection();
          new Notice("AI 连接成功：模型可用。");
        } catch (e) {
          new Notice("AI 连接失败：" + (e instanceof Error ? e.message : String(e)) + "（本地知识索引不受影响）");
        } finally {
          b.setDisabled(false);
          b.setButtonText("测试连接");
        }
      }));
    new Setting(containerEl).setName("今日知识奇想")
      .setDesc("手动生成「今日知识奇想」：AI 从近期笔记中找跨领域连接 / 值得追问的问题 / 观点冲突，输出严格 JSON 并校验。")
      .addButton((b) => b.setButtonText("生成（缓存感知）").onClick(() => { void this.plugin.runCuriosity(); }))
      .addButton((b) => b.setButtonText("强制重新生成").onClick(() => { void this.plugin.runCuriosity(true); }));

    // ---------- AI Cache ----------
    new Setting(containerEl).setName("AI Cache")
      .setHeading()
      .setDesc("AI 结果缓存于 .obsidian/plugins/knowledge-garden/cache/ai-cache.json。同一周期 + 同候选笔记 + 同模型配置默认复用，不重复消耗 Token。清空只会删除 cache/，绝不触碰 Reviews/（复盘 Markdown 是你的知识）。");
    const cacheStatus = containerEl.createDiv({ cls: "kg-cache-status" });
    const renderCacheStatus = (): void => {
      const st = this.plugin.cache.stats();
      const kb = st.bytes >= 1024 ? (st.bytes / 1024).toFixed(1) + " KB" : st.bytes + " B";
      const types = Object.entries(st.byType).map(([k, v]) => k + ":" + v).join("  ·  ");
      cacheStatus.setText("缓存条目：" + st.count + " 条 · 占用 " + kb + (st.lastUpdated ? " · 最后更新 " + new Date(st.lastUpdated).toLocaleString("zh-CN") : "") + (types ? " · " + types : ""));
    };
    renderCacheStatus();
    new Setting(containerEl).setName("缓存操作")
      .addButton((b) => b.setButtonText("查看缓存状态").onClick(() => renderCacheStatus()))
      .addButton((b) => b.setButtonText("清空 AI 缓存").onClick(() => {
        const notice = new Notice("确认清空全部 AI 缓存？此操作不可撤销（只删 cache/，Reviews/ 不受影响）。", 0);
        ;(notice as unknown as { addAction(label: string, cb: () => void): void }).addAction("确认清空", () => { this.plugin.clearAICache(); notice.hide(); renderCacheStatus(); });
        ;(notice as unknown as { addAction(label: string, cb: () => void): void }).addAction("取消", () => { notice.hide(); });
      }));

    // ---------- Query Explorer（§一百一十六~一百一十八：问题 → 全库检索 → AI 关联） ----------
    new Setting(containerEl).setName("Query Explorer 我的探索")
      .setHeading()
      .setDesc("输入问题/关键词 → 本地全库检索（Search Index）→ AI 关联。候选集不变则缓存有效，绝不污染今日奇想/漫游等其他 AI 缓存。");
    new Setting(containerEl).setName("默认范围")
      .setDesc("vault=整个仓库（默认）；current-discovery-scope=沿用当前漫游范围（奇想与漫游范围本来就是分开的，这里按漫游范围走）。")
      .addDropdown((dd) => dd
        .addOption("vault", "整个仓库")
        .addOption("current-discovery-scope", "当前漫游范围")
        .setValue(this.plugin.settings.queryExplorer.scopeMode)
        .onChange(async (v) => { this.plugin.settings.queryExplorer.scopeMode = v as QueryScopeMode; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("AI 候选数量")
      .setDesc("最终发给 AI 整理的候选笔记数（8/12/16/24/32，默认 16）。")
      .addDropdown((dd) => {
        for (const n of [8, 12, 16, 24, 32]) dd.addOption(String(n), String(n) + " 篇");
        dd.setValue(String(this.plugin.settings.queryExplorer.candidateCount));
        dd.onChange(async (v) => { this.plugin.settings.queryExplorer.candidateCount = Number(v); await this.plugin.saveSettings(); });
      });
    new Setting(containerEl).setName("本地搜索结果上限")
      .setDesc("本地检索候选池上限（默认 50；只影响本地检索，不影响 AI 请求量）。")
      .addSlider((sl) => sl.setLimits(10, 200, 10)
        .setValue(this.plugin.settings.queryExplorer.localResultLimit)
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.queryExplorer.localResultLimit = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("保留最近探索")
      .setDesc("Query History 保留条数（默认 20，最多 100；只存 问题/时间/范围/缓存键/标题，不存 AI prompt）。")
      .addSlider((sl) => sl.setLimits(5, 100, 5)
        .setValue(Math.min(100, Math.max(5, this.plugin.settings.queryExplorer.historyLimit)))
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.queryExplorer.historyLimit = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("保存探索时自动生成")
      .setDesc("默认 OFF：只有你点击「保存探索」才写 Markdown（Knowledge Garden/Explorations/YYYY-MM-DD/），避免 Vault 被低价值探索污染。")
      .addToggle((tg) => tg.setValue(this.plugin.settings.queryExplorer.autoSave)
        .onChange(async (v) => { this.plugin.settings.queryExplorer.autoSave = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("最近探索历史")
      .setDesc("只删除 query-history.json；AI 缓存与 Reviews/ 不受影响。")
      .addButton((b) => b.setButtonText("清空最近探索").onClick(() => { this.plugin.clearQueryHistory(); }));

    // ---------- Automatic Review（§20/21/36/38/39） ----------
    // ---------- Capture & Processing（本阶段 §六十九/一百零八：Capture 0 AI；AI 提炼是用户主动操作） ----------
    new Setting(containerEl).setName("Capture & Processing（捕获与提炼）").setHeading();
    new Setting(containerEl).setName("Inbox Folder（待处理捕获）")
      .setDesc("新建捕获 / 剪贴板 / URL 捕获落在哪里。默认 Knowledge Garden/Inbox。")
      .addText((t) => t.setPlaceholder("Knowledge Garden/Inbox").setValue(s.capture.inboxFolder).onChange(async (v) => { s.capture.inboxFolder = v.trim(); await this.plugin.saveSettings(); void this.plugin.ensureCaptureFolders(); }))
    new Setting(containerEl).setName("Processing Folder（知识候选）")
      .setDesc("AI「处理当前捕获」后生成的 Knowledge Candidate 放在哪里。默认 Knowledge Garden/Processing。")
      .addText((t) => t.setPlaceholder("Knowledge Garden/Processing").setValue(s.capture.processingFolder).onChange(async (v) => { s.capture.processingFolder = v.trim(); await this.plugin.saveSettings(); void this.plugin.ensureCaptureFolders(); }))
    new Setting(containerEl).setName("Knowledge Folder（已确认知识）")
      .setDesc("用户确认后提炼出的 Knowledge 放在哪里。默认 Knowledge Garden/Knowledge。")
      .addText((t) => t.setPlaceholder("Knowledge Garden/Knowledge").setValue(s.capture.knowledgeFolder).onChange(async (v) => { s.capture.knowledgeFolder = v.trim(); await this.plugin.saveSettings(); void this.plugin.ensureCaptureFolders(); }))
    new Setting(containerEl).setName("Archive Folder（归档保留）")
      .setDesc("归档优先于删除；来源/provenance 保留。默认 Knowledge Garden/Archive。")
      .addText((t) => t.setPlaceholder("Knowledge Garden/Archive").setValue(s.capture.archiveFolder).onChange(async (v) => { s.capture.archiveFolder = v.trim(); await this.plugin.saveSettings(); void this.plugin.ensureCaptureFolders(); }))
    new Setting(containerEl).setName("AI 自动处理")
      .setDesc("默认 OFF（§一百一十）：Capture 是低成本输入，AI 提炼是需要用户掌控 Token 成本的主动操作。")
      .addToggle((t) => t.setValue(s.capture.autoProcess).onChange(async (v) => { s.capture.autoProcess = v; await this.plugin.saveSettings(); }))
    new Setting(containerEl).setName("AI 建议标签")
      .setDesc("Processing 时是否让 AI 建议标签（用户可逐项接受/忽略/编辑，§一百零四）。")
      .addToggle((t) => t.setValue(s.capture.suggestTags).onChange(async (v) => { s.capture.suggestTags = v; await this.plugin.saveSettings(); }))
    new Setting(containerEl).setName("AI 建议知识区域")
      .setDesc("Processing 时是否让 AI 建议已有知识区域（不自动写入，用户选择已有 Area §七十）。")
      .addToggle((t) => t.setValue(s.capture.suggestAreas).onChange(async (v) => { s.capture.suggestAreas = v; await this.plugin.saveSettings(); }))
    new Setting(containerEl).setName("保存原始来源（provenance）")
      .setDesc("Capture 的来源 URL/标题/来源笔记链在 Processing/Knowledge/Archive 中保留（§四十六）。")
      .addToggle((t) => t.setValue(s.capture.preserveSources).onChange(async (v) => { s.capture.preserveSources = v; await this.plugin.saveSettings(); }))

    new Setting(containerEl).setName("Automatic Review 自动复盘")
      .setHeading()
      .setDesc("到点后按 ScheduleState + AI Cache 四重校验决定是否真正执行：本周期已有缓存直接复用，绝不重复消耗 Token（§25/40）。自动生成的复盘只写 ScheduleState=done，绝不修改 lastReviewedAt（§三/§31）。");
    new Setting(containerEl).setName("启用自动复盘")
      .setDesc("首次开启会提示一次：可能产生 SiliconFlow API 消耗（§39）。")
      .addToggle((t) => t.setValue(s.automaticReview.enabled).onChange(async (v) => {
        s.automaticReview.enabled = v;
        await this.plugin.saveSettings();
        if (v && !s.automaticReview.notifiedOnce) {
          s.automaticReview.notifiedOnce = true;
          await this.plugin.saveSettings();
          new Notice("自动复盘已开启。\nKnowledge Garden 会按你的计划运行 AI 复盘，可能产生 SiliconFlow API 消耗。\n你可以随时在设置中关闭。");
        }
        this.refreshDashboard();
        if (v && this.plugin.scheduler) void this.plugin.scheduler.checkNow();
      }));
    new Setting(containerEl).setName("生成前确认")
      .setDesc("到点先询问（生成 / 跳过 / 稍后提醒），不直接调用 AI（§21）。")
      .addToggle((t) => t.setValue(s.automaticReview.confirmBeforeRun).onChange(async (v) => { s.automaticReview.confirmBeforeRun = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("错过后确认")
      .setDesc("Obsidian 在计划时间没运行时，再次打开先询问是否补生成；关闭则直接跳过，绝不无提示调用 AI（§19/36）。")
      .addToggle((t) => t.setValue(s.automaticReview.confirmAfterMissed).onChange(async (v) => { s.automaticReview.confirmAfterMissed = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("应用启动后检查")
      .setDesc("插件启动时立即检查一次是否到点 / 错过（§36）。")
      .addToggle((t) => t.setValue(s.automaticReview.startupCheck).onChange(async (v) => { s.automaticReview.startupCheck = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Review 复盘机制")
      .setHeading()
      .setDesc("复盘结果永远是「Knowledge Garden/Reviews/」下的可读 Markdown。手动生成立即执行；自动周期任务在下方「Automatic Review」中启用。");
    new Setting(containerEl).setName("日复盘（手动）")
      .setDesc("用今天的近期笔记生成日复盘 Markdown。")
      .addButton((b) => b.setButtonText("生成日复盘").onClick(() => { void this.plugin.runReview("daily"); }));
    new Setting(containerEl).setName("周复盘（手动）")
      .setDesc("加入「被遗忘的知识」（超过 14 天未修改的笔记）提醒。")
      .addButton((b) => b.setButtonText("生成周复盘").onClick(() => { void this.plugin.runReview("weekly"); }));
    new Setting(containerEl).setName("复盘周期配置")
      .setDesc("以下为数据结构预留：每日/每周/每月/每季度/自定义。自动调度在后续阶段启用后生效。");
    new Setting(containerEl).setName("Daily")
      .addToggle((t) => t.setValue(s.review.daily.enabled).onChange(async (v) => { s.review.daily.enabled = v; await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(s.review.daily.time).onChange(async (v) => { s.review.daily.time = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Weekly")
      .addToggle((t) => t.setValue(s.review.weekly.enabled).onChange(async (v) => { s.review.weekly.enabled = v; await this.plugin.saveSettings(); }))
      .addDropdown((d) => d.addOption("0", "周日").addOption("1", "周一").addOption("2", "周二").addOption("3", "周三").addOption("4", "周四").addOption("5", "周五").addOption("6", "周六").setValue(String(s.review.weekly.weekday)).onChange(async (v) => { s.review.weekly.weekday = Number(v); await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(s.review.weekly.time).onChange(async (v) => { s.review.weekly.time = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Monthly")
      .addToggle((t) => t.setValue(s.review.monthly.enabled).onChange(async (v) => { s.review.monthly.enabled = v; await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(s.review.monthly.day).onChange(async (v) => { s.review.monthly.day = v; await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(s.review.monthly.time).onChange(async (v) => { s.review.monthly.time = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Quarterly")
      .setDesc("day: 1..28 或 last（季度末日期）。")
      .addToggle((t) => t.setValue(s.review.quarterly.enabled).onChange(async (v) => { s.review.quarterly.enabled = v; await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(s.review.quarterly.day).onChange(async (v) => { s.review.quarterly.day = v; await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(s.review.quarterly.time).onChange(async (v) => { s.review.quarterly.time = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Custom（每 N 天）")
      .setDesc("anchorDate: YYYY-MM-DD（留空则用首次启用当天为锚点）。")
      .addToggle((t) => t.setValue(s.review.custom.enabled).onChange(async (v) => { s.review.custom.enabled = v; await this.plugin.saveSettings(); }))
      .addText((t) => t.setValue(String(s.review.custom.everyDays)).onChange(async (v) => { const n = Number(v); if (n >= 1) { s.review.custom.everyDays = n; await this.plugin.saveSettings(); } }))
      .addText((t) => { t.setValue(s.review.custom.anchorDate); t.setPlaceholder("YYYY-MM-DD"); t.onChange(async (v) => { s.review.custom.anchorDate = v.trim(); await this.plugin.saveSettings(); }); })
      .addText((t) => t.setValue(s.review.custom.time).onChange(async (v) => { s.review.custom.time = v; await this.plugin.saveSettings(); }));

    // ---------- Activity / Knowledge State（§18~20：本地阈值，只影响状态与排序，不清 AI 缓存） ----------
    new Setting(containerEl).setName("Activity / Knowledge State 知识状态")
      .setHeading()
      .setDesc("本地规则判定五态：new / growing / active / stale / forgotten。修改阈值只影响状态与 AI 候选排序，绝不自动清空 AI 缓存（§25）。");
    new Setting(containerEl).setName("新知识天数（newDays）")
      .setDesc("创建后 N 天内视为「新知识」。")
      .addText((t) => t.setValue(String(s.activity.newDays)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 1) { s.activity.newDays = Math.floor(n); await this.plugin.saveSettings(); this.refreshDashboard(); }
      }));
    new Setting(containerEl).setName("疏于维护天数（staleDays）")
      .setDesc("N 天无访问 / 无修改 / 无复习 →「疏于维护」。")
      .addText((t) => t.setValue(String(s.activity.staleDays)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 1) { s.activity.staleDays = Math.floor(n); await this.plugin.saveSettings(); this.refreshDashboard(); }
      }));
    new Setting(containerEl).setName("可能遗忘天数（forgottenDays）")
      .setDesc("N 天未访问且未复习、仍有知识连接 →「可能正在被遗忘」（本地规则候选，AI 不判定遗忘）。")
      .addText((t) => t.setValue(String(s.activity.forgottenDays)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 1) { s.activity.forgottenDays = Math.floor(n); await this.plugin.saveSettings(); this.refreshDashboard(); }
      }));
    new Setting(containerEl).setName("最近访问显示条数（recentLimit）")
      .setDesc("Dashboard「最近访问」与周复盘输入的最大条数。")
      .addText((t) => t.setValue(String(s.activity.recentLimit)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 1 && n <= 50) { s.activity.recentLimit = Math.floor(n); await this.plugin.saveSettings(); this.refreshDashboard(); }
      }));

    // ---------- Phase 6：Hero 壁纸 ----------
    new Setting(containerEl).setName("Hero 壁纸").setHeading()
      .setDesc("Vault 内图片作为首页背景；路径一律 Vault 相对路径 + normalizePath，不拼 OS 路径（§9/58）。");
    new Setting(containerEl).setName("背景图片（单图，Vault 内路径）")
      .addText((t) => t.setValue(s.hero.background).onChange(async (v) => { s.hero.background = normalizePath(v.trim()); await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("随机壁纸文件夹")
      .setDesc("空 = 不使用随机文件夹；支持 jpg/jpeg/png/webp/gif/avif（§10）。")
      .addText((t) => t.setValue(s.hero.folder).onChange(async (v) => { s.hero.folder = normalizePath(v.trim()).replace(/\/+$/, ""); await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("随机切换")
      .setDesc("开启后：Dashboard 打开时随机选一张；Dashboard 内部 refresh / rerender 不反复跳动（§11）。")
      .addToggle((t) => t.setValue(s.hero.random).onChange(async (v) => { s.hero.random = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("遮罩透明度")
      .setDesc("0 ~ 0.8；数值过低文字可能看不清，可加轻微渐变兜底（§13）。")
      .addSlider((sl) => sl.setLimits(0, 0.8, 0.05).setValue(s.hero.overlay).setDynamicTooltip().onChange(async (v) => { s.hero.overlay = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("标题")
      .addText((t) => t.setValue(s.hero.title).onChange(async (v) => { s.hero.title = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("副标题")
      .addText((t) => t.setValue(s.hero.subtitle).onChange(async (v) => { s.hero.subtitle = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("立即换一张")
      .setDesc("从随机文件夹选一张并立即生效（不重开 Dashboard）；没有可用图片则保留当前 / 纯背景（§48/49）。")
      .addButton((b) => b.setButtonText("换一张").onClick(async () => {
        const f = pickRandomImage(this.plugin.app, s.hero.folder);
        if (f) { s.hero.current = f.path; await this.plugin.saveSettings(); } else { new Notice("随机文件夹中没有可用图片。"); }
        this.refreshDashboard();
      }));

    // ---------- Phase 6：音乐播放器 ----------
    new Setting(containerEl).setName("音乐播放器").setHeading()
      .setDesc("本地音频（mp3/wav/ogg/m4a/aac），只在本地播放，绝不上传；使用 HTMLAudioElement（§18/62）。");
    new Setting(containerEl).setName("启用")
      .addToggle((t) => t.setValue(s.music.enabled).onChange(async (v) => { s.music.enabled = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("音乐文件夹")
      .addText((t) => t.setValue(s.music.folder).onChange(async (v) => { s.music.folder = normalizePath(v.trim()).replace(/\/+$/, ""); await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("自动播放")
      .setDesc("默认关闭（浏览器可能阻止自动播放）；开启后若 play() 被拒绝则静默处理，不报错（§21）。")
      .addToggle((t) => t.setValue(s.music.autoplay).onChange(async (v) => { s.music.autoplay = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("随机播放")
      .addToggle((t) => t.setValue(s.music.shuffle).onChange(async (v) => { s.music.shuffle = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("循环播放")
      .setDesc("开启：列表循环；关闭：播完一首停止。")
      .addToggle((t) => t.setValue(s.music.repeat).onChange(async (v) => { s.music.repeat = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("音量")
      .addSlider((sl) => sl.setLimits(0, 1, 0.05).setValue(s.music.volume).setDynamicTooltip().onChange(async (v) => { s.music.volume = v; await this.plugin.saveSettings(); }));

    // ---------- Phase 6：Dashboard 显示控制 ----------
    new Setting(containerEl).setName("Dashboard 显示").setHeading()
      .setDesc("控制首页密度与区块可见性；只影响 UI，不改变 AI / Cache / Scheduler / Activity（§54）。");
    new Setting(containerEl).setName("内容最大宽度")
      .setDesc("px；建议 1200-1600（§7/40）。")
      .addText((t) => t.setValue(String(s.dashboard.contentWidth)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 900 && n <= 2000) { s.dashboard.contentWidth = Math.floor(n); await this.plugin.saveSettings(); this.refreshDashboard(); }
      }));
    new Setting(containerEl).setName("显示 Hero").addToggle((t) => t.setValue(s.dashboard.showHero).onChange(async (v) => { s.dashboard.showHero = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("显示音乐播放器").addToggle((t) => t.setValue(s.dashboard.showMusic).onChange(async (v) => { s.dashboard.showMusic = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("显示最近访问").addToggle((t) => t.setValue(s.dashboard.showRecentAccess).onChange(async (v) => { s.dashboard.showRecentAccess = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("显示今日复习卡")
      .setDesc("Phase 8：原「值得重新看看」升级为「✦ 今日复习」——候选 Reason 包含“可能正在被遗忘”（§七十五）。")
      .addToggle((t) => t.setValue(s.dashboard.showForgotten).onChange(async (v) => { s.dashboard.showForgotten = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("密度")
      .setDesc("compact：更紧凑；comfortable：默认留白（§55）。")
      .addDropdown((d) => d.addOption("compact", "紧凑").addOption("comfortable", "舒适").setValue(s.dashboard.density).onChange(async (v) => {
        s.dashboard.density = v as "compact" | "comfortable";
        await this.plugin.saveSettings(); this.refreshDashboard();
      }));


    // ---------- Phase 7：知识演化（知识状态机与长期演化） ----------
    new Setting(containerEl).setName("知识演化").setHeading()
      .setDesc("每周自动生成本地快照；Dashboard 只读展示（绝不自动触发 AI，§五十三）。月度/季度长期观察由 AI 解读本地聚合指标（§三十三），默认只发送元数据。");
    new Setting(containerEl).setName("启用知识演化")
      .setDesc("关闭后不记录周快照、Dashboard 不显示演化卡。")
      .addToggle((t) => t.setValue(s.evolution.enabled).onChange(async (v) => { s.evolution.enabled = v; await this.plugin.saveSettings(); this.refreshDashboard(); }));
    new Setting(containerEl).setName("长期 AI 分析")
      .setDesc("off：不自动调用长期 AI；metadata：只发送聚合统计与笔记标题（默认）；excerpts：额外包含代表性笔记摘录（第一版以 metadata 方式处理）。")
      .addDropdown((d) => d.addOption("off", "关闭").addOption("metadata", "仅元数据（默认）").addOption("excerpts", "含笔记摘录").setValue(s.evolution.longTermAI).onChange(async (v) => {
        s.evolution.longTermAI = v as "off" | "metadata" | "excerpts";
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("快照保留周数")
      .setDesc("最多保留最近 N 个周快照（默认 52；历史快照不因删除/改名而篡改，§四十四）。")
      .addText((t) => t.setValue(String(s.evolution.keepWeeks)).onChange(async (v) => {
        const n = Number(v);
        if (n >= 4 && n <= 208) { s.evolution.keepWeeks = Math.floor(n); await this.plugin.saveSettings(); }
      }));

    // ---------- Phase 8：Review Center（主动复习闭环；§六十二/六十三） ----------
    new Setting(containerEl).setName("Review Center").setHeading()
      .setDesc("每日复习队列是本地可执行状态，完全不需要 AI（§六十四）。只有你手动点「✓ 已复习」才更新复习记录（§七十）。");
    new Setting(containerEl).setName("每日复习数量")
      .setDesc("默认 5：每次复习是一个可完成的小任务（§八）。")
      .addDropdown((d) => d.addOption("3", "3 篇").addOption("5", "5 篇（默认）").addOption("8", "8 篇").addOption("10", "10 篇").setValue(String(s.reviewCenter.queueSize)).onChange(async (v) => {
        s.reviewCenter.queueSize = Number(v) as ReviewQueueSize;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl).setName("自动生成每日复习队列")
      .setDesc("日复盘成功后自动生成本地队列（默认 ON；纯本地计算，不调用 AI，§四十二）。")
      .addToggle((t) => t.setValue(s.reviewCenter.autoQueue).onChange(async (v) => { s.reviewCenter.autoQueue = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("AI 复习问题")
      .setDesc("开启后，进入复习窗口时为待复习笔记生成引导回忆的问题（只发送当前待复习笔记的标题/区域/标签/摘要，绝不传整库，§十九）。AI 失败自动用系统问题，不阻塞复习（§二十五）。")
      .addToggle((t) => t.setValue(s.reviewCenter.aiQuestion).onChange(async (v) => { s.reviewCenter.aiQuestion = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("每次最多生成问题")
      .setDesc("每次复习 Session 最多 1 次 AI 请求、最多 N 个问题（§五十六）。")
      .addDropdown((d) => d.addOption("3", "3 个").addOption("5", "5 个（默认）").setValue(String(s.reviewCenter.maxQuestions)).onChange(async (v) => { s.reviewCenter.maxQuestions = Number(v); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("连续跳过惩罚")
      .setDesc("某篇笔记连续 3 次被跳过 → 下次推荐降级，但绝不永久排除（§三十二）。")
      .addToggle((t) => t.setValue(s.reviewCenter.skipPenalty).onChange(async (v) => { s.reviewCenter.skipPenalty = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("自动打开复习窗口")
      .setDesc("日复盘成功后自动弹出复习窗口（默认 OFF：不要让 Obsidian 晚上自动弹出强制学习窗口，§六十三）。")
      .addToggle((t) => t.setValue(s.reviewCenter.autoOpenReview).onChange(async (v) => { s.reviewCenter.autoOpenReview = v; await this.plugin.saveSettings(); }));
    // ---------- Discovery Scope：全库知识奇想 + 可调节知识漫游范围（奇想/漫游独立，§六） ----------
    new Setting(containerEl).setName("知识发现").setHeading()
      .setDesc("奇想与漫游各自独立设置探索范围：奇想=发散（整个仓库找意外连接），漫游=收敛（沿指定领域深入）。本地先筛选候选再发给 AI（§十七），绝不上传整库。")
    new Setting(containerEl).setName("奇想 · 探索范围")
      .setDesc("候选来自本地筛选后的范围：整个仓库 / 指定知识区域 / 文件夹 / 标签 / 最近 N 天。")
      .addDropdown((d) => d.addOption("vault", "整个仓库").addOption("areas", "指定知识区域").addOption("folders", "文件夹").addOption("tags", "标签").addOption("recent", "最近 N 天").setValue(s.discovery.curiosity.scope.mode).onChange(async (v) => { s.discovery.curiosity.scope.mode = v as DiscoveryScopeMode; await this.plugin.saveSettings(); this.refreshDashboard(); }))
    if (s.discovery.curiosity.scope.mode === "areas") {
      new Setting(containerEl).setName("奇想 · 知识区域").setDesc("逗号分隔区域名（例如：AI, Python）。")
        .addText((t) => t.setPlaceholder("AI, Python").setValue((s.discovery.curiosity.scope.areaNames ?? []).join(", ")).onChange(async (v) => { s.discovery.curiosity.scope.areaNames = v.split(",").map((x) => x.trim()).filter(Boolean); await this.plugin.saveSettings(); }))
    }
    if (s.discovery.curiosity.scope.mode === "folders") {
      new Setting(containerEl).setName("奇想 · 文件夹").setDesc("逗号分隔文件夹路径（例如：AI, 游戏开发）。")
        .addText((t) => t.setPlaceholder("AI, 游戏开发").setValue((s.discovery.curiosity.scope.folders ?? []).join(", ")).onChange(async (v) => { s.discovery.curiosity.scope.folders = v.split(",").map((x) => x.trim()).filter(Boolean); await this.plugin.saveSettings(); }))
    }
    if (s.discovery.curiosity.scope.mode === "tags") {
      new Setting(containerEl).setName("奇想 · 标签").setDesc("逗号分隔标签（例如：#ai, #读书）。")
        .addText((t) => t.setPlaceholder("#ai, #读书").setValue((s.discovery.curiosity.scope.tags ?? []).join(", ")).onChange(async (v) => { s.discovery.curiosity.scope.tags = v.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean); await this.plugin.saveSettings(); }))
    }
    if (s.discovery.curiosity.scope.mode === "recent") {
      new Setting(containerEl).setName("奇想 · 最近天数").setDesc("只看最近 N 天修改过的笔记。")
        .addText((t) => t.setValue(String(s.discovery.curiosity.scope.recentDays ?? 7)).onChange(async (v) => { const n = Number(v); if (n >= 1 && n <= 3650) { s.discovery.curiosity.scope.recentDays = Math.floor(n); await this.plugin.saveSettings(); } }))
    }
    new Setting(containerEl).setName("奇想 · 候选数量")
      .setDesc("本地从探索范围里筛出多少个候选发给 AI（8~32，默认 16）。")
      .addDropdown((d) => { for (const n of [8, 12, 16, 24, 32]) d.addOption(String(n), String(n) + " 篇"); d.setValue(String(s.discovery.curiosity.candidateCount ?? 16)).onChange(async (v) => { s.discovery.curiosity.candidateCount = Number(v) as 8 | 12 | 16 | 24 | 32; await this.plugin.saveSettings(); }); })
    new Setting(containerEl).setName("奇想 · 探索旧知识")
      .setDesc("ON：候选里保留 10~20% 很久没被 AI 看过的老知识（少曝光加分，§二十七）。")
      .addToggle((t) => t.setValue(s.discovery.curiosity.exploreOld !== false).onChange(async (v) => { s.discovery.curiosity.exploreOld = v; await this.plugin.saveSettings(); }))
    new Setting(containerEl).setName("漫游 · 探索范围")
      .setDesc("知识漫游（可探索图）的本地候选来源，与奇想独立设置（§六）。")
      .addDropdown((d) => d.addOption("vault", "整个仓库").addOption("areas", "指定知识区域").addOption("folders", "文件夹").addOption("tags", "标签").addOption("recent", "最近 N 天").setValue(s.discovery.roaming.scope.mode).onChange(async (v) => { s.discovery.roaming.scope.mode = v as DiscoveryScopeMode; await this.plugin.saveSettings(); this.refreshDashboard(); }))
    if (s.discovery.roaming.scope.mode === "areas") {
      new Setting(containerEl).setName("漫游 · 知识区域").setDesc("逗号分隔区域名。")
        .addText((t) => t.setPlaceholder("AI, Python").setValue((s.discovery.roaming.scope.areaNames ?? []).join(", ")).onChange(async (v) => { s.discovery.roaming.scope.areaNames = v.split(",").map((x) => x.trim()).filter(Boolean); await this.plugin.saveSettings(); }))
    }
    if (s.discovery.roaming.scope.mode === "folders") {
      new Setting(containerEl).setName("漫游 · 文件夹").setDesc("逗号分隔文件夹路径。")
        .addText((t) => t.setPlaceholder("AI, 游戏开发").setValue((s.discovery.roaming.scope.folders ?? []).join(", ")).onChange(async (v) => { s.discovery.roaming.scope.folders = v.split(",").map((x) => x.trim()).filter(Boolean); await this.plugin.saveSettings(); }))
    }
    if (s.discovery.roaming.scope.mode === "tags") {
      new Setting(containerEl).setName("漫游 · 标签").setDesc("逗号分隔标签。")
        .addText((t) => t.setPlaceholder("#ai, #读书").setValue((s.discovery.roaming.scope.tags ?? []).join(", ")).onChange(async (v) => { s.discovery.roaming.scope.tags = v.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean); await this.plugin.saveSettings(); }))
    }
    if (s.discovery.roaming.scope.mode === "recent") {
      new Setting(containerEl).setName("漫游 · 最近天数").setDesc("只看最近 N 天修改过的笔记。")
        .addText((t) => t.setValue(String(s.discovery.roaming.scope.recentDays ?? 7)).onChange(async (v) => { const n = Number(v); if (n >= 1 && n <= 3650) { s.discovery.roaming.scope.recentDays = Math.floor(n); await this.plugin.saveSettings(); } }))
    }
    new Setting(containerEl).setName("漫游 · 候选数量")
      .setDesc("从漫游范围内筛出多少个候选发给 AI。")
      .addDropdown((d) => { for (const n of [8, 12, 16, 24, 32]) d.addOption(String(n), String(n) + " 篇"); d.setValue(String(s.discovery.roaming.candidateCount ?? 16)).onChange(async (v) => { s.discovery.roaming.candidateCount = Number(v) as 8 | 12 | 16 | 24 | 32; await this.plugin.saveSettings(); }); })
    new Setting(containerEl).setName("漫游 · 优先跨领域")
      .setDesc("ON：评分更看重跨领域连接与图连接性（默认，§三十五）。")
      .addToggle((t) => t.setValue(s.discovery.roaming.preferCrossArea !== false).onChange(async (v) => { s.discovery.roaming.preferCrossArea = v; await this.plugin.saveSettings(); }))

    // ---------- Phase 11：状态浏览设置（§一百二十四：0 AI） ----------
    new Setting(containerEl).setName("状态浏览（随机查看）").setHeading()
      .setDesc("范围只影响「点击状态卡 / 随机查看…命令」；纯本地，0 AI，绝不触发 AI 缓存（§一百二十六/一百八十八）。");
    new Setting(containerEl).setName("浏览范围").addDropdown((d) => {
      d.addOption("vault", "整个仓库");
      d.addOption("discovery", "当前 Discovery Scope（漫游范围）");
      d.addOption("areas", "指定知识区域");
      d.addOption("folders", "指定文件夹");
      d.addOption("tags", "指定标签");
      d.addOption("recent", "最近修改");
      d.addOption("custom", "自定义组合");
      d.setValue(s.stateBrowse?.mode ?? "vault").onChange(async (v) => {
        const mode = v as StateBrowseScopeMode;
        s.stateBrowse = { ...(s.stateBrowse ?? {}), mode };
        await this.plugin.saveSettings();
        void this.display();
      });
    });
    if (s.stateBrowse && (s.stateBrowse.mode === "areas" || s.stateBrowse.mode === "custom")) {
      new Setting(containerEl).setName("知识区域").setDesc("逗号分隔区域名（例如：AI, Python）").addText((t) => t.setValue((s.stateBrowse?.areaNames ?? []).join(", ")).onChange(async (v) => {
        s.stateBrowse = { ...(s.stateBrowse ?? {}), areaNames: v.split(",").map((x) => x.trim()).filter(Boolean) };
        await this.plugin.saveSettings();
      }));
    }
    if (s.stateBrowse && (s.stateBrowse.mode === "folders" || s.stateBrowse.mode === "custom")) {
      new Setting(containerEl).setName("文件夹").setDesc("逗号分隔文件夹路径").addText((t) => t.setValue((s.stateBrowse?.folders ?? []).join(", ")).onChange(async (v) => {
        s.stateBrowse = { ...(s.stateBrowse ?? {}), folders: v.split(",").map((x) => x.trim()).filter(Boolean) };
        await this.plugin.saveSettings();
      }));
    }
    if (s.stateBrowse && (s.stateBrowse.mode === "tags" || s.stateBrowse.mode === "custom")) {
      new Setting(containerEl).setName("标签").setDesc("逗号分隔标签（例如：#ai, #读书）").addText((t) => t.setValue((s.stateBrowse?.tags ?? []).join(", ")).onChange(async (v) => {
        s.stateBrowse = { ...(s.stateBrowse ?? {}), tags: v.split(",").map((x) => x.trim()).filter(Boolean) };
        await this.plugin.saveSettings();
      }));
    }
    if (s.stateBrowse && (s.stateBrowse.mode === "recent" || s.stateBrowse.mode === "custom")) {
      new Setting(containerEl).setName("最近天数").setDesc("只看最近 N 天修改过的笔记").addText((t) => t.setValue(String(s.stateBrowse?.recentDays ?? 14)).onChange(async (v) => {
        const n = Number(v);
        s.stateBrowse = { ...(s.stateBrowse ?? {}), recentDays: n > 0 ? n : 14 };
        await this.plugin.saveSettings();
      }));
    }

    new Setting(containerEl).setName("数据安全")
      .setDesc("复盘结果：Knowledge Garden/Reviews/ 下的 Markdown。AI 缓存与索引缓存：cache/。API Key 仅存于 data.json。");
  }

  private refreshDashboard(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("knowledge-garden-dashboard")) {
      (leaf.view as unknown as { scheduleRender(): void }).scheduleRender();
    }
  }
}

/** Feature 配置 upsert（§八十九）：不存在则新建（默认 profileId=default） */
function upsertFunctionConfig(s: PluginSettings, feature: AIFeature, patch: Partial<AIFunctionConfig>): void {
  const arr = Array.isArray(s.aiFunctionConfig) ? s.aiFunctionConfig : [];
  if (!Array.isArray(arr)) { s.aiFunctionConfig = []; }
  const list = s.aiFunctionConfig;
  const i = list.findIndex((c) => c?.feature === feature);
  if (i < 0) { list.push(Object.assign({ feature, profileId: "default" }, patch)); return; }
  list[i] = Object.assign({}, list[i], patch);
}

/** Feature 配置剥离某 key；若只剩默认值则整条移除（§一百三十五：回退 Default Profile） */
function stripFunctionConfig(s: PluginSettings, feature: AIFeature, key: "profileId" | "modelOverride"): void {
  const list = Array.isArray(s.aiFunctionConfig) ? s.aiFunctionConfig : [];
  const i = list.findIndex((c) => c?.feature === feature);
  if (i < 0) return;
  delete (list[i] as unknown as Record<string, unknown>)[key];
  const c = list[i];
  const isDefaultProfile = !c.profileId || c.profileId === "default";
  const noOverride = c.modelOverride === undefined || c.modelOverride === "";
  const noWeb = c.webEnabled === undefined;
  if (isDefaultProfile && noOverride && noWeb) { list.splice(i, 1); }
}

/** Profile 使用中检查（§一百三十七）：显式配置 + 未配置功能回退 default */
function usedByFeatures(configs: AIFunctionConfig[], profileId: string): AIFeature[] {
  const out: AIFeature[] = [];
  for (const f of allFeatures()) {
    const cfg = (configs ?? []).find((c) => c?.feature === f);
    const assigned = cfg ? (cfg.profileId || "default") : "default";
    if (assigned === profileId) out.push(f);
  }
  return out;
}

/** Phase 13.5：AI Profile 编辑器（create/edit 共用，§三/§八十六；编辑时 Key 不明文回显，§六/§七/§八；取消放弃未保存修改，§三十二）。 */
function maskKeyTail(k: string): string {
  return k.length > 4 ? k.slice(-4) : "••••";
}

class ProfileEditModal extends Modal {
  private editing: AIProfile | null;
  private draft: ProfileDraft;
  private keyChanged: boolean;
  private maxTokensText: string;
  private timeoutText: string;
  private onSaved?: () => void;
  constructor(app: App, private plugin: KnowledgeGardenPlugin, profile: AIProfile | null, onSaved?: () => void) {
    super(app);
    // §33：表单初始化复制对象（draftFromProfile），不得直接引用原 Profile 导致输入污染
    this.editing = profile;
    this.draft = profile
      ? draftFromProfile(profile)
      : { name: "", providerType: "openai_compatible", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "", temperature: 0.7, maxTokens: 2000, timeoutSec: 60 };
    // §7：已有 Key → 默认不修改；无 Key（新建或不完整）→ 直接允许输入
    this.keyChanged = !(profile && profile.apiKey);
    this.maxTokensText = String(this.draft.maxTokens);
    this.timeoutText = String(this.draft.timeoutSec);
    this.onSaved = onSaved;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.editing ? "编辑 AI Profile" : "添加 AI Profile" }); // §110/111
    new Setting(contentEl).setName("名称").setDesc(this.editing ? "修改只改名称；Feature Routing 仍通过 profileId 绑定，不因改名丢失关联（§十）。" : "")
      .addText((t) => t.setValue(this.draft.name).onChange((v) => { this.draft.name = v; }));
    new Setting(contentEl).setName("Provider").setDesc("当前版本仅支持 OpenAI-compatible（§五十五：不因编辑扩展新 Provider）。")
      .addText((t) => t.setValue(this.editing ? this.editing.providerType : "openai_compatible").setDisabled(true));
    new Setting(contentEl).setName("Base URL").setDesc("保存时 trim + 基础格式校验（§二十四：不过度严格 whitelist，允许自定义 endpoint）。")
      .addText((t) => t.setValue(this.draft.baseUrl).onChange((v) => { this.draft.baseUrl = v; }));
    let keyInput: import("obsidian").TextComponent | null = null;
    if (this.editing && this.editing.apiKey) {
      // §6：编辑已有 Profile 时，真实 Key 不在输入框里明文显示，只显示尾号
      new Setting(contentEl).setName("API Key")
        .setDesc("已保存（不在此回显，尾号 " + maskKeyTail(this.editing.apiKey) + "）。勾选「修改 API Key」后可输入新 Key；不勾选则原样保留（§六/§七）。")
        .addToggle((t) => t.setValue(false).onChange((v) => {
          this.keyChanged = v;
          if (keyInput) {
            keyInput.setDisabled(!v);
            keyInput.setPlaceholder(v ? "输入新的 API Key" : "已保存 · 修改请输入新 Key");
            keyInput.setValue("");
          }
        }));
      new Setting(contentEl).setName("新 API Key").addText((t) => {
        t.setPlaceholder("已保存 · 修改请输入新 Key").setDisabled(true);
        t.onChange((v) => { this.draft.apiKeyChange = { changed: true, value: v }; });
        keyInput = t;
        return t;
      });
    } else {
      // 新建或不完整 Profile：允许直接输入；留空允许保存（§六十四）但将标记 ⚠ 不完整（§六十五）
      new Setting(contentEl).setName("API Key")
        .setDesc("新 Profile：未配置（§六十四：允许保存但将标记 ⚠ 配置不完整，§六十五）。")
        .addText((t) => t.setPlaceholder("sk-…").onChange((v) => { this.draft.apiKeyChange = { changed: true, value: v }; }));
    }
    const capSetting = new Setting(contentEl).setName("默认模型")
      .setDesc("模型名称来自 Profile（§五十四：支持自有模型 ID，不限于 Registry；已知模型显示能力摘要，未知显示 Unknown，§五十六/九十五）。")
      .addText((t) => t.setValue(this.draft.defaultModel).onChange((v) => {
        this.draft.defaultModel = v;
        const meta = (this.plugin.settings.modelMetadata ?? []).find((mm) => mm.modelId === v.trim());
        const caps = meta ? capabilityLabel(mergedCapabilities(meta)).slice(0, 4) : [];
        capSetting.setDesc("模型名称来自 Profile（§五十四）。当前能力：" +
          (caps.length ? caps.map((c) => c.label + (c.value ? " ✓" : " ✗")).join(" ") : "Unknown（§五十六/九十五）"));
      }));
    new Setting(contentEl).setName("Temperature").addSlider((t) => t.setLimits(0, 2, 0.1).setValue(this.draft.temperature).setDynamicTooltip().onChange((v) => { this.draft.temperature = v; }));
    new Setting(contentEl).setName("Max Tokens").addText((t) => t.setValue(this.maxTokensText).onChange((v) => { this.maxTokensText = v; }));
    new Setting(contentEl).setName("Timeout（秒）").addText((t) => t.setValue(this.timeoutText).onChange((v) => { this.timeoutText = v; }));
    // §21：测试连接使用当前表单的未保存配置（不先保存再测试）；§19：不写 AI Cache；§20：不影响功能路由
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("测试连接").onClick(async () => {
        if (!(this.draft.baseUrl || "").trim()) { new Notice("请先填写 Base URL。"); return; }
        if (!(this.draft.defaultModel || "").trim()) { new Notice("请先填写默认模型。"); return; }
        const apiKey = this.editing && !this.keyChanged
          ? this.editing.apiKey
          : (this.draft.apiKeyChange?.value ?? "");
        const res = await this.plugin.testProfileConnectionDraft({ baseUrl: this.draft.baseUrl.trim(), apiKey, defaultModel: this.draft.defaultModel.trim() });
        // §23：成功只显示模型，不显示 Key/Authorization；§22：失败显示类型
        new Notice(res.ok ? "连接成功\n模型：" + res.message : "连接失败\n类型：" + (res.code ?? "UNKNOWN") + "\n说明：无法连接当前 AI Profile。" + (res.message ? "\n" + res.message : ""));
      }))
      .addButton((b) => b.setButtonText("取消").onClick(() => { this.close(); })) // §32：放弃所有未保存修改（表单只改 draft，原 Profile 未动）
      .addButton((b) => b.setButtonText(this.editing ? "保存修改" : "添加 Profile").setCta().onClick(async () => {
        // §29：validate → update → persist → refresh UI
        const draftFinal: ProfileDraft = {
          ...this.draft,
          maxTokens: Number(this.maxTokensText),
          timeoutSec: Number(this.timeoutText),
        };
        const errs = validateProfileDraft(draftFinal); // §87/88
        if (errs.length > 0) { new Notice("校验失败：" + errs[0]); return; }
        const cleared = this.draft.apiKeyChange ? (this.draft.apiKeyChange.changed && !this.draft.apiKeyChange.value) : false;
        if (this.editing) {
          const updated = applyProfileDraft(this.editing, draftFinal); // §12：保持 id；§43：revision+1
          this.plugin.settings.aiProfiles = (this.plugin.settings.aiProfiles ?? []).map((x) => x.id === updated.id ? updated : x);
        } else {
          const keyVal = this.draft.apiKeyChange?.value ?? "";
          const created = createProfileFromDraft({ ...draftFinal, apiKeyChange: { changed: true, value: keyVal } });
          this.plugin.settings.aiProfiles = [...(this.plugin.settings.aiProfiles ?? []), created];
        }
        await this.plugin.saveSettings(); // §81/82：统一持久化（loadData/saveData 原子机制），不自行写文件
        this.close(); // §112
        if (this.onSaved) this.onSaved(); // §83：设置页实时刷新，无需关闭重开
        if (this.editing) {
          const usage = usedByFeatures(this.plugin.settings.aiFunctionConfig ?? [], this.editing.id);
          // §30/§57/§58：成功后 Notice（不弹大窗口）；高影响 Profile 提示影响范围
          new Notice("已更新 AI Profile：" + draftFinal.name.trim() +
            (usage.length > 0 ? "（该 Profile 被 " + usage.length + " 个功能使用，下次请求将使用新配置，§五十七）" : "") +
            (cleared ? "；注意：该 Profile 未配置 API Key，相关功能运行时可能无法使用。（§八/§六十五）" : ""));
        } else {
          new Notice("已添加 AI Profile：" + draftFinal.name.trim());
        }
      }));
  }
}

/** 能力文本（§一百一十六：未知 → Unknown，绝不显示「全部支持」） */
function capabilityText(m: ModelMetadata): string {
  const caps = capabilityLabel(m.capabilities ?? {});
  if (caps.length === 0) return "Capabilities: Unknown";
  return "Capabilities: " + caps.map((c) => c.label + (c.value ? " ✓" : " ×")).join(" / ");
}

/** Phase 13 §五/§十：Workspace 编辑（Scope / Profile / Skills / Instructions；不持有 API Key，§十三） */
class WorkspaceEditModal extends Modal {
  private name = "";
  private description = "";
  private scopeMode: DiscoveryScopeMode | "" = "";
  private defaultAIProfileId = "";
  private skills: string[] = [];
  private instructions = "";
  private editing: KnowledgeWorkspace | null;

  constructor(app: App, private plugin: KnowledgeGardenPlugin, ws: KnowledgeWorkspace | null) {
    super(app);
    this.editing = ws;
    if (ws) {
      this.name = ws.name;
      this.description = ws.description || "";
      this.scopeMode = ws.discoveryScope ? ws.discoveryScope.mode : "";
      this.defaultAIProfileId = ws.defaultAIProfileId || "";
      this.skills = ws.skills ? ws.skills.slice() : [];
      this.instructions = ws.instructions || "";
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.editing ? "编辑 Workspace" : "添加 Workspace" });
    new Setting(contentEl).setName("名称").addText((t) => t.setValue(this.name).onChange((v) => { this.name = v.trim(); }));
    new Setting(contentEl).setName("描述").addText((t) => t.setValue(this.description).onChange((v) => { this.description = v.trim(); }));
    new Setting(contentEl).setName("探索范围（Scope）").setDesc("留空 = 跟随全局 Discovery Scope（§一百零四）；仅作为该 Workspace 的默认探索边界，不改全局（§七）")
      .addDropdown((d) => {
        d.addOption("", "跟随全局");
        for (const m of ["vault", "areas", "folders", "tags", "recent", "custom"]) d.addOption(m, m);
        d.setValue(this.scopeMode || "").onChange((v) => { this.scopeMode = (v as DiscoveryScopeMode) || ""; });
      });
    new Setting(contentEl).setName("默认 AI Profile").setDesc("Workspace 只引用 Profile ID，不允许直接持有 API Key（§十三）；Feature 路由优先于它（§十四）")
      .addDropdown((d) => {
        d.addOption("", "跟随全局 Default");
        for (const p of this.plugin.settings.aiProfiles ?? []) d.addOption(p.id, p.name || p.id);
        d.setValue(this.defaultAIProfileId).onChange((v) => { this.defaultAIProfileId = v; });
      });
    const skillsRow = contentEl.createDiv({ cls: "kg-settings-area-list" });
    for (const sk of this.plugin.settings.skillRegistry ?? []) {
      if (!sk.enabled) continue;
      const row = new Setting(skillsRow).setName(sk.name).addToggle((t) => t.setValue(this.skills.includes(sk.id)).onChange((v) => {
        this.skills = v ? Array.from(new Set([...this.skills, sk.id])) : this.skills.filter((x) => x !== sk.id);
      }));
    }
    new Setting(contentEl).setName("指令（Instructions）").setDesc("注入顺序：System Safety > Feature > Workspace > Skill > User（§十二）；不得覆盖安全规则（§一百四十）")
      .addTextArea((ta) => ta.setValue(this.instructions).onChange((v) => { this.instructions = v; }));
    const save = contentEl.createEl("button", { cls: "mod-cta", text: "保存 Workspace" });
    save.addEventListener("click", async () => {
      if (!this.name) { new Notice("请填写 Workspace 名称。"); return; }
      const ws: KnowledgeWorkspace = this.editing
        ? { ...this.editing, name: this.name, description: this.description || undefined, discoveryScope: this.scopeMode ? { mode: this.scopeMode } : undefined, defaultAIProfileId: this.defaultAIProfileId || undefined, skills: this.skills, instructions: this.instructions.trim(), updatedAt: Date.now() }
        : { id: uid(), name: this.name, description: this.description || undefined, discoveryScope: this.scopeMode ? { mode: this.scopeMode } : undefined, defaultAIProfileId: this.defaultAIProfileId || undefined, skills: this.skills, instructions: this.instructions.trim(), createdAt: Date.now(), updatedAt: Date.now() };
      if (this.editing) {
        const i = (this.plugin.settings.workspaces ?? []).findIndex((x) => x.id === this.editing!.id);
        if (i >= 0) this.plugin.settings.workspaces[i] = ws;
      } else {
        this.plugin.settings.workspaces = [...(this.plugin.settings.workspaces ?? []), ws];
      }
      await this.plugin.saveSettings();
      new Notice(this.editing ? "已更新 Workspace「" + ws.name + "」。可在「当前工作空间」切换。" : "已添加 Workspace「" + ws.name + "」。可在「当前工作空间」切换。");
      this.close();
    });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Phase 13 §四十五/一百一十五：模型能力编辑（用户手动配置 > Provider metadata > 保守默认） */
class ModelEditModal extends Modal {
  private modelId = "";
  private provider = "siliconflow";
  private contextWindow = "";
  private pricingHint: "low" | "medium" | "high" | "" = "";
  private caps: Record<string, boolean> = {};

  constructor(app: App, private plugin: KnowledgeGardenPlugin, m: ModelMetadata | null) {
    super(app);
    if (m) {
      this.modelId = m.modelId;
      this.provider = m.provider;
      this.contextWindow = m.contextWindow ? String(m.contextWindow) : "";
      this.pricingHint = m.pricingHint || "";
      this.caps = { ...(m.capabilities ?? {}) } as Record<string, boolean>;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "模型能力元数据" });
    new Setting(contentEl).setName("Model ID").addText((t) => t.setValue(this.modelId).onChange((v) => { this.modelId = v.trim(); }));
    new Setting(contentEl).setName("Provider").addText((t) => t.setValue(this.provider).onChange((v) => { this.provider = v.trim() || "siliconflow"; }));
    new Setting(contentEl).setName("Context Window").addText((t) => t.setPlaceholder("例如 32000").setValue(this.contextWindow).onChange((v) => { this.contextWindow = v.trim(); }));
    new Setting(contentEl).setName("成本级别").setDesc("只在有可靠来源时记录（§四十六：不猜价格）")
      .addDropdown((d) => {
        d.addOption("", "未知");
        for (const v of ["low", "medium", "high"]) d.addOption(v, v);
        d.setValue(this.pricingHint || "").onChange((v) => { this.pricingHint = (v as "low" | "medium" | "high") || ""; });
      });
    new Setting(contentEl).setName("能力（手动配置优先于保守默认，§一百一十五）");
    const capList = contentEl.createDiv({ cls: "kg-settings-area-list" });
    const capDefs: { key: string; label: string }[] = [
      { key: "reasoning", label: "推理" },
      { key: "structuredOutput", label: "结构化输出" },
      { key: "longContext", label: "长上下文" },
      { key: "vision", label: "视觉" },
      { key: "toolCalling", label: "工具调用" },
      { key: "translation", label: "翻译" },
      { key: "multilingual", label: "多语言" },
      { key: "creativeWriting", label: "创意写作" },
    ];
    for (const c of capDefs) {
      new Setting(capList).setName(c.label)
        .addToggle((t) => t.setValue(this.caps[c.key] === true).onChange((v) => { this.caps[c.key] = v; }));
    }
    const save = contentEl.createEl("button", { cls: "mod-cta", text: "保存模型元数据" });
    save.addEventListener("click", async () => {
      if (!this.modelId) { new Notice("请填写 Model ID。"); return; }
      const meta: ModelMetadata = {
        modelId: this.modelId,
        provider: this.provider,
        capabilities: this.caps,
        contextWindow: this.contextWindow ? Number(this.contextWindow) : undefined,
        pricingHint: this.pricingHint || undefined,
      };
      const list = this.plugin.settings.modelMetadata ?? [];
      const i = list.findIndex((x) => x.modelId === this.modelId);
      if (i >= 0) list[i] = meta; else list.push(meta);
      this.plugin.settings.modelMetadata = list;
      await this.plugin.saveSettings();
      new Notice("已保存模型元数据：「" + this.modelId + "」。（Capability 注册表只影响推荐与 required 检查，§五十五）");
      this.close();
    });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
