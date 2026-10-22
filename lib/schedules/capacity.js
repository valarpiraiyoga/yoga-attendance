/**
 * Schedule capacity - the application's reading of how full each recurring class (schedule series) is (V1 Final Improvements,
 * S2; 01-product.md §7 "Schedule Capacity"). The pure rule and the read are here; `lib/schedules/capacity-data.js` is the
 * server-only wrapper that supplies the Supabase client, the Admin check and the centre's date. No Next.js, no React, so it is
 * testable without a server.
 *
 * The rule is the database's own (supabase/migrations/0060_schedule_capacity.sql, `schedule_series_occupied_places`) and must
 * stay identical to it: a schedule assignment TAKES A PLACE in its series when the assignment has no end date or ends on
 * or after the centre's today, AND its enrollment is "active" with no end date or ending on or after today. A future-dated
 * assignment already takes its place; the start dates play no part. The student's own status, memberships, payments and
 * attendance play no part. An enrollment with several assignments takes one place in each of their series. A series' capacity is
 * a whole number from 1 to MAX_SCHEDULE_CAPACITY, or null for unlimited.
 *
 * What this returns is a guide for the screens: the database's checks decide whether a write is accepted.
 */

/** The largest capacity a schedule series may have - the upper bound of `schedule_series_capacity_valid` (0060). */
export const MAX_SCHEDULE_CAPACITY = 1000;

/** Rows read per request when counting places taken (PostgREST caps a single response). */
export const OCCUPANCY_PAGE_SIZE = 1000;

// No end date, or ending on or after today.
const isCurrent = (endDate, today) => !endDate || endDate >= today;

/**
 * True when the assignment takes a place in its series on `today`.
 *
 * @param {{ effective_end_date?: string|null, enrollment?: { status: string, effective_end_date?: string|null }|null }} assignment
 * @param {string} today - "YYYY-MM-DD", the centre's date (`getCentreToday()`), never the UTC date.
 * @returns {boolean}
 */
export function isOccupyingAssignment(assignment, today) {
  const enrollment = assignment?.enrollment;
  if (!enrollment || enrollment.status !== "active") return false;
  return isCurrent(assignment.effective_end_date, today) && isCurrent(enrollment.effective_end_date, today);
}

/**
 * Places taken per series on `today`: one per assignment that takes a place.
 *
 * @param {{ schedule_series_id: string }[]} assignments - with `enrollment` as for `isOccupyingAssignment`.
 * @param {string} today
 * @returns {Map<string, number>}
 */
export function countOccupiedPlacesBySeries(assignments, today) {
  const occupied = new Map();
  for (const assignment of assignments ?? []) {
    if (!isOccupyingAssignment(assignment, today)) continue;
    occupied.set(assignment.schedule_series_id, (occupied.get(assignment.schedule_series_id) ?? 0) + 1);
  }
  return occupied;
}

/**
 * A series' capacity reading for the screens.
 *
 * Unlimited (capacity null): never full, no number of places left, labelled with the places taken alone ("10"). Limited:
 * "10 / 12", full once the places taken reach the capacity. Over its capacity (only possible if the database checks were
 * bypassed) it still reads as full and never as a negative number of places left.
 *
 * @param {number|null|undefined} capacity - `schedule_series.capacity`.
 * @param {number} occupied - the places taken.
 * @returns {{ capacity: number|null, occupied: number, isUnlimited: boolean, available: number|null, isFull: boolean, label: string }}
 */
export function scheduleCapacity(capacity, occupied) {
  const taken = Math.max(0, Number(occupied) || 0);

  if (capacity === null || capacity === undefined) {
    return { capacity: null, occupied: taken, isUnlimited: true, available: null, isFull: false, label: String(taken) };
  }

  return {
    capacity,
    occupied: taken,
    isUnlimited: false,
    available: Math.max(0, capacity - taken),
    isFull: taken >= capacity,
    label: `${taken} / ${capacity}`,
  };
}

// ---- the read ------------------------------------------------------------------------------------------------------------

// The assignment, and its enrollment's status and end date. `!inner` keeps only assignments whose enrollment matches the filter.
const ASSIGNMENT_COLUMNS = "schedule_series_id, effective_end_date, batch_enrollments!inner(status, effective_end_date)";

/**
 * The assignments of these series that can take a place on `today` - not ended before today, of an active enrollment - read in
 * pages, so a large series is never cut off at the response cap. The enrollment's end date is judged by `isOccupyingAssignment`,
 * the one rule, when they are counted.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} seriesIds
 * @param {string} today - "YYYY-MM-DD", the centre's date.
 * @param {number} [pageSize]
 * @returns {Promise<{ schedule_series_id: string, effective_end_date: string|null, enrollment: { status: string, effective_end_date: string|null }|null }[]>}
 */
export async function fetchSeriesAssignments(supabase, seriesIds, today, pageSize = OCCUPANCY_PAGE_SIZE) {
  const assignments = [];
  if (seriesIds.length === 0) return assignments;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("enrollment_schedules")
      .select(ASSIGNMENT_COLUMNS)
      .in("schedule_series_id", seriesIds)
      .or(`effective_end_date.is.null,effective_end_date.gte.${today}`)
      .eq("batch_enrollments.status", "active")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[schedules] Could not count schedule places:", error.code, error.message);
      throw new Error("Could not load schedule capacity.");
    }

    for (const row of data ?? []) {
      const enrollment = Array.isArray(row.batch_enrollments) ? row.batch_enrollments[0] : row.batch_enrollments;
      assignments.push({ schedule_series_id: row.schedule_series_id, effective_end_date: row.effective_end_date, enrollment: enrollment ?? null });
    }
    if ((data ?? []).length < pageSize) break;
  }

  return assignments;
}

/**
 * Each series' capacity reading on `today`: its `capacity` and the places taken, as `scheduleCapacity(...)`. A series that does
 * not exist (or is not visible) is left out. Read-only.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} seriesIds
 * @param {string} today - "YYYY-MM-DD", the centre's date.
 * @param {number} [pageSize]
 * @returns {Promise<Map<string, ReturnType<typeof scheduleCapacity>>>}
 */
export async function fetchScheduleCapacities(supabase, seriesIds, today, pageSize = OCCUPANCY_PAGE_SIZE) {
  const ids = [...new Set((seriesIds ?? []).filter(Boolean))];
  const capacities = new Map();
  if (ids.length === 0) return capacities;

  const { data, error } = await supabase.from("schedule_series").select("id, capacity").in("id", ids);
  if (error) {
    console.error("[schedules] Could not read schedule capacities:", error.code, error.message);
    throw new Error("Could not load schedule capacity.");
  }

  const occupied = countOccupiedPlacesBySeries(await fetchSeriesAssignments(supabase, ids, today, pageSize), today);
  for (const series of data ?? []) {
    capacities.set(series.id, scheduleCapacity(series.capacity, occupied.get(series.id) ?? 0));
  }
  return capacities;
}

/**
 * How a schedule's places read on a screen (schedule list, weekly grid, Batch Details): "Unlimited", or "10 / 20" with a Full flag
 * once the places taken reach the capacity. `places` is `scheduleCapacity(...)`'s result as carried on a schedule row; null or
 * absent means the places could not be loaded - the screen then shows a dash, never a number that might be wrong.
 *
 * @param {ReturnType<typeof scheduleCapacity>|null|undefined} places
 * @returns {{ text: string|null, isFull: boolean, unavailable: boolean }}
 */
export function placesDisplay(places) {
  if (!places) return { text: null, isFull: false, unavailable: true };
  if (places.isUnlimited) return { text: "Unlimited", isFull: false, unavailable: false };
  return { text: places.label, isFull: places.isFull, unavailable: false };
}
