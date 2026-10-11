// Run with `npm test` (Node's built-in test runner).
//
// The attendance date and reversal UI of Class Count Attendance (Admin only): the pure rules (date bounds, reason
// trimming, net counts) are tested directly; the dialogs, the panel and the reverse action are pinned from source, the
// project's way for code that cannot be rendered under node:test. The database (migration 0045) stays the authority.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REASON_MESSAGE,
  REVERSE_FAILED_MESSAGE,
  attendanceDateError,
  reasonError,
  reverseErrorMessage,
  trimReason,
} from "./record-core.js";
import { classCountOf, hasReversal, netUsedOf } from "../memberships/class-count.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

// ---- the attendance date -----------------------------------------------------------------------------------------------------

const bounds = { today: "2026-10-11", startDate: "2026-09-01", endDate: null };

test("today and any earlier date inside the membership are accepted", () => {
  assert.equal(attendanceDateError("2026-10-11", bounds), null);
  assert.equal(attendanceDateError("2026-09-01", bounds), null, "the start date itself");
  assert.equal(attendanceDateError("2026-09-20", bounds), null);
});

test("a missing, impossible, future, too-early or too-late date is refused with a reason, and today is never substituted", () => {
  assert.equal(attendanceDateError("", bounds), "Choose the attendance date.");
  assert.equal(attendanceDateError("2026-02-30", bounds), "Enter a valid attendance date.");
  assert.equal(attendanceDateError("11/10/2026", bounds), "Enter a valid attendance date.");
  assert.equal(attendanceDateError("2026-10-12", bounds), "The attendance date cannot be in the future.");
  assert.equal(attendanceDateError("2026-08-31", bounds), "The attendance date cannot be before the membership starts.");
  const fixed = { ...bounds, endDate: "2026-09-30" };
  assert.equal(attendanceDateError("2026-09-30", fixed), null, "the end date itself");
  assert.equal(attendanceDateError("2026-10-01", fixed), "The attendance date cannot be after the membership ends.");
});

// ---- the reason --------------------------------------------------------------------------------------------------------------

test("a reversal reason is trimmed, then must be 3 to 500 characters", () => {
  assert.equal(trimReason("  \t abc \n"), "abc");
  assert.equal(reasonError(""), REASON_MESSAGE);
  assert.equal(reasonError(null), REASON_MESSAGE);
  assert.equal(reasonError("   \t\n  "), REASON_MESSAGE, "whitespace only");
  assert.equal(reasonError(" ab "), REASON_MESSAGE, "too short once trimmed");
  assert.equal(reasonError(" abc "), null);
  assert.equal(reasonError("x".repeat(500)), null);
  assert.equal(reasonError(`  ${"x".repeat(500)}  `), null, "padding does not count");
  assert.equal(reasonError("x".repeat(501)), REASON_MESSAGE);
});

test("a refusal of a reversal is shown as the database wrote it; anything else is the generic message", () => {
  assert.equal(reverseErrorMessage({ code: "55000", message: "This class has already been reversed." }), "This class has already been reversed.");
  assert.equal(reverseErrorMessage({ code: "P0002", message: "Attendance record not found." }), "Attendance record not found.");
  assert.equal(reverseErrorMessage({ code: "42501", message: "Not authorized." }), "You do not have permission to reverse a class.");
  assert.equal(reverseErrorMessage({ code: "XX000", message: "internal" }), REVERSE_FAILED_MESSAGE);
});

// ---- net counts ----------------------------------------------------------------------------------------------------------------------

test("remaining classes exclude reversed records, whichever way the reversal embeds", () => {
  const rows = [
    { id: "a", class_count_attendance_reversals: null },
    { id: "b", class_count_attendance_reversals: { id: "r1" } },
    { id: "c", class_count_attendance_reversals: [{ id: "r2" }] },
    { id: "d", class_count_attendance_reversals: [] },
  ];
  assert.equal(netUsedOf(rows), 2);
  assert.deepEqual(classCountOf({ kind: "class_count", total_classes: 5 }, rows), { total: 5, used: 2, remaining: 3 });
  assert.deepEqual(classCountOf({ kind: "class_count", total_classes: 2 }, [{ id: "a", class_count_attendance_reversals: { id: "r" } }]), {
    total: 2, used: 0, remaining: 2,
  });
  assert.equal(hasReversal(null), false);
  assert.equal(hasReversal([]), false);
  assert.equal(hasReversal({ id: "r" }), true);
  assert.equal(netUsedOf(undefined), 0);
  assert.equal(classCountOf({ kind: "duration" }, rows), null);
});

test("every read that counts a membership's classes embeds the reversal, so reversed records are not counted", () => {
  const reads = [source("../memberships/data.js"), source("./data.js")].join("\n");
  assert.doesNotMatch(reads, /class_count_attendance\(count\)/);
  assert.ok((reads.match(/class_count_attendance\(id, class_count_attendance_reversals\(id\)\)/g) ?? []).length >= 4);
});

// ---- the reverse action, dialog and panel ---------------------------------------------------------------------------------------

test("reversing is one Admin-only call to reverse_class_count_attendance with the trimmed reason and the caller's request ID", () => {
  const action = code("./actions.js");
  const reverse = action.slice(action.indexOf("export async function reverseClassCount"));
  assert.match(reverse, /^export async function reverseClassCount\(attendanceId, reason, requestId\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.match(reverse, /if \(reasonError\(reason\)\) return \{ error: REASON_MESSAGE \};/);
  assert.match(reverse, /supabase\.rpc\("reverse_class_count_attendance", \{\s*p_attendance_id: attendanceId,\s*p_reason: trimReason\(reason\),\s*p_request_id: requestId,\s*\}\)/);
  // Records are never edited or deleted from the application.
  assert.doesNotMatch(action, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("the Reverse dialog needs a valid reason, is disabled while saving and keeps its request ID until answered", () => {
  const dialog = code("../../app/memberships/[id]/reverse-class-dialog.js");
  assert.match(dialog, /<ConfirmDialog/);
  assert.match(dialog, /context=\{<StudentContext student=\{student\} membership=\{membership\} \/>\}/);
  assert.match(dialog, /const invalid = reasonError\(reason\);/);
  assert.match(dialog, /if \(invalid\) return;/);
  assert.match(dialog, /if \(isPending\) return;/);
  assert.match(dialog, /isPending=\{isPending\}/);
  assert.match(dialog, /await reverseClassCount\(record\.id, reason, requestId\)/);
  assert.match(dialog, /<Textarea/);
  const failure = dialog.slice(dialog.indexOf("} catch {"));
  assert.doesNotMatch(failure.slice(0, failure.indexOf("});")), /requestIdRef\.current = null/);
});

test("Membership Details shows the Class Attendance panel for a class-count membership only; Reverse is on Recorded rows only", () => {
  const page = code("../../app/memberships/[id]/page.js");
  assert.match(page, /membership\.kind === "class_count" \? listClassCountHistory\(id\) : Promise\.resolve\(\[\]\)/);
  assert.match(page, /\{membership\.class_count \? \(\s*<ClassAttendancePanel/);
  const panel = code("../../app/memberships/[id]/class-attendance-panel.js");
  assert.match(panel, /record\.reversal \? null : \(\s*<ReverseClassDialog/);
  assert.match(panel, /Reversed/);
  assert.match(panel, /Reason: \{record\.reversal\.reason\}/);
  assert.match(panel, /No classes recorded yet\./);
  // It reads history; it changes no session data.
  const data = code("./data.js");
  assert.match(data, /\.from\("class_count_attendance"\)/);
  assert.match(data, /class_count_attendance_reversals\(reversed_at, reversed_by, reason\)/);
  assert.doesNotMatch(data.slice(data.indexOf("export async function listClassCountHistory")), /from\("attendance"\)|class_sessions/);
});

test("no migration is part of this change: it calls the functions of 0045 as they are", () => {
  const m45 = readFileSync(new URL("../../supabase/migrations/0045_class_count_dates_and_reversals.sql", import.meta.url), "utf8");
  assert.match(m45, /function public\.record_class_count_attendance\(\s*p_membership_id uuid,\s*p_request_id\s+uuid,\s*p_attended_on\s+date/);
  assert.match(m45, /function public\.reverse_class_count_attendance\(\s*p_attendance_id uuid,\s*p_reason\s+text,\s*p_request_id\s+uuid/);
});
