/**
 * Pure month-calendar helpers for Attendance History's date navigator.
 * "Month" is a "YYYY-MM" string; every date is a "YYYY-MM-DD" string built
 * with UTC arithmetic only, so nothing depends on the viewer's local zone
 * (the centre-timezone rule, 01-product.md §7A, decides "today" upstream).
 */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(value) {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** `"2026-09-24"` → `"2026-09"`. */
export function monthOf(date) {
  return String(date).slice(0, 7);
}

function parseMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

/** First and last day of `month`, inclusive: `{ from: "2026-09-01", to: "2026-09-30" }`. */
export function monthRange(month) {
  const { year, monthIndex } = parseMonth(month);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

/** The month `delta` months from `month` (negative = earlier). */
export function shiftMonth(month, delta) {
  const { year, monthIndex } = parseMonth(month);
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

/** `"2026-09"` → `"September 2026"`. */
export function formatMonthLabel(month) {
  const { year, monthIndex } = parseMonth(month);
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The month as Sunday-first weeks of 7 cells: a `{ date, day }` for each day
 * of the month, `null` for the leading/trailing blanks that square the grid.
 *
 * @returns {({ date: string, day: number } | null)[][]}
 */
export function buildMonthGrid(month) {
  const { year, monthIndex } = parseMonth(month);
  const leadingBlanks = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const { to } = monthRange(month);
  const daysInMonth = Number(to.slice(8, 10));

  const cells = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: `${month}-${pad(day)}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}
