import assert from "node:assert/strict";
import { installBrowserStorage } from "./idb-stub.mjs";

installBrowserStorage();
const first = await import("../js/state.js");
await first.loadBoard();
assert.equal(first.state.board.id, "default");

await first.createBoard("Research board");
const researchId = first.state.board.id;
assert.equal((await first.listBoards()).length, 2);

first.createCheckpoint("Before edits");
first.snapshot(); first.state.board.title = "Edited research"; first.commit("title", false);
await first.flushBoardSave();
assert.equal(first.undo(), true);
assert.equal(first.state.board.title, "Research board");
assert.equal(first.redo(), true);
assert.equal(first.state.board.title, "Edited research");
await first.flushBoardSave();

await new Promise((resolve) => setTimeout(resolve, 350));
localStorage.setItem("infinite-whiteboard-current-board", researchId);
const second = await import("../js/state.js?reload=1");
await second.loadBoard();
assert.equal(second.state.board.title, "Edited research");
assert.ok(second.historyEntries().some((entry) => entry.label === "Before edits"));

await second.duplicateBoard(researchId);
assert.equal((await second.listBoards()).length, 3);
assert.match(second.state.board.title, /copy$/);
