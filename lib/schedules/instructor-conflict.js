// Instructor schedule conflicts (V1 Final Improvements, C2b; 01-product.md §7 "Conflicts"). Pure: no Next.js, no Supabase, so `npm test` loads it
// under plain Node (relative imports only), and the form, the server actions and the error mapper all share one definition.
//
// Two schedules CONFLICT when all of these hold - the same rule migration 0062's trigger enforces, which stays the final authority:
//   * the same instructor and the same day of the week;
//   * overlapping times: each starts before the other ends (back-to-back classes do not overlap);
//   * overlapping effective periods, endpoints inclusive, a missing effective until meaning no end.
// A schedule's Active / Inactive status plays no part: only its dates do.

import { formatDate, formatTimeRange } from "../format.js";

/** SQLSTATE the database raises for a conflict (migration 0062, `exclusion_violation`). The code alone never proves one - see `parseConflictDetail`. */
export const INSTRUCTOR_CONFLICT_CODE = "23P01";

/** `DETAIL.reason` of the database's conflict error. */
export const INSTRUCTOR_CONFLICT_REASON = "instructor_conflict";

/** Shown when the database refuses a conflict but did not say which class it conflicts with. */
const CONFLICT_SENTENCE = "This instructor already has a class at an overlapping time on that day.";
const CONFLICT_ADVICE = "Change the time, day, instructor or dates.";

// "06:00:00" (a database time) and "06:00" (a form value) compare as the same time.
const hhmm = (value) => String(value ?? "").slice(0, 5);
const isOpen = (value) => value === null || value === undefined || value === "";

/** Whether two time intervals overlap. Back-to-back (one ends exactly when the other starts) does not. */
export function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return hhmm(aStart) < hhmm(bEnd) && hhmm(bStart) < hhmm(aEnd);
}

/** Whether two effective periods overlap: endpoints are inclusive and an empty / null until is open-ended. ISO dates compare as text. */
export function datesOverlap(aFrom, aUntil, bFrom, bUntil) {
  return (isOpen(bUntil) || aFrom <= bUntil) && (isOpen(aUntil) || bFrom <= aUntil);
}

/**
 * Whether two schedules conflict. Each is `{ instructor_id, day_of_week, start_time, end_time, effective_from, effective_until }`.
 * Status is ignored on purpose.
 */
export function schedulesConflict(a, b) {
  return (
    a.instructor_id === b.instructor_id &&
    a.day_of_week === b.day_of_week &&
    timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time) &&
    datesOverlap(a.effective_from, a.effective_until, b.effective_from, b.effective_until)
  );
}

/**
 * Add Schedule creates one schedule per day x time slot for ONE instructor and ONE effective period, so two slots whose times overlap
 * conflict on every ticked day. Returns one entry per slot that overlaps an EARLIER slot: `{ index, with }` (the earlier slot's index).
 * Slots without a usable start and end are skipped (the slot validation reports them).
 *
 * @param {{ start_time?: string, end_time?: string }[]} slots
 * @returns {{ index: number, with: number }[]}
 */
export function findOverlappingSlots(slots) {
  const usable = (slot) => slot && hhmm(slot.start_time) && hhmm(slot.end_time) && hhmm(slot.start_time) < hhmm(slot.end_time);
  const found = [];
  for (let index = 1; index < slots.length; index += 1) {
    if (!usable(slots[index])) continue;
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (usable(slots[earlier]) && timesOverlap(slots[earlier].start_time, slots[earlier].end_time, slots[index].start_time, slots[index].end_time)) {
        found.push({ index, with: earlier });
        break;
      }
    }
  }
  return found;
}

/**
 * The first existing schedule the proposed ones would conflict with, in the shape `describeConflict` takes, or null. `proposed` is the
 * day x slot rows an Add Schedule would create (`{ day_of_week, start_time, end_time }`), `period` their shared `{ effective_from,
 * effective_until }`, `existing` the instructor's stored schedules (any status), as read with their batch.
 *
 * @returns {object|null}
 */
export function findInstructorConflict(proposed, period, existing) {
  for (const row of proposed) {
    for (const other of existing ?? []) {
      if (
        other.day_of_week === row.day_of_week &&
        timesOverlap(other.start_time, other.end_time, row.start_time, row.end_time) &&
        datesOverlap(other.effective_from, other.effective_until, period.effective_from, period.effective_until)
      ) {
        return conflictFromSchedule(other);
      }
    }
  }
  return null;
}

/** A stored schedule row (with its `batches` embed, as the schedules reads return it) as the conflict `describeConflict` takes. */
export function conflictFromSchedule(schedule) {
  return {
    batch_name: schedule.batches?.name ?? null,
    batch_code: schedule.batches?.code ?? null,
    day_of_week: schedule.day_of_week,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    effective_from: schedule.effective_from,
    effective_until: schedule.effective_until ?? null,
  };
}

/**
 * The database's conflict DETAIL as an object, or null. Accepted ONLY when it is a JSON object whose `reason` is "instructor_conflict":
 * a malformed or unrelated DETAIL - or any other error that happens to share the SQLSTATE - is not a conflict. Never throws.
 *
 * @param {unknown} details - Supabase's `error.details`.
 * @returns {{ batch_name: string|null, batch_code: string|null, day_of_week: string|null, start_time: string|null, end_time: string|null,
 *             effective_from: string|null, effective_until: string|null } | null}
 */
export function parseConflictDetail(details) {
  if (typeof details !== "string" || details.trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(details);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.reason !== INSTRUCTOR_CONFLICT_REASON) return null;

  const text = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);
  return {
    batch_name: text(parsed.batch_name),
    batch_code: text(parsed.batch_code),
    day_of_week: text(parsed.day_of_week),
    start_time: text(parsed.start_time),
    end_time: text(parsed.end_time),
    effective_from: text(parsed.effective_from),
    effective_until: text(parsed.effective_until),
  };
}

const dayName = (day) => `${day.charAt(0).toUpperCase()}${day.slice(1)}`;

/**
 * The Admin's message for a conflict, built from its details and nothing else: no id, SQLSTATE or database wording.
 * "This instructor already has a class on Monday, 6:00 AM – 7:00 AM, in Hatha Yoga (HY), from Oct 12, 2026 with no end date.
 *  Change the time, day, instructor or dates." Parts the details do not carry are left out; with no day and time at all it is the
 * general sentence.
 *
 * @param {object|null} conflict - `parseConflictDetail`'s or `conflictFromSchedule`'s result.
 * @returns {string}
 */
export function describeConflict(conflict) {
  if (!conflict?.day_of_week || !conflict.start_time || !conflict.end_time) return `${CONFLICT_SENTENCE} ${CONFLICT_ADVICE}`;

  const batch = conflict.batch_name && conflict.batch_code
    ? `${conflict.batch_name} (${conflict.batch_code})`
    : (conflict.batch_name ?? conflict.batch_code);

  let period = "";
  if (conflict.effective_from) {
    period = conflict.effective_until
      ? `, from ${formatDate(conflict.effective_from)} to ${formatDate(conflict.effective_until)}`
      : `, from ${formatDate(conflict.effective_from)} with no end date`;
  }

  return (
    `This instructor already has a class on ${dayName(conflict.day_of_week)}, ` +
    `${formatTimeRange(conflict.start_time, conflict.end_time)}` +
    `${batch ? `, in ${batch}` : ""}${period}. ${CONFLICT_ADVICE}`
  );
}

/**
 * The Admin's message when a Supabase error IS an instructor conflict, else null. Requires both the SQLSTATE and a valid conflict
 * DETAIL, so another exclusion violation (or a refusal without the payload) keeps whatever fallback the caller has.
 *
 * @param {{ code?: string, details?: unknown }|null|undefined} error
 * @returns {string|null}
 */
export function instructorConflictMessage(error) {
  if (error?.code !== INSTRUCTOR_CONFLICT_CODE) return null;
  const conflict = parseConflictDetail(error.details);
  return conflict ? describeConflict(conflict) : null;
}

/** The slot-level message for a time slot that overlaps an earlier one of the same Add Schedule form. */
export function slotOverlapMessage(earlierSlot) {
  return `Overlaps another time slot (${formatTimeRange(earlierSlot.start_time, earlierSlot.end_time)}). One instructor cannot teach two classes at the same time.`;
}
