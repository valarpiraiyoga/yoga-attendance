/**
 * Input checks for the invoice actions.
 *
 * Plain functions, no schema library — consistent with the rest of the project.
 * These check only the SHAPE of what is sent (a real calendar date, a whole
 * number), so a typo is a field message instead of a database error. Every
 * rule that depends on data or on the clock — the number being unique and not
 * below the starting number, a date not being in the future or before the
 * payment date, the payment date being required — is the database's, and its
 * answer is mapped in `invoice-core.js`.
 */

// Native <input type="date"> always submits (or is empty) in this format.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Digits only, and short enough that the number survives JavaScript's
// Number.MAX_SAFE_INTEGER (9,007,199,254,740,991 has 16 digits) on its way to
// a bigint column.
const NUMBER_PATTERN = /^\d{1,15}$/;

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// An optional date: blank / absent is "not supplied" (null), anything else must be a real date.
function optionalDate(value, label, errors, key) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!isValidDateString(text)) {
    errors[key] = `Enter a valid ${label}.`;
    return null;
  }
  return text;
}

/**
 * Issue Invoice input: both dates optional. `paymentDate` is only needed (and
 * only accepted by the database) for a membership with no payment date yet;
 * `invoiceDate` defaults to the payment date in the database.
 *
 * @param {{ paymentDate?: string|null, invoiceDate?: string|null }} [input]
 * @returns {{ success: true, data: { paymentDate: string|null, invoiceDate: string|null } } | { success: false, errors: Record<string, string> }}
 */
export function validateIssueInvoiceInput({ paymentDate, invoiceDate } = {}) {
  const errors = {};
  const payment = optionalDate(paymentDate, "payment date", errors, "payment_date");
  const invoice = optionalDate(invoiceDate, "invoice date", errors, "invoice_date");

  if (Object.keys(errors).length > 0) return { success: false, errors };
  return { success: true, data: { paymentDate: payment, invoiceDate: invoice } };
}

/**
 * Edit Invoice input: the number and the date — the only two things an issued
 * invoice lets change. Both required.
 *
 * @param {{ invoiceNumber?: string|number|null, invoiceDate?: string|null }} [input]
 * @returns {{ success: true, data: { invoiceNumber: number, invoiceDate: string } } | { success: false, errors: Record<string, string> }}
 */
export function validateInvoiceDetailsInput({ invoiceNumber, invoiceDate } = {}) {
  const errors = {};

  const numberText = String(invoiceNumber ?? "").trim();
  let number = null;
  if (!numberText) {
    errors.invoice_number = "Invoice number is required.";
  } else if (!NUMBER_PATTERN.test(numberText) || Number(numberText) <= 0) {
    errors.invoice_number = "Enter the invoice number as a positive whole number.";
  } else {
    number = Number(numberText);
  }

  const dateText = String(invoiceDate ?? "").trim();
  if (!dateText) {
    errors.invoice_date = "Invoice date is required.";
  } else if (!isValidDateString(dateText)) {
    errors.invoice_date = "Enter a valid invoice date.";
  }

  if (Object.keys(errors).length > 0) return { success: false, errors };
  return { success: true, data: { invoiceNumber: number, invoiceDate: dateText } };
}
