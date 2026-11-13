/**
 * Phase 25：Obsidian DeferredView 兼容层。
 *
 * 自 Obsidian 1.7.2 起，隐藏标签页里的 View 可能是「延迟实例化」的占位对象（DeferredView），
 * 它不是 CardsView / ExamSessionView / ExamReviewView / ReviewSessionView / AIWorkbenchView 的实例。
 * 因此任何 getLeavesOfType(...) 之后把 leaf.view 直接 `as XxxView` 都是不安全的：
 * - 未实例化时调用 setScope / refresh / loadExam / preset 会抛 TypeError；
 * - 这正是用户截图里那类 `xxx is not a function` 报错的常见来源之一。
 *
 * 本模块只做两件事：
 * 1. 如果 leaf 支持 `loadIfDeferred()`，先等它真正实例化；
 * 2. 用严格的 instanceof 判定拿到具体 View，否则返回 null（调用方跳过刷新，等 View 真正打开时再读 Store）。
 *
 * 故意不改 minAppVersion：`loadIfDeferred` 作为可选结构类型存在，旧版本 Obsidian 走原路径，
 * 只是不做预实例化（本来旧版本也不存在 DeferredView）。
 */

/** 结构化的可选 loadIfDeferred（不依赖新版 obsidian 类型定义） */
export type DeferredWorkspaceLeaf = {
  view: unknown;
  loadIfDeferred?: () => Promise<void> | void;
  getViewType?: () => string;
};

/**
 * 解析 leaf 的真实 View 实例。
 * @param leaf WorkspaceLeaf（或测试里的等价对象）
 * @param isExpected 具体的 instanceof 守卫
 * @param onError 失败日志（绝不做静默兜底）
 */
export async function resolveConcreteView<T>(
  leaf: DeferredWorkspaceLeaf | null | undefined,
  isExpected: (view: unknown) => view is T,
  onError?: (stage: string, error: unknown) => void
): Promise<T | null> {
  if (!leaf) return null;

  if (typeof leaf.loadIfDeferred === "function") {
    try {
      await leaf.loadIfDeferred();
    } catch (err) {
      // 延迟视图加载失败不是“可以忽略的小事”，但它不应阻塞调用方（不做强制 as 转换）
      onError?.("loadIfDeferred", err);
      return null;
    }
  }

  return isExpected(leaf.view) ? leaf.view : null;
}

/** 判断 leaf 当前是否已实例化为期望的 View（不发动作，只读） */
export function isConcreteView<T>(leaf: DeferredWorkspaceLeaf | null | undefined, isExpected: (view: unknown) => view is T): leaf is DeferredWorkspaceLeaf & { view: T } {
  return !!leaf && isExpected(leaf.view);
}

/** 生成 instanceof 守卫（避免调用方反复写 `(v): v is T => v instanceof T`） */
export function instanceGuard<T>(ctor: abstract new (...args: never[]) => T): (view: unknown) => view is T {
  return (view: unknown): view is T => view instanceof (ctor as unknown as new (...args: never[]) => T);
}

/**
 * 对一组 leaf 执行「只有在已实例化时才刷新」的逻辑。
 * 未能实例化的 leaf 直接跳过：View 真正打开时自己会从 Store 读最新状态，不会丢数据。
 */
export async function forEachConcreteLeaf<T>(
  leaves: DeferredWorkspaceLeaf[],
  isExpected: (view: unknown) => view is T,
  apply: (view: T) => void | Promise<void>,
  onError?: (stage: string, error: unknown) => void
): Promise<number> {
  let applied = 0;
  for (const leaf of leaves) {
    const view = await resolveConcreteView(leaf, isExpected, onError);
    if (!view) continue;
    try {
      await apply(view);
      applied++;
    } catch (err) {
      onError?.("apply", err);
    }
  }
  return applied;
}
