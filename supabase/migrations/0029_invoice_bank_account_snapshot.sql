-- V1 Invoice / Receipt Enhancement — Invoice bank account snapshot.
--
-- When an invoice is issued, the centre's ACTIVE bank account (0028) is copied into the
-- invoice, so the invoice keeps the bank details it was issued with. This is a snapshot,
-- never a live relationship: there is deliberately NO bank_account_id and no foreign key
-- to bank_accounts, so editing, activating, deactivating — or one day removing — an
-- account cannot change an issued invoice.
--
--   * invoices gains five nullable text columns: bank_name, bank_account_name,
--     bank_account_number, bank_ifsc_code, bank_branch. Existing invoices keep NULL in all
--     five: nothing is back-filled and no existing invoice row is updated (a nullable
--     column added without a default is NULL on every existing row).
--   * issue_invoice_core copies the active account's five details into the new invoice.
--     With no active account the invoice is still issued and the five columns stay NULL.
--     At most one account is active (0028's partial unique index), so the lookup yields
--     zero or one row. The function already holds the invoice_settings row lock FOR UPDATE
--     when it reads the account — the same lock activate_bank_account() and
--     deactivate_bank_account() take — so issuing an invoice and changing the active
--     account are serialised by the one existing lock: an invoice never sees a
--     half-switched state. No second lock is introduced.
--   * The freeze needs no change: invoices_freeze_snapshot (0026) compares the whole row
--     as jsonb and allows only invoice_number, invoice_date and updated_at to change, so
--     these columns — like the prefix and every column added later — are protected from the
--     moment they exist. update_invoice_details (number and date only) is untouched, and
--     invoices still has no client INSERT / UPDATE / DELETE privilege.
--   * A CHECK keeps a snapshot coherent: either no bank detail at all, or the four required
--     details together (the branch stays optional), with the same limits as bank_accounts.
--
-- bank_accounts, its functions and its policies are not touched, and neither is any other
-- invoice behaviour: numbering, the counter, the prefix, tax, dates, the starting-number
-- lock, edit.

-- Columns --------------------------------------------------------------------------

alter table public.invoices
  add column if not exists bank_name           text,
  add column if not exists bank_account_name   text,
  add column if not exists bank_account_number text,
  add column if not exists bank_ifsc_code      text,
  add column if not exists bank_branch         text;

comment on column public.invoices.bank_name is
  'Snapshot of the active bank account''s bank name at issue. NULL when no account was active (and on every invoice issued before bank accounts existed). Never changes after issue.';
comment on column public.invoices.bank_account_name is
  'Snapshot of the active bank account''s account name at issue. NULL together with bank_name.';
comment on column public.invoices.bank_account_number is
  'Snapshot of the active bank account''s account number at issue. NULL together with bank_name.';
comment on column public.invoices.bank_ifsc_code is
  'Snapshot of the active bank account''s IFSC code at issue. NULL together with bank_name.';
comment on column public.invoices.bank_branch is
  'Snapshot of the active bank account''s optional branch at issue. May be NULL even when a snapshot exists.';

-- A coherent snapshot (idempotent, like 0024 / 0027) -----------------------------------
-- No bank detail at all, or the four required details together; the branch only with them.
-- Limits match bank_accounts (0028). Every existing row is all-NULL, so every row passes.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_bank_snapshot_valid') then
    alter table public.invoices
      add constraint invoices_bank_snapshot_valid
      check (
        (
          bank_name is null and bank_account_name is null
          and bank_account_number is null and bank_ifsc_code is null
          and bank_branch is null
        )
        or (
          bank_name is not null and length(btrim(bank_name)) > 0 and length(bank_name) <= 100
          and bank_account_name is not null and length(btrim(bank_account_name)) > 0 and length(bank_account_name) <= 100
          and bank_account_number is not null and length(btrim(bank_account_number)) > 0 and length(bank_account_number) <= 34
          and bank_ifsc_code is not null and length(btrim(bank_ifsc_code)) > 0 and length(bank_ifsc_code) <= 20
          and (bank_branch is null or (length(btrim(bank_branch)) > 0 and length(bank_branch) <= 100))
        )
      );
  end if;
end $$;

-- Issuing: snapshot the active bank account -----------------------------------------------
-- Identical to 0027's issue_invoice_core except that it also reads the active bank account
-- and copies its details into the invoice. The counter, the number-skipping loop, the tax
-- calculation, the prefix, the date rules and the lock order (membership row, then
-- settings row) are exactly as before. The account is read AFTER the settings row has been
-- locked, so it is read under the same lock the bank-account functions take.

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

  -- The active bank account, if there is one (at most one row; none is fine — every field of
  -- v_bank is then NULL and the invoice carries no bank snapshot). Read under the settings lock.
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
  'Internal. Issues the invoice for a Paid membership: locks the settings row, takes the next unused number, copies the snapshot (including the invoice prefix and the active bank account, if any), advances the counter — one transaction. No client EXECUTE.';

-- CREATE OR REPLACE keeps the function's privileges; restated so the intent is explicit:
-- this internal function is executable by no client role.
revoke execute on function public.issue_invoice_core(uuid, date) from public, anon, authenticated;
