-- V1 Invoice / Receipt Enhancement — Invoice Number Prefix (database foundation).
--
-- An optional text prefix shown in front of an invoice's number: with prefix
-- "INV-" the invoice whose number is 788 reads "INV-788". The displayed number
-- is conceptually `invoice_prefix || invoice_number`.
--
--   * invoices.invoice_number stays a BIGINT and stays the source of truth for
--     sequencing. The prefix is only a display label: it never takes part in
--     numbering, the counter, the starting-number lock or any uniqueness rule.
--     (No unique constraint on prefix + number: invoice_number is already
--     globally unique, which is all that is needed.)
--   * invoice_settings.invoice_prefix is the CURRENT setting. NULL = no prefix.
--     There is deliberately no "enabled" column: prefix OFF is NULL, and turning
--     it on again means entering it again. It is NOT locked once invoices exist —
--     an Admin may change or clear it at any time; it affects future invoices only.
--   * invoices.invoice_prefix is the HISTORICAL SNAPSHOT, copied from the settings
--     when the invoice is issued (issue_invoice_core below — the one function both
--     automatic and manual issuing use). It is read from the same locked
--     settings row as the number, so the two are always consistent.
--   * After issue it can never change: invoices_freeze_snapshot (0026) compares
--     the whole row as jsonb and allows only invoice_number, invoice_date and
--     updated_at, so this column — like every column added later — is protected
--     with no change to that trigger. Editing an invoice's number therefore
--     leaves its prefix alone.
--
-- Existing invoices (the demo invoices 786 and 787 among them) get NULL: a
-- nullable column added without a default is NULL on every existing row, which is
-- exactly "no prefix". Nothing is back-filled and no invoice row is updated.
--
-- The prefix rule, enforced in the database on both tables (the application
-- validates the same rule for a friendly message): NULL, or 1–20 characters,
-- with no leading or trailing whitespace, and not ending in a digit. Internal
-- spaces and every other character are allowed. A trailing digit is refused
-- because it would let two different invoices print the same: prefix "1" with
-- number 23 and no prefix with number 123 would both read "123".
--
-- issue_invoice, update_invoice_details, the freeze / validate / delete
-- triggers, the counter and the tax calculation are untouched.

-- Columns --------------------------------------------------------------------

alter table public.invoice_settings
  add column if not exists invoice_prefix text;

alter table public.invoices
  add column if not exists invoice_prefix text;

comment on column public.invoice_settings.invoice_prefix is
  'Optional text shown before the number of NEW invoices (e.g. INV-). NULL = no prefix. Changeable at any time, even after invoices exist; copied into each invoice when it is issued.';

comment on column public.invoices.invoice_prefix is
  'Snapshot of invoice_settings.invoice_prefix at issue (NULL = no prefix). Displayed number = prefix followed by invoice_number. Never changes after issue; not part of numbering or uniqueness.';

-- Prefix rule (idempotent, like 0024) -----------------------------------------
-- Existing rows are all NULL, so the constraints are satisfied by every row.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_invoice_prefix_valid') then
    alter table public.invoice_settings
      add constraint invoice_settings_invoice_prefix_valid
      check (
        invoice_prefix is null
        or (
          length(invoice_prefix) between 1 and 20
          and invoice_prefix !~ '^\s|\s$'
          and invoice_prefix !~ '[0-9]$'
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'invoices_invoice_prefix_valid') then
    alter table public.invoices
      add constraint invoices_invoice_prefix_valid
      check (
        invoice_prefix is null
        or (
          length(invoice_prefix) between 1 and 20
          and invoice_prefix !~ '^\s|\s$'
          and invoice_prefix !~ '[0-9]$'
        )
      );
  end if;
end $$;

-- Admin write access to the setting ----------------------------------------------
-- 0025 granted UPDATE on invoice_settings column by column (and deliberately not on
-- next_invoice_number). The new column needs its own grant; nothing else changes,
-- and the existing admin-only UPDATE policy applies to it. invoices stays
-- SELECT-only for clients.

grant update (invoice_prefix) on public.invoice_settings to authenticated;

-- Settings guard: a prefix change counts as a configuration change ------------------
-- Identical to 0026's invoice_settings_guard except that invoice_prefix joins the
-- columns whose change moves updated_at. The starting-number lock and the counter
-- reset are unchanged; the prefix is not locked.

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
      new.terms, new.signatory_name, new.signatory_designation, new.signature_path, new.invoice_prefix)
     is distinct from
     (old.starting_invoice_number, old.document_title, old.tax_enabled, old.tax_name, old.tax_rate,
      old.terms, old.signatory_name, old.signatory_designation, old.signature_path, old.invoice_prefix) then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

comment on function public.invoice_settings_guard() is
  'Locks starting_invoice_number once an invoice exists, resets the counter when it is (re)configured, and maintains updated_at. The invoice prefix is not locked.';

-- Issuing: snapshot the prefix ----------------------------------------------------
-- Identical to 0026's issue_invoice_core except that invoice_prefix is copied from
-- the settings row this function already holds locked FOR UPDATE. The counter,
-- the number-skipping loop, the tax calculation, the date rules and the lock
-- order (membership row, then settings row) are exactly as before. Both the
-- automatic trigger and Issue Invoice call this function, so both copy the prefix.

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
    terms, signatory_name, signatory_designation, signature_path,
    invoice_prefix
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
    v_settings.terms, v_settings.signatory_name, v_settings.signatory_designation, v_settings.signature_path,
    v_settings.invoice_prefix
  )
  returning id into v_id;

  update public.invoice_settings
  set next_invoice_number = v_candidate + 1
  where singleton;

  return v_id;
end;
$$;

comment on function public.issue_invoice_core(uuid, date) is
  'Internal. Issues the invoice for a Paid membership: locks the settings row, takes the next unused number, copies the snapshot (including the invoice prefix), advances the counter — one transaction. No client EXECUTE.';

-- CREATE OR REPLACE keeps the function's privileges; restated so the intent is explicit:
-- this internal function is executable by no client role.
revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;
