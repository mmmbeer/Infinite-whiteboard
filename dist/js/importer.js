import { assetDb } from "./database.js";
import { addNode, state } from "./state.js";
import { fileBase, uid } from "./utils.js";
import { toast } from "./ui.js";

async function imageDimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = Math.min(380, Math.max(200, image.naturalWidth));
    return { w: width, h: Math.max(120, Math.min(360, width / ratio + 32)) };
  } finally { URL.revokeObjectURL(url); }
}

export async function importFiles(files, point) {
  const accepted = [...files].filter((file) => file.type.startsWith("image/") || /\.(txt|md|markdown)$/i.test(file.name));
  if (!accepted.length) return toast("Nothing imported", "Use an image, .txt, .md, or .markdown file.", "error");
  let offset = 0;
  for (const file of accepted) {
    if (file.type.startsWith("image/")) {
      const assetId = uid("asset");
      await assetDb.put({ id: assetId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() });
      const size = await imageDimensions(file);
      addNode({ type: "image", title: fileBase(file.name), description: file.name, assetId, x: point.x + offset, y: point.y + offset, ...size });
    } else {
      const content = await file.text();
      addNode({ type: /\.md|\.markdown$/i.test(file.name) ? "markdown" : "text", title: fileBase(file.name), content, description: file.name, x: point.x + offset, y: point.y + offset, w: 300, h: 180 });
    }
    offset += 28;
  }
  state.selected.clear();
  const recent = state.board.nodes.slice(-accepted.length);
  recent.forEach((node) => state.selected.add(node.id));
  toast("Added to board", `${accepted.length} ${accepted.length === 1 ? "asset" : "assets"} placed at the drop point.`);
}
