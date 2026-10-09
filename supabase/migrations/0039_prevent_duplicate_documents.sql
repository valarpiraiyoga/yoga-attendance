-- =============================================================================
-- V1 Tax Adjustment - Prevent duplicate document issuance
-- Migration 0039
--
-- A membership can hold a membership-level document (invoices.payment_id IS NULL) AND payment-level documents
-- for the same money. That happened for memberships that became Paid through recorded payments between
-- migrations 0034 and 0036, when the auto-issue trigger still issued a membership-level document. 0036 stopped
-- the trigger and issue_invoice_core; nothing yet stops a payment document being issued on such a membership.
--
-- WHAT THIS MIGRATION DOES
--   issue_payment_document_core - 0038's body with one guard: it refuses to issue a FIRST payment document
--   (p_replaces_id is null) when the membership already has a membership-level document. SQLSTATE 55000
--   ("a prerequisite is not met"), like the other issuing refusals. The guard runs after the membership and
--   settings locks and the payment re-read, before any number is chosen, so a refusal consumes no number.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No existing row is inserted, updated, cancelled or deleted. Existing documents - membership-level and
--     payment-level - are untouched, and so are payments, amounts, statuses, numbering and tax.
--   * Correcting an existing payment document (Cancel and Reissue) is not blocked: a replacement adds no
--     document, it replaces one. Memberships already documented twice are not repaired here.
--   * Membership-level documents are not converted into payment-level documents.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is null then
    raise exception '0039 needs migration 0037 (invoice corrections) to be applied first.';
  end if;
  if to_regclass('public.membership_payment_edits') is null then
    raise exception '0039 needs migration 0038 (payment amount edits) to be applied first.';
  end if;
end $$;


-- 1. Issuing: no payment document beside a membership-level document -----------------------------------------

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
  'Internal. Issues a payment document in the given series (or the series the payment chose), optionally as the replacement of a cancelled one. Reads the payment after taking the membership and settings locks. Refuses a first document for a membership that already has a membership-level document.';

revoke execute on function public.issue_payment_document_core(uuid, date, text, uuid) from public, anon, authenticated;
