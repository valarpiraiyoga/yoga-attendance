/**
 * Validation and status derivation for Class Sessions (Phase 14 —
 * foundation slice). Plain functions, no schema library — consistent with
 * the rest of the project.
 *
 * Deliberately minimal: this slice has no session-editing form yet (Edit
 * This Session and Cancel/Holiday are later Phase 14 UI work), so there is
 * no field-by-field form validator here the way lib/schedules/validation.js
 * has one for the Schedule form. What exists is only what the
 * materialization helper (lib/class-sessions/actions.js) and its callers
 * actually need today.
 */

const MAX_NOTE_LENGTH = 500;

// Persisted values only (01-product.md §7A "Session Status") — Upcoming and
// In Progress are never stored, so they are not in this list; see
// `deriveDisplayStatus` below for where they come from instead.
export const SESSION_STATUSES = ["scheduled", "completed", "cancelled", "holiday"];

export const DISPLAY_STATUSES = ["upcoming", "in_progress", "completed", "cancelled", "holiday"];

export const DISPLAY_STATUS_LABELS = {
  upcoming: "Upcoming",
  in_progress: "In Progress",
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
 * The fixed yoga-centre timezone Upcoming/In Progress/Completed are derived
 * against (01-product.md §7A "Centre Timezone"; §12 "Class Session":
 * "Upcoming and In Progress are derived from the session's date and time in
 * the centre timezone, never stored"). One fixed zone, approved — not a
 * multi-branch or per-user setting; see 01-product.md §7A for why.
 */
export const CENTRE_TIMEZONE = "Asia/Kolkata";

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
const centreTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CENTRE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function nowInCentreTimezone(now) {
  const parts = centreTimeFormatter.formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * "Today" as a "YYYY-MM-DD" date in `CENTRE_TIMEZONE` — the Today's Sessions
 * screen's own notion of "today" (01-product.md §7A "Centre Timezone"), which
 * is deliberately not `lib/schedules/validation.js`'s `todayDateString()`:
 * that helper reads the server's own UTC date, which would show the wrong
 * day for part of the day near midnight IST (UTC+5:30). Shares the same
 * `centreTimeFormatter`/`nowInCentreTimezone` `deriveDisplayStatus` already
 * uses, so both "today" and "is this session upcoming/in progress/completed"
 * are always read from the same clock.
 *
 * @param {Date} [now] - Defaults to the current time; overridable for testing.
 * @returns {string} "YYYY-MM-DD".
 */
export function todayInCentreTimezone(now = new Date()) {
  return nowInCentreTimezone(now).slice(0, 10);
}

/**
 * Maps a class session's persisted status to the five values the UI
 * displays (01-product.md §7A "Session Status"). `completed`/`cancelled`/
 * `holiday` pass straight through unchanged. `scheduled` splits into three,
 * by comparing the current time in `CENTRE_TIMEZONE` against the session's
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
 * @returns {"upcoming"|"in_progress"|"completed"|"cancelled"|"holiday"}
 */
export function deriveDisplayStatus(session, now = new Date()) {
  if (session.status !== "scheduled") {
    return session.status;
  }

  const nowInCentre = nowInCentreTimezone(now);
  const start = `${session.session_date}T${session.start_time}`;
  const end = `${session.session_date}T${session.end_time}`;

  if (nowInCentre < start) return "upcoming";
  if (nowInCentre <= end) return "in_progress";
  return "completed";
}
