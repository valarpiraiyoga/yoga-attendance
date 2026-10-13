-- =============================================================================
-- V1 Fee Structure: package catalogue and fee history (FS-2)
-- Migration 0046
--
-- ADDITIVE. Five new tables that hold what the centre sells and what it charged, and nothing else
-- (01-product.md §5 "Packages and Fee Structure", §11 "Packages and Fees"):
--
--   1. packages                     - a package: name, optional description, type (duration or class_count),
--                                     class allowance (class_count only) and status (active or inactive).
--   2. package_duration_options     - which duration options a duration package offers (monthly, quarterly,
--                                     half_yearly, annual, custom). Custom months are chosen per membership, so
--                                     only the fact that Custom is offered is stored.
--   3. package_fee_entries          - the effective-dated fee history of a package: the monthly base fee of a
--                                     duration package, or the price of a class-count package, in one currency.
--   4. package_fee_entry_discounts  - the package discounts (fixed amount or percentage) of one duration fee entry,
--                                     for quarterly, half_yearly and annual. Monthly never has one; Custom uses the
--                                     discount of a standard duration, whether or not that duration is offered.
--   5. package_events               - the audit trail of every package and fee change: who, when, before, after, and
--                                     the reason where one is required.
--
-- APPROVED DECISIONS APPLIED
--   * A fee correction cancels the original entry and appends a linked replacement (corrects_entry_id); the history
--     is never overwritten. A scheduled entry (not yet in effect) can be edited or cancelled; an entry in effect can
--     only be cancelled or corrected.
--   * A reason is required to correct a fee, and to cancel a fee that is in effect (package_events checks it); it is
--     optional for scheduling, editing and cancelling a scheduled fee.
--   * Package names are required, trimmed, 2 to 100 characters, and unique ignoring case across active AND inactive
--     packages. A description is optional, at most 500 characters.
--   * No package deletion in V1: deactivation preserves history. Nothing here can delete a package.
--   * A package's type cannot change once it is referenced: the options, the fee entries (and, in a later phase, the
--     memberships) reference packages (id, kind), so changing kind fails while any of them exists.
--   * Currency lives on each fee entry. It is never converted; the function that schedules an entry (a later phase)
--     stamps the centre's currency.
--   * No global cap on the monthly fee: the final calculated fee is validated against memberships.amount in a later
--     phase.
--
-- ACCESS
--   * Row-level security is on for all five tables, every privilege is revoked from public, anon and authenticated,
--     and authenticated gets SELECT only, through an Admin-only policy (public.is_admin(), 0002) - the same shape as
--     membership_payment_edits (0038). An Instructor can read nothing.
--   * No client holds INSERT, UPDATE or DELETE: every write goes through database functions added in a later phase.
--   * History is protected by triggers (the 0045 pattern) that refuse ordinary statements from EVERY role, including the
--     table owner: events never change; a fee entry in effect cannot be edited; a cancelled entry is final; entries and
--     packages are never deleted; the discounts of an entry in effect (or cancelled) never change; none of the tables
--     can be truncated. They do NOT stop someone who owns a table (or is a superuser) from deliberately disabling or
--     replacing the triggers or their functions, or from dropping a table, and the server-only service key keeps its
--     table privileges (the triggers still apply to it). This is protection against mistakes and ad-hoc statements, not
--     against a deliberate owner.
--   * An event must name who made the change (actor, required on INSERT; it may become null later only when that user
--     account is deleted), must reference a fee entry of its OWN package (composite foreign key), and a fee_cancelled
--     event's in_effect flag is checked against the fee entry and the centre's date by the trigger, not trusted.
--
-- AUDIT LIMITATION
--   * This migration does NOT guarantee that an audit event exists for every change. It checks every event that is
--     written (shape, reasons, actor, entry, the in_effect flag), but it cannot force one to be written: a cancellation
--     or a correction made by an ad-hoc statement leaves no event. The FS-3 functions must write exactly one event for
--     each change, in the same transaction, and FS-3's acceptance criteria require it (04-development-plan.md).
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not INSERT, UPDATE or DELETE any row, alter any existing table, function, trigger or policy, or edit any
--     earlier migration. Memberships, payments, documents and attendance are untouched.
--   * It adds no function a client can call. The write functions (FS-3), the membership link, fee resolution, the
--     fee-conflict check and the create-from-package function (FS-5) come later. Nothing reads these tables yet.
--
-- ORDER OF WRITES (for the functions of a later phase)
--   * Uniqueness is immediate, not deferred. A correction must cancel the old entry BEFORE it inserts the replacement:
--     only a cancelled entry frees its date in package_fee_entries_package_date_unique. Changing the dates of two
--     scheduled entries so that they swap needs a temporary date in between. A cancellation must stamp cancelled_at with
--     now() (the transaction time), not clock_timestamp(): the guard compares it with now().
--
-- RE-RUNNING
--   * Re-run this file as ONE transaction (begin; ... commit;), so a failure leaves nothing half-applied and the guard
--     triggers, which are dropped and re-created, are never missing for other sessions. It writes no row, so it is safe
--     with data present. It is NOT a repair tool: CREATE TABLE IF NOT EXISTS skips a table that already exists, even
--     one whose columns or constraints differ, so after ANY re-run run verify_0046_packages_and_fee_history.sql and
--     read every FAIL before trusting the schema.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0046 needs migration 0002 (public.is_admin) to be applied first.';
  end if;
  if to_regprocedure('public.centre_timezone()') is null then
    raise exception '0046 needs migration 0024 (public.centre_timezone) to be applied first.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'center_profile' and column_name = 'currency') then
    raise exception '0046 needs migration 0024 (center_profile.currency) to be applied first.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception '0046 needs the Supabase auth schema (auth.users).';
  end if;
end $$;


-- 1. packages -------------------------------------------------------------------------------------------------

create table if not exists public.packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  -- duration (a period of time, chosen by duration option) or class_count (a number of classes). The same two values
  -- as memberships.kind (0042), so a later phase can reference packages (id, kind) from memberships.
  kind          text not null,
  -- The class allowance: set for a class_count package, null for a duration package.
  total_classes integer,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,

  constraint packages_kind_valid check (kind in ('duration', 'class_count')),
  constraint packages_status_valid check (status in ('active', 'inactive')),
  constraint packages_name_valid
    check (name = regexp_replace(name, '^\s+|\s+$', '', 'g') and char_length(name) between 2 and 100),
  constraint packages_description_valid
    check (description is null
           or (description = regexp_replace(description, '^\s+|\s+$', '', 'g') and char_length(description) between 1 and 500)),
  constraint packages_total_classes_by_kind
    check ((kind = 'class_count' and total_classes is not null and total_classes > 0)
           or (kind = 'duration' and total_classes is null)),
  -- The target of the composite foreign keys that protect the package type.
  constraint packages_id_kind_key unique (id, kind)
);

comment on table public.packages is
  'A package the centre sells (V1 Fee Structure): duration-based or class-count. Deactivated, never deleted; its type cannot change once the options, fee entries or memberships reference it. Written only by database functions.';

-- One name, whatever its case, among active and inactive packages alike.
create unique index if not exists packages_name_unique
  on public.packages (lower(name));


-- 2. package_duration_options ---------------------------------------------------------------------------------

create table if not exists public.package_duration_options (
  package_id      uuid not null,
  -- Always duration: only a duration package offers duration options. With the composite foreign key below this
  -- also stops a package's type changing while it has options.
  package_kind    text not null default 'duration',
  duration_option text not null,

  constraint package_duration_options_pkey primary key (package_id, duration_option),
  constraint package_duration_options_kind_valid check (package_kind = 'duration'),
  constraint package_duration_options_option_valid
    check (duration_option in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom')),
  constraint package_duration_options_package_fkey
    foreign key (package_id, package_kind) references public.packages (id, kind)
    on update no action on delete restrict
);

comment on table public.package_duration_options is
  'The duration options a duration package offers. Edited in place by database functions, with an audit event; changes apply to future purchases only.';


-- 3. package_fee_entries --------------------------------------------------------------------------------------

create table if not exists public.package_fee_entries (
  id                uuid primary key default gen_random_uuid(),
  package_id        uuid not null,
  package_kind      text not null,
  -- The first day the fee applies. A membership is priced with the entry in effect on its START date.
  effective_from    date not null,
  -- ISO 4217 code, as on center_profile and memberships (0024). Never converted.
  currency          text not null,
  -- A duration package's monthly base fee, or a class-count package's price: exactly one, by the package type.
  monthly_fee       numeric(10, 2),
  price             numeric(10, 2),
  -- A correction cancels the entry it replaces and links to it. One replacement per entry.
  corrects_entry_id uuid,
  cancelled_at      timestamptz,
  cancelled_by      uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id) on delete set null,

  constraint package_fee_entries_package_fkey
    foreign key (package_id, package_kind) references public.packages (id, kind)
    on update no action on delete restrict,
  constraint package_fee_entries_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint package_fee_entries_amount_by_kind
    check ((package_kind = 'duration' and monthly_fee is not null and monthly_fee > 0 and price is null)
           or (package_kind = 'class_count' and price is not null and price > 0 and monthly_fee is null)),
  -- cancelled_by may become null later (its user account was deleted), but never exists without cancelled_at.
  constraint package_fee_entries_cancelled_consistent check (cancelled_by is null or cancelled_at is not null),
  constraint package_fee_entries_corrects_not_self check (corrects_entry_id is null or corrects_entry_id <> id),
  -- Targets of the foreign keys from the discounts (entry kind) and from a correction (same package).
  constraint package_fee_entries_id_kind_key unique (id, package_kind),
  constraint package_fee_entries_package_id_key unique (package_id, id),
  constraint package_fee_entries_corrects_fkey
    foreign key (package_id, corrects_entry_id) references public.package_fee_entries (package_id, id)
    on delete restrict
);

comment on table public.package_fee_entries is
  'The effective-dated fee history of a package. An entry in effect is never edited: a correction cancels it and appends a linked replacement. Written only by database functions.';

-- No two live entries of a package share a date, so the fee in force on any date is unambiguous. Currency is not part
-- of the key: the same date in two currencies would be just as ambiguous. A cancelled entry frees its date.
create unique index if not exists package_fee_entries_package_date_unique
  on public.package_fee_entries (package_id, effective_from)
  where cancelled_at is null;

-- An entry has at most one replacement: the correction history is a chain, never a fork.
create unique index if not exists package_fee_entries_corrects_unique
  on public.package_fee_entries (corrects_entry_id)
  where corrects_entry_id is not null;

-- Finding the entry in effect on a start date.
create index if not exists package_fee_entries_package_effective_idx
  on public.package_fee_entries (package_id, effective_from desc);


-- 4. package_fee_entry_discounts ------------------------------------------------------------------------------

create table if not exists public.package_fee_entry_discounts (
  entry_id        uuid not null,
  -- Always duration: only a duration entry has package discounts.
  entry_kind      text not null default 'duration',
  -- Monthly never has a package discount, and Custom uses the discount of a standard duration - so only these three.
  -- Deliberately NOT tied to package_duration_options: a discount applies to a Custom duration that maps to this
  -- standard duration even when the package does not offer the standard duration itself.
  duration_option text not null,
  discount_type   text not null,
  fixed_amount    numeric(10, 2),
  percent_value   numeric(5, 2),

  constraint package_fee_entry_discounts_pkey primary key (entry_id, duration_option),
  constraint package_fee_entry_discounts_kind_valid check (entry_kind = 'duration'),
  constraint package_fee_entry_discounts_option_valid
    check (duration_option in ('quarterly', 'half_yearly', 'annual')),
  constraint package_fee_entry_discounts_type_valid check (discount_type in ('fixed', 'percent')),
  constraint package_fee_entry_discounts_shape
    check ((discount_type = 'fixed' and fixed_amount is not null and fixed_amount > 0 and percent_value is null)
           or (discount_type = 'percent' and percent_value is not null and percent_value > 0 and percent_value <= 100
               and fixed_amount is null)),
  constraint package_fee_entry_discounts_entry_fkey
    foreign key (entry_id, entry_kind) references public.package_fee_entries (id, package_kind)
    on update no action on delete restrict
);

comment on table public.package_fee_entry_discounts is
  'The package discounts of one duration fee entry (quarterly, half_yearly, annual). Frozen once the entry is in effect or cancelled. Whether a discount fits within the standard fee depends on the months chosen, so it is checked when a membership is priced.';


-- 5. package_events -------------------------------------------------------------------------------------------

create table if not exists public.package_events (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.packages (id) on delete restrict,
  fee_entry_id  uuid,
  event_type    text not null,
  occurred_at   timestamptz not null default now(),
  -- Required when an event is written (package_events_guard); null afterwards only when that user account is deleted.
  actor         uuid references auth.users (id) on delete set null,
  reason        text,
  -- The state before and after, as JSON objects. A package snapshot (name, description, kind, class allowance, status,
  -- offered options) or a fee entry snapshot (id, effective_from, currency, monthly_fee or price, discounts,
  -- cancelled_at, in_effect, corrects_entry_id), with the package name, so a rename stays traceable.
  before_state  jsonb,
  after_state   jsonb,

  -- The fee entry of an event must belong to the event's OWN package (a null fee_entry_id is not checked).
  constraint package_events_fee_entry_fkey
    foreign key (package_id, fee_entry_id) references public.package_fee_entries (package_id, id)
    on delete restrict,
  constraint package_events_type_valid check (event_type in (
    'package_created', 'details_updated', 'terms_updated', 'package_activated', 'package_deactivated',
    'fee_scheduled', 'fee_edited', 'fee_cancelled', 'fee_corrected')),
  constraint package_events_reason_valid
    check (reason is null or (reason = regexp_replace(reason, '^\s+|\s+$', '', 'g') and char_length(reason) between 3 and 500)),
  constraint package_events_state_objects
    check ((before_state is null or jsonb_typeof(before_state) = 'object')
           and (after_state is null or jsonb_typeof(after_state) = 'object')),
  -- What each kind of event must carry.
  constraint package_events_shape check (
    case
      when event_type = 'package_created' then
        before_state is null and after_state is not null and fee_entry_id is null
      when event_type in ('details_updated', 'terms_updated', 'package_activated', 'package_deactivated') then
        before_state is not null and after_state is not null and fee_entry_id is null
      when event_type = 'fee_scheduled' then
        before_state is null and after_state is not null and fee_entry_id is not null
      when event_type in ('fee_edited', 'fee_corrected') then
        before_state is not null and after_state is not null and fee_entry_id is not null
      when event_type = 'fee_cancelled' then
        before_state is not null and after_state is null and fee_entry_id is not null
      else false
    end),
  -- A correction always needs a reason.
  constraint package_events_correction_reason_required
    check (event_type <> 'fee_corrected' or reason is not null),
  -- Cancelling a fee needs a reason when the fee was in effect; the event says which it was, so the rule cannot be
  -- skipped by leaving the flag out, and package_events_guard checks the flag against the fee entry itself.
  -- (coalesce: a CHECK that evaluates to NULL passes, and a missing flag is NULL.)
  constraint package_events_cancel_flag_required
    check (event_type <> 'fee_cancelled' or coalesce((before_state ->> 'in_effect') in ('true', 'false'), false)),
  constraint package_events_cancel_reason_required
    check (event_type <> 'fee_cancelled' or reason is not null or coalesce((before_state ->> 'in_effect') = 'false', false))
);

comment on table public.package_events is
  'Every change to a package or its fees (V1 Fee Structure): who, when, the state before and after, and the reason where required. Written only by database functions; never updated or deleted. Its rows are checked when written; the table cannot force a row to be written (the functions must).';

create index if not exists package_events_package_idx
  on public.package_events (package_id, occurred_at desc);

create index if not exists package_events_fee_entry_idx
  on public.package_events (fee_entry_id)
  where fee_entry_id is not null;


-- 6. Protection of the history: triggers that refuse ordinary statements from every role --------------------------
-- Every function below is SECURITY DEFINER with an empty search_path, like the rest of the project's guards, and is
-- callable by no client role. SQLSTATE 55006 ("object in use") is the one the earlier history guards raise (0037, 0045).
-- They refuse UPDATE, DELETE and TRUNCATE statements from the table owner too; they cannot stop an owner who disables or
-- replaces them (see the header). Each function branches on the operation with nested IFs, so it never reads NEW in a
-- DELETE or OLD in an INSERT and does not rely on the order boolean operands are evaluated in.

-- None of the five tables can be truncated.
create or replace function public.package_tables_no_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Package tables cannot be truncated.' using errcode = '55006';
end;
$$;

-- packages: never deleted, never re-identified. (Name, description, class allowance and status change through database
-- functions, with an audit event.)
create or replace function public.packages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A package cannot be deleted. Deactivate it instead.' using errcode = '55006';
  end if;

  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'The id and creation time of a package cannot be changed.' using errcode = '55006';
  end if;

  return new;
end;
$$;

create or replace function public.packages_touch_updated_at()
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

-- package_fee_entries: never deleted; created uncancelled; a correction replaces a cancelled entry of the same package;
-- an entry in effect (effective_from on or before today at the centre) is never edited and can only be cancelled, with
-- cancelled_at = now(); a cancelled entry is final; a scheduled entry's date, currency and amount can still be edited.
-- The only change an entry in any state accepts besides these is an actor going to null (what ON DELETE SET NULL does
-- when that user account is deleted).
create or replace function public.package_fee_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today        date := (now() at time zone public.centre_timezone())::date;
  v_target       timestamptz;
  v_core_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'A fee entry cannot be deleted. Cancel it instead.' using errcode = '55006';
  end if;

  if tg_op = 'INSERT' then
    if new.cancelled_at is not null or new.cancelled_by is not null then
      raise exception 'A fee entry is created uncancelled.' using errcode = '55006';
    end if;

    if new.corrects_entry_id is not null then
      select e.cancelled_at into v_target
      from public.package_fee_entries e
      where e.id = new.corrects_entry_id
        and e.package_id = new.package_id;

      if not found or v_target is null then
        raise exception 'A correction replaces a cancelled fee entry of the same package.' using errcode = '55006';
      end if;
    end if;

    return new;
  end if;

  -- UPDATE
  if (new.id, new.package_id, new.package_kind, new.created_at, new.corrects_entry_id)
     is distinct from (old.id, old.package_id, old.package_kind, old.created_at, old.corrects_entry_id) then
    raise exception 'The package, creation and correction link of a fee entry cannot be changed.' using errcode = '55006';
  end if;

  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'Who created a fee entry cannot be changed.' using errcode = '55006';
  end if;

  v_core_changed := (new.effective_from, new.currency, new.monthly_fee, new.price)
                    is distinct from (old.effective_from, old.currency, old.monthly_fee, old.price);

  if old.cancelled_at is not null then
    if new.cancelled_at is distinct from old.cancelled_at
       or v_core_changed
       or (new.cancelled_by is distinct from old.cancelled_by and new.cancelled_by is not null) then
      raise exception 'A cancelled fee entry cannot be changed.' using errcode = '55006';
    end if;
    return new;
  end if;

  if new.cancelled_at is not null then
    if v_core_changed then
      raise exception 'A fee entry is cancelled as it is; it cannot be edited in the same step.' using errcode = '55006';
    end if;
    -- The cancellation is stamped with the transaction time, as every other cancellation in the project is (0037).
    if new.cancelled_at <> now() then
      raise exception 'A fee entry is cancelled at the current time.' using errcode = '55006';
    end if;
    return new;
  end if;

  if v_core_changed and old.effective_from <= v_today then
    raise exception 'A fee entry in effect cannot be edited. Correct it instead.' using errcode = '55006';
  end if;

  return new;
end;
$$;

-- package_fee_entry_discounts: the discounts of an entry can change only while the entry is not cancelled and is
-- either not yet in effect or being created in this very transaction (created_at = now(), the transaction's start). The
-- second case lets a correction write its replacement's discounts alongside the replacement, even when the replacement
-- takes effect on a past date; once that transaction is over the discounts are frozen.
create or replace function public.package_fee_entry_discounts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone public.centre_timezone())::date;
  v_entry_id uuid;
  v_entry    record;
begin
  if tg_op = 'DELETE' then
    v_entry_id := old.entry_id;
  else
    v_entry_id := new.entry_id;
  end if;

  if tg_op = 'UPDATE' then
    if new.entry_id is distinct from old.entry_id then
      raise exception 'A discount cannot be moved to another fee entry.' using errcode = '55006';
    end if;
  end if;

  select e.effective_from, e.cancelled_at, e.created_at into v_entry
  from public.package_fee_entries e
  where e.id = v_entry_id;

  if found then
    if v_entry.cancelled_at is not null then
      raise exception 'The discounts of a cancelled fee entry cannot be changed.' using errcode = '55006';
    end if;

    if v_entry.effective_from <= v_today and v_entry.created_at <> now() then
      raise exception 'The discounts of a fee entry in effect cannot be changed. Correct the entry instead.' using errcode = '55006';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- package_events, on INSERT: an event records who made the change (actor is required when it is written), and a
-- fee_cancelled event's in_effect flag must match the fee entry itself - effective_from on or before today at the centre
-- - so the rule "cancelling a fee in effect needs a reason" cannot be dodged by a caller that reports the wrong flag. A
-- missing or malformed flag, a missing entry and an entry of another package are left to the CHECK constraints and the
-- foreign key, which refuse them with their own errors.
-- On UPDATE and DELETE: never changed or deleted. The one allowed change is the actor going to null with every other
-- column exactly as it was - what ON DELETE SET NULL does when that user account is deleted.
create or replace function public.package_events_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today     date := (now() at time zone public.centre_timezone())::date;
  v_flag      text;
  v_effective date;
begin
  if tg_op = 'INSERT' then
    if new.actor is null then
      raise exception 'A package event records who made the change.' using errcode = '23502';
    end if;

    if new.event_type = 'fee_cancelled' then
      v_flag := new.before_state ->> 'in_effect';

      if v_flag in ('true', 'false') then
        select e.effective_from into v_effective
        from public.package_fee_entries e
        where e.id = new.fee_entry_id
          and e.package_id = new.package_id;

        if found then
          if v_flag <> (v_effective <= v_today)::text then
            raise exception 'The in_effect flag of a fee_cancelled event does not match the fee entry.' using errcode = '23514';
          end if;
        end if;
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.actor is not null then
      if new.actor is null then
        if (new.id, new.package_id, new.fee_entry_id, new.event_type, new.occurred_at, new.reason, new.before_state, new.after_state)
           is not distinct from
           (old.id, old.package_id, old.fee_entry_id, old.event_type, old.occurred_at, old.reason, old.before_state, old.after_state) then
          return new;
        end if;
      end if;
    end if;
  end if;

  raise exception 'Package events cannot be changed or deleted.' using errcode = '55006';
end;
$$;

revoke execute on function public.package_tables_no_truncate() from public, anon, authenticated;
revoke execute on function public.packages_guard() from public, anon, authenticated;
revoke execute on function public.packages_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.package_fee_entries_guard() from public, anon, authenticated;
revoke execute on function public.package_fee_entry_discounts_guard() from public, anon, authenticated;
revoke execute on function public.package_events_guard() from public, anon, authenticated;

drop trigger if exists packages_guard_trigger on public.packages;
create trigger packages_guard_trigger
  before update or delete on public.packages
  for each row
  execute function public.packages_guard();

drop trigger if exists packages_touch_updated_at_trigger on public.packages;
create trigger packages_touch_updated_at_trigger
  before update on public.packages
  for each row
  execute function public.packages_touch_updated_at();

drop trigger if exists package_fee_entries_guard_trigger on public.package_fee_entries;
create trigger package_fee_entries_guard_trigger
  before insert or update or delete on public.package_fee_entries
  for each row
  execute function public.package_fee_entries_guard();

drop trigger if exists package_fee_entry_discounts_guard_trigger on public.package_fee_entry_discounts;
create trigger package_fee_entry_discounts_guard_trigger
  before insert or update or delete on public.package_fee_entry_discounts
  for each row
  execute function public.package_fee_entry_discounts_guard();

drop trigger if exists package_events_guard_trigger on public.package_events;
create trigger package_events_guard_trigger
  before insert or update or delete on public.package_events
  for each row
  execute function public.package_events_guard();

drop trigger if exists packages_no_truncate_trigger on public.packages;
create trigger packages_no_truncate_trigger
  before truncate on public.packages
  for each statement
  execute function public.package_tables_no_truncate();

drop trigger if exists package_duration_options_no_truncate_trigger on public.package_duration_options;
create trigger package_duration_options_no_truncate_trigger
  before truncate on public.package_duration_options
  for each statement
  execute function public.package_tables_no_truncate();

drop trigger if exists package_fee_entries_no_truncate_trigger on public.package_fee_entries;
create trigger package_fee_entries_no_truncate_trigger
  before truncate on public.package_fee_entries
  for each statement
  execute function public.package_tables_no_truncate();

drop trigger if exists package_fee_entry_discounts_no_truncate_trigger on public.package_fee_entry_discounts;
create trigger package_fee_entry_discounts_no_truncate_trigger
  before truncate on public.package_fee_entry_discounts
  for each statement
  execute function public.package_tables_no_truncate();

drop trigger if exists package_events_no_truncate_trigger on public.package_events;
create trigger package_events_no_truncate_trigger
  before truncate on public.package_events
  for each statement
  execute function public.package_tables_no_truncate();


-- 7. Access: Admin-only reads, no client writes ---------------------------------------------------------------
-- Per table: RLS on, every privilege revoked, SELECT granted to authenticated, and one policy that lets only an Admin
-- see rows. An Instructor is authenticated, so holds the privilege, but the policy gives them zero rows. No INSERT,
-- UPDATE or DELETE is granted to anyone: writes go through database functions (a later phase).

alter table public.packages enable row level security;
revoke all on public.packages from public, anon, authenticated;
grant select on public.packages to authenticated;
drop policy if exists "packages_select_admin" on public.packages;
create policy "packages_select_admin"
  on public.packages
  for select
  to authenticated
  using (public.is_admin());

alter table public.package_duration_options enable row level security;
revoke all on public.package_duration_options from public, anon, authenticated;
grant select on public.package_duration_options to authenticated;
drop policy if exists "package_duration_options_select_admin" on public.package_duration_options;
create policy "package_duration_options_select_admin"
  on public.package_duration_options
  for select
  to authenticated
  using (public.is_admin());

alter table public.package_fee_entries enable row level security;
revoke all on public.package_fee_entries from public, anon, authenticated;
grant select on public.package_fee_entries to authenticated;
drop policy if exists "package_fee_entries_select_admin" on public.package_fee_entries;
create policy "package_fee_entries_select_admin"
  on public.package_fee_entries
  for select
  to authenticated
  using (public.is_admin());

alter table public.package_fee_entry_discounts enable row level security;
revoke all on public.package_fee_entry_discounts from public, anon, authenticated;
grant select on public.package_fee_entry_discounts to authenticated;
drop policy if exists "package_fee_entry_discounts_select_admin" on public.package_fee_entry_discounts;
create policy "package_fee_entry_discounts_select_admin"
  on public.package_fee_entry_discounts
  for select
  to authenticated
  using (public.is_admin());

alter table public.package_events enable row level security;
revoke all on public.package_events from public, anon, authenticated;
grant select on public.package_events to authenticated;
drop policy if exists "package_events_select_admin" on public.package_events;
create policy "package_events_select_admin"
  on public.package_events
  for select
  to authenticated
  using (public.is_admin());
