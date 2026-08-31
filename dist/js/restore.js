import { assetDb } from "./database.js";
import { commit, createBoard, normalizeBoard, replaceCurrentBoard, snapshot, state } from "./state.js";
import { uid } from "./utils.js";
import { readZip } from "./zip.js";

const decoder = new TextDecoder();

function parseBoard(text) {
  let board;
  try { board = JSON.parse(text); } catch { throw new Error("board.json is not valid JSON."); }
  if (!board || typeof board !== "object") throw new Error("The backup does not contain a board.");
  for (const key of ["nodes", "edges", "groups", "axes"]) if (board[key] !== undefined && !Array.isArray(board[key])) throw new Error(`Invalid board field: ${key}.`);
  return normalizeBoard(board);
}

export async function readBoardBackup(file) {
  if (/\.json$/i.test(file.name)) return { board: parseBoard(await file.text()), assets: [] };
  const entries = await readZip(file); const boardBytes = entries.get("board.json");
  if (!boardBytes) throw new Error("This ZIP does not contain board.json.");
  const board = parseBoard(decoder.decode(boardBytes)); const manifest = Array.isArray(board.assetManifest) ? board.assetManifest : [];
  const assets = manifest.map((item) => {
    const bytes = entries.get(`assets/${item.name}`); if (!bytes) return null;
    return { oldId: item.id, name: item.originalName || item.name, type: item.type || "application/octet-stream", blob: new Blob([bytes], { type: item.type || "application/octet-stream" }) };
  }).filter(Boolean);
  delete board.assetManifest;
  return { board, assets };
}

function prepareBackup(bundle) {
  const assetIds = new Map(bundle.assets.map((asset) => [asset.oldId, uid("asset")]));
  const board = structuredClone(bundle.board);
  board.nodes.forEach((node) => { if (node.assetId) node.assetId = assetIds.get(node.assetId) || null; });
  const assets = bundle.assets.map((asset) => ({ ...asset, id: assetIds.get(asset.oldId) }));
  return { board, assets };
}

async function storeAssets(assets, boardId) {
  await Promise.all(assets.map((asset) => assetDb.put({ id: asset.id, boardId, name: asset.name, type: asset.type, size: asset.blob.size, blob: asset.blob, createdAt: Date.now() })));
}

function mergeIntoCurrent(imported) {
  const nodeIds = new Map(imported.nodes.map((item) => [item.id, uid("node")]));
  const groupIds = new Map(imported.groups.map((item) => [item.id, uid("group")]));
  const axisIds = new Map(imported.axes.map((item) => [item.id, uid("axis")]));
  const offset = 36;
  const groups = imported.groups.map((item) => ({ ...item, id: groupIds.get(item.id), parentId: groupIds.get(item.parentId) || null, x: item.x + offset, y: item.y + offset }));
  const nodes = imported.nodes.map((item) => ({ ...item, id: nodeIds.get(item.id), groupId: groupIds.get(item.groupId) || null, axisBinding: item.axisBinding && axisIds.has(item.axisBinding.axisId) ? { ...item.axisBinding, axisId: axisIds.get(item.axisBinding.axisId) } : null, x: item.x + offset, y: item.y + offset }));
  const axes = imported.axes.map((item) => ({ ...item, id: axisIds.get(item.id), x: item.x + offset, y: item.y + offset }));
  const edges = imported.edges.filter((item) => nodeIds.has(item.from) && nodeIds.has(item.to)).map((item) => ({ ...item, id: uid("edge"), from: nodeIds.get(item.from), to: nodeIds.get(item.to) }));
  snapshot("Before backup merge"); state.board.groups.push(...groups); state.board.nodes.push(...nodes); state.board.axes.push(...axes); state.board.edges.push(...edges);
  state.selected.clear(); nodes.forEach((item) => state.selected.add(item.id)); axes.forEach((item) => state.selected.add(item.id));
  commit("backup-merge", false);
  return nodes.length + groups.length + axes.length;
}

export async function applyBoardBackup(bundle, mode = "new") {
  const prepared = prepareBackup(bundle);
  if (mode === "new") {
    await createBoard(prepared.board.title, prepared.board); await storeAssets(prepared.assets, state.board.id);
    return { board: state.board, itemCount: state.board.nodes.length + state.board.groups.length + state.board.axes.length, assetCount: prepared.assets.length };
  }
  if (mode === "replace") {
    await storeAssets(prepared.assets, state.board.id); await replaceCurrentBoard(prepared.board);
    return { board: state.board, itemCount: state.board.nodes.length + state.board.groups.length + state.board.axes.length, assetCount: prepared.assets.length };
  }
  if (mode === "merge") {
    await storeAssets(prepared.assets, state.board.id); const itemCount = mergeIntoCurrent(prepared.board);
    return { board: state.board, itemCount, assetCount: prepared.assets.length };
  }
  throw new Error("Unknown restore mode.");
}
