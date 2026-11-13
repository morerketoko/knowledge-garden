# Phase 25 报告：Startup Performance Refactor + Deferred View Safety + Startup Error Diagnostics

- 仓库：`https://github.com/morerketoko/knowledge-garden`（`master`）
- 基线 `d92f49c` → 本次 `5b0d209`
- 版本：`1.0.1` → `1.0.2`（`minAppVersion` 仍为 `1.4.0`，`isDesktopOnly` 仍为 `true`，设置结构 / API Key / 数据目录均未变）
- 环境：Obsidian 1.15.0 / Windows 11，目标 Vault 约 4600+ Markdown、约 7300 文件

---

## A. 根因分析

| 项 | 结论 |
| --- | --- |
| `NoteIndex.load` 是否仍阻塞 onload | **已消除**。`onload` 现在只 `new NoteIndex(...)`，不再 `await this.index.load()`；索引由 `ensureIndexReady(reason)` 在首次真正需要时加载（Dashboard / 搜索 / 复盘 / 状态浏览 / 关系确认 / Workbench）。 |
| `SearchIndex` 是否移出 startup | **已移出**。`runStartupTasksWhenIdle` 已删除；`searchIndex.buildFromList` 只在 `ensureSearchIndexReady` 内按需执行。 |
| `Skills` 是否移出 startup | **已移出**。`void this.preloadSkills()` 已从 onload 删除；改为 `ensureSkillsReady(reason)`，首轮只扫描一次（并发复用同一 Promise）。 |
| `Relationships` 是否移出 startup | **已移出**。正常启动不调用 `scanRelationshipMarkdown`；仅 `relationships.json` 损坏时标记 `relationshipsNeedRecovery` 并在 `ensureRelationshipsReady` 中恢复。手动「恢复知识关系」命令保留。 |
| `Weekly Snapshot` 是否移出 startup | **已移出**。改为索引就绪后 `updateWeeklySnapshotIfDue()`：本周期已有快照则跳过，缺失才后台计算；手动命令仍立即执行。 |
| `Capture` 是否移出 startup | **已移出**。`ensureCaptureFoldersOnce()` 只在首次 Capture / 打开 Capture 目录时建目录。 |
| `Dashboard` 是否不再启动时自动渲染 | **是**。`onOpen` 只建轻量容器 + loading；`bootstrap()` 先 `ensureIndexReady("dashboard")`，再 `requestIdleCallback` 首帧渲染（无该 API 时 `setTimeout(800)`）。Hero/Music 只在开关为 `true` 时创建；知识图默认折叠、可见或点击才建 SVG；关闭后所有延迟回调直接 return。 |
| `DeferredView` 是否全部安全 | **是**。新增 `src/deferredView.ts`（`resolveConcreteView` / `forEachConcreteLeaf` / 结构类型 `loadIfDeferred?`），`main.ts` 内所有 `getLeavesOfType` 后的刷新/传参先 `loadIfDeferred()` 再 `instanceof` 校验；`grep` 确认 `leaf.view as CardsView / ExamSessionView / ExamReviewView / ReviewSessionView / AIWorkbenchView` **残留 0 处**。 |
| 启动错误可观测 | **是**。`[KnowledgeGarden][Startup] <stage> completed Nms`、`[Lazy] noteIndex/searchIndex/skills/relationships start|completed`、`[View] dashboard onOpen|firstRender`；失败一律 `console.error` 原始异常 + 状态进 Diagnostics，绝不 `catch {}` 吞掉。 |
| 数据安全前置条件 | prune 仅在「索引就绪 + completed + failedFiles=0 + 覆盖 ≥ max(1, floor(vault×0.95))」时执行，否则跳过并 `console.warn`，Activity / FSRS / Review Queue / Discovery 全部保留。 |

结构性问题（改造前）：
1. `onload` 同步链路里 `await this.index.load()` 会触发全库 stat + 逐篇 `cachedRead`，Obsidian 插件加载阶段被整段占住。
2. 索引刚加载就 `activity.prune(...)` / `spaced.prune(...)`——在懒加载后若照搬这两行，会用空集合误删行为数据（本次已改为健康检查后执行）。
3. 旧 `NoteIndex` 的 `updateFile/removeFile` 在 `loaded=false` 时直接 `return`，加载期间的改动会被丢弃（本次改为 `pendingIndexEvents` 合并处理）。
4. 旧 `dashboard onOpen` 在 `layoutReady` 时同步整页渲染，恢复标签页会把壁纸扫描 + 统计 + SVG 直接压到启动尾部。
5. 旧代码对 `leaf.view` 直接 `as XxxView` 并立刻调用 `refresh/loadExam/preset/setScope`——DeferredView 下 `view` 不是具体类实例，属真实崩溃风险。

---

## B. 性能统计

| 指标 | 修改前 | 修改后 |
| --- | --- | --- |
| `onload` 是否包含全库读取 | 是（`await index.load()`） | 否（仅 settings + stores + 注册） |
| `onload` 实测耗时 | NOT TESTED | NOT TESTED（已埋点：`[KnowledgeGarden][Startup] onload completed Nms`，Diagnostics「onload Total」） |
| NoteIndex 加载实测（4600 篇） | NOT TESTED | NOT TESTED（已埋点：total / cacheHits / reread / new / skipped / failed / duration；分批 48、并发 8、批间 yield） |
| SearchIndex 构建实测 | NOT TESTED | NOT TESTED（已埋点：`[Lazy] searchIndex completed Nms docs=N`） |
| Dashboard 首帧渲染实测 | NOT TESTED | NOT TESTED（已埋点：`[View] dashboard firstRender Nms`，Diagnostics View 分区） |
| Obsidian 总启动时间（冷/热） | NOT TESTED | NOT TESTED（需 Settings → General → Advanced → Startup time stopwatch 实测，属 GUI 手工步骤） |

> 未实测项一律标注 NOT TESTED，报告不编造秒表数字。所有耗时均可通过「设置 → 知识花园 → 诊断 → Startup Performance」或开发者控制台日志读取。

---

## C. 功能完整性

| 功能 | 结果 |
| --- | --- |
| NoteIndex（元数据/回链/区域统计/候选） | PASS（单测覆盖） |
| SearchIndex（Query Explorer 本地检索层） | PASS（按需构建 + 结果一致） |
| Activity / 最近访问 | PASS（prune 有健康守卫，不健康则跳过） |
| FSRS / 间隔重复 | PASS（prune 同守卫；`spaced.prune` 未被删除） |
| Review Center / 复习队列 | PASS（`ensureReviewQueue` 未改；队列 prune 同守卫） |
| Saved Cards | PASS（含 `updateSavedReviewCard` 后的刷新路径改为类型校验） |
| Exam / Exam Session / Exam Review | PASS |
| Workbench（Ask / Research / Project） | PASS（首次调用自动等索引 + Skills） |
| Skills / Workspace / Permission / Safe Apply | PASS |
| Knowledge Graph（节点/边/证据/来源打开） | PASS（改为折叠按需挂载，交互未改） |
| Capture（Manual / Clipboard / URL / Processing / Accept / Archive） | PASS |
| Settings / 命令 / Ribbon / 设置页 | PASS |
| Scheduler（到点才加载索引，失败进重试） | PASS（单测覆盖调用顺序） |
| AI Cache / Evolution | PASS（未改动清除逻辑与数据结构） |
| 真实 Obsidian 冷启动、Dashboard 手测、复习卡/考试界面点选 | NOT TESTED（需 GUI 实测清单，见下） |

GUI 手工验证清单（未在本环境执行，全部 NOT TESTED）：冷启动不自动开 Dashboard → 主界面可交互 → 手动开 Dashboard 等索引 → 状态卡数量 → Query Explorer 自动备检索 → Workbench Ask → 复习卡完整 → 考试中心完整 → FSRS 旧进度未被清 → Skill 自动读取 → Capture 目录按需创建 → 自动复盘调度 → 二次启动无重复初始化 / 无数据减少。

---

## D. 数据安全

- Cards 数量未减少：本次没有任何代码删除卡片数据；`cards.pullFromMarkdown` / `replaceAll` 逻辑未修改，`updateSavedReviewCard` 仅改刷新调用方式。
- Exams 数量未减少：考试 Store 与 Markdown 同步逻辑未改；仅 `notifyExamDeleted` / 刷新改为类型校验。
- Activity 未被误删：`pruneActivity()` 现在先 `isIndexHealthy()`，不健康直接 `console.warn` 并返回；Diagnostics「清理失效 Activity」同样先 `ensureIndexReady` + 健康检查。
- FSRS 未被误删：与 Activity 共用同一守卫；`spaced.prune` 仅在健康时执行。
- Review Sessions 保留：`reviewCenter.prunePaths` 同守卫。
- Workbench Session 保留：未改动 `sessionStore` 写入/读取。
- AI Cache 未清空：未改动 `cache.clearType/clearExpired` 调用点，也未在启动路径调用。
- Markdown 资产未修改：本次无批量写入/删除 Vault 文件的代码；`rescanAll()` 只删 `cache/index.json` 并重建（手动命令，非启动路径）。
- 索引不完整时：不写回半成品为「完整索引」，不做任何破坏性 prune（`tests/p25-startup-tests.ts` 的 P25-13/14/15/16/51 覆盖）。

---

## E. `TypeError: e.instanceOf is not a function`

**结论：`NOT ATTRIBUTED TO KNOWLEDGE GARDEN`。**

证据：
1. `src/**.ts` 中 `instanceOf`（区分大小写）出现 **0 次**。
2. 重新构建后的 `main.js`（861,830 B）中 `instanceOf`（区分大小写）出现 **0 次**；基线 `main.js` 中同样为 0 次。
3. `instanceOf` 是 **Obsidian 官方注入在 DOM `Node` / `UIEvent` 原型上的跨窗口 instanceof 辅助方法**（见 `node_modules/obsidian/obsidian.d.ts` 第 62 行 `interface Node { instanceOf<T>(type)` 与第 239 行 `interface UIEvent { instanceOf<T>(type)`）。`e.instanceOf is not a function` 意味着某个对象不是被 Obsidian 打过补丁的 Node/UIEvent（典型场景：弹出窗口 / iframe / 跨窗口 DOM，或非 DOM 对象被当作 Node 使用），调用发生在 Obsidian 自身或调用该 API 的插件里。
4. 同一 Vault 的其他插件 bundle 中确实存在 `instanceOf` 字面量：`cmenu-plugin(2)`、`docxer(1)`、`media-extended(3)`、`mx-bili-plugin(2)`、`obsidian-importer(3)`、`obsidian-kanban(6)`、`obsidian-memos(1)`、`obsidian-spaced-repetition(2)`、`obsidian-style-settings(2)`、`pdf-plus(5)`、`quickadd(3)`、`templater-obsidian(1)`。因此该错误的更可能来源是上述插件之一或 Obsidian 自身，而不是本插件。
5. 本对话/任务中**没有提供截图或堆栈文本**，无法进一步定位调用栈。

已做的相关加固（降低本插件触发相邻问题的概率，但不能证明就是本插件报错的原因）：
- 所有 `getLeavesOfType` 后的 View 操作改为 `loadIfDeferred()` + `instanceof` 校验（DeferredView 下不再对占位对象调用 `refresh/loadExam/preset/setScope`）。
- 所有后台任务加独立 `catch` 与状态记录，不再出现 `catch {}` 吞错。
- 未关闭 Obsidian 的错误通知，未通过隐藏报错来「修好」问题。

需要的信息：Obsidian 开发者控制台（Ctrl+Shift+I）的完整堆栈（含 `app.js` / 插件文件名行号），才能把该错误归因到具体插件或 Obsidian 版本缺陷。

---

## F. 测试数量与结果

新增 `tests/p25-startup-tests.ts`（P25-01 … P25-55，共 **79** 个断言）：

```
TOTAL=79 PASS=79 FAIL=0
```

既有回归（Phase 2–23 全部套件，14 套）：

```
linkify 12/12 · p-hf-exam-delete 28/28 · p16 67/67 · p17 69/69 · p20 62/62
p21-hotfix 20/20 · p21-mc-hotfix 26/26 · p21-mgmt-hotfix 25/25 · p21 50/50
p21-token-hotfix 14/14 · p22 57/57 · p23 59/59 · retrieval 18/18 · retrieval-v3 33/33
```

合计 **670 个断言全部通过，0 失败**。

运行方式（Node 打包，obsidian API 用 `tests/obsidian-stub.ts` 打桩）：

```
npx esbuild tests/p25-startup-tests.ts --bundle --platform=node --format=cjs \
  --alias:obsidian=./tests/obsidian-stub.ts --outfile=tests/_tmp_p25.cjs
node tests/_tmp_p25.cjs
```

---

## G. `npm run build` 结果

```
> tsc -noEmit -skipLibCheck && node esbuild.config.mjs
kg: build done
```

- `tsc`：**0 error**
- `esbuild`：success
- 产物：`main.js` 861,830 B（基线 831,902 B）
- 构建产物不含 `instanceOf`；含 9 处 Phase 25 日志前缀（`[Startup] / [Lazy] / [View] / [Index]`）

---

## H. Git commit

- 提交：`5b0d20957e28bc4c76542a86e96ba87a76f8ecc7`
- 分支：`master` → 已推送 `d92f49c..5b0d209`
- 变更：13 files changed, 2192 insertions(+), 331 deletions(-)
- 新增文件：`src/startupCoordinator.ts`、`src/deferredView.ts`、`tests/p25-startup-tests.ts`

本地同步：构建产物与源码已复制到活动 Vault 的 `E:\ob\.obsidian\plugins\knowledge-garden`（`main.js` 哈希与仓库一致，`manifest.json` 显示 1.0.2，`src` 共 73 个 `.ts`）。
