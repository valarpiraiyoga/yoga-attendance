/**
 * Validation and status derivation for Class Sessions. Plain functions, no
 * schema library — consistent with the rest of the project.
 *
 * `validateSessionEditInput` (Flow 06 — Edit This Session) is the only
 * field-by-field form validator so far. Cancel/Holiday (Flow 07) is still
 * later Phase 14 UI work — `validateSessionNote` exists ahead of it because
 * it is a direct, cheap encoding of an already-approved decision, not
 * because that form exists yet.
 */

const MAX_NOTE_LENGTH = 500;

// Native <input type="time"> always submits (or is empty) in this format.
// Duplicated from lib/schedules/validation.js's identical private pattern
// rather than exporting that module's `isValidTimeString` — Schedule and
// Class Session are separate feature areas with their own validators
// elsewhere in this codebase (e.g. each module's own `escapeForOrFilter`),
// and this keeps that boundary consistent.
const TIME_PATTERN = /^\d{2}:\d{2}$/;

function isValidTimeString(value) {
  if (!TIME_PATTERN.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

// Persisted values only (01-product.md §7A "Session Status") — Upcoming and
// Ongoing are never stored, so they are not in this list; see
// `deriveDisplayStatus` below for where they come from instead.
export const SESSION_STATUSES = ["scheduled", "completed", "cancelled", "holiday"];

export const DISPLAY_STATUSES = ["upcoming", "in_progress", "completed", "cancelled", "holiday"];

export const DISPLAY_STATUS_LABELS = {
  upcoming: "Upcoming",
  in_progress: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
  holiday: "Holiday",
};

// Badge `variant` (components/ui/badge.jsx) per display status — one shared
// mapping so Today's Sessions, All Sessions and Session Details render the
// same status the same way rather than each inventing its own.
export const DISPLAY_STATUS_BADGE_VARIANTS = {
  upcoming: "outline",
  in_progress: "default",
  completed: "success",
  cancelled: "danger",
  holiday: "neutral",
};

/**
 * Trims and length-checks an optional note (Flow 07's "Optional Note").
 * Not wired to any form in this slice — provided now so the Cancel/Holiday
 * action, when it is built, has a validator ready rather than needing one
 * invented alongside a form under time pressure.
 *
 * @param {unknown} note
 * @returns {{ success: true, data: string|null } | { success: false, errors: { note: string } }}
 */
export function validateSessionNote(note) {
  const trimmed = String(note ?? "").trim();

  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      success: false,
      errors: { note: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` },
    };
  }

  return { success: true, data: trimmed || null };
}

/**
 * Validates the editable fields for Flow 06 — Edit This Session
 * (02-ux.md "06 — Admin: Change One Specific Session"): instructor and
 * start/end time only. Deliberately narrower than
 * `lib/schedules/validation.js`'s `validateScheduleInput`: a session edit
 * can never change date or batch (approved Phase 14 decision — a session
 * belongs to exactly one schedule and one date), so there is nothing to
 * validate for those fields here.
 *
 * @param {object} input
 * @param {unknown} input.instructor_id
 * @param {unknown} input.start_time - "HH:MM".
 * @param {unknown} input.end_time - "HH:MM".
 * @returns {{ success: true, data: object } | { success: false, errors: Record<string, string> }}
 */
export function validateSessionEditInput({ instructor_id, start_time, end_time } = {}) {
  const errors = {};

  const trimmedInstructorId = String(instructor_id ?? "").trim();
  if (!trimmedInstructorId) {
    errors.instructor_id = "Select an instructor.";
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

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      instructor_id: trimmedInstructorId,
      start_time: trimmedStart,
      end_time: trimmedEnd,
    },
  };
}

/**
 * The centre timezone Upcoming/Ongoing/Completed (and every "today") are
 * derived against (01-product.md §7A "Centre Timezone"; §12 "Class Session":
 * "Upcoming and Ongoing are derived from the session's date and time in
 * the centre timezone, never stored").
 *
 * The zone is the CENTRE's - a Center Settings value (`center_profile.timezone`,
 * read on the server by `getCenterSettings()`), one zone for the whole centre.
 * It is never the browser's or the user's: an admin opening the app from another
 * country still sees the centre's own day. It is not a multi-branch or per-user
 * setting.
 *
 * Every helper below takes the zone as a parameter, so this module stays pure
 * (no server or database access) and testable. `DEFAULT_CENTRE_TIMEZONE` is what
 * the parameter defaults to - the value a centre has until it chooses another
 * (and what every centre had before the setting existed) - so a caller that has
 * no configured zone yet behaves exactly as the app always has.
 */
export const DEFAULT_CENTRE_TIMEZONE = "Asia/Kolkata";

// Formats a UTC instant as the centre's own wall-clock date and time
// ("YYYY-MM-DDTHH:MM:SS"), the same shape `session_date`/`start_time`/
// `end_time` are already stored in — so comparing "now" against a session's
// stored boundary is a plain string/lexicographic comparison, not a
// timezone-aware Date comparison, which is what actually makes the
// comparison correct: `session_date`+`start_time` are wall-clock values
// with no timezone info written into them at all, meaning as data they only
// have a meaning once you already know what clock they were written
// against — and per the rule above, that clock is always CENTRE_TIMEZONE.
// `hourCycle: "h23"` avoids the "24" instead of "00" quirk some ICU
// implementations produce for midnight under `hour12: false`.
// One formatter per zone: building an `Intl.DateTimeFormat` is the expensive
// part, and a centre only ever has one zone in practice.
const centreTimeFormatters = new Map();

function centreTimeFormatter(timeZone) {
  let formatter = centreTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    centreTimeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function nowInCentreTimezone(now, timeZone = DEFAULT_CENTRE_TIMEZONE) {
  const parts = centreTimeFormatter(timeZone).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * "Today" as a "YYYY-MM-DD" date in the centre timezone — the Today's Sessions
 * screen's own notion of "today" (01-product.md §7A "Centre Timezone"), which
 * is deliberately never the server's own UTC date (which is the wrong day
 * for part of every centre day: near midnight IST it is yesterday, and in the
 * Americas it is tomorrow by the evening) nor the viewer's device date. Shares the same
 * `centreTimeFormatter`/`nowInCentreTimezone` `deriveDisplayStatus` already
 * uses, so both "today" and "is this session upcoming/ongoing/completed"
 * are always read from the same clock.
 *
 * @param {Date} [now] - Defaults to the current time; overridable for testing.
 * @param {string} [timeZone] - The centre's IANA zone (`getCenterSettings().timezone`).
 * @returns {string} "YYYY-MM-DD".
 */
export function todayInCentreTimezone(now = new Date(), timeZone = DEFAULT_CENTRE_TIMEZONE) {
  return nowInCentreTimezone(now, timeZone).slice(0, 10);
}

/**
 * The centre's calendar date ("YYYY-MM-DD") of a stored instant - a timestamp
 * such as `created_at` or `cancelled_at`, which Postgres holds in UTC. Read
 * with `String(ts).slice(0, 10)` it would be the UTC date, a day off from the
 * centre's for part of every day; this is the date the centre actually lived
 * it on (and the one the database's own eligibility rules use for a
 * cancellation).
 *
 * @param {string|Date} instant - an ISO timestamp.
 * @param {string} [timeZone]
 */
export function centreDateOf(instant, timeZone = DEFAULT_CENTRE_TIMEZONE) {
  return todayInCentreTimezone(new Date(instant), timeZone);
}

/**
 * The centre's current hour (0-23) - what the Dashboard greeting reads.
 *
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function hourInCentreTimezone(now = new Date(), timeZone = DEFAULT_CENTRE_TIMEZONE) {
  return Number(nowInCentreTimezone(now, timeZone).slice(11, 13));
}

/**
 * Maps a class session's persisted status to the five values the UI
 * displays (01-product.md §7A "Session Status"). `completed`/`cancelled`/
 * `holiday` pass straight through unchanged. `scheduled` splits into three,
 * by comparing the current time in the centre timezone against the session's
 * own date and time:
 *
 * - before `start_time` → `upcoming`
 * - from `start_time` through `end_time` (inclusive) → `in_progress`
 * - after `end_time` → `completed`
 *
 * That last case is a **display-only** reading, never a write: a session
 * whose end time has passed while still persisted `scheduled` is shown as
 * `completed` here without this function — or anything that calls it —
 * ever touching the stored `status` column. The row stays `scheduled` in
 * the database until a later, separately-defined completion event
 * (Phase 15's attendance flow) actually persists `completed`. Conflating
 * "looks completed right now" with "is recorded as completed" would let the
 * clock silently rewrite a database value nothing explicitly asked to
 * change — exactly what `01-product.md` §12's Historical Integrity rules
 * exist to prevent elsewhere in this product.
 *
 * Not yet called by any screen in this slice — provided as part of the
 * "foundation" this task asks for, alongside `SESSION_STATUSES`/
 * `DISPLAY_STATUSES`, since it is a direct, cheap encoding of an
 * already-approved decision rather than something a later slice should
 * have to redo from scratch.
 *
 * @param {{ status: string, session_date: string, start_time: string, end_time: string }} session
 * @param {Date} [now] - Defaults to the current time; overridable for testing.
 * @param {string} [timeZone] - The centre's IANA zone (`getCenterSettings().timezone`).
 * @returns {"upcoming"|"in_progress"|"completed"|"cancelled"|"holiday"}
 */
export function deriveDisplayStatus(session, now = new Date(), timeZone = DEFAULT_CENTRE_TIMEZONE) {
  if (session.status !== "scheduled") {
    return session.status;
  }

  const nowInCentre = nowInCentreTimezone(now, timeZone);
  const start = `${session.session_date}T${session.start_time}`;
  const end = `${session.session_date}T${session.end_time}`;

  if (nowInCentre < start) return "upcoming";
  if (nowInCentre <= end) return "in_progress";
  return "completed";
}
