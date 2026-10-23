// Run with `npm test` (Node's built-in test runner).
//
// The schedule picker's places and locking (S4): a full schedule cannot be newly ticked, the places an enrollment already holds
// stay selectable, and an enrollment that is inactive or ended holds none. The rules are the product's (01-product.md §7
// "Schedule Capacity", 02-ux.md Flow 10); the database still decides on Save.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  capacityText,
  enrollmentTakesPlaces,
  enrollmentWillTakePlaces,
  everyScheduleFull,
  heldSeriesIdsOf,
  isScheduleAssignmentCurrent,
  scheduleChoice,
} from "./schedule-availability.js";
import { scheduleCapacity } from "../schedules/capacity.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

const TODAY = "2026-10-22";
const info = (capacity, occupied) => scheduleCapacity(capacity, occupied);

// ---- the places text -----------------------------------------------------------------------------------------------------

test("limited schedules read 'taken / capacity'; unlimited ones read 'Unlimited'; nothing known reads nothing", () => {
  assert.equal(capacityText(info(20, 10)), "10 / 20");
  assert.equal(capacityText(info(20, 0)), "0 / 20");
  assert.equal(capacityText(info(20, 20)), "20 / 20");
  assert.equal(capacityText(info(null, 37)), "Unlimited");
  assert.equal(capacityText(null), null);
  assert.equal(capacityText(undefined), null);
});

// ---- scheduleChoice ------------------------------------------------------------------------------------------------------

test("a schedule with room, or no limit, is offered freely - with its places text and no chip", () => {
  for (const i of [info(20, 10), info(20, 19), info(null, 99)]) {
    for (const checked of [false, true]) {
      const choice = scheduleChoice({ info: i, checked, held: false });
      assert.equal(choice.disabled, false);
      assert.equal(choice.isFull, false);
      assert.equal(choice.chip, null);
      assert.equal(choice.hint, null);
      assert.equal(choice.text, capacityText(i));
    }
  }
});

test("unknown capacity (not loaded, or the schedule is unknown) locks nothing and shows nothing", () => {
  for (const i of [null, undefined]) {
    assert.deepEqual(scheduleChoice({ info: i, checked: false, held: false }), { text: null, isFull: false, disabled: false, chip: null, hint: null });
  }
});

test("a full schedule cannot be newly ticked: it is disabled, labelled Full, and says what to do", () => {
  const choice = scheduleChoice({ info: info(20, 20), checked: false, held: false });
  assert.equal(choice.disabled, true);
  assert.equal(choice.isFull, true);
  assert.equal(choice.text, "20 / 20");
  assert.equal(choice.chip, "Full");
  assert.match(choice.hint, /Raise its capacity first, or choose another schedule\./);
  assert.match(choice.hint, /future-dated enrollments and schedule changes count/);
});

test("a full schedule whose place this enrollment holds stays selectable - ticked or unticked", () => {
  for (const checked of [true, false]) {
    const choice = scheduleChoice({ info: info(20, 20), checked, held: true });
    assert.equal(choice.disabled, false, `checked=${checked}`);
    assert.equal(choice.chip, "Full · current");
    assert.match(choice.hint, /already holds a place here, so it can be kept/);
  }
});

test("a full schedule that is ticked but not held can only be unticked - then it is locked like any other", () => {
  const ticked = scheduleChoice({ info: info(20, 20), checked: true, held: false });
  assert.equal(ticked.disabled, false, "it can be unticked");
  assert.equal(ticked.chip, "Full · untick");
  assert.match(ticked.hint, /It cannot be saved: untick it, or raise its capacity first\./);
  assert.equal(scheduleChoice({ info: info(20, 20), checked: false, held: false }).disabled, true, "and once unticked it cannot be ticked again");
});

test("boundaries: one place left is offered, the last place taken locks it; over capacity reads as full", () => {
  assert.equal(scheduleChoice({ info: info(20, 19), checked: false, held: false }).disabled, false);
  assert.equal(scheduleChoice({ info: info(20, 20), checked: false, held: false }).disabled, true);
  assert.equal(scheduleChoice({ info: info(3, 5), checked: false, held: false }).disabled, true);
  assert.equal(scheduleChoice({ info: info(1, 0), checked: false, held: false }).disabled, false);
});

// ---- the places an enrollment holds ------------------------------------------------------------------------------------------

test("an enrollment takes places while it is active with no end date or ending today or later (0060's reading)", () => {
  assert.equal(enrollmentTakesPlaces({ status: "active", effective_end_date: null }, TODAY), true);
  assert.equal(enrollmentTakesPlaces({ status: "active", effective_end_date: "2026-10-22" }, TODAY), true);
  assert.equal(enrollmentTakesPlaces({ status: "active", effective_end_date: "2026-10-21" }, TODAY), false);
  assert.equal(enrollmentTakesPlaces({ status: "inactive", effective_end_date: null }, TODAY), false);
  assert.equal(enrollmentTakesPlaces(null, TODAY), false);
  assert.equal(enrollmentTakesPlaces(undefined, TODAY), false);
});

const asg = (schedule_series_id, effective_end_date = null, effective_start_date = "2026-01-01") => ({ schedule_series_id, effective_start_date, effective_end_date });
const ACTIVE = { status: "active", effective_end_date: null };

test("editing a current enrollment: the schedules it attends are held, so a full one stays selectable", () => {
  const held = heldSeriesIdsOf(ACTIVE, [asg("mon-6am"), asg("fri-5pm")], TODAY);
  assert.deepEqual([...held].sort(), ["fri-5pm", "mon-6am"]);
});

test("reactivating an inactive enrollment holds nothing: a full schedule is treated like a newly selected one", () => {
  const held = heldSeriesIdsOf({ status: "inactive", effective_end_date: null }, [asg("mon-6am")], TODAY);
  assert.equal(held.size, 0);
  // So its full schedule is locked once unticked, and offers only 'untick' while ticked.
  assert.equal(scheduleChoice({ info: info(20, 20), checked: true, held: held.has("mon-6am") }).chip, "Full · untick");
});

test("extending an ended enrollment holds nothing either", () => {
  const held = heldSeriesIdsOf({ status: "active", effective_end_date: "2026-09-30" }, [asg("mon-6am")], TODAY);
  assert.equal(held.size, 0);
});

test("a FUTURE-DATED assignment of a current enrollment is held - its start date plays no part", () => {
  const future = asg("tue-6am", null, "2026-11-05"); // starts after today
  const held = heldSeriesIdsOf(ACTIVE, [asg("mon-6am"), future], TODAY);
  assert.deepEqual([...held].sort(), ["mon-6am", "tue-6am"]);
  // So a full schedule it already holds stays selectable, ticked or not, with the Full - current label.
  for (const checked of [true, false]) {
    const choice = scheduleChoice({ info: info(20, 20), checked, held: held.has("tue-6am") });
    assert.equal(choice.disabled, false, `checked=${checked}`);
    assert.equal(choice.chip, "Full · current");
  }
});

test("an assignment is held only while it is current: ended before today is not, ending today or later is", () => {
  const held = heldSeriesIdsOf(
    ACTIVE,
    [asg("ended", "2026-10-21"), asg("ends-today", "2026-10-22"), asg("ends-later", "2026-12-31", "2026-11-01"), asg("open")],
    TODAY,
  );
  assert.deepEqual([...held].sort(), ["ends-later", "ends-today", "open"]);
});

test("a future-dated assignment of an inactive or ended enrollment is not held either", () => {
  const future = asg("tue-6am", null, "2026-11-05");
  assert.equal(heldSeriesIdsOf({ status: "inactive", effective_end_date: null }, [future], TODAY).size, 0);
  assert.equal(heldSeriesIdsOf({ status: "active", effective_end_date: "2026-09-30" }, [future], TODAY).size, 0);
});

test("the assignment rule ignores the start date and matches 0060: current = no end date, or ending today or later", () => {
  assert.equal(isScheduleAssignmentCurrent(asg("x", null, "2027-01-01"), TODAY), true, "future-dated, open");
  assert.equal(isScheduleAssignmentCurrent(asg("x", "2026-10-22", "2026-01-01"), TODAY), true);
  assert.equal(isScheduleAssignmentCurrent(asg("x", "2026-10-21", "2026-01-01"), TODAY), false);
  assert.equal(isScheduleAssignmentCurrent(null, TODAY), false);
  assert.equal(isScheduleAssignmentCurrent(undefined, TODAY), false);
});

test("a new enrollment holds nothing; no assignments hold nothing", () => {
  assert.equal(heldSeriesIdsOf(null, [asg("mon-6am")], TODAY).size, 0);
  assert.equal(heldSeriesIdsOf(ACTIVE, [], TODAY).size, 0);
  assert.equal(heldSeriesIdsOf(ACTIVE, undefined, TODAY).size, 0);
});

// ---- an enrollment that takes no place is never locked --------------------------------------------------------------------

test("an enrollment takes places as saved only when it is active with no end date or ending today or later", () => {
  assert.equal(enrollmentWillTakePlaces({ active: true, endDate: "" }, TODAY), true);
  assert.equal(enrollmentWillTakePlaces({ active: true, endDate: null }, TODAY), true);
  assert.equal(enrollmentWillTakePlaces({ active: true, endDate: "2026-10-22" }, TODAY), true);
  assert.equal(enrollmentWillTakePlaces({ active: true, endDate: "2026-10-21" }, TODAY), false);
  assert.equal(enrollmentWillTakePlaces({ active: false, endDate: "" }, TODAY), false);
  assert.equal(enrollmentWillTakePlaces({ active: false, endDate: "2027-01-01" }, TODAY), false);
});

test("an inactive enrollment that stays inactive locks nothing: a full schedule can be ticked, marked Full, and saved", () => {
  const restricted = enrollmentWillTakePlaces({ active: false, endDate: "" }, TODAY);
  for (const checked of [true, false]) {
    const choice = scheduleChoice({ info: info(20, 20), checked, held: false, restricted });
    assert.equal(choice.disabled, false, `checked=${checked}`);
    assert.equal(choice.chip, "Full");
    assert.match(choice.hint, /inactive or ended, so it takes no place and can still be saved/);
    assert.match(choice.hint, /free place will be needed when it is reactivated or extended/);
  }
});

test("an ended enrollment that stays ended locks nothing either", () => {
  const restricted = enrollmentWillTakePlaces({ active: true, endDate: "2026-09-30" }, TODAY);
  assert.equal(restricted, false);
  assert.equal(scheduleChoice({ info: info(20, 20), checked: false, held: false, restricted }).disabled, false);
});

test("reactivating or extending DOES lock: the same full schedule is locked again as soon as the saved enrollment takes places", () => {
  // Stored inactive, switched to active; stored ended, end date cleared or moved to today or later.
  for (const saved of [{ active: true, endDate: "" }, { active: true, endDate: "2026-12-31" }, { active: true, endDate: "2026-10-22" }]) {
    const restricted = enrollmentWillTakePlaces(saved, TODAY);
    assert.equal(restricted, true);
    assert.equal(scheduleChoice({ info: info(20, 20), checked: false, held: false, restricted }).disabled, true, JSON.stringify(saved));
    assert.equal(scheduleChoice({ info: info(20, 20), checked: true, held: false, restricted }).chip, "Full · untick", JSON.stringify(saved));
  }
});

test("a new enrollment is created active: locked unless its end date is already past", () => {
  const locked = (endDate) => scheduleChoice({ info: info(20, 20), checked: false, held: false, restricted: enrollmentWillTakePlaces({ active: true, endDate }, TODAY) }).disabled;
  assert.equal(locked(""), true);
  assert.equal(locked("2026-10-01"), false);
});

test("never more lenient than the database: whenever the saved enrollment would take a place, a full schedule it does not hold is locked", () => {
  for (const active of [true, false]) {
    for (const endDate of ["", "2026-10-21", "2026-10-22", "2027-01-01"]) {
      const takesPlace = enrollmentWillTakePlaces({ active, endDate }, TODAY);
      const choice = scheduleChoice({ info: info(5, 5), checked: false, held: false, restricted: takesPlace });
      assert.equal(choice.disabled, takesPlace, `active=${active} end=${endDate}`);
    }
  }
});

test("a schedule with room is never locked, whatever the enrollment does", () => {
  for (const restricted of [true, false]) {
    for (const checked of [true, false]) {
      assert.equal(scheduleChoice({ info: info(5, 4), checked, held: false, restricted }).disabled, false);
      assert.equal(scheduleChoice({ info: info(null, 99), checked, held: false, restricted }).disabled, false);
    }
  }
});

test("when the enrollment takes no place, the 'every schedule full' notice is not shown", () => {
  const schedules = [{ series_id: "a" }, { series_id: "b" }];
  const full = { a: info(5, 5), b: info(1, 1) };
  assert.equal(everyScheduleFull(schedules, full, new Set(), true), true);
  assert.equal(everyScheduleFull(schedules, full, new Set(), false), false);
  assert.equal(everyScheduleFull(schedules, full, new Set()), true, "restricted by default");
});

// ---- every schedule full ----------------------------------------------------------------------------------------------------

test("'every schedule full' only when each option is full and none is held", () => {
  const schedules = [{ series_id: "a" }, { series_id: "b" }];
  const full = { a: info(5, 5), b: info(1, 1) };
  assert.equal(everyScheduleFull(schedules, full, new Set()), true);
  assert.equal(everyScheduleFull(schedules, { ...full, b: info(2, 1) }, new Set()), false, "one has room");
  assert.equal(everyScheduleFull(schedules, { ...full, b: info(null, 9) }, new Set()), false, "one is unlimited");
  assert.equal(everyScheduleFull(schedules, full, new Set(["a"])), false, "one is held by this enrollment");
});

test("'every schedule full' is false when nothing is known or nothing is offered", () => {
  assert.equal(everyScheduleFull([{ series_id: "a" }], null, new Set()), false);
  assert.equal(everyScheduleFull([{ series_id: "a" }], {}, new Set()), false, "capacity unknown for the schedule");
  assert.equal(everyScheduleFull([], { a: info(1, 1) }, new Set()), false);
  assert.equal(everyScheduleFull(undefined, { a: info(1, 1) }, new Set()), false);
});

// ---- the picker, the form and the pages (from source) -------------------------------------------------------------------------

test("picker: places text and a Full chip per row, disabled only for a locked unticked schedule, described for screen readers", () => {
  const picker = code("app/students/[id]/enrollments/schedule-picker.js");
  assert.match(picker, /capacities = null,\s+heldSeriesIds = new Set\(\),/);
  assert.match(picker, /info: capacities\?\.\[schedule\.series_id\] \?\? null,/);
  assert.match(picker, /held: heldSeriesIds\.has\(schedule\.series_id\),\s+restricted,/);
  assert.match(picker, /heldSeriesIds = new Set\(\),\s+restricted = true,/);
  assert.match(picker, /disabled=\{disabled \|\| choice\.disabled\}/);
  assert.match(picker, /aria-describedby=\{choice\.text \? capacityId : undefined\}/);
  assert.match(picker, /\{choice\.text\}/);
  assert.match(picker, /\{choice\.chip\}/);
  assert.match(picker, /<span className="sr-only">\{choice\.hint\}<\/span>/);
  // Design tokens only: the danger tint the Badge and the time chips already use.
  assert.match(picker, /bg-danger\/10 px-2 py-0\.5 font-medium whitespace-nowrap text-danger/);
  assert.doesNotMatch(picker, /#[0-9a-fA-F]{3,6}\b|rgb\(/);
});

test("picker: multi-schedule selection and the field name are unchanged (one checkbox per schedule, in the time x weekday grid)", () => {
  const picker = code("app/students/[id]/enrollments/schedule-picker.js");
  assert.match(picker, /name="schedule_series_ids"/);
  assert.match(picker, /onChange=\{\(\) => onToggle\(schedule\.series_id\)\}/);
  assert.match(picker, /WEEKDAYS\.map\(\(day\) =>/);
  // Nothing in the picker ticks or unticks a schedule by itself.
  assert.doesNotMatch(picker, /selectedSeriesIds\.(add|delete)|onToggle\(day/);
});

test("form: the held places come from the STORED enrollment, and the picker gets the capacities and the held set", () => {
  const form = code("app/students/[id]/enrollments/enrollment-form.js");
  assert.match(form, /scheduleCapacities = null,/);
  // The assignments themselves go in, so each one is judged by the occupancy rule (a future-dated one is held too).
  assert.match(form, /const heldSeriesIds = useMemo\(\s+\(\) => heldSeriesIdsOf\(enrollment, assignedSchedules, todayDate\),/);
  assert.match(form, /capacities=\{scheduleCapacities\}\s+heldSeriesIds=\{heldSeriesIds\}\s+restricted=\{restricted\}/);
  assert.match(form, /everyScheduleFull\(pickerOptions, scheduleCapacities, heldSeriesIds, restricted\)/);
  // Locking follows the enrollment as it would be saved: its status (a new one is created active) and the end date as typed.
  assert.match(form, /const restricted = enrollmentWillTakePlaces\(\{ active: enrollment \? isActive : true, endDate \}, todayDate\);/);
  assert.match(form, /const \[endDate, setEndDate\] = useState\(state\?\.values\?\.effective_end_date \?\? enrollment\?\.effective_end_date \?\? ""\);/);
  assert.match(form, /onChange=\{\(event\) => setEndDate\(event\.target\.value\)\}/);
  assert.match(form, /Every schedule of this batch is full\. Raise a schedule&rsquo;s capacity first/);
});

test("form: the user's entries are never reset by a refused save - the schedule error is shown with the selection kept", () => {
  const form = code("app/students/[id]/enrollments/enrollment-form.js");
  // The selection is the form's own state (kept across a failed action), and the schedule field shows the server's message.
  assert.match(form, /const \[selectedSeriesIds, setSelectedSeriesIds\] = useState\(\(\) => new Set\(originalSeriesIds\)\);/);
  assert.match(form, /fieldErrors\.schedule_series_ids \? \(\s+<p role="alert" className="text-small text-danger">\s+\{fieldErrors\.schedule_series_ids\}/);
  // Dates and batch are redisplayed from the action's returned values, as before.
  assert.match(form, /state\?\.values\?\.effective_start_date \?\? enrollment\?\.effective_start_date/);
  assert.match(form, /useState\(state\?\.values\?\.batch_id \?\? enrollment\?\.batch_id \?\? ""\)/);
});

test("pages: both read the capacities of every schedule the picker can show, through the safe loader", () => {
  const add = code("app/students/[id]/enrollments/new/page.js");
  assert.match(add, /import \{ getScheduleCapacitiesForPicker \} from "@\/lib\/schedules\/capacity-data";/);
  assert.match(add, /getScheduleCapacitiesForPicker\(currentSchedules\.map\(\(schedule\) => schedule\.series_id\)\)/);
  assert.match(add, /scheduleCapacities=\{scheduleCapacities\}/);

  const edit = code("app/students/[id]/enrollments/[enrollmentId]/edit/page.js");
  assert.match(edit, /\.\.\.currentSchedules\.map\(\(schedule\) => schedule\.series_id\),\s+\.\.\.activeAssignments\.map\(\(assignment\) => assignment\.schedule_series_id\),/);
  assert.match(edit, /scheduleCapacities=\{scheduleCapacities\}/);
  // Both keep their Admin check first.
  assert.match(edit, /await requireRole\(ROLES\.ADMIN\);/);
  assert.match(add, /await requireRole\(ROLES\.ADMIN\);/);
});

test("edit page: the assigned set is every assignment not ended before today, started or not - what the server and 0060 count", () => {
  const edit = code("app/students/[id]/enrollments/[enrollmentId]/edit/page.js");
  assert.match(edit, /allAssignments\.filter\(\(assignment\) => isScheduleAssignmentCurrent\(assignment, today\)\)/);
  assert.match(edit, /import \{ isScheduleAssignmentCurrent \} from "@\/lib\/enrollments\/schedule-availability";/);
  // The "has started" test is gone from this page (it is still what Student Details uses to label current vs historical).
  assert.doesNotMatch(edit, /isScheduleAssignmentActive/);
  // updateEnrollment reads the same set: not ended before today, whatever the start date.
  const actions = code("lib/enrollments/actions.js");
  const currentRead = actions.slice(actions.indexOf("const { data: currentAssignments"), actions.indexOf("const currentSeriesIds"));
  assert.match(currentRead, /\.or\(`effective_end_date\.is\.null,effective_end_date\.gte\.\$\{today\}`\);/);
  assert.doesNotMatch(currentRead, /effective_start_date.*(lte|lt)|\.lte\(|\.lt\(/);
});

test("the safe loader never takes a page down: a failed read gives null, a redirect or not-found is re-thrown", () => {
  const loader = code("lib/schedules/capacity-data.js");
  const fn = loader.slice(loader.indexOf("export async function getScheduleCapacitiesForPicker"));
  assert.match(fn, /return Object\.fromEntries\(await getScheduleCapacities\(seriesIds\)\);/);
  assert.match(fn, /unstable_rethrow\(error\);\s+return null;/);
  assert.match(loader, /import \{ unstable_rethrow \} from "next\/navigation";/);
});

test("S4 changes no enrollment rule, action or database object", () => {
  const actions = code("lib/enrollments/actions.js");
  assert.doesNotMatch(actions, /schedule-availability|capacit/i);
  assert.doesNotMatch(code("lib/enrollments/schedule-availability.js"), /import /);
});
