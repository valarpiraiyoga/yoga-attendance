import "server-only";

import { createClient } from "@/lib/supabase/server";
import { listEnrollmentsForStudent } from "@/lib/enrollments/data";
import { deriveMembershipStatusOn, expiringSoonCutoff, membershipToday } from "@/lib/memberships/validity";

/**
 * Data Access Layer for reading Memberships.
 *
 * RLS restricts these queries to admins (see
 * supabase/migrations/0008_memberships.sql); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from lib/auth/dal.js — this
 * module only reads data, it does not authorize the caller.
 */

const DEFAULT_PAGE_SIZE = 20;

const LIST_COLUMNS =
  "id, membership_code, plan, start_date, end_date, amount, payment_status, cancelled_at, students(id, full_name, student_code, photo_url)";
const DETAIL_COLUMNS =
  "id, membership_code, student_id, plan, start_date, end_date, amount, payment_status, cancelled_at, notes, created_at, updated_at, students(id, full_name, phone, phone_country_code, email, student_code, photo_url, status)";

// PostgREST's `.or()` filter grammar uses "," to separate conditions and
// "()" to group them; escaping them keeps a literal search term literal
// rather than breaking the expression. "%"/"_" are also escaped since they
// are LIKE wildcards. Duplicated from lib/students/data.js's identical
// helper — same rationale as that file's own comment: each caller escapes
// for its own `.or()` call, not a common code path.
function escapeForOrFilter(value) {
  return value.replace(/[%_,()]/g, (char) => `\\${char}`);
}

/**
 * The single "today" every membership date comparison and days-left reading
 * uses: the centre's calendar date (Asia/Kolkata), not the server's UTC date
 * (01-product.md §5). It is the same canonical helper Attendance uses.
 */
export function todayDateString() {
  return membershipToday();
}

// Sort keys the Memberships list may request (`?sort=`). A whitelist, never a
// raw column name from the URL; an unknown key falls back to the default.
// "start-newest" is the pre-existing order, so a request with no `sort`
// behaves exactly as before.
export const DEFAULT_MEMBERSHIP_SORT = "start-newest";
export const MEMBERSHIP_SORTS = {
  "start-newest": { column: "start_date", ascending: false },
  "start-oldest": { column: "start_date", ascending: true },
};

/**
 * Derives Upcoming/Active/Expired/Cancelled from stored facts
 * (01-product.md §12) — never stored, so a membership can't silently stay
 * "Active" after its end date passes. Cancellation overrides any
 * date-derived status. The rule itself lives in `deriveMembershipStatusOn`
 * (lib/memberships/validity.js); this evaluates it on the centre's date
 * unless a day is given.
 *
 * @param {{ start_date: string, end_date: string, cancelled_at: string|null }} membership
 * @param {string} [today] - "YYYY-MM-DD"; defaults to the centre's today.
 * @returns {"cancelled"|"upcoming"|"active"|"expired"}
 */
export function deriveMembershipStatus(membership, today = todayDateString()) {
  return deriveMembershipStatusOn(membership, today);
}

/**
 * Student ids matching a name search — used to fold "search by student
 * name" into the Memberships list's own `.or()` filter (student_id.in.(…))
 * rather than attempting an embedded-table ilike inside `.or()`, which
 * PostgREST's grammar does not reliably support across a join.
 */
async function findStudentIdsByName(supabase, term) {
  const { data, error } = await supabase
    .from("students")
    .select("id")
    .ilike("full_name", `%${term}%`);

  if (error) {
    console.error("[memberships] Could not search students by name:", error.code, error.message);
    return [];
  }

  return (data ?? []).map((row) => row.id);
}

/**
 * Student ids that have at least one non-cancelled, currently-active
 * membership, or at least one membership record at all — used to implement
 * the Membership Status filter's Active/Expired/None distinction
 * (01-product.md §12; 02-ux.md "Memberships list filters"). This can't be
 * expressed as a single embedded-resource filter: "Expired" specifically
 * means "has a record but none of them are currently active", which
 * requires knowing about the student's other membership rows, not just the
 * one being filtered — an `!inner` embed filter only tests one row at a
 * time and cannot express that exclusion.
 */
async function partitionStudentsByMembershipStatus(supabase) {
  const today = todayDateString();

  const { data, error } = await supabase.from("memberships").select("student_id, cancelled_at, start_date, end_date");

  if (error) {
    console.error("[memberships] Could not read memberships for status filtering:", error.code, error.message);
    return { activeIds: [], anyIds: [] };
  }

  const activeIds = new Set();
  const anyIds = new Set();
  for (const row of data ?? []) {
    anyIds.add(row.student_id);
    if (!row.cancelled_at && row.start_date <= today && today <= row.end_date) {
      activeIds.add(row.student_id);
    }
  }

  return { activeIds: [...activeIds], anyIds: [...anyIds] };
}

/**
 * Paginated, filterable membership list for the Memberships screen
 * (wireframe: Memberships list).
 *
 * @param {object} [params]
 * @param {string} [params.q] - Case-insensitive match against student name or membership code.
 * @param {"all"|"monthly"|"quarterly"|"custom"} [params.plan]
 * @param {"all"|"paid"|"pending"} [params.paymentStatus]
 * @param {"all"|"upcoming"|"active"|"expired"|"cancelled"} [params.membershipStatus]
 * @param {string} [params.fromDate] - Start Date on or after this date (02-ux.md "Memberships list filters").
 * @param {string} [params.toDate] - Start Date on or before this date.
 * @param {keyof typeof MEMBERSHIP_SORTS} [params.sort] - Sort key; unknown keys use the default.
 * @param {number} [params.page]
 * @param {number} [params.pageSize]
 * @returns {Promise<{ memberships: object[], total: number, page: number, pageSize: number }>}
 */
export async function listMemberships({
  q = "",
  plan = "all",
  paymentStatus = "all",
  membershipStatus = "all",
  fromDate = "",
  toDate = "",
  sort = DEFAULT_MEMBERSHIP_SORT,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const supabase = await createClient();
  const sortSpec = MEMBERSHIP_SORTS[sort] ?? MEMBERSHIP_SORTS[DEFAULT_MEMBERSHIP_SORT];

  let query = supabase
    .from("memberships")
    .select(LIST_COLUMNS, { count: "exact" })
    .order(sortSpec.column, { ascending: sortSpec.ascending })
    // Stable tie-break so pagination never repeats or skips a row when
    // several memberships share a start date.
    .order("membership_code", { ascending: true });

  if (q) {
    const term = escapeForOrFilter(q);
    const studentIds = await findStudentIdsByName(supabase, term);
    const orParts = [`membership_code.ilike.%${term}%`];
    if (studentIds.length > 0) {
      orParts.push(`student_id.in.(${studentIds.join(",")})`);
    }
    query = query.or(orParts.join(","));
  }

  if (plan !== "all") {
    query = query.eq("plan", plan);
  }

  if (paymentStatus !== "all") {
    query = query.eq("payment_status", paymentStatus);
  }

  if (fromDate) {
    query = query.gte("start_date", fromDate);
  }

  if (toDate) {
    query = query.lte("start_date", toDate);
  }

  // Date-derived status can't be a plain column filter — see
  // partitionStudentsByMembershipStatus's comment.
  if (membershipStatus === "cancelled") {
    query = query.not("cancelled_at", "is", null);
  } else if (membershipStatus === "upcoming") {
    const today = todayDateString();
    query = query.is("cancelled_at", null).gt("start_date", today);
  } else if (membershipStatus === "active") {
    const today = todayDateString();
    query = query.is("cancelled_at", null).lte("start_date", today).gte("end_date", today);
  } else if (membershipStatus === "expired") {
    const today = todayDateString();
    query = query.is("cancelled_at", null).lt("end_date", today);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error(
      `[memberships] Could not list memberships (q=${q}, plan=${plan}, paymentStatus=${paymentStatus}, membershipStatus=${membershipStatus}):`,
      error.code,
      error.message
    );
    throw new Error("Could not load memberships.");
  }

  const memberships = (data ?? []).map((membership) => ({
    ...membership,
    status: deriveMembershipStatus(membership),
  }));

  return { memberships, total: count ?? 0, page, pageSize };
}

/**
 * The four Memberships-list summary counts — Total, Active, Expiring Soon,
 * Expired — for the KPI strip. Center-wide (independent of the list's
 * search/filters). Each is a `head: true` count (no rows transferred) using
 * the same date rules as `listMemberships`' status filter, so a tile and the
 * list it summarises always agree. "Expiring Soon" is an Active membership
 * with `EXPIRING_SOON_DAYS` or fewer days left (`lib/memberships/validity.js`).
 * Upcoming and Cancelled count toward Total only.
 *
 * @returns {Promise<{ total: number, active: number, expiringSoon: number, expired: number }>}
 */
export async function getMembershipSummaryCounts() {
  const supabase = await createClient();
  const today = todayDateString();
  const cutoff = expiringSoonCutoff(today);

  const count = () => supabase.from("memberships").select("id", { count: "exact", head: true });
  const active = () => count().is("cancelled_at", null).lte("start_date", today).gte("end_date", today);

  const [total, activeResult, expiringSoon, expired] = await Promise.all([
    count(),
    active(),
    active().lte("end_date", cutoff),
    count().is("cancelled_at", null).lt("end_date", today),
  ]);

  const failed = [total, activeResult, expiringSoon, expired].find((result) => result.error);
  if (failed) {
    console.error("[memberships] Could not count memberships:", failed.error.code, failed.error.message);
    throw new Error("Could not load memberships.");
  }

  return {
    total: total.count ?? 0,
    active: activeResult.count ?? 0,
    expiringSoon: expiringSoon.count ?? 0,
    expired: expired.count ?? 0,
  };
}

/**
 * A single membership by id, or null if it does not exist (or is not
 * visible to the caller under RLS).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getMembership(id) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("memberships")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116: no row matched .single() — not found, not a failure.
    if (error.code === "PGRST116") return null;

    console.error(`[memberships] Could not load membership ${id}:`, error.code, error.message);
    throw new Error("Could not load membership.");
  }

  return { ...data, status: deriveMembershipStatus(data) };
}

/**
 * All memberships for one student — active and historical/cancelled alike,
 * most recently started first. Used by Student Details' Membership panel
 * (to find the current one) and Membership Details' "Membership History"
 * (01-product.md §5: renewal creates a new record, the previous one remains
 * available).
 *
 * @param {string} studentId
 * @returns {Promise<object[]>}
 */
export async function listMembershipsForStudent(studentId) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("memberships")
    .select("id, membership_code, plan, start_date, end_date, amount, payment_status, cancelled_at")
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });

  if (error) {
    console.error(
      `[memberships] Could not list memberships for student ${studentId}:`,
      error.code,
      error.message
    );
    throw new Error("Could not load memberships.");
  }

  return (data ?? []).map((membership) => ({
    ...membership,
    status: deriveMembershipStatus(membership),
  }));
}

/**
 * The student's current membership — preferring an active one, then an
 * upcoming one, else the most recently started of any status — or null if
 * the student has no membership record at all. Powers Student Details'
 * Membership panel, which shows exactly one card (wireframe), never
 * fabricated data.
 *
 * @param {string} studentId
 * @returns {Promise<object|null>}
 */
export async function getCurrentMembershipForStudent(studentId) {
  const memberships = await listMembershipsForStudent(studentId);
  if (memberships.length === 0) return null;

  return (
    memberships.find((membership) => membership.status === "active") ??
    memberships.find((membership) => membership.status === "upcoming") ??
    memberships[0]
  );
}

/**
 * The student's batch enrollments whose effective period overlaps the given
 * membership's period (01-product.md §12: "Covered batch enrollments are
 * derived from enrollment effective dates that overlap the membership
 * period, not stored directly") — Membership Details' "Covered Batch
 * Enrollments" panel. Reuses lib/enrollments/data.js rather than querying
 * batch_enrollments directly; there is no membership↔enrollment link table.
 * An enrollment with no end date is treated as open-ended (still ongoing),
 * so it overlaps any membership period that starts before "today or later".
 *
 * @param {{ student_id: string, start_date: string, end_date: string }} membership
 * @returns {Promise<object[]>}
 */
export async function listCoveredEnrollments(membership) {
  const enrollments = await listEnrollmentsForStudent(membership.student_id);

  return enrollments.filter((enrollment) => {
    const enrollmentEnd = enrollment.effective_end_date ?? "9999-12-31";
    return enrollment.effective_start_date <= membership.end_date && enrollmentEnd >= membership.start_date;
  });
}

/**
 * Student ids to include/exclude for the Students list's Membership filter
 * (Active/Expired/None — 01-product.md §12; 02-ux.md "Memberships list
 * filters"). Returns null when no restriction applies (filter is "all").
 *
 * @param {"active"|"expired"|"none"} filter
 * @returns {Promise<string[]|null>} ids the Students query should restrict to (or exclude, for "none" — see lib/students/data.js's usage).
 */
export async function getStudentIdsForMembershipFilter(filter) {
  const supabase = await createClient();
  const { activeIds, anyIds } = await partitionStudentsByMembershipStatus(supabase);

  if (filter === "active") return activeIds;
  if (filter === "expired") {
    const activeSet = new Set(activeIds);
    return anyIds.filter((id) => !activeSet.has(id));
  }
  if (filter === "none") return anyIds; // caller excludes these ids.
  return null;
}
