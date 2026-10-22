// Run with `npm test` (Node's built-in test runner).
//
// The centre's financial year runs 1 April - 31 March, both days included, and is named by the year it starts in. "The current
// financial year" is read from the centre's own day in its time zone, never the machine's: every instant below is a fixed UTC
// instant, so the results do not depend on where the tests run.

import test from "node:test";
import assert from "node:assert/strict";
import {
  FINANCIAL_YEAR_START_MONTH,
  currentFinancialYear,
  financialYearOf,
  financialYearRange,
  formatFinancialYear,
} from "./financial-year.js";

// ---- financialYearOf ------------------------------------------------------------------------------------------------

test("the financial year starts in April", () => {
  assert.equal(FINANCIAL_YEAR_START_MONTH, 4);
});

test("31 March belongs to the financial year that started the previous April; 1 April starts a new one", () => {
  assert.equal(financialYearOf("2025-03-31"), 2024);
  assert.equal(financialYearOf("2025-04-01"), 2025);
  assert.equal(financialYearOf("2026-03-31"), 2025);
  assert.equal(financialYearOf("2026-04-01"), 2026);
});

test("every month falls in the right financial year", () => {
  for (const [date, fy] of [
    ["2026-01-01", 2025], ["2026-02-15", 2025], ["2026-03-01", 2025],
    ["2026-04-30", 2026], ["2026-05-01", 2026], ["2026-09-30", 2026], ["2026-12-31", 2026],
  ]) {
    assert.equal(financialYearOf(date), fy, date);
  }
});

test("29 February counts in a leap year", () => {
  assert.equal(financialYearOf("2028-02-29"), 2027);
  assert.equal(financialYearOf("2024-02-29"), 2023);
});

test("an invalid or malformed date has no financial year", () => {
  for (const value of [
    "2027-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-4-1", "2026/04/01", "01-04-2026",
    "2026-04-01T00:00:00Z", " 2026-04-01", "", "not a date", null, undefined, 20260401, new Date("2026-04-01"), {},
  ]) {
    assert.equal(financialYearOf(value), null, String(value));
  }
});

// ---- financialYearRange -------------------------------------------------------------------------------------------

test("a financial year runs from 1 April to 31 March of the next year", () => {
  assert.deepEqual(financialYearRange(2025), { from: "2025-04-01", to: "2026-03-31" });
  assert.deepEqual(financialYearRange(2026), { from: "2026-04-01", to: "2027-03-31" });
});

test("both ends of the range belong to the financial year, and the days just outside do not", () => {
  const { from, to } = financialYearRange(2025);
  assert.equal(financialYearOf(from), 2025);
  assert.equal(financialYearOf(to), 2025);
  assert.equal(financialYearOf("2025-03-31"), 2024);
  assert.equal(financialYearOf("2026-04-01"), 2026);
});

test("consecutive financial years meet without a gap or an overlap", () => {
  for (let fy = 2020; fy < 2030; fy += 1) {
    const end = new Date(`${financialYearRange(fy).to}T00:00:00Z`);
    const nextStart = new Date(`${financialYearRange(fy + 1).from}T00:00:00Z`);
    assert.equal(nextStart - end, 86_400_000, String(fy));
  }
});

test("a range that includes 29 February has 366 days, otherwise 365", () => {
  const days = (fy) => {
    const { from, to } = financialYearRange(fy);
    return (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  };
  assert.equal(days(2027), 366); // includes 2028-02-29
  assert.equal(days(2023), 366); // includes 2024-02-29
  assert.equal(days(2025), 365);
  assert.equal(days(2026), 365);
  assert.equal(days(2099), 365); // 2100 is not a leap year
  assert.equal(days(1999), 366); // 2000 is
});

test("an invalid financial year has no range", () => {
  for (const value of [2025.5, NaN, Infinity, -2025, 0, 999, 9999, "2025", null, undefined, {}]) {
    assert.equal(financialYearRange(value), null, String(value));
  }
});

// ---- currentFinancialYear ------------------------------------------------------------------------------------------

test("Asia/Kolkata: the financial year changes at midnight in India, while it is still 31 March in UTC", () => {
  // 18:29:59Z is 23:59:59 on 31 March in India (UTC+05:30); 18:30:00Z is 00:00:00 on 1 April.
  assert.equal(currentFinancialYear(new Date("2026-03-31T18:29:59Z"), "Asia/Kolkata"), 2025);
  assert.equal(currentFinancialYear(new Date("2026-03-31T18:30:00Z"), "Asia/Kolkata"), 2026);
});

test("America/New_York: the financial year changes at midnight in New York, after it is already 1 April in UTC", () => {
  // New York is on daylight time (UTC-04:00) from 8 March 2026, so its midnight on 1 April is 04:00Z.
  assert.equal(currentFinancialYear(new Date("2026-04-01T03:59:59Z"), "America/New_York"), 2025);
  assert.equal(currentFinancialYear(new Date("2026-04-01T04:00:00Z"), "America/New_York"), 2026);
});

test("the same instant can be a different financial year in different centres", () => {
  const instant = new Date("2026-03-31T20:00:00Z");
  assert.equal(currentFinancialYear(instant, "Asia/Kolkata"), 2026); // 01:30 on 1 April
  assert.equal(currentFinancialYear(instant, "UTC"), 2025); // 20:00 on 31 March
  assert.equal(currentFinancialYear(instant, "America/New_York"), 2025); // 16:00 on 31 March
});

test("the time zone defaults to Asia/Kolkata", () => {
  assert.equal(currentFinancialYear(new Date("2026-03-31T18:30:00Z")), 2026);
});

test("without an instant it reads the current time", () => {
  const fy = currentFinancialYear(undefined, "Asia/Kolkata");
  assert.ok(Number.isInteger(fy) && fy >= 2025, String(fy));
});

test("an invalid instant or time zone has no current financial year", () => {
  const instant = new Date("2026-04-01T12:00:00Z");
  for (const zone of ["IST", "+05:30", "India", "Mars/Base", "", null, 42]) {
    assert.equal(currentFinancialYear(instant, zone), null, String(zone));
  }
  for (const value of [new Date("not a date"), "2026-04-01T12:00:00Z", 1775044800000, null, {}]) {
    assert.equal(currentFinancialYear(value, "Asia/Kolkata"), null, String(value));
  }
});

// ---- formatFinancialYear -----------------------------------------------------------------------------------------

test("a financial year is labelled with both calendar years and an en dash", () => {
  assert.equal(formatFinancialYear(2025), "FY 2025–26");
  assert.equal(formatFinancialYear(2026), "FY 2026–27");
  assert.equal(formatFinancialYear(2009), "FY 2009–10");
  assert.equal(formatFinancialYear(2099), "FY 2099–00");
  assert.equal(formatFinancialYear(2026).charAt(7), "–");
});

test("the label of a date's financial year", () => {
  assert.equal(formatFinancialYear(financialYearOf("2026-03-31")), "FY 2025–26");
  assert.equal(formatFinancialYear(financialYearOf("2026-04-01")), "FY 2026–27");
});

test("an invalid financial year is shown as a dash", () => {
  for (const value of [2025.5, NaN, 999, 9999, "2025", null, undefined]) {
    assert.equal(formatFinancialYear(value), "—", String(value));
  }
});
