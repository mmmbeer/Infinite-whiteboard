import { renderMarkdown } from "./markdown.js";
import { openModal, promptDialog } from "./ui.js";
import { $, escapeHtml } from "./utils.js";

function textMarkdown(value) {
  return value.replace(/\\/g, "\\\\").replace(/([*_\[\]`~])/g, "\\$1");
}

function serializeChildren(node, context = {}) {
  return [...node.childNodes].map((child) => serializeNode(child, context)).join("");
}

function serializeList(node, ordered) {
  return [...node.children].filter((child) => child.tagName === "LI").map((item, index) => {
    const checkbox = $("input[type=checkbox]", item);
    const clone = item.cloneNode(true);
    clone.querySelectorAll("input[type=checkbox]").forEach((input) => input.remove());
    const value = serializeChildren(clone).trim().replace(/\n{2,}/g, "\n  ");
    const marker = checkbox ? `- [${checkbox.checked ? "x" : " "}]` : ordered ? `${index + 1}.` : "-";
    return `${marker} ${value}`;
  }).join("\n") + "\n\n";
}

function serializeTable(table) {
  const rows = [...table.rows];
  if (!rows.length) return "";
  const cells = (row) => [...row.cells].map((cell) => serializeChildren(cell).trim().replace(/\|/g, "\\|") || " ");
  const header = cells(rows[0]);
  const divider = header.map(() => "---");
  return `| ${header.join(" | ")} |\n| ${divider.join(" | ")} |${rows.slice(1).map((row) => `\n| ${cells(row).join(" | ")} |`).join("")}\n\n`;
}

function serializeNode(node, context = {}) {
  if (node.nodeType === Node.TEXT_NODE) return context.raw ? node.nodeValue : textMarkdown(node.nodeValue || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  const children = () => serializeChildren(node, context);
  if (tag === "br") return "  \n";
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
  if (tag === "p" || tag === "div") return `${children().trim()}\n\n`;
  if (tag === "strong" || tag === "b") return `**${children()}**`;
  if (tag === "em" || tag === "i") return `*${children()}*`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${children()}~~`;
  if (tag === "code" && node.parentElement?.tagName !== "PRE") return `\`${serializeChildren(node, { raw: true })}\``;
  if (tag === "pre") {
    const code = $("code", node);
    const language = code?.className.match(/language-([\w-]+)/)?.[1] || "";
    return `\`\`\`${language}\n${(code || node).textContent.replace(/\n$/, "")}\n\`\`\`\n\n`;
  }
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    const title = node.getAttribute("title");
    return href ? `[${children()}](${href}${title ? ` "${title.replace(/"/g, "\\\"")}"` : ""})` : children();
  }
  if (tag === "img") {
    const src = node.getAttribute("src") || "";
    const alt = node.getAttribute("alt") || "";
    const title = node.getAttribute("title");
    return src ? `![${alt}](${src}${title ? ` "${title.replace(/"/g, "\\\"")}"` : ""})` : alt;
  }
  if (tag === "blockquote") return `${children().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  if (tag === "ul") return serializeList(node, false);
  if (tag === "ol") return serializeList(node, true);
  if (tag === "li") return children();
  if (tag === "table") return serializeTable(node);
  if (tag === "hr") return "---\n\n";
  if (tag === "input") return "";
  return children();
}

export function htmlToMarkdown(root) {
  return serializeChildren(root).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function toolbarHtml() {
  const button = (command, label, title) => `<button type="button" data-md-command="${command}" title="${title}" aria-label="${title}">${label}</button>`;
  return `<div class="markdown-editor-top"><div class="markdown-modes" role="group" aria-label="Editor mode"><button type="button" class="active" data-md-mode="visual">Visual</button><button type="button" data-md-mode="source">Source</button></div><span class="markdown-editor-hint">Markdown is saved as plain text</span></div><div class="markdown-toolbar" role="toolbar" aria-label="Markdown formatting"><div class="markdown-tool-group">${button("paragraph", "¶", "Paragraph")}${button("h1", "H1", "Heading 1")}${button("h2", "H2", "Heading 2")}${button("h3", "H3", "Heading 3")}</div><div class="markdown-tool-group">${button("bold", "B", "Bold (Ctrl+B)")}${button("italic", "I", "Italic (Ctrl+I)")}${button("strike", "S", "Strikethrough")}${button("code", "&lt;/&gt;", "Inline code")}${button("link", "↗", "Link (Ctrl+K)")}</div><div class="markdown-tool-group">${button("bullet", "•", "Bulleted list")}${button("ordered", "1.", "Numbered list")}${button("task", "☑", "Task list")}${button("quote", "❯", "Quote")}${button("codeblock", "{ }", "Code block")}</div><div class="markdown-tool-group">${button("table", "▦", "Table")}${button("rule", "―", "Horizontal rule")}${button("undo", "↶", "Undo")}${button("redo", "↷", "Redo")}</div></div>`;
}

function replaceSourceSelection(source, before, after = before, fallback = "text") {
  const start = source.selectionStart;
  const end = source.selectionEnd;
  const selected = source.value.slice(start, end) || fallback;
  source.setRangeText(`${before}${selected}${after}`, start, end, "end");
  source.focus();
}

function insertSource(source, value) {
  source.setRangeText(value, source.selectionStart, source.selectionEnd, "end");
  source.focus();
}

function prefixSourceLines(source, prefix, clear = /^(#{1,6}|[-*+]|\d+[.)]|>)\s+/) {
  const start = source.value.lastIndexOf("\n", source.selectionStart - 1) + 1;
  const endBreak = source.value.indexOf("\n", source.selectionEnd);
  const end = endBreak < 0 ? source.value.length : endBreak;
  const value = source.value.slice(start, end).split("\n").map((line, index) => `${typeof prefix === "function" ? prefix(index) : prefix}${line.replace(clear, "")}`).join("\n");
  source.setRangeText(value, start, end, "select"); source.focus();
}

function sourceCommand(source, command) {
  const wraps = { bold: ["**", "**", "bold text"], italic: ["*", "*", "italic text"], strike: ["~~", "~~", "struck text"], code: ["`", "`", "code"] };
  if (wraps[command]) return replaceSourceSelection(source, ...wraps[command]);
  if (command === "paragraph") return prefixSourceLines(source, "", /^(#{1,6}|>)\s+/);
  if (/^h[1-3]$/.test(command)) return prefixSourceLines(source, `${"#".repeat(Number(command[1]))} `);
  if (command === "bullet") return prefixSourceLines(source, "- ");
  if (command === "ordered") return prefixSourceLines(source, (index) => `${index + 1}. `);
  if (command === "task") return prefixSourceLines(source, "- [ ] ", /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s+)/);
  if (command === "quote") return prefixSourceLines(source, "> ");
  if (command === "codeblock") return replaceSourceSelection(source, "```\n", "\n```", "code");
  if (command === "table") return insertSource(source, "| Heading | Heading |\n| --- | --- |\n| Cell | Cell |");
  if (command === "rule") return insertSource(source, "\n\n---\n\n");
  if (command === "undo" || command === "redo") document.execCommand(command);
}

function insertVisualHtml(html) {
  document.execCommand("insertHTML", false, html);
}

function visualCommand(command) {
  const simple = { bold: "bold", italic: "italic", strike: "strikeThrough", bullet: "insertUnorderedList", ordered: "insertOrderedList", rule: "insertHorizontalRule", undo: "undo", redo: "redo" };
  if (simple[command]) return document.execCommand(simple[command]);
  if (command === "paragraph" || /^h[1-3]$/.test(command)) return document.execCommand("formatBlock", false, command === "paragraph" ? "p" : command);
  if (command === "quote") return document.execCommand("formatBlock", false, "blockquote");
  if (command === "codeblock") return document.execCommand("formatBlock", false, "pre");
  if (command === "code") return insertVisualHtml(`<code>${escapeHtml(getSelection()?.toString() || "code")}</code>`);
  if (command === "task") return insertVisualHtml('<ul class="task-list"><li class="task-item"><input type="checkbox"> <span>Task</span></li></ul><p><br></p>');
  if (command === "table") return insertVisualHtml("<table><thead><tr><th>Heading</th><th>Heading</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>");
}

async function addLink(mode, visual, source, savedRange) {
  const url = await promptDialog({ title: "Add link", label: "URL", placeholder: "https://example.com", confirmLabel: "Add link" });
  if (!url) return;
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return;
  if (mode === "source") return replaceSourceSelection(source, "[", `](${url})`, "link text");
  visual.focus();
  if (savedRange) { const selection = getSelection(); selection.removeAllRanges(); selection.addRange(savedRange); }
  if (getSelection()?.isCollapsed) insertVisualHtml(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`);
  else document.execCommand("createLink", false, url);
}

export function openMarkdownEditor({ title = "Edit Markdown", value = "", confirmLabel = "Save" } = {}) {
  return new Promise((resolve) => {
    const content = document.createElement("div");
    content.className = "markdown-editor";
    content.innerHTML = `${toolbarHtml()}<div class="markdown-visual node-markdown" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Visual Markdown editor"></div><textarea class="markdown-source" aria-label="Markdown source" spellcheck="false"></textarea>`;
    const visual = $(".markdown-visual", content);
    const source = $(".markdown-source", content);
    visual.dataset.placeholder = "Start writing, or switch to Source for raw Markdown…";
    source.placeholder = "# Heading\n\nWrite with **Markdown**";
    visual.innerHTML = renderMarkdown(value);
    visual.querySelectorAll("input[type=checkbox]").forEach((input) => { input.disabled = false; });
    source.value = value;
    let mode = "visual";
    let savedRange = null;

    const setMode = (next) => {
      if (next === mode) return;
      if (next === "source") source.value = htmlToMarkdown(visual);
      else {
        visual.innerHTML = renderMarkdown(source.value);
        visual.querySelectorAll("input[type=checkbox]").forEach((input) => { input.disabled = false; });
      }
      mode = next;
      savedRange = null;
      content.dataset.mode = mode;
      content.querySelectorAll("[data-md-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mdMode === mode));
      (mode === "visual" ? visual : source).focus();
    };

    content.dataset.mode = mode;
    content.querySelectorAll("[data-md-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mdMode)));
    $(".markdown-toolbar", content).addEventListener("pointerdown", (event) => event.preventDefault());
    $(".markdown-toolbar", content).addEventListener("click", async (event) => {
      const command = event.target.closest("[data-md-command]")?.dataset.mdCommand;
      if (!command) return;
      if (command === "link") await addLink(mode, visual, source, savedRange);
      else if (mode === "source") sourceCommand(source, command);
      else { visual.focus(); if (savedRange) { const selection = getSelection(); selection.removeAllRanges(); selection.addRange(savedRange); } visualCommand(command); }
    });
    visual.addEventListener("keyup", () => { const selection = getSelection(); if (selection?.rangeCount) savedRange = selection.getRangeAt(0).cloneRange(); });
    visual.addEventListener("mouseup", () => { const selection = getSelection(); if (selection?.rangeCount) savedRange = selection.getRangeAt(0).cloneRange(); });
    visual.addEventListener("paste", (event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); });
    content.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        if (mode === "source" && event.key === "Tab") { event.preventDefault(); replaceSourceSelection(source, "  ", "", ""); }
        return;
      }
      const command = { b: "bold", i: "italic", k: "link" }[event.key.toLowerCase()];
      if (!command) return;
      event.preventDefault();
      if (command === "link") addLink(mode, visual, source, savedRange);
      else if (mode === "source") sourceCommand(source, command);
      else visualCommand(command);
    });

    const modal = openModal({
      title,
      content,
      onClose: (result) => resolve(result === null || result === undefined ? null : String(result)),
      actions: [
        { label: "Cancel", onClick: () => null },
        { label: confirmLabel, className: "primary", onClick: () => mode === "source" ? source.value.trim() : htmlToMarkdown(visual) },
      ],
    });
    $(".modal", modal.element).classList.add("markdown-editor-modal");
    setTimeout(() => visual.focus(), 0);
  });
}
