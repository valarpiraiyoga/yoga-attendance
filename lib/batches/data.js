import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for reading Batches.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0005_batches.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS = "id, name, code, category, description, status, created_at";
const DETAIL_COLUMNS =
  "id, name, code, category, description, status, created_at, updated_at";

// PostgREST's `.or()` filter grammar uses "," to separate conditions and
// "()" to group them; escaping them keeps a literal search term literal
// rather than breaking the expression. "%"/"_" are also escaped since they
// are LIKE wildcards. The single-column instructor search never needed this
// (a lone `.ilike()` isn't part of a composite filter string) — matching
// name OR code here is what introduces the requirement.
function escapeForOrFilter(value) {
  return value.replace(/[%_,()]/g, (char) => `\\${char}`);
}

/**
 * Paginated, filterable batch list for the Batches screen.
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against name or code.
 * @param {"all"|"active"|"inactive"} [params.status] - Status filter.
 * @param {number} [params.page] - 1-indexed page number.
 * @param {number} [params.pageSize] - Rows per page.
 * @returns {Promise<{ batches: object[], total: number, page: number, pageSize: number }>}
 */
export async function listBatches({
  q = "",
  status = "all",
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();

  let query = supabase
    .from("batches")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("name", { ascending: true });

  if (q) {
    const term = escapeForOrFilter(q);
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
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
      `[batches] Could not list batches (q=${q}, status=${status}, page=${page}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load batches.");
  }

  return { batches: data, total: count ?? 0, page, pageSize };
}

/**
 * A single batch by id, or null if it does not exist (or is not visible to
 * the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getBatch(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("batches")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116: no row matched .single() — not found, not a failure.
    if (error.code === "PGRST116") return null;

    console.error(`[batches] Could not load batch ${id}:`, error.code, error.message);
    throw new Error("Could not load batch.");
  }

  return data;
}
