import { parseUsage } from "./usage.js";

/**
 * Reads the two usage numbers through the `system_usage()` database function (migration 0032),
 * with the Supabase client it is given - in the application, always the signed-in user's own
 * session client (lib/supabase/server.js). The function checks for an Admin itself.
 *
 * It never throws into the page: any failure - a refused call, a missing function, a malformed
 * answer, a network error - is `null`, which the Dashboard shows as "Usage is unavailable right
 * now". Only the error's code and message are logged, as every other Dashboard read does.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<{ databaseBytes: number, storageBytes: number } | null>}
 */
export async function fetchSystemUsage(supabase) {
  try {
    const { data, error } = await supabase.rpc("system_usage");

    if (error) {
      console.error("[system-usage] Could not read usage:", error.code, error.message);
      return null;
    }

    const usage = parseUsage(data);
    if (!usage) {
      console.error("[system-usage] Could not read usage: the answer was not two byte counts.");
      return null;
    }
    return usage;
  } catch (error) {
    console.error("[system-usage] Could not read usage:", error?.code ?? error?.name, error?.message);
    return null;
  }
}
