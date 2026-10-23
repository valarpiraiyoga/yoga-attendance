// FS-8: audited corrections of a package-linked membership (migration 0050). The pure rules, and source pins for the SQL (the
// behaviour itself is exercised by supabase/verification/verify_0050_membership_term_corrections_behavior.sql against a real database)
// and for how the screen and the server actions are wired.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CORRECTION_FIELDS,
  correctionHistoryRowFrom,
  correctionRpcParams,
  currentTermsOf,
  isUuid,
  matchCorrectionError,
  parseConfirmedFee,
  previewOf,
  protectedTermsChanged,
  rawCorrectionInput,
  validateCorrectionInput,
  validateCorrectionReason,
} from "./correction-core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("../../supabase/migrations/0050_membership_term_corrections.sql");
const code = sql.replace(/^--.*$/gm, "");
const script = read("../../supabase/verification/verify_0050_membership_term_corrections_behavior.sql");

const PKG = "11111111-1111-4111-8111-111111111111";
const MEM = "22222222-2222-4222-8222-222222222222";
const duration = (extra = {}) => ({
  package_id: PKG,
  duration_option: "quarterly",
  custom_months: "",
  start_date: "2026-10-01",
  pricing_mode: "standard",
  individual_discount_type: "",
  individual_discount_value: "",
  individual_discount_reason: "",
  individual_discount_note: "",
  custom_fee: "",
  custom_fee_reason: "",
  ...extra,
});

// ---- the pure rules -----------------------------------------------------------------------------------------------------------------

test("a standard duration correction validates and becomes the function's arguments", () => {
  const result = validateCorrectionInput(duration(), "duration");
  assert.equal(result.success, true);
  assert.deepEqual(correctionRpcParams(MEM, result.data), {
    p_membership_id: MEM,
    p_package_id: PKG,
    p_duration_option: "quarterly",
    p_custom_months: null,
    p_start_date: "2026-10-01",
    p_individual_type: null,
    p_individual_value: null,
    p_reason_code: null,
    p_reason_note: null,
    p_pricing_mode: "standard",
    p_custom_fee: null,
    p_custom_reason: null,
  });
});

test("a correction never carries an expiry or notes, and the creation form's confirmation checkbox is not required", () => {
  assert.ok(!CORRECTION_FIELDS.includes("end_date") && !CORRECTION_FIELDS.includes("notes") && !CORRECTION_FIELDS.includes("custom_fee_confirmed"));
  const custom = validateCorrectionInput(duration({ pricing_mode: "custom_fee_plan", custom_fee: "3500", custom_fee_reason: "Agreed with the centre" }), "duration");
  assert.equal(custom.success, true, JSON.stringify(custom));
  const params = correctionRpcParams(MEM, custom.data);
  assert.equal(params.p_pricing_mode, "custom_fee_plan");
  assert.equal(Number(params.p_custom_fee), 3500);
  assert.equal(params.p_custom_reason, "Agreed with the centre");
});

test("switching to or from a Custom Fee Plan is valid input in both directions", () => {
  assert.equal(validateCorrectionInput(duration({ pricing_mode: "standard" }), "duration").success, true);
  assert.equal(validateCorrectionInput(duration({ pricing_mode: "custom_fee_plan", custom_fee: "1200.50", custom_fee_reason: "Special price" }), "duration").success, true);
});

test("a Custom Fee Plan needs a positive fee with at most two decimals and a reason, and takes no discount", () => {
  const base = { pricing_mode: "custom_fee_plan", custom_fee_reason: "Special price" };
  assert.equal(validateCorrectionInput(duration({ ...base, custom_fee: "0" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ ...base, custom_fee: "-5" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ ...base, custom_fee: "10.999" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ ...base, custom_fee: "" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ pricing_mode: "custom_fee_plan", custom_fee: "100", custom_fee_reason: "" }), "duration").success, false);
  const withDiscount = validateCorrectionInput(duration({ ...base, custom_fee: "100", individual_discount_type: "fixed", individual_discount_value: "10" }), "duration");
  assert.equal(withDiscount.success, false);
  assert.ok(withDiscount.errors.discount);
});

test("an individual discount needs a type, a value and a reason, and Other needs an explanation", () => {
  const ok = validateCorrectionInput(
    duration({ individual_discount_type: "percent", individual_discount_value: "10", individual_discount_reason: "returning_member" }),
    "duration"
  );
  assert.equal(ok.success, true);
  assert.deepEqual(correctionRpcParams(MEM, ok.data).p_individual_type, "percent");
  assert.equal(validateCorrectionInput(duration({ individual_discount_type: "percent", individual_discount_value: "10" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ individual_discount_type: "fixed", individual_discount_value: "0", individual_discount_reason: "other" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ individual_discount_type: "fixed", individual_discount_value: "50", individual_discount_reason: "other" }), "duration").success, false);
  assert.equal(
    validateCorrectionInput(duration({ individual_discount_type: "fixed", individual_discount_value: "50", individual_discount_reason: "other", individual_discount_note: "Family friend" }), "duration").success,
    true
  );
});

test("the start date, the package and the duration are required for a duration membership; a class-count one has no duration", () => {
  assert.equal(validateCorrectionInput(duration({ start_date: "" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ start_date: "2026-02-30" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ package_id: "" }), null).success, false);
  assert.equal(validateCorrectionInput(duration({ duration_option: "" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ duration_option: "custom", custom_months: "" }), "duration").success, false);
  assert.equal(validateCorrectionInput(duration({ duration_option: "custom", custom_months: "7" }), "duration").success, true);
  assert.equal(validateCorrectionInput(duration({ duration_option: "" }), "class_count").success, true);
  assert.equal(validateCorrectionInput(duration({ duration_option: "monthly" }), "class_count").success, false, "a class-count package has no duration");
});

test("the correction reason is trimmed and 3 to 500 characters", () => {
  assert.equal(validateCorrectionReason("  ok ").success, false);
  assert.deepEqual(validateCorrectionReason("  Wrong package sold \n"), { success: true, data: "Wrong package sold" });
  assert.equal(validateCorrectionReason("x".repeat(501)).success, false);
  assert.equal(validateCorrectionReason("x".repeat(500)).success, true);
  assert.equal(validateCorrectionReason(null).success, false);
});

test("the confirmed fee is a positive amount with at most two decimals", () => {
  assert.equal(parseConfirmedFee("4000"), 4000);
  assert.equal(parseConfirmedFee(4000.5), 4000.5);
  assert.equal(parseConfirmedFee("0"), null);
  assert.equal(parseConfirmedFee("-1"), null);
  assert.equal(parseConfirmedFee("1.234"), null);
  assert.equal(parseConfirmedFee(""), null);
  assert.equal(parseConfirmedFee(null), null);
  assert.equal(parseConfirmedFee("abc"), null);
});

test("ids are UUIDs", () => {
  assert.equal(isUuid(MEM), true);
  assert.equal(isUuid("not-an-id"), false);
  assert.equal(isUuid(undefined), false);
});

test("the database's own refusals are recognised and shown, with the field they belong to", () => {
  const below = matchCorrectionError({ code: "22023", message: "The final fee (1000) cannot be below the payments already recorded (1500)." });
  assert.match(below.error, /cannot be below the payments already recorded/);
  assert.ok(below.fieldErrors.finalFee);
  assert.match(matchCorrectionError({ code: "22023", message: "Nothing would change." }).error, /Nothing would change/);
  const stale = matchCorrectionError({ code: "22023", message: "The final fee is now 4000, not the 3500 confirmed. Review the revised price and confirm it again." });
  assert.ok(stale.fieldErrors.confirm);
  assert.match(matchCorrectionError({ code: "22023", message: "A correction cannot change the type of a membership (duration-based or class-count)." }).error, /cannot change the type/);
  assert.match(matchCorrectionError({ code: "42501", message: "Not authorized." }).error, /permission/);
  assert.match(matchCorrectionError({ code: "55000", message: "A cancelled membership cannot be corrected." }).error, /cancelled/);
  const currency = matchCorrectionError({ code: "55000", message: "The fee that applies is in USD, not this membership's currency INR. A correction never changes the currency; use a Custom Fee Plan." });
  assert.ok(currency.fieldErrors.startDate);
});

test("errors a correction shares with creation fall back to the package rules; anything else is not claimed", () => {
  assert.match(matchCorrectionError({ code: "22023", message: "The final fee must be greater than 0." }).error, /greater than 0/);
  assert.match(matchCorrectionError({ code: "23P01", message: 'conflicting key value violates exclusion constraint "memberships_no_overlap_per_student"' }).error, /already has a membership/);
  assert.match(matchCorrectionError({ code: "23514", message: "The membership cannot start before the student joined (2026-10-10). Correct the join date in Edit Student first." }).error, /cannot start before the student joined/);
  assert.equal(matchCorrectionError({ code: "XX000", message: "boom" }), null);
  assert.equal(matchCorrectionError(null), null);
});

test("the preview the database returns becomes the screen's numbers", () => {
  const preview = previewOf({
    membership_id: MEM, kind: "duration", currency: "INR", package_id: PKG, package_name: "Yoga Monthly", plan: "quarterly",
    total_classes: null, duration_months: 3, start_date: "2026-10-01", end_date: "2026-12-31", pricing_mode: "standard",
    standard_fee: 4500, package_discount: 300, individual_discount_amount: 200, individual_discount_reason_code: "returning_member",
    custom_fee_reason: null, final_fee: 4000, current_amount: 3000, paid_total: 1000, balance_after: 3000,
  });
  assert.equal(preview.finalFee, 4000);
  assert.equal(preview.balanceAfter, 3000);
  assert.equal(preview.paidTotal, 1000);
  assert.equal(preview.endDate, "2026-12-31");
  assert.equal(preview.totalClasses, null);
});

test("a history row lists only what changed, between the stored before and after, and never labels an unknown person Admin", () => {
  const row = correctionHistoryRowFrom(
    {
      id: "c1", corrected_at: "2026-10-15T10:00:00Z", corrected_by: "u1", reason: "Wrong package sold",
      old_values: { package_name: "Monthly", plan: "monthly", start_date: "2026-10-01", end_date: "2026-10-31", amount: 1500, pricing_mode: "standard", currency: "INR", payment_status: "paid" },
      new_values: { package_name: "Quarterly", plan: "quarterly", start_date: "2026-10-01", end_date: "2026-12-31", amount: 4000, pricing_mode: "standard", currency: "INR", payment_status: "partially_paid" },
      old_amount: "1500.00", new_amount: "4000.00", payments_total: "1500.00", old_payment_status: "paid", new_payment_status: "partially_paid",
    },
    (id) => (id ? "Meera Nair" : null)
  );
  assert.deepEqual(row.changes.map((change) => change.key), ["package_name", "plan", "end_date", "amount", "payment_status"]);
  assert.equal(row.oldAmount, 1500);
  assert.equal(row.newAmount, 4000);
  assert.equal(row.paymentsTotal, 1500);
  assert.equal(row.correctedBy, "Meera Nair");
  assert.equal(row.reason, "Wrong package sold");
  assert.equal(row.currency, "INR");
});

// ---- Edit Membership: routine edits and protected terms ---------------------------------------------------------------------------------

const STORED = {
  package_id: PKG, kind: "duration", plan: "quarterly", duration_months: 3, start_date: "2026-10-01", pricing_mode: "standard", amount: 4200,
  individual_discount_type: null, individual_discount_value: null, individual_discount_reason_code: null, individual_discount_note: null, custom_fee_reason: null,
};

test("the form starts from the stored terms", () => {
  assert.deepEqual(currentTermsOf(STORED), {
    package_id: PKG, duration_option: "quarterly", custom_months: "", start_date: "2026-10-01", pricing_mode: "standard",
    individual_discount_type: "none", individual_discount_value: "", individual_discount_reason: "", individual_discount_note: "",
    custom_fee: "", custom_fee_reason: "",
  });
  const custom = currentTermsOf({ ...STORED, plan: "custom", duration_months: 7, pricing_mode: "custom_fee_plan", amount: 3500.5, custom_fee_reason: "Agreed" });
  assert.equal(custom.custom_months, "7");
  assert.equal(custom.custom_fee, "3500.5");
  assert.equal(custom.custom_fee_reason, "Agreed");
  const discounted = currentTermsOf({ ...STORED, individual_discount_type: "percent", individual_discount_value: 10, individual_discount_reason_code: "other", individual_discount_note: "Friend" });
  assert.deepEqual([discounted.individual_discount_type, discounted.individual_discount_value, discounted.individual_discount_reason, discounted.individual_discount_note], ["percent", "10", "other", "Friend"]);
  assert.equal(currentTermsOf({ ...STORED, kind: "class_count", plan: "class_count", duration_months: null }).duration_option, "");
});

test("a routine edit - only the notes, or the same terms re-submitted - is not a protected change", () => {
  const current = currentTermsOf(STORED);
  assert.equal(protectedTermsChanged(current, rawCorrectionInput(current, "duration")), false);
  // Formatting, blanks and "none" are not changes.
  assert.equal(protectedTermsChanged(current, { ...rawCorrectionInput(current, "duration"), start_date: " 2026-10-01 ", individual_discount_type: "none" }), false);
  assert.equal(protectedTermsChanged(current, { ...rawCorrectionInput(current, "duration"), individual_discount_value: "99", individual_discount_reason: "other" }), false, "a discount value without a type is ignored");
  const custom = currentTermsOf({ ...STORED, pricing_mode: "custom_fee_plan", amount: 1500, custom_fee_reason: "Special" });
  assert.equal(protectedTermsChanged(custom, { ...rawCorrectionInput(custom, "duration"), custom_fee: "1500.00" }), false, "1500 and 1500.00 are one fee");
});

test("a change of the package, duration, start date, pricing, custom fee or discount is a protected change", () => {
  const current = currentTermsOf(STORED);
  const raw = rawCorrectionInput(current, "duration");
  assert.equal(protectedTermsChanged(current, { ...raw, package_id: "33333333-3333-4333-8333-333333333333" }), true);
  assert.equal(protectedTermsChanged(current, { ...raw, duration_option: "annual" }), true);
  assert.equal(protectedTermsChanged(current, { ...raw, start_date: "2026-10-02" }), true);
  assert.equal(protectedTermsChanged(current, { ...raw, pricing_mode: "custom_fee_plan", custom_fee: "1000", custom_fee_reason: "Special" }), true);
  assert.equal(protectedTermsChanged(current, { ...raw, individual_discount_type: "fixed", individual_discount_value: "50", individual_discount_reason: "returning_member" }), true);
  const custom = currentTermsOf({ ...STORED, pricing_mode: "custom_fee_plan", amount: 1500, custom_fee_reason: "Special" });
  assert.equal(protectedTermsChanged(custom, { ...rawCorrectionInput(custom, "duration"), custom_fee: "1600" }), true);
  assert.equal(protectedTermsChanged(custom, { ...rawCorrectionInput(custom, "duration"), custom_fee_reason: "Other reason" }), true);
  assert.equal(protectedTermsChanged(custom, { ...rawCorrectionInput(custom, "duration"), pricing_mode: "standard" }), true, "Custom Fee Plan -> standard");
  const months = currentTermsOf({ ...STORED, plan: "custom", duration_months: 7 });
  assert.equal(protectedTermsChanged(months, { ...rawCorrectionInput(months, "duration"), custom_months: "8" }), true);
});

test("the submitted fields carry only what applies: no duration for class-count, no discount in a Custom Fee Plan, no custom fee in standard pricing", () => {
  const values = { ...currentTermsOf(STORED), individual_discount_type: "fixed", individual_discount_value: "50", individual_discount_reason: "other", individual_discount_note: "n", custom_fee: "999", custom_fee_reason: "x", duration_option: "custom", custom_months: "5" };
  const standard = rawCorrectionInput(values, "duration");
  assert.deepEqual([standard.custom_fee, standard.custom_fee_reason, standard.individual_discount_type, standard.custom_months], ["", "", "fixed", "5"]);
  const custom = rawCorrectionInput({ ...values, pricing_mode: "custom_fee_plan" }, "duration");
  assert.deepEqual([custom.custom_fee, custom.individual_discount_type, custom.individual_discount_value], ["999", "", ""]);
  const classCount = rawCorrectionInput(values, "class_count");
  assert.deepEqual([classCount.duration_option, classCount.custom_months], ["", ""]);
});

// ---- the SQL -------------------------------------------------------------------------------------------------------------------------

test("0050 adds the audit table and four functions, re-creates only the package guard, and changes no row", () => {
  assert.deepEqual([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((match) => match[1]), ["membership_term_corrections"]);
  assert.deepEqual([...code.matchAll(/create or replace function public\.(\w+)/g)].map((match) => match[1]), [
    "membership_term_corrections_readonly",
    "membership_term_snapshot",
    "membership_correction_core",
    "preview_membership_correction",
    "correct_membership_terms",
    "memberships_package_guard",
  ]);
  // The only ALTER TABLE is on the new audit table (row level security); no existing table, function or privilege is altered.
  assert.deepEqual([...code.matchAll(/\balter table ([\w.]+)/gi)].map((match) => match[1]), ["public.membership_term_corrections"]);
  assert.doesNotMatch(code, /\b(drop table|drop function)\b|\bgrant (insert|update|delete|all) on\b/i);
  assert.doesNotMatch(code, /\bdelete from\b/i);
  // The only writes: the membership update and the audit row, both inside correct_membership_terms.
  assert.deepEqual([...code.matchAll(/\bupdate public\.(\w+)/g)].map((match) => match[1]), ["memberships"]);
  assert.deepEqual([...code.matchAll(/\binsert into public\.(\w+)/g)].map((match) => match[1]), ["membership_term_corrections"]);
});

test("the audit table is Admin-readable, append-only and holds who, when, why, before and after, and the payments", () => {
  assert.match(code, /create policy "membership_term_corrections_select_admin"\s+on public\.membership_term_corrections\s+for select\s+to authenticated\s+using \(public\.is_admin\(\)\)/);
  assert.match(code, /revoke all on public\.membership_term_corrections from public, anon, authenticated;\s+grant select on public\.membership_term_corrections to authenticated;/);
  for (const column of ["reason", "corrected_by", "corrected_at", "old_values", "new_values", "old_amount", "new_amount", "payments_total", "old_payment_status", "new_payment_status"]) {
    assert.match(code, new RegExp(`\\n  ${column}\\s`), column);
  }
  assert.match(code, /before update or delete on public\.membership_term_corrections/);
  assert.match(code, /before truncate on public\.membership_term_corrections/);
  assert.match(code, /constraint membership_term_corrections_amount_valid check \(new_amount > 0 and new_amount >= payments_total\)/);
  assert.match(code, /constraint membership_term_corrections_reason_valid/);
});

test("the correction is Admin only, with a required reason, the row locked first, and the revised fee confirmed", () => {
  const body = code.slice(code.indexOf("create or replace function public.correct_membership_terms"), code.indexOf("create or replace function public.memberships_package_guard"));
  assert.match(body, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.' using errcode = '42501';/);
  assert.match(body, /if length\(v_reason\) < 3 or length\(v_reason\) > 500 then/);
  assert.ok(body.indexOf("for update") < body.indexOf("membership_correction_core("), "locked before it is priced");
  assert.match(body, /if p_confirmed_fee is null then\s+raise exception 'Confirm the revised final fee/);
  assert.match(body, /if p_confirmed_fee <> v_final then/);
  assert.match(body, /v_status := case when v_paid >= v_final then 'paid' else 'partially_paid' end;/);
  assert.match(body, /set_config\('yoga\.membership_term_correction', v_mem\.id::text, true\)/);
  assert.match(body, /set_config\('yoga\.membership_term_correction', '', true\)/);
  assert.doesNotMatch(body, /\b(insert into|update|delete from) public\.(membership_payments|invoices)/, "no payment or document is written");
});

test("the pricing core refuses a fee that is not above 0 or is below the payments, and keeps the membership's currency", () => {
  const core = code.slice(code.indexOf("create or replace function public.membership_correction_core"), code.indexOf("create or replace function public.preview_membership_correction"));
  assert.match(core, /if v_final < v_paid then\s+raise exception 'The final fee \(%\) cannot be below the payments already recorded \(%\)\.'/);
  assert.match(core, /if v_final <= 0 then\s+raise exception 'The final fee must be greater than 0\.'/);
  assert.match(core, /if v_entry\.currency <> v_mem\.currency then/);
  assert.match(core, /if v_pkg\.kind <> v_mem\.kind then/);
  assert.match(core, /if v_mem\.package_id is null then/);
  assert.match(core, /if v_mem\.cancelled_at is not null then/);
  assert.match(core, /Nothing would change\./);
  // A class-count expiry is not touched here: it keeps the stored value.
  assert.match(core, /v_end := v_mem\.end_date;/);
});

test("the pricing is the creation pricing: the same lines as create_membership_from_package (0048)", () => {
  const creation = read("../../supabase/migrations/0048_package_linked_memberships.sql");
  for (const line of [
    "v_standard := case when v_pkg.kind = 'duration' then v_entry.monthly_fee * v_months else v_entry.price end;",
    "v_end := (p_start_date + make_interval(months => v_months))::date - 1;",
    "else round(v_standard * v_disc.percent_value / 100, 2) end;",
    "else round((v_standard - v_pkg_disc) * p_individual_value / 100, 2) end;",
    "v_final := v_standard - v_pkg_disc - coalesce(v_ind_amount, 0);",
    "v_disc_opt := case when v_months >= 12 then 'annual' when v_months >= 6 then 'half_yearly'",
    "when v_months >= 3 then 'quarterly' end;",
    "raise exception 'The discounts together cannot be more than the standard fee.' using errcode = '22023';",
    "raise exception 'The final fee is too large.' using errcode = '22023';",
  ]) {
    assert.ok(creation.includes(line), `0048: ${line}`);
    assert.ok(sql.includes(line), `0050: ${line}`);
  }
});

test("the package guard is 0049's with exactly one more exemption, which cannot change the student, type or currency", () => {
  const original = read("../../supabase/migrations/0049_class_count_expiry_edits.sql");
  const functionText = (source) => {
    const start = source.indexOf("create or replace function public.memberships_package_guard()");
    return source.slice(start, source.indexOf("\n$$;\n", start) + 5);
  };
  const exemption = `  -- The audited correction of this membership (0050).
  if coalesce(current_setting('yoga.membership_term_correction', true), '') = old.id::text then
    if new.package_id is null or new.student_id is distinct from old.student_id or new.kind is distinct from old.kind
       or new.currency is distinct from old.currency then
      raise exception 'A correction cannot change the student, the type or the currency of a membership.' using errcode = '55006';
    end if;
    return new;
  end if;

`;
  const anchor = "  v_expiry_edit := old.kind = 'class_count'";
  const base = functionText(original);
  assert.ok(base.includes(anchor));
  assert.equal(functionText(sql), base.replace(anchor, () => exemption + anchor));
});

test("the three public functions are Admin-only callable; the core and the snapshot are internal", () => {
  assert.equal((code.match(/\bgrant execute\b/g) ?? []).length, 2, "preview and correct only");
  assert.match(code, /revoke execute on function public\.membership_correction_core\([^)]*\)\s+from public, anon, authenticated;/);
  assert.match(code, /revoke execute on function public\.membership_term_snapshot\(public\.memberships\) from public, anon, authenticated;/);
  assert.equal((code.match(/security definer\s+set search_path = ''/g) ?? []).length, 4, "readonly, core, preview, correct");
  assert.match(sql, /RE-RUN HAZARD: this migration re-creates memberships_package_guard\(\) from 0049/);
});

test("it needs 0049 and 0048 and is independent of 0051-0053", () => {
  assert.match(code, /0050 needs migration 0048/);
  assert.match(code, /0050 needs migration 0049/);
  assert.doesNotMatch(code, /class_count_student_visible|list_class_count_attendance|record_class_count_attendance/);
});

test("the verification script is rollback-only and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.match(script, /P0 migration 0050 is applied/);
  for (const id of ["A1", "A2", "A3", "R1", "R2", "R3", "R4", "S1", "S2", "S3", "C1", "C2", "C3", "P1", "P2", "P3", "P4", "P5", "F1", "F2", "F3", "F4", "K1", "K2", "G1", "G2", "G3", "H1", "H2", "H3", "Z"]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /leftover_students/);
});

// ---- the application -----------------------------------------------------------------------------------------------------------------

test("the server actions are Admin only, validate against the package's type and call the database functions", () => {
  const actions = read("./corrections.js");
  assert.match(actions, /^"use server";/);
  assert.equal((actions.match(/await requireRole\(ROLES\.ADMIN\);/g) ?? []).length, 2);
  assert.doesNotMatch(actions, /ROLES\.INSTRUCTOR/);
  assert.match(actions, /rpc\("preview_membership_correction", prepared\.params\)/);
  assert.match(actions, /rpc\("correct_membership_terms", \{\s*\.\.\.prepared\.params,\s*p_confirmed_fee: confirmed,\s*p_reason: reason\.data,\s*\}\)/);
  assert.match(actions, /validateCorrectionInput\(rawInput \?\? \{\}, pkg\?\.kind \?\? null\)/);
  assert.deepEqual([...actions.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]), ["previewMembershipCorrection", "saveMembershipEdit"]);
  assert.equal([...actions.matchAll(/^export /gm)].length, 2, "only async functions are exported from a use server file");
  assert.doesNotMatch(actions, /service[_-]?role|SERVICE_ROLE|createAdminClient/i);
});

test("the unified save decides from the STORED membership whether it is a correction, and writes no protected column itself", () => {
  const actions = read("./corrections.js");
  const save = actions.slice(actions.indexOf("export async function saveMembershipEdit("));
  assert.match(save, /\.from\("memberships"\)\.select\(STORED_COLUMNS\)\.eq\("id", membershipId\)\.single\(\)/);
  assert.match(save, /const corrected = protectedTermsChanged\(currentTermsOf\(stored\), rawInput \?\? \{\}\);/);
  // A protected change needs the reason and the confirmed fee; a routine edit asks for neither.
  assert.match(save, /if \(corrected\) \{[\s\S]*validateCorrectionReason\(options\.reason\)[\s\S]*parseConfirmedFee\(options\.confirmedFee\)[\s\S]*rpc\("correct_membership_terms"/);
  assert.ok(save.indexOf('rpc("correct_membership_terms"') < save.indexOf("update({ notes: notes.data })"), "the correction first, then the notes");
  // A cancelled membership cannot have protected terms changed.
  assert.match(save, /if \(stored\.cancelled_at\) \{\s*return \{ error: "A cancelled membership's package, price and dates cannot be changed\./);
  // The only column the application updates is the notes; every protected column goes through the database function.
  assert.deepEqual([...save.matchAll(/\.update\((\{[^}]*\})\)/g)].map((match) => match[1]), ["{ notes: notes.data }"]);
  assert.doesNotMatch(save, /membership_payments|invoices|payment_status|\.insert\(|\.delete\(/, "no payment, document or status is written");
});

test("Edit Membership: a package-linked membership gets the editor, a legacy one keeps its form, and the history stays on Membership Details", () => {
  const edit = read("../../app/memberships/[id]/edit/page.js");
  assert.match(edit, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(edit, /isPackageLinked \? \(\s*<PackageMembershipEditor/);
  assert.match(edit, /locked=\{membership\.status === "cancelled"\}/);
  assert.match(edit, /current=\{currentTermsOf\(membership\)\}/);
  assert.match(edit, /action=\{updateMembership\.bind\(null, id\)\}/);

  const page = read("../../app/memberships/[id]/page.js");
  assert.match(page, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(page, /const isPackageLinked = Boolean\(membership\.package_id\);/);
  assert.match(page, /isPackageLinked \? listMembershipTermCorrections\(id\) : Promise\.resolve\(\[\]\)/);
  assert.match(page, /\{isPackageLinked \? \(\s*<CorrectionsPanel/);
  assert.match(page, /canEdit=\{membership\.status !== "cancelled"\}/);
  const panel = read("../../app/memberships/[id]/corrections-panel.js");
  assert.match(panel, /href=\{`\/memberships\/\$\{membershipId\}\/edit`\}/, "the panel links to Edit Membership; there is no second editing entry point");
  assert.doesNotMatch(panel, /Dialog|saveMembershipEdit|correct_membership_terms/);
  assert.match(panel, /corrections === null \?/, "a failed read is said, not shown as an empty history");
});

test("the editor is laid out like Add Membership (Package | Duration, Start | End, then pricing in pairs, then notes) and asks for a reason and confirmation only when a protected term changed", () => {
  const editor = read("../../app/memberships/[id]/edit/package-membership-editor.js");
  for (const id of ["edit-package", "edit-duration", "edit-start", "edit-end", "edit-custom-fee", "edit-discount-type", "edit-notes-field"]) {
    assert.ok(editor.includes(`id="${id}"`), id);
  }
  assert.ok((editor.match(/className="grid gap-5 sm:grid-cols-2"/g) ?? []).length >= 2, "two-column grids, as Add Membership");
  assert.ok(editor.includes('className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-5"'), "the same divided button row");
  assert.match(editor, /const termsChanged = !locked && protectedTermsChanged\(current, rawCorrectionInput\(values, kind\)\);/);
  // A notes-only save goes straight to the server action with the CURRENT terms and no reason or fee.
  assert.match(editor, /saveMembershipEdit\(membershipId, rawCorrectionInput\(current, kind\), \{ notes \}\)/);
  // A protected change is previewed first, then saved with the confirmed fee and the reason.
  assert.match(editor, /previewMembershipCorrection\(membershipId, raw\)/);
  assert.match(editor, /saveMembershipEdit\(membershipId, rawCorrectionInput\(values, kind\), \{ notes, confirmedFee: preview\.finalFee, reason \}\)/);
  assert.match(editor, /validateCorrectionReason\(reason\)/);
  assert.match(editor, /Confirm the revised final fee before saving\./);
  assert.match(editor, /I confirm the revised final fee of/);
  assert.match(editor, /<Row label="Paid so far"/);
  assert.match(editor, /<Row label="Balance after"/);
  assert.match(editor, /<Row label="Revised final fee"/);
  assert.match(editor, /Payments and\s+issued receipts stay exactly as they are\./);
  assert.match(editor, /Nothing has changed\./);
  // A class-count expiry and a duration end date are shown, never edited here.
  assert.match(editor, /changed only with Edit\s+expiry/);
  assert.match(editor, /<Input \{\.\.\.field\} readOnly/);
});

test("the superseded dialog, notes-only form and notes-only action are gone, and the ordinary Edit action still refuses a package membership", () => {
  for (const path of ["../../app/memberships/[id]/correct-terms-dialog.js", "../../app/memberships/package-membership-edit-form.js"]) {
    assert.throws(() => readFileSync(new URL(path, import.meta.url)), /ENOENT/, path);
  }
  const actions = read("../memberships/actions.js");
  assert.doesNotMatch(actions, /updatePackageMembershipNotes/);
  assert.match(actions, /if \(existing\.package_id\) \{\s*return \{ error: PACKAGE_MEMBERSHIP_EDIT_MESSAGE/);
  assert.doesNotMatch(actions, /correct_membership_terms|preview_membership_correction/, "the legacy actions know nothing of corrections");
});

test("the section 6A ledger records 0050 as applied, with the reported behaviour result", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0050` |"));
  assert.ok(row, "a 0050 row");
  assert.match(row, /Applied; behaviour script passed — 35 passed, 0 failed, 0 not tested/);
  assert.match(row, /reported by the user/);
  assert.match(row, /FS-8/);
});
