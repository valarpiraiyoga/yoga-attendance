// Run with `npm test` (Node's built-in test runner).
//
// The GSTIN setting (migration 0041): the rules, the validation, the save flow, what a document shows (always the value
// copied into it when it was issued), and the migration - read as text - that adds the setting, the snapshot column, and
// the two issuing functions' one-line change. What only a database can show (the real default, the grants, the snapshot
// at issue time) is checked by supabase/verification/verify_0041_gstin_settings_behavior.sql, which is run by hand.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdf from "../invoices/pdf/invoice-pdf.js";
import { extractPdfText } from "../invoices/pdf/pdf-text.js";
import { buildInvoiceDocument } from "../invoices/invoice-document.js";
import { INVOICE_COLUMNS } from "../invoices/invoice-core.js";
import { GSTIN_PATTERN, gstinCheckCharacter, isValidGstin, normalizeGstin, validateGstin } from "./gstin.js";
import { validateInvoiceSettingsInput } from "./validation.js";
import { INVOICE_SETTINGS_COLUMNS, WRITABLE_COLUMNS, buildSettingsUpdate, mapSettingsError, saveInvoiceSettings } from "./settings-core.js";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const M36 = read("supabase/migrations/0036_payment_documents.sql");
const M39 = read("supabase/migrations/0039_prevent_duplicate_documents.sql");
const M41 = read("supabase/migrations/0041_gstin_settings.sql");
const C41 = M41.replace(/^\s*--.*$/gm, "");

function fn(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

// A GSTIN that is well formed AND has the right check character, that belongs to no real entity.
const GOOD_GSTIN = "29ABCDE1234F1ZW";
// The value the migration gives the settings row the first time it runs - read FROM the migration, not repeated here.
const INITIAL_GSTIN = M41.match(/set gstin = '([^']+)'/)[1];

// ==== the rules ================================================================================================

test("a GSTIN is 15 characters: state code, PAN, entity number, Z, check character", () => {
  assert.equal(GSTIN_PATTERN.test(GOOD_GSTIN), true);
  for (const bad of ["29ABCDE1234F1Z", "29ABCDE1234F1ZWX", "29abcde1234f1zw", "XXABCDE1234F1ZW", "29ABCDE1234F1AW", "29ABCDE1234F0ZW", "29ABCDE12345F1ZW", ""]) {
    assert.equal(GSTIN_PATTERN.test(bad), false, bad);
  }
});

test("the check character is validated, so a mistyped number is caught", () => {
  assert.equal(gstinCheckCharacter("29ABCDE1234F1Z"), "W");
  assert.equal(isValidGstin(GOOD_GSTIN), true);
  assert.equal(isValidGstin("27AAPFU0939F1ZV"), true, "another real-format GSTIN with a correct check character");
  assert.equal(isValidGstin("29ABCDE1234F1ZX"), false, "right format, wrong check character");
  assert.equal(isValidGstin("29ABCDE1234F1Z"), false);
  assert.equal(isValidGstin(null), false);
});

test("the initial value in the migration is itself a valid GSTIN, in format and check character", () => {
  assert.equal(INITIAL_GSTIN, "29BPGPP6168E1ZH");
  assert.equal(GSTIN_PATTERN.test(INITIAL_GSTIN), true);
  assert.equal(isValidGstin(INITIAL_GSTIN), true);
});

test("what is typed is trimmed and upper-cased; blank is no GSTIN; nothing else is rewritten", () => {
  assert.equal(normalizeGstin("  29abcde1234f1zw \n"), GOOD_GSTIN);
  for (const blank of ["", "   ", null, undefined]) assert.equal(normalizeGstin(blank), null);
  assert.equal(normalizeGstin("29ABC DE1234F1ZW"), "29ABC DE1234F1ZW", "an inner space stays, so it is reported");
  assert.deepEqual(validateGstin(" 29abcde1234f1zw "), { ok: true, value: GOOD_GSTIN });
  assert.deepEqual(validateGstin(""), { ok: true, value: null });
  assert.equal(validateGstin("29ABC DE1234F1ZW").ok, false);
  assert.equal(validateGstin("29-ABCDE1234F1ZW").ok, false);
});

// ==== validation in the settings form =============================================================================

const BASE = { document_title: "invoice", starting_invoice_number: "1224", tax_enabled: "0", terms: "", signatory_name: "", signatory_designation: "" };

test("the settings validator saves a valid GSTIN normalised, clears a blank one, and ignores one that was not submitted", () => {
  assert.equal(validateInvoiceSettingsInput({ ...BASE, gstin: " 29abcde1234f1zw " }).data.gstin, GOOD_GSTIN);
  for (const blank of ["", "   ", null]) assert.equal(validateInvoiceSettingsInput({ ...BASE, gstin: blank }).data.gstin, null, String(blank));
  const omitted = validateInvoiceSettingsInput(BASE);
  assert.equal(omitted.success, true);
  assert.equal("gstin" in omitted.data, false, "a caller that sends none leaves the stored GSTIN alone");
});

test("an invalid GSTIN is rejected with a message on the field, and blocks the save", () => {
  for (const bad of ["29ABCDE1234F1Z", "not a gstin", "29ABCDE1234F1ZX", "29ABC DE1234F1ZW", "29ABCDE1234F1ZW1"]) {
    const result = validateInvoiceSettingsInput({ ...BASE, gstin: bad });
    assert.equal(result.success, false, bad);
    assert.match(result.errors.gstin, /Enter a valid 15-character GSTIN/);
  }
  // It is the only error: the rest of the form is still valid, and a GSTIN does not depend on the tax switch.
  assert.deepEqual(Object.keys(validateInvoiceSettingsInput({ ...BASE, gstin: "bad" }).errors), ["gstin"]);
  assert.equal(validateInvoiceSettingsInput({ ...BASE, tax_enabled: "0", gstin: GOOD_GSTIN }).success, true);
  assert.equal(validateInvoiceSettingsInput({ ...BASE, tax_enabled: "1", tax_name: "GST", tax_rate: "18", gstin: GOOD_GSTIN }).success, true);
});

// ==== the save flow =================================================================================================

/** A Supabase stand-in that records updates and answers the "has an invoice been issued" counts. */
function fakeSupabase({ updateError = null } = {}) {
  const calls = { updates: [], selects: [] };
  return {
    calls,
    from(table) {
      const query = { table };
      const builder = {
        select(columns) {
          calls.selects.push({ table, columns });
          return builder;
        },
        eq: () => builder,
        maybeSingle: async () => ({ data: { gstin: GOOD_GSTIN }, error: null }),
        then: (resolve) => resolve({ count: 0, error: null }),
        update(payload) {
          calls.updates.push({ table: query.table, payload });
          return { eq: async () => ({ error: updateError }) };
        },
      };
      return builder;
    },
    storage: { from: () => ({}) },
  };
}

test("saving writes the normalised GSTIN to invoice_settings with the other settings, through the existing flow", async () => {
  const supabase = fakeSupabase();
  const result = await saveInvoiceSettings(supabase, { input: { ...BASE, gstin: " 29abcde1234f1zw " } });
  assert.deepEqual(result, { success: true });
  assert.equal(supabase.calls.updates.length, 1);
  assert.equal(supabase.calls.updates[0].table, "invoice_settings");
  assert.equal(supabase.calls.updates[0].payload.gstin, GOOD_GSTIN);
});

test("clearing the GSTIN saves NULL; not sending it saves nothing about it", async () => {
  const cleared = fakeSupabase();
  await saveInvoiceSettings(cleared, { input: { ...BASE, gstin: "" } });
  assert.equal(cleared.calls.updates[0].payload.gstin, null);

  const untouched = fakeSupabase();
  await saveInvoiceSettings(untouched, { input: BASE });
  assert.equal("gstin" in untouched.calls.updates[0].payload, false);
});

test("an invalid GSTIN is refused before anything is written", async () => {
  const supabase = fakeSupabase();
  const result = await saveInvoiceSettings(supabase, { input: { ...BASE, gstin: "29ABCDE1234F1ZX" } });
  assert.equal(result.error, "Check the highlighted fields.");
  assert.match(result.fieldErrors.gstin, /valid 15-character GSTIN/);
  assert.equal(supabase.calls.updates.length, 0);
});

test("gstin is a read and a writable column, never one of the protected ones", () => {
  assert.ok(INVOICE_SETTINGS_COLUMNS.split(", ").includes("gstin"));
  assert.ok(WRITABLE_COLUMNS.includes("gstin"));
  assert.deepEqual(buildSettingsUpdate({ gstin: GOOD_GSTIN, next_invoice_number: 9, singleton: false }), { gstin: GOOD_GSTIN });
});

test("the database's own refusals are shown plainly: the CHECK on the setting, and a non-Admin", () => {
  const check = mapSettingsError({ code: "23514", message: 'new row for relation "invoice_settings" violates check constraint "invoice_settings_gstin_valid"' });
  assert.equal(check.fieldErrors.gstin, "Enter a valid 15-character GSTIN, or leave it blank.");
  assert.equal(mapSettingsError({ code: "42501", message: "permission denied" }).error, "You do not have permission to change the invoice settings.");
});

test("the action and the form carry the field; only an Admin can reach the action; the field does not depend on the tax switch", () => {
  const action = code("lib/invoice-settings/actions.js");
  assert.ok(action.indexOf("await requireRole(ROLES.ADMIN)") < action.indexOf("createClient()"));
  assert.match(action, /gstin: formData\.get\("gstin"\) \?\? undefined,/);

  const form = code("app/settings/invoice-receipt/invoice-receipt-form.js");
  assert.match(form, /gstin: formData\.get\("gstin"\) \?\? undefined,/);
  assert.match(form, /"gstin",\s+"terms",/, "validated on blur like the other fields");
  const field = form.slice(form.indexOf('id="gstin"'), form.indexOf("</FormField>", form.indexOf('id="gstin"')));
  assert.match(field, /name="gstin"/);
  assert.match(field, /disabled=\{isPending\}/);
  assert.doesNotMatch(field, /taxEnabled/, "a GSTIN is not part of the tax switch");
  assert.match(field, /defaultValue=\{state\?\.values\?\.gstin \?\? settings\?\.gstin \?\? ""\}/);
  // It sits in the Tax panel, after the tax name and rate and before Document Content.
  assert.ok(form.indexOf('name="tax_rate"') < form.indexOf('id="gstin"') && form.indexOf('id="gstin"') < form.indexOf('title="Document Content"'));
});

// ==== what a document shows ============================================================================================

const row = (overrides = {}) => ({
  id: "d1", membership_id: "m1", payment_id: "p1", document_series: "invoice", document_title: "invoice",
  invoice_number: 31, invoice_prefix: "INV-", invoice_date: "2026-12-05", payment_date: "2026-12-04",
  description: "Monthly Membership", plan: "monthly", period_start: "2026-12-01", period_end: "2026-12-31",
  currency: "INR", total_amount: 1000, tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null,
  customer_name: "Asha Rao", customer_code: "YC-000012",
  business_name: "Sri Yoga Center", business_address: "12 Temple Road, Chennai", business_phone: "04412345678", business_email: "hello@sriyoga.example",
  business_gstin: GOOD_GSTIN, status: "issued", cancelled_at: null, cancellation_reason: null, ...overrides,
});

// The extractor spaces words unevenly ("12  Temple Road"), so runs of whitespace are collapsed before anything is compared.
const pdfText = async (invoice) =>
  extractPdfText(await renderToBuffer(createElement(InvoicePdf, { invoiceDocument: buildInvoiceDocument(invoice) }))).join(" ").replace(/\s+/g, " ");

test("the document model carries the GSTIN a tax invoice was issued with, and nothing when it had none", () => {
  assert.equal(buildInvoiceDocument(row()).business.gstin, GOOD_GSTIN);
  for (const none of [null, undefined, "", "  "]) assert.equal(buildInvoiceDocument(row({ business_gstin: none })).business.gstin, null, String(none));
});

test("a payment receipt is not a tax document: its model carries no GSTIN, even if a value were stored on it", () => {
  const receipt = { document_series: "payment_receipt", document_title: "payment_receipt", invoice_prefix: "PR-" };
  assert.equal(buildInvoiceDocument(row({ ...receipt, business_gstin: GOOD_GSTIN })).business.gstin, null, "hidden by the rule, not only by the data");
  assert.equal(buildInvoiceDocument(row({ ...receipt, business_gstin: null })).business.gstin, null);
  // Every other kind of document is a tax-invoice-series document and keeps showing its own stored value: the Invoice title,
  // and the Receipt title that a membership-level document can be configured to use (it is still the invoice series).
  for (const document_title of ["invoice", "receipt"]) {
    assert.equal(buildInvoiceDocument(row({ document_title })).business.gstin, GOOD_GSTIN, document_title);
  }
});

test("a tax invoice shows it in the business details, between the address and the contacts", async () => {
  for (const overrides of [{}, { document_title: "receipt" }]) {
    const text = await pdfText(row(overrides));
    assert.ok(text.includes(`GSTIN: ${GOOD_GSTIN}`), text);
    const [address, gstin, phone] = ["12 Temple Road, Chennai", "GSTIN:", "04412345678"].map((part) => text.indexOf(part));
    assert.ok(address >= 0 && gstin >= 0 && phone >= 0, `all three found: ${address} ${gstin} ${phone}`);
    assert.ok(address < gstin && gstin < phone, "address, GSTIN, phone");
  }
});

test("a payment receipt shows no GSTIN - not on the PDF, not in the model that the page also uses", async () => {
  const receipt = row({ document_series: "payment_receipt", document_title: "payment_receipt", invoice_prefix: "PR-", business_gstin: GOOD_GSTIN });
  const text = await pdfText(receipt);
  assert.ok(!text.includes("GSTIN"), text);
  assert.ok(!text.includes(GOOD_GSTIN));
  // The rest of the business details are still there: only the GSTIN is withheld.
  assert.ok(text.includes("Sri Yoga Center") && text.includes("12 Temple Road, Chennai") && text.includes("04412345678"));
  assert.equal(buildInvoiceDocument(receipt).business.gstin, null);
  // Page and PDF read the same model field, so they cannot disagree.
  assert.match(code("app/memberships/[id]/invoice/invoice-document.js"), /\{business\.gstin \?/);
  assert.match(code("lib/invoices/pdf/invoice-pdf.js"), /business\.gstin \?/);
});

test("a cancelled payment receipt, like a cancelled tax invoice, keeps what it showed: none, and its own value", async () => {
  const cancelledReceipt = await pdfText(row({ document_series: "payment_receipt", document_title: "payment_receipt", status: "cancelled", cancelled_on: "2026-12-06", cancellation_reason: "x", business_gstin: GOOD_GSTIN }));
  assert.ok(!cancelledReceipt.includes("GSTIN"));
  assert.ok(cancelledReceipt.includes("CANCELLED ON"));
});

test("a document issued without a GSTIN shows no GSTIN line at all - issued documents are never rewritten", async () => {
  assert.ok(!(await pdfText(row({ business_gstin: null }))).includes("GSTIN"));
  assert.ok(!(await pdfText(row({ business_gstin: undefined }))).includes("GSTIN"));
});

test("a document shows the value stored on IT: two documents with different snapshots show their own", async () => {
  const first = await pdfText(row({ business_gstin: "29ABCDE1234F1ZW" }));
  const later = await pdfText(row({ id: "d2", invoice_number: 32, business_gstin: "27AAPFU0939F1ZV" }));
  assert.ok(first.includes("GSTIN: 29ABCDE1234F1ZW") && !first.includes("27AAPFU0939F1ZV"));
  assert.ok(later.includes("GSTIN: 27AAPFU0939F1ZV") && !later.includes("29ABCDE1234F1ZW"));
});

test("a cancelled document keeps its GSTIN", async () => {
  const text = await pdfText(row({ status: "cancelled", cancelled_on: "2026-12-06", cancellation_reason: "Wrong name" }));
  assert.ok(text.includes(`GSTIN: ${GOOD_GSTIN}`));
  assert.ok(text.includes("CANCELLED ON"));
});

test("the document is rendered ONLY from the stored snapshot: no live settings are read, and no GSTIN is written in a template", () => {
  assert.ok(INVOICE_COLUMNS.split(", ").includes("business_gstin"), "the page and the PDF read the stored column");
  for (const file of ["lib/invoices/invoice-document.js", "lib/invoices/pdf/invoice-pdf.js", "app/memberships/[id]/invoice/invoice-document.js"]) {
    assert.doesNotMatch(code(file), /invoice-settings|invoice_settings|fetchInvoiceSettings/, file);
  }
  assert.match(code("lib/invoices/invoice-document.js"), /gstin: invoice\.document_title === "payment_receipt" \? null : blank\(invoice\.business_gstin\),/);
  assert.match(code("app/memberships/[id]/invoice/invoice-document.js"), /\{business\.gstin \? <p[^>]*>GSTIN: \{business\.gstin\}<\/p> : null\}/);
  assert.match(code("lib/invoices/pdf/invoice-pdf.js"), /business\.gstin \? text\(styles\.secondary, `GSTIN: \$\{business\.gstin\}`\) : null,/);

  // The configured number is configuration: it appears in the migration (its initial value) and nowhere in the application.
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name) && readFileSync(path, "utf8").includes(INITIAL_GSTIN)) hits.push(path);
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(fileURLToPath(new URL(`${dir}/`, root)));
  assert.deepEqual(hits, [], "no template, validator or setting default hardcodes the GSTIN");
});

// ==== migration 0041 ====================================================================================================

test("0041 checks its prerequisites before changing anything", () => {
  const firstChange = C41.indexOf("alter table");
  for (const needs of ["needs migration 0036", "needs migration 0037", "needs migration 0039"]) {
    const at = C41.indexOf(needs);
    assert.ok(at > 0 && at < firstChange, needs);
  }
  assert.match(C41, /not like '%A membership invoice already exists for this membership\.%'/);
});

test("the setting: a nullable text column, initialised ONCE, with the same CHECK as the document column, Admin-updatable", () => {
  assert.match(C41, /alter table public\.invoice_settings add column gstin text;/);
  assert.doesNotMatch(C41, /gstin text not null|gstin text default|business_gstin text not null/i, "nullable, no default: existing rows stay valid");
  // The initial value is written only in the branch that creates the column, to the one settings row.
  const addColumn = C41.indexOf("alter table public.invoice_settings add column gstin text;");
  const branch = C41.slice(C41.lastIndexOf("if not exists", addColumn), C41.indexOf("end if;\nend $$;", addColumn));
  assert.match(branch, /alter table public\.invoice_settings add column gstin text;[\s\S]*update public\.invoice_settings\s+set gstin = '[^']+',\s+updated_at = now\(\)\s+where singleton;/);
  assert.equal((C41.match(/set gstin = /g) ?? []).length, 1);
  assert.match(C41, /grant update \(gstin\) on public\.invoice_settings to authenticated;/);
  assert.doesNotMatch(C41, /grant [^;]*on public\.invoices/i, "documents stay read-only for clients");

  const patterns = [...C41.matchAll(/check \((?:business_)?gstin is null or (?:business_)?gstin ~ '([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(patterns.length, 2, "one CHECK on each table");
  for (const pattern of patterns) assert.equal(pattern, GSTIN_PATTERN.source, "the database and the application agree on the format");
  assert.match(C41, /add constraint invoice_settings_gstin_valid/);
  assert.match(C41, /add constraint invoices_business_gstin_valid/);
});

test("the migration describes the rule: a payment receipt is stored with NULL", () => {
  assert.match(M41, /only onto a TAX INVOICE \(the invoice series\)/);
  assert.match(M41, /A payment receipt, which is not a tax document, always has NULL/);
  assert.match(M41, /the GSTIN only onto a tax invoice, never onto a payment receipt/);
  // Nothing forbids a GSTIN on a receipt in the database beyond that function: no new constraint on the receipt shape.
  assert.doesNotMatch(C41, /invoices_payment_receipt_shape/);
});

test("the snapshot: a nullable column on invoices; no existing document is written", () => {
  assert.match(C41, /alter table public\.invoices\s+add column if not exists business_gstin text;/);
  const outsideFunctions = C41.replace(/create or replace function[\s\S]*?\n\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\b(update|insert into|delete from)\s+public\.invoices\b/i, "no issued document is touched");
  assert.doesNotMatch(outsideFunctions, /\b(update|insert into|delete from)\s+public\.(?!invoice_settings\b)\w+/i, "the settings row is the only data written");
  assert.doesNotMatch(outsideFunctions, /next_invoice_number\s*=|payment_receipt_next_number\s*=/, "no counter is moved outside the issuing functions");
});

test("the settings guard is 0036's with only the GSTIN added to the columns that move updated_at", () => {
  const was = fn(M36, "create or replace function public.invoice_settings_guard()");
  const now = fn(M41, "create or replace function public.invoice_settings_guard()");
  assert.notEqual(now, was);
  assert.equal(now.replaceAll(", new.gstin", "").replaceAll(", old.gstin", ""), was);
});

test("issue_invoice_core is 0036's, and issue_payment_document_core is 0039's, each with ONE business_gstin line added", () => {
  const core36 = fn(M36, "create or replace function public.issue_invoice_core(");
  const core41 = fn(M41, "create or replace function public.issue_invoice_core(");
  assert.notEqual(core41, core36);
  assert.equal(core41.replace(" business_gstin,", "").replace(" v_settings.gstin,", ""), core36, "membership-level issue: numbering, tax, dates and locks identical");

  // The payment function copies the GSTIN onto a TAX INVOICE only; a payment receipt is stored with NULL.
  const COPIED_FOR_INVOICES_ONLY = " case when v_series = 'invoice' then v_settings.gstin end,";
  const pay39 = fn(M39, "create or replace function public.issue_payment_document_core(");
  const pay41 = fn(M41, "create or replace function public.issue_payment_document_core(");
  assert.notEqual(pay41, pay39);
  assert.equal(pay41.replace(" business_gstin,", "").replace(COPIED_FOR_INVOICES_ONLY, ""), pay39, "payment issue and replacement: numbering, tax, series and locks identical");

  // Both read the settings row they already hold locked - the snapshot is taken under the lock.
  for (const core of [core41, pay41]) {
    assert.match(core, /from public\.invoice_settings\s+where singleton\s+for update;/);
    assert.match(core, /business_logo_path, business_gstin,/);
    assert.equal((core.match(/gstin/g) ?? []).length, 2);
  }
  assert.match(core41, /v_logo_path, v_settings\.gstin,/);
  assert.match(pay41, /v_logo_path, case when v_series = 'invoice' then v_settings\.gstin end,/);
  // v_series is the payment document's series, fixed before the insert (a replacement keeps the series it replaces).
  assert.ok(pay41.indexOf("v_series := coalesce(p_series") < pay41.indexOf("insert into public.invoices ("));
  assert.match(pay41, /case when v_series = 'invoice' then 'invoice' else 'payment_receipt' end|case when v_series = 'invoice' then v_settings\.document_title else 'payment_receipt' end/);
});

test("the issuing functions stay closed to clients, and nothing else is re-created", () => {
  assert.match(C41, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
  assert.match(C41, /revoke execute on function public\.issue_payment_document_core\(uuid, date, text, uuid\) from public, anon, authenticated;/);
  assert.doesNotMatch(C41, /grant execute/);
  assert.deepEqual(
    [...C41.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]).sort(),
    ["invoice_settings_guard", "issue_invoice_core", "issue_payment_document_core"],
  );
  // Cancel and Reissue, payment recording and editing, the correction and the freeze trigger are not redefined.
  assert.doesNotMatch(C41, /correct_payment_document|record_membership_payment|edit_payment|invoices_freeze_snapshot|sync_invoice_from_membership/);
});

test("the freeze trigger already protects the new column: it compares every column of an issued document", () => {
  const freeze = fn(read("supabase/migrations/0037_invoice_corrections.sql"), "create or replace function public.invoices_freeze_snapshot()");
  assert.match(freeze, /\(to_jsonb\(new\) - v_exempt\) is distinct from \(to_jsonb\(old\) - v_exempt\)/);
  assert.doesNotMatch(freeze.slice(freeze.indexOf("v_exempt text[]"), freeze.indexOf("begin")), /gstin/, "business_gstin is not among the columns that may change");
});
