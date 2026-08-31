import { applyBoardBackup, readBoardBackup } from "./restore.js";
import { searchBoard, searchFacets } from "./search.js";
import { archiveBoard, createBoard, createCheckpoint, deleteBoard, duplicateBoard, historyEntries, listBoards, openBoard, restoreHistoryEntry, state } from "./state.js";
import { confirmDialog, openModal, promptDialog, toast } from "./ui.js";
import { $, escapeHtml } from "./utils.js";

const dateLabel = (value) => new Date(value || Date.now()).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const optionHtml = (values) => values.map((value) => `<option value="${escapeHtml(value.toLowerCase())}">${escapeHtml(value)}</option>`).join("");

async function refreshBoard(canvas, reason = "board") {
  $("#board-title").value = state.board.title;
  canvas.applyTransform(); await canvas.refresh(reason);
}

export async function showBoardManager(canvas) {
  const content = document.createElement("div"); content.className = "board-browser";
  const modal = openModal({ title: "Boards", content });
  const render = async () => {
    const boards = await listBoards();
    content.innerHTML = `<div class="workspace-actions"><button class="button primary" data-board-action="new">New board</button><button class="button" data-board-action="import">Restore backup</button><button class="button" data-board-action="history">History</button></div><div class="board-list">${boards.map((board) => `<article class="board-row ${board.id === state.board.id ? "current" : ""} ${board.archivedAt ? "archived" : ""}"><button class="board-open" data-board-action="open" data-id="${escapeHtml(board.id)}"><strong>${escapeHtml(board.title)}</strong><span>${board.nodes.length} cards · Updated ${escapeHtml(dateLabel(board.updatedAt))}</span></button><div class="board-row-actions">${board.id === state.board.id ? `<span class="current-badge">Open</span>` : `<button class="button ghost" data-board-action="duplicate" data-id="${escapeHtml(board.id)}" title="Duplicate board">⧉</button>`}<button class="button ghost" data-board-action="archive" data-id="${escapeHtml(board.id)}" title="${board.archivedAt ? "Restore board" : "Archive board"}" ${board.id === state.board.id ? "disabled" : ""}>${board.archivedAt ? "↥" : "⌑"}</button><button class="button ghost danger" data-board-action="delete" data-id="${escapeHtml(board.id)}" title="Delete board">×</button></div></article>`).join("")}</div>`;
  };
  content.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-board-action]"); if (!button) return;
    const action = button.dataset.boardAction; const id = button.dataset.id;
    try {
      if (action === "new") {
        modal.close(); const title = await promptDialog({ title: "Create board", label: "Board title", value: "Untitled board", confirmLabel: "Create" });
        if (title !== null) { await createBoard(title); await refreshBoard(canvas); toast("Board created", state.board.title); }
      }
      if (action === "import") { modal.close(); $("#board-file-input").click(); }
      if (action === "history") { modal.close(); showHistory(canvas); }
      if (action === "open") { await openBoard(id); modal.close(); await refreshBoard(canvas); }
      if (action === "duplicate") { await duplicateBoard(id); modal.close(); await refreshBoard(canvas); toast("Board duplicated", state.board.title); }
      if (action === "archive") { const board = (await listBoards()).find((item) => item.id === id); await archiveBoard(id, !board.archivedAt); await render(); }
      if (action === "delete") {
        const board = (await listBoards()).find((item) => item.id === id);
        if (!await confirmDialog({ title: "Delete board?", message: `Delete “${board?.title || "Untitled board"}” and its recoverable history?`, confirmLabel: "Delete", destructive: true })) return;
        const wasCurrent = id === state.board.id; await deleteBoard(id); if (wasCurrent) await refreshBoard(canvas); await render(); toast("Board deleted");
      }
    } catch (error) { toast("Board action failed", error.message, "error"); }
  });
  await render();
}

export function showHistory(canvas) {
  const content = document.createElement("div"); content.className = "history-browser";
  const modal = openModal({ title: "Board history", content });
  const render = () => {
    const entries = historyEntries();
    content.innerHTML = `<div class="checkpoint-create"><input data-checkpoint-name placeholder="Checkpoint name" /><button class="button primary" data-create-checkpoint>Save checkpoint</button></div><p class="modal-copy">History is stored locally and remains available after closing the browser.</p><div class="history-list">${entries.length ? entries.map((entry) => `<article class="history-row"><div><strong>${escapeHtml(entry.label || entry.reason.replaceAll("-", " "))}</strong><span>${escapeHtml(dateLabel(entry.at))}</span></div><button class="button" data-restore-version="${escapeHtml(entry.id)}">Restore</button></article>`).join("") : `<div class="empty-list">No earlier versions yet.</div>`}</div>`;
  };
  content.addEventListener("click", async (event) => {
    if (event.target.closest("[data-create-checkpoint]")) {
      const input = $("[data-checkpoint-name]", content); createCheckpoint(input.value); render(); toast("Checkpoint saved"); return;
    }
    const id = event.target.closest("[data-restore-version]")?.dataset.restoreVersion; if (!id) return;
    if (!await confirmDialog({ title: "Restore this version?", message: "The current board will remain in history so you can undo the restore.", confirmLabel: "Restore" })) return;
    if (restoreHistoryEntry(id)) { modal.close(); await refreshBoard(canvas, "history"); toast("Version restored"); }
  });
  render();
}

export function showSearch(canvas) {
  const facets = searchFacets(state.board); const content = document.createElement("div"); content.className = "search-browser";
  content.innerHTML = `<div class="search-query"><input data-search-query type="search" placeholder="Search titles, text, descriptions, tags…" autocomplete="off" /></div><div class="search-filters"><select data-search-type><option value="all">All types</option>${optionHtml(facets.types)}</select><select data-search-category><option value="all">All categories</option>${optionHtml(facets.categories)}</select><select data-search-tag><option value="all">All tags</option>${optionHtml(facets.tags)}</select></div><div class="search-summary"></div><div class="search-results"></div>`;
  const modal = openModal({ title: "Find & outline", content }); const resultsRoot = $(".search-results", content); let current = [];
  const render = () => {
    current = searchBoard(state.board, { query: $("[data-search-query]", content).value, type: $("[data-search-type]", content).value, category: $("[data-search-category]", content).value, tag: $("[data-search-tag]", content).value });
    $(".search-summary", content).textContent = `${current.length} result${current.length === 1 ? "" : "s"}`;
    resultsRoot.innerHTML = current.length ? current.slice(0, 150).map((item) => `<button class="search-result" data-result-kind="${item.kind}" data-result-id="${escapeHtml(item.id)}"><span class="result-kind">${escapeHtml(item.type)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(String(item.snippet || "").replace(/\s+/g, " ").slice(0, 120))}</small>${item.tags.length ? `<i>${item.tags.map(escapeHtml).join(" · ")}</i>` : ""}</button>`).join("") : `<div class="empty-list">No board items match these filters.</div>`;
  };
  content.addEventListener("input", render); content.addEventListener("change", render);
  content.addEventListener("keydown", (event) => { if (event.key === "Enter" && current[0]) { event.preventDefault(); modal.close(); canvas.focusItem(current[0].kind, current[0].id); } });
  resultsRoot.addEventListener("click", (event) => { const result = event.target.closest("[data-result-id]"); if (!result) return; modal.close(); canvas.focusItem(result.dataset.resultKind, result.dataset.resultId); });
  render();
}

export async function restoreBoardFile(file, canvas) {
  try {
    const bundle = await readBoardBackup(file); const itemCount = bundle.board.nodes.length + bundle.board.groups.length + bundle.board.axes.length;
    const copy = document.createElement("div"); copy.innerHTML = `<p class="modal-copy"><strong>${escapeHtml(bundle.board.title)}</strong> contains ${itemCount} board items and ${bundle.assets.length} embedded assets.</p><p class="modal-copy">Choose whether to create a separate board, merge its contents here, or replace the current board. Replacing remains recoverable from board history.</p>`;
    const run = (mode) => async (_body, close) => {
      try { const result = await applyBoardBackup(bundle, mode); await refreshBoard(canvas, mode === "merge" ? "import" : "board"); close(true); toast("Backup restored", `${result.itemCount} items and ${result.assetCount} assets restored.`); }
      catch (error) { toast("Restore failed", error.message, "error"); }
    };
    openModal({ title: "Restore board backup", content: copy, actions: [
      { label: "As new board", className: "primary", close: false, onClick: run("new") },
      { label: "Merge here", close: false, onClick: run("merge") },
      { label: "Replace current", className: "danger", close: false, onClick: run("replace") },
    ] });
  } catch (error) { toast("Restore failed", error.message, "error"); }
}
