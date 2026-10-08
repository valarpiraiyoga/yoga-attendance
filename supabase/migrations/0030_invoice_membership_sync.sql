-- =============================================================================
-- V1 Invoice / Receipt — membership synchronization + receipt-number non-reuse
-- Migration 0030
--
-- ADDITIVE. Two changes, no data change to any existing invoice or membership:
--
--  1. A paid membership has exactly ONE receipt, and that receipt FOLLOWS the
--     membership. When a membership's amount, plan, start date or end date is
--     edited, its existing receipt is updated in the same transaction:
--         plan, description, period_start, period_end,
--         total_amount, taxable_amount, tax_amount
--     The tax-inclusive split is recomputed with the receipt's OWN stored tax
--     rate (the terms in force when it was issued). The receipt number, prefix,
--     invoice date, payment date, currency, tax settings and every business /
--     customer / bank / terms / signatory snapshot stay exactly as they were.
--     Nothing here issues a receipt or allocates a number: a second receipt is
--     impossible (invoices_membership_id_unique, and the auto-issue trigger only
--     fires when a membership BECOMES Paid with no receipt).
--
--  2. A receipt number that has ever been assigned can never be assigned to
--     another receipt. invoice_number_reservations records every number the
--     moment it is assigned (issue or edit) and keeps it after the receipt moves
--     to a different number. A number is CONSUMED for good: once assigned it is
--     refused to every receipt - another one, and the receipt that held it too -
--     by a trigger, and the numbering counter skips it.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not UPDATE any row of public.invoices or public.memberships.
--   * It does not renumber, re-date or re-snapshot anything.
--   * The only rows it writes are the new reservation rows for the receipt numbers
--     that already exist (so they count as used).
--
-- SECURITY MODEL
--   * Every function is SECURITY DEFINER with an empty search_path, like the rest
--     of the invoice machinery. No service role is involved.
--   * sync_invoice_from_membership() is callable by NO client role: it is reached
--     only from the membership trigger (itself fired by an Admin-only membership
--     update). Clients still have no UPDATE privilege on invoices.
--   * invoices_freeze_snapshot is NOT weakened for arbitrary updates. The seven
--     synchronized columns may change only while the sync function has marked the
--     transaction for exactly that invoice; every other column is frozen as before.
--
-- RECURSION
--   memberships UPDATE -> memberships_sync_invoice_trigger -> invoices UPDATE
--   -> invoices triggers (freeze, reserve number, validate dates). None of the
--   invoices triggers writes memberships, and the membership trigger is AFTER
--   UPDATE OF amount, plan, start_date, end_date only, so there is no loop.
--
-- FUTURE
--   The Membership Details snapshot (batch / schedule / duration) will be one more
--   column set written by sync_invoice_from_membership() and added to the exempt
--   list in invoices_freeze_snapshot().
-- =============================================================================


-- 1. Receipt-number reservations -------------------------------------------------------------
-- One row per number ever assigned. invoice_id is the receipt that FIRST took the number
-- (history only: it grants no right to take the number again). No audit columns beyond when.

create table if not exists public.invoice_number_reservations (
  invoice_number bigint      primary key check (invoice_number > 0),
  invoice_id     uuid        not null
                   references public.invoices (id) on delete restrict
                   deferrable initially deferred,
  reserved_at    timestamptz not null default now()
);

comment on table public.invoice_number_reservations is
  'Every receipt number ever assigned. A reserved number is never assigned again - not to another receipt, and not to the receipt that held it. Written only by invoices_reserve_number(); no client access.';

-- No client can read or write it: RLS on, no policy, no grants.
revoke all on public.invoice_number_reservations from anon, authenticated;
alter table public.invoice_number_reservations enable row level security;

-- Existing receipt numbers count as used. (Writes only the new table.)
insert into public.invoice_number_reservations (invoice_number, invoice_id)
select invoice_number, id
from public.invoices
on conflict (invoice_number) do nothing;

-- Reserve on assignment; refuse a number that is already reserved - by ANYONE, the receipt
-- that held it included. BEFORE INSERT, and BEFORE UPDATE OF invoice_number. An update that
-- leaves the number as it is does nothing. The PRIMARY KEY makes concurrent claims of the
-- same number safe: the second writer waits for the first to finish, then its insert finds
-- the row and adds nothing, and it is refused.

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
  'Reserves a receipt number when it is assigned and refuses one already reserved - by another receipt or by this one. A number, once assigned, is consumed for good.';

drop trigger if exists invoices_reserve_number_trigger on public.invoices;
create trigger invoices_reserve_number_trigger
  before insert or update of invoice_number on public.invoices
  for each row
  execute function public.invoices_reserve_number();


-- 2. The numbering counter skips reserved numbers ----------------------------------------------
-- issue_invoice_core is 0029's, byte for byte, except the one loop condition: a candidate is
-- skipped when it is reserved (a retired number AHEAD of the counter) as well as when it is held.

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

comment on function public.issue_invoice_core(uuid, date) is
  'Issues the invoice for a Paid membership: numbering from the locked counter row (skipping used AND reserved numbers), the settings, student, centre and active bank account copied in. The only place an invoice is created.';

revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;


-- 3. The freeze, with ONE controlled exception ---------------------------------------------------
-- Always changeable: invoice_number, invoice_date, updated_at (as before).
-- Changeable ONLY while sync_invoice_from_membership() has marked this transaction for this
-- very invoice: the seven columns that follow the membership. Everything else is frozen.

create or replace function public.invoices_freeze_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exempt text[] := array['invoice_number', 'invoice_date', 'updated_at'];
begin
  if current_setting('yoga.invoice_sync', true) = old.id::text then
    v_exempt := v_exempt || array[
      'plan', 'description', 'period_start', 'period_end',
      'total_amount', 'taxable_amount', 'tax_amount'
    ];
  end if;

  if (to_jsonb(new) - v_exempt) is distinct from (to_jsonb(old) - v_exempt) then
    raise exception 'An issued invoice can only change its number and date.' using errcode = '55006';
  end if;
  return new;
end;
$$;

comment on function public.invoices_freeze_snapshot() is
  'Rejects any update to an invoice other than invoice_number, invoice_date and updated_at — plus, only inside sync_invoice_from_membership(), the columns that follow the membership.';


-- 4. Membership -> receipt synchronization -------------------------------------------------------

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

comment on function public.sync_invoice_from_membership(uuid) is
  'Makes a membership''s existing receipt follow it: plan, description, period, and the amounts (tax recomputed with the receipt''s own stored rate). Never issues a receipt, never touches the number, prefix, dates or any snapshot. Callable by no client role.';

revoke execute on function public.sync_invoice_from_membership(uuid) from public, anon, authenticated;

create or replace function public.memberships_sync_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_invoice_from_membership(new.id);
  return null;
end;
$$;

comment on function public.memberships_sync_invoice() is
  'AFTER trigger: after a membership''s amount, plan, start date or end date changes, its receipt (if any) follows. Atomic with the membership save: if the sync fails, the edit fails.';

drop trigger if exists memberships_sync_invoice_trigger on public.memberships;
create trigger memberships_sync_invoice_trigger
  after update of amount, plan, start_date, end_date on public.memberships
  for each row
  when (
    old.amount     is distinct from new.amount
    or old.plan       is distinct from new.plan
    or old.start_date is distinct from new.start_date
    or old.end_date   is distinct from new.end_date
  )
  execute function public.memberships_sync_invoice();
