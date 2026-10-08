// Run with `npm test` (Node's built-in test runner).
//
// The membership form's fields and their lifecycle. Base UI warns when an UNCONTROLLED `Input`'s
// defaultValue changes after it was first rendered. The form's inputs whose starting value can change
// after the first render - a failed save hands the submitted values back (`state.values`) - must
// therefore be controlled, like Plan and the two dates already are. There is no DOM in the unit run,
// so the form is pinned from its source, the project's way for components.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateMembershipEndDate } from "./validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const FORM = code("../../app/memberships/membership-form.js");

/** Every <Input ... /> element of the form, as text. */
const inputs = () => [...FORM.matchAll(/<Input\b[\s\S]*?\/>/g)].map((m) => m[0]);

test("no Input of the form is uncontrolled: none has a defaultValue", () => {
  const all = inputs();
  assert.ok(all.length >= 3, "start date, end date and amount at least");
  for (const input of all) assert.doesNotMatch(input, /defaultValue/, input.slice(0, 80));
});

test("the amount is controlled: state, value and onChange - starting from the same sources as before", () => {
  assert.match(FORM, /const \[amount, setAmount\] = useState\(\s*String\(state\?\.values\?\.amount \?\? membership\?\.amount \?\? initialValues\?\.amount \?\? ""\)\s*\);/);
  const amountInput = inputs().find((input) => /name="amount"/.test(input));
  assert.ok(amountInput);
  assert.match(amountInput, /value=\{amount\}/);
  assert.match(amountInput, /onChange=\{\(event\) => setAmount\(event\.target\.value\)\}/);
  // Everything else about the field is as it was.
  assert.match(amountInput, /type="number"\s+inputMode="decimal"\s+min="0"\s+step="0\.01"\s+required\s+disabled=\{isPending\}/);
  assert.match(amountInput, /placeholder="Enter amount"/);
});

test("the controlled fields all take their first value from the same place: saved record, renewal, or a failed save", () => {
  for (const field of ["plan", "start_date", "end_date", "payment_status", "amount"]) {
    assert.match(FORM, new RegExp(`state\\?\\.values\\?\\.${field} \\?\\? membership\\?\\.${field} \\?\\? initialValues\\?\\.${field}`), field);
  }
});

test("the field still submits: the input keeps its name, so the form data and the review step see the typed amount", () => {
  const amountInput = inputs().find((input) => /name="amount"/.test(input));
  assert.match(amountInput, /id="amount"\s+name="amount"/);
  assert.match(FORM, /amount: formData\.get\("amount"\)/);
});

test("the plan and date behaviour is untouched: standard plans recalculate the end date, Custom does not", () => {
  assert.match(FORM, /function recalculateEndDate\(nextPlan, nextStartDate\) \{\s*if \(nextPlan === "custom"\) return;\s*const calculated = calculateMembershipEndDate\(nextPlan, nextStartDate\);\s*if \(calculated\) setEndDate\(calculated\);\s*\}/);
  assert.match(FORM, /function handlePlanChange\(value\) \{\s*setPlan\(value\);\s*recalculateEndDate\(value, startDate\);\s*\}/);
  assert.match(FORM, /function handleStartDateChange\(event\) \{\s*const value = event\.target\.value;\s*setStartDate\(value\);\s*recalculateEndDate\(plan, value\);\s*\}/);
  // What each plan produces for a start date (the form calls exactly this).
  assert.equal(calculateMembershipEndDate("monthly", "2026-10-01"), "2026-10-31");
  assert.equal(calculateMembershipEndDate("quarterly", "2026-10-01"), "2026-12-31");
  assert.equal(calculateMembershipEndDate("half_yearly", "2026-10-01"), "2027-03-31");
  assert.equal(calculateMembershipEndDate("annual", "2026-10-01"), "2027-09-30");
  assert.equal(calculateMembershipEndDate("custom", "2026-10-01"), "", "Custom: nothing is calculated, the Admin enters it");
});

test("no remount trick and no suppression: the fix is controlled state, not a key or a warning filter", () => {
  assert.doesNotMatch(FORM, /\bkey=\{(?!option\.value)/, "no key forcing a remount");
  assert.doesNotMatch(FORM, /console\.(warn|error)\s*=|suppress/i);
  // The notes field is a Textarea (not a Base UI Input) and keeps its defaultValue, as the other forms do.
  assert.match(FORM, /<Textarea[\s\S]*?defaultValue=\{state\?\.values\?\.notes/);
});
