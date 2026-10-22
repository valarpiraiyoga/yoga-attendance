// Migration 0051 (join-date rules and the enrollment start-date cascade): what its SQL says, what the verification script covers,
// and how the application is wired to it. These are source pins: the behaviour itself is exercised by
// supabase/verification/verify_0051_enrollment_membership_date_rules_behavior.sql against a real database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("../../supabase/migrations/0051_enrollment_membership_date_rules.sql");
const script = read("../../supabase/verification/verify_0051_enrollment_membership_date_rules_behavior.sql");
const code = sql.replace(/^--.*$/gm, "");

test("0051 is a new file that rewrites no earlier migration and does not need the reserved 0050", () => {
  assert.doesNotMatch(code, /\bdrop (table|function|policy|column)\b/i);
  assert.doesNotMatch(code, /\b(insert into|delete from|alter table)\b/i);
  assert.doesNotMatch(code, /update public\.(memberships|batch_enrollments|students)\b/i);
  assert.doesNotMatch(code, /create (table|policy)|grant /i);
  assert.match(sql, /does not depend on 0050/);
});

test("it refuses to run without the tables and the 0013 no-overlap constraint", () => {
  assert.match(code, /enrollment_schedules_no_overlap/);
  assert.match(code, /to_regclass\('public\.enrollment_schedules'\) is null/);
});

test("the join-date guards fire on insert and on a change of the start date only, and check one thing", () => {
  assert.match(code, /before insert or update of effective_start_date on public\.batch_enrollments/);
  assert.match(code, /before insert or update of start_date on public\.memberships/);
  assert.match(code, /new\.effective_start_date is not distinct from old\.effective_start_date then\s+return new/);
  assert.match(code, /new\.start_date is not distinct from old\.start_date then\s+return new/);
  assert.equal((code.match(/errcode = '23514'/g) ?? []).length, 3);
});

test("the guards read the student row FOR SHARE, and the join-date guard runs before the update on the locked row", () => {
  assert.equal((code.match(/where s\.id = new\.student_id for share/g) ?? []).length, 2);
  assert.match(code, /before update of join_date on public\.students/);
});

test("the join-date move guard counts only ACTIVE enrollments and NON-CANCELLED memberships, and only a later date", () => {
  assert.match(code, /be\.status = 'active' and be\.effective_start_date < new\.join_date/);
  assert.match(code, /m\.cancelled_at is null and m\.start_date < new\.join_date/);
  assert.match(code, /new\.join_date <= old\.join_date then\s+return new/);
});

test("the cascade moves only assignments that start on the OLD start, and never on a batch change", () => {
  assert.match(code, /after update of effective_start_date on public\.batch_enrollments/);
  assert.match(code, /new\.batch_id = old\.batch_id/);
  assert.match(code, /where batch_enrollment_id = new\.id\s+and effective_start_date = old\.effective_start_date/);
  assert.equal((code.match(/update public\.enrollment_schedules/g) ?? []).length, 1);
  assert.doesNotMatch(code, /effective_end_date\s*=/);
});

test("nothing of attendance, sessions, snapshots, payments, receipts or packages is touched", () => {
  assert.doesNotMatch(code, /class_session|class_count_attendance|eligibility|invoice|membership_payments|package/i);
});

test("the functions are security definer with an empty search_path and are not callable by clients", () => {
  assert.equal((code.match(/security definer\s+set search_path = ''/g) ?? []).length, 4);
  assert.equal((code.match(/revoke execute on function public\.\w+\(\) from public, anon, authenticated/g) ?? []).length, 4);
});

test("the membership trigger is independent of the package, payment, expiry and receipt triggers", () => {
  assert.doesNotMatch(code, /yoga\.class_count_expiry_edit|memberships_package_guard|memberships_payments_guard|memberships_sync_invoice/);
  assert.match(sql, /does not touch the package guard \(0048\), the payment guard \(0034\), the class-count expiry guard \(0049\)/);
});

test("the verification script is rollback-only, runs nothing when 0051 is missing, and covers each rule", () => {
  assert.match(script, /^begin isolation level repeatable read;/m);
  assert.match(script, /^rollback;/m);
  assert.doesNotMatch(script, /^commit;/m);
  assert.match(script, /P0 migration 0051 is applied/);
  for (const id of ["E1", "E2", "M1", "U1", "U3", "M4", "C1", "C2", "C3", "O1", "O2", "B1", "J1", "J5", "Z"]) {
    assert.match(script, new RegExp(`'${id} `), `scenario ${id}`);
  }
  assert.match(script, /leftover_students/);
});

test("the enrollment actions check the join date, map the database rules and report the moved count", () => {
  const actions = read("../enrollments/actions.js");
  assert.match(actions, /startBeforeJoinDateError\("enrollment"/);
  assert.match(actions, /changedStartBeforeJoinDateError\("enrollment"/);
  // The database rules are mapped through lib/enrollments/save-errors.js, which still starts with matchKnownJoinDateError.
  assert.match(actions, /mapEnrollmentSaveError\(error, \{ scheduleLabel: label \}\)/);
  assert.match(read("../enrollments/save-errors.js"), /const joinRule = matchKnownJoinDateError\(error\);/);
  assert.match(actions, /&moved=\$\{movedAssignments\}/);
  // The moved count is the one change_enrollment (0060) returns: it collects the assignments on the OLD start inside the same
  // transaction as the 0051 cascade.
  assert.match(actions, /const movedAssignments = Number\(saved\?\.moved\) \|\| 0;/);
  assert.match(read("../../supabase/migrations/0060_schedule_capacity.sql"), /es\.batch_enrollment_id = p_enrollment_id and es\.effective_start_date = v_stored\.effective_start_date/);
});

test("the membership actions check the join date on create, renew, package create and a changed start", () => {
  const actions = read("../memberships/actions.js");
  assert.match(actions, /startBeforeJoinDateError\("membership"/);
  assert.match(actions, /changedStartBeforeJoinDateError\("membership"/);
  assert.match(actions, /joinDate: joiner\?\.join_date \?\? null/);
  assert.match(read("../packages/service-core.js"), /The membership cannot start before the student joined/);
});

test("the student action refuses a join date moved past live records before it stages a photo", () => {
  const actions = read("../students/actions.js");
  assert.match(actions, /joinDateMoveError\(/);
  assert.match(actions, /\.eq\("status", "active"\)\.lt\("effective_start_date"/);
  assert.match(actions, /\.is\("cancelled_at", null\)\.lt\("start_date"/);
  assert.ok(actions.indexOf("joinDateMoveError(") < actions.lastIndexOf("stagePhotoChange("));
});

test("the forms say the start date cannot be before the join date", () => {
  assert.match(read("../../app/students/[id]/enrollments/enrollment-form.js"), /Cannot be before the student&rsquo;s join date/);
  assert.match(read("../../app/memberships/package-membership-form.js"), /Not before the student's join date/);
  assert.match(read("../../app/students/[id]/page.js"), /movedAssignmentsText\(rawParams\?\.moved\)/);
});

test("the section 6A ledger records 0051 as applied, with the reported behaviour result and the untested limits", () => {
  const plan = read("../../docs/04-development-plan.md");
  const row = plan.split("\n").find((line) => line.startsWith("| `0051` |"));
  assert.ok(row, "a 0051 row");
  assert.match(row, /Applied to `yoga-attendance-demo`; behaviour script passed — 39 passed, 0 failed, 0 not tested/);
  assert.match(row, /reported by the user/);
  assert.match(row, /0 students, 0 batches, 0 instructors and 0 packages/);
  assert.match(row, /Still not verified:\*\* concurrency/);
  assert.match(row, /reactivation race/);
  assert.doesNotMatch(row, /Repository only/);
});
