import { state, commit, snapshot } from "./state.js";
import { colorFor, escapeHtml, uid } from "./utils.js";

export function createAxis({ x, y, orientation = "x", label = "Timeline", eras = [] }) {
  snapshot();
  const axis = { id: uid("axis"), x, y, orientation, label, eras, length: 900, color: colorFor(state.board.axes.length) };
  state.board.axes.push(axis); state.selected.clear(); state.selected.add(axis.id); commit("axes", false); return axis;
}

export function renderAxes(layer) {
  layer.innerHTML = state.board.axes.map((axis) => {
    const count = Math.max(1, axis.eras.length - 1);
    const ticks = axis.eras.map((era, index) => `<span class="axis-tick" style="${axis.orientation === "x" ? "left" : "top"}:${(index / count) * 100}%"><span>${escapeHtml(era)}</span></span>`).join("");
    return `<div class="axis ${axis.orientation} ${state.selected.has(axis.id) ? "selected" : ""}" data-id="${axis.id}" style="left:${axis.x}px;top:${axis.y}px;--axis-length:${axis.length}px;--axis-color:${axis.color}"><strong class="axis-label">${escapeHtml(axis.label)}</strong>${ticks}</div>`;
  }).join("");
}

export function bindAxisInteractions(layer, onSelect, shouldPan = () => false) {
  layer.addEventListener("pointerdown", (event) => {
    if (shouldPan(event)) return;
    const axis = event.target.closest(".axis");
    if (!axis) return;
    const id = axis.dataset.id;
    if (event.shiftKey || event.ctrlKey || event.metaKey || state.tool === "multi") state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    else if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); }
    state.selectedEdge = null; onSelect();
  });
}
