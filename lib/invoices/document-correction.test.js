// Run with `npm test` (Node's built-in test runner).
//
// Cancel Document and Correct & Reissue (migration 0055) - the application layer: the pure rules (the recalculated document,
// the validation of a correction, the reviewed-figures check, the RPC argument list), the core functions with a small fake
// Supabase client, the database-error mapping, and the structure of the server wrappers (which cannot be imported under node:test).
// The database stays the authority on the balance and every transaction; these tests pin that this layer asks it correctly.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUSINESS_FIELDS,
  CUSTOMER_FIELDS,
  buildCorrectionRpcArgs,
  checkReviewed,
  correctableFields,
  flattenCorrectionErrors,
  methodsAreUnchanged,
  previewCorrection,
  taxInclusivePaise,
  validateCorrectionInput,
} from "./document-correction.js";
import {
  cancelPaymentDocumentFor,
  correctAndReissuePaymentDocumentFor,
  evaluateCorrection,
  fetchCorrectionContext,
  mapInvoiceError,
} from "./invoice-core.js";
import { readCorrectionContext } from "./correction-context.js";
import { gstinCheckCharacter } from "../invoice-settings/gstin.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const GSTIN = `29ABCDE1234F1Z${gstinCheckCharacter("29ABCDE1234F1Z0")}`;

const DETAILS = Object.freeze({
  customer_name: "Asha Rao",
  customer_phone: "9876543210",
  customer_phone_country_code: "+91",
  customer_email: "asha@example.com",
  business_name: "Calm Yoga",
  business_address: "1 Main Road",
  business_phone: "",
  business_email: "",
  business_gstin: "",
});

// The approved example: the membership is payable 20000, its other payments are 12000, so 8000 is available.
const CTX = Object.freeze({
  series: "invoice",
  paymentDate: "2026-10-07",
  originalInvoiceDate: "2026-10-09",
  today: "2026-10-15",
  paymentAmountPaise: 500000,
  currentMethods: [{ method: "upi", amount: "5000.00", reference_id: null, notes: null }],
  availablePaise: 800000,
});

const valid = (extra = {}) => ({ reason: "Customer details were wrong", invoiceDate: "", details: { ...DETAILS }, methods: null, ...extra });
const row = (method, amount, extra = {}) => ({ method, amount, referenceId: "", notes: "", ...extra });

// ---- the recalculated document ------------------------------------------------------------------------------

test("tax is tax-inclusive, to the paisa, a half rounding up - the database's round(amount x rate / (100 + rate), 2)", () => {
  assert.deepEqual(taxInclusivePaise(500000, 1800), { taxPaise: 76271, taxablePaise: 423729 }); // 5000 -> 762.71
  assert.deepEqual(taxInclusivePaise(600000, 1800), { taxPaise: 91525, taxablePaise: 508475 }); // 6000 -> 915.25
  assert.deepEqual(taxInclusivePaise(800000, 1800), { taxPaise: 122034, taxablePaise: 677966 }); // 8000 -> 1220.34
  assert.deepEqual(taxInclusivePaise(118000, 1800), { taxPaise: 18000, taxablePaise: 100000 }); // 1180 -> 180.00
  assert.deepEqual(taxInclusivePaise(10000, 500), { taxPaise: 476, taxablePaise: 9524 }); // 100 at 5% -> 4.76
  // A half rounds UP: 1.05 at 5% is exactly 0.05; 0.21 at 5% is 0.01 (0.0100) - and 0.31 at 5% is 0.0147 -> 0.01, 0.32 -> 0.0152 -> 0.02.
  assert.equal(taxInclusivePaise(31, 500).taxPaise, 1);
  assert.equal(taxInclusivePaise(32, 500).taxPaise, 2);
  assert.deepEqual(taxInclusivePaise(0, 1800), { taxPaise: 0, taxablePaise: 0 });
});

test("the preview of a tax invoice carries tax at the CURRENT rate; a payment receipt and a tax-off setting carry none", () => {
  const membership = { amountPaise: 2000000, otherPaymentsPaise: 1200000 };
  const invoice = previewCorrection({ series: "invoice", totalPaise: 600000, tax: { enabled: true, rate: "18.00", name: "GST" }, membership });
  assert.equal(invoice.taxed, true);
  assert.equal(invoice.taxPaise, 91525);
  assert.equal(invoice.taxablePaise, 508475);
  assert.equal(invoice.taxName, "GST");

  const receipt = previewCorrection({ series: "payment_receipt", totalPaise: 600000, tax: { enabled: true, rate: "18.00" }, membership });
  assert.equal(receipt.taxed, false);
  assert.equal(receipt.taxPaise, null);
  assert.equal(receipt.taxablePaise, null);

  const off = previewCorrection({ series: "invoice", totalPaise: 600000, tax: { enabled: false, rate: "18.00" }, membership });
  assert.equal(off.taxed, false);
  assert.equal(off.taxPaise, null);
});

test("the preview recalculates the membership status and balance from its OTHER payments: 6000 stays partially paid, exactly 8000 settles it", () => {
  const base = { series: "invoice", tax: { enabled: true, rate: "18.00" }, membership: { amountPaise: 2000000, otherPaymentsPaise: 1200000 } };
  const six = previewCorrection({ ...base, totalPaise: 600000 });
  assert.deepEqual(six.membership, { payablePaise: 2000000, paidPaise: 1800000, balancePaise: 200000, paymentStatus: "partially_paid" });

  const eight = previewCorrection({ ...base, totalPaise: 800000 });
  assert.deepEqual(eight.membership, { payablePaise: 2000000, paidPaise: 2000000, balancePaise: 0, paymentStatus: "paid" });
});

// ---- validation -----------------------------------------------------------------------------------------------

test("a details-only correction is valid: every correctable detail is sent, the date and the payment are untouched", () => {
  const result = validateCorrectionInput(valid(), CTX);
  assert.equal(result.success, true);
  assert.equal(result.data.reason, "Customer details were wrong");
  assert.equal(result.data.invoiceDate, null);
  assert.equal(result.data.methods, null);
  assert.equal(result.data.totalPaise, 500000);
  // Every correctable detail travels - blank optional ones as "" (the database turns it into NULL), never omitted.
  assert.deepEqual(Object.keys(result.data.overrides).sort(), correctableFields("invoice").sort());
  assert.equal(result.data.overrides.business_phone, "");
  assert.equal(result.data.overrides.business_gstin, "");
  assert.equal(result.data.overrides.customer_name, "Asha Rao");
});

test("the correctable details are exactly the approved whitelist; a GSTIN belongs to a tax invoice only", () => {
  assert.deepEqual([...CUSTOMER_FIELDS], ["customer_name", "customer_phone", "customer_phone_country_code", "customer_email"]);
  assert.deepEqual([...BUSINESS_FIELDS], ["business_name", "business_address", "business_phone", "business_email"]);
  assert.equal(correctableFields("invoice").length, 9);
  assert.ok(correctableFields("invoice").includes("business_gstin"));
  assert.equal(correctableFields("payment_receipt").length, 8);
  assert.ok(!correctableFields("payment_receipt").includes("business_gstin"));

  // Anything else the form (or a caller) sends is never forwarded: no customer code, no tax, no amount, no payment date.
  const result = validateCorrectionInput(valid({ details: { ...DETAILS, customer_code: "X", tax_rate: "99", total_amount: "1", payment_date: "2020-01-01" } }), CTX);
  assert.equal(result.success, true);
  assert.ok(!("customer_code" in result.data.overrides) && !("tax_rate" in result.data.overrides));
  assert.ok(!("total_amount" in result.data.overrides) && !("payment_date" in result.data.overrides));

  const receipt = validateCorrectionInput(valid({ details: { ...DETAILS, business_gstin: GSTIN } }), { ...CTX, series: "payment_receipt" });
  assert.equal(receipt.success, true);
  assert.ok(!("business_gstin" in receipt.data.overrides), "a GSTIN is silently left off a payment receipt");
});

test("the reason is required, trimmed and at most 500 characters", () => {
  assert.equal(validateCorrectionInput(valid({ reason: "   " }), CTX).errors.reason, "Enter the reason for the correction.");
  assert.equal(validateCorrectionInput(valid({ reason: undefined }), CTX).errors.reason, "Enter the reason for the correction.");
  assert.equal(validateCorrectionInput(valid({ reason: "x".repeat(501) }), CTX).errors.reason, "The reason can have at most 500 characters.");
  const ok = validateCorrectionInput(valid({ reason: `  ${"x".repeat(500)}  ` }), CTX);
  assert.equal(ok.success, true);
  assert.equal(ok.data.reason.length, 500);
});

test("the invoice date keeps the original unless another VALID date is chosen: not before the payment date, not in the future", () => {
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "" }), CTX).data.invoiceDate, null);
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "2026-10-09" }), CTX).data.invoiceDate, null, "the same date is not a change");
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "2026-10-12" }), CTX).data.invoiceDate, "2026-10-12");
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "2026-10-07" }), CTX).data.invoiceDate, "2026-10-07", "the payment date itself is allowed");
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "2026-10-06" }), CTX).errors.invoice_date, "The invoice date cannot be before the payment date.");
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "2026-10-16" }), CTX).errors.invoice_date, "The invoice date cannot be in the future.");
  assert.equal(validateCorrectionInput(valid({ invoiceDate: "15/10/2026" }), CTX).errors.invoice_date, "Enter a valid invoice date.");
});

test("the names are required, each detail has a length limit, and a GSTIN must be valid (or blank)", () => {
  const blank = validateCorrectionInput(valid({ details: { ...DETAILS, customer_name: " ", business_name: "" } }), CTX);
  assert.equal(blank.errors.details.customer_name, "Enter the customer name.");
  assert.equal(blank.errors.details.business_name, "Enter the business name.");

  const long = validateCorrectionInput(valid({ details: { ...DETAILS, business_address: "x".repeat(501) } }), CTX);
  assert.match(long.errors.details.business_address, /at most 500 characters/);

  const bad = validateCorrectionInput(valid({ details: { ...DETAILS, business_gstin: "BADGSTIN" } }), CTX);
  assert.match(bad.errors.details.business_gstin, /valid 15-character GSTIN/);

  const good = validateCorrectionInput(valid({ details: { ...DETAILS, business_gstin: ` ${GSTIN.toLowerCase()} ` } }), CTX);
  assert.equal(good.success, true);
  assert.equal(good.data.overrides.business_gstin, GSTIN, "normalised to upper case");
});

test("payment methods: unchanged sends none; a change is validated like recording a payment (type, amount, reference, notes)", () => {
  const same = validateCorrectionInput(valid({ methods: [row("upi", "5000")] }), CTX);
  assert.equal(same.success, true);
  assert.equal(same.data.methods, null, "the same payment is not resent");
  assert.equal(same.data.totalPaise, 500000);

  const split = validateCorrectionInput(
    valid({ methods: [row("cash", "2500", { notes: " Counter " }), row("upi", "4500", { referenceId: " REF-1 " })] }),
    CTX,
  );
  assert.equal(split.success, true);
  assert.equal(split.data.totalPaise, 700000);
  assert.deepEqual(split.data.methods, [
    { method: "cash", amount: "2500.00", reference_id: null, notes: "Counter" },
    { method: "upi", amount: "4500.00", reference_id: "REF-1", notes: null },
  ]);

  // A removed method, an added one and an edited amount are all changes.
  assert.equal(validateCorrectionInput(valid({ methods: [row("upi", "5000", { referenceId: "NEW" })] }), CTX).data.methods.length, 1);
  assert.equal(methodsAreUnchanged(CTX.currentMethods, [{ method: "upi", amount: "5000.00", reference_id: null, notes: null }]), true);
  assert.equal(methodsAreUnchanged(CTX.currentMethods, [{ method: "cash", amount: "5000.00", reference_id: null, notes: null }]), false);
});

test("the approved balance boundaries: 6000 and exactly 8000 are accepted; 8000.01, 8500 and a split adding to 8500 are refused", () => {
  assert.equal(validateCorrectionInput(valid({ methods: [row("upi", "6000")] }), CTX).success, true);
  const exact = validateCorrectionInput(valid({ methods: [row("upi", "8000")] }), CTX);
  assert.equal(exact.success, true, "a payment that settles the balance exactly is allowed");
  assert.equal(exact.data.totalPaise, 800000);

  for (const methods of [[row("upi", "8000.01")], [row("upi", "8500")], [row("upi", "4000"), row("cash", "4500")]]) {
    const result = validateCorrectionInput(valid({ methods }), CTX);
    assert.equal(result.success, false);
    assert.equal(result.errors.methods, "The payment cannot be more than the outstanding balance.");
  }
});

test("invalid methods are refused: zero, negative, three decimals, no method, an unknown type, an over-long reference or notes", () => {
  const amountMessage = "Enter an amount greater than zero, with at most two decimals.";
  for (const amount of ["0", "-1", "100.005", "", "abc"]) {
    const result = validateCorrectionInput(valid({ methods: [row("upi", amount)] }), CTX);
    assert.equal(result.success, false, amount);
    assert.equal(result.errors.rows[0].amount, amountMessage, amount);
  }
  assert.equal(validateCorrectionInput(valid({ methods: [] }), CTX).errors.methods, "Add at least one payment method.");
  assert.equal(validateCorrectionInput(valid({ methods: [row("cheque", "100")] }), CTX).errors.rows[0].method, "Select a payment method.");
  assert.match(validateCorrectionInput(valid({ methods: [row("upi", "100", { referenceId: "x".repeat(101) })] }), CTX).errors.rows[0].referenceId, /at most 100/);
  assert.match(validateCorrectionInput(valid({ methods: [row("upi", "100", { notes: "x".repeat(501) })] }), CTX).errors.rows[0].notes, /at most 500/);
});

test("errors from every part are collected together and flattened for the form", () => {
  const result = validateCorrectionInput(
    valid({ reason: "", invoiceDate: "2026-10-16", details: { ...DETAILS, customer_name: "" }, methods: [row("upi", "9000")] }),
    CTX,
  );
  assert.equal(result.success, false);
  assert.deepEqual(flattenCorrectionErrors(result.errors), {
    reason: "Enter the reason for the correction.",
    invoice_date: "The invoice date cannot be in the future.",
    methods: "The payment cannot be more than the outstanding balance.",
    customer_name: "Enter the customer name.",
  });
});

test("the payment date is never an input: a correction cannot carry one", () => {
  const result = validateCorrectionInput(valid({ paymentDate: "2020-01-01", methods: [row("upi", "6000")] }), CTX);
  assert.equal(result.success, true);
  assert.ok(!("paymentDate" in result.data) && !("payment_date" in result.data));
  assert.ok(!("p_payment_date" in buildCorrectionRpcArgs("doc-1", result.data, { expectedTotal: "6000.00", expectedTax: null })));
});

// ---- the reviewed figures and the RPC argument list ----------------------------------------------------------------

const PREVIEW_6000 = previewCorrection({
  series: "invoice",
  totalPaise: 600000,
  tax: { enabled: true, rate: "18.00" },
  membership: { amountPaise: 2000000, otherPaymentsPaise: 1200000 },
});

test("the reviewed total and tax must be the ones the same rules produce now", () => {
  assert.deepEqual(checkReviewed(PREVIEW_6000, { total: "6000.00", tax: "915.25" }), { ok: true, expectedTotal: "6000.00", expectedTax: "915.25" });
  assert.deepEqual(checkReviewed(PREVIEW_6000, { total: 6000, tax: 915.25 }), { ok: true, expectedTotal: "6000.00", expectedTax: "915.25" });
  assert.match(checkReviewed(PREVIEW_6000, {}).error, /Review the corrected document before confirming/);
  assert.match(checkReviewed(PREVIEW_6000, { total: "6000.01", tax: "915.25" }).error, /changed since you reviewed it/);
  assert.match(checkReviewed(PREVIEW_6000, { total: "6000.00", tax: "915.26" }).error, /changed since you reviewed it/);
  assert.match(checkReviewed(PREVIEW_6000, { total: "6000.00", tax: null }).error, /changed since you reviewed it/);

  const receipt = previewCorrection({ series: "payment_receipt", totalPaise: 600000, tax: { enabled: true, rate: "18" }, membership: { amountPaise: 2000000, otherPaymentsPaise: 0 } });
  assert.deepEqual(checkReviewed(receipt, { total: "6000.00", tax: null }), { ok: true, expectedTotal: "6000.00", expectedTax: null });
  assert.match(checkReviewed(receipt, { total: "6000.00", tax: "915.25" }).error, /changed since you reviewed it/);
});

/** The parameters of public.correct_and_reissue_payment_document as migration 0055 declares them: [name, type, hasDefault]. */
function migrationSignature(name) {
  const text = source("../../supabase/migrations/0055_payment_document_cancel_and_correction.sql").replace(/\r\n/g, "\n");
  const match = text.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns (\\w+)`));
  assert.ok(match, `${name} is declared`);
  const parameters = match[1]
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .map((part) => {
      const [parameter, type, ...rest] = part.split(" ");
      return [parameter, type, rest.join(" ") === "default null"];
    });
  return { parameters, returns: match[2] };
}

test("the RPC arguments match the 0055 signature - names, order, types and which ones are optional", () => {
  const signature = migrationSignature("correct_and_reissue_payment_document");
  assert.deepEqual(signature, {
    parameters: [
      ["p_document_id", "uuid", false],
      ["p_reason", "text", false],
      ["p_invoice_date", "date", true],
      ["p_methods", "jsonb", true],
      ["p_overrides", "jsonb", true],
      ["p_expected_total", "numeric", true],
      ["p_expected_tax", "numeric", true],
    ],
    returns: "uuid",
  });

  const cancel = migrationSignature("cancel_payment_document");
  assert.deepEqual(cancel, { parameters: [["p_document_id", "uuid", false], ["p_reason", "text", false]], returns: "uuid" });

  // With every optional value given, the keys are exactly the signature's, in its order.
  const full = buildCorrectionRpcArgs(
    "doc-1",
    { reason: "Fix", invoiceDate: "2026-10-12", overrides: { customer_name: "A" }, methods: [{ method: "upi", amount: "6000.00", reference_id: null, notes: null }] },
    { expectedTotal: "6000.00", expectedTax: "915.25" },
  );
  assert.deepEqual(Object.keys(full), signature.parameters.map(([name]) => name));
  assert.deepEqual(full, {
    p_document_id: "doc-1",
    p_reason: "Fix",
    p_invoice_date: "2026-10-12",
    p_methods: [{ method: "upi", amount: "6000.00", reference_id: null, notes: null }],
    p_overrides: { customer_name: "A" },
    p_expected_total: "6000.00",
    p_expected_tax: "915.25",
  });

  // Whatever is sent is a parameter of the function: nothing outside the signature, ever.
  const names = new Set(signature.parameters.map(([name]) => name));
  for (const args of [full, buildCorrectionRpcArgs("d", { reason: "r", invoiceDate: null, overrides: {}, methods: null }, { expectedTotal: "1.00", expectedTax: null })]) {
    for (const key of Object.keys(args)) assert.ok(names.has(key), key);
  }
});

test("a null optional argument is OMITTED, never sent: not a null invoice date, payment methods, overrides or tax", () => {
  const args = buildCorrectionRpcArgs("doc-1", { reason: "Fix", invoiceDate: null, overrides: { customer_name: "A" }, methods: null }, { expectedTotal: "5000.00", expectedTax: null });
  assert.deepEqual(args, { p_document_id: "doc-1", p_reason: "Fix", p_overrides: { customer_name: "A" }, p_expected_total: "5000.00" });
  for (const key of ["p_invoice_date", "p_methods", "p_expected_tax"]) assert.ok(!(key in args), key);
  assert.ok(!Object.values(args).some((value) => value === null), "no JSON null is ever sent");

  // The required three are always present, and the omitted ones really are the migration's optional ones.
  const optional = migrationSignature("correct_and_reissue_payment_document").parameters.filter(([, , hasDefault]) => hasDefault).map(([name]) => name);
  for (const key of ["p_invoice_date", "p_methods", "p_expected_tax"]) assert.ok(optional.includes(key), key);
  for (const key of ["p_document_id", "p_reason"]) assert.ok(!optional.includes(key), key);
});

// ---- the core functions with a fake client -------------------------------------------------------------------------------

const DOCUMENT = {
  id: "doc-1",
  membership_id: "mem-1",
  payment_id: "pay-1",
  status: "issued",
  document_series: "invoice",
  invoice_date: "2026-10-09",
  invoice_number: 837,
  total_amount: "5000.00",
};

function fakeSupabase({ invoice = DOCUMENT, payment, membership, payments, settings, rpcResult = { data: "new-doc", error: null } } = {}) {
  const calls = [];
  const data = {
    invoices: invoice,
    membership_payments: payment === undefined
      ? {
          id: "pay-1",
          membership_id: "mem-1",
          payment_date: "2026-10-07",
          amount: "5000.00",
          issue_tax_invoice: true,
          membership_payment_methods: [{ position: 1, method: "upi", amount: "5000.00", reference_id: null, notes: null }],
        }
      : payment,
    memberships: membership === undefined ? { id: "mem-1", amount: "20000.00", payment_status: "partially_paid", currency: "INR" } : membership,
    invoice_settings: settings === undefined ? { tax_enabled: true, tax_name: "GST", tax_rate: "18.00" } : settings,
  };
  const list = payments ?? [{ id: "pay-0", amount: "12000.00" }, { id: "pay-1", amount: "5000.00" }];
  return {
    calls,
    from(table) {
      const query = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (column, value) => (query.filters.push([column, value]), chain),
        order: () => chain,
        maybeSingle: () => (calls.push({ read: table, filters: query.filters }), Promise.resolve({ data: data[table] ?? null, error: null })),
        then: (resolve, reject) => Promise.resolve({ data: table === "membership_payments" ? list : [], error: null }).then(resolve, reject),
      };
      return chain;
    },
    rpc(name, args) {
      calls.push({ rpc: name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

const rpcCalls = (supabase) => supabase.calls.filter((call) => call.rpc);

const REQUEST = (input, overrides = {}) => ({ membershipId: "mem-1", documentId: "doc-1", today: "2026-10-15", input, ...overrides });

test("Cancel Document sends the document and the trimmed reason, and refuses an empty or over-long reason before calling", async () => {
  const supabase = fakeSupabase();
  assert.deepEqual(await cancelPaymentDocumentFor(supabase, "doc-1", "  Issued in error  "), { success: true, documentId: "new-doc" });
  assert.deepEqual(rpcCalls(supabase), [{ rpc: "cancel_payment_document", args: { p_document_id: "doc-1", p_reason: "Issued in error" } }]);

  const empty = fakeSupabase();
  const refused = await cancelPaymentDocumentFor(empty, "doc-1", "   ");
  assert.equal(refused.error, "Enter the reason for the cancellation.");
  assert.equal(refused.fieldErrors.reason, "Enter the reason for the cancellation.");
  assert.equal((await cancelPaymentDocumentFor(empty, "doc-1", "x".repeat(501))).fieldErrors.reason, "The reason can have at most 500 characters.");
  assert.match((await cancelPaymentDocumentFor(empty, "", "reason")).error, /Could not cancel the document/);
  assert.equal(rpcCalls(empty).length, 0);
});

test("Cancel Document maps the database's refusals", async () => {
  const twice = await cancelPaymentDocumentFor(
    fakeSupabase({ rpcResult: { data: null, error: { code: "55006", message: "This document has already been cancelled." } } }), "doc-1", "again");
  assert.equal(twice.code, "55006");
  assert.match(twice.error, /already been cancelled/);

  const level = await cancelPaymentDocumentFor(
    fakeSupabase({ rpcResult: { data: null, error: { code: "55000", message: "Only a payment document can be cancelled." } } }), "doc-1", "x");
  assert.equal(level.error, "Only a payment document can be cancelled.");

  const denied = await cancelPaymentDocumentFor(fakeSupabase({ rpcResult: { data: null, error: { code: "42501", message: "Not authorized." } } }), "doc-1", "x");
  assert.equal(denied.error, "You do not have permission to manage invoices.");
});

test("the correction context carries the balance the corrected payment may use: the membership amount less its OTHER payments", async () => {
  const context = await fetchCorrectionContext(fakeSupabase(), "mem-1", "doc-1");
  assert.equal(context.membershipAmountPaise, 2000000);
  assert.equal(context.otherPaymentsPaise, 1200000, "this payment's own 5000 is not counted");
  assert.equal(context.availablePaise, 800000);
  assert.equal(context.paymentAmountPaise, 500000);
  assert.equal(context.payment.payment_date, "2026-10-07");
  assert.deepEqual(context.payment.methods.map((m) => m.method), ["upi"]);
  assert.equal(context.settings.tax_rate, "18.00");

  assert.equal(await fetchCorrectionContext(fakeSupabase({ invoice: null }), "mem-1", "doc-1"), null);
  assert.equal(await fetchCorrectionContext(fakeSupabase({ invoice: { ...DOCUMENT, membership_id: "other" } }), "mem-1", "doc-1"), null);
  assert.equal(await fetchCorrectionContext(fakeSupabase({ invoice: { ...DOCUMENT, payment_id: null } }), "mem-1", "doc-1"), null, "a membership-level receipt");
});

test("the context reader takes the loaded document and never imports the invoice core (no circular import)", async () => {
  const reader = code("./correction-context.js");
  assert.doesNotMatch(reader, /import[^;]*invoice-core/);
  assert.doesNotMatch(reader, /fetchInvoice/);
  assert.match(code("./invoice-core.js"), /export async function fetchCorrectionContext\(supabase, membershipId, documentId\) \{\s+return readCorrectionContext\(supabase, membershipId, await fetchInvoice\(supabase, documentId\)\);/);

  const supabase = fakeSupabase();
  const context = await readCorrectionContext(supabase, "mem-1", DOCUMENT);
  assert.equal(context.availablePaise, 800000);
  assert.equal(context.document, DOCUMENT);
  assert.equal(await readCorrectionContext(supabase, "mem-1", null), null);
  assert.equal(await readCorrectionContext(supabase, "mem-2", DOCUMENT), null);
  assert.equal(await readCorrectionContext(supabase, "mem-1", { ...DOCUMENT, payment_id: null }), null);
  // It reads payments, the membership and the tax terms; it never re-reads the invoice (the caller loaded it).
  assert.ok(!supabase.calls.some((call) => call.read === "invoices"));
});

test("evaluateCorrection recalculates from the context: the amount, the tax at the CURRENT rate and the membership balance", async () => {
  const context = await fetchCorrectionContext(fakeSupabase(), "mem-1", "doc-1");
  const six = evaluateCorrection(context, valid({ methods: [row("upi", "6000")] }), "2026-10-15");
  assert.equal(six.success, true);
  assert.equal(six.preview.totalPaise, 600000);
  assert.equal(six.preview.taxPaise, 91525);
  assert.deepEqual(six.preview.membership, { payablePaise: 2000000, paidPaise: 1800000, balancePaise: 200000, paymentStatus: "partially_paid" });

  const eight = evaluateCorrection(context, valid({ methods: [row("upi", "8000")] }), "2026-10-15");
  assert.equal(eight.preview.membership.paymentStatus, "paid");

  const over = evaluateCorrection(context, valid({ methods: [row("upi", "8500")] }), "2026-10-15");
  assert.equal(over.error, "Check the highlighted fields.");
  assert.equal(over.fieldErrors.methods, "The payment cannot be more than the outstanding balance.");
});

test("Correct & Reissue (details only) calls the 0055 RPC with every argument: no payment change, the reviewed total and tax", async () => {
  const supabase = fakeSupabase();
  const result = await correctAndReissuePaymentDocumentFor(
    supabase,
    REQUEST({ ...valid({ invoiceDate: "2026-10-12", details: { ...DETAILS, business_gstin: GSTIN } }), expectedTotal: "5000.00", expectedTax: "762.71" }),
  );
  assert.deepEqual(result, { success: true, invoiceId: "new-doc" });
  const calls = rpcCalls(supabase);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rpc, "correct_and_reissue_payment_document");
  // No payment change: p_methods is not sent at all (a null optional argument is omitted).
  assert.deepEqual(Object.keys(calls[0].args), ["p_document_id", "p_reason", "p_invoice_date", "p_overrides", "p_expected_total", "p_expected_tax"]);
  assert.equal(calls[0].args.p_document_id, "doc-1");
  assert.equal(calls[0].args.p_reason, "Customer details were wrong");
  assert.equal(calls[0].args.p_invoice_date, "2026-10-12");
  assert.ok(!("p_methods" in calls[0].args));
  assert.equal(calls[0].args.p_expected_total, "5000.00");
  assert.equal(calls[0].args.p_expected_tax, "762.71");
  assert.equal(calls[0].args.p_overrides.business_gstin, GSTIN);
  assert.equal(calls[0].args.p_overrides.customer_name, "Asha Rao");
});

test("Correct & Reissue with a payment change sends the new methods and the recalculated reviewed figures (6000: tax 915.25)", async () => {
  const supabase = fakeSupabase();
  const result = await correctAndReissuePaymentDocumentFor(
    supabase,
    REQUEST({ ...valid({ methods: [row("cash", "2000"), row("upi", "4000", { referenceId: "REF-9" })] }), expectedTotal: "6000.00", expectedTax: "915.25" }),
  );
  assert.equal(result.success, true);
  const [call] = rpcCalls(supabase);
  assert.deepEqual(call.args.p_methods, [
    { method: "cash", amount: "2000.00", reference_id: null, notes: null },
    { method: "upi", amount: "4000.00", reference_id: "REF-9", notes: null },
  ]);
  assert.equal(call.args.p_expected_total, "6000.00");
  assert.equal(call.args.p_expected_tax, "915.25");
});

test("a payment receipt is corrected with no tax and no GSTIN", async () => {
  const supabase = fakeSupabase({ invoice: { ...DOCUMENT, document_series: "payment_receipt" } });
  const result = await correctAndReissuePaymentDocumentFor(
    supabase,
    REQUEST({ ...valid({ details: { ...DETAILS, business_gstin: GSTIN } }), expectedTotal: "5000.00", expectedTax: "" }),
  );
  assert.equal(result.success, true);
  const [call] = rpcCalls(supabase);
  assert.ok(!("p_expected_tax" in call.args), "a payment receipt has no tax to review");
  assert.ok(!("p_invoice_date" in call.args), "no new date: the original's is kept");
  assert.ok(!("business_gstin" in call.args.p_overrides));
});

test("nothing is sent to the database when validation fails, the figures were not reviewed, or they no longer match", async () => {
  const over = fakeSupabase();
  const refused = await correctAndReissuePaymentDocumentFor(over, REQUEST({ ...valid({ methods: [row("upi", "8000.01")] }), expectedTotal: "8000.01", expectedTax: "1220.34" }));
  assert.equal(refused.fieldErrors.methods, "The payment cannot be more than the outstanding balance.");

  const unreviewed = await correctAndReissuePaymentDocumentFor(over, REQUEST(valid()));
  assert.match(unreviewed.error, /Review the corrected document before confirming/);

  const stale = await correctAndReissuePaymentDocumentFor(over, REQUEST({ ...valid(), expectedTotal: "5000.00", expectedTax: "1.00" }));
  assert.match(stale.error, /changed since you reviewed it/);

  const noReason = await correctAndReissuePaymentDocumentFor(over, REQUEST({ ...valid({ reason: "" }), expectedTotal: "5000.00", expectedTax: "762.71" }));
  assert.equal(noReason.fieldErrors.reason, "Enter the reason for the correction.");

  assert.equal(rpcCalls(over).length, 0);
});

test("a missing, foreign or already cancelled document is refused before the RPC", async () => {
  const gone = fakeSupabase({ invoice: null });
  assert.equal((await correctAndReissuePaymentDocumentFor(gone, REQUEST(valid()))).code, "P0002");
  const cancelled = fakeSupabase({ invoice: { ...DOCUMENT, status: "cancelled" } });
  const result = await correctAndReissuePaymentDocumentFor(cancelled, REQUEST({ ...valid(), expectedTotal: "5000.00", expectedTax: "762.71" }));
  assert.equal(result.code, "55006");
  assert.match((await correctAndReissuePaymentDocumentFor(gone, { ...REQUEST(valid()), documentId: "" })).error, /Could not correct the document/);
  assert.equal(rpcCalls(gone).length + rpcCalls(cancelled).length, 0);
});

test("the database's refusals of a correction are mapped to messages and fields", async () => {
  const refuse = (error) => correctAndReissuePaymentDocumentFor(
    fakeSupabase({ rpcResult: { data: null, error } }),
    REQUEST({ ...valid(), expectedTotal: "5000.00", expectedTax: "762.71" }),
  );

  const balance = await refuse({ code: "22023", message: "The payment cannot be more than the outstanding balance." });
  assert.equal(balance.fieldErrors.methods, "The payment cannot be more than the outstanding balance.");

  const reviewed = await refuse({ code: "55006", message: "The corrected document is not the one that was reviewed. Review it again." });
  assert.equal(reviewed.error, "The corrected document changed since you reviewed it. Review it again.");
  assert.equal(reviewed.code, "55006");

  const gstin = await refuse({ code: "23514", message: 'new row for relation "invoices" violates check constraint "invoices_business_gstin_valid"' });
  assert.equal(gstin.fieldErrors.business_gstin, "Enter a valid GSTIN, or leave it blank.");

  const again = await refuse({ code: "55006", message: "This document has already been cancelled." });
  assert.match(again.error, /already been cancelled/);

  const reason = await refuse({ code: "22023", message: "Enter the reason for the correction." });
  assert.equal(reason.fieldErrors.reason, "Enter the reason for the correction.");

  const name = await refuse({ code: "22023", message: "The customer name is required." });
  assert.equal(name.fieldErrors.customer_name, "Enter the customer name.");

  const date = await refuse({ code: "22023", message: "The document date cannot be before the payment date." });
  assert.equal(date.fieldErrors.invoice_date, "The document date cannot be before the payment date.");

  const denied = await refuse({ code: "42501", message: "Not authorized." });
  assert.equal(denied.error, "You do not have permission to manage invoices.");
});

test("every 0055 message the database can raise is a known one, and an unknown error is never shown raw", async () => {
  for (const [code, message] of [
    ["22023", "Enter the reason for the cancellation."],
    ["55000", "Only a payment document can be cancelled."],
    ["22023", "The corrections must be an object."],
    ["22023", "That detail cannot be corrected on a document."],
    ["22023", "Each corrected detail must be text."],
    ["22023", "A corrected detail can have at most 500 characters."],
    ["22023", "A GSTIN can be corrected on a tax invoice only."],
    ["22023", "The business name is required."],
    ["22023", "The correction must name a document of this payment."],
    ["22023", "The replaced document must be a document of this payment."],
    ["22023", "Add at least one payment method."],
    ["22023", "Select a valid payment method."],
    ["22023", "Each payment method needs an amount greater than zero, with at most two decimals."],
    ["23514", "The payment methods must add up to the payment amount."],
  ]) {
    const mapped = mapInvoiceError({ code, message }, "fallback");
    assert.notEqual(mapped.error, "fallback", message);
    assert.ok(!mapped.error.includes("postgres"), message);
  }

  const original = console.error;
  console.error = () => {};
  try {
    const unknown = mapInvoiceError({ code: "XX000", message: "relation \"invoices\" exploded" }, "Could not correct the document. Try again.");
    assert.equal(unknown.error, "Could not correct the document. Try again.");
  } finally {
    console.error = original;
  }
});

// ---- the server wrappers (cannot be imported under node:test, so pinned structurally) ---------------------------------

test("the server actions are Admin only, call the cores, and revalidate the membership and the documents", () => {
  const actions = code("./actions.js");
  for (const name of ["cancelPaymentDocument", "previewPaymentDocumentCorrection", "correctAndReissuePaymentDocument"]) {
    const start = actions.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const body = actions.slice(start, actions.indexOf("\n}\n", start));
    assert.match(body, /await requireRole\(ROLES\.ADMIN\);/, name);
    assert.ok(body.indexOf("requireRole") < body.indexOf("createClient"), `${name}: the role is checked first`);
  }
  assert.match(actions, /cancelPaymentDocumentFor\(await createClient\(\), documentId, reason\)/);
  assert.match(actions, /correctAndReissuePaymentDocumentFor\(await createClient\(\), \{\s+membershipId,\s+documentId,\s+input,\s+today: await centreToday\(\),\s+\}\)/);
  assert.match(actions, /revalidatePath\(`\$\{membershipPath\(membershipId\)\}\/documents\/\$\{result\.invoiceId\}`\);/);
  // "use server" files export only async functions: the centre-date helper is not exported.
  assert.doesNotMatch(actions, /export (const|function (?!async)|\{)/);
  assert.doesNotMatch(actions, /export async function centreToday/);
});

test("the data wrapper is Admin only, and the core never writes a table directly - only the two RPCs", () => {
  const data = code("./data.js");
  assert.match(data, /export async function getCorrectionContext\(membershipId, documentId\) \{\s+await requireRole\(ROLES\.ADMIN\);\s+return fetchCorrectionContext\(await createClient\(\), membershipId, documentId\);/);

  // The context reader only READS: four tables, no write, no RPC.
  const reader = code("./correction-context.js");
  assert.deepEqual([...reader.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ["membership_payments", "memberships", "membership_payments", "invoice_settings"]);
  assert.doesNotMatch(reader, /\.(insert|update|delete|upsert|rpc)\(/);

  const core = code("./invoice-core.js");
  assert.doesNotMatch(core, /\.(insert|update|delete|upsert)\(/);
  assert.match(core, /supabase\.rpc\("cancel_payment_document", \{ p_document_id: documentId, p_reason: text \}\)/);
  assert.match(core, /supabase\.rpc\("correct_and_reissue_payment_document", buildCorrectionRpcArgs\(documentId, evaluated\.data, reviewed\)\)/);
  // Not the older RPC, and no payment function is called directly: the one database function does the whole transaction.
  const start = core.indexOf("export async function correctAndReissuePaymentDocumentFor");
  assert.doesNotMatch(core.slice(start, core.indexOf("\n}\n", start)), /rpc\("(edit_payment|issue_payment_document|correct_payment_document)"/);
});
