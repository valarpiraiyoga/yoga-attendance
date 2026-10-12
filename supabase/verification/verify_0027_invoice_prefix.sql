-- ===========================================================================
-- Migration 0027 structural verification
-- Verifies supabase/migrations/0027_invoice_prefix.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0027. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0027_invoice_prefix_behavior.sql, which actually issues
-- invoices with different prefixes (and rolls back).
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
  -- ---- columns ------------------------------------------------------------
  select 1 as seq, 'invoice_settings.invoice_prefix exists: text, nullable, no default' as check_name,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_settings' and column_name = 'invoice_prefix'
        and data_type = 'text' and is_nullable = 'YES' and column_default is null
    ) as ok, '' as detail
  union all
  select 2, 'invoices.invoice_prefix exists: text, nullable, no default',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_prefix'
        and data_type = 'text' and is_nullable = 'YES' and column_default is null
    ), ''
  union all
  select 3, 'there is no invoice_prefix_enabled column: prefix OFF is NULL',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and column_name like '%prefix_enabled%'
    ), ''
  -- ---- constraints --------------------------------------------------------
  union all
  select 4, 'both tables have the prefix constraint',
    exists (select 1 from pg_constraint where conrelid = 'public.invoice_settings'::regclass and conname = 'invoice_settings_invoice_prefix_valid' and contype = 'c')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_invoice_prefix_valid' and contype = 'c'), ''
  union all
  select 5, 'the rule: NULL, or 1-20 characters (so an empty string is refused)',
    (
      select count(*) = 2 and bool_and(
        position('IS NULL' in pg_get_constraintdef(oid)) > 0
        and position('>= 1' in pg_get_constraintdef(oid)) > 0
        and position('<= 20' in pg_get_constraintdef(oid)) > 0)
      from pg_constraint
      where conname in ('invoice_settings_invoice_prefix_valid', 'invoices_invoice_prefix_valid')
    ), ''
  union all
  select 6, 'the rule: no leading or trailing whitespace',
    (
      select count(*) = 2 and bool_and(position('^\s|\s$' in pg_get_constraintdef(oid)) > 0)
      from pg_constraint
      where conname in ('invoice_settings_invoice_prefix_valid', 'invoices_invoice_prefix_valid')
    ), ''
  union all
  select 7, 'the rule: not ending in a digit',
    (
      select count(*) = 2 and bool_and(position('[0-9]$' in pg_get_constraintdef(oid)) > 0)
      from pg_constraint
      where conname in ('invoice_settings_invoice_prefix_valid', 'invoices_invoice_prefix_valid')
    ), ''
  -- ---- grants -------------------------------------------------------------
  union all
  select 8, 'authenticated may UPDATE invoice_settings.invoice_prefix (and the other settings columns)',
    has_column_privilege('authenticated', 'public.invoice_settings', 'invoice_prefix', 'UPDATE')
      and has_column_privilege('authenticated', 'public.invoice_settings', 'starting_invoice_number', 'UPDATE')
      and has_column_privilege('authenticated', 'public.invoice_settings', 'terms', 'UPDATE'), ''
  union all
  select 9, 'next_invoice_number is still not writable by a client; no table-level UPDATE; anon nothing',
    not has_column_privilege('authenticated', 'public.invoice_settings', 'next_invoice_number', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.invoice_settings', 'UPDATE')
      and not has_column_privilege('anon', 'public.invoice_settings', 'invoice_prefix', 'UPDATE'), ''
  union all
  select 10, 'invoices stays SELECT-only for clients (the snapshot prefix cannot be written directly)',
    has_table_privilege('authenticated', 'public.invoices', 'SELECT')
      and not has_table_privilege('authenticated', 'public.invoices', 'INSERT')
      and not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.invoices', 'DELETE')
      and not has_column_privilege('authenticated', 'public.invoices', 'invoice_prefix', 'UPDATE'), ''
  -- ---- issuing ------------------------------------------------------------
  union all
  select 11, 'issue_invoice_core copies the prefix from the locked settings row into invoices',
    (
      select def like '%terms, signatory_name, signatory_designation, signature_path,%invoice_prefix%)%values%'
         and def like '%v_settings.invoice_prefix%'
         and def like '%from public.invoice_settings%where singleton%for update%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 12, 'the counter logic is intact: counter row, skip reserved and held invoice-series numbers, advance in the same transaction',
    (
      -- Current definition (0030 reservations, 0036 series): the loop skips a number that is RESERVED (ever assigned) or held
      -- by an invoice-series document; payment receipts are a separate series with their own counter and are not skipped here.
      select def like '%coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number)%'
         and def like '%while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)%'
         and def like '%or exists (select 1 from public.invoices where invoice_number = v_candidate and document_series = ''invoice'') loop%'
         and def like '%v_candidate := v_candidate + 1;%'
         and def like '%next_invoice_number = v_candidate + 1%'
         and def not ilike '%max(%' and def not ilike '%nextval%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 13, 'the tax calculation is intact',
    (
      select def like '%round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2)%'
         and def like '%v_taxable := v_mem.amount - v_tax_amount%'
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 14, 'the date rules and lock order are intact',
    (
      select def like '%v_invoice_date < v_mem.payment_date%'
         and def like '%v_invoice_date > v_today%'
         and position('from public.memberships' in def) < position('from public.invoice_settings' in def)
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 15, 'issue_invoice_core is still security definer, empty search_path, and executable by no client role',
    (
      select count(*) = 1 and bool_and(
        prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
        and not has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname = 'issue_invoice_core'
    ), ''
  union all
  select 16, 'issue_invoice and update_invoice_details exist, are admin-only and do not mention the prefix (unchanged)',
    (
      select count(*) = 2 and bool_and(
        def like '%public.is_admin()%' and def not like '%invoice_prefix%'
        and has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute'))
      from fn where proname in ('issue_invoice', 'update_invoice_details')
    ), ''
  union all
  select 17, 'update_invoice_details writes only number, date and updated_at (so the prefix cannot change through an edit)',
    (
      select def like '%set invoice_number = p_invoice_number,%invoice_date = p_invoice_date,%updated_at = now()%'
      from fn where proname = 'update_invoice_details'
    ), ''
  -- ---- snapshot protection -------------------------------------------------
  union all
  select 18, 'the freeze trigger compares the whole row less an exemption list that starts with number, date and updated_at and never includes the prefix',
    (
      -- Current definition (0037, built on 0026/0030/0033): the list starts as number, date and updated_at; it grows only
      -- while the synchronization (yoga.invoice_sync) or the cancellation (yoga.invoice_cancel) marker names THIS invoice;
      -- a cancelled document is final; every other change is refused with 55006. The prefix is in no list.
      select def like '%v_exempt text[] := array[''invoice_number'', ''invoice_date'', ''updated_at''];%'
         and def like '%(to_jsonb(new) - v_exempt) is distinct from (to_jsonb(old) - v_exempt)%'
         and def like '%current_setting(''yoga.invoice_sync'', true) = old.id::text%'
         and def like '%''plan'', ''description'', ''period_start'', ''period_end'',%'
         and def like '%current_setting(''yoga.invoice_cancel'', true) = old.id::text%'
         and def like '%''status'', ''cancelled_at'', ''cancelled_by'', ''cancellation_reason''%'
         and def like '%A cancelled document cannot be changed.%'
         and def not like '%invoice_prefix%'
         and def like '%55006%'
      from fn where proname = 'invoices_freeze_snapshot'
    )
    and exists (select 1 from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'invoices_freeze_snapshot_trigger' and (tgtype & 2) = 2 and (tgtype & 16) = 16), ''
  union all
  select 19, 'the settings guard notices a prefix change but does not lock it; each series'' starting-number lock is intact',
    (
      -- Current definition (0041, built on 0027/0036): the prefix is in the compared tuple (updated_at moves) and nowhere
      -- raised on, so it stays editable. The starting number is locked once a document of ITS OWN series exists.
      select def like '%new.invoice_prefix%' and def like '%old.invoice_prefix%'
         and def like '%if new.starting_invoice_number is distinct from old.starting_invoice_number then%'
         and def like '%exists (select 1 from public.invoices where document_series = ''invoice'')%'
         and def like '%The starting invoice number cannot be changed once an invoice has been issued.%'
         and def like '%if new.payment_receipt_starting_number is distinct from old.payment_receipt_starting_number then%'
         and def like '%exists (select 1 from public.invoices where document_series = ''payment_receipt'')%'
         and def like '%The starting payment receipt number cannot be changed once a payment receipt has been issued.%'
         and def not ilike '%prefix cannot%'
      from fn where proname = 'invoice_settings_guard'
    ), ''
  -- ---- what did not change -------------------------------------------------
  union all
  select 20, 'invoice_number is still bigint, NOT NULL, with its unique index; no unique index involves the prefix',
    exists (select 1 from pg_attribute where attrelid = 'public.invoices'::regclass and attname = 'invoice_number' and format_type(atttypid, atttypmod) = 'bigint' and attnotnull)
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'invoices' and indexname = 'invoices_invoice_number_unique')
    and not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'invoices' and indexdef ilike '%invoice_prefix%'), ''
  union all
  select 21, 'invoices has every intended column (the 33 of 0026, invoice_prefix, bank snapshot, service details, payment documents, cancellation, GSTIN) and no void / issuer / payment-method column',
    not exists (
      select 1
      from unnest(array[
        -- 0026
        'id', 'membership_id', 'invoice_number', 'invoice_date', 'payment_date', 'document_title', 'description', 'plan',
        'period_start', 'period_end', 'currency', 'total_amount', 'tax_enabled', 'tax_name', 'tax_rate', 'taxable_amount',
        'tax_amount', 'customer_name', 'customer_code', 'customer_phone', 'customer_phone_country_code', 'customer_email',
        'business_name', 'business_address', 'business_phone', 'business_email', 'business_logo_path', 'terms',
        'signatory_name', 'signatory_designation', 'signature_path', 'created_at', 'updated_at',
        -- 0027 prefix; 0029 bank account snapshot; 0033 service details
        'invoice_prefix', 'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc_code', 'bank_branch',
        'service_details', 'service_details_tracked',
        -- 0036 payment documents; 0037 cancellation and replacement; 0041 GSTIN
        'payment_id', 'document_series', 'status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'replaces_id',
        'business_gstin'
      ]) as e(col)
      where not exists (
        select 1 from information_schema.columns k
        where k.table_schema = 'public' and k.table_name = 'invoices' and k.column_name = e.col)
    )
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices'
        and column_name in ('voided_at', 'issued_by', 'payment_method')
    ),
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'invoices') || ' columns found; 49 expected'
  union all
  select 22, 'invoice_settings has every intended column (the 12 of 0026, invoice_prefix, the payment-receipt numbering fields, GSTIN)',
    not exists (
      select 1
      from unnest(array[
        -- 0025/0026
        'singleton', 'starting_invoice_number', 'next_invoice_number', 'document_title', 'tax_enabled', 'tax_name', 'tax_rate',
        'terms', 'signatory_name', 'signatory_designation', 'signature_path', 'updated_at',
        -- 0027 prefix; 0036 payment receipt series; 0041 GSTIN
        'invoice_prefix', 'payment_receipt_starting_number', 'payment_receipt_next_number', 'payment_receipt_prefix', 'gstin'
      ]) as e(col)
      where not exists (
        select 1 from information_schema.columns k
        where k.table_schema = 'public' and k.table_name = 'invoice_settings' and k.column_name = e.col)
    ),
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'invoice_settings') || ' columns found; 17 expected'
  union all
  select 23, 'memberships gained no prefix column',
    not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name like '%prefix%'), ''
  union all
  select 24, 'the other invoice triggers are intact (validate dates, prevent delete, settings guard)',
    (
      select count(*) = 3 from pg_trigger
      where not tgisinternal and tgname in ('invoices_validate_dates_trigger', 'invoices_prevent_delete_trigger', 'invoice_settings_guard_trigger')
    ), ''
  union all
  select 25, 'no invoice has a prefix that breaks the rule',
    not exists (
      select 1 from public.invoices
      where invoice_prefix is not null
        and not (length(invoice_prefix) between 1 and 20 and invoice_prefix !~ '^\s|\s$' and invoice_prefix !~ '[0-9]$')
    ), ''
  union all
  select 26, 'INFO: invoices / invoices with a prefix / the current setting',
    true,
    (select count(*) from public.invoices) || ' invoices; '
      || (select count(*) from public.invoices where invoice_prefix is not null) || ' with a prefix; setting = '
      || coalesce((select '"' || invoice_prefix || '"' from public.invoice_settings where invoice_prefix is not null), 'none (prefix off)')
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
