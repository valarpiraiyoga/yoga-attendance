// Run with `npm test` (Node's built-in test runner).
//
// Student communication history (migration 0057), the pure rules: the Add Communication form's validation (required fields, the
// follow-up date rule, no future date), with and without a follow-up; the database's refusals as field errors; a stored row
// shaped for the screen (pending and completed follow-ups); and the newest-first order.

import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMUNICATION_TYPES,
  communicationErrorResult,
  defaultCommunicatedAt,
  mapCommunicationRow,
  sortCommunications,
  staffLabel,
  validateCommunicationInput,
} from "./core.js";

const NOW = "2026-10-16T15:30";
const base = { communicatedAt: "2026-10-16T10:15", type: "phone_call", subject: " Membership renewal ", notes: " Discussed renewal. " };

// ---- validation -------------------------------------------------------------------------------------------------------------

test("without a follow-up: only the communication is returned, normalized, and no follow-up is sent", () => {
  const result = validateCommunicationInput({ ...base, followUp: false, followUpDate: "2026-10-20", followUpNote: "ignored" }, NOW);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    communicatedAt: "2026-10-16T10:15",
    type: "phone_call",
    subject: "Membership renewal",
    notes: "Discussed renewal.",
    followUpDate: null,
    followUpNote: null,
  });
});

test("with a follow-up: the date and note are returned with the communication", () => {
  const result = validateCommunicationInput({ ...base, followUp: true, followUpDate: "2026-10-20", followUpNote: " Call back " }, NOW);
  assert.equal(result.success, true);
  assert.equal(result.data.followUpDate, "2026-10-20");
  assert.equal(result.data.followUpNote, "Call back");
});

test("required fields: date and time, type, subject and notes", () => {
  const result = validateCommunicationInput({ communicatedAt: "", type: "", subject: "  ", notes: "" }, NOW);
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(result.fieldErrors).sort(), ["communicatedAt", "notes", "subject", "type"]);
});

test("only the four communication types are accepted", () => {
  assert.deepEqual(COMMUNICATION_TYPES.map((type) => type.label), ["Phone Call", "WhatsApp", "In Person", "Other"]);
  assert.equal(validateCommunicationInput({ ...base, type: "email" }, NOW).fieldErrors.type, "Choose the communication type.");
  for (const { value } of COMMUNICATION_TYPES) assert.equal(validateCommunicationInput({ ...base, type: value }, NOW).success, true);
});

test("an earlier date and time is accepted; a future one is refused", () => {
  assert.equal(validateCommunicationInput({ ...base, communicatedAt: "2026-09-01T09:00" }, NOW).success, true);
  assert.match(validateCommunicationInput({ ...base, communicatedAt: "2026-10-16T15:31" }, NOW).fieldErrors.communicatedAt, /future/);
});

test("an invalid date and time is refused", () => {
  for (const value of ["2026-10-16", "2026-02-30T10:00", "2026-10-16T25:00", "16/10/2026 10:00"]) {
    assert.equal(validateCommunicationInput({ ...base, communicatedAt: value }, NOW).success, false, value);
  }
});

test("follow-up enabled: the date and the note are both required", () => {
  const result = validateCommunicationInput({ ...base, followUp: true, followUpDate: "", followUpNote: "" }, NOW);
  assert.equal(result.fieldErrors.followUpDate, "Enter the follow-up date.");
  assert.equal(result.fieldErrors.followUpNote, "Enter the follow-up note.");
});

test("follow-up date: not before the communication date; the same day or later is fine", () => {
  const before = validateCommunicationInput({ ...base, followUp: true, followUpDate: "2026-10-15", followUpNote: "x" }, NOW);
  assert.equal(before.fieldErrors.followUpDate, "The follow-up date cannot be before the communication date.");
  assert.equal(validateCommunicationInput({ ...base, followUp: true, followUpDate: "2026-10-16", followUpNote: "x" }, NOW).success, true);
  assert.equal(validateCommunicationInput({ ...base, followUp: true, followUpDate: "2026-11-01", followUpNote: "x" }, NOW).success, true);
});

test("length limits match the database", () => {
  assert.match(validateCommunicationInput({ ...base, subject: "x".repeat(151) }, NOW).fieldErrors.subject, /150/);
  assert.match(validateCommunicationInput({ ...base, notes: "x".repeat(4001) }, NOW).fieldErrors.notes, /4000/);
  const note = validateCommunicationInput({ ...base, followUp: true, followUpDate: "2026-10-20", followUpNote: "x".repeat(1001) }, NOW);
  assert.match(note.fieldErrors.followUpNote, /1000/);
});

test("the default date and time is now on the centre's clock, minutes precision", () => {
  const instant = new Date("2026-10-16T10:00:30Z");
  assert.equal(defaultCommunicatedAt(instant, "Asia/Kolkata"), "2026-10-16T15:30");
  assert.equal(defaultCommunicatedAt(instant, "America/New_York"), "2026-10-16T06:00");
});

// ---- database errors ------------------------------------------------------------------------------------------------------------

test("database refusals become field errors or plain messages", () => {
  assert.deepEqual(communicationErrorResult({ code: "22023", message: "The follow-up date cannot be before the communication date." }), {
    error: "Check the highlighted fields.",
    fieldErrors: { followUpDate: "The follow-up date cannot be before the communication date." },
  });
  assert.equal(communicationErrorResult({ code: "22023", message: "Enter a subject." }).fieldErrors.subject, "Enter a subject.");
  assert.deepEqual(communicationErrorResult({ code: "42501", message: "x" }), { error: "You are not allowed to do this for this student." });
  assert.deepEqual(communicationErrorResult({ code: "55000", message: "This follow-up is already completed." }), {
    error: "This follow-up is already completed.",
  });
  assert.deepEqual(communicationErrorResult({ code: "08006", message: "connection" }), { error: "Could not save. Try again." });
});

// ---- shaping rows ----------------------------------------------------------------------------------------------------------------

const ROW = {
  id: "c1",
  communicated_at: "2026-10-16T04:45:00+00:00",
  communication_type: "whatsapp",
  subject: "Class timing enquiry",
  notes: "Asked about evening classes.",
  recorded_by_name: "Subha Kannan",
  recorded_by_role: "instructor",
  follow_up_date: null,
  follow_up_note: null,
  follow_up_status: null,
  follow_up_completed_at: null,
  follow_up_completed_by_name: null,
  created_at: "2026-10-16T05:00:00+00:00",
};

test("a row without a follow-up shows the communication and no follow-up", () => {
  const item = mapCommunicationRow(ROW, "Asia/Kolkata");
  assert.equal(item.typeLabel, "WhatsApp");
  assert.equal(item.dateTimeLabel, "Oct 16, 2026, 10:15 AM");
  assert.equal(item.recordedBy, "Subha Kannan (Instructor)");
  assert.equal(item.followUp, null);
});

test("a pending follow-up shows its due date and note; a completed one keeps them and adds when and by whom", () => {
  const pending = mapCommunicationRow({ ...ROW, follow_up_date: "2026-10-20", follow_up_note: "Send timetable", follow_up_status: "pending" }, "Asia/Kolkata");
  assert.deepEqual(
    { status: pending.followUp.status, dateLabel: pending.followUp.dateLabel, note: pending.followUp.note, completedAtLabel: pending.followUp.completedAtLabel },
    { status: "pending", dateLabel: "Oct 20, 2026", note: "Send timetable", completedAtLabel: null },
  );

  const completed = mapCommunicationRow(
    {
      ...ROW,
      follow_up_date: "2026-10-20",
      follow_up_note: "Send timetable",
      follow_up_status: "completed",
      follow_up_completed_at: "2026-10-19T20:00:00+00:00",
      follow_up_completed_by_name: "Admin User",
    },
    "Asia/Kolkata",
  );
  assert.equal(completed.followUp.status, "completed");
  assert.equal(completed.followUp.dateLabel, "Oct 20, 2026");
  assert.equal(completed.followUp.note, "Send timetable");
  assert.equal(completed.followUp.completedAtLabel, "Oct 20, 2026"); // 01:30 on Oct 20 at the centre
  assert.equal(completed.followUp.completedBy, "Admin User");
});

test("staff labels: an Instructor is marked, an Admin is their name", () => {
  assert.equal(staffLabel("Asha", "admin"), "Asha");
  assert.equal(staffLabel("", "admin"), "Admin");
  assert.equal(staffLabel("Ravi", "instructor"), "Ravi (Instructor)");
  assert.equal(staffLabel(null, "instructor"), "Instructor");
});

// ---- order ------------------------------------------------------------------------------------------------------------------------

test("history order: newest communication first, then the most recently recorded, then id", () => {
  const rows = [
    { id: "a", communicatedAt: "2026-10-01T10:00:00Z", createdAt: "2026-10-01T10:00:00Z" },
    { id: "b", communicatedAt: "2026-10-15T09:00:00Z", createdAt: "2026-10-15T09:05:00Z" },
    { id: "c", communicatedAt: "2026-10-15T09:00:00Z", createdAt: "2026-10-15T09:10:00Z" },
    { id: "d", communicatedAt: "2026-09-20T08:00:00Z", createdAt: "2026-10-16T08:00:00Z" }, // recorded later, happened earlier
  ];
  assert.deepEqual(sortCommunications(rows).map((row) => row.id), ["c", "b", "a", "d"]);
});
