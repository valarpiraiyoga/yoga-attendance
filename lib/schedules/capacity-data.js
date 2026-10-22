import "server-only";

import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCentreToday } from "@/lib/center-profile/settings";
import { fetchScheduleCapacities } from "@/lib/schedules/capacity";

/**
 * Server-only wrapper for schedule capacity (lib/schedules/capacity.js): supplies the Supabase client, the Admin check and the
 * centre's date. Admin only, like every read of schedule assignments (RLS on `enrollment_schedules` and `schedule_series`).
 *
 * It reads `schedule_series.capacity`, which exists only once migration 0060 is applied: nothing calls it before then. The
 * schedule picker (S4) and the schedule screens (S5) are its callers.
 *
 * @param {string[]} seriesIds
 * @returns {Promise<Map<string, ReturnType<typeof import("@/lib/schedules/capacity").scheduleCapacity>>>}
 */
export async function getScheduleCapacities(seriesIds) {
  await requireRole(ROLES.ADMIN);
  return fetchScheduleCapacities(await createClient(), seriesIds, await getCentreToday());
}

/**
 * The same figures for a client form: a plain object keyed by schedule series id (a Map does not travel to a client component as
 * a prop), or null when they cannot be read - for example before migration 0060 is applied, when `schedule_series.capacity` does
 * not exist yet. The enrollment pages call this, so a failed read never takes the form down: the picker then simply shows no
 * places and locks nothing, and the database still decides on Save. (A redirect or not-found from the role check is re-thrown.)
 *
 * @param {string[]} seriesIds
 * @returns {Promise<Record<string, ReturnType<typeof import("@/lib/schedules/capacity").scheduleCapacity>>|null>}
 */
export async function getScheduleCapacitiesForPicker(seriesIds) {
  try {
    return Object.fromEntries(await getScheduleCapacities(seriesIds));
  } catch (error) {
    unstable_rethrow(error);
    return null; // the read already logged why
  }
}

/**
 * Each schedule row with its series' places on `places` (`scheduleCapacity(...)`: capacity, places taken, Full), for the screens
 * that list schedules - the Schedule list and weekly grid, and Batch Details - read with ONE capacity lookup for all the rows'
 * series, never one per row. Versions of one series share its places. `places` is null when they could not be read (see
 * `getScheduleCapacitiesForPicker`): the screen then shows a dash rather than a number that might be wrong. Only call it where the
 * page is Admin-only.
 *
 * @template {{ series_id?: string }} T
 * @param {T[]} schedules
 * @returns {Promise<(T & { places: ReturnType<typeof import("@/lib/schedules/capacity").scheduleCapacity>|null })[]>}
 */
export async function attachSchedulePlaces(schedules) {
  const rows = schedules ?? [];
  const capacities = await getScheduleCapacitiesForPicker([...new Set(rows.map((row) => row.series_id).filter(Boolean))]);
  return rows.map((row) => ({ ...row, places: capacities?.[row.series_id] ?? null }));
}
