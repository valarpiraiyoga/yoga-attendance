"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCenterTimezone } from "@/lib/center-profile/settings";
import { communicationErrorResult, defaultCommunicatedAt, validateCommunicationInput } from "@/lib/communications/core";

/**
 * Server actions for student communications (migration 0057).
 *
 * Staff only (`requireRole` first). The database is the security boundary: `record_student_communication` and
 * `complete_student_follow_up` check that the caller may act for the student (an Admin, or an Instructor for a student they are
 * authorized for) and write the staff attribution from auth.uid() - this module never sends a staff ID. The input is validated
 * here first so the form gets field errors, then again by the database.
 */

function studentPath(studentId) {
  return `/students/${studentId}`;
}

/**
 * Add Communication. `input`: { communicatedAt ("YYYY-MM-DDTHH:MM", the centre's local time), type, subject, notes, followUp
 * (boolean), followUpDate, followUpNote }. Without a follow-up only the communication is saved; with one, both are saved in the
 * same statement and the follow-up is Pending.
 *
 * @returns {Promise<{ ok: true } | { error: string, fieldErrors?: Record<string, string> }>}
 */
export async function recordStudentCommunication(studentId, input) {
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  if (!studentId) return { error: "Could not save. Try again." };

  const result = validateCommunicationInput(input, defaultCommunicatedAt(new Date(), await getCenterTimezone()));
  if (!result.success) return { error: "Check the highlighted fields.", fieldErrors: result.fieldErrors };
  const data = result.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_student_communication", {
    p_student_id: studentId,
    p_communicated_at: data.communicatedAt,
    p_type: data.type,
    p_subject: data.subject,
    p_notes: data.notes,
    p_follow_up_date: data.followUpDate,
    p_follow_up_note: data.followUpNote,
  });

  if (error) {
    if (error.code !== "22023") {
      console.error(`[communications] Could not record a communication for student ${studentId}:`, error.code, error.message);
    }
    return communicationErrorResult(error);
  }

  revalidatePath(studentPath(studentId));
  return { ok: true };
}

/**
 * Edit Communication (migration 0058). The same input and validation as Add Communication. The database keeps the id, the
 * recorder and the recorded time, stamps who edited and when, and refuses to change or remove a COMPLETED follow-up (55000).
 *
 * @returns {Promise<{ ok: true } | { error: string, fieldErrors?: Record<string, string> }>}
 */
export async function updateStudentCommunication(studentId, communicationId, input) {
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  if (!studentId || !communicationId) return { error: "Could not save. Try again." };

  const result = validateCommunicationInput(input, defaultCommunicatedAt(new Date(), await getCenterTimezone()));
  if (!result.success) return { error: "Check the highlighted fields.", fieldErrors: result.fieldErrors };
  const data = result.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_student_communication", {
    p_communication_id: communicationId,
    p_communicated_at: data.communicatedAt,
    p_type: data.type,
    p_subject: data.subject,
    p_notes: data.notes,
    p_follow_up: data.followUpDate !== null,
    p_follow_up_date: data.followUpDate,
    p_follow_up_note: data.followUpNote,
  });

  if (error) {
    if (!["22023", "55000"].includes(error.code)) {
      console.error(`[communications] Could not edit communication ${communicationId}:`, error.code, error.message);
    }
    return communicationErrorResult(error);
  }

  revalidatePath(studentPath(studentId));
  return { ok: true };
}

/**
 * Mark a pending follow-up Completed. Its date and note are kept; when and by whom are recorded; no communication is added.
 *
 * @returns {Promise<{ ok: true } | { error: string }>}
 */
export async function completeStudentFollowUp(studentId, communicationId) {
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);
  if (!studentId || !communicationId) return { error: "Could not update the follow-up. Try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_student_follow_up", { p_communication_id: communicationId });

  if (error) {
    if (!["22023", "55000"].includes(error.code)) {
      console.error(`[communications] Could not complete follow-up ${communicationId}:`, error.code, error.message);
    }
    const mapped = communicationErrorResult(error);
    return { error: mapped.error === "Could not save. Try again." ? "Could not update the follow-up. Try again." : mapped.error };
  }

  revalidatePath(studentPath(studentId));
  return { ok: true };
}
