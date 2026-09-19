import "server-only";

import { createClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/schedules/validation";

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

  const batches = data ?? [];
  const scheduleCountByBatchId = await countCurrentWeeklySchedulesByBatchIds(
    supabase,
    batches.map((batch) => batch.id)
  );

  return {
    batches: batches.map((batch) => ({
      ...batch,
      scheduleCount: scheduleCountByBatchId.get(batch.id) ?? 0,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/**
 * Current weekly schedule counts for the given batch ids — same definition
 * as `listCurrentSchedules` (active + currently in effective period),
 * counted once per schedule series so version history does not inflate the
 * card total.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} batchIds
 * @returns {Promise<Map<string, number>>}
 */
async function countCurrentWeeklySchedulesByBatchIds(supabase, batchIds) {
  const counts = new Map();
  if (batchIds.length === 0) return counts;

  const today = todayDateString();
  const { data, error } = await supabase
    .from("schedules")
    .select("batch_id, series_id, id")
    .in("batch_id", batchIds)
    .eq("status", "active")
    .lte("effective_from", today)
    .or(`effective_until.is.null,effective_until.gte.${today}`);

  if (error) {
    console.error("[batches] Could not count weekly schedules:", error.code, error.message);
    return counts;
  }

  const seriesSeenByBatch = new Map();
  for (const row of data ?? []) {
    const key = row.series_id || row.id;
    if (!seriesSeenByBatch.has(row.batch_id)) {
      seriesSeenByBatch.set(row.batch_id, new Set());
    }
    seriesSeenByBatch.get(row.batch_id).add(key);
  }

  for (const [batchId, seriesIds] of seriesSeenByBatch) {
    counts.set(batchId, seriesIds.size);
  }

  return counts;
}

/**
 * Every active batch's id/name/code, for populating a batch picker — the
 * Students list's Batch filter and the Add/Edit Enrollment form's batch
 * select (Phase 11). Deliberately not paginated: a picker needs the full
 * option list, and this project's batch counts are small (§6's initial data
 * lists seven).
 *
 * @returns {Promise<{ id: string, name: string, code: string }[]>}
 */
export async function listBatchOptions() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("batches")
    .select("id, name, code")
    .eq("status", "active")
    .order("name", { ascending: true });

  if (error) {
    console.error("[batches] Could not list batch options:", error.code, error.message);
    throw new Error("Could not load batches.");
  }

  return data ?? [];
}

/**
 * The count of active batches — the Admin Dashboard's "Active batch
 * summary" (`01-product.md` §3; wireframe p.8 "ACTIVE BATCHES").
 *
 * `head: true` returns only the count, not the matching rows.
 *
 * @returns {Promise<number>}
 */
export async function getActiveBatchCount() {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("batches")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  if (error) {
    console.error("[batches] Could not count active batches:", error.code, error.message);
    throw new Error("Could not load batches.");
  }

  return count ?? 0;
}

/**
 * The count of all batches, active and inactive — the Students list's
 * "Total Batches" summary tile. Same `head: true` count as
 * `getActiveBatchCount`, without the status filter.
 *
 * @returns {Promise<number>}
 */
export async function getTotalBatchCount() {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("batches")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[batches] Could not count batches:", error.code, error.message);
    throw new Error("Could not load batches.");
  }

  return count ?? 0;
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
