// Run with `npm test` (Node's built-in test runner).
//
// Membership Details, the compact layout: full-width stacked cards in the approved order, compact padding and table rows, the
// pricing as three blocks (Plan, Validity, Price Details), and a compact empty Corrections card. Presentation only - the data,
// actions and rules are pinned by the tests of each feature.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const page = strip(read("app/memberships/[id]/page.js"));
const at = (needle) => page.indexOf(needle);

test("the details column, in order: Membership carousel, Pricing, Corrections, Payments, Covered Enrollments, Additional Information (after the header)", () => {
  const order = [
    "<StudentHeader",
    "<MembershipCarousel",
    "<PricingPanel",
    "<CorrectionsPanel",
    "<PaymentsPanel",
    'title="Covered Batch Enrollments"',
    'title="Additional Information"',
  ].map(at);
  assert.ok(order.every((index) => index > 0), "every section is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("compact: tighter gaps and padding, a short header gap, compact table rows", () => {
  assert.match(page, /<Container className="flex flex-col gap-4">/);
  assert.doesNotMatch(page, /className="mb-0 gap-3 sm:p-4"/, "the header uses Student Details' own spacing now");
  assert.doesNotMatch(page, /mb-4 min-h-8/);
  assert.match(page, /<Table aria-label="Covered batch enrollments" className="\[&_td\]:px-4 \[&_td\]:py-2\.5 \[&_th\]:h-10 \[&_th\]:px-4">/);
  assert.doesNotMatch(page, /Membership history|title="Membership History"|MembershipHistoryRow/, "the left list is the one place to switch memberships");
  for (const path of ["payments-panel.js", "corrections-panel.js", "pricing-panel.js", "invoice-panel.js"]) {
    assert.match(read(`app/memberships/[id]/${path}`), /<Panel[^>]*className="(?:[^"]* )?sm:p-4"/, path);
  }
  assert.match(read("app/memberships/[id]/payments-panel.js"), /<Table aria-label="Payments" className="\[&_td\]:px-4/);
});

test("Membership Summary tiles are gone from the page (their data and the lib calculations are not)", () => {
  assert.doesNotMatch(page, /StatTileGroup|StatTile\b|Membership summary/);
  assert.doesNotMatch(page, /progressValue|statusCaption|usedDays|validityTone/);
});

test("Membership Pricing: header with subtitle and Edit; three columns - Plan, Validity, Price Details - with the Final Fee highlighted", () => {
  const panel = strip(read("app/memberships/[id]/pricing-panel.js"));
  assert.match(panel, /title="Membership Pricing"/);
  assert.match(panel, /description="Plan and pricing details for this membership\."/);
  // Edit: the secondary button, a link to Edit Membership, not offered for a cancelled membership (the Corrections card's rule).
  assert.match(panel, /canEdit \? \(\s*<Button variant="secondary" size="sm" render=\{<Link href=\{`\/memberships\/\$\{membershipId\}\/edit`\} \/>\} nativeButton=\{false\}>/);
  assert.match(strip(read("app/memberships/[id]/page.js")), /<PricingPanel snapshot=\{pricing\} membershipId=\{membership\.id\} canEdit=\{membership\.status !== "cancelled"\} \/>/);
  for (const title of ["Plan", "Validity", "Price Details"]) assert.ok(panel.includes(`<Column title="${title}"`), title);
  for (const label of ["Pricing Method", "Start Date", "Base Fee", "Package Discount", "Individual Discount", "Final Fee", "Reason"]) {
    assert.ok(panel.includes(`label="${label}"`) || panel.includes(`>${label}<`), label);
  }
  assert.match(panel, /md:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(0,0\.9fr\)_minmax\(0,1\.2fr\)\] md:divide-x max-md:divide-y/, "three columns with dividers; stacked on a phone");
  assert.match(panel, /<Money label="Final Fee" final>/);
  assert.match(panel, /bg-brand\/10/, "the Final Fee row is a light-blue band");
  assert.match(panel, /text-right whitespace-nowrap tabular-nums/, "amounts are right-aligned");
});

test("Corrections: an empty history is one compact line, not a large empty box; the history and Edit Membership link are kept", () => {
  const panel = read("app/memberships/[id]/corrections-panel.js");
  assert.match(panel, /<EmptyState size="compact" title="No corrections"/);
  assert.match(panel, /corrections === null \?/);
  assert.match(panel, /href=\{`\/memberships\/\$\{membershipId\}\/edit`\}/);
});

test("header: the very same student card as Student Details - one shared component, for the membership's student", () => {
  const raw = read("app/memberships/[id]/page.js");
  assert.ok(raw.includes('import StudentHeader from "@/app/students/[id]/student-header";'));
  assert.match(page, /<StudentHeader student=\{student\} showEdit=\{false\} showMenu=\{false\} \/>/, "no Edit Student button and no More menu here");
  assert.doesNotMatch(page, /StudentCardMenu/);
  // No header of its own any more: no avatar, name, badge, metadata or membership actions written on this page.
  assert.doesNotMatch(page, /<EntityDetailHeader|<Avatar|CancelMembership|\/renew|MembershipTag/);
  // Membership Details hides Edit Student and the More menu (the status button stays); Student Details keeps Edit Student.
  assert.match(page, /showEdit=\{false\}/);
  assert.match(strip(read("app/students/[id]/student-header.js")), /showEdit \? \(\s*<Button render=\{<Link href=\{`\/students\/\$\{student\.id\}\/edit`\} \/>\}/);
  // The card itself is the one Student Details uses: the student's status, ID, join date, gender, the status toggle, Edit Student, menu.
  const card = strip(read("app/students/[id]/student-header.js"));
  for (const needle of ["{studentStatus.label}", "Student ID: {student.student_code}", "Joined {formatDate(student.join_date)}", "{student.gender}", "<StudentStatusButton", "Edit Student", "<StudentCardMenu"]) {
    assert.ok(card.includes(needle), needle);
  }
  // The student's join date and gender come with the membership's student (the same read, two more columns).
  assert.ok(read("lib/memberships/data.js").includes("students(id, full_name, phone, phone_country_code, email, student_code, photo_url, status, join_date, gender, tax_invoice_default)"));
});
