import { state, commit, snapshot } from "./state.js";
import { ancestorGroups, getGroup, groupContents, isEffectivelyHidden, isEffectivelyLocked } from "./item-tree.js";
import { toggleGroupCollapse } from "./item-actions.js";
import { boundsOf, colorFor, escapeHtml, uid } from "./utils.js";

function visualBounds(node) {
  const radians = (node.rotation || 0) * Math.PI / 180; const cosine = Math.abs(Math.cos(radians)); const sine = Math.abs(Math.sin(radians));
  const width = node.w * cosine + node.h * sine; const height = node.w * sine + node.h * cosine;
  return { x: node.x + node.w / 2 - width / 2, y: node.y + node.h / 2 - height / 2, w: width, h: height };
}

export function createGroup(itemIds, title = "New frame", point = null) {
  const selected = new Set(itemIds);
  const nodes = state.board.nodes.filter((node) => selected.has(node.id));
  const groups = state.board.groups.filter((group) => selected.has(group.id));
  const items = [...nodes.map(visualBounds), ...groups];
  const bounds = items.length ? boundsOf(items, 34) : { x: point?.x || 0, y: point?.y || 0, w: 520, h: 320 };
  const parentCandidates = [...nodes.map((node) => node.groupId), ...groups.map((group) => group.parentId)].filter(Boolean);
  const parentId = parentCandidates.length === nodes.length + groups.length && new Set(parentCandidates).size === 1 ? parentCandidates[0] : null;
  snapshot();
  const group = { id: uid("group"), title, description: "", category: "", tags: [], color: colorFor(state.board.groups.length + 1), parentId, collapsed: false, locked: false, hidden: false, manualSize: !items.length, ...bounds };
  state.board.groups.push(group);
  nodes.forEach((node) => { node.groupId = group.id; });
  groups.forEach((child) => { if (child.id !== group.id) child.parentId = group.id; });
  state.selected.clear(); state.selected.add(group.id); commit("groups", false); return group;
}

export function renderGroups(layer) {
  layer.innerHTML = state.board.groups.filter((group) => !isEffectivelyHidden(group)).sort((a, b) => ancestorGroups(a.parentId).length - ancestorGroups(b.parentId).length).map((group) => {
    const depth = ancestorGroups(group.parentId).length;
    const stateClasses = [state.selected.has(group.id) ? "selected" : "", group.collapsed ? "collapsed" : "", group.locked ? "locked" : "", depth ? "nested" : ""].filter(Boolean).join(" ");
    const handles = ["nw", "ne", "se", "sw"].map((handle) => `<button class="group-resize-handle" data-group-resize="${handle}" aria-label="Resize frame from ${handle}"></button>`).join("");
    return `<section class="group-box ${stateClasses}" data-id="${group.id}" style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.collapsed ? 1 : group.h}px;--group-color:${group.color};--group-depth:${depth}"><header class="group-heading"><button class="group-collapse" data-group-collapse aria-label="${group.collapsed ? "Expand" : "Collapse"} frame">${group.collapsed ? "▸" : "▾"}</button><span class="group-dot"></span><span>${escapeHtml(group.title)}</span>${group.locked ? `<i title="Locked">▣</i>` : ""}</header>${handles}</section>`;
  }).join("");
}

export function bindGroupInteractions(layer, canvasApi) {
  layer.addEventListener("pointerdown", (event) => {
    if (canvasApi.shouldPan?.(event)) return;
    const element = event.target.closest(".group-box"); if (!element) return;
    const group = getGroup(element.dataset.id); if (!group) return;
    if (event.target.closest("[data-group-collapse]")) {
      event.preventDefault(); event.stopPropagation(); toggleGroupCollapse(group.id); canvasApi.refresh("group-collapse"); return;
    }
    const resize = event.target.closest("[data-group-resize]");
    if (resize && !isEffectivelyLocked(group)) return startGroupResize(event, group, resize.dataset.groupResize, canvasApi);
    if (isEffectivelyLocked(group)) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || state.tool === "multi") state.selected.has(group.id) ? state.selected.delete(group.id) : state.selected.add(group.id);
    else if (!state.selected.has(group.id)) { state.selected.clear(); state.selected.add(group.id); }
    state.selectedEdge = null; canvasApi.refreshSelection();
  });
}

function startGroupResize(event, group, handle, canvasApi) {
  event.preventDefault(); event.stopPropagation(); snapshot(); group.manualSize = true;
  const start = canvasApi.screenToWorld({ x: event.clientX, y: event.clientY });
  const origin = { x: group.x, y: group.y, w: group.w, h: group.h };
  const left = handle.includes("w"); const top = handle.includes("n");
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== event.pointerId || canvasApi.isGesturing?.()) return;
    const point = canvasApi.screenToWorld({ x: moveEvent.clientX, y: moveEvent.clientY }); const dx = point.x - start.x; const dy = point.y - start.y;
    group.w = Math.max(180, origin.w + (left ? -dx : dx)); group.h = Math.max(120, origin.h + (top ? -dy : dy));
    group.x = left ? origin.x + origin.w - group.w : origin.x; group.y = top ? origin.y + origin.h - group.h : origin.y;
    canvasApi.queueLiveItem(group);
  };
  const up = (upEvent) => { if (upEvent.pointerId !== event.pointerId) return; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); commit("resize-frame", false); canvasApi.finishLiveTransform("frame"); };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
}

export function updateGroupBounds(groupId) {
  const group = getGroup(groupId); if (!group || group.manualSize || group.collapsed) return;
  const contents = groupContents(groupId, false); const items = [...contents.nodes.map(visualBounds), ...state.board.groups.filter((child) => child.parentId === groupId)];
  if (items.length) Object.assign(group, boundsOf(items, 34));
}
