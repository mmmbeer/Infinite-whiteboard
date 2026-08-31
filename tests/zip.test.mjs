import assert from "node:assert/strict";
import { makeZip, readZip } from "../js/zip.js";

const zip = await makeZip([
  { name: "board.json", data: JSON.stringify({ title: "Backup" }) },
  { name: "assets/note.txt", data: "portable asset" },
]);
const entries = await readZip(zip);
assert.equal(new TextDecoder().decode(entries.get("board.json")), '{"title":"Backup"}');
assert.equal(new TextDecoder().decode(entries.get("assets/note.txt")), "portable asset");
