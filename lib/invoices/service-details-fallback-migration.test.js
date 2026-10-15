// Run with `npm test` (Node's built-in test runner).
//
// Migration 0056 - the service details of a NEW document: the classes at the membership's start date, else at the date of issue.
// There is no database in the unit test run, so these tests read the SQL text and pin what must not regress; the behaviour is
// exercised by supabase/verification/verify_0056_service_details_issue_date_fallback_behavior.sql (rollback-only).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { buildServiceDetails } from "./service-details.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");

const M56 = read("../../supabase/migrations/0056_service_details_issue_date_fallback.sql");
const C56 = code(M56);
const M33 = read("../../supabase/migrations/0033_membership_service_details.sql");
const M55 = read("../../supabase/migrations/0055_payment_document_cancel_and_correction.sql");
const BEHAVIOUR = read("../../supabase/verification/verify_0056_service_details_issue_date_fallback_behavior.sql");

function functionOf(sql, header) {
  const start = sql.indexOf(header);
  assert.ok(start >= 0, header);
  return sql.slice(start, sql.indexOf("\n$$;\n", start) + "\n$$;".length);
}

const FN56 = functionOf(M56, "create or replace function public.membership_service_details(p_membership_id uuid)");
const FN33 = functionOf(M33, "create or replace function public.membership_service_details(p_membership_id uuid)");

const queryOf = (fn, from, to) => fn.slice(fn.indexOf(from), fn.indexOf(to) + to.length);

test("0056 directly follows 0055 and changes only membership_service_details(uuid)", () => {
  const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  const at = files.indexOf("0055_payment_document_cancel_and_correction.sql");
  assert.ok(at >= 0);
  assert.equal(files[at + 1], "0056_service_details_issue_date_fallback.sql");

  assert.deepEqual([...C56.matchAll(/create or replace function ([\w.]+)\(/g)].map((m) => m[1]), ["public.membership_service_details"]);
  assert.doesNotMatch(C56, /create (table|trigger|index|policy)|alter table|\binsert into public|\bupdate public|\bdelete from public|\bgrant\b|drop /i);
  assert.match(C56, /revoke execute on function public\.membership_service_details\(uuid\) from public, anon, authenticated;/);
});

test("0056 checks its dependencies first: 0033's helper, 0055's carry-forward core, the centre time zone", () => {
  assert.ok(C56.includes("to_regprocedure('public.membership_service_details(uuid)') is null"));
  assert.ok(C56.includes("to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)') is null"));
  assert.ok(C56.includes("to_regprocedure('public.centre_timezone()') is null"));
  assert.ok(C56.indexOf("raise exception") < C56.indexOf("create or replace function"));
});

test("the signature, return type, volatility and security of the helper are exactly 0033's", () => {
  const header = (fn) => fn.slice(0, fn.indexOf("as $$"));
  assert.equal(header(FN56), header(FN33));
  assert.match(header(FN56), /returns jsonb\s+language plpgsql\s+stable\s+security definer\s+set search_path = ''/);
});

test("the query is 0033's, unchanged, only asked for a date: v_start becomes v_as_of and nothing else differs", () => {
  const original = queryOf(FN33, "  with enrolled as (", "  where b.id in (select batch_id from enrolled);\n");
  const inLoop = queryOf(FN56, "    with enrolled as (", "    where b.id in (select batch_id from enrolled);\n");
  const restored = inLoop
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n")
    .replace(/v_as_of/g, "v_start");
  assert.equal(restored, original);
  // The output shape and the ordering are inside that query: unchanged, so pinned by the equality above. Spot-check them anyway.
  assert.match(inLoop, /'batch_id', b\.id,\s+'name', b\.name,\s+'code', b\.code,/);
  assert.match(inLoop, /'day_of_week', s\.day_of_week,\s+'start_time', to_char\(s\.start_time, 'HH24:MI'\),\s+'end_time', to_char\(s\.end_time, 'HH24:MI'\)/);
  assert.match(inLoop, /order by b\.name, b\.code, b\.id/);
  assert.match(inLoop, /select distinct on \(e\.batch_id, es\.schedule_series_id\)/);
});

test("the start date is tried first, the date of issue only when it finds nothing, and neither finding anything gives NULL", () => {
  assert.match(FN56, /v_today := \(now\(\) at time zone public\.centre_timezone\(\)\)::date;/);
  assert.match(FN56, /v_dates := case when v_today is distinct from v_start then array\[v_start, v_today\] else array\[v_start\] end;/);
  assert.match(FN56, /foreach v_as_of in array v_dates loop/);
  // The first date that finds a batch returns at once, so the second is never consulted then.
  assert.match(FN56, /if v_batches is not null then\s+return jsonb_build_object\('version', 1, 'as_of', to_char\(v_as_of, 'YYYY-MM-DD'\), 'batches', v_batches\);\s+end if;\s+end loop;\s+return null;/);
  assert.ok(FN56.indexOf("array[v_start, v_today]") < FN56.indexOf("foreach"));
  // An unknown membership is still NULL, before any date is looked at.
  assert.match(FN56, /if not found then\s+return null;\s+end if;\s+--/);
});

test("it never touches a document: 0056 reads no invoice, and the correction path does not call the helper", () => {
  assert.doesNotMatch(FN56, /public\.invoices|service_details_tracked|replaces_id/);
  // 0055's core calls the helper exactly once - in the FIRST-document branch; a replacement copies the original's snapshot.
  const core = functionOf(M55, "create or replace function public.issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid,\n  p_overrides     jsonb\n)");
  assert.equal([...core.matchAll(/membership_service_details/g)].length, 1);
  assert.match(core, /if p_replaces_id is null then[\s\S]*?v_service_details := public\.membership_service_details\(v_mem\.id\);[\s\S]*?else[\s\S]*?v_service_details := v_orig\.service_details;/);
  const correction = functionOf(M55, "create or replace function public.correct_and_reissue_payment_document(");
  assert.doesNotMatch(correction, /membership_service_details/);
});

test("the header documents the rule, the untouched history and the re-run warning", () => {
  assert.match(M56, /only when it finds none, it looks again at the centre's date today/);
  assert.match(M56, /It changes no document: no issued or cancelled invoice or receipt is read, rewritten or backfilled/);
  assert.match(M56, /A replacement copies the ORIGINAL's snapshot \(0055\) and never calls this function/);
  assert.match(M56, /If 0033 is ever re-run AFTER 0056, re-apply 0056/);
});

test("the renderer is untouched: a stored snapshot with a batch is shown, an empty one falls back to the generic lines", () => {
  const withBatch = buildServiceDetails({
    version: 1,
    as_of: "2026-10-16",
    batches: [{ batch_id: "b1", name: "Advanced Yoga", code: "ADV", slots: [{ day_of_week: "monday", start_time: "08:15", end_time: "09:15" }, { day_of_week: "wednesday", start_time: "08:15", end_time: "09:15" }] }],
  });
  assert.equal(withBatch.lead, "Advanced Yoga");
  assert.deepEqual(withBatch.schedule, ["Mon, Wed · 8:15 AM–9:15 AM"]);
  assert.equal(buildServiceDetails(null), null);
  assert.equal(buildServiceDetails({ version: 1, batches: [] }), null);
  // Two batches are listed once each, numbered, never merged.
  const two = buildServiceDetails({
    version: 1,
    batches: [
      { batch_id: "a", name: "Alpha", slots: [{ day_of_week: "monday", start_time: "08:15", end_time: "09:15" }] },
      { batch_id: "b", name: "Beta", slots: [{ day_of_week: "saturday", start_time: "07:00", end_time: "08:00" }] },
    ],
  });
  assert.deepEqual(two.table.map((row) => [row.number, row.batch]), [[1, "Alpha"], [2, "Beta"]]);
});

test("the behaviour script is rollback-only, uses disposable fixtures and covers every approved case", () => {
  const live = code(BEHAVIOUR);
  assert.match(live, /^begin;$/m);
  assert.match(live, /^rollback;$/m);
  assert.doesNotMatch(live, /^\s*commit\s*;/im);
  assert.ok(live.lastIndexOf("rollback;") > live.lastIndexOf("select seq, test, status, detail"));
  assert.match(BEHAVIOUR, /ZZVERIFY 0056/);
  for (const id of ["P0", "PF", "A1", "A2", "D1", "D2", "F1", "F2", "M1", "P1", "N1", "N2", "E1", "Q1", "Q2", "Q3", "R1", "R2", "R3", "Z1"]) {
    assert.match(BEHAVIOUR, new RegExp(`'${id} `), `scenario ${id}`);
  }
  // The INV-831 situation: an empty snapshot stays empty although the live helper would now find details.
  assert.match(BEHAVIOUR, /effective_start_date = %L where id = %L/);
  assert.match(BEHAVIOUR, /pg_temp\.details\(m3\) is not null/);
  assert.match(BEHAVIOUR, /correct_and_reissue_payment_document/);
  assert.match(BEHAVIOUR, /create temp table _pre_ids/);
  assert.match(BEHAVIOUR, /AFTER THE ROLLBACK/);
});
