// Run with `npm test` (Node's built-in test runner).
//
// V1 Invoice / Receipt Enhancement — the database layer (migrations 0025 and
// 0026 and their verification scripts). There is no database in the unit test
// run, so these tests read the SQL text and pin the decisions that must not
// regress; the behaviour itself is exercised by
// supabase/verification/verify_0026_invoices_behavior.sql.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const MIGRATIONS = "../../supabase/migrations/";
const VERIFICATION = "../../supabase/verification/";

const M25 = read(`${MIGRATIONS}0025_payment_date_invoice_settings.sql`);
const M26 = read(`${MIGRATIONS}0026_invoices.sql`);

// The SQL with line comments removed, so a pattern cannot match explanatory text.
const code = (sql) => sql.replace(/^\s*--.*$/gm, "");
const C25 = code(M25);
const C26 = code(M26);

// ---- migration structure --------------------------------------------------------

test("the invoice migrations follow 0024 and are numbered 0025, 0026, 0027, 0028, 0029 and 0030", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  // Anchored on 0024, so later migrations (0031 onwards) do not move the pins.
  const at = files.indexOf("0024_center_regional_settings.sql");
  assert.ok(at >= 0);
  assert.deepEqual(files.slice(at, at + 7), [
    "0024_center_regional_settings.sql",
    "0025_payment_date_invoice_settings.sql",
    "0026_invoices.sql",
    "0027_invoice_prefix.sql",
    "0028_bank_accounts.sql",
    "0029_invoice_bank_account_snapshot.sql",
    "0030_invoice_membership_sync.sql",
  ]);
});

test("neither migration rewrites an existing table's data", () => {
  for (const sql of [C25, C26]) {
    assert.doesNotMatch(sql, /\bupdate\s+public\.memberships\s+set\s+payment_date\s*=\s*[^;]*created_at/i, "no back-fill from created_at");
    assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
    assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
    assert.doesNotMatch(sql, /\bdrop\s+column\b/i);
    assert.doesNotMatch(sql, /\balter\s+column\b/i);
  }
});

// ---- 0025: memberships.payment_date --------------------------------------------------

test("0025 adds one nullable payment_date column and does not back-fill it", () => {
  assert.match(C25, /alter table public\.memberships\s+add column if not exists payment_date date;/);
  assert.doesNotMatch(C25, /payment_date date (not null|default)/i);
  // The only statements that write to memberships rows are inside the trigger function.
  assert.doesNotMatch(C25, /\bupdate\s+public\.memberships\b/i);
});

test("0025 only allows a payment_date on a Paid membership", () => {
  assert.match(C25, /memberships_payment_date_only_when_paid/);
  assert.match(C25, /check \(payment_status = 'paid' or payment_date is null\)/);
});

test("0025 gives memberships no invoice number, date or id", () => {
  assert.doesNotMatch(C25 + C26, /alter table public\.memberships[^;]*add column[^;]*invoice_(number|date|id)/i);
});

test("the payment rules default the date only when a membership BECOMES Paid, in the centre timezone", () => {
  assert.match(C25, /create trigger memberships_payment_rules_trigger\s+before insert or update of payment_status, payment_date on public\.memberships/);
  assert.match(C25, /new\.payment_status is distinct from 'paid' then\s+new\.payment_date := null;/);
  assert.match(C25, /v_today := \(now\(\) at time zone public\.centre_timezone\(\)\)::date;/);
  assert.match(C25, /if tg_op = 'UPDATE' then\s+v_became_paid := old\.payment_status is distinct from 'paid';/);
  assert.match(C25, /new\.payment_date is null and v_became_paid then/);
  // OLD is never read in an expression that also runs for INSERT.
  assert.doesNotMatch(C25, /tg_op = 'INSERT' or old\./);
  assert.match(C25, /new\.payment_date := v_today;/);
  assert.match(C25, /new\.payment_date > v_today then\s+raise exception 'The payment date cannot be in the future\.' using errcode = '22023'/);
});

// ---- 0025: invoice_settings -------------------------------------------------------------

test("invoice_settings is a singleton with the approved columns and defaults", () => {
  assert.match(C25, /create table if not exists public\.invoice_settings/);
  assert.match(C25, /singleton\s+boolean primary key default true/);
  assert.match(C25, /constraint invoice_settings_is_singleton check \(singleton\)/);
  assert.match(C25, /starting_invoice_number\s+bigint,/);
  assert.match(C25, /next_invoice_number\s+bigint,/);
  assert.match(C25, /document_title\s+text not null default 'invoice'/);
  assert.match(C25, /tax_enabled\s+boolean not null default false/);
  assert.match(C25, /tax_rate\s+numeric\(5, 2\)/);
  for (const column of ["tax_name", "terms", "signatory_name", "signatory_designation", "signature_path", "updated_at"]) {
    assert.match(C25, new RegExp(`\\b${column}\\b`), column);
  }
  assert.match(C25, /insert into public\.invoice_settings \(singleton\)\s+values \(true\)\s+on conflict \(singleton\) do nothing/);
});

test("invoice_settings starts with numbering UNCONFIGURED (no seeded starting number)", () => {
  assert.doesNotMatch(C25, /insert into public\.invoice_settings \([^)]*starting_invoice_number/);
});

test("invoice_settings does not duplicate Center Profile fields", () => {
  const table = C25.slice(C25.indexOf("create table if not exists public.invoice_settings"));
  const body = table.slice(0, table.indexOf(");"));
  for (const column of ["name", "address", "phone", "email", "logo_url"]) {
    assert.doesNotMatch(body, new RegExp(`^\\s+${column}\\s+text`, "m"), column);
  }
});

test("invoice_settings constraints: positive numbers, title, tax rate range, tax completeness", () => {
  assert.match(C25, /starting_invoice_number is null or starting_invoice_number > 0/);
  assert.match(C25, /document_title in \('invoice', 'receipt'\)/);
  assert.match(C25, /tax_rate is null or \(tax_rate > 0 and tax_rate < 100\)/);
  assert.match(C25, /not tax_enabled or \(tax_name is not null and tax_rate is not null\)/);
});

test("invoice_settings: admin select/update only, and next_invoice_number is not client-writable", () => {
  assert.match(C25, /revoke all on public\.invoice_settings from anon, authenticated;/);
  assert.match(C25, /grant select on public\.invoice_settings to authenticated;/);
  const grantUpdate = C25.match(/grant update \(([^)]*)\) on public\.invoice_settings to authenticated;/);
  assert.ok(grantUpdate, "column-level update grant");
  assert.doesNotMatch(grantUpdate[1], /next_invoice_number/);
  assert.match(grantUpdate[1], /starting_invoice_number/);
  assert.doesNotMatch(C25, /grant (insert|delete|all)[^;]*invoice_settings/i);
  assert.match(C25, /create policy "invoice_settings_select_admin"[\s\S]*?for select\s+using \(public\.is_admin\(\)\)/);
  assert.match(C25, /create policy "invoice_settings_update_admin"[\s\S]*?for update\s+using \(public\.is_admin\(\)\)\s+with check \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(C25, /for (insert|delete|all)\b/i);
});

// ---- 0026: invoices table ---------------------------------------------------------------

test("invoices has the approved columns and none of the excluded ones", () => {
  const start = C26.indexOf("create table if not exists public.invoices");
  const table = C26.slice(start, C26.indexOf("create unique index", start));
  for (const column of [
    "id", "membership_id", "invoice_number", "invoice_date", "payment_date",
    "document_title", "description", "plan", "period_start", "period_end",
    "currency", "total_amount",
    "tax_enabled", "tax_name", "tax_rate", "taxable_amount", "tax_amount",
    "customer_name", "customer_code", "customer_phone", "customer_phone_country_code", "customer_email",
    "business_name", "business_address", "business_phone", "business_email", "business_logo_path",
    "terms", "signatory_name", "signatory_designation", "signature_path",
    "created_at", "updated_at",
  ]) {
    assert.match(table, new RegExp(`^\\s+${column}\\s`, "m"), column);
  }
  for (const column of [
    "status", "voided_at", "issued_by", "cancelled_at", "payment_method", "payment_id",
    "refund", "credit_note", "partial",
  ]) {
    assert.doesNotMatch(table, new RegExp(`^\\s+\\w*${column}\\w*\\s+(text|uuid|boolean|numeric|date|timestamptz)`, "m"), column);
  }
});

test("there is no invoice_items table", () => {
  assert.doesNotMatch(C26, /create table[^;]*invoice_items/i);
  assert.doesNotMatch(C26, /create table[^;]*receipt_items/i);
});

test("invoices follow the project conventions: uuid pk, text + CHECK, numeric(10,2), bigint number, RESTRICT", () => {
  assert.match(C26, /id\s+uuid primary key default gen_random_uuid\(\)/);
  assert.match(C26, /membership_id\s+uuid not null references public\.memberships \(id\) on delete restrict/);
  assert.match(C26, /invoice_number\s+bigint not null check \(invoice_number > 0\)/);
  assert.match(C26, /invoice_date\s+date not null/);
  assert.match(C26, /payment_date\s+date not null/);
  assert.match(C26, /total_amount\s+numeric\(10, 2\) not null check \(total_amount > 0\)/);
  assert.match(C26, /tax_rate\s+numeric\(5, 2\)/);
  assert.match(C26, /document_title in \('invoice', 'receipt'\)/);
  assert.doesNotMatch(C26, /create type\b/i);
  assert.doesNotMatch(C26, /\bon delete cascade\b/i);
});

test("Membership 1 : 0..1 Invoice and unique numbers are database-enforced", () => {
  assert.match(C26, /create unique index if not exists invoices_membership_id_unique\s+on public\.invoices \(membership_id\)/);
  assert.match(C26, /create unique index if not exists invoices_invoice_number_unique\s+on public\.invoices \(invoice_number\)/);
});

test("invoices have no foreign key to students, center_profile or invoice_settings (snapshots, not live links)", () => {
  assert.equal((C26.match(/references public\./g) ?? []).length, 1);
});

test("invoice date and tax CHECK constraints", () => {
  assert.match(C26, /constraint invoices_invoice_date_not_before_payment_date check \(invoice_date >= payment_date\)/);
  assert.match(C26, /constraint invoices_period_end_after_start check \(period_end >= period_start\)/);
  const tax = C26.slice(C26.indexOf("constraint invoices_tax_consistent"));
  assert.match(tax, /tax_enabled = false\s+and tax_name is null and tax_rate is null\s+and taxable_amount is null and tax_amount is null/);
  assert.match(tax, /tax_rate > 0 and tax_rate < 100/);
  assert.match(tax, /taxable_amount \+ tax_amount = total_amount/);
});

test("future dates are rejected against the centre timezone", () => {
  assert.match(C26, /create or replace function public\.invoices_validate_dates\(\)/);
  assert.match(C26, /new\.invoice_date > v_today then\s+raise exception 'The invoice date cannot be in the future\.'/);
  assert.match(C26, /new\.payment_date > v_today then\s+raise exception 'The payment date cannot be in the future\.'/);
  assert.match(C26, /centre_timezone\(\)/);
});

// ---- 0026: snapshot protection ------------------------------------------------------------------

test("an issued invoice can change only its number, date and updated_at", () => {
  assert.match(C26, /to_jsonb\(new\) - 'invoice_number' - 'invoice_date' - 'updated_at'/);
  assert.match(C26, /create trigger invoices_freeze_snapshot_trigger\s+before update on public\.invoices/);
  assert.match(C26, /An issued invoice can only change its number and date\./);
});

test("invoices cannot be deleted, even by the owner", () => {
  assert.match(C26, /create trigger invoices_prevent_delete_trigger\s+before delete on public\.invoices/);
  assert.doesNotMatch(C26, /grant[^;]*\bdelete\b[^;]*public\.invoices/i);
});

// ---- 0026: numbering --------------------------------------------------------------------------------

test("numbering uses a locked counter row — not MAX()+1 and not a sequence", () => {
  const core = C26.slice(C26.indexOf("create or replace function public.issue_invoice_core"), C26.indexOf("create or replace function public.memberships_auto_issue_invoice"));
  assert.match(core, /from public\.invoice_settings\s+where singleton\s+for update/);
  assert.match(core, /coalesce\(v_settings\.next_invoice_number, v_settings\.starting_invoice_number\)/);
  assert.match(core, /while exists \(select 1 from public\.invoices where invoice_number = v_candidate\) loop\s+v_candidate := v_candidate \+ 1;/);
  assert.match(core, /set next_invoice_number = v_candidate \+ 1/);
  assert.doesNotMatch(core, /max\s*\(/i);
  assert.doesNotMatch(C26, /create sequence/i);
  assert.doesNotMatch(C26, /nextval/i);
});

test("issuing refuses to run until numbering is configured", () => {
  assert.match(C26, /v_settings\.starting_invoice_number is null then\s+raise exception 'Invoice numbering has not been configured\.' using errcode = '55000'/);
});

test("the starting number is locked once an invoice exists", () => {
  assert.match(C26, /create trigger invoice_settings_guard_trigger\s+before update on public\.invoice_settings/);
  assert.match(C26, /new\.starting_invoice_number is distinct from old\.starting_invoice_number then\s+if exists \(select 1 from public\.invoices\) then\s+raise exception 'The starting invoice number cannot be changed once an invoice has been issued\.'/);
});

test("manual number edits: admin only, positive, unique, not below the starting number, ahead-of-counter allowed", () => {
  const edit = C26.slice(C26.indexOf("create or replace function public.update_invoice_details"));
  assert.match(edit, /not public\.is_admin\(\)[\s\S]*?errcode = '42501'/);
  assert.match(edit, /p_invoice_number is null or p_invoice_number <= 0/);
  assert.match(edit, /p_invoice_number < v_settings\.starting_invoice_number/);
  assert.match(edit, /invoice_number = p_invoice_number and id <> p_invoice_id/);
  assert.match(edit, /for update/);
  // It writes only the number, the date and updated_at.
  assert.match(edit, /set invoice_number = p_invoice_number,\s+invoice_date = p_invoice_date,\s+updated_at = now\(\)/);
});

// ---- 0026: tax -------------------------------------------------------------------------------------------

test("tax is tax-inclusive and back-calculated, with taxable = total - tax", () => {
  assert.match(C26, /v_tax_amount := round\(v_mem\.amount \* v_settings\.tax_rate \/ \(100 \+ v_settings\.tax_rate\), 2\);/);
  assert.match(C26, /v_taxable := v_mem\.amount - v_tax_amount;/);
  // Disabled tax stores NULL in every tax field.
  assert.match(C26, /case when v_settings\.tax_enabled then v_settings\.tax_name end/);
  assert.match(C26, /case when v_settings\.tax_enabled then v_settings\.tax_rate end/);
});

// ---- 0026: snapshot sources ------------------------------------------------------------------------------

test("the invoice copies its content from membership, student, centre profile and settings", () => {
  const core = C26.slice(C26.indexOf("create or replace function public.issue_invoice_core"), C26.indexOf("create or replace function public.memberships_auto_issue_invoice"));
  assert.match(core, /from public\.students where id = v_mem\.student_id/);
  assert.match(core, /from public\.center_profile where singleton/);
  assert.match(core, /v_student\.full_name, v_student\.student_code, v_student\.phone, v_student\.phone_country_code, v_student\.email/);
  assert.match(core, /v_center\.name, v_center\.address, v_center\.phone, v_center\.email, v_logo_path/);
  assert.match(core, /v_settings\.terms, v_settings\.signatory_name, v_settings\.signatory_designation, v_settings\.signature_path/);
  assert.match(core, /v_mem\.currency, v_mem\.amount/);
  assert.match(core, /v_mem\.id, v_candidate, v_invoice_date, v_mem\.payment_date/);
});

test("the logo is stored as a bucket path, not a URL", () => {
  assert.match(C26, /substring\(v_center\.logo_url from '\/storage\/v1\/object\/public\/profile-photos\/\(\[\^\?\]\+\)'\)/);
});

// ---- 0026: automatic issuing and membership guards ------------------------------------------------------

test("automatic issuing is an AFTER trigger that fires only when a membership BECOMES Paid", () => {
  assert.match(C26, /create trigger memberships_auto_issue_invoice_trigger\s+after insert or update of payment_status on public\.memberships/);
  assert.match(C26, /if tg_op = 'UPDATE' then\s+v_became_paid := old\.payment_status is distinct from 'paid';/);
  assert.match(C26, /new\.payment_status = 'paid'\s+and v_became_paid\s+and not exists \(select 1 from public\.invoices where membership_id = new\.id\)/);
  assert.doesNotMatch(C26, /tg_op = 'INSERT' or (old|new)\./);
  // Unconfigured numbering issues nothing and does not raise.
  assert.match(C26, /if v_start is not null then\s+perform public\.issue_invoice_core\(new\.id, null\);/);
});

test("once an invoice exists, Paid -> Pending and payment_date changes are rejected", () => {
  assert.match(C26, /create trigger memberships_invoice_guard_trigger\s+before update of payment_status, payment_date on public\.memberships/);
  assert.match(C26, /old\.payment_status = 'paid' and new\.payment_status is distinct from 'paid' then\s+raise exception 'The payment status cannot be changed after an invoice has been issued\.'/);
  assert.match(C26, /new\.payment_date is distinct from old\.payment_date then\s+raise exception 'The payment date cannot be changed after an invoice has been issued\.'/);
  // Sorts before 0025's payment rules trigger, so it sees the client's own values.
  assert.ok("memberships_invoice_guard_trigger" < "memberships_payment_rules_trigger");
});

// ---- 0026: manual issue -----------------------------------------------------------------------------------

test("Issue Invoice for an existing Paid membership never invents a payment date", () => {
  const issue = C26.slice(C26.indexOf("create or replace function public.issue_invoice("), C26.indexOf("create or replace function public.update_invoice_details"));
  assert.match(issue, /not public\.is_admin\(\)[\s\S]*?errcode = '42501'/);
  assert.match(issue, /if v_mem\.payment_date is null then\s+if p_payment_date is null then\s+raise exception 'Confirm the payment date to issue this invoice\.' using errcode = '22023'/);
  assert.match(issue, /update public\.memberships\s+set payment_date = p_payment_date/);
  assert.match(issue, /already has a payment date, which cannot be changed/);
  assert.doesNotMatch(issue, /created_at/);
  assert.match(issue, /Only a Paid membership can be invoiced\./);
});

test("a cancelled Paid membership may still be invoiced (no cancellation check)", () => {
  assert.doesNotMatch(C26, /cancelled_at/);
});

// ---- 0026: RLS, grants, functions --------------------------------------------------------------------------

test("invoices: admin SELECT only — no client insert, update or delete", () => {
  assert.match(C26, /revoke all on public\.invoices from anon, authenticated;/);
  assert.match(C26, /grant select on public\.invoices to authenticated;/);
  assert.doesNotMatch(C26, /grant\s+(insert|update|delete|all|truncate)[^;]*on public\.invoices/i);
  assert.match(C26, /alter table public\.invoices enable row level security;/);
  assert.match(C26, /create policy "invoices_select_admin"[\s\S]*?for select\s+using \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(C26, /create policy "invoices_(insert|update|delete)/);
});

test("every new function is security definer with an empty search_path", () => {
  const functions = [...C26.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s+returns\s+(\w+)\s+language plpgsql\s+security definer\s+set search_path = ''/g)];
  const names = functions.map((m) => m[1]).sort();
  assert.deepEqual(names, [
    "invoice_settings_guard", "invoices_freeze_snapshot", "invoices_prevent_delete", "invoices_validate_dates",
    "issue_invoice", "issue_invoice_core", "memberships_auto_issue_invoice", "memberships_invoice_guard",
    "update_invoice_details",
  ]);
  assert.equal((C26.match(/create or replace function/g) ?? []).length, 9);
});

test("client functions are granted to authenticated only; issue_invoice_core to nobody", () => {
  assert.match(C26, /revoke execute on function public\.issue_invoice\(uuid, date, date\) from public, anon;/);
  assert.match(C26, /revoke execute on function public\.update_invoice_details\(uuid, bigint, date\) from public, anon;/);
  assert.match(C26, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
  assert.match(C26, /grant execute on function public\.issue_invoice\(uuid, date, date\) to authenticated;/);
  assert.match(C26, /grant execute on function public\.update_invoice_details\(uuid, bigint, date\) to authenticated;/);
  assert.doesNotMatch(C26, /grant execute on function public\.issue_invoice_core/);
});

// ---- 0026: storage ----------------------------------------------------------------------------------------------

test("the invoice-assets bucket is private, image-only, 2 MB, with no update or delete policy", () => {
  assert.match(C26, /'invoice-assets',\s+'invoice-assets',\s+false,\s+2097152,[^\n]*\n\s+array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(C26, /create policy "invoice_assets_select_admin"[\s\S]*?for select[\s\S]*?bucket_id = 'invoice-assets' and public\.is_admin\(\)/);
  assert.match(C26, /create policy "invoice_assets_insert_admin"[\s\S]*?for insert[\s\S]*?bucket_id = 'invoice-assets' and public\.is_admin\(\)/);
  assert.doesNotMatch(C26, /create policy "invoice_assets_(update|delete)/);
});

test("replaced centre logo files are retained: the profile-photos delete policy excludes center/", () => {
  assert.match(C26, /drop policy if exists "profile_photos_delete_admin" on storage\.objects;/);
  assert.match(C26, /create policy "profile_photos_delete_admin"[\s\S]*?for delete[\s\S]*?bucket_id = 'profile-photos'\s+and public\.is_admin\(\)\s+and \(storage\.foldername\(name\)\)\[1\] is distinct from 'center'/);
  // Nothing else about profile-photos changes.
  assert.doesNotMatch(C26, /create policy "profile_photos_(select|insert|update)_admin"/);
  assert.doesNotMatch(C26, /insert into storage\.buckets[^;]*'profile-photos'/);
});

// ---- the verification scripts --------------------------------------------------------------------------------------

test("the structural verification scripts are read-only", () => {
  for (const file of ["verify_0025_payment_date_invoice_settings.sql", "verify_0026_invoices.sql"]) {
    const sql = code(read(`${VERIFICATION}${file}`));
    assert.match(sql, /begin transaction read only;/, file);
    assert.match(sql, /rollback;\s*$/, file);
    assert.doesNotMatch(sql, /^\s*(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s+(table|function|trigger))/im, file);
  }
});

test("the behavioural script rolls back and never inserts a student or a membership", () => {
  assert.ok(existsSync(new URL(`${VERIFICATION}verify_0026_invoices_behavior.sql`, import.meta.url)));
  const sql = code(read(`${VERIFICATION}verify_0026_invoices_behavior.sql`));
  assert.match(sql, /^\s*begin;/m);
  assert.match(sql, /\nrollback;/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(students|memberships)\b/i);
  assert.match(read(`${VERIFICATION}verify_0026_invoices_behavior.sql`), /two-session procedure/i);
});

test("the migrations leave existing migrations 0001-0024 alone", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files.length, 32);
  assert.equal(files[0], "0001_auth_profiles.sql");
});

// ==== Migration 0027 - Invoice Number Prefix (database foundation) ========================

const M27 = read(`${MIGRATIONS}0027_invoice_prefix.sql`);
const C27 = code(M27);
const lf = (text) => text.replace(/\r\n/g, "\n");

/** One `create or replace function` body, from its header to its closing `$$;`, comments removed. */
function functionOf(sql, name) {
  const text = lf(sql);
  const start = text.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return code(text.slice(start, text.indexOf("\n$$;", start) + 4));
}

test("0027 adds a nullable text invoice_prefix to invoice_settings and to invoices — no default, no enabled column", () => {
  assert.match(C27, /alter table public\.invoice_settings\s+add column if not exists invoice_prefix text;/);
  assert.match(C27, /alter table public\.invoices\s+add column if not exists invoice_prefix text;/);
  assert.doesNotMatch(C27, /invoice_prefix text (not null|default)/i);
  assert.doesNotMatch(C27, /prefix_enabled/i);
});

test("invoice_number is untouched: still bigint, still unique, no new uniqueness involving the prefix", () => {
  assert.doesNotMatch(C27, /alter table[^;]*invoice_number/i);
  assert.doesNotMatch(C27, /alter column/i);
  assert.doesNotMatch(C27, /create\s+(unique\s+)?index/i);
  assert.doesNotMatch(C27, /\bunique\b/i);
  assert.doesNotMatch(C27, /invoice_prefix\s*\|\||\|\|\s*[a-z_.]*invoice_prefix/i, "no displayed-number construction in SQL");
});

test("the prefix rule is a CHECK on both tables: NULL or 1-20 characters, trimmed, not ending in a digit", () => {
  for (const [table, name] of [
    ["invoice_settings", "invoice_settings_invoice_prefix_valid"],
    ["invoices", "invoices_invoice_prefix_valid"],
  ]) {
    assert.match(C27, new RegExp(`alter table public\\.${table}\\s+add constraint ${name}`), name);
  }
  const rule = /invoice_prefix is null\s+or \(\s+length\(invoice_prefix\) between 1 and 20\s+and invoice_prefix !~ '\^\\s\|\\s\$'\s+and invoice_prefix !~ '\[0-9\]\$'\s+\)/g;
  assert.equal((C27.match(rule) ?? []).length, 2, "the same rule on both tables");
  // Idempotent, like 0024.
  assert.equal((C27.match(/if not exists \(select 1 from pg_constraint where conname = /g) ?? []).length, 2);
});

test("the prefix can be written by an Admin through the settings grant — and nothing else is granted", () => {
  assert.match(C27, /grant update \(invoice_prefix\) on public\.invoice_settings to authenticated;/);
  assert.equal((C27.match(/\bgrant\b/gi) ?? []).length, 1);
  assert.doesNotMatch(C27, /next_invoice_number\s*\)/);
  assert.doesNotMatch(C27, /grant[^;]*public\.invoices/i);
  assert.doesNotMatch(C27, /create policy|alter policy|drop policy/i);
});

test("0027 does not touch existing rows: no back-fill, no data statements", () => {
  assert.doesNotMatch(C27, /\bdelete\s+from\b/i);
  assert.doesNotMatch(C27, /\bdrop\s+(table|column|trigger)\b/i);
  assert.doesNotMatch(C27, /\bupdate\s+public\.invoices\b/i);
  assert.doesNotMatch(C27, /\bupdate\s+public\.memberships\b/i);
  // The only insert is the invoice row issue_invoice_core creates; the only update, the counter it advances.
  assert.equal((C27.match(/\binsert\s+into\b/gi) ?? []).length, 1);
  assert.equal((C27.match(/\binsert\s+into public\.invoices\b/g) ?? []).length, 1);
  assert.deepEqual([...C27.matchAll(/\bupdate\s+public\.(\w+)/gi)].map((m) => m[1]), ["invoice_settings"]);
});

test("0027 redefines exactly two functions: issue_invoice_core and invoice_settings_guard", () => {
  const names = [...C27.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["invoice_settings_guard", "issue_invoice_core"]);
  // issue_invoice, update_invoice_details and the freeze / validate / delete triggers are not touched.
  for (const untouched of ["issue_invoice(", "update_invoice_details", "invoices_freeze_snapshot", "invoices_validate_dates", "invoices_prevent_delete"]) {
    assert.doesNotMatch(C27, new RegExp(`function public\\.${untouched.replace("(", "\\(")}`), untouched);
  }
  assert.doesNotMatch(C27, /create trigger|drop trigger/i);
});

test("issue_invoice_core differs from 0026's only by copying invoice_prefix — counter, tax, dates and locks identical", () => {
  const before = functionOf(M26, "issue_invoice_core");
  const after = functionOf(M27, "issue_invoice_core");

  // Take the two prefix additions out of 0027's version and the bodies must match exactly.
  const stripped = after
    .replace(/signature_path,\s*\n\s*invoice_prefix\s*\n(\s*)\)/, "signature_path\n$1)")
    .replace(/v_settings\.signature_path,\s*\n\s*v_settings\.invoice_prefix\s*\n(\s*)\)/, "v_settings.signature_path\n$1)");
  assert.equal(stripped, before);

  assert.match(after, /terms, signatory_name, signatory_designation, signature_path,\s*invoice_prefix\s*\)/);
  assert.match(after, /v_settings\.signature_path,\s*v_settings\.invoice_prefix\s*\)/);
  // The settings row is still the one locked FOR UPDATE, and the prefix is read from it (no second read).
  assert.match(after, /select \* into v_settings\s+from public\.invoice_settings\s+where singleton\s+for update;/);
  assert.equal((after.match(/from public\.invoice_settings/g) ?? []).length, 1);
  assert.match(after, /next_invoice_number = v_candidate \+ 1/);
  assert.match(after, /round\(v_mem\.amount \* v_settings\.tax_rate \/ \(100 \+ v_settings\.tax_rate\), 2\)/);
  assert.doesNotMatch(after, /max\s*\(|nextval/i);
});

test("the function keeps its security: definer, empty search_path, executable by no client role", () => {
  const after = functionOf(M27, "issue_invoice_core");
  assert.match(after, /language plpgsql\s+security definer\s+set search_path = ''/);
  assert.match(C27, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
  assert.doesNotMatch(C27, /grant execute/i);
});

test("the settings guard changes only by noticing the prefix: the starting-number lock is intact, the prefix is not locked", () => {
  const before = functionOf(M26, "invoice_settings_guard");
  const after = functionOf(M27, "invoice_settings_guard");
  const stripped = after.replace(/, new\.invoice_prefix\)/, ")").replace(/, old\.invoice_prefix\)/, ")");
  assert.equal(stripped, before);
  assert.match(after, /new\.invoice_prefix/);
  // No raise anywhere mentions the prefix: nothing locks it.
  assert.doesNotMatch(after, /raise exception[^;]*prefix/i);
});

test("the freeze trigger protects the prefix with no change: it compares the whole row and exempts only three keys", () => {
  const freeze = functionOf(M26, "invoices_freeze_snapshot");
  assert.match(freeze, /to_jsonb\(new\) - 'invoice_number' - 'invoice_date' - 'updated_at'/);
  assert.doesNotMatch(freeze, /invoice_prefix/);
  const edit = functionOf(M26, "update_invoice_details");
  assert.match(edit, /set invoice_number = p_invoice_number,\s+invoice_date = p_invoice_date,\s+updated_at = now\(\)/);
  assert.doesNotMatch(edit, /invoice_prefix/, "editing an invoice never writes the prefix");
});

test("the 0027 verification scripts exist and are safe", () => {
  const structural = code(read(`${VERIFICATION}verify_0027_invoice_prefix.sql`));
  assert.match(structural, /begin transaction read only;/);
  assert.match(structural, /rollback;\s*$/);
  assert.doesNotMatch(structural, /^\s*(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s+(table|function|trigger))/im);
  for (const topic of ["invoice_prefix_enabled", "prefix_enabled", "position('^\\s|\\s$'", "position('[0-9]$'", "has_column_privilege", "to_jsonb(new)", "v_settings.invoice_prefix", "bigint"]) {
    assert.ok(read(`${VERIFICATION}verify_0027_invoice_prefix.sql`).includes(topic), topic);
  }

  const behavior = code(read(`${VERIFICATION}verify_0027_invoice_prefix_behavior.sql`));
  assert.match(behavior, /^\s*begin;/m);
  assert.match(behavior, /\nrollback;/);
  assert.doesNotMatch(behavior, /insert\s+into\s+public\.(students|memberships|invoices)\b/i);
  assert.doesNotMatch(behavior, /delete\s+from\s+public\./i);
  // The only direct writes to invoices are the attempts that must be rejected.
  const invoiceWrites = [...behavior.matchAll(/update public\.invoices set [^;]*/g)].map((m) => m[0]);
  assert.ok(invoiceWrites.length >= 4);
  for (const write of invoiceWrites) assert.match(write, /invoice_prefix/, write);
  // It fingerprints the pre-existing invoices (786 / 787) and checks them at the end.
  assert.match(behavior, /invoice_number in \(786, 787\)/);
  assert.match(behavior, /v_hash0 = v_hash1/);
});

test("the prefix reaches the application only where it belongs: the invoice layer, the Settings code and the Settings screen", () => {
  // Phase 4C (invoice data + formatter) and Phase 4E (the Settings prefix field) supersede the Phase 4A check that
  // the application did not mention the prefix at all. The membership screens still do not: they show it only
  // through the formatter.
  const dirs = ["../../app/memberships/"];
  for (const dir of dirs) {
    const base = new URL(dir, import.meta.url);
    const files = readdirSync(base, { recursive: true }).map(String).filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f));
    for (const file of files) {
      assert.doesNotMatch(readFileSync(new URL(file, base), "utf8"), /invoice_prefix|invoicePrefix/, `${dir}${file}`);
    }
  }

  const invoices = new URL("../invoices/", import.meta.url);
  const mentioning = readdirSync(invoices)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .filter((f) => /invoice_prefix|invoicePrefix/.test(readFileSync(new URL(f, invoices), "utf8")))
    .sort();
  assert.deepEqual(mentioning, ["edit-invoice.js", "invoice-core.js", "invoice-number.js"]);
});

// ==== Migration 0028 - Bank Accounts (database foundation) ============================================

const M28 = read(`${MIGRATIONS}0028_bank_accounts.sql`);
const C28 = code(M28);

function functionOf28(name) {
  const text = lf(M28);
  const start = text.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  return code(text.slice(start, text.indexOf("\n$$;", start) + 4));
}

test("0028 creates bank_accounts with the approved columns and no others", () => {
  const start = C28.indexOf("create table if not exists public.bank_accounts");
  const table = C28.slice(start, C28.indexOf("comment on table", start));
  for (const column of ["id", "bank_name", "account_name", "account_number", "ifsc_code", "branch", "is_active", "created_at", "updated_at"]) {
    assert.match(table, new RegExp(`^\\s+${column}\\s`, "m"), column);
  }
  assert.equal([...table.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|boolean|timestamptz)\b/gm)].length, 9, "exactly nine columns");
  assert.match(table, /id\s+uuid primary key default gen_random_uuid\(\)/);
  assert.match(table, /bank_name\s+text not null/);
  assert.match(table, /account_name\s+text not null/);
  assert.match(table, /account_number\s+text not null/);
  assert.match(table, /ifsc_code\s+text not null/);
  assert.match(table, /branch\s+text,/);
  assert.match(table, /is_active\s+boolean not null default false/);
  assert.match(table, /created_at\s+timestamptz not null default now\(\)/);
  assert.match(table, /updated_at\s+timestamptz not null default now\(\)/);
});

test("0028 validation is light: required values not blank, sensible lengths, branch NULL or real", () => {
  for (const column of ["bank_name", "account_name", "account_number", "ifsc_code"]) {
    assert.match(C28, new RegExp(`length\\(btrim\\(${column}\\)\\) > 0 and length\\(${column}\\) <= \\d+`), column);
  }
  assert.match(C28, /branch is null or \(length\(btrim\(branch\)\) > 0 and length\(branch\) <= 100\)/);
  // No format rules for the account number or IFSC at this layer.
  assert.doesNotMatch(C28, /~\s*'|similar to|\bregexp\b/i);
});

test("at most one active account is a database guarantee (a partial unique index); zero active is valid", () => {
  assert.match(C28, /create unique index if not exists bank_accounts_one_active\s+on public\.bank_accounts \(\(true\)\)\s+where is_active;/);
  // Nothing demands an active account.
  assert.doesNotMatch(C28, /check\s*\([^;]*is_active/i);
  assert.doesNotMatch(C28, /deferrable|exclude using/i);
});

test("a client can never write is_active: INSERT and UPDATE grants are column-level and leave it out", () => {
  assert.match(C28, /revoke all on public\.bank_accounts from anon, authenticated;/);
  assert.match(C28, /grant select on public\.bank_accounts to authenticated;/);
  const insertGrant = C28.match(/grant insert \(([^)]*)\)\s+on public\.bank_accounts to authenticated;/);
  const updateGrant = C28.match(/grant update \(([^)]*)\)\s+on public\.bank_accounts to authenticated;/);
  assert.ok(insertGrant && updateGrant, "column-level grants");
  for (const grant of [insertGrant[1], updateGrant[1]]) {
    assert.deepEqual(grant.split(",").map((c) => c.trim()), ["bank_name", "account_name", "account_number", "ifsc_code", "branch"]);
    assert.doesNotMatch(grant, /is_active|\bid\b|created_at|updated_at/);
  }
  assert.equal((C28.match(/\bgrant\s+(insert|update|select|delete|all|truncate)/gi) ?? []).length, 3, "no other table grant");
});

test("there is no DELETE for anyone: no privilege, no policy, no function", () => {
  assert.doesNotMatch(C28, /grant[^;]*\bdelete\b/i);
  assert.doesNotMatch(C28, /for delete/i);
  assert.doesNotMatch(C28, /create or replace function public\.\w*delete\w*\(/i);
  assert.doesNotMatch(C28, /\bdelete\s+from\b/i);
});

test("RLS: admin-only select, insert and update; nothing for instructors or anon", () => {
  assert.match(C28, /alter table public\.bank_accounts enable row level security;/);
  assert.match(C28, /create policy "bank_accounts_select_admin"[\s\S]*?for select\s+using \(public\.is_admin\(\)\)/);
  assert.match(C28, /create policy "bank_accounts_insert_admin"[\s\S]*?for insert\s+with check \(public\.is_admin\(\)\)/);
  assert.match(C28, /create policy "bank_accounts_update_admin"[\s\S]*?for update\s+using \(public\.is_admin\(\)\)\s+with check \(public\.is_admin\(\)\)/);
  assert.equal((C28.match(/create policy/g) ?? []).length, 3);
  assert.doesNotMatch(C28, /to anon|for all/i);
});

test("activation: admin-only, takes the invoice_settings row lock, deactivates the current account first, then activates", () => {
  const activate = functionOf28("activate_bank_account");
  assert.match(activate, /language plpgsql\s+security definer\s+set search_path = ''/);
  assert.match(activate, /not public\.is_admin\(\)[\s\S]*?errcode = '42501'/);
  // The same lock issue_invoice_core holds.
  assert.match(activate, /perform 1\s+from public\.invoice_settings\s+where singleton\s+for update;/);
  assert.match(lf(M26).replace(/--.*$/gm, ""), /select \* into v_settings\s+from public\.invoice_settings\s+where singleton\s+for update;/);
  assert.match(activate, /perform 1 from public\.bank_accounts where id = p_id for update;/);
  assert.match(activate, /errcode = 'P0002'/);
  const deactivateAt = activate.indexOf("set is_active = false");
  const activateAt = activate.indexOf("set is_active = true");
  assert.ok(deactivateAt > 0 && activateAt > deactivateAt, "deactivate the previous account first");
  assert.match(activate, /where is_active and id <> p_id;/);
  // The admin check comes before anything is read or locked.
  assert.ok(activate.indexOf("is_admin()") < activate.indexOf("invoice_settings"));
});

test("deactivation: admin-only, same lock, only deactivates — never activates another account", () => {
  const deactivate = functionOf28("deactivate_bank_account");
  assert.match(deactivate, /language plpgsql\s+security definer\s+set search_path = ''/);
  assert.match(deactivate, /not public\.is_admin\(\)[\s\S]*?errcode = '42501'/);
  assert.match(deactivate, /perform 1\s+from public\.invoice_settings\s+where singleton\s+for update;/);
  assert.match(deactivate, /set is_active = false\s+where id = p_id and is_active;/);
  assert.doesNotMatch(deactivate, /set is_active = true/);
});

test("the two functions are granted to authenticated only", () => {
  assert.match(C28, /revoke execute on function public\.activate_bank_account\(uuid\) from public, anon;/);
  assert.match(C28, /revoke execute on function public\.deactivate_bank_account\(uuid\) from public, anon;/);
  assert.match(C28, /grant execute on function public\.activate_bank_account\(uuid\) to authenticated;/);
  assert.match(C28, /grant execute on function public\.deactivate_bank_account\(uuid\) to authenticated;/);
});

test("updated_at follows every update through a trigger", () => {
  assert.match(C28, /create trigger bank_accounts_touch_updated_at_trigger\s+before update on public\.bank_accounts/);
  assert.match(functionOf28("bank_accounts_touch_updated_at"), /new\.updated_at := now\(\);/);
});

test("0028 touches no existing invoice and no existing function: the snapshot is a later migration", () => {
  assert.doesNotMatch(C28, /alter table public\.invoices|alter table public\.invoice_settings|create or replace function public\.issue_invoice/i);
  assert.doesNotMatch(C28, /insert\s+into\s+public\.invoices|update\s+public\.invoices|update\s+public\.invoice_settings/i);
  assert.doesNotMatch(C28, /invoice_prefix|tax_|issue_invoice_core/i);
  // Only the new table and its own functions are created or replaced.
  assert.deepEqual(
    [...C28.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort(),
    ["activate_bank_account", "bank_accounts_touch_updated_at", "deactivate_bank_account"]
  );
  // No data is inserted by the migration (no seed, no demo account).
  assert.doesNotMatch(C28, /insert\s+into\b/i);
});

test("the 0028 verification scripts exist and are safe", () => {
  const structural = code(read(`${VERIFICATION}verify_0028_bank_accounts.sql`));
  assert.match(structural, /begin transaction read only;/);
  assert.match(structural, /rollback;\s*$/);
  assert.doesNotMatch(structural, /^\s*(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s+(table|function|trigger))/im);

  const behavior = code(read(`${VERIFICATION}verify_0028_bank_accounts_behavior.sql`));
  assert.match(behavior, /^\s*begin;/m);
  assert.match(behavior, /\nrollback;/);
  assert.doesNotMatch(behavior, /insert\s+into\s+public\.(students|memberships|invoices)\b/i);
  assert.doesNotMatch(behavior, /(update|delete\s+from)\s+public\.(invoices|invoice_settings|memberships|students)\b/i);
  // It fingerprints the existing invoices and checks them at the end.
  assert.match(behavior, /v_hash0 = v_hash1/);
  assert.match(read(`${VERIFICATION}verify_0028_bank_accounts_behavior.sql`), /TWO-SESSION PROCEDURE/);
});

test("outside the Bank Accounts settings section, nothing in the application mentions bank accounts", () => {
  for (const dir of ["../invoices/", "../invoice-settings/", "../../app/settings/", "../../app/memberships/"]) {
    const base = new URL(dir, import.meta.url);
    const files = readdirSync(base, { recursive: true }).map(String).filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f));
    for (const file of files) {
      // The Bank Accounts settings section (and the page that renders it) is the feature built on 0028.
      if (/^\.\.\/\.\.\/app\/settings\/invoice-receipt\/(page|bank-accounts)\.js$/.test(`${dir}${file}`.replaceAll("\\", "/"))) continue;
      // The invoice's own snapshot columns (bank_account_name / bank_account_number) are not the Bank Accounts table.
      const text = readFileSync(new URL(file, base), "utf8").replace(/bank_account_(name|number)/g, "");
      assert.doesNotMatch(text, /bank_account|bankAccount|activate_bank/i, `${dir}${file}`);
    }
  }
});

// ==== Migration 0029 - Invoice bank account snapshot ====================================================

const M29 = read(`${MIGRATIONS}0029_invoice_bank_account_snapshot.sql`);
const C29 = code(M29);

// A function body with comments removed and blank lines collapsed, so two versions compare by their code.
function normalizedFunction(sql, name) {
  return functionOf(sql, name).replace(/\n\s*\n/g, "\n");
}

test("0029 adds five nullable text columns to invoices — no default, no bank_account_id, no foreign key", () => {
  assert.match(
    C29,
    /alter table public\.invoices\s+add column if not exists bank_name\s+text,\s+add column if not exists bank_account_name\s+text,\s+add column if not exists bank_account_number text,\s+add column if not exists bank_ifsc_code\s+text,\s+add column if not exists bank_branch\s+text;/
  );
  assert.doesNotMatch(C29, /bank_(name|account_name|account_number|ifsc_code|branch)\s+text\s+(not null|default)/i);
  assert.doesNotMatch(C29, /bank_account_id|\breferences\b|foreign key/i);
  assert.equal((C29.match(/add column/g) ?? []).length, 5, "exactly five columns");
});

test("the snapshot is coherent: none at all, or the four required details together — with bank_accounts' limits", () => {
  assert.match(C29, /alter table public\.invoices\s+add constraint invoices_bank_snapshot_valid/);
  for (const limit of [
    "length(bank_name) <= 100",
    "length(bank_account_name) <= 100",
    "length(bank_account_number) <= 34",
    "length(bank_ifsc_code) <= 20",
    "length(bank_branch) <= 100",
  ]) {
    assert.ok(C29.includes(limit), limit);
  }
  // The same limits bank_accounts itself has.
  for (const limit of ["length(bank_name) <= 100", "length(account_name) <= 100", "length(account_number) <= 34", "length(ifsc_code) <= 20", "length(branch) <= 100"]) {
    assert.ok(C28.includes(limit), limit);
  }
  assert.match(C29, /bank_name is null and bank_account_name is null\s+and bank_account_number is null and bank_ifsc_code is null\s+and bank_branch is null/);
  assert.match(C29, /bank_branch is null or \(length\(btrim\(bank_branch\)\) > 0 and length\(bank_branch\) <= 100\)/);
  assert.match(C29, /if not exists \(select 1 from pg_constraint where conname = 'invoices_bank_snapshot_valid'\)/);
});

test("0029 does not touch existing invoices: no back-fill, no data statements", () => {
  assert.doesNotMatch(C29, /\bdelete\s+from\b/i);
  assert.doesNotMatch(C29, /\bdrop\s+(table|column|trigger|constraint)\b/i);
  assert.doesNotMatch(C29, /\bupdate\s+public\.invoices\b/i);
  assert.doesNotMatch(C29, /\balter\s+column\b/i);
  // The only insert is the invoice row issue_invoice_core creates; the only update, the counter it advances.
  assert.equal((C29.match(/\binsert\s+into\b/gi) ?? []).length, 1);
  assert.equal((C29.match(/\binsert\s+into public\.invoices\b/g) ?? []).length, 1);
  assert.deepEqual([...C29.matchAll(/\bupdate\s+public\.(\w+)/gi)].map((m) => m[1]), ["invoice_settings"]);
});

test("0029 redefines exactly one function: issue_invoice_core", () => {
  assert.deepEqual([...C29.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]), ["issue_invoice_core"]);
  // The freeze, the edit, issue_invoice, the other triggers, bank_accounts and its functions are not touched.
  for (const untouched of ["invoices_freeze_snapshot", "update_invoice_details", "invoices_validate_dates", "invoices_prevent_delete", "invoice_settings_guard", "activate_bank_account", "deactivate_bank_account", "memberships_auto_issue_invoice"]) {
    assert.doesNotMatch(C29, new RegExp(untouched), untouched);
  }
  assert.doesNotMatch(C29, /function public\.issue_invoice\(/);
  assert.doesNotMatch(C29, /create trigger|drop trigger|create policy|drop policy|\bgrant\b|create table|create unique index|create index/i);
  assert.doesNotMatch(C29, /alter table public\.(bank_accounts|invoice_settings|memberships)/i);
});

test("issue_invoice_core differs from 0027's only by reading and copying the active bank account", () => {
  const before = normalizedFunction(M27, "issue_invoice_core");
  const after = normalizedFunction(M29, "issue_invoice_core");

  const stripped = after
    .replace(/\n {2}v_bank\s+public\.bank_accounts%rowtype;/, "")
    .replace(/\n {2}select \* into v_bank\n {2}from public\.bank_accounts\n {2}where is_active;/, "")
    .replace(/invoice_prefix,\n {4}bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch\n {2}\)/, "invoice_prefix\n  )")
    .replace(/v_settings\.invoice_prefix,\n {4}v_bank\.bank_name, v_bank\.account_name, v_bank\.account_number, v_bank\.ifsc_code, v_bank\.branch\n {2}\)/, "v_settings.invoice_prefix\n  )");
  assert.equal(stripped, before);

  assert.match(after, /select \* into v_bank\s+from public\.bank_accounts\s+where is_active;/);
  assert.match(after, /bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch\s*\)/);
  assert.match(after, /v_bank\.bank_name, v_bank\.account_name, v_bank\.account_number, v_bank\.ifsc_code, v_bank\.branch\s*\)/);
});

test("with no active account the invoice is still issued: a plain SELECT INTO, never STRICT, nothing raises", () => {
  const core = functionOf(M29, "issue_invoice_core");
  assert.doesNotMatch(core, /into strict/i);
  assert.doesNotMatch(core, /raise exception[^;]*bank/i);
  assert.doesNotMatch(core, /if[^;]*v_bank[^;]*then/i, "no branching on the account: NULL fields simply copy as NULL");
});

test("the account is read under the existing invoice_settings lock — no second lock", () => {
  const core = functionOf(M29, "issue_invoice_core");
  const settingsLock = core.search(/from public\.invoice_settings\s+where singleton\s+for update;/);
  const bankRead = core.indexOf("from public.bank_accounts");
  assert.ok(settingsLock > 0 && bankRead > settingsLock, "the account is read after the settings row is locked");
  assert.ok(core.indexOf("from public.memberships") < settingsLock, "lock order: membership, then settings");
  assert.equal((core.match(/for update/g) ?? []).length, 2, "the membership and the settings row — nothing else");
  assert.doesNotMatch(core, /bank_accounts[^;]*for update/i);
  assert.doesNotMatch(core, /pg_advisory|lock table/i);
  // The bank-account functions take that same settings lock (0028).
  assert.match(C28, /perform 1\s+from public\.invoice_settings\s+where singleton\s+for update;/);
});

test("the function keeps its security: definer, empty search_path, executable by no client role", () => {
  assert.match(functionOf(M29, "issue_invoice_core"), /language plpgsql\s+security definer\s+set search_path = ''/);
  assert.match(C29, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
  assert.doesNotMatch(C29, /grant execute/i);
});

test("the freeze protects the snapshot without any change: it compares the whole row", () => {
  const freeze = functionOf(M26, "invoices_freeze_snapshot");
  assert.match(freeze, /to_jsonb\(new\) - 'invoice_number' - 'invoice_date' - 'updated_at'/);
  assert.doesNotMatch(freeze, /bank/i);
  const edit = functionOf(M26, "update_invoice_details");
  assert.match(edit, /set invoice_number = p_invoice_number,\s+invoice_date = p_invoice_date,\s+updated_at = now\(\)/);
  assert.doesNotMatch(edit, /bank/i, "editing an invoice never writes the bank snapshot");
});

test("the 0029 verification scripts exist and are safe", () => {
  const structural = code(read(`${VERIFICATION}verify_0029_invoice_bank_snapshot.sql`));
  assert.match(structural, /begin transaction read only;/);
  assert.match(structural, /rollback;\s*$/);
  assert.doesNotMatch(structural, /^\s*(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s+(table|function|trigger))/im);

  const behaviorText = read(`${VERIFICATION}verify_0029_invoice_bank_snapshot_behavior.sql`);
  const behavior = code(behaviorText);
  assert.match(behavior, /^\s*begin;/m);
  assert.match(behavior, /\nrollback;/);
  assert.doesNotMatch(behavior, /insert\s+into\s+public\.(students|memberships|invoices)\b/i);
  assert.doesNotMatch(behavior, /delete\s+from\s+public\./i);
  // The only direct writes to invoices are attempts that must be rejected, and all touch the snapshot.
  const writes = [...behavior.matchAll(/update public\.invoices set [^;]*/g)].map((m) => m[0]);
  assert.ok(writes.length >= 4);
  for (const write of writes) assert.match(write, /bank_/, write);
  assert.match(behaviorText, /v_hash0 = v_hash1/);
});

test("the snapshot columns are read only by the invoice read and the Invoice Detail — nothing in Settings or the membership UI", () => {
  const allowed = new Set(["../invoices/invoice-core.js", "../invoices/invoice-document.js"]);
  for (const dir of ["../invoices/", "../invoice-settings/", "../../app/settings/", "../../app/memberships/"]) {
    const base = new URL(dir, import.meta.url);
    const files = readdirSync(base, { recursive: true }).map(String).filter((f) => /\.(js|jsx)$/.test(f) && !/\.test\.js$/.test(f));
    for (const file of files) {
      const key = `${dir}${file}`.replaceAll("\\", "/");
      if (allowed.has(key)) continue;
      assert.doesNotMatch(readFileSync(new URL(file, base), "utf8"), /bank_account_number|bank_ifsc_code|bank_branch|bank_account_name|invoices_bank/i, key);
    }
  }
});

// ==== Migration 0030 - membership -> receipt synchronization + receipt-number non-reuse ==============

const M30 = read(`${MIGRATIONS}0030_invoice_membership_sync.sql`);
const C30 = code(M30);

const fn30 = (name) => functionOf(M30, name);
// Application (JavaScript) source with its comments removed.
const jsCode = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("0030 is the next migration and creates only what it needs", () => {
  const files = readdirSync(new URL(MIGRATIONS, import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.indexOf("0030_invoice_membership_sync.sql") - 1], "0029_invoice_bank_account_snapshot.sql");
  assert.deepEqual([...C30.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]), ["invoice_number_reservations"]);
  assert.deepEqual(
    [...C30.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]),
    ["invoices_reserve_number", "issue_invoice_core", "invoices_freeze_snapshot", "sync_invoice_from_membership", "memberships_sync_invoice"]
  );
  assert.deepEqual([...C30.matchAll(/create trigger (\w+)/g)].map((m) => m[1]), ["invoices_reserve_number_trigger", "memberships_sync_invoice_trigger"]);
});

test("0030 changes no existing data and no existing table definition", () => {
  assert.doesNotMatch(C30, /\bdelete\s+from\b/i);
  assert.doesNotMatch(C30, /\bdrop\s+(table|column|constraint|index)\b/i);
  assert.doesNotMatch(C30, /\balter\s+table\s+public\.(invoices|memberships|invoice_settings|bank_accounts)\b/i);
  // The only INSERT outside issue_invoice_core / the reservation trigger is the backfill of the new table.
  const outsideFunctions = C30.replace(/create or replace function[\s\S]*?\n\$\$;/g, "");
  assert.doesNotMatch(outsideFunctions, /\bupdate\s+public\.(memberships|invoice_settings)\b/i, "no existing membership or setting is updated by the migration");
  assert.deepEqual([...outsideFunctions.matchAll(/\binsert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]), ["invoice_number_reservations"]);
  assert.doesNotMatch(outsideFunctions, /\bupdate\s+public\.invoices\b/i, "no existing receipt is updated by the migration");
  assert.match(outsideFunctions, /insert into public\.invoice_number_reservations \(invoice_number, invoice_id\)\s+select invoice_number, id\s+from public\.invoices\s+on conflict \(invoice_number\) do nothing;/);
});

test("the reservation table: a number is the primary key, the receipt is a deferred restrict reference, and clients are shut out", () => {
  assert.match(C30, /create table if not exists public\.invoice_number_reservations \(\s+invoice_number bigint\s+primary key check \(invoice_number > 0\),/);
  assert.match(C30, /invoice_id\s+uuid\s+not null\s+references public\.invoices \(id\) on delete restrict\s+deferrable initially deferred,/);
  assert.match(C30, /reserved_at\s+timestamptz not null default now\(\)/);
  assert.match(C30, /revoke all on public\.invoice_number_reservations from anon, authenticated;/);
  assert.match(C30, /alter table public\.invoice_number_reservations enable row level security;/);
  assert.doesNotMatch(C30, /create policy|grant (select|insert|update|delete)[^;]*invoice_number_reservations/i);
  // Small by design: three columns, no audit system.
  const tableBlock = C30.match(/create table if not exists public\.invoice_number_reservations \(([\s\S]*?)\n\);/)[1];
  assert.equal(tableBlock.split("\n").filter((line) => /^\s{2}\w+\s+(bigint|uuid|timestamptz)\b/.test(line)).length, 3);
});

test("a reserved number is refused to every other receipt, with a race-safe claim", () => {
  const reserve = fn30("invoices_reserve_number");
  assert.match(reserve, /security definer\s+set search_path = ''/);
  assert.match(reserve, /insert into public\.invoice_number_reservations \(invoice_number, invoice_id\)\s+values \(new\.invoice_number, new\.id\)\s+on conflict \(invoice_number\) do nothing;/);
  assert.match(reserve, /get diagnostics v_reserved = row_count;/);
  assert.match(reserve, /if v_reserved = 0 then\s+raise exception 'That invoice number has already been used and cannot be used again\.' using errcode = '23505';\s+end if;/);
  // A number is consumed for good: there is no holder comparison, so the receipt that held it cannot reclaim it.
  assert.doesNotMatch(reserve, /v_holder|invoice_id into|is distinct from new\.id/);
  // The only early exit is an update that keeps the very same number.
  assert.match(reserve, /if tg_op = 'UPDATE' then\s+if new\.invoice_number is not distinct from old\.invoice_number then\s+return new;\s+end if;\s+end if;/);
  assert.equal((reserve.match(/return new;/g) ?? []).length, 2);
  assert.match(C30, /create trigger invoices_reserve_number_trigger\s+before insert or update of invoice_number on public\.invoices\s+for each row/);
  // A new receipt is inserted with its own default id, which the BEFORE trigger sees.
  assert.match(C26, /id\s+uuid primary key default gen_random_uuid\(\)/);
});

test("issue_invoice_core differs from 0029's only in skipping reserved numbers", () => {
  const norm = (text) => text.replace(/\n\s*\n/g, "\n");
  const before = norm(functionOf(read(`${MIGRATIONS}0029_invoice_bank_account_snapshot.sql`), "issue_invoice_core"));
  const after = norm(fn30("issue_invoice_core"));
  const stripped = after.replace(
    "while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)\n     or exists (select 1 from public.invoices where invoice_number = v_candidate) loop",
    "while exists (select 1 from public.invoices where invoice_number = v_candidate) loop"
  );
  assert.equal(stripped, before);
  assert.match(after, /invoice_number_reservations/);
  assert.match(C30, /revoke execute on function public\.issue_invoice_core\(uuid, date\) from public, anon, authenticated;/);
});

test("the freeze is not weakened for arbitrary updates: seven columns, only under the sync marker", () => {
  const freeze = fn30("invoices_freeze_snapshot");
  assert.match(freeze, /v_exempt text\[\] := array\['invoice_number', 'invoice_date', 'updated_at'\];/);
  assert.match(freeze, /if current_setting\('yoga\.invoice_sync', true\) = old\.id::text then\s+v_exempt := v_exempt \|\| array\[\s+'plan', 'description', 'period_start', 'period_end',\s+'total_amount', 'taxable_amount', 'tax_amount'\s+\];\s+end if;/);
  assert.match(freeze, /if \(to_jsonb\(new\) - v_exempt\) is distinct from \(to_jsonb\(old\) - v_exempt\) then\s+raise exception 'An issued invoice can only change its number and date\.' using errcode = '55006';/);
  // Nothing frozen is named in the exempt list.
  for (const frozen of ["business_", "customer_", "bank_", "terms", "signatory", "signature", "tax_enabled", "tax_name", "tax_rate", "currency", "payment_date", "invoice_prefix", "document_title", "membership_id"]) {
    assert.ok(!freeze.includes(frozen), frozen);
  }
});

test("the sync updates exactly the seven columns of the receipt, never the number, prefix or dates, and never issues one", () => {
  const sync = fn30("sync_invoice_from_membership");
  assert.match(sync, /security definer\s+set search_path = ''/);
  assert.match(sync, /select \* into v_inv\s+from public\.invoices\s+where membership_id = p_membership_id\s+for update;\s+if not found then\s+return;\s+end if;/);
  const update = sync.match(/update public\.invoices\s+set([\s\S]*?)where id = v_inv\.id;/)[1];
  assert.deepEqual([...update.matchAll(/(\w+)\s*=/g)].map((m) => m[1]),
    ["plan", "description", "period_start", "period_end", "total_amount", "taxable_amount", "tax_amount", "updated_at"]);
  assert.doesNotMatch(sync, /invoice_number\s*=|invoice_date\s*=|invoice_prefix\s*=|payment_date\s*=|insert into|issue_invoice|next_invoice_number/);
  assert.match(sync, /perform set_config\('yoga\.invoice_sync', v_inv\.id::text, true\);[\s\S]*update public\.invoices[\s\S]*perform set_config\('yoga\.invoice_sync', '', true\);/);
  assert.match(C30, /revoke execute on function public\.sync_invoice_from_membership\(uuid\) from public, anon, authenticated;/);
  assert.doesNotMatch(C30, /grant execute on function public\.sync_invoice_from_membership/i);
});

test("tax is recomputed with the issue formula and the RECEIPT's own stored rate; tax off leaves both NULL", () => {
  const sync = fn30("sync_invoice_from_membership");
  assert.match(sync, /if v_inv\.tax_enabled then\s+v_tax_amount := round\(v_mem\.amount \* v_inv\.tax_rate \/ \(100 \+ v_inv\.tax_rate\), 2\);\s+v_taxable := v_mem\.amount - v_tax_amount;\s+end if;/);
  assert.doesNotMatch(sync, /invoice_settings|v_settings/, "never the current setting");
  // The same formula and wording as issue_invoice_core.
  const core = fn30("issue_invoice_core");
  assert.match(core, /v_tax_amount := round\(v_mem\.amount \* v_settings\.tax_rate \/ \(100 \+ v_settings\.tax_rate\), 2\);/);
  for (const plan of ["'monthly' then 'Monthly'", "'quarterly' then 'Quarterly'", "else 'Custom duration'"]) {
    assert.ok(sync.includes(plan) && core.includes(plan), plan);
  }
  assert.ok(sync.includes("end || ' Membership'") && core.includes("end || ' Membership'"));
  // The CHECK it must satisfy is unchanged.
  assert.match(C26, /taxable_amount \+ tax_amount = total_amount/);
});

test("the membership trigger is AFTER UPDATE OF the four fields, only when one changed, and calls only the sync", () => {
  assert.match(C30, /create trigger memberships_sync_invoice_trigger\s+after update of amount, plan, start_date, end_date on public\.memberships\s+for each row\s+when \(\s+old\.amount\s+is distinct from new\.amount\s+or old\.plan\s+is distinct from new\.plan\s+or old\.start_date is distinct from new\.start_date\s+or old\.end_date\s+is distinct from new\.end_date\s+\)\s+execute function public\.memberships_sync_invoice\(\);/);
  const trigger = fn30("memberships_sync_invoice");
  assert.match(trigger, /security definer\s+set search_path = ''/);
  assert.match(trigger, /perform public\.sync_invoice_from_membership\(new\.id\);\s+return null;/);
  // It is not on payment_status, so it can never issue anything; issuing stays the auto-issue trigger's alone.
  assert.doesNotMatch(C30, /after (insert or )?update of payment_status/);
  assert.doesNotMatch(trigger, /issue_invoice/);
});

test("no recursion: the receipt triggers never write memberships", () => {
  for (const name of ["invoices_validate_dates", "invoices_prevent_delete"]) {
    assert.doesNotMatch(functionOf(M26, name), /memberships/, name);
  }
  assert.doesNotMatch(fn30("invoices_reserve_number"), /public\.memberships/);
  assert.doesNotMatch(fn30("invoices_freeze_snapshot"), /public\.memberships/);
  assert.doesNotMatch(functionOf(M26, "invoices_validate_dates"), /update public\.memberships/);
});

test("0030 leaves the other invoice and membership machinery alone", () => {
  for (const untouched of ["update_invoice_details", "issue_invoice(", "memberships_invoice_guard", "memberships_auto_issue_invoice", "memberships_payment_rules", "invoices_validate_dates", "invoices_prevent_delete", "invoice_settings_guard", "activate_bank_account", "deactivate_bank_account"]) {
    assert.doesNotMatch(C30, new RegExp(`function public\\.${untouched.replace("(", "\\(")}`), untouched);
  }
  assert.doesNotMatch(C30, /create policy|drop policy|\bgrant\b/i);
});

test("the Paid -> Pending and payment-date protections are still the 0026 guard's, unchanged", () => {
  const guard = functionOf(M26, "memberships_invoice_guard");
  assert.match(guard, /The payment status cannot be changed after an invoice has been issued\./);
  assert.match(guard, /The payment date cannot be changed after an invoice has been issued\./);
  assert.doesNotMatch(guard, /amount|plan|start_date|end_date/, "the guard never locked the fields that now follow the membership");
});

test("the 0030 verification scripts exist and are safe", () => {
  const structural = code(read(`${VERIFICATION}verify_0030_invoice_membership_sync.sql`));
  assert.match(structural, /begin transaction read only;/);
  assert.match(structural, /rollback;\s*$/);
  assert.doesNotMatch(structural, /^\s*(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s+(table|function|trigger))/im);

  const behavior = code(read(`${VERIFICATION}verify_0030_invoice_membership_sync_behavior.sql`));
  assert.match(behavior, /^\s*begin;/m);
  assert.match(behavior, /\nrollback;/);
  // It is self-contained: its own disposable student and three memberships (all ZZVERIFY, all rolled back).
  // It never inserts a receipt directly - receipts are issued by marking a fixture membership Paid.
  assert.deepEqual([...behavior.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((m) => m[1]), ["students", "memberships", "memberships", "memberships"]);
  assert.doesNotMatch(behavior, /insert\s+into\s+public\.invoices\b/i);
  assert.match(behavior, /'ZZVERIFY Sync Student'/);
  assert.match(behavior, /exception when others then\s+v_pend := null;/, "a fixture failure is reported, not raised");
  assert.doesNotMatch(behavior, /delete\s+from\s+public\./i);
  // No real membership is edited: every membership statement targets the script's own fixture ids.
  assert.doesNotMatch(behavior, /update public\.memberships[^;]*\bwhere\b(?![^;]*(%L|v_student))/i);
  assert.match(behavior, /Z1 every pre-existing receipt is byte-for-byte unchanged/);
  // The post-rollback check (in a comment, so read from the raw file) counts any leftover fixtures.
  assert.match(read(`${VERIFICATION}verify_0030_invoice_membership_sync_behavior.sql`), /leftover_fixture_students[\s\S]*leftover_fixture_memberships/);
  for (const scenario of ["A3", "B1", "C1", "F1", "G3", "T2", "N5", "N6", "N8"]) assert.ok(behavior.includes(`'${scenario} `), scenario);
});

test("the app maps the new database message to the number field, in plain words", () => {
  const core = jsCode("./invoice-core.js");
  assert.match(core, /\["23505", \/\^That invoice number has already been used and cannot be used again\\\.\$\/, "invoice_number", "That number has already been used and cannot be used again\."\]/);
  assert.match(core, /\["23505", \/invoice_number_reservations\/, "invoice_number", "That number has already been used and cannot be used again\."\]/);
  // The wording the databases raises is not shown raw.
  assert.doesNotMatch(core, /"That invoice number has already been used and cannot be used again\.",\s*\]/);
});

test("the wording no longer says the document is frozen as issued", () => {
  const texts = ["../../app/memberships/[id]/invoice/page.js", "../../app/memberships/[id]/invoice-panel.js", "../../app/memberships/[id]/invoice/edit-invoice.js"].map((f) => jsCode(f)).join("\n");
  assert.doesNotMatch(texts, /as it was issued|stays as it was issued|The stored document/);
  assert.match(jsCode("../../app/memberships/[id]/invoice/page.js"), /description="The receipt follows the membership details\. Receipt number remains assigned to this membership\."/);
  assert.match(jsCode("../../app/memberships/[id]/invoice-panel.js"), /description="The receipt follows the membership details\. Its number stays assigned to this membership\."/);
  assert.match(jsCode("../../app/memberships/[id]/invoice/edit-invoice.js"), /The amount, plan and dates follow the membership; the number stays assigned to it\./);
});

test("the application issues nothing on a membership edit: updateMembership still only updates", () => {
  const actions = jsCode("../memberships/actions.js");
  assert.doesNotMatch(actions, /issueInvoice|issue_invoice|sync_invoice|update_invoice_details/);
  assert.match(actions, /const \{ error \} = await supabase\.from\("memberships"\)\.update\(result\.data\)\.eq\("id", id\);/);
});
