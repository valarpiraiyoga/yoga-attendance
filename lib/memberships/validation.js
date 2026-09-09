/**
 * Validation for the Membership form fields (Add/Edit Membership).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes: callers get back
 * trimmed/normalized values ready to write to the database, never the raw
 * form input.
 */

// Native <input type="date"> always submits (or is empty) in this format.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MAX_NOTES_LENGTH = 1000;

export const MEMBERSHIP_PLANS = ["monthly", "quarterly", "custom"];
export const PAYMENT_STATUSES = ["paid", "pending"];

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addMonthsUTC(dateString, months) {
  const [year, month, day] = dateString.split("-").map(Number);
  // Date.UTC normalizes calendar overflow itself (e.g. 31 Jan + 1 month
  // becomes 3 Mar in a non-leap year, since Feb has no 31st) — the same
  // "roll forward" behavior most calendar-math implementations use.
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

function subtractOneDayUTC(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Renewal's default Start Date (01-product.md §12: "the previous
 * membership's end date plus one day").
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @returns {string} "YYYY-MM-DD".
 */
export function addOneDayUTC(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Derives End Date from Plan and Start Date (01-product.md §5/§12):
 * Monthly = start + 1 month − 1 day, Quarterly = start + 3 months − 1 day,
 * Custom = no derivation, the admin enters it manually.
 *
 * Pure and framework-agnostic so both the client form (live recompute on
 * Plan/Start Date change) and any future server-side default can call it.
 *
 * @param {string} plan - One of MEMBERSHIP_PLANS.
 * @param {string} startDate - "YYYY-MM-DD".
 * @returns {string} "YYYY-MM-DD", or "" if it cannot be derived.
 */
export function calculateMembershipEndDate(plan, startDate) {
  if (!isValidDateString(startDate)) return "";
  if (plan === "monthly") return subtractOneDayUTC(addMonthsUTC(startDate, 1));
  if (plan === "quarterly") return subtractOneDayUTC(addMonthsUTC(startDate, 3));
  return "";
}

/**
 * Validates the editable Membership fields shared by create and update:
 * plan, start date, end date, amount, payment status, notes.
 * membership_code is excluded entirely — system-generated and immutable
 * (0008_memberships.sql), never accepted as input here. Cancellation is
 * excluded too — it is only ever set via the dedicated Cancel Membership
 * action, not this form.
 *
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateMembershipInput({
  plan,
  start_date,
  end_date,
  amount,
  payment_status,
  notes,
} = {}) {
  const errors = {};

  const trimmedPlan = String(plan ?? "").trim().toLowerCase();
  if (!trimmedPlan) {
    errors.plan = "Select a plan.";
  } else if (!MEMBERSHIP_PLANS.includes(trimmedPlan)) {
    errors.plan = "Select a valid plan.";
  }

  const trimmedStart = String(start_date ?? "").trim();
  if (!trimmedStart) {
    errors.start_date = "Start date is required.";
  } else if (!isValidDateString(trimmedStart)) {
    errors.start_date = "Enter a valid start date.";
  }

  const trimmedEnd = String(end_date ?? "").trim();
  if (!trimmedEnd) {
    errors.end_date = "End date is required.";
  } else if (!isValidDateString(trimmedEnd)) {
    errors.end_date = "Enter a valid end date.";
  } else if (!errors.start_date && trimmedEnd < trimmedStart) {
    errors.end_date = "End date cannot be before the start date.";
  }

  const trimmedAmount = String(amount ?? "").trim();
  const numericAmount = Number(trimmedAmount);
  if (!trimmedAmount) {
    errors.amount = "Amount is required.";
  } else if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    errors.amount = "Enter a valid amount greater than 0.";
  }

  const trimmedPaymentStatus = String(payment_status ?? "").trim().toLowerCase() || "pending";
  if (!PAYMENT_STATUSES.includes(trimmedPaymentStatus)) {
    errors.payment_status = "Select a valid payment status.";
  }

  const trimmedNotes = String(notes ?? "").trim();
  if (trimmedNotes.length > MAX_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      plan: trimmedPlan,
      start_date: trimmedStart,
      end_date: trimmedEnd,
      amount: numericAmount,
      payment_status: trimmedPaymentStatus,
      notes: trimmedNotes || null,
    },
  };
}
