-- =============================================================================
-- V1 - GSTIN setting and the GSTIN printed on documents
-- Migration 0041
--
-- The centre's GSTIN becomes a setting (Settings -> Invoice / Receipt -> Tax). Each document copies it when it is
-- issued, like every other business detail, so changing the setting later never alters a document already issued.
--
-- WHAT THIS MIGRATION DOES
--   1. invoice_settings.gstin (nullable text): the setting. The first time this migration runs, the existing settings
--      row is given the initial value 29BPGPP6168E1ZH; after that the Admin owns the value (clearing it makes it NULL, and
--      running this file again does NOT bring the initial value back). A CHECK keeps it NULL or a well-formed GSTIN
--      (15 characters: 2 digits, 5 letters, 4 digits, a letter, 1-9 or a letter, Z, a digit or a letter). Admins may
--      update it through the same column-level grant and row policy as the other settings.
--   2. invoices.business_gstin (nullable text): the snapshot, with the same CHECK. Documents issued before this
--      migration have NULL and are NOT changed: they never showed a GSTIN and still do not. The existing freeze trigger
--      already protects the column, because it compares every column of an issued document.
--   3. invoice_settings_guard() - 0036's body with gstin added to the columns whose change moves updated_at.
--   4. issue_invoice_core() (the membership-level document) and issue_payment_document_core() (a payment's tax invoice
--      or payment receipt, and its replacement in a correction) - their latest definitions (0036, 0039) with ONE
--      difference each: business_gstin is copied from the settings row they already lock - by
--      issue_payment_document_core only onto a TAX INVOICE (the invoice series). A payment receipt is not a tax
--      document: it is stored with NULL and never shows a GSTIN.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No invoice, receipt, payment, number, counter, reservation, tax value or cancellation is touched.
--   * Numbering, tax calculation, payment status logic and Cancel and Reissue are unchanged.
--   * The check character of a GSTIN is validated by the application, not by the database.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.invoice_settings') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'invoice_settings' and column_name = 'payment_receipt_prefix') then
    raise exception '0041 needs migration 0036 (payment documents) to be applied first.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'invoices' and column_name = 'status') then
    raise exception '0041 needs migration 0037 (invoice corrections) to be applied first.';
  end if;
  if to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is null
     or pg_get_functiondef(to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)'))
        not like '%A membership invoice already exists for this membership.%' then
    raise exception '0041 needs migration 0039 (duplicate document guard) to be applied first.';
  end if;
end $$;


-- 1. The setting ------------------------------------------------------------------------------------------------

-- The column and its INITIAL value are written together, once: only when the column does not exist yet. A later
-- run finds it and leaves the Admin's value (even a deliberately cleared one) alone.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'invoice_settings' and column_name = 'gstin') then
    alter table public.invoice_settings add column gstin text;

    update public.invoice_settings
    set gstin = '29BPGPP6168E1ZH',
        updated_at = now()
    where singleton;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_gstin_valid') then
    alter table public.invoice_settings
      add constraint invoice_settings_gstin_valid
      check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  end if;
end $$;

comment on column public.invoice_settings.gstin is
  'The centre''s GSTIN (15 characters), or NULL for none. Copied into each document when it is issued (invoices.business_gstin); changing it affects new documents only.';

-- Admins update it like every other setting: this column grant, and the existing admin-only row policy.
grant update (gstin) on public.invoice_settings to authenticated;


-- 2. The snapshot on each document -------------------------------------------------------------------------------

alter table public.invoices
  add column if not exists business_gstin text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_business_gstin_valid') then
    alter table public.invoices
      add constraint invoices_business_gstin_valid
      check (business_gstin is null or business_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  end if;
end $$;

comment on column public.invoices.business_gstin is
  'The GSTIN in force when a TAX INVOICE was issued (invoice_settings.gstin then); NULL when there was none. A payment receipt, which is not a tax document, always has NULL. Frozen with the rest of the document; documents issued before 0041 have NULL.';


-- 3. The settings guard: a GSTIN change moves updated_at --------------------------------------------------------------

create or replace function public.invoice_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.starting_invoice_number is distinct from old.starting_invoice_number then
    if exists (select 1 from public.invoices where document_series = 'invoice') then
      raise exception 'The starting invoice number cannot be changed once an invoice has been issued.'
        using errcode = '55006';
    end if;
    new.next_invoice_number := null;
  end if;

  -- 0036: the payment receipt series - locked once a payment receipt exists; a (re)configuration restarts its counter.
  if new.payment_receipt_starting_number is distinct from old.payment_receipt_starting_number then
    if exists (select 1 from public.invoices where document_series = 'payment_receipt') then
      raise exception 'The starting payment receipt number cannot be changed once a payment receipt has been issued.'
        using errcode = '55006';
    end if;
    new.payment_receipt_next_number := null;
  end if;

  if (new.starting_invoice_number, new.document_title, new.tax_enabled, new.tax_name, new.tax_rate,
      new.terms, new.signatory_name, new.signatory_designation, new.signature_path, new.invoice_prefix,
      new.payment_receipt_starting_number, new.payment_receipt_prefix, new.gstin)
     is distinct from
     (old.starting_invoice_number, old.document_title, old.tax_enabled, old.tax_name, old.tax_rate,
      old.terms, old.signatory_name, old.signatory_designation, old.signature_path, old.invoice_prefix,
      old.payment_receipt_starting_number, old.payment_receipt_prefix, old.gstin) then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.invoice_settings_guard() is
  'Locks starting_invoice_number once an invoice-series document exists and payment_receipt_starting_number once a payment receipt exists, restarts the matching counter when either is (re)configured, and maintains updated_at. Prefixes and the GSTIN are not locked.';


-- 4. Issuing copies the GSTIN ---------------------------------------------------------------------------------------------
-- Each function below is its latest definition (issue_invoice_core: 0036; issue_payment_document_core: 0039) with
-- business_gstin added to the business details it copies, from the settings row it already holds locked (for a payment's
-- document: onto the invoice series only, so a payment receipt carries none).

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
