// Run with `npm test` (Node's built-in test runner).
//
// The 0041 verification script (supabase/verification/verify_0041_gstin_settings_behavior.sql) is SQL that is run by hand
// in the Supabase SQL editor, so it is never executed here. These tests check what can be checked without a database:
// that it is rollback-only and writes only what it must, that it stops safely when 0041 is not applied, that it covers
// every requested behaviour, and that what it calls, reads and expects exists in the migrations - so it cannot drift
// from the schema it verifies.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GSTIN_PATTERN, isValidGstin } from "./gstin.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("../../supabase/verification/verify_0041_gstin_settings_behavior.sql");
const SQL = SCRIPT.replace(/^\s*--.*$/gm, "");
const M41 = read("../../supabase/migrations/0041_gstin_settings.sql");

test("it runs in one transaction that ends in ROLLBACK, and never commits", () => {
  assert.equal((SQL.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((SQL.match(/^rollback;/gm) ?? []).length, 1);
  assert.ok(SQL.indexOf("begin;") < SQL.indexOf("rollback;"));
  assert.doesNotMatch(SQL, /\bcommit\b(?!\s+drop)/i);
  assert.doesNotMatch(SQL, /\bsavepoint\b|\brelease\b/i);
  assert.match(SQL, /create temp table _verify_results[\s\S]*?on commit drop;/);
  assert.ok(SQL.indexOf("'SUMMARY'") < SQL.lastIndexOf("rollback;"));
  assert.match(SQL, /'PASS' else 'FAIL'/);
  assert.match(SQL, /'NOT TESTED'/);
});

test("it checks that 0041 is applied FIRST and creates or changes nothing before that check passes", () => {
  const p0 = SQL.indexOf("P0 migration 0041 is applied");
  assert.ok(p0 > 0);
  for (const object of ["column_name = 'gstin'", "column_name = 'business_gstin'", "invoice_settings_gstin_valid", "invoices_business_gstin_valid"]) {
    assert.ok(SQL.indexOf(object) > 0, object);
  }
  const doBlock = SQL.indexOf("do $$");
  for (const early of ["pg_temp.fixture('0041", "pg_temp.set_gstin(", "pg_temp.pay(", "update public.invoice_settings set starting_invoice_number"]) {
    assert.ok(SQL.indexOf(early, doBlock) > p0, `${early} comes after P0`);
  }
  // Everything that writes is behind the readiness check, with a NOT TESTED path when it fails.
  assert.match(SQL, /if not v_ready then\s+perform pg_temp\.skip\('S \/ B \/ D \/ Z', 'migration 0041 \(or a prerequisite\) is not applied'\);\s+else/);
});

test("it covers every requested behaviour", () => {
  for (const id of [
    "P0 ", "P0b ",
    "S1 ", "S2 ", "S3 ", "S4 ", "S5 ", "S5b ", "S6 ", "S7 ", // structure, constraints, grants, functions, existing data
    "B1 ", "B2 ", "B3 ", "B4 ", "B5 ", "B6 ",          // updating the setting; invalid input; clearing; permissions
    "D1 ", "D2 ", "D3 ", "D3b ", "D4 ", "D5 ", "D6 ", "D7 ", "D8 ", "D8b ", "D9 ", // snapshots; tax invoices only; existing documents unchanged
    "Z1 ", "Z2 ", "Z3 ",                               // restored; nothing pre-existing changed
  ]) {
    assert.ok(SCRIPT.includes(`'${id}`), id);
  }
  assert.match(SQL, /'DATA'/);
});

test("it writes only disposable fixtures and the GSTIN / numbering of the settings row, and never deletes", () => {
  assert.equal((SQL.match(/pg_temp\.fixture\('0041 [AB]'/g) ?? []).length, 2);
  assert.match(SQL, /'ZZVERIFY '/);
  assert.doesNotMatch(SQL, /MEM-0000\d\d|YC-0000\d\d/);
  const updates = new Set([...SQL.matchAll(/update\s+public\.(\w+)/gi)].map((m) => m[1]));
  // invoice_settings (the GSTIN, and numbering for this run), memberships (a fixture, to be Paid), and invoices ONLY in the two
  // statements that must be REFUSED (D5, D6).
  assert.deepEqual([...updates].sort(), ["invoice_settings", "invoices", "memberships"]);
  const invoiceUpdates = [...SQL.matchAll(/update public\.invoices set business_gstin = %L where id = %L/g)];
  assert.equal(invoiceUpdates.length, 2);
  assert.equal((SQL.match(/update\s+public\.invoices/gi) ?? []).length, 2, "no other write to a document");
  assert.deepEqual([...new Set([...SQL.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]))].sort(), ["memberships", "students"]);
  assert.doesNotMatch(SQL, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|function|trigger|schema)\b|\balter\s+(table|function)\b/i);
  // The membership update is the fixture's own Paid transition, by id.
  assert.match(SQL, /update public\.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 3, v_m2\)/);
});

test("the GSTIN values it writes are fixtures, well formed, and never the real one; the real one is restored and compared", () => {
  const g1 = SQL.match(/g1\s+constant text := '([^']+)'/)[1];
  const g2 = SQL.match(/g2\s+constant text := '([^']+)'/)[1];
  for (const value of [g1, g2]) {
    assert.match(value, /ZZVER/);
    assert.equal(GSTIN_PATTERN.test(value), true, `${value} passes the database CHECK`);
    assert.equal(isValidGstin(value), true, `${value} also has a correct check character`);
  }
  assert.notEqual(g1, g2);
  const initial = M41.match(/set gstin = '([^']+)'/)[1];
  assert.doesNotMatch(SQL, new RegExp(initial), "the real GSTIN is not written anywhere in the code of the script");
  // Read once, restored by the owner, and compared; the rest of the settings row is compared too.
  assert.match(SQL, /v_orig := v_set\.gstin;/);
  assert.match(SQL, /update public\.invoice_settings set gstin = %L where singleton', v_orig\)/);
  assert.match(SQL, /pg_temp\.gstin\(\) is not distinct from v_orig/);
  assert.match(SQL, /to_jsonb\(s\) - array\['gstin', 'updated_at', 'next_invoice_number', 'payment_receipt_next_number'\]/);
});

test("it fingerprints the existing invoices and compares them at the end", () => {
  assert.ok(SQL.indexOf("v_inv_hash0") < SQL.indexOf("v_inv_hash1") && SQL.includes("v_inv_hash0 = v_inv_hash1"));
  assert.match(SQL, /where i\.membership_id not in \(select m\.id from public\.memberships m join public\.students s on s\.id = m\.student_id where s\.full_name like 'ZZVERIFY%'\)/);
});

test("it documents the prerequisites, the limitations and the after-rollback cleanup check", () => {
  for (const heading of ["-- PREREQUISITES", "-- LIMITATIONS", "-- SAFETY - ROLLBACK ONLY", "-- WHAT IT CHECKS"]) assert.ok(SCRIPT.includes(heading), heading);
  assert.match(SCRIPT, /check CHARACTER of a GSTIN is validated by the application/);
  assert.match(SCRIPT, /Concurrency[^\n]*cannot be tested/);
  const cleanup = SCRIPT.slice(SCRIPT.lastIndexOf("-- AFTER THE ROLLBACK"));
  for (const column of ["leftover_students", "leftover_documents", "leftover_cancellations", "gstin", "next_invoice_number", "payment_receipt_next_number"]) {
    assert.ok(cleanup.includes(column), column);
  }
});

// ---- it follows the real schema ------------------------------------------------------------------------------------------------

test("the CHECK pattern it uses is the migration's and the application's", () => {
  const sqlPattern = SQL.match(/c_regex\s+constant text := '([^']+)'/)[1];
  assert.equal(sqlPattern, GSTIN_PATTERN.source);
  assert.ok(M41.includes(`'${sqlPattern}'`), "the migration holds the same pattern");
  assert.ok(SQL.includes("pg_get_constraintdef(oid) like '%[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]%'"));
});

test("every object it reads or calls exists in the migrations", () => {
  const all = ["0036_payment_documents", "0037_invoice_corrections", "0039_prevent_duplicate_documents", "0041_gstin_settings"].map((n) => read(`../../supabase/migrations/${n}.sql`)).join("\n");
  for (const name of ["issue_invoice_core", "issue_payment_document_core", "invoice_settings_guard", "correct_payment_document"]) {
    assert.match(all, new RegExp(`function public\\.${name}\\(`), name);
  }
  assert.match(M41, /invoice_settings_gstin_valid/);
  assert.match(M41, /invoices_business_gstin_valid/);
  assert.match(M41, /grant update \(gstin\) on public\.invoice_settings to authenticated;/);
  // The statuses and the cancellation columns it compares are 0037's.
  const m37 = read("../../supabase/migrations/0037_invoice_corrections.sql");
  for (const column of ["status", "cancelled_at", "cancelled_by", "cancellation_reason"]) assert.match(m37, new RegExp(`add column if not exists ${column}\\b`), column);
  assert.match(SQL, /array\['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'\]/);
  // The SQLSTATEs it expects: 23514 CHECK, 55006 freeze trigger, 42501 no privilege.
  for (const state of ["'23514'", "'55006'", "'42501'"]) assert.ok(SQL.includes(state), state);
  assert.match(read("../../supabase/migrations/0037_invoice_corrections.sql"), /A cancelled document cannot be changed\.' using errcode = '55006'/);
  assert.match(read("../../supabase/migrations/0026_invoices.sql"), /An issued invoice can only change its number and date\.' using errcode = '55006'/);
});

test("the document scenarios use the real issuing path and the real Cancel and Reissue", () => {
  assert.match(SQL, /public\.issue_payment_document\(%L::uuid\)/);
  assert.match(SQL, /public\.correct_payment_document\(%L::uuid, %L\)/);
  assert.match(SQL, /public\.record_membership_payment\(%L::uuid, %L::date, %L::jsonb, %s::boolean\)/);
  // Tax invoices (before and after the change), a payment receipt, a replacement of each, and a membership-level invoice.
  assert.match(SQL, /v_doc1\.document_series = 'invoice' and v_doc1\.business_gstin = g1/);
  assert.match(SQL, /v_doc4\.document_series = 'invoice' and v_doc4\.business_gstin = g2/);
  assert.match(SQL, /v_new\.replaces_id = v_doc1\.id/);
  assert.match(SQL, /membership_id = v_m2 and payment_id is null/);
  // A PAYMENT RECEIPT carries no GSTIN while the setting IS set, and nor does its replacement.
  assert.match(SQL, /v_doc2\.document_series = 'payment_receipt' and v_doc2\.business_gstin is null/);
  assert.match(SQL, /v_new\.replaces_id = v_doc2\.id and v_new\.document_series = 'payment_receipt' and v_new\.business_gstin is null/);
  assert.ok(SQL.indexOf("pg_temp.issue(v_admin, v_p2)") > SQL.indexOf("v_code := pg_temp.set_gstin(v_admin, g2);"), "the receipt is issued AFTER the setting holds a value");
  // The figures follow from its own setup: 400 + 300 + 300 pays the 1000 membership - two tax invoices and one receipt.
  assert.match(SQL, /pg_temp\.fixture\('0041 A', '9000410001', 1000\)/);
  assert.match(SQL, /v_today - 4, '\[\{"method":"cash","amount":"400"\}\]', 'true'/);
  assert.match(SQL, /v_today - 3, '\[\{"method":"cash","amount":"300"\}\]', 'false'/);
  assert.match(SQL, /v_today - 2, '\[\{"method":"cash","amount":"300"\}\]', 'true'/);
});

test("the payment issuing function is checked as text for the invoice-series-only rule (S5b), the same text the migration holds", () => {
  assert.match(SQL, /like '%case when v_series = ''invoice'' then v_settings\.gstin end%'/);
  assert.ok(M41.includes("case when v_series = 'invoice' then v_settings.gstin end"));
});

test("creating the script cannot fail before P0 can report: no LANGUAGE sql helper reads a column that 0041 adds", () => {
  // A LANGUAGE sql body is checked when the function is CREATED; PL/pgSQL only when it runs.
  const helpers = [...SQL.matchAll(/create function pg_temp\.(\w+)\([^)]*\)\s+returns [\w\[\]]+ language (\w+) as \$f\$([\s\S]*?)\$f\$;/g)];
  assert.ok(helpers.length > 10, "found the helpers");
  const gstin = helpers.find((h) => h[1] === "gstin");
  assert.equal(gstin[2], "plpgsql", "pg_temp.gstin() is PL/pgSQL");
  for (const [, name, language, body] of helpers) {
    if (language === "sql") assert.doesNotMatch(body, /gstin/i, `${name} (language sql) must not mention a new column`);
  }
  // ... and the only code that names them before P0 reports is P0's own existence check (a string, not a column reference).
  const body = SQL.slice(SQL.indexOf("do $$"));
  const p0Check = body.indexOf("v_ready := exists (select 1 from information_schema.columns");
  const p0Report = body.indexOf("P0 migration 0041 is applied");
  assert.ok(p0Check >= 0 && p0Report > p0Check);
  assert.ok(body.indexOf("business_gstin") >= p0Check, "nothing mentions the new columns before P0's own check");
  // Between P0's report and the readiness branch only prerequisite checks run; every statement that uses the columns is inside it.
  const branch = body.indexOf("if not v_ready then");
  assert.ok(branch > p0Report);
  const p0b = body.indexOf("P0b ");
  assert.ok(p0b > p0Report && p0b < branch);
  assert.doesNotMatch(body.slice(p0b, branch), /gstin/i, "no use of the new columns before the readiness branch");
  assert.match(body.slice(branch), /gstin/i, "and they are used inside it");
});
