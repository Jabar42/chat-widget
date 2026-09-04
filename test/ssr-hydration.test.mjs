import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatWidget from "../dist/ChatWidget.mjs";

const PLACEHOLDER = '<div id="hermes-chat-ssr-placeholder"></div>';

/**
 * Regression test for the SSR/client hydration mismatch.
 *
 * `ChatWidget` used to branch on `typeof window`, so its first render differed
 * between the server (placeholder) and the browser (full widget). React cannot
 * hydrate that: it throws #418 and, instead of patching the difference, it
 * discards the server HTML and re-renders the whole page on the client.
 *
 * The invariant locked down here: **the first render does not depend on the
 * environment**. Whatever the server produced, the client's first render must
 * produce the same thing; the real widget arrives from an effect afterwards.
 *
 * Runs against the built bundle, which is what consumers actually import.
 */

/** Minimal browser globals — enough for the pre-fix code path to run. */
function withBrowserGlobals(fn) {
  const store = new Map();
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  };

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  globalThis.document = { createElement: () => ({ style: {} }) };

  try {
    return fn();
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.localStorage = previous.localStorage;
  }
}

/**
 * Deliberately synchronous. An async render would resolve *after*
 * `withBrowserGlobals` restored the globals in its `finally`, so the render
 * would run with `window` already undefined and the test would pass even with
 * the bug present — proving nothing.
 */
function renderFirstPass() {
  return renderToStaticMarkup(
    createElement(ChatWidget, { hermesUrl: "ws://localhost:8765" }),
  );
}

test("first render is the placeholder on the server", () => {
  assert.equal(renderFirstPass(), PLACEHOLDER);
});

test("first render is still the placeholder when window and document exist", () => {
  const html = withBrowserGlobals(renderFirstPass);
  assert.equal(
    html,
    PLACEHOLDER,
    "the first client render must match the server's, or React fails hydration (#418)",
  );
});
