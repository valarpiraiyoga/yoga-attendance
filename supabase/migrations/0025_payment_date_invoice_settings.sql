-- V1 Invoice / Receipt Enhancement — part 1 of 2: payment date and settings.
--
-- Additive only (docs/01-product.md §5A, docs/v1/01-v1-business-architecture.md
-- §11A). Nothing here changes an existing column, rule or row:
--
--   * memberships gains ONE nullable column, payment_date. Existing rows stay
--     NULL — including existing Paid rows. No historical date is invented or
--     back-filled: those memberships receive an invoice through the explicit
--     Issue Invoice function added in 0026, where the Admin supplies the date.
--   * invoice_settings is a new singleton configuration table. It is seeded
--     with numbering UNCONFIGURED (starting_invoice_number NULL), which is what
--     keeps automatic issuing (0026) switched off until the client's real
--     starting number is entered. Until then the application behaves exactly as
--     before.
--   * A BEFORE trigger on memberships keeps payment_date consistent with
--     payment_status. The existing Add/Edit Membership form never sends
--     payment_date, so it keeps working unchanged.
--
-- The invoices table, numbering, issuing, snapshot protection and the
-- invoice-related membership guards are 0026.

-- Membership payment date -----------------------------------------------------

alter table public.memberships
  add column if not exists payment_date date;

comment on column public.memberships.payment_date is
  'The date the membership was paid, in the centre calendar. NULL unless payment_status = paid. Defaults to the centre''s today when the membership becomes Paid. NULL on memberships that were already Paid before the Invoice / Receipt enhancement — never back-filled.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_payment_date_only_when_paid') then
    -- Every existing row satisfies this: payment_date was just added, so it is
    -- NULL everywhere.
    alter table public.memberships
      add constraint memberships_payment_date_only_when_paid
      check (payment_status = 'paid' or payment_date is null);
  end if;
end $$;

-- Payment date rules ------------------------------------------------------------
-- BEFORE INSERT / UPDATE OF payment_status, payment_date:
--   * not Paid          -> payment_date becomes NULL (a Pending membership has no
--                          payment date);
--   * becomes Paid      -> a NULL payment_date is set to today in the centre
--                          timezone ("becomes" = a Paid insert, or a status change
--                          from something else to Paid). A membership that is
--                          ALREADY Paid and saved again keeps its date, including
--                          NULL — existing Paid rows are never given a date here;
--   * a payment_date that is set or changed may not be in the future (centre
--     calendar).
-- SQLSTATE 22023 is the project's "invalid value" code (see 0011).

create or replace function public.memberships_payment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today        date;
  v_became_paid  boolean := true;   -- a Paid INSERT counts as becoming Paid
  v_date_changed boolean := true;
begin
  if new.payment_status is distinct from 'paid' then
    new.payment_date := null;
    return new;
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  -- OLD exists only for UPDATE: read it inside this branch, never in an
  -- expression that also runs for INSERT.
  if tg_op = 'UPDATE' then
    v_became_paid := old.payment_status is distinct from 'paid';
    v_date_changed := new.payment_date is distinct from old.payment_date;
  end if;

  if new.payment_date is null and v_became_paid then
    new.payment_date := v_today;
    v_date_changed := true;
  end if;

  if new.payment_date is not null and v_date_changed and new.payment_date > v_today then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  return new;
end;
$$;

comment on function public.memberships_payment_rules() is
  'Keeps memberships.payment_date consistent with payment_status: cleared when not Paid, defaulted to the centre''s today when a membership becomes Paid, never in the future. Never back-fills an already-Paid membership.';

drop trigger if exists memberships_payment_rules_trigger on public.memberships;
create trigger memberships_payment_rules_trigger
  before insert or update of payment_status, payment_date on public.memberships
  for each row
  execute function public.memberships_payment_rules();

-- Invoice / Receipt Settings ----------------------------------------------------
-- A singleton, like center_profile (0018): the `singleton` primary key and
-- CHECK guarantee at most one row. Center name, address, phone, email and logo
-- are NOT stored here — they stay in center_profile and are read when an
-- invoice is issued.
--
-- starting_invoice_number is ADMINISTRATOR configuration. NULL = numbering not
-- configured (no invoice can be issued). It may be set while no invoice exists;
-- 0026 locks it once the first invoice exists.
-- next_invoice_number is INTERNAL numbering state, written only by the
-- invoice-issuing function (0026). Clients are not granted UPDATE on it.

create table if not exists public.invoice_settings (
  singleton                boolean primary key default true,
  starting_invoice_number  bigint,
  next_invoice_number      bigint,
  document_title           text not null default 'invoice',
  tax_enabled              boolean not null default false,
  tax_name                 text,
  tax_rate                 numeric(5, 2),
  terms                    text,
  signatory_name           text,
  signatory_designation    text,
  signature_path           text,
  updated_at               timestamptz not null default now(),

  constraint invoice_settings_is_singleton check (singleton),
  constraint invoice_settings_starting_positive
    check (starting_invoice_number is null or starting_invoice_number > 0),
  constraint invoice_settings_next_positive
    check (next_invoice_number is null or next_invoice_number > 0),
  constraint invoice_settings_next_not_below_starting
    check (
      next_invoice_number is null
      or (starting_invoice_number is not null and next_invoice_number >= starting_invoice_number)
    ),
  constraint invoice_settings_document_title_valid
    check (document_title in ('invoice', 'receipt')),
  constraint invoice_settings_tax_rate_range
    check (tax_rate is null or (tax_rate > 0 and tax_rate < 100)),
  constraint invoice_settings_tax_name_not_blank
    check (tax_name is null or length(btrim(tax_name)) > 0),
  -- Enabled tax needs a name and a rate. Disabled tax may keep them stored, so
  -- toggling it off and on does not lose the configuration.
  constraint invoice_settings_tax_complete
    check (not tax_enabled or (tax_name is not null and tax_rate is not null))
);

comment on table public.invoice_settings is
  'The one Invoice / Receipt configuration record. Settings apply to FUTURE invoices only: values are copied into each invoice when it is issued (0026).';

comment on column public.invoice_settings.starting_invoice_number is
  'Administrator configuration: the first invoice number the application issues. NULL = numbering not configured. Locked once an invoice exists.';

comment on column public.invoice_settings.next_invoice_number is
  'Internal numbering state, maintained only by the invoice-issuing function. NULL until the first invoice is issued. Not writable by clients.';

comment on column public.invoice_settings.document_title is
  'How the document is presented: invoice or receipt. One document type, one title — not two systems.';

comment on column public.invoice_settings.signature_path is
  'Object path of the signature image inside the private invoice-assets bucket (0026). A path, never a URL.';

insert into public.invoice_settings (singleton)
values (true)
on conflict (singleton) do nothing;

-- Table privileges and RLS ---------------------------------------------------------
-- Admin SELECT / UPDATE only: no insert, no delete, nothing for anon.
-- The UPDATE grant is column-level and deliberately leaves out
-- next_invoice_number — only the issuing function (running as the table owner)
-- can move the counter.

revoke all on public.invoice_settings from anon, authenticated;

grant select on public.invoice_settings to authenticated;
grant update (
  starting_invoice_number,
  document_title,
  tax_enabled,
  tax_name,
  tax_rate,
  terms,
  signatory_name,
  signatory_designation,
  signature_path,
  updated_at
) on public.invoice_settings to authenticated;

alter table public.invoice_settings enable row level security;

drop policy if exists "invoice_settings_select_admin" on public.invoice_settings;
create policy "invoice_settings_select_admin"
  on public.invoice_settings
  for select
  using (public.is_admin());

drop policy if exists "invoice_settings_update_admin" on public.invoice_settings;
create policy "invoice_settings_update_admin"
  on public.invoice_settings
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No insert policy, no delete policy, no such privileges.
