-- =============================================================================
-- V1 Tax Adjustment - Step 4: payment-level documents and a separate receipt sequence
-- Migration 0036
--
-- 01-product.md §5A "Payment Documents": each payment has its own document. A payment recorded with
-- issue_tax_invoice = true (0035) gets a tax invoice numbered from the EXISTING invoice sequence; one
-- recorded with false gets a clearly identified PAYMENT RECEIPT numbered from its OWN sequence. A tax
-- invoice number is never consumed by a payment receipt, and no number of either series is reused.
--
-- WHERE THE DOCUMENTS LIVE
--   A payment document is a row of public.invoices - the same stored snapshot the membership-level
--   receipt is, so the existing HTML / Print / PDF document is reused - with two new columns:
--     payment_id      - the payment it documents (NULL for a membership-level document);
--     document_series - 'invoice' (the existing sequence) or 'payment_receipt' (the new one).
--   Every existing row is a membership-level document of the invoice series: payment_id NULL,
--   document_series 'invoice' (the column default). No existing row is updated.
--
-- WHAT THIS MIGRATION DOES
--   1. invoices: payment_id and document_series; document_title also allows 'payment_receipt'; a
--      payment receipt must belong to a payment and carry no tax.
--   2. Uniqueness, rebuilt per kind (same index names where an index already existed):
--        invoices_membership_id_unique      - one membership-level document per membership (payment_id NULL);
--        invoices_payment_id_unique         - one document per payment;
--        invoices_invoice_number_unique     - invoice-series numbers unique (as before);
--        invoices_payment_receipt_number_unique - payment-receipt numbers unique.
--   3. payment_receipt_number_reservations - every payment receipt number ever assigned, like 0030's
--      invoice_number_reservations for the invoice series. invoices_reserve_number writes to the
--      table of the document's series.
--   4. invoice_settings: payment_receipt_starting_number (configurable; locked once a payment receipt
--      exists), payment_receipt_next_number (internal counter) and payment_receipt_prefix (optional,
--      same rules as the invoice prefix). Admin may update the starting number and the prefix.
--   5. issue_payment_document(payment, date?) - Admin only. Issues the one document of a payment, in
--      the series its issue_tax_invoice chose, under the same locks as issue_invoice_core (membership
--      row, then settings row) so concurrent issues never share a number.
--   6. The membership-level functions are kept to membership-level documents (payment_id IS NULL):
--        issue_invoice_core  - refuses a membership that has recorded payments; numbers only against
--                              the invoice series;
--        issue_invoice       - its "already issued" check;
--        update_invoice_details - number uniqueness and the starting-number floor within the series;
--        sync_invoice_from_membership - only the membership-level receipt follows the membership;
--                              payment documents are never synchronized;
--        memberships_auto_issue_invoice - issues nothing for a membership with recorded payments;
--        memberships_invoice_guard - only a membership-level document locks status / payment date.
--      Each is the latest definition (0026, 0027, 0030 or 0033) with only those conditions added.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not UPDATE, INSERT or DELETE any existing row (reservations and documents included).
--   * Existing receipts keep their numbers, dates, snapshot and synchronization exactly as before.
--   * No cancellation / correction (Step 6) and no layout change (Step 5).
-- =============================================================================


-- 1. invoices: which payment, which series ----------------------------------------------------------

alter table public.invoices
  add column if not exists payment_id uuid references public.membership_payments (id) on delete restrict;

alter table public.invoices
  add column if not exists document_series text not null default 'invoice';

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_document_series_valid') then
    alter table public.invoices
      add constraint invoices_document_series_valid
      check (document_series in ('invoice', 'payment_receipt'));
  end if;

  -- The title CHECK was created inline (auto-named): found by what it checks and replaced.
  for r in
    select conname
    from pg_constraint
    where contype = 'c'
      and conrelid = 'public.invoices'::regclass
      and pg_get_constraintdef(oid) like '%document_title%'
      and conname <> 'invoices_document_title_valid'
  loop
    execute format('alter table public.invoices drop constraint %I', r.conname);
  end loop;

  if not exists (select 1 from pg_constraint where conname = 'invoices_document_title_valid') then
    alter table public.invoices
      add constraint invoices_document_title_valid
      check (document_title in ('invoice', 'receipt', 'payment_receipt'));
  end if;

  -- A payment receipt documents a payment and carries no tax; only a payment receipt is titled so.
  if not exists (select 1 from pg_constraint where conname = 'invoices_payment_receipt_shape') then
    alter table public.invoices
      add constraint invoices_payment_receipt_shape
      check (
        (document_series = 'payment_receipt') = (document_title = 'payment_receipt')
        and (document_series <> 'payment_receipt' or (payment_id is not null and tax_enabled = false))
      );
  end if;
end $$;

comment on column public.invoices.payment_id is
  'The payment this document documents (V1 Tax Adjustment). NULL for a membership-level document. One document per payment.';

comment on column public.invoices.document_series is
  'The number sequence the document belongs to: invoice (the existing sequence, used for tax invoices and every membership-level document) or payment_receipt (non-tax payment receipts). Numbers are unique and never reused within a series.';


-- 2. Uniqueness per kind -----------------------------------------------------------------------------

drop index if exists public.invoices_membership_id_unique;
create unique index invoices_membership_id_unique
  on public.invoices (membership_id)
  where payment_id is null;

create unique index if not exists invoices_payment_id_unique
  on public.invoices (payment_id)
  where payment_id is not null;

drop index if exists public.invoices_invoice_number_unique;
create unique index invoices_invoice_number_unique
  on public.invoices (invoice_number)
  where document_series = 'invoice';

create unique index if not exists invoices_payment_receipt_number_unique
  on public.invoices (invoice_number)
  where document_series = 'payment_receipt';


-- 3. Payment receipt number reservations --------------------------------------------------------------

create table if not exists public.payment_receipt_number_reservations (
  receipt_number bigint      primary key check (receipt_number > 0),
  invoice_id     uuid        not null
                   references public.invoices (id) on delete restrict
                   deferrable initially deferred,
  reserved_at    timestamptz not null default now()
);

comment on table public.payment_receipt_number_reservations is
  'Every payment receipt number ever assigned. A reserved number is never assigned again. Written only by invoices_reserve_number(); no client access.';

revoke all on public.payment_receipt_number_reservations from anon, authenticated;
alter table public.payment_receipt_number_reservations enable row level security;

create or replace function public.invoices_reserve_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved integer;
begin
  -- OLD exists only for UPDATE; an update that keeps the number consumes nothing new.
  if tg_op = 'UPDATE' then
    if new.invoice_number is not distinct from old.invoice_number then
      return new;
    end if;
  end if;

  -- 0036: each number series has its own reservations. The invoice series keeps 0030's table.
  if new.document_series = 'payment_receipt' then
    insert into public.payment_receipt_number_reservations (receipt_number, invoice_id)
    values (new.invoice_number, new.id)
    on conflict (receipt_number) do nothing;

    get diagnostics v_reserved = row_count;

    if v_reserved = 0 then
      raise exception 'That payment receipt number has already been used and cannot be used again.' using errcode = '23505';
    end if;

    return new;
  end if;

  insert into public.invoice_number_reservations (invoice_number, invoice_id)
  values (new.invoice_number, new.id)
  on conflict (invoice_number) do nothing;

  get diagnostics v_reserved = row_count;

  -- Nothing was added: the number was reserved already, by another receipt or by this one.
  if v_reserved = 0 then
    raise exception 'That invoice number has already been used and cannot be used again.' using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.invoices_reserve_number() is
  'Reserves a document number when it is assigned - in the reservations of the document''s own series - and refuses one already reserved. A number, once assigned, is consumed for good.';


-- 4. Payment receipt numbering settings ------------------------------------------------------------------

alter table public.invoice_settings
  add column if not exists payment_receipt_starting_number bigint,
  add column if not exists payment_receipt_next_number bigint,
  add column if not exists payment_receipt_prefix text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_payment_receipt_numbers_valid') then
    alter table public.invoice_settings
      add constraint invoice_settings_payment_receipt_numbers_valid
      check (
        (payment_receipt_starting_number is null or payment_receipt_starting_number > 0)
        and (
          payment_receipt_next_number is null
          or (payment_receipt_starting_number is not null and payment_receipt_next_number >= payment_receipt_starting_number)
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_payment_receipt_prefix_valid') then
    alter table public.invoice_settings
      add constraint invoice_settings_payment_receipt_prefix_valid
      check (
        payment_receipt_prefix is null
        or (
          length(payment_receipt_prefix) between 1 and 20
          and payment_receipt_prefix !~ '^\s|\s$'
          and payment_receipt_prefix !~ '[0-9]$'
        )
      );
  end if;
end $$;

comment on column public.invoice_settings.payment_receipt_starting_number is
  'The first payment receipt number. NULL = payment receipt numbering not configured. Locked once a payment receipt exists.';
comment on column public.invoice_settings.payment_receipt_next_number is
  'Internal payment receipt counter, maintained only by issue_payment_document(). Not writable by clients.';
comment on column public.invoice_settings.payment_receipt_prefix is
  'Optional prefix shown before a payment receipt number (same rules as invoice_prefix). Copied into each payment receipt when issued.';

grant update (payment_receipt_starting_number, payment_receipt_prefix) on public.invoice_settings to authenticated;

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
      new.payment_receipt_starting_number, new.payment_receipt_prefix)
     is distinct from
     (old.starting_invoice_number, old.document_title, old.tax_enabled, old.tax_name, old.tax_rate,
      old.terms, old.signatory_name, old.signatory_designation, old.signature_path, old.invoice_prefix,
      old.payment_receipt_starting_number, old.payment_receipt_prefix) then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.invoice_settings_guard() is
  'Locks starting_invoice_number once an invoice-series document exists and payment_receipt_starting_number once a payment receipt exists, restarts the matching counter when either is (re)configured, and maintains updated_at. Prefixes are not locked.';


-- 5. Issuing a payment's document ----------------------------------------------------------------------------

create or replace function public.issue_payment_document(
  p_payment_id    uuid,
  p_document_date date default null
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

  if exists (select 1 from public.invoices where payment_id = v_payment.id) then
    raise exception 'A document has already been issued for this payment.' using errcode = '23505';
  end if;

  v_series := case when v_payment.issue_tax_invoice then 'invoice' else 'payment_receipt' end;

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
    service_details, service_details_tracked
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
    public.membership_service_details(v_mem.id), true
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

comment on function public.issue_payment_document(uuid, date) is
  'Admin only. Issues the one document of a payment: a tax invoice from the invoice sequence when the payment chose one, else a payment receipt from its own sequence. The document is a snapshot and never follows later membership edits.';

revoke execute on function public.issue_payment_document(uuid, date) from public, anon;
grant execute on function public.issue_payment_document(uuid, date) to authenticated;


-- 6. Membership-level functions keep to membership-level documents ----------------------------------------------

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
    business_name, business_address, business_phone, business_email, business_logo_path,
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
    v_center.name, v_center.address, v_center.phone, v_center.email, v_logo_path,
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
  'Issues the membership-level invoice for a Paid membership without recorded payments: numbering from the locked counter row (skipping used AND reserved invoice-series numbers), the settings, student, centre, active bank account and service details copied in.';

revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;

create or replace function public.issue_invoice(
  p_membership_id uuid,
  p_payment_date  date default null,
  p_invoice_date  date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem public.memberships%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_mem
  from public.memberships
  where id = p_membership_id
  for update;

  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  if v_mem.payment_status is distinct from 'paid' then
    raise exception 'Only a Paid membership can be invoiced.' using errcode = '55000';
  end if;

  if exists (select 1 from public.invoices where membership_id = v_mem.id and payment_id is null) then
    raise exception 'An invoice has already been issued for this membership.' using errcode = '23505';
  end if;

  if v_mem.payment_date is null then
    if p_payment_date is null then
      raise exception 'Confirm the payment date to issue this invoice.' using errcode = '22023';
    end if;

    -- The membership's payment_date rules (0025) validate it is not in the future.
    update public.memberships
    set payment_date = p_payment_date
    where id = v_mem.id;
  elsif p_payment_date is not null and p_payment_date is distinct from v_mem.payment_date then
    raise exception 'This membership already has a payment date, which cannot be changed.'
      using errcode = '22023';
  end if;

  return public.issue_invoice_core(v_mem.id, p_invoice_date);
end;
$$;

create or replace function public.update_invoice_details(
  p_invoice_id     uuid,
  p_invoice_number bigint,
  p_invoice_date   date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.invoice_settings%rowtype;
  v_invoice  public.invoices%rowtype;
  v_today    date;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_invoice_number is null or p_invoice_number <= 0 then
    raise exception 'The invoice number must be a positive whole number.' using errcode = '22023';
  end if;

  if p_invoice_date is null then
    raise exception 'The invoice date is required.' using errcode = '22023';
  end if;

  select * into v_settings
  from public.invoice_settings
  where singleton
  for update;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if v_invoice.document_series = 'payment_receipt' then
    if v_settings.payment_receipt_starting_number is not null
       and p_invoice_number < v_settings.payment_receipt_starting_number then
      raise exception 'The payment receipt number cannot be below the starting payment receipt number (%).',
        v_settings.payment_receipt_starting_number using errcode = '22023';
    end if;
  elsif v_settings.starting_invoice_number is not null
     and p_invoice_number < v_settings.starting_invoice_number then
    raise exception 'The invoice number cannot be below the starting invoice number (%).',
      v_settings.starting_invoice_number using errcode = '22023';
  end if;

  if exists (
    select 1 from public.invoices
    where invoice_number = p_invoice_number and id <> p_invoice_id
      and document_series = v_invoice.document_series
  ) then
    raise exception 'That invoice number is already in use.' using errcode = '23505';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  if p_invoice_date < v_invoice.payment_date then
    raise exception 'The invoice date cannot be before the payment date.' using errcode = '22023';
  end if;

  if p_invoice_date > v_today then
    raise exception 'The invoice date cannot be in the future.' using errcode = '22023';
  end if;

  if p_invoice_number is distinct from v_invoice.invoice_number
     or p_invoice_date is distinct from v_invoice.invoice_date then
    update public.invoices
    set invoice_number = p_invoice_number,
        invoice_date = p_invoice_date,
        updated_at = now()
    where id = p_invoice_id;
  end if;
end;
$$;

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

create or replace function public.memberships_auto_issue_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start       bigint;
  v_became_paid boolean := true;   -- a Paid INSERT counts as becoming Paid
begin
  -- OLD exists only for UPDATE.
  if tg_op = 'UPDATE' then
    v_became_paid := old.payment_status is distinct from 'paid';
  end if;

  if new.payment_status = 'paid'
     and v_became_paid
     and not exists (select 1 from public.invoices where membership_id = new.id and payment_id is null)
     -- 0036: becoming Paid through recorded payments issues nothing; each payment gets its own document.
     and not exists (select 1 from public.membership_payments where membership_id = new.id) then

    -- Lock the settings row now (the membership row is already locked by this
    -- statement, so the order matches issue_invoice_core) and read the
    -- configuration under that lock.
    select starting_invoice_number into v_start
    from public.invoice_settings
    where singleton
    for update;

    if v_start is not null then
      perform public.issue_invoice_core(new.id, null);
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.memberships_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices where membership_id = old.id and payment_id is null) then
    if old.payment_status = 'paid' and new.payment_status is distinct from 'paid' then
      raise exception 'The payment status cannot be changed after an invoice has been issued.'
        using errcode = '55006';
    end if;

    if new.payment_date is distinct from old.payment_date then
      raise exception 'The payment date cannot be changed after an invoice has been issued.'
        using errcode = '55006';
    end if;
  end if;

  return new;
end;
$$;
