/**
 * Validation for the Invoice / Receipt Settings form (Settings — V1 Invoice /
 * Receipt Enhancement, Phase 3).
 *
 * Plain functions, no schema library — consistent with the rest of the project
 * (`lib/center-profile/validation.js`). Each validator both checks and
 * normalizes: callers get back trimmed values ready to write, never the raw
 * form input.
 *
 * These check the SHAPE and the approved LENGTHS only. Numbering, uniqueness,
 * the starting-number lock and tax calculation belong to the database
 * (supabase/migrations/0025, 0026); nothing here generates a number or does
 * tax arithmetic. The database's own constraints are mapped in
 * `settings-core.js` for the rare case one slips past.
 */

export const DOCUMENT_TITLES = ["invoice", "receipt"];

export const MAX_STARTING_NUMBER_DIGITS = 15;
export const MAX_TAX_NAME_LENGTH = 30;
export const MAX_TERMS_LENGTH = 2000;
export const MAX_SIGNATORY_NAME_LENGTH = 100;
export const MAX_SIGNATORY_DESIGNATION_LENGTH = 100;

const DIGITS_PATTERN = /^\d+$/;
const RATE_PATTERN = /^\d+(\.\d+)?$/;
const MAX_TAX_RATE_DECIMALS = 2;

/** The Tax switch submits "1" when on and "0" when off (the Switch's value / uncheckedValue). */
export function parseTaxEnabled(value) {
  return value === true || value === "1" || value === "true" || value === "on";
}

/**
 * Validates the Invoice / Receipt Settings fields.
 *
 *   - Document title: Invoice or Receipt.
 *   - Starting invoice number: blank = numbering not configured (null); else a
 *     positive whole number of at most 15 digits. When `startingLocked` (an
 *     invoice already exists) it is not accepted at all — it is left out of
 *     `data`, so the saved value cannot be changed or cleared.
 *   - Tax: when ON a name (≤ 30) and a rate (> 0, < 100, at most 2 decimals) are
 *     required. When OFF the name and rate are ignored — left out of `data`, so
 *     the stored values stay as they were.
 *   - Terms ≤ 2000; signatory name and designation ≤ 100 each; all optional.
 *
 * @param {object} [input]
 * @param {{ startingLocked?: boolean }} [options]
 * @returns {{ success: true, data: {
 *     document_title: string,
 *     tax_enabled: boolean,
 *     terms: string|null,
 *     signatory_name: string|null,
 *     signatory_designation: string|null,
 *     starting_invoice_number?: number|null,
 *     tax_name?: string,
 *     tax_rate?: number,
 *   } } | { success: false, errors: Record<string, string> }}
 */
export function validateInvoiceSettingsInput(
  {
    document_title,
    starting_invoice_number,
    tax_enabled,
    tax_name,
    tax_rate,
    terms,
    signatory_name,
    signatory_designation,
  } = {},
  { startingLocked = false } = {}
) {
  const errors = {};
  const data = {};

  const title = String(document_title ?? "").trim().toLowerCase();
  if (!DOCUMENT_TITLES.includes(title)) {
    errors.document_title = "Choose Invoice or Receipt.";
  } else {
    data.document_title = title;
  }

  if (!startingLocked) {
    const startingText = String(starting_invoice_number ?? "").trim();
    if (!startingText) {
      data.starting_invoice_number = null;
    } else if (!DIGITS_PATTERN.test(startingText) || Number(startingText) <= 0) {
      errors.starting_invoice_number = "Enter the starting number as a positive whole number.";
    } else if (startingText.replace(/^0+/, "").length > MAX_STARTING_NUMBER_DIGITS) {
      errors.starting_invoice_number = `The starting number can have at most ${MAX_STARTING_NUMBER_DIGITS} digits.`;
    } else {
      data.starting_invoice_number = Number(startingText);
    }
  }

  const taxOn = parseTaxEnabled(tax_enabled);
  data.tax_enabled = taxOn;

  if (taxOn) {
    const nameText = String(tax_name ?? "").trim();
    if (!nameText) {
      errors.tax_name = "Enter the tax name.";
    } else if (nameText.length > MAX_TAX_NAME_LENGTH) {
      errors.tax_name = `Tax name must be ${MAX_TAX_NAME_LENGTH} characters or fewer.`;
    } else {
      data.tax_name = nameText;
    }

    const rateText = String(tax_rate ?? "").trim();
    if (!rateText) {
      errors.tax_rate = "Enter the tax rate.";
    } else if (!RATE_PATTERN.test(rateText)) {
      errors.tax_rate = "Enter the tax rate as a number, for example 18 or 5.5.";
    } else if ((rateText.split(".")[1] ?? "").length > MAX_TAX_RATE_DECIMALS) {
      errors.tax_rate = `The tax rate can have at most ${MAX_TAX_RATE_DECIMALS} decimal places.`;
    } else if (Number(rateText) <= 0 || Number(rateText) >= 100) {
      errors.tax_rate = "The tax rate must be above 0 and below 100.";
    } else {
      data.tax_rate = Number(rateText);
    }
  }

  const termsText = String(terms ?? "").trim();
  if (termsText.length > MAX_TERMS_LENGTH) {
    errors.terms = `Terms & Conditions must be ${MAX_TERMS_LENGTH} characters or fewer.`;
  } else {
    data.terms = termsText || null;
  }

  const nameText = String(signatory_name ?? "").trim();
  if (nameText.length > MAX_SIGNATORY_NAME_LENGTH) {
    errors.signatory_name = `Signatory name must be ${MAX_SIGNATORY_NAME_LENGTH} characters or fewer.`;
  } else {
    data.signatory_name = nameText || null;
  }

  const designationText = String(signatory_designation ?? "").trim();
  if (designationText.length > MAX_SIGNATORY_DESIGNATION_LENGTH) {
    errors.signatory_designation = `Signatory designation must be ${MAX_SIGNATORY_DESIGNATION_LENGTH} characters or fewer.`;
  } else {
    data.signatory_designation = designationText || null;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return { success: true, data };
}
