import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

// FS-D: source pins for the PROPOSED behaviour verification of legacy receipt protection.
// The protection migration itself is not written yet; these pins only keep the script honest.

const SCRIPT = "supabase/verification/verify_0054_legacy_receipt_protection_behavior.sql";
const sql = readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
const live = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("the FS-D script is rollback-only: one transaction, ends in rollback, never commits", () => {
  assert.match(live, /^begin;$/m);
  assert.match(live, /^rollback;$/m);
  assert.doesNotMatch(live, /^\s*commit\s*;/im);
  assert.ok(live.lastIndexOf("rollback;") > live.lastIndexOf("select seq, test, status, detail"));
});

test("it uses only disposable ZZVERIFY fixtures and never names a real membership or receipt", () => {
  assert.match(sql, /ZZVERIFY FSD Student/);
  assert.doesNotMatch(live, /MEM-000042|INV-805/);
});

test("it tests the intended behaviour: edits succeed, the receipt keeps its issued fields", () => {
  for (const id of ["E1", "E2", "E4", "E5", "R1", "R2", "R4", "R5", "R6", "C1", "W1"]) {
    assert.match(sql, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(sql, /set amount = /);
  assert.match(sql, /set plan = /);
  assert.match(sql, /set start_date = /);
  assert.match(sql, /set end_date = /);
});

test("it keeps the regression checks: numbering, invoice date, tax consistency, direct-update protection", () => {
  for (const id of ["N1", "N4", "N4b", "N5", "N6", "D1", "D2", "D2b", "D3", "K1", "G3", "G4", "G6", "G7", "Z1"]) {
    assert.match(sql, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(sql, /update_invoice_details/);
  assert.match(sql, /55006/);
});

test("it documents the baseline expectation and the QA procedure", () => {
  assert.match(sql, /BASELINE/);
  assert.match(sql, /R1-R6, C1, T1-T3, W1, N4 and D2/);
  assert.match(sql, /R1-R6, C1, T1-T3, W1, N4, D2\)/);
  assert.match(sql, /expected FAILs are R1-R6, C1, T1-T3, W1, N4 and D2 only/);
  assert.doesNotMatch(sql, /R1-R6, C1, T1-T3 and W1/);
  assert.match(sql, /QA PROCEDURE/);
  assert.match(sql, /AFTER THE ROLLBACK/);
});

test("N4b and D2b compare with the row captured just before the edit, and N4 / D2 name the differing columns", () => {
  assert.match(sql, /create function pg_temp\.diff_cols/);
  assert.match(
    sql,
    /select \* into v_pre from public\.invoices where id = v_i1;\n\s+v_code := pg_temp\.run_as\(v_admin, format\('select public\.update_invoice_details\(%L, %s, %L\)', v_i1, v_inv\.invoice_number, v_newdate\)\)/,
  );
  assert.match(sql, /select coalesce\(max\(invoice_number\), 0\) \+ 50 into v_new from public\.invoices;\n\s+select \* into v_pre from public\.invoices where id = v_i1;/);
  assert.match(sql, /'N4b /);
  assert.match(sql, /'D2b /);
  assert.match(sql, /columns differing from the receipt as issued/);
  assert.match(sql, /columns differing from the row before the edit/);
});

test("the existing 0030 script is untouched, and 0054 is the protection migration (written, applied by the user)", () => {
  assert.ok(existsSync("supabase/verification/verify_0030_invoice_membership_sync_behavior.sql"));
  const migrations = readdirSync("supabase/migrations").filter((f) => /^0054_/.test(f));
  assert.deepEqual(migrations, ["0054_legacy_receipt_protection.sql"]);
});
