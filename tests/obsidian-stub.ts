/** Obsidian API 运行时 stub（仅供 Node 测试 bundle 使用，不是插件代码） */
export class Notice { constructor(_m: unknown) {} }
export class ItemView { contentEl: HTMLElement = document as unknown as HTMLElement; app: unknown; getViewType(): string { return ""; } getDisplayText(): string { return ""; } getIcon(): string { return ""; } async onOpen(): Promise<void> {} }
export class TFile { path = ""; basename = ""; extension = "md"; }
export class TFolder { path = ""; }
export class SuggestModal<T> { constructor(_app: unknown) {} open(): void {} close(): void {} }
export class Modal { contentEl: HTMLElement = document as unknown as HTMLElement; app: unknown; constructor(_app: unknown) {} open(): void {} close(): void {} }
export class Plugin { app: unknown; settings: Record<string, unknown> = {}; }
export class WorkspaceLeaf { }
export const MarkdownRenderer = { render: async (): Promise<void> => {} };
export const normalizePath = (p: string): string => p;
export const setIcon = (): void => {};
export const Platform = { isMobile: false };
export const requestUrl = async (): Promise<{ text: string; json: unknown; status: number }> => ({ text: "", json: null, status: 200 });
export const parseYaml = (s: string): unknown => ({} as unknown);
export const stringifyYaml = (o: unknown): string => JSON.stringify(o);