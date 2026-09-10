/**
 * Phase 24 §二十四 / §二十五 / §二十六 / §三十 / §一百零一：平台无关网络层。
 *
 * 两条传输路径，按能力选择（不按平台猜）：
 *
 *  1. **requestUrl**（Obsidian 官方 API）—— 非流式请求的唯一路径。
 *     它绕过 Obsidian 环境里的 CORS / 协议限制，桌面与 iOS / Android 都可用。
 *     §二十五 明确要求：不能直接用 fetch 发普通请求。
 *
 *  2. **流式 fetch**—— 仅用于「边生成边显示」（§六十二）。
 *     Obsidian 的 requestUrl **没有** ReadableStream（官方 API 至今不暴露响应体流），
 *     因此流式只能走 fetch。移动端 fetch 请求不受 CORS 限制（Capacitor 原生 WebView
 *     不受同源策略约束），桌面（Electron）同样可以；若运行环境没有 fetch 或没有
 *     ReadableStream，`streamSSE` 会返回 null，Provider 自动回退到 requestUrl 非流式
 *     路径 —— 功能不丢，只是没有逐字效果。
 *
 * 错误分类（§二十一 / §一百零一）：网络层只产出便携错误码，由 provider 翻译成文案，
 * 永不把原始响应体 / Authorization 回显给 UI。
 */
import { requestUrl } from "obsidian";

export type NetErrorCode = "TIMEOUT" | "OFFLINE" | "NETWORK" | "ABORTED";

export class NetError extends Error {
  constructor(message: string, readonly code: NetErrorCode) {
    super(message);
  }
}

export interface JsonRequest {
  url: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  body?: string;
  timeoutSec: number;
  signal?: AbortSignal;
}

export interface JsonOutcome {
  status: number;
  /** 已解析的响应（解析失败为 null） */
  json: unknown | null;
  text: string;
}

function isAbort(e: unknown): boolean {
  return !!e && ((e as Error).name === "AbortError" || /aborted/i.test(String((e as Error).message ?? "")));
}

/** 网络异常 → 便携错误码（§一百零一：错误分类，不做无限重试） */
export function classifyNetworkFailure(e: unknown, timeoutSec: number): NetError {
  if (e instanceof NetError) return e;
  if (isAbort(e)) return new NetError("请求已取消或超过 " + timeoutSec + " 秒。", "TIMEOUT");
  const msg = String((e as Error)?.message ?? e ?? "");
  if (/fetch failed|ECONNRESET|ENOTFOUND|getaddrinfo|socket hang up|network|Failed to fetch|failed to fetch|connrefused|offline|ERR_INTERNET_DISCONNECTED|net::/i.test(msg)) {
    return new NetError("网络连接失败，请检查网络设置后重试。", /offline|ERR_INTERNET_DISCONNECTED/i.test(msg) ? "OFFLINE" : "NETWORK");
  }
  return new NetError("网络请求失败，请稍后重试。", "NETWORK");
}

/**
 * 非流式 JSON 请求（走 requestUrl）。
 * 与旧 `fetch` 的差异：4xx/5xx 不抛异常而是返回 status，由调用方按 code 分类（保持既有错误语义）。
 */
export async function requestJson(req: JsonRequest): Promise<JsonOutcome> {
  // requestUrl 不支持 AbortSignal：用超时守卫 + Promise.race 模拟（取消语义见 streaming 路径）
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NetError("请求超时（已超过 " + req.timeoutSec + " 秒）。", "TIMEOUT")), req.timeoutSec * 1000);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!req.signal) return;
    if (req.signal.aborted) { reject(new NetError("请求已取消。", "ABORTED")); return; }
    req.signal.addEventListener("abort", () => reject(new NetError("请求已取消。", "ABORTED")), { once: true });
  });
  try {
    const call = requestUrl({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
      throw: false, // 自己分类状态码（避免 Obsidian 抛出的错误含响应体）
    });
    const res = await Promise.race([call, timeout, aborted]);
    let json: unknown | null = null;
    try { json = res.json; } catch { json = null; }
    return { status: res.status ?? 0, json, text: res.text ?? "" };
  } catch (e) {
    throw classifyNetworkFailure(e, req.timeoutSec);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface StreamHandlers {
  onDelta(delta: string): void;
  onFirstToken?(at: number): void;
  signal?: AbortSignal;
}

/**
 * SSE 流式请求（fetch + ReadableStream）。
 * 返回完整文本；若当前环境不支持流式（无 fetch / 无 body 流）→ 返回 null，调用方回退非流式。
 * 网络层错误抛 NetError；HTTP 错误状态由调用方判断（此处把 status 一并返回）。
 */
export async function streamSSE(
  req: { url: string; headers: Record<string, string>; body: string; timeoutSec: number },
  handlers: StreamHandlers
): Promise<{ text: string; status: number } | null> {
  const g = globalThis as unknown as { fetch?: typeof fetch; ReadableStream?: unknown; TextDecoder?: unknown };
  if (typeof g.fetch !== "function" || typeof g.TextDecoder !== "function") return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutSec * 1000);
  let external: AbortSignal | undefined;
  if (handlers.signal) {
    external = handlers.signal;
    if (external.aborted) ctrl.abort();
    else external.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await g.fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw classifyNetworkFailure(e, req.timeoutSec);
  }
  clearTimeout(timer); // 已收到响应头：后续按流式读取，不再整体计时（长回答不应被总超时打断）

  const body = (res as unknown as { body?: { getReader?: () => unknown } }).body;
  if (!res.ok || !body || typeof body.getReader !== "function") {
    return { text: "", status: res.status };
  }

  const reader = (body as { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock(): void } }).getReader();
  const decoder = new (g.TextDecoder as new (label?: string) => { decode(input?: Uint8Array, options?: { stream?: boolean }): string })("utf-8");
  let buffer = "";
  let full = "";
  let firstEmitted = false;
  let doneSaw = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") { doneSaw = true; break; }
        try {
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            if (!firstEmitted) { handlers.onFirstToken?.(Date.now()); firstEmitted = true; }
            handlers.onDelta(delta);
            full += delta;
          }
        } catch { /* 跳过非 JSON 行（心跳 / 注释） */ }
      }
      if (doneSaw) break;
    }
  } catch (e) {
    if (external?.aborted) throw new NetError("请求已取消。", "ABORTED");
    throw classifyNetworkFailure(e, req.timeoutSec);
  } finally {
    try { reader.releaseLock(); } catch { /* 已释放 */ }
  }
  return { text: full, status: res.status };
}

/** 当前环境是否具备流式能力（供 UI 决定是否显示「逐字生成」提示） */
export function streamingAvailable(): boolean {
  const g = globalThis as unknown as { fetch?: unknown; TextDecoder?: unknown };
  return typeof g.fetch === "function" && typeof g.TextDecoder === "function";
}

/** HTTP 状态码 → 人类可读文案（§二十一：不透传网关响应体，防敏感信息回显） */
export function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "API 认证失败（" + status + "），请检查 API Key 是否正确。";
  if (status === 404) return "API 接口不存在（" + status + "），请检查 Base URL 是否正确。";
  if (status === 429) return "API 请求过于频繁（" + status + "），请稍后重试。";
  if (status >= 500) return "API 服务暂时不可用（" + status + "），请稍后重试。";
  return "API 返回错误（" + status + "）。";
}
