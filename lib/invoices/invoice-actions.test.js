// Run with `npm test` (Node's built-in test runner).
//
// V1 Invoice / Receipt — the application data/action layer (Phase 1): reading
// invoices, issuing one, editing its number/date, mapping database errors, and
// the guards that keep the database the sole authority for numbering and tax.
// The core takes an injected Supabase client, so a small fake stands in for it
// (as in lib/center-profile/center-settings.test.js); the server-only wrappers
// (data.js, actions.js) cannot be imported under node:test, so their Admin
// guard is pinned structurally (as in lib/auth/reset-password-wiring.test.js).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  INVOICE_COLUMNS,
  fetchInvoice,
  fetchInvoiceForMembership,
  issueInvoiceFor,
  mapInvoiceError,
  matchKnownInvoiceError,
  updateInvoiceDetailsFor,
} from "./invoice-core.js";
import { validateInvoiceDetailsInput, validateIssueInvoiceInput } from "./validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// Source with comments removed, so a pattern cannot match explanatory text.
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MEMBERSHIP_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";
const INVOICE = { id: INVOICE_ID, membership_id: MEMBERSHIP_ID, invoice_number: 1224, invoice_date: "2026-10-07" };

/** Runs `fn` with console.error silenced, returning what was logged. */
async function quietly(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

/** A Supabase stand-in: records every query and RPC, answers with what it is given. */
function fakeSupabase({ row = null, readError = null, rpcResult = { data: null, error: null } } = {}) {
  const calls = { queries: [], rpcs: [] };
  return {
    calls,
    from(table) {
      const query = { table, select: null, filters: [] };
      calls.queries.push(query);
      const builder = {
        select(columns) {
          query.select = columns;
          return builder;
        },
        eq(column, value) {
          query.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: readError ? null : row, error: readError }),
      };
      return builder;
    },
    rpc: async (name, args) => {
      calls.rpcs.push({ name, args });
      return rpcResult;
    },
  };
}

// ---- 1-3. reading ------------------------------------------------------------------------------

test("get the invoice for a membership: one explicit-column query on invoices by membership_id", async () => {
  const supabase = fakeSupabase({ row: INVOICE });
  const invoice = await fetchInvoiceForMembership(supabase, MEMBERSHIP_ID);

  assert.deepEqual(invoice, INVOICE);
  assert.equal(supabase.calls.queries.length, 1);
  const [query] = supabase.calls.queries;
  assert.equal(query.table, "invoices");
  assert.deepEqual(query.filters, [["membership_id", MEMBERSHIP_ID]]);
  assert.equal(query.select, INVOICE_COLUMNS);
  assert.notEqual(query.select, "*");
});

test("get the invoice for a membership that has none: null, not an error", async () => {
  assert.equal(await fetchInvoiceForMembership(fakeSupabase({ row: null }), MEMBERSHIP_ID), null);
});

test("get an invoice by its id", async () => {
  const supabase = fakeSupabase({ row: INVOICE });
  assert.deepEqual(await fetchInvoice(supabase, INVOICE_ID), INVOICE);
  assert.deepEqual(supabase.calls.queries[0].filters, [["id", INVOICE_ID]]);
  assert.equal(await fetchInvoice(fakeSupabase({ row: null }), INVOICE_ID), null);
});

test("a missing id reads nothing", async () => {
  const supabase = fakeSupabase({ row: INVOICE });
  assert.equal(await fetchInvoiceForMembership(supabase, ""), null);
  assert.equal(await fetchInvoice(supabase, undefined), null);
  assert.equal(supabase.calls.queries.length, 0);
});

test("a failed read throws a plain message and logs only the code and text", async () => {
  const supabase = fakeSupabase({ readError: { code: "XX000", message: "boom" } });
  const { logged } = await quietly(async () => {
    await assert.rejects(fetchInvoice(supabase, INVOICE_ID), /Could not load the invoice\./);
    await assert.rejects(fetchInvoiceForMembership(supabase, MEMBERSHIP_ID), /Could not load the invoice\./);
  });
  assert.equal(logged.length, 2);
});

test("the column list is exactly the approved invoice columns", () => {
  const columns = INVOICE_COLUMNS.split(", ");
  assert.equal(columns.length, 33);
  for (const excluded of ["status", "voided_at", "issued_by", "payment_method", "refund"]) {
    assert.ok(!columns.includes(excluded), excluded);
  }
});

// ---- 4-5. issuing ---------------------------------------------------------------------------------

test("Issue Invoice calls the issue_invoice function with the membership, and nothing else", async () => {
  const supabase = fakeSupabase({ rpcResult: { data: INVOICE_ID, error: null } });
  const result = await issueInvoiceFor(supabase, MEMBERSHIP_ID);

  assert.deepEqual(result, { success: true, invoiceId: INVOICE_ID });
  assert.deepEqual(supabase.calls.rpcs, [
    { name: "issue_invoice", args: { p_membership_id: MEMBERSHIP_ID, p_payment_date: null, p_invoice_date: null } },
  ]);
  assert.equal(supabase.calls.queries.length, 0, "no table is written or read directly");
});

test("an existing Paid membership is issued with the Admin's confirmed payment date (and an optional invoice date)", async () => {
  const supabase = fakeSupabase({ rpcResult: { data: INVOICE_ID, error: null } });
  const result = await issueInvoiceFor(supabase, MEMBERSHIP_ID, { paymentDate: "2026-10-01", invoiceDate: "2026-10-03" });

  assert.equal(result.success, true);
  assert.deepEqual(supabase.calls.rpcs[0].args, {
    p_membership_id: MEMBERSHIP_ID,
    p_payment_date: "2026-10-01",
    p_invoice_date: "2026-10-03",
  });
});

test("blank dates are 'not supplied': the database defaults them", async () => {
  const supabase = fakeSupabase({ rpcResult: { data: INVOICE_ID, error: null } });
  await issueInvoiceFor(supabase, MEMBERSHIP_ID, { paymentDate: " ", invoiceDate: "" });
  assert.deepEqual(supabase.calls.rpcs[0].args, { p_membership_id: MEMBERSHIP_ID, p_payment_date: null, p_invoice_date: null });
});

test("a malformed date is a field error and never reaches the database", async () => {
  const supabase = fakeSupabase();
  for (const bad of ["31/12/2026", "2026-02-30", "yesterday", "2026-1-1"]) {
    const result = await issueInvoiceFor(supabase, MEMBERSHIP_ID, { paymentDate: bad });
    assert.equal(result.error, "Check the highlighted fields.", bad);
    assert.equal(result.fieldErrors.payment_date, "Enter a valid payment date.", bad);
  }
  const invoiceDate = await issueInvoiceFor(supabase, MEMBERSHIP_ID, { invoiceDate: "nope" });
  assert.equal(invoiceDate.fieldErrors.invoice_date, "Enter a valid invoice date.");
  assert.equal(supabase.calls.rpcs.length, 0);
});

test("issuing without a membership does nothing", async () => {
  const supabase = fakeSupabase();
  const result = await issueInvoiceFor(supabase, "");
  assert.ok(result.error);
  assert.equal(supabase.calls.rpcs.length, 0);
});

// ---- 6. editing -------------------------------------------------------------------------------------

test("Update Invoice Details sends exactly the invoice, its number and its date", async () => {
  const supabase = fakeSupabase();
  const result = await updateInvoiceDetailsFor(supabase, INVOICE_ID, { invoiceNumber: "1230", invoiceDate: "2026-10-05" });

  assert.deepEqual(result, { success: true });
  assert.equal(supabase.calls.rpcs.length, 1);
  assert.equal(supabase.calls.rpcs[0].name, "update_invoice_details");
  assert.deepEqual(supabase.calls.rpcs[0].args, { p_invoice_id: INVOICE_ID, p_invoice_number: 1230, p_invoice_date: "2026-10-05" });
  assert.deepEqual(Object.keys(supabase.calls.rpcs[0].args).sort(), ["p_invoice_date", "p_invoice_id", "p_invoice_number"]);
  assert.equal(supabase.calls.queries.length, 0, "no direct table update");
});

test("extra fields passed to the edit are ignored, never forwarded", async () => {
  const supabase = fakeSupabase();
  await updateInvoiceDetailsFor(supabase, INVOICE_ID, {
    invoiceNumber: 1231,
    invoiceDate: "2026-10-05",
    total_amount: 1,
    customer_name: "X",
    tax_amount: 0,
    terms: "Y",
    business_name: "Z",
    signature_path: "p",
    payment_date: "2020-01-01",
  });
  assert.deepEqual(Object.keys(supabase.calls.rpcs[0].args).sort(), ["p_invoice_date", "p_invoice_id", "p_invoice_number"]);
});

test("invoice number input must be a positive whole number the database can hold", () => {
  const ok = validateInvoiceDetailsInput({ invoiceNumber: " 1224 ", invoiceDate: "2026-10-07" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.invoiceNumber, 1224);
  assert.equal(typeof ok.data.invoiceNumber, "number");

  for (const bad of ["", "0", "-5", "12.5", "12a", "RCT-1", "1e3", "1234567890123456"]) {
    const result = validateInvoiceDetailsInput({ invoiceNumber: bad, invoiceDate: "2026-10-07" });
    assert.equal(result.success, false, `"${bad}"`);
    assert.ok(result.errors.invoice_number, `"${bad}"`);
  }
  assert.equal(validateInvoiceDetailsInput({ invoiceNumber: 1224, invoiceDate: "" }).errors.invoice_date, "Invoice date is required.");
  assert.equal(validateInvoiceDetailsInput({ invoiceNumber: 1224, invoiceDate: "2026-13-01" }).errors.invoice_date, "Enter a valid invoice date.");
});

test("an invalid edit never reaches the database", async () => {
  const supabase = fakeSupabase();
  const result = await updateInvoiceDetailsFor(supabase, INVOICE_ID, { invoiceNumber: "abc", invoiceDate: "2026-10-05" });
  assert.equal(result.fieldErrors.invoice_number, "Enter the invoice number as a positive whole number.");
  assert.equal(supabase.calls.rpcs.length, 0);
  assert.ok((await updateInvoiceDetailsFor(supabase, "", { invoiceNumber: 1, invoiceDate: "2026-10-05" })).error);
});

test("issue-input validation returns normalised values", () => {
  assert.deepEqual(validateIssueInvoiceInput({}), { success: true, data: { paymentDate: null, invoiceDate: null } });
  assert.deepEqual(validateIssueInvoiceInput({ paymentDate: " 2026-10-01 " }).data, { paymentDate: "2026-10-01", invoiceDate: null });
});

// ---- 7. database errors -> application messages ------------------------------------------------------------

const MAPPED = [
  // [code, database message, expected message, expected field]
  ["42501", "Not authorized.", "You do not have permission to manage invoices.", undefined],
  ["P0002", "Membership not found.", "Membership not found.", undefined],
  ["P0002", "Invoice not found.", "Invoice not found.", undefined],
  ["22023", "Confirm the payment date to issue this invoice.", "Confirm the payment date to issue this invoice.", "payment_date"],
  ["22023", "The payment date cannot be in the future.", "The payment date cannot be in the future.", "payment_date"],
  ["22023", "This membership already has a payment date, which cannot be changed.", "This membership already has a payment date, which cannot be changed.", "payment_date"],
  ["22023", "The invoice date cannot be in the future.", "The invoice date cannot be in the future.", "invoice_date"],
  ["22023", "The invoice date cannot be before the payment date.", "The invoice date cannot be before the payment date.", "invoice_date"],
  ["22023", "The invoice number must be a positive whole number.", "Enter the invoice number as a positive whole number.", "invoice_number"],
  ["22023", "The invoice number cannot be below the starting invoice number (1224).", "The invoice number cannot be below the starting invoice number (1224).", "invoice_number"],
  ["23505", "That invoice number is already in use.", "That invoice number is already in use.", "invoice_number"],
  ["23505", "An invoice has already been issued for this membership.", "An invoice has already been issued for this membership.", undefined],
  ["55000", "Invoice numbering has not been configured.", "Invoice numbering has not been configured yet, so an invoice cannot be issued.", undefined],
  ["55000", "Only a Paid membership can be invoiced.", "Only a Paid membership can be invoiced.", undefined],
  ["55006", "The payment status cannot be changed after an invoice has been issued.", "The payment status cannot be changed after an invoice has been issued.", "payment_status"],
  ["55006", "The payment date cannot be changed after an invoice has been issued.", "The payment date cannot be changed after an invoice has been issued.", "payment_date"],
  ["55006", "An issued invoice can only change its number and date.", "An issued invoice can only change its number and date.", undefined],
];

test("every database error the invoice migrations raise maps to its own message (and field)", () => {
  for (const [code, message, expected, field] of MAPPED) {
    const result = mapInvoiceError({ code, message }, "fallback");
    assert.equal(result.error, expected, `${code} ${message}`);
    assert.equal(result.code, code);
    if (field) {
      assert.deepEqual(result.fieldErrors, { [field]: expected }, `${code} ${message}`);
    } else {
      assert.equal(result.fieldErrors, undefined, `${code} ${message}`);
    }
  }
});

test("the unique indexes themselves are recognised when two requests race", () => {
  const number = mapInvoiceError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "invoices_invoice_number_unique"',
    details: "Key (invoice_number)=(1224) already exists.",
  }, "fallback");
  assert.deepEqual(number.fieldErrors, { invoice_number: "That invoice number is already in use." });

  const membership = mapInvoiceError({
    code: "23505",
    message: 'duplicate key value violates unique constraint "invoices_membership_id_unique"',
  }, "fallback");
  assert.equal(membership.error, "An invoice has already been issued for this membership.");
});

test("a recognised code with a message we did not write gets a generic message, never the raw text", async () => {
  const { result, logged } = await quietly(async () => mapInvoiceError({ code: "22023", message: 'invalid input value for enum "secret_thing"' }, "fallback"));
  assert.equal(result.error, "Check the values you entered.");
  assert.doesNotMatch(result.error, /secret_thing|enum/);
  assert.equal(logged.length, 0, "a known code is expected, so it is not logged");
});

test("an unknown error is logged (code and message) and shown as the fallback only", async () => {
  const { result, logged } = await quietly(async () =>
    mapInvoiceError({ code: "XX000", message: 'relation "public.invoices" is on fire' }, "Could not issue the invoice. Try again.")
  );
  assert.equal(result.error, "Could not issue the invoice. Try again.");
  assert.doesNotMatch(result.error, /on fire|relation/);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /XX000/);

  const noCode = await quietly(async () => mapInvoiceError({ message: "network down" }, "fallback"));
  assert.equal(noCode.result.error, "fallback");
});

test("errors from the database functions reach the caller as mapped messages", async () => {
  const issue = await issueInvoiceFor(
    fakeSupabase({ rpcResult: { data: null, error: { code: "55000", message: "Invoice numbering has not been configured." } } }),
    MEMBERSHIP_ID
  );
  assert.equal(issue.error, "Invoice numbering has not been configured yet, so an invoice cannot be issued.");
  assert.equal(issue.success, undefined);

  const duplicate = await updateInvoiceDetailsFor(
    fakeSupabase({ rpcResult: { data: null, error: { code: "23505", message: "That invoice number is already in use." } } }),
    INVOICE_ID,
    { invoiceNumber: 1224, invoiceDate: "2026-10-05" }
  );
  assert.deepEqual(duplicate.fieldErrors, { invoice_number: "That invoice number is already in use." });

  const locked = await updateInvoiceDetailsFor(
    fakeSupabase({ rpcResult: { data: null, error: { code: "55006", message: "An issued invoice can only change its number and date." } } }),
    INVOICE_ID,
    { invoiceNumber: 1224, invoiceDate: "2026-10-05" }
  );
  assert.equal(locked.code, "55006");
});

test("matchKnownInvoiceError recognises only invoice rules, leaving every other error to its caller", () => {
  assert.equal(matchKnownInvoiceError({ code: "23P01", message: "conflicting key value violates exclusion constraint" }), null);
  assert.equal(matchKnownInvoiceError({ code: "42501", message: "permission denied for table memberships" }), null);
  assert.equal(matchKnownInvoiceError({ code: "XX000", message: "boom" }), null);
  assert.equal(matchKnownInvoiceError(null), null);
  assert.equal(matchKnownInvoiceError({ message: "no code" }), null);
  assert.ok(matchKnownInvoiceError({ code: "55006", message: "The payment status cannot be changed after an invoice has been issued." }));
});

// ---- 8. authorization ---------------------------------------------------------------------------------------

test("an Instructor is refused: the database's 42501 is surfaced as 'no permission'", async () => {
  const denied = { code: "42501", message: "Not authorized." };
  const issue = await issueInvoiceFor(fakeSupabase({ rpcResult: { data: null, error: denied } }), MEMBERSHIP_ID);
  const edit = await updateInvoiceDetailsFor(fakeSupabase({ rpcResult: { data: null, error: denied } }), INVOICE_ID, { invoiceNumber: 1224, invoiceDate: "2026-10-05" });
  for (const result of [issue, edit]) {
    assert.equal(result.error, "You do not have permission to manage invoices.");
    assert.equal(result.code, "42501");
  }
});

test("an Instructor reads no invoice: row level security returns nothing, which is 'none'", async () => {
  assert.equal(await fetchInvoiceForMembership(fakeSupabase({ row: null }), MEMBERSHIP_ID), null);
  assert.equal(await fetchInvoice(fakeSupabase({ row: null }), INVOICE_ID), null);
});

test("every invoice action and data function requires the Admin role before touching Supabase", () => {
  const actions = code("./actions.js");
  for (const name of ["issueInvoice", "updateInvoiceDetails"]) {
    const start = actions.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, name);
    const body = actions.slice(start, actions.indexOf("\n}\n", start));
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN)") > 0, `${name} guards`);
    assert.ok(body.indexOf("requireRole") < body.indexOf("createClient"), `${name} guards before the client`);
  }
  assert.match(actions, /^"use server";/);

  const data = code("./data.js");
  for (const name of ["getInvoiceForMembership", "getInvoice"]) {
    const start = data.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, name);
    const body = data.slice(start, data.indexOf("\n}\n", start));
    assert.ok(body.indexOf("await requireRole(ROLES.ADMIN)") > 0, `${name} guards`);
    assert.ok(body.indexOf("requireRole") < body.indexOf("createClient"), `${name} guards before the client`);
  }
  assert.match(data, /^import "server-only";/);
});

test("the wrappers use the request's session client — never the service-role client", () => {
  for (const path of ["./actions.js", "./data.js", "./invoice-core.js"]) {
    const text = code(path);
    assert.doesNotMatch(text, /supabase\/admin|createAdminClient|SECRET_KEY|service_role/, path);
  }
  assert.match(code("./actions.js"), /from "@\/lib\/supabase\/server"/);
});

// ---- 9. existing membership actions ------------------------------------------------------------------------------

test("the membership actions keep their existing behaviour: guard first, same writes, same overlap handling", () => {
  const actions = code("../memberships/actions.js");

  for (const name of ["createMembership", "updateMembership", "cancelMembership"]) {
    const start = actions.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, name);
    const afterSignature = actions.slice(start).replace(/^[^{]*\{/, "");
    assert.match(afterSignature.trimStart(), /^await requireRole\(ROLES\.ADMIN\);/, `${name} still guards first`);
  }

  // The two writes are untouched: the validated fields, plus the currency on create.
  assert.match(actions, /\.insert\(\{ \.\.\.result\.data, student_id: studentId, currency: await getCenterCurrency\(\) \}\)/);
  assert.match(actions, /\.update\(result\.data\)\s*\.eq\("id", id\)/);
  // The overlap handling still runs before anything else is considered.
  assert.ok(actions.indexOf("isOverlapError(error)") < actions.indexOf("invoiceRuleResult(error, formData)"));
  // The generic failure messages are still the fallback.
  assert.match(actions, /Could not save the membership\. Try again\./);
  assert.match(actions, /Could not update the membership\. Try again\./);
});

test("the membership actions add no invoice or payment-date rules of their own: the database owns them", () => {
  const actions = code("../memberships/actions.js");
  assert.doesNotMatch(actions, /payment_date|paymentDate/);
  assert.doesNotMatch(actions, /from\("invoices"\)/);
  assert.doesNotMatch(actions, /issue_invoice|update_invoice_details/);
  // The only new thing: show the database's own invoice-rule message on a refused save.
  assert.match(actions, /import \{ matchKnownInvoiceError \} from "@\/lib\/invoices\/invoice-core";/);
  assert.equal((actions.match(/= invoiceRuleResult\(error, formData\)/g) ?? []).length, 2);
});

test("membership validation is untouched: payment_date is not a form field", () => {
  const validation = code("../memberships/validation.js");
  assert.doesNotMatch(validation, /payment_date/);
  assert.match(validation, /export const PAYMENT_STATUSES = \["paid", "pending"\];/);
});

// ---- 10-11. the database stays the authority ----------------------------------------------------------------------

/** Every non-test source file in lib/invoices. */
function invoiceSources() {
  return readdirSync(new URL(".", import.meta.url))
    .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"))
    .map((file) => [file, code(`./${file}`)]);
}

test("no invoice-number calculation exists in JavaScript", () => {
  const sources = invoiceSources();
  assert.ok(sources.length >= 4);
  for (const [file, text] of sources) {
    assert.doesNotMatch(text, /next_invoice_number|nextInvoiceNumber|starting_invoice_number|startingInvoiceNumber/, file);
    assert.doesNotMatch(text, /invoiceNumber\s*[-+*]|invoice_number\s*[-+*]|[-+]\s*1\s*;?\s*\/\/.*invoice/i, file);
    assert.doesNotMatch(text, /Math\.max|Math\.min|\.reduce\(|\.sort\(/, file);
  }
  // The memberships actions do not number anything either.
  assert.doesNotMatch(code("../memberships/actions.js"), /invoice_number|invoiceNumber/);
});

test("no tax calculation is duplicated in JavaScript", () => {
  for (const [file, text] of invoiceSources()) {
    assert.doesNotMatch(text, /Math\.(round|floor|ceil|trunc)|\.toFixed\(|\(\s*100\s*\+/, file);
    assert.doesNotMatch(text, /tax_?rate\s*[*/]|[*/]\s*tax_?rate|taxRate/i, file);
    assert.doesNotMatch(text, /(taxable|tax)_?amount\s*=/i, file);
  }
});

test("the core only calls the two database functions and reads invoices — it never writes a table", () => {
  const core = code("./invoice-core.js");
  assert.deepEqual([...core.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort(), ["issue_invoice", "update_invoice_details"]);
  assert.deepEqual([...core.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ["invoices", "invoices"]);
  assert.doesNotMatch(core, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(core, /issue_invoice_core/, "the internal function is never called from the app");
});

test("the invoice layer is reached only from the Memberships screens (Phase 2), never from shared components or other areas", () => {
  const walk = (dir) =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]
    );
  for (const file of [...walk("../../app/"), ...walk("../../components/")].filter((f) => /\.(js|jsx)$/.test(f))) {
    if (file.startsWith("../../app/memberships/")) continue;
    assert.doesNotMatch(source(file), /lib\/invoices/, file);
  }
});
