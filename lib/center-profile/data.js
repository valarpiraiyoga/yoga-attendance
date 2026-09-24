import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for the Center Profile (Settings — Phase 19;
 * `01-product.md` §11; `supabase/migrations/0018_center_profile.sql`).
 *
 * RLS restricts this table to admins (0018's `center_profile_select_admin`
 * / `center_profile_update_admin`); callers must still guard the
 * page/action with `requireRole(ROLES.ADMIN)` from `lib/auth/dal.js` — this
 * module only reads data, it does not authorize the caller.
 *
 * There is exactly one row, enforced by the table's own `singleton`
 * primary key and CHECK constraint (0018) — not by anything here.
 */

const COLUMNS = "name, logo_url, address, phone, email, timezone, currency, updated_at";

/**
 * The center's profile — always exactly one row once 0018 is applied,
 * since the migration seeds it and the schema forbids a second one.
 * Returns `null` only if the row is somehow missing (e.g. queried before
 * migrating), so the caller can render an honest empty state rather than
 * assume a row that isn't there.
 *
 * @returns {Promise<{ name: string, logo_url: string|null, address: string|null, phone: string|null, email: string|null, timezone: string, currency: string, updated_at: string }|null>}
 */
export async function getCenterProfile() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("center_profile")
    .select(COLUMNS)
    .eq("singleton", true)
    .maybeSingle();

  if (error) {
    console.error("[center-profile] Could not load the center profile:", error.code, error.message);
    throw new Error("Could not load the center profile.");
  }

  return data ?? null;
}
