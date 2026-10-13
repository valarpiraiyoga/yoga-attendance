-- =============================================================================
-- V1 Fee Structure: package and fee functions (FS-3)
-- Migration 0047
--
-- ADDITIVE. Functions only: no table, column, constraint, trigger or policy is created or changed, and no row is written
-- by this migration. It adds the ONLY way an Admin can change the package catalogue that 0046 created (0046 grants no
-- client INSERT, UPDATE or DELETE). Every function is SECURITY DEFINER with an empty search_path, checks
-- public.is_admin() first (SQLSTATE 42501), locks the package row (so two Admins cannot collide), changes data, and
-- writes EXACTLY ONE audit event for the change in the same transaction - or, when nothing changed, no event at all.
--
--   create_package(name, description, kind, total_classes, options)        -> package_created
--   update_package_details(package, name, description)                      -> details_updated
--   update_package_terms(package, total_classes, options, reason)          -> terms_updated   (future purchases only)
--   set_package_status(package, status, reason)                            -> package_activated / package_deactivated
--   schedule_fee_entry(package, effective_from, amount, discounts, reason) -> fee_scheduled
--   edit_fee_entry(entry, effective_from, amount, discounts, reason)       -> fee_edited      (a scheduled fee only)
--   cancel_fee_entry(entry, reason)                                        -> fee_cancelled   (reason required if in effect)
--   correct_fee_entry(entry, amount, discounts, reason)                    -> fee_corrected   (a fee in effect; reason required)
--
-- RULES (01-product.md §5 "Packages and Fee Structure", 04-development-plan.md "FS-3 acceptance criteria")
--   * Currency is stamped from the centre profile when a fee is scheduled or edited; no function takes a currency. A
--     correction keeps the currency of the fee it corrects. Nothing is converted.
--   * A duration package always keeps at least one offered option; a class-count package has none. Class-count packages
--     have a class allowance and no package discounts. A duration entry's discounts are for quarterly, half_yearly and
--     annual only, each at most once, fixed or percentage (the value is checked here and again by 0046's constraints).
--   * A correction CANCELS the fee in effect first and then appends the linked replacement (same package, same effective
--     date, same currency, corrects_entry_id), because uniqueness of live dates is immediate: only a cancelled entry frees
--     its date. The replacement's discounts and the single fee_corrected event follow in the same transaction. A
--     correction that changes neither the amount nor the discounts is refused, and everything it did is rolled back.
--   * A cancellation is stamped with now() (the transaction time), as 0046's guard requires, and its event says
--     truthfully whether the fee was in effect (the 0046 trigger checks the flag against the entry and the centre date).
--   * Scheduling an entry may use a date of today or earlier (it is then in effect at once). Editing a scheduled entry
--     must keep its date after today, so an edit never turns it into an entry in effect whose discounts are then frozen.
--   * A package that is inactive can still have fees scheduled: deactivation only blocks new purchases (FS-5).
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No fee-conflict check: it needs package-linked memberships, which do not exist until FS-5 (approved). Until then
--     nothing can conflict, so cancelling or correcting a fee in effect is allowed; FS-5 re-creates cancel_fee_entry and
--     correct_fee_entry with the check and its tests.
--   * It does not resolve a fee for a start date, price a membership, or link anything to a membership.
--   * It does not guarantee an audit event for a change made by an ad-hoc statement outside these functions (0046's
--     AUDIT LIMITATION): that guarantee is these functions' job, and is why each writes its event itself.
--   * The helper functions below are internal: callable by no client role.
--
-- RE-RUNNING: every statement is CREATE OR REPLACE, REVOKE or GRANT, so it is safe to run again, as one transaction. Run
-- verify_0047_package_fee_functions_behavior.sql afterwards.
-- =============================================================================


-- 0. Preconditions --------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.packages') is null
     or to_regclass('public.package_duration_options') is null
     or to_regclass('public.package_fee_entries') is null
     or to_regclass('public.package_fee_entry_discounts') is null
     or to_regclass('public.package_events') is null
     or to_regprocedure('public.package_events_guard()') is null then
    raise exception '0047 needs migration 0046 (package catalogue and fee history) to be applied first.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0047 needs migration 0002 (public.is_admin) to be applied first.';
  end if;
  if to_regprocedure('public.centre_timezone()') is null then
    raise exception '0047 needs migration 0024 (public.centre_timezone) to be applied first.';
  end if;
end $$;


-- 1. Internal helpers (callable by no client role) --------------------------------------------------------------

-- Trimmed text, or NULL when nothing is left.
create or replace function public.package_trim(p_text text)
returns text
language sql
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_text, ''), '^\s+|\s+$', '', 'g'), '');
$$;

-- An optional reason: trimmed, NULL when empty, otherwise 3 to 500 characters (the events table checks the same).
create or replace function public.package_clean_reason(p_reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := public.package_trim(p_reason);
begin
  if v_reason is not null and char_length(v_reason) not between 3 and 500 then
    raise exception 'The reason must be 3 to 500 characters.' using errcode = '22023';
  end if;
  return v_reason;
end;
$$;

-- The offered duration options: distinct, sorted, every one a known option.
create or replace function public.package_clean_options(p_options text[])
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_options text[];
begin
  select coalesce(array_agg(distinct u.o order by u.o), '{}') into v_options
  from unnest(coalesce(p_options, '{}')) as u(o);

  if exists (select 1 from unnest(v_options) as u(o)
             where u.o is null or u.o not in ('monthly', 'quarterly', 'half_yearly', 'annual', 'custom')) then
    raise exception 'Select valid duration options.' using errcode = '22023';
  end if;

  return v_options;
end;
$$;

-- A money amount: greater than 0, at most two decimals, within numeric(10,2).
create or replace function public.package_check_amount(p_amount numeric)
returns numeric
language plpgsql
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 100000000 then
    raise exception 'Enter an amount greater than 0, with at most two decimal places.' using errcode = '22023';
  end if;
  return p_amount;
end;
$$;

-- Today at the centre: the same date 0046's guards use for "in effect".
create or replace function public.package_today()
returns date
language sql
set search_path = ''
as $$
  select (now() at time zone public.centre_timezone())::date;
$$;

-- A package as an audit snapshot: name, description, type, class allowance, status and offered options.
create or replace function public.package_snapshot(p_package_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name,
    'description', p.description,
    'kind', p.kind,
    'total_classes', p.total_classes,
    'status', p.status,
    'options', coalesce((select jsonb_agg(o.duration_option order by o.duration_option)
                         from public.package_duration_options o
                         where o.package_id = p.id), '[]'::jsonb))
  from public.packages p
  where p.id = p_package_id;
$$;

-- A fee entry as an audit snapshot, with the package name, its discounts and whether it is in effect today at the centre.
create or replace function public.package_fee_entry_snapshot(p_entry_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'package_id', e.package_id,
    'package_name', p.name,
    'effective_from', e.effective_from,
    'currency', e.currency,
    'monthly_fee', e.monthly_fee,
    'price', e.price,
    'discounts', coalesce((select jsonb_agg(jsonb_build_object(
                                     'option', d.duration_option,
                                     'type', d.discount_type,
                                     'value', coalesce(d.fixed_amount, d.percent_value))
                                   order by d.duration_option)
                           from public.package_fee_entry_discounts d
                           where d.entry_id = e.id), '[]'::jsonb),
    'cancelled_at', e.cancelled_at,
    'in_effect', e.effective_from <= public.package_today(),
    'corrects_entry_id', e.corrects_entry_id)
  from public.package_fee_entries e
  join public.packages p on p.id = e.package_id
  where e.id = p_entry_id;
$$;

-- Replaces the discounts of one fee entry with the given list: [{"option": "quarterly", "type": "fixed", "value": "300.00"}].
-- NULL or an empty list leaves the entry with none. A class-count entry can have none.
create or replace function public.package_write_fee_discounts(p_entry_id uuid, p_discounts jsonb, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_option text;
  v_type   text;
  v_text   text;
  v_value  numeric;
  v_seen   text[] := '{}';
begin
  delete from public.package_fee_entry_discounts where entry_id = p_entry_id;

  if p_discounts is null or jsonb_typeof(p_discounts) = 'null' then
    return;
  end if;

  if jsonb_typeof(p_discounts) <> 'array' then
    raise exception 'Package discounts must be a list.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_discounts) = 0 then
    return;
  end if;

  if p_kind <> 'duration' then
    raise exception 'A class-count package has no package discounts.' using errcode = '22023';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_discounts) as e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each package discount must have an option, a type and a value.' using errcode = '22023';
    end if;

    v_option := v_item ->> 'option';
    v_type := v_item ->> 'type';
    v_text := v_item ->> 'value';

    if v_option is null or v_option not in ('quarterly', 'half_yearly', 'annual') then
      raise exception 'Package discounts apply to Quarterly, Half Yearly and Annual only.' using errcode = '22023';
    end if;

    if v_option = any (v_seen) then
      raise exception 'A duration option can have only one package discount.' using errcode = '22023';
    end if;

    if v_type is null or v_type not in ('fixed', 'percent') then
      raise exception 'Select a valid discount type.' using errcode = '22023';
    end if;

    if v_text is null or v_text !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Enter a discount greater than 0, with at most two decimal places.' using errcode = '22023';
    end if;

    v_value := v_text::numeric;

    if v_value <= 0 or v_value >= 100000000 or (v_type = 'percent' and v_value > 100) then
      raise exception 'Enter a discount greater than 0, with at most two decimal places.' using errcode = '22023';
    end if;

    insert into public.package_fee_entry_discounts (entry_id, duration_option, discount_type, fixed_amount, percent_value)
    values (p_entry_id, v_option, v_type,
            case when v_type = 'fixed' then v_value end,
            case when v_type = 'percent' then v_value end);

    v_seen := v_seen || v_option;
  end loop;
end;
$$;

-- Writes one audit event, for the signed-in user, in the caller's transaction.
create or replace function public.package_log_event(
  p_package_id uuid,
  p_entry_id   uuid,
  p_type       text,
  p_reason     text,
  p_before     jsonb,
  p_after      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.package_events (package_id, fee_entry_id, event_type, actor, reason, before_state, after_state)
  values (p_package_id, p_entry_id, p_type, auth.uid(), p_reason, p_before, p_after);
end;
$$;


-- 2. Packages -----------------------------------------------------------------------------------------------------

create or replace function public.create_package(
  p_name          text,
  p_description   text,
  p_kind          text,
  p_total_classes integer,
  p_options       text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name        text := public.package_trim(p_name);
  v_description text := public.package_trim(p_description);
  v_options     text[];
  v_id          uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if v_name is null then
    raise exception 'Enter the package name.' using errcode = '22023';
  end if;

  if p_kind is null or p_kind not in ('duration', 'class_count') then
    raise exception 'Select a valid package type.' using errcode = '22023';
  end if;

  if p_kind = 'class_count' then
    if p_total_classes is null or p_total_classes < 1 then
      raise exception 'Enter the number of classes, at least 1.' using errcode = '22023';
    end if;
    if coalesce(cardinality(p_options), 0) > 0 then
      raise exception 'A class-count package has no duration options.' using errcode = '22023';
    end if;
    v_options := '{}';
  else
    if p_total_classes is not null then
      raise exception 'A duration package has no class allowance.' using errcode = '22023';
    end if;
    v_options := public.package_clean_options(p_options);
    if cardinality(v_options) = 0 then
      raise exception 'Select at least one duration option.' using errcode = '22023';
    end if;
  end if;

  insert into public.packages (name, description, kind, total_classes, created_by)
  values (v_name, v_description, p_kind, p_total_classes, auth.uid())
  returning id into v_id;

  insert into public.package_duration_options (package_id, duration_option)
  select v_id, u.o from unnest(v_options) as u(o);

  perform public.package_log_event(v_id, null, 'package_created', null, null, public.package_snapshot(v_id));

  return v_id;
end;
$$;

create or replace function public.update_package_details(
  p_package_id  uuid,
  p_name        text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg         public.packages%rowtype;
  v_name        text := public.package_trim(p_name);
  v_description text := public.package_trim(p_description);
  v_before      jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if v_name is null then
    raise exception 'Enter the package name.' using errcode = '22023';
  end if;

  select * into v_pkg from public.packages where id = p_package_id for update;
  if not found then
    raise exception 'Package not found.' using errcode = 'P0002';
  end if;

  -- Nothing changed: no update and no event.
  if v_pkg.name = v_name and v_pkg.description is not distinct from v_description then
    return;
  end if;

  v_before := public.package_snapshot(p_package_id);

  update public.packages set name = v_name, description = v_description where id = p_package_id;

  perform public.package_log_event(p_package_id, null, 'details_updated', null, v_before, public.package_snapshot(p_package_id));
end;
$$;

-- Terms: a class-count package's class allowance, or a duration package's offered options. They apply to FUTURE purchases
-- only: a membership keeps the terms it was created with (the membership link is FS-5).
create or replace function public.update_package_terms(
  p_package_id    uuid,
  p_total_classes integer,
  p_options       text[],
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg     public.packages%rowtype;
  v_reason  text := public.package_clean_reason(p_reason);
  v_options text[];
  v_before  jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_pkg from public.packages where id = p_package_id for update;
  if not found then
    raise exception 'Package not found.' using errcode = 'P0002';
  end if;

  if v_pkg.kind = 'class_count' then
    if p_total_classes is null or p_total_classes < 1 then
      raise exception 'Enter the number of classes, at least 1.' using errcode = '22023';
    end if;
    if coalesce(cardinality(p_options), 0) > 0 then
      raise exception 'A class-count package has no duration options.' using errcode = '22023';
    end if;

    if v_pkg.total_classes = p_total_classes then
      return;
    end if;

    v_before := public.package_snapshot(p_package_id);
    update public.packages set total_classes = p_total_classes where id = p_package_id;
  else
    if p_total_classes is not null then
      raise exception 'A duration package has no class allowance.' using errcode = '22023';
    end if;

    v_options := public.package_clean_options(p_options);
    if cardinality(v_options) = 0 then
      raise exception 'Select at least one duration option.' using errcode = '22023';
    end if;

    if v_options = coalesce((select array_agg(o.duration_option order by o.duration_option)
                             from public.package_duration_options o
                             where o.package_id = p_package_id), '{}') then
      return;
    end if;

    v_before := public.package_snapshot(p_package_id);

    delete from public.package_duration_options
    where package_id = p_package_id and not (duration_option = any (v_options));

    insert into public.package_duration_options (package_id, duration_option)
    select p_package_id, u.o from unnest(v_options) as u(o)
    on conflict (package_id, duration_option) do nothing;
  end if;

  perform public.package_log_event(p_package_id, null, 'terms_updated', v_reason, v_before, public.package_snapshot(p_package_id));
end;
$$;

-- Deactivating blocks new purchases (FS-5) and keeps every existing membership and its history; reactivating allows them.
create or replace function public.set_package_status(
  p_package_id uuid,
  p_status     text,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg    public.packages%rowtype;
  v_reason text := public.package_clean_reason(p_reason);
  v_before jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'Select a valid status.' using errcode = '22023';
  end if;

  select * into v_pkg from public.packages where id = p_package_id for update;
  if not found then
    raise exception 'Package not found.' using errcode = 'P0002';
  end if;

  if v_pkg.status = p_status then
    return;
  end if;

  v_before := public.package_snapshot(p_package_id);

  update public.packages set status = p_status where id = p_package_id;

  perform public.package_log_event(
    p_package_id, null,
    case when p_status = 'inactive' then 'package_deactivated' else 'package_activated' end,
    v_reason, v_before, public.package_snapshot(p_package_id));
end;
$$;


-- 3. Fee entries --------------------------------------------------------------------------------------------------

create or replace function public.schedule_fee_entry(
  p_package_id     uuid,
  p_effective_from date,
  p_amount         numeric,
  p_discounts      jsonb default null,
  p_reason         text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg      public.packages%rowtype;
  v_reason   text := public.package_clean_reason(p_reason);
  v_currency text;
  v_id       uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_effective_from is null then
    raise exception 'Enter the date the fee takes effect.' using errcode = '22023';
  end if;

  perform public.package_check_amount(p_amount);

  select * into v_pkg from public.packages where id = p_package_id for update;
  if not found then
    raise exception 'Package not found.' using errcode = 'P0002';
  end if;

  select cp.currency into v_currency from public.center_profile cp where cp.singleton;
  if not found or v_currency is null then
    raise exception 'The centre currency is not set.' using errcode = '55000';
  end if;

  insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, price, created_by)
  values (v_pkg.id, v_pkg.kind, p_effective_from, v_currency,
          case when v_pkg.kind = 'duration' then p_amount end,
          case when v_pkg.kind = 'class_count' then p_amount end,
          auth.uid())
  returning id into v_id;

  perform public.package_write_fee_discounts(v_id, p_discounts, v_pkg.kind);

  perform public.package_log_event(v_pkg.id, v_id, 'fee_scheduled', v_reason, null, public.package_fee_entry_snapshot(v_id));

  return v_id;
end;
$$;

-- Edits a SCHEDULED fee (one that has not taken effect): its date, amount and discounts. The currency is stamped again from
-- the centre profile. An entry in effect is corrected, not edited.
create or replace function public.edit_fee_entry(
  p_entry_id       uuid,
  p_effective_from date,
  p_amount         numeric,
  p_discounts      jsonb default null,
  p_reason         text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_pkg        public.packages%rowtype;
  v_entry      public.package_fee_entries%rowtype;
  v_reason     text := public.package_clean_reason(p_reason);
  v_today      date := public.package_today();
  v_currency   text;
  v_before     jsonb;
  v_after      jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_effective_from is null then
    raise exception 'Enter the date the fee takes effect.' using errcode = '22023';
  end if;

  perform public.package_check_amount(p_amount);

  select e.package_id into v_package_id from public.package_fee_entries e where e.id = p_entry_id;
  if not found then
    raise exception 'Fee entry not found.' using errcode = 'P0002';
  end if;

  -- The package first, then the entry: the same order every function uses, so two Admins cannot deadlock.
  select * into v_pkg from public.packages where id = v_package_id for update;
  select * into v_entry from public.package_fee_entries where id = p_entry_id for update;

  if v_entry.cancelled_at is not null then
    raise exception 'A cancelled fee entry cannot be changed.' using errcode = '55006';
  end if;

  if v_entry.effective_from <= v_today then
    raise exception 'A fee entry in effect cannot be edited. Correct it instead.' using errcode = '55006';
  end if;

  if p_effective_from <= v_today then
    raise exception 'A scheduled fee must take effect after today. To change the fee in effect, correct it.' using errcode = '22023';
  end if;

  select cp.currency into v_currency from public.center_profile cp where cp.singleton;
  if not found or v_currency is null then
    raise exception 'The centre currency is not set.' using errcode = '55000';
  end if;

  v_before := public.package_fee_entry_snapshot(p_entry_id);

  perform public.package_write_fee_discounts(p_entry_id, p_discounts, v_pkg.kind);

  update public.package_fee_entries
  set effective_from = p_effective_from,
      currency = v_currency,
      monthly_fee = case when v_pkg.kind = 'duration' then p_amount end,
      price = case when v_pkg.kind = 'class_count' then p_amount end
  where id = p_entry_id;

  v_after := public.package_fee_entry_snapshot(p_entry_id);

  -- Nothing changed: no event.
  if v_after = v_before then
    return;
  end if;

  perform public.package_log_event(v_pkg.id, p_entry_id, 'fee_edited', v_reason, v_before, v_after);
end;
$$;

-- Cancels a fee entry. Cancelling a fee that is IN EFFECT needs a reason. The entry is cancelled (never deleted); the
-- event records, truthfully, whether it was in effect.
create or replace function public.cancel_fee_entry(
  p_entry_id uuid,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_pkg        public.packages%rowtype;
  v_entry      public.package_fee_entries%rowtype;
  v_reason     text := public.package_clean_reason(p_reason);
  v_today      date := public.package_today();
  v_before     jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select e.package_id into v_package_id from public.package_fee_entries e where e.id = p_entry_id;
  if not found then
    raise exception 'Fee entry not found.' using errcode = 'P0002';
  end if;

  select * into v_pkg from public.packages where id = v_package_id for update;
  select * into v_entry from public.package_fee_entries where id = p_entry_id for update;

  if v_entry.cancelled_at is not null then
    raise exception 'This fee entry is already cancelled.' using errcode = '55006';
  end if;

  if v_entry.effective_from <= v_today and v_reason is null then
    raise exception 'Enter the reason for cancelling a fee that is in effect.' using errcode = '22023';
  end if;

  v_before := public.package_fee_entry_snapshot(p_entry_id);

  update public.package_fee_entries
  set cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_entry_id;

  perform public.package_log_event(v_pkg.id, p_entry_id, 'fee_cancelled', v_reason, v_before, null);
end;
$$;

-- Corrects the fee IN EFFECT: cancels it, then appends a linked replacement with the same package, effective date and
-- currency, the corrected amount and discounts, and exactly one fee_corrected event (on the replacement). The reason is
-- required. Returns the replacement's id.
create or replace function public.correct_fee_entry(
  p_entry_id  uuid,
  p_amount    numeric,
  p_discounts jsonb,
  p_reason    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_pkg        public.packages%rowtype;
  v_entry      public.package_fee_entries%rowtype;
  v_reason     text := public.package_clean_reason(p_reason);
  v_today      date := public.package_today();
  v_new_id     uuid;
  v_before     jsonb;
  v_after      jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'Enter the reason for the correction.' using errcode = '22023';
  end if;

  perform public.package_check_amount(p_amount);

  select e.package_id into v_package_id from public.package_fee_entries e where e.id = p_entry_id;
  if not found then
    raise exception 'Fee entry not found.' using errcode = 'P0002';
  end if;

  select * into v_pkg from public.packages where id = v_package_id for update;
  select * into v_entry from public.package_fee_entries where id = p_entry_id for update;

  if v_entry.cancelled_at is not null then
    raise exception 'A cancelled fee entry cannot be corrected.' using errcode = '55006';
  end if;

  if v_entry.effective_from > v_today then
    raise exception 'A fee that has not taken effect is edited, not corrected.' using errcode = '55006';
  end if;

  v_before := public.package_fee_entry_snapshot(p_entry_id);

  -- Cancel FIRST: only a cancelled entry frees its date for the replacement.
  update public.package_fee_entries
  set cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_entry_id;

  insert into public.package_fee_entries (package_id, package_kind, effective_from, currency, monthly_fee, price, corrects_entry_id, created_by)
  values (v_entry.package_id, v_entry.package_kind, v_entry.effective_from, v_entry.currency,
          case when v_entry.package_kind = 'duration' then p_amount end,
          case when v_entry.package_kind = 'class_count' then p_amount end,
          v_entry.id, auth.uid())
  returning id into v_new_id;

  perform public.package_write_fee_discounts(v_new_id, p_discounts, v_entry.package_kind);

  v_after := public.package_fee_entry_snapshot(v_new_id);

  -- A correction that changes neither the amount nor the discounts is refused, and everything above is rolled back.
  if (v_after -> 'monthly_fee') is not distinct from (v_before -> 'monthly_fee')
     and (v_after -> 'price') is not distinct from (v_before -> 'price')
     and (v_after -> 'discounts') is not distinct from (v_before -> 'discounts') then
    raise exception 'The corrected fee is the same as the fee in effect.' using errcode = '22023';
  end if;

  perform public.package_log_event(v_pkg.id, v_new_id, 'fee_corrected', v_reason, v_before, v_after);

  return v_new_id;
end;
$$;


-- 4. Privileges ----------------------------------------------------------------------------------------------------
-- The helpers are internal: no client role can call them. The eight functions are callable by a signed-in user; each
-- one refuses anyone who is not an Admin.

revoke execute on function public.package_trim(text) from public, anon, authenticated;
revoke execute on function public.package_clean_reason(text) from public, anon, authenticated;
revoke execute on function public.package_clean_options(text[]) from public, anon, authenticated;
revoke execute on function public.package_check_amount(numeric) from public, anon, authenticated;
revoke execute on function public.package_today() from public, anon, authenticated;
revoke execute on function public.package_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.package_fee_entry_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.package_write_fee_discounts(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.package_log_event(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;

revoke execute on function public.create_package(text, text, text, integer, text[]) from public, anon;
revoke execute on function public.update_package_details(uuid, text, text) from public, anon;
revoke execute on function public.update_package_terms(uuid, integer, text[], text) from public, anon;
revoke execute on function public.set_package_status(uuid, text, text) from public, anon;
revoke execute on function public.schedule_fee_entry(uuid, date, numeric, jsonb, text) from public, anon;
revoke execute on function public.edit_fee_entry(uuid, date, numeric, jsonb, text) from public, anon;
revoke execute on function public.cancel_fee_entry(uuid, text) from public, anon;
revoke execute on function public.correct_fee_entry(uuid, numeric, jsonb, text) from public, anon;

grant execute on function public.create_package(text, text, text, integer, text[]) to authenticated;
grant execute on function public.update_package_details(uuid, text, text) to authenticated;
grant execute on function public.update_package_terms(uuid, integer, text[], text) to authenticated;
grant execute on function public.set_package_status(uuid, text, text) to authenticated;
grant execute on function public.schedule_fee_entry(uuid, date, numeric, jsonb, text) to authenticated;
grant execute on function public.edit_fee_entry(uuid, date, numeric, jsonb, text) to authenticated;
grant execute on function public.cancel_fee_entry(uuid, text) to authenticated;
grant execute on function public.correct_fee_entry(uuid, numeric, jsonb, text) to authenticated;
