/**
 * Center Settings - the values every screen reads from ONE place: the centre's
 * time zone, currency, name and logo.
 *
 * This module is the pure half (no Next.js, no React): the defaults, how a
 * database row is turned into settings, and the loader that takes a Supabase
 * client. `lib/center-profile/settings.js` is the server-only wrapper that
 * supplies the request's client and caches the result for the request - that
 * is what the rest of the app imports.
 *
 * Time zone and currency belong to the CENTRE. Nothing here (or anywhere that
 * uses these settings) reads the user's browser or device.
 */

import { DEFAULT_CENTRE_TIMEZONE } from "../class-sessions/validation.js";
import { DEFAULT_CURRENCY, isCurrencyCode } from "../currencies.js";
import { isValidTimeZone } from "../timezones.js";

/**
 * What a centre has until it chooses otherwise - and what every centre had
 * before these were settings. The database column defaults are the same values.
 */
export const DEFAULT_CENTER_SETTINGS = Object.freeze({
  name: "Yoga Center",
  logoUrl: null,
  timezone: DEFAULT_CENTRE_TIMEZONE,
  currency: DEFAULT_CURRENCY,
});

/**
 * A `center_settings()` row as settings. A missing row, or a stored value that
 * is no longer valid, resolves to the default for that field, so a bad value
 * can never make a page fail to render or a date be computed in a zone the
 * platform does not know.
 *
 * @param {{ name?: string|null, logo_url?: string|null, timezone?: string|null, currency?: string|null }|null|undefined} row
 * @returns {{ name: string, logoUrl: string|null, timezone: string, currency: string }}
 */
export function resolveCenterSettings(row) {
  return {
    name: row?.name?.trim() || DEFAULT_CENTER_SETTINGS.name,
    logoUrl: row?.logo_url || null,
    timezone: isValidTimeZone(row?.timezone) ? row.timezone : DEFAULT_CENTER_SETTINGS.timezone,
    currency: isCurrencyCode(row?.currency) ? row.currency : DEFAULT_CENTER_SETTINGS.currency,
  };
}

// The function is missing only when migration 0024 has not been applied yet.
// PostgREST reports that as PGRST202 (not in the schema cache) or Postgres as
// 42883 (undefined function).
function isMissingFunction(error) {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/**
 * Reads the centre's settings through the `center_settings()` database
 * function, which any signed-in role may call (an instructor cannot read
 * `center_profile` itself). Before migration 0024 is applied the function does
 * not exist; that alone falls back to the defaults (the centre's behaviour
 * until now) rather than taking the app down. Any other failure throws, like
 * every other data read, rather than silently dating a centre's day in the
 * wrong zone.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function loadCenterSettings(supabase) {
  const { data, error } = await supabase.rpc("center_settings");

  if (error) {
    if (isMissingFunction(error)) {
      console.warn("[center-settings] center_settings() is missing - apply migration 0024. Using defaults.");
      return resolveCenterSettings(null);
    }
    console.error("[center-settings] Could not load the center settings:", error.code, error.message);
    throw new Error("Could not load the center settings.");
  }

  return resolveCenterSettings(Array.isArray(data) ? data[0] : data);
}
