import { escapeHtml } from "./utils.js";

function safeUrl(value) {
  const url = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : "";
}

function inline(source = "") {
  const code = [];
  const escaped = [];
  const protectedSource = source.replace(/\\([\\`*_\[\]{}()#+\-.!~|>])/g, (_, value) => {
    escaped.push(escapeHtml(value));
    return `\u0000ESC${escaped.length - 1}\u0000`;
  });
  let text = escapeHtml(protectedSource).replace(/`([^`\n]+)`/g, (_, value) => {
    code.push(`<code>${value}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  text = text
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;([^\n)]*?)&quot;)?\)/g, (_, alt, url, title) => {
      const src = /^https?:\/\//i.test(url) ? url : "";
      return src ? `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ""}>` : alt;
    })
    .replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;([^\n)]*?)&quot;)?\)/g, (_, label, url, title) => {
      const href = safeUrl(url);
      return href ? `<a href="${href}"${title ? ` title="${title}"` : ""} target="_blank" rel="noreferrer">${label}</a>` : label;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>")
    .replace(/ {2}\n/g, "<br>")
    .replace(/\n/g, " ");
  return text
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)])
    .replace(/\u0000ESC(\d+)\u0000/g, (_, index) => escaped[Number(index)]);
}

function splitCells(line) {
  const clean = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return clean.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableDivider(line = "") {
  const cells = splitCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableAlignment(cell) {
  if (/^:-+:$/.test(cell)) return "center";
  if (/-+:$/.test(cell)) return "right";
  if (/^:-+/.test(cell)) return "left";
  return "";
}

function renderTable(lines, index) {
  const headers = splitCells(lines[index]);
  const divider = splitCells(lines[index + 1]);
  const alignments = divider.map(tableAlignment);
  const rows = [];
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].includes("|") && lines[cursor].trim()) {
    rows.push(splitCells(lines[cursor]));
    cursor += 1;
  }
  const attr = (column) => alignments[column] ? ` style="text-align:${alignments[column]}"` : "";
  const head = headers.map((cell, column) => `<th${attr(column)}>${inline(cell)}</th>`).join("");
  const body = rows.map((row) => `<tr>${headers.map((_, column) => `<td${attr(column)}>${inline(row[column] || "")}</td>`).join("")}</tr>`).join("");
  return { html: `<table><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ""}</table>`, next: cursor };
}

function renderList(lines, index, ordered) {
  const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  const items = [];
  let cursor = index;
  while (cursor < lines.length) {
    const match = lines[cursor].match(pattern);
    if (!match) break;
    const task = !ordered && match[1].match(/^\[([ xX])\]\s+(.+)$/);
    if (task) {
      const checked = task[1].toLowerCase() === "x";
      items.push(`<li class="task-item"><input type="checkbox" disabled${checked ? " checked" : ""}> <span>${inline(task[2])}</span></li>`);
    } else items.push(`<li>${inline(match[1])}</li>`);
    cursor += 1;
  }
  const tag = ordered ? "ol" : "ul";
  const className = items.some((item) => item.includes("task-item")) ? ' class="task-list"' : "";
  return { html: `<${tag}${className}>${items.join("")}</${tag}>`, next: cursor };
}

function startsBlock(lines, index) {
  const line = lines[index] || "";
  return !line.trim() || /^#{1,6}\s+/.test(line) || /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)
    || /^\s*```/.test(line) || /^\s*>/.test(line) || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line) || (line.includes("|") && isTableDivider(lines[index + 1]));
}

export function renderMarkdown(source = "") {
  const lines = String(source).replace(/\r/g, "").split("\n");
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      const body = []; index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) { body.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      output.push(`<pre><code${language}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); index += 1; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { output.push("<hr>"); index += 1; continue; }

    if (line.includes("|") && isTableDivider(lines[index + 1])) {
      const table = renderTable(lines, index); output.push(table.html); index = table.next; continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) { quote.push(lines[index].replace(/^\s*>\s?/, "")); index += 1; }
      output.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`); continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = renderList(lines, index, false); output.push(list.html); index = list.next; continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const list = renderList(lines, index, true); output.push(list.html); index = list.next; continue;
    }

    const paragraph = [line.trimStart()]; index += 1;
    while (index < lines.length && !startsBlock(lines, index)) { paragraph.push(lines[index].trimStart()); index += 1; }
    output.push(`<p>${inline(paragraph.join("\n"))}</p>`);
  }
  return output.join("");
}
