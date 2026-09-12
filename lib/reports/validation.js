/**
 * Validation and derivation for Reports (Phase 17 — Slice 1, foundation).
 * Plain functions, no schema library — consistent with every other
 * `validation.js` in this project (`lib/attendance/validation.js`,
 * `lib/memberships/validation.js`).
 *
 * This module is pure: no Supabase client, no `server-only`. Everything
 * here is a derivation over counts the data layer has already read, so the
 * eventual Reports UI can reuse the same arithmetic without a round trip.
 *
 * PERCENTAGES ARE DELIBERATELY NOT ROUNDED HERE (approved decision D1).
 * The data layer returns raw counts and an unrounded ratio; the visible
 * Reports slice decides display precision. The approved wireframes
 * (p.35–37) show one decimal place — 87.5%, 94.4%, 90.5% — which is a
 * presentation concern, and notably differs from the integer rounding
 * `computeAttendanceSummary` applies for Attendance History today. Keeping
 * rounding out of this layer means that difference is resolved once, in
 * the UI slice, rather than being baked into two places now.
 *
 * THE POOLED RULE (approved decision, and `01-product.md` §10's "overall
 * attendance percentage"): an aggregate percentage is
 * `total present / total eligible` across the whole range — never the mean
 * of the per-session percentages. The two coincide only when every session
 * has the same eligible count, which is exactly the case wireframe p.36
 * happens to show (8 sessions x 18 eligible), so that mock does not
 * distinguish them. p.37 does: 67 present / 74 eligible = 90.5%.
 */

/**
 * A student's status for one session in the Student Attendance report.
 *
 * `unmarked` is a *report* status, not a persisted one: `attendance` still
 * stores only present/absent, and an eligible student with no row is
 * unmarked by absence (`supabase/migrations/0011_attendance.sql`). Approved
 * decision D2 — unmarked is never folded into absent, because doing so
 * would invent a fact the database does not hold.
 */
export const REPORT_STUDENT_STATUSES = ["present", "absent", "unmarked"];

/**
 * True when `value` is a "YYYY-MM-DD" calendar date that actually exists.
 *
 * A private copy rather than a shared helper, matching how every other
 * module keeps its own small predicates (`lib/attendance-history/data.js`'s
 * `escapeForOrFilter`, `lib/memberships/validation.js`'s date helpers).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidReportDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  // Round-trips only for a real date: "2025-02-30" normalises to March and
  // therefore fails this comparison.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates the date range a report was asked for.
 *
 * Both ends are REQUIRED here, unlike `listAttendanceHistory`, whose range
 * is optional because History's natural default is "everything". A report
 * has no such default: the approved wireframes (p.35–37) all gate the
 * result behind an explicit Date From / Date To and a Generate Report
 * action, so an absent range is a caller error rather than "all time".
 *
 * The range is INCLUSIVE at both ends — `session_date >= dateFrom` and
 * `session_date <= dateTo` — matching Attendance History's own
 * `.gte()`/`.lte()` convention. A single-date Attendance Summary
 * (`01-product.md` §10: "Filters: Date or date range") is simply
 * `dateFrom === dateTo`, which is why equal dates are accepted.
 *
 * `session_date` is a plain calendar `date` column, so no timezone
 * conversion applies to range filtering.
 *
 * @param {string} dateFrom - "YYYY-MM-DD".
 * @param {string} dateTo - "YYYY-MM-DD".
 * @returns {{ success: true, data: { dateFrom: string, dateTo: string } } | { success: false, error: string }}
 */
export function validateReportDateRange(dateFrom, dateTo) {
  const from = String(dateFrom ?? "").trim();
  const to = String(dateTo ?? "").trim();

  if (!from || !to) {
    return { success: false, error: "Select both a start and an end date." };
  }
  if (!isValidReportDate(from) || !isValidReportDate(to)) {
    return { success: false, error: "Enter valid dates." };
  }
  if (from > to) {
    return { success: false, error: "Date From must be on or before Date To." };
  }

  return { success: true, data: { dateFrom: from, dateTo: to } };
}

/**
 * The attendance ratio as an UNROUNDED fraction, or `null` when there is
 * nothing to measure.
 *
 * `null`, never `0`, when `eligible` is 0 (approved decision: a zero-session
 * range must not manufacture a 0% measurement, and a zero-eligible session
 * must not divide by zero). `0` would read as "nobody attended", which is a
 * different and false claim from "there was nothing to attend". Callers
 * render `null` as an em dash or an empty state, not as a number.
 *
 * Note this differs deliberately from `computeAttendanceSummary`, which
 * returns `0` for a zero-eligible session: that function feeds a
 * single-session panel where 0 is an acceptable placeholder, whereas a
 * report aggregates and must not let a placeholder enter the arithmetic.
 *
 * @param {number} present
 * @param {number} eligible
 * @returns {number|null} 0..1, or null when `eligible` is 0.
 */
export function attendanceRatio(present, eligible) {
  if (!eligible || eligible <= 0) return null;
  return present / eligible;
}

/**
 * Pooled totals across a set of session fact rows — the Batch Attendance
 * and Attendance Summary reports' KPI figures (wireframe p.36: SESSIONS /
 * ELIGIBLE ATTENDANCE / PRESENT / ABSENT / AVG. ATTENDANCE; p.37: TOTAL
 * SESSIONS / TOTAL PRESENT / TOTAL ABSENT / OVERALL ATTENDANCE).
 *
 * `attendanceBasis` is returned alongside the counts so a caller can show
 * the numerator and denominator the percentage was derived from, rather
 * than only its result — the same two numbers p.36 already displays as
 * PRESENT and ELIGIBLE ATTENDANCE.
 *
 * @param {{ eligibleCount: number, presentCount: number, absentCount: number, unmarkedCount: number }[]} facts
 * @returns {{ sessionCount: number, eligibleTotal: number, presentTotal: number, absentTotal: number, unmarkedTotal: number, attendanceBasis: { present: number, eligible: number }, ratio: number|null }}
 */
export function computePooledTotals(facts) {
  const rows = Array.isArray(facts) ? facts : [];

  let eligibleTotal = 0;
  let presentTotal = 0;
  let absentTotal = 0;
  let unmarkedTotal = 0;

  for (const fact of rows) {
    eligibleTotal += fact.eligibleCount ?? 0;
    presentTotal += fact.presentCount ?? 0;
    absentTotal += fact.absentCount ?? 0;
    unmarkedTotal += fact.unmarkedCount ?? 0;
  }

  return {
    sessionCount: rows.length,
    eligibleTotal,
    presentTotal,
    absentTotal,
    unmarkedTotal,
    attendanceBasis: { present: presentTotal, eligible: eligibleTotal },
    ratio: attendanceRatio(presentTotal, eligibleTotal),
  };
}

/**
 * Totals for one student across the sessions they were eligible for —
 * the Student Attendance report's KPI figures (wireframe p.35: SESSIONS /
 * PRESENT / ABSENT / ATTENDANCE).
 *
 * The denominator is the number of sessions the student was ELIGIBLE for,
 * not the number they were marked in: p.35's 8 sessions / 7 present / 1
 * absent yields 87.5% = 7/8. An eligible-but-unmarked session therefore
 * still counts against the percentage, exactly as an unmarked student
 * already does in a single session's own summary — unmarked is not
 * silently dropped from the denominator, and not converted to absent (D2).
 *
 * @param {{ status: "present"|"absent"|"unmarked" }[]} sessions
 * @returns {{ eligibleSessions: number, presentCount: number, absentCount: number, unmarkedCount: number, attendanceBasis: { present: number, eligible: number }, ratio: number|null }}
 */
export function computeStudentTotals(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];

  const presentCount = rows.filter((row) => row.status === "present").length;
  const absentCount = rows.filter((row) => row.status === "absent").length;
  const unmarkedCount = rows.filter((row) => row.status === "unmarked").length;

  return {
    eligibleSessions: rows.length,
    presentCount,
    absentCount,
    unmarkedCount,
    attendanceBasis: { present: presentCount, eligible: rows.length },
    ratio: attendanceRatio(presentCount, rows.length),
  };
}
