-- ===========================================================================
-- Migration 0055 structural verification
-- Verifies supabase/migrations/0055_payment_document_cancel_and_correction.sql
-- ===========================================================================
--
-- Run in the Supabase SQL editor AFTER applying 0055. STRICTLY READ-ONLY: one
-- SELECT over system catalogs and existing rows, inside a read-only transaction.
-- Companion to verify_0055_payment_document_cancel_and_correction_behavior.sql,
-- which cancels and corrects disposable documents for real (and rolls back).
--
-- OUTPUT: seq / check_name / status / detail, ordered by seq. Statuses: PASS,
-- FAIL, INFO (a readout, never an assertion). Every PASS/FAIL row should be PASS.
-- ===========================================================================

begin transaction read only;

with
fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
checks as (
  -- ---- the new and re-created functions exist --------------------------------
  select 1 as seq, 'cancel_payment_document(uuid, text) exists' as check_name,
    to_regprocedure('public.cancel_payment_document(uuid, text)') is not null as ok, '' as detail
  union all
  select 2, 'correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric) exists',
    to_regprocedure('public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric)') is not null, ''
  union all
  select 3, 'edit_payment_core(uuid, date, jsonb, boolean, text, uuid) and the five-argument issue_payment_document_core exist',
    to_regprocedure('public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)') is not null
    and to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)') is not null, ''
  union all
  select 4, 'edit_payment(uuid, date, jsonb) and the four-argument issue_payment_document_core still exist (the wrappers)',
    to_regprocedure('public.edit_payment(uuid, date, jsonb)') is not null
    and to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is not null, ''
  -- ---- security definer, pinned search path -----------------------------------
  union all
  select 5, 'all six are SECURITY DEFINER with an empty search_path',
    (select count(*) = 6 and bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""'))
     from fn where oid in (
       to_regprocedure('public.cancel_payment_document(uuid, text)'),
       to_regprocedure('public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric)'),
       to_regprocedure('public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)'),
       to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)'),
       to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)'),
       to_regprocedure('public.edit_payment(uuid, date, jsonb)'))), ''
  -- ---- privileges --------------------------------------------------------------
  union all
  select 6, 'cancel, correct-and-reissue and edit_payment: authenticated may execute, anon may not',
    has_function_privilege('authenticated', 'public.cancel_payment_document(uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.cancel_payment_document(uuid, text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.edit_payment(uuid, date, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.edit_payment(uuid, date, jsonb)', 'EXECUTE'), ''
  union all
  select 7, 'the two cores (edit_payment_core, both issue_payment_document_core) are callable by no client role',
    not has_function_privilege('authenticated', 'public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.issue_payment_document_core(uuid, date, text, uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.issue_payment_document_core(uuid, date, text, uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.issue_payment_document_core(uuid, date, text, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.issue_payment_document_core(uuid, date, text, uuid)', 'EXECUTE'), ''
  -- ---- the wrappers delegate; the cores carry the logic ----------------------------
  union all
  select 8, 'edit_payment is now a thin wrapper of edit_payment_core with allow_documented = false (it no longer holds the logic)',
    (select def like '%edit_payment_core(p_payment_id, p_payment_date, p_methods, false, null, null)%'
            and def not like '%membership_payment_methods%'
     from fn where oid = to_regprocedure('public.edit_payment(uuid, date, jsonb)')), ''
  union all
  select 9, 'the four-argument issue_payment_document_core is a wrapper of the five-argument one with no overrides',
    (select def like '%issue_payment_document_core(p_payment_id, p_document_date, p_series, p_replaces_id, null)%'
            and def not like '%insert into public.invoices%'
     from fn where oid = to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)')), ''
  union all
  select 10, 'edit_payment_core keeps the balance rule (other payments of the SAME membership, this payment excluded) and locks the membership row',
    (select def like '%where membership_id = v_mem.id and id <> v_payment.id%'
            and def like '%v_total > v_mem.amount - v_other%'
            and def like '%The payment cannot be more than the outstanding balance%'
            and def like '%from public.memberships%'
            and def like '%for update%'
     from fn where oid = to_regprocedure('public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)')), ''
  union all
  select 11, 'edit_payment_core records the reason and the document in the audit row, and a documented payment needs a named document of itself',
    (select def like '%correction_reason, corrected_document_id%'
            and def like '%The correction must name a document of this payment%'
            and def like '%not p_allow_documented and exists%'
     from fn where oid = to_regprocedure('public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid)')), ''
  union all
  select 12, 'the five-argument issue_payment_document_core whitelists its overrides and keeps the series, numbering and tax code of 0044',
    (select def like '%business_gstin%'
            and def like '%That detail cannot be corrected on a document%'
            and def like '%round(v_payment.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2)%'
            and def like '%invoice_number_reservations%'
            and def like '%payment_receipt_number_reservations%'
     from fn where oid = to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)')), ''
  union all
  select 13, 'cancel_payment_document cancels only (no issue, no payment write) under the cancellation marker',
    (select def like '%yoga.invoice_cancel%'
            and def not like '%issue_payment_document_core%'
            and def not like '%edit_payment_core%'
            and def not like '%update public.membership%'
     from fn where oid = to_regprocedure('public.cancel_payment_document(uuid, text)')), ''
  union all
  select 14, 'correct_and_reissue_payment_document cancels, corrects the payment through the core, and issues through the core, in that order',
    (select position('yoga.invoice_cancel' in def) > 0
            and position('edit_payment_core' in def) > position('yoga.invoice_cancel' in def)
            and position('issue_payment_document_core(' in def) > position('edit_payment_core' in def)
            and def like '%v_doc.document_series%'
     from fn where oid = to_regprocedure('public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric)')), ''
  -- ---- the audit trail -------------------------------------------------------------
  union all
  select 15, 'membership_payment_edits has correction_reason (text, nullable) and corrected_document_id (uuid, nullable, references invoices)',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membership_payment_edits'
            and column_name = 'correction_reason' and data_type = 'text' and is_nullable = 'YES')
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membership_payment_edits'
                and column_name = 'corrected_document_id' and data_type = 'uuid' and is_nullable = 'YES')
    and exists (select 1 from pg_constraint where conrelid = 'public.membership_payment_edits'::regclass and contype = 'f'
                and confrelid = 'public.invoices'::regclass and confdeltype = 'r'), ''
  union all
  select 16, 'the reason CHECK exists, and the audit table is still Admin-read, no client write',
    exists (select 1 from pg_constraint where conrelid = 'public.membership_payment_edits'::regclass and conname = 'membership_payment_edits_reason_valid')
    and (select relrowsecurity from pg_class where oid = 'public.membership_payment_edits'::regclass)
    and not has_table_privilege('authenticated', 'public.membership_payment_edits', 'INSERT')
    and not has_table_privilege('authenticated', 'public.membership_payment_edits', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.membership_payment_edits', 'DELETE'), ''
  -- ---- earlier protections remain --------------------------------------------------
  union all
  select 17, 'the freeze trigger, the one-issued-document-per-payment and one-replacement-per-document indexes, and the payment-only constraint remain',
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.invoices'::regclass and t.tgname = 'invoices_freeze_snapshot_trigger' and not t.tgisinternal and t.tgenabled <> 'D')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_payment_id_unique')
    and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_replaces_id_unique')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_correction_payment_only'), ''
  union all
  select 18, 'correct_payment_document, issue_payment_document, edit_payment_amount and record_membership_payment (in its 0065 form) still exist',
    to_regprocedure('public.correct_payment_document(uuid, text)') is not null
    and to_regprocedure('public.issue_payment_document(uuid, date)') is not null
    and to_regprocedure('public.edit_payment_amount(uuid, jsonb)') is not null
    and to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean, uuid)') is not null, ''
  union all
  select 19, 'every document still satisfies the cancellation and tax constraints (cancelled has a reason; issued has none)',
    not exists (select 1 from public.invoices i where i.status = 'cancelled' and (i.cancellation_reason is null or i.cancelled_at is null))
    and not exists (select 1 from public.invoices i where i.status = 'issued' and (i.cancellation_reason is not null or i.cancelled_at is not null))
    and not exists (select 1 from public.invoices i where i.tax_enabled and i.taxable_amount + i.tax_amount <> i.total_amount), ''
  -- ---- readouts ---------------------------------------------------------------------
  union all
  select 20, 'a replacement carries forward the original''s plan, description, period, service details and tracked marker (nothing re-read from the membership)',
    (select def like '%v_plan := v_orig.plan;%'
            and def like '%v_description := v_orig.description;%'
            and def like '%v_period_start := v_orig.period_start;%'
            and def like '%v_period_end := v_orig.period_end;%'
            and def like '%v_service_details := v_orig.service_details;%'
            and def like '%v_service_tracked := v_orig.service_details_tracked;%'
            and def like '%where id = p_replaces_id and payment_id = v_payment.id%'
     from fn where oid = to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)')), ''
  union all
  select 21, 'only a FIRST document reads the live membership service details: membership_service_details is called exactly once, in the first-issue branch',
    (select (length(def) - length(replace(def, 'membership_service_details', ''))) / length('membership_service_details') = 1
            and def like '%if p_replaces_id is null then%'
            and position('v_service_details := public.membership_service_details(v_mem.id);' in def) > 0
            and position('v_service_details := public.membership_service_details(v_mem.id);' in def) < position('v_service_details := v_orig.service_details;' in def)
     from fn where oid = to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid, jsonb)')), ''
  union all
  select 22, 'every existing document keeps its tracked marker and service details as they were: the tracked flag is NOT NULL and the shape CHECK remains',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoices'
            and column_name = 'service_details_tracked' and is_nullable = 'NO')
    and exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_service_details_shape'), ''
  union all
  select 23, 'INFO: payment documents / cancelled / replacements / payment edits (with a recorded correction) - NOT changed by 0055',
    true,
    (select count(*) from public.invoices where payment_id is not null) || ' payment documents; '
      || (select count(*) from public.invoices where payment_id is not null and status = 'cancelled') || ' cancelled; '
      || (select count(*) from public.invoices where replaces_id is not null) || ' replacements; '
      || (select count(*) from public.membership_payment_edits) || ' payment edits, '
      || (select count(*) from public.membership_payment_edits where corrected_document_id is not null) || ' recorded as part of a correction'
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
