// Run with `npm test` (Node's built-in test runner).
//
// V1 Fee Structure, FS-3 - the package services: the validators that run before anything is sent, the mapping of the
// database's own messages, and the database calls (with a fake client, so what is checked is the function name and the
// exact parameters). The database functions themselves are SQL (migration 0047) and are exercised by
// supabase/verification/verify_0047_package_fee_functions_behavior.sql.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelFeeEntryFor,
  correctFeeEntryFor,
  createPackageFor,
  editFeeEntryFor,
  feeEntryStatus,
  matchKnownPackageError,
  scheduleFeeEntryFor,
  setPackageStatusFor,
  updatePackageDetailsFor,
  updatePackageTermsFor,
  validateCancelInput,
  validateCorrectionInput,
  validateFeeInput,
  validatePackageDetailsInput,
  validatePackageInput,
  validatePackageTermsInput,
  validateStatusInput,
} from "./service-core.js";

/** A fake Supabase client: records every rpc and answers with what the test queued. */
function fakeClient(response = { data: null, error: null }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, params) => {
      calls.push({ name, params });
      return response;
    },
  };
}

const ok = (result) => {
  assert.equal(result.success, true, JSON.stringify(result.errors));
  return result.data;
};
const errors = (result) => {
  assert.equal(result.success, false);
  return result.errors;
};

// ---- a new package -----------------------------------------------------------------------------------

test("a duration package needs a name and at least one valid option, and no class allowance", () => {
  assert.deepEqual(ok(validatePackageInput({ name: "  Yoga Basic ", description: "", kind: "duration", options: ["quarterly", "monthly", "monthly"] })), {
    name: "Yoga Basic",
    description: null,
    kind: "duration",
    totalClasses: null,
    options: ["monthly", "quarterly"],
  });
  assert.equal(errors(validatePackageInput({ name: "Yoga", kind: "duration", options: [] })).options, "Select at least one duration option.");
  assert.equal(errors(validatePackageInput({ name: "Yoga", kind: "duration", options: ["weekly"] })).options, "Select valid duration options.");
  assert.equal(errors(validatePackageInput({ name: "Yoga", kind: "duration", options: ["monthly"], totalClasses: "5" })).totalClasses, "A duration package has no class allowance.");
});

test("a class-count package needs a whole class allowance of at least 1, and no duration options", () => {
  assert.deepEqual(ok(validatePackageInput({ name: "Ten classes", kind: "class_count", totalClasses: " 10 " })).totalClasses, 10);
  for (const value of ["", "0", "-3", "2.5", "abc", "2147483648"]) {
    assert.ok(errors(validatePackageInput({ name: "Ten classes", kind: "class_count", totalClasses: value })).totalClasses, value);
  }
  assert.equal(errors(validatePackageInput({ name: "Ten classes", kind: "class_count", totalClasses: "10", options: ["monthly"] })).options,
    "A class-count package has no duration options.");
});

test("a package name is 2 to 100 characters (counted as characters) and a description at most 500", () => {
  assert.ok(errors(validatePackageInput({ name: "A", kind: "class_count", totalClasses: "1" })).name);
  assert.ok(errors(validatePackageInput({ name: "   ", kind: "class_count", totalClasses: "1" })).name);
  assert.equal(ok(validatePackageInput({ name: "ab", kind: "class_count", totalClasses: "1" })).name, "ab");
  assert.equal(ok(validatePackageInput({ name: "🙂".repeat(100), kind: "class_count", totalClasses: "1" })).name.length, 200);
  assert.ok(errors(validatePackageInput({ name: "🙂".repeat(101), kind: "class_count", totalClasses: "1" })).name);
  assert.ok(errors(validatePackageInput({ name: "Ok", description: "d".repeat(501), kind: "class_count", totalClasses: "1" })).description);
  assert.equal(ok(validatePackageInput({ name: "Ok", description: "d".repeat(500), kind: "class_count", totalClasses: "1" })).description.length, 500);
  assert.equal(errors(validatePackageInput({ name: "Ok", kind: "weekly" })).kind, "Select a valid package type.");
});

test("details, terms and status inputs", () => {
  assert.deepEqual(ok(validatePackageDetailsInput({ name: " New name ", description: " d " })), { name: "New name", description: "d" });
  assert.ok(errors(validatePackageDetailsInput({ name: "x" })).name);

  assert.deepEqual(ok(validatePackageTermsInput("class_count", { totalClasses: "12", reason: " More classes " })),
    { totalClasses: 12, options: [], reason: "More classes" });
  assert.deepEqual(ok(validatePackageTermsInput("duration", { options: ["annual", "monthly"] })),
    { totalClasses: null, options: ["annual", "monthly"], reason: null });
  assert.ok(errors(validatePackageTermsInput("duration", { options: [] })).options);
  assert.ok(errors(validatePackageTermsInput("class_count", { totalClasses: "" })).totalClasses);
  assert.ok(errors(validatePackageTermsInput("duration", { options: ["monthly"], reason: "ab" })).reason);
  assert.equal(errors(validatePackageTermsInput("weekly", {})).kind, "Select a valid package type.");

  assert.deepEqual(ok(validateStatusInput({ status: "inactive", reason: "Not offered now" })), { status: "inactive", reason: "Not offered now" });
  assert.deepEqual(ok(validateStatusInput({ status: "active" })), { status: "active", reason: null });
  assert.equal(errors(validateStatusInput({ status: "paused" })).status, "Select a valid status.");
});

// ---- a fee entry -------------------------------------------------------------------------------------

test("a fee entry: the date, the amount as a two-decimal string, and an optional reason", () => {
  assert.deepEqual(ok(validateFeeInput("duration", { effectiveFrom: "2026-11-01", amount: "1500" })),
    { effectiveFrom: "2026-11-01", amount: "1500.00", discounts: [], reason: null });
  assert.equal(ok(validateFeeInput("class_count", { effectiveFrom: "2026-11-01", amount: " 2500.5 ", reason: "New price list" })).amount, "2500.50");
  for (const amount of ["", "0", "0.00", "-5", "1.005", "abc", "100000000"]) {
    assert.ok(errors(validateFeeInput("duration", { effectiveFrom: "2026-11-01", amount })).amount, amount);
  }
  assert.ok(errors(validateFeeInput("duration", { effectiveFrom: "2026-02-30", amount: "10" })).effectiveFrom);
  assert.ok(errors(validateFeeInput("duration", { effectiveFrom: "", amount: "10" })).effectiveFrom);
  assert.ok(errors(validateFeeInput("duration", { effectiveFrom: "2026-11-01", amount: "10", reason: "ab" })).reason);
  assert.equal(errors(validateFeeInput("weekly", { effectiveFrom: "2026-11-01", amount: "10" })).kind, "Select a valid package type.");
});

test("an edit must keep the date after today, so a scheduled fee never becomes a fee in effect through an edit", () => {
  const input = { effectiveFrom: "2026-10-13", amount: "10" };
  assert.ok(errors(validateFeeInput("duration", input, { today: "2026-10-13", requireFuture: true })).effectiveFrom);
  assert.equal(validateFeeInput("duration", { ...input, effectiveFrom: "2026-10-14" }, { today: "2026-10-13", requireFuture: true }).success, true);
  // Scheduling (no requireFuture) may use today or an earlier date: the fee is then in effect at once.
  assert.equal(validateFeeInput("duration", input, { today: "2026-10-13" }).success, true);
});

test("package discounts: quarterly, half_yearly and annual only, once each, fixed or percentage, as two-decimal strings", () => {
  const data = ok(validateFeeInput("duration", {
    effectiveFrom: "2026-11-01",
    amount: "1500",
    discounts: [
      { option: "quarterly", type: "fixed", value: "300" },
      { option: "half_yearly", type: "percent", value: "10" },
      { option: "annual", type: "percent", value: "12.5" },
    ],
  }));
  assert.deepEqual(data.discounts, [
    { option: "quarterly", type: "fixed", value: "300.00" },
    { option: "half_yearly", type: "percent", value: "10.00" },
    { option: "annual", type: "percent", value: "12.50" },
  ]);
});

test("package discounts: Monthly, Custom, duplicates, bad values and class-count discounts are refused", () => {
  const withDiscounts = (kind, discounts) => errors(validateFeeInput(kind, { effectiveFrom: "2026-11-01", amount: "1500", discounts })).discounts;
  assert.match(withDiscounts("duration", [{ option: "monthly", type: "fixed", value: "100" }]), /Quarterly, Half Yearly and Annual only/);
  assert.match(withDiscounts("duration", [{ option: "custom", type: "fixed", value: "100" }]), /Quarterly, Half Yearly and Annual only/);
  assert.match(withDiscounts("duration", [
    { option: "annual", type: "fixed", value: "100" }, { option: "annual", type: "percent", value: "5" },
  ]), /only one package discount/);
  assert.ok(withDiscounts("duration", [{ option: "annual", type: "percent", value: "100.01" }]));
  assert.ok(withDiscounts("duration", [{ option: "annual", type: "fixed", value: "0" }]));
  assert.ok(withDiscounts("duration", [{ option: "annual", type: "bonus", value: "5" }]));
  assert.equal(withDiscounts("class_count", [{ option: "annual", type: "fixed", value: "100" }]), "A class-count package has no package discounts.");
});

test("cancelling: the reason is optional here (the database requires it when the fee is in effect)", () => {
  assert.deepEqual(ok(validateCancelInput({})), { reason: null });
  assert.deepEqual(ok(validateCancelInput({ reason: " Entered by mistake " })), { reason: "Entered by mistake" });
  assert.ok(errors(validateCancelInput({ reason: "ab" })).reason);
});

test("correcting: the reason is required, and the amount and discounts are validated like a fee", () => {
  assert.deepEqual(ok(validateCorrectionInput("duration", {
    amount: "1600", reason: "Typing error", discounts: [{ option: "annual", type: "percent", value: "15" }],
  })), { amount: "1600.00", discounts: [{ option: "annual", type: "percent", value: "15.00" }], reason: "Typing error" });
  assert.equal(errors(validateCorrectionInput("duration", { amount: "1600" })).reason, "Enter the reason for the correction.");
  assert.ok(errors(validateCorrectionInput("duration", { amount: "1600", reason: "ab" })).reason);
  assert.ok(errors(validateCorrectionInput("duration", { amount: "0", reason: "Typing error" })).amount);
});

test("a fee entry is cancelled, scheduled, or in effect (today included)", () => {
  assert.equal(feeEntryStatus({ effective_from: "2026-10-12", cancelled_at: "2026-10-13T00:00:00Z" }, "2026-10-13"), "cancelled");
  assert.equal(feeEntryStatus({ effective_from: "2026-10-14", cancelled_at: null }, "2026-10-13"), "scheduled");
  assert.equal(feeEntryStatus({ effective_from: "2026-10-13", cancelled_at: null }, "2026-10-13"), "in_effect");
  assert.equal(feeEntryStatus({ effective_from: "2026-01-01" }, "2026-10-13"), "in_effect");
});

// ---- the database's own messages -----------------------------------------------------------------------

test("known database messages become field errors; anything else is left to the caller", () => {
  assert.deepEqual(matchKnownPackageError({ code: "23505", message: 'duplicate key value violates unique constraint "packages_name_unique"' }),
    { error: "A package with this name already exists. Names ignore case and include deactivated packages.", fieldErrors: { name: "A package with this name already exists. Names ignore case and include deactivated packages." }, code: "23505" });
  assert.equal(matchKnownPackageError({ code: "23505", message: 'violates unique constraint "package_fee_entries_package_date_unique"' }).fieldErrors.effectiveFrom,
    "This package already has a fee taking effect on that date.");
  assert.equal(matchKnownPackageError({ code: "42501", message: "Not authorized." }).error, "You do not have permission to manage packages.");
  assert.equal(matchKnownPackageError({ code: "22023", message: "Enter the reason for cancelling a fee that is in effect." }).fieldErrors.reason,
    "Enter the reason for cancelling a fee that is in effect.");
  // A discount message is shown as the database wrote it.
  assert.equal(matchKnownPackageError({ code: "22023", message: "Enter a discount greater than 0, with at most two decimal places." }).fieldErrors.discounts,
    "Enter a discount greater than 0, with at most two decimal places.");
  assert.match(matchKnownPackageError({ code: "55006", message: "A fee entry in effect cannot be edited. Correct it instead." }).error, /Correct it instead/);
  // Unknown code, or a known code with a message that is not one of the rules': not ours.
  assert.equal(matchKnownPackageError({ code: "22023", message: "something else" }), null);
  assert.equal(matchKnownPackageError({ code: "XX000", message: "Not authorized." }), null);
  assert.equal(matchKnownPackageError(null), null);
});

// ---- the database calls --------------------------------------------------------------------------------

test("creating a package calls create_package with exactly its parameters, and returns the new id", async () => {
  const supabase = fakeClient({ data: "pkg-1", error: null });
  const result = await createPackageFor(supabase, { name: "Yoga Basic", description: null, kind: "duration", totalClasses: null, options: ["monthly"] });
  assert.deepEqual(result, { success: true, packageId: "pkg-1" });
  assert.deepEqual(supabase.calls, [{ name: "create_package", params: {
    p_name: "Yoga Basic", p_description: null, p_kind: "duration", p_total_classes: null, p_options: ["monthly"],
  } }]);

  const cls = fakeClient({ data: "pkg-2", error: null });
  await createPackageFor(cls, { name: "Ten", description: "d", kind: "class_count", totalClasses: 10, options: [] });
  assert.deepEqual(cls.calls[0].params, { p_name: "Ten", p_description: "d", p_kind: "class_count", p_total_classes: 10, p_options: null });
});

test("every other change calls its own function with its own parameters", async () => {
  const supabase = fakeClient({ data: null, error: null });

  await updatePackageDetailsFor(supabase, "p1", { name: "N", description: null });
  await updatePackageTermsFor(supabase, "p1", "duration", { totalClasses: null, options: ["annual"], reason: null });
  await updatePackageTermsFor(supabase, "p2", "class_count", { totalClasses: 12, options: [], reason: "More" });
  await setPackageStatusFor(supabase, "p1", { status: "inactive", reason: null });
  await scheduleFeeEntryFor(supabase, "p1", { effectiveFrom: "2026-11-01", amount: "1500.00", discounts: [], reason: null });
  await editFeeEntryFor(supabase, "e1", { effectiveFrom: "2026-12-01", amount: "1600.00", discounts: [], reason: "Revised" });
  await cancelFeeEntryFor(supabase, "e1", { reason: null });
  await correctFeeEntryFor(supabase, "e2", { amount: "1700.00", discounts: [], reason: "Typing error" });

  assert.deepEqual(supabase.calls.map((c) => c.name), [
    "update_package_details", "update_package_terms", "update_package_terms", "set_package_status",
    "schedule_fee_entry", "edit_fee_entry", "cancel_fee_entry", "correct_fee_entry",
  ]);
  assert.deepEqual(supabase.calls[1].params, { p_package_id: "p1", p_total_classes: null, p_options: ["annual"], p_reason: null });
  assert.deepEqual(supabase.calls[2].params, { p_package_id: "p2", p_total_classes: 12, p_options: null, p_reason: "More" });
  assert.deepEqual(supabase.calls[4].params, { p_package_id: "p1", p_effective_from: "2026-11-01", p_amount: "1500.00", p_discounts: [], p_reason: null });
  assert.deepEqual(supabase.calls[7].params, { p_entry_id: "e2", p_amount: "1700.00", p_discounts: [], p_reason: "Typing error" });
});

test("scheduling and correcting return the new entry's id", async () => {
  assert.deepEqual(await scheduleFeeEntryFor(fakeClient({ data: "entry-1", error: null }), "p1", { effectiveFrom: "2026-11-01", amount: "1.00", discounts: [], reason: null }),
    { success: true, entryId: "entry-1" });
  assert.deepEqual(await correctFeeEntryFor(fakeClient({ data: "entry-2", error: null }), "e1", { amount: "2.00", discounts: [], reason: "Typing error" }),
    { success: true, entryId: "entry-2" });
});

test("a known database refusal is returned as a field error; an unknown one as a generic message and is logged", async () => {
  const known = await cancelFeeEntryFor(fakeClient({ data: null, error: { code: "22023", message: "Enter the reason for cancelling a fee that is in effect." } }), "e1", { reason: null });
  assert.equal(known.fieldErrors.reason, "Enter the reason for cancelling a fee that is in effect.");

  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const unknown = await setPackageStatusFor(fakeClient({ data: null, error: { code: "XX000", message: "boom" } }), "p1", { status: "active", reason: null });
    assert.deepEqual(unknown, { error: "Could not change the package status. Try again." });
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /set_package_status failed: XX000 boom/);
});
