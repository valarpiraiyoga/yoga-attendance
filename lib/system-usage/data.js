import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchSystemUsage } from "@/lib/system-usage/usage-core";

/**
 * Data Access Layer for the Dashboard's System Usage card (V1; migration 0032). Admin only.
 *
 * The numbers come from the `system_usage()` database function, called with the signed-in user's
 * own session - not the secret/admin client and not a Management API token. Like the other
 * invoice and settings readers it asks for the Admin role itself, and the function checks again.
 *
 * @returns {Promise<{ databaseBytes: number, storageBytes: number } | null>} null when unavailable.
 */
export async function getSystemUsage() {
  await requireRole(ROLES.ADMIN);
  return fetchSystemUsage(await createClient());
}
