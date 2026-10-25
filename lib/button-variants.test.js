// Run with `npm test` (Node's built-in test runner).
//
// The shared Button's primary and secondary styles (components/ui/button.jsx), and which controls deliberately keep a different
// variant: toolbar/filter controls, pagination, toggles, inline row actions, status and destructive controls.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const button = read("components/ui/button.jsx");

test("primary: solid brand fill with white text; secondary: light brand-blue fill with blue text", () => {
  assert.match(button, /default: "bg-primary text-primary-foreground hover:bg-primary\/80",/);
  assert.match(button, /secondary:\s+"bg-primary\/10 text-primary hover:bg-primary\/15 active:bg-primary\/20 aria-expanded:bg-primary\/15",/);
});

test("primary and secondary share one base: same radius, type, icon size, focus ring and disabled state; sizes are per size, not per variant", () => {
  const base = button.slice(button.indexOf("const buttonVariants = cva("), button.indexOf("variants: {"));
  for (const needle of ["rounded-button", "text-button font-medium", "focus-visible:ring-3", "disabled:opacity-50", "[&_svg:not([class*='size-'])]:size-4"]) {
    assert.ok(base.includes(needle), needle);
  }
  assert.doesNotMatch(button.slice(button.indexOf("variant: {"), button.indexOf("size: {")), /\b(h-\d|px-\d|rounded-)/, "no variant sets its own height, padding or radius");
});

test("Cancel, Back and the supporting links use the secondary style", () => {
  const secondary = [
    "app/students/student-form.js",
    "app/batches/batch-form.js",
    "app/schedule/schedule-form.js",
    "components/ui/confirm-dialog.jsx",
    "components/ui/review-dialog.js",
    "app/dashboard-todays-classes.js",
    "app/students/[id]/attendance-calendar.js",
  ];
  for (const path of secondary) assert.match(read(path), /variant="secondary"/, path);
});

test("the main Add actions of a section are primary", () => {
  const page = read("app/students/[id]/page.js");
  assert.match(page, /<Button size="sm" render=\{<Link href=\{`\/students\/\$\{student\.id\}\/enrollments\/new`\} \/>\} nativeButton=\{false\}>/);
  assert.match(page, /<Button size="sm" render=\{<Link href=\{`\/students\/\$\{student\.id\}\/memberships\/new`\} \/>\} nativeButton=\{false\}>/);
});

test("specialized controls keep their own variant: pagination, toggles, row actions, status and destructive actions", () => {
  for (const path of [
    "components/ui/pagination.js",
    "components/ui/kpi-visibility.js",
    "components/ui/mark-button.js",
    "components/ui/filter-bar/FilterBar.js",
    "app/schedule/weekly-schedule.js",
    "app/students/[id]/student-status-button.js",
    "app/memberships/[id]/documents/[documentId]/cancel-document.js",
    "app/schedule/[id]/deactivate-schedule.js",
    "app/settings/packages/fee-history.js",
  ]) {
    assert.match(read(path), /variant="outline"/, `${path} stays outline`);
    assert.doesNotMatch(read(path), /variant="secondary"/, `${path} is not secondary`);
  }
});

test("supporting text actions that were bordered outline buttons now use the secondary style (light brand fill, brand text)", () => {
  const secondary = {
    "app/dashboard-reminders.js": "View All",
    "app/dashboard-reminder-actions.js": "Send Reminder",
    "app/batches/[id]/weekly-schedule-overview.js": "/batches/${batchId}/schedules",
    "app/batches/[id]/batch-attendance-strip.js": "/attendance`",
    "app/memberships/[id]/corrections-panel.js": "/edit`",
    "app/memberships/[id]/issue-invoice.js": "Issue Receipt",
    "app/memberships/[id]/invoice/edit-invoice.js": "Edit",
    "app/memberships/[id]/edit-expiry-dialog.js": "openDialog",
    "app/memberships/[id]/payment-fields.js": "draft.addRow",
    "app/attendance/class-count/class-count-list.js": "Renew",
    "app/attendance/[scheduleId]/[date]/attendance-panel.js": "markAllPresent",
    "app/attendance/[scheduleId]/[date]/mark-session.js": "Mark Cancelled / Holiday",
    "app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form.js": "markAllPresent",
    "app/attendance-history/history-date-range.js": "onClick={reset}",
    "app/settings/instructors/instructor-login-access.js": "Reset Password",
    "app/settings/instructors/temporary-password-dialog.js": "onClick={copy}",
    "app/settings/packages/package-dialogs.js": "handleOpenChange(true)",
    "app/students/[id]/communications/complete-follow-up.js": "setOpen(true)",
  };
  for (const [path, near] of Object.entries(secondary)) {
    // Every `<Button ...>...</Button>` block of the file; the one holding `near` must be a secondary button.
    const blocks = read(path).match(/<Button\b[\s\S]*?<\/Button>/g) ?? [];
    const holding = blocks.filter((block) => block.includes(near));
    assert.ok(holding.length > 0, `${path}: a button holds "${near}"`);
    assert.ok(holding.some((block) => /variant="secondary"/.test(block)), `${path}: the button holding "${near}" is secondary`);
  }
  // Their old hand-made brand colours are gone - the variant supplies them.
  assert.doesNotMatch(read("app/dashboard-reminders.js"), /border-brand\/40 text-brand hover:bg-brand\/5/);
  assert.doesNotMatch(read("app/batches/[id]/weekly-schedule-overview.js"), /variant="secondary" className="text-brand"/);
  assert.match(read("app/students/[id]/communications/communication-history.js"), /<AddCommunication [^>]*variant="secondary"/);
});

test("the payment row's Document actions are compact secondary buttons, side by side; the full action is their accessible name", () => {
  const issue = read("app/memberships/[id]/issue-payment-document.js");
  assert.match(issue, /<Button type="button" variant="secondary" size="sm" onClick=\{\(\) => setOpen\(true\)\} aria-label=\{`Issue document for \$\{paymentLabel\}`\} title="Issue document">\s*<FileText className="size-4" aria-hidden="true" \/>\s*Issue\s*<\/Button>/);
  const edit = read("app/memberships/[id]/edit-payment.js");
  assert.match(edit, /<Button type="button" variant="secondary" size="sm" onClick=\{\(\) => handleOpenChange\(true\)\} aria-label=\{`Edit \$\{paymentLabel\}`\} title="Edit payment">\s*<Pencil className="size-4" aria-hidden="true" \/>\s*Edit\s*<\/Button>/);
  const panel = read("app/memberships/[id]/payments-panel.js");
  assert.match(panel, /<Button\s+variant="secondary"\s+size="sm"\s+render=\{<Link href=\{`\/memberships\/\$\{membership\.id\}\/documents\/\$\{payment\.cancelledDocument\.id\}`\} \/>\}/);
  assert.doesNotMatch(panel, /variant="outline"/);
  // One wrapping row of buttons in the Document cell.
  assert.match(panel, /<div className="flex flex-wrap items-center gap-2">\s*\{canIssueDocument \? \(/);
});

test("filter drawer: every label is the same dark form label, every field a white control on a faint tinted body", () => {
  const sheet = read("components/ui/filter-bar/FilterSheet.js");
  // FilterSection's label: sentence case, dark, semibold - no small grey capitals.
  assert.match(sheet, /<span id=\{`\$\{id\}-label`\} className="text-small font-semibold text-text-primary">/);
  assert.doesNotMatch(sheet, /tracking-wide text-text-secondary uppercase/);
  // A plain <Label> inside the drawer (the date fields) gets the same size.
  assert.ok(sheet.includes("[&_[data-slot=label]]:text-small [&_[data-slot=label]]:font-semibold"));
  // Fields: white, soft shadow, 40px, on a faint tinted body.
  assert.ok(sheet.includes("[&_[data-slot=select-trigger]]:bg-surface [&_[data-slot=select-trigger]]:shadow-xs"));
  assert.ok(sheet.includes("[&_[data-slot=input]]:h-10 [&_[data-slot=input]]:bg-surface [&_[data-slot=input]]:shadow-xs"));
  assert.ok(sheet.includes("bg-background/60 p-5"));
  assert.match(sheet, /<div className=\{FIELDS_BODY\}>\{children\}<\/div>/);
  // Clear All is the red (destructive) button beside the primary Apply Filters.
  assert.match(sheet, /<Button type="button" variant="destructive" className="flex-1" onClick=\{onClearAll\}>/);
});

test("every clear-the-filters action is a red (destructive) button: the drawer's Clear All, each list's Clear Filters, the report form's Clear", () => {
  const cases = {
    "components/ui/filter-bar/FilterSheet.js": ["{clearLabel}"],
    "app/students/page.js": ["Clear Filters"],
    "app/attendance/page.js": ["Clear Filters"],
    "app/attendance-history/page.js": ["Clear Filters"],
    "app/batches/page.js": ["Clear Filters"],
    "app/batches/[id]/attendance/page.js": ["Clear Filters"],
    "app/batches/[id]/batch-students-section.js": ["Clear Filters"],
    "app/documents/page.js": ["Clear Filters"],
    "app/memberships/page.js": ["Clear Filters"],
    "app/schedule/page.js": ["Clear Filters"],
    "app/settings/instructors/page.js": ["Clear Filters"],
    "app/reports/report-form-panel.js": ["onClear"],
  };
  for (const [path, labels] of Object.entries(cases)) {
    const blocks = read(path).match(/<Button\b[\s\S]*?<\/Button>/g) ?? [];
    for (const label of labels) {
      const holding = blocks.filter((block) => block.includes(label));
      assert.ok(holding.length > 0, `${path}: a button holds "${label}"`);
      assert.ok(holding.every((block) => /variant="destructive"/.test(block)), `${path}: "${label}" is red`);
    }
  }
});

test("filters in use are signalled in red: the Filters button's count pill and the Active filters row's Clear all", () => {
  const bar = read("components/ui/filter-bar/FilterBar.js");
  assert.ok(bar.includes('className="flex size-5 items-center justify-center rounded-full bg-danger text-small font-semibold text-surface"'));
  assert.doesNotMatch(bar.replace(/\/\*[\s\S]*?\*\//g, ""), /bg-brand/);
  const chips = read("components/ui/filter-bar/FilterChips.js");
  assert.match(chips, /<button type="button" className="[^"]*text-danger hover:underline[^"]*" onClick=\{onClearAll\}>\s*Clear all\s*<\/button>/);
  assert.doesNotMatch(chips.replace(/\/\*[\s\S]*?\*\//g, ""), /text-brand hover:underline/);
  // The chips themselves stay brand-tinted.
  assert.ok(chips.includes("bg-brand/10") && chips.includes("text-brand"));
});
