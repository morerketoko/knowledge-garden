/**
 * Phase 24：Node 自动测试的便携存储引导（**只属于 tests/，不进插件产物**）。
 *
 * 背景：Phase 24 把插件源码里的 Node `fs` / `path` 换成了平台无关的便携层
 * （src/portable/*）。源码内部只有一条 I/O 路径 —— 通过 `PortableStorageHost` 路由到某个
 * `StorageRoot`。Node 测试必须提供这个宿主，否则存储类只能读到空状态。
 *
 * 这里用 `MemoryRoot` + 真实临时目录基（baseDir）：
 * - 测试仍然用**真实** `fs.mkdtempSync()` 造目录（用于源码字符串断言与存在性检查）；
 * - 存储类的读写不走磁盘：它们写的 `<tmp>/cache/x.json` 被 host 解析到
 *   `Knowledge Garden/.state/cache/x.json` 这个内存键上（§十 的真实布局）。
 *
 * `fs.mkdtempSync` 的返回被改成**相对路径**（`.tmp-tests/...`）：
 * 便携路径层刻意拒绝绝对路径（§十七），而测试里所有断言都通过 `path.join(dir, ...)`
 * 复用它，因此改成相对路径对测试语义零影响。
 */
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { MemoryRoot } from "../src/portable/root";
import { PortableStorageHost, STATE_DIR_NAME } from "../src/portable/host";
import * as fsPortable from "../src/portable/fsPortable";
import { initSyncMirror } from "../src/portable/fsPortable";
import { joinVaultPath } from "../src/portable/paths";

/** 测试用的存储基（相对路径；源码存储类会把它 join 成 <base>/cache/x.json） */
export const TEST_STATE_BASE = "kg-test-state";
/** 测试临时目录的根（相对路径，§十七 便携路径层拒绝绝对路径） */
export const TEST_TMP_ROOT = ".kg-tests";

const nodeFsReal = nodeFs;
void nodeFsReal;
let dirSeq = 0;

/**
 * 测试专用 mkdtemp：返回**相对**路径 `<TEST_TMP_ROOT>/<prefix>-<n>`。
 *
 * 为什么不调用 Node 的 mkdtempSync 再换算：Node 会在**系统临时目录**里真正建目录，
 * 而测试随后用 `path.join(ROOT, dir, ...)` 把同一个相对路径解析到**仓库目录**下，
 * 两边不是同一个物理位置。这里直接生成确定性的、位于仓库内的相对路径，
 * 需要目录时由测试自己 `mkdirSync`（或由便携存储按需创建）。
 */
export function mkdtemp(prefix = ""): string {
  dirSeq++;
  const safe = String(prefix).replace(/[\\/]+$/, "").replace(/[^\w.-]+/g, "-") || "d";
  return TEST_TMP_ROOT + "/" + safe + "-" + dirSeq;
}

/**
 * 由测试目录推出「存储基」。测试目录形如 `<TEST_TMP_ROOT>/<unique>`，
 * 存储基取其第一段（`<TEST_TMP_ROOT>`），于是
 *   测试的 `path.join(dir, "cache", "x.json")`
 *   与源码的 `path.join(baseDir, "cache", "x.json")`
 * 指向同一个内存键。测试之间靠 `<unique>` 隔离。
 */
function testBaseDir(dir: string): string {
  const p = String(dir).replace(/\\/g, "/").replace(/\/+$/, "");
  const first = p.split("/").filter(Boolean)[0];
  return first || TEST_STATE_BASE;
}

let host: PortableStorageHost | null = null;
let ready = false;

/**
 * 初始化测试存储（幂等，**同步**：MemoryRoot 初始为空，镜像预热没有磁盘等待）。
 * 必须在构造任何存储类之前调用一次。
 */
export function initTestStorage(): PortableStorageHost {
  if (ready && host) return host;
  const stateRoot = joinVaultPath("Knowledge Garden", STATE_DIR_NAME);
  const h = new PortableStorageHost({
    stateRoot,
    pluginData: new MemoryRoot(),
    vault: new MemoryRoot(),
    useVault: true,
    reason: "node-test(memory)",
    stripPrefixes: [stateRoot],
  });
  h.baseDir = TEST_TMP_ROOT;
  host = h;
  void h.init();
  void initSyncMirror(h); // MemoryRoot 是纯内存：无异步等待
  ready = true;
  return h;
}

/** 已初始化的宿主（initTestStorage 之后可用） */
export function testHost(): PortableStorageHost {
  if (!host) throw new Error("测试存储未初始化：请先调用 initTestStorage()");
  return host;
}

// 自动引导：本模块被 import 即完成存储初始化
initTestStorage();

/* ------------------------------------------------------------------ */
/* 断言辅助                                                            */
/* ------------------------------------------------------------------ */

/** 损坏隔离位置：新实现是 <dir>/cache/.corrupt/ 目录（§十二），不再是 *.corrupt-* 文件 */
export function corruptDirOf(dir: string): string {
  return nodePath.join(dir, "cache", ".corrupt");
}

/** 便携存储键：与 host.resolve 完全一致（生产代码走的就是这条路径） */
export function stateKeyOf(relPath: string): string {
  return testHost().resolve(relPath);
}

/** 读取「便携存储写出的文件」内容（断言用；同步，读的是便携读镜像） */
export function readStateText(rel: string): string {
  return fsPortable.readFileSync(stateKeyOf(rel), "utf8");
}

/** 该相对路径在便携存储里是否存在（同步） */
export function stateExists(rel: string): boolean {
  return fsPortable.existsSync(stateKeyOf(rel));
}

/** 便携存储里该目录下的直接子项名（同步，等价 readdir） */
export function stateList(rel = ""): string[] {
  return fsPortable.readdirSync(stateKeyOf(rel)).map((d) => d.name);
}

/** 便携存储里该目录下的文件名（异步版本，用于断言真实后端落盘而非镜像） */
export async function stateListAsync(rel = ""): Promise<string[]> {
  const items = await testHost().list(stateKeyOf(rel));
  return items.map((i) => i.name);
}

/**
 * 测试夹具：直接写入便携存储（模拟「上一次运行已写出的文件」，用于损坏文件 / 历史格式场景）。
 * 走 fsPortable 的同步写接口，因此源码的同步读立刻可见。
 */
export function seedStateText(rel: string, text: string): void {
  fsPortable.writeFileSync(stateKeyOf(rel), text);
}

/** 清空便携存储与同步镜像（测试之间隔离状态） */
export function resetTestState(): void {
  fsPortable.setStorageHost(testHost());
  initTestStorage();
}

/** 是否确实产生了损坏副本（可选按原文件名前缀过滤） */
export function hasCorruptBackup(rel: string, fileBase?: string): boolean {
  const backups = stateList(joinVaultPath(rel, ".corrupt"));
  if (!backups.length) return false;
  return fileBase ? backups.some((b) => b.startsWith(fileBase)) : true;
}

/** Node 真实磁盘上该文件不存在（便携化断言：源码不再直接写盘） */
export function notOnRealDisk(dir: string, rel: string): boolean {
  return !nodeFs.existsSync(nodePath.join(dir, rel));
}
