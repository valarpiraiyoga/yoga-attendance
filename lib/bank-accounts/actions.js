"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { createBankAccountFor, setBankAccountActiveFor, updateBankAccountFor } from "@/lib/bank-accounts/accounts-core";

/**
 * Server actions for Bank Accounts (Settings — Invoice / Receipt).
 *
 * `requireRole(ROLES.ADMIN)` runs first in every action, and the database enforces the same
 * thing again (RLS, column grants, and `is_admin()` in the activation functions). Called directly
 * from a client component inside `useTransition`, so they return `{ success }` or
 * `{ error, fieldErrors? }`. Activation is the database's: these only call its functions, with
 * the request's own authenticated client — no service role.
 *
 * Changes affect invoices issued from now on; an issued invoice keeps the bank details it was
 * issued with. There is no delete.
 */

const SETTINGS_PATH = "/settings/invoice-receipt";

async function run(operation) {
  await requireRole(ROLES.ADMIN);
  const result = await operation(await createClient());
  if (result.success) revalidatePath(SETTINGS_PATH);
  return result;
}

export async function addBankAccount(input) {
  return run((supabase) => createBankAccountFor(supabase, input));
}

export async function editBankAccount(id, input) {
  return run((supabase) => updateBankAccountFor(supabase, id, input));
}

export async function activateBankAccount(id) {
  return run((supabase) => setBankAccountActiveFor(supabase, id, true));
}

export async function deactivateBankAccount(id) {
  return run((supabase) => setBankAccountActiveFor(supabase, id, false));
}
