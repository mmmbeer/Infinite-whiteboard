import { commit, snapshot, state } from "./state.js";
import { selectionBounds } from "./arrange.js";
import { openModal, toast } from "./ui.js";
import { $, escapeHtml, uid } from "./utils.js";

export function addBookmark(name, canvas, useSelection = false) {
  const bounds = useSelection ? selectionBounds() : null;
  const bookmark = { id: uid("bookmark"), name: name.trim() || `View ${state.board.bookmarks.length + 1}`, viewport: structuredClone(state.board.viewport), bounds };
  snapshot(); state.board.bookmarks.push(bookmark); commit("bookmarks", false); return bookmark;
}

export function goToBookmark(bookmark, canvas) {
  if (!bookmark) return false;
  if (bookmark.bounds) canvas.zoomToBounds(bookmark.bounds);
  else { state.board.viewport = structuredClone(bookmark.viewport); canvas.applyTransform(); commit("viewport", false); }
  return true;
}

export function showBookmarks(canvas) {
  const content = document.createElement("div"); content.className = "bookmark-browser";
  const modal = openModal({ title: "Navigation bookmarks", content });
  const render = () => {
    content.innerHTML = `<div class="bookmark-create"><input data-bookmark-name placeholder="Bookmark name" /><button class="button primary" data-save-view>Save view</button><button class="button" data-save-selection ${state.selected.size ? "" : "disabled"}>Save selection</button></div><div class="bookmark-list">${state.board.bookmarks.length ? state.board.bookmarks.map((bookmark) => `<article class="bookmark-row"><button data-open-bookmark="${bookmark.id}"><strong>${escapeHtml(bookmark.name)}</strong><span>${bookmark.bounds ? "Selection area" : `${Math.round(bookmark.viewport.zoom * 100)}% view`}</span></button><button class="button ghost danger" data-delete-bookmark="${bookmark.id}" aria-label="Delete bookmark">×</button></article>`).join("") : `<div class="empty-list">No named views yet.</div>`}</div>`;
  };
  content.addEventListener("click", (event) => {
    const input = $("[data-bookmark-name]", content);
    if (event.target.closest("[data-save-view]")) { addBookmark(input.value, canvas, false); render(); toast("Bookmark saved"); return; }
    if (event.target.closest("[data-save-selection]")) { addBookmark(input.value, canvas, true); render(); toast("Selection bookmark saved"); return; }
    const openId = event.target.closest("[data-open-bookmark]")?.dataset.openBookmark;
    if (openId) { goToBookmark(state.board.bookmarks.find((item) => item.id === openId), canvas); modal.close(); canvas.refreshSelection(); return; }
    const deleteId = event.target.closest("[data-delete-bookmark]")?.dataset.deleteBookmark;
    if (deleteId) { snapshot(); state.board.bookmarks = state.board.bookmarks.filter((item) => item.id !== deleteId); commit("bookmarks", false); render(); }
  });
  render();
}
