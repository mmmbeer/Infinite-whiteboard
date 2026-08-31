import { state } from "./state.js";

export function getGroup(id) {
  return state.board.groups.find((group) => group.id === id) || null;
}

export function getAxis(id) {
  return state.board.axes.find((axis) => axis.id === id) || null;
}

export function getItem(id) {
  return state.board.nodes.find((item) => item.id === id)
    || getGroup(id)
    || getAxis(id)
    || state.board.edges.find((item) => item.id === id)
    || null;
}

export function itemKind(item) {
  if (!item) return null;
  if (state.board.nodes.includes(item)) return "node";
  if (state.board.groups.includes(item)) return "group";
  if (state.board.axes.includes(item)) return "axis";
  if (state.board.edges.includes(item)) return "edge";
  return null;
}

export function ancestorGroups(groupId) {
  const result = [];
  const seen = new Set();
  let current = getGroup(groupId);
  while (current && !seen.has(current.id)) {
    result.push(current); seen.add(current.id); current = getGroup(current.parentId);
  }
  return result;
}

export function descendantGroupIds(groupId) {
  const result = new Set();
  const visit = (id) => state.board.groups.filter((group) => group.parentId === id).forEach((group) => {
    if (result.has(group.id)) return;
    result.add(group.id); visit(group.id);
  });
  visit(groupId); return result;
}

export function groupNodeIds(groupId, deep = true) {
  const groupIds = deep ? descendantGroupIds(groupId) : new Set();
  groupIds.add(groupId);
  return new Set(state.board.nodes.filter((node) => groupIds.has(node.groupId)).map((node) => node.id));
}

export function groupContents(groupId, deep = true) {
  const groupIds = deep ? descendantGroupIds(groupId) : new Set();
  groupIds.add(groupId);
  return {
    groups: state.board.groups.filter((group) => groupIds.has(group.id)),
    nodes: state.board.nodes.filter((node) => groupIds.has(node.groupId)),
  };
}

export function hasCollapsedAncestor(item) {
  const parentId = state.board.nodes.includes(item) ? item.groupId : item.parentId;
  return ancestorGroups(parentId).some((group) => group.collapsed || group.hidden);
}

export function isEffectivelyHidden(item) {
  return Boolean(item?.hidden || hasCollapsedAncestor(item));
}

export function isExportHidden(item) {
  if (!item) return false;
  const parentId = state.board.nodes.includes(item) ? item.groupId : item.parentId;
  return Boolean(item.hidden || ancestorGroups(parentId).some((group) => group.hidden));
}

export function isEffectivelyLocked(item) {
  if (!item) return false;
  const parentId = state.board.nodes.includes(item) ? item.groupId : item.parentId;
  return Boolean(item.locked || ancestorGroups(parentId).some((group) => group.locked));
}

export function selectedItems({ includeHidden = false } = {}) {
  return [...state.selected].map(getItem).filter((item) => item && (includeHidden || !isEffectivelyHidden(item)));
}

export function topLevelSelection() {
  const selected = new Set(state.selected);
  return selectedItems().filter((item) => {
    const parentId = state.board.nodes.includes(item) ? item.groupId : item.parentId;
    return !ancestorGroups(parentId).some((group) => selected.has(group.id));
  });
}

export function movableItemsForSelection() {
  const items = [];
  const seen = new Set();
  const add = (item) => { if (item && !seen.has(item.id) && !isEffectivelyLocked(item)) { seen.add(item.id); items.push(item); } };
  topLevelSelection().forEach((item) => {
    add(item);
    if (state.board.groups.includes(item)) {
      const contents = groupContents(item.id);
      contents.groups.forEach(add); contents.nodes.forEach(add);
    }
  });
  return items;
}

export function visibleBoardItems() {
  return [...state.board.groups, ...state.board.axes, ...state.board.nodes].filter((item) => !isEffectivelyHidden(item));
}
