import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for reading Instructors (Settings → Instructors).
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0002_instructors.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS = "id, full_name, phone, email, status, created_at";
// Sort keys the Instructor list may request (`?sort=`). A whitelist, never a
// raw column name from the URL: an unknown key falls back to the default, so
// user input can't choose an arbitrary column. "name-asc" is the pre-existing
// order, so a request with no `sort` behaves exactly as before.
export const DEFAULT_INSTRUCTOR_SORT = "name-asc";
export const INSTRUCTOR_SORTS = {
  "name-asc": { column: "full_name", ascending: true },
  "name-desc": { column: "full_name", ascending: false },
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
};

const DETAIL_COLUMNS =
  "id, full_name, phone, email, status, user_id, created_at, updated_at";

/**
 * Paginated, filterable instructor list for the Settings → Instructors screen.
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive full-name search.
 * @param {"all"|"active"|"inactive"} [params.status] - Status filter.
 * @param {keyof typeof INSTRUCTOR_SORTS} [params.sort] - Sort key; unknown keys use the default.
 * @param {number} [params.page] - 1-indexed page number.
 * @param {number} [params.pageSize] - Rows per page.
 * @returns {Promise<{ instructors: object[], total: number, page: number, pageSize: number }>}
 */
export async function listInstructors({
  q = "",
  status = "all",
  sort = DEFAULT_INSTRUCTOR_SORT,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();
  const sortSpec = INSTRUCTOR_SORTS[sort] ?? INSTRUCTOR_SORTS[DEFAULT_INSTRUCTOR_SORT];

  let query = supabase
    .from("instructors")
    .select(LIST_COLUMNS, { count: "exact" })
    .order(sortSpec.column, { ascending: sortSpec.ascending });

  // Tie-break so equal primary values (e.g. two instructors sharing a
  // created_at) never repeat or vanish across pages.
  if (sortSpec.column !== "full_name") {
    query = query.order("full_name", { ascending: true });
  }

  if (q) {
    query = query.ilike("full_name", `%${q}%`);
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
      `[instructors] Could not list instructors (q=${q}, status=${status}, page=${page}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load instructors.");
  }

  return { instructors: data, total: count ?? 0, page, pageSize };
}

/**
 * A single instructor by id, or null if it does not exist (or is not
 * visible to the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getInstructor(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instructors")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116: no row matched .single() — not found, not a failure.
    if (error.code === "PGRST116") return null;

    console.error(`[instructors] Could not load instructor ${id}:`, error.code, error.message);
    throw new Error("Could not load instructor.");
  }

  return data;
}

/**
 * Every active instructor's id/name, for populating an instructor picker —
 * the Schedule form's instructor select and the Schedule list's Instructor
 * filter (Phase 13). Active only, deliberately not paginated — same
 * reasoning as lib/batches/data.js's `listBatchOptions()`.
 *
 * @returns {Promise<{ id: string, full_name: string }[]>}
 */
export async function listInstructorOptions() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instructors")
    .select("id, full_name")
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[instructors] Could not list instructor options:", error.code, error.message);
    throw new Error("Could not load instructors.");
  }

  return data ?? [];
}
