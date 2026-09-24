/**
 * Validation for the Schedule form fields (Add/Edit Schedule).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes: callers get back
 * trimmed/normalized values ready to write to the database, never the raw
 * form input.
 */

// Native <input type="date"> / <input type="time"> always submit (or are
// empty) in these formats.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const DEFAULT_DURATION_MINUTES = 60;

export const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const DAY_LABELS = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export const SCHEDULE_STATUSES = ["active", "inactive"];

export function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The day before a given date — used to close the current version of a
 * schedule the day before an edit's new version takes effect
 * (01-product.md §7's versioning rule).
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @returns {string} "YYYY-MM-DD".
 */
export function subtractOneDayUTC(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * Adds (or, with a negative count, subtracts) whole days to a date — used
 * for the Weekly Schedule view's Previous/Next week navigation and for
 * stepping across a displayed week's seven days.
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @param {number} days
 * @returns {string} "YYYY-MM-DD".
 */
export function addDaysUTC(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The Monday on or before the given date — the Weekly Schedule view's week
 * boundary (02-ux.md: "Monday–Sunday columns"). Postgres/JS `getUTCDay()`
 * returns 0 for Sunday, so Sunday is treated as 6 days after the preceding
 * Monday rather than 0.
 *
 * @param {string} dateString - "YYYY-MM-DD".
 * @returns {string} "YYYY-MM-DD", always a Monday.
 */
export function getMondayOfWeek(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const jsDay = date.getUTCDay();
  const daysSinceMonday = (jsDay + 6) % 7;
  return addDaysUTC(dateString, -daysSinceMonday);
}

/**
 * Minutes since midnight for an "HH:MM" time string — the common unit the
 * Weekly Schedule grid positions cards in (02-ux.md D14: a fixed 6:00 AM–
 * 10:00 PM axis).
 *
 * @param {string} timeString - "HH:MM".
 * @returns {number}
 */
export function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

function isValidTimeString(value) {
  if (!TIME_PATTERN.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Derives End Time from Start Time (01-product.md §7: "Default duration is
 * 60 minutes... automatically calculates the end time... editable"). Pure
 * and framework-agnostic so both the client form (live recompute on Start
 * Time change) and this module's own validation can call it.
 *
 * Returns "" rather than a wrapped-past-midnight time when the default
 * duration would cross into the next day — a class starting at 23:30 has no
 * same-day +60-minute end time, so the admin must enter one manually rather
 * than being handed a silently wrong value.
 *
 * @param {string} startTime - "HH:MM".
 * @returns {string} "HH:MM", or "" if it cannot be derived same-day.
 */
export function calculateEndTime(startTime) {
  if (!isValidTimeString(startTime)) return "";

  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + DEFAULT_DURATION_MINUTES;
  if (totalMinutes >= 24 * 60) return "";

  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

/**
 * Whether `schedule` belongs on `date` — the Weekly Schedule grid's per-cell
 * test: same weekday as `dayOfWeek` and within its effective period.
 *
 * `day_of_week` is compared normalized (trimmed, lower-cased), the same
 * normalization `validateScheduleInput` already applies on every write. A row
 * whose stored value isn't already in that exact canonical form — data
 * written before this normalization existed, or edited directly — would
 * otherwise match none of the seven day columns under a plain `===` and
 * silently vanish from the whole weekly grid, while still displaying
 * correctly anywhere that falls back to showing the raw value
 * (`DAY_LABELS[x] ?? x`, e.g. List View, Card View, Schedule Details).
 *
 * @param {{ day_of_week: string, effective_from: string, effective_until: string|null }} schedule
 * @param {string} dayOfWeek - one of DAYS_OF_WEEK, e.g. "monday".
 * @param {string} date - "YYYY-MM-DD", the specific date of that weekday in the displayed week.
 * @returns {boolean}
 */
export function scheduleAppliesOn(schedule, dayOfWeek, date) {
  const normalizedDay = String(schedule.day_of_week ?? "").trim().toLowerCase();
  if (normalizedDay !== dayOfWeek) return false;
  if (date < schedule.effective_from) return false;
  if (schedule.effective_until && date > schedule.effective_until) return false;
  return true;
}

/**
 * Validates the days chosen on Add Schedule, where one submission can create a
 * schedule for several weekdays at once. Returns them de-duplicated, in
 * Monday-first week order.
 *
 * @param {unknown[]} days
 * @returns {{ success: true, data: string[] } | { success: false, errors: { day_of_week: string } }}
 */
export function validateScheduleDays(days) {
  const chosen = [...new Set((days ?? []).map((day) => String(day ?? "").trim().toLowerCase()).filter(Boolean))];

  if (chosen.length === 0) {
    return { success: false, errors: { day_of_week: "Select at least one day." } };
  }
  if (chosen.some((day) => !DAYS_OF_WEEK.includes(day))) {
    return { success: false, errors: { day_of_week: "Select valid days of the week." } };
  }

  return { success: true, data: DAYS_OF_WEEK.filter((day) => chosen.includes(day)) };
}

/**
 * Validates the time slots chosen on Add Schedule, where one submission can
 * create schedules for several independent time ranges (each applied to
 * every selected day — the day × slot cross product). Mirrors
 * `validateScheduleDays`'s shape (an array of the same repeated form field,
 * validated as a set) rather than introducing a new validation convention.
 *
 * Each slot uses the exact per-slot rule `validateScheduleInput` already
 * enforces for its single start/end pair — valid times, end after start.
 * Duplicate or overlapping slots are NOT rejected: V1 has no
 * overlap/uniqueness constraint on schedules (lib/schedules/actions.js's own
 * comment), so two identical slots simply create two separate schedule
 * records, same as any other pair of schedules today.
 *
 * @param {unknown[]} startTimes - `formData.getAll("start_time")`.
 * @param {unknown[]} endTimes - `formData.getAll("end_time")`, same length/order.
 * @returns {{ success: true, data: { start_time: string, end_time: string }[] }
 *          | { success: false, errors: Record<string, string>[] }} `errors` is
 *          parallel to the slots — one (possibly empty) error object per slot.
 */
export function validateTimeSlots(startTimes, endTimes) {
  const count = Math.max((startTimes ?? []).length, (endTimes ?? []).length);

  if (count === 0) {
    return { success: false, errors: [{ start_time: "Add at least one time slot." }] };
  }

  const errors = [];
  const data = [];
  for (let index = 0; index < count; index += 1) {
    const start = String(startTimes?.[index] ?? "").trim();
    const end = String(endTimes?.[index] ?? "").trim();
    const slotErrors = {};

    if (!start) {
      slotErrors.start_time = "Start time is required.";
    } else if (!isValidTimeString(start)) {
      slotErrors.start_time = "Enter a valid start time.";
    }

    if (!end) {
      slotErrors.end_time = "End time is required.";
    } else if (!isValidTimeString(end)) {
      slotErrors.end_time = "Enter a valid end time.";
    } else if (!slotErrors.start_time && end <= start) {
      slotErrors.end_time = "End time must be later than start time.";
    }

    errors.push(slotErrors);
    data.push({ start_time: start, end_time: end });
  }

  const success = errors.every((slotErrors) => Object.keys(slotErrors).length === 0);
  return success ? { success: true, data } : { success: false, errors };
}

/**
 * Validates the editable Schedule fields shared by create and update: batch,
 * instructor, day of week, start/end time, effective from/until.
 * `status` is excluded — new schedules always start active via the database
 * default, and status only changes through the dedicated Deactivate action
 * (there is no reactivate flow — see app/schedule/[id]/deactivate-schedule.js).
 *
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateScheduleInput({
  batch_id,
  instructor_id,
  day_of_week,
  start_time,
  end_time,
  effective_from,
  effective_until,
} = {}) {
  const errors = {};

  const trimmedBatchId = String(batch_id ?? "").trim();
  if (!trimmedBatchId) {
    errors.batch_id = "Select a batch.";
  }

  const trimmedInstructorId = String(instructor_id ?? "").trim();
  if (!trimmedInstructorId) {
    errors.instructor_id = "Select an instructor.";
  }

  const trimmedDay = String(day_of_week ?? "").trim().toLowerCase();
  if (!trimmedDay) {
    errors.day_of_week = "Select a day of week.";
  } else if (!DAYS_OF_WEEK.includes(trimmedDay)) {
    errors.day_of_week = "Select a valid day of week.";
  }

  const trimmedStart = String(start_time ?? "").trim();
  if (!trimmedStart) {
    errors.start_time = "Start time is required.";
  } else if (!isValidTimeString(trimmedStart)) {
    errors.start_time = "Enter a valid start time.";
  }

  const trimmedEnd = String(end_time ?? "").trim();
  if (!trimmedEnd) {
    errors.end_time = "End time is required.";
  } else if (!isValidTimeString(trimmedEnd)) {
    errors.end_time = "Enter a valid end time.";
  } else if (!errors.start_time && trimmedEnd <= trimmedStart) {
    errors.end_time = "End time must be later than start time.";
  }

  const trimmedFrom = String(effective_from ?? "").trim();
  if (!trimmedFrom) {
    errors.effective_from = "Effective from date is required.";
  } else if (!isValidDateString(trimmedFrom)) {
    errors.effective_from = "Enter a valid effective from date.";
  }

  const trimmedUntil = String(effective_until ?? "").trim();
  if (trimmedUntil) {
    if (!isValidDateString(trimmedUntil)) {
      errors.effective_until = "Enter a valid effective until date.";
    } else if (!errors.effective_from && trimmedUntil < trimmedFrom) {
      errors.effective_until = "Effective until cannot be before effective from.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      batch_id: trimmedBatchId,
      instructor_id: trimmedInstructorId,
      day_of_week: trimmedDay,
      start_time: trimmedStart,
      end_time: trimmedEnd,
      effective_from: trimmedFrom,
      effective_until: trimmedUntil || null,
    },
  };
}

const DAY_ORDER = Object.fromEntries(DAYS_OF_WEEK.map((day, index) => [day, index]));

/**
 * Groups a flat list of schedule records by batch — the Schedule List Cards
 * view's "one card per batch, its schedules as rows inside it" presentation
 * (rather than one card per schedule record). Presentation-only: never
 * drops, merges or deduplicates a record — every schedule in `schedules`
 * appears in exactly one group's `schedules` array, so
 * `sum(groups.map(g => g.schedules.length)) === schedules.length` always
 * holds, whatever page/filter produced `schedules`.
 *
 * Group (batch) order is each batch's FIRST appearance in `schedules` — i.e.
 * whatever sort the caller already applied to the flat list (Newest First /
 * Oldest First by Effective From, `SCHEDULE_SORTS`) still decides which
 * batch's card comes first. Grouping does not introduce a new batch-level
 * sort or otherwise touch the existing sort/filter/search/pagination
 * contract — it runs on whatever page of already-filtered, already-sorted
 * records the caller hands it.
 *
 * Within a group, schedules are ordered Monday → Sunday, then by start time
 * — the same natural weekly reading order `listCurrentSchedules` and the
 * Weekly Schedule grid already use — independent of the outer sort, and
 * with each schedule's own `id` as the final tie-break for a stable order.
 *
 * @param {{ id: string, batch_id: string, batches: object|null, day_of_week: string, start_time: string }[]} schedules
 * @returns {{ batch: object|null, batchId: string, schedules: object[] }[]}
 */
export function groupSchedulesByBatch(schedules) {
  const order = [];
  const byBatchId = new Map();

  for (const schedule of schedules) {
    const batchId = schedule.batch_id;
    if (!byBatchId.has(batchId)) {
      byBatchId.set(batchId, { batch: schedule.batches ?? null, batchId, schedules: [] });
      order.push(batchId);
    }
    byBatchId.get(batchId).schedules.push(schedule);
  }

  for (const group of byBatchId.values()) {
    group.schedules.sort(
      (a, b) =>
        (DAY_ORDER[a.day_of_week] ?? 7) - (DAY_ORDER[b.day_of_week] ?? 7) ||
        String(a.start_time).localeCompare(String(b.start_time)) ||
        String(a.id).localeCompare(String(b.id))
    );
  }

  return order.map((batchId) => byBatchId.get(batchId));
}
