import assert from "node:assert/strict";
import test from "node:test";
import { renderRouteHandoffShell } from "./routeHandoffShell.js";

test("the wait says what it is waiting for, where a screen reader will read it", () => {
  const markup = renderRouteHandoffShell({ label: "Finding a stream…" });

  assert.match(markup, /Finding a stream…/);
  // The caption replaces a whole page, so it has to announce itself rather than
  // leave someone on a screen that reads as empty.
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-hidden="true"/);
});

test("a quote in the image url cannot end the style declaration", () => {
  // The url sits inside single quotes inside a style attribute. An unescaped
  // quote would close it early and leave the rest of the url as markup.
  const markup = renderRouteHandoffShell({ backdrop: "https://x.test/a'b.jpg" });

  assert.match(markup, /background-image:url\('https:\/\/x\.test\/a%27b\.jpg'\)/);
  assert.doesNotMatch(markup, /a'b\.jpg/);
});

test("no image means no style attribute rather than an empty one", () => {
  // An empty url() asks the browser for the current document and paints
  // nothing, so the attribute is left off entirely.
  for (const backdrop of ["", "   ", null, undefined]) {
    const markup = renderRouteHandoffShell({ backdrop, label: "Opening player…" });
    assert.doesNotMatch(markup, /background-image/);
    assert.match(markup, /class="route-handoff-backdrop"><\/div>/);
  }
  assert.doesNotMatch(renderRouteHandoffShell(), /background-image/);
});

test("a label is text, not markup", () => {
  const markup = renderRouteHandoffShell({ label: "Rock & Roll <script>x</script>" });

  assert.match(markup, /Rock &amp; Roll &lt;script>x&lt;\/script>/);
  assert.doesNotMatch(markup, /<script>/);
});

test("it carries its own classes, not the stream route's", () => {
  // 126 stream-route-* rules are scoped to #stream in desktop.css. Borrowing
  // them inside #detail would miss every one and fall back to the
  // television-scale rules in components.css.
  const markup = renderRouteHandoffShell({ backdrop: "a.jpg", label: "x" });

  assert.doesNotMatch(markup, /stream-route/);
  for (const className of [
    "route-handoff",
    "route-handoff-backdrop",
    "route-handoff-dim",
    "route-handoff-status",
    "route-handoff-spinner"
  ]) {
    assert.match(markup, new RegExp(`class="${className}"`));
  }
});

test("the same inputs give the same markup, so a repaint is a no-op", () => {
  // Both screens compare the markup they last wrote before touching the DOM.
  // An unstable string would reset the container mid-wait and restart the
  // backdrop and the spinner.
  const once = renderRouteHandoffShell({ backdrop: "a.jpg", label: "Finding a stream…" });
  const twice = renderRouteHandoffShell({ backdrop: "a.jpg", label: "Finding a stream…" });

  assert.equal(once, twice);
});
