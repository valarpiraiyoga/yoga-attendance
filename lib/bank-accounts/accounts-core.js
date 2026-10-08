/**
 * Bank Accounts — the pure half of the application layer (no Next.js, no React): which columns
 * are read and written, how a database error becomes a message, and the functions that take a
 * Supabase client. `data.js` and `actions.js` are the server-only wrappers that supply the
 * request's client and the Admin check.
 *
 * THE DATABASE IS THE AUTHORITY (supabase/migrations/0028): at most one account is active, zero
 * is valid, and `is_active` is written ONLY by `activate_bank_account()` / `deactivate_bank_account()`
 * — clients are not even granted that column. So this module never sends `is_active` in an insert
 * or update, and switching the active account is a single RPC call: there is no activation logic
 * here. There is no delete.
 */

import { validateBankAccountInput } from "./validation.js";

export const BANK_ACCOUNT_COLUMNS = "id, bank_name, account_name, account_number, ifsc_code, branch, is_active";

const SAVE_FALLBACK = "Could not save the bank account. Try again.";
const STATUS_FALLBACK = "Could not update the bank account. Try again.";
const NOT_FOUND = "That bank account no longer exists. Refresh the page.";
const NOT_ALLOWED = "You do not have permission to manage bank accounts.";

const KNOWN_ERRORS = [
  ["42501", /^Not authorized\.$/, NOT_ALLOWED],
  ["P0002", /^Bank account not found\.$/, NOT_FOUND],
  ["P0002", /^Invoice settings not found\.$/, "The invoice settings could not be found."],
];

function mapBankAccountError(error, fallback, context) {
  const code = error?.code ?? null;
  const message = error?.message ?? "";
  for (const [knownCode, pattern, shown] of KNOWN_ERRORS) {
    if (code === knownCode && pattern.test(message)) return { error: shown, code };
  }
  if (code === "42501") return { error: NOT_ALLOWED, code };
  // A raw Postgres / PostgREST message is never passed on.
  console.error(`[bank-accounts] ${context} failed:`, code, message);
  return { error: fallback, code };
}

/** The accounts, the active one first; null if they could not be read. */
export async function fetchBankAccounts(supabase) {
  const { data, error } = await supabase
    .from("bank_accounts")
    .select(BANK_ACCOUNT_COLUMNS)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[bank-accounts] load failed:", error.code, error.message);
    return null;
  }
  return data ?? [];
}

/** Adds an account. It starts inactive; activating it is a separate, explicit step. */
export async function createBankAccountFor(supabase, input) {
  const result = validateBankAccountInput(input);
  if (!result.success) return { error: "Check the highlighted fields.", fieldErrors: result.errors, code: null };

  const { error } = await supabase.from("bank_accounts").insert(result.data);
  if (error) return mapBankAccountError(error, SAVE_FALLBACK, "create");
  return { success: true };
}

/** Edits the five details of an account. Whether it is active is left exactly as it is. */
export async function updateBankAccountFor(supabase, id, input) {
  if (!id) return { error: SAVE_FALLBACK, code: null };

  const result = validateBankAccountInput(input);
  if (!result.success) return { error: "Check the highlighted fields.", fieldErrors: result.errors, code: null };

  const { data, error } = await supabase.from("bank_accounts").update(result.data).eq("id", id).select("id");
  if (error) return mapBankAccountError(error, SAVE_FALLBACK, `update ${id}`);
  if (!data?.length) return { error: NOT_FOUND, code: "P0002" };
  return { success: true };
}

/** Activates or deactivates an account through the database function — never a direct update. */
export async function setBankAccountActiveFor(supabase, id, active) {
  if (!id) return { error: STATUS_FALLBACK, code: null };

  const { error } = await supabase.rpc(active ? "activate_bank_account" : "deactivate_bank_account", { p_id: id });
  if (error) return mapBankAccountError(error, STATUS_FALLBACK, `${active ? "activate" : "deactivate"} ${id}`);
  return { success: true };
}
