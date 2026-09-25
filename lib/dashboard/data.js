import "server-only";

import { createClient } from "@/lib/supabase/server";
import { PLAN } from "@/lib/status";
import {
  ACTIVITY_LIMIT,
  attendanceActivity,
  membershipActivity,
  mergeActivity,
  studentActivity,
} from "@/lib/dashboard/activity";

/**
 * Data Access Layer for the Dashboard's Recent Activity (Admin only - all three
 * tables are admin-readable; callers guard with `ROLES.ADMIN`).
 *
 * Three small reads (the latest few of each kind), merged and cut to the newest
 * `ACTIVITY_LIMIT`. Nothing is stored for this: every item is a real record.
 *
 * @returns {Promise<{ kind: string, at: string, title: string, detail: string }[]>}
 */
export async function getRecentActivity() {
  const supabase = await createClient();

  const [sessions, students, memberships] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id, updated_at, batches(name)")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    supabase
      .from("students")
      .select("id, full_name, created_at")
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    supabase
      .from("memberships")
      .select("id, plan, created_at, students(full_name)")
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ]);

  const failed = [sessions, students, memberships].find((result) => result.error);
  if (failed) {
    console.error("[dashboard] Could not read recent activity:", failed.error.code, failed.error.message);
    throw new Error("Could not load recent activity.");
  }

  return mergeActivity([
    ...(sessions.data ?? []).map(attendanceActivity),
    ...(students.data ?? []).map(studentActivity),
    ...(memberships.data ?? []).map((membership) => membershipActivity(membership, PLAN[membership.plan] ?? membership.plan)),
  ]);
}
