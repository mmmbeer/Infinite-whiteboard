import { commit, snapshot, state } from "./state.js";
import { boundsOf, uid } from "./utils.js";

const FORMAT = "infinite-whiteboard-selection-v1";
let clipboard = null;
let pasteCount = 0;

function selectedPayload() {
  const selectedIds = new Set(state.selected);
  const groups = state.board.groups.filter((group) => selectedIds.has(group.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const nodes = state.board.nodes.filter((node) => selectedIds.has(node.id) || groupIds.has(node.groupId));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const axes = state.board.axes.filter((axis) => selectedIds.has(axis.id));
  const edges = state.board.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  if (!nodes.length && !groups.length && !axes.length) return null;
  return structuredClone({ format: FORMAT, nodes, groups, axes, edges });
}

function itemBounds(payload) {
  const axes = payload.axes.map((axis) => ({
    ...axis,
    w: axis.orientation === "x" ? axis.length : 145,
    h: axis.orientation === "y" ? axis.length : 68,
  }));
  return boundsOf([...payload.nodes, ...payload.groups, ...axes]);
}

function writeSystemClipboard(payload) {
  if (!navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(JSON.stringify(payload)).catch(() => {});
}

async function readSystemClipboard() {
  if (!navigator.clipboard?.readText) return null;
  try {
    const parsed = JSON.parse(await navigator.clipboard.readText());
    return parsed?.format === FORMAT ? parsed : null;
  } catch { return null; }
}

export function hasClipboard() { return Boolean(clipboard); }

export function copySelection() {
  const payload = selectedPayload();
  if (!payload) return 0;
  clipboard = payload; pasteCount = 0; writeSystemClipboard(payload);
  return payload.nodes.length + payload.groups.length + payload.axes.length;
}

export function cutSelection() {
  const payload = selectedPayload();
  if (!payload) return 0;
  clipboard = payload; pasteCount = 0; writeSystemClipboard(payload);
  const nodeIds = new Set(payload.nodes.map((node) => node.id));
  const groupIds = new Set(payload.groups.map((group) => group.id));
  const axisIds = new Set(payload.axes.map((axis) => axis.id));
  snapshot();
  state.board.nodes = state.board.nodes.filter((node) => !nodeIds.has(node.id));
  state.board.groups = state.board.groups.filter((group) => !groupIds.has(group.id));
  state.board.axes = state.board.axes.filter((axis) => !axisIds.has(axis.id));
  state.board.edges = state.board.edges.filter((edge) => !nodeIds.has(edge.from) && !nodeIds.has(edge.to));
  state.selected.clear(); state.selectedEdge = null; commit("cut", false);
  return payload.nodes.length + payload.groups.length + payload.axes.length;
}

function pastePayload(payload, point) {
  const sourceBounds = itemBounds(payload);
  const step = 28 * (++pasteCount);
  const delta = point
    ? { x: point.x - sourceBounds.x, y: point.y - sourceBounds.y }
    : { x: step, y: step };
  const groupMap = new Map(payload.groups.map((group) => [group.id, uid("group")]));
  const nodeMap = new Map(payload.nodes.map((node) => [node.id, uid("node")]));
  const groups = payload.groups.map((group) => ({ ...group, id: groupMap.get(group.id), x: group.x + delta.x, y: group.y + delta.y }));
  const nodes = payload.nodes.map((node) => ({
    ...node,
    id: nodeMap.get(node.id),
    groupId: groupMap.get(node.groupId) || null,
    x: node.x + delta.x,
    y: node.y + delta.y,
    createdAt: Date.now(),
  }));
  const axes = payload.axes.map((axis) => ({ ...axis, id: uid("axis"), x: axis.x + delta.x, y: axis.y + delta.y }));
  const edges = payload.edges
    .filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to))
    .map((edge) => ({ ...edge, id: uid("edge"), from: nodeMap.get(edge.from), to: nodeMap.get(edge.to) }));
  snapshot();
  state.board.groups.push(...groups); state.board.nodes.push(...nodes);
  state.board.axes.push(...axes); state.board.edges.push(...edges);
  state.selected.clear(); state.selectedEdge = null;
  if (groups.length) groups.forEach((group) => state.selected.add(group.id));
  const groupedNodeIds = new Set(nodes.filter((node) => node.groupId).map((node) => node.id));
  nodes.filter((node) => !groupedNodeIds.has(node.id)).forEach((node) => state.selected.add(node.id));
  axes.forEach((axis) => state.selected.add(axis.id));
  commit("paste", false);
  return nodes.length + groups.length + axes.length;
}

export async function pasteSelection(point = null) {
  const payload = clipboard || await readSystemClipboard();
  if (!payload) return 0;
  clipboard = structuredClone(payload);
  return pastePayload(clipboard, point);
}

export function duplicateSelection() {
  const payload = selectedPayload();
  if (!payload) return 0;
  pasteCount = 0;
  return pastePayload(payload, null);
}
