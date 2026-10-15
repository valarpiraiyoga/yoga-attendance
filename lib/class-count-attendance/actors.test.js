// Who a class-count record is attributed to on Membership Details ("by ..."). Regression: an Instructor's record was shown "by Admin",
// because the names were read from `profiles` - which an Admin can read only for their OWN row - and every other ID fell back to
// "Admin". The database always stored the right ID (auth.uid()); only the label was wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ADMIN_LABEL, UNKNOWN_ACTOR_LABEL, actorLabelOf, actorLabels } from "./actors.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const INSTRUCTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

// What the Admin's session can read: their own profile only, and the instructors table.
const ADMIN_OWN_PROFILE = [{ id: ADMIN_ID, role: "admin", full_name: "Meera Nair" }];
const INSTRUCTORS = [{ user_id: INSTRUCTOR_ID, full_name: "Ravi Kumar" }];

test("an entry recorded by the Admin and one recorded by an Instructor get different, correct labels", () => {
  const labels = actorLabels({ ids: [ADMIN_ID, INSTRUCTOR_ID], profiles: ADMIN_OWN_PROFILE, instructors: INSTRUCTORS });
  assert.equal(actorLabelOf(labels, ADMIN_ID), "Meera Nair");
  assert.equal(actorLabelOf(labels, INSTRUCTOR_ID), "Ravi Kumar (Instructor)");
  assert.notEqual(actorLabelOf(labels, ADMIN_ID), actorLabelOf(labels, INSTRUCTOR_ID));
});

test("an Instructor is never labelled Admin, even though their own profile row is not readable by the Admin", () => {
  const labels = actorLabels({ ids: [INSTRUCTOR_ID], profiles: ADMIN_OWN_PROFILE, instructors: INSTRUCTORS });
  assert.equal(actorLabelOf(labels, INSTRUCTOR_ID), "Ravi Kumar (Instructor)");
  assert.doesNotMatch(actorLabelOf(labels, INSTRUCTOR_ID), /^Admin/);
});

test("an Admin whose profile has no name is shown as Admin; an Instructor with no name as Instructor", () => {
  const labels = actorLabels({
    ids: [ADMIN_ID, INSTRUCTOR_ID],
    profiles: [{ id: ADMIN_ID, role: "admin", full_name: null }],
    instructors: [{ user_id: INSTRUCTOR_ID, full_name: "  " }],
  });
  assert.equal(actorLabelOf(labels, ADMIN_ID), ADMIN_LABEL);
  assert.equal(actorLabelOf(labels, INSTRUCTOR_ID), "Instructor");
});

test("an ID that cannot be identified is Unknown user - never guessed to be an Admin", () => {
  const labels = actorLabels({ ids: [OTHER_ID], profiles: ADMIN_OWN_PROFILE, instructors: INSTRUCTORS });
  assert.equal(actorLabelOf(labels, OTHER_ID), UNKNOWN_ACTOR_LABEL);
  assert.equal(actorLabelOf(new Map(), OTHER_ID), UNKNOWN_ACTOR_LABEL, "an ID that was never looked up is unknown too");
  assert.notEqual(UNKNOWN_ACTOR_LABEL, ADMIN_LABEL);
});

test("no stored ID (the account was deleted) shows as nothing, not as a person", () => {
  assert.equal(actorLabelOf(new Map(), null), null);
  assert.equal(actorLabelOf(new Map(), undefined), null);
  assert.equal(actorLabelOf(new Map(), ""), null);
});

test("an Instructor's name comes from the instructors table first, and a profile of an instructor is a fallback", () => {
  const labels = actorLabels({
    ids: [INSTRUCTOR_ID],
    profiles: [{ id: INSTRUCTOR_ID, role: "instructor", full_name: "Profile Name" }],
    instructors: [{ user_id: INSTRUCTOR_ID, full_name: "Ravi Kumar" }],
  });
  assert.equal(actorLabelOf(labels, INSTRUCTOR_ID), "Ravi Kumar (Instructor)");
  const profileOnly = actorLabels({ ids: [INSTRUCTOR_ID], profiles: [{ id: INSTRUCTOR_ID, role: "instructor", full_name: "Profile Name" }], instructors: [] });
  assert.equal(actorLabelOf(profileOnly, INSTRUCTOR_ID), "Profile Name (Instructor)");
});

test("empty and missing inputs are safe", () => {
  assert.equal(actorLabels({ ids: [] }).size, 0);
  assert.equal(actorLabels({ ids: [null, undefined, ""] }).size, 0);
  assert.equal(actorLabels({ ids: [ADMIN_ID], profiles: null, instructors: null }).get(ADMIN_ID), UNKNOWN_ACTOR_LABEL);
});

test("the history and the expiry history both resolve names through the shared lookup, with no 'Admin' fallback", () => {
  const data = read("./data.js");
  assert.match(data, /import \{ actorLabelOf, actorLabels \} from "@\/lib\/class-count-attendance\/actors";/);
  assert.match(data, /supabase\.from\("instructors"\)\.select\("user_id, full_name"\)\.in\("user_id", ids\)/);
  assert.match(data, /supabase\.from\("profiles"\)\.select\("id, role, full_name"\)\.in\("id", ids\)/);
  assert.equal((data.match(/await loadActorLabels\(supabase,/g) ?? []).length, 2, "listClassCountHistory and listClassCountExpiryEdits");
  assert.match(data, /const nameOf = \(id\) => actorLabelOf\(names, id\);/);
  assert.doesNotMatch(data, /\?\? "Admin"/, "an unidentified person is never shown as Admin");
  assert.doesNotMatch(data, /service[_-]?role|SERVICE_ROLE|createAdminClient/i);
});

test("the stored recorder is always the caller's own ID, for an Admin and for an Instructor", () => {
  // 0045 (Admin) and 0053 (Admin or Instructor): the record is inserted with recorded_by = auth.uid() - never a passed-in ID.
  for (const path of ["../../supabase/migrations/0045_class_count_dates_and_reversals.sql", "../../supabase/migrations/0053_instructor_class_count_recording.sql"]) {
    const sql = read(path);
    assert.match(sql, /values \(p_membership_id, v_mem\.student_id, p_attended_on, p_request_id, auth\.uid\(\)\)/, path);
  }
  const sql = read("../../supabase/migrations/0053_instructor_class_count_recording.sql");
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /recorded_by\s*:?=/);
});

test("Membership Details shows the label as given and stays Admin only", () => {
  const panel = read("../../app/memberships/[id]/class-attendance-panel.js");
  assert.match(panel, /record\.recordedBy \? `by \$\{record\.recordedBy\}` : "by —"/);
  const reverse = read("../../app/memberships/[id]/reverse-class-dialog.js");
  assert.match(reverse, /record\.recordedBy \?\? "—"/);
  // The recorder's name is read only through the Admin-only data layer and page.
  assert.match(read("../../app/memberships/[id]/page.js"), /requireRole\(ROLES\.ADMIN\)/);
  assert.doesNotMatch(read("./data.js").slice(read("./data.js").indexOf("export async function listClassCountAttendanceRangeScoped")), /recorded_by|recordedBy/);
});
