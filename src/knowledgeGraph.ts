/** Phase 5：AI Connection Result → GraphModel（纯数据层，不依赖 Obsidian DOM）
 *  职责：normalize（防御校验：path/role/edge 端点/去重）→ selectCoreGraph（§45/46 上限裁剪）。
 *  绝不修改缓存原数据；超出显示上限时只裁剪 UI 模型，缓存保留完整结果。 */
import type { RelationshipEvidence, AIConnectionEdge, AIConnectionNode, AIConnectionResult, ConnectionNodeRole, InsightType, QueryExplorationEdge, QueryExplorationNode, QueryExplorationResult } from "./types";

export type GraphNodeRole = "question" | "origin" | "concept" | "bridge" | "destination" | "note";

export interface GraphNode {
  id: string;        // = path（Vault 内唯一）
  path: string;
  label: string;     // 显示标题（AI label 优先，否则笔记 basename）
  role: GraphNodeRole;
  reason: string;
}

export interface GraphEdge {
  id: string;        // from + "→" + to（去重）
  from: string;
  to: string;
  relation: string;
  direction: "forward" | "bidirectional";
  reason: string;
  evidence?: RelationshipEvidence[]; // 关系证据：user_confirmed / wikilink / ai_inferred（§十七）
}

export interface GraphModel {
  key: string;       // cache entry key（内存 Graph 缓存用，§25）
  title: string;
  type: InsightType;
  summary: string;
  question: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNotes: number; // 原始节点数（裁剪前，用于「还有 N 个相关节点」）
  moreCount: number;  // totalNotes - nodes.length（显示「还有 N 个相关节点」）
}

export const GRAPH_MAX_NODES = 12; // §45：第一版显示上限
export const GRAPH_MAX_EDGES = 16;

const VALID_ROLES = new Set<GraphNodeRole>(["question", "origin", "concept", "bridge", "destination", "note"]);

function basename(p: string): string {
  return p.split("/").pop()?.replace(/\.md$/, "") ?? p;
}

/** edge.from/to 归一化为带 .md 的 path */
function normPath(p: string): string {
  const t = (p || "").trim();
  return t.endsWith(".md") ? t : t + ".md";
}

function capStrict(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}


/** ---------- 安全链（§42/43）：候选路径 + 边端点校验（缓存写入前执行，UI 层共用） ---------- */

export const CONNECTION_VALID_ROLES: ConnectionNodeRole[] = [
  "question", "origin", "concept", "bridge", "destination", "note",
];
export const CONNECTION_ROLES = new Set<string>(CONNECTION_VALID_ROLES);

/** nodes 校验：path ∈ allowed（候选清单）、去重、role 白名单；防御上限 30，防 AI 输出膨胀缓存 */
export function filterConnectionNodes(raw: unknown, allowed: string[]): AIConnectionNode[] {
  if (!Array.isArray(raw)) return [];
  const allowedSet = new Set(allowed.map((p) => p.replace(/\.md$/i, "")));
  const out: AIConnectionNode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["path"] !== "string") continue;
    const bare = rec["path"].replace(/\.md$/i, "");
    if (!allowedSet.has(bare) && !allowed.includes(rec["path"] as string)) continue;
    if (seen.has(bare)) continue;
    seen.add(bare);
    const role = CONNECTION_ROLES.has(rec["role"] as string) ? (rec["role"] as ConnectionNodeRole) : "note";
    out.push({
      path: bare + ".md",
      role,
      label: capStrict(rec["label"], 40),
      reason: capStrict(rec["reason"], 160),
    });
    if (out.length >= 30) break;
  }
  return out;
}

/** 边端点解析为 node.path（兼容带/不带 .md 的 AI 输出） */
export function resolveNodePath(v: string, nodes: AIConnectionNode[]): string | null {
  const bare = v.endsWith(".md") ? v.slice(0, -3) : v;
  for (const n of nodes) {
    if (n.path === v || n.path.replace(/\.md$/, "") === bare) return n.path;
  }
  return null;
}

/** edges 校验：from/to 必须 ∈ nodeIds、relation 非空、direction 白名单、去重；防御上限 40 */
export function filterConnectionEdges(raw: unknown, nodes: AIConnectionNode[]): AIConnectionEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: AIConnectionEdge[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["from"] !== "string" || typeof rec["to"] !== "string") continue;
    if (typeof rec["relation"] !== "string" || rec["relation"].trim().length === 0) continue;
    const from = resolveNodePath(rec["from"], nodes);
    const to = resolveNodePath(rec["to"], nodes);
    if (!from || !to || from === to) continue;
    const d = rec["direction"];
    const direction = d === "bidirectional" ? "bidirectional" : "forward";
    const key = from + "|" + to;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from,
      to,
      relation: capStrict(rec["relation"], 30),
      direction,
      reason: capStrict(rec["reason"], 160),
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** Result → GraphModel：service 已校验；这里做第二道防御，保证 UI 层永远拿到安全数据 */
export function normalizeConnection(raw: AIConnectionResult, key = ""): GraphModel | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  const nodeByPath = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  for (const n of raw.nodes as AIConnectionNode[]) {
    if (!n || typeof n.path !== "string") continue;
    const p = normPath(n.path);
    if (nodeByPath.has(p)) continue;
    const g: GraphNode = {
      id: p,
      path: p,
      label: capStrict(n.label, 40) || basename(p),
      role: n.role && VALID_ROLES.has(n.role) ? n.role : "note",
      reason: capStrict(n.reason, 160),
    };
    nodeByPath.set(p, g);
    nodes.push(g);
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of raw.edges as AIConnectionEdge[]) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    const from = nodeByPath.get(normPath(e.from));
    const to = nodeByPath.get(normPath(e.to));
    if (!from || !to || from.id === to.id) continue;
    const relation = capStrict(e.relation, 30);
    if (!relation) continue;
    const id = from.id + "→" + to.id;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      from: from.id,
      to: to.id,
      relation,
      direction: e.direction === "bidirectional" ? "bidirectional" : "forward",
      reason: capStrict(e.reason, 160),
    });
  }
  if (nodes.length === 0) return null;
  const typeRaw = raw.type as InsightType;
  const type: InsightType =
    typeRaw === "question" || typeRaw === "tension" || typeRaw === "pattern" || typeRaw === "missing_link"
      ? typeRaw : "connection";
  return {
    key,
    title: capStrict(raw.title, 80),
    type,
    summary: capStrict(raw.summary, 500),
    question: capStrict(raw.question, 300),
    nodes,
    edges,
    totalNotes: nodes.length,
    moreCount: 0,
  };
}

/** 核心路径选择（§45/46）：
 *  未超上限 → 全量（保留回边，循环图可显示）；
 *  超上限 → 从 question/insight 节点出发做 BFS 生成树（最短有效连接路径 + 高节点覆盖），
 *  绝不用链接数量自行创造 AI 从未表达的关系。 */
export function selectCoreGraph(model: GraphModel): GraphModel {
  if (model.nodes.length <= GRAPH_MAX_NODES && model.edges.length <= GRAPH_MAX_EDGES) {
    return model;
  }
  const start =
    model.nodes.find((n) => n.role === "question") ??
    model.nodes.find((n) => n.role === "origin") ??
    model.nodes.find((n) => model.edges.some((e) => e.from === n.id || e.to === n.id)) ??
    model.nodes[0];
  if (!start) return model;
  const adj = new Map<string, GraphEdge[]>();
  for (const e of model.edges) {
    for (const v of [e.from, e.to]) {
      const arr = adj.get(v) ?? [];
      arr.push(e);
      adj.set(v, arr);
    }
  }
  const picked = new Set<string>([start.id]);
  const order: string[] = [start.id];
  const parentOf = new Map<string, string>();
  for (let i = 0; i < order.length; i++) {
    if (order.length >= GRAPH_MAX_NODES) break;
    const cur = order[i];
    for (const e of adj.get(cur) ?? []) {
      if (order.length >= GRAPH_MAX_NODES) break;
      const other = e.from === cur ? e.to : e.from;
      if (picked.has(other)) continue;
      picked.add(other);
      parentOf.set(other, cur);
      order.push(other);
    }
  }
  const treeEdges = model.edges.filter((e) => {
    return parentOf.get(e.to) === e.from || parentOf.get(e.from) === e.to;
  }).slice(0, GRAPH_MAX_EDGES);
  const nodes = model.nodes.filter((n) => picked.has(n.id));
  return {
    ...model,
    nodes,
    edges: treeEdges,
    totalNotes: model.nodes.length,
    moreCount: model.nodes.length - nodes.length,
  };
}

/* ---------- Query Explorer（§四十二/四十/四十三）：QueryExplorationResult → GraphModel（复用现有 Graph/Layout/SVG） ---------- */

/** Query 中心节点的特殊 path（§四十/四十四：点击不打开 Markdown，而是重新运行查询） */
export const QUERY_NODE_PATH = "__query__";

/** 归一化：AI 节点全部 ∈ 候选白名单（§八十四，service 已校验）；前端附加「用户问题」中心节点 + 与 origin 的连接（§四十/四十一）。 */
export function normalizeQueryResult(
  raw: QueryExplorationResult,
  key: string,
  query: string
): GraphModel | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
  const nodeByPath = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  for (const n of raw.nodes as QueryExplorationNode[]) {
    if (!n || typeof n.path !== "string") continue;
    const p = normPath(n.path);
    if (nodeByPath.has(p)) continue;
    const g: GraphNode = {
      id: p,
      path: p,
      label: capStrict(n.label, 40) || basename(p),
      role: n.role && VALID_ROLES.has(n.role) ? n.role : "note",
      reason: capStrict(n.reason, 160),
    };
    nodeByPath.set(p, g);
    nodes.push(g);
  }
  if (nodes.length === 0) return null;
  // 附加「用户问题」中心节点（§四十）：role=question，不打开笔记
  nodes.unshift({
    id: QUERY_NODE_PATH,
    path: QUERY_NODE_PATH,
    label: "🔎 " + ((query || "").slice(0, 18) || "用户问题"),
    role: "question",
    reason: "用户输入的问题",
  });
  const edgeSeen = new Set<string>();
  const edges: GraphEdge[] = [];
  // Query 中心 → origin 节点（§四十一：问题 → 知识起点）；无 origin 时连第一个真实节点
  const origins = nodes.filter((n) => n.path !== QUERY_NODE_PATH && n.role === "origin").slice(0, 4);
  const starts = origins.length > 0 ? origins : nodes.slice(1, 2);
  for (const o of starts) {
    const id = QUERY_NODE_PATH + "→" + o.id;
    edgeSeen.add(id);
    edges.push({ id, from: QUERY_NODE_PATH, to: o.id, relation: "起点", direction: "forward", reason: "问题指向的知识起点" });
  }
  for (const e of raw.edges as QueryExplorationEdge[]) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    const from = nodeByPath.get(normPath(e.from));
    const to = nodeByPath.get(normPath(e.to));
    if (!from || !to || from.id === to.id) continue;
    const relation = capStrict(e.relation, 30);
    if (!relation) continue;
    const id = from.id + "→" + to.id;
    if (edgeSeen.has(id)) continue;
    edgeSeen.add(id);
    edges.push({
      id,
      from: from.id,
      to: to.id,
      relation,
      direction: e.direction === "bidirectional" ? "bidirectional" : "forward",
      reason: capStrict(e.reason, 160),
    });
  }
  return {
    key,
    title: capStrict(raw.headline, 80) || query || "知识探索",
    type: "connection" as InsightType,
    summary: capStrict(raw.summary, 500),
    question: query || "",
    nodes,
    edges,
    totalNotes: nodes.length - 1,
    moreCount: 0,
  };
}