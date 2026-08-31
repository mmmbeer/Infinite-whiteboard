import { state, commit, snapshot } from "./state.js";
import { $, csvList, escapeHtml } from "./utils.js";
import { confirmDialog, promptDialog } from "./ui.js";
import { renderMarkdown } from "./markdown.js";
import { openMarkdownEditor } from "./markdown-editor.js";
import { alignSelection, autoLayoutSelection, distributeSelection } from "./arrange.js";
import { reorderSelected, setSelectedState } from "./item-actions.js";
import { attachNodeToAxis, detachNodeFromAxis, reflowAxis } from "./axis-bindings.js";
import { ancestorGroups, descendantGroupIds, getItem, isEffectivelyLocked, selectedItems } from "./item-tree.js";

function findSelected() {
  const id = [...state.selected][0]; if (!id) return null;
  const item = getItem(id); if (!item) return null;
  return { kind: state.board.nodes.includes(item) ? "node" : state.board.groups.includes(item) ? "group" : "axis", item };
}

function field(label, key, value, multiline = false, type = "text") {
  const tag = multiline ? "textarea" : "input";
  return `<div class="field"><label>${escapeHtml(label)}</label><${tag} data-field="${key}" type="${type}" value="${multiline ? "" : escapeHtml(value ?? "")}">${multiline ? escapeHtml(value ?? "") : ""}</${tag}></div>`;
}

function selectField(label, key, options, value) {
  return `<div class="field"><label>${escapeHtml(label)}</label><select data-field="${key}">${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${String(value ?? "") === String(optionValue) ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select></div>`;
}

const stateActions = (item) => `<section class="inspector-section compact-actions"><button class="button" data-item-lock>${isEffectivelyLocked(item) ? "Unlock" : "Lock"}</button><button class="button" data-item-hide>Hide</button></section>`;
const nodeOptions = () => state.board.nodes.filter((node) => !node.hidden).map((node) => [node.id, node.title || "Untitled"]);

function nodeInspector(node) {
  const groups = [["", "No frame"], ...state.board.groups.filter((group) => !group.hidden).map((group) => [group.id, group.title])];
  const content = node.type === "markdown"
    ? `<div class="field"><label>Markdown</label><div class="markdown-inspector-preview node-markdown">${renderMarkdown(node.content)}</div><button class="button markdown-edit-button" data-edit-markdown>Edit Markdown</button></div>`
    : node.type !== "image" ? field("Text", "content", node.content, true) : "";
  const axis = state.board.axes.find((item) => item.id === node.axisBinding?.axisId);
  const axes = [["", "Not attached"], ...state.board.axes.filter((item) => !item.hidden).map((item) => [item.id, item.label])];
  const axisValue = axis ? (axis.mode === "eras" ? selectField("Era", "axisValue", axis.eras.map((era) => [era, era]), node.axisBinding?.value ?? axis.eras[0]) : field("Axis value", "axisValue", node.axisBinding?.value ?? axis.min, false, "number")) : "";
  return `<header class="inspector-head"><h2>${escapeHtml(node.type)} asset</h2><span class="node-kind">${node.locked ? "LOCKED" : node.axisBinding ? "BOUND" : escapeHtml(node.type)}</span></header><section class="inspector-section">${field("Title", "title", node.title)}${field("Description", "description", node.description, true)}${content}</section><section class="inspector-section">${field("Category", "category", node.category)}${field("Tags — comma separated", "tags", node.tags?.join(", "))}${selectField("Frame", "groupId", groups, node.groupId)}<div class="field"><label>Color</label><input type="color" data-field="color" value="${node.color}" /></div></section><section class="inspector-section"><div class="field-row">${field("Width", "w", node.w, false, "number")}${field("Height", "h", node.h, false, "number")}</div></section><section class="inspector-section axis-binding-fields">${selectField("Attach to axis", "axisId", axes, axis?.id || "")}${axisValue}${axis ? `<label class="check-field"><input type="checkbox" data-axis-snap ${node.axisBinding?.snap !== false ? "checked" : ""}/> Keep snapped when axis changes</label>` : ""}</section>${stateActions(node)}<div class="inspector-actions"><button class="button" data-duplicate>Duplicate</button><button class="button danger" data-delete>Delete</button></div>`;
}

function groupInspector(group) {
  const invalid = descendantGroupIds(group.id); invalid.add(group.id);
  const parents = [["", "Top level"], ...state.board.groups.filter((item) => !invalid.has(item.id) && !item.hidden).map((item) => [item.id, item.title])];
  return `<header class="inspector-head"><h2>Frame</h2><span class="node-kind">${group.collapsed ? "COLLAPSED" : group.manualSize ? "FIXED" : "AUTO"}</span></header><section class="inspector-section">${field("Title", "title", group.title)}${field("Description", "description", group.description, true)}${field("Category", "category", group.category)}${field("Tags — comma separated", "tags", group.tags?.join(", "))}${selectField("Parent frame", "parentId", parents, group.parentId)}<div class="field"><label>Color</label><input type="color" data-field="color" value="${group.color}" /></div><div class="field-row">${field("Width", "w", group.w, false, "number")}${field("Height", "h", group.h, false, "number")}</div><label class="check-field"><input type="checkbox" data-group-fixed ${group.manualSize ? "checked" : ""}/> Fixed frame size</label><button class="button" data-group-collapse>${group.collapsed ? "Expand frame" : "Collapse frame"}</button></section>${stateActions(group)}<div class="inspector-actions"><button class="button danger" data-delete>Delete frame</button></div>`;
}

function axisInspector(axis) {
  const numeric = axis.mode === "number";
  return `<header class="inspector-head"><h2>Axis</h2><span class="node-kind">${axis.orientation}</span></header><section class="inspector-section">${field("Label", "label", axis.label)}${selectField("Orientation", "orientation", [["x", "Horizontal"], ["y", "Vertical"]], axis.orientation)}${selectField("Scale", "mode", [["eras", "Eras / stages"], ["number", "Numeric values"]], axis.mode)}${numeric ? `<div class="field-row">${field("Minimum", "min", axis.min, false, "number")}${field("Maximum", "max", axis.max, false, "number")}</div>${field("Step", "step", axis.step, false, "number")}` : field("Eras — comma separated", "eras", axis.eras.join(", "))}<div class="field-row">${field("Length", "length", axis.length, false, "number")}<div class="field"><label>Color</label><input type="color" data-field="color" value="${axis.color}" /></div></div><p class="inspector-note">Attached cards follow their era or value when this axis moves, rotates, resizes, or changes scale.</p></section>${stateActions(axis)}<div class="inspector-actions"><button class="button danger" data-delete>Delete axis</button></div>`;
}

function edgeInspector(edge) {
  const anchors = [["n", "Top"], ["e", "Right"], ["s", "Bottom"], ["w", "Left"]];
  return `<header class="inspector-head"><h2>Connection</h2><span class="node-kind">PATH</span></header><section class="inspector-section">${field("Label", "label", edge.label)}${field("Category", "category", edge.category)}${field("Tags — comma separated", "tags", edge.tags?.join(", "))}<div class="field-row">${selectField("Source", "from", nodeOptions(), edge.from)}${selectField("Source point", "fromAnchor", anchors, edge.fromAnchor)}</div><div class="field-row">${selectField("Destination", "to", nodeOptions(), edge.to)}${selectField("Destination point", "toAnchor", anchors, edge.toAnchor)}</div>${selectField("Direction", "direction", [["none", "No arrows"], ["forward", "Source → destination"], ["backward", "Source ← destination"], ["both", "Both directions"]], edge.direction)}${selectField("Line style", "style", [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]], edge.style)}${selectField("Path", "connectionType", [["inherit", "Use board setting"], ["curved", "Curved"], ["straight", "Straight"]], edge.connectionType)}<div class="field"><label>Color</label><input type="color" data-field="color" value="${edge.color}" /></div></section><section class="inspector-section compact-actions"><button class="button" data-edge-lock>${edge.locked ? "Unlock" : "Lock"}</button><button class="button" data-edge-hide>Hide</button></section><div class="inspector-actions"><button class="button danger" data-delete>Delete path</button></div>`;
}

function bulkInspector(items) {
  const nodes = items.filter((item) => state.board.nodes.includes(item));
  const groups = [["", "No frame"], ...state.board.groups.filter((group) => !group.hidden).map((group) => [group.id, group.title])];
  const allLocked = items.every((item) => item.locked);
  return `<header class="inspector-head"><h2>${items.length} items selected</h2><span class="node-kind">BULK</span></header><section class="inspector-section">${field("Set category", "bulkCategory", "")}${field("Add tags", "bulkTags", "")}${nodes.length ? selectField("Move cards to frame", "bulkGroup", [["__keep", "Keep current frames"], ...groups], "__keep") : ""}<div class="field"><label>Card color</label><div class="color-apply"><input type="color" data-bulk-color value="#ff715b" /><label class="check-field"><input type="checkbox" data-apply-color /> Apply color</label></div></div><button class="button primary full-button" data-apply-bulk>Apply bulk fields</button></section><section class="inspector-section arrange-grid"><button class="button" data-arrange="left">Align left</button><button class="button" data-arrange="center">Centers</button><button class="button" data-arrange="right">Align right</button><button class="button" data-arrange="top">Align top</button><button class="button" data-arrange="middle">Middles</button><button class="button" data-arrange="bottom">Align bottom</button><button class="button" data-distribute="x">Equal horizontal</button><button class="button" data-distribute="y">Equal vertical</button><button class="button" data-layout="grid">Grid layout</button><button class="button" data-layout="horizontal">Horizontal</button><button class="button" data-layout="vertical">Vertical</button></section><section class="inspector-section arrange-grid"><button class="button" data-order="forward">Bring forward</button><button class="button" data-order="front">Bring to front</button><button class="button" data-order="backward">Send backward</button><button class="button" data-order="back">Send to back</button><button class="button" data-bulk-lock data-next-locked="${!allLocked}">${allLocked ? "Unlock" : "Lock"}</button><button class="button" data-bulk-hide>Hide</button></section>`;
}

function bindItemFields(root, item, kind, onChange, rerender) {
  root.querySelectorAll("[data-field]").forEach((control) => {
    const eventName = control.tagName === "SELECT" || control.type === "color" ? "change" : "input"; let editing = false;
    control.addEventListener("focus", () => { if (!editing) snapshot("Before inspector edit"); editing = true; }); control.addEventListener("blur", () => { editing = false; });
    control.addEventListener(eventName, () => {
      if (!editing) { snapshot("Before inspector edit"); editing = true; }
      const key = control.dataset.field; let value = control.value;
      if (["w", "h", "length"].includes(key)) value = Math.max(40, Number(value) || 40);
      if (["min", "max", "step"].includes(key)) value = Number(value) || 0;
      if (["tags", "eras"].includes(key)) value = csvList(value);
      if (kind === "node" && key === "axisId") {
        const axis = state.board.axes.find((entry) => entry.id === value); if (axis) attachNodeToAxis(item, axis, axis.mode === "number" ? axis.min : axis.eras[0], true); else detachNodeFromAxis(item);
      } else if (kind === "node" && key === "axisValue") {
        const axis = state.board.axes.find((entry) => entry.id === item.axisBinding?.axisId); if (axis) attachNodeToAxis(item, axis, value, item.axisBinding.snap);
      } else item[key] = value || (["groupId", "parentId"].includes(key) ? null : value);
      if (kind === "axis") { item.step = Math.max(0.0001, Number(item.step) || 1); if (item.max <= item.min) item.max = item.min + item.step; reflowAxis(item.id); } if (kind === "group" && ["w", "h"].includes(key)) item.manualSize = true;
      commit("inspector", false); onChange();
      if (["axisId", "mode"].includes(key)) rerender?.();
    });
  });
}

function bindBulk(root, items, onChange, rerender) {
  root.querySelector("[data-apply-bulk]")?.addEventListener("click", () => {
    snapshot(); const category = root.querySelector('[data-field="bulkCategory"]')?.value; const tags = csvList(root.querySelector('[data-field="bulkTags"]')?.value); const groupId = root.querySelector('[data-field="bulkGroup"]')?.value; const color = root.querySelector("[data-bulk-color]")?.value; const applyColor = root.querySelector("[data-apply-color]")?.checked;
    items.forEach((item) => { if (category) item.category = category; if (tags.length) item.tags = [...new Set([...(item.tags || []), ...tags])]; if (applyColor && color && state.board.nodes.includes(item)) item.color = color; if (state.board.nodes.includes(item) && groupId !== undefined && groupId !== "__keep") item.groupId = groupId || null; });
    commit("bulk-edit", false); onChange();
  });
  root.addEventListener("click", (event) => {
    const align = event.target.closest("[data-arrange]")?.dataset.arrange; const distribute = event.target.closest("[data-distribute]")?.dataset.distribute; const layout = event.target.closest("[data-layout]")?.dataset.layout; const order = event.target.closest("[data-order]")?.dataset.order;
    if (align) alignSelection(align); if (distribute) distributeSelection(distribute); if (layout) autoLayoutSelection(layout); if (order) reorderSelected(order);
    const stateAction = event.target.closest("[data-bulk-lock],[data-bulk-hide]");
    const lockButton = event.target.closest("[data-bulk-lock]"); if (lockButton) setSelectedState("locked", lockButton.dataset.nextLocked === "true");
    if (event.target.closest("[data-bulk-hide]")) setSelectedState("hidden", true);
    if (align || distribute || layout || order || stateAction) { onChange(); if (stateAction) rerender?.(); }
  });
}

export function renderInspector(root, onChange, onDelete, onDuplicate) {
  const edge = state.selectedEdge && state.board.edges.find((item) => item.id === state.selectedEdge); const selected = findSelected(); const items = selectedItems({ includeHidden: true });
  if (!edge && !items.length) { root.innerHTML = `<div class="inspector-empty"><span>◫</span><h2>Nothing selected</h2><p>Select an item to edit it. Hidden items remain available in Layers.</p></div>`; return; }
  if (!edge && items.length > 1) { root.innerHTML = bulkInspector(items); bindBulk(root, items, onChange, () => renderInspector(root, onChange, onDelete, onDuplicate)); return; }
  const item = edge || selected.item; const kind = edge ? "edge" : selected.kind;
  root.innerHTML = edge ? edgeInspector(edge) : kind === "node" ? nodeInspector(item) : kind === "group" ? groupInspector(item) : axisInspector(item);
  if (isEffectivelyLocked(item)) root.querySelectorAll("[data-field],[data-axis-snap],[data-group-fixed],[data-group-collapse]").forEach((control) => { control.disabled = true; });
  bindItemFields(root, item, kind, onChange, () => renderInspector(root, onChange, onDelete, onDuplicate));
  const rerender = () => renderInspector(root, onChange, onDelete, onDuplicate);
  root.querySelector("[data-item-lock]")?.addEventListener("click", () => { snapshot(); if (isEffectivelyLocked(item)) { item.locked = false; ancestorGroups(state.board.nodes.includes(item) ? item.groupId : item.parentId).forEach((group) => { group.locked = false; }); } else item.locked = true; commit("locked", false); onChange(); rerender(); });
  root.querySelector("[data-item-hide]")?.addEventListener("click", () => { snapshot(); item.hidden = true; state.selected.clear(); commit("hidden", false); onChange(); rerender(); });
  root.querySelector("[data-edge-lock]")?.addEventListener("click", () => { snapshot(); item.locked = !item.locked; commit("locked", false); onChange(); rerender(); });
  root.querySelector("[data-edge-hide]")?.addEventListener("click", () => { snapshot(); item.hidden = true; state.selectedEdge = null; commit("hidden", false); onChange(); rerender(); });
  root.querySelector("[data-group-fixed]")?.addEventListener("change", (event) => { snapshot(); item.manualSize = event.target.checked; commit("frame-size", false); onChange(); rerender(); });
  root.querySelector("[data-group-collapse]")?.addEventListener("click", () => { snapshot(); item.collapsed = !item.collapsed; commit("group-collapse", false); onChange(); rerender(); });
  root.querySelector("[data-axis-snap]")?.addEventListener("change", (event) => { snapshot(); item.axisBinding.snap = event.target.checked; commit("axis-binding", false); onChange(); });
  $("[data-delete]", root)?.addEventListener("click", async () => { if (await confirmDialog({ title: "Delete selection?", message: "This removes the selected item and connected paths from this board.", confirmLabel: "Delete", destructive: true })) onDelete?.(); });
  $("[data-duplicate]", root)?.addEventListener("click", () => onDuplicate?.());
  $("[data-edit-markdown]", root)?.addEventListener("click", () => editTextNode(item, onChange));
}

export async function editTextNode(node, onChange) {
  const value = node.type === "markdown" ? await openMarkdownEditor({ title: "Edit Markdown", value: node.content, confirmLabel: "Update" }) : await promptDialog({ title: "Edit text", label: "Text", value: node.content, multiline: true, confirmLabel: "Update" });
  if (value === null) return; snapshot(); node.content = value; commit("edit", false); onChange();
}
