// Run with `npm test` (Node's built-in test runner).
//
// The 0040 verification script (supabase/verification/verify_0040_edit_payment_details_behavior.sql) is SQL that is run
// by hand in the Supabase SQL editor, so it is never executed here. These tests check what can be checked without a
// database: that it is rollback-only and writes only disposable fixtures, that it stops safely when 0040 is not applied,
// that it covers every requested behaviour, and that everything it calls, reads or expects exists in the migrations
// (function signature, columns, messages, SQLSTATEs) - so it cannot silently drift from the schema it verifies.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("../../supabase/verification/verify_0040_edit_payment_details_behavior.sql");
const SQL = SCRIPT.replace(/^\s*--.*$/gm, "");
const MIGRATIONS = ["0034_membership_payments", "0035_tax_invoice_preferences", "0036_payment_documents", "0037_invoice_corrections", "0038_payment_amount_edits", "0040_edit_payment_details"]
  .map((name) => read(`../../supabase/migrations/${name}.sql`))
  .join("\n");

test("it runs in one transaction that ends in ROLLBACK, and never commits", () => {
  assert.equal((SQL.match(/^begin;/gm) ?? []).length, 1);
  assert.equal((SQL.match(/^rollback;/gm) ?? []).length, 1);
  assert.ok(SQL.indexOf("begin;") < SQL.indexOf("rollback;"));
  assert.doesNotMatch(SQL, /\bcommit\b(?!\s+drop)/i, "only the temp table's ON COMMIT DROP");
  assert.doesNotMatch(SQL, /\bsavepoint\b|\brelease\b/i);
  // The results table is temporary and the summary is the last thing selected before the rollback.
  assert.match(SQL, /create temp table _verify_results[\s\S]*?on commit drop;/);
  assert.ok(SQL.indexOf("'SUMMARY'") < SQL.lastIndexOf("rollback;"));
});

test("it checks that 0040 is applied FIRST and creates nothing before that check passes", () => {
  const p0 = SQL.indexOf("P0 migration 0040 is applied");
  assert.ok(p0 > 0);
  assert.match(SQL, /to_regprocedure\('public\.edit_payment\(uuid, date, jsonb\)'\) is not null/);
  assert.match(SQL, /column_name in \('previous_payment_date', 'new_payment_date'\)/);
  // No fixture, no payment and no setting is written before the check ...
  for (const early of ["pg_temp.fixture('0040", "pg_temp.pay(", "update public.invoice_settings"]) {
    assert.ok(SQL.indexOf(early, SQL.indexOf("do $$")) > p0, `${early} comes after P0`);
  }
  // ... and every one of them is behind the readiness check, with a NOT TESTED path when it fails.
  assert.match(SQL, /if v_ready then\s+begin\s+v_m := pg_temp\.fixture\('0040 A'/);
  assert.match(SQL, /if not v_ready then\s+perform pg_temp\.skip\('E \/ S \/ A \/ I \/ D \/ L \/ U', 'migration 0040 \(or a prerequisite\) is not applied'\);/);
  assert.match(SQL, /if v_ready and v_set\.starting_invoice_number is null then/);
});

test("it covers every requested behaviour", () => {
  for (const id of [
    "P0 ", "P0b ",
    "E1a ", "E1b ", "E1c ", "E2a ", "E3 ", "E5 ", "E6 ",       // date / method / amount / reference / notes; add and remove; unchanged
    "S0 ", "S1 ", "S2 ", "S3 ", "S4 ",                         // payment status and payment date
    "A1a ", "A1b ", "A2 ", "A3 ",                              // audit history
    "I1 ", "I2 ", "I3 ", "I4 ", "I5 ", "I6 ", "I7 ", "I8 ", "I9 ", "I10 ", "I11 ", // rejected edits change nothing
    "D1 ", "D2 ", "D3 ", "D4 ", "D5a ", "D5b ", "D5c ",        // issued / cancelled documents, incl. a ONLY-cancelled one
    "L1 ", "L2 ", "L3 ",                                       // atomic rollback after the first write
    "U1 ", "U2 ", "N1 ", "Z1 ", "Z2 ", "Z3 ", "Z4 ",
  ]) {
    assert.ok(SCRIPT.includes(`'${id}`), id);
  }
  // Results use the project's statuses and a SUMMARY row.
  assert.match(SQL, /'PASS' else 'FAIL'/);
  assert.match(SQL, /'NOT TESTED'/);
  assert.match(SQL, /'SUMMARY'/);
  assert.match(SQL, /'ALL PASS' else 'FAILURES'/);
});

test("only disposable ZZVERIFY records are created, and no real membership is ever named or written", () => {
  assert.doesNotMatch(SQL, /MEM-0000\d\d|YC-0000\d\d/);
  assert.equal((SQL.match(/pg_temp\.fixture\('0040 [ABC]'/g) ?? []).length, 3);
  assert.match(SQL, /'ZZVERIFY '/);
  // The only tables it writes directly: the three fixture tables' rows via helpers, memberships by a fixture id, the
  // settings row (numbering, rolled back) and - for the legacy shape only - payments and methods of a fixture.
  const updates = new Set([...SQL.matchAll(/update\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...updates].sort(), ["invoice_settings", "invoices", "memberships"]);
  // The one invoices update is the owner-side cancellation of a fixture payment's document (D5): only the cancellation
  // columns, by that document's id.
  assert.equal((SQL.match(/update\s+public\.invoices/gi) ?? []).length, 1);
  assert.match(SQL, /update public\.invoices set status = ''cancelled'', cancelled_at = now\(\), cancelled_by = %L, cancellation_reason = %L, updated_at = now\(\) where id = %L'/);
  const inserts = new Set([...SQL.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]));
  assert.deepEqual([...inserts].sort(), ["membership_payment_methods", "membership_payments", "memberships", "students"]);
  assert.doesNotMatch(SQL, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|function|trigger|schema)\b|\balter\s+(table|function)\b/i);
  // The one direct membership update is by the id of fixture C, never a pattern or a whole table.
  assert.match(SQL, /update public\.memberships set payment_status = ''paid'', payment_date = %L where id = %L', v_today - 3, v_m3\)/);
});

test("it fingerprints what already exists and compares it at the end", () => {
  for (const table of ["invoices", "membership_payments", "membership_payment_methods", "membership_payment_edits"]) {
    assert.match(SQL, new RegExp(`from public\\.${table}`), table);
  }
  for (const hash of ["v_inv_hash", "v_pay_hash", "v_met_hash", "v_aud_hash"]) {
    assert.ok(SQL.indexOf(`${hash}0`) < SQL.indexOf(`${hash}1`) && SQL.includes(`${hash}0 = ${hash}1`), hash);
  }
  assert.match(SQL, /where i\.membership_id not in \(select m\.id from public\.memberships m join public\.students s on s\.id = m\.student_id where s\.full_name like 'ZZVERIFY%'\)/);
});

test("it documents the prerequisites, the limitations and the after-rollback cleanup check", () => {
  assert.match(SCRIPT, /-- PREREQUISITES/);
  assert.match(SCRIPT, /-- LIMITATIONS/);
  assert.match(SCRIPT, /-- SAFETY - ROLLBACK ONLY/);
  assert.match(SCRIPT, /Concurrency[^\n]*NOT tested/);
  const cleanup = SCRIPT.slice(SCRIPT.lastIndexOf("-- AFTER THE ROLLBACK"));
  for (const column of ["leftover_students", "leftover_methods", "leftover_audit_rows", "leftover_cancellations", "next_invoice_number", "payment_receipt_next_number"]) {
    assert.ok(cleanup.includes(column), column);
  }
  assert.match(cleanup, /ZZVERIFY/);
});

// ---- it follows the real schema ------------------------------------------------------------------------------------------------

test("it calls edit_payment with the migration's signature, and every function it uses exists", () => {
  assert.match(MIGRATIONS, /create or replace function public\.edit_payment\(\s*p_payment_id\s+uuid,\s*p_payment_date date,\s*p_methods\s+jsonb\s*\)/);
  assert.match(SQL, /public\.edit_payment\(%L::uuid, %L::date, %L::jsonb\)/);
  for (const name of ["record_membership_payment", "issue_payment_document", "correct_payment_document", "centre_timezone", "is_admin"]) {
    assert.match(MIGRATIONS + read("../../supabase/migrations/0024_center_regional_settings.sql") + read("../../supabase/migrations/0002_instructors.sql"), new RegExp(`function public\\.${name}\\(`), name);
  }
  assert.match(SQL, /public\.record_membership_payment\(%L::uuid, %L::date, %L::jsonb, %s::boolean\)/);
  assert.match(SQL, /public\.issue_payment_document\(%L::uuid\)/);
  assert.match(SQL, /public\.correct_payment_document\(%L::uuid, %L\)/);
});

test("every audit, payment and method column it reads exists in the migrations", () => {
  const audit = ["previous_amount", "new_amount", "previous_allocations", "new_allocations", "previous_payment_date", "new_payment_date", "edited_by", "payment_id"];
  for (const column of audit) assert.match(MIGRATIONS, new RegExp(`\\b${column}\\b`), column);
  assert.match(MIGRATIONS, /create table if not exists public\.membership_payment_edits/);
  for (const column of ["payment_date", "amount", "issue_tax_invoice", "membership_id"]) {
    assert.match(read("../../supabase/migrations/0034_membership_payments.sql") + read("../../supabase/migrations/0035_tax_invoice_preferences.sql"), new RegExp(`\\b${column}\\b`), column);
  }
  for (const column of ["position", "method", "amount", "reference_id", "notes", "payment_id"]) {
    assert.match(read("../../supabase/migrations/0034_membership_payments.sql"), new RegExp(`\\b${column}\\b`), column);
  }
  // Audit rows are told apart by their amounts, because one transaction gives them one timestamp.
  assert.match(SQL, /previous_amount = 500 and new_amount = 350/);
});

test("the messages and SQLSTATEs it expects are the ones the migrations raise", () => {
  const edit = MIGRATIONS.slice(MIGRATIONS.indexOf("create or replace function public.edit_payment("));
  // The refusal it quotes in full.
  assert.match(SQL, /'55006 A document has been issued for this payment, so it cannot be edited\.'/);
  assert.match(edit, /'A document has been issued for this payment, so it cannot be edited\.' using errcode = '55006'/);
  // 22023 for every invalid input, P0002 for a missing payment, 42501 for a non-Admin.
  for (const code of ["22023", "P0002", "42501"]) assert.match(edit, new RegExp(`errcode = '${code}'`), code);
  for (const code of ["ERR:22023", "ERR:P0002", "ERR:42501", "ERR:23514"]) assert.ok(SQL.includes(`'${code}'`), code);
  // 23514 is the table's own check on a reference ID of more than 100 characters, which fires AFTER the delete.
  assert.match(read("../../supabase/migrations/0034_membership_payments.sql"), /reference_id\s+text check \(reference_id is null or \(reference_id = btrim\(reference_id\) and length\(reference_id\) between 1 and 100\)\)/);
  assert.ok(edit.indexOf("delete from public.membership_payment_methods") < edit.indexOf("insert into public.membership_payment_methods"));
  // The legacy-invoice refusal (L1) is the invoice guard of 0036's message.
  assert.match(read("../../supabase/migrations/0036_payment_documents.sql"), /The payment date cannot be changed after an invoice has been issued\./);
  assert.match(SQL, /v_msg like '55006 %'/);
});

test("the figures it expects follow from its own setup", () => {
  // Membership A is 1000; payment 1 = 300 + 200, payment 2 = 300.
  assert.match(SQL, /pg_temp\.fixture\('0040 A', '9000400001', 1000\)/);
  assert.match(SQL, /\{"method":"cash","amount":"300"\},\{"method":"upi","amount":"200"/);
  // Payment 1 may total 1000 - 300 = 700: 700 is accepted, 700.01 is not.
  assert.match(SQL, /'\[\{"method":"cash","amount":"700.01"\}\]'/);
  assert.match(SQL, /\{"method":"cash","amount":"400"\},\{"method":"upi","amount":"300.01"\}/);
  // 400 + 250 + 50 = 700; 350 + 300 = 650 < 1000; 700 + 300 = 1000 = Paid.
  assert.match(SQL, /'1:cash:400\.00,2:upi:250\.00,3:bank_transfer:50\.00'/);
  // Membership B is 600 = 400 + 200; membership C is 500, paid by one 500 payment.
  assert.match(SQL, /pg_temp\.fixture\('0040 B', '9000400002', 600\)/);
  assert.match(SQL, /pg_temp\.fixture\('0040 C', '9000400003', 500\)/);
});

test("D5 builds the only-cancelled payment the way 0037 cancels, and checks it is refused with nothing changed", () => {
  const m37 = read("../../supabase/migrations/0037_invoice_corrections.sql");
  // The mechanics it relies on exist: the marker the freeze trigger honours, the four columns it then lets change, and
  // the constraint that a cancelled document carries its time and a reason.
  assert.match(m37, /current_setting\('yoga\.invoice_cancel', true\) = old\.id::text/);
  assert.match(m37, /v_exempt := v_exempt \|\| array\['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason'\];/);
  assert.match(m37, /status = 'cancelled' and cancelled_at is not null\s+and cancellation_reason is not null/);
  // The script sets the marker for that one document, cancels only it, and clears the marker straight after.
  const set = SQL.indexOf("set_config('yoga.invoice_cancel', v_doc.id::text, true)");
  const update = SQL.indexOf("update public.invoices set status = ''cancelled''");
  const clear = SQL.indexOf("set_config('yoga.invoice_cancel', '', true)");
  assert.ok(set > 0 && set < update && update < clear, "marker, cancellation, marker cleared");
  // It proves the shape (exactly one document, cancelled, no issued or replacing one) before attempting the edit ...
  assert.match(SQL, /select count\(\*\) from public\.invoices where payment_id = v_pb\) = 1\s+and not exists \(select 1 from public\.invoices where payment_id = v_pb and status = 'issued'\)\s+and not exists \(select 1 from public\.invoices where replaces_id = v_doc\.id\)/);
  assert.ok(SQL.indexOf("D5a setup") < SQL.indexOf("D5b editing"), "shape first, then the attempt");
  // ... and the attempt is an edit that would be valid but for the document (150 is within the 200 B may total).
  assert.match(SQL, /pg_temp\.edit_msg\(v_admin, v_pb, \(v_today - 3\)::text, '\[\{"method":"card","amount":"150"/);
  assert.match(SQL, /v_msg = '55006 A document has been issued for this payment, so it cannot be edited\.'/);
  // Nothing may have changed: amount, date, methods, membership status and payment date, audit history, the document.
  const d5c = SQL.slice(SQL.indexOf("'D5c "), SQL.indexOf("pg_temp.state(v_m2) = v_snap, '');", SQL.indexOf("'D5c ")));
  for (const part of ["v_pay.amount", "v_pay.payment_date", "ZZ-UPI-B", "ZZ-CXL", "v_mem.payment_status", "v_mem.payment_date", "v_audit", "v_doc_json"]) {
    assert.ok(d5c.includes(part), part);
  }
  // It never touches a real record: B is a fixture, built in this transaction.
  assert.doesNotMatch(SQL, /MEM-0000\d\d/);
});
