import "server-only";

import { createClient } from "@/lib/supabase/server";
import { todayDateString, DAYS_OF_WEEK } from "@/lib/schedules/validation";

/**
 * Data Access Layer for reading Schedules.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0009_schedules.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

// series_id (0013_schedule_assignment.sql) is included on every query here,
// not only where it is used today: it is what a schedule version's stable
// identity is, and every caller in this file benefits from having it
// without needing its own column list.
const LIST_COLUMNS =
  "id, series_id, batch_id, day_of_week, start_time, end_time, effective_from, effective_until, status, batches(id, name, code), instructors(id, full_name)";
const DETAIL_COLUMNS = LIST_COLUMNS + ", created_at, updated_at";

const DAY_ORDER = Object.fromEntries(DAYS_OF_WEEK.map((day, index) => [day, index]));

// PostgREST's `.or()` filter grammar uses "," to separate conditions and
// "()" to group them; escaping them keeps a literal search term literal
// rather than breaking the expression. Duplicated from lib/students/data.js's
// identical helper — each caller escapes for its own `.or()` call, not a
// common code path (same rationale as every other copy of this helper).
function escapeForOrFilter(value) {
  return value.replace(/[%_,()]/g, (char) => `\\${char}`);
}

/**
 * Batch ids matching a name/code search, and instructor ids matching a name
 * search — used to fold "search by batch or instructor" into the Schedule
 * list's own `.or()` filter (batch_id.in.(…), instructor_id.in.(…)) rather
 * than an embedded-table ilike inside `.or()`, which PostgREST's grammar
 * does not reliably support across a join. Same technique as
 * lib/memberships/data.js's `findStudentIdsByName`.
 */
async function findMatchingIds(supabase, term) {
  const [batchesResult, instructorsResult] = await Promise.all([
    supabase.from("batches").select("id").or(`name.ilike.%${term}%,code.ilike.%${term}%`),
    supabase.from("instructors").select("id").ilike("full_name", `%${term}%`),
  ]);

  if (batchesResult.error) {
    console.error("[schedules] Could not search batches by name/code:", batchesResult.error.code, batchesResult.error.message);
  }
  if (instructorsResult.error) {
    console.error("[schedules] Could not search instructors by name:", instructorsResult.error.code, instructorsResult.error.message);
  }

  return {
    batchIds: (batchesResult.data ?? []).map((row) => row.id),
    instructorIds: (instructorsResult.data ?? []).map((row) => row.id),
  };
}

/**
 * Paginated, filterable schedule list for the Schedule screen's List View
 * (one of the Schedule area's two approved views — see also
 * `listSchedulesForWeek` for the Weekly Schedule view's data source).
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against batch name/code or instructor name.
 * @param {string} [params.batchId] - Only schedules for this batch.
 * @param {string} [params.instructorId] - Only schedules for this instructor.
 * @param {"all"|"active"|"inactive"} [params.status]
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @returns {Promise<{ schedules: object[], total: number, page: number, pageSize: number }>}
 */
export async function listSchedules({
  q = "",
  batchId = "",
  instructorId = "",
  status = "all",
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();

  let query = supabase
    .from("schedules")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("effective_from", { ascending: false });

  if (q) {
    const term = escapeForOrFilter(q);
    const { batchIds, instructorIds } = await findMatchingIds(supabase, term);
    const orParts = [];
    if (batchIds.length > 0) orParts.push(`batch_id.in.(${batchIds.join(",")})`);
    if (instructorIds.length > 0) orParts.push(`instructor_id.in.(${instructorIds.join(",")})`);

    if (orParts.length === 0) {
      // No batch or instructor matched the search term at all — every
      // schedule filters out, so short-circuit rather than sending a
      // malformed empty `.or()` call.
      return { schedules: [], total: 0, page, pageSize };
    }
    query = query.or(orParts.join(","));
  }

  if (batchId) {
    query = query.eq("batch_id", batchId);
  }

  if (instructorId) {
    query = query.eq("instructor_id", instructorId);
  }

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error(
      `[schedules] Could not list schedules (q=${q}, batchId=${batchId}, instructorId=${instructorId}, status=${status}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load schedules.");
  }

  return { schedules: data ?? [], total: count ?? 0, page, pageSize };
}

/**
 * A single schedule by id, or null if it does not exist (or is not visible
 * to the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getSchedule(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("schedules")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;

    console.error(`[schedules] Could not load schedule ${id}:`, error.code, error.message);
    throw new Error("Could not load schedule.");
  }

  return data;
}

/**
 * All schedules for one batch — active and historical/inactive alike, most
 * recently effective first — for the Batch Details Schedules tab and its
 * Overview panel preview.
 *
 * @param {string} batchId
 * @returns {Promise<object[]>}
 */
export async function listSchedulesForBatch(batchId) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("schedules")
    .select(LIST_COLUMNS)
    .eq("batch_id", batchId)
    .order("effective_from", { ascending: false });

  if (error) {
    console.error(`[schedules] Could not list schedules for batch ${batchId}:`, error.code, error.message);
    throw new Error("Could not load schedules.");
  }

  return data ?? [];
}

/**
 * Every schedule that is both active and currently within its effective
 * period, across every batch — the Add/Edit Batch Enrollment form's
 * schedule-picker data source (01-product.md §4 "Schedule Assignment").
 * Fetched once for all batches rather than re-fetched per batch selection:
 * this project passes everything a client form needs as props rather than
 * fetching on interaction (there is no client-side data layer anywhere in
 * this codebase), and the full currently-available set is small enough
 * that the admin's batch choice can simply filter it client-side.
 *
 * Sorted Monday–Sunday, then by start time — `.order()` on `day_of_week`
 * alone would sort alphabetically (friday, monday, ...), so the calendar
 * order is applied in JS using the same DAYS_OF_WEEK sequence the Schedule
 * form's own day picker uses.
 *
 * @returns {Promise<object[]>}
 */
export async function listCurrentSchedules() {
  const supabase = await createClient();
  const today = todayDateString();

  const { data, error } = await supabase
    .from("schedules")
    .select(LIST_COLUMNS)
    .eq("status", "active")
    .lte("effective_from", today)
    .or(`effective_until.is.null,effective_until.gte.${today}`);

  if (error) {
    console.error("[schedules] Could not list current schedules:", error.code, error.message);
    throw new Error("Could not load schedules.");
  }

  const rows = data ?? [];
  rows.sort((a, b) => {
    const dayDiff = DAY_ORDER[a.day_of_week] - DAY_ORDER[b.day_of_week];
    return dayDiff !== 0 ? dayDiff : a.start_time.localeCompare(b.start_time);
  });

  return rows;
}

/**
 * For each given schedule_series id, the version that best represents it
 * right now: the currently active-and-in-effect version if one exists,
 * else the most recently effective version of any status. A schedule
 * assignment (enrollment_schedules, 0013_schedule_assignment.sql) records
 * only which series it is for, not which specific version — a series can
 * have several versions over time (0009_schedules.sql) — so anywhere an
 * assignment needs to be shown as a weekday/time/instructor, this resolves
 * it to one concrete version rather than leaving the caller to guess.
 *
 * @param {string[]} seriesIds
 * @returns {Promise<Map<string, object>>} Keyed by series_id.
 */
export async function getRepresentativeSchedulesForSeries(seriesIds) {
  if (seriesIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedules")
    .select(LIST_COLUMNS)
    .in("series_id", seriesIds);

  if (error) {
    console.error("[schedules] Could not load schedule versions for series:", error.code, error.message);
    throw new Error("Could not load schedules.");
  }

  const today = todayDateString();
  const isCurrentVersion = (schedule) =>
    schedule.status === "active" &&
    schedule.effective_from <= today &&
    (!schedule.effective_until || schedule.effective_until >= today);

  const sorted = [...(data ?? [])].sort((a, b) => {
    const aCurrent = isCurrentVersion(a);
    const bCurrent = isCurrentVersion(b);
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    return b.effective_from.localeCompare(a.effective_from);
  });

  const bySeriesId = new Map();
  for (const schedule of sorted) {
    if (!bySeriesId.has(schedule.series_id)) {
      bySeriesId.set(schedule.series_id, schedule);
    }
  }

  return bySeriesId;
}

/**
 * Every schedule whose effective period overlaps a given week — the Weekly
 * Schedule view's data source (02-ux.md "Weekly Schedule view"). Active and
 * inactive alike: status is never checked here, deliberately. A deactivated
 * schedule's `effective_until` already marks the last date it applied, so
 * filtering purely by effective-period overlap is both correct and
 * sufficient for a view the admin can navigate to any past, present, or
 * future week — a status check would be redundant for past weeks and
 * wrong for weeks before a schedule was ever deactivated.
 *
 * This returns every candidate schedule whose overall effective range
 * touches the week at all; it is the caller's job (weekly-schedule.js) to
 * check whether each schedule's specific weekday actually falls inside its
 * effective period for this particular week — a schedule effective from
 * Wednesday still overlaps a Monday-starting week, but its own Monday
 * occurrence that week has not happened.
 *
 * @param {string} weekStart - "YYYY-MM-DD", a Monday.
 * @param {string} weekEnd - "YYYY-MM-DD", the following Sunday.
 * @returns {Promise<object[]>}
 */
export async function listSchedulesForWeek(weekStart, weekEnd) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("schedules")
    .select(LIST_COLUMNS)
    .lte("effective_from", weekEnd)
    .or(`effective_until.is.null,effective_until.gte.${weekStart}`);

  if (error) {
    console.error(
      `[schedules] Could not list schedules for week ${weekStart}–${weekEnd}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load schedules.");
  }

  return data ?? [];
}

const JS_DAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Whether a recurring schedule actually falls on a specific calendar date —
 * the day-of-week and effective-period check every occurrence must pass,
 * factored out here so Phase 14's materialization (lib/class-sessions/) can
 * reuse it rather than reimplementing it. This is the same three-condition
 * check app/schedule/weekly-schedule.js already applies inline per day when
 * laying out the week grid; that file is unchanged by this addition — it is
 * pre-existing Phase 13 UI, not touched here — but the rule itself now has
 * one canonical home for anything written after it to call.
 *
 * Deliberately does not check `schedule.status`: a deactivated schedule's
 * `effective_until` already bounds the last date it applied
 * (0009_schedules.sql), so the date check alone is both correct and
 * sufficient — see `listSchedulesForWeek`'s comment above for the same
 * reasoning applied to a week-range query instead of a single date.
 *
 * @param {{ day_of_week: string, effective_from: string, effective_until: string|null }} schedule
 * @param {string} date - "YYYY-MM-DD".
 * @returns {boolean}
 */
export function scheduleOccursOnDate(schedule, date) {
  if (date < schedule.effective_from) return false;
  if (schedule.effective_until && date > schedule.effective_until) return false;

  const [year, month, day] = date.split("-").map(Number);
  const jsDayIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return JS_DAY_INDEX[schedule.day_of_week] === jsDayIndex;
}

/**
 * Projects future occurrences of a recurring schedule for display —
 * 04-development-plan.md's Phase 13 definition: "future occurrences are
 * computed from the recurring pattern for display only." Nothing here is
 * persisted; there is no class_sessions table and no generation job. Powers
 * Schedule Details' Upcoming Sessions tab (and its Overview preview).
 *
 * Bounded by `effective_until` when set, otherwise by `horizonDays`, and
 * always by `limit` — an unbounded open-ended schedule must not be
 * projected forever.
 *
 * @param {{ day_of_week: string, start_time: string, end_time: string, effective_from: string, effective_until: string|null }} schedule
 * @param {{ limit?: number, horizonDays?: number }} [options]
 * @returns {{ date: string, start_time: string, end_time: string }[]}
 */
export function projectUpcomingSessions(schedule, { limit = 12, horizonDays = 90 } = {}) {
  if (schedule.status !== "active") return [];

  const today = todayDateString();
  const windowStart = schedule.effective_from > today ? schedule.effective_from : today;

  const [startYear, startMonth, startDay] = windowStart.split("-").map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));

  const targetDayIndex = JS_DAY_INDEX[schedule.day_of_week];
  const currentDayIndex = cursor.getUTCDay();
  const daysUntilTarget = (targetDayIndex - currentDayIndex + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + daysUntilTarget);

  const horizon = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
  const horizonDate = horizon.toISOString().slice(0, 10);
  const boundDate =
    schedule.effective_until && schedule.effective_until < horizonDate
      ? schedule.effective_until
      : horizonDate;

  const occurrences = [];
  while (occurrences.length < limit) {
    const dateString = cursor.toISOString().slice(0, 10);
    if (dateString > boundDate) break;

    occurrences.push({
      date: dateString,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return occurrences;
}
