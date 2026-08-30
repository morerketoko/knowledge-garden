/**
 * Phase 5：Layered Layout——GraphModel → Node Positions（纯计算，无第三方库）。
 * - 横向分层：Layer0 问题/洞察 → 后续层（origin → concept/bridge → destination）。
 * - cycle 处理：BFS 用 visited 拦截回边（cycle breaking），回边作为 non-tree edge 绘制（§44）。
 * - 不做随机布局；不引入 D3 / Cytoscape / vis.js。
 */
import type { GraphModel } from "./knowledgeGraph";

export interface LayoutNodePos {
  id: string;
  layer: number;
  x: number;
  y: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  isBackEdge: boolean;
}

export interface GraphLayout {
  nodes: LayoutNodePos[];
  edges: LayoutEdge[];
  /** 根 → node 的 BFS 树父链（用于路径高亮：点击节点回溯到根） */
  parentOf: Record<string, string>;
  rootId: string;
}

export function computeGraphLayout(model: GraphModel, width: number, height: number): GraphLayout {
  const ids = new Set(model.nodes.map((n) => n.id));
  const edges = model.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const adjOut = new Map<string, string[]>();
  for (const e of edges) {
    const arr = adjOut.get(e.from) ?? [];
    arr.push(e.to);
    adjOut.set(e.from, arr);
  }
  const root =
    model.nodes.find((n) => n.role === "question") ??
    model.nodes.find((n) => n.role === "origin") ??
    model.nodes.find((n) => (adjOut.get(n.id) ?? []).length > 0) ??
    model.nodes[0];
  const rootId = root ? root.id : "";

  // BFS 分层（有向边；visited 拦截回边 → 不死循环）
  const layer = new Map<string, number>();
  const parentOf: Record<string, string> = {};
  if (rootId) {
    layer.set(rootId, 0);
    const visited = new Set<string>([rootId]);
    const queue: string[] = [rootId];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const l = layer.get(cur) ?? 0;
      for (const next of adjOut.get(cur) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        parentOf[next] = cur;
        layer.set(next, l + 1);
        queue.push(next);
      }
    }
    // 有向不可达节点兜底到 Layer1，避免孤立悬挂
    for (const n of model.nodes) {
      if (!layer.has(n.id)) layer.set(n.id, 1);
    }
  }

  // 回边判定：非树边且 from 层 >= to 层（cycle / 横向边）
  const back = new Set<string>();
  for (const e of edges) {
    const lf = layer.get(e.from) ?? 0;
    const lt = layer.get(e.to) ?? 0;
    const isTree = parentOf[e.to] === e.from || parentOf[e.from] === e.to;
    if (!isTree && lt <= lf) back.add(e.from + "|" + e.to);
  }

  // 每层内按 label 排序，层内节点均匀垂直分布，x 按层水平分布
  const sorted = [...model.nodes].sort((a, b) => {
    const la = layer.get(a.id) ?? 0;
    const lb = layer.get(b.id) ?? 0;
    return la !== lb ? la - lb : a.label.localeCompare(b.label);
  });
  const maxLayer = Math.max(0, ...Array.from(layer.values()));
  const W = Math.max(220, width - 16);
  const H = Math.max(120, height - 16);
  const layers: string[][] = [];
  for (const n of sorted) {
    const l = layer.get(n.id) ?? 0;
    (layers[l] ??= []).push(n.id);
  }
  const pos: LayoutNodePos[] = sorted.map((n) => {
    const l = layer.get(n.id) ?? 0;
    const list = layers[l];
    const idx = list.indexOf(n.id);
    const cnt = list.length;
    const x = maxLayer === 0 ? W / 2 : 12 + ((W - 24) * l) / maxLayer;
    const y = cnt <= 1 ? 12 + H / 2 : 12 + ((H - 24) * idx) / (cnt - 1);
    return { id: n.id, layer: l, x, y };
  });
  const layoutEdges: LayoutEdge[] = edges.map((e) => ({
    from: e.from,
    to: e.to,
    isBackEdge: back.has(e.from + "|" + e.to),
  }));
  return { nodes: pos, edges: layoutEdges, parentOf, rootId };
}
