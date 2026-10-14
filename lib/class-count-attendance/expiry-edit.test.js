// Run with `npm test` (Node's built-in test runner).
//
// FS-7 step 2: editing a class-count membership's expiry from Membership Details. The rules are tested directly; the screens and the
// server action need a server, so their wiring is pinned as source. The database function (migration 0049) is the authority and is
// not run here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EDIT_EXPIRY_FAILED_MESSAGE,
  EXPIRY_FLAG_LABEL,
  attendedAfterExpiry,
  expiryEditErrorMessage,
  expiryEditRowFrom,
  isValidDateString,
  validateExpiryEdit,
} from "./expiry-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const BASE = { startDate: "2026-09-01", currentExpiry: "2026-10-31", reason: "Student travelling" };

test("a new expiry date, or No expiry, with a trimmed 3 to 500 character reason", () => {
  const date = validateExpiryEdit({ ...BASE, mode: "date", date: "2026-12-31", reason: "  Extended for a holiday  " });
  assert.deepEqual(date, { success: true, data: { newExpiry: "2026-12-31", reason: "Extended for a holiday" } });
  assert.deepEqual(validateExpiryEdit({ ...BASE, mode: "none" }), { success: true, data: { newExpiry: null, reason: "Student travelling" } });

  for (const reason of ["", "  ", "ab", " a b ".trim().slice(0, 2), "x".repeat(501)]) {
    assert.ok(validateExpiryEdit({ ...BASE, mode: "none", reason }).errors.reason, JSON.stringify(reason.slice(0, 5)));
  }
  assert.equal(validateExpiryEdit({ ...BASE, mode: "none", reason: "abc" }).success, true);
  assert.equal(validateExpiryEdit({ ...BASE, mode: "none", reason: "x".repeat(500) }).success, true);
});

test("the expiry must be a real date on or after the start date, and something must change", () => {
  assert.equal(validateExpiryEdit({ ...BASE, mode: "date", date: "" }).errors.expiry, "Enter the new expiry date.");
  assert.equal(validateExpiryEdit({ ...BASE, mode: "date", date: "2026-02-30" }).errors.expiry, "Enter the new expiry date.");
  assert.equal(validateExpiryEdit({ ...BASE, mode: "date", date: "2026-08-31" }).errors.expiry, "The expiry date cannot be before the start date.");
  assert.equal(validateExpiryEdit({ ...BASE, mode: "date", date: "2026-09-01" }).success, true, "a same-day expiry is allowed");
  assert.equal(validateExpiryEdit({ ...BASE, mode: "date", date: "2026-10-31" }).errors.expiry, "The expiry is unchanged.");
  assert.equal(validateExpiryEdit({ ...BASE, currentExpiry: null, mode: "none" }).errors.expiry, "The expiry is unchanged.");
  assert.equal(validateExpiryEdit({ ...BASE, currentExpiry: null, mode: "date", date: "2026-12-01" }).success, true, "No expiry to a date");
  assert.equal(validateExpiryEdit({ ...BASE, mode: "weekly" }).errors.expiry, "Choose an expiry date or No expiry.");
  assert.equal(isValidDateString("2026-12-31"), true);
  assert.equal(isValidDateString("31/12/2026"), false);
});

test("the database's own refusals are shown; anything else is the generic message", () => {
  assert.equal(expiryEditErrorMessage({ code: "42501", message: "Not authorized." }), "You do not have permission to change an expiry.");
  assert.equal(expiryEditErrorMessage({ code: "22023", message: "The expiry is unchanged." }), "The expiry is unchanged.");
  assert.equal(expiryEditErrorMessage({ code: "55000", message: "Only a class-count membership has an expiry to edit." }), "Only a class-count membership has an expiry to edit.");
  assert.equal(expiryEditErrorMessage({ code: "XX000", message: "boom" }), EDIT_EXPIRY_FAILED_MESSAGE);
  assert.equal(expiryEditErrorMessage(null), EDIT_EXPIRY_FAILED_MESSAGE);
});

test("Attendance after current expiry: a record not reversed, dated after the current expiry; nothing is flagged without an expiry", () => {
  assert.equal(EXPIRY_FLAG_LABEL, "Attendance after current expiry");
  const record = (attendedOn, reversal = null) => ({ attendedOn, reversal });
  assert.equal(attendedAfterExpiry(record("2026-11-02"), "2026-10-31"), true);
  assert.equal(attendedAfterExpiry(record("2026-10-31"), "2026-10-31"), false, "on the expiry day is not after it");
  assert.equal(attendedAfterExpiry(record("2026-10-01"), "2026-10-31"), false);
  assert.equal(attendedAfterExpiry(record("2026-11-02", { reason: "mistake" }), "2026-10-31"), false, "a reversed record is not flagged");
  assert.equal(attendedAfterExpiry(record("2099-01-01"), null), false, "No expiry: nothing is after it");
  // The flag is a pure reading: it never changes the record.
  const kept = record("2026-11-02");
  attendedAfterExpiry(kept, "2026-10-31");
  assert.deepEqual(kept, { attendedOn: "2026-11-02", reversal: null });
});

test("a history row shows the previous and new expiry (null = No expiry), the reason, the editor and the time", () => {
  const row = { id: "e1", previous_expiry: null, new_expiry: "2026-12-31", reason: "Agreed", edited_by: "u1", edited_at: "2026-10-13T10:00:00Z" };
  assert.deepEqual(expiryEditRowFrom(row, (id) => (id === "u1" ? "Asha" : null)), {
    id: "e1", previousExpiry: null, newExpiry: "2026-12-31", reason: "Agreed", editedAt: "2026-10-13T10:00:00Z", editedBy: "Asha",
  });
  assert.equal(expiryEditRowFrom({ ...row, edited_by: null }, () => null).editedBy, null);
});

test("the server action calls the database function only: Admin first, trimmed reason, no direct update of a membership", () => {
  const actions = code("./actions.js");
  const body = actions.slice(actions.indexOf("export async function editClassCountExpiry("));
  assert.match(body, /export async function editClassCountExpiry\(membershipId, newExpiry, reason\) \{\s*await requireRole\(ROLES\.ADMIN\);/);
  assert.match(body, /supabase\.rpc\("edit_class_count_expiry", \{\s*p_membership_id: membershipId,\s*p_new_expiry: newExpiry,\s*p_reason: trimReason\(reason\),\s*\}\)/);
  assert.match(body, /reasonError\(reason\)/);
  assert.match(body, /newExpiry !== null && !isValidDateString\(newExpiry\)/);
  assert.doesNotMatch(body, /\.from\("memberships"\)|\.update\(|end_date/, "the membership is never updated here");
  assert.match(body, /revalidatePath\(`\/memberships\/\$\{membershipId\}`\)/);
});

test("Membership Details: the Expiry panel and Edit expiry for every class-count membership, the history, and the flag", () => {
  const page = code("../../app/memberships/[id]/page.js");
  // Whatever its origin: the condition is the kind, never a package.
  assert.match(page, /\{membership\.kind === "class_count" \? \(\s*<ExpiryPanel/);
  assert.doesNotMatch(page.slice(page.indexOf("<ExpiryPanel") - 120, page.indexOf("<ExpiryPanel")), /package_id/);
  assert.match(page, /listClassCountExpiryEdits\(id\)/);
  assert.match(page, /endDate=\{membership\.end_date\}/, "the attendance panel flags against the current expiry");

  const panel = code("../../app/memberships/[id]/expiry-panel.js");
  assert.match(panel, /<EditExpiryDialog/);
  for (const part of ["edit.previousExpiry", "edit.newExpiry", "edit.reason", "edit.editedBy", "edit.editedAt"]) assert.ok(panel.includes(part), part);

  const attendance = code("../../app/memberships/[id]/class-attendance-panel.js");
  assert.match(attendance, /attendedAfterExpiry\(record, endDate\) \? <Badge variant="info">\{EXPIRY_FLAG_LABEL\}<\/Badge> : null/);
  // The records are only displayed: nothing is reversed or deleted by the flag.
  assert.doesNotMatch(attendance, /reverseClassCount|\.delete\(|\.update\(/);

  const data = code("./data.js");
  const read = data.slice(data.indexOf("export async function listClassCountExpiryEdits("));
  assert.match(read, /\.from\("class_count_expiry_edits"\)/);
  assert.doesNotMatch(read, /\.insert\(|\.update\(|\.delete\(/);
});

test("the Edit expiry dialog: a date or No expiry, a required reason, the action only, never the membership", () => {
  const dialog = code("../../app/memberships/[id]/edit-expiry-dialog.js");
  assert.match(dialog, /<ConfirmDialog/);
  assert.match(dialog, /validateExpiryEdit\(\{ mode, date, reason, currentExpiry, startDate \}\)/);
  assert.match(dialog, /editClassCountExpiry\(membershipId, result\.data\.newExpiry, result\.data\.reason\)/);
  assert.match(dialog, /if \(isPending\) return;/);
  assert.match(dialog, /Expires on a date/);
  assert.match(dialog, /No expiry/);
  assert.match(dialog, /context=\{<StudentContext student=\{student\} membership=\{membership\} \/>\}/);
  assert.doesNotMatch(dialog, /supabase|\.from\(|end_date/, "no direct write of a membership from the screen");
  assert.doesNotMatch(dialog, /size="lg"/);
});

test("the ordinary Edit form no longer edits the expiry of a class-count membership; duration, create and legacy flows are unchanged", () => {
  const form = code("../../app/memberships/membership-form.js");
  const legacy = form.slice(form.indexOf("function LegacyMembershipForm("), form.indexOf("export default function MembershipForm("));
  // Editing an existing class-count membership shows its expiry and points to Edit expiry; no end_date field is submitted.
  assert.match(legacy, /\{isClassCount && membership \? \(/);
  assert.match(legacy, /To change the expiry, use Edit expiry on the membership page\./);
  // The End Date input itself is still there for every other case: a new class-count membership (optional) and a duration membership.
  assert.match(legacy, /<Label htmlFor="end_date">\{isClassCount \? "End Date \(optional\)" : "End Date"\}<\/Label>/);
  assert.match(legacy, /name="end_date"/);
  assert.match(legacy, /Calculated from Plan and Start Date — editable\./);

  // The ordinary update action never writes a class-count membership's end_date; a duration membership's update is as it was.
  const actions = code("../memberships/actions.js");
  const update = actions.slice(actions.indexOf("export async function updateMembership("), actions.indexOf("export async function updatePackageMembershipNotes("));
  assert.match(update, /if \(isClassCount\) \{\s*result\.data = \{ start_date, total_classes, amount, notes \};\s*\}/);
  assert.match(update, /hasOverlappingMembership\(\s*supabase,\s*existing\.student_id,\s*result\.data\.start_date,\s*result\.data\.end_date,\s*id\s*\)/);
  assert.match(update, /\.update\(result\.data\)\.eq\("id", id\)/);
  // Renewal and creation still choose an expiry for a NEW class-count membership.
  assert.match(code("../../app/memberships/[id]/renew/page.js"), /end_date: ""/);
});
