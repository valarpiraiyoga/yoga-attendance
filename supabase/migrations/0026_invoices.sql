-- V1 Invoice / Receipt Enhancement — part 2 of 2: invoices.
--
-- Builds on 0025 (memberships.payment_date, invoice_settings). Additive: the
-- only change to existing behaviour is the one the approved design requires —
--   (a) once a membership HAS an invoice, its Paid -> Pending change and its
--       payment_date change are rejected (0025's membership rules are untouched
--       for memberships without an invoice), and
--   (b) replaced centre logo files are no longer deletable, so an issued
--       invoice's logo reference stays valid (see "Storage" below).
--
-- Model (docs/v1/01-v1-business-architecture.md §11A):
--
--   Membership 1 : 0..1 Invoice
--
-- An invoice is a separate stored historical document. When it is issued the
-- values it needs are COPIED into it from the membership, the student, the
-- centre profile and the invoice settings; the only live reference is
-- invoices.membership_id (an identity link — no value is read through it
-- afterwards). Only invoice_number and invoice_date can change after issue.
--
-- V1 has no payment table, partial payments, refunds, credit notes, void
-- workflow or multiple invoices per membership, and none is introduced here.
--
-- SQLSTATE USAGE (so the application can map errors without parsing text):
--   42501  not authorised (not an admin)
--   P0002  membership / invoice / settings row not found
--   22023  invalid value (date, number, missing payment date)
--   23505  duplicate: invoice number in use, or membership already invoiced
--   55000  prerequisite not met: numbering not configured, membership not Paid
--   55006  locked: a rule forbids the change (snapshot, status, payment date,
--          starting number, delete)

-- Invoices --------------------------------------------------------------------

create table if not exists public.invoices (
  id                           uuid primary key default gen_random_uuid(),
  membership_id                uuid not null references public.memberships (id) on delete restrict,

  -- The document's own number and date. Editable after issue (and only these).
  invoice_number               bigint not null check (invoice_number > 0),
  invoice_date                 date not null,

  -- Copied from the membership when issued (membership.payment_date is locked
  -- once an invoice exists, so the two always agree).
  payment_date                 date not null,

  -- Document line (V1: exactly one membership line per invoice).
  document_title               text not null check (document_title in ('invoice', 'receipt')),
  description                  text not null check (length(btrim(description)) > 0),
  plan                         text not null check (plan in ('monthly', 'quarterly', 'custom')),
  period_start                 date not null,
  period_end                   date not null,

  -- Money. total_amount is the membership amount, the customer's final amount.
  currency                     text not null check (currency ~ '^[A-Z]{3}$'),
  total_amount                 numeric(10, 2) not null check (total_amount > 0),

  -- Tax snapshot (tax-inclusive: tax is back-calculated from total_amount).
  tax_enabled                  boolean not null,
  tax_name                     text,
  tax_rate                     numeric(5, 2),
  taxable_amount               numeric(10, 2),
  tax_amount                   numeric(10, 2),

  -- Customer snapshot (from students).
  customer_name                text not null check (length(btrim(customer_name)) > 0),
  customer_code                text not null check (length(btrim(customer_code)) > 0),
  customer_phone               text,
  customer_phone_country_code  text,
  customer_email               text,

  -- Business snapshot (from center_profile). The logo is the object PATH inside
  -- the profile-photos bucket, never a URL.
  business_name                text not null check (length(btrim(business_name)) > 0),
  business_address             text,
  business_phone               text,
  business_email               text,
  business_logo_path           text,

  -- Terms / signatory snapshot (from invoice_settings). The signature is the
  -- object PATH inside the private invoice-assets bucket.
  terms                        text,
  signatory_name               text,
  signatory_designation        text,
  signature_path               text,

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint invoices_period_end_after_start check (period_end >= period_start),
  constraint invoices_invoice_date_not_before_payment_date check (invoice_date >= payment_date),
  -- Tax consistency: disabled = every tax field NULL; enabled = every tax field
  -- present, in range, and taxable + tax = total exactly.
  constraint invoices_tax_consistent check (
    (
      tax_enabled = false
      and tax_name is null and tax_rate is null
      and taxable_amount is null and tax_amount is null
    )
    or (
      tax_enabled = true
      and tax_name is not null and length(btrim(tax_name)) > 0
      and tax_rate is not null and tax_rate > 0 and tax_rate < 100
      and taxable_amount is not null and taxable_amount >= 0
      and tax_amount is not null and tax_amount >= 0
      and taxable_amount + tax_amount = total_amount
    )
  )
);

comment on table public.invoices is
  'A stored, issued Invoice / Receipt. One per membership at most. A historical snapshot: only invoice_number and invoice_date can change after issue. Never deleted.';

comment on column public.invoices.invoice_number is
  'Plain numeric document number, no prefix. Unique, > 0. Generated from invoice_settings (locked counter row); editable only through update_invoice_details().';

comment on column public.invoices.payment_date is
  'Snapshot of memberships.payment_date at issue. The membership''s payment_date is locked once an invoice exists.';

comment on column public.invoices.business_logo_path is
  'Path of the centre logo inside the profile-photos bucket at issue time. Replaced logo files are retained (see 0026 Storage), so the reference stays valid.';

comment on column public.invoices.signature_path is
  'Path of the signature image inside the private invoice-assets bucket at issue time. Objects there are never updated or deleted.';

-- Membership 1 : 0..1 Invoice, and unique document numbers — the database-level
-- guarantees. (Plain unique indexes, like memberships_membership_code_unique.)
create unique index if not exists invoices_membership_id_unique
  on public.invoices (membership_id);

create unique index if not exists invoices_invoice_number_unique
  on public.invoices (invoice_number);

-- Invoice date validation ----------------------------------------------------------
-- invoice_date >= payment_date is the CHECK above. "Not in the future" depends
-- on the clock and the centre timezone, so it cannot be a CHECK; this trigger
-- enforces it on insert and whenever a date changes.

create or replace function public.invoices_validate_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today               date;
  v_invoice_date_changed boolean := true;
  v_payment_date_changed boolean := true;
begin
  if new.invoice_date is null or new.payment_date is null then
    raise exception 'Invoice date and payment date are required.' using errcode = '22023';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  -- OLD exists only for UPDATE.
  if tg_op = 'UPDATE' then
    v_invoice_date_changed := new.invoice_date is distinct from old.invoice_date;
    v_payment_date_changed := new.payment_date is distinct from old.payment_date;
  end if;

  if v_invoice_date_changed and new.invoice_date > v_today then
    raise exception 'The invoice date cannot be in the future.' using errcode = '22023';
  end if;

  if v_payment_date_changed and new.payment_date > v_today then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.invoices_validate_dates() is
  'Rejects an invoice date or payment date that is in the future in the centre timezone.';

drop trigger if exists invoices_validate_dates_trigger on public.invoices;
create trigger invoices_validate_dates_trigger
  before insert or update on public.invoices
  for each row
  execute function public.invoices_validate_dates();

-- Snapshot protection -----------------------------------------------------------------
-- After issue, ONLY invoice_number, invoice_date and updated_at may change.
-- Comparing the whole row as jsonb (minus those three keys) means a column
-- added later is protected automatically. Applies to every caller, including
-- the table owner and definer functions.

create or replace function public.invoices_freeze_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'invoice_number' - 'invoice_date' - 'updated_at')
     is distinct from (to_jsonb(old) - 'invoice_number' - 'invoice_date' - 'updated_at') then
    raise exception 'An issued invoice can only change its number and date.' using errcode = '55006';
  end if;
  return new;
end;
$$;

comment on function public.invoices_freeze_snapshot() is
  'Rejects any update to an invoice other than invoice_number, invoice_date and updated_at: the issued document is a historical snapshot.';

drop trigger if exists invoices_freeze_snapshot_trigger on public.invoices;
create trigger invoices_freeze_snapshot_trigger
  before update on public.invoices
  for each row
  execute function public.invoices_freeze_snapshot();

-- Invoices are never deleted or replaced. No DELETE privilege is granted; this
-- also stops the table owner / service role.

create or replace function public.invoices_prevent_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'An issued invoice cannot be deleted.' using errcode = '55006';
end;
$$;

comment on function public.invoices_prevent_delete() is
  'Invoices are never deleted or replaced in V1.';

drop trigger if exists invoices_prevent_delete_trigger on public.invoices;
create trigger invoices_prevent_delete_trigger
  before delete on public.invoices
  for each row
  execute function public.invoices_prevent_delete();

-- Starting-number lock (invoice_settings) --------------------------------------------------
-- starting_invoice_number may be configured only while no invoice exists; once
-- the first invoice exists it is LOCKED (no raise-only variant). Changing it
-- before then also resets the internal counter so the next number is the new
-- starting number. updated_at moves only when configuration changed, not when
-- the counter alone advances.

create or replace function public.invoice_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.starting_invoice_number is distinct from old.starting_invoice_number then
    if exists (select 1 from public.invoices) then
      raise exception 'The starting invoice number cannot be changed once an invoice has been issued.'
        using errcode = '55006';
    end if;
    new.next_invoice_number := null;
  end if;

  if (new.starting_invoice_number, new.document_title, new.tax_enabled, new.tax_name, new.tax_rate,
      new.terms, new.signatory_name, new.signatory_designation, new.signature_path)
     is distinct from
     (old.starting_invoice_number, old.document_title, old.tax_enabled, old.tax_name, old.tax_rate,
      old.terms, old.signatory_name, old.signatory_designation, old.signature_path) then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.invoice_settings_guard() is
  'Locks starting_invoice_number once an invoice exists, resets the counter when it is (re)configured, and maintains updated_at.';

drop trigger if exists invoice_settings_guard_trigger on public.invoice_settings;
create trigger invoice_settings_guard_trigger
  before update on public.invoice_settings
  for each row
  execute function public.invoice_settings_guard();

-- Issuing -------------------------------------------------------------------------------------
-- issue_invoice_core(): the ONE place an invoice row is created. Internal — no
-- client has EXECUTE; it is reached through the automatic trigger below and the
-- Issue Invoice function.
--
-- NUMBERING (not MAX()+1, not a sequence):
--   1. lock the invoice_settings row FOR UPDATE — concurrent issues and number
--      edits queue behind each other, so two cannot receive the same number;
--   2. candidate = next_invoice_number, or starting_invoice_number the first
--      time;
--   3. skip any number already used (one an Admin moved an invoice to);
--   4. insert the invoice and advance next_invoice_number to candidate + 1 —
--      the same transaction, so a rollback also rolls the counter back and
--      leaves no gap. The unique index is the final protection.
-- Lock order is membership row -> settings row everywhere, so no deadlock.
--
-- TAX (tax-inclusive; the membership amount is the customer's final amount):
--   tax_amount     = round(total_amount * tax_rate / (100 + tax_rate), 2)
--   taxable_amount = total_amount - tax_amount
-- so taxable + tax = total exactly. Disabled tax stores NULL in every tax field.

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
begin
  -- Membership first, then settings: the same order every caller uses.
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

  -- Next free number. The loop only runs when an Admin has moved an invoice
  -- ahead of the counter.
  v_candidate := coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number);
  while exists (select 1 from public.invoices where invoice_number = v_candidate) loop
    v_candidate := v_candidate + 1;
  end loop;

  if v_settings.tax_enabled then
    v_tax_amount := round(v_mem.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2);
    v_taxable := v_mem.amount - v_tax_amount;
  end if;

  -- The logo is stored in center_profile as a full public URL; the invoice
  -- keeps only the object path inside the profile-photos bucket.
  v_logo_path := substring(v_center.logo_url from '/storage/v1/object/public/profile-photos/([^?]+)');

  insert into public.invoices (
    membership_id, invoice_number, invoice_date, payment_date,
    document_title, description, plan, period_start, period_end,
    currency, total_amount,
    tax_enabled, tax_name, tax_rate, taxable_amount, tax_amount,
    customer_name, customer_code, customer_phone, customer_phone_country_code, customer_email,
    business_name, business_address, business_phone, business_email, business_logo_path,
    terms, signatory_name, signatory_designation, signature_path
  )
  values (
    v_mem.id, v_candidate, v_invoice_date, v_mem.payment_date,
    v_settings.document_title,
    -- Same wording as the existing on-demand receipt (lib/status.js PLAN).
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
    v_settings.terms, v_settings.signatory_name, v_settings.signatory_designation, v_settings.signature_path
  )
  returning id into v_id;

  update public.invoice_settings
  set next_invoice_number = v_candidate + 1
  where singleton;

  return v_id;
end;
$$;

comment on function public.issue_invoice_core(uuid, date) is
  'Internal. Issues the invoice for a Paid membership: locks the settings row, takes the next unused number, copies the snapshot, advances the counter — one transaction. No client EXECUTE.';

-- Automatic issuing: AFTER trigger on memberships -------------------------------------------
-- When a membership BECOMES Paid (a Paid insert, or a status change to Paid), no
-- invoice exists for it and numbering is configured, issue its invoice in the
-- same transaction as the membership save. invoice_date defaults to the payment
-- date. With numbering unconfigured it does nothing, so the existing save
-- behaviour is unchanged. Saving an already-Paid membership again never issues
-- anything — that is the explicit Issue Invoice function's job.

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
     and not exists (select 1 from public.invoices where membership_id = new.id) then

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

comment on function public.memberships_auto_issue_invoice() is
  'AFTER trigger: issues the invoice when a membership becomes Paid, if none exists and numbering is configured. Atomic with the membership save.';

drop trigger if exists memberships_auto_issue_invoice_trigger on public.memberships;
create trigger memberships_auto_issue_invoice_trigger
  after insert or update of payment_status on public.memberships
  for each row
  execute function public.memberships_auto_issue_invoice();

-- Membership guards once an invoice exists ---------------------------------------------------------
-- BEFORE UPDATE. Named so it sorts before memberships_payment_rules_trigger
-- (0025) and sees the values the client sent.
--   * Paid -> anything else is rejected (no void / refund / credit note in V1);
--   * payment_date cannot change (keeps it equal to invoices.payment_date).
-- A membership without an invoice is untouched by this trigger.

create or replace function public.memberships_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices where membership_id = old.id) then
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

comment on function public.memberships_invoice_guard() is
  'Once a membership has an invoice: rejects Paid -> Pending and any payment_date change. No effect on memberships without an invoice.';

drop trigger if exists memberships_invoice_guard_trigger on public.memberships;
create trigger memberships_invoice_guard_trigger
  before update of payment_status, payment_date on public.memberships
  for each row
  execute function public.memberships_invoice_guard();

-- Issue Invoice (manual) -----------------------------------------------------------------------------
-- For a Paid membership that has no invoice — typically one that was Paid before
-- this enhancement and so has no payment_date. Admin only.
--   * If the membership has no payment_date, the Admin MUST supply one; it is
--     written to the membership, and the invoice copies the same value.
--   * If it already has one, that date is used. A different p_payment_date is
--     rejected (the date is not overwritten).
--   * p_invoice_date defaults to the payment date; it may not be before it or
--     in the future (centre calendar).
-- Everything happens in one transaction: any failure leaves the membership
-- unchanged.

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

  if exists (select 1 from public.invoices where membership_id = v_mem.id) then
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

comment on function public.issue_invoice(uuid, date, date) is
  'Admin only. Issues the invoice for a Paid membership without one; supplies/confirms the payment date for memberships that were Paid before the enhancement. One transaction.';

-- Limited invoice edit ----------------------------------------------------------------------------------
-- The ONLY way to change an issued invoice, and only its number and date. Admin
-- only. Number: positive integer, unique, not below the starting number.
-- Date: not before the payment date, not in the future. A number moved ahead of
-- the counter is skipped by later issues; a freed number is never reused
-- automatically. Takes the settings lock so it serialises with issuing.

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

  if v_settings.starting_invoice_number is not null
     and p_invoice_number < v_settings.starting_invoice_number then
    raise exception 'The invoice number cannot be below the starting invoice number (%).',
      v_settings.starting_invoice_number using errcode = '22023';
  end if;

  if exists (
    select 1 from public.invoices
    where invoice_number = p_invoice_number and id <> p_invoice_id
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

comment on function public.update_invoice_details(uuid, bigint, date) is
  'Admin only. The only edit of an issued invoice: its number and date.';

-- Function privileges ----------------------------------------------------------------------------------------
-- Same convention as 0021/0024: revoke from public/anon, grant to authenticated;
-- each function checks is_admin() itself. issue_invoice_core is internal and is
-- granted to nobody.

revoke execute on function public.issue_invoice(uuid, date, date) from public, anon;
revoke execute on function public.update_invoice_details(uuid, bigint, date) from public, anon;
revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;

grant execute on function public.issue_invoice(uuid, date, date) to authenticated;
grant execute on function public.update_invoice_details(uuid, bigint, date) to authenticated;

-- Table privileges and RLS (invoices) ---------------------------------------------------------------------------
-- Admin SELECT only. No client INSERT / UPDATE / DELETE: every write goes
-- through the definer functions above. Instructors have no access.

revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;

alter table public.invoices enable row level security;

drop policy if exists "invoices_select_admin" on public.invoices;
create policy "invoices_select_admin"
  on public.invoices
  for select
  using (public.is_admin());

-- No insert, update or delete policy exists, and none of those privileges is granted.

-- Storage: historical assets ----------------------------------------------------------------------------------------
-- An invoice records storage PATHS. For those to stay valid:
--
-- 1. Centre logo. 0019 lets an admin delete any object in profile-photos, and
--    the application deletes the old logo when it is replaced or removed. That
--    would break every issued invoice that references it. The delete policy
--    now excludes the center/ folder (where only the logo lives), so replaced
--    logo files are retained. Student, instructor and batch photos keep their
--    existing delete behaviour. (An orphaned logo file is harmless; the
--    application's delete is best-effort and already tolerates failure.)

drop policy if exists "profile_photos_delete_admin" on storage.objects;
create policy "profile_photos_delete_admin"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and public.is_admin()
    and (storage.foldername(name))[1] is distinct from 'center'
  );

-- 2. Signature. A private bucket: signatures are read through signed URLs by
--    admins, not publicly. Admins may upload and read; there is NO update and
--    NO delete policy, so an uploaded signature is permanent and a replacement
--    is simply a new object (invoice_settings.signature_path points at it).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoice-assets',
  'invoice-assets',
  false,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "invoice_assets_select_admin" on storage.objects;
create policy "invoice_assets_select_admin"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'invoice-assets' and public.is_admin());

drop policy if exists "invoice_assets_insert_admin" on storage.objects;
create policy "invoice_assets_insert_admin"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'invoice-assets' and public.is_admin());

-- No update policy and no delete policy on invoice-assets.
