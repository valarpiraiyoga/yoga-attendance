// Run with `npm test`. The Documents list refinements: the customer name's link to Student Details, the icon-only view group and the KPI toggle
// (hidden by default). The mapping runs directly; the screens need the Next.js runtime, so their wiring is pinned from source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOCUMENT_LIST_COLUMNS, mapDocumentRow } from "./list-core.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const ROW = {
  id: "d1",
  membership_id: "m1",
  payment_id: null,
  document_series: "invoice",
  document_title: "invoice",
  invoice_prefix: "INV-",
  invoice_number: 850,
  invoice_date: "2026-10-17",
  total_amount: 50,
  currency: "INR",
  customer_name: "Thejesh K",
  customer_code: "YC-000001",
  status: "issued",
};

test("the register row links the customer to the student the membership belongs to; without one it is plain text", () => {
  assert.equal(mapDocumentRow({ ...ROW, memberships: { membership_code: "MEM-000048", student_id: "s1" } }).studentHref, "/students/s1");
  assert.equal(mapDocumentRow({ ...ROW, memberships: [{ membership_code: "MEM-000048", student_id: "s1" }] }).studentHref, "/students/s1");
  assert.equal(mapDocumentRow({ ...ROW, memberships: null }).studentHref, null);
  assert.equal(mapDocumentRow({ ...ROW, memberships: { membership_code: "MEM-000048" } }).studentHref, null);
  assert.ok(DOCUMENT_LIST_COLUMNS.endsWith("memberships(membership_code, student_id)"), "the one join the register already had, plus the student id");
  assert.doesNotMatch(DOCUMENT_LIST_COLUMNS, /students\(/, "no student table is read");
});

test("table rows and cards show the customer name as plain text, not a link to Student Details", () => {
  const table = code("app/documents/document-table.js");
  assert.ok(table.includes("{document.customerName}") && table.includes("{document.customerCode}"));
  assert.ok(!table.includes("document.studentHref"));
  const card = code("app/documents/document-card-item.js");
  assert.ok(!card.includes("document.studentHref"));
  assert.ok(card.includes("label: customer"), "the customer and ID are still shown");
});

test("the row menu keeps View Document and View Membership, each with an icon", () => {
  const menu = code("app/documents/document-row-actions.js");
  assert.match(menu, /<Link href=\{document\.href\} \/>\} nativeButton=\{false\}>\s*<FileText aria-hidden="true" \/>\s*View Document/);
  assert.match(menu, /<Link href=\{document\.membershipHref\} \/>\} nativeButton=\{false\}>\s*<CreditCard aria-hidden="true" \/>\s*View Membership/);
});

test("the view switcher is the icon-only button group, as on the Students and Memberships lists", () => {
  const filters = code("app/documents/document-filters.js");
  assert.match(filters, /<ViewSwitcher[\s\S]*?separate\s+iconOnly\s*\/>/);
});

test("KPI tiles: a KPIs toggle in the header, the tiles inside the KPI strip - hidden until turned on (the shared default)", () => {
  const page = code("app/documents/page.js");
  assert.ok(page.includes('actions={<KpiToggle pageKey="documents" />}'));
  assert.match(page, /<KpiStrip pageKey="documents">\s*<DocumentSummary summary=\{summary\} currency=\{currency\} \/>\s*<\/KpiStrip>/);
  const kpi = code("components/ui/kpi-visibility.js");
  assert.ok(kpi.includes('getItem(STORAGE_PREFIX + pageKey) === "visible"'), "hidden unless the person turned it on");
});
