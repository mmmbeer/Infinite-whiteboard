import { state, getNode, commit, snapshot } from "./state.js";
import { uid, escapeHtml } from "./utils.js";

const anchorPoint = (node, anchor) => {
  const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  const offset = { n: { x: 0, y: -node.h / 2 }, e: { x: node.w / 2, y: 0 }, s: { x: 0, y: node.h / 2 }, w: { x: -node.w / 2, y: 0 } }[anchor] || { x: 0, y: 0 };
  const radians = (node.rotation || 0) * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return { x: center.x + offset.x * cosine - offset.y * sine, y: center.y + offset.x * sine + offset.y * cosine };
};

function pathBetween(start, end, fromAnchor, toAnchor, connectionType = "curved") {
  if (connectionType === "straight") return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  const horizontal = ["e", "w"].includes(fromAnchor) || ["e", "w"].includes(toAnchor);
  const distance = Math.max(70, Math.min(260, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * .48));
  const offset = (point, anchor, amount) => ({
    x: point.x + (anchor === "e" ? amount : anchor === "w" ? -amount : 0),
    y: point.y + (anchor === "s" ? amount : anchor === "n" ? -amount : 0),
  });
  const c1 = offset(start, fromAnchor, distance);
  const c2 = offset(end, toAnchor, distance);
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

export function renderEdges(svg, preview = null) {
  const connectionType = state.board.settings?.connectionType || "curved";
  const marker = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>`;
  const html = state.board.edges.map((edge) => {
    const from = getNode(edge.from); const to = getNode(edge.to);
    if (!from || !to) return "";
    const start = anchorPoint(from, edge.fromAnchor); const end = anchorPoint(to, edge.toAnchor);
    const path = pathBetween(start, end, edge.fromAnchor, edge.toAnchor, connectionType);
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return `<g data-edge="${edge.id}"><path class="edge-hit" d="${path}"/><path class="edge ${state.selectedEdge === edge.id ? "selected" : ""}" d="${path}" marker-end="url(#arrow)"/>${edge.label ? `<text class="edge-label" x="${midpoint.x}" y="${midpoint.y - 8}" text-anchor="middle">${escapeHtml(edge.label)}</text>` : ""}</g>`;
  }).join("");
  const previewHtml = preview ? `<path class="edge preview-edge" d="${pathBetween(preview.start, preview.end, preview.anchor, preview.toAnchor || "w", connectionType)}" marker-end="url(#arrow)"/>` : "";
  svg.innerHTML = marker + html + previewHtml;
}

export function createEdge(from, to, fromAnchor = "e", toAnchor = "w") {
  if (from === to) return null;
  const duplicate = state.board.edges.some((edge) => edge.from === from && edge.to === to && edge.fromAnchor === fromAnchor && edge.toAnchor === toAnchor);
  if (duplicate) return null;
  snapshot();
  const edge = { id: uid("edge"), from, to, fromAnchor, toAnchor, label: "", category: "", tags: [] };
  state.board.edges.push(edge); commit("edges", false); return edge;
}

export function bindEdgeInteractions(svg, onSelect, shouldPan = () => false) {
  svg.addEventListener("pointerdown", (event) => {
    if (shouldPan(event)) return;
    const group = event.target.closest("[data-edge]");
    if (!group) return;
    event.stopPropagation();
    state.selected.clear(); state.selectedEdge = group.dataset.edge;
    onSelect();
  });
}

export function getAnchorPoint(nodeId, anchor) {
  const node = getNode(nodeId);
  return node ? anchorPoint(node, anchor) : null;
}

export function getClosestAnchor(nodeId, point) {
  const anchors = ["n", "e", "s", "w"].map((anchor) => ({ anchor, point: getAnchorPoint(nodeId, anchor) })).filter((entry) => entry.point);
  return anchors.sort((a, b) => Math.hypot(a.point.x - point.x, a.point.y - point.y) - Math.hypot(b.point.x - point.x, b.point.y - point.y))[0] || null;
}
