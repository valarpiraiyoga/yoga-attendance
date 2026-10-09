-- =============================================================================
-- V1 Tax Adjustment - Step 3: tax invoice preferences
-- Migration 0035
--
-- ADDITIVE. 01-product.md §5A "Tax Invoice Preference":
--   * Tax invoice issuance is enabled by default.
--   * students.tax_invoice_default - the student's default (true unless the owner turns it off).
--   * membership_payments.issue_tax_invoice - the choice made for one payment. The Admin may
--     override the student's default for a payment; that never changes the student's preference.
--     Step 4 reads this value to decide which document a payment gets.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds students.tax_invoice_default boolean NOT NULL DEFAULT true. Every existing student reads
--      true (the system default) through the column default; no row is updated.
--   2. Adds membership_payments.issue_tax_invoice boolean NOT NULL DEFAULT true. A payment recorded
--      before this migration reads true (the system default) the same way.
--   3. Re-creates record_membership_payment with one more, optional argument, p_issue_tax_invoice.
--      Its body is 0034's, byte for byte, except that the payment is stored with
--      coalesce(p_issue_tax_invoice, the student's tax_invoice_default, true). The old three-argument
--      function is dropped so there is one signature only.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No document is issued and nothing about numbering, receipts, tax calculation, payment amounts,
--     balances or payment status changes.
--   * No existing row is updated, inserted or deleted.
-- =============================================================================


-- 1. The student's default --------------------------------------------------------------------------

alter table public.students
  add column if not exists tax_invoice_default boolean not null default true;

comment on column public.students.tax_invoice_default is
  'Whether a payment by this student is documented with a tax invoice by default (V1 Tax Adjustment). Enabled by default. The Admin can override it for one payment (membership_payments.issue_tax_invoice) without changing it. A preference never overrides a legal tax obligation.';


-- 2. The payment's own choice ------------------------------------------------------------------------

alter table public.membership_payments
  add column if not exists issue_tax_invoice boolean not null default true;

comment on column public.membership_payments.issue_tax_invoice is
  'The document decision for this payment: true = tax invoice, false = payment receipt (issued in a later step). Set when the payment is recorded, from the Admin''s choice or else the student''s default.';


-- 3. Recording a payment, with the tax invoice choice ---------------------------------------------------

drop function if exists public.record_membership_payment(uuid, date, jsonb);

create or replace function public.record_membership_payment(
  p_membership_id uuid,
  p_payment_date  date,
  p_methods       jsonb,
  p_issue_tax_invoice boolean default null
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

  -- The payment's own choice: the Admin's override when given, else the student's saved preference,
  -- else the system default (a tax invoice). The student's preference is only read, never changed.
  select coalesce(p_issue_tax_invoice, s.tax_invoice_default, true) into v_issue_tax
  from public.students s
  where s.id = v_mem.student_id;
  v_issue_tax := coalesce(v_issue_tax, p_issue_tax_invoice, true);

  insert into public.membership_payments (membership_id, payment_date, amount, created_by, issue_tax_invoice)
  values (v_mem.id, p_payment_date, v_total, auth.uid(), v_issue_tax)
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

comment on function public.record_membership_payment(uuid, date, jsonb, boolean) is
  'Records a payment (one or more methods) against a membership that is not yet Paid, within its outstanding balance, with its tax invoice choice (the Admin''s override, else the student''s default), and sets the membership''s payment status from its payments. Admin only. The only way payments are written.';

revoke execute on function public.record_membership_payment(uuid, date, jsonb, boolean) from public, anon;
grant execute on function public.record_membership_payment(uuid, date, jsonb, boolean) to authenticated;
