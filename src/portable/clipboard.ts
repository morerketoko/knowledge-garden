/**
 * Phase 24 §六十六 / §一百二十八：平台无关剪贴板。
 *
 * 约束：
 * - **禁止** 使用 Obsidian / Node 的剪贴板原生模块（桌面专属，移动端不可用；§一百三十六）。
 * - 优先 `navigator.clipboard`（移动端 WebView 支持，但 **必须由用户手势触发**）。
 * - 读剪贴板在 iOS 上经常被拒绝（权限 / 非手势上下文）→ 必须有「手动粘贴」兜底路径；
 *   写剪贴板失败 → 退回 `document.execCommand("copy")` 选区方案。
 *
 * 所有函数都不抛错，返回布尔值由 UI 决定提示文案（§一百二十八：必须 fallback）。
 */

export interface ClipboardOutcome {
  ok: boolean;
  /** 失败原因（人类可读，供 Notice 展示） */
  reason?: string;
}

function nav(): Navigator["clipboard"] | null {
  try {
    const c = (navigator as Navigator | undefined)?.clipboard;
    return c && typeof c.writeText === "function" ? c : null;
  } catch {
    return null;
  }
}

/** execCommand 兜底：把文本放进临时 textarea 并选中复制 */
function legacyCopy(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "readonly");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    document.body.appendChild(el);
    const selection = window.getSelection();
    const prev = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand("copy");
    document.body.removeChild(el);
    if (prev && selection) { selection.removeAllRanges(); selection.addRange(prev); }
    return !!ok;
  } catch {
    return false;
  }
}

/** 复制文本：navigator.clipboard → execCommand 兜底 */
export async function copyText(text: string): Promise<ClipboardOutcome> {
  const value = String(text ?? "");
  if (!value) return { ok: false, reason: "没有可复制的内容。" };
  const c = nav();
  if (c) {
    try {
      await c.writeText(value);
      return { ok: true };
    } catch {
      /* 权限 / 非手势上下文 → 走兜底 */
    }
  }
  if (legacyCopy(value)) return { ok: true };
  return { ok: false, reason: "系统拒绝了剪贴板写入，请手动选择文本复制。" };
}

/** 读取剪贴板：失败时 UI 必须提供手动粘贴入口（§六十六） */
export async function readText(): Promise<{ ok: boolean; text: string; reason?: string }> {
  const c = nav();
  if (c && typeof c.readText === "function") {
    try {
      const t = await c.readText();
      if (t) return { ok: true, text: t };
      return { ok: false, text: "", reason: "剪贴板为空。" };
    } catch {
      return { ok: false, text: "", reason: "系统未授予剪贴板读取权限，请手动粘贴内容。" };
    }
  }
  return { ok: false, text: "", reason: "当前环境不支持读取剪贴板，请手动粘贴内容。" };
}

/** 该平台读取剪贴板是否需要用户手动兜底（UI 据此提前显示「手动粘贴」入口） */
export function clipboardReadMayFail(): boolean {
  return !nav() || typeof (nav() as { readText?: unknown })?.readText !== "function";
}
