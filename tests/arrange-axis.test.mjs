import assert from "node:assert/strict";

globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;

const { state } = await import("../js/state.js");
const { distributeSelection, snapAdjustment } = await import("../js/arrange.js");
const { attachNodeToAxis, reflowAxis } = await import("../js/axis-bindings.js");
const { isEffectivelyHidden } = await import("../js/item-tree.js");

const node = (id, x, w = 100) => ({ id, type: "text", title: id, content: id, x, y: 40, w, h: 80, tags: [], groupId: null, locked: false, hidden: false });
const a = node("a", 0); const b = node("b", 170); const c = node("c", 410);
state.board = {
  id: "arrange", title: "Arrange", viewport: { x: 0, y: 0, zoom: 1 },
  settings: { snapEnabled: true, snapDistance: 8 }, nodes: [a, b, c], edges: [], groups: [], axes: [], bookmarks: [],
};
state.selected = new Set(["a", "b", "c"]);
assert.equal(distributeSelection("x"), 3);
assert.equal(b.x - (a.x + a.w), c.x - (b.x + b.w), "distribution creates equal gaps");

state.selected = new Set(["a"]);
const snap = snapAdjustment([a], 100, 0, { zoom: 1 });
assert.equal(a.x + snap.dx + a.w, b.x, "dragging snaps one card edge to another");
assert.ok(snap.guides.some((guide) => guide.axis === "x"));

const axis = { id: "timeline", x: 0, y: 300, orientation: "x", mode: "eras", eras: ["Past", "Now", "Future"], length: 800, hidden: false };
state.board.axes.push(axis);
attachNodeToAxis(a, axis, "Now", true);
assert.equal(a.x + a.w / 2, 400);
axis.length = 1000; reflowAxis(axis.id);
assert.equal(a.x + a.w / 2, 500, "bound cards follow axis length changes");

const frame = { id: "frame", x: 0, y: 0, w: 300, h: 200, parentId: null, collapsed: true, hidden: false, locked: false };
state.board.groups.push(frame); a.groupId = frame.id;
assert.equal(isEffectivelyHidden(a), true, "collapsed frames hide their contents without deleting them");

process.exit(0);
