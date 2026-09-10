/**
 * Phase 5：SVG 渲染层——GraphLayout → DOM/SVG。
 * - 只消费已校验的 GraphModel（AI 内容不可信：所有文本用 textContent / createEl({text})，禁止 innerHTML）。
 * - 交互：节点点击打开真实笔记 + 路径高亮（§39/20）；hover 显示 reason；edge hover 显示 relation+reason；
 *   zoom（按钮 + Ctrl/滚轮）、画布拖动、ResizeObserver 重排（同 GraphModel，绝不调 AI）。
 * - 生命周期：所有监听器 / ResizeObserver 由 destroy() 统一清理（§49/Test 18）。
 */
import type { GraphModel, GraphNode, GraphEdge } from "./knowledgeGraph";
import { computeGraphLayout, type GraphLayout } from "./graphLayout";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 168;
const NODE_H = 34;
const MAX_SCALE = 3;
const MIN_SCALE = 0.2;

export interface GraphSvgCallbacks {
  onOpenNote(path: string): void;
}

function truncate(s: string, max: number): string {
  const t = s || "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

export class GraphSvg {
  private svg: SVGSVGElement;
  private group: SVGGElement;
  private defsId: string;
  private tip: HTMLDivElement;
  private model: GraphModel;
  private layout: GraphLayout;
  private cb: GraphSvgCallbacks;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private selected: string | null = null;
  private resizeObs: ResizeObserver | null = null;
  private destroyed = false;
  private dragging = false;
  private dragId = -1;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragTx = 0;
  private dragTy = 0;
  private cleanup: (() => void)[] = [];

  constructor(container: HTMLElement, model: GraphModel, layout: GraphLayout, cb: GraphSvgCallbacks) {
    this.model = model;
    this.layout = layout;
    this.cb = cb;
    this.defsId = "kgmk" + Math.random().toString(36).slice(2, 9);
    this.svg = svgEl("svg");
    this.svg.setAttribute("class", "kg-graph-svg");
    this.svg.setAttribute("role", "img");
    this.group = svgEl("g");
    this.svg.appendChild(this.group);
    this.tip = document.createElement("div");
    this.tip.className = "kg-graph-tip";
    this.tip.style.display = "none";
    container.appendChild(this.svg);
    container.appendChild(this.tip);

    this.resizeObs = new ResizeObserver(() => {
      if (this.destroyed) return;
      this.relayout();
    });
    this.resizeObs.observe(container);

    this.fit();
    this.renderContent();
    this.bindEvents(container);
  }

  // ---------- 布局 / 视口 ----------

  private viewSize(): { w: number; h: number } {
    const w = this.svg.clientWidth || 400;
    const h = this.svg.clientHeight || 260;
    return { w, h };
  }

  private relayout(): void {
    const { w, h } = this.viewSize();
    this.layout = computeGraphLayout(this.model, w, h);
    this.fit();
    this.renderContent();
  }

  /** 初始/重置：计算 scale 使图完整可见并居中（fit） */
  fit(): void {
    const { w, h } = this.viewSize();
    const xs = this.layout.nodes.map((n) => n.x);
    const ys = this.layout.nodes.map((n) => n.y);
    if (xs.length === 0) { this.applyTransform(); return; }
    const minX = Math.min(...xs) - NODE_W / 2 - 12;
    const maxX = Math.max(...xs) + NODE_W / 2 + 12;
    const minY = Math.min(...ys) - NODE_H / 2 - 12;
    const maxY = Math.max(...ys) + NODE_H / 2 + 12;
    const gw = Math.max(120, maxX - minX);
    const gh = Math.max(80, maxY - minY);
    this.scale = Math.max(MIN_SCALE, Math.min(1.6, (w - 32) / gw, (h - 32) / gh));
    this.tx = (w - gw * this.scale) / 2 - minX * this.scale;
    this.ty = (h - gh * this.scale) / 2 - minY * this.scale;
    this.applyTransform();
  }

  zoomIn(): void {
    this.setScale(this.scale * 1.25);
  }

  zoomOut(): void {
    this.setScale(this.scale / 1.25);
  }

  private setScale(s: number): void {
    const { w, h } = this.viewSize();
    const cx = w / 2;
    const cy = h / 2;
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    // 以视口中心为缩放锚点
    this.tx = cx - ((cx - this.tx) / this.scale) * ns;
    this.ty = cy - ((cy - this.ty) / this.scale) * ns;
    this.scale = ns;
    this.applyTransform();
  }

  private applyTransform(): void {
    this.group.setAttribute("transform", "translate(" + this.tx + "," + this.ty + ") scale(" + this.scale + ")");
  }

  // ---------- 绘制 ----------

  private renderContent(): void {
    this.group.empty?.();
    while (this.group.firstChild) this.group.removeChild(this.group.firstChild);
    const defs = svgEl("defs");
    this.group.appendChild(defs);
    // 箭头 marker（forward + bidirectional）
    const mkEnd = svgEl("marker");
    mkEnd.setAttribute("id", this.defsId + "-end");
    mkEnd.setAttribute("viewBox", "0 0 10 10");
    mkEnd.setAttribute("refX", "9");
    mkEnd.setAttribute("refY", "5");
    mkEnd.setAttribute("markerWidth", "5");
    mkEnd.setAttribute("markerHeight", "5");
    mkEnd.setAttribute("orient", "auto");
    const pEnd = svgEl("path");
    pEnd.setAttribute("d", "M0,0 L10,5 L0,10 z");
    pEnd.setAttribute("class", "kg-graph-marker");
    mkEnd.appendChild(pEnd);
    defs.appendChild(mkEnd);
    const mkStart = svgEl("marker");
    mkStart.setAttribute("id", this.defsId + "-start");
    mkStart.setAttribute("viewBox", "0 0 10 10");
    mkStart.setAttribute("refX", "1");
    mkStart.setAttribute("refY", "5");
    mkStart.setAttribute("markerWidth", "5");
    mkStart.setAttribute("markerHeight", "5");
    mkStart.setAttribute("orient", "auto");
    const pStart = svgEl("path");
    pStart.setAttribute("d", "M10,0 L0,5 L10,10 z");
    pStart.setAttribute("class", "kg-graph-marker");
    mkStart.appendChild(pStart);
    defs.appendChild(mkStart);

    const pos = new Map(this.layout.nodes.map((n) => [n.id, n]));
    // 边（先画，节点压在上面）
    for (const e of this.model.edges) {
      const from = pos.get(e.from);
      const to = pos.get(e.to);
      if (!from || !to) continue;
      const ge = this.layout.edges.find((x) => x.from === e.from && x.to === e.to);
      const isBack = ge ? ge.isBackEdge : to.layer <= from.layer;
      const line = this.drawEdgeLine(e, from, to, isBack);
      this.group.appendChild(line);
      const label = svgEl("text");
      label.setAttribute("class", "kg-graph-el" + (isBack ? " kg-graph-el-back" : ""));
      label.setAttribute("text-anchor", "middle");
      label.textContent = truncate(e.relation, 10);
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2 - (isBack ? 26 : 8);
      label.setAttribute("x", String(mx));
      label.setAttribute("y", String(my));
      this.group.appendChild(label);
    }
    // 节点
    for (const n of this.model.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const g = svgEl("g");
      g.setAttribute("class", "kg-gn" + (n.role === "question" ? " kg-gn-question" : ""));
      g.setAttribute("data-id", n.id);
      g.setAttribute("data-path", n.path);
      g.setAttribute("tabindex", "0");
      const rect = svgEl("rect");
      rect.setAttribute("x", String(p.x - NODE_W / 2));
      rect.setAttribute("y", String(p.y - NODE_H / 2));
      rect.setAttribute("width", String(NODE_W));
      rect.setAttribute("height", String(NODE_H));
      rect.setAttribute("rx", "7");
      g.appendChild(rect);
      const text = svgEl("text");
      text.setAttribute("class", "kg-gn-label");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.textContent = truncate(n.label, 13);
      text.setAttribute("x", String(p.x));
      text.setAttribute("y", String(p.y));
      g.appendChild(text);
      this.group.appendChild(g);
    }
  }

  private drawEdgeLine(e: GraphEdge, from: { x: number; y: number }, to: { x: number; y: number }, isBack: boolean): SVGElement {
    const line = svgEl("path");
    line.setAttribute("class", "kg-ge" + (isBack ? " kg-ge-back" : ""));
    line.setAttribute("data-edge", e.id);
    const x1 = from.x + (to.x >= from.x ? NODE_W / 2 - 2 : -NODE_W / 2 + 2);
    const y1 = from.y;
    const x2 = to.x + (to.x >= from.x ? -NODE_W / 2 + 2 : NODE_W / 2 - 2);
    const y2 = to.y;
    if (!isBack) {
      line.setAttribute("d", "M" + x1 + "," + y1 + " L" + x2 + "," + y2);
    } else {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const off = x1 === x2 ? 30 : Math.abs(x2 - x1) < 40 ? 26 : 22;
      line.setAttribute("d", "M" + x1 + "," + y1 + " C" + mx + "," + (my - off) + " " + mx + "," + (my + off) + " " + x2 + "," + y2);
    }
    if (e.direction === "bidirectional") {
      line.setAttribute("marker-start", "url(#" + this.defsId + "-start)");
    }
    if (e.direction === "forward" || e.direction === "bidirectional") {
      line.setAttribute("marker-end", "url(#" + this.defsId + "-end)");
    }
    const ev = e.evidence || [];
    // §57：user_confirmed / wikilink 用实线；AI 推断（或无证据）用虚线
    if (!ev.includes("user_confirmed") && !ev.includes("wikilink")) {
      line.setAttribute("stroke-dasharray", "5 4");
    }
    if (ev.includes("user_confirmed")) {
      line.setAttribute("data-evidence", "user_confirmed");
    }
    
    return line;
  }

  // ---------- 交互 ----------

  private bindEvents(container: HTMLElement): void {
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const { w, h } = this.viewSize();
        const rect = this.svg.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
        this.tx = mx - ((mx - this.tx) / this.scale) * ns;
        this.ty = my - ((my - this.ty) / this.scale) * ns;
        this.scale = ns;
        this.applyTransform();
      } else {
        this.ty -= ev.deltaY;
        this.applyTransform();
      }
    };
    this.svg.addEventListener("wheel", onWheel, { passive: false });
    this.cleanup.push(() => this.svg.removeEventListener("wheel", onWheel));

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const target = ev.target as Element;
      if (target.closest && target.closest(".kg-gn")) return; // 节点交给 click，不拖动
      this.dragging = true;
      this.dragId = ev.pointerId;
      this.dragStartX = ev.clientX;
      this.dragStartY = ev.clientY;
      this.dragTx = this.tx;
      this.dragTy = this.ty;
      this.svg.setPointerCapture(ev.pointerId);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!this.dragging || ev.pointerId !== this.dragId) return;
      this.tx = this.dragTx + (ev.clientX - this.dragStartX);
      this.ty = this.dragTy + (ev.clientY - this.dragStartY);
      this.applyTransform();
    };
    const endDrag = (ev: PointerEvent) => {
      if (!this.dragging || ev.pointerId !== this.dragId) return;
      this.dragging = false;
      try { this.svg.releasePointerCapture(ev.pointerId); } catch { /* 忽略 */ }
    };
    this.svg.addEventListener("pointerdown", onPointerDown);
    this.svg.addEventListener("pointermove", onPointerMove);
    this.svg.addEventListener("pointerup", endDrag);
    this.svg.addEventListener("pointercancel", endDrag);
    this.cleanup.push(() => {
      this.svg.removeEventListener("pointerdown", onPointerDown);
      this.svg.removeEventListener("pointermove", onPointerMove);
      this.svg.removeEventListener("pointerup", endDrag);
      this.svg.removeEventListener("pointercancel", endDrag);
    });

    const onClick = (ev: MouseEvent) => {
      const target = ev.target as Element;
      const nodeEl = target.closest ? target.closest(".kg-gn") : null;
      if (nodeEl) {
        const id = nodeEl.getAttribute("data-id") || "";
        const path = nodeEl.getAttribute("data-path") || "";
        this.selectNode(id);
        if (path) this.cb.onOpenNote(path); // 点击节点打开真实笔记（§39/Test 2）
        return;
      }
      this.clearHighlight(); // 点击空白恢复
    };
    this.svg.addEventListener("click", onClick);
    this.cleanup.push(() => this.svg.removeEventListener("click", onClick));

    const onOver = (ev: MouseEvent) => {
      const target = ev.target as Element;
      const nodeEl = target.closest ? target.closest(".kg-gn") : null;
      if (nodeEl) {
        const node = this.model.nodes.find((n) => n.id === (nodeEl.getAttribute("data-id") || ""));
        if (node) {
          this.showTip(node.label, node.reason || "（AI 未给出具体理由）", ev);
        }
        return;
      }
      const edgeEl = target.closest ? target.closest(".kg-ge") : null;
      if (edgeEl) {
        const edge = this.model.edges.find((e) => e.id === (edgeEl.getAttribute("data-edge") || ""));
        if (edge) {
          const from = this.model.nodes.find((n) => n.id === edge.from);
          const to = this.model.nodes.find((n) => n.id === edge.to);
          const head = edge.relation + "：" + (from ? from.label : edge.from) + " → " + (to ? to.label : edge.to);
          this.showTip(head, edge.reason || "（AI 未给出具体理由）", ev);
        }
        return;
      }
      this.hideTip();
    };
    const onOut = (ev: MouseEvent) => {
      const related = ev.relatedTarget as Element | null;
      if (related && related.closest && (related.closest(".kg-gn") || related.closest(".kg-ge"))) return;
      this.hideTip();
    };
    this.svg.addEventListener("mouseover", onOver);
    this.svg.addEventListener("mouseout", onOut);
    this.cleanup.push(() => {
      this.svg.removeEventListener("mouseover", onOver);
      this.svg.removeEventListener("mouseout", onOut);
    });
  }

  private showTip(head: string, body: string, ev: MouseEvent): void {
    this.tip.empty?.();
    while (this.tip.firstChild) this.tip.removeChild(this.tip.firstChild);
    const h = document.createElement("div");
    h.className = "kg-graph-tip-head";
    h.textContent = head;
    const b = document.createElement("div");
    b.className = "kg-graph-tip-body";
    b.textContent = body;
    this.tip.appendChild(h);
    this.tip.appendChild(b);
    const rect = this.svg.getBoundingClientRect();
    this.tip.style.left = Math.min(ev.clientX - rect.left + 14, rect.width - 220) + "px";
    this.tip.style.top = Math.min(ev.clientY - rect.top + 14, rect.height - 90) + "px";
    this.tip.style.display = "block";
  }

  private hideTip(): void {
    this.tip.style.display = "none";
  }

  /** §20/Test 5：点击节点 → 根到该节点的路径高亮，其余降透明 */
  private selectNode(id: string): void {
    this.selected = id;
    const chain: string[] = [id];
    let cur = id;
    const maxGuard = this.model.nodes.length + 1;
    for (let i = 0; i < maxGuard; i++) {
      const p = this.layout.parentOf[cur];
      if (!p) break;
      chain.unshift(p);
      cur = p;
    }
    const inPath = new Set(chain);
    const pathPairs = new Set<string>();
    for (let i = 0; i + 1 < chain.length; i++) {
      pathPairs.add(chain[i] + "|" + chain[i + 1]);
      pathPairs.add(chain[i + 1] + "|" + chain[i]);
    }
    for (const g of Array.from(this.group.querySelectorAll(".kg-gn"))) {
      const nid = g.getAttribute("data-id") || "";
      g.classList.remove("kg-gn-sel", "kg-gn-path", "kg-gn-dim");
      if (nid === id) g.classList.add("kg-gn-sel");
      else if (inPath.has(nid)) g.classList.add("kg-gn-path");
      else g.classList.add("kg-gn-dim");
    }
    for (const g of Array.from(this.group.querySelectorAll(".kg-ge"))) {
      const eid = g.getAttribute("data-edge") || "";
      g.classList.remove("kg-ge-path", "kg-ge-linked", "kg-ge-dim");
      const e = this.model.edges.find((x) => x.id === eid);
      if (!e) continue;
      if (pathPairs.has(e.from + "|" + e.to) || pathPairs.has(e.to + "|" + e.from)) {
        g.classList.add("kg-ge-path");
      } else if (e.from === id || e.to === id) {
        g.classList.add("kg-ge-linked");
      } else {
        g.classList.add("kg-ge-dim");
      }
      const label = g.nextElementSibling;
      if (label && label.classList.contains("kg-graph-el")) {
        label.classList.remove("kg-graph-el-dim");
        if (!g.classList.contains("kg-ge-dim")) label.classList.add("kg-graph-el-dim");
      }
    }
  }

  private clearHighlight(): void {
    this.selected = null;
    for (const g of Array.from(this.group.querySelectorAll(".kg-gn"))) {
      g.classList.remove("kg-gn-sel", "kg-gn-path", "kg-gn-dim");
    }
    for (const g of Array.from(this.group.querySelectorAll(".kg-ge"))) {
      g.classList.remove("kg-ge-path", "kg-ge-linked", "kg-ge-dim");
      const label = g.nextElementSibling;
      if (label && label.classList.contains("kg-graph-el")) label.classList.remove("kg-graph-el-dim");
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const fn of this.cleanup) {
      try { fn(); } catch { /* 忽略 */ }
    }
    this.cleanup = [];
    if (this.resizeObs) this.resizeObs.disconnect();
    this.svg.remove();
    this.tip.remove();
  }
}
