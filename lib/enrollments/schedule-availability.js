/**
 * What the Add / Edit Enrollment schedule picker shows about each schedule's places, and which schedules it lets the Admin newly
 * tick (V1 Final Improvements, S4; 01-product.md §7 "Schedule Capacity", 02-ux.md Flow 10 "Schedule capacity"). Pure: no
 * Supabase, no Next.js, so every rule is testable. The figures come from `lib/schedules/capacity.js` (`scheduleCapacity(...)`),
 * read on the server for the page and passed down as a plain object keyed by schedule series id.
 *
 * Everything here is a GUIDE: the database's checks (migration 0060, saved through `create_enrollment` / `change_enrollment`)
 * decide whether a save is accepted, and a schedule that fills up meanwhile is refused there with a clear message.
 */

/**
 * True when the enrollment, as stored, takes places in its schedules today: it is active and has no end date or ends on or after
 * the centre's today - 0060's own reading. An inactive or ended enrollment takes none.
 *
 * @param {{ status?: string, effective_end_date?: string|null }|null|undefined} enrollment
 * @param {string} today - "YYYY-MM-DD", the centre's date.
 * @returns {boolean}
 */
export function enrollmentTakesPlaces(enrollment, today) {
  if (!enrollment || enrollment.status !== "active") return false;
  return !enrollment.effective_end_date || enrollment.effective_end_date >= today;
}

/**
 * True when the assignment takes a place on `today` as far as ITS OWN dates go: it has no end date or ends on or after today.
 * The start date plays no part - a future-dated assignment already takes its place (0060, and what `updateEnrollment` reads
 * as "currently assigned"). Whether it counts also depends on its enrollment (`enrollmentTakesPlaces`).
 *
 * @param {{ effective_end_date?: string|null }|null|undefined} assignment
 * @param {string} today - "YYYY-MM-DD", the centre's date.
 * @returns {boolean}
 */
export function isScheduleAssignmentCurrent(assignment, today) {
  if (!assignment) return false;
  return !assignment.effective_end_date || assignment.effective_end_date >= today;
}

/**
 * The series whose place this enrollment already holds - the ones it can keep ticked even when they are now full, since keeping
 * an assignment takes no new place. A place is held by a current assignment (started or not yet started) of an enrollment that
 * itself takes places. When an edit reactivates an inactive enrollment or extends an ended one, its schedules take places AGAIN,
 * so none is held and a full one is treated like a newly selected schedule (the database refuses it the same way). Nothing is
 * held on a new enrollment.
 *
 * @param {{ status?: string, effective_end_date?: string|null }|null|undefined} enrollment - the stored enrollment (null when adding).
 * @param {{ schedule_series_id: string, effective_end_date?: string|null }[]} assignments - its assignments, any dates.
 * @param {string} today
 * @returns {Set<string>}
 */
export function heldSeriesIdsOf(enrollment, assignments, today) {
  if (!enrollmentTakesPlaces(enrollment, today)) return new Set();
  return new Set((assignments ?? []).filter((assignment) => isScheduleAssignmentCurrent(assignment, today)).map((assignment) => assignment.schedule_series_id));
}

/**
 * True when the enrollment, as the form would save it, takes places in its schedules: it is active and has no end date or ends on
 * or after today. When it does not (it stays or becomes inactive, or ends before today) the database counts none of its
 * assignments, so no schedule is locked for it - saving cannot be refused for capacity. `active` is true for a new
 * enrollment, which is created active. A date that has not been entered yet reads as no end date.
 *
 * @param {{ active: boolean, endDate?: string|null }} saved
 * @param {string} today
 * @returns {boolean}
 */
export function enrollmentWillTakePlaces({ active, endDate }, today) {
  if (!active) return false;
  return !endDate || endDate >= today;
}

/** The places text: "Unlimited", or "10 / 20" (places taken / capacity). Null when nothing is known about the schedule. */
export function capacityText(info) {
  if (!info) return null;
  return info.isUnlimited ? "Unlimited" : `${info.occupied} / ${info.capacity}`;
}

const FULL_HINT = "Full. Places held by future-dated enrollments and schedule changes count.";

/**
 * How one schedule is offered.
 *
 * - No capacity information (it could not be read, or the schedule is unknown): offered freely, with no places text.
 * - Not full: offered freely, with its places text.
 * - Full, but the enrollment as it will be saved takes no place (`restricted` false: inactive, or ended before today): offered
 *   freely - the database counts only active, current enrollments, so nothing is refused. It is marked Full so the Admin knows a
 *   free place will be needed when the enrollment is reactivated or extended.
 * - Full and its place is held by this enrollment: still ticked or unticked freely (keeping it takes no new place).
 * - Full and not held: it cannot be newly ticked. If it is ticked already (a full schedule the enrollment cannot keep - it is being
 *   reactivated or extended - or a form kept after a refused save) it can be unticked, and then not ticked again.
 *
 * @param {{ info?: object|null, checked: boolean, held: boolean, restricted?: boolean }} input - `restricted`: the enrollment will
 *   take places when saved (`enrollmentWillTakePlaces`); true unless the form knows otherwise.
 * @returns {{ text: string|null, isFull: boolean, disabled: boolean, chip: string|null, hint: string|null }}
 */
export function scheduleChoice({ info, checked, held, restricted = true }) {
  if (!info) return { text: null, isFull: false, disabled: false, chip: null, hint: null };

  const text = capacityText(info);
  if (!info.isFull) return { text, isFull: false, disabled: false, chip: null, hint: null };

  if (!restricted) {
    return {
      text,
      isFull: true,
      disabled: false,
      chip: "Full",
      hint: `${FULL_HINT} This enrollment is inactive or ended, so it takes no place and can still be saved; a free place will be needed when it is reactivated or extended.`,
    };
  }
  if (held) {
    return { text, isFull: true, disabled: false, chip: "Full · current", hint: `${FULL_HINT} This student already holds a place here, so it can be kept.` };
  }
  if (checked) {
    return { text, isFull: true, disabled: false, chip: "Full · untick", hint: `${FULL_HINT} It cannot be saved: untick it, or raise its capacity first.` };
  }
  return { text, isFull: true, disabled: true, chip: "Full", hint: `${FULL_HINT} Raise its capacity first, or choose another schedule.` };
}

/**
 * True when the batch has schedules to offer, capacity is known for all of them, and not one of them can be newly ticked - the
 * "every schedule full" state (02-ux.md Flow 10), where the Admin is told to raise a capacity first instead of meeting only
 * disabled options. A schedule the enrollment holds, or that has room or no limit, makes it false - and so does an enrollment that
 * will take no place (`restricted` false), for which nothing is locked.
 *
 * @param {{ series_id: string }[]} schedules - the picker's options for the chosen batch.
 * @param {Record<string, object>|null|undefined} capacities
 * @param {Set<string>} heldSeriesIds
 * @param {boolean} [restricted] - `enrollmentWillTakePlaces(...)`.
 * @returns {boolean}
 */
export function everyScheduleFull(schedules, capacities, heldSeriesIds, restricted = true) {
  if (!restricted || !capacities || !schedules || schedules.length === 0) return false;
  return schedules.every((schedule) => {
    const info = capacities[schedule.series_id];
    return Boolean(info?.isFull) && !heldSeriesIds.has(schedule.series_id);
  });
}
