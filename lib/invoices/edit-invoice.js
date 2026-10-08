import { validateInvoiceDetailsInput } from "./validation.js";

/**
 * The Edit Invoice dialog's logic, without React: what it opens with, what it sends, and what it
 * makes of the answer (V1 Invoice / Receipt, supabase/migrations/0026 `update_invoice_details`).
 *
 * An issued invoice may change in exactly two things - its number and its date - and this sends
 * exactly those two. Every rule that depends on data or on the clock (the number unique and not
 * below the starting number, the date not in the future or before the payment date) is the
 * database's; its message comes back through the action and is shown as it is. Here the only checks
 * are the SHAPE ones the action itself makes first (a whole number, a real date), so a typo is a
 * field message before the round trip. The prefix is never part of the form: it is not editable.
 */

/**
 * What the dialog is given about the invoice, from the stored record: its id, its number and date
 * as stored (the number without its prefix), and the prefix, for display only. Just these four -
 * the rest of the invoice never reaches the browser.
 */
export function editInvoiceInitial(invoice) {
  return {
    id: invoice.id,
    number: String(invoice.invoice_number ?? ""),
    date: String(invoice.invoice_date ?? ""),
    prefix: invoice.invoice_prefix ?? null,
  };
}

/** The dialog's fields - always the current stored values. */
export function initialEditValues(initial) {
  return { invoiceNumber: initial?.number ?? "", invoiceDate: initial?.date ?? "" };
}

/**
 * @param {{ invoiceNumber?: string, invoiceDate?: string }} values - what is in the fields.
 * @returns {{ errors: Record<string, string> } | { input: { invoiceNumber: string, invoiceDate: string } }}
 */
export function prepareEditInput(values) {
  const checked = validateInvoiceDetailsInput(values);
  if (!checked.success) return { errors: checked.errors };

  // The two allowed values, as typed - the action validates and converts them again.
  return { input: { invoiceNumber: String(values.invoiceNumber).trim(), invoiceDate: String(values.invoiceDate).trim() } };
}

/** The two field messages, by the dialog's own names, from the action's `fieldErrors` keys. */
function fieldMessages(fieldErrors = {}) {
  return { number: fieldErrors.invoice_number ?? null, date: fieldErrors.invoice_date ?? null };
}

/**
 * Validates, saves through `save` (the `updateInvoiceDetails` action, bound to the invoice) and
 * says what the dialog should do next:
 *   { status: "saved" }                                    - close it
 *   { status: "invalid", fields: { number, date } }        - nothing was sent
 *   { status: "error", fields: { number, date }, formError } - the save was refused; show why
 *
 * @param {{ invoiceNumber?: string, invoiceDate?: string }} values
 * @param {(input: { invoiceNumber: string, invoiceDate: string }) => Promise<{ success?: true, error?: string, fieldErrors?: Record<string, string> }>} save
 */
export async function submitInvoiceEdit(values, save) {
  const prepared = prepareEditInput(values);
  if (prepared.errors) return { status: "invalid", fields: fieldMessages(prepared.errors) };

  const result = await save(prepared.input);
  if (!result?.error) return { status: "saved" };

  const fields = fieldMessages(result.fieldErrors);
  // A message tied to a field shows there; anything else shows as the dialog's own error.
  return { status: "error", fields, formError: fields.number || fields.date ? null : result.error };
}
