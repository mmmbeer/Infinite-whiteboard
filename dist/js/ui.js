import { $, escapeHtml } from "./utils.js";

const modalRoot = () => $("#modal-root");
const toastRoot = () => $("#toast-root");

export function toast(title, message = "", type = "success", duration = 3400) {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.innerHTML = `<div><strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}</div>`;
  toastRoot().append(element);
  setTimeout(() => element.remove(), duration);
}

export function openModal({ title, content, actions = [], onClose }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const actionHtml = actions.map((action, index) => `<button class="button ${action.className || ""}" data-action="${index}">${escapeHtml(action.label)}</button>`).join("");
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" aria-label="Close">×</button></header><div class="modal-body"></div>${actions.length ? `<footer class="modal-actions">${actionHtml}</footer>` : ""}</section>`;
  const body = $(".modal-body", backdrop);
  if (typeof content === "string") body.innerHTML = content;
  else body.append(content);
  const close = (value) => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.(value);
  };
  const onKey = (event) => event.key === "Escape" && close(null);
  $(".modal-close", backdrop).onclick = () => close(null);
  backdrop.onclick = (event) => event.target === backdrop && close(null);
  actions.forEach((action, index) => {
    $(`[data-action="${index}"]`, backdrop).onclick = async () => {
      const result = await action.onClick?.(body, close);
      if (action.close !== false) close(result);
    };
  });
  document.addEventListener("keydown", onKey);
  modalRoot().append(backdrop);
  setTimeout(() => $("input,textarea,select,button", body)?.focus(), 0);
  return { element: backdrop, body, close };
}

export function confirmDialog({ title = "Are you sure?", message, confirmLabel = "Confirm", destructive = false }) {
  return new Promise((resolve) => openModal({
    title,
    content: `<p class="modal-copy">${escapeHtml(message)}</p>`,
    onClose: (value) => resolve(Boolean(value)),
    actions: [
      { label: "Cancel", onClick: () => false },
      { label: confirmLabel, className: destructive ? "danger" : "primary", onClick: () => true },
    ],
  }));
}

export function promptDialog({ title, label, value = "", multiline = false, placeholder = "", confirmLabel = "Save" }) {
  return new Promise((resolve) => {
    const field = document.createElement("div");
    field.className = "field";
    const control = multiline ? "textarea" : "input";
    field.innerHTML = `<label>${escapeHtml(label)}</label><${control} placeholder="${escapeHtml(placeholder)}">${multiline ? escapeHtml(value) : ""}</${control}>`;
    const input = $(control, field);
    if (!multiline) input.value = value;
    openModal({
      title,
      content: field,
      onClose: (result) => resolve(result === null ? null : String(result)),
      actions: [
        { label: "Cancel", onClick: () => null },
        { label: confirmLabel, className: "primary", onClick: () => input.value.trim() },
      ],
    });
  });
}

export function alertDialog({ title = "Notice", message }) {
  return new Promise((resolve) => openModal({
    title,
    content: `<p class="modal-copy">${escapeHtml(message)}</p>`,
    onClose: resolve,
    actions: [{ label: "OK", className: "primary", onClick: () => true }],
  }));
}
