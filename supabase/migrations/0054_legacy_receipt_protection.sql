-- Legacy issued receipt protection (V1 Fee Structure, FS-D)
--
-- WHAT THIS MIGRATION DOES
--   Removes the automatic "receipt follows the membership" path of migration 0030, so an ISSUED membership-level receipt (a document
--   with payment_id IS NULL, which only a legacy membership can hold) is never rewritten silently:
--     1. drops the trigger memberships_sync_invoice_trigger on public.memberships;
--     2. drops its trigger function public.memberships_sync_invoice();
--     3. drops public.sync_invoice_from_membership(uuid), the function that rewrote the receipt's plan, description, period, total,
--        taxable and tax amounts (and, for a tracked receipt, its service details).
--   After it, editing a legacy membership's amount, plan, start date or end date changes the MEMBERSHIP only. The receipt keeps what it
--   was issued with. This applies the approved rule of 01-product.md: an issued invoice or receipt never changes silently.
--
-- WHAT IT DOES NOT CHANGE
--   * Receipt issuance: issue_invoice, issue_invoice_core and the auto-issue trigger memberships_auto_issue_invoice_trigger are untouched.
--     A receipt is still issued from the membership's values at the moment it is issued.
--   * Numbering and reservations, update_invoice_details (number and date edits), the snapshot protection invoices_freeze_snapshot
--     (it still refuses any other change to an issued document), cancellation, payment documents and their cancel-and-reissue correction.
--   * No row: it updates, inserts and deletes nothing. Receipts that an earlier edit already rewrote are not restored; the database
--     keeps no earlier values to restore them from.
--   * invoices_freeze_snapshot still contains its exemption for the transaction marker yoga.invoice_sync. With the function that set the
--     marker gone, nothing in the application sets it any more; the exemption is left in place on purpose, to keep this change to the
--     three drops.
--
-- KNOWN LIMIT (accepted)
--   There is no cancel-and-reissue correction for a membership-level receipt: correct_payment_document covers payment documents only
--   (invoices_correction_payment_only). A legacy receipt can have its number and date edited; its other fields stay as issued, so it can
--   now differ from its membership. Providing a correction process for these receipts is a separate, later decision.
--
-- RERUN
--   Idempotent: every drop uses IF EXISTS. Run it as one transaction.
--
-- RE-RUNNING OTHER MIGRATIONS
--   0030 (which created the trigger and its trigger function) INSTALLS the sync path again if it is re-run AFTER 0054, and 0031, 0033,
--   0036 and 0044 re-create sync_invoice_from_membership(uuid) in the same way. 0049 (which re-created the trigger with the class-count
--   expiry condition) would refuse to run after 0054, because its own precondition needs memberships_sync_invoice(); if it were forced
--   after re-running 0030, it would install the trigger as well. If any of them is ever re-run, re-apply 0054 afterwards, and run
--   supabase/verification/verify_0054_legacy_receipt_protection.sql.

do $$
begin
  if to_regclass('public.memberships') is null or to_regclass('public.invoices') is null then
    raise exception '0054 needs the memberships and invoices tables (migrations 0026 and earlier) applied first.';
  end if;
  if to_regprocedure('public.invoices_freeze_snapshot()') is null then
    raise exception '0054 needs public.invoices_freeze_snapshot() (migration 0030 and later) applied first - the snapshot protection must exist.';
  end if;
  if to_regprocedure('public.memberships_auto_issue_invoice()') is null then
    raise exception '0054 needs public.memberships_auto_issue_invoice() (migration 0036) applied first - receipt issuance must exist.';
  end if;
  if to_regprocedure('public.update_invoice_details(uuid, bigint, date)') is null then
    raise exception '0054 needs public.update_invoice_details(uuid, bigint, date) applied first - number and date edits must exist.';
  end if;
  if to_regclass('public.class_count_expiry_edits') is null then
    raise exception '0054 needs migration 0049 (which last defined the sync trigger) applied first.';
  end if;
end
$$;

drop trigger if exists memberships_sync_invoice_trigger on public.memberships;

drop function if exists public.memberships_sync_invoice();

drop function if exists public.sync_invoice_from_membership(uuid);
