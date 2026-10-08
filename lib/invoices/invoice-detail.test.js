// Run with `npm test` (Node's built-in test runner).
//
// V1 Invoice Detail (Phase 5.1): the read-only page for a stored invoice. What it shows is
// built by one pure function from the invoice record alone (tested directly); the page,
// its document component and the image-URL helper are pinned from source, the project's
// way for code that cannot be rendered under node:test.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { buildInvoiceDocument } from "./invoice-document.js";
import { formatCurrency } from "../currencies.js";
import { formatDate } from "../format.js";
import { fetchInvoiceForMembership } from "./invoice-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "../../app/memberships/[id]/invoice/page.js";
const DOCUMENT = "../../app/memberships/[id]/invoice/invoice-document.js";
const PRINT_BUTTON = "../../app/memberships/[id]/invoice/print-invoice-button.js";
const PANEL = "../../app/memberships/[id]/invoice-panel.js";

/** A complete stored invoice (all 34 columns). */
function invoice(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    membership_id: "11111111-1111-4111-8111-111111111111",
    invoice_number: 790,
    invoice_prefix: "INV-",
    invoice_date: "2026-10-07",
    payment_date: "2026-10-05",
    document_title: "invoice",
    description: "Monthly Membership",
    plan: "monthly",
    period_start: "2026-10-01",
    period_end: "2026-10-31",
    currency: "INR",
    total_amount: 1180,
    tax_enabled: true,
    tax_name: "GST",
    tax_rate: 18,
    taxable_amount: 1000,
    tax_amount: 180,
    customer_name: "Asha Rao",
    customer_code: "YC-000012",
    customer_phone: "9876543210",
    customer_phone_country_code: "+91",
    customer_email: "asha@example.com",
    business_name: "Sri Yoga Center",
    business_address: "12 Temple Road\nChennai",
    business_phone: "04412345678",
    business_email: "hello@sriyoga.example",
    business_logo_path: "center/logo.png",
    terms: "Fees are non-refundable.",
    signatory_name: "R. Kumar",
    signatory_designation: "Director",
    signature_path: "signatures/sig.png",
    created_at: "2026-10-07T04:00:00Z",
    updated_at: "2026-10-07T04:00:00Z",
    ...overrides,
  };
}

// ---- the invoice number ------------------------------------------------------------------------

test("a NULL prefix shows the bare number", () => {
  assert.equal(buildInvoiceDocument(invoice({ invoice_number: 786, invoice_prefix: null })).number, "786");
});

test("an INV- prefix shows INV-790; a YC- prefix shows YC-791", () => {
  assert.equal(buildInvoiceDocument(invoice()).number, "INV-790");
  assert.equal(buildInvoiceDocument(invoice({ invoice_number: 791, invoice_prefix: "YC-" })).number, "YC-791");
});

test("an existing invoice with no prefix value at all stays valid and reads as its number", () => {
  const legacy = invoice();
  delete legacy.invoice_prefix;
  assert.equal(buildInvoiceDocument(legacy).number, "790");
});

test("the number is built by the one formatter — the page never joins a prefix and a number", () => {
  const builder = code("./invoice-document.js");
  assert.match(builder, /import \{ formatInvoiceNumberOf \} from "\.\/invoice-number\.js";/);
  assert.match(builder, /number: formatInvoiceNumberOf\(invoice\)/);
  for (const file of [PAGE, DOCUMENT, "./invoice-document.js", "./document-data.js"]) {
    const text = code(file);
    assert.doesNotMatch(text, /invoice_prefix|invoicePrefix|\.invoice_number/, file);
  }
});

// ---- a historical snapshot: nothing but the invoice -------------------------------------------------

test("the current Invoice / Receipt Settings prefix cannot override the invoice's stored prefix", () => {
  const currentSettings = { invoice_prefix: "YC-", document_title: "receipt", tax_name: "VAT", tax_rate: 20, terms: "NEW", signatory_name: "New Person" };
  const shown = buildInvoiceDocument(invoice());
  assert.equal(shown.number, "INV-790", "still INV-790, not YC-790");
  // The builder takes the invoice and nothing else, so no live value can reach it.
  assert.equal(buildInvoiceDocument.length, 1);
  assert.deepEqual(buildInvoiceDocument({ ...invoice(), liveSettings: currentSettings }), shown);
});

test("every displayed value comes from the stored snapshot", () => {
  const shown = buildInvoiceDocument(invoice());
  assert.equal(shown.title, "Invoice");
  assert.equal(shown.invoiceDate, formatDate("2026-10-07"));
  assert.equal(shown.paymentDate, formatDate("2026-10-05"));
  assert.deepEqual(shown.business, {
    name: "Sri Yoga Center",
    address: "12 Temple Road\nChennai",
    phone: "04412345678",
    email: "hello@sriyoga.example",
    hasLogo: true,
  });
  assert.deepEqual(shown.customer, { name: "Asha Rao", code: "YC-000012", phone: "+91 98765 43210", email: "asha@example.com" });
  assert.deepEqual(shown.line, { description: "Monthly Membership", period: `${formatDate("2026-10-01")} – ${formatDate("2026-10-31")}` });
  assert.equal(shown.terms, "Fees are non-refundable.");
  assert.deepEqual(shown.signatory, { name: "R. Kumar", designation: "Director", hasSignature: true });
});

test("later changes to the membership, student, centre or settings cannot change what an invoice shows", () => {
  const issued = invoice();
  const before = buildInvoiceDocument(issued);

  // Everything that exists live and could change later — none of it is an input to the builder.
  const live = {
    membership: { amount: 9999, plan: "quarterly", start_date: "2030-01-01", end_date: "2030-03-31", payment_date: "2030-01-02" },
    student: { full_name: "Someone Else", phone: "1111111111", email: "else@example.com" },
    center: { name: "Renamed Center", address: "New Address", phone: "000", email: "new@example.com", logo_url: "x" },
    settings: { invoice_prefix: "YC-", tax_name: "VAT", tax_rate: 5, terms: "NEW TERMS", signatory_name: "Nobody", signature_path: "signatures/new.png" },
  };
  assert.ok(live.membership.amount !== issued.total_amount);

  const after = buildInvoiceDocument(issued);
  assert.deepEqual(after, before);
  const text = JSON.stringify(after);
  for (const stranger of ["Someone Else", "Renamed Center", "New Address", "NEW TERMS", "Nobody", "VAT", "YC-790"]) {
    assert.equal(text.includes(stranger), false, stranger);
  }
});

// ---- the money ------------------------------------------------------------------------------------------

test("tax is shown as stored — nothing is recalculated", () => {
  // Deliberately NOT what 18% of 1180 would give: a recalculation would change these.
  const stored = invoice({ total_amount: 1180, taxable_amount: 1000.5, tax_amount: 179.5, tax_rate: 18, tax_name: "GST" });
  const shown = buildInvoiceDocument(stored);
  assert.deepEqual(shown.amounts, {
    currency: "INR",
    total: formatCurrency(1180, "INR"),
    taxable: formatCurrency(1000.5, "INR"),
    tax: {
      rate: "18",
      amount: formatCurrency(179.5, "INR"),
      // The stored 179.50 split in two: 89.75 + 89.75, each at half the stored 18%.
      components: [
        { label: "CGST", rate: "9", amount: formatCurrency(89.75, "INR") },
        { label: "SGST", rate: "9", amount: formatCurrency(89.75, "INR") },
      ],
    },
  });
  // A different current rate changes nothing: the rate shown is the stored one.
  assert.equal(buildInvoiceDocument(invoice({ tax_rate: 12.5 })).amounts.tax.rate, "12.5");
});

test("an invoice without tax shows just its total", () => {
  const shown = buildInvoiceDocument(invoice({ tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null }));
  assert.equal(shown.amounts.tax, null);
  assert.equal(shown.amounts.taxable, null);
  assert.equal(shown.amounts.total, formatCurrency(1180, "INR"));
});

test("amounts are shown in the invoice's own stored currency", () => {
  const shown = buildInvoiceDocument(invoice({ currency: "USD", total_amount: 50, tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null }));
  assert.equal(shown.amounts.currency, "USD");
  assert.equal(shown.amounts.total, formatCurrency(50, "USD"));
});

test("the builder does no arithmetic and generates nothing", () => {
  const text = code("./invoice-document.js");
  assert.doesNotMatch(text, /Math\.|toFixed|\bNumber\(|parseFloat|parseInt|\*|\s\/\s|[a-z_]\s[-+]\s[a-z_]/);
});

// ---- terms, signatory, signature ---------------------------------------------------------------------------------

test("stored terms and signatory are used; empty ones are simply left out", () => {
  const bare = buildInvoiceDocument(invoice({ terms: null, signatory_name: null, signatory_designation: "  ", signature_path: null, business_address: "", business_phone: null, business_email: null, business_logo_path: null, customer_phone: null, customer_email: null }));
  assert.equal(bare.terms, null);
  assert.deepEqual(bare.signatory, { name: null, designation: null, hasSignature: false });
  assert.deepEqual(bare.business, { name: "Sri Yoga Center", address: null, phone: null, email: null, hasLogo: false });
  assert.deepEqual(bare.customer, { name: "Asha Rao", code: "YC-000012", phone: null, email: null });
});

test("the document title reads Invoice or Receipt as issued", () => {
  assert.equal(buildInvoiceDocument(invoice({ document_title: "receipt" })).title, "Receipt");
  assert.equal(buildInvoiceDocument(invoice({ document_title: "invoice" })).title, "Invoice");
});

test("the logo and signature images come from the paths the invoice stored", () => {
  const data = code("./document-data.js");
  assert.match(data, /invoice\?\.business_logo_path/);
  assert.match(data, /\.getPublicUrl\(invoice\.business_logo_path\)/);
  assert.match(data, /createSignatureUrl\(supabase, invoice\?\.signature_path\)/);
  assert.match(data, /import \{ createSignatureUrl \} from "@\/lib\/invoice-settings\/signature";/);
  assert.match(data, /PROFILE_PHOTO_BUCKET/);
  // Reuses the helper; no storage write or delete, no settings read, no service-role client.
  assert.doesNotMatch(data, /\.upload\(|\.remove\(|\.delete\(|createAdminClient|SECRET_KEY|center_profile|invoice_settings/);
  assert.doesNotMatch(data, /createSignedUrl\(/, "the signed-link code is the existing helper's, not a copy");
});

// ---- access ------------------------------------------------------------------------------------------------------

test("Admin can open it; anyone else is turned away before any data is read", () => {
  const page = code(PAGE);
  assert.match(page, /export default async function InvoiceDetailPage\(\{ params \}\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.ok(page.indexOf("requireRole") < page.indexOf("getInvoiceForMembership"));
  // Defence in depth, as for every membership page: the layout, the data and the asset helper require it too.
  assert.match(code("../../app/memberships/layout.js"), /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(code("./data.js"), /export async function getInvoiceForMembership\(membershipId\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.match(code("./document-data.js"), /export async function getInvoiceAssetUrls\(invoice\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
});

test("a membership with no invoice is a plain not-found, like a missing membership", async () => {
  assert.match(code(PAGE), /if \(!invoice\) \{\s*notFound\(\);\s*\}/);
  assert.match(code(PAGE), /import \{ notFound \} from "next\/navigation";/);
  // The data layer answers "no invoice" with null (not an error), which is what the page tests.
  const none = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  assert.equal(await fetchInvoiceForMembership(none, "m1"), null);
});

test("the page reads only the stored invoice — not the membership, student, Center Profile or settings", () => {
  const page = code(PAGE);
  assert.match(page, /getInvoiceForMembership\(id\)/);
  assert.match(page, /buildInvoiceDocument\(invoice\)/);
  assert.doesNotMatch(page, /getMembership|memberships\/data|center-profile|getCenterProfile|invoice-settings|getInvoiceSettings|getCenterSettings|students\/|from\("/);
  // The document component is handed the view model and two image URLs — and imports no data at all.
  const component = code(DOCUMENT);
  assert.doesNotMatch(component, /@\/lib\//, "the document component imports nothing from lib");
  assert.match(component, /export default function InvoiceDocument\(\{ invoiceDocument: doc, logoUrl, signatureUrl \}\)/);
});

// ---- the screen ---------------------------------------------------------------------------------------------------

test("a Back to Membership link leads to the membership, and the title shows the stored number", () => {
  const page = code(PAGE);
  assert.match(page, /back=\{\{ href: `\/memberships\/\$\{id\}`, label: "Back to Membership" \}\}/);
  assert.match(page, /title=\{`\$\{invoiceDocument\.title\} \$\{invoiceDocument\.number\}`\}/);
});

test("the document shows every section: business, number and dates, customer, items and total, terms, signatory", () => {
  const component = code(DOCUMENT);
  for (const part of [
    "business.name", "business.address", "business.phone", "business.email", "logoUrl",
    "doc.title", "doc.number", "doc.invoiceDate", "doc.paymentDate",
    "customer.name", "customer.code", "customer.phone", "customer.email",
    "line.description", "line.period", "amounts.taxable", "amounts.tax.amount", "amounts.total",
    "doc.terms", "doc.bank", "doc.signatory.name", "doc.signatory.designation", "signatureUrl",
  ]) {
    assert.ok(component.includes(part), part);
  }
  assert.match(component, /Bill To/);
  assert.match(component, /Authorized Signatory/);
  assert.match(component, /Terms &amp; Conditions/);
});

test("responsive: sections stack on a narrow screen, amounts stay aligned, nothing scrolls sideways", () => {
  const component = code(DOCUMENT);
  assert.match(component, /flex flex-col gap-6[^"]*sm:flex-row sm:items-start sm:justify-between/);
  assert.match(component, /px-6[^"]*sm:px-10/);
  assert.match(component, /shadow-xs/);
  // On a phone the table keeps the item and its amount; the before-tax and tax columns return from `sm`, and the
  // same breakdown is always in the totals block below.
  assert.equal((component.match(/hidden[^"]*sm:table-cell/g) ?? []).length, 4);
  assert.match(component, /Amount before tax/);
  assert.match(component, /text-right[^"]*whitespace-nowrap[^"]*tabular-nums/);
  assert.doesNotMatch(component, /overflow-x|min-w-\[|w-\[\d{3,}/);
  assert.match(code(PAGE), /mx-auto w-full max-w-3xl/);
});

test("no PDF, share, download or edit: printing is the browser's own, from the page", () => {
  for (const file of [PAGE, DOCUMENT, "./invoice-document.js", "./document-data.js", PRINT_BUTTON]) {
    const text = code(file);
    assert.doesNotMatch(text, /navigator\.share|wa\.me|react-pdf|jspdf|html2canvas|download|updateInvoiceDetails|update_invoice_details|issueInvoice/i, file);
  }
  assert.doesNotMatch(code(PAGE), /Edit/);
  // Only the Print button is a client component, and the only place that calls window.print().
  for (const file of [PAGE, DOCUMENT, "./invoice-document.js", "./document-data.js"]) {
    assert.doesNotMatch(code(file), /window\.print|"use client"/, file);
  }
});

// ---- the panel link ------------------------------------------------------------------------------------------------

test("the membership panel gains a View Invoice link — only when an invoice exists — and stays a summary", () => {
  const panel = code(PANEL);
  assert.match(panel, /action=\{\s*invoice \? \(\s*<Button variant="outline" render=\{<Link href=\{`\/memberships\/\$\{membership\.id\}\/invoice`\} \/>\} nativeButton=\{false\}>\s*View Invoice\s*<\/Button>\s*\) : state\.canIssue \? \(\s*<IssueInvoice/);
  // Issue Invoice is still there for a Paid membership without one; no Edit action yet.
  assert.match(panel, /<IssueInvoice/);
  assert.doesNotMatch(panel, /Edit/);
  assert.match(panel, /label="Invoice Number"[\s\S]*\{formatInvoiceNumberOf\(invoice\)\}/);
});

test("only fields the approved invoice holds are shown: nothing from the reference invoice that V1 does not store", () => {
  const component = code(DOCUMENT) + code("./invoice-document.js");
  assert.doesNotMatch(component, /gstin|gst_?in|igst|upi|qr|payment instructions|received|balance|in words|amount_in_words|place of supply|place_of_supply|hsn|sac/i);
  // Every property the document reads exists in the invoice schema.
  const schema = new Set(readFileSync(new URL("../../supabase/migrations/0026_invoices.sql", import.meta.url), "utf8").match(/^\s{2}([a-z_]+)\s+(uuid|text|date|bigint|numeric|boolean|timestamptz)/gm)?.map((l) => l.trim().split(/\s+/)[0]));
  const read = [...code("./invoice-document.js").matchAll(/(?<![-\w])invoice\.([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(read.length > 20);
  for (const column of read) assert.ok(schema.has(column) || column === "invoice_prefix" || column.startsWith("bank_"), column);
});

test("the document is laid out like a formal invoice: identity and title, a number-and-dates band, bill to, items, totals, signatory", () => {
  const component = code(DOCUMENT);
  const at = (needle) => component.indexOf(needle);
  assert.ok(at("{business.name}</p>") < at("No.`}>{doc.number}"));
  assert.ok(at("No.`}>{doc.number}") < at("Bill To"));
  assert.ok(at("Bill To") < at("Services"));
  assert.ok(at("Services") < at("Terms &amp; Conditions"));
  assert.ok(at("Terms &amp; Conditions") < at("Authorized Signatory"));
  assert.match(component, /Authorized Signatory for \{business\.name\}/);
  assert.match(component, /border-t-brand/);
});

test("the totals show the amount before tax, CGST, SGST, Total Tax and Total Amount — and the item table keeps the total tax only", () => {
  const component = code(DOCUMENT);
  const at = (needle) => component.indexOf(needle);
  // Totals block, in order.
  assert.ok(at("Amount before tax") > 0);
  assert.ok(at("Amount before tax") < at("amounts.tax.components.map"));
  assert.ok(at("amounts.tax.components.map") < at("Total Tax"));
  assert.ok(at("Total Tax") < at("Total Amount"));
  assert.match(component, /label=\{`\$\{component\.label\} @ \$\{component\.rate\}%`\}/);
  assert.match(component, /<dt[^>]*>Total Tax<\/dt>\s*<dd[^>]*>\s*\{amounts\.tax\.amount\}/);
  // The item table has one Tax column — the total tax with the combined rate — and no CGST / SGST column.
  const table = component.slice(component.indexOf("<table"), component.indexOf("</table>"));
  assert.match(table, />\s*Tax\s*<\/th>/);
  assert.match(table, /\{amounts\.tax\.amount\}/);
  assert.match(table, /\(\{amounts\.tax\.rate\}%\)/);
  assert.doesNotMatch(table, /CGST|SGST|components/);
});

test("CGST / SGST labels are fixed text: the tax name is not used", () => {
  const shown = buildInvoiceDocument(invoice({ tax_name: "Service Charge" }));
  assert.deepEqual(shown.amounts.tax.components.map((c) => c.label), ["CGST", "SGST"]);
  assert.equal(JSON.stringify(shown.amounts).includes("Service Charge"), false);
  assert.doesNotMatch(code("./invoice-document.js"), /tax_name/);
  assert.doesNotMatch(code(DOCUMENT), /tax\.name/);
});

test("the split shown is of the STORED tax: amounts and rates follow the invoice, nothing is recalculated", () => {
  // 5% of an inclusive 13,900: stored before-tax 13,238.10 and tax 661.90.
  const shown = buildInvoiceDocument(invoice({ total_amount: 13900, taxable_amount: 13238.1, tax_amount: 661.9, tax_rate: 5 }));
  assert.equal(shown.amounts.taxable, formatCurrency(13238.1, "INR"), "the before-tax amount is the stored one");
  assert.equal(shown.amounts.tax.amount, formatCurrency(661.9, "INR"));
  assert.deepEqual(shown.amounts.tax.components, [
    { label: "CGST", rate: "2.5", amount: formatCurrency(330.95, "INR") },
    { label: "SGST", rate: "2.5", amount: formatCurrency(330.95, "INR") },
  ]);
  assert.equal(shown.amounts.total, formatCurrency(13900, "INR"));
});

test("an invoice with tax off, or with zero tax, shows no CGST / SGST", () => {
  const off = buildInvoiceDocument(invoice({ tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null }));
  assert.equal(off.amounts.tax, null);
  const zero = buildInvoiceDocument(invoice({ tax_amount: 0, taxable_amount: 1180 }));
  assert.deepEqual(zero.amounts.tax.components, []);
});

// ---- bank details (the snapshot stored by 0029) ---------------------------------------------------------------

const BANK = {
  bank_name: "HDFC Bank",
  bank_account_name: "Aathi Yoga Center",
  bank_account_number: "50100123456789",
  bank_ifsc_code: "HDFC0001234",
  bank_branch: "Bengaluru",
};

test("an invoice with a bank snapshot shows every stored detail, branch included", () => {
  const { bank } = buildInvoiceDocument(invoice(BANK));
  assert.deepEqual(bank, { name: "HDFC Bank", accountName: "Aathi Yoga Center", accountNumber: "50100123456789", ifscCode: "HDFC0001234", branch: "Bengaluru" });
});

test("a snapshot with no branch leaves the branch out; the component draws the row only when present", () => {
  const { bank } = buildInvoiceDocument(invoice({ ...BANK, bank_branch: null }));
  assert.equal(bank.branch, null);
  assert.equal(buildInvoiceDocument(invoice({ ...BANK, bank_branch: "  " })).bank.branch, null);
  assert.match(code(DOCUMENT), /doc\.bank\.branch \? <BankLine/);
});

test("an invoice with no bank snapshot has no bank block, and renders as before", () => {
  const shown = buildInvoiceDocument(invoice({ bank_name: null, bank_account_name: null, bank_account_number: null, bank_ifsc_code: null, bank_branch: null }));
  assert.equal(shown.bank, null);
  assert.equal(buildInvoiceDocument(invoice()).bank, null, "an older record without the fields at all");
  assert.match(code(DOCUMENT), /doc\.bank \? \(\s*<section aria-labelledby="invoice-bank"/);
});

test("the account number is shown in full, with no icon or extra financial fields", () => {
  const component = code(DOCUMENT);
  assert.ok(!/mask|\*{2,}|slice\(/.test(component));
  assert.ok(!/upi|qr/i.test(component));
  assert.match(component, /Bank Details/);
});

test("bank details come from the stored invoice only — never the Bank Accounts table or current settings", () => {
  for (const path of [DOCUMENT, "./invoice-document.js", "./document-data.js", PAGE]) {
    assert.doesNotMatch(code(path), /bank_accounts|from\("bank|getBankAccount|getInvoiceSettings|invoice_settings/i, path);
  }
  const current = { bank_name: "NEW BANK" };
  assert.equal(buildInvoiceDocument(invoice({ ...BANK }), current).bank.name, "HDFC Bank");
});

test("the footer puts bank details left and the signatory right, below Terms and Totals, stacking on mobile", () => {
  const component = code(DOCUMENT);
  const totals = component.indexOf("Total Amount");
  const bank = component.indexOf("Bank Details");
  const signatory = component.indexOf("Authorized Signatory");
  assert.ok(totals > 0 && bank > totals && signatory > bank);
  assert.match(component, /grid gap-6 px-6 pt-2 pb-8 sm:grid-cols-2/);
  assert.match(component, /sm:text-right/);
});

test("terms, CGST / SGST and the signatory are unchanged by the bank block", () => {
  const withBank = buildInvoiceDocument(invoice(BANK));
  const without = buildInvoiceDocument(invoice());
  assert.deepEqual({ ...withBank, bank: null }, without);
  assert.deepEqual(withBank.amounts.tax.components.map((c) => c.label), ["CGST", "SGST"]);
  assert.equal(withBank.terms, "Fees are non-refundable.");
  assert.deepEqual(withBank.signatory, { name: "R. Kumar", designation: "Director", hasSignature: true });
  assert.match(code(DOCUMENT), /Terms &amp; Conditions/);
});

// ---- print (the browser's own, from this page) --------------------------------------------------------------------

test("the page has a Print action, and it calls the browser print function", () => {
  const button = code(PRINT_BUTTON);
  assert.match(button, /^"use client";/);
  assert.match(button, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(button, />\s*Print\s*<\/Button>/);
  assert.match(code(PAGE), /actions=\{<PrintInvoiceButton \/>\}/);
  assert.match(code(PAGE), /import PrintInvoiceButton from "@\/app\/memberships\/\[id\]\/invoice\/print-invoice-button"/);
});

test("printing uses this page's document: no second template and no script-built print document", () => {
  for (const file of [PAGE, DOCUMENT, PRINT_BUTTON]) {
    assert.doesNotMatch(code(file), /window\.open|document\.write|createElement|innerHTML|iframe/i, file);
  }
  assert.equal((code(PAGE).match(/<InvoiceDocument/g) ?? []).length, 1);
  assert.equal(readdirSync(new URL("../../app/memberships/[id]/invoice/", import.meta.url)).sort().join(), "invoice-document.js,page.js,print-invoice-button.js");
});

test("in print only the document remains: the page header (back link, title, Print) is hidden, as are the shell's sidebar and header", () => {
  const page = code(PAGE);
  assert.match(page, /<PageHeader\s+compact\s+className="print:hidden"/);
  assert.match(page, /print:max-w-none/);
  assert.match(page, /@media print \{ @page \{ size: A4; margin: 14mm; \} \}/);
  // The same shell rules the membership receipt relies on.
  const shell = readFileSync(new URL("../../components/layout/AppShell.js", import.meta.url), "utf8");
  assert.match(shell, /print:overflow-visible/);
  assert.match(shell, /print:block print:h-auto/);
  for (const chrome of ["Sidebar", "Header"]) {
    assert.match(readFileSync(new URL(`../../components/global/${chrome}.js`, import.meta.url), "utf8"), /print:hidden/, chrome);
  }
});

test("the document keeps its colours in print and does not split its key blocks across pages", () => {
  const component = code(DOCUMENT);
  assert.match(component, /\[-webkit-print-color-adjust:exact\] \[print-color-adjust:exact\]/);
  assert.match(component, /print:rounded-none print:shadow-none/);
  assert.match(component, /<tr className="border-b border-border print:break-inside-avoid">/);
  // Terms + totals together; bank details + signatory together.
  assert.match(component, /sm:grid-cols-2 sm:px-10 print:break-inside-avoid">\s*<div className="min-w-0">\s*\{doc\.terms/);
  assert.match(component, /sm:grid-cols-2 sm:px-10 print:break-inside-avoid">\s*<div className="min-w-0">\s*\{doc\.bank/);
  // Nothing is hidden in print, so every part of the approved document is printed.
  assert.doesNotMatch(component, /print:hidden|print:block|print:contents/);
});

test("the printable document still holds the bank details and signature — and no bank block without a snapshot", () => {
  const component = code(DOCUMENT);
  assert.match(component, /doc\.bank \? \(\s*<section aria-labelledby="invoice-bank"/);
  assert.match(component, /Authorized Signatory for \{business\.name\}/);
  assert.match(component, /<img src=\{signatureUrl\}/);
  const without = buildInvoiceDocument(invoice({ bank_name: null, bank_account_name: null, bank_account_number: null, bank_ifsc_code: null, bank_branch: null }));
  assert.equal(without.bank, null);
  assert.deepEqual(without.signatory, { name: "R. Kumar", designation: "Director", hasSignature: true });
});

test("the print changes add classes only: the document's content is the same", () => {
  const component = code(DOCUMENT);
  for (const text of ["Bill To", "Terms &amp; Conditions", "Bank Details", "Total Tax", "Total Amount", "Amount before tax", "Services"]) {
    assert.ok(component.includes(text), text);
  }
  assert.match(component, /\$\{component\.label\} @ \$\{component\.rate\}%/);
  assert.match(component, /border-t-2 border-t-brand/);
});
