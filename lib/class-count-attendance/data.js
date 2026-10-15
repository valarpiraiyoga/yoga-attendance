import "server-only";

import { createClient } from "@/lib/supabase/server";
import { eligibleRowFrom, pickClassesToRenew } from "@/lib/class-count-attendance/rows";
import { expiryEditRowFrom } from "@/lib/class-count-attendance/expiry-core";
import { actorLabelOf, actorLabels } from "@/lib/class-count-attendance/actors";
import { classCountRecordFrom, classCountRecordFromHistoryRow, countClassCountByDate } from "@/lib/class-count-attendance/attendance-rows";

/**
 * Data Access Layer for the Class Count Attendance tab (migrations 0043 and 0044).
 *
 * `list_class_count_eligible()` (migration 0053) admits an Admin (every membership) and an active Instructor (only their authorized
 * students, no phone) and refuses everyone else. The memberships read in `listClassCountToRenew` is Admin-only under RLS: only an
 * Admin's page calls it. Callers must still guard the page with `requireRole`.
 */

/**
 * The display labels for the people behind audit columns (`recorded_by`, `reversed_by`, `edited_by`): a Map from user ID to
 * "Name (Instructor)", an Admin's name, or "Unknown user" (see `actorLabels`). An Instructor's name is read from `instructors`
 * (an Admin may read it); `profiles` answers only for the signed-in Admin's own row, so it is never the only source. A failed
 * lookup is logged and leaves the labels as "Unknown user" - never a guess that the person is an Admin.
 */
export async function loadActorLabels(supabase, userIds) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [profileResult, instructorResult] = await Promise.all([
    supabase.from("profiles").select("id, role, full_name").in("id", ids),
    supabase.from("instructors").select("user_id, full_name").in("user_id", ids),
  ]);
  if (profileResult.error) {
    console.error("[class-count-attendance] Could not load profile names:", profileResult.error.code, profileResult.error.message);
  }
  if (instructorResult.error) {
    console.error("[class-count-attendance] Could not load instructor names:", instructorResult.error.code, instructorResult.error.message);
  }

  return actorLabels({ ids, profiles: profileResult.data ?? [], instructors: instructorResult.data ?? [] });
}

/**
 * The class-count memberships a class can be recorded for today (not cancelled, started, not expired, active
 * student, at least one class left), straight from `list_class_count_eligible()`.
 */
export async function listClassCountEligible() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_class_count_eligible");

  if (error) {
    console.error("[class-count-attendance] Could not list eligible memberships:", error.code, error.message);
    throw new Error("Could not load class-count memberships.");
  }

  return (data ?? []).map(eligibleRowFrom);
}

/**
 * The used-up class-count memberships to offer a Renew action for (see `pickClassesToRenew`).
 */
export async function listClassCountToRenew() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select(
      "id, membership_code, student_id, start_date, end_date, total_classes, class_count_attendance(id, class_count_attendance_reversals(id)), students(id, full_name, student_code, photo_url, status)"
    )
    .eq("kind", "class_count")
    .is("cancelled_at", null);

  if (error) {
    console.error("[class-count-attendance] Could not list class-count memberships:", error.code, error.message);
    throw new Error("Could not load class-count memberships.");
  }

  return pickClassesToRenew(data ?? []);
}

/**
 * Every class recorded against one class-count membership, newest attendance date first, each with its reversal when it
 * has one (migration 0045) and the names of who recorded and who reversed it. Records are shown as they were made - a
 * reversed one stays in the list, marked reversed.
 *
 * @returns {Promise<{
 *   id: string, attendedOn: string, recordedAt: string, recordedBy: string|null,
 *   reversal: { reversedAt: string, reversedBy: string|null, reason: string }|null,
 * }[]>}
 */
export async function listClassCountHistory(membershipId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_count_attendance")
    .select("id, attended_on, created_at, recorded_by, class_count_attendance_reversals(reversed_at, reversed_by, reason)")
    .eq("membership_id", membershipId)
    .order("attended_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[class-count-attendance] Could not load the history of ${membershipId}:`, error.code, error.message);
    throw new Error("Could not load class attendance.");
  }

  const rows = data ?? [];
  const reversalOf = (row) => {
    const reversal = row.class_count_attendance_reversals;
    return Array.isArray(reversal) ? (reversal[0] ?? null) : (reversal ?? null);
  };

  const userIds = new Set();
  for (const row of rows) {
    if (row.recorded_by) userIds.add(row.recorded_by);
    const reversal = reversalOf(row);
    if (reversal?.reversed_by) userIds.add(reversal.reversed_by);
  }

  // Who recorded and who reversed: an Admin or an Instructor (migration 0053). A person whose account has since been removed has no
  // stored ID and shows as nothing; an ID that cannot be identified shows as unknown - never as "Admin".
  const names = await loadActorLabels(supabase, [...userIds]);
  const nameOf = (id) => actorLabelOf(names, id);

  return rows.map((row) => {
    const reversal = reversalOf(row);
    return {
      id: row.id,
      attendedOn: row.attended_on,
      recordedAt: row.created_at,
      recordedBy: nameOf(row.recorded_by),
      reversal: reversal
        ? { reversedAt: reversal.reversed_at, reversedBy: nameOf(reversal.reversed_by), reason: reversal.reason }
        : null,
    };
  });
}

/**
 * The expiry edits of one class-count membership, newest first (migration 0049): the previous and new expiry (null = No expiry),
 * the reason, and who made the change and when. Read-only: the history is written only by `edit_class_count_expiry`.
 *
 * @returns {Promise<{ id: string, previousExpiry: string|null, newExpiry: string|null, reason: string, editedAt: string, editedBy: string|null }[]>}
 */
export async function listClassCountExpiryEdits(membershipId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_count_expiry_edits")
    .select("id, previous_expiry, new_expiry, reason, edited_by, edited_at")
    .eq("membership_id", membershipId)
    .order("edited_at", { ascending: false });

  if (error) {
    console.error(`[class-count-attendance] Could not load the expiry history of ${membershipId}:`, error.code, error.message);
    throw new Error("Could not load the expiry history.");
  }

  const rows = data ?? [];
  const names = await loadActorLabels(supabase, rows.map((row) => row.edited_by));

  return rows.map((row) => expiryEditRowFrom(row, (id) => actorLabelOf(names, id)));
}

// What Student Details and Attendance History show of a record: the date, its reversal, its membership (code and current
// expiry, for the "Attendance after current expiry" flag) and its student. Who recorded or reversed it stays on Membership Details.
const DISPLAY_COLUMNS =
  "id, membership_id, student_id, attended_on, created_at, class_count_attendance_reversals(reversed_at, reason), memberships(id, membership_code, end_date), students(id, full_name, student_code)";

// Attendance History shows a date range at once (no pagination), like its session list.
export const CLASS_COUNT_HISTORY_RANGE_LIMIT = 500;

// "Quick dates" offers the most recent dates; this many rows are read to find them (a date can hold several records).
const CLASS_COUNT_QUICK_DATE_SCAN_LIMIT = 200;

/**
 * A student's most recent class-count records (newest attendance date first), for Student Details "Recent Attendance". Each
 * is a display record (`classCountRecordFrom`); a reversed one stays in the list marked reversed. Admin only through RLS (0043,
 * 0045): the caller must still guard the page with `requireRole(ROLES.ADMIN)`. Throws when the read fails, so the caller can
 * let the session attendance show without it.
 */
export async function listStudentClassCountAttendance(studentId, { dateFrom, dateTo, limit }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_count_attendance")
    .select(DISPLAY_COLUMNS)
    .eq("student_id", studentId)
    .gte("attended_on", dateFrom)
    .lte("attended_on", dateTo)
    .order("attended_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[class-count-attendance] Could not load the recent classes of ${studentId}:`, error.code, error.message);
    throw new Error("Could not load class-count attendance.");
  }

  return (data ?? []).map(classCountRecordFrom);
}

/**
 * The class-count records of a date range for Attendance History (Admin only through RLS), newest first, at most
 * `CLASS_COUNT_HISTORY_RANGE_LIMIT`, with `total` the number in the range. `q` matches the student's name or the membership
 * code; it is resolved to ids first (like the session search) so the cap applies to the matches. Kept apart from every session
 * query: nothing here can change a session list, count or total. Throws when a read fails.
 *
 * @returns {Promise<{ records: object[], total: number }>}
 */
export async function listClassCountAttendanceRange({ dateFrom, dateTo, q = "" }) {
  const supabase = await createClient();
  let query = supabase
    .from("class_count_attendance")
    .select(DISPLAY_COLUMNS, { count: "exact" })
    .gte("attended_on", dateFrom)
    .lte("attended_on", dateTo);

  const term = q.trim();
  if (term) {
    const [students, memberships] = await Promise.all([
      supabase.from("students").select("id").ilike("full_name", `%${term}%`),
      supabase.from("memberships").select("id").ilike("membership_code", `%${term}%`),
    ]);
    for (const result of [students, memberships]) {
      if (result.error) {
        console.error("[class-count-attendance] Could not search class-count attendance:", result.error.code, result.error.message);
        throw new Error("Could not load class-count attendance.");
      }
    }
    const studentIds = (students.data ?? []).map((row) => row.id);
    const membershipIds = (memberships.data ?? []).map((row) => row.id);
    if (studentIds.length === 0 && membershipIds.length === 0) return { records: [], total: 0 };

    // Ids are UUIDs, so they carry nothing that could break the filter grammar.
    const conditions = [];
    if (studentIds.length > 0) conditions.push(`student_id.in.(${studentIds.join(",")})`);
    if (membershipIds.length > 0) conditions.push(`membership_id.in.(${membershipIds.join(",")})`);
    query = query.or(conditions.join(","));
  }

  const { data, error, count } = await query
    .order("attended_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(CLASS_COUNT_HISTORY_RANGE_LIMIT);

  if (error) {
    console.error(`[class-count-attendance] Could not load class-count attendance for ${dateFrom}..${dateTo}:`, error.code, error.message);
    throw new Error("Could not load class-count attendance.");
  }

  const records = (data ?? []).map(classCountRecordFrom);
  return { records, total: count ?? records.length };
}

/**
 * Per-date record counts for Attendance History's calendar and quick dates (Admin): `{ date, count }[]` for a month, or - with
 * no range - for the most recent dates. Dates only; no student or membership data is read.
 */
export async function listClassCountAttendanceDates({ dateFrom, dateTo } = {}) {
  const supabase = await createClient();
  let query = supabase.from("class_count_attendance").select("attended_on");
  if (dateFrom && dateTo) {
    query = query.gte("attended_on", dateFrom).lte("attended_on", dateTo);
  } else {
    query = query.order("attended_on", { ascending: false }).limit(CLASS_COUNT_QUICK_DATE_SCAN_LIMIT);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[class-count-attendance] Could not load the class-count dates:", error.code, error.message);
    throw new Error("Could not load class-count attendance.");
  }

  return countClassCountByDate(data ?? []);
}

/**
 * The same range as `listClassCountAttendanceRange`, through `list_class_count_attendance_history()` (migration 0052): for an
 * INSTRUCTOR the database returns only the records of students they are authorized for (a current active enrollment and assignment
 * on a series they teach, or attendance on a session they own) and never the reversal reason or time. The raw tables stay
 * Admin-only, so there is no other read. `q` matches the student name or membership code and can only narrow. Throws when the read
 * fails (the caller keeps the session attendance).
 *
 * @returns {Promise<{ records: object[], total: number }>}
 */
export async function listClassCountAttendanceRangeScoped({ dateFrom, dateTo, q = "" }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_class_count_attendance_history", {
    p_from: dateFrom,
    p_to: dateTo,
    p_q: q.trim() || null,
    p_limit: CLASS_COUNT_HISTORY_RANGE_LIMIT,
  });

  if (error) {
    console.error(`[class-count-attendance] Could not load the scoped history for ${dateFrom}..${dateTo}:`, error.code, error.message);
    throw new Error("Could not load class-count attendance.");
  }

  const rows = data ?? [];
  return { records: rows.map(classCountRecordFromHistoryRow), total: Number(rows[0]?.total_count ?? 0) };
}

/** Per-date counts for the calendar and Quick dates through `list_class_count_attendance_dates()` (migration 0052), scoped like the history above. */
export async function listClassCountAttendanceDatesScoped({ dateFrom, dateTo } = {}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_class_count_attendance_dates", {
    p_from: dateFrom ?? null,
    p_to: dateTo ?? null,
    p_limit: CLASS_COUNT_QUICK_DATE_SCAN_LIMIT,
  });

  if (error) {
    console.error("[class-count-attendance] Could not load the scoped class-count dates:", error.code, error.message);
    throw new Error("Could not load class-count attendance.");
  }

  return (data ?? []).map((row) => ({ date: row.attended_on, count: Number(row.record_count) }));
}
