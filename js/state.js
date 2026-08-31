import { assetDb, boardDb, historyDb } from "./database.js";
import { uid } from "./utils.js";

const listeners = new Set();
const history = [];
const future = [];
let saveListener = () => {};
const pendingSaves = new Map();
const historyTimers = new Map();
const CURRENT_BOARD_KEY = "infinite-whiteboard-current-board";
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

export function emptyBoard(id = uid("board"), title = "Untitled board") {
  return {
    id,
    title,
    version: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    viewport: { x: innerWidth / 2, y: innerHeight / 2, zoom: 1 },
    nodes: [], edges: [], groups: [], axes: [],
    settings: { connectionType: "curved" },
  };
}

export function normalizeBoard(board) {
  const normalized = board && typeof board === "object" ? board : emptyBoard();
  normalized.id ||= uid("board");
  normalized.title = String(normalized.title || "Untitled board");
  normalized.version = 2;
  normalized.createdAt ||= normalized.updatedAt || Date.now();
  normalized.updatedAt ||= Date.now();
  normalized.viewport = { x: innerWidth / 2, y: innerHeight / 2, zoom: 1, ...(normalized.viewport || {}) };
  ["nodes", "edges", "groups", "axes"].forEach((key) => { if (!Array.isArray(normalized[key])) normalized[key] = []; });
  normalized.archivedAt ||= null;
  normalized.settings = { connectionType: "curved", ...(normalized.settings || {}) };
  normalized.nodes.forEach((node) => {
    if (!Number.isFinite(node.rotation)) node.rotation = 0;
    node.color = legacyPalette.get(node.color?.toLowerCase()) || node.color || "#ff715b";
    node.tags = Array.isArray(node.tags) ? node.tags : [];
  });
  [...normalized.groups, ...normalized.axes].forEach((item) => {
    item.color = legacyPalette.get(item.color?.toLowerCase()) || item.color;
    item.tags = Array.isArray(item.tags) ? item.tags : [];
  });
  normalized.edges.forEach((edge) => { edge.tags = Array.isArray(edge.tags) ? edge.tags : []; });
  return normalized;
}

async function hydrateHistory(boardId) {
  const record = await historyDb.get(boardId).catch(() => null);
  history.length = 0; future.length = 0;
  if (!record) return;
  history.push(...(record.past || []).map(normalizeHistoryEntry).filter(Boolean));
  future.push(...(record.future || []).map(normalizeHistoryEntry).filter(Boolean));
}

function normalizeHistoryEntry(entry) {
  const board = entry?.board || entry;
  if (!board?.id) return null;
  return { id: entry.id || uid("version"), at: entry.at || board.updatedAt || Date.now(), reason: entry.reason || "Change", label: entry.label || "", board };
}

export async function loadBoard(id = localStorage.getItem(CURRENT_BOARD_KEY)) {
  let board = id ? await boardDb.get(id) : null;
  if (!board) {
    const boards = await boardDb.all();
    board = boards.find((item) => !item.archivedAt) || boards[0] || await createInitialBoard();
  }
  state.board = normalizeBoard(board);
  localStorage.setItem(CURRENT_BOARD_KEY, state.board.id);
  state.selected.clear(); state.selectedEdge = null;
  await hydrateHistory(state.board.id);
  return state.board;
}

async function createInitialBoard() {
  const board = emptyBoard("default");
  await boardDb.put(board);
  return board;
}

function scheduleSave(board) {
  const copy = structuredClone(board); copy.updatedAt = Date.now(); board.updatedAt = copy.updatedAt;
  const current = pendingSaves.get(copy.id); if (current) clearTimeout(current.timer);
  const timer = setTimeout(() => writeBoard(copy.id), 450);
  pendingSaves.set(copy.id, { timer, board: copy });
}

async function writeBoard(id) {
  const pending = pendingSaves.get(id); if (!pending) return;
  pendingSaves.delete(id);
  try {
    await boardDb.put(pending.board);
    if (state.board?.id === id) saveListener("saved");
  } catch (error) {
    if (state.board?.id === id) saveListener("error", error);
  }
}

export async function flushBoardSave(id = state.board?.id) {
  const pending = pendingSaves.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  await writeBoard(id);
}

function persistHistory(boardId = state.board?.id) {
  if (!boardId) return;
  clearTimeout(historyTimers.get(boardId));
  const record = { id: boardId, past: structuredClone(history), future: structuredClone(future), updatedAt: Date.now() };
  historyTimers.set(boardId, setTimeout(async () => {
    historyTimers.delete(boardId);
    try { await historyDb.put(record); }
    catch (error) { if (state.board?.id === boardId) saveListener("error", error); }
  }, 250));
}

export function onSaveStatus(listener) { saveListener = listener; }
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function notify(reason = "update") { listeners.forEach((listener) => listener(reason)); }
export function snapshot(reason = "Change", label = "") {
  history.push({ id: uid("version"), at: Date.now(), reason, label, board: structuredClone(state.board) });
  if (history.length > 80) history.shift();
  future.length = 0;
  persistHistory();
}
export function commit(reason = "update", record = true) {
  if (record) snapshot(reason);
  else if (history.at(-1)?.reason === "Change") history.at(-1).reason = reason;
  saveListener("saving");
  scheduleSave(state.board);
  persistHistory();
  notify(reason);
}
export function undo() {
  const previous = history.pop();
  if (!previous) return false;
  future.push({ id: uid("version"), at: Date.now(), reason: "Redo point", board: structuredClone(state.board) });
  state.board = normalizeBoard(structuredClone(previous.board));
  saveListener("saving"); scheduleSave(state.board); persistHistory(); notify("history"); return true;
}
export function redo() {
  const next = future.pop();
  if (!next) return false;
  history.push({ id: uid("version"), at: Date.now(), reason: "Undo point", board: structuredClone(state.board) });
  state.board = normalizeBoard(structuredClone(next.board));
  saveListener("saving"); scheduleSave(state.board); persistHistory(); notify("history"); return true;
}

export function historyEntries() {
  return history.map(({ id, at, reason, label }) => ({ id, at, reason, label })).reverse();
}

export function createCheckpoint(label = "Manual checkpoint") {
  snapshot("Checkpoint", label.trim() || "Manual checkpoint");
  return history.at(-1).id;
}

export function restoreHistoryEntry(id) {
  const entry = history.find((item) => item.id === id);
  if (!entry) return false;
  snapshot("Before history restore");
  state.board = normalizeBoard(structuredClone(entry.board));
  commit("history-restore", false); notify("history"); return true;
}

export async function listBoards({ includeArchived = true } = {}) {
  const boards = (await boardDb.all()).map(normalizeBoard);
  return boards.filter((board) => includeArchived || !board.archivedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function openBoard(id) {
  if (state.board?.id === id) return state.board;
  await flushBoardSave();
  const board = await boardDb.get(id);
  if (!board) throw new Error("That board could not be found.");
  state.board = normalizeBoard(board); state.selected.clear(); state.selectedEdge = null;
  localStorage.setItem(CURRENT_BOARD_KEY, id); await hydrateHistory(id); notify("board"); return state.board;
}

export async function createBoard(title = "Untitled board", source = null) {
  await flushBoardSave();
  const board = normalizeBoard(source ? structuredClone(source) : emptyBoard());
  board.id = uid("board"); board.title = title.trim() || source?.title || "Untitled board";
  board.createdAt = Date.now(); board.updatedAt = Date.now(); board.archivedAt = null;
  await boardDb.put(board); await historyDb.delete(board.id).catch(() => {});
  return openBoard(board.id);
}

export async function duplicateBoard(id) {
  const source = await boardDb.get(id);
  if (!source) throw new Error("That board could not be found.");
  return createBoard(`${source.title} copy`, source);
}

export async function archiveBoard(id, archived = true) {
  await flushBoardSave(id);
  const board = await boardDb.get(id); if (!board) return false;
  board.archivedAt = archived ? Date.now() : null; board.updatedAt = Date.now(); await boardDb.put(board);
  if (state.board?.id === id) state.board.archivedAt = board.archivedAt;
  notify("boards"); return true;
}

export async function deleteBoard(id) {
  await flushBoardSave();
  const boards = await listBoards();
  if (boards.length <= 1) throw new Error("At least one board must remain.");
  await flushBoardSave(id); clearTimeout(historyTimers.get(id)); historyTimers.delete(id); await boardDb.delete(id); await historyDb.delete(id);
  const remaining = boards.filter((board) => board.id !== id);
  const referencedAssets = new Set(remaining.flatMap((board) => board.nodes.filter((node) => node.assetId).map((node) => node.assetId)));
  const assets = await assetDb.all(); await Promise.all(assets.filter((asset) => !referencedAssets.has(asset.id)).map((asset) => assetDb.delete(asset.id)));
  if (state.board?.id === id) await openBoard((remaining.find((board) => !board.archivedAt) || remaining[0]).id);
  notify("boards"); return true;
}

export async function replaceCurrentBoard(board) {
  snapshot("Before backup restore");
  const id = state.board.id; const createdAt = state.board.createdAt;
  state.board = normalizeBoard(structuredClone(board)); state.board.id = id; state.board.createdAt = createdAt;
  state.board.updatedAt = Date.now(); state.selected.clear(); state.selectedEdge = null;
  commit("restore", false); await flushBoardSave(id); notify("board"); return state.board;
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
