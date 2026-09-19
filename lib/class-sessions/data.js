import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getSchedule, listSchedulesForWeek, scheduleOccursOnDate } from "@/lib/schedules/data";
import { addDaysUTC } from "@/lib/schedules/validation";
import { deriveDisplayStatus, todayInCentreTimezone } from "@/lib/class-sessions/validation";

/**
 * Data Access Layer for reading Class Sessions.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0010_class_sessions.sql); callers must still guard
 * the page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js —
 * this module only reads data, it does not authorize the caller.
 *
 * Every read in this file is exactly that — a read. Nothing here ever
 * inserts into `class_sessions`; the only writer in the codebase is
 * `materializeClassSession` (lib/class-sessions/actions.js), and it is
 * reserved for the three approved triggers (a session-specific change,
 * cancellation/holiday, attendance) — never for viewing
 * (01-product.md §7A: "nothing about looking at a session ... ever writes
 * to the database").
 */

const DEFAULT_PAGE_SIZE = 20;

// All Sessions' default future horizon when no explicit Date Range filter
// is applied (approved Phase 14 decision) — bounded so an open-ended
// schedule can never be projected forever.
const DEFAULT_PROJECTION_WINDOW_DAYS = 90;

// Sort keys the session lists may request (`?sort=`). A whitelist: an unknown
// key falls back to the default. "earliest" is the pre-existing order
// (nearest date, then start time, first — an approved Phase 14 decision), so
// a request with no `sort` behaves exactly as before. On Today's Sessions
// every row shares one date, so this is a sort by start time.
export const DEFAULT_SESSION_SORT = "earliest";
export const SESSION_SORTS = {
  earliest: 1,
  latest: -1,
};

// Batch/instructor names are embedded on every query here (not just list
// screens) — Session Details needs them too, and there is no cheaper
// separate query worth having for the one or two extra embedded columns.
const COLUMNS =
  "id, schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status, note, created_at, updated_at, batches(id, name, code), instructors(id, full_name)";

/**
 * The shape of an occurrence that has never been materialized: everything
 * a real `class_sessions` row has except `id`/`created_at`/`updated_at`,
 * read straight from the schedule's *current* version — an unmaterialized
 * occurrence always follows the current schedule (01-product.md §7A), so
 * there is no snapshot to read here, unlike a materialized row.
 *
 * `is_materialized: false` is what every caller (list rows, Session
 * Details) checks to know this is not a real database row.
 */
function buildProjectedOccurrence(schedule, date) {
  return {
    id: null,
    schedule_id: schedule.id,
    batch_id: schedule.batches.id,
    batches: schedule.batches,
    instructor_id: schedule.instructors.id,
    instructors: schedule.instructors,
    session_date: date,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    status: "scheduled",
    note: null,
    is_materialized: false,
  };
}

/**
 * Every occurrence — materialized or projected — across an inclusive date
 * range. The single merge routine every list in this file (Today's
 * Sessions, All Sessions) is built on, so "materialized rows are
 * authoritative, unmaterialized occurrences follow the current schedule,
 * nothing here ever writes" is implemented exactly once.
 *
 * - Materialized rows come straight from `class_sessions` within the
 *   range, independent of whether their schedule still produces that
 *   occurrence today — a materialized row is a historical fact that
 *   outlives later schedule edits, deactivation, or the effective period
 *   ending (01-product.md §7A "Snapshot and Historical Integrity";
 *   "Inactive or Ended Schedules").
 * - For every remaining (schedule, date) pair in range that has no
 *   materialized row, `scheduleOccursOnDate` (lib/schedules/data.js,
 *   Phase 13) decides whether it is a real occurrence — the exact rule
 *   the Weekly Schedule grid and Schedule Details' Upcoming Sessions tab
 *   already use, reused rather than reimplemented. A schedule whose
 *   effective period has ended simply stops producing candidates past
 *   that date; nothing here needs to special-case it.
 * - Walking the range one day at a time (rather than only projecting
 *   forward from today, the way `projectUpcomingSessions` does for a
 *   single schedule) is what lets this same routine also serve a
 *   date-range filter that reaches into the past.
 *
 * @param {string} dateFrom - "YYYY-MM-DD", inclusive.
 * @param {string} dateTo - "YYYY-MM-DD", inclusive.
 * @returns {Promise<object[]>} Unsorted; callers sort for their own screen.
 */
async function occurrencesInRange(dateFrom, dateTo) {
  const supabase = await createClient();

  const [schedules, materializedResult] = await Promise.all([
    listSchedulesForWeek(dateFrom, dateTo),
    supabase.from("class_sessions").select(COLUMNS).gte("session_date", dateFrom).lte("session_date", dateTo),
  ]);

  if (materializedResult.error) {
    console.error(
      `[class-sessions] Could not list sessions for ${dateFrom}–${dateTo}:`,
      materializedResult.error.code,
      materializedResult.error.message
    );
    throw new Error("Could not load sessions.");
  }

  const occurrences = (materializedResult.data ?? []).map((row) => ({ ...row, is_materialized: true }));
  const materializedKeys = new Set(occurrences.map((row) => `${row.schedule_id}:${row.session_date}`));

  for (let date = dateFrom; date <= dateTo; date = addDaysUTC(date, 1)) {
    for (const schedule of schedules) {
      if (!scheduleOccursOnDate(schedule, date)) continue;
      if (materializedKeys.has(`${schedule.id}:${date}`)) continue;
      occurrences.push(buildProjectedOccurrence(schedule, date));
    }
  }

  return occurrences;
}

/**
 * Narrows already-merged occurrences by search text, batch, instructor and
 * displayed status — the one implementation both session lists use, so
 * Today's Sessions and All Sessions can never filter differently.
 *
 * `status` is the same 5-value **displayed** status (`deriveDisplayStatus`)
 * the status badge shows, not the 4-value persisted column.
 *
 * @param {object[]} occurrences
 * @param {object} [filters]
 * @param {string} [filters.q] - Case-insensitive match against batch name/code or instructor name.
 * @param {string} [filters.batchId]
 * @param {string} [filters.instructorId]
 * @param {"all"|"upcoming"|"in_progress"|"completed"|"cancelled"|"holiday"} [filters.status]
 * @returns {object[]}
 */
export function filterSessions(occurrences, { q = "", batchId = "", instructorId = "", status = "all" } = {}) {
  let result = occurrences;

  if (q) {
    const term = q.trim().toLowerCase();
    result = result.filter(
      (session) =>
        (session.batches?.name ?? "").toLowerCase().includes(term) ||
        (session.batches?.code ?? "").toLowerCase().includes(term) ||
        (session.instructors?.full_name ?? "").toLowerCase().includes(term)
    );
  }

  if (batchId) {
    result = result.filter((session) => session.batch_id === batchId);
  }

  if (instructorId) {
    result = result.filter((session) => session.instructor_id === instructorId);
  }

  if (status !== "all") {
    result = result.filter((session) => deriveDisplayStatus(session) === status);
  }

  return result;
}

/**
 * Orders occurrences by date, then start time, in the direction `sort`
 * names (`SESSION_SORTS`). Returns a new array.
 *
 * @param {object[]} occurrences
 * @param {keyof typeof SESSION_SORTS} [sort] - Unknown keys use the default.
 * @returns {object[]}
 */
export function sortSessions(occurrences, sort = DEFAULT_SESSION_SORT) {
  const direction = SESSION_SORTS[sort] ?? SESSION_SORTS[DEFAULT_SESSION_SORT];

  return [...occurrences].sort(
    (a, b) =>
      direction *
      (a.session_date === b.session_date
        ? a.start_time.localeCompare(b.start_time)
        : a.session_date.localeCompare(b.session_date))
  );
}

/**
 * Every session that occurs on one date — Today's Sessions' data source.
 * A single-day call into `occurrencesInRange`, sorted by start time.
 *
 * @param {string} date - "YYYY-MM-DD".
 * @returns {Promise<object[]>}
 */
export async function listSessionsForDate(date) {
  const occurrences = await occurrencesInRange(date, date);
  occurrences.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return occurrences;
}

/**
 * Paginated, filterable session list for All Sessions — materialized and
 * projected occurrences together (approved Phase 14 decision:
 * "Both lists ... show sessions whether or not they have been
 * materialized", 02-ux.md). Built on the same `occurrencesInRange` merge
 * Today's Sessions uses, so a materialized row is never duplicated by a
 * projected one for the same schedule and date.
 *
 * Defaults to today through the next `DEFAULT_PROJECTION_WINDOW_DAYS`
 * days when no `dateFrom`/`dateTo` is given — an explicit Date Range
 * filter overrides either side individually. Filtering, sorting and
 * pagination all happen in memory over the merged set: a projected
 * occurrence has no database row to filter, sort or page against, so
 * there is no way to push any of this to SQL without treating the two
 * sources differently — which is exactly what would let a duplicate or a
 * missing row slip through.
 *
 * `status` filters on the same 5-value **displayed** status
 * (`deriveDisplayStatus`) the STATUS badge shows — not the 4-value
 * persisted column — so "Upcoming"/"In Progress" work correctly for both
 * materialized and projected rows and always agree with what the row
 * displays.
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against batch name/code or instructor name.
 * @param {string} [params.batchId]
 * @param {string} [params.instructorId]
 * @param {"all"|"upcoming"|"in_progress"|"completed"|"cancelled"|"holiday"} [params.status]
 * @param {keyof typeof SESSION_SORTS} [params.sort] - Sort key; unknown keys use the default.
 * @param {string} [params.dateFrom] - "YYYY-MM-DD", inclusive. Defaults to today (centre timezone).
 * @param {string} [params.dateTo] - "YYYY-MM-DD", inclusive. Defaults to `dateFrom` + 90 days.
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @returns {Promise<{ sessions: object[], total: number, page: number, pageSize: number }>}
 */
export async function listSessions({
  q = "",
  batchId = "",
  instructorId = "",
  status = "all",
  sort = DEFAULT_SESSION_SORT,
  dateFrom = "",
  dateTo = "",
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const resolvedFrom = dateFrom || todayInCentreTimezone();
  const resolvedTo = dateTo || addDaysUTC(resolvedFrom, DEFAULT_PROJECTION_WINDOW_DAYS);

  const merged = await occurrencesInRange(resolvedFrom, resolvedTo);

  // Nearest-first by default (approved Phase 14 decision): soonest date and
  // time at the top, rather than the newest-first ordering a plain history
  // table would use — All Sessions' primary use is finding what is coming
  // up, not what happened most recently.
  const occurrences = sortSessions(filterSessions(merged, { q, batchId, instructorId, status }), sort);

  const total = occurrences.length;
  const from = (page - 1) * pageSize;
  const sessions = occurrences.slice(from, from + pageSize);

  return { sessions, total, page, pageSize };
}

/**
 * One occurrence, identified by its schedule and date rather than a
 * `class_sessions` id — Session Details' data source
 * (`/attendance/[scheduleId]/[date]`). A class session has no
 * product-facing identifier (01-product.md §7A), and an unmaterialized
 * occurrence has no `id` at all, so `(schedule_id, session_date)` — the
 * same pair `class_sessions_schedule_date_unique` already treats as the
 * unique key for a real row — is the only address that works for both a
 * materialized and a projected occurrence.
 *
 * Returns null when the date is not a genuine occurrence of the schedule
 * (and was never materialized either) — e.g. the wrong weekday, or
 * outside the schedule's effective period.
 *
 * @param {string} scheduleId
 * @param {string} date - "YYYY-MM-DD".
 * @returns {Promise<object|null>}
 */
export async function getSessionOccurrence(scheduleId, date) {
  const materialized = await getMaterializedSession(scheduleId, date);
  if (materialized) {
    return { ...materialized, is_materialized: true };
  }

  const schedule = await getSchedule(scheduleId);
  if (!schedule) return null;
  if (!scheduleOccursOnDate(schedule, date)) return null;

  return buildProjectedOccurrence(schedule, date);
}

/**
 * The materialized session for one schedule on one date, or null if that
 * occurrence has never been materialized — the lookup half of
 * materialize-on-first-touch (lib/class-sessions/actions.js's
 * `materializeClassSession` calls this before ever inserting, so the
 * `class_sessions_schedule_date_unique` constraint is a backstop against a
 * race, not the primary way duplicates are avoided).
 *
 * @param {string} scheduleId
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<object|null>}
 */
export async function getMaterializedSession(scheduleId, sessionDate) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("class_sessions")
    .select(COLUMNS)
    .eq("schedule_id", scheduleId)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (error) {
    console.error(
      `[class-sessions] Could not look up session for schedule ${scheduleId} on ${sessionDate}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load class session.");
  }

  return data;
}
