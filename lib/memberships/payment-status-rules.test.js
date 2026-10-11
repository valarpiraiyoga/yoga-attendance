// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 7 - the payment status is no longer chosen on the membership form. A new membership is
// Pending with its whole amount outstanding, payments determine Pending / Partially Paid / Paid, and editing a
// membership never sends or resets the status - so a membership marked Paid before payment records existed keeps it.
// Server actions cannot be imported under node:test, so what they send is proven from the validation they use and
// pinned from source, the project's way for code that cannot be rendered.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { validateMembershipInput } from "./validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const INPUT = { plan: "monthly", start_date: "2026-10-01", end_date: "2026-10-31", amount: "1000", notes: "" };

// ---- what a save sends --------------------------------------------------------------------------------------------

test("validated membership data carries no payment status, even when one is supplied", () => {
  for (const extra of [{}, { payment_status: "paid" }, { payment_status: "partially_paid" }, { payment_status: "pending" }, { payment_status: "nonsense" }]) {
    const result = validateMembershipInput({ ...INPUT, ...extra });
    assert.equal(result.success, true, JSON.stringify(extra));
    assert.deepEqual(Object.keys(result.data).sort(), ["amount", "end_date", "notes", "plan", "start_date"]);
  }
  // A supplied status is not an error either: there is simply nothing to read.
  assert.equal(validateMembershipInput({ ...INPUT, payment_status: "refunded" }).success, true);
});

test("creating a membership sends no payment status, so it is Pending (the column default) with its full amount outstanding", () => {
  const actions = code("./actions.js");
  const create = actions.slice(actions.indexOf("export async function createMembership("), actions.indexOf("export async function updateMembership("));
  assert.match(create, /\.insert\(\{ \.\.\.result\.data, student_id: studentId, currency: await getCenterCurrency\(\) \}\)/);
  assert.doesNotMatch(create, /payment_status/);
  // The database default is what makes it Pending, and nothing has been paid: no payment rows are written.
  assert.match(source("../../supabase/migrations/0008_memberships.sql"), /payment_status\s+text not null default 'pending'/);
  assert.doesNotMatch(create, /membership_payments/);
});

test("editing a membership never sends or resets its payment status - a historical Paid one keeps it", () => {
  const actions = code("./actions.js");
  const update = actions.slice(actions.indexOf("export async function updateMembership("), actions.indexOf("export async function cancelMembership("));
  // The update is exactly the validated data (no status, as proven above) - and nothing else is added to it.
  assert.match(update, /await supabase\.from\("memberships"\)\.update\(result\.data\)\.eq\("id", id\);/);
  assert.doesNotMatch(update, /payment_status|membership_payments|result\.data\.[a-z_]+ =/, "no status is read, set or restored");
  assert.match(update, /\.select\("student_id"\)/);

  // So for a membership marked Paid before payment records existed (no payment rows), the payload of an edit is the same
  // five details as for any other: the status column is not in it, and the database leaves it as it is.
  const historicalPaid = { id: "m1", payment_status: "paid", payment_date: "2026-01-05", payments: [] };
  const edit = validateMembershipInput({ ...INPUT, amount: "1100", notes: "amount corrected" });
  assert.equal(historicalPaid.payment_status, "paid");
  assert.equal("payment_status" in edit.data, false);
  assert.equal("payment_date" in edit.data, false);
  assert.deepEqual(edit.data.amount, 1100);
});

test("the form reads, posts and validates no payment status in any mode (create, renew, edit, guided)", () => {
  const actions = code("./actions.js");
  assert.doesNotMatch(actions, /payment_status|PAYMENT_STATUS/);
  assert.doesNotMatch(code("./validation.js"), /payment_status|PAYMENT_STATUS/);
  const form = code("../../app/memberships/membership-form.js");
  assert.doesNotMatch(form, /name="payment_status"|formData\.get\("payment_status"\)|setPaymentStatus|PAYMENT_STATUS_OPTIONS|paymentStatusLabel|paymentStatusLocked/);
  assert.doesNotMatch(form, /Payment status/, "no Review dialog row");
  assert.doesNotMatch(code("../../app/memberships/[id]/renew/page.js"), /payment_status/);
});

// ---- what the form shows ---------------------------------------------------------------------------------------------

test("neither Create nor Edit Membership shows, explains or submits a Payment Status", () => {
  const form = code("../../app/memberships/membership-form.js");
  assert.doesNotMatch(form, /Payment Status|Managed from Payments|PAYMENT_STATUS|@\/lib\/status/);
  assert.doesNotMatch(form, /name="payment_status"|payment_status:|formData\.get\("payment_status"\)|type="hidden"/);
  // The amount keeps its own cell, with its error, and nothing replaced the removed block.
  assert.match(form, /<Label htmlFor="amount">Amount \(\{currency\}\)<\/Label>/);
  assert.match(form, /id="amount-error"/);

  // Where the status IS read - the same table for every screen - still has all three labels.
  const statuses = code("../status.js");
  assert.match(statuses, /paid: \{ label: "Paid"/);
  assert.match(statuses, /partially_paid: \{ label: "Partially Paid"/);
  assert.match(statuses, /pending: \{ label: "Pending"/);
  assert.match(code("../../app/memberships/[id]/page.js"), /PAYMENT_STATUS\[membership\.payment_status\]/);

  // The Edit page still passes the saved membership (for the header), and the actions never read a status from the form.
  assert.match(code("../../app/memberships/[id]/edit/page.js"), /membership=\{membership\}/);
  assert.doesNotMatch(code("./actions.js"), /payment_status|PAYMENT_STATUS/);
});

test("the status labels are the saved ones (including Partially Paid), shown only for display", () => {
  const status = code("../status.js");
  assert.match(status, /partially_paid: \{ label: "Partially Paid"/);
  assert.doesNotMatch(code("../../app/memberships/membership-form.js"), /@\/lib\/status/, "the form no longer reads the status table");
});

// ---- what did not change ---------------------------------------------------------------------------------------------------

test("payments still decide the status: recording is the only writer, in the database", () => {
  const sql = source("../../supabase/migrations/0034_membership_payments.sql");
  assert.match(sql, /v_status := case when v_paid \+ v_total >= v_mem\.amount then 'paid' else 'partially_paid' end;/);
  assert.match(sql, /'Partially Paid is set by recording payments\.'/);
  const payments = code("./payment-actions.js");
  // It reads the status (to refuse an already-Paid membership) but never writes one.
  assert.doesNotMatch(payments, /payment_status\s*:|payment_status\s*=[^=]|\.update\(/);
});

test("no migration, trigger or SQL was added for this step", () => {
  const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  // Step 7 ended at 0037; the only later migrations are Step 8's payment amount edits, the duplicate-document guard, the payment editor, the GSTIN setting and class-count memberships (0042 to 0045, which do not touch payments).
  assert.deepEqual(files.slice(files.indexOf("0037_invoice_corrections.sql")), ["0037_invoice_corrections.sql", "0038_payment_amount_edits.sql", "0039_prevent_duplicate_documents.sql", "0040_edit_payment_details.sql", "0041_gstin_settings.sql", "0042_class_count_memberships.sql", "0043_class_count_attendance.sql", "0044_class_count_documents_and_guard.sql", "0045_class_count_dates_and_reversals.sql"]);
  assert.doesNotMatch(source("../../supabase/migrations/0038_payment_amount_edits.sql"), /payment_status\s+text|alter table public\.memberships/);
});

test("the documentation describes it: no Payment Status step in the flows, and the status follows the payments", () => {
  const ux = source("../../docs/02-ux.md");
  assert.doesNotMatch(ux, /Set Payment Status/);
  const product = source("../../docs/01-product.md").replace(/\r\n/g, "\n");
  assert.match(product, /Payment Status is never chosen by hand: a new membership \(including a renewal\) is created Pending/);
  assert.match(product, /Editing a membership never changes its Payment Status\. A membership marked Paid before payment records existed keeps that status/);
});
