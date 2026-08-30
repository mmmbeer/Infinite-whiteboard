export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const uid = (prefix = "id") => `${prefix}_${crypto.randomUUID()}`;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const debounce = (fn, delay = 250) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};
export const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
export const csvList = (value = "") => value.split(",").map((item) => item.trim()).filter(Boolean);
export const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
export const pointInRect = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
export const rectsIntersect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const boundsOf = (items, padding = 0) => {
  if (!items.length) return { x: -400, y: -260, w: 800, h: 520 };
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + (item.w || 0)));
  const bottom = Math.max(...items.map((item) => item.y + (item.h || 0)));
  return { x: left - padding, y: top - padding, w: right - left + padding * 2, h: bottom - top + padding * 2 };
};
export const colorFor = (index = 0) => ["#d8ff64", "#75d7ff", "#ff9f68", "#d99cff", "#68e1b4", "#ff7f9e"][index % 6];
export const fileBase = (name = "Untitled") => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
export const safeName = (name = "whiteboard") => name.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "whiteboard";
export const isTypingTarget = (target) => ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
