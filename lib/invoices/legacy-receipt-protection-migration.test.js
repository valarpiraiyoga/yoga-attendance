import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// FS-D: source pins for migration 0054 (legacy issued receipt protection), its structural verification script, and the wording
// that explains it. There is no database in the unit test run; the behaviour is exercised by
// supabase/verification/verify_0054_legacy_receipt_protection_behavior.sql.

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/0054_legacy_receipt_protection.sql";
const STRUCTURE = "supabase/verification/verify_0054_legacy_receipt_protection.sql";
const M54 = read(MIGRATION);
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");
const C54 = code(M54);
const V54 = read(STRUCTURE);

test("0054 directly follows 0053", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  // Anchored on 0053, so later migrations (0055 onwards) do not move the pin.
  const at = files.indexOf("0053_instructor_class_count_recording.sql");
  assert.ok(at >= 0);
  assert.equal(files[at + 1], "0054_legacy_receipt_protection.sql");
});

test("0054 does exactly three idempotent drops - the trigger and its two functions - and nothing else", () => {
  const drops = [...C54.matchAll(/^drop (trigger|function) if exists ([^;]+);/gm)].map((m) => `${m[1]} ${m[2].replace(/\s+/g, " ")}`);
  assert.deepEqual(drops, [
    "trigger memberships_sync_invoice_trigger on public.memberships",
    "function public.memberships_sync_invoice()",
    "function public.sync_invoice_from_membership(uuid)",
  ]);
  assert.doesNotMatch(C54, /\b(create|alter|insert into|update public|delete from|truncate|grant|revoke)\b/i);
  assert.doesNotMatch(C54, /\bcascade\b/i);
});

test("0054 checks its dependencies before dropping anything, and the checks come first", () => {
  for (const needle of [
    "to_regclass('public.memberships') is null or to_regclass('public.invoices') is null",
    "to_regprocedure('public.invoices_freeze_snapshot()') is null",
    "to_regprocedure('public.memberships_auto_issue_invoice()') is null",
    "to_regprocedure('public.update_invoice_details(uuid, bigint, date)') is null",
    "to_regclass('public.class_count_expiry_edits') is null",
  ]) {
    assert.ok(C54.includes(needle), needle);
  }
  assert.ok(C54.indexOf("raise exception") < C54.indexOf("drop trigger"));
});

test("0054 documents what it keeps, the accepted limit and the re-run warning", () => {
  assert.match(M54, /never rewritten silently/);
  assert.match(M54, /issue_invoice_core and the auto-issue trigger memberships_auto_issue_invoice_trigger are untouched/);
  assert.match(M54, /invoices_freeze_snapshot/);
  assert.match(M54, /There is no cancel-and-reissue correction for a membership-level receipt/);
  assert.match(M54, /RE-RUNNING OTHER MIGRATIONS/);
  assert.match(M54, /INSTALLS the sync path again if it is re-run AFTER 0054/);
  assert.match(M54, /re-apply 0054 afterwards/);
});

test("the older migrations 0030-0049 still define the sync path (0054 is a new file, not an edit of them)", () => {
  assert.match(read("supabase/migrations/0030_invoice_membership_sync.sql"), /create trigger memberships_sync_invoice_trigger/);
  assert.match(read("supabase/migrations/0044_class_count_documents_and_guard.sql"), /create or replace function public\.sync_invoice_from_membership\(/);
  assert.match(read("supabase/migrations/0049_class_count_expiry_edits.sql"), /create trigger memberships_sync_invoice_trigger/);
});

test("the structural verification script is read-only and checks the sync objects are absent and the protections remain", () => {
  assert.match(V54, /^begin transaction read only;$/m);
  assert.match(V54, /^rollback;$/m);
  assert.doesNotMatch(code(V54), /\b(insert into|update public|delete from|drop |alter |create (table|function|trigger))\b/i);
  for (const needle of [
    "memberships_sync_invoice_trigger no longer exists",
    "memberships_sync_invoice() no longer exists",
    "no function public.sync_invoice_from_membership exists",
    "invoices_freeze_snapshot_trigger",
    "memberships_auto_issue_invoice_trigger",
    "memberships_invoice_guard_trigger",
    "invoices_reserve_number_trigger",
    "update_invoice_details(uuid, bigint, date)",
    "correct_payment_document",
  ]) {
    assert.ok(V54.includes(needle), needle);
  }
});

test("the invoice screens say the receipt keeps its issued details, with no mention of following the membership", () => {
  const page = read("app/memberships/[id]/invoice/page.js");
  const panel = read("app/memberships/[id]/invoice-panel.js");
  const dialog = read("app/memberships/[id]/invoice/edit-invoice.js");
  assert.match(page, /This receipt keeps the details it was issued with\. Later changes to the membership do not change it\./);
  assert.match(panel, /This receipt keeps the details it was issued with\. Later changes to the membership do not change it\./);
  assert.match(dialog, /The amount, plan and dates stay as issued/);
  for (const text of [page, panel, dialog]) assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ""), /follows? the membership/);
});

test("the legacy Edit Membership form shows the notice only for a Paid legacy membership with an issued receipt", () => {
  const page = read("app/memberships/[id]/edit/page.js");
  assert.match(page, /import \{ getInvoiceForMembership \} from "@\/lib\/invoices\/data";/);
  assert.match(page, /import Alert from "@\/components\/ui\/alert";/);
  assert.match(page, /const hasIssuedReceipt = !isPackageLinked && membership\.payment_status === "paid" && Boolean\(await getInvoiceForMembership\(id\)\);/);
  assert.match(page, /This membership has an issued receipt/);
  assert.match(page, /Changing the amount, plan or dates will not change the receipt\. It keeps the details it was issued with\./);
  // The notice sits in the legacy branch only; the package editor is untouched by it.
  const legacy = page.slice(page.indexOf("<MembershipForm") - 400);
  assert.ok(legacy.includes("hasIssuedReceipt ?"));
  assert.ok(page.indexOf("<PackageMembershipEditor") < page.indexOf("hasIssuedReceipt ?"));
  assert.doesNotMatch(page.slice(page.indexOf("<PackageMembershipEditor"), page.indexOf(") : (")), /hasIssuedReceipt/);
  // The save is unchanged: still the legacy action, with no confirmation.
  assert.match(page, /action=\{updateMembership\.bind\(null, id\)\}/);
  assert.match(page, /requireConfirmation=\{false\}/);
});

test("the docs record 0054 as applied and verified", () => {
  const plan = read("docs/04-development-plan.md");
  const row = plan.split("\n").find((l) => l.startsWith("| `0054` |"));
  assert.ok(row, "ledger row");
  assert.match(row, /Applied; catalog verification 15\/15 passed; behaviour script passed — 46 passed, 0 failed, 0 not tested; cleanup confirmed \(all reported by the user, 2026-10-15\)/);
  assert.match(plan, /Applied by the user, catalog and behaviour scripts passed as reported \(1 more\): `0054` — 15\/15 catalog checks; 46 passed, 0 failed, 0 not tested\./);
  assert.match(read("docs/01-product.md"), /### The Receipt Keeps Its Issued Details/);
  assert.match(read("docs/02-ux.md"), /A legacy membership with an issued receipt/);
});
