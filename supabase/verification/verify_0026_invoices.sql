-- ===========================================================================
-- Migration 0026 structural verification
-- Verifies supabase/migrations/0026_invoices.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0025 and 0026. STRICTLY
-- READ-ONLY: one SELECT over system catalogs and existing rows, inside a
-- read-only transaction. Companion to verify_0026_invoices_behavior.sql, which
-- actually exercises numbering, snapshots and the guards (and rolls back).
--
-- OUTPUT: seq / check_name / status / detail, ordered by seq. Statuses: PASS,
-- FAIL, INFO (a readout, never an assertion). Every PASS/FAIL row should be PASS.
-- ===========================================================================

begin transaction read only;

with
fn as (
  select p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def, p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
checks as (
  -- ---- table shape --------------------------------------------------------
  select 1 as seq, 'invoices exists with exactly the approved columns' as check_name,
    (
      select count(*) = 33 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices'
        and column_name in (
          'id', 'membership_id', 'invoice_number', 'invoice_date', 'payment_date',
          'document_title', 'description', 'plan', 'period_start', 'period_end',
          'currency', 'total_amount',
          'tax_enabled', 'tax_name', 'tax_rate', 'taxable_amount', 'tax_amount',
          'customer_name', 'customer_code', 'customer_phone', 'customer_phone_country_code', 'customer_email',
          'business_name', 'business_address', 'business_phone', 'business_email', 'business_logo_path',
          'terms', 'signatory_name', 'signatory_designation', 'signature_path',
          'created_at', 'updated_at'
        )
    )
    and (select count(*) = 33 from information_schema.columns where table_schema = 'public' and table_name = 'invoices') as ok,
    '' as detail
  union all
  select 2, 'invoices has no status / void / issued_by / payment / refund / credit-note column',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices'
        and (column_name in ('status', 'voided_at', 'issued_by', 'cancelled_at', 'payment_method', 'payment_id')
             or column_name like '%refund%' or column_name like '%credit%' or column_name like '%partial%')
    ), ''
  union all
  select 3, 'no invoice_items table (one membership line per invoice, kept on invoices)',
    not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('invoice_items', 'receipt_items')), ''
  union all
  select 4, 'id is uuid default gen_random_uuid(); invoice_number is bigint; money is numeric(10,2); tax_rate numeric(5,2)',
    (
      select bool_and(ok) from (
        select format_type(atttypid, atttypmod) = 'uuid' as ok from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'id'
        union all select format_type(atttypid, atttypmod) = 'bigint' from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'invoice_number'
        union all select format_type(atttypid, atttypmod) = 'numeric(10,2)' from pg_attribute where attrelid = 'public.invoices'::regclass and attname in ('total_amount', 'taxable_amount', 'tax_amount')
        union all select format_type(atttypid, atttypmod) = 'numeric(5,2)' from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'tax_rate'
        union all select pg_get_expr(d.adbin, d.adrelid) like '%gen_random_uuid()%'
          from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
          where d.adrelid = 'public.invoices'::regclass and a.attname = 'id'
      ) s
    ), ''
  union all
  select 5, 'invoice_number, invoice_date, payment_date, membership_id are NOT NULL',
    (
      select count(*) = 4 from pg_attribute
      where attrelid = 'public.invoices'::regclass and attname in ('invoice_number', 'invoice_date', 'payment_date', 'membership_id')
        and attnotnull
    ), ''
  -- ---- relationship and uniqueness -----------------------------------------
  union all
  select 6, 'invoices.membership_id -> memberships(id) ON DELETE RESTRICT',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and contype = 'f'
        and confrelid = 'public.memberships'::regclass and confdeltype = 'r'
    ), ''
  union all
  select 7, 'the only foreign key is to memberships (no live link to students, center_profile or invoice_settings)',
    (select count(*) = 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'f'), ''
  union all
  select 8, 'UNIQUE on membership_id (Membership 1 : 0..1 Invoice)',
    exists (
      select 1 from pg_index i
      where i.indrelid = 'public.invoices'::regclass and i.indisunique and i.indnatts = 1
        and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'membership_id'
    ), ''
  union all
  select 9, 'UNIQUE on invoice_number',
    exists (
      select 1 from pg_index i
      where i.indrelid = 'public.invoices'::regclass and i.indisunique and i.indnatts = 1
        and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'invoice_number'
    ), ''
  -- ---- constraints -----------------------------------------------------------
  union all
  select 10, 'CHECK invoice_number > 0',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%invoice_number > 0%'
    ), ''
  union all
  select 11, 'CHECK invoice_date >= payment_date',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and conname = 'invoices_invoice_date_not_before_payment_date'
        and pg_get_constraintdef(oid) like '%invoice_date >= payment_date%'
    ), ''
  union all
  select 12, 'CHECK period_end >= period_start; total_amount > 0; currency format; document_title; plan',
    exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_period_end_after_start')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'total_amount > \(?0\)?')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%currency%A-Z%')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%document_title%invoice%receipt%')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%plan%monthly%quarterly%custom%'), ''
  union all
  select 13, 'tax consistency CHECK: disabled = all NULL; enabled = complete, 0 < rate < 100, taxable + tax = total',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.invoices'::regclass and conname = 'invoices_tax_consistent'
        and pg_get_constraintdef(oid) like '%tax_enabled = false%'
        and pg_get_constraintdef(oid) ~ 'tax_rate > \(?0\)?'
        and pg_get_constraintdef(oid) ~ 'tax_rate < \(?100\)?'
        and pg_get_constraintdef(oid) like '%taxable_amount + tax_amount) = total_amount%'
    ), ''
  -- ---- RLS and grants --------------------------------------------------------
  union all
  select 14, 'row level security is enabled on invoices',
    (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass), ''
  union all
  select 15, 'invoices has exactly one policy: admin-only SELECT',
    (
      select count(*) = 1 and count(*) filter (where cmd = 'SELECT' and qual like '%is_admin()%') = 1
      from pg_policies where schemaname = 'public' and tablename = 'invoices'
    ), ''
  union all
  select 16, 'authenticated has SELECT only on invoices (no INSERT / UPDATE / DELETE / TRUNCATE); anon nothing',
    has_table_privilege('authenticated', 'public.invoices', 'SELECT')
      and not has_table_privilege('authenticated', 'public.invoices', 'INSERT')
      and not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.invoices', 'DELETE')
      and not has_table_privilege('authenticated', 'public.invoices', 'TRUNCATE')
      and not has_table_privilege('anon', 'public.invoices', 'SELECT')
      and not has_table_privilege('anon', 'public.invoices', 'INSERT')
      and not has_column_privilege('authenticated', 'public.invoices', 'invoice_number', 'UPDATE'), ''
  -- ---- functions ----------------------------------------------------------------
  union all
  select 17, 'every new function is security definer with an empty search_path',
    (
      select count(*) = 10 and bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""'))
      from fn
      where proname in (
        'issue_invoice_core', 'issue_invoice', 'update_invoice_details',
        'memberships_auto_issue_invoice', 'memberships_invoice_guard',
        'invoices_validate_dates', 'invoices_freeze_snapshot', 'invoices_prevent_delete',
        'invoice_settings_guard', 'memberships_payment_rules'
      )
    ), ''
  union all
  select 18, 'issue_invoice and update_invoice_details: authenticated may execute, anon may not',
    (
      select count(*) = 2 and bool_and(
        has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname in ('issue_invoice', 'update_invoice_details')
    ), ''
  union all
  select 19, 'issue_invoice_core is internal: neither authenticated nor anon may execute it',
    (
      select count(*) = 1 and bool_and(
        not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 20, 'both client functions check is_admin()',
    (
      select count(*) = 2 and bool_and(def like '%public.is_admin()%' and def like '%42501%')
      from fn where proname in ('issue_invoice', 'update_invoice_details')
    ), ''
  -- ---- numbering ------------------------------------------------------------------
  union all
  select 21, 'numbering locks the settings row FOR UPDATE and skips used numbers',
    (
      select def like '%from public.invoice_settings%where singleton%for update%'
         and def like '%while exists (select 1 from public.invoices where invoice_number = v_candidate)%'
         and def like '%next_invoice_number = v_candidate + 1%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 22, 'numbering does not use MAX() or a sequence',
    (select def not ilike '%max(%' and def not ilike '%nextval%' from fn where proname = 'issue_invoice_core')
      and not exists (select 1 from pg_class where relkind = 'S' and relname ilike '%invoice%'), ''
  union all
  select 23, 'tax is back-calculated: round(total * rate / (100 + rate), 2); taxable = total - tax',
    (
      select def like '%round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2)%'
         and def like '%v_taxable := v_mem.amount - v_tax_amount%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 24, 'the snapshot is copied from membership, student, center_profile and invoice_settings',
    (
      select def like '%from public.students%' and def like '%from public.center_profile%'
         and def like '%v_settings.terms%' and def like '%v_settings.signature_path%'
         and def like '%v_mem.amount%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  -- ---- triggers ---------------------------------------------------------------------
  union all
  select 25, 'invoices triggers: validate dates (BEFORE I/U), freeze snapshot (BEFORE U), prevent delete (BEFORE D)',
    (
      select count(*) = 3
        and count(*) filter (where tgname = 'invoices_validate_dates_trigger' and (tgtype & 2) = 2 and (tgtype & 4) = 4 and (tgtype & 16) = 16) = 1
        and count(*) filter (where tgname = 'invoices_freeze_snapshot_trigger' and (tgtype & 2) = 2 and (tgtype & 16) = 16) = 1
        and count(*) filter (where tgname = 'invoices_prevent_delete_trigger' and (tgtype & 2) = 2 and (tgtype & 8) = 8) = 1
      from pg_trigger where tgrelid = 'public.invoices'::regclass and not tgisinternal
    ), ''
  union all
  select 26, 'snapshot protection allows only invoice_number, invoice_date, updated_at to change',
    (
      select def like '%- ''invoice_number'' - ''invoice_date'' - ''updated_at''%' and def like '%55006%'
      from fn where proname = 'invoices_freeze_snapshot'
    ), ''
  union all
  select 27, 'memberships: invoice guard (BEFORE UPDATE) and auto-issue (AFTER INSERT/UPDATE) triggers exist',
    exists (select 1 from pg_trigger where tgrelid = 'public.memberships'::regclass and tgname = 'memberships_invoice_guard_trigger' and (tgtype & 2) = 2 and (tgtype & 16) = 16)
    and exists (select 1 from pg_trigger where tgrelid = 'public.memberships'::regclass and tgname = 'memberships_auto_issue_invoice_trigger' and (tgtype & 2) = 0 and (tgtype & 4) = 4 and (tgtype & 16) = 16), ''
  union all
  select 28, 'Paid -> Pending and payment_date changes are rejected once an invoice exists',
    (
      select def like '%from public.invoices where membership_id = old.id%'
         and def like '%old.payment_status = ''paid'' and new.payment_status is distinct from ''paid''%'
         and def like '%new.payment_date is distinct from old.payment_date%'
         and def like '%55006%'
      from fn where proname = 'memberships_invoice_guard'
    ), ''
  union all
  select 29, 'the invoice guard fires before the payment rules trigger (sorts first)',
    'memberships_invoice_guard_trigger' < 'memberships_payment_rules_trigger', ''
  union all
  select 30, 'auto-issue only when the membership BECOMES Paid, no invoice exists and numbering is configured',
    (
      select def like '%old.payment_status is distinct from ''paid''%'
         and def like '%not exists (select 1 from public.invoices where membership_id = new.id)%'
         and def like '%v_start is not null%'
      from fn where proname = 'memberships_auto_issue_invoice'
    ), ''
  union all
  select 31, 'starting-number lock: invoice_settings_guard trigger rejects a change once an invoice exists',
    exists (select 1 from pg_trigger where tgrelid = 'public.invoice_settings'::regclass and tgname = 'invoice_settings_guard_trigger' and (tgtype & 2) = 2 and (tgtype & 16) = 16)
    and (select def like '%exists (select 1 from public.invoices)%' and def like '%55006%' from fn where proname = 'invoice_settings_guard'), ''
  union all
  select 32, 'manual edit rules: positive, unique, not below the starting number, dates validated',
    (
      select def like '%p_invoice_number <= 0%'
         and def like '%p_invoice_number < v_settings.starting_invoice_number%'
         and def like '%invoice_number = p_invoice_number and id <> p_invoice_id%'
         and def like '%p_invoice_date < v_invoice.payment_date%'
         and def like '%p_invoice_date > v_today%'
      from fn where proname = 'update_invoice_details'
    ), ''
  union all
  select 33, 'manual Issue Invoice requires / confirms the payment date and never overwrites an existing one',
    (
      select def like '%Confirm the payment date%'
         and def like '%v_mem.payment_date is null%'
         and def like '%This membership already has a payment date%'
      from fn where proname = 'issue_invoice'
    ), ''
  -- ---- storage ---------------------------------------------------------------------------
  union all
  select 34, 'invoice-assets bucket exists, is private, 2 MB, png/jpeg/webp',
    exists (
      select 1 from storage.buckets
      where id = 'invoice-assets' and public = false and file_size_limit = 2097152
        and allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp']
    ), ''
  union all
  select 35, 'invoice-assets: admin SELECT and INSERT policies; NO update or delete policy',
    exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'invoice_assets_select_admin' and cmd = 'SELECT')
    and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'invoice_assets_insert_admin' and cmd = 'INSERT')
    and not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')
        and (coalesce(qual, '') like '%invoice-assets%' or coalesce(with_check, '') like '%invoice-assets%')
    ), ''
  union all
  select 36, 'profile-photos: the delete policy no longer allows deleting the centre logo folder',
    exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = 'profile_photos_delete_admin'
        and cmd = 'DELETE' and qual like '%foldername%' and qual like '%center%'
    ), ''
  union all
  select 37, 'profile-photos: insert / select / update policies are unchanged',
    (
      select count(*) = 3 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('profile_photos_select_admin', 'profile_photos_insert_admin', 'profile_photos_update_admin')
    ), ''
  -- ---- existing-data compatibility ---------------------------------------------------------------
  union all
  select 38, 'every invoice agrees with its membership: same payment_date, Paid status',
    not exists (
      select 1 from public.invoices i join public.memberships m on m.id = i.membership_id
      where m.payment_status <> 'paid' or m.payment_date is distinct from i.payment_date
    ), ''
  union all
  select 39, 'no invoice number is below the configured starting number',
    not exists (
      select 1 from public.invoices i, public.invoice_settings s
      where s.starting_invoice_number is not null and i.invoice_number < s.starting_invoice_number
    ), ''
  union all
  select 40, 'no membership has more than one invoice',
    not exists (select 1 from public.invoices group by membership_id having count(*) > 1), ''
  union all
  select 41, 'invoice_number values are unique',
    not exists (select 1 from public.invoices group by invoice_number having count(*) > 1), ''
  union all
  select 42, 'memberships and the other V1 tables still exist untouched',
    (
      select count(*) = 8 from information_schema.tables
      where table_schema = 'public'
        and table_name in ('students', 'memberships', 'batches', 'batch_enrollments', 'schedules',
                           'class_sessions', 'attendance', 'center_profile')
    ), ''
  union all
  select 43, 'INFO: invoices issued so far / next number / starting number',
    true,
    (select count(*) from public.invoices) || ' invoices; next = '
      || coalesce((select next_invoice_number::text from public.invoice_settings), 'n/a')
      || '; starting = ' || coalesce((select starting_invoice_number::text from public.invoice_settings), 'not configured')
)
select seq, check_name,
  case when check_name like 'INFO:%' then 'INFO' when ok then 'PASS' else 'FAIL' end as status,
  detail
from checks
union all
select 99, 'SUMMARY', case when bool_and(ok) then 'PASS' else 'FAIL' end,
  count(*) filter (where ok) || ' of ' || count(*) || ' checks passed'
from checks
order by seq;

rollback;
