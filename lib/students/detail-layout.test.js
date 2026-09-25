// Run with `npm test` (Node's built-in test runner).
//
// Student Details: page strip, identity header, four summary cards, two columns of
// working panels (enrollments + attendance | membership + profile & contact), and
// Additional Information full width. Every student field stays on the page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../../app/students/[id]/page.js", import.meta.url), "utf8");
const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const at = (needle) => code.indexOf(needle);

test("the four summary cards sit between the identity header and the content", () => {
  assert.match(code, /<StatTileGroup ariaLabel="Student summary"/);
  for (const label of ["Enrollments", "Membership", "Status", "Joined"]) {
    assert.ok(code.includes(`label="${label}"`), label);
  }
  assert.equal((code.match(/<StatTile\b/g) ?? []).length, 4, "no extra metrics");
  assert.ok(at("<EntityDetailHeader") < at("<StatTileGroup") && at("<StatTileGroup") < at('title="Batch Enrollments"'));
});

test("the panels and their order: enrollments, attendance | membership, profile & contact, then additional information", () => {
  for (const title of ["Batch Enrollments", "Current Membership", "Profile & Contact", "Recent Attendance", "Additional Information"]) {
    assert.ok(code.includes(`title="${title}"`), title);
  }
  assert.ok(at('title="Batch Enrollments"') < at('title="Recent Attendance"'));
  assert.ok(at('title="Current Membership"') < at('title="Profile & Contact"'));
  assert.ok(at('title="Profile & Contact"') < at('title="Additional Information"'), "additional information is last, full width");
});

test("no student field is dropped: identity header + Profile & Contact + Additional Information cover them all", () => {
  const header = code.slice(at("<EntityDetailHeader"), at("<StatTileGroup"));
  for (const field of ["student.full_name", "student.student_code", "student.gender", "student.join_date"]) {
    assert.ok(header.includes(field), `${field} is in the identity header`);
  }
  const start = at('title="Profile & Contact"');
  const contact = code.slice(start, code.indexOf("</Panel>", start));
  for (const label of ["Phone", "Email", "Date of Birth", "Gender"]) {
    assert.ok(contact.includes(`label="${label}"`), label);
  }
  const extraStart = at('title="Additional Information"');
  const extra = code.slice(extraStart, code.indexOf("</Panel>", extraStart));
  assert.match(extra, /student\.notes \? \(/);
  assert.match(extra, /title="No additional information yet"/);
  assert.doesNotMatch(extra, /description=/, "a compact empty state, not a large empty box");
  assert.doesNotMatch(code, /No notes\./);
});

test("two columns from xl, and a stacked order that puts membership before attendance on a phone", () => {
  assert.match(code, /xl:grid-cols-\[minmax\(0,1fr\)_22rem\]/);
  assert.equal((code.match(/className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6"/g) ?? []).length, 2);
  assert.ok([1, 2, 3, 4].every((n) => code.includes(`className="order-${n} `)), "each panel has its mobile order");
});

test("batch enrollments use the shared batch identity mark, not a page-local tile", () => {
  assert.match(code, /import BatchAvatar from "@\/components\/ui\/batch-avatar"/);
  assert.match(code, /<BatchAvatar batch=\{\{ \.\.\.enrollment\.batches, name: batchName \}\}/);
  assert.doesNotMatch(code, /batchAbbreviation/);
  // The query already carries the saved colour and image.
  const data = readFileSync(new URL("../enrollments/data.js", import.meta.url), "utf8");
  assert.match(data, /batches\(id, name, code, batch_color, batch_image_url\)/);
});

test("the membership figures are label / value rows and Add Membership is a compact icon button", () => {
  assert.match(code, /<DetailRow label="Validity">/);
  assert.match(code, /<DetailRow label="Amount">/);
  assert.match(code, /<DetailRow label="Payment">/);
  assert.match(code, /aria-label="Add Membership"/);
});
