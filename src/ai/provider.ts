/** AI Provider 层：SiliconFlow（OpenAI-compatible）。错误信息永不包含 API Key / Authorization（§十九/二十/二十一）。
 *  code：结构化错误类型（§二十二：MISSING_KEY / TIMEOUT / NETWORK / HTTP_xxx / EMPTY / PARSE），
 *  供 Profile 测试连接与诊断展示；message 始终为人类可读文案，不含真实 Key。
 *
 *  Phase 24 §二十四~二十六：网络层全部收敛到 `portable/net.ts`：
 *  - 普通请求 → Obsidian `requestUrl`（桌面 + iOS/Android 官方推荐，绕开 CORS 限制）；
 *  - 流式请求 → fetch + ReadableStream（requestUrl 不暴露响应体流）；不可用时自动回退非流式。
 *  本文件不再出现裸 `fetch`，也不再有平台判断分支。
 */
import {
  NetError, httpErrorMessage, requestJson, streamSSE, streamingAvailable,
} from "../portable/net";

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

/** 网络层错误 → provider 错误码（§一百零一：错误分类，不做无限重试） */
function classifyNetError(e: unknown, timeoutSec: number): AIError {
  if (e instanceof AIError) return e;
  const code = e instanceof NetError ? e.code : "NETWORK";
  if (code === "TIMEOUT" || code === "ABORTED") {
    return new AIError("请求超时（已超过 " + timeoutSec + " 秒）。", "TIMEOUT");
  }
  if (code === "OFFLINE") return new AIError("当前处于离线状态，请恢复网络后重试（本地缓存内容仍可查看）。", "OFFLINE");
  return new AIError("网络连接失败，请检查网络设置后重试。", "NETWORK");
}

/**
 * Phase 21.x Hotfix：finish_reason=length → 输出被 max_tokens 截断。
 * 截断的 JSON/Markdown 必然不完整，继续解析只会得到误导性的“格式非法”。
 * 返回 AIError（code=TRUNCATED），否则 null。纯函数便于 Node 自动测试。
 */
export function truncationError(finishReason: unknown): AIError | null {
  if (finishReason === "length") {
    return new AIError(
      "当前批次输出被长度上限截断（finish_reason=length），系统会自动尝试拆分/重试该批次；若仍失败，请降低总题数或检查模型输出窗口。",
      "TRUNCATED"
    );
  }
  return null;
}

export class SiliconFlowProvider {
  constructor(private cfg: ProviderConfig) {}

  private endpoint(): string {
    return this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + this.cfg.apiKey,
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions, signal?: AbortSignal): Promise<ChatResult> {
    if (!this.cfg.apiKey) throw new AIError("尚未配置 API Key：请到 设置 → AI 中填写。", "MISSING_KEY");
    let out;
    try {
      out = await requestJson({
        url: this.endpoint(),
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: false,
        }),
        timeoutSec: opts.timeoutSec,
        signal,
      });
    } catch (e) {
      throw classifyNetError(e, opts.timeoutSec);
    }
    // 非 2xx：只按状态码分类，绝不回显网关响应体（部分网关会回显 Authorization）
    if (out.status < 200 || out.status >= 300) {
      throw new AIError(httpErrorMessage(out.status), "HTTP_" + out.status);
    }
    const data = out.json as { choices?: { message?: { content?: string }; finish_reason?: unknown }[] } | null;
    if (!data) throw new AIError("响应解析失败（返回内容无效）。", "PARSE");
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") throw new AIError("API 返回了空响应。", "EMPTY");
    // Phase 21.x Hotfix：finish_reason=length → 截断结果直接拒绝（code=TRUNCATED，见 truncationError）
    const trunc = truncationError(data.choices?.[0]?.finish_reason);
    if (trunc) throw trunc;
    return { content, model: this.cfg.model };
  }

  /** Phase 16 §26-29：流式输出（SSE）。AbortController 由调用方持有（取消按钮 §28）；
   *  首个 token（TTFT，§19）通过 onFirstToken 回调记录；增量通过 onDelta 回调。
   *  Phase 24 §六十二/§六十三：移动端必须边生成边显示且必须能停止生成 —— 因此这里保留
   *  fetch 流式路径；当环境没有流式能力（或流式请求失败且尚未产生内容）时，
   *  **自动回退** `chat()`（requestUrl），保证移动端功能不降级（§一百三十）。 */
  async stream(
    messages: ChatMessage[],
    opts: ChatOptions,
    signal?: AbortSignal,
    onDelta?: (delta: string) => void,
    onFirstToken?: (at: number) => void
  ): Promise<ChatResult> {
    if (!this.cfg.apiKey) throw new AIError("尚未配置 API Key：请到 设置 → AI 中填写。", "MISSING_KEY");

    if (!streamingAvailable()) {
      return this.chat(messages, opts, signal); // 无流式能力：直接用 requestUrl
    }

    const body = JSON.stringify({
      model: this.cfg.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: true,
    });

    let sawContent = false;
    let res: { text: string; status: number } | null = null;
    try {
      res = await streamSSE(
        { url: this.endpoint(), headers: this.headers(), body, timeoutSec: opts.timeoutSec },
        {
          signal,
          onFirstToken,
          onDelta: (d) => { sawContent = true; onDelta?.(d); },
        }
      );
    } catch (e) {
      // 已经显示过增量 → 不能静默重发（§27 禁止重复发起两次相同请求）
      if (sawContent) throw classifyNetError(e, opts.timeoutSec);
      // 还没拿到任何内容 → 回退非流式（例如运营商 / 中间层不支持 SSE）
      return this.chat(messages, opts, signal);
    }

    if (res === null) return this.chat(messages, opts, signal); // 环境不支持流式
    if (res.status < 200 || res.status >= 300) {
      throw new AIError(httpErrorMessage(res.status), "HTTP_" + res.status);
    }
    if (!res.text.trim()) {
      // 流式返回空：未产生内容，回退非流式再试一次（只此一次）
      if (!sawContent) return this.chat(messages, opts, signal);
      throw new AIError("API 流式返回为空。", "EMPTY");
    }
    return { content: res.text, model: this.cfg.model };
  }

  async testConnection(): Promise<void> {
    await this.chat(
      [{ role: "user", content: "请只回复四个字：连接成功。" }],
      { temperature: 0, maxTokens: 16, timeoutSec: 20 }
    );
  }
}
