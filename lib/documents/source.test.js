// Run with `npm test` (Node's built-in test runner).
//
// A document opened from the Documents list keeps Documents highlighted in the menu and returns there with Back, although its address
// is under /memberships/.... The helpers are run for real; the pages and the navigation are checked as source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cameFromDocuments,
  documentBack,
  isNavItemActive,
  keepDocumentsSource,
  withDocumentsSource,
} from "./source.js";
import { mapListDocumentRow, mapDocumentRow, membershipDocumentLinks } from "./list-core.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the marker is added to a link, before any fragment, and read back from either kind of params", () => {
  assert.equal(withDocumentsSource("/memberships/m1/invoice"), "/memberships/m1/invoice?from=documents");
  assert.equal(withDocumentsSource("/memberships/m1/documents/d1?x=1"), "/memberships/m1/documents/d1?x=1&from=documents");
  assert.equal(withDocumentsSource("/a#b"), "/a?from=documents#b");
  assert.equal(cameFromDocuments({ from: "documents" }), true);
  assert.equal(cameFromDocuments(new URLSearchParams("from=documents")), true);
  assert.equal(cameFromDocuments({ from: "elsewhere" }), false);
  assert.equal(cameFromDocuments(undefined), false);
});

test("Back goes to the Documents list when opened from it, else to the membership; the marker is carried forward", () => {
  const fallback = { href: "/memberships/m1", label: "Back to Membership" };
  assert.deepEqual(documentBack({ from: "documents" }, fallback), { href: "/documents", label: "Back to Documents" });
  assert.deepEqual(documentBack({}, fallback), fallback);
  assert.equal(keepDocumentsSource({ from: "documents" }, "/memberships/m1/documents/d1/correct"), "/memberships/m1/documents/d1/correct?from=documents");
  assert.equal(keepDocumentsSource({}, "/memberships/m1/documents/d1/correct"), "/memberships/m1/documents/d1/correct");
});

test("menu highlight: Documents for a membership-area page opened from Documents, Memberships otherwise", () => {
  const fromDocs = new URLSearchParams("from=documents");
  const none = new URLSearchParams("");
  for (const path of ["/memberships/m1/invoice", "/memberships/m1/documents/d1", "/memberships/m1/documents/d1/correct"]) {
    assert.equal(isNavItemActive(path, "/documents", fromDocs), true, path);
    assert.equal(isNavItemActive(path, "/memberships", fromDocs), false, `${path} is not Memberships`);
    assert.equal(isNavItemActive(path, "/memberships", none), true, `${path} stays Memberships without the marker`);
    assert.equal(isNavItemActive(path, "/documents", none), false);
  }
  // Everything else is the ordinary segment-aware rule.
  assert.equal(isNavItemActive("/documents", "/documents", none), true);
  assert.equal(isNavItemActive("/students/s1", "/students", fromDocs), true, "the marker only matters under /memberships");
  assert.equal(isNavItemActive("/attendance-history", "/attendance", none), false, "a string prefix is not a path segment");
  assert.equal(isNavItemActive("/", "/", none), true);
});

test("only the Documents list's own links carry the marker; a membership's document links do not", () => {
  const row = { id: "d1", membership_id: "m1", payment_id: "p1", invoice_number: 5, document_title: "tax_invoice", status: "issued", memberships: { membership_code: "MEM-1" } };
  assert.equal(mapListDocumentRow(row).href, "/memberships/m1/documents/d1?from=documents");
  assert.equal(mapListDocumentRow({ ...row, payment_id: null }).href, "/memberships/m1/invoice?from=documents");
  assert.equal(mapDocumentRow(row).href, "/memberships/m1/documents/d1", "the plain row is unmarked");
  assert.equal(mapListDocumentRow(row).membershipHref, "/memberships/m1", "View Membership is a plain membership link");
  const links = membershipDocumentLinks([{ id: "d1", payment_id: "p1", status: "issued", document_title: "tax_invoice", invoice_number: 5 }], "m1");
  assert.doesNotMatch(links[0].href, /from=documents/, "Student Details' membership history links are unmarked");
});

test("the document pages read the marker for Back; the navigation reads it for the highlight", () => {
  for (const path of ["app/memberships/[id]/invoice/page.js", "app/memberships/[id]/documents/[documentId]/page.js"]) {
    const page = read(path);
    assert.match(page, /\{ params, searchParams \}\) \{/, path);
    assert.ok(page.includes("documentBack(rawParams, { href: `/memberships/${id}`, label: \"Back to Membership\" })"), path);
  }
  const document = read("app/memberships/[id]/documents/[documentId]/page.js");
  assert.ok(document.includes("keepDocumentsSource(rawParams, `/memberships/${id}/documents/${document.id}/correct`)"), "Correct Document keeps it");
  const correct = read("app/memberships/[id]/documents/[documentId]/correct/page.js");
  assert.ok(correct.includes("keepDocumentsSource(rawParams, `/memberships/${id}/documents/${documentId}`)"), "its Back keeps it");
  assert.ok(correct.includes("fromDocuments={cameFromDocuments(rawParams)}"));
  const form = read("app/memberships/[id]/documents/[documentId]/correct/correction-form.js");
  assert.ok(form.includes("fromDocuments ? withDocumentsSource(replacementPath) : replacementPath"), "the reissued document opens under Documents too");
  const nav = read("components/global/NavList.js");
  assert.ok(nav.includes("useSearchParams()") && nav.includes("isNavItemActive(pathname, href, searchParams)"));
  assert.ok(read("lib/documents/list-core.js").includes("documents: (data ?? []).map(mapListDocumentRow)"));
});
