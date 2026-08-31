import { state } from "./state.js";
import { clamp } from "./utils.js";

export function axisRatio(axis, value) {
  if (!axis) return 0;
  if (axis.mode === "number") return clamp((Number(value) - axis.min) / Math.max(0.0001, axis.max - axis.min), 0, 1);
  const index = Math.max(0, axis.eras.indexOf(String(value)));
  return index / Math.max(1, axis.eras.length - 1);
}

export function axisPoint(axis, value) {
  const ratio = axisRatio(axis, value);
  return { x: axis.x + (axis.orientation === "x" ? axis.length * ratio : 0), y: axis.y + (axis.orientation === "y" ? axis.length * ratio : 0) };
}

export function positionBoundNode(node, axis) {
  const binding = node.axisBinding; if (!binding || binding.axisId !== axis?.id) return false;
  const point = axisPoint(axis, binding.value);
  if (axis.orientation === "x") {
    node.x = point.x - node.w / 2;
    if (binding.snap !== false) node.y = axis.y + Number(binding.offset || 0);
  } else {
    node.y = point.y - node.h / 2;
    if (binding.snap !== false) node.x = axis.x + Number(binding.offset || 0);
  }
  return true;
}

export function reflowAxis(axisId) {
  const axis = state.board.axes.find((item) => item.id === axisId); if (!axis) return [];
  const moved = state.board.nodes.filter((node) => positionBoundNode(node, axis)); return moved;
}

export function attachNodeToAxis(node, axis, value, snap = true) {
  if (!node || !axis) return false;
  const offset = axis.orientation === "x" ? node.y - axis.y : node.x - axis.x;
  node.axisBinding = { axisId: axis.id, value: axis.mode === "number" ? Number(value) : String(value), offset, snap };
  positionBoundNode(node, axis); return true;
}

export function detachNodeFromAxis(node) {
  if (!node?.axisBinding) return false; node.axisBinding = null; return true;
}

export function nearestAxisValue(axis, point) {
  if (axis.mode === "number") {
    const position = axis.orientation === "x" ? point.x - axis.x : point.y - axis.y;
    const raw = axis.min + clamp(position / axis.length, 0, 1) * (axis.max - axis.min);
    const value = Math.round((raw - axis.min) / axis.step) * axis.step + axis.min;
    return clamp(value, axis.min, axis.max);
  }
  if (!axis.eras.length) return null;
  const position = axis.orientation === "x" ? point.x - axis.x : point.y - axis.y;
  const index = Math.round(clamp(position / axis.length, 0, 1) * Math.max(1, axis.eras.length - 1));
  return axis.eras[index];
}

export function findAxisAttachment(node, threshold = 16) {
  const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  let best = null;
  state.board.axes.filter((axis) => !axis.hidden).forEach((axis) => {
    const value = nearestAxisValue(axis, center); if (value === null) return;
    const point = axisPoint(axis, value);
    const distance = Math.hypot(center.x - point.x, center.y - point.y);
    if (distance <= threshold && (!best || distance < best.distance)) best = { axis, value, distance };
  });
  return best;
}
