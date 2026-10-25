// Run with `npm test` (Node's built-in test runner).
//
// The student / batch identity header at the top of the forms is the card's full-bleed top band: no gap above it or at its sides
// (it pulls out by the card's padding, `--card-pad`), the card's top corners, a bottom rule, and the teal-to-white wash. It is the
// first thing in every form that shows it, so a validation alert appears below it rather than pushing it inward. Checked as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const header = read("components/ui/student-identity-header.js");

test("the band: full-bleed when first (negative margin = the card padding), top corners, bottom rule, the wash", () => {
  for (const part of [
    "first:mx-[calc(var(--card-pad,1.5rem)*-1)]",
    "first:mt-[calc(var(--card-pad,1.5rem)*-1)]",
    "first:rounded-b-none",
    "first:rounded-t-[calc(var(--radius-card)-1px)]",
    "first:border-x-0 first:border-t-0",
    "first:px-(--card-pad,1.5rem)",
    "bg-linear-to-r from-brand/10 via-brand/5 to-surface",
  ]) {
    assert.ok(header.includes(part), part);
  }
  assert.ok(header.includes("<div className={cn(IDENTITY_BAND, className)}>"));
  assert.ok(read("components/ui/batch-identity-header.js").includes("<div className={cn(IDENTITY_BAND, className)}>"), "the batch header shares it");
});

test("cards whose padding is not the default 1.5rem tell the band", () => {
  assert.ok(read("app/students/[id]/enrollments/new/page.js").includes('isGuided ? "sm:p-8 sm:[--card-pad:2rem]" : ""'));
  assert.ok(read("app/students/[id]/memberships/new/page.js").includes('isGuided ? "sm:p-8 sm:[--card-pad:2rem]" : ""'));
  assert.ok(read("app/memberships/[id]/documents/[documentId]/correct/page.js").includes("p-4 shadow-xs [--card-pad:1rem] sm:p-6 sm:[--card-pad:1.5rem]"));
});

test("the identity header is the first thing in each form - before any validation alert", () => {
  const cases = [
    ["app/students/student-form.js", "<StudentIdentityHeader", 'role="alert"'],
    ["app/batches/batch-form.js", "<BatchIdentityHeader", 'role="alert"'],
    ["app/schedule/schedule-form.js", "<BatchIdentityHeader", 'role="alert"'],
    ["app/memberships/membership-form.js", "<StudentIdentityHeader", 'role="alert"'],
    ["app/memberships/package-membership-form.js", "<StudentIdentityHeader", 'role="alert"'],
    ["app/memberships/[id]/edit/package-membership-editor.js", "<StudentIdentityHeader student={student} membership={{ code: membership.membership_code, plan: membership.package_name }} />", "{submitError ? ("],
  ];
  for (const [path, first, then] of cases) {
    const source = read(path);
    const form = source.lastIndexOf("<form", source.indexOf(first));
    assert.ok(form >= 0, `${path}: inside its form`);
    assert.ok(source.indexOf(first, form) < source.indexOf(then, form), `${path}: the header comes before the alert`);
  }
});
