/**
 * Recent Activity on the Dashboard: what happened lately at the centre, read from
 * the records themselves (no separate activity log exists or is invented). Pure
 * (no database, no clock of its own) so the wording and ordering are testable.
 *
 * Three kinds, each a real record with its own timestamp:
 *   - attendance   a class session whose attendance was saved (`completed`)
 *   - student      a student added
 *   - membership   a membership created
 */

import { centreDateOf } from "../class-sessions/validation.js";

export const ACTIVITY_LIMIT = 4;

/**
 * "Today, 6:30 AM" / "Yesterday, 4:12 PM" / "Sep 22, 4:10 PM" - the instant as the
 * centre lived it (its time zone, never the viewer's).
 *
 * @param {string} instant - an ISO timestamp.
 * @param {Date} now
 * @param {string} timeZone - the centre's IANA zone.
 */
export function describeWhen(instant, now, timeZone) {
  const then = new Date(instant);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(then);

  const day = centreDateOf(then, timeZone);
  const today = centreDateOf(now, timeZone);
  const yesterday = centreDateOf(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);

  if (day === today) return `Today, ${time}`;
  if (day === yesterday) return `Yesterday, ${time}`;

  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(then);
  return `${date}, ${time}`;
}

/**
 * The newest `limit` items across all kinds, newest first. Each item is
 * `{ kind, at, title, detail }`; items without a usable timestamp are dropped.
 */
export function mergeActivity(items, limit = ACTIVITY_LIMIT) {
  return items
    .filter((item) => item && item.at && !Number.isNaN(new Date(item.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

/** Row -> activity item, one per kind. */
export function attendanceActivity(session) {
  return {
    kind: "attendance",
    at: session.updated_at,
    title: "Attendance marked",
    detail: session.batches?.name ?? "Class session",
  };
}

export function studentActivity(student) {
  return { kind: "student", at: student.created_at, title: "New student added", detail: student.full_name };
}

export function membershipActivity(membership, planLabel) {
  const student = membership.students?.full_name;
  return {
    kind: "membership",
    at: membership.created_at,
    title: "Membership created",
    detail: [planLabel, student].filter(Boolean).join(" · "),
  };
}
