// Run with `npm test` (Node's built-in test runner).
//
// Center Settings: the time zone and currency are validated on save, stored,
// and read back through ONE loader that every screen uses. The migration is
// non-destructive and the database reads the same zone the app does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCenterProfileInput } from "./validation.js";
import {
  DEFAULT_CENTER_SETTINGS,
  loadCenterSettings,
  resolveCenterSettings,
} from "./settings-core.js";

const BASE = { name: "Sri Yoga", address: "", phone: "", email: "" };
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- validation: time zone ----------------------------------------------------

test("a valid IANA time zone is accepted and saved as itself", () => {
  for (const timezone of ["Asia/Kolkata", "America/New_York", "Europe/London"]) {
    const result = validateCenterProfileInput({ ...BASE, timezone, currency: "INR" });
    assert.equal(result.success, true, timezone);
    assert.equal(result.data.timezone, timezone);
  }
});

test("an invalid time zone is rejected on the time zone field", () => {
  for (const timezone of ["IST", "+05:30", "India", "Mars/Base", "Asia/Nowhere"]) {
    const result = validateCenterProfileInput({ ...BASE, timezone, currency: "INR" });
    assert.equal(result.success, false, timezone);
    assert.equal(result.errors.timezone, "Choose a time zone from the list.");
  }
});

test("a time zone is required", () => {
  for (const timezone of ["", "  ", undefined, null]) {
    const result = validateCenterProfileInput({ ...BASE, timezone, currency: "INR" });
    assert.equal(result.success, false);
    assert.equal(result.errors.timezone, "Choose the center's time zone.");
  }
});

// ---- validation: currency -----------------------------------------------------

test("a valid ISO 4217 currency is accepted and saved as its code", () => {
  for (const currency of ["INR", "USD", "EUR", "GBP", "AED", "SGD"]) {
    const result = validateCenterProfileInput({ ...BASE, timezone: "Asia/Kolkata", currency });
    assert.equal(result.success, true, currency);
    assert.equal(result.data.currency, currency);
  }
});

test("a symbol, a lower-case code or an unknown code is rejected", () => {
  for (const currency of ["₹", "$", "inr", "Rupee", "ZZZ"]) {
    const result = validateCenterProfileInput({ ...BASE, timezone: "Asia/Kolkata", currency });
    assert.equal(result.success, false, currency);
    assert.equal(result.errors.currency, "Choose a currency from the list.");
  }
});

test("a currency is required", () => {
  const result = validateCenterProfileInput({ ...BASE, timezone: "Asia/Kolkata", currency: "" });
  assert.equal(result.errors.currency, "Choose the center's currency.");
});

test("both regional errors are reported together with the other fields", () => {
  const result = validateCenterProfileInput({ name: "", timezone: "IST", currency: "$" });
  assert.equal(result.success, false);
  assert.ok(result.errors.name && result.errors.timezone && result.errors.currency);
});

test("the existing centre fields are still normalised as before", () => {
  const { data } = validateCenterProfileInput({
    name: "  Sri Yoga ", address: " 12 Lake Rd ", phone: "9876543210", email: " Hello@Sri.Yoga ",
    timezone: "Asia/Kolkata", currency: "INR",
  });
  assert.deepEqual(data, {
    name: "Sri Yoga", address: "12 Lake Rd", phone: "9876543210", email: "hello@sri.yoga",
    timezone: "Asia/Kolkata", currency: "INR",
  });
});

// ---- settings: defaults and resolution ---------------------------------------------

test("the defaults are Asia/Kolkata and INR, with no logo", () => {
  assert.equal(DEFAULT_CENTER_SETTINGS.timezone, "Asia/Kolkata");
  assert.equal(DEFAULT_CENTER_SETTINGS.currency, "INR");
  assert.equal(DEFAULT_CENTER_SETTINGS.logoUrl, null);
});

test("a saved row resolves to its own time zone, currency and logo", () => {
  const settings = resolveCenterSettings({
    name: "Zen NYC", logo_url: "https://x/logo.png", timezone: "America/New_York", currency: "USD",
  });
  assert.deepEqual(settings, {
    name: "Zen NYC", logoUrl: "https://x/logo.png", timezone: "America/New_York", currency: "USD",
  });
});

test("a missing row, or a stored value that is no longer valid, falls back to the default", () => {
  assert.deepEqual(resolveCenterSettings(null), { ...DEFAULT_CENTER_SETTINGS });
  assert.deepEqual(resolveCenterSettings(undefined), { ...DEFAULT_CENTER_SETTINGS });
  const settings = resolveCenterSettings({ name: " ", timezone: "Mars/Base", currency: "ZZZ", logo_url: "" });
  assert.equal(settings.timezone, "Asia/Kolkata");
  assert.equal(settings.currency, "INR");
  assert.equal(settings.logoUrl, null);
  assert.equal(settings.name, "Yoga Center");
});

// ---- the loader (one source of truth) ------------------------------------------------

// A stand-in for the database: `save` is the Center Profile update, `rpc` is the
// `center_settings()` function every screen reads through.
function fakeCenter(initial) {
  const state = { ...initial };
  const calls = [];
  return {
    calls,
    save(values) {
      Object.assign(state, values);
    },
    rpc: async (name) => {
      calls.push(name);
      return { data: [{ ...state }], error: null };
    },
  };
}

test("the loader returns the saved time zone, currency and logo", async () => {
  const center = fakeCenter({ name: "Zen NYC", logo_url: "https://x/l.png", timezone: "America/New_York", currency: "USD" });
  const settings = await loadCenterSettings(center);
  assert.equal(settings.timezone, "America/New_York");
  assert.equal(settings.currency, "USD");
  assert.equal(settings.logoUrl, "https://x/l.png");
  assert.deepEqual(center.calls, ["center_settings"], "read through the one settings function");
});

test("saving then reloading returns what was saved (persistence round trip)", async () => {
  const center = fakeCenter({ name: "Sri Yoga", logo_url: null, timezone: "Asia/Kolkata", currency: "INR" });
  assert.equal((await loadCenterSettings(center)).timezone, "Asia/Kolkata");

  const saved = validateCenterProfileInput({ ...BASE, timezone: "Europe/London", currency: "GBP" });
  assert.equal(saved.success, true);
  center.save({ ...saved.data, logo_url: "https://x/logo.webp" });

  const reloaded = await loadCenterSettings(center);
  assert.equal(reloaded.timezone, "Europe/London");
  assert.equal(reloaded.currency, "GBP");
  assert.equal(reloaded.logoUrl, "https://x/logo.webp");
});

test("removing the logo persists as no logo", async () => {
  const center = fakeCenter({ name: "Sri Yoga", logo_url: "https://x/l.png", timezone: "Asia/Kolkata", currency: "INR" });
  center.save({ logo_url: null });
  assert.equal((await loadCenterSettings(center)).logoUrl, null);
});

test("a single row (not an array) from the function is read too", async () => {
  const settings = await loadCenterSettings({
    rpc: async () => ({ data: { name: "A", logo_url: null, timezone: "Asia/Dubai", currency: "AED" }, error: null }),
  });
  assert.equal(settings.timezone, "Asia/Dubai");
});

test("before migration 0024 the missing function falls back to the defaults", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const code of ["PGRST202", "42883"]) {
      const settings = await loadCenterSettings({ rpc: async () => ({ data: null, error: { code, message: "missing" } }) });
      assert.equal(settings.timezone, "Asia/Kolkata");
      assert.equal(settings.currency, "INR");
    }
  } finally {
    console.warn = warn;
  }
});

test("any other failure throws instead of silently dating the centre in the wrong zone", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      loadCenterSettings({ rpc: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }),
      /Could not load the center settings/
    );
  } finally {
    console.error = error;
  }
});

// ---- the migration -----------------------------------------------------------------

const MIGRATION = read("../../supabase/migrations/0024_center_regional_settings.sql");

test("the migration adds timezone (default Asia/Kolkata) and currency (default INR), both required", () => {
  assert.match(MIGRATION, /add column if not exists timezone text not null default 'Asia\/Kolkata'/);
  assert.match(MIGRATION, /add column if not exists currency text not null default 'INR'/);
  assert.match(MIGRATION, /center_profile_currency_format check \(currency ~ '\^\[A-Z\]\{3\}\$'\)/);
});

test("the logo reuses the existing nullable column - no duplicate column, no new bucket", () => {
  assert.doesNotMatch(MIGRATION, /add column[^;]*logo/i);
  assert.doesNotMatch(MIGRATION, /storage\.buckets/);
});

test("existing memberships keep INR (their amounts are not touched)", () => {
  assert.match(MIGRATION, /alter table public\.memberships\s+add column if not exists currency text not null default 'INR'/);
  assert.doesNotMatch(MIGRATION, /update\s+public\.memberships/i);
  assert.doesNotMatch(MIGRATION, /alter column amount/i);
});

test("the migration is non-destructive: nothing is dropped, deleted or truncated", () => {
  // The re-created rule functions below the marker keep their own bodies
  // (delete_unused_schedule deletes an unused schedule, as it always has); the
  // migration's OWN statements are above it.
  const own = MIGRATION.split("-- Functions and policy that used the fixed zone")[0];
  assert.doesNotMatch(own, /\bdrop (table|column)\b/i);
  assert.doesNotMatch(own, /\bdelete from\b/i);
  assert.doesNotMatch(own, /\btruncate\b/i);
  assert.doesNotMatch(own, /\bupdate\s+public\./i);
  // The only things dropped are its own trigger and policy, to re-create them.
  const dropped = [...MIGRATION.matchAll(/^drop (\w+)/gim)].map((match) => match[1].toLowerCase()).sort();
  assert.deepEqual(dropped, ["policy", "trigger"]);
});

test("the database no longer hard-codes the centre's zone in any rule", () => {
  // Every quoted zone in a rule is now the centre setting; the only literal zones left are
  // the column / function defaults.
  const withoutDefaults = MIGRATION
    .replace(/default 'Asia\/Kolkata'/g, "")
    .replace(/, 'Asia\/Kolkata'\);/g, ");");
  assert.doesNotMatch(withoutDefaults, /at time zone 'Asia\/Kolkata'|timezone\('Asia\/Kolkata'/);
  const uses = MIGRATION.match(/public\.centre_timezone\(\)/g) ?? [];
  assert.ok(uses.length >= 6, "eligibility, attendance, three schedule functions and the delete policy");
});

test("every function that used the fixed zone is re-created", () => {
  for (const name of [
    "resolve_eligible_students", "save_session_attendance",
    "schedule_usage", "delete_unused_schedule", "correct_unused_schedule",
  ]) {
    assert.match(MIGRATION, new RegExp(`create or replace function public\\.${name}\\(`), name);
  }
  assert.match(MIGRATION, /create policy "enrollment_schedules_delete_unstarted_admin"/);
});

test("the settings functions are callable by signed-in users only", () => {
  assert.match(MIGRATION, /revoke execute on function public\.center_settings\(\) from public, anon/);
  assert.match(MIGRATION, /grant execute on function public\.center_settings\(\) to authenticated/);
  assert.match(MIGRATION, /grant execute on function public\.centre_timezone\(\) to authenticated/);
  // Only the four non-sensitive fields are exposed - not address, phone or email.
  assert.match(MIGRATION, /returns table \(name text, logo_url text, timezone text, currency text\)/);
});

test("the time zone is checked against Postgres's own zone table on save", () => {
  assert.match(MIGRATION, /pg_timezone_names/);
  assert.match(MIGRATION, /before insert or update of timezone on public\.center_profile/);
});

// ---- branding: the shell shows the saved Center Profile name ---------------------------

test("the settings loader exposes the saved centre name alongside the logo", async () => {
  const settings = await loadCenterSettings({
    rpc: async () => ({ data: [{ name: "Nagendran Yoga Center", logo_url: "https://x/l.png", timezone: "Asia/Kolkata", currency: "INR" }], error: null }),
  });
  assert.equal(settings.name, "Nagendran Yoga Center");
  assert.equal(settings.logoUrl, "https://x/l.png");
});

test("the app shell passes the saved name and logo (one source) to every brand slot", () => {
  const shell = read("../../components/layout/AppShell.js");
  assert.match(shell, /logoUrl: settings\.logoUrl, centerName: settings\.name/);
  for (const slot of ["<Sidebar ", "<Header "]) {
    assert.ok(new RegExp(`${slot}[^>]*centerName=\{centerName\}`).test(shell), slot);
  }
  assert.match(read("../../components/global/Header.js"), /<MobileMenu [^>]*centerName=\{centerName\}/);
});

test("no shell component hard-codes the centre's name; 'Attendance System' stays the descriptor", () => {
  for (const path of ["Sidebar.js", "MobileMenu.js", "Header.js"]) {
    const source = read(`../../components/global/${path}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(source, /Yoga Center/, path);
  }
  assert.match(read("../../components/global/Sidebar.js"), /Attendance System/);
  assert.match(read("../../components/global/MobileMenu.js"), /Attendance System/);
});
