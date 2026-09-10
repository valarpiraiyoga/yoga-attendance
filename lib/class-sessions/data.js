import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for reading Class Sessions.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0010_class_sessions.sql); callers must still guard
 * the page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js —
 * this module only reads data, it does not authorize the caller.
 *
 * Deliberately minimal for this slice: no list/pagination/filter function
 * exists yet because no session-list screen (Today's Sessions, All
 * Sessions) is built in this slice — see 04-development-plan.md's Phase 14
 * definition. Only what the materialization helper
 * (lib/class-sessions/actions.js) and a single-session lookup need.
 */

const COLUMNS =
  "id, schedule_id, batch_id, instructor_id, session_date, start_time, end_time, status, note, created_at, updated_at";

/**
 * A single class session by id, or null if it does not exist (or is not
 * visible to the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getClassSession(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("class_sessions")
    .select(COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116: no row matched .single() — not found, not a failure.
    if (error.code === "PGRST116") return null;

    console.error(`[class-sessions] Could not load class session ${id}:`, error.code, error.message);
    throw new Error("Could not load class session.");
  }

  return data;
}

/**
 * The materialized session for one schedule on one date, or null if that
 * occurrence has never been materialized — the lookup half of
 * materialize-on-first-touch (lib/class-sessions/actions.js's
 * `materializeClassSession` calls this before ever inserting, so the
 * `class_sessions_schedule_date_unique` constraint is a backstop against a
 * race, not the primary way duplicates are avoided).
 *
 * @param {string} scheduleId
 * @param {string} sessionDate - "YYYY-MM-DD".
 * @returns {Promise<object|null>}
 */
export async function getMaterializedSession(scheduleId, sessionDate) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("class_sessions")
    .select(COLUMNS)
    .eq("schedule_id", scheduleId)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (error) {
    console.error(
      `[class-sessions] Could not look up session for schedule ${scheduleId} on ${sessionDate}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load class session.");
  }

  return data;
}
