import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for reading Students.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0006_students.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS = "id, student_code, full_name, phone, status, created_at";
const DETAIL_COLUMNS =
  "id, student_code, full_name, phone, email, date_of_birth, gender, join_date, photo_url, notes, status, created_at, updated_at";

// PostgREST's `.or()` filter grammar uses "," to separate conditions and
// "()" to group them; escaping them keeps a literal search term literal
// rather than breaking the expression. "%"/"_" are also escaped since they
// are LIKE wildcards. Same rationale as lib/batches/data.js's identical
// helper — duplicated rather than shared because each caller escapes for
// its own `.or()` call, not a common code path.
function escapeForOrFilter(value) {
  return value.replace(/[%_,()]/g, (char) => `\\${char}`);
}

/**
 * Paginated, filterable student list for the Students screen.
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against name or phone.
 * @param {"all"|"active"|"inactive"} [params.status] - Student status filter.
 * @param {string} [params.batchId] - Only students with an active enrollment in this batch.
 * @param {number} [params.page] - 1-indexed page number.
 * @param {number} [params.pageSize] - Rows per page.
 * @returns {Promise<{ students: object[], total: number, page: number, pageSize: number }>}
 */
export async function listStudents({
  q = "",
  status = "all",
  batchId = "",
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();

  // Left-joined (display only) unless a batch filter is active, in which
  // case `!inner` turns the embed into the filter itself — see the `.eq()`
  // calls below. PostgREST still returns one row per student either way,
  // with the matching enrollments nested, not a flattened/duplicated row
  // per match.
  const enrollmentsSelect = batchId
    ? "batch_enrollments!inner(status, batches(code))"
    : "batch_enrollments(status, batches(code))";

  let query = supabase
    .from("students")
    .select(`${LIST_COLUMNS}, ${enrollmentsSelect}`, { count: "exact" })
    .order("full_name", { ascending: true });

  if (q) {
    const term = escapeForOrFilter(q);
    query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (batchId) {
    query = query.eq("batch_enrollments.batch_id", batchId).eq("batch_enrollments.status", "active");
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error(
      `[students] Could not list students (q=${q}, status=${status}, batchId=${batchId}, page=${page}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load students.");
  }

  // The list only ever needs which batches a student is CURRENTLY (active)
  // enrolled in, for the wireframe's "BATCHES" chip column — never the full
  // enrollment history, which belongs to Student Details.
  const students = (data ?? []).map(({ batch_enrollments, ...student }) => ({
    ...student,
    batchCodes: (batch_enrollments ?? [])
      .filter((enrollment) => enrollment.status === "active")
      .map((enrollment) => enrollment.batches?.code)
      .filter(Boolean),
  }));

  return { students, total: count ?? 0, page, pageSize };
}

/**
 * A single student by id, or null if it does not exist (or is not visible
 * to the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getStudent(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("students")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116: no row matched .single() — not found, not a failure.
    if (error.code === "PGRST116") return null;

    console.error(`[students] Could not load student ${id}:`, error.code, error.message);
    throw new Error("Could not load student.");
  }

  return data;
}
