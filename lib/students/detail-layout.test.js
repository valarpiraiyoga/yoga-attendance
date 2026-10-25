// Run with `npm test` (Node's built-in test runner).
//
// Student Details (the approved Student Details design): page strip, identity header, then two columns from xl -
// left: Batch Enrollments, Recent Attendance, Profile & Contact, Additional Information, Communication History; right:
// Membership, Membership History. Below xl the columns stack in that same order. Every student field stays on the page.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const code = strip(read("../../app/students/[id]/page.js"));
const at = (needle) => code.indexOf(needle);

test("no summary tiles: the identity header is followed directly by the two columns", () => {
  assert.doesNotMatch(code, /<StatTileGroup|<StatTile\b/);
  assert.ok(at("<StudentHeader") < at('title="Batch Enrollments"'));
});

test("left column, in order: Batch Enrollments, Recent Attendance, Profile & Contact, Additional Information, Communication History", () => {
  const left = at('title="Batch Enrollments"');
  assert.ok(left > 0);
  assert.ok(left < at("<AttendanceCalendar"));
  assert.ok(at("<AttendanceCalendar") < at("<ProfileContact"), "Profile & Contact is directly below Recent Attendance");
  assert.ok(at("<ProfileContact") < at('title="Additional Information"'));
  assert.ok(at('title="Additional Information"') < at("<CommunicationHistory"));
});

test("right column, in order: Membership, Membership History - and nothing else", () => {
  assert.ok(at("<CommunicationHistory") < at('title="Membership"'), "the right column follows the left one (mobile order)");
  assert.ok(at('title="Membership"') < at("<MembershipHistory"));
  const right = code.slice(at('title="Membership"'));
  assert.ok(!right.includes("<ProfileContact"), "Profile & Contact is not in the right column");
  assert.ok(!right.includes('title="Additional Information"'), "Additional Information is not in the right column");
});

test("two columns from xl, the working column wider; one column below", () => {
  assert.match(code, /grid grid-cols-1 items-start gap-6 xl:grid-cols-\[minmax\(0,1\.45fr\)_minmax\(0,1fr\)\]/);
  assert.equal((code.match(/<div className="flex min-w-0 flex-col gap-6">/g) ?? []).length, 2, "one wrapper per column");
});

test("no student field is dropped: identity header + Profile & Contact + Additional Information cover them all", () => {
  const header = strip(read("../../app/students/[id]/student-header.js"));
  for (const field of ["student.full_name", "student.student_code", "student.gender", "student.join_date"]) {
    assert.ok(header.includes(field), `${field} is in the identity header`);
  }
  const contact = strip(read("../../app/students/[id]/profile-contact.js"));
  for (const label of ["Phone", "Email", "Date of Birth", "Gender"]) {
    assert.ok(contact.includes(`label="${label}"`), label);
  }
  assert.match(contact, /href=\{`\/students\/\$\{student\.id\}\/edit`\}/, "Edit opens the existing Edit Student form");
  const extraStart = at('title="Additional Information"');
  const extra = code.slice(extraStart, code.indexOf("</Panel>", extraStart));
  assert.match(extra, /student\.notes \? \(/);
  assert.match(extra, /title="No additional information yet"/);
});

test("header actions: the status toggle and Edit Student; no More button or dropdown on Student Details", () => {
  const header = strip(read("../../app/students/[id]/student-header.js"));
  assert.match(code, /<StudentHeader student=\{student\} showMenu=\{false\} \/>/);
  assert.match(header, /<StudentStatusButton/);
  assert.match(header, /href=\{`\/students\/\$\{student\.id\}\/edit`\}/);
  assert.match(header, /Edit Student/);
  // The menu stays an option of the shared header (Membership Details still shows it) but is switched off here.
  assert.match(header, /showMenu \? \(\s*<StudentCardMenu/);
  assert.doesNotMatch(code, /StudentCardMenu/);
});

test("batch enrollments use the shared batch identity mark, not a page-local tile", () => {
  assert.match(code, /import BatchAvatar from "@\/components\/ui\/batch-avatar"/);
  assert.match(code, /<BatchAvatar batch=\{\{ \.\.\.enrollment\.batches, name: batchName \}\}/);
  assert.doesNotMatch(code, /batchAbbreviation/);
  const data = read("../enrollments/data.js");
  assert.match(data, /batches\(id, name, code, batch_color, batch_image_url\)/);
});

test("Membership: Add Membership in the header; the summary card shows number, plan, status, validity, amount and payment", () => {
  assert.match(code, /href=\{`\/students\/\$\{student\.id\}\/memberships\/new`\}/);
  const card = strip(read("../../app/students/[id]/membership-summary-card.js"));
  for (const needle of [
    "{membership.membership_code}",
    "PLAN[membership.plan]",
    "{status.label}",
    'label="Validity"',
    'label="Amount"',
    "{payment.label}",
    "href={`/memberships/${membership.id}`}",
    "href={`/memberships/${membership.id}/edit`}",
  ]) {
    assert.ok(card.includes(needle), needle);
  }
});

test("Membership History: the other memberships, numbered, real status, opening Membership Details", () => {
  assert.match(code, /const otherMemberships = memberships\.filter\(\(membership\) => membership\.id !== currentMembership\?\.id\);/);
  const history = strip(read("../../app/students/[id]/membership-history.js"));
  assert.match(history, /title="Membership History"/);
  assert.match(history, /\{index \+ 1\}/);
  assert.match(history, /MEMBERSHIP_STATUS\[membership\.status\]/);
  assert.doesNotMatch(history, /Completed/, "no invented status label");
  assert.match(history, /href=\{`\/memberships\/\$\{membership\.id\}`\}/);
  assert.match(history, /<ChevronRight/);
});

test("Recent Attendance: the calendar reads only recorded marks, Admin only, from the existing tables", () => {
  const data = read("./attendance-calendar-data.js");
  assert.match(data, /import "server-only";/);
  assert.match(data, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(data, /\.from\("attendance"\)\s*\.select\("status, class_sessions!inner\(session_date, batch_id, start_time, end_time, instructors\(id, full_name, photo_url\)\)"\)/);
  assert.match(data, /\.eq\("class_sessions\.batch_id", batchId\)/);
  assert.doesNotMatch(data, /\.(insert|update|delete|upsert|rpc)\(/);
  const calendar = strip(read("../../app/students/[id]/attendance-calendar.js"));
  assert.match(calendar, /View All/);
  assert.match(calendar, /\/attendance-history\?/);
  for (const label of ["Present", "Absent", "Not Enrolled"]) assert.ok(calendar.includes(`label: "${label}"`), label);
});

test("Recent Attendance shows the student's class dates only: read-only, Admin only, and a month with none says so", () => {
  const data = read("./attendance-calendar-data.js");
  const classDates = data.slice(data.indexOf("export async function listStudentBatchClassDates"));
  assert.match(classDates, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(classDates, /\.from\("schedules"\)\.select\("id, series_id, day_of_week, start_time, end_time, effective_from, effective_until, instructors\(id, full_name, photo_url\)"\)\.eq\("batch_id", batchId\)/);
  assert.match(classDates, /\.from\("class_sessions"\)\s*\.select\("schedule_id, session_date, status, start_time, end_time, instructors\(id, full_name, photo_url\)"\)\s*\.eq\("batch_id", batchId\)/);
  assert.match(classDates, /occursOn: scheduleOccursOnDate,/, "the schedule's own occurrence rule, not a new one");
  assert.doesNotMatch(classDates, /\.(insert|update|delete|upsert|rpc)\(/);
  // The page reads the marks and the class dates together; either failing leaves the panel saying so.
  assert.match(code, /records === null \|\| occurrences === null/);
  assert.match(code, /classDates: occurrences\.map\(\(occurrence\) => occurrence\.date\),\s+instructors: instructorsByDate\(occurrences, records\),/);
  assert.match(strip(read("../../app/students/[id]/attendance-calendar.js")), /strip\.length === 0 \? \(/);
});

test("date cards: header, status circle, instructor avatar; the instructor comes from the same two reads, never assumed", () => {
  const stripCode = strip(read("../../app/students/[id]/attendance-strip.js"));
  assert.match(stripCode, /import Avatar from "@\/components\/ui\/avatar";/, "the app's avatar, with its initials fallback");
  assert.match(stripCode, /<Avatar name=\{first\.name\} src=\{first\.photoUrl\}/);
  assert.match(stripCode, /<DayMarker status=\{day\.status\} \/>/);
  assert.match(stripCode, /<DayInstructors instructors=\{day\.instructors \?\? \[\]\} \/>/);
  assert.match(stripCode, /if \(instructors\.length === 0\) return null;/);
  const data = read("./attendance-calendar-data.js");
  // The instructor is embedded in the existing reads (no new query): the held session's, the schedule's, the mark's session's.
  assert.equal((data.match(/instructors\(id, full_name, photo_url\)/g) ?? []).length, 3);
  assert.equal((data.match(/\.from\("/g) ?? []).length, 3, "still exactly the same three reads");
});

test("date tooltip: Base UI tooltip on hover and focus, a touch tap path, Escape / outside tap / scroll to dismiss, no new reads", () => {
  const stripCode = strip(read("../../app/students/[id]/attendance-strip.js"));
  assert.match(stripCode, /import \{ Tooltip \} from "@base-ui\/react\/tooltip";/, "the installed primitive, no new dependency");
  assert.match(stripCode, /<Tooltip\.Trigger[\s\S]*?delay=\{350\}[\s\S]*?closeDelay=\{80\}[\s\S]*?closeOnClick=\{false\}/);
  assert.match(stripCode, /<Tooltip\.Positioner side="top" align="center" sideOffset=\{8\} collisionPadding=\{8\}/, "flips and shifts to stay on screen");
  // The click still selects; a touch tap additionally toggles the details.
  assert.match(stripCode, /setSelected\(day\.date\);[\s\S]*?if \(last && last\.type !== "mouse"\) setOpenDate\(last\.wasOpen \? null : day\.date\);/);
  assert.match(stripCode, /event\.key === "Escape"/);
  assert.match(stripCode, /closest\("\[data-day-card\], \[data-attendance-tip\]"\)/);
  assert.match(stripCode, /onScroll=\{\(\) => setOpenDate\(null\)\}/);
  // The tooltip: the date with the batch beneath it and NO overall status badge (a day can have several classes with different
  // states); then one row per class - time, instructor, and that class's own status circle in a right-hand column.
  const tip = stripCode.slice(stripCode.indexOf("function DayTip"), stripCode.indexOf("The calendar strip"));
  for (const needle of ["formatDateWithWeekday(day.date)", "{batchName}", "sessionTimeOf(session)", "session.instructor.name", "<DayMarker status={session.status} />"]) {
    assert.ok(tip.includes(needle), needle);
  }
  assert.doesNotMatch(stripCode, /<Badge|TIP_STATUS/, "no status badge anywhere in the tooltip");
  assert.doesNotMatch(tip, />\s*Time\s*</, "no redundant Time label");
  // The only "Instructor" label is the small role line directly beneath the instructor's name.
  assert.equal((tip.match(/>Instructor</g) ?? []).length, 1);
  assert.match(tip, /\{session\.instructor\.name\}<\/span>\s*<span[^>]*>Instructor<\/span>/);
  assert.match(tip, /grid-cols-\[minmax\(0,1fr\)_auto\]/, "details on the left, the status in its own right-hand column");
  assert.match(tip, /break-words/, "a long instructor name wraps instead of running under the status");
  assert.match(tip, /Time not available/);
  assert.match(tip, /Instructor not available/);
  assert.match(stripCode, /SESSION_STATUS_WORD\[session\.status\]/, "each class's own state is in the card's accessible label");
  // The same facts are in the card's accessible label, and the native title (a second tooltip) is gone.
  assert.match(stripCode, /aria-label=\{cardLabel\(day\)\}/);
  assert.doesNotMatch(stripCode, /\btitle=\{name\}/);
  // Times come from the same reads as before (the columns were added to them; no new query).
  const data = read("./attendance-calendar-data.js");
  assert.equal((data.match(/\.from\("/g) ?? []).length, 3);
  assert.equal((data.match(/start_time, end_time/g) ?? []).length, 3);
});

test("Membership History row: the dates alone (no repeated plan), and the documents are separate links", () => {
  const history = strip(read("../../app/students/[id]/membership-history.js"));
  // The dates already say the duration, so the plan is neither a line of its own nor in brackets beside the dates.
  assert.match(history, /<p className="text-small text-text-secondary">\{formatPeriod\(membership\.start_date, membership\.end_date\)\}<\/p>/);
  assert.doesNotMatch(history, /membershipPlanLine|PLAN\b/);
  // The issued invoices / receipts, each a link to its own page; the row's link is stretched, the document links sit above it.
  assert.match(history, /documents\.map\(\(document\) => \(\s*<Link\s+key=\{document\.id\}\s+href=\{document\.href\}/);
  assert.match(history, /\{document\.label\} \{document\.number\}/);
  assert.match(history, /after:absolute after:inset-0/);
  assert.match(history, /relative z-10/);
  assert.doesNotMatch(history, /lib\/invoices|\.invoice_number/, "uses the Documents module's precomputed number");
  // The data: only the issued documents' label columns are added to the student's membership read.
  const data = read("../memberships/data.js");
  assert.match(data, /documents: membershipDocumentLinks\(invoices, membership\.id\),/);
});

test("Membership: the current membership's issued invoice / receipt links sit beneath the card, only when it has any", () => {
  const card = strip(read("../../app/students/[id]/membership-summary-card.js"));
  // Shown by default; Membership Details' carousel turns them off (its Payments section has them).
  assert.match(card, /const documents = showDocuments \? \(membership\.documents \?\? \[\]\) : \[\];/);
  assert.match(card, /showDocuments = true/);
  // Beneath the card (after its closing tag), and only when there are documents.
  assert.ok(card.indexOf("{documents.length > 0 ? (") > card.indexOf("</dl>"));
  assert.match(card, /documents\.map\(\(document\) => \(\s*<Link\s+key=\{document\.id\}\s+href=\{document\.href\}/);
  assert.match(card, /\{document\.label\} \{document\.number\}/);
  assert.doesNotMatch(card, /lib\/invoices|\.invoice_number/, "the Documents module's precomputed number");
  // The same data as Membership History: the current membership comes from the same read (with its documents).
  assert.match(code, /const currentMembership = pickCurrentMembership\(memberships\);/);
});

test("the status control is an action button - Deactivate while active, Activate (green) while inactive - not a toggle icon", () => {
  const button = strip(read("../../app/students/[id]/student-status-button.js"));
  assert.doesNotMatch(button, /ToggleLeft|ToggleRight|size="icon"/);
  assert.match(button, /\{isActive \? "Deactivate" : "Activate"\}/);
  assert.doesNotMatch(button, /\{isActive \? "Active" : "Inactive"\}/, "the label is the action; the badge beside the name is the status");
  assert.match(button, /!isActive && "border-success\/30 bg-success\/5 text-success/);
  // Behaviour unchanged: Deactivate asks for confirmation, Activate happens in one click.
  assert.match(button, /onClick=\{isActive \? \(\) => setConfirmOpen\(true\) : \(\) => runStatusChange\("active"\)\}/);
  assert.match(button, /aria-label=\{/);
});
