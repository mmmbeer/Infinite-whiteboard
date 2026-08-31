import { commit, snapshot, state } from "./state.js";
import { descendantGroupIds, getGroup, getItem, groupContents, isEffectivelyLocked, selectedItems, topLevelSelection } from "./item-tree.js";

export function translateItem(item, dx, dy, moved = new Set()) {
  if (!item || moved.has(item.id)) return;
  moved.add(item.id); item.x += dx; item.y += dy;
  if (!state.board.groups.includes(item)) return;
  const contents = groupContents(item.id);
  contents.groups.forEach((group) => {
    if (moved.has(group.id)) return;
    moved.add(group.id); group.x += dx; group.y += dy;
  });
  contents.nodes.forEach((node) => {
    if (moved.has(node.id)) return;
    moved.add(node.id); node.x += dx; node.y += dy;
  });
}

export function translateSelection(dx, dy) {
  const items = topLevelSelection().filter((item) => !isEffectivelyLocked(item));
  if (!items.length || (!dx && !dy)) return 0;
  snapshot(); const moved = new Set(); items.forEach((item) => translateItem(item, dx, dy, moved));
  state.board.nodes.filter((node) => moved.has(node.id) && node.axisBinding && !state.selected.has(node.axisBinding.axisId)).forEach((node) => { node.axisBinding = null; });
  commit("move", false); return items.length;
}

export function setSelectedState(key, value) {
  const items = selectedItems({ includeHidden: true });
  if (!items.length || !["locked", "hidden"].includes(key)) return 0;
  snapshot(); items.forEach((item) => { item[key] = value; });
  if (key === "hidden" && value) state.selected.clear();
  commit(key, false); return items.length;
}

export function toggleSelectedState(key) {
  const items = selectedItems({ includeHidden: true });
  const next = !items.length ? false : !items.every((item) => item[key]);
  return setSelectedState(key, next);
}

export function reorderSelected(direction) {
  const ids = new Set(state.selected); state.board.groups.filter((group) => ids.has(group.id)).forEach((group) => groupContents(group.id).nodes.forEach((node) => ids.add(node.id))); const nodes = state.board.nodes;
  if (!nodes.some((node) => ids.has(node.id))) return 0;
  snapshot();
  if (direction === "front") nodes.sort((a, b) => Number(ids.has(a.id)) - Number(ids.has(b.id)));
  if (direction === "back") nodes.sort((a, b) => Number(ids.has(b.id)) - Number(ids.has(a.id)));
  if (direction === "forward") {
    for (let index = nodes.length - 2; index >= 0; index -= 1) if (ids.has(nodes[index].id) && !ids.has(nodes[index + 1].id)) [nodes[index], nodes[index + 1]] = [nodes[index + 1], nodes[index]];
  }
  if (direction === "backward") {
    for (let index = 1; index < nodes.length; index += 1) if (ids.has(nodes[index].id) && !ids.has(nodes[index - 1].id)) [nodes[index], nodes[index - 1]] = [nodes[index - 1], nodes[index]];
  }
  commit("layer-order", false); return nodes.filter((node) => ids.has(node.id)).length;
}

export function toggleGroupCollapse(groupId) {
  const group = getGroup(groupId); if (!group) return false;
  snapshot(); group.collapsed = !group.collapsed;
  if (group.collapsed) {
    const hiddenIds = descendantGroupIds(group.id); hiddenIds.add(group.id);
    [...state.selected].forEach((id) => {
      const item = getItem(id);
      if ((state.board.nodes.includes(item) && hiddenIds.has(item.groupId)) || (state.board.groups.includes(item) && hiddenIds.has(item.parentId))) state.selected.delete(id);
    });
  }
  commit("group-collapse", false); return group.collapsed;
}
