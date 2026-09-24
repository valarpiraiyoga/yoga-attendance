// Run with `npm test` (Node's built-in test runner).
//
// The centre's time zone is a real IANA identifier, chosen from a searchable,
// country-grouped list. Abbreviations, offsets and country names are not zones.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMEZONE,
  isListedTimeZone,
  isValidTimeZone,
  listTimeZoneGroups,
  searchTimeZoneGroups,
  timeZoneLabel,
} from "./timezones.js";

test("the default time zone is Asia/Kolkata", () => {
  assert.equal(DEFAULT_TIMEZONE, "Asia/Kolkata");
  assert.ok(isValidTimeZone(DEFAULT_TIMEZONE));
});

test("real IANA identifiers are valid", () => {
  for (const zone of [
    "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin",
    "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "America/Argentina/Buenos_Aires", "UTC",
  ]) {
    assert.equal(isValidTimeZone(zone), true, zone);
  }
});

test("abbreviations, offsets, country names and unknown zones are rejected", () => {
  for (const bad of ["IST", "EST", "PST", "+05:30", "-08:00", "GMT+5", "India", "Mars/Base", "Asia/Nowhere", "", " ", null, undefined, 5]) {
    assert.equal(isValidTimeZone(bad), false, String(bad));
  }
});

test("every zone the selector offers is a valid IANA zone", () => {
  const zones = listTimeZoneGroups().flatMap((group) => group.zones);
  assert.ok(zones.length > 100, "a worldwide list, not an India-only one");
  for (const zone of zones) {
    assert.ok(isValidTimeZone(zone.id), zone.id);
    assert.ok(isListedTimeZone(zone.id), zone.id);
  }
  assert.equal(isListedTimeZone("Mars/Base"), false);
});

test("the list is grouped by country and covers the required examples", () => {
  const groups = listTimeZoneGroups();
  const ids = groups.flatMap((group) => group.zones.map((zone) => zone.id));
  for (const zone of [
    "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London",
    "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney",
  ]) {
    assert.ok(ids.includes(zone), zone);
  }
  const us = groups.find((group) => group.country === "United States");
  assert.deepEqual(
    ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"].filter((z) => us.zones.some((zone) => zone.id === z)),
    ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"]
  );
  assert.equal(new Set(ids).size, ids.length, "no zone is listed twice");
});

test("the label is the identifier plus a friendly name", () => {
  assert.equal(timeZoneLabel("Asia/Kolkata"), "Asia/Kolkata — India Standard Time");
  assert.equal(timeZoneLabel("America/New_York"), "America/New_York — Eastern Time");
  assert.match(timeZoneLabel("Europe/London"), /^Europe\/London — /);
});

test("search finds a zone by city, country or identifier", () => {
  const groups = listTimeZoneGroups();
  const found = (query) => searchTimeZoneGroups(groups, query).flatMap((group) => group.zones.map((zone) => zone.id));

  assert.deepEqual(found("kolkata"), ["Asia/Kolkata"]);
  // "India" also appears in other zones' names ("India Standard Time" in Sri Lanka), so
  // the country itself is what must come first.
  assert.equal(found("India")[0], "Asia/Kolkata");
  assert.ok(found("new york").includes("America/New_York"));
  assert.ok(found("America/Los").includes("America/Los_Angeles"));
  assert.ok(found("berlin").includes("Europe/Berlin"));
  assert.ok(found("eastern").includes("America/New_York"));
});

test("searching a country keeps all of its zones; a miss keeps none; blank keeps all", () => {
  const groups = listTimeZoneGroups();
  const us = searchTimeZoneGroups(groups, "united states");
  assert.equal(us.length, 1);
  assert.ok(us[0].zones.length >= 6);
  assert.deepEqual(searchTimeZoneGroups(groups, "zzzzz"), []);
  assert.equal(searchTimeZoneGroups(groups, "  ").length, groups.length);
});

test("a country heading is dropped when none of its zones match", () => {
  const result = searchTimeZoneGroups(listTimeZoneGroups(), "sydney");
  assert.deepEqual(result.map((group) => group.country), ["Australia"]);
  assert.deepEqual(result[0].zones.map((zone) => zone.id), ["Australia/Sydney"]);
});
