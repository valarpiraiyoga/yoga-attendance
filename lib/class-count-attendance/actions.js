"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString } from "@/lib/memberships/data";
import {
  RECORD_FAILED_MESSAGE,
  REVERSE_FAILED_MESSAGE,
  UUID_PATTERN,
  REASON_MESSAGE,
  attendanceDateError,
  reasonError,
  recordErrorMessage,
  reverseErrorMessage,
  trimReason,
} from "@/lib/class-count-attendance/record-core";
import { EDIT_EXPIRY_FAILED_MESSAGE, expiryEditErrorMessage, isValidDateString } from "@/lib/class-count-attendance/expiry-core";

/**
 * Records ONE completed class against a class-count membership for the date the user chose (migration 0045's
 * three-argument `record_class_count_attendance`, re-created by 0053): an Admin, or an Instructor for a student they are
 * authorized for - the database decides, and refuses everyone else (42501). The database does everything that matters - locks the
 * membership, checks it and the date, takes one class, never below zero - and answers a repeat of the same `requestId`
 * with the original result without recording again, so a retry after a dropped connection cannot take a second class.
 * This only guards the caller and turns the result into something the screen shows; the date is checked here for a quick
 * answer (a real date, not in the future at the centre) and never replaced with today.
 *
 * Class-count recording is separate from session attendance: nothing here touches a class session or the
 * `attendance` table.
 *
 * @param {string} membershipId
 * @param {string} requestId - one per confirmation, kept by the caller until the call has been answered.
 * @param {string} attendedOn - "YYYY-MM-DD", the day the class was held.
 * @returns {Promise<{ success: true, classesRemaining: number, replayed: boolean } | { error: string }>}
 */
export async function recordClassCount(membershipId, requestId, attendedOn) {
  await requireRole(ROLES.ADMIN, ROLES.INSTRUCTOR);

  if (!UUID_PATTERN.test(String(membershipId ?? "")) || !UUID_PATTERN.test(String(requestId ?? ""))) {
    return { error: RECORD_FAILED_MESSAGE };
  }
  const dateError = attendanceDateError(attendedOn, { today: await todayDateString() });
  if (dateError) return { error: dateError };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_class_count_attendance", {
    p_membership_id: membershipId,
    p_request_id: requestId,
    p_attended_on: attendedOn,
  });

  if (error) {
    // A refusal the function raises on purpose is expected, not worth a log line; anything else is.
    const message = recordErrorMessage(error);
    if (message === RECORD_FAILED_MESSAGE) {
      console.error(`[class-count-attendance] Could not record a class for ${membershipId}:`, error.code, error.message);
    }
    return { error: message };
  }

  revalidatePath("/attendance/class-count");
  revalidatePath("/memberships");
  revalidatePath(`/memberships/${membershipId}`);
  if (data?.student_id) revalidatePath(`/students/${data.student_id}`);

  return { success: true, classesRemaining: data?.classes_remaining ?? 0, replayed: Boolean(data?.replayed) };
}

/**
 * Reverses ONE recorded class (migration 0045's `reverse_class_count_attendance`, Admin only). The record is never
 * edited or deleted: the database adds a reversal row (who, when, why) and the class counts again. The reason is trimmed
 * and checked here (3 to 500 characters) for a quick answer; the database checks it again. A repeat of the same
 * `requestId` is answered with the original result.
 *
 * @param {string} attendanceId
 * @param {string} reason
 * @param {string} requestId - one per confirmation, kept by the caller until the call has been answered.
 * @returns {Promise<{ success: true, classesRemaining: number, replayed: boolean } | { error: string }>}
 */
export async function reverseClassCount(attendanceId, reason, requestId) {
  await requireRole(ROLES.ADMIN);

  if (!UUID_PATTERN.test(String(attendanceId ?? "")) || !UUID_PATTERN.test(String(requestId ?? ""))) {
    return { error: REVERSE_FAILED_MESSAGE };
  }
  if (reasonError(reason)) return { error: REASON_MESSAGE };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_class_count_attendance", {
    p_attendance_id: attendanceId,
    p_reason: trimReason(reason),
    p_request_id: requestId,
  });

  if (error) {
    const message = reverseErrorMessage(error);
    if (message === REVERSE_FAILED_MESSAGE) {
      console.error(`[class-count-attendance] Could not reverse record ${attendanceId}:`, error.code, error.message);
    }
    return { error: message };
  }

  revalidatePath("/attendance/class-count");
  revalidatePath("/memberships");
  if (data?.membership_id) revalidatePath(`/memberships/${data.membership_id}`);
  if (data?.student_id) revalidatePath(`/students/${data.student_id}`);

  return { success: true, classesRemaining: data?.classes_remaining ?? 0, replayed: Boolean(data?.replayed) };
}

/**
 * Changes the expiry of a class-count membership - legacy or package-linked - through migration 0049's
 * `edit_class_count_expiry` (Admin only): a new expiry date, or null for No expiry, with a required reason. The membership is
 * never updated here: the database function changes the expiry and writes the audit row (previous and new expiry, reason, who
 * and when) in one transaction, and refuses anything else (a duration membership, an expiry before the start date, no change).
 * The fee, the class allowance, the attendance records and the reversals are not touched, and no record is reversed.
 *
 * @param {string} membershipId
 * @param {string|null} newExpiry - "YYYY-MM-DD", or null for No expiry.
 * @param {string} reason - trimmed and checked here (3 to 500 characters); the database checks it again.
 * @returns {Promise<{ success: true } | { error: string }>}
 */
export async function editClassCountExpiry(membershipId, newExpiry, reason) {
  await requireRole(ROLES.ADMIN);

  if (!UUID_PATTERN.test(String(membershipId ?? ""))) return { error: EDIT_EXPIRY_FAILED_MESSAGE };
  if (newExpiry !== null && !isValidDateString(newExpiry)) return { error: "Enter a valid expiry date, or choose No expiry." };
  if (reasonError(reason)) return { error: REASON_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_class_count_expiry", {
    p_membership_id: membershipId,
    p_new_expiry: newExpiry,
    p_reason: trimReason(reason),
  });

  if (error) {
    const message = expiryEditErrorMessage(error);
    if (message === EDIT_EXPIRY_FAILED_MESSAGE) {
      console.error(`[class-count-attendance] Could not edit the expiry of ${membershipId}:`, error.code, error.message);
    }
    return { error: message };
  }

  revalidatePath("/attendance/class-count");
  revalidatePath("/memberships");
  revalidatePath(`/memberships/${membershipId}`);

  return { success: true };
}
