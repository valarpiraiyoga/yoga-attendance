import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCentreToday } from "@/lib/center-profile/settings";
import { loadReminders } from "@/lib/reminders/data-core";

/**
 * Current membership expiry and payment reminders (01-product.md §5 "Reminders"; 02-ux.md "Membership & payment reminders").
 *
 * Admin-only, enforced here and not by hiding a screen: `requireRole(ROLES.ADMIN)` runs before anything is read, so an Instructor or a signed-out
 * visitor never receives reminder data (requireRole sends them away). The reads use the Admin's own session, so RLS applies as well
 * (memberships and payments are Admin-only tables).
 *
 * Nothing is stored: every call works the reminders out from the current data on the centre's date (`getCentreToday`, the centre's time zone).
 * The queries and the assembly are in `lib/reminders/data-core.js`; the rules are R1's `lib/reminders/rules.js`.
 *
 * Like the other data functions, a read that fails throws a plain "Could not load reminders." (the details are logged); the caller shows its
 * error state.
 *
 * Memoized with React `cache()` for one request, so the notification bell, the Dashboard panel and the Memberships list read once per page,
 * not once each.
 *
 * @returns {Promise<{ today: string, reminders: object[], counts: { total: number, expiry: number, payment: number } }>}
 */
export const getReminders = cache(async () => {
  await requireRole(ROLES.ADMIN);

  const supabase = await createClient();
  return loadReminders(supabase, await getCentreToday());
});
