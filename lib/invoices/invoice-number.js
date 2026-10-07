/**
 * The ONE place an invoice's displayed number is built (V1 Invoice Number Prefix,
 * supabase/migrations/0027_invoice_prefix.sql).
 *
 * An invoice has two stored values:
 *   - `invoice_number` — the numeric number (a bigint; PostgREST returns it as a
 *     JSON number). It is the source of truth for sequencing and is never changed
 *     here, never padded and never turned into the stored value;
 *   - `invoice_prefix` — an optional text label, NULL when there is none. It is a
 *     SNAPSHOT: the prefix that was in force when this invoice was issued.
 *
 * What is shown is the prefix followed by the number: prefix `INV-` and number 788
 * read "INV-788"; no prefix reads "788".
 *
 * Every screen and document that shows an invoice number (the membership invoice
 * panel, the future invoice page, PDF, share text) must call this and nowhere
 * else join a prefix and a number. It is a pure function — no database, no UI, no
 * settings — and it only ever formats the values it is given.
 */

/**
 * The displayed invoice number: the prefix (if any) followed by the number.
 * A missing, NULL or empty prefix means no prefix, so an invoice issued without
 * one reads exactly as the bare number. The number is shown as it is stored.
 *
 * @param {number|bigint|string|null|undefined} invoiceNumber - the numeric `invoice_number`.
 * @param {string|null|undefined} [invoicePrefix] - the invoice's own stored `invoice_prefix`.
 * @returns {string} e.g. "786", "INV-786", "Yoga Center-786"; "" when there is no number.
 */
export function formatInvoiceNumber(invoiceNumber, invoicePrefix) {
  if (invoiceNumber === null || invoiceNumber === undefined) return "";

  const prefix = typeof invoicePrefix === "string" ? invoicePrefix : "";
  return `${prefix}${String(invoiceNumber)}`;
}

/**
 * The displayed number of an invoice record, from the invoice's OWN stored
 * `invoice_number` and `invoice_prefix` only. This is the historical-snapshot
 * rule in code: an issued invoice never takes its prefix from the current
 * Invoice / Receipt Settings, so a later change of the setting cannot change how
 * an existing invoice reads. (There is deliberately no settings parameter.)
 *
 * @param {{ invoice_number?: number|bigint|string|null, invoice_prefix?: string|null }|null|undefined} invoice
 * @returns {string}
 */
export function formatInvoiceNumberOf(invoice) {
  return formatInvoiceNumber(invoice?.invoice_number, invoice?.invoice_prefix);
}
