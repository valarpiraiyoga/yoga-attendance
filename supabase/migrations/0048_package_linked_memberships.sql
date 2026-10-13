-- Package-linked memberships: pricing in the database (V1 Fee Structure, FS-5)
--
-- WHAT THIS MIGRATION DOES
--   1. Adds nullable package-linked columns to public.memberships: the package, the fee entry it was priced from, the
--      package-name snapshot, the duration in months, the pricing mode ('standard' or 'custom_fee_plan'), the standard
--      fee, the package discount, the individual discount (type, value, amount, reason code, note) and, for a Custom Fee
--      Plan, its reason and who confirmed it and when. `amount` stays the final agreed fee.
--   2. memberships_package_consistency: one CHECK tying those columns together (all NULL for a legacy membership; for a
--      standard one the arithmetic standard fee - package discount - individual discount = amount, with a final fee
--      greater than 0; for a Custom Fee Plan no fee entry, no discounts, a reason and a confirmation time).
--   3. create_membership_from_package(): the only way to create a package-linked membership. It resolves the fee entry
--      in effect on the start date in the centre's current currency (or takes an explicit, confirmed Custom Fee Plan),
--      calculates the end date by calendar months (clamped to the last day of a shorter month, then minus one day),
--      applies the package discount and the individual discount (each rounded half up to two decimals), enforces the
--      final-fee rules, snapshots the package name, fee and currency, and refuses a deactivated package.
--   4. memberships_package_guard(): a package-linked membership's package, fee, discounts, terms, dates and currency
--      cannot be changed by an ordinary UPDATE; a legacy membership cannot be linked to a package; a package-linked
--      row cannot be INSERTed except by the function above. Payment status, payment date, cancellation and notes still
--      change as before. (Audited corrections, FS-8, and the audited class-count expiry edit, FS-7, will re-create this
--      guard with their own bypass.)
--   5. invoices_package_membership_guard(): a package-linked membership is documented per payment, never at membership
--      level. A membership-level document (invoices.payment_id IS NULL) is refused for it.
--   6. Fee-conflict detection. A fee-history change CONFLICTS when it would change which fee entry applies to the start
--      date of an existing, non-cancelled, standard-priced membership of the package (01-product.md section 5). The check
--      is a DEFERRED constraint trigger on package_fee_entries, so it covers every function that changes an entry
--      (schedule, edit, cancel, correct) and sees the final state of the transaction: a correction that cancels an entry
--      and appends its replacement on the same date is not a conflict, cancelling the entry a membership was priced from
--      is, scheduling an entry dated on or before an existing membership's start date (when it is later than the entry
--      that membership used) is, and moving a scheduled entry past a membership's start date is. A conflicting change is
--      refused (55006) with the affected memberships and their agreed fees in the error DETAIL; nothing is repriced, and
--      no payment or document is touched. package_fee_conflicts() lists the affected memberships for the screens.
--
-- WHAT IT DOES NOT DO
--   * It does not UPDATE or backfill any existing row: legacy memberships keep every package column NULL.
--   * It does not change a trigger, function, policy or grant of an earlier migration, and no screen or server action
--     yet calls it (FS-6).
--   * It does not protect legacy membership-level receipts that follow a legacy membership edit (FS-D).
--   * It does not add an expiry edit or an agreed-fee correction (FS-7, FS-8).
--
-- ORDER OF WRITES AND LOCKS
--   create_membership_from_package locks the package row FOR SHARE before it resolves the fee. The package and fee functions
--   of 0047 lock it FOR UPDATE, so a fee change and a membership creation for one package cannot interleave. The conflict
--   check runs at COMMIT, after the changing function has finished; a creation that committed first is seen by it.
--
-- RERUN
--   Idempotent: ADD COLUMN IF NOT EXISTS, constraints added only when missing, CREATE OR REPLACE for functions, triggers
--   dropped and re-created. Run it as one transaction.

do $$
begin
  if to_regclass('public.packages') is null or to_regclass('public.package_fee_entries') is null
     or to_regclass('public.package_fee_entry_discounts') is null or to_regclass('public.package_duration_options') is null then
    raise exception '0048 needs migrations 0046 and 0047 (the package tables) applied first.';
  end if;
  if to_regprocedure('public.package_trim(text)') is null or to_regprocedure('public.package_clean_reason(text)') is null
     or to_regprocedure('public.package_check_amount(numeric)') is null then
    raise exception '0048 needs migration 0047 (the package helper functions) applied first.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0048 needs public.is_admin().';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'memberships' and column_name = 'kind') then
    raise exception '0048 needs migration 0042 (memberships.kind) applied first.';
  end if;
end
$$;


-- 1. Columns -------------------------------------------------------------------------------------------

alter table public.memberships
  add column if not exists package_id                     uuid,
  add column if not exists fee_entry_id                   uuid,
  add column if not exists package_name                   text,
  add column if not exists duration_months                integer,
  add column if not exists pricing_mode                   text,
  add column if not exists standard_fee                   numeric(10, 2),
  add column if not exists package_discount               numeric(10, 2),
  add column if not exists individual_discount_type       text,
  add column if not exists individual_discount_value      numeric(10, 2),
  add column if not exists individual_discount_amount     numeric(10, 2),
  add column if not exists individual_discount_reason_code text,
  add column if not exists individual_discount_note       text,
  add column if not exists custom_fee_reason              text,
  add column if not exists custom_fee_confirmed_by        uuid references auth.users (id) on delete set null,
  add column if not exists custom_fee_confirmed_at        timestamptz;

comment on column public.memberships.package_id is
  'The package this membership was bought from (V1 Fee Structure). NULL for a legacy membership, which is never linked afterwards.';
comment on column public.memberships.fee_entry_id is
  'The fee entry in effect on the start date that priced this membership. NULL for a legacy membership and for a Custom Fee Plan.';
comment on column public.memberships.package_name is
  'The package name when the membership was created. Later renames never change it.';
comment on column public.memberships.pricing_mode is
  'standard (priced from a fee entry) or custom_fee_plan (an explicit, confirmed special price). NULL for a legacy membership.';
comment on column public.memberships.amount is
  'The final agreed fee. For a package-linked membership: standard fee - package discount - individual discount (standard) or the custom agreed fee (Custom Fee Plan).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_package_kind_fkey'
                 and conrelid = 'public.memberships'::regclass) then
    -- (package_id, kind): the membership's type is the package's type, and a package's type cannot change once used.
    alter table public.memberships
      add constraint memberships_package_kind_fkey
      foreign key (package_id, kind) references public.packages (id, kind)
      on update no action on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memberships_fee_entry_fkey'
                 and conrelid = 'public.memberships'::regclass) then
    -- (package_id, fee_entry_id): the fee entry belongs to the membership's own package. Skipped while fee_entry_id is NULL.
    alter table public.memberships
      add constraint memberships_fee_entry_fkey
      foreign key (package_id, fee_entry_id) references public.package_fee_entries (package_id, id)
      on update no action on delete restrict;
  end if;
end
$$;

create index if not exists memberships_package_id_idx on public.memberships (package_id) where package_id is not null;
create index if not exists memberships_fee_entry_id_idx on public.memberships (fee_entry_id) where fee_entry_id is not null;


-- 2. The consistency CHECK -----------------------------------------------------------------------------
-- Wrapped in coalesce(..., false): a CHECK that evaluates to NULL PASSES, so a NULL inside any branch must fail it.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_package_consistency'
                 and conrelid = 'public.memberships'::regclass) then
    alter table public.memberships
      add constraint memberships_package_consistency
      check (coalesce(
        -- A legacy membership: nothing package-linked.
        (package_id is null and fee_entry_id is null and package_name is null and duration_months is null
         and pricing_mode is null and standard_fee is null and package_discount is null
         and individual_discount_type is null and individual_discount_value is null and individual_discount_amount is null
         and individual_discount_reason_code is null and individual_discount_note is null
         and custom_fee_reason is null and custom_fee_confirmed_by is null and custom_fee_confirmed_at is null)
        or
        -- Standard pricing: a fee entry, the arithmetic, and a final fee greater than 0 (memberships.amount > 0).
        (package_id is not null and package_name is not null and pricing_mode = 'standard'
         and fee_entry_id is not null and standard_fee > 0
         and ((kind = 'duration' and duration_months between 1 and 120 and package_discount >= 0)
              or (kind = 'class_count' and duration_months is null and package_discount is null))
         and custom_fee_reason is null and custom_fee_confirmed_by is null and custom_fee_confirmed_at is null
         and amount = standard_fee - coalesce(package_discount, 0) - coalesce(individual_discount_amount, 0)
         and ((individual_discount_type is null and individual_discount_value is null and individual_discount_amount is null
               and individual_discount_reason_code is null and individual_discount_note is null)
              or (individual_discount_type in ('fixed', 'percent')
                  and individual_discount_value > 0 and individual_discount_amount > 0
                  and (individual_discount_type = 'fixed' or individual_discount_value <= 100)
                  and individual_discount_reason_code in ('promotional_offer', 'returning_member', 'special_approval', 'other')
                  and (individual_discount_reason_code <> 'other' or individual_discount_note is not null)
                  and (individual_discount_note is null or char_length(individual_discount_note) between 3 and 500))))
        or
        -- A Custom Fee Plan: no fee entry, no discounts, a reason and a confirmation time. amount is the custom agreed fee.
        (package_id is not null and package_name is not null and pricing_mode = 'custom_fee_plan'
         and fee_entry_id is null and standard_fee is null and package_discount is null
         and individual_discount_type is null and individual_discount_value is null and individual_discount_amount is null
         and individual_discount_reason_code is null and individual_discount_note is null
         and ((kind = 'duration' and duration_months between 1 and 120) or (kind = 'class_count' and duration_months is null))
         and char_length(custom_fee_reason) between 3 and 500
         and custom_fee_confirmed_at is not null),
        false));
  end if;
end
$$;


-- 3. Fee conflicts -------------------------------------------------------------------------------------
-- The existing, non-cancelled, standard-priced memberships of a package for which the entry that applies to the start date
-- is no longer the one they were priced from. Entries are compared by their effective date: a correction keeps the date.

create or replace function public.package_fee_conflicts_core(p_package_id uuid)
returns table (
  membership_id   uuid,
  membership_code text,
  student_id      uuid,
  start_date      date,
  agreed_fee      numeric,
  currency        text,
  priced_from     date,
  applies_from    date
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.membership_code, m.student_id, m.start_date, m.amount, m.currency, e.effective_from,
         (select max(n.effective_from)
          from public.package_fee_entries n
          where n.package_id = m.package_id and n.cancelled_at is null and n.effective_from <= m.start_date)
  from public.memberships m
  join public.package_fee_entries e on e.id = m.fee_entry_id
  where m.package_id = p_package_id
    and m.pricing_mode = 'standard'
    and m.cancelled_at is null
    and e.effective_from is distinct from
        (select max(n.effective_from)
         from public.package_fee_entries n
         where n.package_id = m.package_id and n.cancelled_at is null and n.effective_from <= m.start_date)
$$;

-- The same list for the Admin screens.
create or replace function public.package_fee_conflicts(p_package_id uuid)
returns table (
  membership_id   uuid,
  membership_code text,
  student_id      uuid,
  start_date      date,
  agreed_fee      numeric,
  currency        text,
  priced_from     date,
  applies_from    date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;
  return query
    select * from public.package_fee_conflicts_core(p_package_id) c order by c.start_date, c.membership_code;
end;
$$;

create or replace function public.package_fee_entries_conflict_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_list  jsonb;
begin
  select count(*),
         jsonb_agg(jsonb_build_object('membership_code', c.membership_code, 'start_date', c.start_date,
                                      'agreed_fee', c.agreed_fee, 'currency', c.currency)
                   order by c.start_date, c.membership_code)
  into v_count, v_list
  from public.package_fee_conflicts_core(new.package_id) c;

  if v_count > 0 then
    raise exception 'This fee change would change the fee that applies to % existing membership(s). Resolve them first.', v_count
      using errcode = '55006', detail = v_list::text;
  end if;

  return null;
end;
$$;

drop trigger if exists package_fee_entries_conflict_trigger on public.package_fee_entries;
create constraint trigger package_fee_entries_conflict_trigger
  after insert or update on public.package_fee_entries
  deferrable initially deferred
  for each row
  execute function public.package_fee_entries_conflict_check();


-- 4. Guards --------------------------------------------------------------------------------------------

create or replace function public.memberships_package_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.package_id is not null and coalesce(current_setting('yoga.package_membership_create', true), '') <> 'on' then
      raise exception 'A package membership is created with create_membership_from_package().' using errcode = '55006';
    end if;
    return new;
  end if;

  if old.package_id is null then
    if new.package_id is not null then
      raise exception 'An existing membership cannot be linked to a package.' using errcode = '55006';
    end if;
    return new;
  end if;

  if row(new.student_id, new.plan, new.kind, new.total_classes, new.start_date, new.end_date, new.amount, new.currency,
         new.package_id, new.fee_entry_id, new.package_name, new.duration_months, new.pricing_mode, new.standard_fee,
         new.package_discount, new.individual_discount_type, new.individual_discount_value, new.individual_discount_amount,
         new.individual_discount_reason_code, new.individual_discount_note, new.custom_fee_reason,
         new.custom_fee_confirmed_by, new.custom_fee_confirmed_at)
     is distinct from
     row(old.student_id, old.plan, old.kind, old.total_classes, old.start_date, old.end_date, old.amount, old.currency,
         old.package_id, old.fee_entry_id, old.package_name, old.duration_months, old.pricing_mode, old.standard_fee,
         old.package_discount, old.individual_discount_type, old.individual_discount_value, old.individual_discount_amount,
         old.individual_discount_reason_code, old.individual_discount_note, old.custom_fee_reason,
         old.custom_fee_confirmed_by, old.custom_fee_confirmed_at) then
    -- A deleted account may clear who confirmed a Custom Fee Plan (ON DELETE SET NULL): that alone is allowed.
    if not (new.custom_fee_confirmed_by is null and old.custom_fee_confirmed_by is not null
            and row(new.student_id, new.plan, new.kind, new.total_classes, new.start_date, new.end_date, new.amount, new.currency,
                    new.package_id, new.fee_entry_id, new.package_name, new.duration_months, new.pricing_mode, new.standard_fee,
                    new.package_discount, new.individual_discount_type, new.individual_discount_value, new.individual_discount_amount,
                    new.individual_discount_reason_code, new.individual_discount_note, new.custom_fee_reason,
                    new.custom_fee_confirmed_at)
                is not distinct from
                row(old.student_id, old.plan, old.kind, old.total_classes, old.start_date, old.end_date, old.amount, old.currency,
                    old.package_id, old.fee_entry_id, old.package_name, old.duration_months, old.pricing_mode, old.standard_fee,
                    old.package_discount, old.individual_discount_type, old.individual_discount_value, old.individual_discount_amount,
                    old.individual_discount_reason_code, old.individual_discount_note, old.custom_fee_reason,
                    old.custom_fee_confirmed_at)) then
      raise exception 'The package, fee, discounts and terms of a package membership cannot be edited directly.'
        using errcode = '55006';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.memberships_package_guard() is
  'A package-linked membership is created only by create_membership_from_package() and its package, fee, discounts, terms, dates and currency never change by an ordinary UPDATE. Legacy memberships are never linked.';

drop trigger if exists memberships_package_guard_trigger on public.memberships;
create trigger memberships_package_guard_trigger
  before insert or update on public.memberships
  for each row
  execute function public.memberships_package_guard();

create or replace function public.invoices_package_membership_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_id is null
     and exists (select 1 from public.memberships m where m.id = new.membership_id and m.package_id is not null) then
    raise exception 'A package membership is documented per payment, not at membership level.' using errcode = '55006';
  end if;
  return new;
end;
$$;

comment on function public.invoices_package_membership_guard() is
  'Refuses a membership-level document (payment_id IS NULL) for a package-linked membership; its payments carry their own documents.';

drop trigger if exists invoices_package_membership_guard_trigger on public.invoices;
create trigger invoices_package_membership_guard_trigger
  before insert on public.invoices
  for each row
  execute function public.invoices_package_membership_guard();


-- 5. create_membership_from_package --------------------------------------------------------------------

create or replace function public.create_membership_from_package(
  p_student_id      uuid,
  p_package_id      uuid,
  p_duration_option text,
  p_custom_months   integer,
  p_start_date      date,
  p_end_date        date,
  p_individual_type text,
  p_individual_value numeric,
  p_reason_code     text,
  p_reason_note     text,
  p_pricing_mode    text,
  p_custom_fee      numeric,
  p_custom_reason   text,
  p_confirmed       boolean,
  p_notes           text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg        public.packages%rowtype;
  v_entry      public.package_fee_entries%rowtype;
  v_disc       public.package_fee_entry_discounts%rowtype;
  v_currency   text;
  v_mode       text := coalesce(p_pricing_mode, 'standard');
  v_months     integer;
  v_plan       text;
  v_end        date;
  v_disc_opt   text;
  v_standard   numeric;
  v_pkg_disc   numeric := 0;
  v_ind_amount numeric;
  v_final      numeric;
  v_reason     text;
  v_note       text;
  v_has_ind    boolean := p_individual_type is not null or p_individual_value is not null
                          or p_reason_code is not null or p_reason_note is not null;
  v_id         uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if p_start_date is null then
    raise exception 'Enter the start date.' using errcode = '22023';
  end if;
  if v_mode not in ('standard', 'custom_fee_plan') then
    raise exception 'Unknown pricing mode.' using errcode = '22023';
  end if;

  select * into v_pkg from public.packages where id = p_package_id for share;
  if not found then
    raise exception 'Package not found.' using errcode = 'P0002';
  end if;
  if v_pkg.status <> 'active' then
    raise exception 'This package is deactivated and cannot be chosen for a new membership.' using errcode = '55006';
  end if;
  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'Student not found.' using errcode = 'P0002';
  end if;

  select cp.currency into v_currency from public.center_profile cp where cp.singleton;
  if v_currency is null then
    raise exception 'The centre currency is not set.' using errcode = '55000';
  end if;

  -- Terms: the duration and end date, or the class allowance and optional expiry.
  if v_pkg.kind = 'duration' then
    if p_end_date is not null then
      raise exception 'The end date of a duration membership is calculated.' using errcode = '22023';
    end if;
    if p_duration_option is null
       or not exists (select 1 from public.package_duration_options o
                      where o.package_id = v_pkg.id and o.duration_option = p_duration_option) then
      raise exception 'This package does not offer that duration.' using errcode = '22023';
    end if;
    if p_duration_option <> 'custom' and p_custom_months is not null then
      raise exception 'Months are chosen only for a Custom duration.' using errcode = '22023';
    end if;
    v_months := case p_duration_option
                  when 'monthly' then 1 when 'quarterly' then 3 when 'half_yearly' then 6 when 'annual' then 12
                  else p_custom_months end;
    if v_months is null or v_months not between 1 and 120 then
      raise exception 'Enter a whole number of months from 1 to 120.' using errcode = '22023';
    end if;
    v_plan := p_duration_option;
    -- Calendar months, clamped to the last day of a shorter month (date + interval does this), then minus one day.
    v_end := (p_start_date + make_interval(months => v_months))::date - 1;
  else
    if p_duration_option is not null or p_custom_months is not null then
      raise exception 'A class-count package has no duration.' using errcode = '22023';
    end if;
    v_plan := 'class_count';
    v_end := p_end_date;
    if v_end is not null and v_end < p_start_date then
      raise exception 'The expiry date cannot be before the start date.' using errcode = '22023';
    end if;
  end if;

  if v_mode = 'custom_fee_plan' then
    if v_has_ind then
      raise exception 'A Custom Fee Plan takes no discounts.' using errcode = '22023';
    end if;
    v_final := public.package_check_amount(p_custom_fee);
    v_reason := public.package_clean_reason(p_custom_reason);
    if v_reason is null then
      raise exception 'Enter the reason for the Custom Fee Plan.' using errcode = '22023';
    end if;
    if p_confirmed is not true then
      raise exception 'Confirm the Custom Fee Plan before the membership is created.' using errcode = '22023';
    end if;
  else
    if p_custom_fee is not null or p_custom_reason is not null then
      raise exception 'A custom fee belongs to a Custom Fee Plan.' using errcode = '22023';
    end if;

    -- The fee entry in effect on the start date: the live entry with the latest effective date on or before it.
    select * into v_entry
    from public.package_fee_entries e
    where e.package_id = v_pkg.id and e.cancelled_at is null and e.effective_from <= p_start_date
    order by e.effective_from desc
    limit 1;
    if not found then
      raise exception 'No fee applies to this package on the start date. Schedule a fee, or use a Custom Fee Plan.' using errcode = '55000';
    end if;
    if v_entry.currency <> v_currency then
      raise exception 'The fee that applies is in %, not the centre currency %. Schedule a fee in %, or use a Custom Fee Plan.',
        v_entry.currency, v_currency, v_currency using errcode = '55000';
    end if;

    v_standard := case when v_pkg.kind = 'duration' then v_entry.monthly_fee * v_months else v_entry.price end;
    -- memberships.standard_fee is numeric(10, 2): refuse here with a clear message, not with a numeric overflow.
    if v_standard >= 100000000 then
      raise exception 'The final fee is too large.' using errcode = '22023';
    end if;

    -- The package discount of the largest standard duration not exceeding the months; none for Monthly (1-2 months).
    if v_pkg.kind = 'duration' then
      v_disc_opt := case when v_months >= 12 then 'annual' when v_months >= 6 then 'half_yearly'
                         when v_months >= 3 then 'quarterly' end;
      if v_disc_opt is not null then
        select * into v_disc from public.package_fee_entry_discounts d
        where d.entry_id = v_entry.id and d.duration_option = v_disc_opt;
        if found then
          v_pkg_disc := case when v_disc.discount_type = 'fixed' then v_disc.fixed_amount
                             else round(v_standard * v_disc.percent_value / 100, 2) end;
        end if;
      end if;
      if v_pkg_disc > v_standard then
        raise exception 'The package discount is more than the standard fee.' using errcode = '22023';
      end if;
    end if;

    -- The individual discount, against the fee after the package discount.
    if v_has_ind then
      if p_individual_type is null or p_individual_type not in ('fixed', 'percent') then
        raise exception 'Select the individual discount type.' using errcode = '22023';
      end if;
      if p_individual_value is null or p_individual_value <= 0 or p_individual_value <> round(p_individual_value, 2)
         or p_individual_value >= 100000000 or (p_individual_type = 'percent' and p_individual_value > 100) then
        raise exception 'Enter a valid individual discount.' using errcode = '22023';
      end if;
      if p_reason_code is null or p_reason_code not in ('promotional_offer', 'returning_member', 'special_approval', 'other') then
        raise exception 'Select the reason for the individual discount.' using errcode = '22023';
      end if;
      v_note := public.package_clean_reason(p_reason_note);
      if p_reason_code = 'other' and v_note is null then
        raise exception 'Explain the individual discount.' using errcode = '22023';
      end if;
      v_ind_amount := case when p_individual_type = 'fixed' then p_individual_value
                           else round((v_standard - v_pkg_disc) * p_individual_value / 100, 2) end;
      if v_ind_amount <= 0 then
        raise exception 'The individual discount is too small to apply.' using errcode = '22023';
      end if;
      if v_pkg_disc + v_ind_amount > v_standard then
        raise exception 'The discounts together cannot be more than the standard fee.' using errcode = '22023';
      end if;
    end if;

    v_final := v_standard - v_pkg_disc - coalesce(v_ind_amount, 0);
    if v_final <= 0 then
      raise exception 'The final fee must be greater than 0.' using errcode = '22023';
    end if;
    if v_final >= 100000000 then
      raise exception 'The final fee is too large.' using errcode = '22023';
    end if;
  end if;

  perform set_config('yoga.package_membership_create', 'on', true);

  insert into public.memberships (
    student_id, plan, kind, total_classes, start_date, end_date, amount, currency, notes,
    package_id, fee_entry_id, package_name, duration_months, pricing_mode, standard_fee, package_discount,
    individual_discount_type, individual_discount_value, individual_discount_amount,
    individual_discount_reason_code, individual_discount_note,
    custom_fee_reason, custom_fee_confirmed_by, custom_fee_confirmed_at
  ) values (
    p_student_id, v_plan, v_pkg.kind, v_pkg.total_classes, p_start_date, v_end, v_final, v_currency, public.package_trim(p_notes),
    v_pkg.id, case when v_mode = 'standard' then v_entry.id end, v_pkg.name, v_months, v_mode,
    case when v_mode = 'standard' then v_standard end,
    case when v_mode = 'standard' and v_pkg.kind = 'duration' then v_pkg_disc end,
    case when v_ind_amount is not null then p_individual_type end,
    case when v_ind_amount is not null then p_individual_value end,
    v_ind_amount,
    case when v_ind_amount is not null then p_reason_code end,
    case when v_ind_amount is not null then v_note end,
    case when v_mode = 'custom_fee_plan' then v_reason end,
    case when v_mode = 'custom_fee_plan' then auth.uid() end,
    case when v_mode = 'custom_fee_plan' then now() end
  )
  returning id into v_id;

  perform set_config('yoga.package_membership_create', '', true);

  return v_id;
end;
$$;

comment on function public.create_membership_from_package(uuid, uuid, text, integer, date, date, text, numeric, text, text, text, numeric, text, boolean, text) is
  'Admin only. Creates a package-linked membership: resolves the fee in effect on the start date (or an explicit, confirmed Custom Fee Plan), calculates the end date and the discounts, enforces the final-fee rules and snapshots the package, fee and currency.';


-- 6. Privileges ----------------------------------------------------------------------------------------

revoke execute on function public.package_fee_conflicts_core(uuid) from public, anon, authenticated;
revoke execute on function public.package_fee_entries_conflict_check() from public, anon, authenticated;
revoke execute on function public.memberships_package_guard() from public, anon, authenticated;
revoke execute on function public.invoices_package_membership_guard() from public, anon, authenticated;

revoke execute on function public.package_fee_conflicts(uuid) from public, anon;
grant execute on function public.package_fee_conflicts(uuid) to authenticated;

revoke execute on function public.create_membership_from_package(uuid, uuid, text, integer, date, date, text, numeric, text, text, text, numeric, text, boolean, text) from public, anon;
grant execute on function public.create_membership_from_package(uuid, uuid, text, integer, date, date, text, numeric, text, text, text, numeric, text, boolean, text) to authenticated;
