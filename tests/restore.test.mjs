import assert from "node:assert/strict";
import { installBrowserStorage } from "./idb-stub.mjs";

installBrowserStorage();
const { makeZip } = await import("../js/zip.js");
const { applyBoardBackup, readBoardBackup } = await import("../js/restore.js");
const { loadBoard, state, historyEntries } = await import("../js/state.js");

const exported = {
  id: "exported", title: "Restored research", viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
  nodes: [{ id: "n1", type: "image", title: "Map", content: "", description: "", assetId: "old-asset", x: 10, y: 20, w: 200, h: 140, tags: [] }],
  groups: [], axes: [], edges: [],
  assetManifest: [{ id: "old-asset", name: "map.txt", originalName: "map.txt", type: "text/plain", size: 9 }],
};
const blob = await makeZip([{ name: "board.json", data: JSON.stringify(exported) }, { name: "assets/map.txt", data: "map bytes" }]);
Object.defineProperty(blob, "name", { value: "backup.zip" });
const bundle = await readBoardBackup(blob);
assert.equal(bundle.board.title, "Restored research");
assert.equal(bundle.assets.length, 1);
assert.equal(await bundle.assets[0].blob.text(), "map bytes");

await loadBoard();
await applyBoardBackup(bundle, "new");
assert.equal(state.board.title, "Restored research");
assert.equal(state.board.nodes.length, 1);
assert.notEqual(state.board.nodes[0].assetId, "old-asset");

const merge = structuredClone(bundle); merge.assets = [];
merge.board.nodes[0].assetId = null;
await applyBoardBackup(merge, "merge");
assert.equal(state.board.nodes.length, 2);
assert.notEqual(state.board.nodes[0].id, state.board.nodes[1].id);

await applyBoardBackup(merge, "replace");
assert.equal(state.board.nodes.length, 1);
assert.ok(historyEntries().some((entry) => entry.reason === "Before backup restore"));
