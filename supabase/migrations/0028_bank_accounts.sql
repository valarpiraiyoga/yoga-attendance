-- V1 Invoice / Receipt Enhancement — Bank Accounts (database foundation).
--
-- The centre can store several bank accounts and have AT MOST ONE of them active at a
-- time (zero active is valid). A later migration will copy the active account into each
-- invoice when it is issued, so invoices keep their own historical bank details; THIS
-- migration adds only the accounts themselves. It does not touch invoices or
-- issue_invoice_core, and no existing invoice receives any bank detail.
--
--   * bank_accounts: one row per account — bank name, account name, account number,
--     IFSC code (all required) and an optional branch — plus is_active.
--   * "At most one active" is a database guarantee, not a convention: a partial unique
--     index over the active rows. Nothing requires an account to be active.
--   * Clients can create and edit an account's details but can NEVER write is_active:
--     the table's INSERT / UPDATE grants are column-level and leave it out, so new
--     accounts are always inactive. Activation and deactivation happen only through two
--     admin-only security-definer functions.
--   * activate_bank_account() takes the invoice_settings row lock FOR UPDATE — the same lock
--     issue_invoice_core holds while it numbers an invoice — then deactivates the current
--     active account and activates the requested one in one transaction. Two simultaneous
--     activations queue on that lock, and an activation never interleaves with an invoice
--     being issued. The unique index is the final protection. deactivate_bank_account()
--     takes the same lock and never activates anything else.
--   * Admin-only: select / insert / update for admins, nothing for instructors or anon.
--     There is no DELETE privilege or policy: V1 deactivates and reactivates instead.
--
-- Field validation here is deliberately light: required values are not blank, lengths are
-- sensible. Account-number and IFSC format are the application's concern.

-- Table ------------------------------------------------------------------------

create table if not exists public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  bank_name       text not null,
  account_name    text not null,
  account_number  text not null,
  ifsc_code       text not null,
  branch          text,
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint bank_accounts_bank_name_valid
    check (length(btrim(bank_name)) > 0 and length(bank_name) <= 100),
  constraint bank_accounts_account_name_valid
    check (length(btrim(account_name)) > 0 and length(account_name) <= 100),
  constraint bank_accounts_account_number_valid
    check (length(btrim(account_number)) > 0 and length(account_number) <= 34),
  constraint bank_accounts_ifsc_code_valid
    check (length(btrim(ifsc_code)) > 0 and length(ifsc_code) <= 20),
  -- Optional: NULL, or a real value.
  constraint bank_accounts_branch_valid
    check (branch is null or (length(btrim(branch)) > 0 and length(branch) <= 100))
);

comment on table public.bank_accounts is
  'The centre''s bank accounts. At most one is active (partial unique index); zero is valid. Only the activation functions change is_active. Never deleted in V1.';

comment on column public.bank_accounts.is_active is
  'Whether this is the account copied into newly issued invoices. At most one row is true. Written only by activate_bank_account() / deactivate_bank_account().';

-- At most one active account; zero is fine ---------------------------------------
-- A unique index over a constant, restricted to the active rows: a second active row
-- would collide with the first.

create unique index if not exists bank_accounts_one_active
  on public.bank_accounts ((true))
  where is_active;

-- updated_at ---------------------------------------------------------------------

create or replace function public.bank_accounts_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.bank_accounts_touch_updated_at() is
  'Maintains bank_accounts.updated_at on every update, including activation changes.';

drop trigger if exists bank_accounts_touch_updated_at_trigger on public.bank_accounts;
create trigger bank_accounts_touch_updated_at_trigger
  before update on public.bank_accounts
  for each row
  execute function public.bank_accounts_touch_updated_at();

-- Table privileges and RLS ----------------------------------------------------------
-- Admin SELECT / INSERT / UPDATE only; no DELETE for anyone. INSERT and UPDATE are
-- column-level and deliberately leave out is_active (so a client can neither create an
-- active account nor flip the flag), id and the timestamps.

revoke all on public.bank_accounts from anon, authenticated;

grant select on public.bank_accounts to authenticated;
grant insert (bank_name, account_name, account_number, ifsc_code, branch)
  on public.bank_accounts to authenticated;
grant update (bank_name, account_name, account_number, ifsc_code, branch)
  on public.bank_accounts to authenticated;

alter table public.bank_accounts enable row level security;

drop policy if exists "bank_accounts_select_admin" on public.bank_accounts;
create policy "bank_accounts_select_admin"
  on public.bank_accounts
  for select
  using (public.is_admin());

drop policy if exists "bank_accounts_insert_admin" on public.bank_accounts;
create policy "bank_accounts_insert_admin"
  on public.bank_accounts
  for insert
  with check (public.is_admin());

drop policy if exists "bank_accounts_update_admin" on public.bank_accounts;
create policy "bank_accounts_update_admin"
  on public.bank_accounts
  for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy, and no delete privilege.

-- Activation ---------------------------------------------------------------------------
-- SQLSTATE usage as in 0026: 42501 not an admin, P0002 not found.

create or replace function public.activate_bank_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- The same row lock issue_invoice_core holds while it issues an invoice: activations
  -- queue behind each other, and behind an invoice being issued.
  perform 1
  from public.invoice_settings
  where singleton
  for update;

  if not found then
    raise exception 'Invoice settings not found.' using errcode = 'P0002';
  end if;

  perform 1 from public.bank_accounts where id = p_id for update;

  if not found then
    raise exception 'Bank account not found.' using errcode = 'P0002';
  end if;

  -- Deactivate first, then activate: the unique index is never violated.
  update public.bank_accounts
  set is_active = false
  where is_active and id <> p_id;

  update public.bank_accounts
  set is_active = true
  where id = p_id and not is_active;
end;
$$;

comment on function public.activate_bank_account(uuid) is
  'Admin only. Makes one bank account the active one, deactivating the previous active account, in one transaction under the invoice_settings row lock.';

create or replace function public.deactivate_bank_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  perform 1
  from public.invoice_settings
  where singleton
  for update;

  if not found then
    raise exception 'Invoice settings not found.' using errcode = 'P0002';
  end if;

  perform 1 from public.bank_accounts where id = p_id for update;

  if not found then
    raise exception 'Bank account not found.' using errcode = 'P0002';
  end if;

  -- May leave no active account; nothing else is activated.
  update public.bank_accounts
  set is_active = false
  where id = p_id and is_active;
end;
$$;

comment on function public.deactivate_bank_account(uuid) is
  'Admin only. Deactivates a bank account (zero active accounts is valid). Never activates another.';

revoke execute on function public.activate_bank_account(uuid) from public, anon;
revoke execute on function public.deactivate_bank_account(uuid) from public, anon;
grant execute on function public.activate_bank_account(uuid) to authenticated;
grant execute on function public.deactivate_bank_account(uuid) to authenticated;
