# Infinite Whiteboard

A local-first infinite canvas for arranging images, editable text, Markdown, timelines, groups, and connected ideas. All board data and uploaded files remain in the browser's IndexedDB storage.

## Run locally

Python 3 is the only requirement.

```bash
python3 start.py
```

The app opens at `http://127.0.0.1:8080`. Keep using the same browser and address so it can load the board saved in that browser profile.

## Core interactions

- Drop images, `.txt`, `.md`, or `.markdown` files exactly where they should appear.
- Double-click, right-click, or long-press empty canvas space to create a card or era axis.
- Drag a card by its header. Ctrl/Cmd-click toggles an item in the current selection. Shift-click remains available for additive selection.
- Use the **Multi** tool on touch devices to tap several items into or out of a selection.
- Copy, cut, paste, or duplicate individual items, mixed selections, and complete groups. Internal connections between copied cards are retained.
- Choose **Connect**, then drag from one card anchor to another card anchor.
- Drag from any selected card's anchor toward another card. The preview snaps to the nearest target anchor.
- Select an image to reveal four resize handles and a rotation handle. Hold `Shift` while resizing to preserve its aspect ratio or while rotating to snap to 15° increments.
- Select cards and choose **Group** or press `Ctrl/Cmd+G`.
- Use the inspector to edit descriptions, categories, tags, groups, dimensions, and text. Markdown cards open a full editor with visual and source modes, formatting controls, tables, task lists, quotes, code blocks, links, and keyboard formatting shortcuts.
- Choose **Capture**, then drag across a region to download a PNG automatically.
- Choose **Export ZIP** to download `board.json`, every original asset, a full-board preview, and export notes.
- Open **Boards** to create, switch, duplicate, archive, or delete local boards. Restore an exported ZIP as a new board, merge it into the current board, or replace the current board.
- Open **Boards → History** to create checkpoints or restore automatically persisted earlier versions after a browser restart.
- Choose **Find** or press `Ctrl/Cmd+K` to search text, Markdown, descriptions, tags, categories, groups, axes, and connection labels, then jump directly to a result.
- Open **Settings** to switch all board connections between curved and straight paths.
- Right-click or long-press an item, group, axis, or connection for its context menu.
- Pinch with two fingers to zoom and pan. Touch targets and transform handles enlarge automatically on coarse-pointer devices.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select tool |
| `M` | Touch-friendly multi-select tool |
| `H` | Pan tool |
| `C` | Connect tool |
| `N` | Create item |
| `U` | Upload assets |
| `A` | Add era axis |
| `P` | Capture area |
| `G` | Group selected cards |
| `Ctrl/Cmd+click` | Add or remove an item from the selection |
| `Ctrl/Cmd+A` | Select all |
| `Ctrl/Cmd+C / X / V` | Copy / cut / paste |
| `Ctrl/Cmd+D` | Duplicate selection |
| `Ctrl/Cmd+G` | Group selection |
| `Ctrl/Cmd+Shift+G` | Ungroup selection |
| `Ctrl/Cmd+K` | Add a link in the Markdown editor; otherwise find board content |
| `Ctrl/Cmd+B / I` | Bold / italic in the Markdown editor |
| `Space` + drag | Temporarily pan |
| `Delete` | Delete selection |
| `Enter` | Edit the selected text or Markdown card |
| `Arrow keys` | Move selection by 1px (`Shift` for 10px) |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `+ / -` | Zoom in / out |
| `1` | Reset to 100% zoom |
| `0` | Fit board |
| `S / E` | Settings / export ZIP |
| `?` | Open the full keyboard and touch reference |

## Checks

Run the regression checks with:

```bash
node tests/clipboard.test.mjs
node tests/markdown.test.mjs
node tests/restore.test.mjs
node tests/search.test.mjs
node tests/state.test.mjs
node tests/zip.test.mjs
```

## Data and privacy

The application has no backend, analytics, remote fonts, CDN dependencies, or external API calls. Clearing site data for `127.0.0.1:8080` also clears locally stored boards and assets. Export a ZIP before clearing browser data or moving to another machine.

## Architecture

The UI and domain behavior are separated into small modules for canvas navigation, nodes, paths, groups, axes, persistence, imports, screenshots, exports, Markdown rendering, and shared dialogs/toasts. Every JavaScript file is kept below 500 lines.
