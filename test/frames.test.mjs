import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contract tests for the rich-frame support (card / form / action / event) and
 * the client-side form_submit. They run against the built bundle — what
 * consumers load — because the widget only renders after mount, so the UI is
 * pinned through the stable markers it carries, not through a DOM render.
 */
const bundle = readFileSync(new URL("../dist/ChatWidget.mjs", import.meta.url), "utf8");

test("the hook understands the rich frame types", () => {
  for (const t of ['"card"', '"form"', '"action"', '"event"']) {
    assert.ok(bundle.includes(t), `frame type ${t} missing from the bundle`);
  }
});

test("the hook re-emits events as chat:<name> CustomEvents", () => {
  assert.ok(bundle.includes("CustomEvent"), "events must be re-emitted as CustomEvents");
  assert.ok(/chat:\$\{/.test(bundle) || bundle.includes('"chat:"'), "event name must be prefixed with chat:");
});

test("the hook sends form_submit frames", () => {
  assert.ok(bundle.includes('"form_submit"'), "form_submit frame missing");
  assert.ok(bundle.includes("sendFormSubmit"), "sendFormSubmit not exposed by the hook");
});

test("the widget renders cards, forms and action buttons", () => {
  for (const marker of ["data-chat-card", "data-chat-form", "data-chat-action", "data-chat-form-submit"]) {
    assert.ok(bundle.includes(marker), `render marker ${marker} missing`);
  }
});

test("the bundle never touches localStorage", () => {
  assert.ok(!bundle.includes("localStorage"), "conversation state must stay per-tab (sessionStorage)");
});
