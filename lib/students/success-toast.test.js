// Run with `npm test` (Node's built-in test runner).
//
// Student Details confirms a save with the shared Toast overlay, not an inline
// banner that pushes the page down.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Student Details shows its success message through the toast, not an inline banner", () => {
  const page = source("../../app/students/[id]/page.js");
  assert.match(page, /import FlashToast from "@\/components\/ui\/flash-toast"/);
  assert.match(page, /<FlashToast message=\{message\} \/>/);
  assert.doesNotMatch(page, /border-success\/30 bg-success\/5/, "the inline banner is gone");
  // The message text and its keys are unchanged.
  assert.match(page, /updated: "Student updated successfully\."/);
});

test("the bridge reuses the shared Toast (no second toast implementation)", () => {
  const flash = source("../../components/ui/flash-toast.js");
  assert.match(flash, /import Toast from "@\/components\/ui\/toast"/);
  assert.match(flash, /<Toast message=\{text\} tone="success" onDismiss=\{dismiss\} \/>/);
  const code = flash.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /createPortal|role=/, "positioning, timing and ARIA stay in Toast");
});

test("the success parameter is cleared once shown so a reload does not repeat the toast", () => {
  const flash = source("../../components/ui/flash-toast.js");
  assert.match(flash, /searchParams\.delete\("success"\)/);
  assert.match(flash, /window\.history\.replaceState\(/);
});

test("the shared Toast is a top-right tinted overlay (portal, status role, auto-dismiss)", () => {
  const toast = source("../../components/ui/toast.js");
  assert.match(toast, /createPortal\(/);
  assert.match(toast, /fixed inset-x-4 top-16/);
  assert.match(toast, /sm:right-6 lg:top-6/, "top-right");
  assert.ok(toast.includes('tint: "bg-success/10"'));
  assert.ok(toast.includes('tint: "bg-danger/10"'));
  assert.match(toast, /role: "status"/);
  assert.match(toast, /tone === "error" \? 6000 : 4000/);
});

test("Membership Details confirms a save with the same toast, with its messages unchanged", () => {
  const page = source("../../app/memberships/[id]/page.js");
  assert.match(page, /import FlashToast from "@\/components\/ui\/flash-toast"/);
  assert.match(page, /<FlashToast message=\{message\} \/>/);
  assert.doesNotMatch(page, /border-success\/30 bg-success\/5/, "the inline banner is gone");
  assert.match(page, /updated: "Membership updated successfully\."/);
  assert.match(page, /created: "Membership created successfully\."/);
  assert.match(page, /renewed: "Membership renewed successfully\."/);
});

test("the Membership form opens with a simple student header (avatar, name, ID)", () => {
  const form = source("../../app/memberships/membership-form.js");
  assert.match(form, /<StudentIdentityHeader/);
  assert.doesNotMatch(form, /rounded-lg border border-border bg-background\/60 p-3/, "the old plain strip is gone");

  const header = source("../../components/ui/student-identity-header.js");
  assert.match(header, /<Avatar name=\{student\.full_name\} src=\{student\.photo_url\} size="lg" \/>/);
  assert.match(header, /Student ID: /);
  assert.doesNotMatch(header, /student.phone|student.email|Badge/, "simple: name and ID only");
  assert.match(header, /<MembershipTag code=\{membership\.code\} plan=\{membership\.plan\} \/>/);
  assert.match(source("../../components/ui/membership-tag.js"), /bg-brand\/10/, "a tinted badge");
  assert.match(source("../../app/memberships/[id]/page.js"), /<MembershipTag code=\{membership\.membership_code\} plan=\{planLabel\} \/>/);
});

test("Add and Edit Batch Enrollment open with the same student identity header", () => {
  const edit = source("../../app/students/[id]/enrollments/[enrollmentId]/edit/page.js");
  assert.match(edit, /<StudentIdentityHeader student=\{student\} className="mb-6" \/>/);
  const add = source("../../app/students/[id]/enrollments/new/page.js");
  assert.match(add, /isGuided \? null : <StudentIdentityHeader student=\{student\} className="mb-6" \/>/);
  // One shared component for every form that says who the record is for.
  assert.match(source("../../app/memberships/membership-form.js"), /@\/components\/ui\/student-identity-header/);
});

test("Edit Batch opens with a simple header: the batch's own mark, name and code", () => {
  const form = source("../../app/batches/batch-form.js");
  assert.match(form, /\{batch \? <BatchIdentityHeader batch=\{batch\} \/> : null\}/, "edit only - Add Batch has no saved batch yet");
  const header = source("../../components/ui/batch-identity-header.js");
  assert.match(header, /<BatchAvatar batch=\{batch\} size="lg" \/>/);
  assert.match(header, /Code: /);
  const code = header.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /Created|category|description|ENTITY_STATUS/, "simple: name and code only");
});

test("Edit Student opens with the same simple student header (edit only)", () => {
  const form = source("../../app/students/student-form.js");
  assert.match(form, /\{student \? <StudentIdentityHeader student=\{student\} \/> : null\}/);
  assert.match(form, /@\/components\/ui\/student-identity-header/);
});

test("Student, Instructor and Center Logo all use the one photo card, in the same layout and style", () => {
  const card = source("../../components/ui/profile-photo-card.js");
  assert.match(card, /w-56 max-w-full rounded-card border border-border/, "the image, buttons and hint live inside one card");
  assert.match(card, /aspect-\[9\/10\]/, "a portrait box, not a circle");
  assert.match(card, /<ProfilePhotoField[\s\S]*?stacked/);
  assert.match(card, /fit === "contain"|contain = fit/, "a logo is contained, a person is cropped to fill");

  const student = source("../../app/students/student-form.js");
  const instructor = source("../../app/settings/instructors/instructor-form.js");
  const center = source("../../app/settings/center-profile/center-profile-form.js");
  for (const [name, form] of [["student", student], ["instructor", instructor]]) {
    assert.match(form, /<ProfilePhotoCard/, name);
    assert.match(form, /lg:grid-cols-\[14rem_minmax\(0,1fr\)\]/, `${name}: the photo card is its own left column`);
    assert.doesNotMatch(form, /<ProfilePhotoField/, `${name}: no second photo layout`);
  }
  assert.match(center, /<ProfilePhotoCard[\s\S]*?label="Center Logo"[\s\S]*?fit="contain"/);
  assert.doesNotMatch(center, /<ProfilePhotoField/);

  const field = source("../../components/ui/profile-photo-field.js");
  assert.match(field, /stacked = false/);
  assert.match(field, /h-10 w-full border-brand\/30 bg-brand\/10 text-brand/, "full-width, brand-tinted Change button");
  assert.match(field, /h-10 w-full border-border bg-surface text-danger/, "full-width Remove button in the danger colour");
  assert.match(field, /PROFILE_PHOTO_HINT_POINTS\.map/, "the hint is one bullet per point, under a rule");
  assert.match(field, /<ul className="text-small list-disc/);
});

test("Edit Student uses the shared compact PageHeader with a Back link, not its own title block", () => {
  const page = source("../../app/students/[id]/edit/page.js");
  assert.match(page, /import PageHeader from "@\/components\/layout\/PageHeader"/);
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: `\/students\/\$\{id\}`/);
  assert.match(page, /title="Edit Student"/);
  assert.doesNotMatch(page, /<h1/, "the title comes from PageHeader, not a second heading");

  const header = source("../../components/layout/PageHeader.js");
  assert.match(header, /back \? \(/);
  assert.match(header, /href=\{back\.href\}/);
  assert.match(header, /aria-label=\{back\.label\}/, "the arrow is icon-only; the label is its accessible name");
  assert.doesNotMatch(header, /<span[^>]*>\{back\.label\}<\/span>/, "no visible 'Back to …' text");
});

test("Student Details uses the same compact PageHeader with a boxed back button", () => {
  const page = source("../../app/students/[id]/page.js");
  assert.match(page, /import PageHeader from "@\/components\/layout\/PageHeader"/);
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/students", label: "Back to Students" \}\}/);
  assert.match(page, /title="Student Details"/);
  assert.doesNotMatch(page, /ArrowLeft/, "the old plain text link is gone");
});

test("every KPI tile uses the full-height icon box from xl; there is no per-page opt-in", () => {
  const tile = source("../../components/ui/stat-tile.js");
  assert.match(tile, /"xl:size-auto xl:aspect-square xl:self-stretch xl:rounded-xl"/);
  const code = tile.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /iconFill/, "one style for every tile, not an option");
  assert.doesNotMatch(source("../../app/page.js"), /iconFill/);
});

test("Add Student uses the same compact PageHeader with a back button, then the stepper and form", () => {
  const page = source("../../app/students/new/page.js");
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/students", label: "Back to Students" \}\}/);
  assert.match(page, /title="Add Student"/);
  assert.match(page, /Create a student profile to begin their enrollment setup\./);
  assert.doesNotMatch(page, /<h1|ArrowLeft/, "no page-local title block or back link");
  assert.match(page, /<GuidedSteps current=\{1\} className="mt-0" \/>/);
});

test("Student Details header takes the Dashboard greeting card's teal-to-white wash", () => {
  const header = source("../../components/layout/EntityDetailHeader.js");
  assert.match(header, /wash && "bg-linear-to-r from-brand\/10 via-surface to-surface"/);
  assert.match(source("../../app/page.js"), /bg-linear-to-r from-brand\/10 via-surface to-surface/, "same classes as the Dashboard");
  assert.match(source("../../app/students/[id]/page.js"), /decorative=\{false\}\s+wash/);
  assert.match(source("../../app/memberships/[id]/page.js"), /decorative=\{false\}\s+wash/, "Membership Details too");
  assert.match(source("../../app/batches/[id]/batch-header.js"), /decorative=\{false\}\s+wash/, "Batch Details too");
  assert.match(source("../../app/batches/[id]/batch-header.js"), /<PageHeader\s+compact\s+back=\{\{ href: "\/batches", label: "Back to Batches" \}\}/);
  assert.match(source("../../app/batches/[id]/batch-header.js"), /title="Batch Details"/);
  assert.match(source("../../app/schedule/[id]/schedule-header.js"), /decorative=\{false\}\s+wash/, "Schedule Details too");
});

test("Schedule Details uses the same compact PageHeader; its layout adds no container around the strip", () => {
  const page = source("../../app/schedule/[id]/page.js");
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/schedule", label: "Back to Schedule" \}\}/);
  assert.match(page, /title="Schedule Details"/);
  assert.match(page, /<Container className="flex flex-col gap-6">/, "the body sets its own width");
  assert.doesNotMatch(source("../../app/schedule/[id]/schedule-header.js"), /ArrowLeft|Back to Schedule/);
  const layout = source("../../app/schedule/[id]/layout.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(layout, /Container/, "the strip must be a direct child of the shell's main");
});

test("Membership Details uses the same compact PageHeader with a back button", () => {
  const page = source("../../app/memberships/[id]/page.js");
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/memberships", label: "Back to Memberships" \}\}/);
  assert.match(page, /title="Membership Details"/);
  assert.doesNotMatch(page, /ArrowLeft/, "the old plain text link is gone");
});

test("Edit Schedule opens with the batch identity header inside the card, not a read-only Batch field", () => {
  const form = source("../../app/schedule/schedule-form.js");
  assert.match(form, /import BatchIdentityHeader from "@\/components\/ui\/batch-identity-header"/);
  assert.match(form, /<BatchIdentityHeader batch=\{batch\} \/>/);
  assert.match(form, /<input type="hidden" name="batch_id" value=\{batch\.id\} \/>/, "the batch is still submitted");
  assert.doesNotMatch(form, /rounded-lg border border-border bg-background\/60 p-3">\s*<span className="text-body font-medium text-text-primary">\{batch\.name\}/, "the old plain field is gone");
  // The header sits inside the page's form card, under the strip.
  assert.match(source("../../app/schedule/[id]/edit/page.js"), /batch=\{schedule\.batches\}/);
});
