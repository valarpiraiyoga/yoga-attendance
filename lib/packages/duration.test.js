// Run with `npm test` (Node's built-in test runner).
//
// V1 Fee Structure, FS-1 - durations of package-linked memberships: the months of each duration option, the standard
// duration whose package discount a Custom duration uses, and the clamped, inclusive end date (01-product.md §5).

import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_MONTHS_MAX,
  CUSTOM_MONTHS_MIN,
  DURATION_OPTIONS,
  STANDARD_DURATION_MONTHS,
  calculateDurationEndDate,
  packageDiscountDurationFor,
  resolveDurationMonths,
} from "./duration.js";

const endDate = (start, months) => calculateDurationEndDate(start, months).data;

// ---- resolveDurationMonths ----------------------------------------------------------------------------------------

test("the standard options stand for 1, 3, 6 and 12 months", () => {
  assert.deepEqual(STANDARD_DURATION_MONTHS, { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 });
  assert.deepEqual(DURATION_OPTIONS, ["monthly", "quarterly", "half_yearly", "annual", "custom"]);
  for (const [option, months] of Object.entries(STANDARD_DURATION_MONTHS)) {
    assert.deepEqual(resolveDurationMonths(option), { success: true, data: months });
  }
});

test("a standard option ignores any custom months given with it", () => {
  assert.deepEqual(resolveDurationMonths("quarterly", "7"), { success: true, data: 3 });
});

test("Custom accepts whole months from 1 to 120, given as text or a number", () => {
  assert.equal(CUSTOM_MONTHS_MIN, 1);
  assert.equal(CUSTOM_MONTHS_MAX, 120);
  assert.deepEqual(resolveDurationMonths("custom", "1"), { success: true, data: 1 });
  assert.deepEqual(resolveDurationMonths("custom", " 5 "), { success: true, data: 5 });
  assert.deepEqual(resolveDurationMonths("custom", 120), { success: true, data: 120 });
});

test("Custom refuses months that are not a whole number from 1 to 120", () => {
  for (const months of ["0", "121", "1.5", "-3", "abc", "", null, undefined, "3 months", 2.5]) {
    const result = resolveDurationMonths("custom", months);
    assert.equal(result.success, false, `months ${JSON.stringify(months)}`);
    assert.equal(result.errors.custom_months, "Enter a whole number of months from 1 to 120.");
  }
});

test("an unknown duration option is refused", () => {
  for (const option of ["weekly", "Monthly", "", null, undefined, "class_count"]) {
    const result = resolveDurationMonths(option, "3");
    assert.equal(result.success, false, `option ${JSON.stringify(option)}`);
    assert.equal(result.errors.duration_option, "Select a valid duration.");
  }
});

// ---- packageDiscountDurationFor -----------------------------------------------------------------------------------

test("a duration takes the discount of the largest standard duration not exceeding it", () => {
  const expected = {
    1: "monthly",
    2: "monthly",
    3: "quarterly",
    5: "quarterly",
    6: "half_yearly",
    7: "half_yearly",
    10: "half_yearly",
    11: "half_yearly",
    12: "annual",
    13: "annual",
    120: "annual",
  };
  for (const [months, option] of Object.entries(expected)) {
    assert.equal(packageDiscountDurationFor(Number(months)), option, `${months} months`);
  }
});

test("no standard duration fits below one month", () => {
  for (const months of [0, -1, 1.5, NaN, null, undefined]) {
    assert.equal(packageDiscountDurationFor(months), null);
  }
});

// ---- calculateDurationEndDate -------------------------------------------------------------------------------------

test("end date: add calendar months, then subtract one day", () => {
  assert.equal(endDate("2026-01-15", 1), "2026-02-14");
  assert.equal(endDate("2026-03-01", 1), "2026-03-31");
  assert.equal(endDate("2026-04-10", 3), "2026-07-09");
  assert.equal(endDate("2026-01-01", 12), "2026-12-31");
});

test("end date: a shorter target month clamps the anniversary to its last day", () => {
  assert.equal(endDate("2027-01-31", 1), "2027-02-27"); // 28 Feb 2027, minus one day
  assert.equal(endDate("2026-11-30", 3), "2027-02-27");
  assert.equal(endDate("2026-08-31", 6), "2027-02-27");
  assert.equal(endDate("2026-03-31", 1), "2026-04-29"); // 30 Apr, minus one day
  assert.equal(endDate("2026-05-31", 1), "2026-06-29");
});

test("end date: leap years", () => {
  assert.equal(endDate("2028-01-31", 1), "2028-02-28"); // 29 Feb 2028, minus one day
  assert.equal(endDate("2028-02-29", 12), "2029-02-27"); // 28 Feb 2029, minus one day
  assert.equal(endDate("2028-02-29", 1), "2028-03-28");
  assert.equal(endDate("2027-02-28", 12), "2028-02-27");
});

test("end date: year boundaries and long durations", () => {
  assert.equal(endDate("2026-12-15", 1), "2027-01-14");
  assert.equal(endDate("2026-12-01", 1), "2026-12-31");
  assert.equal(endDate("2026-10-31", 4), "2027-02-27");
  assert.equal(endDate("2026-01-31", 120), "2036-01-30");
  assert.equal(endDate("2026-06-15", 13), "2027-07-14");
});

test("end date: an invalid start date is refused", () => {
  for (const start of ["2026-02-30", "2026-13-01", "2026-1-5", "", null, undefined, "not a date"]) {
    const result = calculateDurationEndDate(start, 1);
    assert.equal(result.success, false, `start ${JSON.stringify(start)}`);
    assert.equal(result.errors.start_date, "Enter a valid start date.");
  }
});

test("end date: months outside 1 to 120 are refused", () => {
  for (const months of [0, 121, 1.5, -1, "3", null]) {
    const result = calculateDurationEndDate("2026-01-15", months);
    assert.equal(result.success, false, `months ${JSON.stringify(months)}`);
    assert.ok(result.errors.months);
  }
});
