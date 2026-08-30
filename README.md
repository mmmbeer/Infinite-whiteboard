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
- Drag a card by its header. Shift-click or drag-select to select several cards.
- Choose **Connect**, then drag from one card anchor to another card anchor.
- Select cards and choose **Group** or press `Ctrl/Cmd+G`.
- Use the inspector to edit descriptions, categories, tags, groups, dimensions, text, and Markdown.
- Choose **Capture**, then drag across a region to download a PNG automatically.
- Choose **Export ZIP** to download `board.json`, every original asset, a full-board preview, and export notes.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select tool |
| `H` | Pan tool |
| `C` | Connect tool |
| `N` | Create item |
| `A` | Add era axis |
| `G` | Group selected cards |
| `Space` + drag | Temporarily pan |
| `Delete` | Delete selection |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `0` | Fit board |

## Data and privacy

The application has no backend, analytics, remote fonts, CDN dependencies, or external API calls. Clearing site data for `127.0.0.1:8080` also clears locally stored boards and assets. Export a ZIP before clearing browser data or moving to another machine.

## Architecture

The UI and domain behavior are separated into small modules for canvas navigation, nodes, paths, groups, axes, persistence, imports, screenshots, exports, Markdown rendering, and shared dialogs/toasts. Every JavaScript file is kept below 500 lines.
