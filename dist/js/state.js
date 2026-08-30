import { boardDb } from "./database.js";
import { debounce, uid } from "./utils.js";

const listeners = new Set();
const history = [];
const future = [];
let saveListener = () => {};
const legacyPalette = new Map([
  ["#d8ff64", "#ff715b"],
  ["#75d7ff", "#cbd2d0"],
  ["#ff9f68", "#ff715b"],
  ["#d99cff", "#8b2635"],
  ["#68e1b4", "#cbd2d0"],
  ["#ff7f9e", "#8b2635"],
]);

export const state = {
  board: null,
  tool: "select",
  selected: new Set(),
  selectedEdge: null,
};

export function emptyBoard() {
  return {
    id: "default",
    title: "Untitled board",
    version: 1,
    updatedAt: Date.now(),
    viewport: { x: innerWidth / 2, y: innerHeight / 2, zoom: 1 },
    nodes: [], edges: [], groups: [], axes: [],
    settings: { connectionType: "curved" },
  };
}

export async function loadBoard() {
  state.board = await boardDb.get("default") || emptyBoard();
  state.board.settings = { connectionType: "curved", ...(state.board.settings || {}) };
  state.board.nodes.forEach((node) => {
    if (!Number.isFinite(node.rotation)) node.rotation = 0;
    node.color = legacyPalette.get(node.color?.toLowerCase()) || node.color || "#ff715b";
  });
  [...state.board.groups, ...state.board.axes].forEach((item) => {
    item.color = legacyPalette.get(item.color?.toLowerCase()) || item.color;
  });
  return state.board;
}

const saveNow = debounce(async () => {
  state.board.updatedAt = Date.now();
  await boardDb.put(structuredClone(state.board));
  saveListener("saved");
}, 450);

export function onSaveStatus(listener) { saveListener = listener; }
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function notify(reason = "update") { listeners.forEach((listener) => listener(reason)); }
export function snapshot() {
  history.push(structuredClone(state.board));
  if (history.length > 80) history.shift();
  future.length = 0;
}
export function commit(reason = "update", record = true) {
  if (record) snapshot();
  saveListener("saving");
  saveNow();
  notify(reason);
}
export function undo() {
  const previous = history.pop();
  if (!previous) return false;
  future.push(structuredClone(state.board));
  state.board = previous;
  saveListener("saving"); saveNow(); notify("history"); return true;
}
export function redo() {
  const next = future.pop();
  if (!next) return false;
  history.push(structuredClone(state.board));
  state.board = next;
  saveListener("saving"); saveNow(); notify("history"); return true;
}
export function newNode(partial) {
  return {
    id: uid("node"), type: "text", title: "Untitled", description: "", content: "",
    x: 0, y: 0, w: 260, h: 160, category: "", tags: [], groupId: null,
    color: "#ff715b", rotation: 0, createdAt: Date.now(), ...partial,
  };
}
export function addNode(partial) {
  const node = newNode(partial);
  snapshot(); state.board.nodes.push(node); commit("nodes", false); return node;
}
export function getNode(id) { return state.board.nodes.find((node) => node.id === id); }
export function removeSelected() {
  const ids = new Set(state.selected);
  if (!ids.size && !state.selectedEdge) return false;
  snapshot();
  state.board.nodes = state.board.nodes.filter((node) => !ids.has(node.id));
  state.board.groups = state.board.groups.filter((group) => !ids.has(group.id));
  state.board.axes = state.board.axes.filter((axis) => !ids.has(axis.id));
  state.board.nodes.forEach((node) => { if (ids.has(node.groupId)) node.groupId = null; });
  state.board.edges = state.board.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to) && edge.id !== state.selectedEdge);
  state.selected.clear(); state.selectedEdge = null; commit("delete", false); return true;
}
