// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment - preventing duplicate document issuance (migration 0039). The SQL is read as text: the
// issuing function must be 0038's with only the guard added, and the migration must change no data. The
// application pieces (the visibility rule, the Payments panel, the error message) are tested directly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { issuePaymentDocumentFor } from "./invoice-core.js";
import { canIssuePaymentDocument, PAYMENT_DOCUMENT_BLOCKED_MESSAGE } from "./membership-invoice.js";

const read = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");
const M38 = read("0038_payment_amount_edits.sql");
const M39 = read("0039_prevent_duplicate_documents.sql");

function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

const HEADER = "create or replace function public.issue_payment_document_core(";
const NOW = fn(M39, HEADER);
const WAS = fn(M38, HEADER);

// ---- the database guard ---------------------------------------------------------------------------------------------

test("0039 re-creates issue_payment_document_core as 0038's body with only the guard added", () => {
  const withoutGuard = NOW.replace(/\n  -- 0039: [\s\S]*?using errcode = '55000';\n  end if;\n/, "");
  assert.notEqual(withoutGuard, NOW, "the guard is present");
  assert.equal(withoutGuard, WAS);
});

test("the guard refuses a FIRST payment document when the membership has a membership-level document (55000)", () => {
  const guard = NOW.match(/  if p_replaces_id is null\n[\s\S]*?end if;/)[0];
  assert.match(guard, /exists \(select 1 from public\.invoices where membership_id = v_mem\.id and payment_id is null\)/);
  assert.match(guard, /raise exception 'A membership invoice already exists for this membership\.' using errcode = '55000';/);
});

test("the guard runs under the membership and settings locks, after the payment re-read, before any number is chosen", () => {
  const at = (text) => {
    const i = NOW.indexOf(text);
    assert.ok(i >= 0, text);
    return i;
  };
  const lockMembership = at("from public.memberships\n  where id = v_payment.membership_id\n  for update;");
  const lockSettings = at("from public.invoice_settings\n  where singleton\n  for update;");
  const reread = at("-- 0038: read the payment again");
  const guard = at("if p_replaces_id is null\n     and exists");
  const candidate = at("v_candidate := coalesce(");
  const insert = at("insert into public.invoices (");
  assert.ok(lockMembership < lockSettings && lockSettings < reread && reread < guard, "locks, re-read, guard");
  assert.ok(guard < candidate && candidate < insert, "a refusal consumes no number and writes nothing");
});

test("a replacement (Cancel and Reissue) is not blocked: the guard applies only when p_replaces_id is null", () => {
  assert.match(NOW, /if p_replaces_id is null\n {5}and exists/);
  // correct_payment_document still reissues through the core, with the replaced document's id.
  const correction = fn(read("0037_invoice_corrections.sql"), "create or replace function public.correct_payment_document(");
  assert.match(correction, /issue_payment_document_core\(v_doc\.payment_id, v_doc\.invoice_date, v_doc\.document_series, v_doc\.id\)/);
});

test("0039 changes no data and keeps the internal function closed to clients; it re-creates nothing else", () => {
  const outside = code(M39).replace(code(NOW), "");
  assert.doesNotMatch(outside, /\b(insert\s+into|update\s+public|delete\s+from|alter\s+table|drop\s|create\s+table|create\s+trigger)/i);
  assert.match(code(M39), /revoke execute on function public\.issue_payment_document_core\(uuid, date, text, uuid\) from public, anon, authenticated;/);
  assert.doesNotMatch(code(M39), /grant execute/);
  assert.equal((code(M39).match(/create or replace function/g) ?? []).length, 1);
});

test("0039 needs 0037 and 0038 first", () => {
  assert.match(M39, /0039 needs migration 0037/);
  assert.match(M39, /0039 needs migration 0038/);
});

// ---- the application ------------------------------------------------------------------------------------------------

test("canIssuePaymentDocument: offered unless the membership already has a membership-level document", () => {
  assert.equal(canIssuePaymentDocument({ hasMembershipInvoice: false }), true);
  assert.equal(canIssuePaymentDocument({}), true);
  assert.equal(canIssuePaymentDocument(), true);
  assert.equal(canIssuePaymentDocument({ hasMembershipInvoice: true }), false);
  assert.equal(PAYMENT_DOCUMENT_BLOCKED_MESSAGE, "A membership invoice already exists for this membership.");
});

test("Membership Details tells the Payments panel whether the membership-level invoice exists", () => {
  const page = source("../../app/memberships/[id]/page.js");
  assert.match(page, /<PaymentsPanel[\s\S]*?hasMembershipInvoice=\{Boolean\(invoice\)\}/);
});

test("the Payments panel hides Issue Document and explains why, but keeps documents linked and Edit Amount untouched", () => {
  const panel = source("../../app/memberships/[id]/payments-panel.js");
  assert.match(panel, /hasMembershipInvoice = false/);
  assert.match(panel, /canIssuePaymentDocument\(\{ hasMembershipInvoice \}\)/);
  assert.match(panel, /\{hasMembershipInvoice \? \(\s*<p[^>]*>\{PAYMENT_DOCUMENT_BLOCKED_MESSAGE\}<\/p>\s*\) : null\}/);
  // Issue Document sits only behind the check; "Not available" replaces it.
  assert.match(panel, /\{canIssueDocument \? \(\s*<IssuePaymentDocument[\s\S]*?\/>\s*\) : \(\s*<span[^>]*>Not available<\/span>\s*\)\}/);
  assert.equal((panel.match(/<IssuePaymentDocument/g) ?? []).length, 1);
  // A payment WITH a document is still shown as a link, before and outside the check.
  const link = panel.indexOf("href={`/memberships/${membership.id}/documents/${payment.document.id}`}");
  assert.ok(link > 0 && link < panel.indexOf("{canIssueDocument ?"), "existing documents stay viewable");
  assert.match(panel, /\{payment\.editable \? \(\s*<EditPaymentAmount/);
});

test("without a membership-level invoice, Issue Document is offered as before", () => {
  assert.equal(canIssuePaymentDocument({ hasMembershipInvoice: false }), true);
});

test("the database refusal reaches the Admin in words", async () => {
  const refused = await issuePaymentDocumentFor(
    { rpc: async () => ({ data: null, error: { code: "55000", message: "A membership invoice already exists for this membership." } }) },
    "pay-1",
  );
  assert.equal(refused.error, "A membership invoice already exists for this membership, so its payments cannot be given documents.");
  assert.equal(refused.code, "55000");
});

test("normal issuing is unchanged: the payment alone is sent", async () => {
  const calls = [];
  const supabase = { rpc: async (name, args) => (calls.push({ name, args }), { data: "doc-1", error: null }) };
  assert.deepEqual(await issuePaymentDocumentFor(supabase, "pay-1"), { success: true, invoiceId: "doc-1" });
  assert.deepEqual(calls, [{ name: "issue_payment_document", args: { p_payment_id: "pay-1" } }]);
});

// ---- the verification script ---------------------------------------------------------------------------------------

test("the 0039 behaviour script is rollback-only, skips cleanly before 0039, and never names the real memberships in SQL", () => {
  const script = source("../../supabase/verification/verify_0039_prevent_duplicate_documents_behavior.sql");
  const sql = code(script);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^rollback;/m);
  assert.doesNotMatch(sql, /\bcommit\b(?! drop)/i);
  assert.match(sql, /P0 migration 0039 is applied/);
  assert.doesNotMatch(sql, /MEM-0000\d\d/);
  // Every write goes through ZZVERIFY fixtures; nothing is deleted or truncated.
  assert.doesNotMatch(sql, /\b(delete\s+from|truncate|drop\s+table\s+public)/i);
  for (const id of ["G1", "G2", "G3", "G4", "N1", "N3", "C1", "C2a", "C2c", "C2d", "Z1", "Z2"]) assert.ok(script.includes(`'${id} `), id);
});
