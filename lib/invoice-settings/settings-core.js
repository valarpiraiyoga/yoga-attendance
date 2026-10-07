/**
 * Invoice / Receipt Settings — the pure half of the application layer (no
 * Next.js, no React): which columns are read and written, how a database error
 * becomes a message, and the functions that take a Supabase client.
 * `lib/invoice-settings/data.js` and `actions.js` are the server-only wrappers
 * that supply the request's client and the Admin check. The split mirrors
 * `lib/center-profile/settings-core.js`, and it is kept apart from
 * `lib/invoices/` (the invoices themselves).
 *
 * THE DATABASE IS THE AUTHORITY (supabase/migrations/0025, 0026): it locks the
 * starting number once an invoice exists, keeps the counter, enforces the tax
 * constraints, restricts the table to admins, and copies these settings into
 * each invoice when it is issued. This module only reads the settings and
 * writes the approved, whitelisted columns. It never writes
 * `next_invoice_number` (the database's own counter — clients are not even
 * granted it), and it does no numbering and no tax arithmetic.
 */

import { matchKnownInvoiceError } from "../invoices/invoice-core.js";
import { validateInvoiceSettingsInput } from "./validation.js";
import { stageSignatureChange } from "./signature.js";

// `next_invoice_number` is internal numbering state: it is not even read here.
export const INVOICE_SETTINGS_COLUMNS = [
  "starting_invoice_number",
  "invoice_prefix",
  "document_title",
  "tax_enabled",
  "tax_name",
  "tax_rate",
  "terms",
  "signatory_name",
  "signatory_designation",
  "signature_path",
  "updated_at",
].join(", ");

/**
 * The ONLY columns an update may carry. `next_invoice_number`, `singleton` and
 * `updated_at` (set by the database) are deliberately absent.
 */
export const WRITABLE_COLUMNS = Object.freeze([
  "starting_invoice_number",
  "invoice_prefix",
  "document_title",
  "tax_enabled",
  "tax_name",
  "tax_rate",
  "terms",
  "signatory_name",
  "signatory_designation",
  "signature_path",
]);

/**
 * The update payload: validated form data plus the signature patch, reduced to
 * the whitelist. A key that is absent (the starting number while locked; the tax
 * name and rate while tax is off; the signature when it is unchanged) is simply
 * not in the payload, so the stored value is left alone — never blanked.
 *
 * @param {object} data - from `validateInvoiceSettingsInput`.
 * @param {{ signature_path?: string|null }} [signaturePatch] - from `stageSignatureChange`.
 */
export function buildSettingsUpdate(data, signaturePatch = {}) {
  const payload = {};
  for (const column of WRITABLE_COLUMNS) {
    const source = column === "signature_path" ? signaturePatch : data;
    if (source && Object.hasOwn(source, column) && source[column] !== undefined) {
      payload[column] = source[column];
    }
  }
  return payload;
}

// ---- error mapping ---------------------------------------------------------------------

const SAVE_FALLBACK = "Could not save the invoice settings. Try again.";

// The table's own CHECK constraints (0025), reached only if something slips past validation.
const CONSTRAINT_ERRORS = [
  [/invoice_settings_tax_complete/, "tax_name", "Enter the tax name and rate to turn tax on."],
  [/invoice_settings_tax_rate_range/, "tax_rate", "The tax rate must be above 0 and below 100."],
  [/invoice_settings_tax_name_not_blank/, "tax_name", "Enter the tax name."],
  [/invoice_settings_starting_positive/, "starting_invoice_number", "Enter the starting number as a positive whole number."],
  [/invoice_settings_document_title_valid/, "document_title", "Choose Invoice or Receipt."],
  [/invoice_settings_invoice_prefix_valid/, "invoice_prefix", "The prefix must be 1–20 characters, with no space at either end and not ending in a number."],
];

/**
 * A database error as `{ error, fieldErrors?, code }`. The invoice rules' own
 * messages (the starting number being locked is one) come from the shared
 * whitelist; the table's CHECK constraints are mapped here; anything else is
 * logged (code and message only) and shown as a generic message. A raw
 * Postgres message is never passed on.
 */
export function mapSettingsError(error) {
  const known = matchKnownInvoiceError(error);
  if (known) return known;

  const code = error?.code ?? null;
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;

  if (code === "23514") {
    for (const [pattern, field, message] of CONSTRAINT_ERRORS) {
      if (pattern.test(text)) return { error: message, fieldErrors: { [field]: message }, code };
    }
  }

  if (code === "42501") {
    return { error: "You do not have permission to change the invoice settings.", code };
  }

  console.error("[invoice-settings] Could not update the invoice settings:", code, error?.message);
  return { error: SAVE_FALLBACK, code };
}

// ---- reads ---------------------------------------------------------------------------------

/**
 * The invoice settings row — exactly one once migration 0025 is applied. Null
 * only if it is missing (queried before migrating), so the page can say so
 * instead of crashing.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchInvoiceSettings(supabase) {
  const { data, error } = await supabase
    .from("invoice_settings")
    .select(INVOICE_SETTINGS_COLUMNS)
    .eq("singleton", true)
    .maybeSingle();

  if (error) {
    console.error("[invoice-settings] Could not load the invoice settings:", error.code, error.message);
    throw new Error("Could not load the invoice settings.");
  }

  return data ?? null;
}

/**
 * Whether any invoice has been issued — the moment the starting number locks
 * (the database enforces the lock; this only lets the screen show it).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchHasIssuedInvoices(supabase) {
  const { count, error } = await supabase.from("invoices").select("id", { count: "exact", head: true });

  if (error) {
    console.error("[invoice-settings] Could not check for issued invoices:", error.code, error.message);
    throw new Error("Could not load the invoice settings.");
  }

  return (count ?? 0) > 0;
}

// ---- save --------------------------------------------------------------------------------------

/**
 * Validates and saves the Invoice / Receipt Settings.
 *
 *  1. Ask the database whether an invoice exists; if so the starting number is
 *     locked and whatever was submitted for it is ignored.
 *  2. Validate (and normalise) the fields and the signature file.
 *  3. Upload a new signature to the private bucket (or note its removal).
 *  4. Write only the whitelisted columns.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ input: object, signature?: { file: File|null, remove: boolean, error: string|null } }} request
 * @returns {Promise<{ success: true } | { error: string, fieldErrors?: Record<string, string>, code?: string|null }>}
 */
export async function saveInvoiceSettings(supabase, { input, signature = { file: null, remove: false, error: null } }) {
  const startingLocked = await fetchHasIssuedInvoices(supabase);

  const result = validateInvoiceSettingsInput(input, { startingLocked });
  if (!result.success || signature.error) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { ...(result.success ? null : result.errors), ...(signature.error ? { photo: signature.error } : null) },
    };
  }

  const staged = await stageSignatureChange(supabase, signature);
  if (staged.error) {
    return { error: staged.error };
  }

  const { error } = await supabase
    .from("invoice_settings")
    .update(buildSettingsUpdate(result.data, staged.patch))
    .eq("singleton", true);

  if (error) {
    if (staged.patch.signature_path) {
      // The new object stays (nothing is ever deleted); it is simply unreferenced.
      console.error(`[invoice-settings] The save failed after uploading ${staged.patch.signature_path}; the file is unreferenced.`);
    }
    return mapSettingsError(error);
  }

  return { success: true };
}
