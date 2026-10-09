-- =============================================================================
-- V1 Tax Adjustment - Step 6: correcting a payment document (cancel and reissue)
-- Migration 0037
--
-- 01-product.md §5A "Corrections": an issued document is never edited in content, overwritten or
-- deleted. To correct one, the Admin cancels it - with a reason - and a replacement is issued with a NEW
-- number from the SAME series (a tax invoice from the invoice sequence, a payment receipt from the payment
-- receipt sequence). The original keeps its number, which stays reserved for good (0030 / 0036), and
-- stays viewable as Cancelled, with its reason and a link to its replacement.
--
-- Only payment-level documents (0036) are corrected this way. Membership-level documents keep their
-- current behaviour.
--
-- WHAT THIS MIGRATION DOES
--   1. invoices: status ('issued' | 'cancelled'), cancelled_at, cancelled_by, cancellation_reason, and
--      replaces_id - on a replacement, the document it replaces. The chain of replaces_id is the
--      correction history of a payment. Every existing row reads 'issued' (the column default).
--   2. One ISSUED document per payment (the 0036 index is narrowed to status = 'issued'), and a
--      document can be replaced only once.
--   3. issue_payment_document_core(payment, date, series, replaces) - 0036's issue_payment_document body
--      with the series and the replaced document as inputs; internal (no client execute).
--      issue_payment_document(payment, date) is now a thin, unchanged-in-behaviour wrapper around it.
--   4. correct_payment_document(document, reason) - Admin only, one transaction: cancels the document
--      and issues its replacement. If issuing fails, the whole correction is rolled back and the
--      document stays issued. A cancelled document cannot be corrected again.
--   5. The freeze trigger (0033's): a cancelled document can never change again, and the cancellation
--      columns change only inside correct_payment_document().
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No existing row is updated, inserted or deleted.
--   * The payment, its methods, the membership and its balance are never touched.
--   * No refund, no credit note; numbering formats and starting numbers are unchanged.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------
-- 0037 builds on 0034 (payments), 0035 (tax invoice choice) and 0036 (payment documents). If any of them is not
-- applied to this database, stop here with a clear message - before anything is changed.

do $$
begin
  if to_regclass('public.membership_payments') is null then
    raise exception '0037 needs migration 0034 (membership_payments) to be applied first.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'membership_payments' and column_name = 'issue_tax_invoice') then
    raise exception '0037 needs migration 0035 (membership_payments.issue_tax_invoice) to be applied first.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'invoices' and column_name = 'payment_id')
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'invoices' and column_name = 'document_series')
     or to_regclass('public.payment_receipt_number_reservations') is null
     or to_regprocedure('public.issue_payment_document(uuid, date)') is null then
    raise exception '0037 needs migration 0036 (payment documents) to be applied first.';
  end if;
end $$;


-- 1. Cancellation and the replacement link ---------------------------------------------------------------

alter table public.invoices
  add column if not exists status text not null default 'issued',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users (id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists replaces_id uuid references public.invoices (id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_status_valid') then
    alter table public.invoices
      add constraint invoices_status_valid
      check (status in ('issued', 'cancelled'));
  end if;

  -- An issued document carries no cancellation; a cancelled one always has its time and a real reason.
  if not exists (select 1 from pg_constraint where conname = 'invoices_cancellation_consistent') then
    alter table public.invoices
      add constraint invoices_cancellation_consistent
      check (
        (status = 'issued' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
        or (
          status = 'cancelled' and cancelled_at is not null
          and cancellation_reason is not null
          and cancellation_reason = btrim(cancellation_reason)
          and length(cancellation_reason) between 1 and 500
        )
      );
  end if;

  -- Only a payment document is cancelled or replaced (membership-level documents keep their behaviour).
  if not exists (select 1 from pg_constraint where conname = 'invoices_correction_payment_only') then
    alter table public.invoices
      add constraint invoices_correction_payment_only
      check ((status = 'issued' and replaces_id is null) or payment_id is not null);
  end if;
end $$;

comment on column public.invoices.status is
  'issued, or cancelled by a correction (V1 Tax Adjustment). A cancelled document keeps its number and stays viewable; it never changes again.';
comment on column public.invoices.cancellation_reason is
  'Why the document was cancelled, as entered by the Admin who corrected it.';
comment on column public.invoices.replaces_id is
  'On a replacement document: the cancelled document it replaces. Following replaces_id gives a payment''s correction history.';


-- 2. One issued document per payment; one replacement per document -----------------------------------------

drop index if exists public.invoices_payment_id_unique;
create unique index invoices_payment_id_unique
  on public.invoices (payment_id)
  where payment_id is not null and status = 'issued';

create unique index if not exists invoices_replaces_id_unique
  on public.invoices (replaces_id)
  where replaces_id is not null;


-- 3. Issuing: the shared core, and the existing entry point --------------------------------------------------

create or replace function public.issue_payment_document_core(
  p_payment_id    uuid,
  p_document_date date,
  p_series        text,
  p_replaces_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment   public.membership_payments%rowtype;
  v_mem       public.memberships%rowtype;
  v_settings  public.invoice_settings%rowtype;
  v_student   public.students%rowtype;
  v_center    public.center_profile%rowtype;
  v_bank      public.bank_accounts%rowtype;
  v_series    text;
  v_taxed     boolean;
  v_today     date;
  v_doc_date  date;
  v_candidate bigint;
  v_taxable   numeric(10, 2);
  v_tax       numeric(10, 2);
  v_logo_path text;
  v_id        uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_payment
  from public.membership_payments
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  -- The same lock order as issue_invoice_core: the membership row, then the settings row. Every
  -- issue of every series holds the settings row, so two issues never take the same number.
  select * into v_mem
  from public.memberships
  where id = v_payment.membership_id
  for update;

  select * into v_settings
  from public.invoice_settings
  where singleton
  for update;

  if exists (select 1 from public.invoices where payment_id = v_payment.id and status = 'issued') then
    raise exception 'A document has already been issued for this payment.' using errcode = '23505';
  end if;

  -- A replacement keeps the series of the document it replaces; a first document follows the payment's choice.
  v_series := coalesce(p_series, case when v_payment.issue_tax_invoice then 'invoice' else 'payment_receipt' end);

  if v_series = 'invoice' and v_settings.starting_invoice_number is null then
    raise exception 'Invoice numbering has not been configured.' using errcode = '55000';
  end if;

  if v_series = 'payment_receipt' and v_settings.payment_receipt_starting_number is null then
    raise exception 'Payment receipt numbering has not been configured.' using errcode = '55000';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;
  v_doc_date := coalesce(p_document_date, v_payment.payment_date);

  if v_doc_date < v_payment.payment_date then
    raise exception 'The document date cannot be before the payment date.' using errcode = '22023';
  end if;

  if v_doc_date > v_today then
    raise exception 'The document date cannot be in the future.' using errcode = '22023';
  end if;

  select * into v_student from public.students where id = v_mem.student_id;
  select * into v_center from public.center_profile where singleton;

  if v_student.id is null or v_center.singleton is null then
    raise exception 'The student or centre profile could not be read.' using errcode = 'P0002';
  end if;

  -- The next free number of the payment's own series: never reserved, never held by a document of it.
  if v_series = 'invoice' then
    v_candidate := coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number);
    while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)
       or exists (select 1 from public.invoices where invoice_number = v_candidate and document_series = 'invoice') loop
      v_candidate := v_candidate + 1;
    end loop;
  else
    v_candidate := coalesce(v_settings.payment_receipt_next_number, v_settings.payment_receipt_starting_number);
    while exists (select 1 from public.payment_receipt_number_reservations where receipt_number = v_candidate)
       or exists (select 1 from public.invoices where invoice_number = v_candidate and document_series = 'payment_receipt') loop
      v_candidate := v_candidate + 1;
    end loop;
  end if;

  -- Tax (tax-inclusive, as issue_invoice_core) only on a tax invoice, and only while tax is enabled.
  v_taxed := v_series = 'invoice' and v_settings.tax_enabled;
  if v_taxed then
    v_tax := round(v_payment.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2);
    v_taxable := v_payment.amount - v_tax;
  end if;

  v_logo_path := substring(v_center.logo_url from '/storage/v1/object/public/profile-photos/([^?]+)');

  select * into v_bank
  from public.bank_accounts
  where is_active;

  insert into public.invoices (
    membership_id, payment_id, document_series,
    invoice_number, invoice_date, payment_date,
    document_title, description, plan, period_start, period_end,
    currency, total_amount,
    tax_enabled, tax_name, tax_rate, taxable_amount, tax_amount,
    customer_name, customer_code, customer_phone, customer_phone_country_code, customer_email,
    business_name, business_address, business_phone, business_email, business_logo_path,
    terms, signatory_name, signatory_designation, signature_path,
    invoice_prefix,
    bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch,
    service_details, service_details_tracked,
    replaces_id
  )
  values (
    v_mem.id, v_payment.id, v_series,
    v_candidate, v_doc_date, v_payment.payment_date,
    case when v_series = 'invoice' then v_settings.document_title else 'payment_receipt' end,
    case v_mem.plan
      when 'monthly' then 'Monthly'
      when 'quarterly' then 'Quarterly'
      when 'half_yearly' then 'Half Yearly'
      when 'annual' then 'Annual'
      else 'Custom duration'
    end || ' Membership',
    v_mem.plan, v_mem.start_date, v_mem.end_date,
    v_mem.currency, v_payment.amount,
    v_taxed,
    case when v_taxed then v_settings.tax_name end,
    case when v_taxed then v_settings.tax_rate end,
    v_taxable, v_tax,
    v_student.full_name, v_student.student_code, v_student.phone, v_student.phone_country_code, v_student.email,
    v_center.name, v_center.address, v_center.phone, v_center.email, v_logo_path,
    v_settings.terms, v_settings.signatory_name, v_settings.signatory_designation, v_settings.signature_path,
    case when v_series = 'invoice' then v_settings.invoice_prefix else v_settings.payment_receipt_prefix end,
    v_bank.bank_name, v_bank.account_name, v_bank.account_number, v_bank.ifsc_code, v_bank.branch,
    public.membership_service_details(v_mem.id), true,
    p_replaces_id
  )
  returning id into v_id;

  if v_series = 'invoice' then
    update public.invoice_settings set next_invoice_number = v_candidate + 1 where singleton;
  else
    update public.invoice_settings set payment_receipt_next_number = v_candidate + 1 where singleton;
  end if;

  return v_id;
end;
$$;

comment on function public.issue_payment_document_core(uuid, date, text, uuid) is
  'Internal. Issues a payment document in the given series (or the series the payment chose), optionally as the replacement of a cancelled one. Numbering, locks, snapshot and tax are 0036''s.';

revoke execute on function public.issue_payment_document_core(uuid, date, text, uuid) from public, anon, authenticated;

create or replace function public.issue_payment_document(
  p_payment_id    uuid,
  p_document_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  return public.issue_payment_document_core(p_payment_id, p_document_date, null, null);
end;
$$;

comment on function public.issue_payment_document(uuid, date) is
  'Admin only. Issues the one issued document of a payment: a tax invoice from the invoice sequence when the payment chose one, else a payment receipt from its own sequence. The document is a snapshot and never follows later membership edits.';

revoke execute on function public.issue_payment_document(uuid, date) from public, anon;
grant execute on function public.issue_payment_document(uuid, date) to authenticated;


-- 4. Correcting: cancel and reissue, in one transaction ----------------------------------------------------------

create or replace function public.correct_payment_document(
  p_document_id uuid,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc    public.invoices%rowtype;
  v_reason text;
  v_new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Enter the reason for the correction.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason can have at most 500 characters.' using errcode = '22023';
  end if;

  select * into v_doc
  from public.invoices
  where id = p_document_id;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if v_doc.payment_id is null then
    raise exception 'Only a payment document can be corrected.' using errcode = '55000';
  end if;

  -- The same lock order as every issue: the membership row, then the settings row - then the document,
  -- so a concurrent correction of the same document waits here and then finds it cancelled.
  perform 1 from public.memberships where id = v_doc.membership_id for update;
  perform 1 from public.invoice_settings where singleton for update;

  select * into v_doc
  from public.invoices
  where id = p_document_id
  for update;

  if v_doc.status <> 'issued' then
    raise exception 'This document has already been cancelled.' using errcode = '55006';
  end if;

  -- Cancel the original: only this document, only its cancellation columns (the freeze trigger checks).
  perform set_config('yoga.invoice_cancel', v_doc.id::text, true);

  update public.invoices
  set status              = 'cancelled',
      cancelled_at        = now(),
      cancelled_by        = auth.uid(),
      cancellation_reason = v_reason,
      updated_at          = now()
  where id = v_doc.id;

  perform set_config('yoga.invoice_cancel', '', true);

  -- Issue the replacement in the same series, dated as the original. Any failure rolls back the whole
  -- correction, so the original is never left cancelled without a replacement.
  v_new_id := public.issue_payment_document_core(v_doc.payment_id, v_doc.invoice_date, v_doc.document_series, v_doc.id);

  return v_new_id;
end;
$$;

comment on function public.correct_payment_document(uuid, text) is
  'Admin only. Corrects a payment document: cancels it with the given reason and issues its replacement with a new number from the same series, atomically. A cancelled document cannot be corrected again.';

revoke execute on function public.correct_payment_document(uuid, text) from public, anon;
grant execute on function public.correct_payment_document(uuid, text) to authenticated;


-- 5. The freeze trigger --------------------------------------------------------------------------------------------

create or replace function public.invoices_freeze_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exempt text[] := array['invoice_number', 'invoice_date', 'updated_at'];
begin
  -- 0037: a cancelled document is final - not even its number or date may change.
  if old.status = 'cancelled' then
    raise exception 'A cancelled document cannot be changed.' using errcode = '55006';
  end if;

  -- 0037: only correct_payment_document() may cancel, and only the document it marked.
  if current_setting('yoga.invoice_cancel', true) = old.id::text then
    v_exempt := v_exempt || array['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason'];
  end if;

  if current_setting('yoga.invoice_sync', true) = old.id::text then
    v_exempt := v_exempt || array[
      'plan', 'description', 'period_start', 'period_end',
      'total_amount', 'taxable_amount', 'tax_amount', 'service_details'
    ];
  end if;

  if (to_jsonb(new) - v_exempt) is distinct from (to_jsonb(old) - v_exempt) then
    raise exception 'An issued invoice can only change its number and date.' using errcode = '55006';
  end if;
  return new;
end;
$$;

comment on function public.invoices_freeze_snapshot() is
  'Rejects any update to an invoice other than invoice_number, invoice_date and updated_at - plus, only inside sync_invoice_from_membership(), the columns that follow the membership, and only inside correct_payment_document(), the cancellation columns. A cancelled document never changes.';
