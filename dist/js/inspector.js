import { state, commit, snapshot } from "./state.js";
import { $, csvList, escapeHtml } from "./utils.js";
import { confirmDialog, promptDialog } from "./ui.js";
import { renderMarkdown } from "./markdown.js";
import { openMarkdownEditor } from "./markdown-editor.js";

function findSelected() {
  const id = [...state.selected][0];
  if (!id) return null;
  const node = state.board.nodes.find((item) => item.id === id);
  if (node) return { kind: "node", item: node };
  const group = state.board.groups.find((item) => item.id === id);
  if (group) return { kind: "group", item: group };
  const axis = state.board.axes.find((item) => item.id === id);
  if (axis) return { kind: "axis", item: axis };
  return null;
}

function field(label, key, value, multiline = false) {
  const tag = multiline ? "textarea" : "input";
  return `<div class="field"><label>${escapeHtml(label)}</label><${tag} data-field="${key}" value="${multiline ? "" : escapeHtml(value ?? "")}">${multiline ? escapeHtml(value ?? "") : ""}</${tag}></div>`;
}

function nodeInspector(node) {
  const groups = state.board.groups.map((group) => `<option value="${group.id}" ${node.groupId === group.id ? "selected" : ""}>${escapeHtml(group.title)}</option>`).join("");
  const content = node.type === "markdown"
    ? `<div class="field"><label>Markdown</label><div class="markdown-inspector-preview node-markdown">${renderMarkdown(node.content)}</div><button class="button markdown-edit-button" data-edit-markdown>Edit Markdown</button></div>`
    : node.type !== "image" ? field("Text", "content", node.content, true) : "";
  return `<header class="inspector-head"><h2>${escapeHtml(node.type)} asset</h2><span class="node-kind">${escapeHtml(node.type)}</span></header><section class="inspector-section">${field("Title", "title", node.title)}${field("Description", "description", node.description, true)}${content}</section><section class="inspector-section">${field("Category", "category", node.category)}${field("Tags — comma separated", "tags", node.tags?.join(", "))}<div class="field"><label>Group</label><select data-field="groupId"><option value="">No group</option>${groups}</select></div></section><section class="inspector-section"><div class="field-row">${field("Width", "w", node.w)}${field("Height", "h", node.h)}</div></section><div class="inspector-actions"><button class="button" data-duplicate>Duplicate</button><button class="button danger" data-delete>Delete</button></div>`;
}

function groupInspector(group) {
  return `<header class="inspector-head"><h2>Group</h2><span class="node-kind">FRAME</span></header><section class="inspector-section">${field("Title", "title", group.title)}${field("Description", "description", group.description, true)}${field("Category", "category", group.category)}${field("Tags — comma separated", "tags", group.tags?.join(", "))}<div class="field"><label>Color</label><input type="color" data-field="color" value="${group.color}" /></div></section><div class="inspector-actions"><button class="button danger" data-delete>Delete group</button></div>`;
}

function axisInspector(axis) {
  return `<header class="inspector-head"><h2>Axis</h2><span class="node-kind">${axis.orientation}</span></header><section class="inspector-section">${field("Label", "label", axis.label)}${field("Eras — comma separated", "eras", axis.eras.join(", "))}<div class="field-row">${field("Length", "length", axis.length)}<div class="field"><label>Color</label><input type="color" data-field="color" value="${axis.color}" /></div></div></section><div class="inspector-actions"><button class="button danger" data-delete>Delete axis</button></div>`;
}

function edgeInspector(edge) {
  return `<header class="inspector-head"><h2>Connection</h2><span class="node-kind">PATH</span></header><section class="inspector-section">${field("Label", "label", edge.label)}${field("Category", "category", edge.category)}${field("Tags — comma separated", "tags", edge.tags?.join(", "))}</section><div class="inspector-actions"><button class="button danger" data-delete>Delete path</button></div>`;
}

export function renderInspector(root, onChange, onDelete, onDuplicate) {
  const edge = state.selectedEdge && state.board.edges.find((item) => item.id === state.selectedEdge);
  const selected = findSelected();
  if (!edge && (!selected || state.selected.size > 1)) {
    root.innerHTML = state.selected.size > 1 ? `<div class="inspector-empty"><span>▦</span><h2>${state.selected.size} items selected</h2><p>Edit them individually or create a group to organize the selection.</p></div>` : `<div class="inspector-empty"><span>◫</span><h2>Nothing selected</h2><p>Select an item to edit its description, categories, tags, and grouping.</p></div>`;
    return;
  }
  const item = edge || selected.item;
  root.innerHTML = edge ? edgeInspector(edge) : selected.kind === "node" ? nodeInspector(item) : selected.kind === "group" ? groupInspector(item) : axisInspector(item);
  root.querySelectorAll("[data-field]").forEach((control) => {
    const eventName = control.tagName === "SELECT" || control.type === "color" ? "change" : "input";
    let editing = false;
    control.addEventListener("focus", () => { if (!editing) snapshot("Before inspector edit"); editing = true; });
    control.addEventListener("blur", () => { editing = false; });
    control.addEventListener(eventName, () => {
      if (!editing) { snapshot("Before inspector edit"); editing = true; }
      const key = control.dataset.field;
      let value = control.value;
      if (["w", "h", "length"].includes(key)) value = Math.max(40, Number(value) || 40);
      if (["tags", "eras"].includes(key)) value = csvList(value);
      item[key] = value || (key === "groupId" ? null : value); commit("inspector", false); onChange();
    });
  });
  $("[data-delete]", root)?.addEventListener("click", async () => {
    if (await confirmDialog({ title: "Delete selection?", message: "This removes the selected item and connected paths from this board.", confirmLabel: "Delete", destructive: true })) onDelete();
  });
  $("[data-duplicate]", root)?.addEventListener("click", () => {
    onDuplicate?.();
  });
  $("[data-edit-markdown]", root)?.addEventListener("click", () => editTextNode(item, onChange));
}

export async function editTextNode(node, onChange) {
  const value = node.type === "markdown"
    ? await openMarkdownEditor({ title: "Edit Markdown", value: node.content, confirmLabel: "Update" })
    : await promptDialog({ title: "Edit text", label: "Text", value: node.content, multiline: true, confirmLabel: "Update" });
  if (value === null) return;
  snapshot(); node.content = value; commit("edit", false); onChange();
}
