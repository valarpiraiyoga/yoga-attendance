// Run with `npm test` (Node's built-in test runner).
//
// Central Documents register (Phase 1): Admin-only wiring and the guards that keep it a read-only register. The screens need the
// React and Next.js runtime, so they are pinned from source - the project's way.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const appFiles = readdirSync(new URL("../../app/documents/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `../../app/documents/${f}`);
const libFiles = ["list-core.js", "data.js", "status.js"].map((f) => `./${f}`);

test("Admin only: layout, page and data function each require the Admin role", () => {
  for (const path of ["../../app/documents/layout.js", "../../app/documents/page.js", "./data.js"]) {
    assert.match(code(path), /requireRole\(ROLES\.ADMIN\)/, path);
  }
  assert.match(source("./data.js"), /import "server-only"/);
});

test("navigation: Documents is an Admin-only item directly after Memberships", () => {
  const nav = code("../../app/data/navigation.js");
  assert.match(nav, /label: "Documents", href: "\/documents", icon: FileText, roles: \["admin"\]/);
  assert.ok(nav.indexOf('label: "Memberships"') < nav.indexOf('label: "Documents"'));
  const lines = nav.split("\n");
  const memberships = lines.findIndex((l) => l.includes('label: "Memberships"'));
  assert.ok(lines[memberships + 1].includes('label: "Documents"'));
});

test("read-only register: no write, rpc, server action or export anywhere in it", () => {
  for (const path of [...appFiles, ...libFiles]) {
    const text = code(path);
    assert.doesNotMatch(text, /\.(insert|update|upsert|rpc)\(/, path);
    if (path.startsWith("./")) assert.doesNotMatch(text, /\.delete\(/, path); // app files call URLSearchParams.delete
    assert.doesNotMatch(text, /["']use server["']/, path);
    assert.doesNotMatch(text, /export(ed)? to|\.csv|download/i, path);
  }
});

// The only figure that adds amounts up is the KPI summary's Issued Value (lib/documents/summary.test.js); rows are never summed.
test("no student table, no row totals, no correction-history column", () => {
  for (const path of [...appFiles, ...libFiles]) {
    const text = code(path);
    assert.doesNotMatch(text, /from\("students"\)|students\(/, path);
    assert.doesNotMatch(text, /\.reduce\(|total_paid|Total (amount|issued)/i, path);
    assert.doesNotMatch(text, /replaces_id|replacement|cancel_reason/i, path);
  }
});

test("architecture guards: the register uses only lib/documents (no lib/invoices import, no bare invoice_number)", () => {
  for (const path of appFiles) {
    const text = code(path);
    assert.doesNotMatch(text, /lib\/invoices/, path);
    assert.doesNotMatch(text, /\.invoice_number/, path);
  }
});

test("page: URL-driven list - parses the URL, pages, redirects past the last page, links both ways", () => {
  const page = code("../../app/documents/page.js");
  assert.match(page, /parseDocumentListParams\(rawParams\)/);
  assert.match(page, /<Pagination/);
  assert.match(page, /redirect\(buildListHref\("\/documents"/);
  assert.match(page, /<DocumentFilters/);
  assert.match(page, /<DocumentList/);
});

test("table and cards link the number to the document and the membership number to Membership Details", () => {
  for (const path of ["../../app/documents/document-table.js", "../../app/documents/document-card-item.js"]) {
    const text = code(path);
    assert.match(text, /href=\{document\.href\}/, path);
    assert.match(text, /href=\{document\.membershipHref\}/, path);
    assert.match(text, /\{document\.number\}/, path);
    assert.match(text, /DOCUMENT_STATUS/, path);
  }
});

test("status badges: Issued is success, Cancelled is danger", async () => {
  const { DOCUMENT_STATUS } = await import("./status.js");
  assert.deepEqual(DOCUMENT_STATUS.issued, { label: "Issued", variant: "success" });
  assert.deepEqual(DOCUMENT_STATUS.cancelled, { label: "Cancelled", variant: "danger" });
});

test("list: table from lg and cards below when no view is chosen, like the Memberships list", () => {
  const list = code("../../app/documents/document-list.js");
  assert.match(list, /lg:hidden/);
  assert.match(list, /hidden lg:block/);
});
