# 交给上游模型的最小上下文提示（可直接粘贴）

下面这段是自包含的，粘到任意 GPT 端口即可，不需要再补文件。

---

我在 Obsidian 1.15.0（Windows 11，vault 里 4500+ 篇 Markdown，启用 47 个社区插件）里遇到一个社区插件报错，帮我定位原因并给出最小修复补丁。

插件：epub-importer 0.8.4（仓库 https://github.com/aoout ，为 Obsidian 的 EPUB 导入插件）。

报错原文（Obsidian `dev:errors` 捕获，用户正常使用期间出现）：

```
15:02:56 Uncaught TypeError: Cannot read properties of null (reading 'path')
TypeError: Cannot read properties of null (reading 'path')
    at plugin:epub-importer:38139:108
    at Mw.tryTrigger (app://obsidian.md/app.js:245:73690)
    at Mw.trigger (app://obsidian.md/app.js:245:73645)
    at Mw.trigger (app://obsidian.md/app.js:568:76989)
    at Mw.activeLeafEvents (app://obsidian.md/app.js:568:64686)
    at s (app://obsidian.md/app.js:12:38560)
    at l (app://obsidian.md/app.js:12:38655)
```

该插件 `main.js` 第 38133-38150 行（0.8.4，未压缩源码）内容：

```js
async setupReadProgressManager() {
  if (!this.settings.enableReadProgressManager)
    return;
  this.progressManager = new ReadProgressManager(this.app);
  await this.progressManager.initialize();
  this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.progressManager.renameFile(oldPath, file.path)));
  this.registerEvent(this.app.workspace.on("file-open", (file) => this.progressManager.restoreState(file.path)));   // ← 报错行
  this.registerEvent(this.app.vault.on("delete", (file) => this.progressManager.deleteFile(file.path)));
  this.registerInterval(window.setInterval(() => {
    const file = this.app.workspace.getActiveFile();
    if (file) {
      const state = this.progressManager.getCurrentState();
      if (state) {
        this.progressManager.saveState(file.path, state);
      }
    }
  }, 100));
  this.registerInterval(window.setInterval(() => this.progressManager.saveDatabase(), 500));
}
```

我另外用最小化方式复现到了同一栈帧：

```js
app.workspace.trigger('file-open', null)
```

→ 依然抛 `plugin:epub-importer:38139:108` 的同一个 TypeError。

现象：每次把活动标签切换到「没有文件」的视图（自定义 Dashboard 视图、空白标签、Web viewer 标签等），就抛一次未捕获异常；阅读进度本身还能靠 100ms 定时器保存，没丢数据。

请回答：
1. 这个 `file-open` 回调为什么会收到 `null`？Obsidian 哪些操作会这样触发？
2. 给出最小 patch（保持 TypeScript 类型正确，`file: TFile | null`）。
3. 指出同段代码里还有哪些地方需要同样判空（`rename` / `delete` / 定时器）？
4. 按这个仓库的提交习惯，帮我写 commit message 与 issue 标题。

<!-- 原始转储见 diagnostics/raw/dev-errors-2026-11-13.txt，完整报告见 diagnostics/2026-11-13-obsidian-errors.md -->
