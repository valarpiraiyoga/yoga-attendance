-- =============================================================================
-- V1 Tax Adjustment - Step 2: membership payments (installments, mixed methods)
-- Migration 0034
--
-- ADDITIVE. A membership can now be paid in installments, and one payment can combine several
-- payment methods (01-product.md §5 "Payment Status", "Payments").
--
-- WHAT THIS MIGRATION DOES
--   1. memberships.payment_status gains 'partially_paid' (Pending / Partially Paid / Paid).
--   2. public.membership_payments - one row per payment: membership, payment date, amount,
--      created_at, created_by.
--   3. public.membership_payment_methods - one row per method used in a payment: cash, card, UPI,
--      bank transfer or other, its amount, an optional reference ID and optional notes.
--   4. public.record_membership_payment(...) - the ONLY way to record a payment. Admin only. It
--      locks the membership, checks the method allocations add up to the payment and that the
--      payment does not exceed the outstanding balance, writes the payment and its methods, and
--      sets the membership's payment status from the recorded payments:
--        Partially Paid while they are below the amount, Paid once they cover it.
--      Becoming Paid through payments uses the existing path: the membership's payment_date is the
--      date of the payment that completed it, and the existing auto-issue trigger (0026) issues the
--      membership's receipt exactly as when a membership is marked Paid today.
--   5. A guard on memberships with recorded payments: their payment status follows the payments
--      only (it cannot be set by hand, and no membership can be set to Partially Paid by hand), and
--      their amount cannot be edited to a value that would change that status.
--   6. Deferred integrity checks: a payment's method amounts equal its amount, and a membership's
--      payments never exceed its amount - whatever writes them.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not UPDATE, INSERT or DELETE any existing row, and creates no payment for any
--     existing membership. A membership marked Paid before payments existed stays as it is (a
--     payment cannot be recorded against an already-Paid membership).
--   * Payments are not edited or deleted (no grant, no policy): corrections are a later step.
--   * No tax invoice preference, no payment document and no numbering change (later steps).
--   * Receipt issuing, numbering, sync (0030/0031/0033) and the invoice guards are unchanged.
-- =============================================================================


-- 1. Payment status: Pending / Partially Paid / Paid ---------------------------------------------
-- The original CHECK was created inline (auto-named), so it is found by what it checks - the list
-- that includes 'pending' - and replaced by a named one. memberships_payment_date_only_when_paid
-- (0025) does not mention 'pending' and is left alone. Safe to run again.

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where contype = 'c'
      and conrelid = 'public.memberships'::regclass
      and pg_get_constraintdef(oid) like '%payment_status%'
      and pg_get_constraintdef(oid) like '%pending%'
  loop
    execute format('alter table public.memberships drop constraint %I', r.conname);
  end loop;
end
$$;

alter table public.memberships
  add constraint memberships_payment_status_valid
  check (payment_status in ('pending', 'partially_paid', 'paid'));


-- 2. Payments ------------------------------------------------------------------------------------

create table if not exists public.membership_payments (
  id             uuid primary key default gen_random_uuid(),
  membership_id  uuid not null references public.memberships (id) on delete restrict,
  payment_date   date not null,
  amount         numeric(10, 2) not null check (amount > 0),
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id) on delete set null
);

comment on table public.membership_payments is
  'A payment recorded against a membership (V1 Tax Adjustment). A membership can have several (installments). Written only by record_membership_payment(); never edited or deleted in V1.';

create index if not exists membership_payments_membership_id_idx
  on public.membership_payments (membership_id);


-- 3. Payment methods -----------------------------------------------------------------------------

create table if not exists public.membership_payment_methods (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.membership_payments (id) on delete restrict,
  position      smallint not null check (position >= 1),
  method        text not null check (method in ('cash', 'card', 'upi', 'bank_transfer', 'other')),
  amount        numeric(10, 2) not null check (amount > 0),
  reference_id  text check (reference_id is null or (reference_id = btrim(reference_id) and length(reference_id) between 1 and 100)),
  notes         text check (notes is null or (notes = btrim(notes) and length(notes) between 1 and 500)),
  created_at    timestamptz not null default now()
);

comment on table public.membership_payment_methods is
  'How a payment was made: one row per method (cash, card, UPI, bank transfer, other), with its share of the payment and its optional reference ID and notes. The rows of a payment add up to its amount.';

-- The order the methods were entered in: one position per method of a payment.
create unique index if not exists membership_payment_methods_payment_position_unique
  on public.membership_payment_methods (payment_id, position);


-- 4. Access: Admin may read; nobody writes directly ------------------------------------------------

alter table public.membership_payments enable row level security;
alter table public.membership_payment_methods enable row level security;

revoke all on public.membership_payments from public, anon, authenticated;
revoke all on public.membership_payment_methods from public, anon, authenticated;
grant select on public.membership_payments to authenticated;
grant select on public.membership_payment_methods to authenticated;

drop policy if exists "membership_payments_select_admin" on public.membership_payments;
create policy "membership_payments_select_admin"
  on public.membership_payments
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "membership_payment_methods_select_admin" on public.membership_payment_methods;
create policy "membership_payment_methods_select_admin"
  on public.membership_payment_methods
  for select
  to authenticated
  using (public.is_admin());


-- 5. Integrity, whatever writes the rows (checked at commit) --------------------------------------

create or replace function public.membership_payments_check_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id    uuid;
  v_membership_id uuid;
  v_amount        numeric(10, 2);
  v_allocated     numeric(12, 2);
  v_paid          numeric(12, 2);
  v_due           numeric(10, 2);
begin
  -- Each branch reads only the column its own table has.
  if tg_table_name = 'membership_payments' then
    v_payment_id := new.id;
  else
    v_payment_id := new.payment_id;
  end if;

  select p.membership_id, p.amount into v_membership_id, v_amount
  from public.membership_payments p
  where p.id = v_payment_id;

  if not found then
    raise exception 'A payment method must belong to a payment.' using errcode = '23503';
  end if;

  select coalesce(sum(m.amount), 0) into v_allocated
  from public.membership_payment_methods m
  where m.payment_id = v_payment_id;

  if v_allocated <> v_amount then
    raise exception 'The payment methods must add up to the payment amount.' using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.membership_payments p
  where p.membership_id = v_membership_id;

  select amount into v_due from public.memberships where id = v_membership_id;

  if v_paid > v_due then
    raise exception 'The payment cannot be more than the outstanding balance.' using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function public.membership_payments_check_totals() is
  'Deferred check: a payment''s methods add up to its amount, and a membership''s payments never exceed its amount.';

drop trigger if exists membership_payments_check_totals_trigger on public.membership_payments;
create constraint trigger membership_payments_check_totals_trigger
  after insert or update on public.membership_payments
  deferrable initially deferred
  for each row
  execute function public.membership_payments_check_totals();

drop trigger if exists membership_payment_methods_check_totals_trigger on public.membership_payment_methods;
create constraint trigger membership_payment_methods_check_totals_trigger
  after insert or update on public.membership_payment_methods
  deferrable initially deferred
  for each row
  execute function public.membership_payments_check_totals();


-- 6. The payment status of a membership with payments follows its payments ---------------------------
-- BEFORE INSERT OR UPDATE (every column, so an amount-only edit is seen too).
--   * Partially Paid is never set by hand: only record_membership_payment() sets it (it marks the
--     transaction for that one membership).
--   * A membership with recorded payments: its payment status cannot be changed by hand, and its
--     amount cannot change to a value that would change the status the payments give it
--     (below the amount already paid, or - for a Paid one - away from it).
-- A membership without payments is untouched: Pending / Paid are still set as today.

create or replace function public.memberships_payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marked boolean;
  v_paid   numeric(12, 2);
begin
  v_marked := tg_op = 'UPDATE' and current_setting('yoga.payment_status_sync', true) = old.id::text;

  if v_marked then
    return new;
  end if;

  if new.payment_status = 'partially_paid'
     and (tg_op = 'INSERT' or old.payment_status is distinct from 'partially_paid') then
    raise exception 'Partially Paid is set by recording payments.' using errcode = '55006';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(p.amount), 0) into v_paid
    from public.membership_payments p
    where p.membership_id = old.id;

    if v_paid > 0 then
      if new.payment_status is distinct from old.payment_status then
        raise exception 'The payment status follows the recorded payments.' using errcode = '55006';
      end if;

      if new.amount is distinct from old.amount
         and (case when v_paid >= new.amount then 'paid' else 'partially_paid' end) is distinct from old.payment_status then
        raise exception 'The amount cannot change the payment status given by the recorded payments.' using errcode = '55006';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.memberships_payments_guard() is
  'A membership with recorded payments: its payment status follows the payments (never set by hand) and its amount cannot change that status. Partially Paid is set only by record_membership_payment().';

drop trigger if exists memberships_payments_guard_trigger on public.memberships;
create trigger memberships_payments_guard_trigger
  before insert or update on public.memberships
  for each row
  execute function public.memberships_payments_guard();


-- 7. Recording a payment ---------------------------------------------------------------------------
-- p_methods: a JSON array of { "method", "amount", "reference_id"?, "notes"? }.
-- Returns the new payment's id.

create or replace function public.record_membership_payment(
  p_membership_id uuid,
  p_payment_date  date,
  p_methods       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem        public.memberships%rowtype;
  v_today      date;
  v_entry      jsonb;
  v_method     text;
  v_amount     numeric;
  v_reference  text;
  v_notes      text;
  v_total      numeric(12, 2) := 0;
  v_paid       numeric(12, 2);
  v_payment_id uuid;
  v_status     text;
  v_position   integer;
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

  if v_mem.payment_status = 'paid' then
    raise exception 'This membership is already paid.' using errcode = '55000';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  if p_payment_date is null then
    raise exception 'The payment date is required.' using errcode = '22023';
  end if;

  if p_payment_date > v_today then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  if p_methods is null or jsonb_typeof(p_methods) <> 'array' or jsonb_array_length(p_methods) = 0 then
    raise exception 'Add at least one payment method.' using errcode = '22023';
  end if;

  -- Validate every entry before writing anything.
  for v_entry in select value from jsonb_array_elements(p_methods) loop
    v_method := v_entry ->> 'method';
    if v_method is null or v_method not in ('cash', 'card', 'upi', 'bank_transfer', 'other') then
      raise exception 'Select a valid payment method.' using errcode = '22023';
    end if;

    begin
      v_amount := (v_entry ->> 'amount')::numeric;
    exception when others then
      v_amount := null;
    end;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
      raise exception 'Each payment method needs an amount greater than zero, with at most two decimals.' using errcode = '22023';
    end if;

    v_total := v_total + v_amount;
  end loop;

  select coalesce(sum(amount), 0) into v_paid
  from public.membership_payments
  where membership_id = v_mem.id;

  if v_total > v_mem.amount - v_paid then
    raise exception 'The payment cannot be more than the outstanding balance.' using errcode = '22023';
  end if;

  insert into public.membership_payments (membership_id, payment_date, amount, created_by)
  values (v_mem.id, p_payment_date, v_total, auth.uid())
  returning id into v_payment_id;

  for v_entry, v_position in select value, ordinality from jsonb_array_elements(p_methods) with ordinality loop
    v_reference := nullif(btrim(coalesce(v_entry ->> 'reference_id', '')), '');
    v_notes := nullif(btrim(coalesce(v_entry ->> 'notes', '')), '');

    insert into public.membership_payment_methods (payment_id, position, method, amount, reference_id, notes)
    values (v_payment_id, v_position, v_entry ->> 'method', (v_entry ->> 'amount')::numeric, v_reference, v_notes);
  end loop;

  v_status := case when v_paid + v_total >= v_mem.amount then 'paid' else 'partially_paid' end;

  -- Mark this transaction for this one membership: the payments guard lets the status follow.
  perform set_config('yoga.payment_status_sync', v_mem.id::text, true);

  update public.memberships
  set payment_status = v_status,
      payment_date   = case when v_status = 'paid' then p_payment_date else null end
  where id = v_mem.id;

  perform set_config('yoga.payment_status_sync', '', true);

  return v_payment_id;
end;
$$;

comment on function public.record_membership_payment(uuid, date, jsonb) is
  'Records a payment (one or more methods) against a membership that is not yet Paid, within its outstanding balance, and sets the membership''s payment status from its payments. Admin only. The only way payments are written.';

revoke execute on function public.record_membership_payment(uuid, date, jsonb) from public, anon;
grant execute on function public.record_membership_payment(uuid, date, jsonb) to authenticated;

revoke execute on function public.membership_payments_check_totals() from public, anon, authenticated;
revoke execute on function public.memberships_payments_guard() from public, anon, authenticated;
