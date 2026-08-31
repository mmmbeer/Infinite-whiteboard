import assert from "node:assert/strict";

Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {}, readText: async () => "" } } });
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;

const { state } = await import("../js/state.js");
const { copySelection, cutSelection, duplicateSelection, pasteSelection } = await import("../js/clipboard.js");

const node = (id, x, groupId = null) => ({ id, type: "text", title: id, content: id, x, y: 20, w: 200, h: 100, groupId, tags: [] });
state.board = {
  id: "default", title: "Test", viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
  nodes: [node("a", 10, "g"), node("b", 240, "g"), node("c", 500)],
  groups: [{ id: "g", title: "Group", x: 0, y: 0, w: 470, h: 160 }],
  axes: [], edges: [{ id: "e", from: "a", to: "b", fromAnchor: "e", toAnchor: "w" }],
};

state.selected = new Set(["g"]);
assert.equal(copySelection(), 3, "copying a group includes its member nodes");
assert.equal(await pasteSelection(), 3, "pasting restores the group and its two members");
assert.equal(state.board.groups.length, 2);
assert.equal(state.board.nodes.length, 5);
assert.equal(state.board.edges.length, 2, "internal connections are preserved");
const pastedGroup = state.board.groups.at(-1);
assert.equal(state.board.nodes.filter((item) => item.groupId === pastedGroup.id).length, 2);

state.selected = new Set(["c"]);
assert.equal(duplicateSelection(), 1);
assert.equal(state.board.nodes.length, 6);
assert.notEqual(state.board.nodes.at(-1).id, "c");

state.selected = new Set(["g"]);
assert.equal(cutSelection(), 3);
assert.equal(state.board.groups.some((item) => item.id === "g"), false);
assert.equal(state.board.nodes.some((item) => ["a", "b"].includes(item.id)), false);
assert.equal(state.board.edges.some((item) => item.id === "e"), false);

state.board.nodes = [node("nested", 30, "child")];
state.board.groups = [
  { id: "parent", title: "Parent", x: 0, y: 0, w: 400, h: 300, parentId: null },
  { id: "child", title: "Child", x: 20, y: 20, w: 260, h: 180, parentId: "parent" },
];
state.board.axes = []; state.board.edges = []; state.selected = new Set(["parent"]);
assert.equal(copySelection(), 3, "copying a frame includes nested frames and their cards");
assert.equal(await pasteSelection(), 3);
const nestedCopy = state.board.groups.at(-1); const parentCopy = state.board.groups.at(-2);
assert.equal(nestedCopy.parentId, parentCopy.id, "nested frame hierarchy is remapped on paste");
assert.equal(state.board.nodes.at(-1).groupId, nestedCopy.id);

process.exit(0);
