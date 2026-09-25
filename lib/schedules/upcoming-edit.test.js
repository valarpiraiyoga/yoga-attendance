// Run with `npm test` (Node's built-in test runner).
//
// Schedule Details -> Upcoming Sessions offers "Edit Session" per row. It is a
// link to the EXISTING Edit This Session page/action (one session, instructor
// and/or time, Upcoming only) - not a second editing implementation - and it is
// offered only for sessions that are still Upcoming in the centre's time zone.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deriveDisplayStatus } from "../class-sessions/validation.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const projected = (date, start = "18:00:00", end = "19:00:00") => ({ status: "scheduled", session_date: date, start_time: start, end_time: end });
const editableNow = (session, now, timeZone) => deriveDisplayStatus(session, now, timeZone) === "upcoming";

test("a future session is editable; today's session is only editable before it starts", () => {
  const now = new Date("2026-09-24T05:00:00Z"); // 10:30 in Kolkata
  assert.equal(editableNow(projected("2026-10-01"), now, "Asia/Kolkata"), true);
  assert.equal(editableNow(projected("2026-09-24", "17:00:00", "18:00:00"), now, "Asia/Kolkata"), true);
  assert.equal(editableNow(projected("2026-09-24", "10:00:00", "11:00:00"), now, "Asia/Kolkata"), false, "ongoing");
  assert.equal(editableNow(projected("2026-09-24", "06:00:00", "07:00:00"), now, "Asia/Kolkata"), false, "already over");
});

test("whether a session is still upcoming follows the centre's time zone", () => {
  // The same instant is 10:30 in Kolkata but 01:00 in New York, so a 07:00 class on the 24th
  // is already over for one centre and still to come for the other.
  const now = new Date("2026-09-24T05:00:00Z");
  const morning = projected("2026-09-24", "07:00:00", "08:00:00");
  assert.equal(editableNow(morning, now, "Asia/Kolkata"), false);
  assert.equal(editableNow(morning, now, "America/New_York"), true);
});

test("the row action opens the existing Edit This Session route for that one date", () => {
  const tabs = source("../../app/schedule/[id]/upcoming-sessions-panel.js");
  assert.match(tabs, /href=\{`\/attendance\/\$\{scheduleId\}\/\$\{session\.date\}\/edit`\}/);
  assert.match(tabs, /aria-label=\{`Edit session on \$\{label\}`\}/);
  assert.match(tabs, /title="Edit Session"/);
  // Only Upcoming rows get it.
  assert.match(tabs, /if \(!session\.editable\) return null;/);
  // The page-level action is a different one and is untouched.
  assert.match(source("../../app/schedule/[id]/schedule-header.js"), /Edit Schedule/);
});

test("the page marks a row editable with the centre timezone, and no new write path exists", () => {
  const page = source("../../app/schedule/[id]/page.js");
  assert.match(page, /deriveDisplayStatus\(/);
  assert.match(page, /getCenterTimezone\(\)/);
  assert.match(page, /=== "upcoming"/);

  // The edit page and action already exist and still enforce Upcoming-only.
  assert.ok(existsSync(new URL("../../app/attendance/[scheduleId]/[date]/edit/page.js", import.meta.url)));
  const actions = source("../class-sessions/actions.js");
  assert.match(actions, /export async function updateClassSession\(scheduleId, date, _prevState, formData\)/);
  assert.match(actions, /Only upcoming sessions can be edited\./);
});
