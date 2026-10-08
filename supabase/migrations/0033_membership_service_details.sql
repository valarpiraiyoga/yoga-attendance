-- =============================================================================
-- V1 Membership service details on receipts
-- Migration 0033
--
-- ADDITIVE. A newly issued receipt can carry a structured snapshot of the classes the student
-- attended under the membership: the batch (name, code) and its weekly slots (day, start, end).
-- The document layer turns it into "Hatha Yoga Intermediate / Mon-Fri, 8:15 AM-9:15 AM"; nothing
-- presentational is stored.
--
-- WHAT THIS MIGRATION DOES
--   1. invoices.service_details jsonb NULL, with a CHECK that it is NULL or an object carrying
--      a version and a batches array. Every existing receipt stays NULL: no backfill.
--      invoices.service_details_tracked boolean NOT NULL DEFAULT false: the lineage marker. Receipts
--      that exist when this migration runs read false (the column default, no UPDATE) and so never
--      gain service details; every receipt issued afterwards is stored with true, whether or not
--      any class applied (service_details is then NULL).
--   2. public.membership_service_details(membership_id): an internal helper (no client execute)
--      that returns the snapshot, or NULL when nothing applied.
--   3. issue_invoice_core is 0031's, byte for byte, except that the INSERT also stores
--      service_details and service_details_tracked = true. Numbering, reservations, prefix, bank snapshot, tax and wording are 0031's.
--   4. sync_invoice_from_membership is 0031's, except that for a TRACKED receipt it recomputes
--      service_details when the membership's start date has moved (and ONLY then).
--   5. invoices_freeze_snapshot is 0030's, except that service_details joins the columns the
--      synchronization may change - eight in all.
--
-- APPLICABILITY AT THE MEMBERSHIP START DATE D (the project's own effective-date model)
--   * batch_enrollments: the student's, status 'active', covering D (start <= D, end NULL or >= D).
--   * enrollment_schedules: covering D (start <= D, end NULL or >= D).
--   * schedules (the series' versions): effective_from <= D and effective_until NULL or >= D.
--     schedules.status is NOT checked (a deactivated schedule's effective_until already bounds it,
--     0014), the weekday need not equal D's, and the batch need not be active.
--   * Overlapping versions of one series (nothing forbids them, 0009): the latest effective_from,
--     then the latest created_at, then the latest id. Only a deterministic fallback.
--   * An enrolled batch with no schedule covering D is kept, with no slots.
--
-- ORDER
--   Batches by name, code, id. Slots by day name (monday .. sunday, an explicit CASE - the stored
--   value is text, not a number), then start, then end.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not UPDATE, INSERT or DELETE any row.
--   * No payment, numbering, tax, reservation or synchronization rule of 0030/0031 changes, and
--     the membership trigger is untouched.
-- =============================================================================


-- 1. The snapshot column ------------------------------------------------------------------------

alter table public.invoices
  add column if not exists service_details jsonb;

alter table public.invoices
  drop constraint if exists invoices_service_details_shape;

alter table public.invoices
  add constraint invoices_service_details_shape
  check (
    service_details is null
    or (
      jsonb_typeof(service_details) = 'object'
      and service_details ? 'version'
      and jsonb_typeof(service_details -> 'batches') = 'array'
    )
  );

-- Added with a constant default: existing rows read false without being rewritten or updated.
alter table public.invoices
  add column if not exists service_details_tracked boolean not null default false;

comment on column public.invoices.service_details_tracked is
  'True for a receipt issued with service-details tracking (every receipt issued after migration 0033), false for one that existed before it. Set once at issue and never changed. Only tracked receipts take part in service-details recomputation, so a pre-0033 receipt keeps service_details NULL for good.';

comment on column public.invoices.service_details is
  'Snapshot of the batches and weekly slots that applied at the membership start date, taken when the receipt is issued and recomputed only when the start date changes. Structured data (day names, HH:MM times), never presentation text. NULL when none applied, and for every receipt issued before this column existed.';


-- 2. The internal helper -------------------------------------------------------------------------

create or replace function public.membership_service_details(p_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_start   date;
  v_batches jsonb;
begin
  select m.student_id, m.start_date into v_student, v_start
  from public.memberships m
  where m.id = p_membership_id;

  if not found then
    return null;
  end if;

  with enrolled as (
    select be.id as enrollment_id, be.batch_id
    from public.batch_enrollments be
    where be.student_id = v_student
      and be.status = 'active'
      and be.effective_start_date <= v_start
      and (be.effective_end_date is null or be.effective_end_date >= v_start)
  ),
  slots as (
    -- One version per assigned series: the one in force at D (latest first if several overlap).
    select distinct on (e.batch_id, es.schedule_series_id)
      e.batch_id, sc.day_of_week, sc.start_time, sc.end_time
    from enrolled e
    join public.enrollment_schedules es
      on es.batch_enrollment_id = e.enrollment_id
     and es.effective_start_date <= v_start
     and (es.effective_end_date is null or es.effective_end_date >= v_start)
    join public.schedules sc
      on sc.series_id = es.schedule_series_id
     and sc.batch_id = e.batch_id
     and sc.effective_from <= v_start
     and (sc.effective_until is null or sc.effective_until >= v_start)
    order by e.batch_id, es.schedule_series_id, sc.effective_from desc, sc.created_at desc, sc.id desc
  )
  select jsonb_agg(
           jsonb_build_object(
             'batch_id', b.id,
             'name', b.name,
             'code', b.code,
             'slots', coalesce((
               select jsonb_agg(
                        jsonb_build_object(
                          'day_of_week', s.day_of_week,
                          'start_time', to_char(s.start_time, 'HH24:MI'),
                          'end_time', to_char(s.end_time, 'HH24:MI')
                        )
                        order by
                          case s.day_of_week
                            when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
                            when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6
                            when 'sunday' then 7 else 8
                          end,
                          s.start_time, s.end_time
                      )
               from slots s
               where s.batch_id = b.id
             ), '[]'::jsonb)
           )
           order by b.name, b.code, b.id
         )
    into v_batches
  from public.batches b
  where b.id in (select batch_id from enrolled);

  if v_batches is null then
    return null;
  end if;

  return jsonb_build_object('version', 1, 'as_of', to_char(v_start, 'YYYY-MM-DD'), 'batches', v_batches);
end;
$$;

comment on function public.membership_service_details(uuid) is
  'The batches and weekly slots in force at a membership''s start date, as structured JSON, or NULL when none. Internal: used by issue_invoice_core and sync_invoice_from_membership; callable by no client role.';

revoke execute on function public.membership_service_details(uuid) from public, anon, authenticated;


-- 3. issue_invoice_core and sync_invoice_from_membership ----------------------------------------
-- 0031's bodies. issue_invoice_core differs by the service_details column and value in its INSERT;
-- sync_invoice_from_membership by v_recompute / v_details and the service_details assignment.

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

comment on function public.issue_invoice_core(uuid, date) is
  'Issues the invoice for a Paid membership: numbering from the locked counter row (skipping used AND reserved numbers), the settings, student, centre, active bank account and the membership''s service details copied in. The only place an invoice is created.';

revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;

comment on function public.sync_invoice_from_membership(uuid) is
  'Makes a membership''s existing receipt follow it: plan, description, period, and the amounts (tax recomputed with the receipt''s own stored rate); the service details are recomputed only when the start date moved. Never issues a receipt, never touches the number, prefix, dates or any other snapshot. Callable by no client role.';

revoke execute on function public.sync_invoice_from_membership(uuid) from public, anon, authenticated;


-- 4. The freeze trigger: the eighth synchronized column -----------------------------------------
-- 0030's function, plus 'service_details' in the list the synchronization may change. The general
-- freeze is unchanged: outside sync_invoice_from_membership() the column cannot be edited.

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
      'total_amount', 'taxable_amount', 'tax_amount', 'service_details'
    ];
  end if;

  if (to_jsonb(new) - v_exempt) is distinct from (to_jsonb(old) - v_exempt) then
    raise exception 'An issued invoice can only change its number and date.' using errcode = '55006';
  end if;
  return new;
end;
$$;

comment on function public.invoices_freeze_snapshot() is
  'Rejects any update to an invoice other than invoice_number, invoice_date and updated_at - plus, only inside sync_invoice_from_membership(), the columns that follow the membership (plan, description, period, amounts, service details).';
