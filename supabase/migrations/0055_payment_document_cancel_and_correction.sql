-- Cancel Document and Correct & Reissue for payment documents (V1 Tax Adjustment follow-up)
--
-- WHY
--   Correct Document (0037) cancels a payment document and issues a replacement from CURRENT data, with nothing the Admin can
--   correct: the replacement is the same document with a new number. This migration adds the two workflows the business rules ask for.
--   An issued document is never edited; it is cancelled and kept, and a correction is a cancelled original plus a linked replacement.
--
-- WHAT THIS MIGRATION DOES
--   1. membership_payment_edits gains two nullable columns - correction_reason and corrected_document_id - so the audit trail of a
--      payment correction records WHY and for which document. Every existing row stays valid.
--   2. edit_payment_core(payment, date, methods, allow_documented, reason, document): the body of edit_payment (0040), unchanged except
--      for three things - it may be allowed to edit a payment that already has a document, but ONLY when it is told which document of
--      that payment is being corrected; it checks that document belongs to the payment; and its audit row records the reason and the
--      document. edit_payment(payment, date, methods) becomes a thin wrapper that passes allow_documented = false, so its behaviour is
--      exactly what it was. The core is internal (no client execute).
--   3. issue_payment_document_core gets a fifth parameter, p_overrides: a whitelist of snapshot fields a replacement may carry instead
--      of the current student / centre values (customer name, phone, phone country code, email; business name, address, phone, email,
--      GSTIN of a tax invoice). The body is 0044's, unchanged, apart from where those nine values come from and the carry-forward
--      below. The four-argument function becomes a wrapper that passes no overrides. The student record and the centre profile are never
--      written; the overrides exist only on the replacement document.
--      CARRY-FORWARD: when the document replaces another (p_replaces_id), its plan, description, period_start, period_end,
--      service_details and service_details_tracked are COPIED FROM THE ORIGINAL, never re-read from the current membership, enrollment,
--      batch or schedule, and never invented for an original that had none (an untracked original stays untracked, with no details). A
--      first document is built from the membership exactly as before. This applies to correct_payment_document (0037) as well, since it
--      issues through the same core.
--   4. cancel_payment_document(document, reason) - Admin only. Cancels one issued payment document with a required reason and issues
--      nothing. The payment and the membership are untouched, and the payment stays locked (any document, even a cancelled one, locks
--      it - 0038 / 0040), so a payment can be corrected only through Correct & Reissue.
--   5. correct_and_reissue_payment_document(document, reason, invoice_date, methods, overrides, expected_total, expected_tax) -
--      Admin only, one transaction: locks the membership, the settings and the document; cancels the original with the reason;
--      when methods are given, corrects the payment (amount and method allocation, the payment date unchanged) through
--      edit_payment_core; issues the replacement in the SAME series with a NEW number, linked by replaces_id; and, when the
--      reviewed total or tax is given, refuses (55006) a replacement that differs from it. Any failure rolls back everything.
--
-- THE BALANCE RULE (enforced in the database, inside edit_payment_core, under the membership lock)
--   corrected total must be > 0, and <= memberships.amount - the sum of the OTHER payments of the SAME membership. The payment being
--   corrected is excluded from that sum, so its own previous amount is never counted twice. A payment that settles the balance exactly is
--   allowed. record_membership_payment, edit_payment and this correction all take the membership row lock first, so two writers cannot
--   interleave, and the deferred checks of 0034 (methods add up to the payment, payments never exceed the membership amount) still
--   guard every write at commit.
--
-- WHAT IT DOES NOT DO
--   * No existing row is inserted, updated or deleted, and no earlier migration is edited. No refund or credit note exists: a lower
--     corrected amount only changes the record; nothing says money was returned.
--   * Membership price, package terms, validity, attendance eligibility, other payments and their documents are not touched. The
--     membership's payment status and payment date are recomputed from its payments, exactly as edit_payment does.
--   * Legacy membership-level receipts (payment_id IS NULL) are not covered; both new functions refuse them (55000).
--   * Nothing is backfilled: no existing document gains, loses or changes any service detail, plan, description or period.
--   * Numbering, series, tax rules and the freeze trigger are unchanged: a replacement uses issue_payment_document_core, which computes
--     tax-inclusive tax from the payment amount and the current rate for a tax invoice, and none for a payment receipt.
--
-- RERUN
--   Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE. Run it as one transaction.
--
-- RE-RUNNING OTHER MIGRATIONS
--   0040 re-creates edit_payment, and 0044 re-creates the four-argument issue_payment_document_core, each with its own body: after
--   either, the wrappers of this migration are replaced by the old bodies (the corrected-payment path then refuses a documented payment,
--   and a replacement ignores its overrides). If 0040 or 0044 is ever re-run, re-apply 0055 afterwards.

do $$
begin
  if to_regclass('public.membership_payment_edits') is null or to_regclass('public.membership_payments') is null then
    raise exception '0055 needs migrations 0034 and 0038 (payments and their edit audit) applied first.';
  end if;
  if to_regprocedure('public.edit_payment(uuid, date, jsonb)') is null then
    raise exception '0055 needs migration 0040 (public.edit_payment) applied first.';
  end if;
  if to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)') is null
     or to_regprocedure('public.correct_payment_document(uuid, text)') is null then
    raise exception '0055 needs migration 0037 (payment document corrections) applied first.';
  end if;
  if to_regprocedure('public.membership_service_details(uuid)') is null
     or position('membership_service_details' in pg_get_functiondef(to_regprocedure('public.issue_payment_document_core(uuid, date, text, uuid)'))) = 0 then
    raise exception '0055 needs the issue_payment_document_core of migration 0044 (with service details) in place.';
  end if;
  if to_regprocedure('public.record_membership_payment(uuid, date, jsonb, boolean)') is null then
    raise exception '0055 needs public.record_membership_payment (migrations 0034 and 0035) applied first.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception '0055 needs public.is_admin().';
  end if;
end
$$;


-- 1. The audit trail also records the reason and the document -----------------------------------------------------

alter table public.membership_payment_edits
  add column if not exists correction_reason text,
  add column if not exists corrected_document_id uuid references public.invoices (id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'membership_payment_edits_reason_valid') then
    alter table public.membership_payment_edits
      add constraint membership_payment_edits_reason_valid
      check (correction_reason is null or (correction_reason = btrim(correction_reason) and length(correction_reason) between 1 and 500));
  end if;
end
$$;

comment on column public.membership_payment_edits.correction_reason is
  'The reason given when the edit was made as part of Correct & Reissue (NULL for an ordinary edit before a document exists).';
comment on column public.membership_payment_edits.corrected_document_id is
  'The document that was cancelled by the correction this edit belongs to (NULL for an ordinary edit). Its replacement is the document whose replaces_id points at it.';


-- 2. edit_payment_core, and edit_payment as its unchanged wrapper ----------------------------------------------------

create or replace function public.edit_payment_core(
  p_payment_id       uuid,
  p_payment_date     date,
  p_methods          jsonb,
  p_allow_documented boolean,
  p_reason           text,
  p_document_id      uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment   public.membership_payments%rowtype;
  v_mem       public.memberships%rowtype;
  v_today     date;
  v_entry     jsonb;
  v_method    text;
  v_amount    numeric;
  v_reference text;
  v_notes     text;
  v_total     numeric(12, 2) := 0;
  v_other     numeric(12, 2);
  v_previous  jsonb;
  v_new       jsonb := '[]'::jsonb;
  v_status    text;
  v_latest    date;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_payment
  from public.membership_payments
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  -- The membership row first (the order every payment write and every document issue takes), then the payment.
  select * into v_mem
  from public.memberships
  where id = v_payment.membership_id
  for update;

  select * into v_payment
  from public.membership_payments
  where id = p_payment_id
  for update;

  -- Once any document exists - issued or cancelled - the payment is part of the record: Cancel and Reissue. (0055: that correction
  -- is the only caller that passes p_allow_documented, and it must name a document of this very payment.)
  if not p_allow_documented and exists (select 1 from public.invoices where payment_id = v_payment.id) then
    raise exception 'A document has been issued for this payment, so it cannot be edited.' using errcode = '55006';
  end if;

  if p_allow_documented and not exists (select 1 from public.invoices where id = p_document_id and payment_id = v_payment.id) then
    raise exception 'The correction must name a document of this payment.' using errcode = '22023';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;

  if p_payment_date is null then
    raise exception 'The payment date is required.' using errcode = '22023';
  end if;

  if p_payment_date > v_today then
    raise exception 'The payment date cannot be in the future.' using errcode = '22023';
  end if;

  if p_methods is null or jsonb_typeof(p_methods) <> 'array' or jsonb_array_length(p_methods) = 0 then
    raise exception 'Add at least one payment method.' using errcode = '22023';
  end if;

  -- Validate every entry before writing anything, and build the normalized list as it will be stored.
  for v_entry in select value from jsonb_array_elements(p_methods) loop
    v_method := v_entry ->> 'method';
    if v_method is null or v_method not in ('cash', 'card', 'upi', 'bank_transfer', 'other') then
      raise exception 'Select a valid payment method.' using errcode = '22023';
    end if;

    begin
      v_amount := (v_entry ->> 'amount')::numeric;
    exception when others then
      v_amount := null;
    end;
    if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
      raise exception 'Each payment method needs an amount greater than zero, with at most two decimals.' using errcode = '22023';
    end if;

    v_reference := nullif(btrim(coalesce(v_entry ->> 'reference_id', '')), '');
    v_notes := nullif(btrim(coalesce(v_entry ->> 'notes', '')), '');

    v_total := v_total + v_amount;
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'method', v_method, 'amount', round(v_amount, 2), 'reference_id', v_reference, 'notes', v_notes));
  end loop;

  -- The membership amount less what the OTHER payments already cover: this payment's previous amount is available.
  select coalesce(sum(amount), 0) into v_other
  from public.membership_payments
  where membership_id = v_mem.id and id <> v_payment.id;

  if v_total > v_mem.amount - v_other then
    raise exception 'The payment cannot be more than the outstanding balance.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'method', m.method, 'amount', m.amount, 'reference_id', m.reference_id, 'notes', m.notes) order by m.position),
         '[]'::jsonb)
    into v_previous
  from public.membership_payment_methods m
  where m.payment_id = v_payment.id;

  -- Nothing to record when nothing changes.
  if v_payment.payment_date = p_payment_date and v_previous = v_new then
    return v_payment.id;
  end if;

  -- The methods are replaced, then the payment's date and total: the deferred checks of 0034 see the methods add up
  -- to the payment at commit.
  delete from public.membership_payment_methods where payment_id = v_payment.id;

  insert into public.membership_payment_methods (payment_id, position, method, amount, reference_id, notes)
  select v_payment.id, t.ord::smallint, t.entry ->> 'method', (t.entry ->> 'amount')::numeric,
         t.entry ->> 'reference_id', t.entry ->> 'notes'
  from jsonb_array_elements(v_new) with ordinality as t(entry, ord);

  update public.membership_payments
  set payment_date = p_payment_date,
      amount       = v_total
  where id = v_payment.id;

  insert into public.membership_payment_edits (
    payment_id, edited_by, previous_amount, new_amount, previous_allocations, new_allocations,
    previous_payment_date, new_payment_date, correction_reason, corrected_document_id
  )
  values (
    v_payment.id, auth.uid(), v_payment.amount, v_total, v_previous, v_new,
    v_payment.payment_date, p_payment_date, p_reason, p_document_id
  );

  -- The membership's status follows its payments; while Paid, its payment date is the latest payment's date.
  v_status := case when v_other + v_total >= v_mem.amount then 'paid' else 'partially_paid' end;

  select max(payment_date) into v_latest
  from public.membership_payments
  where membership_id = v_mem.id;

  if v_status is distinct from v_mem.payment_status
     or (case when v_status = 'paid' then v_latest end) is distinct from v_mem.payment_date then
    -- Mark this transaction for this one membership: the payments guard (0034) lets the status follow.
    perform set_config('yoga.payment_status_sync', v_mem.id::text, true);

    update public.memberships
    set payment_status = v_status,
        payment_date   = case when v_status = 'paid' then v_latest else null end
    where id = v_mem.id;

    perform set_config('yoga.payment_status_sync', '', true);
  end if;

  return v_payment.id;
end;
$$;

comment on function public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid) is
  'Internal. edit_payment (0040) with one addition: when allowed, it edits a payment that has a document, but only for a named document of that payment, and the audit row records the reason and the document. Same balance rule, same locks.';

revoke execute on function public.edit_payment_core(uuid, date, jsonb, boolean, text, uuid) from public, anon, authenticated;

create or replace function public.edit_payment(
  p_payment_id   uuid,
  p_payment_date date,
  p_methods      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.edit_payment_core(p_payment_id, p_payment_date, p_methods, false, null, null);
end;
$$;

comment on function public.edit_payment(uuid, date, jsonb) is
  'Admin only. Edits a recorded payment - its date and its methods (type, amount, reference ID, notes; added, changed or removed) - while no document exists for it; records the edit in membership_payment_edits and recomputes the membership''s payment status and date.';

revoke execute on function public.edit_payment(uuid, date, jsonb) from public, anon;
grant execute on function public.edit_payment(uuid, date, jsonb) to authenticated;


-- 3. issue_payment_document_core with overrides, and the four-argument function as its unchanged wrapper -------------

create or replace function public.issue_payment_document_core(
  p_payment_id    uuid,
  p_document_date date,
  p_series        text,
  p_replaces_id   uuid,
  p_overrides     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment   public.membership_payments%rowtype;
  v_mem       public.memberships%rowtype;
  v_settings  public.invoice_settings%rowtype;
  v_student   public.students%rowtype;
  v_center    public.center_profile%rowtype;
  v_bank      public.bank_accounts%rowtype;
  v_series    text;
  v_taxed     boolean;
  v_today     date;
  v_doc_date  date;
  v_candidate bigint;
  v_taxable   numeric(10, 2);
  v_tax       numeric(10, 2);
  v_logo_path text;
  v_id        uuid;
  v_c_name    text;
  v_c_phone   text;
  v_c_phone_cc text;
  v_c_email   text;
  v_b_name    text;
  v_b_address text;
  v_b_phone   text;
  v_b_email   text;
  v_b_gstin   text;
  v_orig      public.invoices%rowtype;
  v_plan      text;
  v_description text;
  v_period_start date;
  v_period_end   date;
  v_service_details jsonb;
  v_service_tracked boolean;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_payment
  from public.membership_payments
  where id = p_payment_id;

  if not found then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;

  -- The same lock order as issue_invoice_core: the membership row, then the settings row. Every
  -- issue of every series holds the settings row, so two issues never take the same number.
  select * into v_mem
  from public.memberships
  where id = v_payment.membership_id
  for update;

  select * into v_settings
  from public.invoice_settings
  where singleton
  for update;

  -- 0038: read the payment again, locked, now that the membership is locked - an amount edit (which holds the
  -- membership lock while it changes the payment) can no longer leave this issue with the amount read above.
  select * into v_payment
  from public.membership_payments
  where id = p_payment_id
  for update;

  if exists (select 1 from public.invoices where payment_id = v_payment.id and status = 'issued') then
    raise exception 'A document has already been issued for this payment.' using errcode = '23505';
  end if;

  -- 0039: a membership that already has a membership-level document (payment_id is null) is documented once,
  -- at membership level; its payments get no document of their own, or the same money would appear on two
  -- documents. Only a FIRST document is refused: a replacement (p_replaces_id) replaces a payment document
  -- that already exists and adds none, so correcting an existing payment document stays possible.
  if p_replaces_id is null
     and exists (select 1 from public.invoices where membership_id = v_mem.id and payment_id is null) then
    raise exception 'A membership invoice already exists for this membership.' using errcode = '55000';
  end if;

  -- A replacement keeps the series of the document it replaces; a first document follows the payment's choice.
  v_series := coalesce(p_series, case when v_payment.issue_tax_invoice then 'invoice' else 'payment_receipt' end);

  if v_series = 'invoice' and v_settings.starting_invoice_number is null then
    raise exception 'Invoice numbering has not been configured.' using errcode = '55000';
  end if;

  if v_series = 'payment_receipt' and v_settings.payment_receipt_starting_number is null then
    raise exception 'Payment receipt numbering has not been configured.' using errcode = '55000';
  end if;

  v_today := (now() at time zone public.centre_timezone())::date;
  v_doc_date := coalesce(p_document_date, v_payment.payment_date);

  if v_doc_date < v_payment.payment_date then
    raise exception 'The document date cannot be before the payment date.' using errcode = '22023';
  end if;

  if v_doc_date > v_today then
    raise exception 'The document date cannot be in the future.' using errcode = '22023';
  end if;

  select * into v_student from public.students where id = v_mem.student_id;
  select * into v_center from public.center_profile where singleton;

  if v_student.id is null or v_center.singleton is null then
    raise exception 'The student or centre profile could not be read.' using errcode = 'P0002';
  end if;

  -- 0055: the snapshot values a replacement may carry instead of the current student / centre values. A whitelist: any other key
  -- is refused. Only this document is affected; the student record and the centre profile are never written. An empty text clears an
  -- optional value; the names must stay non-blank; a GSTIN is for a tax invoice only (its format is the table's own CHECK).
  if p_overrides is not null then
    if jsonb_typeof(p_overrides) <> 'object' then
      raise exception 'The corrections must be an object.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_object_keys(p_overrides) as k
      where k not in ('customer_name', 'customer_phone', 'customer_phone_country_code', 'customer_email',
                      'business_name', 'business_address', 'business_phone', 'business_email', 'business_gstin')
    ) then
      raise exception 'That detail cannot be corrected on a document.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(p_overrides) as e where jsonb_typeof(e.value) not in ('string', 'null')) then
      raise exception 'Each corrected detail must be text.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each_text(p_overrides) as e where length(e.value) > 500) then
      raise exception 'A corrected detail can have at most 500 characters.' using errcode = '22023';
    end if;
    if p_overrides ? 'business_gstin' and v_series <> 'invoice' then
      raise exception 'A GSTIN can be corrected on a tax invoice only.' using errcode = '22023';
    end if;
  end if;

  v_c_name := case when p_overrides ? 'customer_name' then nullif(btrim(p_overrides ->> 'customer_name'), '') else v_student.full_name end;
  v_c_phone := case when p_overrides ? 'customer_phone' then nullif(btrim(p_overrides ->> 'customer_phone'), '') else v_student.phone end;
  v_c_phone_cc := case when p_overrides ? 'customer_phone_country_code' then nullif(btrim(p_overrides ->> 'customer_phone_country_code'), '') else v_student.phone_country_code end;
  v_c_email := case when p_overrides ? 'customer_email' then nullif(btrim(p_overrides ->> 'customer_email'), '') else v_student.email end;
  v_b_name := case when p_overrides ? 'business_name' then nullif(btrim(p_overrides ->> 'business_name'), '') else v_center.name end;
  v_b_address := case when p_overrides ? 'business_address' then nullif(btrim(p_overrides ->> 'business_address'), '') else v_center.address end;
  v_b_phone := case when p_overrides ? 'business_phone' then nullif(btrim(p_overrides ->> 'business_phone'), '') else v_center.phone end;
  v_b_email := case when p_overrides ? 'business_email' then nullif(btrim(p_overrides ->> 'business_email'), '') else v_center.email end;
  v_b_gstin := case when p_overrides ? 'business_gstin' then nullif(btrim(p_overrides ->> 'business_gstin'), '') else v_settings.gstin end;

  if v_c_name is null then
    raise exception 'The customer name is required.' using errcode = '22023';
  end if;
  if v_b_name is null then
    raise exception 'The business name is required.' using errcode = '22023';
  end if;

  -- 0055: a replacement carries forward what the document it replaces says about the membership - plan, description, period, and
  -- the service details with their tracked marker - exactly as that document stored them. Nothing is re-read from the current
  -- membership, enrollment, batch or schedule, and nothing is invented for a document that never had service details. A first
  -- document is built from the membership, as before.
  if p_replaces_id is null then
    v_plan := v_mem.plan;
    v_description := case v_mem.plan
      when 'monthly' then 'Monthly'
      when 'quarterly' then 'Quarterly'
      when 'half_yearly' then 'Half Yearly'
      when 'annual' then 'Annual'
      when 'class_count' then 'Class Count'
      else 'Custom duration'
    end || ' Membership';
    v_period_start := v_mem.start_date;
    v_period_end := v_mem.end_date;
    v_service_details := public.membership_service_details(v_mem.id);
    v_service_tracked := true;
  else
    select * into v_orig
    from public.invoices
    where id = p_replaces_id and payment_id = v_payment.id;

    if not found then
      raise exception 'The replaced document must be a document of this payment.' using errcode = '22023';
    end if;

    v_plan := v_orig.plan;
    v_description := v_orig.description;
    v_period_start := v_orig.period_start;
    v_period_end := v_orig.period_end;
    v_service_details := v_orig.service_details;
    v_service_tracked := v_orig.service_details_tracked;
  end if;

  -- The next free number of the payment's own series: never reserved, never held by a document of it.
  if v_series = 'invoice' then
    v_candidate := coalesce(v_settings.next_invoice_number, v_settings.starting_invoice_number);
    while exists (select 1 from public.invoice_number_reservations where invoice_number = v_candidate)
       or exists (select 1 from public.invoices where invoice_number = v_candidate and document_series = 'invoice') loop
      v_candidate := v_candidate + 1;
    end loop;
  else
    v_candidate := coalesce(v_settings.payment_receipt_next_number, v_settings.payment_receipt_starting_number);
    while exists (select 1 from public.payment_receipt_number_reservations where receipt_number = v_candidate)
       or exists (select 1 from public.invoices where invoice_number = v_candidate and document_series = 'payment_receipt') loop
      v_candidate := v_candidate + 1;
    end loop;
  end if;

  -- Tax (tax-inclusive, as issue_invoice_core) only on a tax invoice, and only while tax is enabled.
  v_taxed := v_series = 'invoice' and v_settings.tax_enabled;
  if v_taxed then
    v_tax := round(v_payment.amount * v_settings.tax_rate / (100 + v_settings.tax_rate), 2);
    v_taxable := v_payment.amount - v_tax;
  end if;

  v_logo_path := substring(v_center.logo_url from '/storage/v1/object/public/profile-photos/([^?]+)');

  select * into v_bank
  from public.bank_accounts
  where is_active;

  insert into public.invoices (
    membership_id, payment_id, document_series,
    invoice_number, invoice_date, payment_date,
    document_title, description, plan, period_start, period_end,
    currency, total_amount,
    tax_enabled, tax_name, tax_rate, taxable_amount, tax_amount,
    customer_name, customer_code, customer_phone, customer_phone_country_code, customer_email,
    business_name, business_address, business_phone, business_email, business_logo_path, business_gstin,
    terms, signatory_name, signatory_designation, signature_path,
    invoice_prefix,
    bank_name, bank_account_name, bank_account_number, bank_ifsc_code, bank_branch,
    service_details, service_details_tracked,
    replaces_id
  )
  values (
    v_mem.id, v_payment.id, v_series,
    v_candidate, v_doc_date, v_payment.payment_date,
    case when v_series = 'invoice' then v_settings.document_title else 'payment_receipt' end,
    v_description,
    v_plan, v_period_start, v_period_end,
    v_mem.currency, v_payment.amount,
    v_taxed,
    case when v_taxed then v_settings.tax_name end,
    case when v_taxed then v_settings.tax_rate end,
    v_taxable, v_tax,
    v_c_name, v_student.student_code, v_c_phone, v_c_phone_cc, v_c_email,
    v_b_name, v_b_address, v_b_phone, v_b_email, v_logo_path, case when v_series = 'invoice' then v_b_gstin end,
    v_settings.terms, v_settings.signatory_name, v_settings.signatory_designation, v_settings.signature_path,
    case when v_series = 'invoice' then v_settings.invoice_prefix else v_settings.payment_receipt_prefix end,
    v_bank.bank_name, v_bank.account_name, v_bank.account_number, v_bank.ifsc_code, v_bank.branch,
    v_service_details, v_service_tracked,
    p_replaces_id
  )
  returning id into v_id;

  if v_series = 'invoice' then
    update public.invoice_settings set next_invoice_number = v_candidate + 1 where singleton;
  else
    update public.invoice_settings set payment_receipt_next_number = v_candidate + 1 where singleton;
  end if;

  return v_id;
end;
$$;

comment on function public.issue_payment_document_core(uuid, date, text, uuid, jsonb) is
  'Internal. Issues a payment document in the given series (or the series the payment chose), optionally as the replacement of a cancelled one, optionally with whitelisted customer / business snapshot overrides. Reads the payment after taking the membership and settings locks.';

revoke execute on function public.issue_payment_document_core(uuid, date, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.issue_payment_document_core(
  p_payment_id    uuid,
  p_document_date date,
  p_series        text,
  p_replaces_id   uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.issue_payment_document_core(p_payment_id, p_document_date, p_series, p_replaces_id, null);
end;
$$;

comment on function public.issue_payment_document_core(uuid, date, text, uuid) is
  'Internal. The four-argument form: issues a payment document with no overrides (the current student and centre values).';

revoke execute on function public.issue_payment_document_core(uuid, date, text, uuid) from public, anon, authenticated;


-- 4. Cancel Document -------------------------------------------------------------------------------------------------

create or replace function public.cancel_payment_document(
  p_document_id uuid,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc    public.invoices%rowtype;
  v_reason text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Enter the reason for the cancellation.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason can have at most 500 characters.' using errcode = '22023';
  end if;

  select * into v_doc
  from public.invoices
  where id = p_document_id;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if v_doc.payment_id is null then
    raise exception 'Only a payment document can be cancelled.' using errcode = '55000';
  end if;

  -- The same lock order as every issue and correction: the membership row, then the settings row, then the document.
  perform 1 from public.memberships where id = v_doc.membership_id for update;
  perform 1 from public.invoice_settings where singleton for update;

  select * into v_doc
  from public.invoices
  where id = p_document_id
  for update;

  if v_doc.status <> 'issued' then
    raise exception 'This document has already been cancelled.' using errcode = '55006';
  end if;

  -- Only this document, only its cancellation columns (the freeze trigger checks).
  perform set_config('yoga.invoice_cancel', v_doc.id::text, true);

  update public.invoices
  set status              = 'cancelled',
      cancelled_at        = now(),
      cancelled_by        = auth.uid(),
      cancellation_reason = v_reason,
      updated_at          = now()
  where id = v_doc.id;

  perform set_config('yoga.invoice_cancel', '', true);

  return v_doc.id;
end;
$$;

comment on function public.cancel_payment_document(uuid, text) is
  'Admin only. Cancels one issued payment document with a required reason and issues no replacement. The document keeps its number and details; the payment and the membership are untouched, and the payment stays locked.';


-- 5. Correct & Reissue -----------------------------------------------------------------------------------------------
-- p_methods:  NULL leaves the payment as it is; a JSON array (the shape record_membership_payment takes) replaces its methods and
--             sets its amount to their total, under the balance rule above. The payment date never changes.
-- p_overrides: NULL, or an object with any of customer_name, customer_phone, customer_phone_country_code, customer_email,
--             business_name, business_address, business_phone, business_email, business_gstin (tax invoices only).
-- p_invoice_date: NULL keeps the original document's date.
-- p_expected_total / p_expected_tax: what the Admin reviewed; a replacement that differs is refused and everything rolls back.

create or replace function public.correct_and_reissue_payment_document(
  p_document_id    uuid,
  p_reason         text,
  p_invoice_date   date    default null,
  p_methods        jsonb   default null,
  p_overrides      jsonb   default null,
  p_expected_total numeric default null,
  p_expected_tax   numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc     public.invoices%rowtype;
  v_payment public.membership_payments%rowtype;
  v_new     public.invoices%rowtype;
  v_reason  text;
  v_new_id  uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'Enter the reason for the correction.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'The reason can have at most 500 characters.' using errcode = '22023';
  end if;

  select * into v_doc
  from public.invoices
  where id = p_document_id;

  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if v_doc.payment_id is null then
    raise exception 'Only a payment document can be corrected.' using errcode = '55000';
  end if;

  -- The same lock order as every issue: the membership row, then the settings row - then the document, so a concurrent
  -- correction of the same document waits here and then finds it cancelled (and so can never issue a second replacement).
  perform 1 from public.memberships where id = v_doc.membership_id for update;
  perform 1 from public.invoice_settings where singleton for update;

  select * into v_doc
  from public.invoices
  where id = p_document_id
  for update;

  if v_doc.status <> 'issued' then
    raise exception 'This document has already been cancelled.' using errcode = '55006';
  end if;

  -- 1. Cancel the original: only this document, only its cancellation columns.
  perform set_config('yoga.invoice_cancel', v_doc.id::text, true);

  update public.invoices
  set status              = 'cancelled',
      cancelled_at        = now(),
      cancelled_by        = auth.uid(),
      cancellation_reason = v_reason,
      updated_at          = now()
  where id = v_doc.id;

  perform set_config('yoga.invoice_cancel', '', true);

  -- 2. Correct the payment, when methods were given: the balance rule is checked inside, against the same membership's other
  --    payments, and the membership's status and payment date follow. The payment date is kept as it is.
  if p_methods is not null then
    select * into v_payment
    from public.membership_payments
    where id = v_doc.payment_id;

    perform public.edit_payment_core(v_doc.payment_id, v_payment.payment_date, p_methods, true, v_reason, v_doc.id);
  end if;

  -- 3. Issue the replacement: the same series, a new number, linked to the original, with the corrected snapshot values.
  v_new_id := public.issue_payment_document_core(
    v_doc.payment_id, coalesce(p_invoice_date, v_doc.invoice_date), v_doc.document_series, v_doc.id, p_overrides);

  select * into v_new from public.invoices where id = v_new_id;

  if p_expected_total is not null and v_new.total_amount is distinct from p_expected_total then
    raise exception 'The corrected document is not the one that was reviewed. Review it again.' using errcode = '55006';
  end if;
  if p_expected_tax is not null and coalesce(v_new.tax_amount, 0) is distinct from p_expected_tax then
    raise exception 'The corrected document is not the one that was reviewed. Review it again.' using errcode = '55006';
  end if;

  return v_new_id;
end;
$$;

comment on function public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric) is
  'Admin only. Corrects a payment document: cancels it with the reason, optionally corrects the payment (amount and methods, within the membership balance), and issues a linked replacement in the same series with a new number and the corrected customer / business values, atomically.';


-- 6. Privileges ------------------------------------------------------------------------------------------------------

revoke execute on function public.cancel_payment_document(uuid, text) from public, anon;
grant execute on function public.cancel_payment_document(uuid, text) to authenticated;

revoke execute on function public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric) from public, anon;
grant execute on function public.correct_and_reissue_payment_document(uuid, text, date, jsonb, jsonb, numeric, numeric) to authenticated;
