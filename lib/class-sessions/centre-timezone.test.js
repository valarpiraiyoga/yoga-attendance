// Run with `npm test` (Node's built-in test runner).
//
// The centre timezone is a Center Setting, and the business date / session
// status / membership validity follow it - not the server's clock, not the
// viewer's browser. Asia/Kolkata stays the default, so a centre that has not
// chosen a zone behaves exactly as before.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CENTRE_TIMEZONE,
  centreDateOf,
  deriveDisplayStatus,
  hourInCentreTimezone,
  nowInCentreTimezone,
  todayInCentreTimezone,
} from "./validation.js";
import { batchToday } from "../batches/summary.js";
import { deriveMembershipStatusOn, membershipToday } from "../memberships/validity.js";

const NY = "America/New_York";
const LONDON = "Europe/London";
const KOLKATA = "Asia/Kolkata";

// ---- default ---------------------------------------------------------------

test("the default centre timezone is Asia/Kolkata", () => {
  assert.equal(DEFAULT_CENTRE_TIMEZONE, "Asia/Kolkata");
});

test("with no zone given, every helper behaves exactly as it always did (Kolkata)", () => {
  const now = new Date("2026-09-23T20:00:00Z"); // 01:30 on 24 Sep in Kolkata
  assert.equal(todayInCentreTimezone(now), "2026-09-24");
  assert.equal(todayInCentreTimezone(now), todayInCentreTimezone(now, KOLKATA));
  assert.equal(batchToday(now), "2026-09-24");
  assert.equal(membershipToday(now), "2026-09-24");
  assert.equal(hourInCentreTimezone(now), 1);
});

// ---- configured zone drives the date ----------------------------------------

test("the same instant is a different centre date in a different zone", () => {
  // 02:00 UTC on 24 Sep: already the 24th in Kolkata, still the 23rd in New York.
  const now = new Date("2026-09-24T02:00:00Z");
  assert.equal(todayInCentreTimezone(now, KOLKATA), "2026-09-24");
  assert.equal(todayInCentreTimezone(now, NY), "2026-09-23");
  assert.equal(todayInCentreTimezone(now, LONDON), "2026-09-24");
});

test("the batch and membership 'today' follow the configured zone too", () => {
  const now = new Date("2026-09-24T02:00:00Z");
  assert.equal(batchToday(now, NY), "2026-09-23");
  assert.equal(membershipToday(now, NY), "2026-09-23");
  assert.equal(membershipToday(now, KOLKATA), "2026-09-24");
});

test("the centre's hour (the Dashboard greeting) follows the configured zone", () => {
  const now = new Date("2026-09-24T02:00:00Z");
  assert.equal(hourInCentreTimezone(now, KOLKATA), 7);
  assert.equal(hourInCentreTimezone(now, NY), 22);
  assert.equal(hourInCentreTimezone(now, LONDON), 3);
});

test("an instant's centre date is read in the centre zone (a cancellation, a creation)", () => {
  // 20:00 UTC on the 23rd is the 24th at 01:30 in Kolkata, but still the 23rd in New York.
  assert.equal(centreDateOf("2026-09-23T20:00:00Z", KOLKATA), "2026-09-24");
  assert.equal(centreDateOf("2026-09-23T20:00:00Z", NY), "2026-09-23");
  assert.equal(centreDateOf(new Date("2026-09-23T20:00:00Z")), "2026-09-24");
});

// ---- daylight saving comes from the IANA rules -------------------------------

test("New York's offset changes with daylight saving without any offset arithmetic", () => {
  // Winter (EST, UTC-5) and summer (EDT, UTC-4): the same 03:30 UTC is 22:30 / 23:30 the day before.
  assert.equal(nowInCentreTimezone(new Date("2026-01-15T03:30:00Z"), NY), "2026-01-14T22:30:00");
  assert.equal(nowInCentreTimezone(new Date("2026-07-15T03:30:00Z"), NY), "2026-07-14T23:30:00");
});

test("the day of a spring-forward changeover is handled (2026-03-08 in New York)", () => {
  assert.equal(nowInCentreTimezone(new Date("2026-03-08T06:59:00Z"), NY), "2026-03-08T01:59:00");
  assert.equal(nowInCentreTimezone(new Date("2026-03-08T07:00:00Z"), NY), "2026-03-08T03:00:00");
  assert.equal(todayInCentreTimezone(new Date("2026-03-08T04:59:00Z"), NY), "2026-03-07");
  assert.equal(todayInCentreTimezone(new Date("2026-03-08T05:00:00Z"), NY), "2026-03-08");
});

test("London is on UTC in winter and UTC+1 (BST) in summer", () => {
  assert.equal(nowInCentreTimezone(new Date("2026-01-15T12:00:00Z"), LONDON), "2026-01-15T12:00:00");
  assert.equal(nowInCentreTimezone(new Date("2026-07-15T12:00:00Z"), LONDON), "2026-07-15T13:00:00");
  // 23:30 UTC in summer is already the next day in London.
  assert.equal(todayInCentreTimezone(new Date("2026-07-15T23:30:00Z"), LONDON), "2026-07-16");
  assert.equal(todayInCentreTimezone(new Date("2026-01-15T23:30:00Z"), LONDON), "2026-01-15");
});

test("Kolkata has no daylight saving: its offset is +05:30 all year", () => {
  assert.equal(nowInCentreTimezone(new Date("2026-01-15T00:00:00Z"), KOLKATA), "2026-01-15T05:30:00");
  assert.equal(nowInCentreTimezone(new Date("2026-07-15T00:00:00Z"), KOLKATA), "2026-07-15T05:30:00");
});

// ---- session status is derived in the centre's zone ----------------------------

const SESSION = { status: "scheduled", session_date: "2026-07-01", start_time: "18:00:00", end_time: "19:00:00" };

test("a 6 PM New York class is Upcoming, Ongoing, then Completed on New York time", () => {
  // 6 PM EDT is 22:00 UTC.
  assert.equal(deriveDisplayStatus(SESSION, new Date("2026-07-01T21:30:00Z"), NY), "upcoming");
  assert.equal(deriveDisplayStatus(SESSION, new Date("2026-07-01T22:30:00Z"), NY), "in_progress");
  assert.equal(deriveDisplayStatus(SESSION, new Date("2026-07-01T23:30:00Z"), NY), "completed");
});

test("the same instant reads differently for a Kolkata centre (class time is local to the centre)", () => {
  const instant = new Date("2026-07-01T22:30:00Z"); // 04:00 on 2 Jul in Kolkata
  assert.equal(deriveDisplayStatus(SESSION, instant, NY), "in_progress");
  assert.equal(deriveDisplayStatus(SESSION, instant, KOLKATA), "completed");
});

test("cancelled, holiday and completed sessions ignore the clock and the zone", () => {
  const instant = new Date("2026-07-01T22:30:00Z");
  for (const status of ["cancelled", "holiday", "completed"]) {
    assert.equal(deriveDisplayStatus({ ...SESSION, status }, instant, NY), status);
  }
});

// ---- membership validity ------------------------------------------------------

test("membership validity is evaluated on the centre's date", () => {
  const membership = { start_date: "2026-09-01", end_date: "2026-09-23", cancelled_at: null };
  const instant = new Date("2026-09-24T02:00:00Z");
  // Already the 24th in Kolkata: expired. Still the 23rd in New York: its last day.
  assert.equal(deriveMembershipStatusOn(membership, membershipToday(instant, KOLKATA)), "expired");
  assert.equal(deriveMembershipStatusOn(membership, membershipToday(instant, NY)), "active");
});

// ---- the zone belongs to the centre, never the viewer's device -----------------

test("the browser's / server's own timezone never changes the result", () => {
  const script = `
    const v = await import(${JSON.stringify(new URL("./validation.js", import.meta.url).href)});
    const now = new Date("2026-09-24T02:00:00Z");
    console.log(JSON.stringify([
      v.todayInCentreTimezone(now, "Asia/Kolkata"),
      v.todayInCentreTimezone(now, "America/New_York"),
      v.hourInCentreTimezone(now, "Europe/London"),
      v.deriveDisplayStatus({ status: "scheduled", session_date: "2026-09-24", start_time: "07:00:00", end_time: "08:00:00" }, now, "Asia/Kolkata"),
    ]));
  `;
  const results = ["UTC", "America/Los_Angeles", "Pacific/Auckland", "Asia/Tokyo"].map((TZ) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ },
      encoding: "utf8",
    }).trim()
  );

  assert.deepEqual(JSON.parse(results[0]), ["2026-09-24", "2026-09-23", 3, "in_progress"]);
  for (const result of results) assert.equal(result, results[0], "identical in every device timezone");
});

// ---- guards: nothing falls back to a fixed zone by forgetting the argument -------------

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.jsx?$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) found.push(path);
  }
  return found;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Code only: a comment may name a helper or a zone without calling or using it.
const code = (path) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const SOURCES = ["app", "lib", "components"]
  .flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .filter((path) => !path.includes(`${join("app", "login", "pv")}`));

test("no call to a centre-date helper omits the centre timezone", () => {
  const bare = [
    /\btodayInCentreTimezone\(\s*\)/,
    /\bhourInCentreTimezone\(\s*\)/,
    /\bbatchToday\(\s*\)/,
    /\bmembershipToday\(\s*\)/,
    /\bderiveDisplayStatus\(\s*[\w.]+\s*\)/,
  ];
  const offenders = [];
  for (const path of SOURCES) {
    const text = code(path);
    for (const pattern of bare) if (pattern.test(text)) offenders.push(`${path}: ${pattern}`);
  }
  assert.deepEqual(offenders, []);
});

test("the fixed 'Asia/Kolkata' appears only as the documented default, nowhere in a rule", () => {
  const allowed = [join("lib", "class-sessions", "validation.js"), join("lib", "timezones.js")];
  const offenders = SOURCES.filter((path) => /["'`]Asia\/Kolkata["'`]/.test(code(path)))
    .map((path) => path.slice(ROOT.length))
    .filter((path) => !allowed.includes(path));
  assert.deepEqual(offenders, []);
  assert.ok(
    !SOURCES.some((path) => /\bCENTRE_TIMEZONE\b/.test(code(path).replace(/DEFAULT_CENTRE_TIMEZONE/g, ""))),
    "the old fixed-zone constant is gone"
  );
});

test("no page computes the business date from the server's UTC clock", () => {
  const offenders = SOURCES.filter((path) => /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(code(path)))
    .map((path) => path.slice(ROOT.length));
  // Student date-of-birth validation compares a birth date, not a business day, and keeps its own UTC check.
  assert.deepEqual(offenders, [join("lib", "students", "validation.js")]);
});
