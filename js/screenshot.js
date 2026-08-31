import { assetDb } from "./database.js";
import { state } from "./state.js";
import { boundsOf, downloadBlob, safeName } from "./utils.js";
import { isEffectivelyHidden } from "./item-tree.js";
import { axisTicks } from "./axes.js";

function anchorPoint(node, anchor) {
  const center = [node.x + node.w / 2, node.y + node.h / 2]; const offset = { n: [0, -node.h / 2], e: [node.w / 2, 0], s: [0, node.h / 2], w: [-node.w / 2, 0] }[anchor] || [0, 0];
  const radians = (node.rotation || 0) * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return [center[0] + offset[0] * cosine - offset[1] * sine, center[1] + offset[0] * sine + offset[1] * cosine];
}

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 12) {
  const words = String(text || "").replace(/[#*_`>-]/g, " ").split(/\s+/);
  let line = ""; let lines = 0;
  for (const word of words) {
    const candidate = `${line} ${word}`.trim();
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y); y += lineHeight; lines += 1; line = word;
      if (lines >= maxLines) return y;
    } else line = candidate;
  }
  if (line && lines < maxLines) context.fillText(line, x, y);
  return y + lineHeight;
}

async function loadAssetImage(assetId) {
  const asset = await assetDb.get(assetId); if (!asset?.blob) return null;
  const bitmap = await createImageBitmap(asset.blob).catch(() => null); return bitmap;
}

function drawGroups(ctx) {
  state.board.groups.filter((group) => !isEffectivelyHidden(group)).forEach((group) => {
    ctx.save(); ctx.strokeStyle = group.color; ctx.globalAlpha = .5; ctx.setLineDash([8, 7]); ctx.lineWidth = 1.5; ctx.strokeRect(group.x, group.y, group.w, group.collapsed ? 1 : group.h); ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.fillStyle = group.color; ctx.font = "700 13px system-ui"; ctx.fillText(`${group.collapsed ? "▸ " : ""}${group.title}`, group.x + 12, group.y - 10); ctx.restore();
  });
}

function drawAxes(ctx) {
  state.board.axes.filter((axis) => !isEffectivelyHidden(axis)).forEach((axis) => {
    ctx.save(); ctx.strokeStyle = axis.color; ctx.fillStyle = axis.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(axis.x, axis.y); ctx.lineTo(axis.x + (axis.orientation === "x" ? axis.length : 0), axis.y + (axis.orientation === "y" ? axis.length : 0)); ctx.stroke(); ctx.font = "700 12px system-ui"; ctx.fillText(axis.label, axis.x, axis.y - 14);
    axisTicks(axis).forEach((tick) => { const x = axis.x + (axis.orientation === "x" ? axis.length * tick.ratio : 0); const y = axis.y + (axis.orientation === "y" ? axis.length * tick.ratio : 0); ctx.beginPath(); ctx.moveTo(x - (axis.orientation === "y" ? 6 : 0), y - (axis.orientation === "x" ? 6 : 0)); ctx.lineTo(x + (axis.orientation === "y" ? 6 : 0), y + (axis.orientation === "x" ? 6 : 0)); ctx.stroke(); ctx.font = "11px system-ui"; ctx.fillText(tick.value, x + 8, y + 18); }); ctx.restore();
  });
}

function drawArrow(ctx, tip, previous, color) {
  const angle = Math.atan2(tip[1] - previous[1], tip[0] - previous[0]); const size = 9;
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(tip[0] - size * Math.cos(angle - .48), tip[1] - size * Math.sin(angle - .48)); ctx.lineTo(tip[0] - size * Math.cos(angle + .48), tip[1] - size * Math.sin(angle + .48)); ctx.closePath(); ctx.fill(); ctx.restore();
}

function drawEdges(ctx) {
  const nodeMap = new Map(state.board.nodes.filter((node) => !isEffectivelyHidden(node)).map((node) => [node.id, node]));
  state.board.edges.filter((edge) => !edge.hidden).forEach((edge) => {
    const from = nodeMap.get(edge.from); const to = nodeMap.get(edge.to); if (!from || !to) return;
    const [sx, sy] = anchorPoint(from, edge.fromAnchor); const [ex, ey] = anchorPoint(to, edge.toAnchor); const horizontal = ["e", "w"].includes(edge.fromAnchor);
    const distance = Math.max(70, Math.min(240, (horizontal ? Math.abs(ex - sx) : Math.abs(ey - sy)) * .45)); const offsets = { n: [0, -distance], e: [distance, 0], s: [0, distance], w: [-distance, 0] };
    const a = offsets[edge.fromAnchor] || [distance, 0]; const b = offsets[edge.toAnchor] || [-distance, 0]; const color = edge.color || "#cbd2d0";
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; if (edge.style === "dashed") ctx.setLineDash([9, 6]); if (edge.style === "dotted") { ctx.setLineDash([2, 6]); ctx.lineCap = "round"; }
    ctx.beginPath(); ctx.moveTo(sx, sy); const type = edge.connectionType && edge.connectionType !== "inherit" ? edge.connectionType : state.board.settings?.connectionType;
    if (type === "straight") ctx.lineTo(ex, ey); else ctx.bezierCurveTo(sx + a[0], sy + a[1], ex + b[0], ey + b[1], ex, ey); ctx.stroke(); ctx.restore();
    if (["forward", "both"].includes(edge.direction)) drawArrow(ctx, [ex, ey], type === "straight" ? [sx, sy] : [ex + b[0], ey + b[1]], color);
    if (["backward", "both"].includes(edge.direction)) drawArrow(ctx, [sx, sy], type === "straight" ? [ex, ey] : [sx + a[0], sy + a[1]], color);
    if (edge.label) { ctx.save(); ctx.fillStyle = "#fffdfd"; ctx.font = "12px system-ui"; ctx.fillText(edge.label, (sx + ex) / 2, (sy + ey) / 2 - 7); ctx.restore(); }
  });
}

async function drawNodes(ctx) {
  for (const node of state.board.nodes.filter((item) => !isEffectivelyHidden(item))) {
    ctx.save(); const center = { x: node.x + node.w / 2, y: node.y + node.h / 2 }; ctx.translate(center.x, center.y); ctx.rotate((node.rotation || 0) * Math.PI / 180); ctx.translate(-center.x, -center.y); ctx.fillStyle = "#343c38"; ctx.strokeStyle = "#505b56"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(node.x, node.y, node.w, node.h, 3); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(node.x, node.y + 32); ctx.lineTo(node.x + node.w, node.y + 32); ctx.strokeStyle = "#505b56"; ctx.stroke(); ctx.fillStyle = "#ff715b"; ctx.font = "800 10px system-ui"; ctx.fillText(node.type.toUpperCase(), node.x + 10, node.y + 20); ctx.fillStyle = "#eef1f0"; ctx.font = "650 12px system-ui"; ctx.fillText(node.title.slice(0, 34), node.x + 68, node.y + 20);
    if (node.type === "image") { const image = await loadAssetImage(node.assetId); if (image) { const available = node.h - 32; const ratio = Math.max(node.w / image.width, available / image.height); const sw = node.w / ratio; const sh = available / ratio; const sx = (image.width - sw) / 2; const sy = (image.height - sh) / 2; ctx.drawImage(image, sx, sy, sw, sh, node.x, node.y + 32, node.w, available); image.close?.(); } }
    else { ctx.fillStyle = "#fffdfd"; ctx.font = "13px system-ui"; wrapText(ctx, node.content, node.x + 13, node.y + 54, node.w - 26, 19, Math.floor((node.h - 48) / 19)); }
    ctx.restore();
  }
}

export async function renderRegion(region, options = {}) {
  const scale = options.scale || Math.min(2, 12000 / Math.max(region.w, region.h, 1));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.ceil(region.w * scale)); canvas.height = Math.max(1, Math.ceil(region.h * scale));
  const ctx = canvas.getContext("2d"); ctx.scale(scale, scale); ctx.fillStyle = "#202623"; ctx.fillRect(0, 0, region.w, region.h); ctx.translate(-region.x, -region.y);
  const patternCanvas = document.createElement("canvas"); patternCanvas.width = 24; patternCanvas.height = 24; const pctx = patternCanvas.getContext("2d"); pctx.fillStyle = "rgba(203,210,208,.18)"; pctx.beginPath(); pctx.arc(1, 1, 1, 0, Math.PI * 2); pctx.fill(); ctx.fillStyle = ctx.createPattern(patternCanvas, "repeat"); ctx.fillRect(region.x, region.y, region.w, region.h);
  drawAxes(ctx); drawGroups(ctx); drawEdges(ctx); await drawNodes(ctx);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", .95));
}

export async function captureRegion(region) {
  if (region.w < 10 || region.h < 10) return;
  const blob = await renderRegion(region); downloadBlob(blob, `${safeName(state.board.title)}-capture.png`); return blob;
}

function visualNodeBounds(node) { const radians = (node.rotation || 0) * Math.PI / 180; const cosine = Math.abs(Math.cos(radians)); const sine = Math.abs(Math.sin(radians)); const width = node.w * cosine + node.h * sine; const height = node.w * sine + node.h * cosine; return { x: node.x + node.w / 2 - width / 2, y: node.y + node.h / 2 - height / 2, w: width, h: height }; }
export function boardBounds() { return boundsOf([...state.board.nodes.filter((item) => !isEffectivelyHidden(item)).map(visualNodeBounds), ...state.board.groups.filter((item) => !isEffectivelyHidden(item)).map((group) => ({ ...group, h: group.collapsed ? 1 : group.h })), ...state.board.axes.filter((item) => !isEffectivelyHidden(item)).map((axis) => ({ x: axis.x, y: axis.y, w: axis.orientation === "x" ? axis.length : 150, h: axis.orientation === "y" ? axis.length : 90 }))], 80); }
