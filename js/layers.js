import { commit, snapshot, state } from "./state.js";
import { ancestorGroups, getItem, isEffectivelyHidden, isEffectivelyLocked, itemKind } from "./item-tree.js";
import { openModal } from "./ui.js";
import { escapeHtml } from "./utils.js";

function labelOf(item) {
  if (state.board.edges.includes(item)) { const from = getItem(item.from)?.title || "Source"; const to = getItem(item.to)?.title || "Destination"; return item.label || `${from} → ${to}`; }
  return item.title || item.label || item.content?.slice(0, 32) || "Untitled";
}

export function showLayers(canvas) {
  const content = document.createElement("div"); content.className = "layer-browser";
  const modal = openModal({ title: "Layers, visibility & locks", content });
  const render = () => {
    const items = [...state.board.groups, ...state.board.axes, ...state.board.nodes, ...state.board.edges].reverse();
    content.innerHTML = `<p class="modal-copy">Hidden items remain stored locally but are excluded from captures and exports.</p><div class="layer-list">${items.map((item) => { const hidden = isEffectivelyHidden(item); const locked = isEffectivelyLocked(item); return `<article class="layer-row ${hidden ? "hidden-item" : ""}"><button class="layer-focus" data-layer-focus="${item.id}"><span>${escapeHtml(itemKind(item))}</span><strong>${escapeHtml(labelOf(item))}</strong></button><button class="layer-state ${locked ? "active" : ""}" data-layer-lock="${item.id}" title="${locked ? "Unlock item" : "Lock"}">▣</button><button class="layer-state ${hidden ? "active" : ""}" data-layer-hide="${item.id}" title="${hidden ? "Show item and parent frames" : "Hide"}">${hidden ? "◌" : "◉"}</button></article>`; }).join("")}</div>`;
  };
  content.addEventListener("click", (event) => {
    const lockId = event.target.closest("[data-layer-lock]")?.dataset.layerLock;
    const hideId = event.target.closest("[data-layer-hide]")?.dataset.layerHide;
    if (lockId || hideId) {
      const item = getItem(lockId || hideId); if (!item) return;
      snapshot();
      if (lockId) {
        if (isEffectivelyLocked(item)) { item.locked = false; ancestorGroups(state.board.nodes.includes(item) ? item.groupId : item.parentId).forEach((group) => { group.locked = false; }); }
        else item.locked = true;
      } else if (isEffectivelyHidden(item)) {
        item.hidden = false; ancestorGroups(state.board.nodes.includes(item) ? item.groupId : item.parentId).forEach((group) => { group.hidden = false; group.collapsed = false; });
      } else item.hidden = true;
      commit(lockId ? "locked" : "hidden", false); canvas.refresh(lockId ? "lock" : "visibility"); render(); return;
    }
    const id = event.target.closest("[data-layer-focus]")?.dataset.layerFocus; const item = getItem(id);
    if (!item) return; if (isEffectivelyHidden(item)) { snapshot(); item.hidden = false; ancestorGroups(state.board.nodes.includes(item) ? item.groupId : item.parentId).forEach((group) => { group.hidden = false; group.collapsed = false; }); commit("visibility", false); canvas.refresh("visibility"); }
    modal.close(); canvas.focusItem(itemKind(item), item.id);
  });
  render();
}
