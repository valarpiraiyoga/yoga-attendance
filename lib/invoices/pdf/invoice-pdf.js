import { createElement as h } from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY, registerPdfFonts } from "./fonts.js";

/**
 * The invoice as a PDF (React-PDF): the business identity (with the logo) and document title, the
 * number-and-dates band, Bill To, the items table, the terms, the totals with the CGST / SGST
 * lines, and the footer - the stored bank details on the left, the authorized signatory (with the
 * signature) on the right.
 *
 * It renders ONLY the view model that `buildInvoiceDocument` (lib/invoices/invoice-document.js)
 * builds from the stored invoice row - the same one the HTML Invoice Detail shows - plus the two
 * images made from the paths that same invoice stored (`images`, from ./images.js). An image that
 * is not given is simply not drawn: the text identity and the signatory's name stay. It queries
 * nothing, calculates nothing and formats nothing itself: every amount, rate, date and number
 * below is a string the view model already holds, and the CGST / SGST split is the view model's
 * own. It is renderer-specific on purpose (React-PDF has its own primitives and cannot draw the
 * HTML / Tailwind document); the values and the colours are what is shared.
 *
 * A4 portrait with the 14mm margin of the print layout. A normal invoice is one page. The items
 * table never splits. Two arrangements of the terms and the totals:
 *   - short terms (TERMS_KEEP_TOGETHER_MAX): terms on the left, totals on the right, side by side,
 *     as one block that moves to the next page whole if it does not fit;
 *   - long terms: the totals first, right-aligned and unbroken, then the terms across the full
 *     width, flowing onto as many pages as they need. They are never side by side, because a
 *     side-by-side row cannot be split across pages without the terms running under the totals.
 *
 * Written with `createElement` rather than JSX so the plain Node test runner can import and
 * render it.
 */

// The application's own tokens (app/globals.css), as the PDF uses them.
const COLORS = Object.freeze({
  brand: "#1e40af",
  background: "#f5f7fb",
  border: "#e4e7ec",
  textPrimary: "#1f2933",
  textSecondary: "#667085",
});

// A4 with the 14mm margin the print layout uses (14mm = 39.7pt).
const PAGE_PADDING = 40;

// Type sizes in points (the HTML's 12 / 14 / 24px at print scale).
const FONT_SIZE = Object.freeze({ small: 9, body: 10, title: 15 });

// Widths of the amount columns of the items table, and of the totals block.
const AMOUNT_COLUMN_WIDTH = 84;
const TOTALS_WIDTH = 230;

// Terms up to this many characters sit beside the totals as one block that moves to the next page
// whole if it does not fit; longer terms go below the totals and flow across pages. A presentation
// threshold only.
const TERMS_KEEP_TOGETHER_MAX = 900;

const styles = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY,
    fontSize: FONT_SIZE.body,
    lineHeight: 1.4,
    color: COLORS.textPrimary,
    padding: PAGE_PADDING,
  },
  frame: {
    borderTopWidth: 2,
    borderTopColor: COLORS.brand,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingTop: 20,
    paddingBottom: 16,
  },
  businessName: { fontSize: FONT_SIZE.title, fontWeight: 600, color: COLORS.brand, lineHeight: 1.4, marginBottom: 4 },
  secondary: { fontSize: FONT_SIZE.small, color: COLORS.textSecondary },
  documentTitle: { fontSize: FONT_SIZE.title, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", textAlign: "right" },
  band: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  metaLabel: { fontSize: FONT_SIZE.small, color: COLORS.textSecondary },
  metaValue: { fontSize: FONT_SIZE.body, fontWeight: 600 },
  section: { paddingTop: 16, paddingBottom: 12 },
  sectionHeading: { fontSize: FONT_SIZE.small, fontWeight: 500, letterSpacing: 0.6, textTransform: "uppercase", color: COLORS.textSecondary },
  customerName: { fontSize: FONT_SIZE.body, fontWeight: 600, marginTop: 3 },

  items: { marginTop: 4 },
  itemsHead: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 6,
  },
  itemsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 10,
  },
  columnHeading: { fontSize: FONT_SIZE.small, fontWeight: 500, letterSpacing: 0.6, textTransform: "uppercase", color: COLORS.textSecondary },
  serviceColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 },
  amountColumn: { width: AMOUNT_COLUMN_WIDTH, flexShrink: 0, textAlign: "right" },
  serviceName: { fontWeight: 500 },
  // Several batches: a numbered, stacked entry per batch in the Services cell - the number and name on one
  // line, the schedule line(s) indented beneath.
  batchEntry: { marginTop: 6 },
  batchSchedule: { paddingLeft: 14 },
  amountCell: { width: AMOUNT_COLUMN_WIDTH, flexShrink: 0, alignItems: "flex-end" },
  amountText: { textAlign: "right" },
  amountStrong: { textAlign: "right", fontWeight: 500 },

  lower: { flexDirection: "row", justifyContent: "space-between", paddingTop: 16, paddingBottom: 12 },
  terms: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 24 },
  termsFull: { paddingBottom: 12 },

  logo: { height: 48, maxWidth: 96, objectFit: "contain", marginRight: 12 },
  identityRow: { flexDirection: "row", alignItems: "flex-start", flexGrow: 1, flexShrink: 1, paddingRight: 16 },
  identityText: { flexGrow: 1, flexShrink: 1 },

  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingTop: 4, paddingBottom: 8 },
  bank: { flexGrow: 1, flexShrink: 1, paddingRight: 24 },
  bankLine: { flexDirection: "row", fontSize: FONT_SIZE.small, marginTop: 1 },
  bankLabel: { width: 52, color: COLORS.textSecondary },
  bankValue: { flexGrow: 1, flexShrink: 1 },
  signatory: { width: TOTALS_WIDTH, alignItems: "flex-end" },
  signature: { height: 48, maxWidth: 160, objectFit: "contain", marginBottom: 6 },
  signatoryName: { fontWeight: 600, textAlign: "right" },
  signatoryLabel: { fontSize: FONT_SIZE.small, letterSpacing: 0.4, textTransform: "uppercase", color: COLORS.textSecondary, marginTop: 3, textAlign: "right" },
  totalsAbove: { alignItems: "flex-end", paddingTop: 16, paddingBottom: 16 },
  termsText: { fontSize: FONT_SIZE.small, marginTop: 3 },
  totals: { width: TOTALS_WIDTH, flexShrink: 0 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 },
  totalLabel: { color: COLORS.textSecondary },
  totalValue: { fontWeight: 500 },
  totalTaxRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 3,
    paddingTop: 6,
  },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 3,
    paddingTop: 8,
  },
  grandLabel: { fontWeight: 600 },
  grandValue: { fontSize: FONT_SIZE.title, fontWeight: 600 },
});

registerPdfFonts();

const text = (style, value) => h(Text, { style }, value);

/** A label above its value, in the metadata band. */
function meta(label, value, align) {
  return h(View, { style: { flexBasis: 0, flexGrow: 1, alignItems: align } }, text(styles.metaLabel, label), text(styles.metaValue, value));
}

/** One line of the totals block: a label and its right-aligned amount. */
function totalLine(rowStyle, labelStyle, valueStyle, label, value) {
  return h(View, { key: label, style: rowStyle }, text(labelStyle, label), text(valueStyle, value));
}

/**
 * The Services cell: the description and period as ever. With stored service details of ONE batch, the
 * batch above the plan and its schedule below it. With SEVERAL, the plan and period, then a stacked,
 * numbered entry per batch - "1. Advanced Yoga" on one line and each of its schedule lines (one Text
 * per time group, so a line wraps only if it truly exceeds the cell) indented beneath. No table.
 */
function serviceCell(line) {
  const { service } = line;
  if (!service) return [text(styles.serviceName, line.description), text(styles.secondary, line.period)];

  if (service.table) {
    return [
      text(styles.serviceName, line.description),
      text(styles.secondary, line.period),
      ...service.table.flatMap((row) => [
        text(styles.batchEntry, `${row.number}. ${row.batch}`),
        ...row.schedule.map((schedule) => text([styles.secondary, styles.batchSchedule], schedule)),
      ]),
    ];
  }

  return [
    text(styles.serviceName, service.lead),
    text(styles.secondary, line.description),
    ...service.schedule.map((schedule) => text(styles.secondary, schedule)),
    text(styles.secondary, line.period),
  ];
}

function itemsTable(doc) {
  const { line, amounts } = doc;
  const tax = amounts.tax;

  return h(
    View,
    { style: styles.items, wrap: false },
    h(
      View,
      { style: styles.itemsHead },
      text([styles.columnHeading, styles.serviceColumn], "Services"),
      tax ? text([styles.columnHeading, styles.amountColumn], "Before tax") : null,
      tax ? text([styles.columnHeading, styles.amountColumn], "Tax") : null,
      text([styles.columnHeading, styles.amountColumn], "Amount")
    ),
    h(
      View,
      { style: styles.itemsRow },
      h(View, { style: styles.serviceColumn }, ...serviceCell(line)),
      tax ? h(View, { style: styles.amountCell }, text(styles.amountText, amounts.taxable)) : null,
      tax ? h(View, { style: styles.amountCell }, text(styles.amountText, tax.amount), text([styles.secondary, styles.amountText], `(${tax.rate}%)`)) : null,
      h(View, { style: styles.amountCell }, text(styles.amountStrong, amounts.total))
    )
  );
}

function totalsBlock(doc) {
  const { amounts } = doc;
  const tax = amounts.tax;

  return h(
    View,
    { style: styles.totals, wrap: false },
    tax ? totalLine(styles.totalRow, styles.totalLabel, styles.totalValue, "Amount before tax", amounts.taxable) : null,
    ...(tax
      ? tax.components.map((component) =>
          totalLine(styles.totalRow, styles.totalLabel, styles.totalValue, `${component.label} @ ${component.rate}%`, component.amount)
        )
      : []),
    tax ? totalLine(styles.totalTaxRow, styles.grandLabel, styles.totalValue, "Total Tax", tax.amount) : null,
    totalLine(styles.grandRow, styles.grandLabel, styles.grandValue, "Total Amount", amounts.total)
  );
}

function termsBlock(doc, style) {
  if (!doc.terms) return h(View, { style });

  return h(
    View,
    { style },
    text(styles.sectionHeading, "Terms & Conditions"),
    text(styles.termsText, doc.terms)
  );
}

/** The stored bank snapshot, label by label; the branch only when one is stored. */
function bankBlock(bank) {
  const line = (label, value) => h(View, { key: label, style: styles.bankLine }, text(styles.bankLabel, label), text(styles.bankValue, value));

  return h(
    View,
    { style: styles.bank },
    text(styles.sectionHeading, "Bank Details"),
    h(
      View,
      { style: { marginTop: 3 } },
      line("Bank", bank.name),
      line("A/C Name", bank.accountName),
      line("A/C No.", bank.accountNumber),
      line("IFSC", bank.ifscCode),
      bank.branch ? line("Branch", bank.branch) : null
    )
  );
}

/** The signature image (when there is one), the signatory's name and designation, and the label. */
function signatoryBlock(doc, signature) {
  const { signatory, business } = doc;

  return h(
    View,
    { style: styles.signatory },
    signature ? h(Image, { src: signature, style: styles.signature }) : null,
    signatory.name ? text(styles.signatoryName, signatory.name) : null,
    signatory.designation ? text([styles.secondary, styles.amountText], signatory.designation) : null,
    text(styles.signatoryLabel, `Authorized Signatory for ${business.name}`)
  );
}

/**
 * @param {object} props
 * @param {ReturnType<import("../invoice-document.js").buildInvoiceDocument>} props.invoiceDocument
 *   - the view model, exactly as `buildInvoiceDocument` returns it.
 * @param {{ logo?: object|null, signature?: object|null }} [props.images] - ready-to-draw images
 *   ({ data, format }), each optional.
 */
export default function InvoicePdf({ invoiceDocument: doc, images }) {
  const { business, customer } = doc;
  const logo = images?.logo ?? null;
  const signature = images?.signature ?? null;
  const hasSignatory = Boolean(doc.signatory.name || doc.signatory.designation || signature);
  const title = `${doc.title} ${doc.number}`;
  const keepTogether = !doc.terms || doc.terms.length <= TERMS_KEEP_TOGETHER_MAX;

  return h(
    Document,
    { title, author: business.name, creator: business.name, producer: business.name },
    h(
      Page,
      { size: "A4", orientation: "portrait", style: styles.page },
      h(
        View,
        { style: styles.frame },
        h(
          View,
          { style: styles.header },
          h(
            View,
            { style: styles.identityRow },
            logo ? h(Image, { src: logo, style: styles.logo }) : null,
            h(
              View,
              { style: styles.identityText },
              text(styles.businessName, business.name),
              business.address ? text(styles.secondary, business.address) : null,
              business.phone ? text(styles.secondary, business.phone) : null,
              business.email ? text(styles.secondary, business.email) : null
            )
          ),
          text(styles.documentTitle, doc.title)
        ),

        h(
          View,
          { style: styles.band },
          meta(`${doc.title} No.`, doc.number, "flex-start"),
          meta("Payment Date", doc.paymentDate, "center"),
          meta(`${doc.title} Date`, doc.invoiceDate, "flex-end")
        ),

        h(
          View,
          { style: styles.section },
          text(styles.sectionHeading, "Bill To"),
          text(styles.customerName, customer.name),
          text(styles.secondary, `Student ID: ${customer.code}`),
          customer.phone ? text(styles.secondary, customer.phone) : null,
          customer.email ? text(styles.secondary, customer.email) : null
        ),

        itemsTable(doc),

        // Short terms: beside the totals, one unbroken block. Long terms: the totals, then the terms
        // full width, free to flow onto further pages.
        ...(keepTogether
          ? [h(View, { key: "lower", style: styles.lower, wrap: false }, termsBlock(doc, styles.terms), totalsBlock(doc))]
          : [
              h(View, { key: "totals", style: styles.totalsAbove, wrap: false }, totalsBlock(doc)),
              termsBlock(doc, styles.termsFull),
            ]),

        // Bank details (left) and signatory (right): one unbroken block, after the terms.
        doc.bank || hasSignatory
          ? h(View, { style: styles.footer, wrap: false }, doc.bank ? bankBlock(doc.bank) : h(View, { style: styles.bank }), hasSignatory ? signatoryBlock(doc, signature) : null)
          : null
      )
    )
  );
}
