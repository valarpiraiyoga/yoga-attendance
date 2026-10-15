-- Membership term and fee corrections (V1 Fee Structure, FS-8)
--
-- WHY
--   A package-linked membership keeps the package, fee, discounts, terms and dates it was agreed with (0048): its guard refuses any
--   ordinary UPDATE of them. Changing one afterwards is a CORRECTION - a separate, authorized, audited action that always needs a
--   reason (01-product.md section 5 "Existing memberships", section 5A "Fee corrections"). This migration is that action.
--
-- WHAT THIS MIGRATION DOES
--   1. membership_term_corrections - the append-only audit history: who, when, the reason, the membership's package / pricing / fee /
--      dates BEFORE and AFTER (as snapshots), the payments recorded at the time and the payment status before and after.
--   2. membership_correction_core()    - the one place a correction is priced and checked (internal; no client may call it).
--   3. preview_membership_correction() - the revised price and terms, written nowhere, so the screen can show them for
--      confirmation; refuses exactly what the correction would refuse.
--   4. correct_membership_terms()      - Admin only. Corrects ONE package-linked membership - its package (of the same type),
--      duration, start date, pricing mode (standard <-> Custom Fee Plan), custom fee, individual discount - and records it.
--   5. memberships_package_guard() re-created from 0049 with ONE exemption: the correction of THIS membership, inside
--      correct_membership_terms(), which still cannot change the student, the type or the currency.
--
-- THE RULES A CORRECTION FOLLOWS (all from 01-product.md; none is new)
--   * Admin only, and a reason of 3 to 500 characters is required.
--   * Only a package-linked, non-cancelled membership. A legacy membership keeps its Edit form. The package must be of the
--     membership's own type (a duration membership stays duration, a class-count one stays class-count); another package must be
--     active, the membership's own package may have been deactivated since.
--   * The fee is priced exactly as at creation: the fee entry in effect on the (new) START DATE, standard fee -> package discount ->
--     individual discount -> final agreed fee, each step rounded half up, or a Custom Fee Plan whose amount IS the final fee
--     (no discounts). Switching between the two is allowed; standard pricing needs a valid fee entry in the membership's own
--     currency - a correction never converts or changes the currency.
--   * The final agreed fee must be greater than 0 and NOT BELOW THE PAYMENTS ALREADY RECORDED.
--   * The Admin must CONFIRM THE REVISED FINAL FEE: the amount passed has to equal the amount the function calculates, so a fee that
--     changed between the preview and the save (for example a new fee entry) is refused, not silently applied.
--   * A duration membership's end date is recalculated (calendar months from the start date). A class-count membership's expiry is
--     NOT touched here - it changes only through the audited expiry edit (0049) - and its class total follows the package but never
--     goes below the classes already used; a class recorded before the new start date refuses the change.
--   * Payments and issued documents are never changed: no payment row, no receipt or invoice. The membership's payment status and
--     payment date are recalculated from the payments exactly as edit_payment does (Paid when the payments cover the fee, Partially
--     Paid when they do not).
--   * Everything else follows from the existing constraints: no overlapping duration membership (23P01), no start before the
--     student joined (23514, 0051), the package-consistency CHECK of 0048.
--
-- WHAT IT DOES NOT DO
--   * It changes no row when applied, no payment, no invoice, no attendance record, no session, no eligibility snapshot and no other
--     membership. Frozen session rosters keep what they hold.
--   * It adds no client privilege on the memberships table, and no function other than the three below is callable by a client.
--
-- ORDER OF MIGRATIONS
--   Needs 0049 (the guard it re-creates, the expiry flag), 0048 (package columns), 0047 (package_* helpers), 0034 (payments), 0045
--   (class_count_net_used). 0050 was reserved for this feature; 0051-0053 do not depend on it.
--   RE-RUN HAZARD: this migration re-creates memberships_package_guard() from 0049. If 0048 or 0049 is re-run afterwards, re-apply
--   0050 - they would put the guard back without the correction exemption and every correction would be refused.
--
-- RE-RUN
--   Idempotent: CREATE ... IF NOT EXISTS / OR REPLACE, triggers dropped and re-created, privileges set again.

do $$
begin
  if to_regprocedure('public.memberships_package_guard()') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'memberships' and column_name = 'pricing_mode') then
    raise exception '0050 needs migration 0048 (package-linked memberships) applied first.';
  end if;
  if to_regclass('public.class_count_expiry_edits') is null then
    raise exception '0050 needs migration 0049 (class-count expiry edits) applied first: it re-creates the guard 0049 defined.';
  end if;
  if to_regprocedure('public.package_check_amount(numeric)') is null or to_regprocedure('public.package_clean_reason(text)') is null then
    raise exception '0050 needs migration 0047 (the package_* helper functions) applied first.';
  end if;
  if to_regclass('public.membership_payments') is null then
    raise exception '0050 needs migration 0034 (membership payments) applied first.';
  end if;
  if to_regprocedure('public.class_count_net_used(uuid)') is null then
    raise exception '0050 needs migration 0045 (class_count_net_used) applied first.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0050 needs public.is_admin().';
  end if;
end
$$;


-- 1. The audit table -----------------------------------------------------------------------------------

create table if not exists public.membership_term_corrections (
  id                    uuid primary key default gen_random_uuid(),
  membership_id         uuid not null references public.memberships (id) on delete restrict,
  reason                text not null,
  corrected_by          uuid references auth.users (id) on delete set null,
  corrected_at          timestamptz not null default now(),
  -- The membership's package, pricing, fee, dates and payment status immediately before and after (membership_term_snapshot).
  old_values             jsonb not null,
  new_values             jsonb not null,
  old_amount            numeric(10, 2) not null,
  new_amount            numeric(10, 2) not null,
  -- What had been paid when the correction was made (it is never changed by it).
  payments_total        numeric(12, 2) not null,
  old_payment_status    text not null,
  new_payment_status    text not null,

  constraint membership_term_corrections_changed check (old_values is distinct from new_values),
  -- Trimmed means no leading or trailing whitespace of any kind: a reason of only whitespace is refused whatever its length.
  constraint membership_term_corrections_reason_valid
    check (reason = regexp_replace(reason, '^\s+|\s+$', '', 'g') and length(reason) between 3 and 500),
  constraint membership_term_corrections_amount_valid check (new_amount > 0 and new_amount >= payments_total)
);

comment on table public.membership_term_corrections is
  'One row per audited correction of a package-linked membership''s package, fee, discounts, pricing mode, start date or term: who, when, the reason, the values before and after, and the payments recorded at the time. Append-only history, written only by correct_membership_terms().';

create index if not exists membership_term_corrections_membership_idx
  on public.membership_term_corrections (membership_id, corrected_at desc);

alter table public.membership_term_corrections enable row level security;

revoke all on public.membership_term_corrections from public, anon, authenticated;
grant select on public.membership_term_corrections to authenticated;

drop policy if exists "membership_term_corrections_select_admin" on public.membership_term_corrections;
create policy "membership_term_corrections_select_admin"
  on public.membership_term_corrections
  for select
  to authenticated
  using (public.is_admin());

-- Read-only even for the owner. The one change allowed: clearing corrected_by (what ON DELETE SET NULL does when that user account
-- is deleted), with every other column exactly as it was.
create or replace function public.membership_term_corrections_readonly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.corrected_by is not null and new.corrected_by is null
       and (new.id, new.membership_id, new.reason, new.corrected_at, new.old_values, new.new_values, new.old_amount, new.new_amount,
            new.payments_total, new.old_payment_status, new.new_payment_status)
           is not distinct from
           (old.id, old.membership_id, old.reason, old.corrected_at, old.old_values, old.new_values, old.old_amount, old.new_amount,
            old.payments_total, old.old_payment_status, old.new_payment_status) then
      return new;
    end if;
  end if;

  raise exception 'Membership term corrections cannot be changed or deleted.' using errcode = '55006';
end;
$$;

comment on function public.membership_term_corrections_readonly() is
  'Refuses every update, delete and truncate of membership_term_corrections: its rows are history. The only change allowed is clearing corrected_by when its user account is deleted.';

revoke execute on function public.membership_term_corrections_readonly() from public, anon, authenticated;

drop trigger if exists membership_term_corrections_readonly_trigger on public.membership_term_corrections;
create trigger membership_term_corrections_readonly_trigger
  before update or delete on public.membership_term_corrections
  for each row
  execute function public.membership_term_corrections_readonly();

drop trigger if exists membership_term_corrections_readonly_truncate_trigger on public.membership_term_corrections;
create trigger membership_term_corrections_readonly_truncate_trigger
  before truncate on public.membership_term_corrections
  for each statement
  execute function public.membership_term_corrections_readonly();


-- 2. The snapshot of a membership's terms ----------------------------------------------------------------------

create or replace function public.membership_term_snapshot(p_mem public.memberships)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'package_id', p_mem.package_id,
    'package_name', p_mem.package_name,
    'kind', p_mem.kind,
    'plan', p_mem.plan,
    'total_classes', p_mem.total_classes,
    'duration_months', p_mem.duration_months,
    'start_date', p_mem.start_date,
    'end_date', p_mem.end_date,
    'amount', p_mem.amount,
    'currency', p_mem.currency,
    'pricing_mode', p_mem.pricing_mode,
    'fee_entry_id', p_mem.fee_entry_id,
    'standard_fee', p_mem.standard_fee,
    'package_discount', p_mem.package_discount,
    'individual_discount_type', p_mem.individual_discount_type,
    'individual_discount_value', p_mem.individual_discount_value,
    'individual_discount_amount', p_mem.individual_discount_amount,
    'individual_discount_reason_code', p_mem.individual_discount_reason_code,
    'individual_discount_note', p_mem.individual_discount_note,
    'custom_fee_reason', p_mem.custom_fee_reason,
    'payment_status', p_mem.payment_status,
    'payment_date', p_mem.payment_date
  );
$$;

revoke execute on function public.membership_term_snapshot(public.memberships) from public, anon, authenticated;


-- 3. The one place a correction is priced and checked --------------------------------------------------------
-- Returns the corrected terms and price as jsonb. Reads the membership without locking it: correct_membership_terms() locks it
-- first, preview_membership_correction() does not need to. The pricing mirrors create_membership_from_package() (0048) step for
-- step - the same entry resolution, the same discount order and rounding, the same limits - with the membership's OWN currency
-- in place of the centre's current one.

create or replace function public.membership_correction_core(
  p_membership_id   uuid,
  p_package_id      uuid,
  p_duration_option text,
  p_custom_months   integer,
  p_start_date      date,
  p_individual_type text,
  p_individual_value numeric,
  p_reason_code     text,
  p_reason_note     text,
  p_pricing_mode    text,
  p_custom_fee      numeric,
  p_custom_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem        public.memberships%rowtype;
  v_pkg        public.packages%rowtype;
  v_entry      public.package_fee_entries%rowtype;
  v_disc       public.package_fee_entry_discounts%rowtype;
  v_mode       text := coalesce(p_pricing_mode, 'standard');
  v_months     integer;
  v_plan       text;
  v_end        date;
  v_total      integer;
  v_standard   numeric;
  v_pkg_disc   numeric := 0;
  v_ind_amount numeric;
  v_final      numeric;
  v_disc_opt   text;
  v_note       text;
  v_custom_reason text;
  v_paid       numeric(12, 2);
  v_used       integer;
  v_name       text;
  v_has_ind    boolean := p_individual_type is not null or p_individual_value is not null
                          or p_reason_code is not null or p_reason_note is not null;
  v_result     jsonb;
begin
  select * into v_mem from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  if v_mem.package_id is null then
    raise exception 'Only a package-linked membership is corrected here. A legacy membership keeps its Edit form.' using errcode = '22023';
  end if;
  if v_mem.cancelled_at is not null then
    raise exception 'A cancelled membership cannot be corrected.' using errcode = '55000';
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
  if v_pkg.kind <> v_mem.kind then
    raise exception 'A correction cannot change the type of a membership (duration-based or class-count).' using errcode = '22023';
  end if;
  -- The membership's own package may have been deactivated since; choosing a DIFFERENT package needs an active one.
  if v_pkg.id <> v_mem.package_id and v_pkg.status <> 'active' then
    raise exception 'This package is deactivated and cannot be chosen.' using errcode = '55006';
  end if;
  -- The package name as agreed: kept while the package is unchanged (a later rename never reaches an existing membership).
  v_name := case when v_pkg.id = v_mem.package_id then v_mem.package_name else v_pkg.name end;

  -- Terms -------------------------------------------------------------------------------------------------------------------
  if v_pkg.kind = 'duration' then
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
    v_total := null;
    -- Calendar months, clamped to the last day of a shorter month (date + interval does this), then minus one day.
    v_end := (p_start_date + make_interval(months => v_months))::date - 1;
  else
    if p_duration_option is not null or p_custom_months is not null then
      raise exception 'A class-count package has no duration.' using errcode = '22023';
    end if;
    v_plan := 'class_count';
    v_months := null;
    v_total := v_pkg.total_classes;
    -- The expiry is not corrected here: it changes only through the audited expiry edit (0049).
    v_end := v_mem.end_date;
    if v_end is not null and v_end < p_start_date then
      raise exception 'The start date cannot be after the expiry date. Change the expiry first.' using errcode = '22023';
    end if;
    v_used := public.class_count_net_used(v_mem.id);
    if v_total < v_used then
      raise exception 'The package allows % classes but % have already been recorded.', v_total, v_used using errcode = '22023';
    end if;
    if exists (select 1 from public.class_count_attendance a where a.membership_id = v_mem.id and a.attended_on < p_start_date) then
      raise exception 'A class has been recorded before that start date.' using errcode = '22023';
    end if;
  end if;

  -- Price -------------------------------------------------------------------------------------------------------------------
  if v_mode = 'custom_fee_plan' then
    if v_has_ind then
      raise exception 'A Custom Fee Plan takes no discounts.' using errcode = '22023';
    end if;
    v_final := public.package_check_amount(p_custom_fee);
    v_custom_reason := public.package_clean_reason(p_custom_reason);
    if v_custom_reason is null then
      raise exception 'Enter the reason for the Custom Fee Plan.' using errcode = '22023';
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
    if v_entry.currency <> v_mem.currency then
      raise exception 'The fee that applies is in %, not this membership''s currency %. A correction never changes the currency; use a Custom Fee Plan.',
        v_entry.currency, v_mem.currency using errcode = '55000';
    end if;

    v_standard := case when v_pkg.kind = 'duration' then v_entry.monthly_fee * v_months else v_entry.price end;
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

  -- Payments: the fee cannot go below what has been paid -----------------------------------------------------------------------
  select coalesce(sum(p.amount), 0) into v_paid from public.membership_payments p where p.membership_id = v_mem.id;
  if v_final < v_paid then
    raise exception 'The final fee (%) cannot be below the payments already recorded (%).', v_final, v_paid using errcode = '22023';
  end if;

  -- Something must change ----------------------------------------------------------------------------------------------------
  if (v_pkg.id, v_name, v_plan, v_total, v_months, p_start_date, v_end, v_final, v_mode,
      case when v_mode = 'standard' then v_entry.id end, case when v_mode = 'standard' then v_standard end,
      case when v_mode = 'standard' and v_pkg.kind = 'duration' then v_pkg_disc end,
      case when v_ind_amount is not null then p_individual_type end, case when v_ind_amount is not null then p_individual_value end,
      v_ind_amount, case when v_ind_amount is not null then p_reason_code end, case when v_ind_amount is not null then v_note end,
      case when v_mode = 'custom_fee_plan' then v_custom_reason end)
     is not distinct from
     (v_mem.package_id, v_mem.package_name, v_mem.plan, v_mem.total_classes, v_mem.duration_months, v_mem.start_date, v_mem.end_date,
      v_mem.amount, v_mem.pricing_mode, v_mem.fee_entry_id, v_mem.standard_fee, v_mem.package_discount,
      v_mem.individual_discount_type, v_mem.individual_discount_value, v_mem.individual_discount_amount,
      v_mem.individual_discount_reason_code, v_mem.individual_discount_note, v_mem.custom_fee_reason) then
    raise exception 'Nothing would change.' using errcode = '22023';
  end if;

  v_result := jsonb_build_object(
    'membership_id', v_mem.id,
    'kind', v_mem.kind,
    'currency', v_mem.currency,
    'package_id', v_pkg.id,
    'package_name', v_name,
    'plan', v_plan,
    'total_classes', v_total,
    'duration_months', v_months,
    'start_date', p_start_date,
    'end_date', v_end,
    'pricing_mode', v_mode,
    'fee_entry_id', case when v_mode = 'standard' then v_entry.id end,
    'standard_fee', case when v_mode = 'standard' then v_standard end,
    'package_discount', case when v_mode = 'standard' and v_pkg.kind = 'duration' then v_pkg_disc end,
    'individual_discount_type', case when v_ind_amount is not null then p_individual_type end,
    'individual_discount_value', case when v_ind_amount is not null then p_individual_value end,
    'individual_discount_amount', v_ind_amount,
    'individual_discount_reason_code', case when v_ind_amount is not null then p_reason_code end,
    'individual_discount_note', case when v_ind_amount is not null then v_note end,
    'custom_fee_reason', case when v_mode = 'custom_fee_plan' then v_custom_reason end,
    'final_fee', v_final,
    'current_amount', v_mem.amount,
    'paid_total', v_paid,
    'balance_after', v_final - v_paid
  );

  return v_result;
end;
$$;

comment on function public.membership_correction_core(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text) is
  'Prices and checks a correction of a package-linked membership exactly as creation prices a new one (fee entry in effect on the start date, standard fee, package discount, individual discount, final fee; or a Custom Fee Plan), in the membership''s own currency, and refuses a final fee that is not above 0 or is below the payments recorded. Internal.';

revoke execute on function public.membership_correction_core(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text)
  from public, anon, authenticated;


-- 4. The preview ---------------------------------------------------------------------------------------------

create or replace function public.preview_membership_correction(
  p_membership_id   uuid,
  p_package_id      uuid,
  p_duration_option text,
  p_custom_months   integer,
  p_start_date      date,
  p_individual_type text,
  p_individual_value numeric,
  p_reason_code     text,
  p_reason_note     text,
  p_pricing_mode    text,
  p_custom_fee      numeric,
  p_custom_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Writes nothing: the revised price and terms, or the error the correction itself would give.
  return public.membership_correction_core(p_membership_id, p_package_id, p_duration_option, p_custom_months, p_start_date,
    p_individual_type, p_individual_value, p_reason_code, p_reason_note, p_pricing_mode, p_custom_fee, p_custom_reason);
end;
$$;

comment on function public.preview_membership_correction(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text) is
  'Admin only. The revised price and terms of a correction (final fee, breakdown, end date, payments recorded, balance after), written nowhere, so they can be confirmed before correct_membership_terms().';

revoke execute on function public.preview_membership_correction(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text)
  from public, anon;
grant execute on function public.preview_membership_correction(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text)
  to authenticated;


-- 5. The correction ------------------------------------------------------------------------------------------
-- Returns the id of the audit row.

create or replace function public.correct_membership_terms(
  p_membership_id   uuid,
  p_package_id      uuid,
  p_duration_option text,
  p_custom_months   integer,
  p_start_date      date,
  p_individual_type text,
  p_individual_value numeric,
  p_reason_code     text,
  p_reason_note     text,
  p_pricing_mode    text,
  p_custom_fee      numeric,
  p_custom_reason   text,
  p_confirmed_fee   numeric,
  p_reason          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem     public.memberships%rowtype;
  v_new     public.memberships%rowtype;
  v_reason  text;
  v_core    jsonb;
  v_final   numeric;
  v_paid    numeric(12, 2);
  v_status  text;
  v_pdate   date;
  v_id      uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  -- Trimmed of all leading and trailing whitespace, the same rule as the table's check, so a reason of only whitespace is
  -- refused here with the clear message instead of reaching the table.
  v_reason := regexp_replace(coalesce(p_reason, ''), '^\s+|\s+$', '', 'g');
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Enter a reason of 3 to 500 characters.' using errcode = '22023';
  end if;

  -- The membership row first, the order payments, recording and the expiry edit take, so none of them interleaves with this.
  select * into v_mem from public.memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  v_core := public.membership_correction_core(p_membership_id, p_package_id, p_duration_option, p_custom_months, p_start_date,
    p_individual_type, p_individual_value, p_reason_code, p_reason_note, p_pricing_mode, p_custom_fee, p_custom_reason);
  v_final := (v_core ->> 'final_fee')::numeric;
  v_paid  := (v_core ->> 'paid_total')::numeric;

  -- The Admin confirms the REVISED price: the amount confirmed has to be the amount calculated now.
  if p_confirmed_fee is null then
    raise exception 'Confirm the revised final fee (%) before saving.', v_final using errcode = '22023';
  end if;
  if p_confirmed_fee <> v_final then
    raise exception 'The final fee is now %, not the % confirmed. Review the revised price and confirm it again.', v_final, p_confirmed_fee
      using errcode = '22023';
  end if;

  -- The payment status follows the payments, as edit_payment recalculates it: Paid when they cover the fee, Partially Paid when
  -- they do not. With no payment recorded the status and date are left as they are.
  v_status := v_mem.payment_status;
  v_pdate  := v_mem.payment_date;
  if v_paid > 0 then
    v_status := case when v_paid >= v_final then 'paid' else 'partially_paid' end;
    v_pdate  := case when v_status = 'paid'
                     then (select max(p.payment_date) from public.membership_payments p where p.membership_id = v_mem.id) end;
  end if;

  -- The two flags let the guards of memberships pass THIS change of THIS membership, and nothing else: each holds the id, both are
  -- cleared right after, and a statement that fails rolls them back with the transaction.
  perform set_config('yoga.membership_term_correction', v_mem.id::text, true);
  perform set_config('yoga.payment_status_sync', v_mem.id::text, true);

  update public.memberships
  set plan                            = v_core ->> 'plan',
      total_classes                   = (v_core ->> 'total_classes')::integer,
      start_date                      = (v_core ->> 'start_date')::date,
      end_date                        = (v_core ->> 'end_date')::date,
      amount                          = v_final,
      package_id                      = (v_core ->> 'package_id')::uuid,
      fee_entry_id                    = (v_core ->> 'fee_entry_id')::uuid,
      package_name                    = v_core ->> 'package_name',
      duration_months                 = (v_core ->> 'duration_months')::integer,
      pricing_mode                    = v_core ->> 'pricing_mode',
      standard_fee                    = (v_core ->> 'standard_fee')::numeric,
      package_discount                = (v_core ->> 'package_discount')::numeric,
      individual_discount_type        = v_core ->> 'individual_discount_type',
      individual_discount_value       = (v_core ->> 'individual_discount_value')::numeric,
      individual_discount_amount      = (v_core ->> 'individual_discount_amount')::numeric,
      individual_discount_reason_code = v_core ->> 'individual_discount_reason_code',
      individual_discount_note        = v_core ->> 'individual_discount_note',
      custom_fee_reason               = v_core ->> 'custom_fee_reason',
      custom_fee_confirmed_by         = case when v_core ->> 'pricing_mode' = 'custom_fee_plan' then auth.uid() end,
      custom_fee_confirmed_at         = case when v_core ->> 'pricing_mode' = 'custom_fee_plan' then now() end,
      payment_status                  = v_status,
      payment_date                    = v_pdate
  where id = v_mem.id;

  perform set_config('yoga.membership_term_correction', '', true);
  perform set_config('yoga.payment_status_sync', '', true);

  select * into v_new from public.memberships where id = v_mem.id;

  insert into public.membership_term_corrections (
    membership_id, reason, corrected_by, old_values, new_values, old_amount, new_amount,
    payments_total, old_payment_status, new_payment_status
  ) values (
    v_mem.id, v_reason, auth.uid(), public.membership_term_snapshot(v_mem), public.membership_term_snapshot(v_new),
    v_mem.amount, v_new.amount, v_paid, v_mem.payment_status, v_new.payment_status
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.correct_membership_terms(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text, numeric, text) is
  'Admin only. Corrects a package-linked, non-cancelled membership''s package (same type), duration, start date, pricing mode (standard or Custom Fee Plan), custom fee and individual discount with a required reason: prices it as at creation, requires the revised final fee to be confirmed, refuses a fee that is not above 0 or is below the payments recorded, recalculates the end date (duration) and the payment status, changes no payment and no document, and records the values before and after.';

revoke execute on function public.correct_membership_terms(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text, numeric, text)
  from public, anon;
grant execute on function public.correct_membership_terms(uuid, uuid, text, integer, date, text, numeric, text, text, text, numeric, text, numeric, text)
  to authenticated;


-- 6. memberships_package_guard (0049), with the one more exemption --------------------------------------------
-- Identical to 0049's, except that while correct_membership_terms() is correcting THIS membership the package columns may change
-- - and still never the student, the type or the currency. Every other path is exactly as before.

create or replace function public.memberships_package_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_expiry_edit boolean;
  v_new_end     date;
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

  -- The audited correction of this membership (0050).
  if coalesce(current_setting('yoga.membership_term_correction', true), '') = old.id::text then
    if new.package_id is null or new.student_id is distinct from old.student_id or new.kind is distinct from old.kind
       or new.currency is distinct from old.currency then
      raise exception 'A correction cannot change the student, the type or the currency of a membership.' using errcode = '55006';
    end if;
    return new;
  end if;

  v_expiry_edit := old.kind = 'class_count' and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') = old.id::text;
  v_new_end := case when v_expiry_edit then old.end_date else new.end_date end;

  if row(new.student_id, new.plan, new.kind, new.total_classes, new.start_date, v_new_end, new.amount, new.currency,
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
            and row(new.student_id, new.plan, new.kind, new.total_classes, new.start_date, v_new_end, new.amount, new.currency,
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
  'A package-linked membership is created only by create_membership_from_package() and its package, fee, discounts, terms, dates and currency never change by an ordinary UPDATE; the only exceptions are the expiry of a class-count membership inside edit_class_count_expiry() (0049) and the audited correction inside correct_membership_terms() (0050), which can never change the student, type or currency. Legacy memberships are never linked.';
