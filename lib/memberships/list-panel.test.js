// Run with `npm test` (Node's built-in test runner).
//
// Membership Details → the Memberships list on the left: what a card says about its plan, the search and the Status / Plan filters
// (pure, over the memberships the page already loaded), and the panel's wiring - the existing Add Membership flow, links to each
// membership's details, the current one highlighted, no new data read.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL, activeFilterCount, filterMemberships, membershipPlanLine, planOptions, statusOptions } from "./list-panel-core.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// The label maps of lib/status.js (it imports through the app's path alias, which plain tests cannot resolve), as the panel passes them.
const PLAN = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half Yearly", annual: "Annual", custom: "Custom duration", class_count: "Class Count" };
const STATUS = {
  upcoming: { label: "Upcoming", variant: "warning" },
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "neutral" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

const M = [
  { id: "m4", membership_code: "MEM-000004", plan: "monthly", package_name: "Hatha Yoga - 5 days", status: "active" },
  { id: "m3", membership_code: "MEM-000003", plan: "quarterly", package_name: "General Yoga", status: "upcoming" },
  { id: "m2", membership_code: "MEM-000002", plan: "monthly", package_name: null, status: "expired" },
  { id: "m1", membership_code: "MEM-000001", plan: "class_count", kind: "class_count", total_classes: 10, package_name: null, status: "cancelled" },
];

test("plan line: the package it was sold under, else the plan, and a class count its total", () => {
  assert.equal(membershipPlanLine(M[0], PLAN), "Hatha Yoga - 5 days");
  assert.equal(membershipPlanLine(M[2], PLAN), "Monthly");
  assert.equal(membershipPlanLine(M[3], PLAN), "Class Count · 10 classes");
  assert.equal(membershipPlanLine({ plan: "class_count", kind: "class_count", total_classes: 1 }, PLAN), "Class Count · 1 class");
  assert.equal(membershipPlanLine({ plan: "custom" }, PLAN), "Custom duration");
});

test("search: by membership number or plan, case-insensitive; empty search shows all, in the given order", () => {
  assert.deepEqual(filterMemberships(M, {}, PLAN).map((m) => m.id), ["m4", "m3", "m2", "m1"]);
  assert.deepEqual(filterMemberships(M, { q: "mem-000003" }, PLAN).map((m) => m.id), ["m3"]);
  assert.deepEqual(filterMemberships(M, { q: "000" }, PLAN).map((m) => m.id), ["m4", "m3", "m2", "m1"]);
  assert.deepEqual(filterMemberships(M, { q: "hatha" }, PLAN).map((m) => m.id), ["m4"]);
  assert.deepEqual(filterMemberships(M, { q: "monthly" }, PLAN).map((m) => m.id), ["m4", "m2"], "the plan's name, even under another package name");
  assert.deepEqual(filterMemberships(M, { q: "  general  " }, PLAN).map((m) => m.id), ["m3"]);
  assert.deepEqual(filterMemberships(M, { q: "zzz" }, PLAN), []);
});

test("filters: Status and Plan are exact, and combine with the search", () => {
  assert.deepEqual(filterMemberships(M, { status: "expired" }, PLAN).map((m) => m.id), ["m2"]);
  assert.deepEqual(filterMemberships(M, { plan: "monthly" }, PLAN).map((m) => m.id), ["m4", "m2"]);
  assert.deepEqual(filterMemberships(M, { plan: "monthly", status: "active" }, PLAN).map((m) => m.id), ["m4"]);
  assert.deepEqual(filterMemberships(M, { plan: "monthly", q: "hatha" }, PLAN).map((m) => m.id), ["m4"]);
  assert.deepEqual(filterMemberships(M, { status: ALL, plan: ALL }, PLAN).length, 4);
});

test("filtering never changes a membership or its status", () => {
  const before = JSON.stringify(M);
  filterMemberships(M, { q: "mem", status: "active", plan: "monthly" }, PLAN);
  assert.equal(JSON.stringify(M), before);
});

test("options: All Status plus each status; All Plans plus only the plans in use, in the app's plan order", () => {
  assert.deepEqual(statusOptions(STATUS).map((o) => o.label), ["All Status", "Upcoming", "Active", "Expired", "Cancelled"]);
  assert.deepEqual(planOptions(M, PLAN).map((o) => o.label), ["All Plans", "Monthly", "Quarterly", "Class Count"]);
  assert.deepEqual(planOptions([], PLAN).map((o) => o.value), [ALL]);
});

test("the filter count: Status and Plan only (the search has its own clear button)", () => {
  assert.equal(activeFilterCount({}), 0);
  assert.equal(activeFilterCount({ status: "active" }), 1);
  assert.equal(activeFilterCount({ status: "active", plan: "monthly" }), 2);
});

// ---- the panel and the page ---------------------------------------------------------------------------------------------------

const panel = strip(read("app/memberships/[id]/membership-list-panel.js"));
const page = strip(read("app/memberships/[id]/page.js"));

test("panel: Membership History with the count, no Add button, search only (no filters)", () => {
  assert.match(panel, /^"use client";/);
  assert.match(panel, /title=\{`Membership History \(\$\{memberships\.length\}\)`\}/);
  assert.doesNotMatch(panel, /Filter|SlidersHorizontal|<Select|planOptions|statusOptions/, "no filters");
  assert.doesNotMatch(panel, /Add Membership|memberships\/new|<Plus\b/, "no Add button in the history panel; Student Details still adds a membership");
  assert.match(panel, /placeholder="Search by ID or plan\.\.\."/);
});

test("panel: each card opens that membership; the current one is highlighted with a blue border and a left bar", () => {
  assert.match(panel, /href=\{`\/memberships\/\$\{membership\.id\}`\}/);
  assert.match(panel, /aria-current=\{isCurrent \? "page" : undefined\}/);
  assert.match(panel, /isCurrent \? "border-brand bg-brand\/5"/);
  assert.match(panel, /absolute inset-y-0 left-0 w-1 bg-brand/);
  for (const needle of ["{membership.membership_code}", "formatPeriod(membership.start_date, membership.end_date)", "formatCurrency(membership.amount, membership.currency)", "{state.label}", "<ChevronRight"]) {
    assert.ok(panel.includes(needle), needle);
  }
  assert.match(panel, /filterMemberships\(memberships, \{ q \}, PLAN\)/);
  // The card: ID, dates, amount, status, chevron - no plan line and no invoice / receipt numbers.
  assert.doesNotMatch(panel, /membershipPlanLine|document\.|documents/);
  assert.match(panel, /after:absolute after:inset-0/, "the membership link covers the whole card");
  assert.doesNotMatch(panel, /fetch\(|supabase|createClient|useEffect/, "no new data read");
});

test("page: two columns from xl with the list on the left (below the details on a phone); the data is the page's existing read", () => {
  assert.match(page, /grid items-start gap-4 xl:grid-cols-\[19rem_minmax\(0,1fr\)\]/);
  assert.match(page, /order-last min-w-0 xl:sticky xl:top-24 xl:order-first/);
  assert.match(page, /<MembershipListPanel\s+memberships=\{history\.map/);
  assert.match(page, /currentId=\{membership\.id\}/);
  assert.match(page, /studentId=\{membership\.student_id\}/);
  assert.doesNotMatch(page, /documents: entry\.documents/, "the list no longer carries invoice / receipt links");
  // The details column keeps its own content, in its own order; it no longer repeats the student's other memberships.
  assert.ok(page.indexOf("<MembershipListPanel") < page.indexOf("<MembershipCarousel"));
  assert.ok(page.indexOf("<PricingPanel") < page.indexOf('title="Covered Batch Enrollments"'));
  assert.doesNotMatch(page, /title="Membership History"/);
});

// ---- the Membership carousel ---------------------------------------------------------------------------------------------------

import { dotWindow, neighboursOf } from "./list-panel-core.js";

const ids = (...list) => list.map((id) => ({ id }));

test("carousel neighbours: the list's own order - the one before on the left, the one after on the right", () => {
  const list = ids("m4", "m3", "m2", "m1");
  assert.deepEqual(neighboursOf(list, "m3"), { index: 1, previous: { id: "m4" }, next: { id: "m2" } });
});

test("carousel ends: no card on a side that has none; the first has no previous, the last no next", () => {
  const list = ids("m4", "m3", "m2", "m1");
  assert.deepEqual(neighboursOf(list, "m4"), { index: 0, previous: null, next: { id: "m3" } });
  assert.deepEqual(neighboursOf(list, "m1"), { index: 3, previous: { id: "m2" }, next: null });
});

test("carousel with one membership: centred alone, no neighbours; with two: only the adjacent one", () => {
  assert.deepEqual(neighboursOf(ids("m1"), "m1"), { index: 0, previous: null, next: null });
  assert.deepEqual(neighboursOf(ids("m2", "m1"), "m2"), { index: 0, previous: null, next: { id: "m1" } });
  assert.deepEqual(neighboursOf(ids("m2", "m1"), "m1"), { index: 1, previous: { id: "m2" }, next: null });
});

test("carousel never invents a position: an unknown selection or an empty list has no neighbours", () => {
  assert.deepEqual(neighboursOf(ids("m1", "m2"), "zzz"), { index: -1, previous: null, next: null });
  assert.deepEqual(neighboursOf([], "m1"), { index: -1, previous: null, next: null });
  assert.deepEqual(neighboursOf(null, "m1"), { index: -1, previous: null, next: null });
});

test("carousel dots: all of them up to the limit, else a window around the selected one that never passes either end", () => {
  assert.deepEqual(dotWindow(4, 2), { from: 0, to: 4 });
  assert.deepEqual(dotWindow(7, 6), { from: 0, to: 7 });
  assert.deepEqual(dotWindow(12, 0), { from: 0, to: 7 });
  assert.deepEqual(dotWindow(12, 6), { from: 3, to: 10 });
  assert.deepEqual(dotWindow(12, 11), { from: 5, to: 12 });
});

const carousel = strip(read("app/memberships/[id]/membership-carousel.js"));

test("carousel: the centre card is Student Details' summary card; the arrows, side cards and dots are links to the neighbouring membership's page", () => {
  assert.match(carousel, /import MembershipSummaryCard from "@\/app\/students\/\[id\]\/membership-summary-card";/);
  assert.match(carousel, /<MembershipSummaryCard membership=\{selected\} centreName=\{centreName\} today=\{today\} showDocuments=\{false\} \/>/);
  // Selection is the page's own: every control navigates to /memberships/{id}, so the details and the left list follow.
  assert.equal((carousel.match(/href=\{`\/memberships\/\$\{(target|membership|entry)\.id\}`\}/g) ?? []).length, 3, "arrow, side card, dot");
  assert.match(carousel, /neighboursOf\(memberships, selectedId\)/);
  assert.doesNotMatch(carousel, /"use client"|useState|useEffect|\.sort\(/, "no state of its own and no ordering of its own");
  // Add Membership: the same existing flow; the primary button style.
  assert.match(carousel, /href=\{`\/students\/\$\{studentId\}\/memberships\/new`\}/);
  assert.match(carousel, /<Button size="sm" render=/);
  // The ends: a disabled arrow, no card; one membership: no arrows or dots.
  assert.match(carousel, /aria-disabled="true"/);
  assert.match(carousel, /const many = memberships\.length > 1;/);
});

test("carousel on the page: first in the details column (above Pricing), from the page's own membership list", () => {
  assert.ok(page.indexOf("<MembershipCarousel") > page.indexOf("<MembershipListPanel"));
  assert.ok(page.indexOf("<MembershipCarousel") < page.indexOf("<PricingPanel"));
  assert.match(page, /<MembershipCarousel\s+memberships=\{history\}\s+selectedId=\{membership\.id\}/);
});

test("carousel header: Renew (secondary, for the selected membership) sits before the primary Add Membership", () => {
  const header = carousel.slice(carousel.indexOf("action={"), carousel.indexOf("className=\"mb-3\""));
  assert.match(header, /<Button variant="secondary" size="sm" render=\{<Link href=\{`\/memberships\/\$\{selectedId\}\/renew`\} \/>\} nativeButton=\{false\}>/);
  assert.ok(header.indexOf("Renew") < header.indexOf("Add Membership"));
  assert.match(header, /<Button size="sm" render=\{<Link href=\{`\/students\/\$\{studentId\}\/memberships\/new`\} \/>\}/);
});

test("sticky list: from xl the left column sticks below the student header and only the card list scrolls; a phone/tablet stays one normal column", () => {
  assert.match(page, /order-last min-w-0 xl:sticky xl:top-24 xl:order-first xl:flex xl:max-h-\[calc\(100dvh-8rem\)\] xl:flex-col/);
  assert.match(panel, /<Panel aria-label="Membership History" className="flex min-h-0 flex-1 flex-col sm:p-4">/);
  assert.match(panel, /xl:flex-1 xl:overflow-y-auto/, "only the list scrolls, and only when the column is sticky");
  assert.doesNotMatch(page, /fixed /, "no fixed positioning");
});

test("uniform cards: a minimum height and no shrinking, so a scrolling list never squeezes or overlaps them", () => {
  assert.match(panel, /relative flex min-h-16 shrink-0 items-center gap-2 overflow-hidden rounded-card/);
  assert.match(panel, /<div className="min-w-0 flex-1">/, "long content wraps inside the card instead of pushing the amount out");
});

test("slim scrollbar: the list uses the app's scrollbar-slim utility (thin, rounded, token colours)", () => {
  assert.match(panel, /xl:overflow-y-auto xl:p-1 xl:scrollbar-slim/);
  const css = read("app/globals.css");
  assert.match(css, /@utility scrollbar-slim \{[\s\S]*scrollbar-width: thin;[\s\S]*border-radius: 9999px;/);
  assert.doesNotMatch(css.slice(css.indexOf("@utility scrollbar-slim")), /#[0-9a-f]{3,6}\b/i, "token colours only");
});
