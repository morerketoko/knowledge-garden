# Obsidian 运行报错收集（2026-11-13 15:02–15:05）

> 用途：把刚刚几分钟内 Obsidian 捕获到的报错原样归档，供上游排查。
> 采集方式：Obsidian 原生 CLI `obsidian dev:errors` / `obsidian dev:console`（Windows，Obsidian 常驻运行）。

## 1. 摘要

| 项 | 内容 |
|---|---|
| 报错数量 | 1 类，共 2 次（1 次真实触发 + 1 次最小化复现） |
| 来源插件 | `epub-importer` **0.8.4**（作者 aoout，https://github.com/aoout） |
| 错误 | `Uncaught TypeError: Cannot read properties of null (reading 'path')` |
| 位置 | `plugin:epub-importer:38139:108` → `main.js:38139` |
| 根因 | `workspace.on("file-open", (file) => this.progressManager.restoreState(file.path))` 的 `file` 未判空；Obsidian 在激活「无文件视图」时会以 `null` 触发 `file-open` |
| 影响 | 每次切到无文件视图（Dashboard、空白标签、Web viewer 等）抛一次未捕获异常；阅读进度仍由 100ms 定时器正常保存，不丢数据，但控制台噪音、可能弹 Notice |
| 严重度 | 低（不影响功能），建议上游加一行判空 |

## 2. 环境

| 项 | 值 |
|---|---|
| Obsidian 桌面版 | **1.15.0**（安装目录 `C:\Users\DIY\AppData\Local\Programs\Obsidian`） |
| 系统 | Windows NT 10.0.26200（Windows 11） |
| Vault | `ob`（`E:\ob`），7,330 个文件、4,600+ 篇 Markdown |
| 已启用社区插件 | 47 个 |
| 相关插件版本 | `epub-importer` 0.8.4；`knowledge-garden` 1.0.0（本地）/1.0.1（仓库） |
| Obsidian CLI | `Obsidian.com`，设置里已启用命令行界面 |

## 3. 原始报错（逐字）

### 3.1 首次出现（用户正常使用期间，无任何脚本干预）

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

### 3.2 最小化复现（同一代码路径，`file-open` 传 null）

复现命令（Obsidian CLI）：

```
obsidian eval code="(() => { app.workspace.trigger('file-open', null); return 'triggered file-open with null'; })()"
```

结果：

```
15:04:46 Uncaught TypeError: Cannot read properties of null (reading 'path')
TypeError: Cannot read properties of null (reading 'path')
    at plugin:epub-importer:38139:108
    at Mw.tryTrigger (app://obsidian.md/app.js:245:73690)
    at Mw.trigger (app://obsidian.md/app.js:245:73645)
    at Mw.trigger (app://obsidian.md/app.js:568:76989)
    at eval (eval at <anonymous> (app://obsidian.md/app.js:320:488), <anonymous>:1:24)
    ...
```

两次栈帧前 4 行完全一致（`plugin:epub-importer:38139:108` ← `Mw.tryTrigger` ← `Mw.trigger`），只差触发来源（`activeLeafEvents` vs `eval`），可确认是同一个回调。

原始转储见 `diagnostics/raw/dev-errors-2026-11-13.txt`。

## 4. 代码定位

文件：`E:\ob\.obsidian\plugins\epub-importer\main.js`（0.8.4，1,264,224 B，38,276 行）

```js
38133:   async setupReadProgressManager() {
38134:     if (!this.settings.enableReadProgressManager)
38135:       return;
38136:     this.progressManager = new ReadProgressManager(this.app);
38137:     await this.progressManager.initialize();
38138:     this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.progressManager.renameFile(oldPath, file.path)));
38139:     this.registerEvent(this.app.workspace.on("file-open", (file) => this.progressManager.restoreState(file.path)));   // ← 报错行
38140:     this.registerEvent(this.app.vault.on("delete", (file) => this.progressManager.deleteFile(file.path)));
38141:     this.registerInterval(window.setInterval(() => {
38142:       const file = this.app.workspace.getActiveFile();
38143:       if (file) {
38144:         const state = this.progressManager.getCurrentState();
38145:         if (state) {
38146:           this.progressManager.saveState(file.path, state);
38147:         }
38148:       }
38149:     }, 100));
38150:     this.registerInterval(window.setInterval(() => this.progressManager.saveDatabase(), 500));
```

注意：同段代码里 38142 的定时器有 `if (file)` 判空，38139 的 `file-open` 回调反而没有 —— 说明是遗漏，不是设计。

## 5. 根因

- Obsidian 的 `file-open` 事件签名是 `(file: TFile | null) => void`，在「激活的 leaf 没有文件」时以 `null` 触发，例如：激活 Dashboard/自定义视图标签、空白标签、Web viewer 标签、关闭最后一个笔记后的空 leaf。
- epub-importer 0.8.4 在 `setupReadProgressManager()` 里直接 `file.path`，于是抛 `Cannot read properties of null (reading 'path')`。
- 该回调挂在 `workspace.on("file-open")`，异常被 Obsidian 的 `tryTrigger` 捕获后进 `dev:errors`，同时用户侧可能看到 Notice；插件的阅读进度恢复功能在该次切换中不执行，但不影响后续（定时器仍有判空）。

## 6. 建议修复（给上游的 patch）

```diff
-    this.registerEvent(this.app.workspace.on("file-open", (file) => this.progressManager.restoreState(file.path)));
+    this.registerEvent(this.app.workspace.on("file-open", (file) => {
+      if (!file?.path)
+        return;
+      this.progressManager.restoreState(file.path);
+    }));
```

同样的判空也建议加在 `vault.on("delete", (file) => this.progressManager.deleteFile(file.path))` 上（`delete` 一般有 file，但统一更稳）。

## 7. 可直接提交给上游的 issue 模板

**标题**：`TypeError: Cannot read properties of null (reading 'path') in file-open handler (setupReadProgressManager)`

**正文**：

```
Obsidian 1.15.0 (Windows 11), epub-importer 0.8.4, 47 community plugins enabled.

Every time the active leaf has no file (custom dashboard view, empty leaf, web viewer),
the plugin throws:

15:02:56 Uncaught TypeError: Cannot read properties of null (reading 'path')
    at plugin:epub-importer:38139:108
    at Mw.tryTrigger (app://obsidian.md/app.js:245:73690)
    at Mw.trigger (app://obsidian.md/app.js:568:76989)
    at Mw.activeLeafEvents (app://obsidian.md/app.js:568:64686)

The handler registered in setupReadProgressManager() is:
  this.app.workspace.on("file-open", (file) => this.progressManager.restoreState(file.path))

Obsidian emits `file-open` with `null` when the active leaf has no file,
so `file.path` throws. Minimal repro (Obsidian CLI):
  app.workspace.trigger('file-open', null)

Fix: guard the callback:
  (file) => { if (!file) return; this.progressManager.restoreState(file.path); }

Suggested for patch release 0.8.5.
```

## 8. 备注：同期已修复、与本报错无关的问题（背景）

以下都是本机 Obsidian 其它报错，**不属于 epub-importer 责任**，已修复并记录，避免上游误判：

1. **Excalidraw 落笔即卡死（黄屏）** — i18n 汉化插件把 Excalidraw 的 JS 字符串当 UI 文案翻译，连 `querySelector("button")`、`getAttribute("width")`、`classList.add("excalidraw-release")` 等选择器一起改中文，导致 `markDirtyVisuals` 读到 null。已还原官方 2.29.1 bundle 并清空 i18n 的 `isApplied` 状态。
2. **knowledge-garden 复习卡/考试显示 0 张** — 插件 store 用相对路径读 cache，从非 vault 工作目录启动 Obsidian 时 `process.cwd()` = `C:\WINDOWS\system32`，读写全部失败并报 `EPERM: mkdir 'C:\WINDOWS\system32\.obsidian\...'`。已把 `baseDir` 改成 vault 绝对路径并发布 1.0.1（commit `a972693`）。

## 9. 采集/复现方式备忘

```powershell
$env:PATH = "C:\Users\DIY\AppData\Local\Programs\Obsidian;$env:PATH"
obsidian dev:errors                      # 捕获到的未处理异常
obsidian dev:debug on                    # 挂 CDP 后才能抓 console
obsidian dev:console level=error         # 控制台 error
obsidian eval code="app.workspace.trigger('file-open', null)"   # 最小复现
obsidian dev:debug off
obsidian dev:errors clear                # 清空缓冲（谨慎）
```

- `dev:errors` 只保留「当前会话」内的异常，重启 Obsidian 会清空，所以要归档就尽快导出。
- `dev:console` 必须 `dev:debug on` 之后才会开始捕获，之前的历史日志拿不到。
