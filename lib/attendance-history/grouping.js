/**
 * Pure helpers for Attendance History's date-grouped presentation — no I/O,
 * no framework imports, so they run under `npm test` (Node's test runner).
 *
 * Dates are the sessions' own centre-timezone `session_date` strings
 * ("YYYY-MM-DD"), compared as strings and never converted through a `Date`
 * in the viewer's local zone, so the centre-timezone rule
 * (01-product.md §7A) is preserved by construction.
 */

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** True for a real-looking "YYYY-MM-DD" string (shape check, then calendar check). */
export function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Groups sessions by `session_date`, keeping the groups in the order each date
 * first appears in `sessions` (the query already orders them newest- or
 * oldest-first), and ordering the sessions inside a group by start time, the
 * way a day's classes read: earliest first.
 *
 * @param {{ session_date: string, start_time: string }[]} sessions
 * @returns {{ date: string, sessions: object[] }[]}
 */
export function groupSessionsByDate(sessions) {
  const groups = new Map();

  for (const session of sessions ?? []) {
    const existing = groups.get(session.session_date);
    if (existing) existing.push(session);
    else groups.set(session.session_date, [session]);
  }

  return [...groups.entries()].map(([date, items]) => ({
    date,
    sessions: [...items].sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))),
  }));
}

/**
 * Collapses rows that each carry only a `session_date` into
 * `{ date, count }[]`, preserving first-seen order.
 */
export function countSessionsByDate(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    counts.set(row.session_date, (counts.get(row.session_date) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}
