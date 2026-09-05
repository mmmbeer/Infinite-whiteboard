import { InfiniteCanvas } from "./canvas.js";
import { createAxis } from "./axes.js";
import { copySelection, cutSelection, duplicateSelection, pasteSelection } from "./clipboard.js";
import { exportBoard } from "./exporter.js";
import { createGroup } from "./groups.js";
import { importFiles } from "./importer.js";
import { editTextNode, renderInspector } from "./inspector.js";
import { openMarkdownEditor } from "./markdown-editor.js";
import { captureRegion } from "./screenshot.js";
import { addNode, canRedo, canUndo, commit, getNode, loadBoard, onSaveStatus, redo, removeSelected, snapshot, state, subscribe, undo } from "./state.js";
import { closeContextMenu, openContextMenu, openModal, promptDialog, toast } from "./ui.js";
import { $, $$, csvList, escapeHtml, isTypingTarget } from "./utils.js";
import { restoreBoardFile, showBoardManager, showSearch } from "./workspace.js";
import { alignSelection, autoLayoutSelection, distributeSelection } from "./arrange.js";
import { reorderSelected, setSelectedState, toggleGroupCollapse, translateSelection } from "./item-actions.js";
import { showBookmarks } from "./navigation.js";
import { showLayers } from "./layers.js";
import { getGroup, getItem, isEffectivelyHidden, topLevelSelection } from "./item-tree.js";
import { showTutorial, showTutorialOnce } from "./tutorial.js";

let canvas;
let pendingImportPoint = null;

function selectionChanged() {
  renderInspector($("#inspector"), () => canvas.refresh("inspector-live"), deleteSelection, duplicateItems);
  updateActionStates();
}

function deleteSelection() {
  if (removeSelected()) { canvas.refresh("delete"); toast("Removed from board"); }
}

function selectNode(node) {
  state.selected.clear(); state.selected.add(node.id); state.selectedEdge = null; canvas.refresh("create");
}

async function createText(point, type = "text") {
  const content = type === "markdown"
    ? await openMarkdownEditor({ title: "Create Markdown card", confirmLabel: "Create" })
    : await promptDialog({ title: "Create text card", label: "Text", multiline: true, placeholder: "Write a note…", confirmLabel: "Create" });
  if (content === null) return;
  const firstLine = content.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 42) || "Untitled";
  const node = addNode({ type, title: firstLine, content, x: point.x, y: point.y, w: 300, h: 180 }); selectNode(node);
}

function chooseUpload(point) { pendingImportPoint = point; $("#file-input").click(); }

function showCreateMenu(point = canvas.viewportCenter()) {
  const content = document.createElement("div"); content.className = "create-menu";
  content.innerHTML = `<button class="create-choice" data-create="text"><strong>Text card</strong><span>A quick editable note.</span></button><button class="create-choice" data-create="markdown"><strong>Markdown card</strong><span>Headings, emphasis, lists, and links.</span></button><button class="create-choice" data-create="upload"><strong>Upload assets</strong><span>Images, text, or Markdown files.</span></button><button class="create-choice" data-create="axis"><strong>Era or value axis</strong><span>A functional horizontal or vertical scale.</span></button><button class="create-choice" data-create="frame"><strong>Empty frame</strong><span>A resizable section for nested content.</span></button>`;
  const modal = openModal({ title: "Create on board", content });
  content.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-create]")?.dataset.create; if (!choice) return; modal.close();
    if (choice === "text" || choice === "markdown") createText(point, choice);
    if (choice === "upload") chooseUpload(point);
    if (choice === "axis") showAxisDialog(point);
    if (choice === "frame") { createGroup([], "New frame", point); canvas.refresh("group"); }
  });
}

function showAxisDialog(point = canvas.viewportCenter()) {
  const form = document.createElement("div");
  form.innerHTML = `<div class="field"><label>Axis label</label><input data-axis-label value="Timeline" /></div><div class="field-row"><div class="field"><label>Orientation</label><select data-axis-orientation><option value="x">Horizontal</option><option value="y">Vertical</option></select></div><div class="field"><label>Scale</label><select data-axis-mode><option value="eras">Eras / stages</option><option value="number">Numeric values</option></select></div></div><div class="field" data-era-fields><label>Eras or stages — comma separated</label><textarea data-axis-eras placeholder="Ancient, Medieval, Modern">Ancient, Medieval, Modern</textarea></div><div class="field-row hidden" data-number-fields><div class="field"><label>Minimum</label><input type="number" data-axis-min value="0" /></div><div class="field"><label>Maximum</label><input type="number" data-axis-max value="100" /></div><div class="field"><label>Step</label><input type="number" data-axis-step value="25" /></div></div>`;
  form.querySelector("[data-axis-mode]").addEventListener("change", (event) => { form.querySelector("[data-era-fields]").classList.toggle("hidden", event.target.value === "number"); form.querySelector("[data-number-fields]").classList.toggle("hidden", event.target.value !== "number"); });
  openModal({ title: "Add an axis", content: form, actions: [{ label: "Cancel", onClick: () => null }, { label: "Add axis", className: "primary", onClick: (body) => { const axis = createAxis({ x: point.x, y: point.y, label: $("[data-axis-label]", body).value.trim() || "Timeline", orientation: $("[data-axis-orientation]", body).value, mode: $("[data-axis-mode]", body).value, eras: csvList($("[data-axis-eras]", body).value), min: Number($("[data-axis-min]", body).value), max: Number($("[data-axis-max]", body).value), step: Number($("[data-axis-step]", body).value) }); canvas.refresh("axis"); return axis; } }] });
}

function showSettings() {
  const form = document.createElement("div");
  const current = state.board.settings?.connectionType || "curved";
  form.innerHTML = `<div class="field"><label>Default connection type</label><select data-connection-type><option value="curved" ${current === "curved" ? "selected" : ""}>Curved</option><option value="straight" ${current === "straight" ? "selected" : ""}>Straight</option></select></div><label class="check-field"><input type="checkbox" data-snap-enabled ${state.board.settings.snapEnabled !== false ? "checked" : ""}/> Alignment snapping</label><label class="check-field"><input type="checkbox" data-grid-snap ${state.board.settings.gridSnap ? "checked" : ""}/> Snap to dot grid</label><label class="check-field"><input type="checkbox" data-axis-snap ${state.board.settings.axisSnap !== false ? "checked" : ""}/> Attach cards dropped on axis ticks</label><div class="field"><label>Snap distance</label><input type="number" min="2" max="30" data-snap-distance value="${state.board.settings.snapDistance || 8}" /></div><p class="modal-copy">Hold Alt while dragging to temporarily bypass snapping.</p><div class="settings-tour"><p>Replay the guided tour of canvas gestures and board features.</p><button type="button" class="button" data-open-tutorial>View tutorial</button></div>`;
  const modal = openModal({ title: "Board settings", content: form, actions: [
    { label: "Cancel", onClick: () => null },
    { label: "Save settings", className: "primary", onClick: (body) => { snapshot(); Object.assign(state.board.settings, { connectionType: $("[data-connection-type]", body).value, snapEnabled: $("[data-snap-enabled]", body).checked, gridSnap: $("[data-grid-snap]", body).checked, axisSnap: $("[data-axis-snap]", body).checked, snapDistance: Number($("[data-snap-distance]", body).value) || 8 }); commit("settings", false); canvas.refresh("settings"); return true; } },
  ] });
  $("[data-open-tutorial]", form).onclick = () => { modal.close(); setTimeout(() => showTutorial({ force: true }), 0); };
}

function createSelectedGroup() {
  const itemIds = topLevelSelection().filter((item) => state.board.nodes.includes(item) || state.board.groups.includes(item)).map((item) => item.id);
  if (!itemIds.length) return toast("Select items first", "Choose cards or frames, then create a frame.", "error");
  createGroup(itemIds, itemIds.length === 1 ? "New frame" : `${itemIds.length} related items`); canvas.refresh("group");
}

function ungroupSelection() {
  const groupIds = new Set([...state.selected].filter((id) => state.board.groups.some((group) => group.id === id)));
  if (!groupIds.size) return false;
  snapshot();
  const survivingParent = (id) => { let parentId = id; const seen = new Set(); while (parentId && groupIds.has(parentId) && !seen.has(parentId)) { seen.add(parentId); parentId = getGroup(parentId)?.parentId || null; } return parentId; };
  state.board.nodes.forEach((node) => { if (groupIds.has(node.groupId)) node.groupId = survivingParent(node.groupId); });
  state.board.groups.forEach((group) => { if (groupIds.has(group.parentId)) group.parentId = survivingParent(group.parentId); });
  state.board.groups = state.board.groups.filter((group) => !groupIds.has(group.id));
  state.selected.clear(); commit("ungroup", false); canvas.refresh("groups"); return true;
}

function selectAll() {
  state.selected = new Set([...state.board.nodes, ...state.board.groups, ...state.board.axes].filter((item) => !isEffectivelyHidden(item)).map((item) => item.id));
  state.selectedEdge = null; canvas.refreshSelection();
}

function clearSelection() {
  if (!state.selected.size && !state.selectedEdge) return false;
  state.selected.clear(); state.selectedEdge = null; canvas.refreshSelection(); return true;
}

function copyItems() {
  const count = copySelection();
  toast(count ? "Copied" : "Nothing to copy", count ? `${count} item${count === 1 ? "" : "s"} copied.` : "Select an item first.", count ? "success" : "error");
}

function cutItems() {
  const count = cutSelection();
  if (count) { canvas.refresh("cut"); toast("Cut", `${count} item${count === 1 ? "" : "s"} moved to the clipboard.`, "success"); }
  else toast("Nothing to cut", "Select an item first.", "error");
}

async function pasteItems(point = null) {
  const count = await pasteSelection(point);
  if (count) { canvas.refresh("paste"); toast("Pasted", `${count} item${count === 1 ? "" : "s"} added.`, "success"); }
  else toast("Clipboard is empty", "Copy or cut a whiteboard item first.", "error");
}

function duplicateItems() {
  const count = duplicateSelection();
  if (count) { canvas.refresh("duplicate"); toast("Duplicated", `${count} item${count === 1 ? "" : "s"} added.`, "success"); }
  else toast("Nothing to duplicate", "Select an item first.", "error");
}

function nudgeSelection(dx, dy) { if (translateSelection(dx, dy)) canvas.refresh("move"); }

function showArrange() {
  const content = document.createElement("div"); content.className = "arrange-menu";
  content.innerHTML = `<div class="arrange-grid"><button class="button" data-align="left">Align left</button><button class="button" data-align="center">Align centers</button><button class="button" data-align="right">Align right</button><button class="button" data-align="top">Align top</button><button class="button" data-align="middle">Align middles</button><button class="button" data-align="bottom">Align bottom</button><button class="button" data-distribute="x">Equal horizontal spacing</button><button class="button" data-distribute="y">Equal vertical spacing</button><button class="button" data-layout="grid">Grid layout</button><button class="button" data-layout="horizontal">Horizontal layout</button><button class="button" data-layout="vertical">Vertical layout</button></div>`;
  const modal = openModal({ title: "Arrange selection", content });
  content.addEventListener("click", (event) => { const align = event.target.closest("[data-align]")?.dataset.align; const distribute = event.target.closest("[data-distribute]")?.dataset.distribute; const layout = event.target.closest("[data-layout]")?.dataset.layout; const count = align ? alignSelection(align) : distribute ? distributeSelection(distribute) : layout ? autoLayoutSelection(layout) : 0; if (count) { modal.close(); canvas.refresh("arrange"); } });
}

function showSelectionEditor() {
  const content = document.createElement("div"); content.className = "selection-editor";
  const modal = openModal({ title: state.selectedEdge ? "Connection properties" : state.selected.size > 1 ? "Edit selection" : "Item properties", content });
  renderInspector(content, () => canvas.refresh("inspector-live"), () => { deleteSelection(); modal.close(); }, duplicateItems);
}

function editSelected() {
  if (state.selected.size !== 1) return;
  const node = getNode([...state.selected][0]);
  if (node && node.type !== "image") editTextNode(node, () => canvas.refresh("edit"));
}

function showShortcuts() {
  const shortcuts = [
    ["Select / multi-select / pan / connect", "V / M / H / C"], ["Pan empty canvas", "Primary drag / one finger"], ["Trackpad or wheel pan", "Scroll"], ["Pointer-centered zoom", "Ctrl/Cmd + scroll"],
    ["Marquee select", "Shift + drag / Multi tool"], ["Create item / upload", "N / U"], ["Add axis / capture", "A / P"],
    ["Add or remove from selection", "Ctrl/Cmd + click"], ["Select all", "Ctrl/Cmd + A"], ["Copy / cut / paste", "Ctrl/Cmd + C / X / V"],
    ["Duplicate selection", "Ctrl/Cmd + D"], ["Group / ungroup", "Ctrl/Cmd + G / Shift + Ctrl/Cmd + G"],
    ["Find on board", "Ctrl/Cmd + K"],
    ["Undo / redo", "Ctrl/Cmd + Z / Shift + Ctrl/Cmd + Z"], ["Move selection", "Arrow keys (Shift = 10px)"],
    ["Delete / edit", "Delete / Enter"], ["Zoom in / out", "+ / −"], ["Reset / selection / fit", "1 / 2 / 0"],
    ["Layer backward / forward", "[ / ]"], ["Layers / bookmarks", "L / B"],
    ["Settings / export", "S / E"], ["Clear selection", "Escape"], ["Shortcut reference", "?"],
  ];
  const content = `<dl class="shortcut-list">${shortcuts.map(([label, key]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(key)}</dd>`).join("")}</dl><p class="modal-copy">Touch: pinch with two fingers to zoom and pan, double-tap empty canvas to create, double-tap a text card to edit, and long-press for contextual actions. Larger handles appear automatically on touch screens.</p>`;
  openModal({ title: "Keyboard & touch controls", content, actions: [{ label: "Close", className: "primary", onClick: () => true }] });
}

function showItemContext({ type, id, x, y, point }) {
  if (type === "edge") { state.selected.clear(); state.selectedEdge = id; }
  else if (!state.selected.has(id)) { state.selected.clear(); state.selected.add(id); state.selectedEdge = null; }
  canvas.refreshSelection();
  const node = type === "node" ? getNode(id) : null;
  const canGroup = [...state.selected].some((selectedId) => getNode(selectedId) || getGroup(selectedId));
  const canUngroup = [...state.selected].some((selectedId) => state.board.groups.some((group) => group.id === selectedId));
  const selectedGroup = type === "group" ? getGroup(id) : null;
  const clipboardItems = type !== "edge" ? [
    { label: "Copy", shortcut: "Ctrl+C", action: copyItems },
    { label: "Cut", shortcut: "Ctrl+X", action: cutItems },
    { label: "Paste here", shortcut: "Ctrl+V", action: () => pasteItems(point) },
    { label: "Duplicate", shortcut: "Ctrl+D", action: duplicateItems },
    { separator: true },
  ] : [];
  openContextMenu({ x, y, items: [
    { label: state.selected.size > 1 ? "Edit selection" : "Edit properties", action: showSelectionEditor },
    ...(node && node.type !== "image" ? [{ label: "Edit", shortcut: "Enter", action: editSelected }, { separator: true }] : []),
    ...clipboardItems,
    { label: "Frame selection", shortcut: "Ctrl+G", disabled: !canGroup, action: createSelectedGroup },
    { label: "Remove frame", shortcut: "Ctrl+Shift+G", disabled: !canUngroup, action: ungroupSelection },
    { separator: true },
    ...(state.selected.size > 1 ? [{ label: "Arrange selection", action: showArrange }, { label: "Zoom to selection", shortcut: "2", action: () => canvas.zoomToSelection() }, { separator: true }] : []),
    ...(type !== "edge" ? [{ label: "Bring forward", shortcut: "]", action: () => { reorderSelected("forward"); canvas.refresh("layers"); } }, { label: "Send backward", shortcut: "[", action: () => { reorderSelected("backward"); canvas.refresh("layers"); } }, { separator: true }, { label: getItem(id)?.locked ? "Unlock" : "Lock", action: () => { setSelectedState("locked", !getItem(id)?.locked); canvas.refresh("lock"); } }, { label: "Hide", action: () => { setSelectedState("hidden", true); canvas.refresh("visibility"); } }] : []),
    ...(selectedGroup ? [{ label: selectedGroup.collapsed ? "Expand frame" : "Collapse frame", action: () => { toggleGroupCollapse(selectedGroup.id); canvas.refresh("group-collapse"); } }] : []),
    { separator: true },
    { label: "Delete", shortcut: "Delete", destructive: true, action: deleteSelection },
  ] });
}

function setTool(tool) {
  if ($(`[data-tool="${tool}"]`)?.disabled) return;
  if (tool === "group") return createSelectedGroup();
  if (tool === "axis") return showAxisDialog();
  canvas.setTool(tool);
}

function updateActionStates() {
  if (!state.board) return;
  const items = [...state.board.nodes, ...state.board.groups, ...state.board.axes];
  const groupable = topLevelSelection().filter((item) => state.board.nodes.includes(item) || state.board.groups.includes(item));
  $("#undo-btn").disabled = !canUndo();
  $("#redo-btn").disabled = !canRedo();
  $("#arrange-btn").disabled = topLevelSelection().length < 2;
  $("#search-btn").disabled = !items.length && !state.board.edges.length;
  $("#layers-btn").disabled = !items.length && !state.board.edges.length;
  $("#zoom-selection").disabled = !state.selected.size && !state.selectedEdge;
  $("[data-tool='group']").disabled = !groupable.length;
  $("[data-tool='connect']").disabled = state.board.nodes.filter((node) => !isEffectivelyHidden(node)).length < 2;
  if (state.tool === "connect" && $("[data-tool='connect']").disabled) canvas?.setTool("select");
}

function bindToolbar() {
  $$(".tool").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#create-fab").onclick = () => showCreateMenu();
  $("#search-btn").onclick = () => showSearch(canvas);
  $("#boards-btn").onclick = () => showBoardManager(canvas);
  $("#arrange-btn").onclick = showArrange;
  $("#layers-btn").onclick = () => showLayers(canvas);
  $("#bookmarks-btn").onclick = () => showBookmarks(canvas);
  $("#import-btn").onclick = () => chooseUpload(canvas.viewportCenter());
  $("#settings-btn").onclick = showSettings;
  $("#shortcuts-btn").onclick = showShortcuts;
  $("#export-btn").onclick = () => exportBoard().catch((error) => toast("Export failed", error.message, "error"));
  $("#undo-btn").onclick = () => { if (undo()) canvas.refresh("history"); };
  $("#redo-btn").onclick = () => { if (redo()) canvas.refresh("history"); };
  $("#zoom-in").onclick = () => canvas.zoomBy(1.2); $("#zoom-out").onclick = () => canvas.zoomBy(1 / 1.2);
  $("#zoom-reset").onclick = () => canvas.resetZoom(); $("#zoom-fit").onclick = () => canvas.fitBoard();
  $("#zoom-selection").onclick = () => canvas.zoomToSelection();
  $("#board-title").addEventListener("focus", () => snapshot());
  $("#board-title").addEventListener("input", (event) => { state.board.title = event.target.value; commit("title", false); });
  $("#file-input").addEventListener("change", async (event) => { if (event.target.files.length) await importFiles(event.target.files, pendingImportPoint || canvas.viewportCenter()); event.target.value = ""; pendingImportPoint = null; canvas.refresh("import"); });
  $("#board-file-input").addEventListener("change", async (event) => { const file = event.target.files[0]; event.target.value = ""; if (file) await restoreBoardFile(file, canvas); });
  updateActionStates();
}

function bindDragDrop() {
  const viewport = $("#viewport");
  ["dragenter", "dragover"].forEach((type) => viewport.addEventListener(type, (event) => { if ([...event.dataTransfer.types].includes("Files")) { event.preventDefault(); viewport.classList.add("drag-over"); } }));
  ["dragleave", "drop"].forEach((type) => viewport.addEventListener(type, (event) => { event.preventDefault(); viewport.classList.remove("drag-over"); }));
  viewport.addEventListener("drop", async (event) => { const point = canvas.screenToWorld({ x: event.clientX, y: event.clientY }); await importFiles(event.dataTransfer.files, point); canvas.refresh("import"); });
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.(".modal-backdrop,.context-menu")) return;
    if (event.code === "Space" && !isTypingTarget(event.target)) { event.preventDefault(); canvas.setSpace(true); }
    if (isTypingTarget(event.target)) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (command && key === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); canvas.refresh("history"); return; }
    if (command && key === "y") { event.preventDefault(); redo(); canvas.refresh("history"); return; }
    if (command && key === "a") { event.preventDefault(); selectAll(); return; }
    if (command && key === "c") { event.preventDefault(); copyItems(); return; }
    if (command && key === "x") { event.preventDefault(); cutItems(); return; }
    if (command && key === "v") { event.preventDefault(); pasteItems(); return; }
    if (command && key === "d") { event.preventDefault(); duplicateItems(); return; }
    if (command && key === "g") { event.preventDefault(); event.shiftKey ? ungroupSelection() : createSelectedGroup(); return; }
    if (command && key === "k") { event.preventDefault(); showSearch(canvas); return; }
    if (key === "]") { event.preventDefault(); reorderSelected(event.shiftKey ? "front" : "forward"); canvas.refresh("layers"); return; }
    if (key === "[") { event.preventDefault(); reorderSelected(event.shiftKey ? "back" : "backward"); canvas.refresh("layers"); return; }
    if (["Backspace", "Delete"].includes(event.key)) { event.preventDefault(); deleteSelection(); return; }
    if (event.key === "Escape") { closeContextMenu(); if (!clearSelection()) setTool("select"); return; }
    if (event.key === "Enter") { event.preventDefault(); editSelected(); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
      nudgeSelection(event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0, event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0); return;
    }
    if (["+", "="].includes(event.key)) { event.preventDefault(); canvas.zoomBy(1.2); return; }
    if (["-", "_"].includes(event.key)) { event.preventDefault(); canvas.zoomBy(1 / 1.2); return; }
    const toolKeys = { v: "select", m: "multi", h: "hand", c: "connect" };
    if (toolKeys[key]) setTool(toolKeys[key]);
    if (key === "g") createSelectedGroup();
    if (key === "a") showAxisDialog();
    if (key === "n") showCreateMenu();
    if (key === "u") chooseUpload(canvas.viewportCenter());
    if (key === "p") setTool("capture");
    if (key === "s") showSettings();
    if (key === "l") showLayers(canvas);
    if (key === "b") showBookmarks(canvas);
    if (key === "e") exportBoard().catch((error) => toast("Export failed", error.message, "error"));
    if (key === "?") showShortcuts();
    if (event.key === "1") canvas.resetZoom();
    if (event.key === "2") canvas.zoomToSelection();
    if (event.key === "0") canvas.fitBoard();
  });
  document.addEventListener("keyup", (event) => { if (event.code === "Space") canvas.setSpace(false); });
}

async function start() {
  await loadBoard(); $("#board-title").value = state.board.title;
  canvas = new InfiniteCanvas({ onSelection: selectionChanged, onCreate: showCreateMenu, onContext: showItemContext, onCapture: (region) => captureRegion(region).catch((error) => toast("Capture failed", error.message, "error")), onEditNode: (node) => node.type !== "image" && editTextNode(node, () => canvas.refresh("edit")) });
  onSaveStatus((status, error) => { const element = $("#save-status"); element.textContent = status === "saving" ? "Saving locally…" : status === "error" ? "Save failed" : "Saved locally"; element.classList.toggle("saving", status === "saving"); element.classList.toggle("error", status === "error"); element.title = status === "error" ? error?.message || "Local save failed" : ""; });
  bindToolbar(); bindDragDrop(); bindKeyboard(); subscribe((reason) => { if (reason === "history") $("#board-title").value = state.board.title; updateActionStates(); }); canvas.init();
  setTimeout(() => showTutorialOnce(), 420);
  if (!state.board.nodes.length && !state.board.axes.length) toast("Board ready", "Double-click, right-click, or long-press anywhere to create.");
}

start().catch((error) => { document.body.innerHTML = `<main style="padding:2rem;color:white"><h1>Infinite Whiteboard could not start</h1><p>${escapeHtml(error.message)}</p></main>`; });
