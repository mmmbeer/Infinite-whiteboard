import { commit, snapshot, state } from "./state.js";
import { isEffectivelyHidden, isEffectivelyLocked, topLevelSelection, visibleBoardItems } from "./item-tree.js";
import { translateItem } from "./item-actions.js";
import { boundsOf } from "./utils.js";

const itemBounds = (item) => ({ x: item.x, y: item.y, w: item.w || (item.orientation === "x" ? item.length : 145), h: item.h || (item.orientation === "y" ? item.length : 68) });
const centerX = (item) => item.x + item.w / 2;
const centerY = (item) => item.y + item.h / 2;

function arrangedItems() {
  return topLevelSelection().filter((item) => !isEffectivelyHidden(item) && !isEffectivelyLocked(item)).map(itemBounds);
}

function sourceItems() {
  const selected = new Set(state.selected);
  return topLevelSelection().filter((item) => selected.has(item.id) && !isEffectivelyLocked(item));
}

function moveSources(moves, reason) {
  if (!moves.length) return 0;
  snapshot(); const moved = new Set(); moves.forEach(({ item, dx, dy }) => translateItem(item, dx, dy, moved));
  state.board.nodes.filter((node) => moved.has(node.id) && node.axisBinding && !state.selected.has(node.axisBinding.axisId)).forEach((node) => { node.axisBinding = null; });
  commit(reason, false); return moves.length;
}

export function alignSelection(mode) {
  const items = sourceItems(); const boxes = items.map(itemBounds);
  if (items.length < 2) return 0;
  const bounds = boundsOf(boxes);
  return moveSources(items.map((item, index) => {
    const box = boxes[index]; let dx = 0; let dy = 0;
    if (mode === "left") dx = bounds.x - box.x;
    if (mode === "center") dx = bounds.x + bounds.w / 2 - centerX(box);
    if (mode === "right") dx = bounds.x + bounds.w - box.x - box.w;
    if (mode === "top") dy = bounds.y - box.y;
    if (mode === "middle") dy = bounds.y + bounds.h / 2 - centerY(box);
    if (mode === "bottom") dy = bounds.y + bounds.h - box.y - box.h;
    return { item, dx, dy };
  }), `align-${mode}`);
}

export function distributeSelection(axis = "x") {
  const items = sourceItems(); if (items.length < 3) return 0;
  const boxes = new Map(items.map((item) => [item.id, itemBounds(item)]));
  const sorted = [...items].sort((a, b) => (axis === "x" ? boxes.get(a.id).x - boxes.get(b.id).x : boxes.get(a.id).y - boxes.get(b.id).y));
  const first = boxes.get(sorted[0].id); const last = boxes.get(sorted.at(-1).id);
  const totalSize = sorted.reduce((sum, item) => sum + (axis === "x" ? boxes.get(item.id).w : boxes.get(item.id).h), 0);
  const span = axis === "x" ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - totalSize) / (sorted.length - 1); let cursor = axis === "x" ? first.x : first.y;
  const moves = sorted.map((item) => {
    const box = boxes.get(item.id); const current = axis === "x" ? box.x : box.y;
    const move = { item, dx: axis === "x" ? cursor - current : 0, dy: axis === "y" ? cursor - current : 0 };
    cursor += (axis === "x" ? box.w : box.h) + gap; return move;
  });
  return moveSources(moves, `distribute-${axis}`);
}

export function autoLayoutSelection(layout = "grid", gap = 32) {
  const items = sourceItems(); if (items.length < 2) return 0;
  const boxes = items.map(itemBounds); const origin = boundsOf(boxes); const columns = layout === "grid" ? Math.ceil(Math.sqrt(items.length)) : layout === "horizontal" ? items.length : 1;
  const cellW = Math.max(...boxes.map((box) => box.w)); const cellH = Math.max(...boxes.map((box) => box.h));
  const moves = items.map((item, index) => {
    const box = boxes[index]; const column = index % columns; const row = Math.floor(index / columns);
    return { item, dx: origin.x + column * (cellW + gap) - box.x, dy: origin.y + row * (cellH + gap) - box.y };
  });
  return moveSources(moves, `auto-layout-${layout}`);
}

function axisSnapLines() {
  return state.board.axes.filter((axis) => !isEffectivelyHidden(axis)).flatMap((axis) => {
    const values = axis.mode === "number"
      ? Array.from({ length: Math.min(101, Math.floor((axis.max - axis.min) / axis.step) + 1) }, (_, index) => index / Math.max(1, Math.floor((axis.max - axis.min) / axis.step)))
      : axis.eras.map((_, index) => index / Math.max(1, axis.eras.length - 1));
    return values.map((ratio) => axis.orientation === "x" ? { axis: "x", value: axis.x + axis.length * ratio, kind: "axis" } : { axis: "y", value: axis.y + axis.length * ratio, kind: "axis" });
  });
}

export function snapAdjustment(movingItems, rawDx, rawDy, options = {}) {
  const settings = state.board.settings || {}; if (!settings.snapEnabled || options.disable) return { dx: rawDx, dy: rawDy, guides: [] };
  const movingIds = new Set(movingItems.map((item) => item.id)); const moving = boundsOf(movingItems.map(itemBounds));
  const translated = { x: moving.x + rawDx, y: moving.y + rawDy, w: moving.w, h: moving.h };
  const threshold = (Number(settings.snapDistance) || 8) / (options.zoom || 1);
  const candidates = visibleBoardItems().filter((item) => !movingIds.has(item.id) && !state.board.groups.some((group) => movingIds.has(group.id) && (item.groupId === group.id || item.parentId === group.id))).map(itemBounds);
  const xLines = candidates.flatMap((box) => [box.x, centerX(box), box.x + box.w].map((value) => ({ value, kind: "item" })));
  const yLines = candidates.flatMap((box) => [box.y, centerY(box), box.y + box.h].map((value) => ({ value, kind: "item" })));
  axisSnapLines().forEach((line) => (line.axis === "x" ? xLines : yLines).push(line));
  const movingX = [translated.x, centerX(translated), translated.x + translated.w];
  const movingY = [translated.y, centerY(translated), translated.y + translated.h];
  const best = (lines, values) => lines.flatMap((line) => values.map((value) => ({ delta: line.value - value, line }))).filter((item) => Math.abs(item.delta) <= threshold).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  let snapX = best(xLines, movingX); let snapY = best(yLines, movingY);
  if (settings.gridSnap) {
    const grid = Number(settings.gridSize) || 22;
    const gridX = { delta: Math.round(translated.x / grid) * grid - translated.x, line: { value: Math.round(translated.x / grid) * grid, kind: "grid" } };
    const gridY = { delta: Math.round(translated.y / grid) * grid - translated.y, line: { value: Math.round(translated.y / grid) * grid, kind: "grid" } };
    if (!snapX || Math.abs(gridX.delta) < Math.abs(snapX.delta)) snapX = gridX;
    if (!snapY || Math.abs(gridY.delta) < Math.abs(snapY.delta)) snapY = gridY;
  }
  const guides = [];
  if (snapX) guides.push({ axis: "x", value: snapX.line.value, kind: snapX.line.kind });
  if (snapY) guides.push({ axis: "y", value: snapY.line.value, kind: snapY.line.kind });
  return { dx: rawDx + (snapX?.delta || 0), dy: rawDy + (snapY?.delta || 0), guides };
}

export function selectionBounds() {
  const items = arrangedItems(); return items.length ? boundsOf(items, 24) : null;
}
