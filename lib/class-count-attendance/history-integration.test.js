// Class-count attendance on Student Details and Attendance History: how the screens and reads are wired. Source pins - the
// behaviour of the rules themselves is in attendance-rows.test.js. They pin that the records stay Admin-only and separate from
// every session list, count, total and report.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const data = read("./data.js");
const historyPage = read("../../app/attendance-history/page.js");
const studentPage = read("../../app/students/[id]/page.js");
const timeline = read("../../app/attendance-history/history-timeline.js");

const newReads = data.slice(data.indexOf("const DISPLAY_COLUMNS"));
const directReads = newReads.slice(0, newReads.indexOf("export async function listClassCountAttendanceRangeScoped"));
const scopedReads = newReads.slice(newReads.indexOf("export async function listClassCountAttendanceRangeScoped"));

test("the new reads use the regular RLS client, only select or the two scoped functions, and never a service role", () => {
  assert.match(data, /import \{ createClient \} from "@\/lib\/supabase\/server"/);
  assert.doesNotMatch(data, /service[_-]?role|SERVICE_ROLE|createAdminClient/i);
  assert.doesNotMatch(newReads, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(directReads, /\.rpc\(/, "the direct reads are table selects (Admin only under RLS)");
  assert.equal((directReads.match(/export async function/g) ?? []).length, 3);
  assert.equal((scopedReads.match(/export async function/g) ?? []).length, 2);
  assert.deepEqual([...scopedReads.matchAll(/\.rpc\("([a-z_]+)"/g)].map((match) => match[1]), [
    "list_class_count_attendance_history",
    "list_class_count_attendance_dates",
  ]);
  assert.doesNotMatch(scopedReads, /\.from\("class_count_attendance/, "the scoped reads never touch the raw tables");
});

test("class-count tables are readable only by an Admin: the policies (0043, 0045) allow nobody else", () => {
  for (const [file, table] of [
    ["0043_class_count_attendance.sql", "class_count_attendance"],
    ["0045_class_count_dates_and_reversals.sql", "class_count_attendance_reversals"],
  ]) {
    const sql = read(`../../supabase/migrations/${file}`);
    assert.match(sql, new RegExp(`create policy "${table}_select_admin"\\s+on public\\.${table}\\s+for select\\s+to authenticated\\s+using \\(public\\.is_admin\\(\\)\\)`));
    assert.doesNotMatch(sql, new RegExp(`on public\\.${table}[^;]*instructor`, "i"));
  }
});

test("Attendance History reads class-count data by role: an Admin directly, an Instructor only through the scoped functions", () => {
  assert.match(historyPage, /const canSeeClassCount = isAdmin \|\| user\.role === ROLES\.INSTRUCTOR/);
  assert.match(historyPage, /showClassCountInHistory\(\{ isAdmin, isInstructor: !isAdmin, batchId, instructorId, attendanceStatus \}\)/);
  assert.match(historyPage, /const readRange = isAdmin \? listClassCountAttendanceRange : listClassCountAttendanceRangeScoped/);
  assert.match(historyPage, /const readDates = isAdmin \? listClassCountAttendanceDates : listClassCountAttendanceDatesScoped/);
  assert.match(historyPage, /showClassCount \? settle\(readRange\(\{ dateFrom: rangeFrom, dateTo: rangeTo, q \}\)\) : null/);
  assert.equal((historyPage.match(/canSeeClassCount \? settle\(readDates\(/g) ?? []).length, 2, "the calendar and quick-date reads");
  assert.equal((historyPage.match(/\b(readRange|readDates)\(/g) ?? []).length, 3, "no other call site");
  assert.doesNotMatch(historyPage, /listClassCountAttendance(Range|Dates)\(/, "the page never calls a direct read itself");
  // The instructor filter is Admin-only, so a URL parameter cannot make an Instructor's request different from their own.
  assert.match(historyPage, /const instructorId = isAdmin && typeof rawParams\.instructor === "string"/);
});

test("each class-count read is independent: a failure leaves the sessions and says so", () => {
  assert.match(historyPage, /\.then\(\(value\) => \(\{ ok: true, value \}\), \(\) => \(\{ ok: false \}\)\)/);
  assert.match(historyPage, /const classCountFailed = Boolean\(classCountResult\) && !classCountResult\.ok/);
  assert.match(historyPage, /Class count attendance could not be loaded\. Session attendance is shown below\./);
  // Student Details: the session calendar and the class-count records are read independently; either failing leaves the other.
  assert.match(studentPage, /listStudentBatchAttendance\(id, calendarBatch\.id, range\)\.catch\(quiet\)/);
  assert.match(studentPage, /listStudentClassCountAttendance\(studentId, \{ dateFrom, dateTo, limit: RECENT_ATTENDANCE_ROWS \}\)\.catch\(\(\) => null\)/);
});

test("session data, totals and the 'Showing N of M sessions' note are not derived from class-count records", () => {
  assert.match(historyPage, /const \{ sessions, total \}|\[\{ sessions, total \}/);
  assert.match(historyPage, /Showing the most recent \{sessions\.length\} of \{total\} sessions\./);
  assert.match(historyPage, /mergeHistoryGroups\(groupSessionsByDate\(sessions\), classCountRecords\)/);
  assert.doesNotMatch(historyPage, /sessions\.(push|concat)|total\s*[+]=?\s*classCount|classCountTotal\s*\+/);
  assert.match(timeline, /items: group\.sessions,/, "the timeline's session count comes from sessions only");
  const dateGroup = read("../../components/layout/DateGroupTimeline.js");
  assert.match(dateGroup, /const count = group\.items\.length;/);
});

test("reports and the session attendance reads know nothing of class-count attendance", () => {
  for (const path of ["../reports/data.js", "../attendance-history/data.js", "../attendance/data.js", "../attendance/recent.js"]) {
    assert.doesNotMatch(read(path), /class[-_]count/i, path);
  }
});

test("the history page shows the same sections to both roles, and nobody else gets class-count dates", () => {
  assert.match(historyPage, /const isAdmin = user\.role === ROLES\.ADMIN/);
  assert.match(historyPage, /const monthDays = canSeeClassCount \? mergeNavigationDays\(/);
  assert.match(historyPage, /: navigation\.monthDays;/);
  assert.match(historyPage, /: navigation\.quickDates;/);
  assert.match(historyPage, /\{canSeeClassCount && !showClassCount \? \(/);
  // Session data is read exactly as before, and for both roles from the same call.
  assert.match(historyPage, /listAttendanceHistory\(\{/);
});

test("an Instructor's rows carry no Membership link and no reversal reason", () => {
  const section = read("../../app/attendance-history/history-class-count-section.js");
  assert.match(section, /if \(!record\.membershipId\) return <span/);
  assert.match(section, /if \(!record\.reversal\?\.reason\) return null/);
  const rows = read("./attendance-rows.js");
  const mapper = rows.slice(rows.indexOf("export function classCountRecordFromHistoryRow"), rows.indexOf("/** The classes that count as USED"));
  assert.match(mapper, /membershipId: null/);
});

test("a Student Details panel with nothing loadable says unavailable; with one source down it still shows the other", () => {
  const calendar = read("../../app/students/[id]/attendance-calendar.js");
  // The class-count tab: its records as before, or "not available" - never "none" - when they could not be read.
  assert.match(studentPage, /if \(records === null\) return \{ items: \[\], unavailable: true \};/);
  assert.match(calendar, /classCount\.unavailable \? \(/);
  assert.match(calendar, /title="Class-count attendance is not available right now"/);
  assert.match(calendar, /<RecentAttendanceTable items=\{classCount\.items\} \/>/);
  // The month calendar: "not available" when its month could not be read, independent of the class-count tab.
  assert.match(calendar, /strip === null \? \(/);
  assert.match(calendar, /title="Attendance is not available right now"/);
});

test("the Type label and the status vocabulary are on the rows, and the Membership Details panel is untouched", () => {
  const table = read("../../app/students/[id]/recent-attendance-table.js");
  assert.match(table, /ATTENDANCE_TYPE_LABELS\.session/);
  assert.match(table, /ATTENDANCE_TYPE_LABELS\.class_count/);
  assert.match(table, /\{record\.afterExpiry \? <Badge variant="info">\{EXPIRY_FLAG_LABEL\}<\/Badge> : null\}/);
  const section = read("../../app/attendance-history/history-class-count-section.js");
  assert.match(section, /record\.afterExpiry \? <Badge variant="info">\{EXPIRY_FLAG_LABEL\}<\/Badge> : null/);
  assert.ok(existsSync(new URL("../../app/memberships/[id]/class-attendance-panel.js", import.meta.url)));
  assert.match(read("../../app/memberships/[id]/class-attendance-panel.js"), /attendedAfterExpiry\(record, endDate\)/);
});

test("the section 6A ledger records 0052 as applied by the user, with the reported behaviour result", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0052` |"));
  assert.ok(row, "a 0052 row");
  assert.match(row, /Applied by the user \(reported 2026-10-15\); behaviour script passed — 58 passed, 0 failed, 0 not tested/);
  assert.match(row, /returned 58 passed, 0 failed, 0 not tested/);
  assert.match(row, /Instructor/);
});

test("the docs describe the visibility", () => {
  const product = read("../../docs/01-product.md");
  assert.match(product, /\*\*Visibility on Student Details and Attendance History\.\*\*/);
  assert.match(product, /An \*\*Instructor\*\* sees class-count records in Attendance History only for the students they are authorized for/);
  const ux = read("../../docs/02-ux.md");
  assert.match(ux, /Class-count attendance on Student Details and Attendance History/);
  assert.match(read("../../docs/04-development-plan.md"), /Class-count attendance visibility/);
});
