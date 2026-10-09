import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchPaymentsForMembership } from "@/lib/memberships/payments-core";

/**
 * Data Access Layer for membership payments (V1 Tax Adjustment, Step 2; migration 0034). Admin only:
 * the role is required here and the table's row-level security allows only an Admin to read it.
 *
 * @param {string} membershipId
 */
export async function getPaymentsForMembership(membershipId) {
  await requireRole(ROLES.ADMIN);
  return fetchPaymentsForMembership(await createClient(), membershipId);
}
