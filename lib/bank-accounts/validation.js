/**
 * Validation for a bank account (Settings — Invoice / Receipt, Bank Accounts).
 *
 * Plain functions, as in the rest of the project. This checks the SHAPE and the approved LENGTHS
 * only — the same limits bank_accounts has (supabase/migrations/0028): four required details and
 * an optional branch. It does not check what an account number or an IFSC code looks like.
 * Which account is active is never decided here; the database's activation functions do that.
 */

export const MAX_BANK_NAME_LENGTH = 100;
export const MAX_ACCOUNT_NAME_LENGTH = 100;
export const MAX_ACCOUNT_NUMBER_LENGTH = 34;
export const MAX_IFSC_CODE_LENGTH = 20;
export const MAX_BRANCH_LENGTH = 100;

const FIELDS = [
  { key: "bank_name", label: "Bank name", max: MAX_BANK_NAME_LENGTH, required: true },
  { key: "account_name", label: "Account name", max: MAX_ACCOUNT_NAME_LENGTH, required: true },
  { key: "account_number", label: "Account number", max: MAX_ACCOUNT_NUMBER_LENGTH, required: true },
  { key: "ifsc_code", label: "IFSC code", max: MAX_IFSC_CODE_LENGTH, required: true },
  { key: "branch", label: "Branch", max: MAX_BRANCH_LENGTH, required: false },
];

/**
 * @param {object} [input] - bank_name, account_name, account_number, ifsc_code, branch.
 * @returns {{ success: true, data: { bank_name: string, account_name: string, account_number: string, ifsc_code: string, branch: string|null } }
 *   | { success: false, errors: Record<string, string> }}
 */
export function validateBankAccountInput(input = {}) {
  const errors = {};
  const data = {};

  for (const { key, label, max, required } of FIELDS) {
    const raw = input?.[key];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (required) errors[key] = `${label} is required.`;
      else data[key] = null;
      continue;
    }
    if (value.length > max) {
      errors[key] = `${label} must be ${max} characters or fewer.`;
      continue;
    }
    data[key] = value;
  }

  return Object.keys(errors).length ? { success: false, errors } : { success: true, data };
}

/** An account number for the list: everything but the last four characters hidden. */
export function maskAccountNumber(accountNumber) {
  const value = typeof accountNumber === "string" ? accountNumber.trim() : "";
  if (value.length <= 4) return value;
  return `${"•".repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}
