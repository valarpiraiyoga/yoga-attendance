/**
 * Shared presentation formatters (06-ui-implementation-rules.md §21).
 *
 * These are display-string helpers only — no business logic, no date
 * arithmetic, no eligibility or validation rules. `lib/schedules/validation.js`
 * (`addDaysUTC`, `timeToMinutes`, `DAY_LABELS`, …) and
 * `lib/class-sessions/validation.js` own that and are unchanged by this
 * module.
 *
 * Every date helper parses `value` as `${value}T00:00:00Z` and formats with
 * `timeZone: "UTC"` — the same centre-timezone-safe pattern the ~22
 * duplicated `formatDate` copies already used, now in one place. This file
 * does not change what any screen renders by itself; a page adopts these
 * exports when that page is next implemented (§21 rule 2), not in a
 * repo-wide sweep.
 */

/** Canonical date format across the app: `Sep 01, 2026`. */
export function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `Tue, Sep 01, 2026` — for detail headers and confirmation summaries. */
export function formatDateWithWeekday(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `Sep 1` — compact form for tight spaces (calendars, chips). */
export function formatDateShort(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The three pieces a date "tile" needs (Attendance History's card date
 * block): `{ weekday: "TUE", day: 16, monthYear: "Sep 2026" }`.
 */
export function formatDateParts(value) {
  if (!value) return { weekday: "—", day: "—", monthYear: "—" };
  const date = new Date(`${value}T00:00:00Z`);
  return {
    weekday: date
      .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
      .toUpperCase(),
    day: date.getUTCDate(),
    monthYear: date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/** `"14:05"` → `"2:05 PM"`. Native `<input type="time">` format in, 12-hour display out. */
export function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/** `"6:00 AM – 7:00 AM"` — the en-dash time-range pattern used everywhere. */
export function formatTimeRange(startTime, endTime) {
  return `${formatTime(startTime)} – ${formatTime(endTime)}`;
}

/**
 * `"60 minutes"` from two `"HH:MM"` strings. Pure arithmetic on the raw
 * strings — does not import `lib/schedules/validation.js`'s
 * `timeToMinutes`, keeping this module free of feature-validation
 * dependencies.
 */
export function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return "—";
  const toMinutes = (value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  const minutes = toMinutes(endTime) - toMinutes(startTime);
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** `1000` → `"₹1,000.00"`. */
export function formatAmount(value) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * `"Kannan Thangavel"` → `"KT"`. First + last word initials, uppercase; a
 * single name yields one letter; empty/whitespace falls back to `"?"`.
 *
 * `components/global/UserMenu.js` keeps its own smaller variant (all-parts,
 * sliced to 2, no `"?"` fallback) — a different, single-purpose algorithm
 * for the header's own account avatar, not one of the ~17 duplicated
 * copies this helper consolidates.
 */
export function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * `count` as a rounded percentage of `total` — `"83%"` — or `null` when
 * there is no total to take a share of. Derived from real counts only.
 */
export function formatShare(count, total) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : null;
}
