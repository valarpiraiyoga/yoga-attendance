import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchBankAccounts } from "@/lib/bank-accounts/accounts-core";

/**
 * Data Access Layer for Bank Accounts (supabase/migrations/0028). Admin-only: RLS already
 * restricts the table, but like the other invoice data functions this requires the Admin role
 * itself, so the accounts can never be read on a path that forgot to guard its page.
 *
 * @returns {Promise<object[]|null>} the accounts (active first), or null if they could not be read.
 */
export async function getBankAccounts() {
  await requireRole(ROLES.ADMIN);
  return fetchBankAccounts(await createClient());
}
