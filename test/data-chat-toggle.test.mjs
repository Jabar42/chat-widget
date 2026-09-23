import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contract test for the launcher hook.
 *
 * Host pages open the chat from their own buttons ("Me interesa", a nav CTA)
 * by clicking the launcher. Until now the only way to find it was its markup:
 * a class that 0.2.5 no longer renders, or an aria-label that flips between
 * "Abrir chat" and "Cerrar chat". Both broke silently on consumers.
 *
 * `data-chat-toggle` is the stable hook: an attribute whose only job is to be
 * found. This test pins it on the launcher — the element carrying
 * aria-label "Abrir chat" — in the built bundle, which is what consumers load.
 * (The launcher only renders after mount, so a static SSR render cannot see it.)
 */
const bundle = readFileSync(new URL("../dist/ChatWidget.mjs", import.meta.url), "utf8");

test("the launcher carries the data-chat-toggle hook", () => {
  const i = bundle.indexOf('"aria-label": "Abrir chat"');
  assert.notEqual(i, -1, "launcher not found in bundle");
  // the props object of the launcher button: from its onClick to its aria-label
  const start = bundle.lastIndexOf("onClick", i);
  const props = bundle.slice(start, i + 40);
  assert.match(props, /"data-chat-toggle"/, "launcher lost its data-chat-toggle hook");
});
