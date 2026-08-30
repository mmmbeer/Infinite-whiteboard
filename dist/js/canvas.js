import { $, $$, boundsOf, clamp, rectsIntersect } from "./utils.js";
import { state, commit, snapshot } from "./state.js";
import { renderNodes, bindNodeInteractions, updateNodeFrame } from "./nodes.js";
import { bindEdgeInteractions, createEdge, getAnchorPoint, getClosestAnchor, renderEdges } from "./connections.js";
import { bindGroupInteractions, renderGroups, updateGroupBounds } from "./groups.js";
import { bindAxisInteractions, renderAxes } from "./axes.js";

export function visibleWorldBounds(view, rect) {
  return { x: -view.x / view.zoom, y: -view.y / view.zoom, w: rect.width / view.zoom, h: rect.height / view.zoom };
}

export function minimapBounds(items, visible) {
  const raw = boundsOf([...items, visible]);
  const padding = Math.max(20, Math.max(raw.w, raw.h) * .05);
  return { x: raw.x - padding, y: raw.y - padding, w: raw.w + padding * 2, h: raw.h + padding * 2 };
}

export function minimapLayout(bounds, width = 142, height = 86) {
  const inset = { left: 6, top: 14, right: 6, bottom: 6 };
  const innerWidth = Math.max(1, width - inset.left - inset.right);
  const innerHeight = Math.max(1, height - inset.top - inset.bottom);
  const scale = Math.min(innerWidth / bounds.w, innerHeight / bounds.h);
  return {
    scale,
    x: inset.left + (innerWidth - bounds.w * scale) / 2,
    y: inset.top + (innerHeight - bounds.h * scale) / 2,
  };
}

export class InfiniteCanvas {
  constructor({ onSelection, onCreate, onCapture, onEditNode }) {
    this.viewport = $("#viewport"); this.world = $("#world");
    this.nodesLayer = $("#nodes-layer"); this.edgesLayer = $("#edges-layer");
    this.groupsLayer = $("#groups-layer"); this.axesLayer = $("#axes-layer");
    this.selectionBox = $("#selection-box"); this.captureBox = $("#capture-box");
    this.onSelection = onSelection; this.onCreate = onCreate; this.onCapture = onCapture; this.onEditNode = onEditNode;
    this.preview = null; this.drag = null; this.longPress = null;
    this.liveFrame = null; this.minimapFrame = null;
    this.liveNodeIds = new Set(); this.liveGroups = new Set(); this.liveAxes = new Set();
  }

  init() {
    bindNodeInteractions(this.nodesLayer, {
      startConnection: (...args) => this.startConnection(...args),
      screenToWorld: (point) => this.screenToWorld(point), refreshSelection: () => this.refreshSelection(),
      refresh: (reason) => this.refresh(reason), editNode: (node) => this.onEditNode(node),
      beginLiveTransform: (nodes) => this.beginLiveTransform(nodes),
      queueLiveNodes: (nodes) => this.queueLiveNodes(nodes),
      finishLiveTransform: (reason) => this.finishLiveTransform(reason),
      shouldPan: (event) => this.shouldPan(event),
    });
    bindEdgeInteractions(this.edgesLayer, () => this.refreshSelection(), (event) => this.shouldPan(event));
    bindGroupInteractions(this.groupsLayer, () => this.refreshSelection(), (event) => this.shouldPan(event));
    bindAxisInteractions(this.axesLayer, () => this.refreshSelection(), (event) => this.shouldPan(event));
    this.viewport.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.viewport.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    this.viewport.addEventListener("dblclick", (event) => this.doubleClick(event));
    this.viewport.addEventListener("contextmenu", (event) => { event.preventDefault(); if (!event.target.closest(".board-node,.group-box,.axis")) this.onCreate(this.screenToWorld({ x: event.clientX, y: event.clientY })); });
    this.viewport.addEventListener("pointercancel", () => this.cancelDrag());
    this.applyTransform(); this.refresh("init");
  }

  screenToWorld(point) {
    const rect = this.viewport.getBoundingClientRect(); const view = state.board.viewport;
    return { x: (point.x - rect.left - view.x) / view.zoom, y: (point.y - rect.top - view.y) / view.zoom };
  }
  worldToScreen(point) {
    const rect = this.viewport.getBoundingClientRect(); const view = state.board.viewport;
    return { x: rect.left + view.x + point.x * view.zoom, y: rect.top + view.y + point.y * view.zoom };
  }
  applyTransform() {
    const view = state.board.viewport;
    this.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    $("#zoom-value").textContent = `${Math.round(view.zoom * 100)}%`;
    this.queueMinimapUpdate();
  }
  async refresh(reason = "render") {
    if (["move", "transform-live", "transform"].includes(reason)) state.board.groups.forEach((group) => updateGroupBounds(group.id));
    if (reason === "selection") {
      this.syncSelection();
      renderEdges(this.edgesLayer, this.preview);
      this.onSelection?.();
      return;
    }
    renderGroups(this.groupsLayer); renderAxes(this.axesLayer); renderEdges(this.edgesLayer, this.preview);
    await renderNodes(this.nodesLayer); this.world.classList.toggle("connect-mode", state.tool === "connect");
    this.queueMinimapUpdate(); if (!["inspector-live", "transform-live"].includes(reason)) this.onSelection?.();
  }
  refreshSelection() { this.refresh("selection"); }

  syncSelection() {
    this.nodesLayer.querySelectorAll(".board-node").forEach((element) => element.classList.toggle("selected", state.selected.has(element.dataset.id)));
    this.groupsLayer.querySelectorAll(".group-box").forEach((element) => element.classList.toggle("selected", state.selected.has(element.dataset.id)));
    this.axesLayer.querySelectorAll(".axis").forEach((element) => element.classList.toggle("selected", state.selected.has(element.dataset.id)));
  }

  beginLiveTransform(nodes = []) {
    nodes.forEach((node) => this.nodesLayer.querySelector(`[data-id="${node.id}"]`)?.classList.add("is-dragging"));
  }

  queueLiveNodes(nodes = []) {
    nodes.forEach((node) => {
      this.liveNodeIds.add(node.id);
      if (node.groupId) this.liveGroups.add(node.groupId);
    });
    this.queueLiveFrame();
  }

  queueLiveItem(item, members = []) {
    if (state.board.groups.includes(item)) this.liveGroups.add(item.id);
    if (state.board.axes.includes(item)) this.liveAxes.add(item.id);
    members.forEach((node) => this.liveNodeIds.add(node.id));
    this.queueLiveFrame();
  }

  queueLiveFrame() {
    if (this.liveFrame) return;
    this.liveFrame = requestAnimationFrame(() => this.flushLiveFrame());
  }

  flushLiveFrame() {
    this.liveFrame = null;
    this.liveNodeIds.forEach((id) => {
      const node = state.board.nodes.find((item) => item.id === id);
      updateNodeFrame(this.nodesLayer.querySelector(`[data-id="${id}"]`), node);
    });
    this.liveGroups.forEach((id) => {
      updateGroupBounds(id);
      const group = state.board.groups.find((item) => item.id === id);
      const element = this.groupsLayer.querySelector(`[data-id="${id}"]`);
      if (group && element) Object.assign(element.style, { left: `${group.x}px`, top: `${group.y}px`, width: `${group.w}px`, height: `${group.h}px` });
    });
    this.liveAxes.forEach((id) => {
      const axis = state.board.axes.find((item) => item.id === id);
      const element = this.axesLayer.querySelector(`[data-id="${id}"]`);
      if (axis && element) Object.assign(element.style, { left: `${axis.x}px`, top: `${axis.y}px` });
    });
    if (this.liveNodeIds.size) renderEdges(this.edgesLayer, this.preview);
    this.liveNodeIds.clear(); this.liveGroups.clear(); this.liveAxes.clear();
  }

  finishLiveTransform(reason) {
    if (this.liveFrame) { cancelAnimationFrame(this.liveFrame); this.liveFrame = null; }
    this.flushLiveFrame();
    this.nodesLayer.querySelectorAll(".is-dragging").forEach((element) => element.classList.remove("is-dragging"));
    this.refresh(reason);
  }

  setTool(tool) {
    state.tool = tool; $$(".tool").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    this.world.classList.toggle("connect-mode", tool === "connect");
    this.viewport.style.cursor = tool === "hand" ? "grab" : tool === "capture" ? "crosshair" : "default";
  }

  pointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target.closest(".create-fab,.zoom-controls")) return;
    if (this.shouldPan(event)) return this.startPan(event);
    const interactive = event.target.closest(".board-node,.anchor,.edge-hit,.group-box,.axis,.create-fab,.zoom-controls");
    if (event.target.closest(".group-box,.axis") && state.tool === "select") return this.startItemDrag(event);
    if (interactive) return;
    if (state.tool === "capture") return this.startCapture(event);
    this.startLongPress(event);
    this.startSelection(event);
  }

  shouldPan(event) { return state.tool === "hand" || event.button === 1 || event.altKey || this.spaceDown; }

  startPan(event) {
    event.preventDefault(); const view = state.board.viewport; const origin = { x: view.x, y: view.y, cx: event.clientX, cy: event.clientY };
    this.viewport.style.cursor = "grabbing";
    const move = (e) => { view.x = origin.x + e.clientX - origin.cx; view.y = origin.y + e.clientY - origin.cy; this.applyTransform(); };
    const up = () => { document.removeEventListener("pointermove", move); this.viewport.style.cursor = state.tool === "hand" ? "grab" : "default"; commit("viewport", false); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up, { once: true });
  }

  startSelection(event) {
    const start = { x: event.clientX, y: event.clientY }; let moved = false;
    if (!event.shiftKey) { state.selected.clear(); state.selectedEdge = null; this.refreshSelection(); }
    const move = (e) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      moved = true; this.cancelLongPress();
      const rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      Object.assign(this.selectionBox.style, { left: `${rect.x}px`, top: `${rect.y - this.viewport.getBoundingClientRect().top}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      this.selectionBox.classList.remove("hidden");
      const a = this.screenToWorld({ x: rect.x, y: rect.y }); const b = this.screenToWorld({ x: rect.x + rect.w, y: rect.y + rect.h });
      state.selected.clear();
      state.board.nodes.filter((node) => rectsIntersect({ x: node.x, y: node.y, w: node.w, h: node.h }, { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y })).forEach((node) => state.selected.add(node.id));
      this.syncSelection();
    };
    const up = () => { document.removeEventListener("pointermove", move); this.selectionBox.classList.add("hidden"); this.cancelLongPress(); this.refreshSelection(); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up, { once: true });
  }

  startItemDrag(event) {
    const id = event.target.closest("[data-id]").dataset.id;
    const group = state.board.groups.find((entry) => entry.id === id);
    const item = group || state.board.axes.find((entry) => entry.id === id);
    if (!item) return; event.preventDefault(); snapshot();
    const start = this.screenToWorld({ x: event.clientX, y: event.clientY }); const origin = { x: item.x, y: item.y };
    const members = group ? state.board.nodes.filter((node) => node.groupId === group.id) : [];
    const memberOrigins = new Map(members.map((node) => [node.id, { x: node.x, y: node.y }]));
    this.beginLiveTransform(members);
    const move = (e) => { const point = this.screenToWorld({ x: e.clientX, y: e.clientY }); const dx = point.x - start.x; const dy = point.y - start.y; item.x = origin.x + dx; item.y = origin.y + dy; members.forEach((node) => { const base = memberOrigins.get(node.id); node.x = base.x + dx; node.y = base.y + dy; }); this.queueLiveItem(item, members); };
    const up = () => { document.removeEventListener("pointermove", move); commit("move-item", false); this.finishLiveTransform(group ? "move" : "move-item"); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up, { once: true });
  }

  startConnection(event, nodeId, anchor) {
    event.preventDefault(); event.stopPropagation(); const start = getAnchorPoint(nodeId, anchor);
    const move = (e) => {
      const point = this.screenToWorld({ x: e.clientX, y: e.clientY });
      const targetElement = document.elementFromPoint(e.clientX, e.clientY)?.closest(".board-node");
      const targetId = targetElement?.dataset.id;
      const snap = targetId && targetId !== nodeId ? getClosestAnchor(targetId, point) : null;
      this.setConnectionSnap(snap ? { nodeId: targetId, anchor: snap.anchor } : null);
      this.preview = { start, end: snap?.point || point, anchor, toAnchor: snap?.anchor || "w" };
      renderEdges(this.edgesLayer, this.preview);
    };
    const up = () => {
      document.removeEventListener("pointermove", move); this.preview = null;
      if (this.connectionSnap) createEdge(nodeId, this.connectionSnap.nodeId, anchor, this.connectionSnap.anchor);
      this.setConnectionSnap(null);
      this.refresh("connection");
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up, { once: true });
  }

  setConnectionSnap(target) {
    this.nodesLayer.querySelectorAll(".connection-target,.snap-target").forEach((element) => element.classList.remove("connection-target", "snap-target"));
    this.connectionSnap = target;
    if (!target) return;
    const node = this.nodesLayer.querySelector(`[data-id="${target.nodeId}"]`); node?.classList.add("connection-target");
    node?.querySelector(`[data-anchor="${target.anchor}"]`)?.classList.add("snap-target");
  }

  startCapture(event) {
    const start = { x: event.clientX, y: event.clientY }; const viewportTop = this.viewport.getBoundingClientRect().top;
    const move = (e) => {
      const rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      Object.assign(this.captureBox.style, { left: `${rect.x}px`, top: `${rect.y - viewportTop}px`, width: `${rect.w}px`, height: `${rect.h}px` }); this.captureBox.classList.remove("hidden");
    };
    const up = (e) => { document.removeEventListener("pointermove", move); this.captureBox.classList.add("hidden"); const a = this.screenToWorld(start); const b = this.screenToWorld({ x: e.clientX, y: e.clientY }); this.onCapture({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }); this.setTool("select"); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up, { once: true });
  }

  wheel(event) {
    event.preventDefault();
    if (event.shiftKey && !event.ctrlKey && !event.metaKey) { state.board.viewport.x -= event.deltaY; this.applyTransform(); return; }
    const point = this.screenToWorld({ x: event.clientX, y: event.clientY }); const view = state.board.viewport;
    const next = clamp(view.zoom * Math.exp(-event.deltaY * .0014), .12, 4);
    const rect = this.viewport.getBoundingClientRect(); view.x = event.clientX - rect.left - point.x * next; view.y = event.clientY - rect.top - point.y * next; view.zoom = next; this.applyTransform();
  }
  zoomBy(factor) { const rect = this.viewport.getBoundingClientRect(); const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; const point = this.screenToWorld(center); const view = state.board.viewport; view.zoom = clamp(view.zoom * factor, .12, 4); view.x = rect.width / 2 - point.x * view.zoom; view.y = rect.height / 2 - point.y * view.zoom; this.applyTransform(); commit("viewport", false); }
  resetZoom() { state.board.viewport.zoom = 1; this.applyTransform(); commit("viewport", false); }
  fitBoard() { const items = [...state.board.nodes, ...state.board.groups]; const bounds = boundsOf(items, 90); const rect = this.viewport.getBoundingClientRect(); const zoom = clamp(Math.min(rect.width / bounds.w, rect.height / bounds.h), .12, 1.5); state.board.viewport = { zoom, x: (rect.width - bounds.w * zoom) / 2 - bounds.x * zoom, y: (rect.height - bounds.h * zoom) / 2 - bounds.y * zoom }; this.applyTransform(); commit("viewport", false); }
  doubleClick(event) { if (!event.target.closest(".board-node,.group-box,.axis")) this.onCreate(this.screenToWorld({ x: event.clientX, y: event.clientY })); }
  startLongPress(event) { this.cancelLongPress(); const point = this.screenToWorld({ x: event.clientX, y: event.clientY }); this.longPress = setTimeout(() => this.onCreate(point), 620); }
  cancelLongPress() { clearTimeout(this.longPress); this.longPress = null; }
  cancelDrag() { this.cancelLongPress(); this.selectionBox.classList.add("hidden"); this.captureBox.classList.add("hidden"); }
  setSpace(value) { this.spaceDown = value; this.viewport.style.cursor = value ? "grab" : state.tool === "hand" ? "grab" : "default"; }
  viewportCenter() { const rect = this.viewport.getBoundingClientRect(); return this.screenToWorld({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }); }

  queueMinimapUpdate() {
    if (this.minimapFrame) return;
    this.minimapFrame = requestAnimationFrame(() => { this.minimapFrame = null; this.updateMinimap(); });
  }

  minimapItems() {
    const axes = state.board.axes.map((axis) => ({
      ...axis,
      w: axis.orientation === "x" ? axis.length : 1,
      h: axis.orientation === "y" ? axis.length : 1,
      minimapType: "axis",
    }));
    return [
      ...state.board.groups.map((item) => ({ ...item, minimapType: "group" })),
      ...state.board.nodes.map((item) => ({ ...item, minimapType: "node" })),
      ...axes,
    ];
  }

  updateMinimap() {
    const map = $("#minimap"); if (!map) return;
    const rect = this.viewport.getBoundingClientRect(); const visible = visibleWorldBounds(state.board.viewport, rect);
    const items = this.minimapItems(); const bounds = minimapBounds(items, visible);
    const layout = minimapLayout(bounds, map.clientWidth || 142, map.clientHeight || 86);
    const existing = new Map([...map.querySelectorAll("[data-minimap-id]")].map((element) => [element.dataset.minimapId, element]));
    items.forEach((item) => {
      let element = existing.get(item.id);
      if (!element) { element = document.createElement("i"); element.dataset.minimapId = item.id; map.append(element); }
      element.className = `minimap-${item.minimapType}`;
      this.placeMinimapItem(element, item, bounds, layout);
      existing.delete(item.id);
    });
    existing.forEach((element) => element.remove());
    this.placeMinimapItem($("#minimap-window"), visible, bounds, layout);
  }

  placeMinimapItem(element, item, bounds, layout) {
    const x = layout.x + (item.x - bounds.x) * layout.scale;
    const y = layout.y + (item.y - bounds.y) * layout.scale;
    Object.assign(element.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${Math.max(2, item.w * layout.scale)}px`,
      height: `${Math.max(2, item.h * layout.scale)}px`,
    });
  }
}
