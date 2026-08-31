function text(value) { return String(value || "").toLowerCase(); }
function tagsOf(item) { return Array.isArray(item.tags) ? item.tags : []; }

function nodeResult(node) {
  return { kind: "node", type: node.type, id: node.id, title: node.title || "Untitled", category: node.category || "", tags: tagsOf(node), searchable: [node.title, node.content, node.description, node.category, ...tagsOf(node)].join(" "), snippet: node.content || node.description || "" };
}

function groupResult(group) {
  return { kind: "group", type: "group", id: group.id, title: group.title || "Untitled group", category: group.category || "", tags: tagsOf(group), searchable: [group.title, group.description, group.category, ...tagsOf(group)].join(" "), snippet: group.description || "Group frame" };
}

function axisResult(axis) {
  const values = axis.mode === "number" ? [axis.min, axis.max, axis.step] : (axis.eras || []);
  return { kind: "axis", type: "axis", id: axis.id, title: axis.label || "Timeline", category: "", tags: [], searchable: [axis.label, ...values].join(" "), snippet: axis.mode === "number" ? `${axis.min}–${axis.max} · step ${axis.step}` : values.join(" · ") };
}

function edgeResult(edge, nodes) {
  const from = nodes.get(edge.from)?.title || "Source"; const to = nodes.get(edge.to)?.title || "Target";
  return { kind: "edge", type: "connection", id: edge.id, title: edge.label || `${from} → ${to}`, category: edge.category || "", tags: tagsOf(edge), searchable: [edge.label, edge.category, from, to, ...tagsOf(edge)].join(" "), snippet: `${from} → ${to}` };
}

export function boardSearchItems(board) {
  const nodes = new Map(board.nodes.map((node) => [node.id, node]));
  return [...board.nodes.map(nodeResult), ...board.groups.map(groupResult), ...board.axes.map(axisResult), ...board.edges.map((edge) => edgeResult(edge, nodes))];
}

export function searchBoard(board, filters = {}) {
  const query = text(filters.query).trim(); const tokens = query.split(/\s+/).filter(Boolean);
  const type = text(filters.type); const category = text(filters.category); const tag = text(filters.tag);
  return boardSearchItems(board).filter((item) => {
    if (type && type !== "all" && text(item.type) !== type) return false;
    if (category && category !== "all" && text(item.category) !== category) return false;
    if (tag && tag !== "all" && !item.tags.some((value) => text(value) === tag)) return false;
    const haystack = text(item.searchable); return tokens.every((token) => haystack.includes(token));
  }).map((item) => {
    const title = text(item.title); const score = !query ? 0 : title === query ? 4 : title.startsWith(query) ? 3 : title.includes(query) ? 2 : 1;
    return { ...item, score };
  }).sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
}

export function searchFacets(board) {
  const items = boardSearchItems(board);
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { types: unique(items.map((item) => item.type)), categories: unique(items.map((item) => item.category)), tags: unique(items.flatMap((item) => item.tags)) };
}
