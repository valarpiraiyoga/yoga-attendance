-- =============================================================================
-- V1 Tax Adjustment - Step 8: editing a payment's amount before its document is issued
-- Migration 0038
--
-- A recorded payment may be corrected - only its amount, split over its EXISTING methods - while no document
-- has been issued for it. Once any document exists (issued or cancelled), the payment is frozen and corrections
-- go through Cancel and Reissue (0037).
--
-- WHAT THIS MIGRATION DOES
--   1. membership_payment_edits - the audit trail: one row per edit, with who, when, the previous and the new
--      amount, and the previous and new allocation of every method. Admin may read it; nobody writes it but
--      edit_payment_amount(). Nothing in it is ever updated or deleted.
--   2. edit_payment_amount(payment, allocations) - Admin only, one transaction. Locks the membership, then the
--      payment; refuses a payment with any document; takes one positive amount (at most two decimals) for EVERY
--      existing method and nothing else; checks the new total against the membership amount less the OTHER
--      payments; writes the audit row; updates the method amounts and the payment amount; and recomputes the
--      membership's payment status (Partially Paid / Paid) and payment date (the latest payment's date while
--      Paid, else none). Method types, references and notes are never touched.
--   3. issue_payment_document_core - 0037's body with one change: the payment is read again, locked, AFTER the
--      membership and settings rows are locked. An edit holds the membership lock while it changes the
--      payment, so an issue waiting on that lock can no longer go on with the amount it read before.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No existing row is updated, inserted or deleted.
--   * Payment recording, tax preferences, numbering, document layouts and the correction workflow are unchanged.
--   * The deferred checks of 0034 still guard every write: a payment's methods add up to its amount, and a
--     membership's payments never exceed its amount.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.membership_payments') is null then
    raise exception '0038 needs migration 0034 (membership_payments) to be applied first.';
  end if;
  if to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'invoices' and column_name = 'status') then
    raise exception '0038 needs migration 0037 (invoice corrections) to be applied first.';
  end if;
end $$;


-- 1. The audit trail -------------------------------------------------------------------------------------------

create table if not exists public.membership_payment_edits (
  id                   uuid primary key default gen_random_uuid(),
  payment_id           uuid not null references public.membership_payments (id) on delete restrict,
  edited_at            timestamptz not null default now(),
  edited_by            uuid references auth.users (id) on delete set null,
  previous_amount      numeric(10, 2) not null check (previous_amount > 0),
  new_amount           numeric(10, 2) not null check (new_amount > 0),
  previous_allocations jsonb not null check (jsonb_typeof(previous_allocations) = 'array'),
  new_allocations      jsonb not null check (jsonb_typeof(new_allocations) = 'array')
);

comment on table public.membership_payment_edits is
  'Every edit of a recorded payment''s amount (V1 Tax Adjustment, Step 8): who, when, the previous and new amount, and the previous and new amount of each method. Written only by edit_payment_amount(); never updated or deleted.';

create index if not exists membership_payment_edits_payment_id_idx
  on public.membership_payment_edits (payment_id, edited_at);

alter table public.membership_payment_edits enable row level security;

revoke all on public.membership_payment_edits from public, anon, authenticated;
grant select on public.membership_payment_edits to authenticated;

drop policy if exists "membership_payment_edits_select_admin" on public.membership_payment_edits;
create policy "membership_payment_edits_select_admin"
  on public.membership_payment_edits
  for select
  to authenticated
  using (public.is_admin());


-- 2. Editing a payment's amount ------------------------------------------------------------------------------------
-- p_allocations: a JSON array of { "id": <membership_payment_methods.id>, "amount": <new amount> }, one per
-- existing method of the payment. Returns the payment's id.

create or replace function public.edit_payment_amount(
  p_payment_id  uuid,
  p_allocations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment   public.membership_payments%rowtype;
  v_mem       public.memberships%rowtype;
  v_entry     jsonb;
  v_method_id uuid;
  v_amount    numeric;
  v_total     numeric(12, 2) := 0;
  v_count     integer := 0;
  v_methods   integer;
  v_other     numeric(12, 2);
  v_previous  jsonb;
  v_new       jsonb;
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
    raise exception 'A document has been issued for this payment, so its amount cannot be edited.' using errcode = '55006';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Enter an amount for each payment method.' using errcode = '22023';
  end if;

  select count(*) into v_methods
  from public.membership_payment_methods
  where payment_id = v_payment.id;

  -- One amount for every existing method of this payment, each once, and nothing else.
  for v_entry in select value from jsonb_array_elements(p_allocations) loop
    begin
      v_method_id := (v_entry ->> 'id')::uuid;
      v_amount := (v_entry ->> 'amount')::numeric;
    exception when others then
      v_method_id := null;
      v_amount := null;
    end;

    if v_method_id is null
       or not exists (select 1 from public.membership_payment_methods where id = v_method_id and payment_id = v_payment.id) then
      raise exception 'Each amount must belong to one of this payment''s methods.' using errcode = '22023';
    end if;

    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
      raise exception 'Each payment method needs an amount greater than zero, with at most two decimals.' using errcode = '22023';
    end if;

    v_total := v_total + v_amount;
    v_count := v_count + 1;
  end loop;

  if v_count <> v_methods
     or (select count(distinct value ->> 'id') from jsonb_array_elements(p_allocations)) <> v_methods then
    raise exception 'Enter an amount for each payment method, once.' using errcode = '22023';
  end if;

  -- The membership amount less what the OTHER payments already cover: this payment's previous amount is available.
  select coalesce(sum(amount), 0) into v_other
  from public.membership_payments
  where membership_id = v_mem.id and id <> v_payment.id;

  if v_total > v_mem.amount - v_other then
    raise exception 'The payment cannot be more than the outstanding balance.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'method', m.method, 'amount', m.amount) order by m.position), '[]'::jsonb)
    into v_previous
  from public.membership_payment_methods m
  where m.payment_id = v_payment.id;

  -- Nothing to record when nothing changes.
  if v_total = v_payment.amount and not exists (
    select 1
    from jsonb_array_elements(p_allocations) a
    join public.membership_payment_methods m on m.id = (a.value ->> 'id')::uuid
    where m.amount <> (a.value ->> 'amount')::numeric
  ) then
    return v_payment.id;
  end if;

  -- The method amounts, then the payment total: the deferred checks of 0034 see them agree at commit.
  update public.membership_payment_methods m
  set amount = (a.value ->> 'amount')::numeric
  from jsonb_array_elements(p_allocations) a
  where m.id = (a.value ->> 'id')::uuid
    and m.payment_id = v_payment.id;

  update public.membership_payments
  set amount = v_total
  where id = v_payment.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'method', m.method, 'amount', m.amount) order by m.position), '[]'::jsonb)
    into v_new
  from public.membership_payment_methods m
  where m.payment_id = v_payment.id;

  insert into public.membership_payment_edits (payment_id, edited_by, previous_amount, new_amount, previous_allocations, new_allocations)
  values (v_payment.id, auth.uid(), v_payment.amount, v_total, v_previous, v_new);

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

comment on function public.edit_payment_amount(uuid, jsonb) is
  'Admin only. Edits a recorded payment''s amount, split over its existing methods, while no document exists for it; records the edit in membership_payment_edits and recomputes the membership''s payment status and date.';

revoke execute on function public.edit_payment_amount(uuid, jsonb) from public, anon;
grant execute on function public.edit_payment_amount(uuid, jsonb) to authenticated;


-- 3. Issuing: read the payment again once the locks are held --------------------------------------------------------

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
  'Internal. Issues a payment document in the given series (or the series the payment chose), optionally as the replacement of a cancelled one. Reads the payment after taking the membership and settings locks, so a concurrent amount edit can never be issued stale.';

revoke execute on function public.issue_payment_document_core(uuid, date, text, uuid) from public, anon, authenticated;
