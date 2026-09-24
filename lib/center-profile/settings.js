import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadCenterSettings } from "@/lib/center-profile/settings-core";
import { todayInCentreTimezone } from "@/lib/class-sessions/validation";

/**
 * The single server-side source of the centre's settings: time zone, currency,
 * name and logo. Every page, data function and action that needs one of them
 * reads it here - none queries the profile itself or hard-codes a value.
 *
 * `cache()` makes it one database read per request no matter how many callers
 * ask, and the value is never held between requests, so saving Center Settings
 * takes effect on the next request with nothing to invalidate. Server data
 * stays authoritative: there is no client-side settings store - a client
 * component that needs a value is handed it as a prop.
 *
 * Any signed-in role may call this (it goes through the `center_settings()`
 * function, not the admin-only `center_profile` table); it exposes only the
 * non-sensitive fields.
 *
 * @returns {Promise<{ name: string, logoUrl: string|null, timezone: string, currency: string }>}
 */
export const getCenterSettings = cache(async () => loadCenterSettings(await createClient()));

/** The centre's IANA time zone - the business timezone for every date the app derives. */
export async function getCenterTimezone() {
  return (await getCenterSettings()).timezone;
}

/** The centre's ISO 4217 currency code. */
export async function getCenterCurrency() {
  return (await getCenterSettings()).currency;
}

/**
 * "Today" as a `YYYY-MM-DD` date at the centre - the one business date every
 * screen and rule uses (Attendance, Dashboard, Schedule, memberships, batches).
 * Never the server's UTC date and never the viewer's local date.
 *
 * @param {Date} [now] - overridable for testing.
 */
export async function getCentreToday(now = new Date()) {
  return todayInCentreTimezone(now, await getCenterTimezone());
}
