/**
 * Shared status label + badge-variant mappings (06-ui-implementation-rules.md
 * §10, §21). One source of truth per status domain, so a status is never
 * given a new color just because a new name is added ("03-visual-tokens.md"
 * §7) and the same status never reads two different labels on two views of
 * the same data.
 *
 * This module has no business logic — it does not decide what status a
 * record has, only how an already-decided status is labelled and colored.
 * A page adopts these exports when that page is next implemented (§21 rule
 * 2); nothing here changes what any screen renders until a page imports it.
 *
 * Two canonicalization decisions made here (both presentational, not
 * business rules — flagged for visibility, not silent):
 *   - `custom` plan reads "Custom duration" everywhere. The card-view copy
 *     ("Custom") is dropped in favor of the table/detail copy.
 *   - Any *Pending*-family status (`membership: upcoming`, `payment:
 *     pending`) uses the `warning` badge variant, matching
 *     03-visual-tokens.md's own "Warning … Pending, Upcoming" example and
 *     06-ui-implementation-rules.md §10. The membership list previously
 *     used the brand-tinted `default` variant for "Upcoming" and `neutral`
 *     for "Pending" payments; both now read `warning`.
 */

export const MEMBERSHIP_STATUS = {
  upcoming: { label: "Upcoming", variant: "warning" },
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "neutral" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

export const PLAN = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  custom: "Custom duration",
};

export const PAYMENT_STATUS = {
  paid: { label: "Paid", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
};

/** Active/Inactive — Students, Batches, Schedules, Instructors alike. */
export const ENTITY_STATUS = {
  active: { label: "Active", variant: "success" },
  inactive: { label: "Inactive", variant: "danger" },
};

/**
 * Batch display status — derived from a batch's schedules, never stored
 * (`lib/batches/summary.js` `deriveBatchDisplayStatus`). Upcoming reads as a
 * Pending-family status (warning); Completed is de-emphasised (neutral).
 */
export const BATCH_STATUS = {
  active: { label: "Active", variant: "success" },
  upcoming: { label: "Upcoming", variant: "warning" },
  completed: { label: "Completed", variant: "neutral" },
  inactive: { label: "Inactive", variant: "danger" },
};

/** Present/Absent/Unmarked — Reports and Attendance History summaries. */
export const ATTENDANCE_STATUS = {
  present: { label: "Present", variant: "success" },
  absent: { label: "Absent", variant: "danger" },
  unmarked: { label: "Unmarked", variant: "neutral" },
};

/** A student's rolled-up membership state on the Students list/detail. */
export const MEMBERSHIP_SUMMARY = {
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "neutral" },
  none: { label: "None", variant: "outline" },
};

/**
 * Class-session display status (Upcoming / In Progress / Completed /
 * Cancelled / Holiday). Re-exported, not duplicated — the canonical source
 * stays `lib/class-sessions/validation.js`, which already derives these
 * from clock time plus persisted status and is business logic, not
 * presentation. Import from here for a single status-import surface; the
 * values are unchanged.
 */
export {
  DISPLAY_STATUSES,
  DISPLAY_STATUS_LABELS,
  DISPLAY_STATUS_BADGE_VARIANTS,
} from "@/lib/class-sessions/validation";
