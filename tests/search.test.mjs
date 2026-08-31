import assert from "node:assert/strict";
import { searchBoard, searchFacets } from "../js/search.js";

const board = {
  nodes: [
    { id: "n1", type: "markdown", title: "Roman Republic", content: "Political institutions and consuls", description: "", category: "History", tags: ["Rome", "Politics"] },
    { id: "n2", type: "image", title: "Forum", description: "Historic site", content: "", category: "Places", tags: ["Rome"] },
  ],
  groups: [{ id: "g1", title: "Primary sources", description: "Documents", category: "Research", tags: ["Sources"] }],
  axes: [{ id: "a1", label: "Roman eras", eras: ["Kingdom", "Republic", "Empire"] }],
  edges: [{ id: "e1", from: "n1", to: "n2", label: "located at", category: "Evidence", tags: ["Relation"] }],
};

assert.deepEqual(searchBoard(board, { query: "political consuls" }).map((item) => item.id), ["n1"]);
assert.deepEqual(searchBoard(board, { tag: "rome", type: "image" }).map((item) => item.id), ["n2"]);
assert.deepEqual(searchBoard(board, { category: "evidence" }).map((item) => item.id), ["e1"]);
assert.deepEqual(searchBoard(board, { query: "empire" }).map((item) => item.id), ["a1"]);
const facets = searchFacets(board);
assert.ok(facets.types.includes("connection"));
assert.ok(facets.tags.includes("Sources"));
