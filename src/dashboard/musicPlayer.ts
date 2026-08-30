/**
 * Phase 6：MusicPlayer —— 本地音乐播放器（Hero 下方的玻璃播放条）。
 * - HTMLAudioElement 实现，绝不引入播放器库；音频永远本地播放、绝不上传。
 * - render() 只重建 UI 外壳；audio 元素跨 render 存活 → Dashboard refresh/resize 不中断播放。
 * - 状态持久化：currentTrack / currentPos / volume / shuffle / repeat（切歌、暂停、卸载时保存，不做每秒写入）。
 * - 坏文件 error → 自动下一首，不让单个坏音频卡死；play() 被浏览器拒绝 → 静默。
 * - 生命周期：audio 事件 / DOM 事件 / Vault 媒体事件全部进入 Component 生命周期，View 卸载自动清理。
 */
import { Component, TFile, normalizePath } from "obsidian";
import type KnowledgeGardenPlugin from "../main";
import { AUDIO_EXTS, listMediaFiles, resourceUrl } from "../mediaHelper";

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ":" + String(s).padStart(2, "0");
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

export class MusicPlayer extends Component {
  private audio: HTMLAudioElement;
  private files: TFile[] = [];
  private filesKey = "";
  private order: string[] = []; // 播放顺序（shuffle 时已洗牌）
  private idx = -1;
  private currentPath = "";
  private seekEl: HTMLInputElement | null = null;
  private timeEl: HTMLElement | null = null;
  private playBtnEl: HTMLButtonElement | null = null;

  constructor(private plugin: KnowledgeGardenPlugin, private container: HTMLElement) {
    super();
    this.audio = document.createElement("audio");
    this.audio.preload = "metadata";
  }

  onload(): void {
    // audio 事件只注册一次（UI 重建时只重新绑定元素，不重复注册监听，避免累积）
    const syncSeek = () => {
      if (!this.seekEl) return;
      const d = this.audio.duration;
      if (isFinite(d) && d > 0) this.seekEl.setAttr("value", String((this.audio.currentTime / d) * 100));
      if (isFinite(this.audio.duration)) this.seekEl.setAttr("max", String(Math.floor(this.audio.duration)));
      if (this.timeEl) this.timeEl.setText(fmtTime(this.audio.currentTime) + " / " + fmtTime(this.audio.duration));
    };
    this.registerDomEvent(this.audio, "timeupdate", syncSeek);
    this.registerDomEvent(this.audio, "durationchange", syncSeek);
    const syncPlay = () => {
      if (this.playBtnEl) this.playBtnEl.setText(this.audio.paused ? "▶" : "⏸");
    };
    this.registerDomEvent(this.audio, "play", syncPlay);
    this.registerDomEvent(this.audio, "pause", syncPlay);
    this.registerDomEvent(this.audio, "ended", () => this.next());
    // 坏文件 / 已删除 → 保存进度并自动下一首
    this.registerDomEvent(this.audio, "error", () => {
      this.persistPos();
      this.next();
    });

    // Vault 媒体变动 → 只刷新内存播放列表缓存（不每次 render 全量扫描）
    const refresh = () => { this.files = []; this.filesKey = ""; };
    const isAudio = (f: unknown): f is TFile =>
      f instanceof TFile && AUDIO_EXTS.includes((f.extension || "").toLowerCase());
    this.registerEvent(this.plugin.app.vault.on("create", (f) => { if (isAudio(f)) refresh(); }));
    this.registerEvent(this.plugin.app.vault.on("delete", (f) => { if (isAudio(f)) refresh(); }));
    this.registerEvent(this.plugin.app.vault.on("rename", (f) => { if (isAudio(f)) refresh(); }));

    // 恢复持久化状态（§五十六：currentTrack / volume / shuffle / repeat / currentPos）
    const m = this.plugin.settings.music;
    this.audio.volume = Math.max(0, Math.min(1, m.volume));
    this.rebuildOrder();
    const saved = m.currentTrack || "";
    const idx = this.order.indexOf(saved);
    if (idx >= 0) {
      this.idx = idx;
      this.currentPath = saved;
      if (m.currentPos && m.currentPos > 0) this.audio.currentTime = Math.min(m.currentPos, 99999);
    }
    // autoplay 设置开关（默认关闭；开启后才尝试，失败静默）
    if (m.autoplay && m.enabled && this.currentPath) {
      void this.audio.play().catch(() => { /* 自动播放被浏览器拒绝 → 静默 */ });
    }
  }

  private mediaList(): TFile[] {
    const folder = normalizePath((this.plugin.settings.music.folder || "").trim());
    if (this.filesKey !== folder) {
      this.files = folder ? listMediaFiles(this.plugin.app, folder, AUDIO_EXTS) : [];
      this.filesKey = folder;
    }
    return this.files;
  }

  /** 重建播放顺序：非 shuffle → path 排序；shuffle → 洗牌（当前曲目保留在列表内） */
  private rebuildOrder(): void {
    const files = this.mediaList();
    const paths = files.map((f) => f.path).sort((a, b) => a.localeCompare(b));
    this.order = this.plugin.settings.music.shuffle ? shuffleArr(paths) : paths;
    this.audio.volume = Math.max(0, Math.min(1, this.plugin.settings.music.volume));
  }

  private fileName(p: string): string {
    const base = p.split("/").pop() ?? p;
    return base.replace(/\.(mp3|wav|ogg|m4a|aac)$/i, "");
  }

  private playIndex(i: number): void {
    if (i < 0 || i >= this.order.length) return;
    this.idx = i;
    this.currentPath = this.order[i];
    const url = resourceUrl(this.plugin.app, this.currentPath);
    if (!url) { this.next(); return; }
    this.audio.src = url;
    this.audio.currentTime = 0;
    this.persistTrack();
    void this.audio.play().catch(() => { /* 自动播放被拒绝 → 静默 */ });
    this.syncSeekNow();
  }

  /** 下一首：列表内 → 下一首；到尾 → repeat 回 0，否则保持 UI 停止 */
  next(): void {
    if (this.order.length === 0) return;
    if (this.idx + 1 < this.order.length) this.playIndex(this.idx + 1);
    else if (this.plugin.settings.music.repeat) this.playIndex(0);
    else this.stopKeepUI();
  }

  prev(): void {
    if (this.order.length === 0) return;
    if (this.idx > 0) this.playIndex(this.idx - 1);
    else this.playIndex(0);
  }

  private togglePlay(): void {
    if (!this.currentPath) { this.playIndex(this.idx >= 0 ? this.idx : 0); return; }
    if (this.audio.paused) {
      void this.audio.play().catch(() => { /* 静默 */ });
    } else {
      this.audio.pause();
      this.persistPos();
    }
    this.syncPlayNow();
  }

  private stopKeepUI(): void {
    this.audio.pause();
    this.persistPos();
    this.syncPlayNow();
  }

  private persistTrack(): void {
    const m = this.plugin.settings.music;
    m.currentTrack = this.currentPath || "";
    m.currentPos = 0;
    void this.plugin.saveSettings();
  }

  private persistPos(): void {
    const m = this.plugin.settings.music;
    m.currentTrack = this.currentPath || "";
    m.currentPos = isFinite(this.audio.currentTime) ? Math.floor(this.audio.currentTime) : 0;
    void this.plugin.saveSettings();
  }

  unload(): void {
    // §20：保存播放进度后停止
    this.persistPos();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    super.unload();
  }

  // ---- UI ----

  private syncSeekNow(): void {
    if (!this.seekEl) return;
    const d = this.audio.duration;
    if (isFinite(d) && d > 0) this.seekEl.setAttr("value", String((this.audio.currentTime / d) * 100));
    if (isFinite(this.audio.duration)) this.seekEl.setAttr("max", String(Math.floor(this.audio.duration)));
    if (this.timeEl) this.timeEl.setText(fmtTime(this.audio.currentTime) + " / " + fmtTime(this.audio.duration));
  }

  private syncPlayNow(): void {
    if (this.playBtnEl) this.playBtnEl.setText(this.audio.paused ? "▶" : "⏸");
  }

  /** 渲染播放器 UI（每次 render 重建外观；audio 实例保留 → 不中断播放） */
  render(): HTMLElement {
    const s = this.plugin.settings;
    const wrap = this.container.createDiv({ cls: "kg-music" });
    if (!s.music.enabled || !s.dashboard.showMusic) {
      wrap.createDiv({ cls: "kg-music-empty", text: "音乐未启用（设置 → 音乐播放器）。" });
      return wrap;
    }
    const list = this.mediaList();
    if (list.length === 0) {
      // §50：空文件夹 → 文案 + 跳设置，不禁用按钮
      const empty = wrap.createDiv({ cls: "kg-music-empty", text: "音乐文件夹中暂无可播放音乐。" });
      const btn = empty.createEl("button", { cls: "kg-btn", attr: { "aria-label": "设置音乐文件夹", title: "设置音乐文件夹" }, text: "设置音乐" });
      this.registerDomEvent(btn, "click", () => {
        (this.plugin.app as unknown as { setting: { open: () => void } }).setting.open();
      });
      return wrap;
    }
    this.rebuildOrder();

    const main = wrap.createDiv({ cls: "kg-music-main" });
    const track = main.createDiv({ cls: "kg-music-track" });
    track.createSpan({ cls: "kg-music-name", text: this.currentPath ? this.fileName(this.currentPath) : "未播放" });
    this.timeEl = track.createSpan({ cls: "kg-music-time", text: fmtTime(this.audio.currentTime) + " / " + fmtTime(this.audio.duration) });
    const seek = main.createEl("input", { attr: { type: "range", min: "0", max: "100", value: "0", "aria-label": "播放进度" } });
    seek.addClass("kg-music-seek");
    this.seekEl = seek;
    this.syncSeekNow();
    this.registerDomEvent(seek, "input", () => {
      const d = this.audio.duration;
      if (isFinite(d) && d > 0) {
        this.audio.currentTime = (Number(seek.value) / 100) * d;
        if (this.timeEl) this.timeEl.setText(fmtTime(this.audio.currentTime) + " / " + fmtTime(d));
      }
    });

    const controls = wrap.createDiv({ cls: "kg-music-controls" });
    const mkBtn = (label: string, aria: string, fn: () => void): HTMLButtonElement => {
      const b = controls.createEl("button", { cls: "kg-btn kg-btn-icon", attr: { "aria-label": aria, title: aria } });
      b.setText(label);
      this.registerDomEvent(b, "click", fn);
      return b;
    };
    mkBtn("⏮", "上一首", () => this.prev());
    this.playBtnEl = controls.createEl("button", { cls: "kg-btn kg-btn-primary kg-btn-icon", attr: { "aria-label": "播放或暂停", title: "播放/暂停" } });
    this.registerDomEvent(this.playBtnEl, "click", () => this.togglePlay());
    mkBtn("⏭", "下一首", () => this.next());
    const shuffleBtn = mkBtn("🔀", "随机播放", () => {
      s.music.shuffle = !s.music.shuffle;
      void this.plugin.saveSettings();
      this.rebuildOrder();
      shuffleBtn.toggleClass("kg-btn-on", s.music.shuffle);
    });
    shuffleBtn.toggleClass("kg-btn-on", s.music.shuffle);
    const repeatBtn = mkBtn("🔁", "循环播放", () => {
      s.music.repeat = !s.music.repeat;
      void this.plugin.saveSettings();
      repeatBtn.toggleClass("kg-btn-on", s.music.repeat);
    });
    repeatBtn.toggleClass("kg-btn-on", s.music.repeat);

    const volume = wrap.createEl("input", { attr: { type: "range", min: "0", max: "100", value: String(Math.round(this.audio.volume * 100)), "aria-label": "音量" } });
    volume.addClass("kg-music-volume");
    this.registerDomEvent(volume, "input", () => {
      const v = Number(volume.value) / 100;
      this.audio.volume = Math.max(0, Math.min(1, v));
      s.music.volume = this.audio.volume;
      void this.plugin.saveSettings();
    });

    this.syncPlayNow();
    return wrap;
  }
}