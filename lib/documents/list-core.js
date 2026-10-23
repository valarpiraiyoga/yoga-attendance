/**
 * Central Documents register (Phase 1, read-only) - the pure half: reading the URL, parsing a search, building and running the one
 * list query, and shaping a row for the screen. No Next.js, no React; the Supabase client is passed in so it is testable without a
 * server. `lib/documents/data.js` is the server-only wrapper that supplies the client and the Admin check.
 *
 * It reads the EXISTING `invoices` table (supabase/migrations/0026, 0036, 0037) and nothing else: no second document table, no
 * student table (the customer is the name and code written on the document, a snapshot), no totals and no write. Every stored
 * document is one row - issued or cancelled, payment-level or legacy membership-level, replacement or original - so a payment that
 * has a cancelled document and its replacement appears twice and nothing is summed or merged. Row-level security
 * (`invoices_select_admin`) already limits `invoices` to Admins.
 */

import { financialYearOf, financialYearRange, formatFinancialYear } from "../financial-year.js";
import { formatInvoiceNumberOf } from "../invoices/invoice-number.js";
import { DOCUMENT_TITLE_LABEL } from "../invoices/membership-invoice.js";

export const DOCUMENTS_PAGE_SIZE = 10;

export const DOCUMENT_SERIES = ["invoice", "payment_receipt"];
export const DOCUMENT_STATUSES = ["issued", "cancelled"];

export const DEFAULT_DOCUMENT_SORT = "date-newest";
/** The URL's sort key -> direction. An unknown key uses the default. */
export const DOCUMENT_SORTS = {
  "date-newest": { ascending: false },
  "date-oldest": { ascending: true },
};
export const DOCUMENT_SORT_OPTIONS = [
  { value: "date-newest", label: "Document Date (Newest)" },
  { value: "date-oldest", label: "Document Date (Oldest)" },
];

export const SERIES_OPTIONS = [
  { value: "all", label: "All Series" },
  { value: "invoice", label: "Invoice series" },
  { value: "payment_receipt", label: "Payment receipt series" },
];
export const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "issued", label: "Issued" },
  { value: "cancelled", label: "Cancelled" },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---- the financial year preset ----------------------------------------------------------------------------------------
// A financial year is only a shortcut for the document-date range: choosing one fills From and To with its inclusive range
// (`lib/financial-year.js`), and the URL keeps only `from` and `to`. A range that is exactly one financial year reads as it.

/** The Financial Year choices offered: the current one and the five before it. */
export const FINANCIAL_YEAR_OPTION_COUNT = 6;
export const FINANCIAL_YEAR_ALL = "all";
export const FINANCIAL_YEAR_CUSTOM = "custom";

/**
 * The financial year a document-date range is exactly (1 April to 31 March), or null for any other range or none.
 *
 * @param {string} fromDate - "YYYY-MM-DD" or "".
 * @param {string} toDate - "YYYY-MM-DD" or "".
 * @returns {number|null}
 */
export function financialYearOfRange(fromDate, toDate) {
  const fy = financialYearOf(fromDate);
  if (fy === null) return null;
  const range = financialYearRange(fy);
  return range.from === fromDate && range.to === toDate ? fy : null;
}

/** The Financial Year select's value for a range: "all" (no dates), the year ("2026") or "custom" (any other range). */
export function financialYearFilterValue(fromDate, toDate) {
  if (!fromDate && !toDate) return FINANCIAL_YEAR_ALL;
  const fy = financialYearOfRange(fromDate, toDate);
  return fy === null ? FINANCIAL_YEAR_CUSTOM : String(fy);
}

/**
 * The Financial Year choices: All Dates, then the current financial year and the ones before it, newest first. A financial year
 * that is selected but older than that is added, so the select can always show it; "Custom Range" is listed only while the
 * dates are a custom range (it is a reading of the dates, not something to pick).
 *
 * @param {number|null} currentFy - `currentFinancialYear(...)` at the centre; null lists no years.
 * @param {string} [selected] - `financialYearFilterValue(...)`.
 * @returns {{ value: string, label: string }[]}
 */
export function financialYearOptions(currentFy, selected = FINANCIAL_YEAR_ALL) {
  const years = [];
  if (Number.isInteger(currentFy)) {
    for (let fy = currentFy; fy > currentFy - FINANCIAL_YEAR_OPTION_COUNT; fy -= 1) {
      if (financialYearRange(fy)) years.push(fy);
    }
  }
  const selectedFy = Number(selected);
  if (Number.isInteger(selectedFy) && financialYearRange(selectedFy) && !years.includes(selectedFy)) {
    years.push(selectedFy);
    years.sort((a, b) => b - a);
  }

  const options = [{ value: FINANCIAL_YEAR_ALL, label: "All Dates" }];
  for (const fy of years) options.push({ value: String(fy), label: formatFinancialYear(fy) });
  if (selected === FINANCIAL_YEAR_CUSTOM) options.push({ value: FINANCIAL_YEAR_CUSTOM, label: "Custom Range" });
  return options;
}

/**
 * The applied-filter chips of the document-date range: one "Financial Year" chip (key `fy`, removing it clears both dates) when
 * the range is exactly a financial year, otherwise a From and a To chip as before.
 *
 * @returns {{ key: "fy"|"from"|"to", label: string }[]}
 */
export function documentDateChips(fromDate, toDate) {
  const fy = financialYearOfRange(fromDate, toDate);
  if (fy !== null) return [{ key: "fy", label: `Financial Year: ${formatFinancialYear(fy)}` }];

  const chips = [];
  if (fromDate) chips.push({ key: "from", label: `From: ${fromDate}` });
  if (toDate) chips.push({ key: "to", label: `To: ${toDate}` });
  return chips;
}

/** The columns of a register row: the document's own snapshot, plus the membership number through the membership link. */
export const DOCUMENT_LIST_COLUMNS =
  "id, membership_id, payment_id, document_series, document_title, invoice_prefix, invoice_number, invoice_date, total_amount, currency, customer_name, customer_code, status, memberships(membership_code, student_id)";

// ---- reading the URL ------------------------------------------------------------------------------------------

/**
 * The register's view of the URL: every value is checked, and anything unknown falls back to "no filter" (never an error).
 *
 * @param {Record<string, string|string[]|undefined>} raw - the page's `searchParams`.
 */
export function parseDocumentListParams(raw = {}) {
  const text = (value) => (typeof value === "string" ? value : "");
  const date = (value) => (typeof value === "string" && DATE_PATTERN.test(value) ? value : "");

  return {
    q: text(raw.q).trim(),
    series: DOCUMENT_SERIES.includes(raw.series) ? raw.series : "all",
    status: DOCUMENT_STATUSES.includes(raw.status) ? raw.status : "all",
    fromDate: date(raw.from),
    toDate: date(raw.to),
    page: Math.max(1, Math.floor(Number(raw.page)) || 1),
    // "" = no explicit choice: Table from `lg` up, Cards below (resolved in CSS), like the other lists.
    view: raw.view === "cards" || raw.view === "table" ? raw.view : "",
    sort: Object.hasOwn(DOCUMENT_SORTS, raw.sort) ? raw.sort : DEFAULT_DOCUMENT_SORT,
  };
}

// ---- the search ----------------------------------------------------------------------------------------------------

// PostgREST's `.or()` grammar uses "," to separate conditions and "()" to group them; escaping them keeps a typed term literal.
// "%" and "_" are LIKE wildcards. (Each list module keeps its own private copy of this helper.)
function escapeForOrFilter(value) {
  return value.replace(/[%_,()]/g, (char) => `\\${char}`);
}

/**
 * What a search box entry means. A document number is searched by its digits, with or without the prefix it was issued with
 * ("INV-837", "INV837" or "837"); the same text is also matched against the customer name and the customer code on the document.
 *
 * @param {string} q
 * @returns {{ text: string, number: number|null, prefix: string }}
 */
export function parseDocumentSearch(q) {
  const text = String(q ?? "").trim();
  const match = /^(\D*?)(\d{1,12})$/.exec(text);
  return match
    ? { text, number: Number(match[2]), prefix: match[1].trim() }
    : { text, number: null, prefix: "" };
}

/** The `.or()` expression of a search, or "" for no search. */
export function documentSearchFilter(q) {
  const { text, number, prefix } = parseDocumentSearch(q);
  if (!text) return "";

  const term = escapeForOrFilter(text);
  const parts = [`customer_name.ilike.%${term}%`, `customer_code.ilike.%${term}%`];

  if (number !== null) {
    // The number alone, or the number together with the start of the prefix it was typed with.
    parts.push(prefix ? `and(invoice_number.eq.${number},invoice_prefix.ilike.${escapeForOrFilter(prefix)}%)` : `invoice_number.eq.${number}`);
  }
  return parts.join(",");
}

// ---- shaping a row ------------------------------------------------------------------------------------------------------

/**
 * The page a document opens. A payment-level document (a tax invoice or payment receipt of one payment) has its own page, which
 * shows its Cancelled status, reason, replacement link and correction history; a legacy membership-level receipt (no payment) opens
 * the membership's invoice page.
 */
export function documentHref({ membership_id: membershipId, id, payment_id: paymentId }) {
  return paymentId ? `/memberships/${membershipId}/documents/${id}` : `/memberships/${membershipId}/invoice`;
}

/** One register row for the screen. Everything shown comes from the stored document. */
export function mapDocumentRow(row) {
  const membership = Array.isArray(row.memberships) ? row.memberships[0] : row.memberships;
  return {
    id: row.id,
    number: formatInvoiceNumberOf(row),
    title: row.document_title,
    titleLabel: DOCUMENT_TITLE_LABEL[row.document_title] ?? row.document_title,
    series: row.document_series,
    isPaymentDocument: row.payment_id != null,
    customerName: row.customer_name,
    customerCode: row.customer_code,
    membershipId: row.membership_id,
    membershipCode: membership?.membership_code ?? null,
    // The student the membership belongs to - for the customer name's link to Student Details (null when the membership cannot be read).
    studentHref: membership?.student_id ? `/students/${membership.student_id}` : null,
    documentDate: row.invoice_date,
    amount: row.total_amount,
    currency: row.currency,
    status: row.status === "cancelled" ? "cancelled" : "issued",
    href: documentHref(row),
    membershipHref: `/memberships/${row.membership_id}`,
  };
}

/**
 * A membership's documents for a link on a screen about the membership (Student Details → Membership History): the ISSUED ones
 * only (a cancelled document is replaced by, or simply is no longer, the membership's document), each with the label ("Invoice",
 * "Receipt", "Payment Receipt"), the number as it is shown and the page it opens - the same number and routing rules as the
 * register (`mapDocumentRow`). `embedded` is the membership's `invoices(...)` embed (an array, one object or nothing).
 *
 * @param {object|object[]|null|undefined} embedded
 * @param {string} membershipId
 * @returns {{ id: string, label: string, number: string, href: string }[]} Oldest number first.
 */
export function membershipDocumentLinks(embedded, membershipId) {
  const rows = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];
  return rows
    .filter((row) => row && row.status !== "cancelled")
    .map((row) => {
      const document = mapDocumentRow({ ...row, membership_id: membershipId });
      return { id: document.id, label: document.titleLabel, number: document.number, href: document.href, sort: Number(row.invoice_number) || 0 };
    })
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ sort, ...link }) => link);
}

// ---- the query ------------------------------------------------------------------------------------------------------------

/** The search and the filters, applied to a query on `invoices` (the same for the page and for the out-of-range count). */
function applyFilters(query, { q, series, status, fromDate, toDate }) {
  const search = documentSearchFilter(q);
  if (search) query = query.or(search);
  if (series !== "all") query = query.eq("document_series", series);
  if (status !== "all") query = query.eq("status", status);
  if (fromDate) query = query.gte("invoice_date", fromDate);
  if (toDate) query = query.lte("invoice_date", toDate);
  return query;
}

/**
 * One page of the register: the documents that match the search and filters, in a stable order, and the total that match.
 * Read-only: one select on `invoices`, never an insert, update, delete or function call.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {ReturnType<typeof parseDocumentListParams>} params
 * @param {number} [pageSize]
 * @returns {Promise<{ documents: object[], total: number }>}
 */
export async function fetchDocumentList(supabase, params, pageSize = DOCUMENTS_PAGE_SIZE) {
  const { page, sort } = params;
  const { ascending } = DOCUMENT_SORTS[sort] ?? DOCUMENT_SORTS[DEFAULT_DOCUMENT_SORT];

  const query = applyFilters(
    supabase
      .from("invoices")
      .select(DOCUMENT_LIST_COLUMNS, { count: "exact" })
      .order("invoice_date", { ascending })
      .order("invoice_number", { ascending })
      // A stable tie-break, so paging never repeats or skips a document when several share a date and number (the two series).
      .order("id", { ascending }),
    params,
  );

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);

  // A page past the last one: no documents, but the real total, so the page can send the Admin to the last page.
  if (error?.code === "PGRST103") {
    const { count: total, error: countError } = await applyFilters(supabase.from("invoices").select("id", { count: "exact", head: true }), params);
    if (!countError) return { documents: [], total: total ?? 0 };
  }

  if (error) {
    console.error("[documents] Could not list the documents:", error.code, error.message);
    throw new Error("Could not load the documents.");
  }

  return { documents: (data ?? []).map(mapDocumentRow), total: count ?? 0 };
}

// ---- the summary (KPI tiles) ------------------------------------------------------------------------------------------

/** Rows read per request when adding up the issued value (PostgREST caps a single response). */
export const DOCUMENT_SUMMARY_BATCH = 1000;

/**
 * The value of the issued documents, per currency: one entry per currency, largest first. Amounts are added as whole paise
 * (cents) so the total never drifts. A cancelled document is never passed in.
 *
 * @param {{ total_amount: number|string, currency: string }[]} rows
 * @returns {{ currency: string, amount: number }[]}
 */
export function sumIssuedValue(rows) {
  const minor = new Map();
  for (const row of rows) {
    const cents = Math.round(Number(row.total_amount) * 100);
    if (!Number.isFinite(cents)) continue;
    minor.set(row.currency, (minor.get(row.currency) ?? 0) + cents);
  }
  return [...minor]
    .map(([currency, cents]) => ({ currency, amount: cents / 100 }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * The register's center-wide figures, independent of the search and filters: every stored document, the issued ones, the
 * cancelled ones, and the value of the issued ones (cancelled documents never count). Read-only - head counts and one paged
 * read of the issued amounts on `invoices`, under the same Admin-only RLS as the list.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} [batchSize]
 * @returns {Promise<{ total: number, issued: number, cancelled: number, issuedValue: { currency: string, amount: number }[] }>}
 */
export async function fetchDocumentSummary(supabase, batchSize = DOCUMENT_SUMMARY_BATCH) {
  const count = () => supabase.from("invoices").select("id", { count: "exact", head: true });
  const [total, issued, cancelled] = await Promise.all([count(), count().eq("status", "issued"), count().eq("status", "cancelled")]);

  const failed = [total, issued, cancelled].find((result) => result.error);
  if (failed) {
    console.error("[documents] Could not count the documents:", failed.error.code, failed.error.message);
    throw new Error("Could not load the document summary.");
  }

  const amounts = [];
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await supabase
      .from("invoices")
      .select("total_amount, currency")
      .eq("status", "issued")
      .order("id", { ascending: true })
      .range(from, from + batchSize - 1);
    if (error) {
      console.error("[documents] Could not add up the issued documents:", error.code, error.message);
      throw new Error("Could not load the document summary.");
    }
    amounts.push(...(data ?? []));
    if ((data ?? []).length < batchSize) break;
  }

  return {
    total: total.count ?? 0,
    issued: issued.count ?? 0,
    cancelled: cancelled.count ?? 0,
    issuedValue: sumIssuedValue(amounts),
  };
}
