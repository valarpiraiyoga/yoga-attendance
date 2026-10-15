import test from "node:test";
import assert from "node:assert/strict";
import {
  classCountGroupLabel,
  classCountRecordFrom,
  classCountRecordFromHistoryRow,
  combineRecentAttendance,
  countClassCountByDate,
  mergeHistoryGroups,
  mergeNavigationDays,
  showClassCountInHistory,
  validClassUse,
} from "./attendance-rows.js";

const row = (id, attendedOn, extra = {}) => ({
  id,
  membership_id: "m1",
  student_id: "s1",
  attended_on: attendedOn,
  created_at: `${attendedOn}T10:00:00Z`,
  class_count_attendance_reversals: null,
  memberships: { id: "m1", membership_code: "M-001", end_date: null },
  students: { id: "s1", full_name: "Asha Rao", student_code: "S-001" },
  ...extra,
});
const record = (id, attendedOn, extra) => classCountRecordFrom(row(id, attendedOn, extra));
const session = (id, session_date, start_time = "09:00:00") => ({ id, session_date, start_time, status: "present" });

test("a record is Recorded, or Reversed with its reason - whether the reversal comes as an object or an array", () => {
  assert.equal(record("a", "2026-10-01").status, "recorded");
  const reversal = { reversed_at: "2026-10-02T08:00:00Z", reason: "Entered by mistake" };
  for (const shape of [reversal, [reversal]]) {
    const reversed = record("a", "2026-10-01", { class_count_attendance_reversals: shape });
    assert.equal(reversed.status, "reversed");
    assert.equal(reversed.reversal.reason, "Entered by mistake");
  }
});

test("a reversed record is never valid class use", () => {
  const reversal = { reversed_at: "2026-10-02T08:00:00Z", reason: "Entered by mistake" };
  const records = [record("a", "2026-10-01"), record("b", "2026-10-02", { class_count_attendance_reversals: reversal }), record("c", "2026-10-03")];
  assert.equal(validClassUse(records), 2);
  assert.equal(validClassUse([]), 0);
  assert.equal(validClassUse(undefined), 0);
});

test("the expiry flag is only on a non-reversed record dated after the current expiry", () => {
  const withEnd = (attendedOn, extra) => record("x", attendedOn, { memberships: { id: "m1", membership_code: "M-001", end_date: "2026-10-10" }, ...extra });
  const reversal = { reversed_at: "2026-10-12T08:00:00Z", reason: "Entered by mistake" };
  assert.equal(withEnd("2026-10-11").afterExpiry, true);
  assert.equal(withEnd("2026-10-10").afterExpiry, false, "on the expiry date is not after it");
  assert.equal(withEnd("2026-10-09").afterExpiry, false);
  assert.equal(withEnd("2026-10-11", { class_count_attendance_reversals: reversal }).afterExpiry, false, "a reversed record is not flagged");
  assert.equal(record("x", "2026-12-31").afterExpiry, false, "No expiry has nothing to be after");
});

test("Recent Attendance merges sessions and class-count records newest first and keeps only the limit", () => {
  const out = combineRecentAttendance({
    sessions: [session("s1", "2026-10-05"), session("s2", "2026-10-01")],
    classCount: [record("c1", "2026-10-07"), record("c2", "2026-10-03"), record("c3", "2026-09-20")],
    limit: 4,
  });
  assert.deepEqual(
    out.items.map((item) => `${item.type}:${item.date}`),
    ["class_count:2026-10-07", "session:2026-10-05", "class_count:2026-10-03", "session:2026-10-01"]
  );
  assert.equal(out.partial, false);
  assert.equal(out.unavailable, false);
  assert.equal(combineRecentAttendance({ sessions: [], classCount: [] }).items.length, 0);
});

test("the default limit is five", () => {
  const sessions = ["01", "02", "03", "04"].map((day) => session(`s${day}`, `2026-10-${day}`));
  const classCount = ["05", "06", "07"].map((day) => record(`c${day}`, `2026-10-${day}`));
  assert.equal(combineRecentAttendance({ sessions, classCount }).items.length, 5);
});

test("on the same date a session comes first; sessions later-start first, class-count later-recorded first; inputs are not changed", () => {
  const sessions = [session("a", "2026-10-05", "07:00:00"), session("b", "2026-10-05", "18:00:00")];
  const classCount = [
    record("c1", "2026-10-05", { created_at: "2026-10-05T09:00:00Z" }),
    record("c2", "2026-10-05", { created_at: "2026-10-05T11:00:00Z" }),
  ];
  const before = JSON.stringify({ sessions, classCount });
  const out = combineRecentAttendance({ sessions, classCount });
  assert.deepEqual(out.items.map((item) => item.session?.id ?? item.record.id), ["b", "a", "c2", "c1"]);
  assert.equal(JSON.stringify({ sessions, classCount }), before);
});

test("a reversed class-count record stays in the list", () => {
  const reversed = record("c1", "2026-10-07", { class_count_attendance_reversals: { reversed_at: "2026-10-08T08:00:00Z", reason: "Entered by mistake" } });
  const out = combineRecentAttendance({ sessions: [], classCount: [reversed] });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].record.status, "reversed");
});

test("one source failing (null) still shows the other, and only both failing is unavailable - never 'none'", () => {
  const sessions = [session("s1", "2026-10-05")];
  const classCount = [record("c1", "2026-10-06")];
  const noClassCount = combineRecentAttendance({ sessions, classCount: null });
  assert.deepEqual([noClassCount.items.length, noClassCount.partial, noClassCount.unavailable], [1, true, false]);
  const noSessions = combineRecentAttendance({ sessions: null, classCount });
  assert.deepEqual([noSessions.items.length, noSessions.partial, noSessions.unavailable], [1, true, false]);
  const neither = combineRecentAttendance({ sessions: null, classCount: null });
  assert.deepEqual([neither.items.length, neither.partial, neither.unavailable], [0, false, true]);
});

test("class-count records are shown only for an Admin with no batch, instructor or Present/Absent filter", () => {
  assert.equal(showClassCountInHistory({ isAdmin: true }), true);
  assert.equal(showClassCountInHistory({ isAdmin: true, batchId: "", instructorId: "", attendanceStatus: "all" }), true);
  assert.equal(showClassCountInHistory({ isAdmin: true, batchId: "b1" }), false);
  assert.equal(showClassCountInHistory({ isAdmin: true, instructorId: "i1" }), false);
  assert.equal(showClassCountInHistory({ isAdmin: true, attendanceStatus: "present" }), false);
  assert.equal(showClassCountInHistory({ isAdmin: true, attendanceStatus: "absent" }), false);
  assert.equal(showClassCountInHistory({ isAdmin: false }), false, "neither role: nothing");
  assert.equal(showClassCountInHistory({ isAdmin: undefined }), false);
  // An Instructor sees them (limited in SQL to their own students) under the same filter rules as an Admin.
  assert.equal(showClassCountInHistory({ isInstructor: true }), true);
  assert.equal(showClassCountInHistory({ isInstructor: true, batchId: "b1" }), false);
  assert.equal(showClassCountInHistory({ isInstructor: true, attendanceStatus: "absent" }), false);
  assert.equal(showClassCountInHistory({ isInstructor: true, instructorId: "i1" }), false);
});

const historyRow = (extra = {}) => ({
  attendance_id: "a1",
  attended_on: "2026-10-05",
  recorded_at: "2026-10-05T10:00:00Z",
  membership_code: "M-001",
  membership_end_date: null,
  student_id: "s1",
  student_name: "Asha Rao",
  student_code: "S-001",
  reversed: false,
  reversed_at: null,
  reversal_reason: null,
  total_count: 3,
  ...extra,
});

test("a scoped history row becomes a display record with no membership link", () => {
  const record = classCountRecordFromHistoryRow(historyRow());
  assert.equal(record.id, "a1");
  assert.equal(record.membershipId, null, "an Instructor has no Membership Details link");
  assert.equal(record.membershipCode, "M-001");
  assert.equal(record.status, "recorded");
  assert.equal(record.reversal, null);
  assert.equal(record.studentName, "Asha Rao");
});

test("an Instructor's reversed row is Reversed with no reason; an Admin's keeps it", () => {
  const instructor = classCountRecordFromHistoryRow(historyRow({ reversed: true }));
  assert.equal(instructor.status, "reversed");
  assert.equal(instructor.reversal.reason, null);
  assert.equal(instructor.reversal.reversedAt, null);
  assert.equal(validClassUse([instructor]), 0, "a reversed record is never valid use");

  const admin = classCountRecordFromHistoryRow(historyRow({ reversed: true, reversal_reason: "Entered by mistake", reversed_at: "2026-10-06T08:00:00Z" }));
  assert.equal(admin.reversal.reason, "Entered by mistake");
});

test("a scoped row gets the expiry flag only when not reversed and after the current expiry", () => {
  assert.equal(classCountRecordFromHistoryRow(historyRow({ membership_end_date: "2026-10-04" })).afterExpiry, true);
  assert.equal(classCountRecordFromHistoryRow(historyRow({ membership_end_date: "2026-10-05" })).afterExpiry, false);
  assert.equal(classCountRecordFromHistoryRow(historyRow({ membership_end_date: "2026-10-04", reversed: true })).afterExpiry, false);
  assert.equal(classCountRecordFromHistoryRow(historyRow()).afterExpiry, false);
});

test("a date with only class-count records is a group of its own, with no sessions", () => {
  const sessionGroups = [{ date: "2026-10-05", sessions: [session("s1", "2026-10-05")] }];
  const groups = mergeHistoryGroups(sessionGroups, [record("c1", "2026-10-07"), record("c2", "2026-10-05")]);
  assert.deepEqual(groups.map((group) => group.date), ["2026-10-07", "2026-10-05"]);
  assert.equal(groups[0].sessions.length, 0);
  assert.equal(groups[0].classCount.length, 1);
  assert.equal(groups[1].sessions.length, 1);
  assert.equal(groups[1].classCount.length, 1);
});

test("merging class-count records never changes a session list or count", () => {
  const sessions = [session("s1", "2026-10-05"), session("s2", "2026-10-05", "10:00:00")];
  const sessionGroups = [{ date: "2026-10-05", sessions }];
  const before = JSON.stringify(sessionGroups);
  const groups = mergeHistoryGroups(sessionGroups, [record("c1", "2026-10-05"), record("c2", "2026-10-05")]);
  assert.equal(groups[0].sessions, sessions, "the very same session array");
  assert.equal(groups[0].sessions.length, 2);
  assert.equal(JSON.stringify(sessionGroups), before);
  assert.equal(groups.flatMap((group) => group.sessions).length, 2, "total sessions unchanged");
  assert.equal(mergeHistoryGroups(sessionGroups, []).flatMap((group) => group.sessions).length, 2);
});

test("calendar days and quick dates keep the session count apart from the class-count number", () => {
  const days = mergeNavigationDays([{ date: "2026-10-05", count: 2 }], [{ date: "2026-10-05", count: 3 }, { date: "2026-10-07", count: 1 }]);
  assert.deepEqual(days, [
    { date: "2026-10-07", count: 0, classCount: 1 },
    { date: "2026-10-05", count: 2, classCount: 3 },
  ]);
  assert.deepEqual(mergeNavigationDays([{ date: "2026-10-05", count: 2 }], []), [{ date: "2026-10-05", count: 2, classCount: 0 }]);
  assert.deepEqual(countClassCountByDate([{ attended_on: "a" }, { attended_on: "a" }, { attended_on: "b" }]), [
    { date: "a", count: 2 },
    { date: "b", count: 1 },
  ]);
});

test("the class-count header label is separate from the session label and empty for none", () => {
  assert.equal(classCountGroupLabel(0), "");
  assert.equal(classCountGroupLabel(2), "2 Class count");
});
