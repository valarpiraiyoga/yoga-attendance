// Run with `npm test` (Node's built-in test runner).
//
// Central Documents register (Phase 1): URL parsing, search parsing, the one list query (built against a fake query builder that
// records every call), row mapping and routing for both kinds of document.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_LIST_COLUMNS,
  DOCUMENTS_PAGE_SIZE,
  FINANCIAL_YEAR_OPTION_COUNT,
  documentDateChips,
  documentHref,
  documentSearchFilter,
  fetchDocumentList,
  financialYearFilterValue,
  financialYearOfRange,
  financialYearOptions,
  mapDocumentRow,
  parseDocumentListParams,
  parseDocumentSearch,
} from "./list-core.js";
import { financialYearRange } from "../financial-year.js";

// ---- a fake Supabase query builder that records the calls --------------------------------------------------------------

function fakeSupabase(results) {
  const calls = [];
  const queue = [...results];
  const builder = {
    from: (table) => (calls.push(["from", table]), builder),
    select: (...args) => (calls.push(["select", ...args]), builder),
    order: (...args) => (calls.push(["order", ...args]), builder),
    or: (...args) => (calls.push(["or", ...args]), builder),
    eq: (...args) => (calls.push(["eq", ...args]), builder),
    gte: (...args) => (calls.push(["gte", ...args]), builder),
    lte: (...args) => (calls.push(["lte", ...args]), builder),
    range: (...args) => (calls.push(["range", ...args]), Promise.resolve(queue.shift())),
    then: (resolve, reject) => Promise.resolve(queue.shift()).then(resolve, reject),
  };
  return { supabase: builder, calls };
}

const ROW = {
  id: "d1",
  membership_id: "m1",
  payment_id: "p1",
  document_series: "invoice",
  document_title: "invoice",
  invoice_prefix: "INV-",
  invoice_number: 837,
  invoice_date: "2026-05-02",
  total_amount: 1500,
  currency: "INR",
  customer_name: "Asha Rao",
  customer_code: "STU-0007",
  status: "issued",
  memberships: { membership_code: "MEM-0042" },
};

const params = (raw = {}) => parseDocumentListParams(raw);

// ---- reading the URL ----------------------------------------------------------------------------------------------------

test("URL parsing: defaults, valid values and unknown values (no filter, never an error)", () => {
  assert.deepEqual(params(), { q: "", series: "all", status: "all", fromDate: "", toDate: "", page: 1, view: "", sort: "date-newest" });
  assert.deepEqual(
    params({ q: "  asha ", series: "payment_receipt", status: "cancelled", from: "2026-01-01", to: "2026-02-01", page: "3", view: "table", sort: "date-oldest" }),
    { q: "asha", series: "payment_receipt", status: "cancelled", fromDate: "2026-01-01", toDate: "2026-02-01", page: 3, view: "table", sort: "date-oldest" },
  );
  const bad = params({ q: ["a"], series: "x", status: "y", from: "01/02/2026", to: "2026-13", page: "-4", view: "grid", sort: "amount" });
  assert.deepEqual(bad, { q: "", series: "all", status: "all", fromDate: "", toDate: "", page: 1, view: "", sort: "date-newest" });
  assert.equal(params({ page: "abc" }).page, 1);
  assert.equal(params({ page: "2.9" }).page, 2);
});

// ---- the search ---------------------------------------------------------------------------------------------------------

test("search parsing: digits with or without a prefix are a document number", () => {
  assert.deepEqual(parseDocumentSearch("837"), { text: "837", number: 837, prefix: "" });
  assert.deepEqual(parseDocumentSearch("INV-837"), { text: "INV-837", number: 837, prefix: "INV-" });
  assert.deepEqual(parseDocumentSearch("inv837"), { text: "inv837", number: 837, prefix: "inv" });
  assert.deepEqual(parseDocumentSearch("Asha"), { text: "Asha", number: null, prefix: "" });
  assert.deepEqual(parseDocumentSearch("  "), { text: "", number: null, prefix: "" });
});

test("search filter: customer name and code always, number when digits are typed, nothing for an empty search", () => {
  assert.equal(documentSearchFilter(""), "");
  assert.equal(documentSearchFilter("Asha"), "customer_name.ilike.%Asha%,customer_code.ilike.%Asha%");
  assert.equal(documentSearchFilter("837"), "customer_name.ilike.%837%,customer_code.ilike.%837%,invoice_number.eq.837");
  assert.equal(
    documentSearchFilter("INV-837"),
    "customer_name.ilike.%INV-837%,customer_code.ilike.%INV-837%,and(invoice_number.eq.837,invoice_prefix.ilike.INV-%)",
  );
});

test("search filter: or-grammar and LIKE characters are escaped, so a typed term stays literal", () => {
  const filter = documentSearchFilter("a,b(c)%_");
  assert.equal(filter, "customer_name.ilike.%a\\,b\\(c\\)\\%\\_%,customer_code.ilike.%a\\,b\\(c\\)\\%\\_%");
});

test("search never reads the current student's name (only the document's own snapshot columns)", () => {
  const filter = documentSearchFilter("Asha 12");
  assert.doesNotMatch(filter, /students|full_name|memberships/);
});

// ---- mapping and routing ------------------------------------------------------------------------------------------------

test("mapping: a payment-level document shows its snapshot, number string, label and status", () => {
  const mapped = mapDocumentRow(ROW);
  assert.equal(mapped.number, "INV-837");
  assert.equal(mapped.titleLabel, "Invoice");
  assert.equal(mapped.customerName, "Asha Rao");
  assert.equal(mapped.customerCode, "STU-0007");
  assert.equal(mapped.membershipCode, "MEM-0042");
  assert.equal(mapped.documentDate, "2026-05-02");
  assert.equal(mapped.amount, 1500);
  assert.equal(mapped.currency, "INR");
  assert.equal(mapped.status, "issued");
  assert.equal(mapped.isPaymentDocument, true);
  assert.equal(mapped.membershipHref, "/memberships/m1");
});

test("mapping: cancelled status, array-shaped membership and a missing membership are handled", () => {
  assert.equal(mapDocumentRow({ ...ROW, status: "cancelled" }).status, "cancelled");
  assert.equal(mapDocumentRow({ ...ROW, memberships: [{ membership_code: "MEM-1" }] }).membershipCode, "MEM-1");
  assert.equal(mapDocumentRow({ ...ROW, memberships: null }).membershipCode, null);
});

test("routing: a payment-level document opens its own page; a legacy membership-level receipt opens the membership invoice page", () => {
  assert.equal(documentHref(ROW), "/memberships/m1/documents/d1");
  assert.equal(mapDocumentRow(ROW).href, "/memberships/m1/documents/d1");
  const legacy = { ...ROW, payment_id: null };
  assert.equal(documentHref(legacy), "/memberships/m1/invoice");
  assert.equal(mapDocumentRow(legacy).href, "/memberships/m1/invoice");
  assert.equal(mapDocumentRow(legacy).isPaymentDocument, false);
});

// ---- the query ----------------------------------------------------------------------------------------------------------

test("query: reads only `invoices`, selects the snapshot columns with an exact count, newest first, first page", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [ROW], error: null, count: 1 }]);
  const result = await fetchDocumentList(supabase, params());

  assert.deepEqual(calls[0], ["from", "invoices"]);
  assert.deepEqual(calls[1], ["select", DOCUMENT_LIST_COLUMNS, { count: "exact" }]);
  assert.deepEqual(calls.filter((c) => c[0] === "order"), [
    ["order", "invoice_date", { ascending: false }],
    ["order", "invoice_number", { ascending: false }],
    ["order", "id", { ascending: false }],
  ]);
  assert.deepEqual(calls.at(-1), ["range", 0, DOCUMENTS_PAGE_SIZE - 1]);
  assert.ok(!calls.some((c) => ["or", "eq", "gte", "lte"].includes(c[0])), "no filter without parameters");
  assert.equal(result.total, 1);
  assert.equal(result.documents[0].number, "INV-837");
});

test("query: oldest-first sort flips every order direction; paging uses the right range", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [], error: null, count: 25 }]);
  await fetchDocumentList(supabase, params({ sort: "date-oldest", page: "3" }));
  assert.ok(calls.filter((c) => c[0] === "order").every((c) => c[2].ascending === true));
  assert.deepEqual(calls.at(-1), ["range", 20, 29]);
});

test("query: search, series, status and the inclusive document-date range are all applied server-side", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [], error: null, count: 0 }]);
  await fetchDocumentList(supabase, params({ q: "INV-837", series: "invoice", status: "cancelled", from: "2026-01-01", to: "2026-03-31" }));
  assert.deepEqual(calls.find((c) => c[0] === "or"), ["or", documentSearchFilter("INV-837")]);
  assert.deepEqual(calls.find((c) => c[0] === "eq" && c[1] === "document_series"), ["eq", "document_series", "invoice"]);
  assert.deepEqual(calls.find((c) => c[0] === "eq" && c[1] === "status"), ["eq", "status", "cancelled"]);
  assert.deepEqual(calls.find((c) => c[0] === "gte"), ["gte", "invoice_date", "2026-01-01"]);
  assert.deepEqual(calls.find((c) => c[0] === "lte"), ["lte", "invoice_date", "2026-03-31"]);
});

test("query: issued and cancelled documents are both returned when no status filter is set", async () => {
  const cancelled = { ...ROW, id: "d2", status: "cancelled" };
  const { supabase, calls } = fakeSupabase([{ data: [ROW, cancelled], error: null, count: 2 }]);
  const result = await fetchDocumentList(supabase, params());
  assert.ok(!calls.some((c) => c[0] === "eq" && c[1] === "status"));
  assert.deepEqual(result.documents.map((d) => d.status), ["issued", "cancelled"]);
});

test("query: a page past the last returns no documents and the real total (head count with the same filters)", async () => {
  const { supabase, calls } = fakeSupabase([
    { data: null, error: { code: "PGRST103", message: "range" }, count: null },
    { count: 12, error: null },
  ]);
  const result = await fetchDocumentList(supabase, params({ page: "9", status: "issued" }));
  assert.deepEqual(result, { documents: [], total: 12 });
  const head = calls.filter((c) => c[0] === "select").at(-1);
  assert.deepEqual(head, ["select", "id", { count: "exact", head: true }]);
  assert.equal(calls.filter((c) => c[0] === "eq" && c[1] === "status").length, 2);
});

test("query: any other error is logged and surfaces as a plain message", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { supabase } = fakeSupabase([{ data: null, error: { code: "42501", message: "denied" }, count: null }]);
    await assert.rejects(fetchDocumentList(supabase, params()), /Could not load the documents\./);
  } finally {
    console.error = original;
  }
});

test("query: read-only - it never calls a write or an rpc", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [], error: null, count: 0 }]);
  await fetchDocumentList(supabase, params({ q: "x" }));
  assert.ok(!calls.some((c) => ["insert", "update", "delete", "upsert", "rpc"].includes(c[0])));
});

// ---- a membership's document links (Student Details → Membership History) -------------------------------------------------------

import { membershipDocumentLinks } from "./list-core.js";

const DOC = (over) => ({ id: "d1", payment_id: "p1", document_title: "invoice", invoice_prefix: "INV-", invoice_number: 837, status: "issued", ...over });

test("document links: the issued documents with label, shown number and the page each opens", () => {
  const links = membershipDocumentLinks(
    [DOC({}), DOC({ id: "d2", payment_id: "p2", document_title: "payment_receipt", invoice_prefix: "RCT-", invoice_number: 12 })],
    "m1",
  );
  assert.deepEqual(links, [
    { id: "d2", label: "Payment Receipt", number: "RCT-12", href: "/memberships/m1/documents/d2" },
    { id: "d1", label: "Invoice", number: "INV-837", href: "/memberships/m1/documents/d1" },
  ]);
});

test("document links: a legacy membership-level receipt opens the membership's invoice page", () => {
  const [link] = membershipDocumentLinks([DOC({ id: "d9", payment_id: null, document_title: "receipt", invoice_prefix: null, invoice_number: 1223 })], "m1");
  assert.deepEqual(link, { id: "d9", label: "Receipt", number: "1223", href: "/memberships/m1/invoice" });
});

test("document links: a cancelled document is not listed; no documents (or none loaded) is an empty list", () => {
  assert.deepEqual(membershipDocumentLinks([DOC({ status: "cancelled" })], "m1"), []);
  assert.deepEqual(membershipDocumentLinks([], "m1"), []);
  assert.deepEqual(membershipDocumentLinks(null, "m1"), []);
  assert.equal(membershipDocumentLinks(DOC({}), "m1").length, 1, "a single embedded object is accepted");
});

// ---- the financial year preset ------------------------------------------------------------------------------------------
// A financial year only fills the existing From / To document-date filter; the URL and the query keep only `from` and `to`.

// Which of these document dates a recorded query keeps: the `gte` / `lte` calls on invoice_date, applied as Postgres would.
function keptDates(calls, dates) {
  const bounds = calls.filter((c) => (c[0] === "gte" || c[0] === "lte") && c[1] === "invoice_date");
  return dates.filter((date) => bounds.every(([op, , value]) => (op === "gte" ? date >= value : date <= value)));
}

test("financial year: FY 2026–27 fills From 2026-04-01 and To 2027-03-31, which the URL carries as from / to", () => {
  const range = financialYearRange(2026);
  assert.deepEqual(range, { from: "2026-04-01", to: "2027-03-31" });
  const parsed = params({ from: range.from, to: range.to });
  assert.equal(parsed.fromDate, "2026-04-01");
  assert.equal(parsed.toDate, "2027-03-31");
  assert.equal(financialYearFilterValue(parsed.fromDate, parsed.toDate), "2026");
});

test("financial year: no URL param of its own - an `fy` param is ignored like any unknown value", () => {
  assert.deepEqual(params({ fy: "2026" }), params());
});

test("financial year: the query is the existing inclusive invoice_date range - 1 April and 31 March in, the days outside out", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [], error: null, count: 0 }]);
  const { from, to } = financialYearRange(2026);
  await fetchDocumentList(supabase, params({ from, to }));

  assert.deepEqual(calls.filter((c) => c[0] === "gte"), [["gte", "invoice_date", "2026-04-01"]]);
  assert.deepEqual(calls.filter((c) => c[0] === "lte"), [["lte", "invoice_date", "2027-03-31"]]);
  assert.deepEqual(
    keptDates(calls, ["2026-03-31", "2026-04-01", "2026-10-15", "2027-03-31", "2027-04-01"]),
    ["2026-04-01", "2026-10-15", "2027-03-31"],
  );
});

test("financial year: a manual From / To range is queried exactly as before", async () => {
  const { supabase, calls } = fakeSupabase([{ data: [], error: null, count: 0 }]);
  await fetchDocumentList(supabase, params({ from: "2026-05-10", to: "2026-06-20" }));
  assert.deepEqual(calls.filter((c) => c[0] === "gte" || c[0] === "lte"), [["gte", "invoice_date", "2026-05-10"], ["lte", "invoice_date", "2026-06-20"]]);
  assert.deepEqual(keptDates(calls, ["2026-05-09", "2026-05-10", "2026-06-20", "2026-06-21"]), ["2026-05-10", "2026-06-20"]);
});

test("financial year: a range reads as a financial year only when it is exactly 1 April to 31 March", () => {
  assert.equal(financialYearOfRange("2026-04-01", "2027-03-31"), 2026);
  assert.equal(financialYearOfRange("2025-04-01", "2026-03-31"), 2025);
  for (const [from, to] of [
    ["2026-04-01", "2027-03-30"], ["2026-04-02", "2027-03-31"], ["2026-04-01", "2028-03-31"], ["2026-04-01", ""], ["", "2027-03-31"], ["", ""],
  ]) {
    assert.equal(financialYearOfRange(from, to), null, `${from}..${to}`);
  }
});

test("financial year: the select reads All Dates for no dates, the year for an exact range, Custom Range otherwise", () => {
  assert.equal(financialYearFilterValue("", ""), "all");
  assert.equal(financialYearFilterValue("2026-04-01", "2027-03-31"), "2026");
  assert.equal(financialYearFilterValue("2026-04-01", "2027-03-30"), "custom");
  assert.equal(financialYearFilterValue("2026-04-01", ""), "custom");
  assert.equal(financialYearFilterValue("", "2027-03-31"), "custom");
});

test("financial year options: All Dates, then the current financial year and the five before it, newest first", () => {
  assert.equal(FINANCIAL_YEAR_OPTION_COUNT, 6);
  assert.deepEqual(financialYearOptions(2026), [
    { value: "all", label: "All Dates" },
    { value: "2026", label: "FY 2026–27" },
    { value: "2025", label: "FY 2025–26" },
    { value: "2024", label: "FY 2024–25" },
    { value: "2023", label: "FY 2023–24" },
    { value: "2022", label: "FY 2022–23" },
    { value: "2021", label: "FY 2021–22" },
  ]);
});

test("financial year options: an older selected year is added in order; Custom Range only while the dates are custom", () => {
  const older = financialYearOptions(2026, "2018").map((o) => o.value);
  assert.deepEqual(older, ["all", "2026", "2025", "2024", "2023", "2022", "2021", "2018"]);
  assert.deepEqual(financialYearOptions(2026, "2025").map((o) => o.value), ["all", "2026", "2025", "2024", "2023", "2022", "2021"]);

  const custom = financialYearOptions(2026, "custom");
  assert.deepEqual(custom.at(-1), { value: "custom", label: "Custom Range" });
  assert.ok(!financialYearOptions(2026, "all").some((o) => o.value === "custom"));
});

test("financial year options: without a current financial year only All Dates (and a selected year) are offered", () => {
  assert.deepEqual(financialYearOptions(null), [{ value: "all", label: "All Dates" }]);
  assert.deepEqual(financialYearOptions(null, "2025").map((o) => o.value), ["all", "2025"]);
});

test("date chips: one Financial Year chip for an exact financial year, otherwise From and To as before", () => {
  assert.deepEqual(documentDateChips("2026-04-01", "2027-03-31"), [{ key: "fy", label: "Financial Year: FY 2026–27" }]);
  assert.deepEqual(documentDateChips("2026-04-01", "2027-03-30"), [
    { key: "from", label: "From: 2026-04-01" },
    { key: "to", label: "To: 2027-03-30" },
  ]);
  assert.deepEqual(documentDateChips("2026-05-01", ""), [{ key: "from", label: "From: 2026-05-01" }]);
  assert.deepEqual(documentDateChips("", "2026-05-01"), [{ key: "to", label: "To: 2026-05-01" }]);
  assert.deepEqual(documentDateChips("", ""), []);
});
