/**
 * Invoice / Receipt — the pure half of the application layer (no Next.js, no
 * React): the column list, how database errors become application messages, and
 * the functions that take a Supabase client. `lib/invoices/data.js` and
 * `lib/invoices/actions.js` are the server-only wrappers that supply the
 * request's client and the Admin check; that is what the rest of the app
 * imports. The split mirrors `lib/center-profile/settings-core.js`.
 *
 * THE DATABASE IS THE AUTHORITY (supabase/migrations/0025, 0026). Nothing here
 * generates or edits an invoice number's sequence, calculates tax, builds the
 * snapshot, or decides who may issue what — it calls `issue_invoice()` and
 * `update_invoice_details()` and reports the result. The only checks made here
 * are the shape of what is being sent (a real date, a whole number), so a typo
 * is a field message rather than a database error.
 */

import { validateInvoiceDetailsInput, validateIssueInvoiceInput } from "./validation.js";

/** Every column of an invoice, explicitly (the project never `select("*")`). */
export const INVOICE_COLUMNS = [
  "id", "membership_id", "invoice_number", "invoice_date", "payment_date",
  "document_title", "description", "plan", "period_start", "period_end",
  "currency", "total_amount",
  "tax_enabled", "tax_name", "tax_rate", "taxable_amount", "tax_amount",
  "customer_name", "customer_code", "customer_phone", "customer_phone_country_code", "customer_email",
  "business_name", "business_address", "business_phone", "business_email", "business_logo_path",
  "terms", "signatory_name", "signatory_designation", "signature_path",
  "invoice_prefix",
  "created_at", "updated_at",
].join(", ");

// ---- error mapping -------------------------------------------------------------------

/**
 * The messages the invoice migrations raise (SQLSTATE + exact text), and how
 * each is shown. Matching on the text as well as the code is deliberate: only a
 * message WE wrote is ever passed on; anything else — a raw Postgres or
 * PostgREST error — falls to a generic message for its code and is logged.
 *
 * `field` names the form field a message belongs to, for `fieldErrors`.
 */
const KNOWN_ERRORS = [
  // 42501 — not authorised
  ["42501", /^Not authorized\.$/, null, "You do not have permission to manage invoices."],

  // P0002 — not found
  ["P0002", /^Membership not found\.$/, null, "Membership not found."],
  ["P0002", /^Invoice not found\.$/, null, "Invoice not found."],
  ["P0002", /^The student or centre profile could not be read\.$/, null, "The student or center profile needed for the invoice could not be read."],

  // 22023 — invalid value
  ["22023", /^Confirm the payment date to issue this invoice\.$/, "payment_date", "Confirm the payment date to issue this invoice."],
  ["22023", /^A payment date is required to issue an invoice\.$/, "payment_date", "A payment date is required to issue an invoice."],
  ["22023", /^The payment date cannot be in the future\.$/, "payment_date", "The payment date cannot be in the future."],
  ["22023", /^This membership already has a payment date, which cannot be changed\.$/, "payment_date", "This membership already has a payment date, which cannot be changed."],
  ["22023", /^The invoice date cannot be in the future\.$/, "invoice_date", "The invoice date cannot be in the future."],
  ["22023", /^The invoice date cannot be before the payment date\.$/, "invoice_date", "The invoice date cannot be before the payment date."],
  ["22023", /^The invoice date is required\.$/, "invoice_date", "Enter the invoice date."],
  ["22023", /^Invoice date and payment date are required\.$/, "invoice_date", "Enter the invoice date."],
  ["22023", /^The invoice number must be a positive whole number\.$/, "invoice_number", "Enter the invoice number as a positive whole number."],
  ["22023", /^The invoice number cannot be below the starting invoice number \((\d+)\)\.$/, "invoice_number", (m) => `The invoice number cannot be below the starting invoice number (${m[1]}).`],

  // 23505 — duplicate
  ["23505", /^An invoice has already been issued for this membership\.$/, null, "An invoice has already been issued for this membership."],
  ["23505", /^That invoice number is already in use\.$/, "invoice_number", "That invoice number is already in use."],
  // The unique indexes themselves, reached if two requests race past the function's own check.
  ["23505", /invoices_invoice_number_unique/, "invoice_number", "That invoice number is already in use."],
  ["23505", /invoices_membership_id_unique/, null, "An invoice has already been issued for this membership."],

  // 55000 — prerequisite not met
  ["55000", /^Invoice numbering has not been configured\.$/, null, "Invoice numbering has not been configured yet, so an invoice cannot be issued."],
  ["55000", /^Only a Paid membership can be invoiced\.$/, null, "Only a Paid membership can be invoiced."],

  // 55006 — protected / locked
  ["55006", /^The payment status cannot be changed after an invoice has been issued\.$/, "payment_status", "The payment status cannot be changed after an invoice has been issued."],
  ["55006", /^The payment date cannot be changed after an invoice has been issued\.$/, "payment_date", "The payment date cannot be changed after an invoice has been issued."],
  ["55006", /^The starting invoice number cannot be changed once an invoice has been issued\.$/, null, "The starting invoice number cannot be changed once an invoice has been issued."],
  ["55006", /^An issued invoice can only change its number and date\.$/, null, "An issued invoice can only change its number and date."],
  ["55006", /^An issued invoice cannot be deleted\.$/, null, "An issued invoice cannot be deleted."],
];

// What a recognised code says when its message is not one we know.
const CODE_FALLBACKS = {
  "42501": "You do not have permission to manage invoices.",
  P0002: "The invoice or membership could not be found.",
  "22023": "Check the values you entered.",
  "23505": "That invoice number is already in use, or an invoice has already been issued.",
  "55000": "The invoice cannot be issued right now.",
  "55006": "This change is not allowed once an invoice has been issued.",
};

/**
 * The application result for a database error ONLY IF it is one of the
 * invoice rules' own messages (the whitelist above), else null. No logging, no
 * fallback — so a caller with its own error handling (the membership actions,
 * whose saves can now be refused by the invoice triggers) can surface exactly
 * these and leave everything else to its existing handling.
 *
 * @param {{ code?: string, message?: string, details?: string }|null|undefined} error
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string }|null}
 */
export function matchKnownInvoiceError(error) {
  const code = error?.code ?? null;
  if (!code) return null;
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`.trim();

  for (const [knownCode, pattern, field, message] of KNOWN_ERRORS) {
    if (code !== knownCode) continue;
    const match = text.match(pattern) ?? error?.message?.match(pattern);
    if (!match) continue;
    const shown = typeof message === "function" ? message(match) : message;
    return field ? { error: shown, fieldErrors: { [field]: shown }, code } : { error: shown, code };
  }

  return null;
}

/**
 * A database error as an application result: `{ error, fieldErrors?, code }`,
 * the same shape the membership actions return. A raw Postgres/PostgREST
 * message is never passed on; an unrecognised error is logged here (code and
 * message only, as everywhere else) and shown as `fallback`.
 *
 * @param {{ code?: string, message?: string, details?: string }|null|undefined} error
 * @param {string} fallback - what to say when nothing more specific is known.
 * @param {string} [context] - for the log line.
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string|null }}
 */
export function mapInvoiceError(error, fallback, context = "invoice") {
  const known = matchKnownInvoiceError(error);
  if (known) return known;

  const code = error?.code ?? null;
  if (CODE_FALLBACKS[code]) {
    return { error: CODE_FALLBACKS[code], code };
  }

  console.error(`[invoices] ${context} failed:`, code, error?.message);
  return { error: fallback, code };
}

// ---- reads ---------------------------------------------------------------------------------

/**
 * The invoice issued for a membership, or null if it has none (or is not
 * visible to the caller under RLS — an Instructor sees no invoices).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} membershipId
 */
export async function fetchInvoiceForMembership(supabase, membershipId) {
  if (!membershipId) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("membership_id", membershipId)
    .maybeSingle();

  if (error) {
    console.error(`[invoices] Could not load the invoice for membership ${membershipId}:`, error.code, error.message);
    throw new Error("Could not load the invoice.");
  }

  return data ?? null;
}

/**
 * An invoice by its own id, or null if it does not exist (or is not visible
 * to the caller under RLS).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} invoiceId
 */
export async function fetchInvoice(supabase, invoiceId) {
  if (!invoiceId) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    console.error(`[invoices] Could not load invoice ${invoiceId}:`, error.code, error.message);
    throw new Error("Could not load the invoice.");
  }

  return data ?? null;
}

// ---- writes ----------------------------------------------------------------------------------

/**
 * Issues the invoice for a Paid membership that has none, through the
 * `issue_invoice()` function — the database numbers it, calculates any tax,
 * builds the snapshot and enforces every date and uniqueness rule.
 *
 * `paymentDate` is for a membership that was Paid before invoicing existed and
 * so has no payment date: the Admin confirms one here (the database refuses to
 * invent it). `invoiceDate` is optional and defaults, in the database, to the
 * payment date.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} membershipId
 * @param {{ paymentDate?: string|null, invoiceDate?: string|null }} [input]
 * @returns {Promise<{ success: true, invoiceId: string } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function issueInvoiceFor(supabase, membershipId, input = {}) {
  if (!membershipId) {
    return { error: "Could not issue the invoice. Try again.", code: null };
  }

  const result = validateIssueInvoiceInput(input);
  if (!result.success) {
    return { error: "Check the highlighted fields.", fieldErrors: result.errors, code: null };
  }

  const { data, error } = await supabase.rpc("issue_invoice", {
    p_membership_id: membershipId,
    p_payment_date: result.data.paymentDate,
    p_invoice_date: result.data.invoiceDate,
  });

  if (error) {
    return mapInvoiceError(error, "Could not issue the invoice. Try again.", `issue for membership ${membershipId}`);
  }

  return { success: true, invoiceId: data };
}

/**
 * Edits the two things an issued invoice allows — its number and its date —
 * through `update_invoice_details()`. Nothing else is sent: the amount,
 * customer, tax, terms, business details and payment date are a historical
 * snapshot the database will not let change.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} invoiceId
 * @param {{ invoiceNumber: string|number, invoiceDate: string }} input
 * @returns {Promise<{ success: true } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function updateInvoiceDetailsFor(supabase, invoiceId, input = {}) {
  if (!invoiceId) {
    return { error: "Could not update the invoice. Try again.", code: null };
  }

  const result = validateInvoiceDetailsInput(input);
  if (!result.success) {
    return { error: "Check the highlighted fields.", fieldErrors: result.errors, code: null };
  }

  const { error } = await supabase.rpc("update_invoice_details", {
    p_invoice_id: invoiceId,
    p_invoice_number: result.data.invoiceNumber,
    p_invoice_date: result.data.invoiceDate,
  });

  if (error) {
    return mapInvoiceError(error, "Could not update the invoice. Try again.", `update of invoice ${invoiceId}`);
  }

  return { success: true };
}
