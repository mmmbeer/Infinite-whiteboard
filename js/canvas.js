import { $, $$, boundsOf, clamp, rectsIntersect } from "./utils.js";
import { state, commit, snapshot } from "./state.js";
import { renderNodes, bindNodeInteractions, updateNodeFrame } from "./nodes.js";
import { bindEdgeInteractions, createEdge, getAnchorPoint, getClosestAnchor, renderEdges } from "./connections.js";
import { bindGroupInteractions, renderGroups, updateGroupBounds } from "./groups.js";
import { bindAxisInteractions, renderAxes } from "./axes.js";
import { snapAdjustment, selectionBounds } from "./arrange.js";
import { ancestorGroups, isEffectivelyHidden, isEffectivelyLocked, movableItemsForSelection, topLevelSelection } from "./item-tree.js";
import { reflowAxis } from "./axis-bindings.js";

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
  constructor({ onSelection, onCreate, onCapture, onEditNode, onContext }) {
    this.viewport = $("#viewport"); this.world = $("#world");
    this.nodesLayer = $("#nodes-layer"); this.edgesLayer = $("#edges-layer");
    this.groupsLayer = $("#groups-layer"); this.axesLayer = $("#axes-layer");
    this.guidesLayer = $("#guides-layer");
    this.selectionBox = $("#selection-box"); this.captureBox = $("#capture-box");
    this.onSelection = onSelection; this.onCreate = onCreate; this.onCapture = onCapture; this.onEditNode = onEditNode; this.onContext = onContext;
    this.preview = null; this.drag = null; this.longPress = null;
    this.liveFrame = null; this.minimapFrame = null;
    this.liveNodeIds = new Set(); this.liveGroups = new Set(); this.liveAxes = new Set();
    this.touchPoints = new Map(); this.pinch = null; this.touchGestureActive = false;
  }

  init() {
    bindNodeInteractions(this.nodesLayer, {
      startConnection: (...args) => this.startConnection(...args),
      screenToWorld: (point) => this.screenToWorld(point), refreshSelection: () => this.refreshSelection(),
      refresh: (reason) => this.refresh(reason), editNode: (node) => this.onEditNode(node),
      beginLiveTransform: (nodes) => this.beginLiveTransform(nodes),
      queueLiveNodes: (nodes) => this.queueLiveNodes(nodes),
      queueLiveItem: (item, members) => this.queueLiveItem(item, members),
      finishLiveTransform: (reason) => this.finishLiveTransform(reason),
      shouldPan: (event) => this.shouldPan(event),
      isGesturing: () => this.isGesturing(),
    });
    bindEdgeInteractions(this.edgesLayer, () => this.refreshSelection(), (event) => this.shouldPan(event));
    bindGroupInteractions(this.groupsLayer, {
      screenToWorld: (point) => this.screenToWorld(point), refreshSelection: () => this.refreshSelection(),
      refresh: (reason) => this.refresh(reason), queueLiveItem: (item, members) => this.queueLiveItem(item, members),
      finishLiveTransform: (reason) => this.finishLiveTransform(reason), shouldPan: (event) => this.shouldPan(event),
      isGesturing: () => this.isGesturing(),
    });
    bindAxisInteractions(this.axesLayer, () => this.refreshSelection(), (event) => this.shouldPan(event));
    this.viewport.addEventListener("pointerdown", (event) => this.trackTouchStart(event), true);
    this.viewport.addEventListener("pointermove", (event) => this.trackTouchMove(event), true);
    this.viewport.addEventListener("pointerup", (event) => this.trackTouchEnd(event), true);
    this.viewport.addEventListener("pointercancel", (event) => this.trackTouchEnd(event), true);
    this.viewport.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.viewport.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    this.viewport.addEventListener("dblclick", (event) => this.doubleClick(event));
    this.viewport.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const target = this.contextTarget(event.target);
      if (target) this.onContext?.({ ...target, x: event.clientX, y: event.clientY, point: this.screenToWorld({ x: event.clientX, y: event.clientY }) });
      else this.onCreate(this.screenToWorld({ x: event.clientX, y: event.clientY }));
    });
    this.viewport.addEventListener("pointercancel", () => this.cancelDrag());
    this.bindMinimap();
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
    if (reason !== "selection") [...state.board.groups].sort((a, b) => ancestorGroups(b.parentId).length - ancestorGroups(a.parentId).length).forEach((group) => updateGroupBounds(group.id));
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

  showGuides(guides = []) {
    if (!this.guidesLayer) return;
    this.guidesLayer.innerHTML = guides.map((guide) => `<i class="alignment-guide ${guide.axis} ${guide.kind || "item"}" style="${guide.axis === "x" ? "left" : "top"}:${guide.value}px"></i>`).join("");
  }

  beginLiveTransform(nodes = []) {
    nodes.forEach((node) => this.nodesLayer.querySelector(`[data-id="${node.id}"]`)?.classList.add("is-dragging"));
  }

  queueLiveNodes(nodes = []) {
    nodes.forEach((node) => {
      this.liveNodeIds.add(node.id);
      if (node.groupId) { this.liveGroups.add(node.groupId); ancestorGroups(node.groupId).forEach((group) => this.liveGroups.add(group.id)); }
    });
    this.queueLiveFrame();
  }

  queueLiveItem(item, members = []) {
    if (state.board.groups.includes(item)) { this.liveGroups.add(item.id); ancestorGroups(item.parentId).forEach((group) => this.liveGroups.add(group.id)); }
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
    if (this.isGesturing()) return;
    if (this.shouldPan(event)) return this.startPan(event);
    const interactive = event.target.closest(".board-node,.anchor,.edge-hit,.group-box,.axis,.create-fab,.zoom-controls,.minimap");
    if (interactive && event.pointerType === "touch") {
      const target = this.contextTarget(interactive);
      if (target) this.startLongPress(event, () => this.onContext?.({ ...target, x: event.clientX, y: event.clientY, point: this.screenToWorld({ x: event.clientX, y: event.clientY }) }));
    }
    if (event.target.closest(".group-box,.axis") && state.tool === "select") return this.startItemDrag(event);
    if (interactive) return;
    if (state.tool === "capture") return this.startCapture(event);
    this.startLongPress(event, () => this.onCreate(this.screenToWorld({ x: event.clientX, y: event.clientY })));
    this.startSelection(event);
  }

  shouldPan(event) { return this.isGesturing() || state.tool === "hand" || event.button === 1 || event.altKey || this.spaceDown; }

  startPan(event) {
    event.preventDefault(); const view = state.board.viewport; const origin = { x: view.x, y: view.y, cx: event.clientX, cy: event.clientY };
    this.viewport.style.cursor = "grabbing";
    const move = (e) => { if (e.pointerId !== event.pointerId || this.isGesturing()) return; view.x = origin.x + e.clientX - origin.cx; view.y = origin.y + e.clientY - origin.cy; this.applyTransform(); };
    const up = (e) => { if (e.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); this.viewport.style.cursor = state.tool === "hand" ? "grab" : "default"; commit("viewport", false); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  startSelection(event) {
    const start = { x: event.clientX, y: event.clientY }; let moved = false;
    const toggle = event.ctrlKey || event.metaKey || state.tool === "multi"; const additive = event.shiftKey;
    const initial = new Set(state.selected);
    if (!toggle && !additive) { state.selected.clear(); state.selectedEdge = null; this.refreshSelection(); }
    const move = (e) => {
      if (e.pointerId !== event.pointerId || this.isGesturing()) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      moved = true; this.cancelLongPress();
      const rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      Object.assign(this.selectionBox.style, { left: `${rect.x}px`, top: `${rect.y - this.viewport.getBoundingClientRect().top}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      this.selectionBox.classList.remove("hidden");
      const a = this.screenToWorld({ x: rect.x, y: rect.y }); const b = this.screenToWorld({ x: rect.x + rect.w, y: rect.y + rect.h });
      const selectionRect = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      const axes = state.board.axes.map((axis) => ({ ...axis, w: axis.orientation === "x" ? axis.length : 12, h: axis.orientation === "y" ? axis.length : 12 }));
      const hits = [...state.board.nodes, ...state.board.groups, ...axes].filter((item) => !isEffectivelyHidden(item) && !isEffectivelyLocked(item) && rectsIntersect({ x: item.x, y: item.y, w: item.w, h: item.h }, selectionRect)).map((item) => item.id);
      state.selected = new Set(initial);
      if (!toggle && !additive) state.selected.clear();
      hits.forEach((id) => { if (toggle && initial.has(id)) state.selected.delete(id); else state.selected.add(id); });
      this.syncSelection();
    };
    const up = (e) => { if (e.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); this.selectionBox.classList.add("hidden"); this.cancelLongPress(); this.refreshSelection(); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  startItemDrag(event) {
    const id = event.target.closest("[data-id]").dataset.id;
    if (!state.selected.has(id)) return;
    const group = state.board.groups.find((entry) => entry.id === id);
    const item = group || state.board.axes.find((entry) => entry.id === id);
    if (!item || isEffectivelyLocked(item)) return; event.preventDefault(); snapshot();
    const start = this.screenToWorld({ x: event.clientX, y: event.clientY });
    const topItems = topLevelSelection().filter((entry) => !isEffectivelyLocked(entry));
    const movers = movableItemsForSelection();
    if (state.board.axes.includes(item)) state.board.nodes.filter((node) => node.axisBinding?.axisId === item.id && !isEffectivelyLocked(node)).forEach((node) => { if (!movers.includes(node)) movers.push(node); });
    const origins = new Map(movers.map((entry) => [entry.id, { x: entry.x, y: entry.y }]));
    const movingNodes = movers.filter((entry) => state.board.nodes.includes(entry)); this.beginLiveTransform(movingNodes);
    const move = (e) => {
      if (e.pointerId !== event.pointerId || this.isGesturing()) return;
      const point = this.screenToWorld({ x: e.clientX, y: e.clientY }); const rawDx = point.x - start.x; const rawDy = point.y - start.y;
      const snapped = snapAdjustment(topItems, rawDx, rawDy, { zoom: state.board.viewport.zoom, disable: e.altKey });
      movers.forEach((entry) => { const origin = origins.get(entry.id); entry.x = origin.x + snapped.dx; entry.y = origin.y + snapped.dy; });
      this.showGuides(snapped.guides); topItems.forEach((entry) => this.queueLiveItem(entry, movingNodes));
    };
    const up = (e) => { if (e.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); this.showGuides([]); movingNodes.filter((node) => node.axisBinding && !state.selected.has(node.axisBinding.axisId)).forEach((node) => { node.axisBinding = null; }); state.board.axes.filter((axis) => state.selected.has(axis.id)).forEach((axis) => reflowAxis(axis.id)); commit("move-item", false); this.finishLiveTransform(group ? "move" : "move-item"); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  }

  startConnection(event, nodeId, anchor) {
    event.preventDefault(); event.stopPropagation(); const start = getAnchorPoint(nodeId, anchor);
    const move = (e) => {
      if (e.pointerId !== event.pointerId || this.isGesturing()) return;
      const point = this.screenToWorld({ x: e.clientX, y: e.clientY });
      const targetElement = document.elementFromPoint(e.clientX, e.clientY)?.closest(".board-node");
      const targetId = targetElement?.dataset.id;
      const targetNode = targetId ? state.board.nodes.find((node) => node.id === targetId) : null;
      const snap = targetId && targetId !== nodeId && !isEffectivelyLocked(targetNode) ? getClosestAnchor(targetId, point) : null;
      this.setConnectionSnap(snap ? { nodeId: targetId, anchor: snap.anchor } : null);
      this.preview = { start, end: snap?.point || point, anchor, toAnchor: snap?.anchor || "w" };
      renderEdges(this.edgesLayer, this.preview);
    };
    const up = (e) => {
      if (e.pointerId !== event.pointerId) return;
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); this.preview = null;
      if (this.connectionSnap) createEdge(nodeId, this.connectionSnap.nodeId, anchor, this.connectionSnap.anchor);
      this.setConnectionSnap(null);
      this.refresh("connection");
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
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
      if (e.pointerId !== event.pointerId || this.isGesturing()) return;
      const rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      Object.assign(this.captureBox.style, { left: `${rect.x}px`, top: `${rect.y - viewportTop}px`, width: `${rect.w}px`, height: `${rect.h}px` }); this.captureBox.classList.remove("hidden");
    };
    const up = (e) => { if (e.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); this.captureBox.classList.add("hidden"); const a = this.screenToWorld(start); const b = this.screenToWorld({ x: e.clientX, y: e.clientY }); this.onCapture({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }); this.setTool("select"); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
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
  fitBoard() { const axes = state.board.axes.filter((item) => !isEffectivelyHidden(item)).map((axis) => ({ ...axis, w: axis.orientation === "x" ? axis.length : 145, h: axis.orientation === "y" ? axis.length : 68 })); const items = [...state.board.nodes, ...state.board.groups].filter((item) => !isEffectivelyHidden(item)).concat(axes); const bounds = boundsOf(items, 90); const rect = this.viewport.getBoundingClientRect(); const zoom = clamp(Math.min(rect.width / bounds.w, rect.height / bounds.h), .12, 1.5); state.board.viewport = { zoom, x: (rect.width - bounds.w * zoom) / 2 - bounds.x * zoom, y: (rect.height - bounds.h * zoom) / 2 - bounds.y * zoom }; this.applyTransform(); commit("viewport", false); }
  zoomToBounds(bounds, maxZoom = 1.6) { if (!bounds) return false; const rect = this.viewport.getBoundingClientRect(); const zoom = clamp(Math.min(rect.width / Math.max(1, bounds.w), rect.height / Math.max(1, bounds.h)), .12, maxZoom); state.board.viewport = { zoom, x: (rect.width - bounds.w * zoom) / 2 - bounds.x * zoom, y: (rect.height - bounds.h * zoom) / 2 - bounds.y * zoom }; this.applyTransform(); commit("viewport", false); return true; }
  zoomToSelection() { return this.zoomToBounds(selectionBounds()); }
  focusItem(kind, id) {
    let item = kind === "node" ? state.board.nodes.find((entry) => entry.id === id) : kind === "group" ? state.board.groups.find((entry) => entry.id === id) : state.board.axes.find((entry) => entry.id === id);
    if (kind === "edge") {
      const edge = state.board.edges.find((entry) => entry.id === id); const from = edge && state.board.nodes.find((entry) => entry.id === edge.from); const to = edge && state.board.nodes.find((entry) => entry.id === edge.to);
      if (from && to) item = boundsOf([from, to], 30);
      state.selected.clear(); state.selectedEdge = edge?.id || null;
    } else {
      state.selected.clear(); if (item) state.selected.add(item.id); state.selectedEdge = null;
    }
    if (!item) return false;
    const width = item.w || (item.orientation === "x" ? item.length : 145); const height = item.h || (item.orientation === "y" ? item.length : 68);
    const rect = this.viewport.getBoundingClientRect(); const view = state.board.viewport; view.zoom = clamp(view.zoom, .65, 1.4);
    view.x = rect.width / 2 - (item.x + width / 2) * view.zoom; view.y = rect.height / 2 - (item.y + height / 2) * view.zoom;
    this.applyTransform(); commit("viewport", false); this.refreshSelection(); return true;
  }
  doubleClick(event) { if (!event.target.closest(".board-node,.group-box,.axis")) this.onCreate(this.screenToWorld({ x: event.clientX, y: event.clientY })); }
  contextTarget(target) {
    const node = target.closest?.(".board-node"); if (node) return { type: "node", id: node.dataset.id };
    const group = target.closest?.(".group-box"); if (group) return { type: "group", id: group.dataset.id };
    const axis = target.closest?.(".axis"); if (axis) return { type: "axis", id: axis.dataset.id };
    const edge = target.closest?.("[data-edge]"); if (edge) return { type: "edge", id: edge.dataset.edge };
    return null;
  }
  startLongPress(event, action) { this.cancelLongPress(); this.longPress = setTimeout(() => { this.longPress = null; navigator.vibrate?.(18); action(); }, 560); }
  cancelLongPress() { clearTimeout(this.longPress); this.longPress = null; }
  cancelDrag() { this.cancelLongPress(); this.selectionBox.classList.add("hidden"); this.captureBox.classList.add("hidden"); }
  setSpace(value) { this.spaceDown = value; this.viewport.style.cursor = value ? "grab" : state.tool === "hand" ? "grab" : "default"; }
  viewportCenter() { const rect = this.viewport.getBoundingClientRect(); return this.screenToWorld({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }); }

  trackTouchStart(event) {
    if (event.pointerType !== "touch") return;
    this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (this.touchPoints.size !== 2) return;
    this.cancelLongPress(); this.touchGestureActive = true;
    const [a, b] = [...this.touchPoints.values()];
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: state.board.viewport.zoom, world: this.screenToWorld(midpoint) };
  }

  trackTouchMove(event) {
    const point = this.touchPoints.get(event.pointerId); if (!point) return;
    point.x = event.clientX; point.y = event.clientY;
    if (Math.hypot(point.x - point.startX, point.y - point.startY) > 8) this.cancelLongPress();
    if (!this.pinch || this.touchPoints.size < 2) return;
    event.preventDefault();
    const [a, b] = [...this.touchPoints.values()];
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const zoom = clamp(this.pinch.zoom * distance / this.pinch.distance, .12, 4);
    const rect = this.viewport.getBoundingClientRect();
    state.board.viewport.zoom = zoom;
    state.board.viewport.x = midpoint.x - rect.left - this.pinch.world.x * zoom;
    state.board.viewport.y = midpoint.y - rect.top - this.pinch.world.y * zoom;
    this.applyTransform();
  }

  trackTouchEnd(event) {
    if (!this.touchPoints.has(event.pointerId)) return;
    this.touchPoints.delete(event.pointerId); this.cancelLongPress();
    if (this.pinch && this.touchPoints.size < 2) { this.pinch = null; commit("viewport", false); }
    if (!this.touchPoints.size) this.touchGestureActive = false;
  }

  isGesturing() { return this.touchGestureActive; }

  queueMinimapUpdate() {
    if (this.minimapFrame) return;
    this.minimapFrame = requestAnimationFrame(() => { this.minimapFrame = null; this.updateMinimap(); });
  }

  minimapItems() {
    const axes = state.board.axes.filter((axis) => !isEffectivelyHidden(axis)).map((axis) => ({
      ...axis,
      w: axis.orientation === "x" ? axis.length : 1,
      h: axis.orientation === "y" ? axis.length : 1,
      minimapType: "axis",
    }));
    return [
      ...state.board.groups.filter((item) => !isEffectivelyHidden(item)).map((item) => ({ ...item, minimapType: "group" })),
      ...state.board.nodes.filter((item) => !isEffectivelyHidden(item)).map((item) => ({ ...item, minimapType: "node" })),
      ...axes,
    ];
  }

  updateMinimap() {
    const map = $("#minimap"); if (!map) return;
    const rect = this.viewport.getBoundingClientRect(); const visible = visibleWorldBounds(state.board.viewport, rect);
    const items = this.minimapItems(); const bounds = minimapBounds(items, visible);
    const layout = minimapLayout(bounds, map.clientWidth || 142, map.clientHeight || 86);
    this.minimapGeometry = { bounds, layout };
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

  minimapPoint(event, geometry = this.minimapGeometry) {
    const map = $("#minimap"); if (!map || !geometry) return null;
    const rect = map.getBoundingClientRect();
    return { x: geometry.bounds.x + (event.clientX - rect.left - geometry.layout.x) / geometry.layout.scale, y: geometry.bounds.y + (event.clientY - rect.top - geometry.layout.y) / geometry.layout.scale };
  }

  centerOnWorld(point) {
    if (!point) return; const rect = this.viewport.getBoundingClientRect(); const view = state.board.viewport;
    view.x = rect.width / 2 - point.x * view.zoom; view.y = rect.height / 2 - point.y * view.zoom; this.applyTransform();
  }

  bindMinimap() {
    const map = $("#minimap"); if (!map) return;
    map.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); map.setPointerCapture?.(event.pointerId); const geometry = this.minimapGeometry; this.centerOnWorld(this.minimapPoint(event, geometry));
      const move = (moveEvent) => { if (moveEvent.pointerId === event.pointerId) this.centerOnWorld(this.minimapPoint(moveEvent, geometry)); };
      const up = (upEvent) => { if (upEvent.pointerId !== event.pointerId) return; map.removeEventListener("pointermove", move); map.removeEventListener("pointerup", up); commit("viewport", false); };
      map.addEventListener("pointermove", move); map.addEventListener("pointerup", up);
    });
  }
}
