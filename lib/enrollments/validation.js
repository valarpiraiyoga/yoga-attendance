/**
 * Validation for the Batch Enrollment form fields (Add/Edit Batch
 * Enrollment, wireframe p13).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes.
 */

// Native <input type="date"> always submits (or is empty) in this format.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ENROLLMENT_STATUSES = ["active", "inactive"];

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Validates the editable enrollment fields: batch, effective start date,
 * effective end date. Status is deliberately excluded from this validator —
 * `createEnrollment` always writes 'active' (the database default) and
 * `updateEnrollment` validates it separately via `validateEnrollmentStatus`,
 * the same split used by lib/students/validation.js.
 *
 * @param {{ batch_id?: unknown, effective_start_date?: unknown, effective_end_date?: unknown }} input
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateEnrollmentInput({ batch_id, effective_start_date, effective_end_date } = {}) {
  const errors = {};

  const trimmedBatchId = String(batch_id ?? "").trim();
  if (!trimmedBatchId) {
    errors.batch_id = "Select a batch.";
  }

  const trimmedStart = String(effective_start_date ?? "").trim();
  if (!trimmedStart) {
    errors.effective_start_date = "Enrollment start date is required.";
  } else if (!isValidDateString(trimmedStart)) {
    errors.effective_start_date = "Enter a valid start date.";
  }

  const trimmedEnd = String(effective_end_date ?? "").trim();
  if (trimmedEnd) {
    if (!isValidDateString(trimmedEnd)) {
      errors.effective_end_date = "Enter a valid end date.";
    } else if (!errors.effective_start_date && trimmedEnd < trimmedStart) {
      errors.effective_end_date = "End date cannot be before the start date.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      batch_id: trimmedBatchId,
      effective_start_date: trimmedStart,
      effective_end_date: trimmedEnd || null,
    },
  };
}

/**
 * Validates a status value for the Edit Enrollment form's Status field.
 *
 * @param {unknown} status
 * @returns {{ success: true, data: "active"|"inactive" }
 *         | { success: false, errors: { status: string } }}
 */
export function validateEnrollmentStatus(status) {
  if (!ENROLLMENT_STATUSES.includes(status)) {
    return {
      success: false,
      errors: { status: "Status must be active or inactive." },
    };
  }

  return { success: true, data: status };
}

/**
 * Validates the Add/Edit Enrollment form's schedule picker (01-product.md
 * §4 "Schedule Assignment") — at least one schedule series must be
 * selected, since an enrollment with none is eligible for nothing. Trims
 * and de-duplicates; does not check that the selected series actually
 * belong to the submitted batch — `createEnrollment`/`updateEnrollment`
 * verify that against the database, where it is authoritative, rather
 * than trusting whatever the client happened to render.
 *
 * @param {unknown} scheduleSeriesIds - Expected: `string[]` (a FormData `getAll()` result).
 * @returns {{ success: true, data: string[] } | { success: false, errors: { schedule_series_ids: string } }}
 */
export function validateScheduleSelection(scheduleSeriesIds) {
  const ids = (Array.isArray(scheduleSeriesIds) ? scheduleSeriesIds : [scheduleSeriesIds])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length === 0) {
    return {
      success: false,
      errors: { schedule_series_ids: "Select at least one schedule." },
    };
  }

  return { success: true, data: uniqueIds };
}

/**
 * Validates the effective date for a schedule *assignment* change on an
 * existing enrollment (Edit Batch Enrollment, when the schedule selection
 * itself changes) — distinct from the enrollment's own effective start/end
 * dates. Cannot be back-dated, mirroring `updateSchedule`'s identical rule
 * for schedule versioning (01-product.md §7): a past date would rewrite
 * which schedule a student was attending on a date that has already
 * happened.
 *
 * @param {unknown} date
 * @param {string} today - "YYYY-MM-DD", the caller's own notion of today (centre timezone where relevant).
 * @returns {{ success: true, data: string } | { success: false, errors: { schedule_effective_date: string } }}
 */
export function validateScheduleChangeDate(date, today) {
  const trimmed = String(date ?? "").trim();

  if (!trimmed || !isValidDateString(trimmed)) {
    return {
      success: false,
      errors: { schedule_effective_date: "Enter a valid date for the schedule change." },
    };
  }

  if (trimmed < today) {
    return {
      success: false,
      errors: { schedule_effective_date: "The schedule change cannot be back-dated." },
    };
  }

  return { success: true, data: trimmed };
}
