-- Class-count expiry edits (V1 Fee Structure, FS-7)
--
-- WHAT THIS MIGRATION DOES
--   1. class_count_expiry_edits: an append-only audit table, one row per expiry edit - the membership, the previous expiry, the new
--      expiry (NULL is "No expiry"), the reason, who edited it and when. Admin-only to read; nobody can write it directly, and a
--      row is never updated or deleted (the one allowed change is clearing edited_by when that user account is deleted).
--   2. edit_class_count_expiry(membership, new expiry, reason): the ONLY way a class-count membership's expiry changes, for EVERY
--      class-count membership - legacy or package-linked, which it never links to a package. Admin only (42501). The reason is
--      required: trimmed, 3 to 500 characters. The new expiry is a date on or after the membership's start date, or NULL for
--      No expiry; it may extend, shorten or switch. An edit that changes nothing is refused. It changes end_date and writes its
--      audit row in one transaction, and returns the audit row's id.
--   3. memberships_class_count_expiry_guard: a direct change of a class-count membership's end_date - by any role, the owner
--      included - is refused (55006) unless it comes from the function above. Creating a membership is not an UPDATE and is
--      unaffected; a duration membership's end date is untouched.
--   4. memberships_package_guard (0048) is re-created with ONE exemption: when the expiry edit is in progress, end_date is
--      not compared. Every other protection of a package-linked membership is exactly as in 0048.
--   5. memberships_sync_invoice_trigger (0030) is re-created with ONE added condition: it does not fire for an expiry edit. That
--      trigger makes a tracked membership-level receipt FOLLOW its membership; an expiry edit must never rewrite an issued
--      document (01-product.md section 5: issued documents never change silently). Every other change of amount, plan, start date
--      or end date still fires it exactly as before.
--
-- WHAT IT DOES NOT DO
--   * It never touches the agreed fee, the class allowance (total_classes), any attendance record, any reversal, any payment or
--     document, or a membership's package link. A reversal does not extend the expiry and nothing here reverses a record.
--   * It does not change recording: record_class_count_attendance (0045) already reads the CURRENT end_date, so an extension
--     re-enables recording and a shortening stops new records after it. A record made earlier whose attendance date is now
--     after the expiry is KEPT, is not reversed and does not change the balance; the informational flag "Attendance after
--     current expiry" is derived from attended_on and the current end_date by the screens, not stored.
--   * It updates no existing row and adds no data. It does not apply itself: it is run by hand.
--   * It adds no screen: the Edit expiry action, the history and the flag are the next step.
--
-- ORDER OF WRITES
--   The function locks the membership row FOR UPDATE first - the order recording and reversing take - so an edit and a recording
--   of the same membership cannot interleave. Then it sets the one-transaction flag, updates end_date, clears the flag, and
--   writes the audit row, all in the caller's transaction: either both happen or neither.
--
-- RERUN
--   Idempotent: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, triggers dropped and re-created. Run it as one transaction.
--
-- RE-RUNNING OTHER MIGRATIONS
--   0049 REPLACES two definitions made earlier: the memberships_sync_invoice_trigger of 0030 and memberships_package_guard() of
--   0048. If 0030 or 0048 is ever re-run AFTER 0049, it puts its own definition back - the receipt sync would again follow an
--   expiry edit, and a package-linked class-count expiry edit would be refused. Re-apply 0049 after re-running either of them.

do $$
begin
  if to_regclass('public.memberships') is null or to_regclass('public.class_count_attendance') is null
     or to_regclass('public.class_count_attendance_reversals') is null then
    raise exception '0049 needs migrations 0042-0045 (class-count memberships, attendance and reversals) applied first.';
  end if;
  if to_regprocedure('public.memberships_package_guard()') is null then
    raise exception '0049 needs migration 0048 (package-linked memberships) applied first.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0049 needs public.is_admin().';
  end if;
  if to_regprocedure('public.memberships_sync_invoice()') is null then
    raise exception '0049 needs migration 0030 (public.memberships_sync_invoice(), the receipt-sync trigger function) applied first.';
  end if;
end
$$;


-- 1. The audit table -----------------------------------------------------------------------------------

create table if not exists public.class_count_expiry_edits (
  id              uuid primary key default gen_random_uuid(),
  membership_id   uuid not null references public.memberships (id) on delete restrict,
  -- NULL means No expiry, before and after.
  previous_expiry date,
  new_expiry      date,
  reason          text not null,
  edited_by       uuid references auth.users (id) on delete set null,
  edited_at       timestamptz not null default now(),

  constraint class_count_expiry_edits_changed check (previous_expiry is distinct from new_expiry),
  -- Trimmed means no leading or trailing whitespace of any kind: a reason of only whitespace is refused whatever its length.
  constraint class_count_expiry_edits_reason_valid
    check (reason = regexp_replace(reason, '^\s+|\s+$', '', 'g') and length(reason) between 3 and 500)
);

comment on table public.class_count_expiry_edits is
  'One row per audited expiry edit of a class-count membership: the previous and new expiry (NULL = No expiry), the reason, who and when. Append-only history, written only by edit_class_count_expiry().';

create index if not exists class_count_expiry_edits_membership_idx
  on public.class_count_expiry_edits (membership_id, edited_at desc);

alter table public.class_count_expiry_edits enable row level security;

revoke all on public.class_count_expiry_edits from public, anon, authenticated;
grant select on public.class_count_expiry_edits to authenticated;

drop policy if exists "class_count_expiry_edits_select_admin" on public.class_count_expiry_edits;
create policy "class_count_expiry_edits_select_admin"
  on public.class_count_expiry_edits
  for select
  to authenticated
  using (public.is_admin());

-- Read-only even for the owner. The one change allowed: clearing edited_by (what ON DELETE SET NULL does when that user account
-- is deleted), with every other column exactly as it was.
create or replace function public.class_count_expiry_edits_readonly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.edited_by is not null and new.edited_by is null
       and (new.id, new.membership_id, new.previous_expiry, new.new_expiry, new.reason, new.edited_at)
           is not distinct from (old.id, old.membership_id, old.previous_expiry, old.new_expiry, old.reason, old.edited_at) then
      return new;
    end if;
  end if;

  raise exception 'Class count expiry edits cannot be changed or deleted.' using errcode = '55006';
end;
$$;

comment on function public.class_count_expiry_edits_readonly() is
  'Refuses every update, delete and truncate of class_count_expiry_edits: its rows are history. The only change allowed is clearing edited_by when its user account is deleted.';

revoke execute on function public.class_count_expiry_edits_readonly() from public, anon, authenticated;

drop trigger if exists class_count_expiry_edits_readonly_trigger on public.class_count_expiry_edits;
create trigger class_count_expiry_edits_readonly_trigger
  before update or delete on public.class_count_expiry_edits
  for each row
  execute function public.class_count_expiry_edits_readonly();

drop trigger if exists class_count_expiry_edits_readonly_truncate_trigger on public.class_count_expiry_edits;
create trigger class_count_expiry_edits_readonly_truncate_trigger
  before truncate on public.class_count_expiry_edits
  for each statement
  execute function public.class_count_expiry_edits_readonly();


-- 2. The guard on memberships.end_date of a class-count membership --------------------------------------

create or replace function public.memberships_class_count_expiry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.kind = 'class_count' or new.kind = 'class_count')
     and new.end_date is distinct from old.end_date
     and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') <> old.id::text then
    raise exception 'A class-count membership''s expiry changes only through the audited expiry edit.' using errcode = '55006';
  end if;
  return new;
end;
$$;

comment on function public.memberships_class_count_expiry_guard() is
  'A class-count membership''s end_date (its expiry) changes only inside edit_class_count_expiry(); any other change of it is refused, whoever sends it.';

revoke execute on function public.memberships_class_count_expiry_guard() from public, anon, authenticated;

drop trigger if exists memberships_class_count_expiry_guard_trigger on public.memberships;
create trigger memberships_class_count_expiry_guard_trigger
  before update on public.memberships
  for each row
  execute function public.memberships_class_count_expiry_guard();


-- 3. memberships_package_guard (0048), with the one exemption ---------------------------------------------
-- Identical to 0048 except that end_date is read from OLD while the expiry edit of this very membership is in progress, so an
-- expiry edit of a package-linked class-count membership is not refused and nothing else about it is loosened.

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
  'A package-linked membership is created only by create_membership_from_package() and its package, fee, discounts, terms, dates and currency never change by an ordinary UPDATE; the one exception is the expiry of a class-count membership inside edit_class_count_expiry() (0049). Legacy memberships are never linked.';


-- 3b. An expiry edit never rewrites an issued membership-level receipt --------------------------------------
-- 0030's trigger, unchanged except for the last condition of its WHEN clause.

drop trigger if exists memberships_sync_invoice_trigger on public.memberships;
create trigger memberships_sync_invoice_trigger
  after update of amount, plan, start_date, end_date on public.memberships
  for each row
  when (
    (old.amount     is distinct from new.amount
      or old.plan       is distinct from new.plan
      or old.start_date is distinct from new.start_date
      or old.end_date   is distinct from new.end_date)
    and coalesce(current_setting('yoga.class_count_expiry_edit', true), '') <> old.id::text
  )
  execute function public.memberships_sync_invoice();


-- 4. edit_class_count_expiry ------------------------------------------------------------------------------

create or replace function public.edit_class_count_expiry(
  p_membership_id uuid,
  p_new_expiry    date,
  p_reason        text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mem    public.memberships%rowtype;
  v_reason text;
  v_id     uuid;
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

  -- The membership row first, the order recording and reversing take, so an edit and a recording never interleave.
  select * into v_mem from public.memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  if v_mem.kind <> 'class_count' then
    raise exception 'Only a class-count membership has an expiry to edit.' using errcode = '55000';
  end if;

  if p_new_expiry is not null and p_new_expiry < v_mem.start_date then
    raise exception 'The expiry date cannot be before the start date.' using errcode = '22023';
  end if;

  if p_new_expiry is not distinct from v_mem.end_date then
    raise exception 'The expiry is unchanged.' using errcode = '22023';
  end if;

  -- The flag lets the two guards of memberships pass THIS change of THIS membership, and nothing else: it holds the id, it is
  -- cleared right after, and a statement that fails rolls it back with the transaction.
  perform set_config('yoga.class_count_expiry_edit', v_mem.id::text, true);
  update public.memberships set end_date = p_new_expiry where id = v_mem.id;
  perform set_config('yoga.class_count_expiry_edit', '', true);

  insert into public.class_count_expiry_edits (membership_id, previous_expiry, new_expiry, reason, edited_by)
  values (v_mem.id, v_mem.end_date, p_new_expiry, v_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.edit_class_count_expiry(uuid, date, text) is
  'Admin only. Changes the expiry of a class-count membership (legacy or package-linked) to a date on or after its start date, or to No expiry (NULL), with a required reason, and records the previous and new expiry, the reason, who and when. Changes nothing else.';


-- 5. Privileges ----------------------------------------------------------------------------------------

revoke execute on function public.edit_class_count_expiry(uuid, date, text) from public, anon;
grant execute on function public.edit_class_count_expiry(uuid, date, text) to authenticated;
