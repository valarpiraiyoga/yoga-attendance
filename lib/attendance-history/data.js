import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAttendanceSummaries } from "@/lib/attendance/data";
import { countSessionsByDate } from "@/lib/attendance-history/grouping";
import { monthRange } from "@/lib/attendance-history/calendar";

/**
 * Data Access Layer for reading Attendance History (Phase 16;
 * `04-development-plan.md` "Phase 16 — Attendance History").
 *
 * This is a read-only module, same convention as every other `data.js` in
 * this codebase: it does not authorize the caller. RLS restricts every
 * query here exactly as it already restricts Attendance itself — an admin
 * reads every row, an active instructor reads only rows their own sessions
 * (`class_sessions_select_instructor`, `attendance_select_instructor`,
 * `0014_instructor_attendance_access.sql`) and `students_select_admin`'s
 * absence of an instructor policy naturally allow. Callers (once a Phase 16
 * page exists) must still guard with `requireRole(ROLES.ADMIN,
 * ROLES.INSTRUCTOR)` from `lib/auth/dal.js`, the same as every Attendance
 * page already does — that boundary is not repeated here. No JavaScript
 * ownership check is added anywhere in this file; every role difference in
 * what a call to `listAttendanceHistory` returns comes from RLS alone.
 *
 * Deliberately its own module, not an addition to `lib/attendance/data.js`:
 * Attendance History is its own feature area in the approved IA
 * (`02-ux.md`), with its own list/filter/pagination concerns that are
 * unrelated to Session Details or Take Attendance — "Feature-specific
 * components should remain close to their feature" (`CLAUDE.md`).
 *
 * Attendance History lists only **materialized, completed** sessions
 * (`class_sessions.status = 'completed'`) — a session that was never
 * touched (still projected) or that was cancelled/holiday has no attendance
 * to review, so it has nothing to show here. This is a data-layer decision,
 * not a UI-layer filter: unlike `lib/class-sessions/data.js`'s
 * `occurrencesInRange`, this module never merges in projected occurrences.
 *
 * No default date window is applied when `dateFrom`/`dateTo` are omitted
 * (unlike `listSessions`'s forward-looking 90-day default) — History looks
 * backward, potentially over the system's entire life, so "everything"
 * is the correct default, not an arbitrary recent window. The eventual
 * Phase 16 UI decides what to show on first load, if anything; this module
 * does not.
 *
 * Ordered newest-first (`session_date` then `start_time`, descending) —
 * deliberately the opposite of All Sessions' soonest-first ordering
 * (`lib/class-sessions/data.js`'s `listSessions`), matching the wireframe's
 * own row order (Admin's Attendance History, wireframe p.30: 04 Jun, 03
 * Jun, 02 Jun) and History's own purpose: reviewing what already happened,
 * most recent first.
 */

const DEFAULT_PAGE_SIZE = 10;

// Attendance History's date-grouped view shows a whole date range at once (no
// pagination), so it asks for one page this large. A month of classes is far
// below it; the page states plainly when a very wide range exceeds it.
export const HISTORY_RANGE_LIMIT = 500;

// How many recent dates the "Quick dates" list offers, and how many session
// rows are read to find them (a date can hold several sessions).
const QUICK_DATE_COUNT = 4;
const QUICK_DATE_SCAN_LIMIT = 200;

// Sort keys Attendance History may request (`?sort=`). A whitelist: an unknown
// key falls back to the default. "newest" is the pre-existing order (latest
// session date, then start time, first), so a request with no `sort` behaves
// exactly as before.
export const DEFAULT_HISTORY_SORT = "newest";
export const HISTORY_SORTS = {
  newest: { ascending: false },
  oldest: { ascending: true },
};

const COLUMNS =
  "id, schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status, note, created_at, updated_at, batches(id, name, code, batch_color, batch_image_url), instructors(id, full_name, photo_url)";

// PostgREST's `.or()` filter grammar uses "," to separate conditions and
// "()" to group them; escaping them keeps a literal search term literal
// rather than breaking the expression. "%"/"_" are also escaped since they
// are LIKE wildcards. Duplicated rather than shared, matching every other
// module's own private copy of this helper (lib/batches/data.js,
// lib/students/data.js, lib/schedules/data.js, lib/memberships/data.js).
function escapeForOrFilter(value) {
  return value.replace(/[%_,()]/g, (char) => `\\${char}`);
}

/**
 * Resolves the `studentId`/`attendanceStatus` filters to a concrete set of
 * matching `class_sessions.id` values, or `null` when neither filter is
 * active (meaning: do not restrict by this at all).
 *
 * Both conditions are applied to the same `attendance` query when both are
 * given — "this student's Absent sessions", not "this student's sessions"
 * OR'd with "any Absent session" — so a caller asking for both gets the
 * intersection, not a broader match.
 *
 * Deliberately a separate, deduplicated id list rather than an `!inner`
 * embed on the main `class_sessions` query (the pattern
 * `lib/students/data.js`'s `batch_enrollments!inner` uses for its own batch
 * filter): `attendanceStatus` alone, without `studentId`, can match more
 * than one student's row within the same session, which an inner-embed
 * filter would surface as one duplicate `class_sessions` row per match,
 * corrupting both `count` and pagination. Resolving to a deduplicated id
 * list first, then filtering the main query with a plain `.in()`, avoids
 * that regardless of which of the two filters is active.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} studentId
 * @param {string} attendanceStatus - `"all"`, or an `ATTENDANCE_STATUSES` value (`lib/attendance/validation.js`).
 * @returns {Promise<string[]|null>}
 */
async function resolveSessionIdsForAttendanceFilter(supabase, studentId, attendanceStatus) {
  if (!studentId && attendanceStatus === "all") return null;

  let query = supabase.from("attendance").select("class_session_id");
  if (studentId) query = query.eq("student_id", studentId);
  if (attendanceStatus !== "all") query = query.eq("status", attendanceStatus);

  const { data, error } = await query;

  if (error) {
    console.error(
      `[attendance-history] Could not resolve sessions for student=${studentId || "(any)"} status=${attendanceStatus}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load attendance history.");
  }

  return [...new Set((data ?? []).map((row) => row.class_session_id))];
}

/**
 * Resolves the free-text `q` filter ("Search by student name, batch or
 * instructor" — wireframe p.6/p.30, extended with instructor by the
 * finalized `ui-reference/02/attendance history.png`) to an `.or()` filter fragment for the main query, or
 * `null` when `q` is empty.
 *
 * Three independent matches, OR'd together: a batch whose name or code
 * contains the term, an instructor whose name contains the term (the
 * session's own snapshot `instructor_id`), or a session with an attendance
 * record for a student whose name contains the term. Resolved as separate id
 * lookups (not a single joined query) for the same duplication reason
 * `resolveSessionIdsForAttendanceFilter` avoids an `!inner` embed — and
 * because `students` and `batches` are unrelated tables with no single
 * query that could match either without an embed on each.
 *
 * The `students` lookup runs under the same RLS every other query in this
 * module does: for an admin it matches real students; for an instructor
 * `students` carries no instructor SELECT policy at all
 * (`0014_instructor_attendance_access.sql`), so it returns zero rows,
 * silently. That is correct, not a bug to route around — an instructor's
 * search-by-student-name naturally contributes nothing, while
 * search-by-batch-name still works, because `batches` does carry a scoped
 * instructor policy. No JavaScript branch on role is needed for this to be
 * true; RLS already makes it true.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} q
 * @returns {Promise<string|null>}
 */
async function resolveSearchFilter(supabase, q) {
  if (!q) return null;

  const term = escapeForOrFilter(q);

  const [batchMatches, studentMatches, instructorMatches] = await Promise.all([
    supabase.from("batches").select("id").or(`name.ilike.%${term}%,code.ilike.%${term}%`),
    supabase.from("students").select("id").ilike("full_name", `%${q}%`),
    supabase.from("instructors").select("id").ilike("full_name", `%${q}%`),
  ]);

  if (batchMatches.error) {
    console.error(`[attendance-history] Could not search batches for "${q}":`, batchMatches.error.code, batchMatches.error.message);
    throw new Error("Could not load attendance history.");
  }
  if (studentMatches.error) {
    console.error(`[attendance-history] Could not search students for "${q}":`, studentMatches.error.code, studentMatches.error.message);
    throw new Error("Could not load attendance history.");
  }

  if (instructorMatches.error) {
    console.error(`[attendance-history] Could not search instructors for "${q}":`, instructorMatches.error.code, instructorMatches.error.message);
    throw new Error("Could not load attendance history.");
  }

  const batchIds = (batchMatches.data ?? []).map((row) => row.id);
  const instructorIds = (instructorMatches.data ?? []).map((row) => row.id);

  let studentSessionIds = [];
  const studentIds = (studentMatches.data ?? []).map((row) => row.id);
  if (studentIds.length > 0) {
    const { data: attendanceRows, error: attendanceError } = await supabase
      .from("attendance")
      .select("class_session_id")
      .in("student_id", studentIds);

    if (attendanceError) {
      console.error(`[attendance-history] Could not resolve sessions for matched students:`, attendanceError.code, attendanceError.message);
      throw new Error("Could not load attendance history.");
    }

    studentSessionIds = [...new Set((attendanceRows ?? []).map((row) => row.class_session_id))];
  }

  if (batchIds.length === 0 && instructorIds.length === 0 && studentSessionIds.length === 0) {
    // Nothing matched the term at all — the caller (below) short-circuits
    // to an empty page rather than passing an empty `.or()` fragment,
    // which PostgREST would reject rather than treat as "match nothing".
    return "";
  }

  const parts = [];
  if (batchIds.length > 0) parts.push(`batch_id.in.(${batchIds.join(",")})`);
  if (instructorIds.length > 0) parts.push(`instructor_id.in.(${instructorIds.join(",")})`);
  if (studentSessionIds.length > 0) parts.push(`id.in.(${studentSessionIds.join(",")})`);
  return parts.join(",");
}

/**
 * Paginated, filterable Attendance History — one row per completed class
 * session, each carrying its own attendance summary
 * (Eligible/Present/Absent/Unmarked/Attendance %), exactly the shape
 * `app/attendance/page.js`'s `withAttendanceSummaries` already attaches to
 * Today's/All Sessions rows (`attendanceSummary`), reused here rather than
 * invented a second time.
 *
 * One function serves both Admin and Instructor screens (approved decision
 * 1, Phase 16): the caller passes whichever filters its own screen exposes
 * (Admin: Date From/To, Batch, Instructor, Search, Attendance Status;
 * Instructor: Date Range, Search, Assigned Classes — the same `batchId`
 * parameter, since RLS already narrows "assigned classes" to the
 * instructor's own — and Attendance Status), and RLS alone decides which
 * underlying rows either role can see. There is no `role` or
 * `instructorId`-for-the-caller parameter here, because none is needed:
 * `class_sessions_select_instructor`/`attendance_select_instructor`
 * already restrict an instructor's own query to their own sessions before
 * any filter below is even applied.
 *
 * `studentId` (approved decision 3) is what Student Details' "View Full
 * Attendance History" link uses — the exact same list, filtered, not a
 * separate "Student History" query or page. `batchId` (approved decision
 * 4) is the same reuse for "batch history" — there is no separate Batch
 * History function or model.
 *
 * `attendanceStatus` (`"all"` or an `ATTENDANCE_STATUSES` value —
 * `lib/attendance/validation.js`) means: when `studentId` is also given,
 * that student's own recorded status for each session; when it is given
 * alone, any session containing at least one attendance record of that
 * status. The former is the well-defined, product-described case (a
 * student's Present/Absent history); the latter is a coarser, still
 * honest, session-level filter — there is no per-student context to narrow
 * it further when no student is selected.
 *
 * Historical Integrity (`01-product.md` §9, §12) is preserved by
 * construction, not by anything added here: every filter column
 * (`batch_id`, `instructor_id`, `session_date`/`start_time`/`end_time`) is
 * the session's own **snapshot**, set once at materialization and never
 * touched by a later schedule edit, batch deactivation, membership expiry,
 * or a student changing or leaving a batch (`01-product.md` §7A). The
 * per-row summary comes from `getAttendanceSummaries` (the batched form of `getAttendanceSummary`), which resolves
 * eligibility through `resolve_eligible_students` evaluated as of the
 * session's own historical date, and reads recorded Present/Absent marks
 * from `attendance`, which is never deleted — nothing here reconstructs
 * eligibility from current membership state; the existing Phase 15
 * machinery already refuses to.
 *
 * @param {object} [params]
 * @param {string} [params.dateFrom] - "YYYY-MM-DD", inclusive. Unbounded (all history) when omitted.
 * @param {string} [params.dateTo] - "YYYY-MM-DD", inclusive. Unbounded when omitted.
 * @param {string} [params.batchId]
 * @param {string} [params.instructorId]
 * @param {string} [params.studentId] - Exact match; the Student Details "View Full Attendance History" entry point.
 * @param {string} [params.q] - Case-insensitive match against batch name/code or a matching student's name.
 * @param {"all"|"present"|"absent"} [params.attendanceStatus]
 * @param {keyof typeof HISTORY_SORTS} [params.sort] - Sort key; unknown keys use the default.
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @returns {Promise<{ sessions: object[], total: number, page: number, pageSize: number }>}
 */
export async function listAttendanceHistory({
  dateFrom = "",
  dateTo = "",
  batchId = "",
  instructorId = "",
  studentId = "",
  q = "",
  attendanceStatus = "all",
  sort = DEFAULT_HISTORY_SORT,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();
  const { ascending } = HISTORY_SORTS[sort] ?? HISTORY_SORTS[DEFAULT_HISTORY_SORT];

  const attendanceFilterIds = await resolveSessionIdsForAttendanceFilter(supabase, studentId, attendanceStatus);
  if (attendanceFilterIds !== null && attendanceFilterIds.length === 0) {
    return { sessions: [], total: 0, page, pageSize };
  }

  const searchFilter = await resolveSearchFilter(supabase, q);
  if (searchFilter === "") {
    return { sessions: [], total: 0, page, pageSize };
  }

  let query = supabase
    .from("class_sessions")
    .select(COLUMNS, { count: "exact" })
    .eq("status", "completed");

  if (dateFrom) query = query.gte("session_date", dateFrom);
  if (dateTo) query = query.lte("session_date", dateTo);
  if (batchId) query = query.eq("batch_id", batchId);
  if (instructorId) query = query.eq("instructor_id", instructorId);
  if (attendanceFilterIds !== null) query = query.in("id", attendanceFilterIds);
  if (searchFilter) query = query.or(searchFilter);

  query = query.order("session_date", { ascending }).order("start_time", { ascending });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error(
      `[attendance-history] Could not list attendance history (dateFrom=${dateFrom}, dateTo=${dateTo}, batchId=${batchId}, instructorId=${instructorId}, studentId=${studentId}, page=${page}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load attendance history.");
  }

  const rows = data ?? [];
  let summaries;
  try {
    // One set-based round trip for the whole result (`session_attendance_summaries`,
    // 0017) instead of one eligibility resolve + one attendance read per session.
    summaries = await getAttendanceSummaries(rows);
  } catch (summaryError) {
    // Summaries must never take the whole page down: rows still render, with
    // their counts blank, exactly as the old per-row fallback did.
    console.error(`[attendance-history] Could not summarise ${rows.length} session(s):`, summaryError.message);
    summaries = rows.map(() => null);
  }

  const sessions = rows.map((session, index) => ({ ...session, attendanceSummary: summaries[index] }));

  return { sessions, total: count ?? 0, page, pageSize };
}

/**
 * Data for Attendance History's date navigator: which days of `month` have
 * completed sessions (with how many), and the most recent dates that do
 * ("Quick dates").
 *
 * Deliberately independent of the search/filters and of the selected date
 * range: it answers "where is there history to look at?", so it always reads
 * the same completed-session set `listAttendanceHistory` draws from, under the
 * same RLS (an instructor's calendar shows only their own sessions).
 *
 * @param {string} month - "YYYY-MM".
 * @returns {Promise<{ monthDays: { date: string, count: number }[], quickDates: { date: string, count: number }[] }>}
 */
export async function getHistoryDateNavigation(month) {
  const supabase = await createClient();
  const { from, to } = monthRange(month);

  const [monthResult, recentResult] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("session_date")
      .eq("status", "completed")
      .gte("session_date", from)
      .lte("session_date", to),
    supabase
      .from("class_sessions")
      .select("session_date")
      .eq("status", "completed")
      .order("session_date", { ascending: false })
      .limit(QUICK_DATE_SCAN_LIMIT),
  ]);

  for (const result of [monthResult, recentResult]) {
    if (result.error) {
      console.error(`[attendance-history] Could not load date navigation for ${month}:`, result.error.code, result.error.message);
      throw new Error("Could not load attendance history.");
    }
  }

  return {
    monthDays: countSessionsByDate(monthResult.data),
    quickDates: countSessionsByDate(recentResult.data).slice(0, QUICK_DATE_COUNT),
  };
}
