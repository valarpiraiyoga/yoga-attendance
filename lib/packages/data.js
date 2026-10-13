import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchPackage, fetchPackages } from "@/lib/packages/service-core";

/**
 * Data Access Layer for packages and their fees (V1 Fee Structure, FS-3; migration 0046). Admin only: the role is required
 * here and the tables' row-level security lets only an Admin read them.
 */

/** Every package, by name, with its offered options. */
export async function getPackages() {
  await requireRole(ROLES.ADMIN);
  return fetchPackages(await createClient());
}

/**
 * One package with its options, fee entries (newest effective date first, each with its discounts) and audit events (newest
 * first), or null.
 *
 * @param {string} packageId
 */
export async function getPackage(packageId) {
  await requireRole(ROLES.ADMIN);
  return fetchPackage(await createClient(), packageId);
}
