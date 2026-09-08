import "server-only";

import { createClient } from "@/lib/supabase/server";

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
