// Run with `npm test` (Node's built-in test runner).
//
// V1 System Usage: the pure logic (limits, percentage, remaining, thresholds, formatting), the data
// reader (with a recording fake client), and - from source, the project's way for components and
// migrations - the Admin-only card, the server-only data module and migration 0032.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FREE_PLAN_LIMITS,
  USAGE_THRESHOLDS,
  buildSystemUsage,
  formatBytes,
  formatPercent,
  parseUsage,
  percentUsed,
  remainingBytes,
  usageStatus,
  worstStatus,
} from "./usage.js";
import { fetchSystemUsage } from "./usage-core.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (path) => source(path).replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "");

const MB = 1024 * 1024;
const GB = 1024 * MB;

// ---- the limits, defined once ---------------------------------------------------------------------------------

test("the Free plan limits: 500 MB of database and 1 GB of file storage, in bytes", () => {
  assert.deepEqual({ ...FREE_PLAN_LIMITS }, { databaseBytes: 500 * MB, storageBytes: 1 * GB });
  assert.ok(Object.isFrozen(FREE_PLAN_LIMITS));
  assert.deepEqual({ ...USAGE_THRESHOLDS }, { warning: 70, critical: 90, limit: 100 });
});

test("the limits are defined in ONE module: nothing else hard-codes them", () => {
  const roots = ["../../app/", "../../lib/", "../../components/"];
  for (const root of roots) {
    const files = readdirSync(new URL(root, import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
      .map((f) => `${root}${f.replaceAll("\\", "/")}`)
      .filter((f) => f !== "../../lib/system-usage/usage.js");
    for (const file of files) {
      assert.doesNotMatch(code(file), /524288000|1073741824|500 \* 1024|1024 \* 1024 \* 1024|500 ?MB|1 ?GB/, file);
    }
  }
});

// ---- percentage and remaining ---------------------------------------------------------------------------------------

test("percentage used: 0%, normal, exactly the thresholds, the limit, and over it", () => {
  const limit = FREE_PLAN_LIMITS.databaseBytes;
  assert.equal(percentUsed(0, limit), 0);
  assert.equal(percentUsed(limit / 2, limit), 50);
  assert.equal(percentUsed(limit * 0.7, limit), 70);
  assert.equal(percentUsed(limit * 0.9, limit), 90);
  assert.equal(percentUsed(limit, limit), 100);
  assert.equal(percentUsed(limit * 1.5, limit), 150);
  assert.equal(percentUsed(-5, limit), 0, "garbage is never a negative percentage");
  assert.equal(percentUsed(10, 0), 0, "no limit, no division by zero");
});

test("remaining capacity: the limit minus the use, never below zero", () => {
  const limit = FREE_PLAN_LIMITS.storageBytes;
  assert.equal(remainingBytes(0, limit), limit);
  assert.equal(remainingBytes(300 * MB, limit), limit - 300 * MB);
  assert.equal(remainingBytes(limit, limit), 0);
  assert.equal(remainingBytes(limit + 5, limit), 0);
});

// ---- status thresholds ---------------------------------------------------------------------------------------------------

test("status: Normal below 70%, Warning 70-89%, Critical 90-99%, Limit reached from 100%", () => {
  const limit = FREE_PLAN_LIMITS.databaseBytes;
  const at = (percent) => usageStatus(Math.round((limit * percent) / 100), limit);
  assert.equal(at(0), "normal");
  assert.equal(at(45), "normal");
  assert.equal(at(69), "normal");
  assert.equal(usageStatus(limit * 0.7 - 1, limit), "normal", "just under 70% is still normal");
  assert.equal(usageStatus(limit * 0.7, limit), "warning", "exactly 70%");
  assert.equal(at(89), "warning");
  assert.equal(usageStatus(limit * 0.9 - 1, limit), "warning", "just under 90% is still a warning");
  assert.equal(usageStatus(limit * 0.9, limit), "critical", "exactly 90%");
  assert.equal(at(99), "critical");
  assert.equal(usageStatus(limit - 1, limit), "critical", "one byte under the limit");
  assert.equal(usageStatus(limit, limit), "limit", "exactly 100%");
  assert.equal(usageStatus(limit * 2, limit), "limit", "over the limit");
});

test("the overall status is the worse of the two", () => {
  assert.equal(worstStatus(["normal", "normal"]), "normal");
  assert.equal(worstStatus(["normal", "warning"]), "warning");
  assert.equal(worstStatus(["critical", "warning"]), "critical");
  assert.equal(worstStatus(["limit", "normal"]), "limit");
  assert.equal(worstStatus([]), "normal");
});

// ---- formatting ----------------------------------------------------------------------------------------------------------------

test("bytes read like the Supabase dashboard: 1 KB = 1024 bytes, one decimal at most", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(12.4 * MB), "12.4 MB");
  assert.equal(formatBytes(500 * MB), "500 MB");
  assert.equal(formatBytes(FREE_PLAN_LIMITS.storageBytes), "1 GB");
  assert.equal(formatBytes(1.5 * GB), "1.5 GB");
  assert.equal(formatBytes(-1), "—");
  assert.equal(formatBytes(Number.NaN), "—");
});

test("a value just under the next unit or the limit is never rounded up to it", () => {
  assert.equal(formatBytes(500 * MB - 1), "499.9 MB");
  assert.equal(formatPercent(99.99), "99%");
  assert.equal(formatPercent(100), "100%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(0.46), "0.4%");
  assert.equal(formatPercent(9.99), "9.9%");
  assert.equal(formatPercent(12.7), "12%");
  assert.equal(formatPercent(130), "130%");
});

// ---- what the card shows -------------------------------------------------------------------------------------------------------

test("the card model: Database and File Storage, each with used / limit, percent and remaining, and one status", () => {
  const usage = buildSystemUsage({ databaseBytes: 125 * MB, storageBytes: 256 * MB });
  assert.deepEqual(usage.items.map((i) => i.label), ["Database", "File Storage"]);

  const [database, storage] = usage.items;
  assert.equal(database.usedText, "125 MB");
  assert.equal(database.limitText, "500 MB");
  assert.equal(database.percentText, "25%");
  assert.equal(database.remainingText, "375 MB");
  assert.equal(database.status, "normal");

  assert.equal(storage.usedText, "256 MB");
  assert.equal(storage.limitText, "1 GB");
  assert.equal(storage.percentText, "25%");
  assert.equal(storage.remainingText, "768 MB");

  assert.equal(usage.status, "normal");
  assert.equal(usage.statusLabel, "Normal");
  assert.equal(usage.message, "Usage is within the Free plan limits.");
});

test("the overall message follows the worse of the two, at each approved level", () => {
  const level = (databaseBytes, storageBytes) => buildSystemUsage({ databaseBytes, storageBytes });
  assert.deepEqual([level(0, 0).status, level(0, 0).statusLabel], ["normal", "Normal"]);
  assert.deepEqual([level(350 * MB, 0).status, level(350 * MB, 0).statusLabel], ["warning", "Warning"]);
  assert.deepEqual([level(0, 0.95 * GB).status, level(0, 0.95 * GB).statusLabel], ["critical", "Critical"]);
  assert.deepEqual([level(500 * MB, 0).status, level(500 * MB, 0).statusLabel], ["limit", "Limit reached"]);
  assert.deepEqual([level(10, 2 * GB).status, level(10, 2 * GB).statusLabel], ["limit", "Limit reached"]);
  assert.equal(level(500 * MB, 0).items[0].remainingText, "0 B");
});

test("the usage answer is two byte counts or nothing", () => {
  assert.deepEqual(parseUsage({ database_bytes: 1000, storage_bytes: 0 }), { databaseBytes: 1000, storageBytes: 0 });
  assert.deepEqual(parseUsage({ database_bytes: "2048", storage_bytes: "10" }), { databaseBytes: 2048, storageBytes: 10 });
  for (const bad of [null, undefined, {}, { database_bytes: 1 }, { database_bytes: -1, storage_bytes: 0 }, { database_bytes: "x", storage_bytes: 1 }, "text"]) {
    assert.equal(parseUsage(bad), null, JSON.stringify(bad));
  }
});

// ---- the data reader ----------------------------------------------------------------------------------------------------------

async function quietly(run) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    return { result: await run(), logged };
  } finally {
    console.error = original;
  }
}

test("it calls the system_usage RPC, with no arguments, and returns the normalized counts", async () => {
  const calls = [];
  const supabase = { rpc: async (...args) => (calls.push(args), { data: { database_bytes: 123456, storage_bytes: 789 }, error: null }) };
  assert.deepEqual(await fetchSystemUsage(supabase), { databaseBytes: 123456, storageBytes: 789 });
  assert.deepEqual(calls, [["system_usage"]]);
});

test("a refused or failed call is null, and only the error's code and message are logged", async () => {
  const supabase = { rpc: async () => ({ data: null, error: { code: "42501", message: "Not authorized.", details: "secret detail", hint: "h" } }) };
  const { result, logged } = await quietly(() => fetchSystemUsage(supabase));
  assert.equal(result, null);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /42501 Not authorized\./);
  assert.doesNotMatch(logged[0], /secret detail/);
});

test("a thrown error, a missing function and a malformed answer are all null — never an exception into the page", async () => {
  for (const rpc of [
    async () => { throw new TypeError("fetch failed"); },
    async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.system_usage" } }),
    async () => ({ data: { database_bytes: "n/a", storage_bytes: 1 }, error: null }),
    async () => ({ data: null, error: null }),
  ]) {
    const { result } = await quietly(() => fetchSystemUsage({ rpc }));
    assert.equal(result, null);
  }
});

// ---- server-side only, no privileged credential --------------------------------------------------------------------------

test("the data module is server-only and uses the signed-in user's session client — never the secret/admin client", () => {
  const data = code("./data.js");
  assert.match(source("./data.js"), /^import "server-only";/);
  assert.match(data, /import \{ createClient \} from "@\/lib\/supabase\/server";/);
  assert.match(data, /await requireRole\(ROLES\.ADMIN\);\s*return fetchSystemUsage\(await createClient\(\)\);/);
  for (const path of ["./data.js", "./usage-core.js", "./usage.js", "../../app/dashboard-system-usage.js"]) {
    assert.doesNotMatch(code(path), /createAdminClient|supabase\/admin|SUPABASE_SECRET_KEY|service_role|SERVICE_ROLE|process\.env|Management API|api\.supabase\.com|access.token/i, path);
  }
});

test("nothing here is reachable from the browser: no client component, no browser client", () => {
  for (const path of ["./data.js", "./usage-core.js", "../../app/dashboard-system-usage.js"]) {
    assert.doesNotMatch(source(path), /"use client"|supabase\/client/, path);
  }
});

// ---- the card and the page ----------------------------------------------------------------------------------------------

test("the Dashboard renders the card only for an Admin, in the Admin aside below Recent Activity — and nothing else changed", () => {
  const page = code("../../app/page.js");
  assert.match(page, /import DashboardSystemUsage from "@\/app\/dashboard-system-usage";/);
  assert.match(page, /\{isAdmin && recentActivity \? <DashboardRecentActivity items=\{recentActivity\} timeZone=\{timeZone\} \/> : null\}\s*\{isAdmin \? <DashboardSystemUsage \/> : null\}\s*<\/aside>/);
  assert.equal((page.match(/DashboardSystemUsage/g) ?? []).length, 2, "one import, one use");
  assert.match(page, /const isAdmin = user\.role === ROLES\.ADMIN;/);
});

test("the card shows Database and File Storage, the status and the Free Plan label, and a quiet failure state with no figures", () => {
  const card = code("../../app/dashboard-system-usage.js");
  assert.match(card, /System Usage/);
  assert.match(card, /Free Plan/);
  assert.match(card, /\{item\.usedText\} \/ \{item\.limitText\}/);
  assert.match(card, /\{item\.percentText\} used · \{item\.remainingText\} remaining/);
  assert.match(card, /\{usage\.statusLabel\}/);
  assert.match(card, /\{usage\.message\}/);
  assert.match(card, /if \(!raw\) \{\s*return \(\s*<section[\s\S]*?Usage is unavailable right now\.[\s\S]*?\);\s*\}/);
  // The failure state shows no numbers at all.
  const failure = card.match(/if \(!raw\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(failure, /usedText|percentText|remainingText|buildSystemUsage|MB|GB/);
  // It reuses the Dashboard's panel frame and the existing progress bar - no new visual language.
  assert.match(card, /const PANEL = "rounded-card border border-border bg-surface p-4 shadow-xs";/);
  assert.match(card, /import Progress from "@\/components\/ui\/progress";/);
  // It streams in its own Suspense so a slow read never delays the rest of the Dashboard.
  assert.match(card, /<Suspense fallback=\{<SystemUsageSkeleton \/>\}>\s*<SystemUsageContent \/>/);
});

test("the Dashboard's existing sections are untouched by the card", () => {
  const page = code("../../app/page.js");
  for (const kept of ["Active Students", "Active Batches", "Today's Classes", "Attendance Marked", "DashboardQuickActions", "DashboardCalendar", "Upcoming Classes"]) {
    assert.ok(page.includes(kept), kept);
  }
});

// ---- migration 0032 --------------------------------------------------------------------------------------------------------------

const M32 = "../../supabase/migrations/0032_system_usage.sql";
const C32 = sqlCode(M32);

test("0032 is the next migration, and it only adds one function", () => {
  const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  // Anchored on 0032 by name, so later migrations (0033 onwards) do not move the pin.
  const at = files.indexOf("0032_system_usage.sql");
  assert.ok(at > 0);
  assert.equal(files[at - 1], "0031_membership_plans.sql");
  assert.deepEqual([...C32.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]), ["system_usage"]);
  assert.doesNotMatch(C32, /\b(create table|alter table|drop |insert into|update public|delete from|create policy|create trigger)\b/i);
});

test("the function is Admin-only, security definer, with an empty search_path", () => {
  const fn = C32.match(/create or replace function public\.system_usage\(\)[\s\S]*?\n\$\$;/)[0];
  assert.match(fn, /returns jsonb\s+language plpgsql\s+security definer\s+stable\s+set search_path = ''/);
  assert.match(fn, /if not public\.is_admin\(\) then\s+raise exception 'Not authorized\.' using errcode = '42501';\s+end if;/);
  assert.ok(fn.indexOf("public.is_admin()") < fn.indexOf("pg_database_size"), "the check comes first");
});

test("it reads exactly the database size and the storage object sizes, and returns exactly those two numbers", () => {
  const fn = C32.match(/create or replace function public\.system_usage\(\)[\s\S]*?\n\$\$;/)[0];
  assert.match(fn, /v_database_bytes := pg_database_size\(current_database\(\)\);/);
  assert.match(fn, /from storage\.objects o;/);
  assert.match(fn, /coalesce\(\s*sum\(/);
  assert.match(fn, /~ '\^\[0-9\]\+\$'/, "a size that is missing or not a plain number counts as 0");
  assert.match(fn, /jsonb_build_object\(\s*'database_bytes', v_database_bytes,\s*'storage_bytes',\s+v_storage_bytes\s*\)/);
  // It never returns or exposes rows of storage.objects, names, or paths.
  assert.doesNotMatch(fn, /\bname\b|bucket_id|owner|\bpath\b|returns table|setof/i);
});

test("no anonymous caller can execute it; authenticated can, and nothing broader is granted", () => {
  assert.match(C32, /revoke execute on function public\.system_usage\(\) from public, anon;/);
  assert.match(C32, /grant execute on function public\.system_usage\(\) to authenticated;/);
  assert.doesNotMatch(C32, /grant (select|insert|update|delete|usage|all)\b/i);
  assert.doesNotMatch(C32, /storage\.objects[^;]*\b(grant|policy)\b/i);
});

test("the 0032 verification script exists and writes nothing", () => {
  const script = sqlCode("../../supabase/verification/verify_0032_system_usage.sql");
  assert.match(script, /^\s*begin;/m);
  assert.match(script, /\nrollback;\s*$/);
  assert.doesNotMatch(script, /insert\s+into\s+public\.|update\s+public\.|delete\s+from\s+public\./i);
  for (const check of ["A3", "A6", "B1", "B5", "B6", "B7"]) assert.ok(source("../../supabase/verification/verify_0032_system_usage.sql").includes(`'${check} `), check);
});
