/**
 * Phase 9：统一数据版本化 / 损坏隔离 / 原子写（§三~五 / §八~十三 / §七十）。
 * Phase 24：改为平台无关实现 —— 不再 import Node fs/path，改用 portable 存储层：
 * 桌面与 iOS/Android 走同一套代码，路径一律是存储根相对路径，绝不产生绝对路径。
 *
 * - FORMAT_VERSION：持久化文件顶层版本号（未知字段一律保留，绝不 parse→rewrite 删字段）。
 * - isolateCorruptFile：损坏文件移入 `.corrupt/` 并保留可恢复副本（§九/§十二）。
 * - atomicWriteJson：写 `.tmp` 后 rename 原子替换；rename 不可用时退化为直接写（§十三：
 *   原子性以平台能力为准，不假装移动端存在 fs atomic rename）。
 * 本模块不依赖 Obsidian API（只依赖 portable 层），便于 Node 自动测试。
 */
import * as fs from "./portable/fsPortable";

/** 当前持久化格式版本 */
export const FORMAT_VERSION = 1;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 损坏文件时间戳：YYYYMMDD-HHmmss（§九） */
export function corruptStamp(now = new Date()): string {
  return (
    String(now.getFullYear()) +
    pad2(now.getMonth() + 1) +
    pad2(now.getDate()) +
    "-" +
    pad2(now.getHours()) +
    pad2(now.getMinutes()) +
    pad2(now.getSeconds())
  );
}

/** 损坏副本目标路径：<dir>/.corrupt/<name>.<stamp>（纯字符串，无 Node path） */
export function corruptTargetPath(filePath: string, now = new Date()): string {
  const p = String(filePath).replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  const dir = i < 0 ? "" : p.slice(0, i);
  const name = i < 0 ? p : p.slice(i + 1);
  const stamp = name + "." + corruptStamp(now);
  return dir ? dir + "/.corrupt/" + stamp : ".corrupt/" + stamp;
}

/**
 * 损坏文件隔离：<file> → <dir>/.corrupt/<name>.<stamp>（保留可恢复副本，不直接删除）。
 * 返回是否真的执行了隔离（文件存在且移动成功）。失败不抛错（不阻塞启动）。
 */
export function isolateCorruptFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.renameSync(filePath, corruptTargetPath(filePath));
    return true;
  } catch {
    // rename 不可用（后端不支持）→ 读出来写到副本再删原文件，语义等价
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(corruptTargetPath(filePath), raw);
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 原子写 JSON（平台无关）。
 *
 * 关键正确性要求（v1.1.1 事故复盘）：
 * `fsPortable.renameSync` 会更新**内存镜像**并把目标标脏，落盘是 800ms 防抖的异步过程。
 * 如果只依赖它，进程在防抖窗口内退出（插件卸载 / 关窗 / 崩溃）时，
 * 磁盘上的目标文件仍是**旧字节**，而内存里是新的 —— 下次启动读到残缺状态。
 * 真实症状：`index.json` 507 字节（1 条笔记）、`index.json.tmp` 12.7KB（37 条笔记），
 * 于是 Dashboard 几乎全部显示为「新知识」。
 *
 * 因此这里显式做三步，保证「同步写目标 + 清理临时文件」：
 *  1. 写 `<file>.tmp`（模拟 Node fs 的原子写语义，同时保留 mid-write 崩溃的可恢复副本）；
 *  2. rename 到目标（更新镜像，并让本次写入尽快落盘）；
 *  3. **同步再写一次目标**，确保镜像与目标内容一致（不依赖异步落盘时机）。
 * rename 不可用时退化为直接写目标；两种情况都会清理临时文件。
 */
export function atomicWriteJson(filePath: string, value: unknown): void {
  const data = JSON.stringify(value);
  const tmp = filePath + ".tmp";
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, filePath);
  } catch {
    // rename 不可用：清掉临时文件，直接写目标
    try { fs.unlinkSync(tmp); } catch { /* 临时文件可能不存在 */ }
  }
  // 同步再写一次目标（内存镜像即时生效），随后**立即落盘**：
  // 便携层的常规落盘是 800ms 防抖，索引重建/状态保存不能等 —— 进程在窗口内退出会丢。
  fs.writeFileSync(filePath, data, "utf8");
  fs.flushMirrorSoon();
}

/**
 * 修复「临时写残留」：`<file>.tmp` 与 `<file>` 同时存在时，若目标为空或非法，
 * 而临时文件是合法 JSON 且信息量更大，则用临时文件替换目标（只增不减，§三十一）。
 *
 * 返回修复的文件数。用于启动时的状态完整性巡检。
 */
export function repairStaleTempFiles(filePaths: string[], measure: (raw: string) => number): number {
  let fixed = 0;
  for (const target of filePaths) {
    const tmp = target + ".tmp";
    try {
      if (!fs.existsSync(tmp)) continue;
      const tmpRaw = fs.readFileSync(tmp, "utf8");
      let tmpWeight = 0;
      try { tmpWeight = measure(tmpRaw); } catch { continue; }
      if (tmpWeight <= 0) continue;
      let targetWeight = 0;
      if (fs.existsSync(target)) {
        try { targetWeight = measure(fs.readFileSync(target, "utf8")); } catch { targetWeight = 0; }
      }
      if (targetWeight >= tmpWeight) continue; // 目标已够好 → 只清理临时文件
      fs.writeFileSync(target, tmpRaw, "utf8");
      fixed++;
    } catch { /* 单个文件失败不影响其它文件 */ }
  }
  return fixed;
}

/**
 * 给持久化对象补 formatVersion（若缺失，视为历史版本一次迁移；未知字段保留）。
 * 数组形态的历史文件（如 ai-cache.json 旧数组）不需要版本号，load 侧按结构兼容。
 */
export function withFormatVersion<T extends object>(obj: T): T & { formatVersion: number } {
  const rec = obj as Record<string, unknown>;
  if (typeof rec["formatVersion"] !== "number") rec["formatVersion"] = FORMAT_VERSION;
  return rec as T & { formatVersion: number };
}

/** 读取持久化对象的 formatVersion（缺失按 0 处理 = 历史版本） */
export function readFormatVersion(value: unknown): number {
  if (value && typeof value === "object") {
    const v = (value as Record<string, unknown>)["formatVersion"];
    if (typeof v === "number") return v;
  }
  return 0;
}
