import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderMarkdown } from "../dist/ChatWidget.mjs";

/**
 * Contract tests for the identity/greeting/suggestions UI and for the two
 * security details found in the 1-oct-2026 review of 0.2.5:
 *   - a quote inside a markdown link's URL closed the href attribute;
 *   - the conversation (which may carry a name and a phone) was persisted in
 *     localStorage, outliving the tab.
 *
 * Like data-chat-toggle.test.mjs these run against the built bundle, which is
 * what consumers load. The widget only renders after mount, so the UI is
 * pinned through the stable markers it carries, not through a DOM render.
 */
const bundle = readFileSync(new URL("../dist/ChatWidget.mjs", import.meta.url), "utf8");

test("renderMarkdown escapes quotes inside a link href", () => {
  const html = renderMarkdown('[ver](https://x.test/?q="onmouseover="x)');
  assert.ok(!/onmouseover="/.test(html), "an unescaped quote let an attribute through");
  assert.match(html, /href="https:\/\/x\.test\/\?q=&quot;onmouseover=&quot;x"/);
});

test("renderMarkdown still drops non-http links and escapes html", () => {
  assert.equal(renderMarkdown("[x](javascript:alert)"), "x");
  assert.equal(renderMarkdown("<b>hola</b>"), "&lt;b&gt;hola&lt;/b&gt;");
});

test("the bundle never touches localStorage", () => {
  assert.ok(!bundle.includes("localStorage"), "conversation state must stay per-tab (sessionStorage)");
});

test("the launcher keeps its data-chat-toggle hook with the pill variant", () => {
  const i = bundle.indexOf('"aria-label": "Abrir chat"');
  assert.notEqual(i, -1, "launcher not found in bundle");
  const start = bundle.lastIndexOf("onClick", i);
  assert.match(bundle.slice(start, i + 40), /"data-chat-toggle"/);
});

test("the UI carries the suggestion chips and the header actions", () => {
  assert.ok(bundle.includes('"data-chat-suggestion"'), "suggestion chip marker missing");
  assert.ok(bundle.includes('"data-chat-suggestions"'), "suggestions container marker missing");
  // tsup escapes non-ASCII in string literals ("conversaci\xF3n"), so match the ASCII prefix.
  for (const label of ["Nueva conversaci", "Ampliar chat", "Reducir chat", "Cerrar saludo"]) {
    assert.ok(bundle.includes(label), `header/teaser action "${label}" missing`);
  }
});

test("the UI carries the inline mode, the open event, and the live log", () => {
  assert.ok(bundle.includes('"hermes-chat:open"'), "host-page open event missing");
  assert.ok(bundle.includes("__hermesChatOpen"), "pre-mount open flag missing");
  assert.ok(/role:\s*"log"/.test(bundle), "messages container is not a live log");
  assert.ok(/role:\s*(inline|[a-z]) \? "region" : "dialog"|"region"/.test(bundle), "inline region role missing");
  assert.ok(bundle.includes("chat-inline"), "inline panel class missing");
});
