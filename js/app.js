import { InfiniteCanvas } from "./canvas.js";
import { createAxis } from "./axes.js";
import { exportBoard } from "./exporter.js";
import { createGroup } from "./groups.js";
import { importFiles } from "./importer.js";
import { editTextNode, renderInspector } from "./inspector.js";
import { captureRegion } from "./screenshot.js";
import { addNode, commit, loadBoard, onSaveStatus, redo, removeSelected, snapshot, state, subscribe, undo } from "./state.js";
import { openModal, promptDialog, toast } from "./ui.js";
import { $, $$, csvList, escapeHtml, isTypingTarget } from "./utils.js";

let canvas;
let pendingImportPoint = null;

function selectionChanged() {
  renderInspector($("#inspector"), () => canvas.refresh("inspector-live"), deleteSelection);
}

function deleteSelection() {
  if (removeSelected()) { canvas.refresh("delete"); toast("Removed from board"); }
}

function selectNode(node) {
  state.selected.clear(); state.selected.add(node.id); state.selectedEdge = null; canvas.refresh("create");
}

async function createText(point, type = "text") {
  const content = await promptDialog({ title: type === "markdown" ? "Create Markdown card" : "Create text card", label: type === "markdown" ? "Markdown" : "Text", multiline: true, placeholder: type === "markdown" ? "# Heading\n\nWrite with **Markdown**" : "Write a note…", confirmLabel: "Create" });
  if (content === null) return;
  const firstLine = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 42) || "Untitled";
  const node = addNode({ type, title: firstLine, content, x: point.x, y: point.y, w: 300, h: 180 }); selectNode(node);
}

function chooseUpload(point) { pendingImportPoint = point; $("#file-input").click(); }

function showCreateMenu(point = canvas.viewportCenter()) {
  const content = document.createElement("div"); content.className = "create-menu";
  content.innerHTML = `<button class="create-choice" data-create="text"><strong>Text card</strong><span>A quick editable note.</span></button><button class="create-choice" data-create="markdown"><strong>Markdown card</strong><span>Headings, emphasis, lists, and links.</span></button><button class="create-choice" data-create="upload"><strong>Upload assets</strong><span>Images, text, or Markdown files.</span></button><button class="create-choice" data-create="axis"><strong>Era axis</strong><span>A horizontal or vertical timeline.</span></button>`;
  const modal = openModal({ title: "Create on board", content });
  content.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-create]")?.dataset.create; if (!choice) return; modal.close();
    if (choice === "text" || choice === "markdown") createText(point, choice);
    if (choice === "upload") chooseUpload(point);
    if (choice === "axis") showAxisDialog(point);
  });
}

function showAxisDialog(point = canvas.viewportCenter()) {
  const form = document.createElement("div");
  form.innerHTML = `<div class="field"><label>Axis label</label><input data-axis-label value="Timeline" /></div><div class="field"><label>Orientation</label><select data-axis-orientation><option value="x">Horizontal</option><option value="y">Vertical</option></select></div><div class="field"><label>Eras or stages — comma separated</label><textarea data-axis-eras placeholder="Ancient, Medieval, Modern">Ancient, Medieval, Modern</textarea></div>`;
  openModal({ title: "Add an era axis", content: form, actions: [{ label: "Cancel", onClick: () => null }, { label: "Add axis", className: "primary", onClick: (body) => { const axis = createAxis({ x: point.x, y: point.y, label: $("[data-axis-label]", body).value.trim() || "Timeline", orientation: $("[data-axis-orientation]", body).value, eras: csvList($("[data-axis-eras]", body).value) }); canvas.refresh("axis"); return axis; } }] });
}

function createSelectedGroup() {
  const nodeIds = [...state.selected].filter((id) => state.board.nodes.some((node) => node.id === id));
  if (!nodeIds.length) return toast("Select assets first", "Choose one or more cards, then create a group.", "error");
  createGroup(nodeIds, nodeIds.length === 1 ? "New group" : `${nodeIds.length} related items`); canvas.refresh("group");
}

function setTool(tool) {
  if (tool === "group") return createSelectedGroup();
  if (tool === "axis") return showAxisDialog();
  canvas.setTool(tool);
}

function bindToolbar() {
  $$(".tool").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#create-fab").onclick = () => showCreateMenu();
  $("#import-btn").onclick = () => chooseUpload(canvas.viewportCenter());
  $("#export-btn").onclick = () => exportBoard().catch((error) => toast("Export failed", error.message, "error"));
  $("#undo-btn").onclick = () => { if (undo()) canvas.refresh("history"); };
  $("#redo-btn").onclick = () => { if (redo()) canvas.refresh("history"); };
  $("#zoom-in").onclick = () => canvas.zoomBy(1.2); $("#zoom-out").onclick = () => canvas.zoomBy(1 / 1.2);
  $("#zoom-reset").onclick = () => canvas.resetZoom(); $("#zoom-fit").onclick = () => canvas.fitBoard();
  $("#board-title").addEventListener("focus", () => snapshot());
  $("#board-title").addEventListener("input", (event) => { state.board.title = event.target.value; commit("title", false); });
  $("#file-input").addEventListener("change", async (event) => { if (event.target.files.length) await importFiles(event.target.files, pendingImportPoint || canvas.viewportCenter()); event.target.value = ""; pendingImportPoint = null; canvas.refresh("import"); });
}

function bindDragDrop() {
  const viewport = $("#viewport");
  ["dragenter", "dragover"].forEach((type) => viewport.addEventListener(type, (event) => { if ([...event.dataTransfer.types].includes("Files")) { event.preventDefault(); viewport.classList.add("drag-over"); } }));
  ["dragleave", "drop"].forEach((type) => viewport.addEventListener(type, (event) => { event.preventDefault(); viewport.classList.remove("drag-over"); }));
  viewport.addEventListener("drop", async (event) => { const point = canvas.screenToWorld({ x: event.clientX, y: event.clientY }); await importFiles(event.dataTransfer.files, point); canvas.refresh("import"); });
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !isTypingTarget(event.target)) { event.preventDefault(); canvas.setSpace(true); }
    if (isTypingTarget(event.target)) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); canvas.refresh("history"); return; }
    if (command && event.key.toLowerCase() === "g") { event.preventDefault(); createSelectedGroup(); return; }
    if (["Backspace", "Delete"].includes(event.key)) { event.preventDefault(); deleteSelection(); return; }
    const toolKeys = { v: "select", h: "hand", c: "connect" };
    if (toolKeys[event.key.toLowerCase()]) setTool(toolKeys[event.key.toLowerCase()]);
    if (event.key.toLowerCase() === "g") createSelectedGroup();
    if (event.key.toLowerCase() === "a") showAxisDialog();
    if (event.key.toLowerCase() === "n") showCreateMenu();
    if (event.key === "0") canvas.fitBoard();
  });
  document.addEventListener("keyup", (event) => { if (event.code === "Space") canvas.setSpace(false); });
}

async function start() {
  await loadBoard(); $("#board-title").value = state.board.title;
  canvas = new InfiniteCanvas({ onSelection: selectionChanged, onCreate: showCreateMenu, onCapture: (region) => captureRegion(region).catch((error) => toast("Capture failed", error.message, "error")), onEditNode: (node) => node.type !== "image" && editTextNode(node, () => canvas.refresh("edit")) });
  onSaveStatus((status) => { const element = $("#save-status"); element.textContent = status === "saving" ? "Saving locally…" : "Saved locally"; element.classList.toggle("saving", status === "saving"); });
  bindToolbar(); bindDragDrop(); bindKeyboard(); subscribe((reason) => { if (reason === "history") $("#board-title").value = state.board.title; }); canvas.init();
  if (!state.board.nodes.length && !state.board.axes.length) toast("Board ready", "Double-click, right-click, or long-press anywhere to create.");
}

start().catch((error) => { document.body.innerHTML = `<main style="padding:2rem;color:white"><h1>Infinite Whiteboard could not start</h1><p>${escapeHtml(error.message)}</p></main>`; });
