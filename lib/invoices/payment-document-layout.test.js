// Run with `npm test` (Node's built-in test runner).
//
// V1 Tax Adjustment, Step 5 - the layout of payment documents: a tax invoice and a PAYMENT RECEIPT of one
// payment, with the methods it was paid by. One view model feeds the browser view, Print and the PDF, so the
// builder, the HTML source and a real rendered PDF are checked here. Membership-level documents must render
// exactly as before.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdf from "./pdf/invoice-pdf.js";
import { extractPdfText } from "./pdf/pdf-text.js";
import { buildInvoiceDocument } from "./invoice-document.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const METHODS = [
  { position: 1, method: "cash", amount: "1000.00", reference_id: null, notes: null },
  { position: 2, method: "upi", amount: "500.50", reference_id: "UPI-4821-7733", notes: "Paid by the student's father" },
  { position: 3, method: "card", amount: "250.00", reference_id: "AUTH 884412", notes: null },
];

/** A stored payment document: the tax invoice of a 1,750.50 payment (tax-inclusive 5%). */
function taxInvoice(overrides = {}) {
  return {
    id: "d1", membership_id: "m1", payment_id: "p1", document_series: "invoice",
    invoice_number: 807, invoice_prefix: "INV-", invoice_date: "2026-12-05", payment_date: "2026-12-04",
    document_title: "invoice", description: "Quarterly Membership", plan: "quarterly",
    period_start: "2026-12-01", period_end: "2027-02-28", currency: "INR", total_amount: 1750.5,
    tax_enabled: true, tax_name: "GST", tax_rate: 5, taxable_amount: 1667.14, tax_amount: 83.36,
    customer_name: "Asha Rao", customer_code: "YC-000012", customer_phone: "9876543210", customer_phone_country_code: "+91", customer_email: "asha@example.com",
    business_name: "Sri Yoga Center", business_address: "12 Temple Road, Chennai", business_phone: "04412345678", business_email: "hello@sriyoga.example",
    terms: "Fees are non-refundable.", signatory_name: "R. Kumar", signatory_designation: "Director",
    bank_name: "State Bank of India", bank_account_name: "Sri Yoga Center", bank_account_number: "123456789012", bank_ifsc_code: "SBIN0001234", bank_branch: "T. Nagar",
    service_details: null, payment_methods: METHODS,
    ...overrides,
  };
}

/** The payment receipt of the same payment: its own series, titled so, with no tax at all. */
const receipt = (overrides = {}) =>
  taxInvoice({
    document_series: "payment_receipt", document_title: "payment_receipt", invoice_number: 31, invoice_prefix: "PR-",
    tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null,
    ...overrides,
  });

// ---- the shared view model ---------------------------------------------------------------------------------------

test("a payment document lists its methods with amounts, references and notes, in the order entered", () => {
  const doc = buildInvoiceDocument(taxInvoice());
  assert.deepEqual(doc.paymentMethods, {
    beside: true,
    items: [
      { label: "Cash", amount: "₹1,000.00", reference: null, notes: null },
      { label: "UPI", amount: "₹500.50", reference: "UPI-4821-7733", notes: "Paid by the student's father" },
      { label: "Card", amount: "₹250.00", reference: "AUTH 884412", notes: null },
    ],
  });
  // More than three methods stand on their own above the terms and totals, so the page can break between them.
  const four = Array.from({ length: 4 }, (_, i) => ({ position: i + 1, method: "cash", amount: "10.00", reference_id: null, notes: null }));
  assert.equal(buildInvoiceDocument(taxInvoice({ payment_methods: four })).paymentMethods.beside, false);
  // The methods add up to the document's total, which is the payment amount.
  assert.equal(doc.amounts.total, "₹1,750.50");
});

test("a document with no methods (every membership-level document) has none and is otherwise unchanged", () => {
  for (const overrides of [{ payment_methods: undefined }, { payment_methods: [] }, { payment_methods: null }]) {
    const doc = buildInvoiceDocument(taxInvoice(overrides));
    assert.equal(doc.paymentMethods, null);
  }
  const { paymentMethods: _a, ...withMethods } = buildInvoiceDocument(taxInvoice());
  const { paymentMethods: _b, ...without } = buildInvoiceDocument(taxInvoice({ payment_methods: undefined }));
  assert.deepEqual(withMethods, without, "the methods change nothing else in the model");
});

test("the tax invoice keeps its tax: before tax, the combined rate and the CGST / SGST split of the stored tax", () => {
  const doc = buildInvoiceDocument(taxInvoice());
  assert.equal(doc.title, "Invoice");
  assert.equal(doc.number, "INV-807");
  assert.equal(doc.amounts.taxable, "₹1,667.14");
  assert.equal(doc.amounts.tax.amount, "₹83.36");
  assert.deepEqual(doc.amounts.tax.components.map((c) => c.label), ["CGST", "SGST"]);
});

test("the payment receipt is titled PAYMENT RECEIPT, numbered from its own series, and shows no tax anywhere", () => {
  const doc = buildInvoiceDocument(receipt());
  assert.equal(doc.title, "Payment Receipt");
  assert.equal(doc.number, "PR-31");
  assert.equal(doc.amounts.tax, null);
  assert.equal(doc.amounts.taxable, null);
  assert.equal(doc.amounts.total, "₹1,750.50");
  assert.equal(doc.paymentDate, buildInvoiceDocument(taxInvoice()).paymentDate);
  assert.equal(doc.invoiceDate, buildInvoiceDocument(taxInvoice()).invoiceDate);
});

// ---- the browser view and Print (one component) ----------------------------------------------------------------------

test("the browser document and Print show the payment details beside the totals, above the terms, only when there are methods", () => {
  const html = code("../../app/memberships/[id]/invoice/invoice-document.js");
  assert.match(html, /const methods = doc\.paymentMethods;/);
  assert.match(html, /\{methods\?\.beside \? <PaymentDetails methods=\{methods\} \/> : null\}/);
  assert.match(html, /\{methods && !methods\.beside \? \(/);
  assert.ok(html.indexOf('aria-label="Items"') < html.indexOf("<PaymentDetails"));
  assert.ok(html.indexOf("<PaymentDetails") < html.indexOf("invoice-terms"));
  assert.match(html, /Payment Details/);
  assert.match(html, /Ref: \{method\.reference\}/);
  assert.match(html, /\{method\.notes \? <span className="block text-text-secondary">\{method\.notes\}<\/span> : null\}/);
  // Long names and notes wrap; the amount never shrinks or wraps; and the block does not split across printed pages.
  assert.match(html, /min-w-0 break-words/);
  assert.match(html, /shrink-0 font-medium whitespace-nowrap/);
  // It lives in the terms column of the terms-and-totals block, which does not split across printed pages.
  assert.match(html, /<div className="grid gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10 print:break-inside-avoid">\s*<div className="flex min-w-0 flex-col gap-5">\s*\{methods\?\.beside \?/);
  // The tax columns and totals appear only for a taxed document, as before.
  assert.match(html, /\{amounts\.tax \? \(/);
  assert.match(html, /\{doc\.title\}<\/h2>/);
});

// ---- the PDF (rendered for real, text read back) -----------------------------------------------------------------------

const renderPdf = (invoice) => renderToBuffer(createElement(InvoicePdf, { invoiceDocument: buildInvoiceDocument(invoice) }));
const runOf = (lines) => lines.join(" ").replace(/\s+/g, " ");
const pages = (buffer) => (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

test("the PDF of a tax invoice shows the payment amount, its tax split and every method with its reference and notes", async () => {
  const buffer = await renderPdf(taxInvoice());
  const joined = runOf(extractPdfText(buffer));
  for (const expected of ["INVOICE", "INV-807", "Payment Date", "Dec 04, 2026", "Dec 05, 2026", "PAYMENT DETAILS", "Cash", "₹1,000.00", "UPI", "Ref: UPI-4821-7733", "Paid by the student's father", "₹500.50", "Card", "Ref: AUTH 884412", "₹250.00", "CGST @ 2.5%", "SGST @ 2.5%", "Total Tax", "Total Amount", "₹1,750.50"]) {
    assert.ok(joined.includes(expected), `"${expected}" in ${joined}`);
  }
  assert.ok(joined.indexOf("PAYMENT DETAILS") < joined.indexOf("TERMS & CONDITIONS"));
  assert.equal(pages(buffer), 1, "one page");
  // The common worst case - several batches, three methods, terms, bank and signatory - still fits one page.
  const busy = await renderPdf(taxInvoice({ service_details: { version: 1, as_of: "2026-12-01", batches: [
    { batch_id: "a", name: "Advanced Yoga", code: "AY", slots: [{ day_of_week: "monday", start_time: "10:30", end_time: "11:30" }] },
    { batch_id: "b", name: "Hatha Yoga", code: "HY", slots: [{ day_of_week: "tuesday", start_time: "07:00", end_time: "08:00" }] },
    { batch_id: "c", name: "Yoga Therapy", code: "YT", slots: [{ day_of_week: "friday", start_time: "16:00", end_time: "17:00" }] },
  ] } }));
  assert.equal(pages(busy), 1, "several batches and three methods on one page");
});

test("the PDF of a payment receipt says PAYMENT RECEIPT, has no tax of any kind, and keeps terms, bank and signatory", async () => {
  const buffer = await renderPdf(receipt());
  const shown = extractPdfText(buffer);
  const joined = runOf(shown);
  assert.ok(shown.some((line) => line.trim() === "PAYMENT RECEIPT"));
  for (const expected of ["PR-31", "Payment Date", "Payment Receipt Date", "Payment Details", "₹1,750.50", "TERMS & CONDITIONS", "Fees are non-refundable.", "BANK DETAILS", "State Bank of India", "R. Kumar", "AUTHORIZED SIGNATORY"]) {
    assert.ok(joined.toUpperCase().includes(expected.toUpperCase()), `"${expected}" in ${joined}`);
  }
  for (const taxed of ["BEFORE TAX", "CGST", "SGST", "Total Tax", "Amount before tax", "GST", "(5%)"]) {
    assert.ok(!joined.includes(taxed), `no "${taxed}"`);
  }
  assert.equal(pages(buffer), 1, "one page");
});

test("many methods, long names, long references and long notes still render without dropping anything", async () => {
  const long = "Advance for the next quarter, paid in three parts by relatives living abroad and settled by the family on a single visit to the centre";
  const methods = [
    ...Array.from({ length: 5 }, (_, i) => ({ position: i + 1, method: ["cash", "card", "upi", "bank_transfer", "other"][i], amount: "100.00", reference_id: `REFERENCE-NUMBER-${i + 1}-WITH-A-LONG-TRANSACTION-ID-0123456789`, notes: i === 2 ? long : null })),
  ];
  const doc = taxInvoice({ payment_methods: methods, total_amount: 500, taxable_amount: 476.19, tax_amount: 23.81, description: "Annual Membership including all weekend workshops, special sessions and extended access" });
  const buffer = await renderPdf(doc);
  const joined = runOf(extractPdfText(buffer));
  for (const i of [1, 2, 3, 4, 5]) assert.ok(joined.includes(`REFERENCE-NUMBER-${i}-WITH-A-LONG-TRANSACTION-ID-0123456789`), `reference ${i}`);
  assert.ok(joined.includes("settled by the family on a single visit to the centre"));
  for (const label of ["Cash", "Card", "UPI", "Bank Transfer", "Other"]) assert.ok(joined.includes(label), label);
  assert.ok(joined.includes("₹500.00"));
});

test("a membership-level document renders exactly as before: no payment details block, in HTML or PDF", async () => {
  const membershipLevel = taxInvoice({ payment_id: null, payment_methods: undefined });
  const joined = runOf(extractPdfText(await renderPdf(membershipLevel)));
  assert.ok(!joined.toUpperCase().includes("PAYMENT DETAILS"));
  assert.ok(joined.includes("Total Amount") && joined.includes("CGST @ 2.5%"));
  assert.equal(buildInvoiceDocument(membershipLevel).paymentMethods, null);
});

test("the PDF and the browser document draw the methods from the same view model, with no business logic of their own", () => {
  const pdf = code("./pdf/invoice-pdf.js");
  assert.match(pdf, /if \(!doc\.paymentMethods\) return null;/);
  assert.match(pdf, /doc\.paymentMethods\.items\.map/);
  assert.match(pdf, /const methodsBeside = !doc\.paymentMethods \|\| doc\.paymentMethods\.beside;/);
  // The methods lead the terms column beside the totals; with long terms they stand alone above the totals.
  assert.match(pdf, /termsBlock\(doc, styles\.terms, methodsBeside \? methodsBlock\(doc\) : null\)/);
  assert.match(pdf, /methodsBlock\(doc, true\),\s*h\(View, \{ key: "totals", style: styles\.totalsAbove/);
  assert.doesNotMatch(pdf, /formatCurrency|membership_payment|payment_methods|PAYMENT_METHOD_LABEL/);
  const builder = code("./invoice-document.js");
  assert.match(builder, /paymentMethods: paymentMethodsOf\(invoice, currency\)/);
  assert.match(builder, /PAYMENT_METHOD_LABEL\[method\.method\]/);
});

test("the payment document page and PDF read the stored document with its methods, and nothing is calculated", () => {
  const data = code("./data.js");
  assert.match(data, /fetchPaymentMethods\(supabase, document\.payment_id\)/);
  assert.match(data, /payment_methods: methods,/);
  const core = code("../memberships/payments-core.js");
  assert.match(core, /\.from\("membership_payment_methods"\)\s*\.select\("position, method, amount, reference_id, notes"\)\s*\.eq\("payment_id", paymentId\)\s*\.order\("position", \{ ascending: true \}\)/);
});

test("a long reference ID may break inside its column, while names and account numbers stay whole", async () => {
  const fonts = code("./pdf/fonts.js");
  assert.match(fonts, /const LONG_RUN = 28;/);
  assert.match(fonts, /word\.length > LONG_RUN \? word\.match\(new RegExp\(`\.\{1,\$\{BREAK_EVERY\}\}`, "gs"\)\) : \[word\]/);
  // A 90-character reference with no spaces is drawn in full, split across lines, never lost or cut off.
  const reference = "R".repeat(30) + "-" + "0123456789".repeat(6);
  const methods = [{ position: 1, method: "bank_transfer", amount: "1750.50", reference_id: reference, notes: null }];
  const joined = runOf(extractPdfText(await renderPdf(taxInvoice({ payment_methods: methods }))));
  assert.ok(joined.replace(/[\s-]/g, "").includes(reference.replace(/-/g, "")), "every character of the reference is on the page");
  assert.ok(joined.includes("State Bank of India") && joined.includes("123456789012"), "an account number is still whole");
});
