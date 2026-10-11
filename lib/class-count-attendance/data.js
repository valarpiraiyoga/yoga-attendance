import "server-only";

import { createClient } from "@/lib/supabase/server";
import { eligibleRowFrom, pickClassesToRenew } from "@/lib/class-count-attendance/rows";

/**
 * Data Access Layer for the Class Count Attendance tab (migrations 0043 and 0044).
 *
 * Admin only: `list_class_count_eligible()` refuses anyone else, and the memberships read is Admin-only under RLS;
 * callers must still guard the page with `requireRole(ROLES.ADMIN)`.
 */

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

  // Names come from `profiles` (the Admin's own account row); a person who has since been removed shows as unknown.
  const names = new Map();
  if (userIds.size > 0) {
    const { data: profiles, error: profileError } = await supabase.from("profiles").select("id, full_name").in("id", [...userIds]);
    if (profileError) {
      console.error("[class-count-attendance] Could not load profile names:", profileError.code, profileError.message);
    }
    for (const profile of profiles ?? []) names.set(profile.id, profile.full_name);
  }
  const nameOf = (id) => (id ? (names.get(id) ?? "Admin") : null);

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
