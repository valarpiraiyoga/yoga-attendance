import "server-only";

import { createClient } from "@/lib/supabase/server";
import { computePooledTotals, computeStudentTotals } from "@/lib/reports/validation";

/**
 * Data Access Layer for Reports (Phase 17).
 *
 * Read-only, and — same convention as every other `data.js` here — it does
 * not authorize the caller. Reports are Admin-only (`01-product.md` §10,
 * `02-ux.md` Flow 13, and `app/data/navigation.js`'s existing
 * `roles: ["admin"]` entry), and that gate is the page's own
 * `requireRole(ROLES.ADMIN)` from `lib/auth/dal.js`, not anything here.
 *
 * ONE ROUND TRIP PER REPORT
 * Every function below is a thin projection over a single
 * `report_session_facts` RPC call (`0016_report_session_facts.sql`). That
 * function does the session filtering, historical eligibility resolution,
 * attendance counting, batch filtering, date filtering and the per-student
 * projection, and returns exactly one row per session.
 *
 * This replaced an application-side implementation that read
 * `class_session_eligible_students` and `attendance` in chunked `.in()`
 * batches and aggregated them in JavaScript. That cost one round trip per
 * 150 sessions plus a payload growing with sessions x students — to produce
 * a handful of integers — and in the Student report's case transferred the
 * whole centre's rows to report on one student. Database efficiency is a
 * product requirement for this application (it is intended to run
 * affordably for small centres on Supabase Free), so the aggregation now
 * happens where the rows already are.
 *
 * SECURITY. `report_session_facts` is SECURITY INVOKER, so RLS remains the
 * ownership boundary exactly as it was when this module queried the tables
 * directly: an admin reads every session, an instructor would read only
 * their own. No privilege was widened by moving the work into SQL.
 *
 * HISTORICAL INTEGRITY (`01-product.md` §9, §12; Phase 16A). Eligibility
 * comes from the frozen `class_session_eligible_students` snapshot, and a
 * session without one falls back to live resolution *inside* the RPC — the
 * application never issues a second request for it. Nothing reads
 * `batch_enrollments`, `enrollment_schedules`, `memberships` or any current
 * student/batch status. `eligibility_source` reports per row which branch
 * produced the count, and `fallbackSessionCount` below surfaces how many
 * rows leaned on live resolution so a growing fallback set is visible
 * rather than silent.
 *
 * Percentages are still never rounded here (approved decision D1) — raw
 * counts and an unrounded ratio come from `lib/reports/validation.js`, and
 * the Reports UI slice decides display precision.
 */

/**
 * Calls `report_session_facts` once and normalises its rows into the shape
 * the rest of this module (and the eventual UI) consumes.
 *
 * @param {{ dateFrom: string, dateTo: string, batchId?: string, studentId?: string }} params
 * @returns {Promise<{ rows: object[], fallbackSessionCount: number }>}
 */
async function callReportSessionFacts({ dateFrom, dateTo, batchId = "", studentId = "" }) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("report_session_facts", {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_batch_id: batchId || null,
    p_student_id: studentId || null,
  });

  if (error) {
    console.error(
      `[reports] report_session_facts failed (dateFrom=${dateFrom}, dateTo=${dateTo}, batchId=${batchId || "(any)"}, studentId=${studentId || "(none)"}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load report data.");
  }

  const rows = data ?? [];
  const fallbackSessionCount = rows.filter((row) => row.eligibility_source === "live_fallback").length;

  if (fallbackSessionCount > 0) {
    console.warn(
      `[reports] ${fallbackSessionCount} session(s) in range had no eligibility snapshot and were resolved live.`
    );
  }

  return { rows, fallbackSessionCount };
}

/** The session identity fields every report row carries. */
function toSessionIdentity(row) {
  return {
    id: row.class_session_id,
    session_date: row.session_date,
    start_time: row.start_time,
    end_time: row.end_time,
    batch: row.batch_id ? { id: row.batch_id, name: row.batch_name, code: row.batch_code } : null,
    instructor: row.instructor_id ? { id: row.instructor_id, full_name: row.instructor_name } : null,
  };
}

/** One session fact row: identity plus its four counts. */
function toFact(row) {
  return {
    ...toSessionIdentity(row),
    eligibleCount: row.eligible_count,
    presentCount: row.present_count,
    absentCount: row.absent_count,
    unmarkedCount: row.unmarked_count,
  };
}

/**
 * The shared session-fact core: one fact row per completed session in the
 * inclusive date range, each carrying its historical eligible count and its
 * recorded present/absent/unmarked counts.
 *
 * All three report readers below are thin projections over this — there is
 * exactly one place a session's counts are defined, and it is now the RPC.
 *
 * @param {{ dateFrom: string, dateTo: string, batchId?: string }} params
 * @returns {Promise<{ facts: object[], fallbackSessionCount: number }>}
 */
export async function getSessionFacts({ dateFrom, dateTo, batchId = "" }) {
  const { rows, fallbackSessionCount } = await callReportSessionFacts({ dateFrom, dateTo, batchId });

  return { facts: rows.map(toFact), fallbackSessionCount };
}

/**
 * Student Attendance report (`01-product.md` §10; wireframe p.35).
 *
 * Filters: student, date range. Shows: sessions, present, absent, attendance
 * percentage — plus the per-session DATE / TIME / BATCH / INSTRUCTOR /
 * STATUS table beneath them.
 *
 * Which sessions belong to this report is decided by the RPC, which keeps a
 * session when the student was in its frozen eligible set *or* holds an
 * attendance mark for it — a mark is proof the student passed eligibility at
 * save time (Phase 16A). Status is present/absent/unmarked; unmarked is
 * never folded into absent (approved decision D2), because the database does
 * not record why a student was unmarked and calling it an absence would
 * invent a fact.
 *
 * @param {{ studentId: string, dateFrom: string, dateTo: string }} params
 * @returns {Promise<{ studentId: string, dateFrom: string, dateTo: string, sessions: object[], totals: object, fallbackSessionCount: number }>}
 */
export async function getStudentAttendanceReport({ studentId, dateFrom, dateTo }) {
  const { rows, fallbackSessionCount } = await callReportSessionFacts({ dateFrom, dateTo, studentId });

  const sessions = rows.map((row) => ({
    ...toSessionIdentity(row),
    status: row.student_status,
  }));

  return {
    studentId,
    dateFrom,
    dateTo,
    sessions,
    totals: computeStudentTotals(sessions),
    fallbackSessionCount,
  };
}

/**
 * Batch Attendance report (`01-product.md` §10; wireframe p.36).
 *
 * Filters: batch, date range. Shows: number of sessions, attendance totals,
 * average attendance — plus the per-session Session Attendance table
 * (DATE / TIME / ELIGIBLE / PRESENT / ABSENT / ATTENDANCE).
 *
 * "Average attendance" is the POOLED ratio, `total present / total
 * eligible`, not the mean of the per-session percentages — see
 * `computePooledTotals` for why the wireframe's own figures do not
 * distinguish the two and why pooled is nonetheless the right reading.
 *
 * @param {{ batchId: string, dateFrom: string, dateTo: string }} params
 * @returns {Promise<{ batchId: string, dateFrom: string, dateTo: string, sessions: object[], totals: object, fallbackSessionCount: number }>}
 */
export async function getBatchAttendanceReport({ batchId, dateFrom, dateTo }) {
  const { facts, fallbackSessionCount } = await getSessionFacts({ dateFrom, dateTo, batchId });

  return {
    batchId,
    dateFrom,
    dateTo,
    sessions: facts,
    totals: computePooledTotals(facts),
    fallbackSessionCount,
  };
}

/**
 * Attendance Summary report (`01-product.md` §10; wireframe p.37).
 *
 * Filters: date or date range — a single date is `dateFrom === dateTo`.
 * Shows: total sessions, total present, total absent, overall attendance
 * percentage — plus the per-session DATE / TIME / BATCH / INSTRUCTOR /
 * ELIGIBLE / PRESENT / ABSENT / ATTENDANCE table.
 *
 * Identical to the Batch report minus the batch filter, and deliberately
 * built from the same core rather than as a separate aggregation: one
 * definition of a session's counts, three presentations of it.
 *
 * A range containing no completed sessions returns an empty `sessions`
 * array, zeroed counts, and a `null` ratio — never a manufactured 0%, which
 * would assert that nobody attended rather than that there was nothing to
 * attend.
 *
 * @param {{ dateFrom: string, dateTo: string }} params
 * @returns {Promise<{ dateFrom: string, dateTo: string, sessions: object[], totals: object, fallbackSessionCount: number }>}
 */
export async function getAttendanceSummaryReport({ dateFrom, dateTo }) {
  const { facts, fallbackSessionCount } = await getSessionFacts({ dateFrom, dateTo });

  return {
    dateFrom,
    dateTo,
    sessions: facts,
    totals: computePooledTotals(facts),
    fallbackSessionCount,
  };
}
