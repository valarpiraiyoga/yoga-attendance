import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { mapCommunicationRow, sortCommunications } from "@/lib/communications/core";

/**
 * Data Access Layer for student communications (migration 0057). Read-only.
 *
 * Reads go through `list_student_communications`, which authorizes the caller itself (an Admin, or an Instructor for a student
 * they are authorized for) and returns the history newest first. Staff are signed in here as well, so a page that forgot its own
 * check still never reads anything for an anonymous caller.
 *
 * @param {string} studentId
 * @returns {Promise<ReturnType<typeof mapCommunicationRow>[]>}
 */
export async function listStudentCommunications(studentId) {
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  const supabase = await createClient();
  const [{ data, error }, timeZone] = await Promise.all([
    supabase.rpc("list_student_communications", { p_student_id: studentId }),
    getCenterTimezone(),
  ]);

  if (error) {
    console.error(`[communications] Could not list communications for student ${studentId}:`, error.code, error.message);
    throw new Error("Could not load the communication history.");
  }

  return sortCommunications((data ?? []).map((row) => mapCommunicationRow(row, timeZone)));
}
