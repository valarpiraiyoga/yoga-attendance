-- =============================================================================
-- Payment idempotency - one request ID per payment submission
-- Migration 0065
--
-- WHY
--   Recording a payment could not tell a retry from a new payment. If the Admin submitted a payment, the database
--   recorded it, and the response was then lost (a dropped connection, a timeout), pressing Record Payment again recorded
--   a SECOND payment whenever its amount still fit the outstanding balance. The membership row lock and the balance check
--   (0034/0035) only stop OVERpayment, not a duplicate. Class-count attendance already solves the same problem with a
--   request ID (0043, 0053); this migration gives payment recording the same guarantee.
--
-- WHAT THIS MIGRATION DOES
--   1. membership_payments.request_id uuid - NULLABLE. Existing payments have none, and callers that do not send one yet
--      (see COMPATIBILITY) store none.
--   2. A unique partial index on request_id (non-null values only): one payment per request ID, the backstop for a race.
--   3. Replaces record_membership_payment(uuid, date, jsonb, boolean) with
--      record_membership_payment(uuid, date, jsonb, boolean, uuid) - a fifth, optional argument p_request_id uuid DEFAULT
--      NULL. The four-argument version is DROPPED in this same migration: keeping both would make every call that omits
--      p_request_id ambiguous between the two overloads.
--
-- HOW A REQUEST ID BEHAVES (p_request_id is not null)
--   After the Admin check and the membership row lock - and BEFORE the "already paid" and balance checks - the payment
--   with this request ID is looked up:
--     * none            -> the payment is recorded exactly as before (every check), with the request ID stored on it;
--     * same request    -> nothing is recorded again; the ORIGINAL payment's id is returned. This holds even when that
--                          payment made the membership Paid, so a retry of a full payment is answered, not refused;
--     * another membership, or different details -> refused, SQLSTATE 23505, with its own message (below). Nothing is
--                          recorded.
--   "Same request" means the same membership, payment date, and methods - in the same order, each with the same method,
--   amount, reference ID and notes, normalised exactly as they are stored (references and notes trimmed, empty -> none,
--   amounts to two decimals) - and, when p_issue_tax_invoice is given explicitly, the same tax invoice choice. When it is
--   not given, the stored choice is not compared: it came from the student's default, which may have changed since.
--   A payment that has been EDITED since (edit_payment) no longer matches its original request, so a late retry of that
--   request is refused rather than silently answered with the edited payment.
--
--   The two refusals (both 23505, both new in this migration, distinguishable by their message):
--     'This request ID has already been used for another membership.'
--     'This request ID has already been used for a different payment.'
--
--   Concurrency: two calls with the same request ID for the same membership queue on the membership row lock; the second
--   then finds the first one's payment and replays it. Two calls racing with the same request ID for DIFFERENT memberships
--   take different locks; the unique index stops the second insert, and that collision is reported with the first message.
--
-- COMPATIBILITY (migration-first rollout)
--   p_request_id is optional. A caller that omits it (the application until it is updated, the initial payment of a new
--   membership, older verification scripts calling with 3 or 4 positional arguments) gets exactly the 0035 behaviour, and
--   its payment is stored with request_id NULL - recorded, but without retry protection. A later migration may require
--   the request ID once every caller sends one; this one does not.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No existing row is inserted, updated or deleted; existing payments keep request_id NULL.
--   * The checks, their messages and SQLSTATEs, the inserts, the payment status update and the return type (the payment's
--     uuid) are unchanged. No other function, trigger, policy or grant on another object changes.
--   * Editing payments and issuing documents are not changed: an identical edit is already a no-op (0055), and a second
--     document for a payment is already refused (0037, 0039).
--   * Client roles still cannot write membership_payments directly; this function remains the only writer.
--
-- ROLLBACK (not part of this migration; run manually only if it must be undone)
--   Recreate the four-argument function from 0035 (with its revoke/grant), drop the five-argument one, then
--   drop index public.membership_payments_request_id_key and alter table public.membership_payments drop column
--   request_id. Dropping the column discards the stored request IDs, which only serve retries.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.membership_payments') is null or to_regclass('public.membership_payment_methods') is null then
    raise exception '0065 needs migration 0034 (membership payments) applied first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'membership_payments' and column_name = 'issue_tax_invoice'
  ) then
    raise exception '0065 needs migration 0035 (tax invoice preferences) applied first.';
  end if;
  if to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is null
     and to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean, uuid)') is null then
    raise exception '0065 needs public.record_membership_payment from migration 0035.';
  end if;
  if to_regprocedure('public.centre_timezone()') is null or to_regprocedure('public.is_admin()') is null then
    raise exception '0065 needs public.centre_timezone() and public.is_admin().';
  end if;
end $$;


-- 1. The request ID column and its uniqueness ------------------------------------------------------------------

alter table public.membership_payments
  add column if not exists request_id uuid;

comment on column public.membership_payments.request_id is
  'The request ID of the submission that recorded this payment (0065). A retry of the same request records nothing again and returns this payment. NULL for payments recorded without one (before 0065, or by a caller that does not send one).';

create unique index if not exists membership_payments_request_id_key
  on public.membership_payments (request_id)
  where request_id is not null;


-- 2. Recording a payment, with an optional request ID ------------------------------------------------------------

-- Dropped, not left beside the new one: with both present, a call that omits p_request_id could match either.
drop function if exists public.record_membership_payment(uuid, date, jsonb, boolean);

create or replace function public.record_membership_payment(
  p_membership_id     uuid,
  p_payment_date      date,
  p_methods           jsonb,
  p_issue_tax_invoice boolean default null,
  p_request_id        uuid default null
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
  v_issue_tax  boolean;
  -- 0065: the replay of a request ID.
  v_existing   public.membership_payments%rowtype;
  v_stored     jsonb;
  v_incoming   jsonb;
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

  -- 0065: a request ID that has already recorded a payment. Looked up after the lock (so a concurrent first attempt for
  -- this membership has finished) and BEFORE the "already paid" and balance checks (so the retry of a payment that made
  -- the membership Paid, or used up its balance, is answered with that payment instead of being refused).
  if p_request_id is not null then
    select * into v_existing
    from public.membership_payments
    where request_id = p_request_id;

    if found then
      if v_existing.membership_id <> p_membership_id then
        raise exception 'This request ID has already been used for another membership.' using errcode = '23505';
      end if;

      -- The stored methods, normalised as they were stored, in their order.
      select coalesce(jsonb_agg(jsonb_build_object(
               'method', m.method, 'amount', round(m.amount, 2), 'reference_id', m.reference_id, 'notes', m.notes)
               order by m.position), '[]'::jsonb)
        into v_stored
      from public.membership_payment_methods m
      where m.payment_id = v_existing.id;

      -- The incoming methods, normalised the same way. Anything malformed cannot be the request that was recorded (that
      -- one passed every check), so it simply does not match.
      v_incoming := '[]'::jsonb;
      if p_methods is null or jsonb_typeof(p_methods) <> 'array' then
        v_incoming := null;
      else
        for v_entry in select value from jsonb_array_elements(p_methods) loop
          begin
            v_amount := round((v_entry ->> 'amount')::numeric, 2);
          exception when others then
            v_amount := null;
          end;
          if v_amount is null or jsonb_typeof(v_entry) <> 'object' then
            v_incoming := null;
            exit;
          end if;
          v_incoming := v_incoming || jsonb_build_array(jsonb_build_object(
            'method', v_entry ->> 'method',
            'amount', v_amount,
            'reference_id', nullif(btrim(coalesce(v_entry ->> 'reference_id', '')), ''),
            'notes', nullif(btrim(coalesce(v_entry ->> 'notes', '')), '')));
        end loop;
      end if;

      if p_payment_date is distinct from v_existing.payment_date
         or v_incoming is null
         or v_incoming <> v_stored
         or (p_issue_tax_invoice is not null and p_issue_tax_invoice <> v_existing.issue_tax_invoice) then
        raise exception 'This request ID has already been used for a different payment.' using errcode = '23505';
      end if;

      -- The same request: nothing is recorded again.
      return v_existing.id;
    end if;
  end if;

  -- From here on: the 0035 checks and writes, unchanged, plus the request ID stored with the payment.

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

  -- The payment's own choice: the Admin's override when given, else the student's saved preference,
  -- else the system default (a tax invoice). The student's preference is only read, never changed.
  select coalesce(p_issue_tax_invoice, s.tax_invoice_default, true) into v_issue_tax
  from public.students s
  where s.id = v_mem.student_id;
  v_issue_tax := coalesce(v_issue_tax, p_issue_tax_invoice, true);

  begin
    insert into public.membership_payments (membership_id, payment_date, amount, created_by, issue_tax_invoice, request_id)
    values (v_mem.id, p_payment_date, v_total, auth.uid(), v_issue_tax, p_request_id)
    returning id into v_payment_id;
  exception when unique_violation then
    -- Only request_id can collide (the id is generated). The lookup above saw no payment for it, so a concurrent call
    -- for ANOTHER membership (holding another lock) recorded it first.
    raise exception 'This request ID has already been used for another membership.' using errcode = '23505';
  end;

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

comment on function public.record_membership_payment(uuid, date, jsonb, boolean, uuid) is
  'Records a payment (one or more methods) against a membership that is not yet Paid, within its outstanding balance, with its tax invoice choice (the Admin''s override, else the student''s default), and sets the membership''s payment status from its payments. Admin only. The only way payments are written. 0065: with p_request_id, a repeat of the same request (same membership, date, methods and, when given, tax invoice choice) records nothing and returns the original payment id - even once the membership is Paid; reusing the request ID for another membership or different details is refused (23505). Without p_request_id it behaves as before (no retry protection).';

revoke execute on function public.record_membership_payment(uuid, date, jsonb, boolean, uuid) from public, anon;
grant execute on function public.record_membership_payment(uuid, date, jsonb, boolean, uuid) to authenticated;
