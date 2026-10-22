/**
 * The writes of schedule capacity that stay in the application (V1 Final Improvements, S5): new series for Add Schedule that carry a
 * capacity, and the capacity-only change of one existing series. The Supabase client is passed in so the logic is testable without a
 * server; `lib/schedules/actions.js` calls these. Capacity lives on `schedule_series.capacity` (migration 0060) - never on `schedules` -
 * so every write here targets that table, and a change names its series by id: no other series is touched. Every other Edit Schedule
 * save - capacity together with a schedule change or extra days - is one atomic database function (migration 0061), not a sequence
 * of these calls.
 *
 * The database is authoritative (0060's `schedule_series_capacity_guard` refuses a value below the places taken now, and the CHECK
 * keeps it within 1-1000); a refusal is returned as a message for the form's capacity field, anything else as a plain failure.
 */

import { mapScheduleCapacityError } from "./capacity-input.js";

/**
 * Inserts `count` new schedule series for a batch, each with the same capacity (null = unlimited), in one statement.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} batchId
 * @param {number} count
 * @param {number|null} capacity
 * @returns {Promise<{ ids: string[] } | { error: true }>}
 */
export async function createSeriesRows(supabase, batchId, count, capacity) {
  const { data, error } = await supabase
    .from("schedule_series")
    .insert(Array.from({ length: count }, () => ({ batch_id: batchId, capacity })))
    .select("id");

  if (error || data?.length !== count) {
    console.error("[schedules] Could not create schedule series:", error?.code, error?.message);
    return { error: true };
  }
  return { ids: data.map((row) => row.id) };
}

/**
 * A series' stored capacity, or a failure when it cannot be read.
 *
 * @returns {Promise<{ capacity: number|null } | { failed: true }>}
 */
export async function readSeriesCapacity(supabase, seriesId) {
  const { data, error } = await supabase.from("schedule_series").select("capacity").eq("id", seriesId).maybeSingle();
  if (error || !data) {
    console.error("[schedules] Could not read schedule capacity:", error?.code, error?.message);
    return { failed: true };
  }
  return { capacity: data.capacity };
}

/**
 * Sets one series' capacity (null = unlimited). Nothing is written when it is already that value. It takes effect at once: it is
 * not versioned and has no effective date.
 *
 * @returns {Promise<{ changed: boolean, previous: number|null } | { refused: string } | { failed: true }>} `refused` is the message
 *   for the capacity field (a value below the places taken, or out of range).
 */
export async function setSeriesCapacity(supabase, seriesId, capacity) {
  const current = await readSeriesCapacity(supabase, seriesId);
  if (current.failed) return { failed: true };
  if (current.capacity === capacity) return { changed: false, previous: current.capacity };

  const { data, error } = await supabase.from("schedule_series").update({ capacity }).eq("id", seriesId).select("id");

  if (error) {
    const refused = mapScheduleCapacityError(error);
    if (refused) return { refused };
    console.error(`[schedules] Could not set the capacity of series ${seriesId}:`, error.code, error.message);
    return { failed: true };
  }
  // A row-level-security filter updates nothing and reports no error: the count proves it happened.
  if (data?.length !== 1) {
    console.error(`[schedules] The capacity of series ${seriesId} was not updated.`);
    return { failed: true };
  }
  return { changed: true, previous: current.capacity };
}
