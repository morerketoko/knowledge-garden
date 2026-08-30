/** Phase 6：HeroWall —— 首页头部（壁纸 / 标题 / 副标题 / 日期 / 复盘状态 / 换壁纸）。
 * - 壁纸来源：hero.current（持久化）→ hero.background（单图）→ hero.folder 随机（§8/11）。
 * - 随机只在首次打开 / 手动「换一张」时执行；Dashboard render 不重复随机（§11）。
 * - 当前图片被删除 → 自动 fallback 到其他图片 / 无图则纯主题背景（§49/51）。
 * - 生命周期由 DashboardView（Component）通过 addChild 管理；Vault 图片变动仅刷新内存列表（§12）。
 */
import { Component, TFile, normalizePath } from "obsidian";
import type KnowledgeGardenPlugin from "../main";
import { IMAGE_EXTS, listMediaFiles, resourceUrl } from "../mediaHelper";

export class HeroWall extends Component {
  private images: TFile[] = [];
  private imagesKey = "";
  private currentEl: HTMLElement | null = null;
  private actionsEl: HTMLElement | null = null;

  constructor(
    private plugin: KnowledgeGardenPlugin,
    private container: HTMLElement,
  ) {
    super();
  }

  onload(): void {
    // 图片列表内存缓存：只在 Vault 图片新增/删除/改名时刷新（§12），绝不每次 render 全量扫描
    const refresh = () => { this.images = []; this.imagesKey = ""; };
    this.registerEvent(this.plugin.app.vault.on("create", (f) => {
      if (f instanceof TFile && IMAGE_EXTS.includes((f.extension || "").toLowerCase())) refresh();
    }));
    this.registerEvent(this.plugin.app.vault.on("delete", (f) => {
      if (f instanceof TFile && IMAGE_EXTS.includes((f.extension || "").toLowerCase())) refresh();
    }));
    this.registerEvent(this.plugin.app.vault.on("rename", (f) => {
      if (f instanceof TFile && IMAGE_EXTS.includes((f.extension || "").toLowerCase())) refresh();
    }));
  }

  private folderImages(): TFile[] {
    const folder = normalizePath((this.plugin.settings.hero.folder || "").trim());
    if (!folder) return [];
    if (this.imagesKey !== folder) {
      this.images = listMediaFiles(this.plugin.app, folder, IMAGE_EXTS);
      this.imagesKey = folder;
    }
    return this.images;
  }

  private fileIfExists(p: string): TFile | null {
    if (!p) return null;
    const f = this.plugin.app.vault.getAbstractFileByPath(normalizePath(p));
    return f instanceof TFile ? f : null;
  }

  /** 当前壁纸路径（§11：持久化 current 优先；图片删除 fallback；随机只在无 current 时） */
  private resolveHero(): string {
    const s = this.plugin.settings;
    if (s.hero.current) {
      const f = this.fileIfExists(s.hero.current);
      if (f) return f.path;
    }
    if (s.hero.background) {
      const f = this.fileIfExists(s.hero.background);
      if (f) return f.path;
    }
    if (s.hero.random && s.hero.folder) {
      const list = this.folderImages();
      if (list.length > 0) {
        const pick = list[Math.floor(Math.random() * list.length)];
        s.hero.current = pick.path;
        void this.plugin.saveSettings();
        return pick.path;
      }
    }
    return "";
  }

  private todayLabel(): string {
    const d = new Date();
    const week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + week;
  }

  private reviewStatusText(): string {
    const s = this.plugin.settings;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = start.getTime() + 86400000;
    const today = s.reviews.some((r) => r.date >= start.getTime() && r.date < end);
    return today ? "今日复盘 · 已完成 ✓" : "今日复盘 · 未开始";
  }

  /** 渲染 Hero（每次 render 重建 DOM；壁纸保持 current，不跳动） */
  render(): HTMLElement {
    const s = this.plugin.settings;
    const hero = this.container.createDiv({ cls: "kg-hero" });
    const path = this.resolveHero();
    const url = path ? resourceUrl(this.plugin.app, path) : "";
    if (url) {
      hero.style.backgroundImage = "url(\"" + url + "\")";
      hero.style.backgroundSize = "cover";
      hero.style.backgroundPosition = "center";
    }
    const overlay = hero.createDiv({ cls: "kg-hero-overlay" });
    overlay.style.opacity = String(Math.max(0, Math.min(0.8, s.hero.overlay)));
    hero.createDiv({ cls: "kg-hero-shade" }); // 底部轻微渐变（§13 兜底，样式在 CSS）
    hero.createDiv({ cls: "kg-hero-title", text: s.hero.title });
    if (s.hero.subtitle) hero.createDiv({ cls: "kg-hero-subtitle", text: s.hero.subtitle });
    const meta = hero.createDiv({ cls: "kg-hero-meta" });
    meta.createDiv({ cls: "kg-hero-date", text: this.todayLabel() });
    meta.createDiv({ cls: "kg-hero-review", text: this.reviewStatusText() });
    const actions = hero.createDiv({ cls: "kg-hero-actions" });
    this.actionsEl = actions;
    // 换一张（§48：不重新加载 Dashboard；仅在存在随机文件夹时提供）
    if (s.hero.folder) {
      const change = actions.createEl("button", { cls: "kg-btn kg-hero-btn", attr: { "aria-label": "更换壁纸", title: "更换壁纸" } });
      change.setText("🖼 换一张");
      this.registerDomEvent(change, "click", () => {
        const list = this.folderImages();
        if (list.length === 0) { void this.plugin.saveSettings(); this.refresh(); return; }
        const pick = list[Math.floor(Math.random() * list.length)];
        s.hero.current = pick.path;
        void this.plugin.saveSettings();
        this.refresh();
      });
    }
    const open = actions.createEl("button", { cls: "kg-btn kg-hero-btn", attr: { "aria-label": "打开设置", title: "打开设置" } });
    open.setText("⚙ 设置");
    this.registerDomEvent(open, "click", () => {
      (this.plugin.app as unknown as { setting: { open: () => void } }).setting.open();
    });
    this.currentEl = hero;
    return hero;
  }

  /** 换壁纸 / 设置变化后刷新（保留 Hero 组件，只重建内部 DOM） */
  refresh(): void {
    if (this.currentEl) this.currentEl.remove();
    this.currentEl = null;
    if (this.container.isConnected) this.render();
  }

  /** 手动「换一张」从设置页调用时的便捷入口 */
  cycle(): void {
    const s = this.plugin.settings;
    if (s.hero.folder) {
      const list = this.folderImages();
      if (list.length > 0) {
        s.hero.current = list[Math.floor(Math.random() * list.length)].path;
        void this.plugin.saveSettings();
      }
    }
    this.refresh();
  }
}
