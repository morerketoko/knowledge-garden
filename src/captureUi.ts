/**
 * Capture UI（§十七/六十八）：新建捕获表单 / URL 捕获 / 操作确认。
 * 只做收集输入与确认，实际写盘逻辑在 main.ts（createCapture / runKnowledgeProcessing / archiveCapture）。
 * UI 层绝不用 AI（§二十二：Capture 不触发 AI）。
 */
import { App, Modal, Setting } from "obsidian";
import type { CaptureType } from "./types";

export interface CaptureFormInput {
  captureType: CaptureType;
  title: string;
  body: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

/** §二十一：Manual / Import 捕获表单（标题/内容/来源标题/来源URL） */
export class CaptureFormModal extends Modal {
  private captureType: CaptureType = "note";
  private title = "";
  private body = "";
  private sourceUrl = "";
  private sourceTitle = "";

  constructor(app: App, private onSubmit: (input: CaptureFormInput) => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "新建捕获（Capture）" });
    this.contentEl.createDiv({ cls: "kg-capture-desc", text: "先捕获、后处理：捕获本身不调用 AI（§二十二）。来源信息单独存入 frontmatter（§九）。" });

    new Setting(this.contentEl).setName("捕获类型").addDropdown((d) => {
      for (const v of [
        ["note", "手动输入（笔记）"],
        ["clipboard", "剪贴板"],
        ["url", "URL"],
        ["import", "导入"],
      ] as [CaptureType, string][]) d.addOption(v[0], v[1]);
      d.setValue("note").onChange((v) => { this.captureType = v as CaptureType; });
    });

    new Setting(this.contentEl).setName("标题").addText((t) => t.setPlaceholder("例如：模块化设计").onChange((v) => { this.title = v; }));
    new Setting(this.contentEl).setName("内容").addTextArea((t) => t.setPlaceholder("粘贴或输入要捕获的内容…").onChange((v) => { this.body = v; }));
    new Setting(this.contentEl).setName("来源 URL（可选）").addText((t) => t.setPlaceholder("https://…").onChange((v) => { this.sourceUrl = v; }));
    new Setting(this.contentEl).setName("来源标题（可选）").addText((t) => t.setPlaceholder("原始文章/视频标题").onChange((v) => { this.sourceTitle = v; }));

    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("创建捕获").setCta().onClick(() => {
        if (!this.title.trim() && !this.body.trim() && !this.sourceUrl.trim()) {
          return;
        }
        const input: CaptureFormInput = {
          captureType: this.captureType,
          title: this.title.trim() || (this.sourceTitle.trim() || "未命名捕获"),
          body: this.body,
          ...(this.sourceUrl.trim() ? { sourceUrl: this.sourceUrl.trim() } : {}),
          ...(this.sourceTitle.trim() ? { sourceTitle: this.sourceTitle.trim() } : {}),
        };
        this.close();
        this.onSubmit(input);
      })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** §十八/一百一十五：URL 捕获表单（URL 必填；重复 URL 仅提示、不强制阻止） */
export class UrlCaptureModal extends Modal {
  private url = "";
  private sourceTitle = "";

  constructor(app: App, private onSubmit: (input: CaptureFormInput) => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "从 URL 捕获" });
    this.contentEl.createDiv({ cls: "kg-capture-desc", text: "保存原始 URL 作为来源（§九十三）。AI 不抓取网页（§十九/六十），只在你点「处理」时对已保存的文字内容提炼。" });
    new Setting(this.contentEl).setName("URL").addText((t) => t.setPlaceholder("https://…").onChange((v) => { this.url = v; }));
    new Setting(this.contentEl).setName("来源标题（可选）").addText((t) => t.setPlaceholder("原始文章标题").onChange((v) => { this.sourceTitle = v; }));
    new Setting(this.contentEl).setName("摘录内容（可选）").addTextArea((t) => t.setPlaceholder("可以先粘贴网页正文摘录；AI 后续基于它提炼。").onChange((v) => { this.body = v; }));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("创建 URL 捕获").setCta().onClick(() => {
        if (!this.url.trim()) return;
        const input: CaptureFormInput = {
          captureType: "url",
          title: this.sourceTitle.trim() || this.url.trim(),
          body: this.body,
          sourceUrl: this.url.trim(),
          ...(this.sourceTitle.trim() ? { sourceTitle: this.sourceTitle.trim() } : {}),
        };
        this.close();
        this.onSubmit(input);
      })
    );
  }

  private body = "";

  onClose(): void {
    this.contentEl.empty();
  }
}

/** §一百零五/一百零六：需要用户确认的操作（提炼为知识 / 归档 / 继续处理） */
export class CaptureConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: { title: string; body: string; confirmLabel: string; onConfirm: () => void }
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: this.opts.title });
    this.contentEl.createDiv({ cls: "kg-capture-desc", text: this.opts.body });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("取消").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.opts.confirmLabel).setCta().onClick(() => { this.close(); this.opts.onConfirm(); }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}