import { assetDb } from "./database.js";
import { renderMarkdown } from "./markdown.js";
import { state, getNode, commit, snapshot } from "./state.js";
import { $, escapeHtml } from "./utils.js";

const objectUrls = new Map();

async function imageUrl(assetId) {
  if (!assetId) return "";
  if (objectUrls.has(assetId)) return objectUrls.get(assetId);
  const asset = await assetDb.get(assetId);
  if (!asset?.blob) return "";
  const url = URL.createObjectURL(asset.blob);
  objectUrls.set(assetId, url);
  return url;
}

function bodyHtml(node) {
  if (node.type === "image") return `<img class="node-image" data-asset="${node.assetId}" alt="${escapeHtml(node.description || node.title)}" draggable="false" />`;
  if (node.type === "markdown") return `<div class="node-text node-markdown">${renderMarkdown(node.content)}</div>`;
  return `<div class="node-text">${escapeHtml(node.content)}</div>`;
}

export async function renderNodes(layer) {
  const existing = new Map([...layer.children].map((element) => [element.dataset.id, element]));
  for (const node of state.board.nodes) {
    let element = existing.get(node.id);
    const signature = JSON.stringify([node.type, node.title, node.content, node.description, node.tags, node.assetId]);
    if (!element) {
      element = document.createElement("article");
      element.className = "board-node";
      element.dataset.id = node.id;
      layer.append(element);
    }
    if (element.dataset.signature !== signature) {
      element.dataset.signature = signature;
      element.innerHTML = `<header class="node-bar"><span class="node-kind">${escapeHtml(node.type)}</span><span class="node-title">${escapeHtml(node.title)}</span></header><div class="node-body">${bodyHtml(node)}${node.tags?.length ? `<div class="node-tags">${node.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</div>${["n", "e", "s", "w"].map((anchor) => `<button class="anchor" data-anchor="${anchor}" aria-label="Connect from ${anchor}"></button>`).join("")}`;
      if (node.type === "image") {
        const image = $("img", element);
        imageUrl(node.assetId).then((url) => { if (url) image.src = url; });
      }
    }
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.w}px`;
    element.style.height = `${node.h}px`;
    element.classList.toggle("selected", state.selected.has(node.id));
    existing.delete(node.id);
  }
  existing.forEach((element) => element.remove());
}

export function bindNodeInteractions(layer, canvasApi) {
  layer.addEventListener("pointerdown", (event) => {
    const anchor = event.target.closest(".anchor");
    const element = event.target.closest(".board-node");
    if (!element) return;
    if (anchor) return canvasApi.startConnection(event, element.dataset.id, anchor.dataset.anchor);
    const id = element.dataset.id;
    if (event.shiftKey) {
      state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    } else if (!state.selected.has(id)) {
      state.selected.clear(); state.selected.add(id);
    }
    state.selectedEdge = null;
    canvasApi.refreshSelection();
    if (state.tool === "select" && event.target.closest(".node-bar")) startDrag(event, canvasApi);
  });
  layer.addEventListener("dblclick", (event) => {
    const element = event.target.closest(".board-node");
    if (!element) return;
    canvasApi.editNode(getNode(element.dataset.id));
  });
}

function startDrag(event, canvasApi) {
  event.preventDefault();
  const start = canvasApi.screenToWorld({ x: event.clientX, y: event.clientY });
  const nodes = [...state.selected].map(getNode).filter(Boolean);
  const origins = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  snapshot();
  const move = (moveEvent) => {
    const point = canvasApi.screenToWorld({ x: moveEvent.clientX, y: moveEvent.clientY });
    nodes.forEach((node) => {
      const origin = origins.get(node.id);
      node.x = origin.x + point.x - start.x;
      node.y = origin.y + point.y - start.y;
    });
    canvasApi.refresh("move");
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    commit("move", false);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
}

export function resizeNodeToContent(id, height) {
  const node = getNode(id);
  if (!node) return;
  node.h = Math.max(node.type === "image" ? 120 : 100, Math.min(420, height));
}
