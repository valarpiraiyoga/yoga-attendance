// Run with `npm test` (Node's built-in test runner).
//
// The Class Count Attendance tab of Attendance (Admin only): the pure rules (what a failed recording says, which used-up
// memberships are offered a Renew) are tested directly; the page, the action, the button and the tab are pinned from
// source, the project's way for code that cannot be rendered under node:test. The recording itself is the database's
// (migration 0043, verified by its own script).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RECORD_FAILED_MESSAGE, UUID_PATTERN, recordErrorMessage, remainingText } from "./record-core.js";
import { eligibleRowFrom, pickClassesToRenew } from "./rows.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

// ---- what a failed recording says --------------------------------------------------------------------------------------------

test("a refusal the database raises on purpose is shown as the database wrote it; anything else is the generic message", () => {
  for (const code of ["55000", "22023", "23505", "P0002"]) {
    assert.equal(recordErrorMessage({ code, message: "No classes remain on this membership." }), "No classes remain on this membership.", code);
  }
  assert.equal(recordErrorMessage({ code: "42501", message: "Not authorized." }), "You do not have permission to record a class.");
  assert.equal(recordErrorMessage({ code: "XX000", message: "internal detail" }), RECORD_FAILED_MESSAGE);
  assert.equal(recordErrorMessage({ code: "55000" }), RECORD_FAILED_MESSAGE, "no message to show");
  assert.equal(recordErrorMessage(null), RECORD_FAILED_MESSAGE);
});

test("request and membership ids must be UUIDs; remaining classes read naturally", () => {
  assert.ok(UUID_PATTERN.test("6f1c1f0e-8d3a-4c43-9b5e-2f6d9a1b7c10"));
  for (const bad of ["", "abc", "6f1c1f0e-8d3a-4c43-9b5e-2f6d9a1b7c1", "6f1c1f0e8d3a4c439b5e2f6d9a1b7c10", "x".repeat(36)]) {
    assert.equal(UUID_PATTERN.test(bad), false, bad);
  }
  assert.equal(remainingText(3), "3 classes left");
  assert.equal(remainingText(1), "1 class left");
  assert.equal(remainingText(0), "No classes left");
  assert.equal(remainingText(-2), "No classes left");
});

// ---- the rows ----------------------------------------------------------------------------------------------------------------------

test("a row of list_class_count_eligible() becomes the screen's row shape, a null end date meaning no expiry", () => {
  assert.deepEqual(
    eligibleRowFrom({
      membership_id: "m1", membership_code: "MEM-000010", student_id: "s1", full_name: "Asha Rao", phone: "9876543210",
      student_code: "YC-000012", start_date: "2026-09-01", end_date: null, total_classes: 10, classes_used: 4, classes_remaining: 6,
    }),
    {
      membershipId: "m1", membershipCode: "MEM-000010", studentId: "s1", fullName: "Asha Rao", studentCode: "YC-000012", photoUrl: null,
      startDate: "2026-09-01", endDate: null, total: 10, used: 4, remaining: 6,
    },
  );
});

const student = (id, name, status = "active") => ({ id, full_name: name, student_code: `YC-${id}`, photo_url: null, status });
const membership = (id, studentId, name, start, total, used, extra = {}) => ({
  id, membership_code: `MEM-${id}`, student_id: studentId, start_date: start, end_date: null, total_classes: total,
  class_count_attendance: [{ count: used }], students: student(studentId, name, extra.status), ...extra,
});

test("a used-up class-count membership is offered Renew; one with classes left is not", () => {
  const rows = pickClassesToRenew([
    membership("a", "s1", "Asha", "2026-08-01", 5, 5),
    membership("b", "s2", "Bala", "2026-08-01", 5, 3),
  ]);
  assert.deepEqual(rows.map((row) => row.membershipId), ["a"]);
  assert.deepEqual(
    { total: rows[0].total, used: rows[0].used, remaining: rows[0].remaining, endDate: rows[0].endDate, fullName: rows[0].fullName },
    { total: 5, used: 5, remaining: 0, endDate: null, fullName: "Asha" },
  );
});

test("only a student's latest class-count membership counts, so a renewed one is no longer offered", () => {
  // Asha used up her August pack and has since renewed (September, not used up): nothing to renew.
  assert.deepEqual(
    pickClassesToRenew([membership("a1", "s1", "Asha", "2026-08-01", 5, 5), membership("a2", "s1", "Asha", "2026-09-01", 5, 1)]),
    [],
  );
  // The later pack is used up too: it is the one offered, not the earlier one.
  assert.deepEqual(
    pickClassesToRenew([membership("a1", "s1", "Asha", "2026-08-01", 5, 5), membership("a2", "s1", "Asha", "2026-09-01", 5, 5)]).map((row) => row.membershipId),
    ["a2"],
  );
  // The order of the rows read does not matter.
  assert.deepEqual(
    pickClassesToRenew([membership("a2", "s1", "Asha", "2026-09-01", 5, 1), membership("a1", "s1", "Asha", "2026-08-01", 5, 5)]),
    [],
  );
});

test("an inactive student, and a membership that records more than its total, behave", () => {
  assert.deepEqual(pickClassesToRenew([membership("a", "s1", "Asha", "2026-08-01", 5, 5, { status: "inactive" })]), [], "inactive students are not offered");
  assert.equal(pickClassesToRenew([membership("a", "s1", "Asha", "2026-08-01", 5, 7)])[0].remaining, 0, "never negative");
  assert.deepEqual(pickClassesToRenew([{ ...membership("a", "s1", "Asha", "2026-08-01", 5, 5), students: null }]), []);
  assert.deepEqual(pickClassesToRenew([]), []);
});

test("Renew rows are sorted by student name, then membership code", () => {
  const rows = pickClassesToRenew([
    membership("c", "s3", "Chitra", "2026-08-01", 2, 2),
    membership("a", "s1", "Asha", "2026-08-01", 2, 2),
    membership("b", "s2", "Bala", "2026-08-01", 2, 2),
  ]);
  assert.deepEqual(rows.map((row) => row.fullName), ["Asha", "Bala", "Chitra"]);
});

// ---- the page, the tab and the sidebar ---------------------------------------------------------------------------------------------

test("the tab is a route of its own under Attendance, Admin only, listing eligible memberships and those with no classes left", () => {
  const page = code("../../app/attendance/class-count/page.js");
  assert.match(page, /await requireRole\(ROLES\.ADMIN\);/);
  assert.doesNotMatch(page, /ROLES\.INSTRUCTOR/);
  assert.match(page, /Promise\.all\(\[listClassCountEligible\(\), listClassCountToRenew\(\), todayDateString\(\)\]\)/);
  assert.match(page, /<AttendanceViewToggle active="class-count" showClassCount \/>/);
  assert.match(page, /<ClassCountList rows=\{eligible\} mode="record"[^>]* today=\{today\} \/>/);
  assert.match(page, /<ClassCountList rows=\{toRenew\} mode="renew"/);
  assert.match(page, /No classes remaining/);
  // It is its own screen: no class session, no session attendance.
  assert.doesNotMatch(page, /class-sessions|lib\/attendance\/|listSessions|resolve_eligible_students/);
});

test("the Attendance tabs: the two session tabs are unchanged, the third is shown only when asked for", () => {
  const toggle = code("../../app/attendance/attendance-view-toggle.js");
  assert.match(toggle, /\{ key: "today", label: "Today's Sessions", href: "\/attendance", icon: CalendarDays \}/);
  assert.match(toggle, /\{ key: "all", label: "All Sessions", href: "\/attendance\?view=all", icon: List \}/);
  assert.match(toggle, /const CLASS_COUNT_VIEW = \{ key: "class-count", label: "Class Count Attendance", href: "\/attendance\/class-count", icon: ListChecks \};/);
  assert.match(toggle, /export default function AttendanceViewToggle\(\{ active, showClassCount = false \}\)/);
  assert.match(toggle, /const views = showClassCount \? \[\.\.\.VIEWS, CLASS_COUNT_VIEW\] : VIEWS;/);
  // The session screen offers it to an Admin only, on both of its views, and changes nothing else about them.
  const attendance = code("../../app/attendance/page.js");
  assert.match(attendance, /<AttendanceViewToggle active="today" showClassCount=\{isAdmin\} \/>/);
  assert.match(attendance, /<AttendanceViewToggle active="all" showClassCount=\{isAdmin\} \/>/);
  assert.match(attendance, /const isAdmin = user\.role === ROLES\.ADMIN/);
});

test("the primary navigation is unchanged: there is no Class Count item in the sidebar", () => {
  const navigation = source("../../app/data/navigation.js");
  assert.doesNotMatch(navigation, /Class Count|class-count/i);
  assert.match(navigation, /\{ label: "Attendance", href: "\/attendance", icon: CircleCheck, roles: \["admin", "instructor"\] \}/);
});

// ---- the data, the action and the button ---------------------------------------------------------------------------------------------

test("the reads use the existing database functions and the memberships table - no session tables", () => {
  const data = code("./data.js");
  assert.match(data, /supabase\.rpc\("list_class_count_eligible"\)/);
  assert.match(data, /\.from\("memberships"\)/);
  assert.match(data, /\.eq\("kind", "class_count"\)\s*\.is\("cancelled_at", null\)/);
  // Counts are NET: the records come with their reversal, never as a gross count.
  assert.match(data, /class_count_attendance\(id, class_count_attendance_reversals\(id\)\)/);
  assert.doesNotMatch(data, /class_count_attendance\(count\)/);
  assert.doesNotMatch(data, /from\("attendance"\)|from\("class_sessions"\)|resolve_eligible_students/);
});

test("recording is one call to record_class_count_attendance, Admin only, with the caller's request ID, and touches no session table", () => {
  const action = code("./actions.js");
  assert.match(source("./actions.js"), /^"use server";/);
  assert.match(action, /export async function recordClassCount\(membershipId, requestId, attendedOn\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.match(action, /UUID_PATTERN\.test\(String\(membershipId \?\? ""\)\) \|\| !UUID_PATTERN\.test\(String\(requestId \?\? ""\)\)/);
  // The date-aware, three-argument function; the chosen date is sent as it is.
  assert.match(action, /supabase\.rpc\("record_class_count_attendance", \{\s*p_membership_id: membershipId,\s*p_request_id: requestId,\s*p_attended_on: attendedOn,\s*\}\)/);
  assert.match(action, /attendanceDateError\(attendedOn, \{ today: await todayDateString\(\) \}\)/);
  assert.match(action, /revalidatePath\("\/attendance\/class-count"\);/);
  assert.match(action, /revalidatePath\(`\/memberships\/\$\{membershipId\}`\);/);
  assert.doesNotMatch(action, /from\("attendance"\)|class_sessions|save_session_attendance|\.insert\(|\.update\(|\.delete\(/);
  // Only async functions are exported from a "use server" file.
  assert.deepEqual([...action.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]), ["recordClassCount", "reverseClassCount", "editClassCountExpiry"]);
  assert.equal([...action.matchAll(/^export /gm)].length, 3);
});

test("Record class opens a confirmation with the attendance date; one request ID per confirmation, disabled while the call runs, kept only if the call was not answered", () => {
  const button = code("../../app/attendance/class-count/record-class-button.js");
  assert.match(button, /<ConfirmDialog/);
  // Nothing is recorded by the button itself: only by the dialog's Confirm.
  assert.match(button, /onClick=\{openDialog\}/);
  assert.match(button, /onConfirm=\{confirm\}/);
  assert.match(button, /isPending=\{isPending\}/);
  assert.match(button, /if \(isPending\) return;/);
  // The date defaults to the centre's today (a prop from the server) and is bounded by the membership.
  assert.match(button, /useState\(today\)/);
  assert.match(button, /type="date"/);
  assert.match(button, /min=\{startDate\}/);
  assert.match(button, /max=\{max\}/);
  assert.match(button, /attendanceDateError\(date, \{ today, startDate, endDate \}\)/);
  assert.match(button, /remainingText\(remaining\)/);
  assert.match(button, /remainingText\(remaining - 1\)/);
  // The chosen date is what is sent; a request ID is used with one date only.
  assert.match(button, /await recordClassCount\(membershipId, requestId, date\)/);
  assert.match(button, /requestDateRef\.current !== date/);
  assert.doesNotMatch(button, /new Date\(|Date\.now\(/);
  // On a network failure the ID is NOT cleared, so trying again repeats this confirmation instead of recording a second class.
  const failure = button.slice(button.indexOf("} catch {"));
  assert.doesNotMatch(failure.slice(0, failure.indexOf("});")), /requestIdRef\.current = null/);
  assert.match(button, /role="status"/);
});

test("the list offers Record class for the first group and Renew (the renewal form) for the used-up ones", () => {
  const list = code("../../app/attendance/class-count/class-count-list.js");
  assert.match(list, /mode === "renew" \? \(/);
  assert.match(list, /href=\{`\/memberships\/\$\{row\.membershipId\}\/renew`\}/);
  assert.match(list, /<RecordClassButton\s+today=\{today\}\s+student=\{\{ fullName: row\.fullName, studentCode: row\.studentCode, photoUrl: row\.photoUrl \}\}/);
  assert.match(list, /membershipId: row\.membershipId,\s+code: row\.membershipCode,\s+startDate: row\.startDate,\s+endDate: row\.endDate,\s+remaining: row\.remaining,/);
  // Used and left, and the expiry - "No expiry" when there is no end date.
  assert.match(list, /\{row\.used\} of \{row\.total\} used/);
  assert.match(list, /remainingText\(row\.remaining\)/);
  assert.match(list, /row\.endDate \? `Expires \$\{formatDate\(row\.endDate\)\}` : NO_EXPIRY_LABEL/);
});

test("no migration is part of this change: it uses the functions of 0043 and 0044 as they are", () => {
  const all = ["./data.js", "./actions.js"].map((path) => source(path)).join("\n");
  const m43 = readFileSync(new URL("../../supabase/migrations/0043_class_count_attendance.sql", import.meta.url), "utf8");
  for (const name of ["record_class_count_attendance", "list_class_count_eligible"]) {
    assert.match(all, new RegExp(name));
    assert.match(m43, new RegExp(`function public\\.${name}\\(`));
  }
  assert.match(m43, /p_membership_id uuid,\s+p_request_id\s+uuid/);
});
