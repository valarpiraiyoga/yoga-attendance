// Run with `npm test` (Node's built-in test runner).
//
// V1 Membership service details - the database layer (migration 0033 and its verification scripts).
// There is no database in the unit test run, so these tests read the SQL text and pin the decisions
// that must not regress; the behaviour itself is exercised by
// supabase/verification/verify_0033_membership_service_details_behavior.sql.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const MIGRATIONS = "../../supabase/migrations/";
const VERIFICATION = "../../supabase/verification/";
const lf = (text) => text.replace(/\r\n/g, "\n");
const read = (path) => lf(readFileSync(new URL(path, import.meta.url), "utf8"));
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");

const M33 = read(`${MIGRATIONS}0033_membership_service_details.sql`);
const C33 = code(M33);
const C31 = code(read(`${MIGRATIONS}0031_membership_plans.sql`));
const C30 = code(read(`${MIGRATIONS}0030_invoice_membership_sync.sql`));

/** One `create or replace function` body, from its header to its closing `$$;`. */
function functionOf(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const end = sql.indexOf("\n$$;", start);
  return sql.slice(start, end + 4);
}

// ---- structure ------------------------------------------------------------------------------------------

test("0033 follows 0032 and no earlier migration is edited", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  const at = files.indexOf("0032_system_usage.sql");
  assert.ok(at > 0);
  assert.equal(files[at + 1], "0033_membership_service_details.sql");
});

test("0033 adds a nullable jsonb service_details to invoices, with a shape CHECK", () => {
  assert.match(C33, /alter table public\.invoices\s+add column if not exists service_details jsonb;/);
  assert.doesNotMatch(C33, /service_details jsonb\s+(not null|default)/i);
  const check = C33.match(/add constraint invoices_service_details_shape\s+check \(([\s\S]*?)\n  \);/)[1];
  assert.match(check, /service_details is null/);
  assert.match(check, /jsonb_typeof\(service_details\) = 'object'/);
  assert.match(check, /service_details \? 'version'/);
  assert.match(check, /jsonb_typeof\(service_details -> 'batches'\) = 'array'/);
});

test("0033 backfills nothing: outside the function bodies it has no INSERT, UPDATE or DELETE", () => {
  const outside = C33.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
  assert.match(M33, /does not UPDATE, INSERT or DELETE any row/);
});

test("0033 defines exactly the helper, issue_invoice_core, sync_invoice_from_membership and the freeze trigger function", () => {
  assert.deepEqual(
    [...C33.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]),
    ["membership_service_details", "issue_invoice_core", "sync_invoice_from_membership", "invoices_freeze_snapshot"],
  );
  // No new trigger: the membership trigger of 0030 is untouched.
  assert.doesNotMatch(C33, /create trigger|drop trigger/i);
  assert.doesNotMatch(C33, /memberships_sync_invoice/);
});

// ---- the helper ------------------------------------------------------------------------------------------

const HELPER = functionOf(C33, "membership_service_details");

test("the helper is internal: security definer, empty search_path, executable by no client role", () => {
  assert.match(HELPER, /returns jsonb\s+language plpgsql\s+stable\s+security definer\s+set search_path = ''/);
  assert.match(C33, /revoke execute on function public\.membership_service_details\(uuid\) from public, anon, authenticated;/);
  assert.doesNotMatch(C33, /grant execute on function public\.membership_service_details/i);
});

test("the helper applies the project's effective-date rule at the membership start date", () => {
  assert.match(HELPER, /be\.student_id = v_student/);
  assert.match(HELPER, /be\.status = 'active'/);
  assert.match(HELPER, /be\.effective_start_date <= v_start\s+and \(be\.effective_end_date is null or be\.effective_end_date >= v_start\)/);
  assert.match(HELPER, /es\.effective_start_date <= v_start\s+and \(es\.effective_end_date is null or es\.effective_end_date >= v_start\)/);
  assert.match(HELPER, /sc\.effective_from <= v_start\s+and \(sc\.effective_until is null or sc\.effective_until >= v_start\)/);
  assert.match(HELPER, /sc\.series_id = es\.schedule_series_id/);
});

test("the helper does not check schedule status, the weekday, the batch status or the student's current status", () => {
  assert.doesNotMatch(HELPER, /sc\.status|s\.status|schedules\.status|b\.status|students/);
  assert.doesNotMatch(HELPER, /extract\s*\(\s*dow|isodow|day_of_week\s*=\s*v_|to_char\(v_start, 'Day'/i);
  assert.doesNotMatch(HELPER, /current_date|now\(\)/);
});

test("overlapping versions of one series resolve deterministically: latest effective_from, created_at, id", () => {
  assert.match(HELPER, /select distinct on \(e\.batch_id, es\.schedule_series_id\)/);
  assert.match(HELPER, /order by e\.batch_id, es\.schedule_series_id, sc\.effective_from desc, sc\.created_at desc, sc\.id desc/);
});

test("batches are ordered by name, code, id; slots Monday to Sunday by an explicit day-name CASE, then start, then end", () => {
  assert.match(HELPER, /order by b\.name, b\.code, b\.id/);
  assert.match(HELPER, /case s\.day_of_week\s+when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3\s+when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6\s+when 'sunday' then 7 else 8\s+end,\s+s\.start_time, s\.end_time/);
});

test("the stored structure is the approved one: version, as_of, batches[{batch_id, name, code, slots[{day_of_week, start_time, end_time}]}]", () => {
  assert.match(HELPER, /jsonb_build_object\('version', 1, 'as_of', to_char\(v_start, 'YYYY-MM-DD'\), 'batches', v_batches\)/);
  assert.match(HELPER, /'batch_id', b\.id,\s+'name', b\.name,\s+'code', b\.code,\s+'slots'/);
  assert.match(HELPER, /'day_of_week', s\.day_of_week,\s+'start_time', to_char\(s\.start_time, 'HH24:MI'\),\s+'end_time', to_char\(s\.end_time, 'HH24:MI'\)/);
  // Nothing presentational and nothing duplicated from the membership or the amounts.
  assert.doesNotMatch(HELPER, /'plan'|'amount'|'tax|'period|'description'|Sl\. ?No|row_number|ordinality/i);
});

test("nothing applicable gives NULL, not an empty object; a batch with no slot keeps its name and an empty slots array", () => {
  assert.match(HELPER, /if v_batches is null then\s+return null;\s+end if;/);
  assert.match(HELPER, /if not found then\s+return null;/);
  assert.match(HELPER, /coalesce\(\(\s*select jsonb_agg\([\s\S]*?\), '\[\]'::jsonb\)/);
});

// ---- issue_invoice_core -----------------------------------------------------------------------------------

test("issue_invoice_core is 0031's body, byte for byte, plus the service_details column and value", () => {
  const was = functionOf(C31, "issue_invoice_core");
  const now = functionOf(C33, "issue_invoice_core");
  const restored = now
    .replace("bank_branch,\n    service_details, service_details_tracked\n  )", "bank_branch\n  )")
    .replace("v_bank.branch,\n    public.membership_service_details(v_mem.id), true\n  )", "v_bank.branch\n  )");
  assert.equal(restored, was);
  assert.match(now, /public\.membership_service_details\(v_mem\.id\)/);
});

test("the current 0031 behaviour is still there: reservations, prefix, bank snapshot, tax, wording", () => {
  const now = functionOf(C33, "issue_invoice_core");
  assert.match(now, /invoice_number_reservations/);
  assert.match(now, /v_settings\.invoice_prefix/);
  assert.match(now, /v_bank\.bank_name/);
  assert.match(now, /round\(v_mem\.amount \* v_settings\.tax_rate \/ \(100 \+ v_settings\.tax_rate\), 2\)/);
  assert.match(now, /when 'half_yearly' then 'Half Yearly'\s+when 'annual' then 'Annual'/);
  assert.match(now, /set next_invoice_number = v_candidate \+ 1/);
  // Both issue paths still end in the one function: 0026's trigger and RPC call it, and 0033 redefines neither.
  assert.doesNotMatch(C33, /memberships_auto_issue_invoice|issue_invoice\(/);
  assert.match(C33, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
});

// ---- synchronization -------------------------------------------------------------------------------------

test("sync_invoice_from_membership is 0031's, with only the start-date recompute added", () => {
  // Compared with the comments in, so the one added explanation is part of the difference.
  const was = functionOf(read(`${MIGRATIONS}0031_membership_plans.sql`), "sync_invoice_from_membership");
  const now = functionOf(M33, "sync_invoice_from_membership");
  const restored = now
    .replace("  v_recompute   boolean;\n  v_details     jsonb;\n", "")
    .replace(/  -- The service details describe[\s\S]*?  if v_recompute\n     or v_inv\.plan/, "  if v_inv.plan")
    .replace("-- eight columns below", "-- seven columns below")
    .replace("        service_details = case when v_recompute then v_details else service_details end,\n", "");
  assert.equal(restored, was);
});

test("the service details are recomputed only when the start date has moved; other edits keep the snapshot", () => {
  const now = functionOf(C33, "sync_invoice_from_membership");
  assert.match(now, /v_recompute := v_inv\.service_details_tracked\s+and v_inv\.period_start is distinct from v_mem\.start_date;/);
  assert.match(now, /if v_recompute then\s+v_details := public\.membership_service_details\(v_mem\.id\);\s+end if;/);
  assert.match(now, /service_details = case when v_recompute then v_details else service_details end,/);
  // Exactly one place computes it, and the update never writes it unconditionally.
  assert.equal(now.match(/membership_service_details\(/g).length, 1);
  assert.doesNotMatch(now, /service_details\s*=\s*v_details/);
});

test("0033 adds the lineage marker: boolean NOT NULL DEFAULT false, so existing receipts read false without any UPDATE", () => {
  assert.match(C33, /alter table public\.invoices\s+add column if not exists service_details_tracked boolean not null default false;/);
  const outside = C33.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
  assert.doesNotMatch(outside, /service_details_tracked\s*=/);
});

test("every receipt issued after 0033 is stored tracked = true, whether or not any class applied", () => {
  const now = functionOf(C33, "issue_invoice_core");
  assert.match(now, /service_details, service_details_tracked\s*\)\s*values/);
  assert.match(now, /public\.membership_service_details\(v_mem\.id\), true\s*\)/);
  // The value is the literal true - not derived from service_details, so a receipt with NO applicable class is tracked too.
  assert.doesNotMatch(now, /service_details_tracked[^,)]*is not null|v_details/);
});

test("only tracked receipts are recomputed; the marker is never written by sync, never exempt from the freeze, and no timestamp cutoff is used", () => {
  const sync = functionOf(C33, "sync_invoice_from_membership");
  const freeze = functionOf(C33, "invoices_freeze_snapshot");
  assert.doesNotMatch(sync.match(/update public\.invoices\s+set ([\s\S]*?)\s+where id = v_inv\.id;/)[1], /service_details_tracked/);
  assert.doesNotMatch(freeze, /service_details_tracked/);
  // No timestamp cutoff: the sync never looks at when a receipt was created, and the helper reads no invoice at all.
  assert.doesNotMatch(sync, /created_at|cutoff|migration/i);
  assert.doesNotMatch(HELPER, /public\.invoices|cutoff/i);
  assert.match(sync, /v_inv\.service_details_tracked/);
});

test("the seven financial columns are still written exactly as before", () => {
  const now = functionOf(C33, "sync_invoice_from_membership");
  const set = now.match(/update public\.invoices\s+set ([\s\S]*?)\s+where id = v_inv\.id;/)[1];
  for (const assignment of [
    "plan           = v_mem.plan",
    "description    = v_description",
    "period_start   = v_mem.start_date",
    "period_end     = v_mem.end_date",
    "total_amount   = v_mem.amount",
    "taxable_amount = v_taxable",
    "tax_amount     = v_tax_amount",
  ]) {
    assert.ok(set.includes(assignment), assignment);
  }
  // Never the number, prefix, dates, tax settings or bank snapshot.
  assert.doesNotMatch(set, /invoice_number|invoice_prefix|invoice_date|payment_date|tax_enabled|tax_rate|tax_name|bank_|customer_|business_|terms|signat/);
});

// ---- the freeze trigger ------------------------------------------------------------------------------------

test("the freeze trigger is 0030's with exactly one more synchronized column: eight in all", () => {
  const was = functionOf(C30, "invoices_freeze_snapshot");
  const now = functionOf(C33, "invoices_freeze_snapshot");
  assert.equal(now.replace("'tax_amount', 'service_details'", "'tax_amount'"), was);

  const synced = now.match(/v_exempt := v_exempt \|\| array\[([\s\S]*?)\]/)[1].match(/'(\w+)'/g).map((q) => q.slice(1, -1));
  assert.deepEqual(synced, ["plan", "description", "period_start", "period_end", "total_amount", "taxable_amount", "tax_amount", "service_details"]);
  // Outside the marker nothing but the three always-changeable columns is exempt.
  assert.match(now, /v_exempt text\[\] := array\['invoice_number', 'invoice_date', 'updated_at'\];/);
  assert.match(now, /if current_setting\('yoga\.invoice_sync', true\) = old\.id::text then/);
  assert.match(now, /if \(to_jsonb\(new\) - v_exempt\) is distinct from \(to_jsonb\(old\) - v_exempt\) then/);
});

// ---- the application ---------------------------------------------------------------------------------------

test("the application never writes service_details, and only the invoice layer reads it", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "tmp") continue;
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (/\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) files.push(path);
    }
  };
  walk("../../lib/");
  walk("../../app/");
  const users = files.filter((f) => /service_details|service-details|serviceDetails/.test(readFileSync(new URL(f, import.meta.url), "utf8")));
  assert.deepEqual(users.map((f) => f.replace("../../", "")).sort(), [
    "lib/invoices/invoice-core.js",
    "lib/invoices/invoice-document.js",
    "lib/invoices/service-details.js",
  ]);
  for (const file of users) assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /\.(insert|update|upsert|rpc)\([^)]*service_details/);
});

// ---- verification scripts ------------------------------------------------------------------------------------

test("the 0033 verification scripts exist and write nothing permanently", () => {
  const structural = code(read(`${VERIFICATION}verify_0033_membership_service_details.sql`));
  const behavior = code(read(`${VERIFICATION}verify_0033_membership_service_details_behavior.sql`));
  for (const script of [structural, behavior]) {
    assert.match(script, /^\s*begin;/m);
    assert.match(script, /\nrollback;/);
  }
  assert.doesNotMatch(structural, /\b(insert into public|update public|delete from public)\b/i);
  // The behaviour script never inserts a receipt directly - receipts are issued by marking a fixture membership Paid.
  assert.doesNotMatch(behavior, /insert\s+into\s+public\.invoices\b/i);
  assert.doesNotMatch(behavior, /delete\s+from\s+public\./i);
  assert.match(behavior, /'ZZVERIFY /);
  for (const scenario of ["C1", "C2", "D1", "E1", "E2", "E3", "E4", "F1", "G1", "G4", "H1", "N1", "O1", "O2", "P1", "T1", "T2", "Z1"]) {
    assert.ok(behavior.includes(`'${scenario} `), scenario);
  }
  assert.ok(existsSync(new URL(`${MIGRATIONS}0033_membership_service_details.sql`, import.meta.url)));
});
