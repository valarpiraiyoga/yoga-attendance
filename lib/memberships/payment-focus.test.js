// Run with `npm test` (Node's built-in test runner).
//
// Record Payment (Memberships list menu) opens Membership Details scrolled to its Payments section: the link, the one-shot marker, and
// the scroll position below the sticky header. The component is checked as source (the project has no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAYMENTS_FOCUS, PAYMENTS_SECTION_ID, recordPaymentHref, scrollTopBelowHeader } from "./payment-focus.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("the Record Payment link is the existing Membership Details route plus the focus marker", () => {
  assert.equal(recordPaymentHref("abc"), "/memberships/abc?focus=payments");
  assert.equal(PAYMENTS_FOCUS, "payments");
  assert.match(code("app/memberships/membership-card-menu.js"), /<Link href=\{recordPaymentHref\(membershipId\)\} \/>\} nativeButton=\{false\}>\s*\{icon\(Wallet\)\}\s*Record Payment/);
});

test("the scroll puts the section below the sticky header, with a gap, and never above the top", () => {
  // Section 800px below the container top, header's visible bottom at 120: scroll so it sits 16px under the header.
  assert.equal(scrollTopBelowHeader({ targetTop: 900, containerTop: 100, scrollTop: 0, headerBottom: 220 }), 900 - 220 - 16);
  // Already scrolled: the offset is added to the current position.
  assert.equal(scrollTopBelowHeader({ targetTop: 300, containerTop: 100, scrollTop: 500, headerBottom: 220 }), 500 + (300 - 220) - 16);
  // No sticky header (mobile): clear of the container's own top edge only.
  assert.equal(scrollTopBelowHeader({ targetTop: 700, containerTop: 60, scrollTop: 0, headerBottom: 0 }), 700 - 60 - 16);
  assert.equal(scrollTopBelowHeader({ targetTop: 10, containerTop: 0, scrollTop: 0, headerBottom: 0 }), 0);
});

test("Membership Details scrolls only when opened with the marker; a plain visit renders no scroller", () => {
  const page = code("app/memberships/[id]/page.js");
  assert.ok(page.includes("{rawParams?.focus === PAYMENTS_FOCUS ? <ScrollToSection targetId={PAYMENTS_SECTION_ID} /> : null}"));
  assert.ok(code("app/memberships/[id]/payments-panel.js").includes("<Panel id={PAYMENTS_SECTION_ID} tabIndex={-1}"));
  assert.equal(PAYMENTS_SECTION_ID, "membership-payments");
});

test("the scroller waits for the commit (effect, no timers), respects reduced motion, focuses the section and clears the marker", () => {
  const scroller = code("app/memberships/[id]/scroll-to-section.js");
  assert.match(scroller, /^"use client";/);
  assert.ok(scroller.includes("useEffect("));
  assert.doesNotMatch(scroller, /setTimeout|setInterval/);
  assert.ok(scroller.includes("prefers-reduced-motion: reduce") && scroller.includes('behavior: reduceMotion ? "auto" : "smooth"'));
  assert.ok(scroller.includes("[data-sticky-header]") && scroller.includes('=== "sticky"'));
  assert.ok(scroller.includes("target.focus({ preventScroll: true })"));
  assert.ok(scroller.includes('url.searchParams.delete("focus")') && scroller.includes("window.history.replaceState"));
  assert.match(code("components/layout/EntityDetailHeader.js"), /data-sticky-header/);
});
