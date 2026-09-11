import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getRepresentativeSchedulesForSeries } from "@/lib/schedules/data";
import { todayDateString } from "@/lib/schedules/validation";

/**
 * Data Access Layer for reading Batch Enrollments (Student Details' "Batch
 * Enrollments" panel and the Add/Edit Enrollment forms).
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0007_batch_enrollments.sql); callers must still guard
 * the page/action with `requireRole(ROLES.ADMIN)` — this module only reads
 * data, it does not authorize the caller.
 */

const COLUMNS =
  "id, student_id, batch_id, effective_start_date, effective_end_date, status, batches(id, name, code)";

/**
 * All enrollments for one student — active and historical/inactive alike,
 * so Student Details can show the full record (01-product.md §12:
 * historical enrollments are retained, never hidden). Most recently started
 * first.
 *
 * @param {string} studentId
 * @returns {Promise<object[]>}
 */
export async function listEnrollmentsForStudent(studentId) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("batch_enrollments")
    .select(COLUMNS)
    .eq("student_id", studentId)
    .order("effective_start_date", { ascending: false });

  if (error) {
    console.error(
      `[enrollments] Could not list enrollments for student ${studentId}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load batch enrollments.");
  }

  return data ?? [];
}

/**
 * All enrollments in one batch — active and historical/inactive alike,
 * most recently started first (same "retain, never hide" convention as
 * `listEnrollmentsForStudent`) — Batch Details' Students tab.
 *
 * @param {string} batchId
 * @returns {Promise<object[]>}
 */
export async function listEnrollmentsForBatch(batchId) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("batch_enrollments")
    .select(
      "id, student_id, batch_id, effective_start_date, effective_end_date, status, students(id, full_name, phone, student_code, status)"
    )
    .eq("batch_id", batchId)
    .order("effective_start_date", { ascending: false });

  if (error) {
    console.error(`[enrollments] Could not list enrollments for batch ${batchId}:`, error.code, error.message);
    throw new Error("Could not load batch enrollments.");
  }

  return data ?? [];
}

/**
 * A single enrollment by id, or null if it does not exist (or is not
 * visible to the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getEnrollment(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("batch_enrollments")
    .select(COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;

    console.error(`[enrollments] Could not load enrollment ${id}:`, error.code, error.message);
    throw new Error("Could not load batch enrollment.");
  }

  return data;
}

/**
 * The schedule assignments for one enrollment (01-product.md §4 "Schedule
 * Assignment") — all of them, current and historical alike, most recently
 * started first, never hidden (same "retain, don't hide" convention as
 * `listEnrollmentsForStudent` itself). Each assignment is resolved to a
 * representative `schedules` version for display (weekday, time,
 * instructor) via `getRepresentativeSchedulesForSeries` — the single place
 * that resolution logic lives, shared with the enrollment form's picker
 * and the Batch Details Students tab.
 *
 * An assignment whose representative schedule could not be resolved (`null`)
 * is a genuine data inconsistency worth surfacing, not hiding — see this
 * slice's Student Details panel, which flags it rather than silently
 * dropping the row.
 *
 * @param {string} enrollmentId
 * @returns {Promise<{ id: string, schedule_series_id: string, effective_start_date: string, effective_end_date: string|null, schedule: object|null }[]>}
 */
export async function listScheduleAssignmentsForEnrollment(enrollmentId) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enrollment_schedules")
    .select("id, schedule_series_id, effective_start_date, effective_end_date")
    .eq("batch_enrollment_id", enrollmentId)
    .order("effective_start_date", { ascending: false });

  if (error) {
    console.error(
      `[enrollments] Could not list schedule assignments for enrollment ${enrollmentId}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load schedule assignments.");
  }

  const assignments = data ?? [];
  const scheduleBySeriesId = await getRepresentativeSchedulesForSeries([
    ...new Set(assignments.map((assignment) => assignment.schedule_series_id)),
  ]);

  return assignments.map((assignment) => ({
    ...assignment,
    schedule: scheduleBySeriesId.get(assignment.schedule_series_id) ?? null,
  }));
}

/**
 * Whether a schedule assignment is currently active — its effective period
 * covers today. Pure date comparison, no query; used both to pre-check the
 * Edit Enrollment form's schedule picker and to label a Student Details
 * assignment as current vs. historical.
 *
 * @param {{ effective_start_date: string, effective_end_date: string|null }} assignment
 * @param {string} [today] - "YYYY-MM-DD". Defaults to the server's own UTC today.
 * @returns {boolean}
 */
export function isScheduleAssignmentActive(assignment, today = todayDateString()) {
  return (
    assignment.effective_start_date <= today &&
    (!assignment.effective_end_date || assignment.effective_end_date >= today)
  );
}
