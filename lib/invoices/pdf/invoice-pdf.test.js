// Run with `npm test` (Node's built-in test runner).
//
// PDF Phase 6.1 - the foundation: React-PDF renders the invoice view model into a real PDF, set in
// the bundled Inter font with the rupee sign. The PDF is generated for real and its text is read
// back out of the file (no PDF-parsing dependency: the file is parsed with node:zlib - see
// `extractPdfText`), so what the document contains is checked, not assumed.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { inflateSync } from "node:zlib";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { renderToBuffer } from "@react-pdf/renderer";
import InvoicePdf from "./invoice-pdf.js";
import { PDF_FONT_FILES, PDF_FONT_FAMILY } from "./fonts.js";
import { buildInvoiceDocument } from "../invoice-document.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A complete stored invoice, as the Invoice Detail tests use. */
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
    business_address: "12 Temple Road, Chennai",
    business_phone: "04412345678",
    business_email: "hello@sriyoga.example",
    ...overrides,
  };
}

const render = (overrides) => renderToBuffer(createElement(InvoicePdf, { invoiceDocument: buildInvoiceDocument(invoice(overrides)) }));

// ---- reading the text back out of a PDF -------------------------------------------------------------------------

/**
 * The text a PDF shows, page by page, in drawing order. React-PDF writes each font as a Type0 font with a
 * /ToUnicode map and draws text as glyph ids in hex strings, in Flate-compressed streams. So: inflate the
 * streams, read each font's glyph->character map, and decode every `<hex> Tj` / `[<hex> n <hex>] TJ`
 * with the font set by the preceding `/Fn size Tf`.
 */
function extractPdfPages(buffer) {
  const raw = buffer.toString("latin1"); // one char per byte, so string offsets are byte offsets
  const objects = new Map();
  for (const match of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    const [, number, body] = match;
    const start = body.indexOf("stream");
    let stream = null;
    if (start !== -1 && /\/FlateDecode/.test(body.slice(0, start))) {
      const from = match.index + match[0].indexOf(body) + start + "stream".length;
      const begin = raw[from] === "\r" ? from + 2 : from + 1;
      const end = raw.indexOf("endstream", begin);
      stream = inflateSync(buffer.subarray(begin, end)).toString("latin1");
    }
    objects.set(Number(number), { dict: start === -1 ? body : body.slice(0, start), stream });
  }

  const cmapOf = (toUnicodeObject) => {
    const map = new Map();
    const cmap = objects.get(toUnicodeObject)?.stream ?? "";
    const decode = (hex) => String.fromCodePoint(...(hex.match(/.{4}/g) ?? []).map((unit) => parseInt(unit, 16)));
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, gid, unicode] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(gid, 16), decode(unicode));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      // React-PDF writes each range as `<from> <to> [<char> <char> ...]` (the standard single-start form is read too).
      for (const [, from, to, list, start] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:\[([^\]]*)\]|<([0-9a-f]+)>)/gi)) {
        const units = list ? [...list.matchAll(/<([0-9a-f]+)>/gi)].map((m) => decode(m[1])) : null;
        for (let gid = parseInt(from, 16); gid <= parseInt(to, 16); gid += 1) {
          map.set(gid, units ? units[gid - parseInt(from, 16)] : String.fromCodePoint(parseInt(start, 16) + (gid - parseInt(from, 16))));
        }
      }
    }
    return map;
  };

  const fonts = new Map(); // resource name -> glyph map
  for (const { dict } of objects.values()) {
    for (const [, name, number] of dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const toUnicode = objects.get(Number(number))?.dict.match(/\/ToUnicode (\d+) 0 R/)?.[1];
      if (toUnicode) fonts.set(name, cmapOf(Number(toUnicode)));
    }
  }

  // Pages in order (the /Kids of the page tree), each with its drawn text and how far down the page it is drawn.
  const kids = [...(raw.match(/\/Kids \[([^\]]*)\]/)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const pages = kids.map((pageNumber) => {
    const contents = Number(objects.get(pageNumber)?.dict.match(/\/Contents (\d+) 0 R/)?.[1]);
    const stream = objects.get(contents)?.stream ?? "";
    const runs = [];
    const offsets = [0]; // vertical offset of each open `q` level; a `cm` with d = 1 shifts the current one
    let font = null;
    const operations = /^(q|Q)$|^[-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+) [-\d.]+ ([-\d.]+) cm$|\/(F\d+) [\d.]+ Tf|\[((?:<[0-9a-f]+>|[-\d.\s])+)\] TJ|<([0-9a-f]+)> Tj/gim;
    for (const operation of stream.matchAll(operations)) {
      if (operation[1] === "q") offsets.push(offsets[offsets.length - 1]);
      else if (operation[1] === "Q") offsets.pop();
      else if (operation[2] !== undefined) {
        if (Number(operation[2]) === 1) offsets[offsets.length - 1] += Number(operation[3]);
      } else if (operation[4]) font = fonts.get(operation[4]);
      else {
        const hex = (operation[5] ?? operation[6]).match(/<([0-9a-f]+)>|^([0-9a-f]+)$/gi) ?? [];
        const text = hex
          .map((chunk) => chunk.replace(/[<>]/g, ""))
          .map((chunk) => (chunk.match(/.{4}/g) ?? []).map((gid) => font?.get(parseInt(gid, 16)) ?? "").join(""))
          .join("");
        runs.push({ text, y: offsets[offsets.length - 1] });
      }
    }
    return runs;
  });
  return pages;
}

const extractPdfText = (buffer) => extractPdfPages(buffer).flat().map((run) => run.text);

// ---- the dependency and the font --------------------------------------------------------------------------------

test("@react-pdf/renderer is installed and can render", async () => {
  const renderer = await import("@react-pdf/renderer");
  for (const name of ["Document", "Page", "View", "Text", "Font", "StyleSheet", "renderToBuffer"]) {
    assert.ok(name in renderer, name);
  }
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.match(pkg.dependencies["@react-pdf/renderer"], /^\^?4\./);
});

test("Inter is bundled as static TrueType files — Regular, Medium and SemiBold — with its licence", () => {
  const directory = new URL("./fonts/", import.meta.url);
  assert.deepEqual(
    readdirSync(directory).sort(),
    ["Inter-LICENSE.txt", "Inter-Medium.ttf", "Inter-Regular.ttf", "Inter-SemiBold.ttf"]
  );
  assert.deepEqual(PDF_FONT_FILES.map((f) => f.fontWeight), [400, 500, 600]);
  for (const { file } of PDF_FONT_FILES) {
    const bytes = readFileSync(new URL(`./fonts/${file}`, import.meta.url));
    assert.ok(bytes.length > 100_000, `${file} is the full font, not a stub`);
    assert.equal(bytes.readUInt32BE(0), 0x00010000, `${file} is a TrueType file`);
  }
  assert.match(readFileSync(new URL("./fonts/Inter-LICENSE.txt", import.meta.url), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/i);
  assert.equal(PDF_FONT_FAMILY, "Inter");
});

test("the bundled fonts have the rupee sign (U+20B9) and the digits and letters the invoice needs", async () => {
  const { default: fontkit } = await import("@react-pdf/font").then(() => import("fontkit")).catch(() => ({ default: null }));
  // fontkit is React-PDF's own dependency; read the glyph table directly from the file when it cannot be imported.
  for (const { file } of PDF_FONT_FILES) {
    const bytes = readFileSync(new URL(`./fonts/${file}`, import.meta.url));
    assert.ok(bytes.includes(Buffer.from("OS/2")) && bytes.includes(Buffer.from("cmap")), file);
    if (fontkit) {
      const font = fontkit.create(bytes);
      for (const character of ["₹", "0", "9", "A", "z", "&"]) assert.ok(font.hasGlyphForCodePoint(character.codePointAt(0)), `${file} ${character}`);
    }
  }
});

// ---- the generated PDF ------------------------------------------------------------------------------------------

test("the view model renders to a valid PDF", async () => {
  const pdf = await render();
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(pdf.subarray(-16).toString("latin1"), /%%EOF\s*$/);
  assert.ok(pdf.length > 5_000);
  // One A4 page.
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length, 1);
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/);
});

test("the PDF is set in the bundled Inter fonts — embedded, not a standard font", async () => {
  const text = (await render()).toString("latin1");
  assert.match(text, /\/FontName \/[A-Z]+\+Inter-Regular/);
  assert.match(text, /\/FontName \/[A-Z]+\+Inter-SemiBold/);
  assert.doesNotMatch(text, /\/BaseFont \/Helvetica/);
});

test("the PDF shows the basic invoice information, exactly as the view model has it", async () => {
  const shown = extractPdfText(await render());
  // A long line wraps into several drawn lines; compare the text as one run.
  const joined = shown.join(" ").replace(/\s+/g, " ");
  const doc = buildInvoiceDocument(invoice());

  for (const expected of [
    doc.business.name,
    "12 Temple Road, Chennai",
    doc.business.phone,
    doc.business.email,
    "Invoice No.",
    doc.number, // INV-790, from the one formatter
    "Payment Date",
    doc.paymentDate,
    "Invoice Date",
    doc.invoiceDate,
    "BILL TO",
    "Asha Rao",
    "Student ID: YC-000012",
    doc.customer.phone,
    "asha@example.com",
    "Total Amount",
  ]) {
    assert.ok(joined.includes(expected), `"${expected}" in ${JSON.stringify(shown)}`);
  }
  assert.ok(shown.some((line) => line.trim() === "INVOICE"), "the title is shown");
});

test("the rupee sign is drawn: the stored, formatted amount comes through with ₹", async () => {
  const doc = buildInvoiceDocument(invoice());
  assert.ok(doc.amounts.total.includes("₹"), "the view model's total carries the rupee sign");
  const shown = extractPdfText(await render());
  assert.ok(shown.some((line) => line.includes(doc.amounts.total)), `${doc.amounts.total} in ${JSON.stringify(shown)}`);
  assert.ok(shown.join("").includes("₹1,180.00"));
});

test("a Receipt title, a prefix and optional contact details follow the view model", async () => {
  const shown = extractPdfText(
    await render({ document_title: "receipt", invoice_prefix: "RC-", invoice_number: 12, business_address: null, business_phone: null, business_email: null, customer_phone: null, customer_email: null })
  ).join("\n");
  assert.ok(shown.includes("Receipt No."));
  assert.ok(shown.includes("RECEIPT"));
  assert.ok(shown.includes("RC-12"));
  assert.ok(!shown.includes("12 Temple Road"));
  assert.ok(!shown.includes("asha@example.com"));
});

// ---- the component's boundaries ---------------------------------------------------------------------------------

test("the PDF component takes the existing view model and nothing else", () => {
  const component = code("./invoice-pdf.js");
  assert.match(component, /export default function InvoicePdf\(\{ invoiceDocument: doc, images \}\)/);
  for (const field of ["doc.title", "doc.number", "doc.paymentDate", "doc.invoiceDate", "business.name", "customer.name", "customer.code", "amounts.total"]) {
    assert.ok(component.includes(field), field);
  }
});

test("it queries nothing, calculates nothing and formats nothing itself", () => {
  for (const file of ["./invoice-pdf.js", "./fonts.js"]) {
    const text = code(file);
    assert.doesNotMatch(text, /supabase|createClient|requireRole|from\("|\.rpc\(|fetch\(/i, file);
    assert.doesNotMatch(text, /\b(students?|memberships?|settings|bank[_-]accounts?|invoice-settings|center[_-]profile)\b/, file);
    assert.doesNotMatch(text, /Math\.|toFixed|Intl\.|formatCurrency|formatDate|formatInvoiceNumber|taxRate|splitTax|\* 100|\/ 100/, file);
  }
  // The only invoice import is none: it receives the built view model.
  const imports = [...code("./invoice-pdf.js").matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["react", "@react-pdf/renderer", "./fonts.js"]);
});

test("the shared layer is unchanged: buildInvoiceDocument still lives in lib/invoices and imports no renderer", () => {
  const builder = code("../invoice-document.js");
  assert.doesNotMatch(builder, /react-pdf|pdf\//i);
  assert.ok(existsSync(new URL("../invoice-document.js", import.meta.url)));
});

// ---- nothing else moved --------------------------------------------------------------------------------------------

test("the HTML document and Print know nothing of the PDF, and the page only links to it", () => {
  // The only thing under the invoice route folder is the PDF endpoint itself (Phase 6.4).
  assert.deepEqual(readdirSync(new URL("../../../app/memberships/[id]/invoice/pdf/", import.meta.url)), ["route.js"]);
  // The page links to the endpoint (Phase 6.5) but never builds a PDF itself; the document and Print know nothing of it.
  assert.doesNotMatch(source("../../../app/memberships/[id]/invoice/page.js"), /react-pdf|lib\/invoices\/pdf|invoice-pdf/i);
  for (const path of ["../../../app/memberships/[id]/invoice/invoice-document.js", "../../../app/memberships/[id]/invoice/print-invoice-button.js"]) {
    assert.doesNotMatch(source(path), /react-pdf|Download PDF|lib\/invoices\/pdf|invoice-pdf/i, path);
  }
  assert.match(source("../../../app/memberships/[id]/invoice/print-invoice-button.js"), /window\.print\(\)/);
});

// ==== Phase 6.2 - the complete layout (no images, no bank details, no signature yet) ======================

const runOf = (lines) => lines.join(" ").replace(/\s+/g, " ");
const pageCount = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

const TERMS = "Fees are non-refundable. Classes missed cannot be carried over.";

/** Enough terms to run over several pages: numbered clauses, so loss of any part is detectable. */
const longTerms = () =>
  Array.from({ length: 90 }, (_, i) => `Clause ${i + 1}: members agree to follow the studio rules and the instructor's guidance at all times.`).join("\n");

test("the items table shows the service, its period and the stored amounts", async () => {
  const doc = buildInvoiceDocument(invoice());
  const shown = extractPdfText(await render());
  const joined = runOf(shown);

  for (const heading of ["SERVICES", "BEFORE TAX", "TAX", "AMOUNT"]) {
    assert.ok(shown.some((line) => line.trim() === heading), heading);
  }
  assert.ok(joined.includes("Monthly Membership"));
  assert.ok(joined.includes(doc.line.period), doc.line.period);
  assert.ok(joined.includes(doc.amounts.taxable), "before tax");
  assert.ok(joined.includes(`${doc.amounts.tax.amount}`), "tax");
  assert.ok(joined.includes(`(${doc.amounts.tax.rate}%)`), "the combined rate beside the tax");
});

test("tax: Amount before tax, CGST, SGST, Total Tax and Total Amount — all from the view model", async () => {
  const doc = buildInvoiceDocument(invoice());
  const shown = extractPdfText(await render());
  const joined = runOf(shown);

  assert.deepEqual(doc.amounts.tax.components.map((c) => c.label), ["CGST", "SGST"]);
  for (const label of ["Amount before tax", "CGST @ 9%", "SGST @ 9%", "Total Tax", "Total Amount"]) {
    assert.ok(joined.includes(label), label);
  }
  // 1,180 at 18%: 180 of tax, 90 each, 1,000 before tax - every one with its rupee sign.
  for (const amount of ["₹1,000.00", "₹90.00", "₹180.00", "₹1,180.00"]) {
    assert.ok(joined.includes(amount), amount);
  }
  assert.equal(shown.filter((line) => line.includes("₹90.00")).length, 2, "CGST and SGST");

  // The lines come in the HTML invoice's order.
  const order = ["Amount before tax", "CGST @ 9%", "SGST @ 9%", "Total Tax", "Total Amount"].map((label) => joined.lastIndexOf(label));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("an odd amount of tax splits the way the view model says: CGST takes the extra paisa", async () => {
  const odd = invoice({ total_amount: 1000.01, taxable_amount: 847.46, tax_amount: 152.55 });
  const doc = buildInvoiceDocument(odd);
  const joined = runOf(extractPdfText(await render(odd)));

  const [cgst, sgst] = doc.amounts.tax.components.map((c) => c.amount);
  assert.notEqual(cgst, sgst);
  assert.ok(joined.includes(cgst), cgst);
  assert.ok(joined.includes(sgst));
});

test("tax off: no tax column, no CGST / SGST / Total Tax — just the total", async () => {
  const plain = { tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null, total_amount: 1180 };
  const shown = extractPdfText(await render(plain));
  const joined = runOf(shown);

  for (const gone of ["BEFORE TAX", "Amount before tax", "CGST", "SGST", "Total Tax", "(18%)", "₹90.00", "₹180.00", "₹1,000.00"]) {
    assert.ok(!joined.includes(gone), gone);
  }
  assert.ok(!shown.some((line) => line.trim() === "TAX"));
  assert.ok(joined.includes("Total Amount"));
  assert.ok(joined.includes("₹1,180.00"));
  assert.ok(shown.some((line) => line.trim() === "AMOUNT"));
});

test("the amounts match the HTML invoice's data: both are the one view model", async () => {
  const doc = buildInvoiceDocument(invoice());
  const joined = runOf(extractPdfText(await render()));
  for (const value of [doc.amounts.total, doc.amounts.taxable, doc.amounts.tax.amount, ...doc.amounts.tax.components.map((c) => c.amount)]) {
    assert.ok(joined.includes(value), value);
  }
  const component = code("./invoice-pdf.js");
  assert.doesNotMatch(component, /formatCurrency|toLocaleString|Intl\.|toFixed|Number\(|parseFloat/);
});

test("the stored terms are shown, with their line breaks", async () => {
  const shown = extractPdfText(await render({ terms: "First rule.\nSecond rule." }));
  assert.ok(shown.some((line) => line.trim() === "TERMS & CONDITIONS"));
  assert.ok(shown.some((line) => line.trim() === "First rule."));
  assert.ok(shown.some((line) => line.trim() === "Second rule."));
});

test("with no terms the heading is left out", async () => {
  const joined = runOf(extractPdfText(await render({ terms: null })));
  assert.ok(!joined.includes("TERMS"));
  assert.ok(joined.includes("Total Amount"));
});

test("a normal invoice is one A4 portrait page", async () => {
  const pdf = await render({ terms: TERMS });
  assert.equal(pageCount(pdf), 1);
  const [, width, height] = pdf.toString("latin1").match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).map(Number);
  assert.ok(Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1, `${width} x ${height}`);
  assert.ok(height > width, "portrait");
});

test("long terms run onto more pages, nothing is lost, and the totals are shown once and whole", async () => {
  const pdf = await render({ terms: longTerms() });
  assert.ok(pageCount(pdf) > 1, `${pageCount(pdf)} pages`);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.match(pdf.subarray(-16).toString("latin1"), /%%EOF\s*$/);

  const joined = runOf(extractPdfText(pdf));
  for (let clause = 1; clause <= 90; clause += 1) {
    assert.ok(joined.includes(`Clause ${clause}:`), `clause ${clause}`);
  }
  assert.ok(joined.includes("guidance at all times."), "to the very end");
  for (const once of ["Total Tax", "Total Amount", "CGST @ 9%", "SGST @ 9%", "Amount before tax"]) {
    assert.equal(joined.split(once).length - 1, 1, `${once} once`);
  }
  assert.equal(joined.split("Bill To".toUpperCase()).length - 1, 1, "the header is not repeated");
});

test("the items table and the totals block never split (wrap off), and short terms stay with the totals", () => {
  const component = code("./invoice-pdf.js");
  assert.match(component, /style: styles\.items, wrap: false/);
  assert.match(component, /style: styles\.totals, wrap: false/);
  assert.match(component, /key: "lower", style: styles\.lower, wrap: false/);
  assert.match(component, /key: "totals", style: styles\.totalsAbove, wrap: false/);
  assert.doesNotMatch(component, /wrap: !keepTogether/, "a row of terms beside totals is never allowed to split");
  assert.match(component, /TERMS_KEEP_TOGETHER_MAX/);
});

test("A4 portrait with the print layout's 14mm margin, in React-PDF primitives — no CSS or Tailwind", () => {
  const component = code("./invoice-pdf.js");
  assert.match(component, /size: "A4", orientation: "portrait"/);
  assert.match(component, /PAGE_PADDING = 40;/);
  assert.doesNotMatch(component, /className|tailwind|@media|rem\b|\bpx\b/);
});

test("the colours are the application's tokens, held once", () => {
  const component = code("./invoice-pdf.js");
  const globals = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
  for (const [token, name] of [["brand", "--brand"], ["background", "--background"], ["border", "--border"], ["textPrimary", "--text-primary"], ["textSecondary", "--text-secondary"]]) {
    const value = component.match(new RegExp(`${token}: "(#[0-9a-f]{6})"`, "i"))?.[1];
    assert.ok(value, token);
    assert.match(globals, new RegExp(`${name}:\\s*${value}`, "i"), `${token} matches ${name}`);
  }
  // Every other colour in the file is one of those five.
  assert.equal(new Set([...component.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase())).size, 5);
});

// ---- long terms: the terms never run under the totals --------------------------------------------------------------

const TOTALS_LABELS = ["Amount before tax", "CGST @ 9%", "SGST @ 9%", "Total Tax", "Total Amount"];

test("short terms sit beside the totals, in one block on the first page", async () => {
  const [page] = extractPdfPages(await render({ terms: TERMS }));
  const terms = page.find((run) => run.text.trim() === "TERMS & CONDITIONS");
  const totals = page.filter((run) => TOTALS_LABELS.includes(run.text));
  assert.equal(totals.length, 5);
  // The terms heading is level with the first totals line: side by side.
  assert.ok(Math.abs(terms.y - Math.min(...totals.map((run) => run.y))) < 12, `${terms.y} vs ${totals.map((r) => r.y)}`);
});

test("long terms: the totals come first, whole, and every terms line is drawn BELOW them — nothing is level with the totals", async () => {
  const pages = extractPdfPages(await render({ terms: longTerms() }));
  assert.ok(pages.length > 1);

  const first = pages[0];
  const totals = first.filter((run) => TOTALS_LABELS.includes(run.text));
  assert.equal(totals.length, 5, "all five totals lines are on the first page");
  const totalsTop = Math.min(...totals.map((run) => run.y));
  const totalsBottom = Math.max(...totals.map((run) => run.y));
  // The five lines are one compact block, not spread across the page.
  assert.ok(totalsBottom - totalsTop < 150, `${totalsBottom - totalsTop}`);

  const termsLines = first.filter((run) => /Clause \d+/.test(run.text) || run.text.trim() === "TERMS & CONDITIONS");
  assert.ok(termsLines.length > 5, "the terms begin on the first page");
  for (const line of termsLines) {
    assert.ok(line.y > totalsBottom + 4, `"${line.text.slice(0, 30)}" at ${line.y} is not below the totals (${totalsBottom})`);
  }
  // The terms heading is after the totals and the totals appear only on the first page.
  assert.ok(first.findIndex((run) => run.text === "Total Amount") < first.findIndex((run) => run.text.trim() === "TERMS & CONDITIONS"));
  for (const later of pages.slice(1)) assert.equal(later.filter((run) => TOTALS_LABELS.includes(run.text)).length, 0);
});

test("long terms flow across pages in order with no line lost, and later pages hold only terms", async () => {
  const pages = extractPdfPages(await render({ terms: longTerms() }));
  const clauses = pages.flatMap((page) => page.map((run) => run.text.match(/Clause (\d+):/)?.[1]).filter(Boolean)).map(Number);
  assert.deepEqual(clauses, Array.from({ length: 90 }, (_, i) => i + 1));
  for (const later of pages.slice(1)) {
    assert.ok(later.length > 0 && later.every((run) => /Clause \d+|guidance|all times|rules|instructor|members|studio/.test(run.text)), "only terms text");
  }
});

// ==== Phase 6.3 - logo, bank details, signature, and image handling =========================================

import { crc32, deflateSync } from "node:zlib";
import { loadPdfImage, loadInvoicePdfImages, sniffImageFormat, PDF_IMAGE_MAX_BYTES } from "./images.js";
import { renderInvoicePdf } from "./render.js";

/** A real PNG of the given size and colour, built by hand (signature, IHDR, IDAT, IEND). */
function makePng(width = 8, height = 4, [r, g, b] = [30, 64, 175]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

/** Looks like a PNG (so it passes the first-bytes check) but cannot be decoded. */
const corruptPng = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this is not a png at all")]);

const imageObjects = (pdf) => (pdf.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;

const BANK_FIELDS = {
  bank_name: "HDFC Bank",
  bank_account_name: "Sri Yoga Center",
  bank_account_number: "50100123456789",
  bank_ifsc_code: "HDFC0001234",
  bank_branch: "Chennai Main",
};
const SIGNATORY = { signatory_name: "R. Kumar", signatory_designation: "Director" };

const fakeFetch = (response) => async () => (response instanceof Error ? Promise.reject(response) : response);
const okResponse = (bytes, headers = {}) => ({
  ok: true,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

// ---- loading the images --------------------------------------------------------------------------------------------

test("a PNG or JPEG link becomes image bytes; the format comes from the file's own first bytes", async () => {
  const png = await loadPdfImage("https://example.test/logo", { fetchImpl: fakeFetch(okResponse(makePng())) });
  assert.equal(png.format, "png");
  assert.ok(Buffer.isBuffer(png.data));

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
  assert.equal((await loadPdfImage("https://example.test/s", { fetchImpl: fakeFetch(okResponse(jpeg)) })).format, "jpg");
  assert.equal(sniffImageFormat(Buffer.from("RIFF....WEBPVP8 ")), null, "WebP cannot be embedded");
});

test("a missing link, a failed fetch, a wrong kind of file or an oversized one is null — never a throw", async () => {
  assert.equal(await loadPdfImage(null), null);
  assert.equal(await loadPdfImage(""), null);
  assert.equal(await loadPdfImage("https://example.test/x", { fetchImpl: fakeFetch({ ok: false, headers: { get: () => null } }) }), null);
  assert.equal(await loadPdfImage("https://example.test/x", { fetchImpl: fakeFetch(new Error("network down")) }), null);
  assert.equal(await loadPdfImage("https://example.test/x", { fetchImpl: fakeFetch(okResponse(Buffer.from("<html>not an image</html>"))) }), null);
  assert.equal(await loadPdfImage("https://example.test/x", { fetchImpl: fakeFetch(okResponse(makePng(), { "content-length": String(PDF_IMAGE_MAX_BYTES + 1) })) }), null);
  assert.equal(await loadPdfImage("https://example.test/x", { fetchImpl: fakeFetch(okResponse(Buffer.alloc(0))) }), null);
});

test("the logo and signature load independently: one failing leaves the other", async () => {
  const fetchImpl = async (url) => (url.includes("logo") ? okResponse(makePng()) : { ok: false, headers: { get: () => null } });
  const images = await loadInvoicePdfImages({ logoUrl: "https://example.test/logo", signatureUrl: "https://example.test/sig" }, { fetchImpl });
  assert.equal(images.logo.format, "png");
  assert.equal(images.signature, null);
  assert.deepEqual(await loadInvoicePdfImages({}), { logo: null, signature: null });
});

// ---- the logo -----------------------------------------------------------------------------------------------------------

test("the logo is drawn in the header when given — and the text identity stays", async () => {
  const doc = buildInvoiceDocument(invoice());
  const pdf = await renderInvoicePdf(doc, { logo: { data: makePng(), format: "png" } });
  assert.equal(imageObjects(pdf), 1);
  assert.equal(pageCount(pdf), 1);
  const joined = runOf(extractPdfText(pdf));
  for (const kept of [doc.business.name, "12 Temple Road, Chennai", doc.business.phone, doc.business.email, "INVOICE", doc.number]) assert.ok(joined.includes(kept), kept);

  // The logo sits in the header's identity row, beside the business name, before the band.
  const [page] = extractPdfPages(pdf);
  const name = page.find((run) => run.text === doc.business.name);
  const band = page.find((run) => run.text === "Invoice No.");
  assert.ok(name.y < band.y);
});

test("without a logo the header is the text identity, exactly as in 6.2", async () => {
  const pdf = await renderInvoicePdf(buildInvoiceDocument(invoice()), {});
  assert.equal(imageObjects(pdf), 0);
  assert.ok(runOf(extractPdfText(pdf)).includes("Sri Yoga Center"));
});

test("a logo that cannot be decoded is left out and the PDF is still produced", async () => {
  const doc = buildInvoiceDocument(invoice(SIGNATORY));
  const pdf = await renderInvoicePdf(doc, { logo: { data: corruptPng(), format: "png" }, signature: null });
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(imageObjects(pdf), 0);
  const joined = runOf(extractPdfText(pdf));
  assert.ok(joined.includes("Sri Yoga Center") && joined.includes("R. Kumar") && joined.includes("Total Amount"));
});

// ---- the signature -----------------------------------------------------------------------------------------------------

test("the signature image, name, designation and Authorized Signatory label are drawn", async () => {
  const doc = buildInvoiceDocument(invoice(SIGNATORY));
  const pdf = await renderInvoicePdf(doc, { signature: { data: makePng(20, 8, [0, 0, 0]), format: "png" } });
  assert.equal(imageObjects(pdf), 1);
  const joined = runOf(extractPdfText(pdf));
  for (const shown of ["R. Kumar", "Director", "AUTHORIZED SIGNATORY FOR SRI YOGA CENTER".replace("SRI YOGA CENTER", "Sri Yoga Center")]) {
    assert.ok(joined.toLowerCase().includes(shown.toLowerCase()), shown);
  }
});

test("without a signature image the name, designation and label remain, and the PDF succeeds", async () => {
  const pdf = await renderInvoicePdf(buildInvoiceDocument(invoice(SIGNATORY)), { signature: null });
  assert.equal(imageObjects(pdf), 0);
  const joined = runOf(extractPdfText(pdf));
  assert.ok(joined.includes("R. Kumar") && joined.includes("Director") && /authorized signatory for sri yoga center/i.test(joined));
});

test("a signature that cannot be decoded is left out only — the name, designation and label stay, and a good logo is kept", async () => {
  const pdf = await renderInvoicePdf(buildInvoiceDocument(invoice(SIGNATORY)), {
    logo: { data: makePng(), format: "png" },
    signature: { data: corruptPng(), format: "png" },
  });
  assert.equal(imageObjects(pdf), 1, "the logo survives");
  const joined = runOf(extractPdfText(pdf));
  assert.ok(joined.includes("R. Kumar") && joined.includes("Director") && /authorized signatory/i.test(joined));
});

test("both images undecodable: still a valid PDF with all the text", async () => {
  const pdf = await renderInvoicePdf(buildInvoiceDocument(invoice(SIGNATORY)), {
    logo: { data: corruptPng(), format: "png" },
    signature: { data: corruptPng(), format: "png" },
  });
  assert.equal(imageObjects(pdf), 0);
  assert.match(pdf.subarray(-16).toString("latin1"), /%%EOF\s*$/);
  assert.ok(runOf(extractPdfText(pdf)).includes("R. Kumar"));
});

test("with no signatory details and no image there is no signature block at all", async () => {
  const joined = runOf(extractPdfText(await renderInvoicePdf(buildInvoiceDocument(invoice()), {})));
  assert.ok(!/authorized signatory/i.test(joined));
});

// ---- bank details ---------------------------------------------------------------------------------------------------------

test("a stored bank snapshot is drawn in full: heading, bank, account name, the whole account number, IFSC, branch", async () => {
  const joined = runOf(extractPdfText(await renderInvoicePdf(buildInvoiceDocument(invoice(BANK_FIELDS)), {})));
  for (const shown of ["BANK DETAILS", "Bank", "HDFC Bank", "A/C Name", "Sri Yoga Center", "A/C No.", "50100123456789", "IFSC", "HDFC0001234", "Branch", "Chennai Main"]) {
    assert.ok(joined.includes(shown), shown);
  }
});

test("no branch stored: the Branch row is left out", async () => {
  const joined = runOf(extractPdfText(await renderInvoicePdf(buildInvoiceDocument(invoice({ ...BANK_FIELDS, bank_branch: null })), {})));
  assert.ok(joined.includes("HDFC0001234"));
  assert.ok(!joined.includes("Branch"));
});

test("an invoice with no bank snapshot (every field NULL, or the fields absent) has no Bank Details", async () => {
  for (const overrides of [{ bank_name: null, bank_account_name: null, bank_account_number: null, bank_ifsc_code: null, bank_branch: null }, {}]) {
    const joined = runOf(extractPdfText(await renderInvoicePdf(buildInvoiceDocument(invoice({ ...SIGNATORY, ...overrides })), {})));
    assert.ok(!/bank details/i.test(joined));
    assert.ok(joined.includes("R. Kumar"), "the signatory still shows");
  }
});

test("bank details come from the stored snapshot only: another bank's name never appears", async () => {
  const joined = runOf(extractPdfText(await renderInvoicePdf(buildInvoiceDocument(invoice(BANK_FIELDS)), {})));
  assert.ok(!joined.includes("ICICI"));
  const sources = ["./invoice-pdf.js", "./images.js", "./render.js"].map(code).join("\n");
  assert.doesNotMatch(sources, /bank_accounts|bank-accounts|getBankAccount|from\("bank|invoice_settings|invoice-settings|center-profile|getCenter/i);
});

// ---- the footer layout ----------------------------------------------------------------------------------------------------

test("footer: bank details on the left, the signatory on the right, level, after the totals and the terms", async () => {
  const pdf = await renderInvoicePdf(buildInvoiceDocument(invoice({ ...BANK_FIELDS, ...SIGNATORY, terms: TERMS })), {
    logo: { data: makePng(), format: "png" },
    signature: { data: makePng(20, 8, [0, 0, 0]), format: "png" },
  });
  assert.equal(pageCount(pdf), 1, "a full invoice with both images is still one page");

  const [page] = extractPdfPages(pdf);
  const at = (text) => page.find((run) => run.text.trim() === text);
  const totalAmount = at("Total Amount");
  const bankHeading = at("BANK DETAILS");
  const signatoryName = at("R. Kumar");
  assert.ok(bankHeading.y > totalAmount.y, "below the totals");
  assert.ok(bankHeading.y > at("TERMS & CONDITIONS").y, "below the terms");
  assert.ok(signatoryName.y >= bankHeading.y - 1 && signatoryName.y < bankHeading.y + 80, "the signatory shares the footer row");
  // Draw order: bank column before the signatory column.
  const order = page.map((run) => run.text.trim());
  assert.ok(order.indexOf("BANK DETAILS") < order.indexOf("R. Kumar"));
});

test("long terms: the footer follows the last clause, on the last page, once", async () => {
  const pdf = await renderInvoicePdf(buildInvoiceDocument(invoice({ ...BANK_FIELDS, ...SIGNATORY, terms: longTerms() })), {
    signature: { data: makePng(20, 8, [0, 0, 0]), format: "png" },
  });
  const pages = extractPdfPages(pdf);
  assert.ok(pages.length > 1);
  const last = pages[pages.length - 1];
  const lastTexts = last.map((run) => run.text.trim());
  assert.ok(lastTexts.includes("BANK DETAILS") && lastTexts.includes("R. Kumar"));
  const lastClause = Math.max(...last.map((run) => run.y).filter((_, i) => /Clause/.test(last[i].text)));
  assert.ok(last.find((run) => run.text.trim() === "BANK DETAILS").y > lastClause);
  assert.equal(pages.flat().filter((run) => run.text.trim() === "BANK DETAILS").length, 1);
  assert.equal(pages.flat().filter((run) => run.text.trim() === "R. Kumar").length, 1);
});

test("the footer block never splits (bank and signatory stay together)", () => {
  assert.match(code("./invoice-pdf.js"), /style: styles\.footer, wrap: false/);
});

// ---- boundaries ---------------------------------------------------------------------------------------------------------------

test("the PDF component draws what it is given: no fetching, no storage, no database, no calculation", () => {
  const component = code("./invoice-pdf.js");
  assert.doesNotMatch(component, /fetch\(|supabase|storage|signed|getPublicUrl|process\.env/i);
  assert.deepEqual([...component.matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]), ["react", "@react-pdf/renderer", "./fonts.js"]);
  assert.match(component, /doc\.bank/);
  assert.match(component, /doc\.signatory/);
});

test("the image loader holds no database or path knowledge and logs nothing (links are secret)", () => {
  const loader = code("./images.js");
  assert.doesNotMatch(loader, /supabase|createClient|requireRole|from\("|storage|signature_path|business_logo_path|console\./i);
  assert.deepEqual([...loader.matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]), []);
  assert.doesNotMatch(code("./render.js"), /supabase|requireRole|console\./i);
});

test("the PDF code is imported by the endpoint only - not the page, the document or the panel", () => {
  // The only thing under the invoice route folder is the PDF endpoint itself (Phase 6.4).
  assert.deepEqual(readdirSync(new URL("../../../app/memberships/[id]/invoice/pdf/", import.meta.url)), ["route.js"]);
  // The page links to the endpoint (Phase 6.5) but never builds a PDF itself; the document and Print know nothing of it.
  assert.doesNotMatch(source("../../../app/memberships/[id]/invoice/page.js"), /react-pdf|lib\/invoices\/pdf|invoice-pdf/i);
  for (const path of ["../../../app/memberships/[id]/invoice/invoice-document.js", "../../../app/memberships/[id]/invoice/print-invoice-button.js"]) {
    assert.doesNotMatch(source(path), /react-pdf|Download PDF|lib\/invoices\/pdf|invoice-pdf/i, path);
  }
});

// ---- membership service details (migration 0033) -----------------------------------------------------------------

const slot = (day_of_week, start_time = "08:15", end_time = "09:15") => ({ day_of_week, start_time, end_time });
const WEEKDAY_SLOTS = ["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => slot(day));
const oneBatch = { version: 1, as_of: "2026-10-01", batches: [{ batch_id: "b1", name: "Hatha Yoga Intermediate", code: "HYI", slots: WEEKDAY_SLOTS }] };
const twoBatches = {
  version: 1,
  as_of: "2026-10-01",
  batches: [oneBatch.batches[0], { batch_id: "b2", name: "Hatha Yoga", code: "HY", slots: [slot("saturday", "07:00", "08:00")] }],
};

test("a receipt without service details prints the same service lines as before", async () => {
  const shown = extractPdfText(await render({ service_details: null }));
  const joined = runOf(shown);
  assert.ok(joined.includes("Monthly Membership"));
  assert.ok(joined.includes("Oct 01, 2026 – Oct 31, 2026") || joined.includes(buildInvoiceDocument(invoice()).line.period));
  assert.ok(!joined.includes("Sl. No."));
  assert.ok(!joined.includes(" · "));
});

test("one batch: the batch, the plan, the schedule and the period, with no numbering", async () => {
  const joined = runOf(extractPdfText(await render({ service_details: oneBatch })));
  const at = (value) => joined.indexOf(value);
  assert.ok(at("Hatha Yoga Intermediate") >= 0 && at("Monthly Membership") > at("Hatha Yoga Intermediate"), "batch above the plan");
  assert.ok(at("Mon–Fri · 8:15 AM–9:15 AM") > at("Monthly Membership"), "schedule below the plan");
  assert.ok(at(buildInvoiceDocument(invoice()).line.period) > at("Mon–Fri · 8:15 AM–9:15 AM"), "period last");
  assert.ok(!joined.includes("Sl. No."));
  assert.ok(!joined.includes("Duration"));
});

test("several batches: the plan and period, then a stacked, numbered entry per batch - no table", async () => {
  const joined = runOf(extractPdfText(await render({ service_details: twoBatches })));
  for (const expected of ["1. Hatha Yoga Intermediate", "Mon–Fri · 8:15 AM–9:15 AM", "2. Hatha Yoga", "Sat · 7:00 AM–8:00 AM"]) {
    assert.ok(joined.includes(expected), expected);
  }
  assert.ok(joined.indexOf("Monthly Membership") < joined.indexOf("1. Hatha Yoga Intermediate"), "plan before the entries");
  for (const header of ["Sl. No.", "Batch / Class"]) assert.ok(!joined.includes(header), `no "${header}" header`);
});

test("the financial columns are the same with and without service details", async () => {
  const bare = runOf(extractPdfText(await render({ service_details: null })));
  const withDetails = runOf(extractPdfText(await render({ service_details: twoBatches })));
  const doc = buildInvoiceDocument(invoice());
  for (const value of [doc.amounts.total, doc.amounts.taxable, doc.amounts.tax.amount, `(${doc.amounts.tax.rate}%)`, "SERVICES", "BEFORE TAX", "AMOUNT"]) {
    assert.ok(bare.includes(value) && withDetails.includes(value), value);
  }
});

// ---- the classes list is a separate full-width block, not a table inside the Services cell ------------------------

const slotsOf = (days, start, end) => days.map((day_of_week) => ({ day_of_week, start_time: start, end_time: end }));
const MWF = ["monday", "wednesday", "friday"];
const MON_FRI = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const threeBatches = {
  version: 1,
  as_of: "2026-12-01",
  batches: [
    { batch_id: "b1", name: "Advanced Yoga", code: "AY", slots: slotsOf(MWF, "10:30", "11:30") },
    { batch_id: "b2", name: "Hatha Yoga", code: "HY", slots: slotsOf(MON_FRI, "07:00", "08:00") },
    { batch_id: "b3", name: "Yoga Therapy", code: "YT", slots: slotsOf(MWF, "16:00", "17:00") },
  ],
};

test("several batches: each schedule is drawn as ONE intact line, never split into day and time fragments", async () => {
  const shown = extractPdfText(await render({ service_details: threeBatches }));
  for (const schedule of ["Mon, Wed, Fri · 10:30 AM–11:30 AM", "Mon–Fri · 7:00 AM–8:00 AM", "Mon, Wed, Fri · 4:00 PM–5:00 PM"]) {
    assert.ok(shown.some((line) => line.includes(schedule)), `"${schedule}" is one drawn line in ${JSON.stringify(shown)}`);
  }
  // No broken vertical text: none of the fragments of a schedule is drawn on a line of its own.
  for (const fragment of ["Mon,", "Wed,", "Fri", "·", "10:30", "AM–11:30", "AM"]) {
    assert.ok(!shown.some((line) => line.trim() === fragment), `"${fragment}" must not be a line by itself`);
  }
});

test("several batches: number and name on one line, its schedule beneath, entries in order", async () => {
  const shown = extractPdfText(await render({ service_details: threeBatches }));
  const joined = runOf(shown);
  const order = ["1. Advanced Yoga", "Mon, Wed, Fri · 10:30 AM–11:30 AM", "2. Hatha Yoga", "Mon–Fri · 7:00 AM–8:00 AM", "3. Yoga Therapy", "Mon, Wed, Fri · 4:00 PM–5:00 PM"];
  let at = -1;
  for (const part of order) {
    const found = joined.indexOf(part, at + 1);
    assert.ok(found > at, `"${part}" after the previous part in ${joined}`);
    at = found;
  }
  // (The text extractor reports a glyph run per font chunk - "1. " then the name, as it does "12 " then "Temple Road" in the
  // address - so the single-line placement is checked in the rasterised PDF, not here.)
  for (const heading of ["Sl. No.", "Batch / Class"]) assert.ok(!shown.some((line) => line.includes(heading)), heading);
});

test("several batches: the service row keeps its tax columns and the totals are intact", async () => {
  const doc = buildInvoiceDocument(invoice({ service_details: threeBatches }));
  const shown = extractPdfText(await render({ service_details: threeBatches }));
  const joined = runOf(shown);
  for (const value of ["SERVICES", "BEFORE TAX", "TAX", "AMOUNT"]) assert.ok(shown.some((line) => line.trim() === value), value);
  for (const value of ["Monthly Membership", doc.line.period, doc.amounts.taxable, doc.amounts.tax.amount, `(${doc.amounts.tax.rate}%)`, doc.amounts.total, "Total Amount", "CGST", "SGST"]) {
    assert.ok(joined.includes(value), value);
  }
  // The plan and period come first in the Services content, the entries after them, and all before the totals.
  assert.ok(joined.indexOf("Monthly Membership") < joined.indexOf(doc.line.period));
  assert.ok(joined.indexOf(doc.line.period) < joined.indexOf("1. Advanced Yoga"));
  assert.ok(joined.indexOf("3. Yoga Therapy") < joined.indexOf("Total Amount"));
});

test("the multi-batch list is stacked text in the Services cell: no table, no column headers, one Text per schedule group", () => {
  const renderer = code("./invoice-pdf.js");
  const cell = renderer.slice(renderer.indexOf("function serviceCell("), renderer.indexOf("function itemsTable("));
  // Numbered entry: number and name in one Text; each schedule group its own Text, indented.
  assert.match(cell, /text\(styles\.batchEntry, `\$\{row\.number\}\. \$\{row\.batch\}`\)/);
  assert.match(cell, /row\.schedule\.map\(\(schedule\) => text\(\[styles\.secondary, styles\.batchSchedule\], schedule\)\)/);
  assert.match(renderer, /batchSchedule: \{ paddingLeft: 14 \}/);
  // No table, no headers, no per-fragment Text, no separate block.
  assert.doesNotMatch(renderer, /classesBlock|classesHead|classesRow|numberColumn|batchColumn|scheduleColumn|Sl\. No\.|Batch \/ Class/);
  assert.doesNotMatch(cell, /<View|h\(\s*View/);
  assert.doesNotMatch(renderer, /position: "absolute"/);
});

test("a long entry wraps inside the Services column; the amount columns keep their width and stay under their headings", () => {
  const renderer = code("./invoice-pdf.js");
  assert.match(renderer, /serviceColumn: \{ flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 \}/);
  assert.match(renderer, /amountColumn: \{ width: AMOUNT_COLUMN_WIDTH, flexShrink: 0,/);
  assert.match(renderer, /amountCell: \{ width: AMOUNT_COLUMN_WIDTH, flexShrink: 0,/);
});

test("a single batch keeps the compact layout inside the Services cell, with no list block", async () => {
  const joined = runOf(extractPdfText(await render({ service_details: oneBatch })));
  assert.ok(joined.indexOf("Hatha Yoga Intermediate") < joined.indexOf("Monthly Membership"));
  assert.ok(joined.includes("Mon–Fri · 8:15 AM–9:15 AM"));
  assert.ok(!joined.includes("Sl. No.") && !joined.includes("Batch / Class"));
});

test("a tax-on receipt with several batches shows the combined rate beside the tax and CGST / SGST in the totals", async () => {
  const joined = runOf(extractPdfText(await render({ service_details: threeBatches, tax_enabled: true })));
  assert.ok(joined.includes("(18%)"));
  assert.ok(joined.includes("CGST @ 9%") && joined.includes("SGST @ 9%"));
});

test("a tax-off receipt with several batches shows only the total and still lists the classes", async () => {
  const shown = extractPdfText(await render({ service_details: threeBatches, tax_enabled: false, tax_name: null, tax_rate: null, taxable_amount: null, tax_amount: null }));
  assert.ok(!shown.some((line) => line.trim() === "TAX"));
  assert.ok(shown.some((line) => line.trim() === "AMOUNT"));
  assert.ok(runOf(shown).includes("Mon–Fri · 7:00 AM–8:00 AM"));
});

test("a long batch name wraps inside its own column; its schedule stays one intact line", async () => {
  const longName = "Advanced Therapeutic Restorative Yoga for Back Care and Posture Correction";
  const details = { version: 1, as_of: "2026-12-01", batches: [{ batch_id: "b1", name: longName, code: "L", slots: slotsOf(MWF, "10:30", "11:30") }, threeBatches.batches[1]] };
  const shown = extractPdfText(await render({ service_details: details }));
  assert.ok(runOf(shown).includes(longName), "the whole name is drawn");
  assert.ok(shown.some((line) => line.includes("Mon, Wed, Fri · 10:30 AM–11:30 AM")), "the schedule is one line");
});

test("a batch with several times draws each time on its own line of the one schedule cell, every line intact", async () => {
  const slots = [...slotsOf(MON_FRI, "06:00", "07:00"), ...slotsOf(["monday", "wednesday"], "18:00", "19:00"), ...slotsOf(["saturday"], "07:30", "09:00"), ...slotsOf(["sunday"], "08:00", "10:00")];
  const details = { version: 1, as_of: "2026-12-01", batches: [{ batch_id: "b1", name: "Flow", code: "F", slots }, threeBatches.batches[0]] };
  const shown = extractPdfText(await render({ service_details: details }));
  for (const line of ["Mon–Fri · 6:00 AM–7:00 AM", "Mon, Wed · 6:00 PM–7:00 PM", "Sat · 7:30 AM–9:00 AM", "Sun · 8:00 AM–10:00 AM"]) {
    assert.ok(shown.some((drawn) => drawn.includes(line)), `"${line}" intact in ${JSON.stringify(shown)}`);
  }
});

test("a receipt with NULL service details is drawn exactly as before: plan and period only", async () => {
  const joined = runOf(extractPdfText(await render({ service_details: null })));
  assert.ok(joined.includes("Monthly Membership") && joined.includes(buildInvoiceDocument(invoice()).line.period));
  assert.ok(!joined.includes("Sl. No.") && !joined.includes(" · "));
});
