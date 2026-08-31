import assert from "node:assert/strict";
import { renderMarkdown } from "../js/markdown.js";

const rendered = renderMarkdown(`# Heading

1. First
2. Second

- [ ] Open
- [x] Done

> A **useful** quote

| Name | Status |
| :--- | ---: |
| Editor | Ready |

\`\`\`js
<script>alert("unsafe")</script>
\`\`\`

~~removed~~ [safe](https://example.com) [mail](mailto:test@example.com)`);

assert.match(rendered, /<h1>Heading<\/h1>/);
assert.match(rendered, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
assert.match(rendered, /class="task-list"/);
assert.match(rendered, /type="checkbox" disabled checked/);
assert.match(rendered, /<blockquote>.*<strong>useful<\/strong>.*<\/blockquote>/);
assert.match(rendered, /<table>.*text-align:left.*text-align:right.*<\/table>/);
assert.match(rendered, /<pre><code class="language-js">&lt;script&gt;/);
assert.match(rendered, /<del>removed<\/del>/);
assert.match(rendered, /href="https:\/\/example.com"/);
assert.match(rendered, /href="mailto:test@example.com"/);
assert.doesNotMatch(rendered, /<script>/);

const unsafe = renderMarkdown(`[bad](javascript:alert(1))

![bad](data:text/html,boom)

<img src=x onerror=alert(1)>`);
assert.doesNotMatch(unsafe, /href=/);
assert.doesNotMatch(unsafe, /<img/);
assert.match(unsafe, /&lt;img src=x onerror=alert\(1\)&gt;/);

assert.equal(renderMarkdown("line one  \nline two"), "<p>line one<br>line two</p>");
assert.equal(renderMarkdown("\\*literal stars\\*"), "<p>*literal stars*</p>");
assert.match(renderMarkdown('[title](https://example.com "Example")'), /title="Example"/);
