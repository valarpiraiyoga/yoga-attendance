-- =============================================================================
-- V1 Tax Adjustment - Editing a payment before its document is issued
-- Migration 0040
--
-- Migration 0038 let the Admin change the AMOUNT of each existing method of a payment. Correcting a payment
-- usually needs more: its date, the methods used (changed, added or removed), their amounts, their reference IDs
-- and their notes. Until a document is issued for the payment, all of it may be corrected, in one step.
--
-- WHAT THIS MIGRATION DOES
--   1. membership_payment_edits gains previous_payment_date and new_payment_date (both nullable, so every
--      existing row stays valid), so the audit trail also records a change of date.
--   2. edit_payment(payment, payment date, methods) - Admin only, one transaction. Locks the membership, then the
--      payment (the order of record_membership_payment, edit_payment_amount and the document issue); refuses a
--      payment with ANY document; checks the date and the methods with the rules and messages of
--      record_membership_payment; checks the new total against the membership amount less the OTHER payments;
--      replaces the payment's methods and updates its date and amount; writes one audit row holding the previous and
--      new date, amount and methods; and recomputes the membership's payment status and payment date exactly as
--      edit_payment_amount does.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No existing row is inserted, updated or deleted. edit_payment_amount (0038) is left as it is.
--   * The payment's tax invoice choice is not editable here, and a payment WITH a document is never editable:
--     it is corrected by Cancel and Reissue (0037).
--   * The deferred checks of 0034 still guard every write: a payment's methods add up to its amount, and a
--     membership's payments never exceed its amount. The document issue (0038) still re-reads the payment under
--     the membership lock, so an edit and an issue can never interleave.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.membership_payment_edits') is null then
    raise exception '0040 needs migration 0038 (payment amount edits) to be applied first.';
  end if;
  if to_regprocedure('public.edit_payment_amount(uuid, jsonb)') is null then
    raise exception '0040 needs migration 0038 (payment amount edits) to be applied first.';
  end if;
end $$;


-- 1. The audit trail also records the date ------------------------------------------------------------------------

alter table public.membership_payment_edits
  add column if not exists previous_payment_date date,
  add column if not exists new_payment_date date;

comment on column public.membership_payment_edits.previous_payment_date is
  'The payment date before the edit (NULL on edits made before 0040, which only changed amounts).';
comment on column public.membership_payment_edits.new_payment_date is
  'The payment date after the edit (NULL on edits made before 0040, which only changed amounts).';


-- 2. Editing a payment ------------------------------------------------------------------------------------------------
-- p_methods: a JSON array of { "method", "amount", "reference_id"?, "notes"? }, in the order they are to be shown -
-- the same shape record_membership_payment takes. It REPLACES the payment's methods. Returns the payment's id.

create or replace function public.edit_payment(
  p_payment_id   uuid,
  p_payment_date date,
  p_methods      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment   public.membership_payments%rowtype;
  v_mem       public.memberships%rowtype;
  v_today     date;
  v_entry     jsonb;
  v_method    text;
  v_amount    numeric;
  v_reference text;
  v_notes     text;
  v_total     numeric(12, 2) := 0;
  v_other     numeric(12, 2);
  v_previous  jsonb;
  v_new       jsonb := '[]'::jsonb;
  v_status    text;
  v_latest    date;
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

  -- The membership row first (the order every payment write and every document issue takes), then the payment.
  select * into v_mem
  from public.memberships
  where id = v_payment.membership_id
  for update;

  select * into v_payment
  from public.membership_payments
  where id = p_payment_id
  for update;

  -- Once any document exists - issued or cancelled - the payment is part of the record: Cancel and Reissue.
  if exists (select 1 from public.invoices where payment_id = v_payment.id) then
    raise exception 'A document has been issued for this payment, so it cannot be edited.' using errcode = '55006';
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

  -- Validate every entry before writing anything, and build the normalized list as it will be stored.
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

    v_reference := nullif(btrim(coalesce(v_entry ->> 'reference_id', '')), '');
    v_notes := nullif(btrim(coalesce(v_entry ->> 'notes', '')), '');

    v_total := v_total + v_amount;
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'method', v_method, 'amount', round(v_amount, 2), 'reference_id', v_reference, 'notes', v_notes));
  end loop;

  -- The membership amount less what the OTHER payments already cover: this payment's previous amount is available.
  select coalesce(sum(amount), 0) into v_other
  from public.membership_payments
  where membership_id = v_mem.id and id <> v_payment.id;

  if v_total > v_mem.amount - v_other then
    raise exception 'The payment cannot be more than the outstanding balance.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', m.method, 'amount', m.amount, 'reference_id', m.reference_id, 'notes', m.notes) order by m.position),
         '[]'::jsonb)
    into v_previous
  from public.membership_payment_methods m
  where m.payment_id = v_payment.id;

  -- Nothing to record when nothing changes.
  if v_payment.payment_date = p_payment_date and v_previous = v_new then
    return v_payment.id;
  end if;

  -- The methods are replaced, then the payment's date and total: the deferred checks of 0034 see the methods add up
  -- to the payment at commit.
  delete from public.membership_payment_methods where payment_id = v_payment.id;

  insert into public.membership_payment_methods (payment_id, position, method, amount, reference_id, notes)
  select v_payment.id, t.ord::smallint, t.entry ->> 'method', (t.entry ->> 'amount')::numeric,
         t.entry ->> 'reference_id', t.entry ->> 'notes'
  from jsonb_array_elements(v_new) with ordinality as t(entry, ord);

  update public.membership_payments
  set payment_date = p_payment_date,
      amount       = v_total
  where id = v_payment.id;

  insert into public.membership_payment_edits (
    payment_id, edited_by, previous_amount, new_amount, previous_allocations, new_allocations,
    previous_payment_date, new_payment_date
  )
  values (
    v_payment.id, auth.uid(), v_payment.amount, v_total, v_previous, v_new,
    v_payment.payment_date, p_payment_date
  );

  -- The membership's status follows its payments; while Paid, its payment date is the latest payment's date.
  v_status := case when v_other + v_total >= v_mem.amount then 'paid' else 'partially_paid' end;

  select max(payment_date) into v_latest
  from public.membership_payments
  where membership_id = v_mem.id;

  if v_status is distinct from v_mem.payment_status
     or (case when v_status = 'paid' then v_latest end) is distinct from v_mem.payment_date then
    -- Mark this transaction for this one membership: the payments guard (0034) lets the status follow.
    perform set_config('yoga.payment_status_sync', v_mem.id::text, true);

    update public.memberships
    set payment_status = v_status,
        payment_date   = case when v_status = 'paid' then v_latest else null end
    where id = v_mem.id;

    perform set_config('yoga.payment_status_sync', '', true);
  end if;

  return v_payment.id;
end;
$$;

comment on function public.edit_payment(uuid, date, jsonb) is
  'Admin only. Edits a recorded payment - its date and its methods (type, amount, reference ID, notes; added, changed or removed) - while no document exists for it; records the edit in membership_payment_edits and recomputes the membership''s payment status and date.';

revoke execute on function public.edit_payment(uuid, date, jsonb) from public, anon;
grant execute on function public.edit_payment(uuid, date, jsonb) to authenticated;
