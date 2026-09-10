/**
 * Phase 24 §三 / §十三：便携存储的**同步视图**（无任何 Node import）。
 *
 * 设计（单一事实来源 = 内存镜像）：
 *   1. onload 时 `initSyncMirror()` 把插件状态根目录下的全部文件读入镜像（await 一次）。
 *   2. 业务代码继续使用同步 API（`existsSync` / `readFileSync` / `writeFileSync` …），
 *      全部操作镜像 —— 立即生效，无 await 级联（§十五：禁止把整个项目同步改异步）。
 *   3. 写操作把文件标脏，800ms 合并后异步落盘到 StorageRoot（Vault API 或 Plugin Data）；
 *      错误延后到下一次同步调用抛出，保持旧 `fs.writeFileSync` 的 try/catch 语义。
 *
 * 为什么不用 Node fs：移动端没有 fs（§三）；桌面与移动走同一套代码，消除平台分叉。
 * 目录语义：镜像内的键就是 **后端相对路径**（例如 `.state/cache/activity.json`）。
 */
import type { PortableStorageHost } from "./host";

let host: PortableStorageHost | null = null;
/** 镜像：后端相对路径 → 文本 */
const mirror = new Map<string, string>();
const dirty = new Set<string>();
let pendingError: Error | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let initialized = false;

/** 落盘节流：与 Activity 的 800ms 对齐，避免移动端频繁写 Vault 造成卡顿（§二十二 / §一百二） */
export const MIRROR_FLUSH_MS = 800;

export function setStorageHost(h: PortableStorageHost | null): void {
  host = h;
  mirror.clear();
  dirty.clear();
  pendingError = null;
  initialized = false;
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
}

export function getStorageHost(): PortableStorageHost | null { return host; }
export function storageReady(): boolean { return host !== null && initialized; }

/** 诊断用：镜像中的文件数 / 待落盘文件数 */
export function mirrorStats(): { files: number; dirty: number } {
  return { files: mirror.size, dirty: dirty.size };
}

/* ------------------------------------------------------------------ */
/* 初始化 / 落盘                                                       */
/* ------------------------------------------------------------------ */

/** 启动预热：状态根目录递归读入镜像（onload await 一次；失败不阻塞启动） */
export async function initSyncMirror(h: PortableStorageHost): Promise<void> {
  setStorageHost(h);
  try {
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      const items = await h.list(rel);
      for (const it of items) {
        const child = rel ? rel + "/" + it.name : it.name;
        if (await h.isDirectory(child)) await walk(child, depth + 1);
        else {
          const raw = await h.read(child);
          if (raw !== null) mirror.set(child, raw);
        }
      }
    };
    await walk(h.stateRoot, 0);
    // 兼容期：同时把 plugin-data 里的镜像副本读入（Vault 未同步时状态不丢，§十一）
    for (const it of await h.list("mirror")) {
      const raw = await h.read("mirror/" + it.name);
      if (raw !== null) mirror.set(it.name, raw);
    }
  } catch { /* 预热失败 → 空镜像，等同首次运行 */ }
  initialized = true;
}

function schedule(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flushMirror(); }, MIRROR_FLUSH_MS);
}

/**
 * 立即（下一个微任务）落盘。
 *
 * 供 `atomicWriteJson` 这类「必须持久化」的写入使用：写入本身只改内存镜像，
 * 真正落盘默认是 800ms 防抖；若进程在窗口内退出（插件卸载 / 关窗 / 崩溃），
 * 磁盘上仍是旧字节 —— 这正是「索引重建后重启又变回空」的原因。
 */
export function flushMirrorSoon(): void {
  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  void Promise.resolve().then(() => flushMirror());
}

/** 立即落盘（插件 onunload / 关键写入后手动调用） */
export async function flushMirror(): Promise<void> {
  if (!host || flushing || dirty.size === 0) return;
  flushing = true;
  const paths = Array.from(dirty);
  dirty.clear();
  try {
    for (const p of paths) {
      const data = mirror.get(p);
      if (data === undefined) { await host.remove(p); continue; }
      const out = await host.write(p, data, { nativeAtomic: host.backendFor(p).backend === "vault" });
      if (!out.ok) pendingError = pendingError ?? new Error(out.error ?? ("写入失败：" + p));
    }
  } catch (e) {
    pendingError = pendingError ?? (e as Error);
  } finally {
    flushing = false;
    if (dirty.size) schedule();
  }
}

/** 同步调用前检查延迟错误（等价旧 writeFileSync 抛错时机） */
function bump(): void {
  if (pendingError) {
    const e = pendingError;
    pendingError = null;
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* 同步 API（签名与 Node fs 一致，实现无 Node）                        */
/* ------------------------------------------------------------------ */

function key(p: string): string {
  if (!host) return "";
  return host.resolve(p);
}

export function existsSync(p: string): boolean {
  if (!host || !p) return false;
  const k = key(p);
  if (!k) return false;
  if (mirror.has(k)) return true;
  // 目录也算「存在」，但仅当镜像里有子项（realdir 语义）
  const prefix = k + "/";
  for (const m of mirror.keys()) if (m.startsWith(prefix)) return true;
  return false;
}

export function readFileSync(p: string, _enc?: string): string {
  const k = key(p);
  const v = k ? mirror.get(k) : undefined;
  if (v === undefined) throw new Error("ENOENT: " + (k || p));
  return v;
}

export function writeFileSync(p: string, data: string, _enc?: string): void {
  bump();
  const k = key(p);
  if (!k) { pendingError = new Error("存储未就绪，写入被忽略：" + p); return; }
  mirror.set(k, String(data ?? ""));
  dirty.add(k);
  schedule();
}

export function appendFileSync(p: string, data: string): void {
  bump();
  const k = key(p);
  if (!k) { pendingError = new Error("存储未就绪，追加被忽略：" + p); return; }
  mirror.set(k, (mirror.get(k) ?? "") + String(data ?? ""));
  dirty.add(k);
  schedule();
}

export function mkdirSync(_p: string, _opts?: { recursive?: boolean }): void {
  bump(); // 目录由落盘层按需创建（VaultRoot.write / plugin-data 都是路径式）
}

export function renameSync(from: string, to: string): void {
  bump();
  const f = key(from);
  const t = key(to);
  if (!f || !t) throw new Error("存储未就绪，rename 失败");
  const v = mirror.get(f);
  if (v === undefined) throw new Error("ENOENT: " + f);
  mirror.delete(f);
  mirror.set(t, v);
  dirty.add(t);
  schedule();
}

export function unlinkSync(p: string): void {
  bump();
  const k = key(p);
  if (!k) return;
  mirror.delete(k);
  dirty.add(k); // 落盘时 mirror.get 为 undefined → remove
  schedule();
}

export interface PortableDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

/** 类型别名：源码里写 `fs.Dirent[]` 的地方改指这里（eliminating @types/node 依赖） */
export type Dirent = PortableDirent;

/** 类型别名：`fs.Stats` 的最小可用面（本项目只读 size/mtime） */
export interface Stats {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export function readdirSync(p: string, _opts?: { withFileTypes?: boolean }): PortableDirent[] {
  if (!host || !p) return [];
  const k = key(p);
  const prefix = k ? k + "/" : "";
  const seen = new Map<string, boolean>();
  for (const m of mirror.keys()) {
    if (!m.startsWith(prefix)) continue;
    const rest = m.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const isDir = slash >= 0;
    seen.set(name, (seen.get(name) ?? false) || isDir);
  }
  return Array.from(seen.entries())
    .map(([name, isDir]) => ({ name, isFile: () => !isDir, isDirectory: () => isDir }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 测试 / 诊断：镜像内容快照（不暴露给业务逻辑） */
export function __mirrorSnapshot(): Record<string, string> {
  return Object.fromEntries(mirror);
}
