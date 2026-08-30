import { state, commit, snapshot } from "./state.js";
import { boundsOf, colorFor, escapeHtml, uid } from "./utils.js";

function visualBounds(node) {
  const radians = (node.rotation || 0) * Math.PI / 180; const cosine = Math.abs(Math.cos(radians)); const sine = Math.abs(Math.sin(radians));
  const width = node.w * cosine + node.h * sine; const height = node.w * sine + node.h * cosine;
  return { x: node.x + node.w / 2 - width / 2, y: node.y + node.h / 2 - height / 2, w: width, h: height };
}

export function createGroup(nodeIds, title = "New group") {
  const nodes = state.board.nodes.filter((node) => nodeIds.includes(node.id));
  const bounds = boundsOf(nodes.map(visualBounds), 34);
  snapshot();
  const group = { id: uid("group"), title, description: "", category: "", tags: [], color: colorFor(state.board.groups.length + 1), ...bounds };
  state.board.groups.push(group);
  nodes.forEach((node) => { node.groupId = group.id; });
  state.selected.clear(); state.selected.add(group.id); commit("groups", false); return group;
}

export function renderGroups(layer) {
  layer.innerHTML = state.board.groups.map((group) => `<section class="group-box ${state.selected.has(group.id) ? "selected" : ""}" data-id="${group.id}" style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.h}px;--group-color:${group.color}"><header class="group-heading"><span class="group-dot"></span>${escapeHtml(group.title)}</header></section>`).join("");
}

export function bindGroupInteractions(layer, onSelect, shouldPan = () => false) {
  layer.addEventListener("pointerdown", (event) => {
    if (shouldPan(event)) return;
    const group = event.target.closest(".group-box");
    if (!group) return;
    const id = group.dataset.id;
    if (event.shiftKey || event.ctrlKey || event.metaKey || state.tool === "multi") state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    else if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); }
    state.selectedEdge = null; onSelect();
  });
}

export function updateGroupBounds(groupId) {
  const group = state.board.groups.find((item) => item.id === groupId);
  const nodes = state.board.nodes.filter((node) => node.groupId === groupId);
  if (!group || !nodes.length) return;
  Object.assign(group, boundsOf(nodes.map(visualBounds), 34));
}
