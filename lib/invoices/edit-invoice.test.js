// Run with `npm test` (Node's built-in test runner).
//
// Phase 5.2 - Edit Invoice: the dialog that changes an issued invoice's number and date, and
// nothing else. Its logic (lib/invoices/edit-invoice.js) is tested directly, against the real
// `updateInvoiceDetailsFor` with a recording Supabase fake; the dialog component and the page are
// pinned from source - the project's way for code that needs the React and Next.js runtime.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { editInvoiceInitial, initialEditValues, prepareEditInput, submitInvoiceEdit } from "./edit-invoice.js";
import { updateInvoiceDetailsFor } from "./invoice-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const DIALOG = "../../app/memberships/[id]/invoice/edit-invoice.js";
const PAGE = "../../app/memberships/[id]/invoice/page.js";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";

/** A complete stored invoice - far more than the dialog is ever given. */
const STORED = {
  id: INVOICE_ID,
  membership_id: "11111111-1111-4111-8111-111111111111",
  invoice_number: 788,
  invoice_prefix: "INV-",
  invoice_date: "2026-10-07",
  payment_date: "2026-10-05",
  total_amount: 1180,
  tax_rate: 18,
  customer_name: "Asha Rao",
  business_name: "Sri Yoga Center",
  terms: "Fees are non-refundable.",
  bank_account_number: "50100123456789",
  signature_path: "signatures/sig.png",
};

/** A recording fake Supabase client whose `update_invoice_details` answers as given. */
function fakeSupabase(answer = { error: null }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return answer;
    },
  };
}

const realSave = (supabase) => (input) => updateInvoiceDetailsFor(supabase, INVOICE_ID, input);

async function quietly(run) {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

// ---- opening ------------------------------------------------------------------------------------------------------

test("the dialog opens with the invoice's current stored number and date — the number without its prefix", () => {
  const initial = editInvoiceInitial(STORED);
  assert.deepEqual(initialEditValues(initial), { invoiceNumber: "788", invoiceDate: "2026-10-07" });
});

test("the dialog is given only the id, number, date and prefix — never the rest of the invoice", () => {
  const initial = editInvoiceInitial(STORED);
  assert.deepEqual(Object.keys(initial).sort(), ["date", "id", "number", "prefix"]);
  assert.equal(initial.prefix, "INV-");
  const shipped = JSON.stringify(initial);
  for (const secret of ["50100123456789", "Asha", "Fees are", "signatures/", "Sri Yoga"]) assert.ok(!shipped.includes(secret), secret);
  assert.equal(editInvoiceInitial({ ...STORED, invoice_prefix: undefined }).prefix, null);
});

test("every open starts from the stored values again: Cancel discards what was typed", () => {
  const component = code(DIALOG);
  // Both opening and closing reset the fields, the field errors and the form error from `initial`.
  assert.match(
    component,
    /function handleOpenChange\(next\) \{\s*if \(isPending\) return;\s*[^}]*setValues\(initialEditValues\(initial\)\);\s*setFieldErrors\(\{\}\);\s*setFormError\(null\);\s*setOpen\(next\);/
  );
  assert.match(component, /onClick=\{\(\) => handleOpenChange\(true\)\}/);
  assert.match(component, /onOpenChange=\{handleOpenChange\}/);
  // Cancel is the dialog's own button -> onOpenChange(false); nothing in it saves.
  assert.doesNotMatch(component.match(/function handleOpenChange[\s\S]*?\n  \}/)[0], /updateInvoiceDetails|submitInvoiceEdit/);
});

// ---- validation ------------------------------------------------------------------------------------------------------------

test("only the shape is checked in the browser: a number is required and whole, a date is required and real", () => {
  for (const [values, field, message] of [
    [{ invoiceNumber: "", invoiceDate: "2026-10-07" }, "invoice_number", "Invoice number is required."],
    [{ invoiceNumber: "12a", invoiceDate: "2026-10-07" }, "invoice_number", "Enter the invoice number as a positive whole number."],
    [{ invoiceNumber: "0", invoiceDate: "2026-10-07" }, "invoice_number", "Enter the invoice number as a positive whole number."],
    [{ invoiceNumber: "-5", invoiceDate: "2026-10-07" }, "invoice_number", "Enter the invoice number as a positive whole number."],
    [{ invoiceNumber: "788", invoiceDate: "" }, "invoice_date", "Invoice date is required."],
    [{ invoiceNumber: "788", invoiceDate: "2026-02-30" }, "invoice_date", "Enter a valid invoice date."],
    [{ invoiceNumber: "788", invoiceDate: "not a date" }, "invoice_date", "Enter a valid invoice date."],
  ]) {
    assert.equal(prepareEditInput(values).errors?.[field], message, JSON.stringify(values));
  }
});

test("a valid edit is prepared as exactly the two allowed values", () => {
  assert.deepEqual(prepareEditInput({ invoiceNumber: " 800 ", invoiceDate: " 2026-10-08 ", prefix: "YC-", total_amount: 1, tax_rate: 99 }), {
    input: { invoiceNumber: "800", invoiceDate: "2026-10-08" },
  });
});

test("an invalid date or number is shown on its field and nothing is sent", async () => {
  const supabase = fakeSupabase();
  const badDate = await submitInvoiceEdit({ invoiceNumber: "800", invoiceDate: "2026-13-45" }, realSave(supabase));
  assert.equal(badDate.status, "invalid");
  assert.equal(badDate.fields.date, "Enter a valid invoice date.");
  assert.equal(badDate.fields.number, null);

  const badNumber = await submitInvoiceEdit({ invoiceNumber: "abc", invoiceDate: "2026-10-07" }, realSave(supabase));
  assert.equal(badNumber.status, "invalid");
  assert.match(badNumber.fields.number, /positive whole number/);
  assert.equal(supabase.calls.length, 0, "no request was made");
});

// ---- saving -------------------------------------------------------------------------------------------------------------------

test("Save calls update_invoice_details with the invoice id, the number and the date — nothing else", async () => {
  const supabase = fakeSupabase();
  const outcome = await submitInvoiceEdit({ invoiceNumber: "800", invoiceDate: "2026-10-08" }, realSave(supabase));

  assert.deepEqual(outcome, { status: "saved" });
  assert.deepEqual(supabase.calls, [
    { name: "update_invoice_details", args: { p_invoice_id: INVOICE_ID, p_invoice_number: 800, p_invoice_date: "2026-10-08" } },
  ]);
});

test("the dialog hands the action exactly {invoiceNumber, invoiceDate}, bound to the invoice id", async () => {
  const received = [];
  await submitInvoiceEdit({ invoiceNumber: "800", invoiceDate: "2026-10-08", extra: "x" }, async (input) => {
    received.push(input);
    return { success: true };
  });
  assert.deepEqual(received, [{ invoiceNumber: "800", invoiceDate: "2026-10-08" }]);
  assert.match(code(DIALOG), /submitInvoiceEdit\(values, \(input\) => updateInvoiceDetails\(initial\.id, input\)\)/);
});

test("saving an unchanged number and date is accepted (the database makes it a no-op)", async () => {
  const supabase = fakeSupabase();
  assert.deepEqual(await submitInvoiceEdit(initialEditValues(editInvoiceInitial(STORED)), realSave(supabase)), { status: "saved" });
});

test("after a save the dialog closes and the page is refreshed from the stored invoice, so the new values show at once", () => {
  const component = code(DIALOG);
  assert.match(component, /if \(outcome\.status === "saved"\) \{\s*setOpen\(false\);\s*router\.refresh\(\);\s*return;\s*\}/);
  assert.match(component, /const router = useRouter\(\);/);
  // The action revalidates the membership pages, and the Invoice Detail reads the invoice fresh on every request.
  assert.match(code("./actions.js"), /if \(invoice\) revalidateMembership\(invoice\.membership_id\);/);
  assert.match(code(PAGE), /const invoice = await getInvoiceForMembership\(id\);/);
  // The header's number and the document are built from that stored row.
  assert.match(code(PAGE), /buildInvoiceDocument\(invoice\)/);
});

test("the edit does not rebuild or write the snapshot: it goes through the one RPC and the page only re-reads", () => {
  const files = [DIALOG, "./edit-invoice.js"].map(code).join("\n");
  assert.doesNotMatch(files, /\.from\(|\.insert\(|\.update\(|issue_invoice|buildInvoiceDocument|issueInvoice/);
  assert.match(code("./invoice-core.js"), /rpc\("update_invoice_details"/);
});

// ---- the database's answers --------------------------------------------------------------------------------------------------

test("a duplicate invoice number is shown on the number field, in plain words", async () => {
  const supabase = fakeSupabase({ error: { code: "23505", message: "That invoice number is already in use." } });
  const outcome = await submitInvoiceEdit({ invoiceNumber: "787", invoiceDate: "2026-10-07" }, realSave(supabase));
  assert.equal(outcome.status, "error");
  assert.equal(outcome.fields.number, "That invoice number is already in use.");
  assert.equal(outcome.formError, null);
});

test("the unique index winning a race is the same message, not a database error", async () => {
  const supabase = fakeSupabase({ error: { code: "23505", message: 'duplicate key value violates unique constraint "invoices_invoice_number_unique"', details: "Key (invoice_number)=(787) already exists." } });
  const outcome = await submitInvoiceEdit({ invoiceNumber: "787", invoiceDate: "2026-10-07" }, realSave(supabase));
  assert.equal(outcome.fields.number, "That invoice number is already in use.");
  assert.ok(!JSON.stringify(outcome).includes("violates"));
  assert.ok(!JSON.stringify(outcome).includes("Key ("));
});

test("a number below the starting number is shown on the number field", async () => {
  const supabase = fakeSupabase({ error: { code: "22023", message: "The invoice number cannot be below the starting invoice number (790)." } });
  const outcome = await submitInvoiceEdit({ invoiceNumber: "5", invoiceDate: "2026-10-07" }, realSave(supabase));
  assert.equal(outcome.fields.number, "The invoice number cannot be below the starting invoice number (790).");
});

test("a future date, or one before the payment date, is shown on the date field", async () => {
  for (const message of ["The invoice date cannot be in the future.", "The invoice date cannot be before the payment date."]) {
    const supabase = fakeSupabase({ error: { code: "22023", message } });
    const outcome = await submitInvoiceEdit({ invoiceNumber: "788", invoiceDate: "2030-01-01" }, realSave(supabase));
    assert.equal(outcome.fields.date, message);
    assert.equal(outcome.fields.number, null);
  }
});

test("anything the app does not recognise is a generic message — never the database's own", async () => {
  await quietly(async () => {
    const raw = 'relation "public.invoices" does not exist (SQLSTATE 42P01) at /var/lib/postgres';
    const outcome = await submitInvoiceEdit({ invoiceNumber: "788", invoiceDate: "2026-10-07" }, realSave(fakeSupabase({ error: { code: "XX000", message: raw } })));
    assert.equal(outcome.status, "error");
    assert.equal(outcome.formError, "Could not update the invoice. Try again.");
    assert.ok(!JSON.stringify(outcome).includes("postgres") && !JSON.stringify(outcome).includes("42P01"));
  });
});

test("a refused or missing invoice is reported as a dialog error, not a field error", async () => {
  const denied = await submitInvoiceEdit({ invoiceNumber: "788", invoiceDate: "2026-10-07" }, realSave(fakeSupabase({ error: { code: "42501", message: "Not authorized." } })));
  assert.equal(denied.formError, "You do not have permission to manage invoices.");
  const missing = await submitInvoiceEdit({ invoiceNumber: "788", invoiceDate: "2026-10-07" }, realSave(fakeSupabase({ error: { code: "P0002", message: "Invoice not found." } })));
  assert.equal(missing.formError, "Invoice not found.");
  assert.deepEqual(missing.fields, { number: null, date: null });
});

test("the dialog shows field messages on their fields and the rest as an alert", () => {
  const component = code(DIALOG);
  assert.match(component, /setFieldErrors\(outcome\.fields \?\? \{\}\);\s*setFormError\(outcome\.formError \?\? null\);/);
  assert.match(component, /label="Invoice number" required error=\{fieldErrors\.number\}/);
  assert.match(component, /label="Invoice date" required error=\{fieldErrors\.date\}/);
  assert.match(component, /<p role="alert"[^>]*>\s*\{formError\}/);
});

// ---- double submission ---------------------------------------------------------------------------------------------------------

test("a second submit while saving is ignored, and the fields and buttons are disabled meanwhile", () => {
  const component = code(DIALOG);
  assert.match(component, /function save\(\) \{\s*if \(isPending\) return;/);
  assert.equal((component.match(/disabled=\{isPending\}/g) ?? []).length, 2, "both fields");
  assert.match(component, /isPending=\{isPending\}/, "the dialog disables Save and Cancel and shows the pending label");
  assert.match(component, /startTransition\(async \(\) => \{/);
  // The dialog cannot be dismissed mid-save.
  assert.match(component, /function handleOpenChange\(next\) \{\s*if \(isPending\) return;/);
  // The shared dialog disables both of its buttons while pending.
  const dialog = source("../../components/ui/confirm-dialog.jsx");
  assert.equal((dialog.match(/disabled=\{isPending\}/g) ?? []).length, 2);
});

// ---- the form: two fields, nothing more -------------------------------------------------------------------------------------

test("the form has the invoice number and the invoice date — and nothing else", () => {
  const component = code(DIALOG);
  assert.equal((component.match(/<FormField/g) ?? []).length, 2);
  assert.equal((component.match(/<Input/g) ?? []).length, 2);
  assert.doesNotMatch(component, /<Textarea|<Select|<Switch|type="file"|type="checkbox"/);
  assert.doesNotMatch(component, /prefix.*onChange|setField\("prefix"|amount|tax|terms|signature|bank|payment|business|logo|student|membership/i);
  // The prefix is shown as context only, never as a field.
  assert.match(component, /detail=\{initial\.prefix \? `Prefix \$\{initial\.prefix\} stays as issued` : null\}/);
});

test("the number field is numeric and the date field is a native date input", () => {
  const component = code(DIALOG);
  assert.match(component, /inputMode="numeric"/);
  assert.match(component, /type="date"/);
});

// ---- the shared dialog pattern ----------------------------------------------------------------------------------------------------

test("it uses the application's existing dialog, form field, input and button — with a title, labels and a context card", () => {
  const component = code(DIALOG);
  for (const imported of ["@/components/ui/confirm-dialog", "@/components/ui/form-field", "@/components/ui/input", "@/components/ui/button", "@/components/ui/context-card"]) {
    assert.ok(component.includes(`from "${imported}"`), imported);
  }
  assert.match(component, /title="Edit invoice"/);
  assert.match(component, /confirmLabel="Save Changes"/);
  assert.match(component, /context=\{\s*<ContextCard/);
  assert.match(component, /<Button type="button" variant="outline" onClick=\{\(\) => handleOpenChange\(true\)\}>\s*<Pencil[^>]*\/>\s*Edit\s*<\/Button>/);
});

test("on a narrow screen it is the shared dialog with stacked fields — no fixed widths, no sideways scroll", () => {
  const component = code(DIALOG);
  assert.match(component, /<div className="flex flex-col gap-4">/);
  assert.doesNotMatch(component, /\bw-\[|\bmin-w|\bwhitespace-nowrap|overflow-x|\bgrid-cols|\bw-\d+\b/);
  assert.doesNotMatch(component, /sm:|md:|lg:/, "no separate mobile design");
});

// ---- Admin only -------------------------------------------------------------------------------------------------------------------------

test("Edit is on the Invoice Detail page, which is Admin-only, and only there", () => {
  const page = code(PAGE);
  assert.match(page, /<EditInvoice\s+initial=\{editInvoiceInitial\(invoice\)\}\s+title=\{invoiceDocument\.title\}\s+number=\{invoiceDocument\.number\}\s*\/>/);
  assert.ok(page.indexOf("await requireRole(ROLES.ADMIN)") < page.indexOf("await getInvoiceForMembership("));
  assert.ok(page.indexOf("notFound()") < page.indexOf("<EditInvoice"), "no invoice, no Edit");

  const importers = (dir) =>
    readdirSync(new URL(dir, import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f))
      .filter((f) => source(`${dir}${f}`).includes("invoice/edit-invoice"))
      .map((f) => f.replaceAll("\\", "/"));
  assert.deepEqual(importers("../../app/"), ["memberships/[id]/invoice/page.js"]);
  assert.deepEqual(importers("../../components/"), []);
});

test("the action it calls requires the Admin role first; an Instructor can neither see nor call it", () => {
  assert.match(code("./actions.js"), /export async function updateInvoiceDetails\(invoiceId, input\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  // No Instructor-visible area refers to the invoice code at all.
  const dirs = ["../../app/attendance/", "../../app/attendance-history/", "../../app/schedule/", "../../app/batches/", "../../app/students/", "../../app/dashboard-class-row.js"];
  for (const dir of dirs) {
    const files = dir.endsWith(".js") ? [dir] : readdirSync(new URL(dir, import.meta.url), { recursive: true }).map((f) => `${dir}${String(f).replaceAll("\\", "/")}`).filter((f) => /\.js$/.test(f));
    for (const file of files) assert.doesNotMatch(source(file), /edit-invoice|updateInvoiceDetails/, file);
  }
});

// ---- nothing else moved ------------------------------------------------------------------------------------------------------------------

test("Print and Download PDF are exactly as they were, and sit with Edit in the header's actions", () => {
  const page = code(PAGE);
  assert.match(page, /<PrintInvoiceButton \/>\s*<Button\s+variant="outline"\s+render=\{<a href=\{`\/memberships\/\$\{id\}\/invoice\/pdf`\} \/>\}\s+nativeButton=\{false\}\s*>\s*<Download className="size-4" aria-hidden="true" \/>\s*Download PDF\s*<\/Button>\s*<EditInvoice/);
  assert.match(code("../../app/memberships/[id]/invoice/print-invoice-button.js"), /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(page, /<PageHeader\s+compact\s+className="print:hidden"/);
});

test("the document, the PDF and the invoice rules are untouched by the edit dialog", () => {
  for (const path of ["../../app/memberships/[id]/invoice/invoice-document.js", "./invoice-document.js", "./pdf/invoice-pdf.js", "./pdf/pdf-request.js", "./tax-split.js"]) {
    assert.doesNotMatch(code(path), /edit-invoice|EditInvoice|editInvoiceInitial|updateInvoiceDetails/, path);
  }
  // The rules stay the database's: the helper holds no uniqueness, starting-number or date-clock rule.
  const helper = code("./edit-invoice.js");
  assert.doesNotMatch(helper, /starting|unique|new Date\(|Date\.now|payment_date|future/i);
  assert.doesNotMatch(helper, /Math\.|toFixed|tax|amount/i);
});
