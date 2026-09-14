import "server-only";

import { createClient } from "@/lib/supabase/server";
import { deriveMembershipStatus, getStudentIdsForMembershipFilter } from "@/lib/memberships/data";

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
 * Collapses a student's membership records into the Students list's coarse
 * three-state summary (02-ux.md "Memberships list filters": "The Membership
 * filter (here and on the Students list) distinguishes three states:
 * Active, Expired, and None... Expired is not equivalent to None") — a
 * simpler partition than Membership's own four-state Upcoming/Active/
 * Expired/Cancelled, deliberately: this column only needs to answer "is
 * this student currently covered".
 *
 * @param {{ start_date: string, end_date: string, cancelled_at: string|null }[]} memberships
 * @returns {"active"|"expired"|"none"}
 */
function deriveStudentMembershipSummary(memberships) {
  if (!memberships || memberships.length === 0) return "none";
  const hasActive = memberships.some((membership) => deriveMembershipStatus(membership) === "active");
  return hasActive ? "active" : "expired";
}

/**
 * Same preference as `getCurrentMembershipForStudent`: active → upcoming →
 * most recently available row. Used only so the Students card menu can link
 * "View Membership" without a per-row round trip.
 */
function pickCurrentMembershipId(memberships) {
  if (!memberships || memberships.length === 0) return null;

  const ranked = memberships.map((membership) => ({
    id: membership.id,
    status: deriveMembershipStatus(membership),
  }));

  return (
    ranked.find((membership) => membership.status === "active")?.id ??
    ranked.find((membership) => membership.status === "upcoming")?.id ??
    ranked[0]?.id ??
    null
  );
}

/**
 * Paginated, filterable student list for the Students screen.
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against name or phone.
 * @param {"all"|"active"|"inactive"} [params.status] - Student status filter.
 * @param {string} [params.batchId] - Only students with an active enrollment in this batch.
 * @param {"all"|"active"|"expired"|"none"} [params.membershipFilter] - Students list Membership filter.
 * @param {number} [params.page] - 1-indexed page number.
 * @param {number} [params.pageSize] - Rows per page.
 * @returns {Promise<{ students: object[], total: number, page: number, pageSize: number }>}
 */
export async function listStudents({
  q = "",
  status = "all",
  batchId = "",
  membershipFilter = "all",
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
    ? "batch_enrollments!inner(id, status, batches(code))"
    : "batch_enrollments(id, status, batches(code))";

  let query = supabase
    .from("students")
    .select(`${LIST_COLUMNS}, ${enrollmentsSelect}, memberships(id, start_date, end_date, cancelled_at)`, {
      count: "exact",
    })
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

  // "Active"/"Expired"/"None" can't be expressed as a plain column filter or
  // an embedded-resource filter — see
  // lib/memberships/data.js's partitionStudentsByMembershipStatus comment
  // for why "Expired" in particular needs to know about a student's *other*
  // membership rows, not just the one row an embedded filter would test.
  let noResultsForMembershipFilter = false;
  if (membershipFilter === "active" || membershipFilter === "expired") {
    const ids = await getStudentIdsForMembershipFilter(membershipFilter);
    if (ids.length === 0) {
      noResultsForMembershipFilter = true;
    } else {
      query = query.in("id", ids);
    }
  } else if (membershipFilter === "none") {
    const idsWithMemberships = await getStudentIdsForMembershipFilter("none");
    if (idsWithMemberships.length > 0) {
      query = query.not("id", "in", `(${idsWithMemberships.join(",")})`);
    }
  }

  if (noResultsForMembershipFilter) {
    return { students: [], total: 0, page, pageSize };
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error(
      `[students] Could not list students (q=${q}, status=${status}, batchId=${batchId}, membershipFilter=${membershipFilter}, page=${page}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load students.");
  }

  // The list only ever needs which batches a student is CURRENTLY (active)
  // enrolled in, for the wireframe's "BATCHES" chip column — never the full
  // enrollment history, which belongs to Student Details.
  const students = (data ?? []).map(({ batch_enrollments, memberships, ...student }) => {
    const activeEnrollments = (batch_enrollments ?? []).filter((enrollment) => enrollment.status === "active");

    return {
      ...student,
      batchCodes: activeEnrollments.map((enrollment) => enrollment.batches?.code).filter(Boolean),
      membershipSummary: deriveStudentMembershipSummary(memberships),
      currentMembershipId: pickCurrentMembershipId(memberships),
      primaryEnrollmentId: activeEnrollments[0]?.id ?? null,
    };
  });

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

/**
 * Every active student's id/name/phone/code, for populating a student
 * picker — the standalone Add Membership flow's Select Student step
 * (Phase 12). Active only, mirroring lib/batches/data.js's
 * `listBatchOptions()` — adding a new membership to an already-inactive
 * student isn't a documented use case. Deliberately not paginated, same
 * reasoning as `listBatchOptions()`: a picker needs the full option list.
 *
 * @returns {Promise<{ id: string, student_code: string, full_name: string, phone: string }[]>}
 */
export async function listStudentOptions() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("students")
    .select("id, student_code, full_name, phone")
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (error) {
    console.error("[students] Could not list student options:", error.code, error.message);
    throw new Error("Could not load students.");
  }

  return data ?? [];
}

/**
 * The count of active students — the Admin Dashboard's "Active student
 * summary" (`01-product.md` §3; wireframe p.8 "ACTIVE STUDENTS").
 *
 * `head: true` returns only the count, not the matching rows — a page that
 * needs a single number should not transfer every active student's columns
 * to compute it (Reports' own `report_session_facts` design principle
 * applies here too: read only what the screen shows).
 *
 * @returns {Promise<number>}
 */
export async function getActiveStudentCount() {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  if (error) {
    console.error("[students] Could not count active students:", error.code, error.message);
    throw new Error("Could not load students.");
  }

  return count ?? 0;
}
