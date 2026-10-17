// Run with `npm test` (Node's built-in test runner).
//
// Edit Communication (migration 0058): the form's starting values, the database rules pinned from source (authorization,
// validation, a pending follow-up edited or removed, a completed follow-up preserved, the original recorder and recorded time
// kept, the edit stamped from auth.uid()), and the wiring (server action, timeline pencil, the shared form). Behaviour against a
// real database is in supabase/verification/verify_0058_student_communication_edits_behavior.sql (rollback only).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { editDraftOf, mapCommunicationRow, toCentreLocalDateTime, validateCommunicationInput } from "./core.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SQL = read("../../supabase/migrations/0058_student_communication_edits.sql").replace(/^\s*--.*$/gm, "");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const ROW = {
  id: "c1",
  communicated_at: "2026-10-16T04:45:00+00:00",
  communication_type: "whatsapp",
  subject: "Class timing enquiry",
  notes: "Asked about evening classes.",
  recorded_by_name: "Asha",
  recorded_by_role: "admin",
  follow_up_date: null,
  follow_up_note: null,
  follow_up_status: null,
  created_at: "2026-10-16T05:00:00+00:00",
};

// ---- the form's starting values ----------------------------------------------------------------------------------------------

test("edit draft: the stored values on the centre's clock, ready for the same form", () => {
  assert.equal(toCentreLocalDateTime("2026-10-16T04:45:00+00:00", "Asia/Kolkata"), "2026-10-16T10:15");
  assert.deepEqual(editDraftOf(ROW, "Asia/Kolkata"), {
    communicatedAt: "2026-10-16T10:15",
    type: "whatsapp",
    subject: "Class timing enquiry",
    notes: "Asked about evening classes.",
    followUp: false,
    followUpDate: "",
    followUpNote: "",
    followUpLocked: false,
  });
});

test("edit draft: a pending follow-up is editable; a completed one is locked", () => {
  const pending = editDraftOf({ ...ROW, follow_up_date: "2026-10-20", follow_up_note: "Call", follow_up_status: "pending" }, "Asia/Kolkata");
  assert.deepEqual([pending.followUp, pending.followUpDate, pending.followUpNote, pending.followUpLocked], [true, "2026-10-20", "Call", false]);
  const completed = editDraftOf({ ...ROW, follow_up_date: "2026-10-20", follow_up_note: "Call", follow_up_status: "completed" }, "Asia/Kolkata");
  assert.equal(completed.followUpLocked, true);
  assert.equal(completed.followUp, true);
});

test("edit draft: an unchanged draft passes the same validation as Add Communication", () => {
  const draft = mapCommunicationRow({ ...ROW, follow_up_date: "2026-10-20", follow_up_note: "Call", follow_up_status: "pending" }, "Asia/Kolkata").editDraft;
  const result = validateCommunicationInput(draft, "2026-10-16T15:00");
  assert.equal(result.success, true);
  assert.equal(result.data.followUpDate, "2026-10-20");
});

test("edit validation: required fields and the follow-up date rule are the same as for creation", () => {
  const draft = editDraftOf(ROW, "Asia/Kolkata");
  assert.equal(validateCommunicationInput({ ...draft, subject: " " }, "2026-10-16T15:00").fieldErrors.subject, "Enter a subject.");
  assert.equal(validateCommunicationInput({ ...draft, type: "" }, "2026-10-16T15:00").fieldErrors.type, "Choose the communication type.");
  const early = validateCommunicationInput({ ...draft, followUp: true, followUpDate: "2026-10-15", followUpNote: "x" }, "2026-10-16T15:00");
  assert.equal(early.fieldErrors.followUpDate, "The follow-up date cannot be before the communication date.");
});

// ---- migration 0058 --------------------------------------------------------------------------------------------------------------

const fnStart = SQL.indexOf("create or replace function public.update_student_communication(");
const FN = SQL.slice(fnStart, SQL.indexOf("$$;", fnStart));

test("0058 adds only the edit stamp and one function; it changes no existing function, policy or grant", () => {
  assert.match(SQL, /add column if not exists edited_at\s+timestamptz/);
  assert.match(SQL, /add column if not exists edited_by\s+uuid references auth\.users \(id\) on delete set null/);
  assert.match(SQL, /add column if not exists edited_by_name text/);
  assert.match(SQL, /add constraint student_communications_edit_stamp check/);
  const created = [...SQL.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(created, ["update_student_communication"]);
  assert.doesNotMatch(SQL, /create policy|drop policy|grant [^;]*on public\.student_communications|drop function/i);
  assert.ok(SQL.includes("revoke execute on function public.update_student_communication(uuid, timestamp, text, text, text, boolean, date, text) from public, anon;"));
  assert.ok(SQL.includes("grant execute on function public.update_student_communication(uuid, timestamp, text, text, text, boolean, date, text) to authenticated;"));
  assert.match(FN, /security definer\s+set search_path = ''/);
});

test("0058 authorization: a non-staff caller is refused before the row lock; unknown and out-of-scope rows get the same 42501", () => {
  assert.match(FN, /into v_user, v_name from public\.student_communication_actor\(\) a;\s+if v_user is null then\s+raise exception 'You are not allowed to edit this communication\.' using errcode = '42501';/);
  assert.ok(FN.indexOf("if v_user is null then") < FN.indexOf("for update;"));
  assert.match(FN, /if not found or not public\.class_count_student_visible\(v_row\.student_id\) then\s+raise exception 'You are not allowed to edit this communication\.' using errcode = '42501';/);
  // Authorization before any validation.
  assert.ok(FN.indexOf("'42501'") < FN.indexOf("'22023'"));
});

test("0058 validation: the same rules and messages as record_student_communication", () => {
  for (const message of [
    "Enter the date and time of the communication.",
    "The communication date and time cannot be in the future.",
    "Choose the communication type.",
    "Enter a subject.",
    "The subject can be at most 150 characters.",
    "Enter the communication notes.",
    "The notes can be at most 4000 characters.",
    "Enter the follow-up date.",
    "Enter the follow-up note.",
    "The follow-up note can be at most 1000 characters.",
    "The follow-up date cannot be before the communication date.",
  ]) {
    assert.ok(FN.includes(`'${message}'`), message);
  }
  assert.match(FN, /v_at := p_communicated_at at time zone v_tz;/);
});

test("0058 follow-up: a completed one cannot be removed or changed (55000) and keeps its status", () => {
  const completed = FN.slice(FN.indexOf("if v_row.follow_up_status = 'completed' then"), FN.indexOf("elsif coalesce(p_follow_up, false) then"));
  assert.match(completed, /A completed follow-up cannot be removed: it records what was done\.' using errcode = '55000'/);
  assert.match(completed, /p_follow_up_date is distinct from v_row\.follow_up_date or v_note is distinct from v_row\.follow_up_note/);
  assert.match(completed, /A completed follow-up cannot be changed: it records what was done\.' using errcode = '55000'/);
  assert.match(completed, /v_status := 'completed';/);
});

test("0058 follow-up: a pending one can be changed (stays Pending) or removed; one can be added", () => {
  const branch = FN.slice(FN.indexOf("elsif coalesce(p_follow_up, false) then"), FN.indexOf("if v_date is not null and v_date <"));
  assert.match(branch, /v_status := 'pending';/);
  assert.match(branch, /else\s+v_date := null;\s+v_note := null;\s+v_status := null;/);
});

test("0058 never changes the id, student, recorder, recorded time or completion details; the edit is stamped from auth.uid()", () => {
  const update = FN.slice(FN.indexOf("update public.student_communications"));
  const setList = update.slice(update.indexOf("set"), update.indexOf("where"));
  for (const column of ["id", "student_id", "recorded_by", "recorded_by_name", "recorded_by_role", "created_at", "follow_up_completed_at", "follow_up_completed_by", "follow_up_completed_by_name"]) {
    assert.doesNotMatch(setList, new RegExp(`\\b${column}\\s*=`), column);
  }
  assert.match(setList, /edited_at\s+= now\(\)/);
  assert.match(setList, /edited_by\s+= v_user/);
  assert.match(setList, /edited_by_name\s+= v_name/);
  const params = FN.slice(0, FN.indexOf("returns void"));
  assert.doesNotMatch(params, /edited|recorded|staff|user/i);
});

test("0058: a row lock serialises an edit with a concurrent completion; an unchanged edit writes nothing", () => {
  assert.match(FN, /where c\.id = p_communication_id for update;/);
  assert.match(FN, /and v_row\.follow_up_status is not distinct from v_status then\s+return;/);
});

// ---- the application -----------------------------------------------------------------------------------------------------------

test("action: staff only, validated first, the database function only, and no staff ID sent", () => {
  const actions = code("./actions.js");
  const edit = actions.slice(actions.indexOf("export async function updateStudentCommunication"), actions.indexOf("export async function completeStudentFollowUp"));
  assert.match(edit, /await requireRole\(ROLES\.ADMIN, ROLES\.INSTRUCTOR\);/);
  assert.ok(edit.indexOf("validateCommunicationInput(") < edit.indexOf('.rpc("update_student_communication"'));
  assert.match(edit, /p_follow_up: data\.followUpDate !== null,/);
  assert.doesNotMatch(edit, /edited_by|recorded_by|p_user|p_staff|\.from\("student_communications"\)/);
});

test("UI: a pencil on every timeline entry opens the same form, titled Edit Communication with Save Changes", () => {
  const history = code("../../app/students/[id]/communications/communication-history.js");
  assert.match(history, /<EditCommunication\s+studentId=\{studentId\}[\s\S]*?draft=\{item\.editDraft\}/);
  const form = code("../../app/students/[id]/communications/add-communication.js");
  assert.match(form, /title: "Edit Communication",/);
  assert.match(form, /confirmLabel: "Save Changes",/);
  assert.match(form, /<Pencil className="size-4" aria-hidden="true" \/>/);
  assert.match(form, /updateStudentCommunication\(studentId, communicationId, draft\)/);
  // A completed follow-up is shown but locked, with the reason.
  assert.match(form, /disabled=\{isPending \|\| locked\}/);
  assert.match(form, /This follow-up is completed\. Its date and note record what was done, so they cannot be changed or removed\./);
});

test("accordion: each entry's chevron sits beside its Edit pencil and opens / closes the notes and follow-up", () => {
  const accordion = code("../../app/students/[id]/communications/communication-accordion.js");
  assert.match(accordion, /^"use client";/);
  assert.match(accordion, /useState\(true\)/, "entries start open: nothing is hidden until collapsed");
  assert.match(accordion, /\{actions\}\s*<Button[\s\S]*?aria-expanded=\{open\}[\s\S]*?aria-controls=\{detailsId\}/, "the chevron follows the actions (Edit)");
  assert.match(accordion, /aria-label=\{`\$\{open \? "Collapse" : "Expand"\} communication: \$\{subject\}`\}/);
  assert.match(accordion, /<div id=\{detailsId\} hidden=\{!open\}>/, "details stay in the page when closed");
  const history = code("../../app/students/[id]/communications/communication-history.js");
  assert.match(history, /<CommunicationAccordion/);
  // Edit is the accordion's action; the notes and the follow-up (with Mark as Completed) are its details.
  assert.match(history, /actions=\{\s*<EditCommunication/);
  const details = history.slice(history.indexOf("</CommunicationAccordion>") > 0 ? history.indexOf('collapsedHint=') : 0);
  assert.match(details, /\{item\.notes\}/);
  assert.match(details, /<CompleteFollowUp/);
  // A collapsed pending follow-up stays visible as a status line.
  assert.match(history, /collapsedHint=\{\s*followUp \? \(/);
});
