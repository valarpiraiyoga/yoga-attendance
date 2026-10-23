// Run with `npm test`. The grouping is pure and run directly; the section's wiring is pinned from source (the screen needs the Next.js runtime).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_SESSION_KEY, groupStudentsBySession, instructorCountLabel, studentCountLabel } from "./students-by-session.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const KANNAN = { id: "i1", full_name: "Kannan Thangavel" };
const MEERA = { id: "i2", full_name: "Meera S" };
const sched = (series, start, end, instructors) => ({ series_id: series, start_time: start, end_time: end, instructors });
const SCHEDULES = [sched("s-am-k", "06:00:00", "07:00:00", KANNAN), sched("s-am-m", "06:00:00", "07:00:00", MEERA), sched("s-pm", "17:00:00", "18:00:00", KANNAN)];
const enr = (id) => ({ id, students: { full_name: `Student ${id}` } });
const asg = (enrollment, series) => ({ batch_enrollment_id: enrollment, schedule_series_id: series });

test("one group per time slot, earliest first, each student under their slot with that slot's instructor", () => {
  const groups = groupStudentsBySession({
    enrollments: [enr("a"), enr("b"), enr("c")],
    assignments: [asg("a", "s-pm"), asg("b", "s-am-k"), asg("c", "s-am-m")],
    schedules: SCHEDULES,
  });
  assert.deepEqual(groups.map((group) => group.key), ["06:00:00-07:00:00", "17:00:00-18:00:00"]);
  assert.deepEqual(groups[0].rows.map((row) => [row.enrollment.id, row.instructor.full_name]), [["b", "Kannan Thangavel"], ["c", "Meera S"]]);
  assert.equal(groups[0].studentCount, 2);
  assert.equal(groups[0].instructorCount, 2);
  assert.equal(groups[1].studentCount, 1);
  assert.equal(groups[1].instructorCount, 1);
});

test("a student in two slots appears under both; in one slot with two instructors, once per instructor but counted once", () => {
  const groups = groupStudentsBySession({
    enrollments: [enr("a")],
    assignments: [asg("a", "s-am-k"), asg("a", "s-am-m"), asg("a", "s-pm")],
    schedules: SCHEDULES,
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].studentCount, 1, "one student, however many instructors");
  assert.equal(groups[0].instructorCount, 2);
});

test("students with no current assignment (or an unknown series) go in a last 'no session' group; none lost", () => {
  const groups = groupStudentsBySession({
    enrollments: [enr("a"), enr("b"), enr("c")],
    assignments: [asg("a", "s-pm"), asg("b", "s-unknown")],
    schedules: SCHEDULES,
  });
  const last = groups[groups.length - 1];
  assert.equal(last.key, NO_SESSION_KEY);
  assert.deepEqual(last.rows.map((row) => row.enrollment.id), ["b", "c"]);
  assert.equal(groups.flatMap((group) => group.rows).length, 3);
});

test("assignments that could not be read (null): every student is listed, in the no-session group", () => {
  const groups = groupStudentsBySession({ enrollments: [enr("a"), enr("b")], assignments: null, schedules: SCHEDULES });
  assert.deepEqual(groups.map((group) => group.key), [NO_SESSION_KEY]);
  assert.equal(groups[0].studentCount, 2);
  assert.deepEqual(groupStudentsBySession({ enrollments: [], assignments: [], schedules: SCHEDULES }), []);
});

test("a slot taught by nobody has no instructor row and counts none", () => {
  const groups = groupStudentsBySession({ enrollments: [enr("a")], assignments: [asg("a", "s-x")], schedules: [sched("s-x", "09:00:00", "10:00:00", null)] });
  assert.equal(groups[0].instructorCount, 0);
  assert.equal(groups[0].rows[0].instructor, null);
});

test("count wording", () => {
  assert.equal(studentCountLabel(1), "1 student");
  assert.equal(studentCountLabel(12), "12 students");
  assert.equal(instructorCountLabel(0), "No instructor");
  assert.equal(instructorCountLabel(1), "1 instructor");
  assert.equal(instructorCountLabel(2), "2 instructors");
});

test("wiring: the page reads the enrollments' current assignments once (one query, not one per student) and the section groups them", () => {
  const data = code("lib/enrollments/data.js");
  assert.match(data, /export async function listScheduleAssignmentsForEnrollments\(enrollmentIds\)/);
  assert.match(data, /\.from\("enrollment_schedules"\)[\s\S]*?\.in\("batch_enrollment_id"/);
  const page = code("app/batches/[id]/page.js");
  assert.ok(page.includes("listScheduleAssignmentsForEnrollments(enrollments.map((enrollment) => enrollment.id))"));
  assert.ok(page.includes("isScheduleAssignmentActive(assignment, today)"), "only current assignments, by the existing rule");
  assert.match(page, /<BatchStudentsSection\s+enrollments=\{enrollments\}\s+activeCount=\{activeStudentCount\}\s+assignments=\{assignments\}\s+schedules=\{currentSchedules\}/);
  const section = code("app/batches/[id]/batch-students-section.js");
  assert.ok(section.includes("groupStudentsBySession({ enrollments: visible, assignments, schedules })"));
  assert.ok(section.includes("rowSpan"));
});
