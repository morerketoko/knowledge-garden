/**
 * Phase 16 §九~十七：Prompt Library UI（Writing Assistant / Workbench 顶部 Prompt 选择与收藏）。
 * - 应用 = activate：填回「附加要求」，不自动发送（§十）；搜索 = 本地全文（name/description/tags/body，0 AI，§十五）。
 * - 收藏 = setFavorite（§十一）；新建 = create（§十六）；编辑 = update（id 不变，§十二）；删除 = remove。
 * - Prompt 内容改变 → promptFingerprint 改变 → Cache Miss（§十三），但绝不 clearType("*")。
 * - 使用统计：touch() → usageCount++ / lastUsedAt（§十四），不调用 AI。
 */
import { App, Modal, Notice, Setting } from "obsidian";
import type KnowledgeGardenPlugin from "./main";
import { PROMPT_CATEGORIES, searchPrompts } from "./promptLibrary";
import type { PromptTemplate } from "./promptLibrary";

/** §十六：收藏当前输入为提示词（名称/描述/分类/标签；0 AI） */
export class PromptSaveModal extends Modal {
  constructor(
    app: App,
    private plugin: KnowledgeGardenPlugin,
    private onSaved: (name: string, description: string, category: string, tags: string[]) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "☆ 收藏为提示词" });
    contentEl.createDiv({ cls: "kg-toolbox-note", text: "保存后可在顶部 Prompt 下拉一键应用（不自动发送，§十）。" });
    let name = "";
    let description = "";
    let tags = "";
    let category = "General";
    new Setting(contentEl).setName("名称（必填）").addText((t) => t.onChange((v) => { name = v.trim(); }));
    new Setting(contentEl).setName("描述").addText((t) => t.onChange((v) => { description = v.trim(); }));
    new Setting(contentEl).setName("分类").addDropdown((d) => {
      for (const c of PROMPT_CATEGORIES) d.addOption(c, c);
      d.setValue(category).onChange((v) => { category = v; });
    });
    new Setting(contentEl).setName("标签（逗号分隔）").addText((t) => t.onChange((v) => { tags = v; }));
    const btn = contentEl.createEl("button", { cls: "kg-btn kg-btn-primary", text: "保存" });
    btn.addEventListener("click", () => {
      if (!name) { new Notice("请填写名称。"); return; }
      this.onSaved(name, description, category, tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean));
      this.close();
    });
  }
}

/** §九：Prompt Library 管理（搜索 / 应用 / 收藏 / 编辑 / 删除 / 新建；全部 0 AI） */
export class PromptLibraryModal extends Modal {
  constructor(
    app: App,
    private plugin: KnowledgeGardenPlugin,
    private onApply: (id: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "我的提示词（Prompt Library）" });
    contentEl.createDiv({ cls: "kg-toolbox-note", text: "点击「应用」= 填回写作助手附加要求（不自动发送，§十）。Prompt 编辑后缓存自动失效（§十三）。" });
    let q = "";
    const listEl = contentEl.createDiv({ cls: "kg-settings-area-list" });
    const render = (): void => {
      listEl.empty();
      const all = this.plugin.promptLibraryStore.templates;
      const list = q.trim() ? searchPrompts(all, q) : all;
      const sorted = [...list].slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name));
      if (!sorted.length) { listEl.createDiv({ cls: "kg-toolbox-note", text: "（无匹配提示词）" }); return; }
      for (const t of sorted) {
        const row = listEl.createDiv({ cls: "kg-settings-area-row" });
        row.createDiv({ text: (t.favorite ? "★ " : "☆ ") + t.name + (t.category ? "（" + t.category + "）" : "") });
        if (t.description) row.createDiv({ cls: "kg-toolbox-note", text: t.description });
        const acts = row.createDiv({ cls: "kg-toolbox-actions" });
        acts.createEl("button", { cls: "kg-btn kg-btn-primary", text: "应用" }).addEventListener("click", () => { this.onApply(t.id); this.close(); });
        acts.createEl("button", { cls: "kg-btn", text: t.favorite ? "取消收藏" : "收藏" }).addEventListener("click", () => {
          this.plugin.promptLibraryStore.setFavorite(t.id, !t.favorite);
          render();
        });
        acts.createEl("button", { cls: "kg-btn", text: "编辑" }).addEventListener("click", () => {
          new PromptEditModal(this.app, this.plugin, t, () => render()).open();
        });
        acts.createEl("button", { cls: "kg-btn", text: "删除" }).addEventListener("click", () => {
          this.plugin.promptLibraryStore.remove(t.id);
          render();
        });
      }
    };
    new Setting(contentEl).setName("🔎 搜索").setDesc("本地全文：名称/描述/标签/正文（0 AI，§十五）").addText((t) => t.onChange((v) => { q = v; render(); }));
    contentEl.createEl("button", { cls: "kg-btn", text: "＋ 新建提示词" }).addEventListener("click", () => {
      new PromptSaveModal(this.app, this.plugin, (name, description, category, tags) => {
        const created = this.plugin.promptLibraryStore.create({ name, description: description || undefined, prompt: "", tags, category, favorite: false });
        if (created) {
          new Notice("已新建「" + created.name + "」，请用「编辑」填入正文。");
          render();
        } else {
          new Notice("新建失败。");
        }
      }).open();
    });
    render();
  }
}

/** §十二：编辑 = update（id 不变）；正文变化 → promptFingerprint → Cache Miss（§十三） */
export class PromptEditModal extends Modal {
  constructor(
    app: App,
    private plugin: KnowledgeGardenPlugin,
    private template: PromptTemplate,
    private onDone: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "编辑提示词：" + this.template.name });
    let name = this.template.name;
    let description = this.template.description ?? "";
    let category = this.template.category ?? "General";
    let tags = (this.template.tags ?? []).join(", ");
    let prompt = this.template.prompt;
    new Setting(contentEl).setName("名称").addText((t) => t.setValue(name).onChange((v) => { name = v.trim(); }));
    new Setting(contentEl).setName("描述").addText((t) => t.setValue(description).onChange((v) => { description = v.trim(); }));
    new Setting(contentEl).setName("分类").addDropdown((d) => {
      for (const c of PROMPT_CATEGORIES) d.addOption(c, c);
      d.setValue(category).onChange((v) => { category = v; });
    });
    new Setting(contentEl).setName("标签（逗号分隔）").addText((t2) => t2.setValue(tags).onChange((v) => { tags = v; }));
    new Setting(contentEl).setName("正文").addTextArea((t2) => t2.setValue(prompt).onChange((v) => { prompt = v; }));
    contentEl.createDiv({ cls: "kg-toolbox-note", text: "正文改变 → promptFingerprint 改变 → 该 Prompt 相关 AI 缓存自动失效（§十三；不清空其他缓存）。" });
    const btn = contentEl.createEl("button", { cls: "kg-btn kg-btn-primary", text: "保存修改" });
    btn.addEventListener("click", () => {
      if (!name.trim() || !prompt.trim()) { new Notice("名称与正文不能为空。"); return; }
      const updated = this.plugin.promptLibraryStore.update(this.template.id, {
        name,
        description: description.trim() || undefined,
        category,
        tags: tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        prompt,
      });
      if (updated) { new Notice("已保存（id 不变，「" + updated.name + "」）。"); this.onDone(); this.close(); }
      else new Notice("保存失败：提示词不存在。");
    });
  }
}