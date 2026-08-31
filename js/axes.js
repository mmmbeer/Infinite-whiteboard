import { state, commit, snapshot } from "./state.js";
import { isEffectivelyHidden, isEffectivelyLocked } from "./item-tree.js";
import { colorFor, escapeHtml, uid } from "./utils.js";

export function createAxis({ x, y, orientation = "x", label = "Timeline", eras = [], mode = "eras", min = 0, max = 100, step = 25 }) {
  snapshot();
  min = Number(min) || 0; max = Number(max); if (!Number.isFinite(max) || max <= min) max = min + 100; step = Math.max(0.0001, Number(step) || (max - min) / 4);
  const axis = { id: uid("axis"), x, y, orientation, label, eras, mode, min, max, step, length: 900, color: colorFor(state.board.axes.length), locked: false, hidden: false };
  state.board.axes.push(axis); state.selected.clear(); state.selected.add(axis.id); commit("axes", false); return axis;
}

export function axisTicks(axis) {
  if (axis.mode !== "number") return axis.eras.map((value, index) => ({ value, ratio: index / Math.max(1, axis.eras.length - 1) }));
  const rawCount = Math.max(1, Math.ceil((axis.max - axis.min) / axis.step)); const count = Math.min(100, rawCount);
  return Array.from({ length: count + 1 }, (_, index) => { const ratio = index / count; const raw = rawCount > 100 ? axis.min + (axis.max - axis.min) * ratio : axis.min + Math.min(index * axis.step, axis.max - axis.min); return { value: Number(raw.toFixed(6)), ratio }; });
}

export function renderAxes(layer) {
  layer.innerHTML = state.board.axes.filter((axis) => !isEffectivelyHidden(axis)).map((axis) => {
    const ticks = axisTicks(axis).map((tick) => `<span class="axis-tick" style="${axis.orientation === "x" ? "left" : "top"}:${tick.ratio * 100}%" data-axis-value="${escapeHtml(tick.value)}"><span>${escapeHtml(tick.value)}</span></span>`).join("");
    return `<div class="axis ${axis.orientation} ${axis.locked ? "locked" : ""} ${state.selected.has(axis.id) ? "selected" : ""}" data-id="${axis.id}" style="left:${axis.x}px;top:${axis.y}px;--axis-length:${axis.length}px;--axis-color:${axis.color}"><strong class="axis-label">${axis.locked ? "▣ " : ""}${escapeHtml(axis.label)}</strong>${ticks}</div>`;
  }).join("");
}

export function bindAxisInteractions(layer, onSelect, shouldPan = () => false) {
  layer.addEventListener("pointerdown", (event) => {
    if (shouldPan(event)) return;
    const axis = event.target.closest(".axis");
    if (!axis) return;
    const id = axis.dataset.id; const item = state.board.axes.find((entry) => entry.id === id);
    if (isEffectivelyLocked(item)) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey || state.tool === "multi") state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    else if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); }
    state.selectedEdge = null; onSelect();
  });
}
