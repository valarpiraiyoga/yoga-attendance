import "server-only";

import { createClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/schedules/validation";

/**
 * Data Access Layer for reading Schedules.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0009_schedules.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS =
  "id, day_of_week, start_time, end_time, effective_from, effective_until, status, batches(id, name, code), instructors(id, full_name)";
const DETAIL_COLUMNS = LIST_COLUMNS + ", created_at, updated_at";

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
 * Paginated, filterable schedule list for the Schedule screen (wireframe:
 * "Weekly Schedule List View").
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
