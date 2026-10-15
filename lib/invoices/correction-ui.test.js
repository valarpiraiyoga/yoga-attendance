// Run with `npm test` (Node's built-in test runner).
//
// Correct & Reissue - the dedicated page (migration 0055, Step 2). React components cannot be rendered under node:test, so the
// wiring is pinned as source: which server actions the page calls, what it sends, what it shows for each document series, and
// the guards against a double submission. The rules themselves are tested in document-correction.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DOCUMENT_DIR = "../../app/memberships/[id]/documents/[documentId]/";
const PAGE = `${DOCUMENT_DIR}correct/page.js`;
const FORM = `${DOCUMENT_DIR}correct/correction-form.js`;

test("the reason-only dialog is replaced by a dedicated correction page, reached from the document page", () => {
  assert.equal(existsSync(new URL(`${DOCUMENT_DIR}correct-document.js`, import.meta.url)), false);
  assert.equal(existsSync(new URL(PAGE, import.meta.url)), true);
  assert.equal(existsSync(new URL(FORM, import.meta.url)), true);

  const document = code(`${DOCUMENT_DIR}page.js`);
  assert.match(document, /href=\{`\/memberships\/\$\{id\}\/documents\/\$\{document\.id\}\/correct`\}/);
  assert.doesNotMatch(document, /CorrectDocument|ConfirmDialog/);
  // Offered on an issued document only; a cancelled one has nothing to correct.
  assert.match(document, /\{isCancelled \? null : \(/);
});

test("the page is Admin only, loads the context, and sends a cancelled or unknown document away", () => {
  const page = code(PAGE);
  assert.match(page, /await requireRole\(ROLES\.ADMIN\);/);
  assert.ok(page.indexOf("requireRole") < page.indexOf("getCorrectionContext("));
  assert.match(page, /const context = await getCorrectionContext\(id, documentId\);\s+if \(!context\) \{\s+notFound\(\);/);
  assert.match(page, /if \(document\.status !== "issued"\) \{\s+redirect\(documentPath\);/);
  // Everything shown is read from the stored document, its payment and its membership; nothing is written here.
  assert.doesNotMatch(page, /\.rpc\(|\.insert\(|\.update\(|createClient/);
  // The details start from what the DOCUMENT says (not from the student or the centre profile).
  assert.match(page, /correctableFields\(document\.document_series\)\.map\(\(field\) => \[field, document\[field\] \?\? ""\]\)/);
  assert.match(page, /initialRows=\{payment\.methods\.map\(rowOf\)\}/);
  assert.match(page, /availablePaise=\{context\.availablePaise\}/);
});

test("the form edits the customer, the business, the invoice date and the payment methods - and nothing else", () => {
  const form = code(FORM);
  for (const name of ["customer_name", "customer_phone_country_code", "customer_phone", "customer_email", "business_name", "business_address", "business_phone", "business_email"]) {
    assert.ok(form.includes(`"${name}"`), name);
  }
  assert.match(form, /id="correct-invoice-date"/);
  assert.match(form, /min=\{paymentDate\}\s+max=\{today\}/);
  // The payment: add, remove and edit methods through the shared payment fields - without a payment date or a tax invoice choice.
  assert.match(form, /<PaymentFields[\s\S]*?showPaymentDate=\{false\}\s+showTaxInvoice=\{false\}/);
  assert.match(form, /const draft = usePaymentDraft\(\{ today, balancePaise: availablePaise, initialPaymentDate: paymentDate, initialRows \}\);/);
  // What is sent: the reason, the date, every detail and the method rows. No payment date, no amount of the document, no tax.
  assert.match(form, /const input = \(\) => \(\{ reason, invoiceDate, details, methods: draft\.rows \}\);/);
  assert.doesNotMatch(form, /paymentDate:|payment_date:|total_amount|tax_rate/);
});

test("a payment receipt never shows a GSTIN or tax: both are conditional on a tax invoice", () => {
  const form = code(FORM);
  assert.match(form, /const isTaxInvoice = series === "invoice";/);
  // The GSTIN field (edit) and the GSTIN row (review) exist only for a tax invoice.
  assert.match(form, /\{isTaxInvoice \? \(\s+<FormField\s+id="correct-business_gstin"/);
  assert.match(form, /\{isTaxInvoice && data\.overrides\.business_gstin \? <Row label="GSTIN"/);
  // The tax lines of the review come from the server's preview and only when it is taxed.
  assert.match(form, /\{preview\.taxed \? \(\s+<>\s+<Row label="Amount before tax"/);
  assert.match(form, /expectedTax: preview\.taxed \? fromPaise\(preview\.taxPaise\) : null/);
  // The edit-step hint mentions tax only for a tax invoice.
  assert.match(form, /\{isTaxInvoice \? "tax and " : ""\}/);
});

test("the review comes from the server's preview and shows the total, tax, membership status and outstanding balance", () => {
  const form = code(FORM);
  assert.match(form, /await previewPaymentDocumentCorrection\(membershipId, documentId, input\(\)\)/);
  assert.match(form, /setReview\(\{ preview: result\.preview, data: result\.data \}\);\s+setConfirmed\(false\);\s+setStep\("review"\);/);
  for (const label of ["Document total", "Membership payable", "Paid after this correction", "Outstanding balance", "Payment status", "Payment date (unchanged)", "Amount before tax"]) {
    assert.ok(form.includes(`"${label}"`), label);
  }
  assert.match(form, /PAYMENT_STATUS_LABEL = \{ paid: "Paid", partially_paid: "Partially Paid" \}/);
  // A lower payment says plainly that no refund is processed.
  assert.match(form, /no refund is processed or recorded/);
  assert.match(form, /The membership&rsquo;s price, package, dates and attendance are not changed/);
});

test("nothing is written before Confirm: the reason is required, the confirmation is explicit, and the reviewed figures travel with it", () => {
  const form = code(FORM);
  assert.match(form, /label="Reason for the correction"\s+required/);
  assert.match(form, /id="correct-confirm"\s+type="checkbox"/);
  assert.match(form, /if \(!confirmed\) \{\s+setFieldErrors\(\{ confirm: "Confirm the corrected document before reissuing\." \}\);\s+return;/);
  assert.match(form, /await correctAndReissuePaymentDocument\(membershipId, documentId, \{\s+\.\.\.input\(\),\s+expectedTotal: fromPaise\(preview\.totalPaise\),\s+expectedTax: preview\.taxed \? fromPaise\(preview\.taxPaise\) : null,\s+\}\)/);
  // The only call that writes is the confirmation; the review step calls the read-only preview.
  assert.equal([...form.matchAll(/correctAndReissuePaymentDocument\(/g)].length, 1);
  assert.match(form, /disabled=\{isPending\} onClick=\{confirmCorrection\}/);
});

test("a second submission is prevented, a success opens the replacement, and refusals are shown where they belong", () => {
  const form = code(FORM);
  assert.match(form, /const inFlight = useRef\(false\);/);
  assert.match(form, /if \(inFlight\.current\) return;\s+inFlight\.current = true;/);
  assert.match(form, /router\.push\(`\/memberships\/\$\{membershipId\}\/documents\/\$\{result\.invoiceId\}`\);\s+router\.refresh\(\);\s+return;/);
  // After a success the lock stays on (the page is navigating away); after a refusal it is released.
  assert.match(form, /inFlight\.current = false;\s+\/\/|inFlight\.current = false;\s+if \(showRefusal\(result\)\) setStep\("edit"\);/);
  // Refused fields and rows are marked; anything else is a banner; a network failure is a message, never a crash.
  assert.match(form, /setRowErrors\(rows\);/);
  assert.match(form, /Could not reach the server\. Try again\./);
  assert.match(form, /role="alert"/);
});

test("the shared payment fields only gained an opt-out of the payment date; the recording and editing dialogs are unchanged", () => {
  const fields = read("../../app/memberships/[id]/payment-fields.js");
  assert.match(fields, /showPaymentDate = true,/);
  assert.match(fields, /\{showPaymentDate \? \(\s+<FormField id=\{`\$\{idPrefix\}-date`\} label="Payment date"/);
  // The two existing users do not pass it, so the payment date is still shown for them.
  for (const file of ["../../app/memberships/[id]/edit-payment.js", "../../app/memberships/[id]/record-payment.js"]) {
    assert.doesNotMatch(read(file), /showPaymentDate/, file);
  }
});

test("Cancel Document is not part of this page", () => {
  const form = code(FORM);
  assert.doesNotMatch(form, /cancelPaymentDocument/);
  assert.doesNotMatch(code(PAGE), /cancelPaymentDocument/);
});
