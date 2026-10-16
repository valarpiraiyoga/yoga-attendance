/**
 * Student communication history (migration 0057) - the pure half: the types, the form's validation, the database's refusals as
 * field errors, and a stored row shaped for the screen. No Next.js, no Supabase; tested without a server.
 *
 * The database is the authority: `record_student_communication` and `complete_student_follow_up` repeat every rule here and
 * write the staff attribution from auth.uid(). These checks exist so the form can say what is wrong before anything is sent.
 *
 * Dates and times are the centre's wall clock. The form's Date & Time is a `datetime-local` value ("YYYY-MM-DDTHH:MM", no zone),
 * sent as is; the database reads it in centre_timezone(). Comparing two such values is a plain string comparison.
 */

import { centreDateOf, nowInCentreTimezone } from "../class-sessions/validation.js";
import { formatDate } from "../format.js";

export const COMMUNICATION_TYPES = [
  { value: "phone_call", label: "Phone Call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "in_person", label: "In Person" },
  { value: "other", label: "Other" },
];
const TYPE_VALUES = COMMUNICATION_TYPES.map((type) => type.value);
export const COMMUNICATION_TYPE_LABEL = Object.fromEntries(COMMUNICATION_TYPES.map((type) => [type.value, type.label]));

export const SUBJECT_MAX = 150;
export const NOTES_MAX = 4000;
export const FOLLOW_UP_NOTE_MAX = 1000;

export const FOLLOW_UP_STATUS = {
  pending: { label: "Pending", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
};

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isLocalDateTime(value) {
  const match = LOCAL_DATE_TIME.exec(value);
  return Boolean(match) && isRealDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60;
}

/** The form's default Date & Time: now, on the centre's clock, as a `datetime-local` value. */
export function defaultCommunicatedAt(now = new Date(), timeZone) {
  return nowInCentreTimezone(now, timeZone).slice(0, 16);
}

/**
 * Checks and normalizes the Add Communication form.
 *
 * @param {{ communicatedAt?: unknown, type?: unknown, subject?: unknown, notes?: unknown, followUp?: unknown,
 *           followUpDate?: unknown, followUpNote?: unknown }} input
 * @param {string} nowLocal - "YYYY-MM-DDTHH:MM", the centre's current wall clock (see `defaultCommunicatedAt`).
 * @returns {{ success: true, data: { communicatedAt: string, type: string, subject: string, notes: string,
 *             followUpDate: string|null, followUpNote: string|null } } | { success: false, fieldErrors: Record<string, string> }}
 */
export function validateCommunicationInput(input = {}, nowLocal) {
  const text = (value) => String(value ?? "").trim();
  const fieldErrors = {};

  const communicatedAt = text(input.communicatedAt);
  if (!communicatedAt) fieldErrors.communicatedAt = "Enter the date and time of the communication.";
  else if (!isLocalDateTime(communicatedAt)) fieldErrors.communicatedAt = "Enter a valid date and time.";
  else if (nowLocal && communicatedAt > nowLocal) fieldErrors.communicatedAt = "The communication date and time cannot be in the future.";

  const type = text(input.type);
  if (!TYPE_VALUES.includes(type)) fieldErrors.type = "Choose the communication type.";

  const subject = text(input.subject);
  if (!subject) fieldErrors.subject = "Enter a subject.";
  else if (subject.length > SUBJECT_MAX) fieldErrors.subject = `The subject can be at most ${SUBJECT_MAX} characters.`;

  const notes = text(input.notes);
  if (!notes) fieldErrors.notes = "Enter the communication notes.";
  else if (notes.length > NOTES_MAX) fieldErrors.notes = `The notes can be at most ${NOTES_MAX} characters.`;

  const followUp = input.followUp === true || input.followUp === "on" || input.followUp === "true";
  let followUpDate = null;
  let followUpNote = null;
  if (followUp) {
    followUpDate = text(input.followUpDate);
    followUpNote = text(input.followUpNote);
    if (!followUpDate) fieldErrors.followUpDate = "Enter the follow-up date.";
    else if (!isRealDate(followUpDate)) fieldErrors.followUpDate = "Enter a valid follow-up date.";
    else if (isLocalDateTime(communicatedAt) && followUpDate < communicatedAt.slice(0, 10)) {
      fieldErrors.followUpDate = "The follow-up date cannot be before the communication date.";
    }
    if (!followUpNote) fieldErrors.followUpNote = "Enter the follow-up note.";
    else if (followUpNote.length > FOLLOW_UP_NOTE_MAX) {
      fieldErrors.followUpNote = `The follow-up note can be at most ${FOLLOW_UP_NOTE_MAX} characters.`;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { success: false, fieldErrors };
  return { success: true, data: { communicatedAt, type, subject, notes, followUpDate, followUpNote } };
}

// The database's refusals (record_student_communication / complete_student_follow_up), by message, as the field they belong to.
const KNOWN_ERRORS = [
  { match: "date and time of the communication", field: "communicatedAt" },
  { match: "cannot be in the future", field: "communicatedAt" },
  { match: "communication type", field: "type" },
  { match: "subject", field: "subject" },
  { match: "communication notes", field: "notes" },
  { match: "notes can be at most", field: "notes" },
  { match: "follow-up date", field: "followUpDate" },
  { match: "follow-up note", field: "followUpNote" },
];

/**
 * A database error as the action's result: a field error for a known validation refusal, a plain message otherwise.
 *
 * @returns {{ error: string, fieldErrors?: Record<string, string> }}
 */
export function communicationErrorResult(error) {
  const code = error?.code;
  const message = String(error?.message ?? "");
  if (code === "42501") return { error: "You are not allowed to do this for this student." };
  if (code === "55000") return { error: message || "This follow-up is already completed." };
  if (code === "22023") {
    const known = KNOWN_ERRORS.find((rule) => message.includes(rule.match));
    if (known) return { error: "Check the highlighted fields.", fieldErrors: { [known.field]: message } };
    return { error: message || "Check the details and try again." };
  }
  return { error: "Could not save. Try again." };
}

// "Oct 16, 2026, 3:45 PM" on the centre's clock.
const dateTimeFormatters = new Map();
function dateTimeFormatter(timeZone) {
  const key = timeZone ?? "";
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatCommunicationDateTime(instant, timeZone) {
  if (!instant) return "—";
  return dateTimeFormatter(timeZone).format(new Date(instant));
}

/** The recorder's label: "Name (Instructor)" for an Instructor, the name for an Admin. */
export function staffLabel(name, role) {
  const clean = String(name ?? "").trim();
  if (role === "instructor") return clean ? `${clean} (Instructor)` : "Instructor";
  return clean || "Admin";
}

/** One stored row for the screen. Everything shown comes from the row itself. */
/** A stored instant as the form's `datetime-local` value, on the centre's clock ("YYYY-MM-DDTHH:MM"). */
export function toCentreLocalDateTime(instant, timeZone) {
  if (!instant) return "";
  return nowInCentreTimezone(new Date(instant), timeZone).slice(0, 16);
}

/**
 * The Edit Communication form's starting values for a stored row (migration 0058). A COMPLETED follow-up comes with
 * `followUpLocked`: the form shows it but cannot change or remove it, and the database refuses the same.
 */
export function editDraftOf(row, timeZone) {
  const hasFollowUp = row.follow_up_status === "pending" || row.follow_up_status === "completed";
  return {
    communicatedAt: toCentreLocalDateTime(row.communicated_at, timeZone),
    type: row.communication_type ?? "",
    subject: row.subject ?? "",
    notes: row.notes ?? "",
    followUp: hasFollowUp,
    followUpDate: hasFollowUp ? (row.follow_up_date ?? "") : "",
    followUpNote: hasFollowUp ? (row.follow_up_note ?? "") : "",
    followUpLocked: row.follow_up_status === "completed",
  };
}

export function mapCommunicationRow(row, timeZone) {
  const hasFollowUp = row.follow_up_status === "pending" || row.follow_up_status === "completed";
  return {
    id: row.id,
    editDraft: editDraftOf(row, timeZone),
    communicatedAt: row.communicated_at,
    dateTimeLabel: formatCommunicationDateTime(row.communicated_at, timeZone),
    type: row.communication_type,
    typeLabel: COMMUNICATION_TYPE_LABEL[row.communication_type] ?? row.communication_type,
    subject: row.subject,
    notes: row.notes,
    recordedBy: staffLabel(row.recorded_by_name, row.recorded_by_role),
    createdAt: row.created_at,
    followUp: hasFollowUp
      ? {
          status: row.follow_up_status,
          date: row.follow_up_date,
          dateLabel: formatDate(row.follow_up_date),
          note: row.follow_up_note,
          completedAtLabel: row.follow_up_completed_at ? formatDate(centreDateOf(row.follow_up_completed_at, timeZone)) : null,
          completedBy: row.follow_up_completed_by_name ?? null,
        }
      : null,
  };
}

/** Newest first: by communication time, then when it was recorded, then id - the database's own order, kept on the screen. */
export function sortCommunications(rows) {
  const time = (value) => Date.parse(value ?? "") || 0;
  return [...rows].sort(
    (a, b) =>
      time(b.communicatedAt) - time(a.communicatedAt) ||
      time(b.createdAt) - time(a.createdAt) ||
      String(b.id ?? "").localeCompare(String(a.id ?? "")),
  );
}
