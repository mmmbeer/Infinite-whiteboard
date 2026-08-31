import { assetDb } from "./database.js";
import { renderMarkdown } from "./markdown.js";
import { state, getNode, commit, snapshot } from "./state.js";
import { $, escapeHtml } from "./utils.js";
import { isEffectivelyHidden, isEffectivelyLocked, movableItemsForSelection, topLevelSelection } from "./item-tree.js";
import { snapAdjustment } from "./arrange.js";
import { attachNodeToAxis, detachNodeFromAxis, findAxisAttachment, reflowAxis } from "./axis-bindings.js";

const objectUrls = new Map();
const renderedNodeState = new WeakMap();

async function imageUrl(assetId) {
  if (!assetId) return "";
  if (objectUrls.has(assetId)) return objectUrls.get(assetId);
  const asset = await assetDb.get(assetId);
  if (!asset?.blob) return "";
  const url = URL.createObjectURL(asset.blob);
  objectUrls.set(assetId, url);
  return url;
}

function bodyHtml(node) {
  if (node.type === "image") return `<img class="node-image" data-asset="${node.assetId}" alt="${escapeHtml(node.description || node.title)}" draggable="false" />`;
  if (node.type === "markdown") return `<div class="node-text node-markdown">${renderMarkdown(node.content)}</div>`;
  return `<div class="node-text">${escapeHtml(node.content)}</div>`;
}

const transformHandles = () => `${["nw", "ne", "se", "sw"].map((handle) => `<button class="image-transform-handle resize-handle" data-resize="${handle}" aria-label="Resize image from ${handle}"></button>`).join("")}<button class="image-transform-handle rotate-handle" aria-label="Rotate image"></button>`;

function contentChanged(node) {
  const previous = renderedNodeState.get(node);
  const tags = node.tags?.join("\u001f") || "";
  const next = { type: node.type, title: node.title, content: node.content, description: node.description, tags, assetId: node.assetId };
  renderedNodeState.set(node, next);
  return !previous || Object.keys(next).some((key) => previous[key] !== next[key]);
}

export function updateNodeFrame(element, node) {
  if (!element || !node) return;
  element.style.width = `${node.w}px`;
  element.style.height = `${node.h}px`;
  element.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) rotate(${node.rotation || 0}deg)`;
}

export async function renderNodes(layer) {
  const existing = new Map([...layer.children].map((element) => [element.dataset.id, element]));
  for (const node of state.board.nodes.filter((item) => !isEffectivelyHidden(item))) {
    let element = existing.get(node.id);
    if (!element) {
      element = document.createElement("article");
      element.className = "board-node";
      element.dataset.id = node.id;
      layer.append(element);
    }
    if (contentChanged(node)) {
      element.innerHTML = `<header class="node-bar"><span class="node-kind">${escapeHtml(node.type)}</span><span class="node-title">${escapeHtml(node.title)}</span><span class="node-state"></span></header><div class="node-body">${bodyHtml(node)}${node.tags?.length ? `<div class="node-tags">${node.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</div>${["n", "e", "s", "w"].map((anchor) => `<button class="anchor" data-anchor="${anchor}" aria-label="Connect from ${anchor}"></button>`).join("")}${node.type === "image" ? transformHandles() : ""}`;
      if (node.type === "image") {
        const image = $("img", element);
        imageUrl(node.assetId).then((url) => { if (url) image.src = url; });
      }
    }
    updateNodeFrame(element, node);
    element.style.setProperty("--node-color", node.color || "#ff715b");
    element.classList.toggle("selected", state.selected.has(node.id));
    element.classList.toggle("locked", isEffectivelyLocked(node));
    element.classList.toggle("axis-bound", Boolean(node.axisBinding));
    const stateBadge = $(".node-state", element); if (stateBadge) stateBadge.textContent = `${node.axisBinding ? "⇥" : ""}${isEffectivelyLocked(node) ? "▣" : ""}`;
    layer.append(element);
    existing.delete(node.id);
  }
  existing.forEach((element) => element.remove());
}

export function bindNodeInteractions(layer, canvasApi) {
  layer.addEventListener("pointerdown", (event) => {
    if (canvasApi.shouldPan?.(event)) return;
    const resizeHandle = event.target.closest(".resize-handle");
    const rotateHandle = event.target.closest(".rotate-handle");
    const anchor = event.target.closest(".anchor");
    const element = event.target.closest(".board-node");
    if (!element) return;
    const selectedNode = getNode(element.dataset.id);
    if (isEffectivelyLocked(selectedNode)) return;
    if (resizeHandle) return startResize(event, getNode(element.dataset.id), resizeHandle.dataset.resize, canvasApi);
    if (rotateHandle) return startRotate(event, getNode(element.dataset.id), canvasApi);
    if (anchor) return canvasApi.startConnection(event, element.dataset.id, anchor.dataset.anchor);
    const id = element.dataset.id;
    if (event.shiftKey || event.ctrlKey || event.metaKey || state.tool === "multi") {
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    } else if (!state.selected.has(id)) {
      state.selected.clear(); state.selected.add(id);
    }
    state.selectedEdge = null;
    canvasApi.refreshSelection();
    if (state.tool === "select" && state.selected.has(id) && event.target.closest(".node-bar")) startDrag(event, canvasApi);
  });
  layer.addEventListener("dblclick", (event) => {
    const element = event.target.closest(".board-node");
    if (!element) return;
    const node = getNode(element.dataset.id); if (!isEffectivelyLocked(node)) canvasApi.editNode(node);
  });
}

function rotateVector(point, degrees) {
  const radians = degrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

function startResize(event, node, handle, canvasApi) {
  if (!node || isEffectivelyLocked(node)) return; event.preventDefault(); event.stopPropagation(); snapshot();
  canvasApi.beginLiveTransform([node]);
  const signs = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[handle];
  const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  const fixedOffset = rotateVector({ x: -signs[0] * node.w / 2, y: -signs[1] * node.h / 2 }, node.rotation || 0);
  const fixed = { x: center.x + fixedOffset.x, y: center.y + fixedOffset.y }; const ratio = node.w / node.h;
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId || canvasApi.isGesturing?.()) return;
    const point = canvasApi.screenToWorld({ x: moveEvent.clientX, y: moveEvent.clientY });
    const local = rotateVector({ x: point.x - fixed.x, y: point.y - fixed.y }, -(node.rotation || 0));
    let width = Math.max(90, signs[0] * local.x); let height = Math.max(80, signs[1] * local.y);
    if (moveEvent.shiftKey) { if (width / height > ratio) height = width / ratio; else width = height * ratio; }
    const centerOffset = rotateVector({ x: signs[0] * width / 2, y: signs[1] * height / 2 }, node.rotation || 0);
    const nextCenter = { x: fixed.x + centerOffset.x, y: fixed.y + centerOffset.y };
    node.w = width; node.h = height; node.x = nextCenter.x - width / 2; node.y = nextCenter.y - height / 2;
    canvasApi.queueLiveNodes([node]);
  };
  const up = (upEvent) => { if (upEvent.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); commit("resize", false); canvasApi.finishLiveTransform("transform"); };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
}

function startRotate(event, node, canvasApi) {
  if (!node || isEffectivelyLocked(node)) return; event.preventDefault(); event.stopPropagation(); snapshot();
  canvasApi.beginLiveTransform([node]);
  const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  const start = canvasApi.screenToWorld({ x: event.clientX, y: event.clientY });
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI; const original = node.rotation || 0;
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId || canvasApi.isGesturing?.()) return;
    const point = canvasApi.screenToWorld({ x: moveEvent.clientX, y: moveEvent.clientY });
    const angle = original + Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI - startAngle;
    node.rotation = moveEvent.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10;
    canvasApi.queueLiveNodes([node]);
  };
  const up = (upEvent) => { if (upEvent.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); commit("rotate", false); canvasApi.finishLiveTransform("transform"); };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
}

function startDrag(event, canvasApi) {
  event.preventDefault();
  const start = canvasApi.screenToWorld({ x: event.clientX, y: event.clientY });
  const items = movableItemsForSelection();
  state.board.axes.filter((axis) => state.selected.has(axis.id)).forEach((axis) => state.board.nodes.filter((node) => node.axisBinding?.axisId === axis.id && !isEffectivelyLocked(node)).forEach((node) => { if (!items.includes(node)) items.push(node); }));
  const nodes = items.filter((item) => state.board.nodes.includes(item)); const topItems = topLevelSelection().filter((item) => !isEffectivelyLocked(item));
  const origins = new Map(items.map((item) => [item.id, { x: item.x, y: item.y }]));
  snapshot();
  canvasApi.beginLiveTransform(nodes);
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId || canvasApi.isGesturing?.()) return;
    const point = canvasApi.screenToWorld({ x: moveEvent.clientX, y: moveEvent.clientY });
    const rawDx = point.x - start.x; const rawDy = point.y - start.y;
    const snapped = snapAdjustment(topItems, rawDx, rawDy, { zoom: state.board.viewport.zoom, disable: moveEvent.altKey });
    items.forEach((item) => {
      const origin = origins.get(item.id);
      item.x = origin.x + snapped.dx;
      item.y = origin.y + snapped.dy;
    });
    canvasApi.showGuides?.(snapped.guides);
    canvasApi.queueLiveNodes(nodes);
    topItems.filter((item) => !state.board.nodes.includes(item)).forEach((item) => canvasApi.queueLiveItem?.(item, nodes));
  };
  const up = (upEvent) => {
    if (upEvent.pointerId !== event.pointerId) return;
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    canvasApi.showGuides?.([]);
    if (state.board.settings?.axisSnap !== false) nodes.forEach((node) => {
      const attachment = findAxisAttachment(node, 28 / state.board.viewport.zoom);
      if (attachment) attachNodeToAxis(node, attachment.axis, attachment.value, true);
      else if (node.axisBinding) detachNodeFromAxis(node);
    });
    state.board.axes.filter((axis) => state.selected.has(axis.id)).forEach((axis) => reflowAxis(axis.id));
    commit("move", false);
    canvasApi.finishLiveTransform("move");
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}

export function resizeNodeToContent(id, height) {
  const node = getNode(id);
  if (!node) return;
  node.h = Math.max(node.type === "image" ? 120 : 100, Math.min(420, height));
}
