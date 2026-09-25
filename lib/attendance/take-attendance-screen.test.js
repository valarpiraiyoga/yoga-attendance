// Run with `npm test` (Node's built-in test runner).
//
// Take Attendance is one focused screen: the compact page strip, a one-line session
// summary, the student rows and a save bar. No tabs and no summary tiles.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const dir = "../../app/attendance/[scheduleId]/[date]";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "");

test("the session screen has no tabs and no summary tiles, and always shows the attendance list", () => {
  const page = code(`${dir}/page.js`);
  assert.doesNotMatch(page, /Tabs|StatTile|SessionOverview|EligibleStudentsList|activeTab|getAttendanceSummary/);
  assert.match(page, /<AttendancePanel/);
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/attendance", label: "Back to Attendance" \}\}/);
  assert.match(page, /"Take Attendance"/);

  const header = code(`${dir}/session-header.js`);
  assert.doesNotMatch(header, /Tabs|EntityDetailHeader|ArrowLeft|Eligible Students/);

  const panel = code(`${dir}/attendance-panel.js`);
  assert.doesNotMatch(panel, /StatTile|<Table|TableRow|Membership/);
});

test("nothing links to a tab any more", () => {
  for (const path of [
    "../../app/attendance/session-summary.js",
    "../../app/dashboard-todays-classes.js",
    "../../app/dashboard-upcoming-classes.js",
  ]) {
    assert.doesNotMatch(source(path), /tab=attendance|\?tab=/, path);
  }
});

test("View Session Details opens Session Details, not the attendance screen", () => {
  const summary = source("../../app/attendance/session-summary.js");
  assert.match(summary, /detailsHref: `\$\{basePath\}\/details`/);
  // Take / View Attendance stay on the attendance screen; a session with none to take opens its details.
  assert.match(summary, /actionHref: actionLabel === "View Session" \? `\$\{basePath\}\/details` : basePath/);
  assert.match(source("../../app/dashboard-upcoming-classes.js"), /\$\{session\.session_date\}\/details/);
  assert.match(source("../../app/dashboard-todays-classes.js"), /label === "View Session" \? "\/details" : ""/);
  // The attendance screen points to it too.
  assert.match(source(`${dir}/session-header.js`), /href=\{`\$\{base\}\/details`\}/);
});

test("Session Details shows the session header, the attendance summary and the eligible students", () => {
  assert.equal(existsSync(new URL(`${dir}/details/page.js`, import.meta.url)), true);
  const page = code(`${dir}/details/page.js`);
  assert.match(page, /<PageHeader\s+compact\s+back=\{\{ href: "\/attendance", label: "Back to Attendance" \}\}/);
  assert.match(page, /title="Session Details"/);
  assert.match(page, /decorative=\{false\}\s+wash/, "the detail header card, like Student and Batch Details");
  assert.match(page, /<EligibleStudentsList students=\{eligibleStudents\} batch=\{session\.batches\} \/>/);
  assert.match(page, /getAttendanceSummary\(/);
  assert.doesNotMatch(page, /Tabs/, "one page, no tabs");
});

test("the Session Details header is about the session: date and time as the heading, its own status beside it", () => {
  const page = code(`${dir}/details/page.js`);
  const header = page.slice(page.indexOf("<EntityDetailHeader"), page.indexOf("<StatTileGroup"));
  // The same start-time tile the session card in the list uses (one shared component).
  assert.match(header, /avatar=\{<StartTimeTile startTime=\{session\.start_time\} label=\{timeLabel\} \/>\}/);
  assert.match(source("../../app/attendance/session-card-item.js"), /import StartTimeTile from "@\/components\/ui\/start-time-tile"/);
  // Heading = date + time; the batch is NOT the heading, so a Cancelled badge cannot read as a cancelled batch.
  assert.match(page, /formatDateWithWeekday\(session\.session_date\)/);
  assert.match(header, /status=\{\s*<Badge variant=\{DISPLAY_STATUS_BADGE_VARIANTS\[displayStatus\]\}/);
  assert.doesNotMatch(header, /title=\{batchName\}/);
  // Day, month and start time are large; the year and the end time are small; the batch code is in the heading.
  const title = header.slice(header.indexOf("title={"), header.indexOf("status={"));
  assert.match(title, /\{dayMonth\}\s*<span className="text-section-title[^"]*">\{yearLabel\}<\/span>/, "day and month large, year small");
  assert.match(title, /\{formatTime\(session\.start_time\)\}\s*<span className="text-section-title[^"]*"> – \{formatTime\(session\.end_time\)\}<\/span>/, "start time large, end time small");
  assert.match(title, /\{batchCode \? \(/, "the batch code is in the heading");
  assert.doesNotMatch(header.slice(header.indexOf("subMeta=")), /Code: /, "and is not repeated below it");
  // The batch name and the instructor sit under the heading, with the session note if there is one.
  for (const field of ["batchName", "session.instructors?.full_name", "session.note"]) {
    assert.ok(header.includes(field), field);
  }
  // No separate Session Information card any more.
  assert.doesNotMatch(page, /Session Information|SessionOverview/);
  assert.equal(existsSync(new URL(`${dir}/session-overview.js`, import.meta.url)), false);
});

test("Session Details shows the attendance numbers as the same four KPI cards Attendance Details uses", () => {
  const page = code(`${dir}/details/page.js`);
  assert.match(page, /<StatTileGroup ariaLabel="Attendance summary"/);
  assert.equal((page.match(/<StatTile\b/g) ?? []).length, 4);
  for (const label of ["Eligible", "Present", "Absent", "Attendance"]) {
    assert.ok(page.includes(`label="${label}"`), label);
  }
  // Unmarked is a caption on Eligible, not a fifth card; a percentage of nothing is a dash.
  assert.match(page, /not marked yet/);
  assert.match(page, /marked > 0 \? `\$\{summary\.percentage \?\? 0\}%` : "—"/);
  // The way into the marking screen is the header's action, with the list's own label rule.
  assert.match(page, /sessionActionLabel\(session, todayInCentreTimezone\(new Date\(\), timeZone\)\)/);
  assert.match(page, /actionLabel !== "View Session"/);
  assert.match(page, /render=\{<Link href=\{base\} \/>\}/);
  const summary = source("../../app/attendance/session-summary.js");
  assert.match(summary, /export function sessionActionLabel\(session, today\)/);
  assert.match(summary, /const actionLabel = sessionActionLabel\(session, today\);/, "the list uses the same rule");
});

test("Edit This Session and Mark Cancelled / Holiday return to Session Details and refresh both screens", () => {
  const edit = source(`${dir}/edit/page.js`);
  assert.match(edit, /back=\{\{ href: `\/attendance\/\$\{scheduleId\}\/\$\{date\}\/details`, label: "Back to Session Details" \}\}/);
  assert.match(edit, /cancelHref=\{`\/attendance\/\$\{scheduleId\}\/\$\{date\}\/details`\}/);
  const actions = source("../../lib/class-sessions/actions.js");
  assert.match(actions, /redirect\(`\$\{sessionDetailsPath\(scheduleId, date\)\}\?success=updated`\)/);
  assert.match(actions, /function revalidateSession\(/);
  assert.match(source("../../lib/attendance/actions.js"), /revalidatePath\(`\/attendance\/\$\{scheduleId\}\/\$\{date\}\/details`\)/);
});

test("the session summary is one line of batch, status, date, time and instructor", () => {
  const header = source(`${dir}/session-header.js`);
  assert.match(header, /<BatchAvatar[^>]*size="md"/);
  assert.match(header, /DISPLAY_STATUS_LABELS\[displayStatus\]/);
  for (const field of ["session_date", "start_time", "instructors?.full_name"]) {
    assert.ok(header.includes(field), field);
  }
  // The admin's occasional actions live in the overflow menu, and only for an admin.
  assert.match(header, /hasActions = isAdmin && \(canEdit \|\| canMarkException\)/);
  assert.match(header, /<SessionActionsMenu/);
});

test("Edit This Session and Mark Cancelled / Holiday sit in the overflow menu with their own rules", () => {
  const menu = source(`${dir}/session-actions-menu.js`);
  assert.match(menu, /aria-label="Session actions"/);
  assert.match(menu, /\{canEdit \? \(/);
  assert.match(menu, /\{canMarkException \? \(/);
  assert.match(menu, /`\$\{base\}\/edit`/);
  assert.match(menu, /<MarkSession key=\{markKey\} scheduleId=\{scheduleId\} date=\{date\} sessionContext=\{sessionContext\} defaultOpen hideTrigger \/>/);

  const mark = source(`${dir}/mark-session.js`);
  assert.match(mark, /defaultOpen = false, hideTrigger = false/);
  assert.match(mark, /markSessionException\(/, "the same action and the same two-step dialog");
});

test("students are rows with the shared Present | Absent toggle; search shows only on a long list", () => {
  const panel = source(`${dir}/attendance-panel.js`);
  assert.match(panel, /<ul aria-label="Student attendance"/);
  assert.match(panel, /import MarkButton from "@\/components\/ui\/mark-button"/);
  assert.match(panel, /SEARCH_THRESHOLD = 8/);
  assert.match(panel, /showSearch = eligibleStudents\.length > SEARCH_THRESHOLD/);
  assert.match(panel, /\{showSearch \? \(/);
  // Mark All Present, the save action and the review step for a completed session are unchanged.
  assert.match(panel, /Mark All Present/);
  assert.match(panel, /saveSessionAttendance\(scheduleId, date, payload\)/);
  assert.match(panel, /title="Review attendance changes"/);
});

test("the save bar stays on screen and carries the progress", () => {
  const panel = source(`${dir}/attendance-panel.js`);
  assert.match(panel, /sticky bottom-4/);
  assert.match(panel, /<MarkedProgress summary=\{summary\} \/>/);
  assert.match(panel, /role="progressbar"/);
  assert.match(panel, /of \{total\} marked/);
});

test("an admin can Mark Cancelled / Holiday from a session's row menu, only while it is still scheduled", () => {
  const menu = source("../../app/attendance/session-card-menu.js");
  assert.match(menu, /\{canMarkException \? \(/);
  assert.match(menu, />Mark Cancelled \/ Holiday</);
  assert.match(menu, /<MarkSession key=\{markKey\} scheduleId=\{scheduleId\} date=\{date\} sessionContext=\{sessionContext\} defaultOpen hideTrigger \/>/, "the same two-step dialog");

  // The rule: admin, and the stored status is still scheduled (as on Session Details).
  for (const path of ["../../app/attendance/session-card-item.js", "../../app/attendance/session-table.js"]) {
    assert.match(source(path), /canMarkException=\{isAdmin && session\.status === "scheduled"\}/, path);
  }
  // The role reaches the rows from the page, through both list layouts.
  assert.match(source("../../app/attendance/page.js"), /const isAdmin = user\.role === ROLES\.ADMIN/);
  assert.equal((source("../../app/attendance/page.js").match(/isAdmin=\{isAdmin\}/g) ?? []).length, 2);
  assert.match(source("../../app/attendance/session-list.js"), /isAdmin=\{isAdmin\}/);
  assert.match(source("../../app/attendance/session-timeline.js"), /isAdmin=\{isAdmin\}/);
});

test("a cancelled or holiday session does not claim its students are 'not marked yet'", () => {
  const page = code(`${dir}/details/page.js`);
  assert.match(page, /takesAttendance = session\.status !== "cancelled" && session\.status !== "holiday"/);
  assert.match(page, /unmarked = takesAttendance \? \(summary\.unmarkedCount \?\? 0\) : 0/);
});

test("the Mark Cancelled / Holiday dialog says which session it is for, on both steps, from every entry point", () => {
  const context = source("../../app/attendance/session-context.js");
  assert.match(context, /export function sessionContextOf\(session\)/);
  assert.match(context, /<StartTimeTile startTime=\{context\.startTime\} label=\{timeLabel\} \/>/, "the session's own mark");
  for (const field of ["context.batchName", "context.batchCode", "context.date", "timeLabel", "context.instructor"]) {
    assert.ok(context.includes(field), field);
  }

  const mark = source(`${dir}/mark-session.js`);
  assert.equal((mark.match(/<SessionContext context=\{sessionContext\} \/>/g) ?? []).length, 2, "compose and review");

  // Both menus hand the context on; each place that offers the action supplies it.
  assert.match(source(`${dir}/session-actions-menu.js`), /sessionContext=\{sessionContext\}/);
  assert.match(source("../../app/attendance/session-card-menu.js"), /sessionContext=\{sessionContext\}/);
  for (const path of [
    "../../app/attendance/session-card-item.js",
    "../../app/attendance/session-table.js",
    `${dir}/session-header.js`,
    `${dir}/details/page.js`,
  ]) {
    assert.match(source(path), /sessionContext=\{sessionContextOf\(session\)\}/, path);
  }
});
