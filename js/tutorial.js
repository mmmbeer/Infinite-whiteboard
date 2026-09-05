import { escapeHtml } from "./utils.js";

const TUTORIAL_KEY = "infinite-whiteboard-tutorial-v1";

const steps = [
  {
    target: ".brand",
    title: "A board without edges",
    copy: "Infinite Whiteboard stores boards and their assets in this browser. Pan and zoom freely while your cards, frames, axes, and connections stay in one continuous workspace.",
  },
  {
    target: "#create-fab",
    title: "Create or drop content",
    copy: "Use + to add text, Markdown, a frame, or an axis. You can also drop images, text files, and Markdown files directly at the position where they belong.",
  },
  {
    target: "#viewport",
    title: "Move around naturally",
    copy: "Drag empty canvas with the primary mouse button or one finger to pan. A trackpad or mouse wheel pans. Hold Ctrl or Cmd while scrolling to zoom. Pinch with two fingers to pan and zoom together.",
    placement: "center",
  },
  {
    target: ".tool-rail",
    title: "Select and transform",
    copy: "Tap or click an item to select it. Drag its header to move it. Image and frame handles resize, and the round image handle rotates. Use Shift-drag or Multi for a marquee selection.",
  },
  {
    target: "[data-tool='connect']",
    title: "Connect ideas",
    copy: "Select Connect, then drag from a card anchor toward another card. The endpoint snaps into place. Select a connection later to change its color, line style, direction, label, or endpoints.",
  },
  {
    target: "[data-tool='group']",
    title: "Build structure",
    copy: "Frame a selection to keep related material together. Frames can nest, collapse, resize, lock, and hide. Add functional era or numeric axes and snap cards to their values.",
  },
  {
    target: ".zoom-controls",
    title: "Navigate large boards",
    copy: "Use the zoom controls to reset, fit the board, or focus the selection. The navigator minimap shows both your content and the current viewport and can be dragged to jump around.",
  },
  {
    target: "#layers-btn",
    title: "Find and organize",
    copy: "Search locates content across the board. Layers controls order, visibility, and locks. Navigation bookmarks save named views so you can return to important areas instantly.",
  },
  {
    target: "#boards-btn",
    title: "Local history and boards",
    copy: "Boards are saved locally as you work. The Boards panel switches boards, creates checkpoints, restores history, and imports a previous board backup.",
  },
  {
    target: "#export-btn",
    title: "Take everything with you",
    copy: "Export creates a ZIP containing the complete board data and its original assets. Open Settings whenever you want to replay this tutorial or adjust snapping and connection defaults.",
  },
];

let active = null;

function visibleTarget(selector) {
  const element = document.querySelector(selector);
  return element && element.getClientRects().length ? element : document.querySelector("#viewport");
}

function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }

function positionPopover(popover, target, placement) {
  const margin = 10; const gap = 11; const targetRect = target.getBoundingClientRect(); const box = popover.getBoundingClientRect();
  let left; let top;
  if (placement === "center") {
    left = (innerWidth - box.width) / 2; top = (innerHeight - box.height) / 2;
  } else {
    const roomBelow = innerHeight - targetRect.bottom; const roomAbove = targetRect.top;
    left = targetRect.left + targetRect.width / 2 - box.width / 2;
    top = roomBelow >= box.height + gap || roomBelow >= roomAbove ? targetRect.bottom + gap : targetRect.top - box.height - gap;
  }
  popover.style.left = `${clamp(left, margin, innerWidth - box.width - margin)}px`;
  popover.style.top = `${clamp(top, margin, innerHeight - box.height - margin)}px`;
}

function finish() {
  if (!active) return;
  active.target?.classList.remove("tutorial-target");
  active.element.remove();
  removeEventListener("resize", active.reposition);
  document.removeEventListener("keydown", active.onKey);
  active = null;
}

function renderStep(index) {
  if (!active) return;
  active.target?.classList.remove("tutorial-target");
  active.index = index;
  const step = steps[index]; const target = visibleTarget(step.target); active.target = target;
  target?.classList.add("tutorial-target");
  active.element.innerHTML = `
    <header class="tutorial-head">
      <span>QUICK TOUR · ${index + 1}/${steps.length}</span>
      <button type="button" data-tutorial-close aria-label="Close tutorial">×</button>
    </header>
    <div class="tutorial-body">
      <h2>${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.copy)}</p>
      <div class="tutorial-progress" aria-hidden="true">${steps.map((_, dot) => `<i class="${dot === index ? "active" : ""}"></i>`).join("")}</div>
    </div>
    <footer class="tutorial-actions">
      <button type="button" class="button" data-tutorial-skip>End tour</button>
      <span></span>
      ${index ? `<button type="button" class="button" data-tutorial-back>Back</button>` : ""}
      <button type="button" class="button primary" data-tutorial-next>${index === steps.length - 1 ? "Finish" : "Next"}</button>
    </footer>`;
  active.element.querySelector("[data-tutorial-close]").onclick = finish;
  active.element.querySelector("[data-tutorial-skip]").onclick = finish;
  active.element.querySelector("[data-tutorial-back]")?.addEventListener("click", () => renderStep(index - 1));
  active.element.querySelector("[data-tutorial-next]").onclick = () => index === steps.length - 1 ? finish() : renderStep(index + 1);
  requestAnimationFrame(() => positionPopover(active.element, target, step.placement));
}

export function showTutorial({ force = false } = {}) {
  if (active || !force && localStorage.getItem(TUTORIAL_KEY)) return false;
  localStorage.setItem(TUTORIAL_KEY, "seen");
  const element = document.createElement("aside"); element.className = "tutorial-popover"; element.setAttribute("role", "dialog"); element.setAttribute("aria-label", "Infinite Whiteboard quick tour");
  document.body.append(element);
  const reposition = () => active && positionPopover(element, active.target, steps[active.index].placement);
  const onKey = (event) => {
    if (!active) return;
    if (event.key === "Escape") finish();
    if (event.key === "ArrowRight") renderStep(Math.min(steps.length - 1, active.index + 1));
    if (event.key === "ArrowLeft") renderStep(Math.max(0, active.index - 1));
  };
  active = { element, index: 0, target: null, reposition, onKey };
  addEventListener("resize", reposition); document.addEventListener("keydown", onKey); renderStep(0); return true;
}

export function showTutorialOnce() { return showTutorial(); }
