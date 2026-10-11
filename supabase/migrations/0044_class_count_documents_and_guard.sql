-- =============================================================================
-- V1 Class-count memberships: documents and history integrity (Phase 4)
-- Migration 0044
--
-- ADDITIVE. Builds on 0042 and 0043. Two things:
--
--   1. DOCUMENT WORDING. A class-count membership (plan 'class_count') now reads "Class Count Membership" on its
--      documents. Until now each description fell through to "Custom duration Membership". The three functions that
--      write a description are re-created, each IDENTICAL to its latest definition except for ONE added line,
--
--          when 'class_count' then 'Class Count'
--
--      before the existing `else 'Custom duration'`:
--        * issue_invoice_core                (0041) - the membership-level invoice,
--        * issue_payment_document_core       (0041) - every payment document, including a replacement made by
--                                                      Cancel and Reissue,
--        * sync_invoice_from_membership      (0036) - a membership-level receipt following its membership.
--      A membership with a null end date already copies into invoices.period_end as NULL (0042).
--      Every document already issued is untouched: nothing here updates a row, and a document keeps the description it
--      was issued with. The wording of a duration plan does not change.
--
--   2. HISTORY INTEGRITY. Once classes have been recorded against a class-count membership (0043), a trigger on
--      memberships refuses changes that would contradict that history:
--        * its type (kind) and its student cannot change (55006);
--        * its class total cannot be set below the classes already recorded (23514), or to NULL.
--      Raising the total, and every other edit (dates, amount, notes), stay allowed. A membership with no recorded
--      classes can be edited as before. The check runs after the membership row is locked by the update, and recording
--      a class takes the same lock, so the count it reads cannot change under it.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not INSERT, UPDATE or DELETE any row, and edits no earlier migration.
--   * No change to payments, numbering, tax, the GSTIN, snapshots, corrections or any other function.
-- Safe to run again.
-- =============================================================================


-- 1. Document wording ---------------------------------------------------------------------------------------------

create or replace function public.issue_invoice_core(
  p_membership_id uuid,
  p_invoice_date  date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem          public.memberships%rowtype;
  v_settings     public.invoice_settings%rowtype;
  v_student      public.students%rowtype;
  v_center       public.center_profile%rowtype;
  v_today        date;
  v_invoice_date date;
  v_candidate    bigint;
  v_taxable      numeric(10, 2);
  v_tax_amount   numeric(10, 2);
  v_logo_path    text;
  v_id           uuid;
  v_bank         public.bank_accounts%rowtype;
begin
  select * into v_mem
  from public.memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  -- 0036: a membership paid through recorded payments is documented per payment, never at membership level.
  if exists (select 1 from public.membership_payments where membership_id = v_mem.id) then
    raise exception 'This membership has recorded payments: issue a document for each payment.' using errcode = '55000';
  end if;

  select * into v_settings
  from public.invoice_settings
  where singleton
  for update;

  if not found or v_settings.starting_invoice_number is null then
    raise exception 'Invoice numbering has not been configured.' using errcode = '55000';
  end if;

  if v_mem.payment_status is distinct from 'paid' then
    raise exception 'Only a Paid membership can be invoiced.' using errcode = '55000';
  end if;

  if v_mem.payment_date is null then
    raise exception 'A payment date is required to issue an invoice.' using errcode = '22023';
  end if;

  if exists (select 1 from public.invoices where membership_id = v_mem.id and payment_id is null) then
    raise exception 'An invoice has already been issued for this membership.' using errcode = '23505';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;
  v_invoice_date := coalesce(p_invoice_date, v_mem.payment_date);

  if v_invoice_date < v_mem.payment_date then
    raise exception 'The invoice date cannot be before the payment date.' using errcode = '22023';
  end if;

  if v_invoice_date > v_today then
    raise exception 'The invoice date cannot be in the future.' using errcode = '22023';
  end if;

  select * into v_student from public.students where id = v_mem.student_id;
  select * into v_center from public.center_profile where singleton;

  if v_student.id is null or v_center.singleton is null then
    raise exception 'The student or centre profile could not be read.' using errcode = 'P0002';
  end if;

  v_candidate := coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number);
  while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)
     or exists (select 1 from public.invoices where invoice_number = v_candidate and document_series = 'invoice') loop
    v_candidate := v_candidate + 1;
  end loop;

  if v_settings.tax_enabled then
    v_tax_amount := round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2);
    v_taxable := v_mem.amount - v_tax_amount;
  end if;

  v_logo_path := substring(v_center.logo_url from '/storage/v1/object/public/profile-photos/([^?]+)');

  select * into v_bank
  from public.bank_accounts
  where is_active;

  insert into public.invoices (
    membership_id, invoice_number, invoice_date, payment_date,
    document_title, description, plan, period_start, period_end,
    currency, total_amount,
    tax_enabled, tax_name, tax_rate, taxable_amount, tax_amount,
    customer_name, customer_code, customer_phone, customer_phone_country_code, customer_email,
    business_name, business_address, business_phone, business_email, business_logo_path, business_gstin,
    terms, signatory_name, signatory_designation, signature_path,
    invoice_prefix,
    bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch,
    service_details, service_details_tracked
  )
  values (
    v_mem.id, v_candidate, v_invoice_date, v_mem.payment_date,
    v_settings.document_title,
    case v_mem.plan
      when 'monthly' then 'Monthly'
      when 'quarterly' then 'Quarterly'
      when 'half_yearly' then 'Half Yearly'
      when 'annual' then 'Annual'
      when 'class_count' then 'Class Count'
      else 'Custom duration'
    end || ' Membership',
    v_mem.plan, v_mem.start_date, v_mem.end_date,
    v_mem.currency, v_mem.amount,
    v_settings.tax_enabled,
    case when v_settings.tax_enabled then v_settings.tax_name end,
    case when v_settings.tax_enabled then v_settings.tax_rate end,
    v_taxable, v_tax_amount,
    v_student.full_name, v_student.student_code, v_student.phone, v_student.phone_country_code, v_student.email,
    v_center.name, v_center.address, v_center.phone, v_center.email, v_logo_path, v_settings.gstin,
    v_settings.terms, v_settings.signatory_name, v_settings.signatory_designation, v_settings.signature_path,
    v_settings.invoice_prefix,
    v_bank.bank_name, v_bank.account_name, v_bank.account_number, v_bank.ifsc_code, v_bank.branch,
    public.membership_service_details(v_mem.id), true
  )
  returning id into v_id;

  update public.invoice_settings
  set next_invoice_number = v_candidate + 1
  where singleton;

  return v_id;
end;
$$;

comment on function public.issue_invoice_core(uuid, date) is
  'Issues the membership-level invoice for a Paid membership without recorded payments: numbering from the locked counter row (skipping used AND reserved invoice-series numbers), the settings (including the GSTIN), student, centre, active bank account and service details copied in.';

revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;

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

  -- 0038: read the payment again, locked, now that the membership is locked - an amount edit (which holds the
  -- membership lock while it changes the payment) can no longer leave this issue with the amount read above.
  select * into v_payment
  from public.membership_payments
  where id = p_payment_id
  for update;

  if exists (select 1 from public.invoices where payment_id = v_payment.id and status = 'issued') then
    raise exception 'A document has already been issued for this payment.' using errcode = '23505';
  end if;

  -- 0039: a membership that already has a membership-level document (payment_id is null) is documented once,
  -- at membership level; its payments get no document of their own, or the same money would appear on two
  -- documents. Only a FIRST document is refused: a replacement (p_replaces_id) replaces a payment document
  -- that already exists and adds none, so correcting an existing payment document stays possible.
  if p_replaces_id is null
     and exists (select 1 from public.invoices where membership_id = v_mem.id and payment_id is null) then
    raise exception 'A membership invoice already exists for this membership.' using errcode = '55000';
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
    business_name, business_address, business_phone, business_email, business_logo_path, business_gstin,
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
      when 'class_count' then 'Class Count'
      else 'Custom duration'
    end || ' Membership',
    v_mem.plan, v_mem.start_date, v_mem.end_date,
    v_mem.currency, v_payment.amount,
    v_taxed,
    case when v_taxed then v_settings.tax_name end,
    case when v_taxed then v_settings.tax_rate end,
    v_taxable, v_tax,
    v_student.full_name, v_student.student_code, v_student.phone, v_student.phone_country_code, v_student.email,
    v_center.name, v_center.address, v_center.phone, v_center.email, v_logo_path, case when v_series = 'invoice' then v_settings.gstin end,
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
  'Internal. Issues a payment document in the given series (or the series the payment chose), optionally as the replacement of a cancelled one. Reads the payment after taking the membership and settings locks. Refuses a first document for a membership that already has a membership-level document. Copies the settings as they are when it runs; the GSTIN only onto a tax invoice, never onto a payment receipt.';

revoke execute on function public.issue_payment_document_core(uuid, date, text, uuid) from public, anon, authenticated;

create or replace function public.sync_invoice_from_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem         public.memberships%rowtype;
  v_inv         public.invoices%rowtype;
  v_description text;
  v_tax_amount  numeric(10, 2);
  v_taxable     numeric(10, 2);
  v_recompute   boolean;
  v_details     jsonb;
begin
  select * into v_mem
  from public.memberships
  where id = p_membership_id;

  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  -- A membership without a receipt has nothing to follow it. (This never issues one.)
  select * into v_inv
  from public.invoices
  where membership_id = p_membership_id
    and payment_id is null   -- 0036: payment documents never follow the membership
  for update;

  if not found then
    return;
  end if;

  -- The same wording issue_invoice_core gives a receipt.
  v_description := case v_mem.plan
    when 'monthly' then 'Monthly'
    when 'quarterly' then 'Quarterly'
    when 'half_yearly' then 'Half Yearly'
    when 'annual' then 'Annual'
    when 'class_count' then 'Class Count'
    else 'Custom duration'
  end || ' Membership';

  -- Tax-inclusive, with the receipt's OWN stored rate. With tax off, both stay NULL
  -- (invoices_tax_consistent).
  if v_inv.tax_enabled then
    v_tax_amount := round(v_mem.amount * v_inv.tax_rate / (100 + v_inv.tax_rate), 2);
    v_taxable := v_mem.amount - v_tax_amount;
  end if;

  -- The service details describe the classes in force at the membership's START date, so they are
  -- recomputed only when the start date has moved away from the one the receipt carries
  -- (period_start is the synchronized copy of start_date), and only for a TRACKED receipt: one that
  -- existed before 0033 never gains them. An amount, plan or end-date edit keeps the snapshot.
  v_recompute := v_inv.service_details_tracked
                 and v_inv.period_start is distinct from v_mem.start_date;
  if v_recompute then
    v_details := public.membership_service_details(v_mem.id);
  end if;

  if v_recompute
     or v_inv.plan is distinct from v_mem.plan
     or v_inv.description is distinct from v_description
     or v_inv.period_start is distinct from v_mem.start_date
     or v_inv.period_end is distinct from v_mem.end_date
     or v_inv.total_amount is distinct from v_mem.amount
     or v_inv.taxable_amount is distinct from v_taxable
     or v_inv.tax_amount is distinct from v_tax_amount then

    -- Mark this transaction for this one invoice; the freeze trigger honours it for the
    -- eight columns below and nothing else. Transaction-local.
    perform set_config('yoga.invoice_sync', v_inv.id::text, true);

    update public.invoices
    set plan           = v_mem.plan,
        description    = v_description,
        period_start   = v_mem.start_date,
        period_end     = v_mem.end_date,
        total_amount   = v_mem.amount,
        taxable_amount = v_taxable,
        tax_amount     = v_tax_amount,
        service_details = case when v_recompute then v_details else service_details end,
        updated_at     = now()
    where id = v_inv.id;

    perform set_config('yoga.invoice_sync', '', true);
  end if;
end;
$$;

comment on function public.sync_invoice_from_membership(uuid) is
  'Makes a membership''s membership-level receipt follow it (plan, description, period, amounts; service details when the start date moved). Payment documents are never touched. Callable by no client role.';

revoke execute on function public.sync_invoice_from_membership(uuid) from public, anon, authenticated;

-- 2. History integrity ----------------------------------------------------------------------------------------------

create or replace function public.memberships_class_count_history_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  select count(*) into v_used
  from public.class_count_attendance
  where membership_id = old.id;

  if v_used = 0 then
    return new;
  end if;

  if new.kind is distinct from old.kind then
    raise exception 'The type of a membership with recorded classes cannot be changed.' using errcode = '55006';
  end if;

  if new.student_id is distinct from old.student_id then
    raise exception 'The student of a membership with recorded classes cannot be changed.' using errcode = '55006';
  end if;

  if new.total_classes is distinct from old.total_classes
     and (new.total_classes is null or new.total_classes < v_used) then
    raise exception 'The class total cannot be less than the classes already recorded.' using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.memberships_class_count_history_guard() is
  'Before an update of a membership''s kind, student or class total: when classes have been recorded against it, its kind and student cannot change and its class total cannot go below the classes recorded.';

revoke execute on function public.memberships_class_count_history_guard() from public, anon, authenticated;

drop trigger if exists memberships_class_count_history_guard_trigger on public.memberships;
create trigger memberships_class_count_history_guard_trigger
  before update of kind, student_id, total_classes on public.memberships
  for each row
  execute function public.memberships_class_count_history_guard();
