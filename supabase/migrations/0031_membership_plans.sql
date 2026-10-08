-- =============================================================================
-- V1 Membership plans: Half Yearly and Annual
-- Migration 0031
--
-- ADDITIVE. Two standard plans join Monthly and Quarterly, stored as
-- 'half_yearly' (6 calendar months) and 'annual' (12 calendar months). Existing
-- plan values and every existing row are untouched.
--
-- WHY A MIGRATION
--   memberships.plan and invoices.plan are each guarded by a CHECK that lists the
--   allowed values ('monthly', 'quarterly', 'custom'), so the new values would be
--   rejected - and a Paid half-yearly or annual membership could not even be issued
--   a receipt (the receipt copies the plan). The two CHECKs are widened.
--
-- RECEIPT WORDING
--   A receipt's description is built from the plan when it is issued and when it
--   follows its membership (issue_invoice_core, sync_invoice_from_membership). Both
--   functions are re-created below, identical to 0030 except for two added WHEN
--   lines, so a Half Yearly membership reads "Half Yearly Membership" and an Annual
--   one "Annual Membership" instead of falling through to "Custom duration".
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not UPDATE, INSERT or DELETE any row.
--   * Dropping and re-adding a CHECK validates the existing rows; every existing
--     plan is one of the old values, which the new CHECK still allows.
--   * End dates are calculated by the application (Plan + Start Date), not here.
--   * No payment, receipt-numbering, tax or synchronization rule changes.
-- =============================================================================


-- 1. Widen the plan CHECK constraints ---------------------------------------------------------
-- The existing constraints were created inline (auto-named), so they are found by what they
-- check rather than by name, dropped, and replaced by named ones. Safe to run again.

do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.memberships'::regclass, 'public.invoices'::regclass)
      and pg_get_constraintdef(oid) like '%plan%'
      and pg_get_constraintdef(oid) like '%monthly%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end
$$;

alter table public.memberships
  add constraint memberships_plan_valid
  check (plan in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom'));

alter table public.invoices
  add constraint invoices_plan_valid
  check (plan in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom'));


-- 2. Receipt wording for the new plans --------------------------------------------------------
-- issue_invoice_core and sync_invoice_from_membership are 0030's, byte for byte, except the two
-- added WHEN lines in the description wording.

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

  if exists (select 1 from public.invoices where membership_id = v_mem.id) then
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
     or exists (select 1 from public.invoices where invoice_number = v_candidate) loop
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
    bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch
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
    v_bank.bank_name, v_bank.account_name, v_bank.account_number, v_bank.ifsc_code, v_bank.branch
  )
  returning id into v_id;

  update public.invoice_settings
  set next_invoice_number = v_candidate + 1
  where singleton;

  return v_id;
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

  if v_inv.plan is distinct from v_mem.plan
     or v_inv.description is distinct from v_description
     or v_inv.period_start is distinct from v_mem.start_date
     or v_inv.period_end is distinct from v_mem.end_date
     or v_inv.total_amount is distinct from v_mem.amount
     or v_inv.taxable_amount is distinct from v_taxable
     or v_inv.tax_amount is distinct from v_tax_amount then

    -- Mark this transaction for this one invoice; the freeze trigger honours it for the
    -- seven columns below and nothing else. Transaction-local.
    perform set_config('yoga.invoice_sync', v_inv.id::text, true);

    update public.invoices
    set plan           = v_mem.plan,
        description    = v_description,
        period_start   = v_mem.start_date,
        period_end     = v_mem.end_date,
        total_amount   = v_mem.amount,
        taxable_amount = v_taxable,
        tax_amount     = v_tax_amount,
        updated_at     = now()
    where id = v_inv.id;

    perform set_config('yoga.invoice_sync', '', true);
  end if;
end;
$$;

comment on function public.issue_invoice_core(uuid, date) is
  'Issues the invoice for a Paid membership: numbering from the locked counter row (skipping used AND reserved numbers), the settings, student, centre and active bank account copied in. The only place an invoice is created.';

revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;

comment on function public.sync_invoice_from_membership(uuid) is
  'Makes a membership''s existing receipt follow it: plan, description, period, and the amounts (tax recomputed with the receipt''s own stored rate). Never issues a receipt, never touches the number, prefix, dates or any snapshot. Callable by no client role.';

revoke execute on function public.sync_invoice_from_membership(uuid) from public, anon, authenticated;
