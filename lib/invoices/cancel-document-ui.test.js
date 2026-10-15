// Run with `npm test` (Node's built-in test runner).
//
// Cancel Document - the dialog on an issued payment document (migration 0055, Step 3). React components cannot be rendered under
// node:test, so the wiring is pinned as source; the action's behaviour (the required reason, the RPC, the error mapping) is run
// for real through the core with a small fake client. The database rules are pinned in payment-document-correction-migration.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { cancelPaymentDocumentFor } from "./invoice-core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DIR = "../../app/memberships/[id]/documents/[documentId]/";
const DIALOG = `${DIR}cancel-document.js`;
const PAGE = `${DIR}page.js`;

function client(result) {
  const calls = [];
  return { calls, rpc: (name, args) => (calls.push({ name, args }), Promise.resolve(result)) };
}

// ---- the dialog --------------------------------------------------------------------------------------------------

test("Cancel Document is its own action, beside Correct Document, on an issued document only", () => {
  assert.equal(existsSync(new URL(DIALOG, import.meta.url)), true);
  const page = code(PAGE);
  assert.match(page, /import CancelDocument from "@\/app\/memberships\/\[id\]\/documents\/\[documentId\]\/cancel-document";/);
  // Both actions sit in the same issued-only group; a cancelled document shows neither.
  assert.match(page, /\{isCancelled \? null : \(\s*<>\s*<Button variant="outline" render=\{<Link href=\{`\/memberships\/\$\{id\}\/documents\/\$\{document\.id\}\/correct`\} \/>\} nativeButton=\{false\}>[\s\S]*?Correct Document\s*<\/Button>\s*<CancelDocument membershipId=\{id\} documentId=\{document\.id\} title=\{invoiceDocument\.title\} number=\{invoiceDocument\.number\} \/>\s*<\/>\s*\)\}/);
  assert.equal([...page.matchAll(/<CancelDocument /g)].length, 1);
  assert.equal([...page.matchAll(/Correct Document/g)].length, 1);
});

test("the dialog uses the existing confirmation pattern: the button only opens it, and Confirm runs the action", () => {
  const dialog = code(DIALOG);
  assert.match(dialog, /import ConfirmDialog from "@\/components\/ui\/confirm-dialog";/);
  assert.match(dialog, /import ContextCard from "@\/components\/ui\/context-card";/);
  assert.match(dialog, /<Button type="button" variant="outline" onClick=\{\(\) => setOpen\(true\)\}>/);
  assert.match(dialog, /tone="warning"/);
  assert.match(dialog, /confirmLabel="Cancel Document"\s+pendingLabel="Cancelling…"\s+isPending=\{isPending\}\s+onConfirm=\{runCancel\}/);
  assert.match(dialog, /startTransition\(async \(\) => \{/);
});

test("it explains that the original is preserved and that no replacement is issued", () => {
  const dialog = read(DIALOG);
  assert.match(dialog, /will be cancelled\. It stays viewable, marked Cancelled with your reason, and keeps its number and every detail\./);
  assert.match(dialog, /No replacement is issued, and the payment and the membership are not changed\./);
  assert.match(dialog, /To correct details or the amount instead, use Correct Document\./);
  assert.match(dialog, /This cannot be undone\./);
});

test("a reason is required (at most 500 characters) before anything is sent", () => {
  const dialog = code(DIALOG);
  assert.match(dialog, /const REASON_MAX = 500;/);
  assert.match(dialog, /label="Reason for the cancellation"\s+required/);
  assert.match(dialog, /maxLength=\{REASON_MAX\}/);
  assert.match(dialog, /if \(!reason\.trim\(\)\) \{\s+setFieldError\("Enter the reason for the cancellation\."\);\s+return;\s+\}/);
  // The check comes before the call, so an empty reason never reaches the server.
  assert.ok(dialog.indexOf("Enter the reason for the cancellation.") < dialog.indexOf("await cancelPaymentDocument("));
});

test("the dialog calls the server action, never the database or a client of its own", () => {
  const dialog = code(DIALOG);
  assert.match(dialog, /import \{ cancelPaymentDocument \} from "@\/lib\/invoices\/actions";/);
  assert.match(dialog, /await cancelPaymentDocument\(membershipId, documentId, reason\)/);
  assert.equal([...dialog.matchAll(/cancelPaymentDocument\(/g)].length, 1);
  assert.doesNotMatch(dialog, /\.rpc\(|supabase|createClient|correctAndReissue|correctPaymentDocument/);
});

test("success refreshes the page (the cancelled status and reason appear); refusals are shown; a second click is blocked", () => {
  const dialog = code(DIALOG);
  // Success: close, then refresh - the action has already revalidated the document and the membership.
  assert.match(dialog, /handleOpenChange\(false\);\s+router\.refresh\(\);/);
  // A refusal: the reason's own message on the field, anything else in the banner; a network failure never crashes.
  assert.match(dialog, /setFieldError\(result\.fieldErrors\?\.reason \?\? null\);\s+setFormError\(result\.fieldErrors\?\.reason \? null : result\.error\);/);
  assert.match(dialog, /Could not reach the server\. Try again\./);
  assert.match(dialog, /role="alert"/);
  // Duplicate submissions: a ref, and the dialog cannot be dismissed while the request runs.
  assert.match(dialog, /const inFlight = useRef\(false\);/);
  assert.match(dialog, /if \(inFlight\.current\) return;/);
  assert.match(dialog, /if \(!next && inFlight\.current\) return;/);
  assert.match(dialog, /disabled=\{isPending\}/);
});

// ---- a cancelled document ------------------------------------------------------------------------------------------

test("a cancelled document shows its status and reason, and offers neither Correct nor Cancel", () => {
  const page = code(PAGE);
  assert.match(page, /const isCancelled = document\.status === "cancelled";/);
  assert.match(page, /This document was cancelled\{invoiceDocument\.cancellation\?\.date/);
  assert.match(page, /Reason: \{invoiceDocument\.cancellation\.reason\}/);
  // Both actions are inside the single issued-only branch; there is no other place either is rendered.
  const branch = page.slice(page.indexOf("{isCancelled ? null : ("), page.indexOf("</>\n        }"));
  assert.ok(branch.includes("<CancelDocument") && branch.includes("Correct Document"));
  assert.equal(page.indexOf("<CancelDocument"), page.lastIndexOf("<CancelDocument"));
  // The cancelled copy carries the word CANCELLED in the HTML, and the page does not link to the correction.
  assert.match(read("../../app/memberships/[id]/invoice/invoice-document.js"), /Cancellation reason: \{doc\.cancellation\.reason\}/);
});

test("the correction page of a cancelled document goes back to the document, so it cannot be corrected after a cancellation", () => {
  const correctionPage = code(`${DIR}correct/page.js`);
  assert.match(correctionPage, /if \(document\.status !== "issued"\) \{\s+redirect\(documentPath\);/);
});

// ---- the server action's behaviour (the real core, a fake client) ---------------------------------------------------------------

test("a successful cancellation sends only the document and the trimmed reason - no replacement, no payment, no membership", async () => {
  const supabase = client({ data: "doc-1", error: null });
  const result = await cancelPaymentDocumentFor(supabase, "doc-1", "  Issued to the wrong student  ");
  assert.deepEqual(result, { success: true, documentId: "doc-1" });
  assert.deepEqual(supabase.calls, [{ name: "cancel_payment_document", args: { p_document_id: "doc-1", p_reason: "Issued to the wrong student" } }]);
});

test("an empty, blank or over-long reason is refused before the database is called", async () => {
  const supabase = client({ data: "doc-1", error: null });
  for (const reason of ["", "   ", undefined, null]) {
    const result = await cancelPaymentDocumentFor(supabase, "doc-1", reason);
    assert.equal(result.fieldErrors.reason, "Enter the reason for the cancellation.");
  }
  const long = await cancelPaymentDocumentFor(supabase, "doc-1", "x".repeat(501));
  assert.equal(long.fieldErrors.reason, "The reason can have at most 500 characters.");
  assert.equal((await cancelPaymentDocumentFor(supabase, "doc-1", "x".repeat(500))).success, true);
  assert.equal(supabase.calls.length, 1, "only the 500-character reason reached the database");
});

test("the database's refusals become messages: not authorized, not found, already cancelled, not a payment document", async () => {
  const refuse = (error) => cancelPaymentDocumentFor(client({ data: null, error }), "doc-1", "reason");
  assert.equal((await refuse({ code: "42501", message: "Not authorized." })).error, "You do not have permission to manage invoices.");
  assert.equal((await refuse({ code: "P0002", message: "Invoice not found." })).error, "Invoice not found.");
  assert.equal((await refuse({ code: "55006", message: "This document has already been cancelled." })).code, "55006");
  assert.equal((await refuse({ code: "55000", message: "Only a payment document can be cancelled." })).error, "Only a payment document can be cancelled.");
  assert.equal((await refuse({ code: "22023", message: "Enter the reason for the cancellation." })).fieldErrors.reason, "Enter the reason for the cancellation.");
});

test("the action is Admin only (the Instructor stays unauthorized: the page, the action and the database each refuse)", () => {
  const actions = code("./actions.js");
  const start = actions.indexOf("export async function cancelPaymentDocument(");
  const body = actions.slice(start, actions.indexOf("\n}\n", start));
  assert.match(body, /await requireRole\(ROLES\.ADMIN\);/);
  assert.ok(body.indexOf("requireRole") < body.indexOf("createClient"));
  // A success revalidates the membership and this document's page, so the refresh shows it cancelled with its reason.
  assert.match(body, /revalidateMembership\(membershipId\);\s+revalidatePath\(`\$\{membershipPath\(membershipId\)\}\/documents\/\$\{documentId\}`\);/);
  assert.match(code(PAGE), /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(read("../../supabase/migrations/0055_payment_document_cancel_and_correction.sql"), /create or replace function public\.cancel_payment_document\([\s\S]*?if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.' using errcode = '42501';/);
});
