import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Cancel Document and Correct & Reissue (migration 0055): source pins for the migration and its two verification scripts. There is
// no database in the unit test run; the behaviour is exercised by
// supabase/verification/verify_0055_payment_document_cancel_and_correction_behavior.sql (rollback-only).

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/0055_payment_document_cancel_and_correction.sql";
const STRUCTURE = "supabase/verification/verify_0055_payment_document_cancel_and_correction.sql";
const BEHAVIOUR = "supabase/verification/verify_0055_payment_document_cancel_and_correction_behavior.sql";
const M55 = read(MIGRATION);
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");
const C55 = code(M55);
const M40 = read("supabase/migrations/0040_edit_payment_details.sql");
const M44 = read("supabase/migrations/0044_class_count_documents_and_guard.sql");

function fn(sql, signature) {
  const start = sql.indexOf(`create or replace function ${signature}`);
  assert.ok(start >= 0, `${signature} is defined`);
  const end = sql.indexOf("\n$$;\n", start);
  assert.ok(end > start, `${signature} ends`);
  return sql.slice(start, end + "\n$$;".length);
}

function swap(text, from, to) {
  assert.ok(text.includes(from), `contains: ${from.slice(0, 60)}`);
  return text.replace(from, () => to);
}

// ---- the migration's shape -------------------------------------------------------------------------------------------------

test("0055 directly follows 0054 and does not edit an earlier one", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  // Anchored on 0054, so later migrations (0056 onwards) do not move the pin.
  const at = files.indexOf("0054_legacy_receipt_protection.sql");
  assert.ok(at >= 0);
  assert.equal(files[at + 1], "0055_payment_document_cancel_and_correction.sql");
});

test("0055 checks its dependencies first and changes no data: one additive ALTER TABLE, functions only", () => {
  for (const needle of [
    "to_regprocedure('public.edit_payment(uuid, date, jsonb)') is null",
    "to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is null",
    "to_regprocedure('public.correct_payment_document(uuid, text)') is null",
    "to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is null",
    "to_regclass('public.membership_payment_edits') is null",
  ]) {
    assert.ok(C55.includes(needle), needle);
  }
  assert.ok(C55.indexOf("raise exception") < C55.indexOf("alter table"));
  // One top-level ALTER TABLE (the two columns); the CHECK constraint is added inside a guarded DO block.
  assert.deepEqual([...C55.matchAll(/^alter table ([\w.]+)/gm)].map((m) => m[1]), ["public.membership_payment_edits"]);
  assert.match(C55, /add constraint membership_payment_edits_reason_valid\s+check \(correction_reason is null or/);
  assert.match(C55, /add column if not exists correction_reason text,\s+add column if not exists corrected_document_id uuid references public\.invoices \(id\) on delete restrict;/);
  assert.doesNotMatch(C55, /^(drop|truncate)\b/im);
  assert.doesNotMatch(C55, /create (table|trigger|index|policy)/i);
  // Top-level statements outside the function bodies never write rows.
  const outside = C55.replace(/create or replace function[\s\S]*?\n\$\$;\n/g, "");
  assert.doesNotMatch(outside, /\b(insert into|update public|delete from)\b/i);
});

test("0055 documents the balance rule, the no-refund rule and the re-run warning", () => {
  assert.match(M55, /THE BALANCE RULE/);
  assert.match(M55, /<= memberships\.amount - the sum of the OTHER payments of the SAME membership/);
  assert.match(M55, /never counted twice/);
  assert.match(M55, /nothing says money was returned/);
  assert.match(M55, /RE-RUNNING OTHER MIGRATIONS/);
  assert.match(M55, /re-apply 0055 afterwards/);
});

// ---- edit_payment_core is 0040's body, with exactly three documented changes ------------------------------------------------

test("edit_payment_core is edit_payment of 0040 with only the allow-documented guard, the document check and the audit columns added", () => {
  let core = fn(M55, "public.edit_payment_core(");
  core = swap(
    core,
    "create or replace function public.edit_payment_core(\n  p_payment_id       uuid,\n  p_payment_date     date,\n  p_methods          jsonb,\n  p_allow_documented boolean,\n  p_reason           text,\n  p_document_id      uuid\n)",
    "create or replace function public.edit_payment(\n  p_payment_id   uuid,\n  p_payment_date date,\n  p_methods      jsonb\n)",
  );
  core = swap(
    core,
    "  -- Once any document exists - issued or cancelled - the payment is part of the record: Cancel and Reissue. (0055: that correction\n  -- is the only caller that passes p_allow_documented, and it must name a document of this very payment.)\n  if not p_allow_documented and exists (select 1 from public.invoices where payment_id = v_payment.id) then",
    "  -- Once any document exists - issued or cancelled - the payment is part of the record: Cancel and Reissue.\n  if exists (select 1 from public.invoices where payment_id = v_payment.id) then",
  );
  core = swap(
    core,
    "  if p_allow_documented and not exists (select 1 from public.invoices where id = p_document_id and payment_id = v_payment.id) then\n    raise exception 'The correction must name a document of this payment.' using errcode = '22023';\n  end if;\n\n",
    "",
  );
  core = swap(
    core,
    "    previous_payment_date, new_payment_date, correction_reason, corrected_document_id\n  )\n  values (\n    v_payment.id, auth.uid(), v_payment.amount, v_total, v_previous, v_new,\n    v_payment.payment_date, p_payment_date, p_reason, p_document_id\n  );",
    "    previous_payment_date, new_payment_date\n  )\n  values (\n    v_payment.id, auth.uid(), v_payment.amount, v_total, v_previous, v_new,\n    v_payment.payment_date, p_payment_date\n  );",
  );
  assert.equal(core, fn(M40, "public.edit_payment("));
});

test("the balance rule is the original's: positive methods, and the total within the membership amount less the OTHER payments of the same membership", () => {
  const core = fn(M55, "public.edit_payment_core(");
  assert.match(core, /select coalesce\(sum\(amount\), 0\) into v_other\s+from public\.membership_payments\s+where membership_id = v_mem\.id and id <> v_payment\.id;/);
  assert.match(core, /if v_total > v_mem\.amount - v_other then\s+raise exception 'The payment cannot be more than the outstanding balance\.' using errcode = '22023';/);
  assert.match(core, /v_amount is null or v_amount <= 0 or v_amount <> round\(v_amount, 2\)/);
  assert.match(core, /Add at least one payment method\./);
  // The membership row is locked first, then the payment, then the checks.
  assert.ok(core.indexOf("where id = v_payment.membership_id\n  for update;") < core.indexOf("where id = p_payment_id\n  for update;"));
  assert.ok(core.indexOf("for update;") < core.indexOf("v_total > v_mem.amount - v_other"));
  // The status follows the payments, as before.
  assert.match(core, /v_status := case when v_other \+ v_total >= v_mem\.amount then 'paid' else 'partially_paid' end;/);
});

test("edit_payment is a thin wrapper that keeps its behaviour (no documented payment) and its grants; the core is internal", () => {
  const wrapper = fn(M55, "public.edit_payment(");
  assert.match(wrapper, /return public\.edit_payment_core\(p_payment_id, p_payment_date, p_methods, false, null, null\);/);
  assert.doesNotMatch(wrapper, /membership_payment_methods|insert into|update public/);
  assert.match(C55, /revoke execute on function public\.edit_payment_core\(uuid, date, jsonb, boolean, text, uuid\) from public, anon, authenticated;/);
  assert.match(C55, /revoke execute on function public\.edit_payment\(uuid, date, jsonb\) from public, anon;\s+grant execute on function public\.edit_payment\(uuid, date, jsonb\) to authenticated;/);
});

// ---- issue_payment_document_core is 0044's body, with only the override block and its nine sources added ----------------------

test("the five-argument issue_payment_document_core is 0044's body with only the whitelisted overrides and the carry-forward added", () => {
  let core = fn(M55, "public.issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid,\n  p_overrides     jsonb\n)");
  core = swap(core, "  p_replaces_id   uuid,\n  p_overrides     jsonb\n)", "  p_replaces_id   uuid\n)");
  core = swap(
    core,
    "  v_id        uuid;\n  v_c_name    text;\n  v_c_phone   text;\n  v_c_phone_cc text;\n  v_c_email   text;\n  v_b_name    text;\n  v_b_address text;\n  v_b_phone   text;\n  v_b_email   text;\n  v_b_gstin   text;\n  v_orig      public.invoices%rowtype;\n  v_plan      text;\n  v_description text;\n  v_period_start date;\n  v_period_end   date;\n  v_service_details jsonb;\n  v_service_tracked boolean;\nbegin",
    "  v_id        uuid;\nbegin",
  );
  const from = core.indexOf("  -- 0055: the snapshot values a replacement may carry");
  const to = core.indexOf("  -- The next free number of the payment's own series");
  assert.ok(from > 0 && to > from);
  core = core.slice(0, from) + core.slice(to);
  // The carry-forward's three INSERT sources go back to 0044's: the membership-derived wording and period, and the live service details.
  core = swap(
    core,
    "    v_description,\n    v_plan, v_period_start, v_period_end,",
    "    case v_mem.plan\n      when 'monthly' then 'Monthly'\n      when 'quarterly' then 'Quarterly'\n      when 'half_yearly' then 'Half Yearly'\n      when 'annual' then 'Annual'\n      when 'class_count' then 'Class Count'\n      else 'Custom duration'\n    end || ' Membership',\n    v_mem.plan, v_mem.start_date, v_mem.end_date,",
  );
  core = swap(core, "    v_service_details, v_service_tracked,\n    p_replaces_id", "    public.membership_service_details(v_mem.id), true,\n    p_replaces_id");
  core = swap(core, "    v_c_name, v_student.student_code, v_c_phone, v_c_phone_cc, v_c_email,", "    v_student.full_name, v_student.student_code, v_student.phone, v_student.phone_country_code, v_student.email,");
  core = swap(
    core,
    "    v_b_name, v_b_address, v_b_phone, v_b_email, v_logo_path, case when v_series = 'invoice' then v_b_gstin end,",
    "    v_center.name, v_center.address, v_center.phone, v_center.email, v_logo_path, case when v_series = 'invoice' then v_settings.gstin end,",
  );
  assert.equal(core, fn(M44, "public.issue_payment_document_core(\n"));
});

test("the overrides are a closed whitelist, never reach the student or the centre profile, and a GSTIN is for a tax invoice only", () => {
  const core = fn(M55, "public.issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid,\n  p_overrides     jsonb\n)");
  assert.match(core, /k not in \('customer_name', 'customer_phone', 'customer_phone_country_code', 'customer_email',\s+'business_name', 'business_address', 'business_phone', 'business_email', 'business_gstin'\)/);
  assert.match(core, /A GSTIN can be corrected on a tax invoice only\./);
  assert.match(core, /The customer name is required\./);
  assert.match(core, /The business name is required\./);
  assert.doesNotMatch(core, /update public\.(students|center_profile|invoice_settings)\s+set(?![\s\S]*next_invoice_number|[\s\S]*payment_receipt_next_number)/);
  assert.doesNotMatch(core, /customer_code'/, "the customer code is not overridable");
  const wrapper = fn(M55, "public.issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid\n)");
  assert.match(wrapper, /return public\.issue_payment_document_core\(p_payment_id, p_document_date, p_series, p_replaces_id, null\);/);
  assert.doesNotMatch(wrapper, /insert into/);
  assert.match(C55, /revoke execute on function public\.issue_payment_document_core\(uuid, date, text, uuid, jsonb\) from public, anon, authenticated;/);
  assert.match(C55, /revoke execute on function public\.issue_payment_document_core\(uuid, date, text, uuid\) from public, anon, authenticated;/);
});

test("a replacement carries forward the original's plan, description, period, service details and tracked marker; a first document is built as before", () => {
  const core = fn(M55, "public.issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid,\n  p_overrides     jsonb\n)");
  const branch = core.slice(core.indexOf("  if p_replaces_id is null then\n    v_plan := v_mem.plan;"), core.indexOf("  -- The next free number of the payment's own series"));
  assert.ok(branch.length > 0, "the carry-forward block exists");
  const [first, replacement] = branch.split("  else\n");
  // The first-issue branch reads the membership and the live service details, and marks the document tracked.
  assert.match(first, /v_plan := v_mem\.plan;/);
  assert.match(first, /v_period_start := v_mem\.start_date;\s+v_period_end := v_mem\.end_date;/);
  assert.match(first, /v_service_details := public\.membership_service_details\(v_mem\.id\);\s+v_service_tracked := true;/);
  // The replacement branch copies exactly the six approved fields from the replaced document of THIS payment and reads nothing live.
  assert.match(replacement, /where id = p_replaces_id and payment_id = v_payment\.id;/);
  assert.match(replacement, /The replaced document must be a document of this payment\./);
  for (const [variable, column] of [
    ["v_plan", "plan"],
    ["v_description", "description"],
    ["v_period_start", "period_start"],
    ["v_period_end", "period_end"],
    ["v_service_details", "service_details"],
    ["v_service_tracked", "service_details_tracked"],
  ]) {
    assert.ok(replacement.includes(`${variable} := v_orig.${column};`), `${variable} comes from the original`);
  }
  assert.doesNotMatch(replacement, /v_mem|membership_service_details|v_student|v_center/);
  // The INSERT uses the six variables, never the membership or the live helper directly.
  const insert = core.slice(core.indexOf("insert into public.invoices ("));
  assert.match(insert, /v_description,\s+v_plan, v_period_start, v_period_end,/);
  assert.match(insert, /v_service_details, v_service_tracked,\s+p_replaces_id/);
  assert.doesNotMatch(insert, /membership_service_details|v_mem\.plan|v_mem\.start_date|v_mem\.end_date/);
  // Only the amount, the currency and the payment date still come from the payment / membership, as before.
  assert.match(insert, /v_mem\.currency, v_payment\.amount,/);
});

test("the carry-forward is documented, applies to correct_payment_document too, and nothing is backfilled", () => {
  assert.match(M55, /CARRY-FORWARD: when the document replaces another \(p_replaces_id\)/);
  assert.match(M55, /COPIED FROM THE ORIGINAL, never re-read from the current membership, enrollment,\n--      batch or schedule/);
  assert.match(M55, /an untracked original stays untracked, with no details/);
  assert.match(M55, /This applies to correct_payment_document \(0037\) as well/);
  assert.match(M55, /Nothing is backfilled/);
  // correct_payment_document (0037) is not edited: it reaches the carry-forward through the four-argument wrapper.
  assert.match(read("supabase/migrations/0037_invoice_corrections.sql"), /v_new_id := public\.issue_payment_document_core\(v_doc\.payment_id, v_doc\.invoice_date, v_doc\.document_series, v_doc\.id\);/);
  assert.doesNotMatch(C55, /create or replace function public\.correct_payment_document/);
  const wrapper = fn(M55, "public.issue_payment_document_core(\n  p_payment_id    uuid,\n  p_document_date date,\n  p_series        text,\n  p_replaces_id   uuid\n)");
  assert.match(wrapper, /p_replaces_id, null\);/);
});

// ---- cancel_payment_document ---------------------------------------------------------------------------------------------------

test("cancel_payment_document is Admin only, needs a reason, cancels one issued payment document and issues or changes nothing else", () => {
  const f = fn(M55, "public.cancel_payment_document(");
  assert.match(f, /security definer\s+set search_path = ''/);
  assert.match(f, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.' using errcode = '42501';/);
  assert.match(f, /Enter the reason for the cancellation\./);
  assert.match(f, /length\(v_reason\) > 500/);
  assert.match(f, /Only a payment document can be cancelled\./);
  assert.match(f, /This document has already been cancelled\./);
  assert.ok(f.indexOf("from public.memberships where id = v_doc.membership_id for update") < f.indexOf("from public.invoice_settings where singleton for update"));
  assert.ok(f.indexOf("from public.invoice_settings where singleton for update") < f.indexOf("where id = p_document_id\n  for update;"));
  assert.match(f, /perform set_config\('yoga\.invoice_cancel', v_doc\.id::text, true\);[\s\S]*set status\s+= 'cancelled'[\s\S]*perform set_config\('yoga\.invoice_cancel', '', true\);/);
  assert.doesNotMatch(f, /issue_payment_document_core|edit_payment_core|insert into|membership_payments|update public\.memberships/);
  assert.match(C55, /revoke execute on function public\.cancel_payment_document\(uuid, text\) from public, anon;\s+grant execute on function public\.cancel_payment_document\(uuid, text\) to authenticated;/);
});

// ---- correct_and_reissue_payment_document ---------------------------------------------------------------------------------------

test("correct_and_reissue locks membership, settings, document in that order, then cancels, corrects the payment and issues, in one function", () => {
  const f = fn(M55, "public.correct_and_reissue_payment_document(");
  assert.match(f, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.' using errcode = '42501';/);
  assert.match(f, /Enter the reason for the correction\./);
  assert.match(f, /Only a payment document can be corrected\./);
  assert.match(f, /This document has already been cancelled\./);
  const order = [
    "from public.memberships where id = v_doc.membership_id for update",
    "from public.invoice_settings where singleton for update",
    "where id = p_document_id\n  for update;",
    "set_config('yoga.invoice_cancel', v_doc.id::text, true)",
    "perform public.edit_payment_core(",
    "v_new_id := public.issue_payment_document_core(",
  ].map((needle) => f.indexOf(needle));
  assert.ok(order.every((n) => n > 0), "every step is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the documented order");
});

test("a correction keeps the payment date and series, links the replacement, and refuses a replacement that is not the one reviewed", () => {
  const f = fn(M55, "public.correct_and_reissue_payment_document(");
  assert.match(f, /if p_methods is not null then\s+select \* into v_payment\s+from public\.membership_payments\s+where id = v_doc\.payment_id;\s+perform public\.edit_payment_core\(v_doc\.payment_id, v_payment\.payment_date, p_methods, true, v_reason, v_doc\.id\);/);
  assert.match(f, /v_doc\.payment_id, coalesce\(p_invoice_date, v_doc\.invoice_date\), v_doc\.document_series, v_doc\.id, p_overrides\);/);
  assert.match(f, /p_expected_total is not null and v_new\.total_amount is distinct from p_expected_total/);
  assert.match(f, /p_expected_tax is not null and coalesce\(v_new\.tax_amount, 0\) is distinct from p_expected_tax/);
  assert.match(f, /The corrected document is not the one that was reviewed\. Review it again\./);
  assert.doesNotMatch(f, /payment_date\s*=\s*coalesce|set payment_date/, "the payment date is never changed");
  assert.doesNotMatch(f, /update public\.(memberships|membership_payments|students|center_profile)/);
  assert.match(C55, /revoke execute on function public\.correct_and_reissue_payment_document\(uuid, text, date, jsonb, jsonb, numeric, numeric\) from public, anon;\s+grant execute on function public\.correct_and_reissue_payment_document\(uuid, text, date, jsonb, jsonb, numeric, numeric\) to authenticated;/);
});

// ---- the verification scripts ------------------------------------------------------------------------------------------------------

test("the structure script is read-only and checks the functions, grants, wrappers, audit columns and remaining protections", () => {
  const v = read(STRUCTURE);
  assert.match(v, /^begin transaction read only;$/m);
  assert.match(v, /^rollback;$/m);
  // No write statement outside its quoted strings (the LIKE patterns legitimately mention them).
  assert.doesNotMatch(code(v).replace(/'[^']*'/g, "''"), /\b(insert into|update public|delete from|drop |alter |create (table|function|trigger))\b/i);
  for (const needle of [
    "cancel_payment_document(uuid, text) exists",
    "correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric) exists",
    "edit_payment_core",
    "callable by no client role",
    "thin wrapper of edit_payment_core",
    "membership_payment_edits_reason_valid",
    "invoices_replaces_id_unique",
    "invoices_correction_payment_only",
    "correct_payment_document, issue_payment_document",
    "a replacement carries forward the original''s plan, description, period, service details and tracked marker",
    "membership_service_details is called exactly once, in the first-issue branch",
    "v_service_tracked := v_orig.service_details_tracked;",
  ]) {
    assert.ok(v.includes(needle), needle);
  }
});

test("the behaviour script is rollback-only, uses disposable fixtures, and covers cancel, correction, the balance boundaries, atomicity, retry, series, authorization and audit", () => {
  const v = read(BEHAVIOUR);
  const live = code(v);
  assert.match(live, /^begin;$/m);
  assert.match(live, /^rollback;$/m);
  assert.doesNotMatch(live, /^\s*commit\s*;/im);
  assert.ok(live.lastIndexOf("rollback;") > live.lastIndexOf("select seq, test, status, detail"));
  assert.match(v, /ZZVERIFY 0055/);
  assert.doesNotMatch(live, /MEM-000042|INV-805/);
  for (const id of ["P0", "PF", "A1", "A2", "A3", "A4", "A5", "C1", "C3", "C5", "C6", "C7", "C8", "C9", "C10",
    "R1", "R2", "R4", "R5", "R6", "R7", "R8", "B1", "B2", "B3", "B4", "B5", "B7", "B9", "B10", "B11", "M1", "M2",
    "X1", "X2", "Y1", "Y2", "S1", "S2", "S3", "F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "Z1"]) {
    assert.match(v, new RegExp(`'${id} `), `scenario ${id}`);
  }
  // Carry-forward through BOTH workflows, with an untracked original and a deactivated enrollment.
  assert.match(v, /public\.correct_payment_document\(%L::uuid, %L\)/);
  assert.match(v, /service_details = null, service_details_tracked = false/);
  assert.match(v, /update public\.batch_enrollments set status = ''inactive''/);
  assert.match(v, /disable trigger invoices_freeze_snapshot_trigger/);
  assert.match(v, /enable trigger invoices_freeze_snapshot_trigger/);
  // The approved example: payable 20000, other payments 12000, available 8000.
  assert.match(v, /20000/);
  assert.match(v, /'\[\{"method":"cash","amount":"12000"\}\]'/);
  assert.match(v, /"amount":"8000"\}\]/);
  assert.match(v, /"amount":"8000\.01"\}\]/);
  assert.match(v, /"amount":"8500"\}\]/);
  assert.match(v, /"amount":"6000"\}\]/);
  assert.match(v, /AFTER THE ROLLBACK/);
  // Z1 compares only the rows that existed before the script created anything.
  assert.match(v, /create temp table _pre_ids/);
  assert.match(v, /v_world0 = v_world1/);
});
