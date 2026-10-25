// Run with `npm test` (Node's built-in test runner).
//
// Every form confirms a successful save with the same success toast:
// - a save that redirects lands on a page with `?success=<key>`, and that page shows it through `FlashToast`;
// - a save that happens in place (a dialog or inline form that closes, or a `router.push`) calls `showSuccessToast`, shown by the one
//   `SuccessToastHost` in the app shell - so the toast outlives the dialog and the navigation.
// Checked as source (the project has no component test runner).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("the one host: mounted in the app shell, rendering the shared Toast from a small store", () => {
  const store = code("components/ui/success-toast.js");
  assert.match(store, /^"use client";/);
  assert.match(store, /export function showSuccessToast\(text\)/);
  assert.match(store, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
  assert.match(store, /<Toast key=\{toast\?\.id \?\? "none"\} message=\{toast\?\.text\} tone="success" onDismiss=\{dismiss\} \/>/);
  const shell = code("components/layout/AppShell.js");
  assert.ok(shell.includes('import { SuccessToastHost } from "@/components/ui/success-toast";'));
  assert.ok(shell.includes("<SuccessToastHost />"));
});

test("every in-place save calls showSuccessToast after it succeeds", () => {
  const cases = {
    "app/memberships/[id]/record-payment.js": "Payment recorded successfully.",
    "app/memberships/[id]/edit-payment.js": "Payment updated successfully.",
    "app/memberships/[id]/issue-invoice.js": "Receipt issued successfully.",
    "app/memberships/[id]/issue-payment-document.js": "Payment receipt issued successfully.",
    "app/memberships/[id]/edit-expiry-dialog.js": "Expiry updated successfully.",
    "app/memberships/[id]/reverse-class-dialog.js": "Class reversed successfully.",
    "app/memberships/[id]/invoice/edit-invoice.js": "Invoice details updated successfully.",
    "app/memberships/[id]/documents/[documentId]/cancel-document.js": "Document cancelled successfully.",
    "app/memberships/[id]/documents/[documentId]/correct/correction-form.js": "Document corrected and reissued successfully.",
    "app/students/[id]/communications/add-communication.js": "Communication recorded successfully.",
    "app/students/[id]/communications/complete-follow-up.js": "Follow-up completed successfully.",
    "app/schedule/delete-schedule-dialog.js": "Schedule deleted successfully.",
    "app/settings/invoice-receipt/bank-accounts.js": "Bank account added successfully.",
    "app/settings/packages/package-dialogs.js": "Package created successfully.",
    "app/settings/packages/fee-history.js": "Fee cancelled successfully.",
  };
  for (const [path, message] of Object.entries(cases)) {
    const source = code(path);
    assert.ok(source.includes('import { showSuccessToast } from "@/components/ui/success-toast";'), `${path}: imports it`);
    assert.ok(source.includes(message), `${path}: says "${message}"`);
  }
  const packages = code("app/settings/packages/package-dialogs.js");
  for (const message of ["Package details updated successfully.", "Package terms updated successfully.", "Package deactivated successfully."]) {
    assert.ok(packages.includes(message), message);
  }
  const fees = code("app/settings/packages/fee-history.js");
  for (const message of ["Fee scheduled successfully.", "Fee updated successfully.", "Fee corrected successfully."]) assert.ok(fees.includes(message), message);
});

test("every redirect after a save carries a success key the landing page turns into a toast", () => {
  // Batch Enrollment: added / updated -> Student Details.
  const enrollments = code("lib/enrollments/actions.js");
  assert.match(enrollments, /\?success=enrollment_added/);
  assert.match(enrollments, /\?success=enrollment_updated/);
  const student = code("app/students/[id]/page.js");
  assert.ok(student.includes('enrollment_added: "Batch enrollment added successfully."'));
  assert.ok(student.includes('enrollment_updated: "Batch enrollment updated successfully."'));
  assert.ok(student.includes("<FlashToast message={message} />"));

  // The guided Add Student flow: each saved step is confirmed on the next one.
  assert.match(code("lib/students/actions.js"), /memberships\/new\?guided=1&success=student_created/);
  assert.match(code("lib/memberships/actions.js"), /enrollments\/new\?guided=1&success=membership_added/);
  assert.ok(code("app/students/[id]/memberships/new/page.js").includes('<FlashToast message={rawParams?.success === "student_created" ? "Student created successfully." : null} />'));
  assert.ok(code("app/students/[id]/enrollments/new/page.js").includes('<FlashToast message={rawParams?.success === "membership_added" ? "Membership added successfully." : null} />'));

  // Settings: a toast, not an inline banner.
  for (const path of ["app/settings/center-profile/page.js", "app/settings/invoice-receipt/page.js"]) {
    const page = code(path);
    assert.ok(page.includes("<FlashToast message={message} />"), path);
    assert.doesNotMatch(page, /bg-success\/5/, `${path}: no inline success banner`);
  }

  // Add Schedule creating several schedules -> the Schedule list: a toast that clears `created`.
  const schedule = code("app/schedule/page.js");
  assert.match(schedule, /<FlashToast\s+message=\{createdCount > 0 \?[\s\S]*?param="created"\s*\/>/);
  assert.doesNotMatch(schedule, /bg-success\/5/);
});
