/** AI Provider 层：SiliconFlow（OpenAI-compatible）。错误信息永不包含 API Key / Authorization（§十九/二十/二十一）。
 *  code：结构化错误类型（§二十二：MISSING_KEY / TIMEOUT / NETWORK / HTTP_xxx / EMPTY / PARSE），
 *  供 Profile 测试连接与诊断展示；message 始终为人类可读文案，不含真实 Key。 */
export class AIError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export interface ChatMessage { role: "system" | "user"; content: string; }
export interface ChatOptions { temperature: number; maxTokens: number; timeoutSec: number; }
export interface ChatResult { content: string; model: string; }
export interface ProviderConfig { baseUrl: string; apiKey: string; model: string; }

/** HTTP 状态码 → 人类可读文案（§二十一：不透传网关响应体，防敏感信息回显） */
function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "API 认证失败（" + status + "），请检查 API Key 是否正确。";
  if (status === 404) return "API 接口不存在（" + status + "），请检查 Base URL 是否正确。";
  if (status === 429) return "API 请求过于频繁（" + status + "），请稍后重试。";
  if (status >= 500) return "API 服务暂时不可用（" + status + "），请稍后重试。";
  return "API 返回错误（" + status + "）。";
}

export class SiliconFlowProvider {
  constructor(private cfg: ProviderConfig) {}

  private endpoint(): string {
    return this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  }

  /** 网络层错误 → 分类文案（§二十一：普通用户看不到 fetch failed / ECONNRESET / 原始堆栈） */
  private classifyNetworkError(e: unknown, timeoutSec: number): string {
    const err = e as Error | null;
    if (err && err.name === "AbortError") return "请求超时（已超过 " + timeoutSec + " 秒）。";
    const msg = err?.message ?? "";
    if (/fetch failed|ECONNRESET|ENOTFOUND|getaddrinfo|socket hang up|network|Failed to fetch|failed to fetch|connrefused/i.test(msg)) {
      return "网络连接失败，请检查网络设置后重试。";
    }
    return "网络请求失败，请稍后重试。";
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    if (!this.cfg.apiKey) throw new AIError("尚未配置 API Key：请到 设置 → AI 中填写。", "MISSING_KEY");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutSec * 1000);
    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + this.cfg.apiKey,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: false,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = this.classifyNetworkError(e, opts.timeoutSec);
      throw new AIError(msg, msg.indexOf("超时") >= 0 ? "TIMEOUT" : "NETWORK");
    }
    clearTimeout(timer);
    if (!res.ok) {
      try { await res.text(); } catch { /* 读取后丢弃：绝不把响应体回显给 UI（部分网关会回显 Authorization） */ }
      throw new AIError(httpErrorMessage(res.status), "HTTP_" + res.status);
    }
    try {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") throw new AIError("API 返回了空响应。", "EMPTY");
      return { content, model: this.cfg.model };
    } catch (e) {
      if (e instanceof AIError) throw e;
      throw new AIError("响应解析失败（返回内容无效）。", "PARSE");
    }
  }

  /** Phase 16 §26-29：流式输出（SSE）。AbortController 由调用方持有（取消按钮 §28）；
   *  首个 token（TTFT，§19）通过 onFirstToken 回调记录；增量通过 onDelta 回调。
   *  流失败由调用方回退普通 chat（§27：禁止重复发起两次相同请求——回退只在 stream 尚未拿到完整结果时执行）。 */
  async stream(
    messages: ChatMessage[],
    opts: ChatOptions,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    onFirstToken?: (at: number) => void
  ): Promise<ChatResult> {
    if (!this.cfg.apiKey) throw new AIError("尚未配置 API Key：请到 设置 → AI 中填写。", "MISSING_KEY");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutSec * 1000);
    if (signal) {
      const onAbort = () => ctrl.abort();
      signal.addEventListener("abort", onAbort);
      (ctrl.signal as unknown as { _kgSignal?: AbortSignal })._kgSignal = signal;
    }
    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + this.cfg.apiKey,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: true,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = this.classifyNetworkError(e, opts.timeoutSec);
      throw new AIError(msg, msg.indexOf("超时") >= 0 ? "TIMEOUT" : "NETWORK");
    }
    clearTimeout(timer);
    if (!res.ok) {
      try { await res.text(); } catch { /* 丢弃：不把响应体回显（防 Authorization 泄漏） */ }
      throw new AIError(httpErrorMessage(res.status), "HTTP_" + res.status);
    }
    if (!res.body) throw new AIError("网络响应没有可读取的流。", "NETWORK");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";
    let firstTokenEmitted = false;
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
              if (!firstTokenEmitted && onFirstToken) { onFirstToken(Date.now()); firstTokenEmitted = true; }
              if (onDelta) onDelta(delta);
              full += delta;
            }
          } catch { /* 跳过非 JSON 行 */ }
        }
        if (doneSaw) break;
      }
    } finally {
      void reader.releaseLock();
    }
    if (!full.trim()) throw new AIError("API 流式返回为空。", "EMPTY");
    return { content: full, model: this.cfg.model };
  }

  async testConnection(): Promise<void> {
    await this.chat(
      [{ role: "user", content: "请只回复四个字：连接成功。" }],
      { temperature: 0, maxTokens: 16, timeoutSec: 20 }
    );
  }
}
