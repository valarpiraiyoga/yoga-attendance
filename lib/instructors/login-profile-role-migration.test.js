// Run with `npm test` (Node's built-in test runner).
//
// Migration 0064 (public.login_profile_role), pinned from source - the project's way for SQL. This proves what the file says, not how the
// database behaves: that is supabase/verification/verify_0064_login_profile_role_behavior.sql, run against a database.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0064_login_profile_role.sql");
const body = sql.replace(/^\s*--.*$/gm, "");
const fn = body.slice(body.indexOf("create or replace function public.login_profile_role("), body.indexOf("comment on function public.login_profile_role("));

test("0064 is the next migration number and the only file with that number", () => {
  const numbers = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).map((name) => name.slice(0, 4));
  assert.equal(numbers.filter((number) => number === "0064").length, 1);
  assert.ok(numbers.includes("0063"));
});

test("the function: one uuid argument, returns text, SECURITY DEFINER, STABLE, search_path pinned to empty", () => {
  assert.match(fn, /create or replace function public\.login_profile_role\(p_user_id uuid\)\s+returns text\s+language plpgsql\s+stable\s+security definer\s+set search_path = ''/);
});

test("the caller must be an Admin - checked first, with is_admin() (auth.uid(), the verified request), and a refusal is 42501", () => {
  const check = fn.indexOf("if not public.is_admin() then");
  const readAt = fn.indexOf("from public.profiles p");
  assert.ok(check > 0 && readAt > check, "the Admin check comes before any read");
  assert.match(fn, /raise exception 'Not authorized\.' using errcode = '42501';/);
  assert.ok(!/p_user_id[^;]*is_admin|is_admin\([^)]+\)/.test(fn), "the argument plays no part in the Admin decision");
  const isAdmin = read("supabase/migrations/0002_instructors.sql");
  assert.match(isAdmin, /where id = auth\.uid\(\)\s+and role = 'admin'/, "is_admin() decides from auth.uid()");
});

test("it returns only that one user's role - no other column, no other user - and NULL when there is no profile", () => {
  assert.match(fn, /select p\.role into v_role\s+from public\.profiles p\s+where p\.id = p_user_id;/);
  assert.match(fn, /return v_role;/);
  assert.ok(!/full_name|created_at|updated_at|select \*/.test(fn));
  assert.equal((fn.match(/\bfrom\b/g) ?? []).length, 1, "a single read");
});

test("every object is schema-qualified (search_path is empty)", () => {
  assert.ok(fn.includes("public.is_admin()") && fn.includes("public.profiles"));
  assert.ok(!/\bfrom profiles\b|\bis_admin\(\)/.test(fn.replace(/public\.is_admin\(\)/g, "")));
});

test("EXECUTE is revoked from PUBLIC, anon and service_role and granted to authenticated only", () => {
  assert.match(body, /revoke execute on function public\.login_profile_role\(uuid\) from public, anon, service_role;/);
  assert.match(body, /grant execute on function public\.login_profile_role\(uuid\) to authenticated;/);
  assert.equal((body.match(/^\s*grant\b/gm) ?? []).length, 1, "one GRANT statement, and it is the function's");
});

test("no grant, revoke or policy touches public.profiles, and nothing else is created or changed", () => {
  assert.doesNotMatch(body, /\bon (table )?public\.profiles\b/i);
  assert.doesNotMatch(body, /\bpolicy\b|\balter table\b|\bcreate table\b|\bcreate trigger\b|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b/i);
  assert.equal((body.match(/create or replace function/g) ?? []).length, 1);
  assert.ok(!body.includes("create or replace function public.is_admin("), "is_admin() is used, not redefined");
});
