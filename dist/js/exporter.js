import { assetDb } from "./database.js";
import { state } from "./state.js";
import { boardBounds, renderRegion } from "./screenshot.js";
import { makeZip } from "./zip.js";
import { downloadBlob, safeName } from "./utils.js";
import { toast } from "./ui.js";

function uniqueAssetName(asset, used) {
  const safe = asset.name.replace(/[^a-z0-9._-]+/gi, "-") || `${asset.id}.bin`;
  let name = safe; let index = 2;
  while (used.has(name)) { const dot = safe.lastIndexOf("."); name = dot > 0 ? `${safe.slice(0, dot)}-${index}${safe.slice(dot)}` : `${safe}-${index}`; index += 1; }
  used.add(name); return name;
}

export async function exportBoard() {
  toast("Preparing export", "Collecting local board data and original assets.");
  const referenced = new Set(state.board.nodes.map((node) => node.assetId).filter(Boolean));
  const assets = (await assetDb.all()).filter((asset) => referenced.has(asset.id)); const used = new Set(); const manifest = [];
  const entries = assets.map((asset) => {
    const name = uniqueAssetName(asset, used); manifest.push({ id: asset.id, name, originalName: asset.name, type: asset.type, size: asset.size });
    return { name: `assets/${name}`, data: asset.blob, date: new Date(asset.createdAt || Date.now()) };
  });
  const board = structuredClone(state.board); board.exportedAt = new Date().toISOString(); board.assetManifest = manifest;
  const preview = await renderRegion(boardBounds(), { scale: 1 });
  entries.unshift(
    { name: "board.json", data: JSON.stringify(board, null, 2) },
    { name: "preview.png", data: preview },
    { name: "README.txt", data: "Infinite Whiteboard export\n\nboard.json contains the complete board structure.\nassets/ contains every original uploaded asset.\npreview.png is a full-board snapshot.\n\nThe application stores its working data locally in your browser." },
  );
  const zip = await makeZip(entries); downloadBlob(zip, `${safeName(state.board.title)}-whiteboard.zip`);
  toast("Export complete", `${assets.length} original ${assets.length === 1 ? "asset" : "assets"} included.`); return zip;
}
