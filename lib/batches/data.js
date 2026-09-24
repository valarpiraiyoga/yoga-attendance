import "server-only";

import { createClient } from "@/lib/supabase/server";
import { batchToday, currentSchedulesOf, deriveBatchDisplayStatus } from "@/lib/batches/summary";

/**
 * Data Access Layer for reading Batches.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0005_batches.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS = "id, name, code, category, description, status, batch_color, batch_image_url, created_at";
const DETAIL_COLUMNS =
  "id, name, code, category, description, status, batch_color, batch_image_url, created_at, updated_at";

// Sort keys the Batches list may request (`?sort=`). A whitelist, never a
// raw column name from the URL; an unknown key falls back to the default.
// "name-asc" is the pre-existing order, so a request with no `sort` behaves
// exactly as before. (A batch has no start time of its own — times belong
// to its schedules — so there is no time sort.)
export const DEFAULT_BATCH_SORT = "name-asc";
export const BATCH_SORTS = {
  "name-asc": { column: "name", ascending: true },
  "name-desc": { column: "name", ascending: false },
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
};

// What the derived display status needs from a schedule row (any status)...
const SCHEDULE_STATUS_COLUMNS = "batch_id, status, effective_from, effective_until";
// ...and what a row's Days / Time / Instructor lines need on top of that.
const SCHEDULE_ROW_COLUMNS =
  "batch_id, series_id, id, status, day_of_week, start_time, end_time, effective_from, effective_until, instructors(id, full_name, photo_url)";

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
 * Display status (Active / Upcoming / Completed / Inactive) of EVERY batch,
 * derived from each batch's schedules — see `deriveBatchDisplayStatus`.
 * Two light reads (batches, schedules), grouped in JS. Powers the KPI
 * counts and the Status filter, both of which need the derived status of
 * batches that are not on the current page.
 *
 * @returns {Promise<Map<string, "active"|"upcoming"|"completed"|"inactive">>}
 */
async function getBatchDisplayStatusMap(supabase) {
  const today = batchToday();

  const [batchesResult, schedulesResult] = await Promise.all([
    supabase.from("batches").select("id, status"),
    supabase.from("schedules").select(SCHEDULE_STATUS_COLUMNS),
  ]);

  const failed = [batchesResult, schedulesResult].find((result) => result.error);
  if (failed) {
    console.error("[batches] Could not read batch statuses:", failed.error.code, failed.error.message);
    throw new Error("Could not load batches.");
  }

  const schedulesByBatch = new Map();
  for (const row of schedulesResult.data ?? []) {
    if (!schedulesByBatch.has(row.batch_id)) schedulesByBatch.set(row.batch_id, []);
    schedulesByBatch.get(row.batch_id).push(row);
  }

  const statuses = new Map();
  for (const batch of batchesResult.data ?? []) {
    statuses.set(batch.id, deriveBatchDisplayStatus(batch.status, schedulesByBatch.get(batch.id), today));
  }
  return statuses;
}

/**
 * The Batches-list KPI counts — Total, Active, Upcoming, Completed (and
 * Inactive, for completeness). Center-wide, independent of the list's
 * search/filters, and counted from the same derived statuses as the badge
 * and the Status filter so a tile and its list always agree.
 *
 * @returns {Promise<{ total: number, active: number, upcoming: number, completed: number, inactive: number }>}
 */
export async function getBatchSummaryCounts() {
  const supabase = await createClient();
  const statuses = await getBatchDisplayStatusMap(supabase);

  const counts = { total: statuses.size, active: 0, upcoming: 0, completed: 0, inactive: 0 };
  for (const status of statuses.values()) counts[status] += 1;
  return counts;
}

/**
 * Paginated, filterable batch list for the Batches screen.
 *
 * Each returned batch also carries what a card/row shows and the batch
 * itself does not store: its derived `displayStatus`, its
 * `currentSchedules` (for Days / Time / Instructor) and its `studentCount`
 * (active enrollments — the same definition Batch Details uses). Those come
 * from two batched reads for the page's batches, never per row.
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against name or code.
 * @param {"all"|"active"|"upcoming"|"completed"|"inactive"} [params.status] - Display-status filter.
 * @param {keyof typeof BATCH_SORTS} [params.sort] - Sort key; unknown keys use the default.
 * @param {number} [params.page] - 1-indexed page number.
 * @param {number} [params.pageSize] - Rows per page.
 * @returns {Promise<{ batches: object[], total: number, page: number, pageSize: number }>}
 */
export async function listBatches({
  q = "",
  status = "all",
  sort = DEFAULT_BATCH_SORT,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();
  const today = batchToday();
  const sortSpec = BATCH_SORTS[sort] ?? BATCH_SORTS[DEFAULT_BATCH_SORT];

  let query = supabase
    .from("batches")
    .select(LIST_COLUMNS, { count: "exact" })
    .order(sortSpec.column, { ascending: sortSpec.ascending });

  // Stable tie-break so pagination never repeats or skips a row when the
  // primary sort column has equal values.
  if (sortSpec.column !== "name") {
    query = query.order("name", { ascending: true });
  }

  if (q) {
    const term = escapeForOrFilter(q);
    query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  }

  // The status shown is derived from schedules, so filtering by it can't be
  // a plain column filter — resolve the matching ids first, like the
  // Students list's membership filter.
  if (status !== "all") {
    const statuses = await getBatchDisplayStatusMap(supabase);
    const matchingIds = [...statuses].filter(([, value]) => value === status).map(([id]) => id);
    if (matchingIds.length === 0) return { batches: [], total: 0, page, pageSize };
    query = query.in("id", matchingIds);
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

  const rows = data ?? [];
  const pageIds = rows.map((batch) => batch.id);

  const schedulesByBatch = new Map();
  const studentCounts = new Map();
  if (pageIds.length > 0) {
    const [schedulesResult, enrollmentsResult] = await Promise.all([
      supabase.from("schedules").select(SCHEDULE_ROW_COLUMNS).in("batch_id", pageIds),
      supabase.from("batch_enrollments").select("batch_id").in("batch_id", pageIds).eq("status", "active"),
    ]);

    if (schedulesResult.error) {
      console.error("[batches] Could not read batch schedules:", schedulesResult.error.code, schedulesResult.error.message);
      throw new Error("Could not load batches.");
    }
    if (enrollmentsResult.error) {
      console.error("[batches] Could not count batch students:", enrollmentsResult.error.code, enrollmentsResult.error.message);
      throw new Error("Could not load batches.");
    }

    for (const row of schedulesResult.data ?? []) {
      if (!schedulesByBatch.has(row.batch_id)) schedulesByBatch.set(row.batch_id, []);
      schedulesByBatch.get(row.batch_id).push(row);
    }
    for (const row of enrollmentsResult.data ?? []) {
      studentCounts.set(row.batch_id, (studentCounts.get(row.batch_id) ?? 0) + 1);
    }
  }

  return {
    batches: rows.map((batch) => {
      const schedules = schedulesByBatch.get(batch.id) ?? [];
      return {
        ...batch,
        displayStatus: deriveBatchDisplayStatus(batch.status, schedules, today),
        currentSchedules: currentSchedulesOf(schedules, today),
        studentCount: studentCounts.get(batch.id) ?? 0,
      };
    }),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/**
 * Every active batch's id/name/code, for populating a batch picker — the
 * Students list's Batch filter and the Add/Edit Enrollment form's batch
 * select (Phase 11). Deliberately not paginated: a picker needs the full
 * option list, and this project's batch counts are small (§6's initial data
 * lists seven).
 *
 * @returns {Promise<{ id: string, name: string, code: string, batch_color: string, batch_image_url: string|null }[]>}
 */
export async function listBatchOptions() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("batches")
    .select("id, name, code, batch_color, batch_image_url")
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
