-- ===========================================================================
-- Legacy-data audit (READ-ONLY) - membership-level documents on memberships that also have payments
-- Relates to migrations 0034 (payments) and 0036 (payment-level documents)
-- ===========================================================================
--
-- WHY
--   Between applying 0034 and 0036, a membership that became Paid through recorded payments could still be given
--   a membership-level document (invoices.payment_id IS NULL) by the old auto-issue trigger or Issue Invoice.
--   0036 stopped that, but a membership from that window may now hold BOTH its membership-level document AND
--   payment-level documents for the same money - documented twice.
--
-- WHAT IT RETURNS
--   One row per membership that has a membership-level document AND at least one recorded payment.
--   finding:
--     'DOUBLE DOCUMENTED'      - it also has payment-level documents: the same money appears on two documents.
--     'MEMBERSHIP-LEVEL ONLY'  - its payments have no documents yet: issuing them now WOULD document it twice.
--   An empty result means nothing from that window needs attention.
--
-- SAFETY
--   A single SELECT. It writes nothing, takes no row locks, and changes no data. It suggests no fix: what to do
--   with any row it finds is a business decision (see the report).
-- ===========================================================================

select
  case when count(pd.id) > 0 then 'DOUBLE DOCUMENTED' else 'MEMBERSHIP-LEVEL ONLY' end as finding,
  m.membership_code,
  s.student_code,
  s.full_name                                                   as student_name,
  m.amount                                                      as membership_amount,
  m.payment_status,
  coalesce(md.invoice_prefix, '') || md.invoice_number::text    as membership_level_document,
  md.document_title                                             as membership_level_title,
  md.invoice_date                                               as membership_level_date,
  md.total_amount                                               as membership_level_total,
  md.created_at                                                 as membership_level_created_at,
  (select count(*) from public.membership_payments p where p.membership_id = m.id)                 as payments,
  (select coalesce(sum(p.amount), 0) from public.membership_payments p where p.membership_id = m.id) as payments_total,
  (select min(p.created_at) from public.membership_payments p where p.membership_id = m.id)          as first_payment_recorded_at,
  md.created_at > (select min(p.created_at) from public.membership_payments p where p.membership_id = m.id)
                                                                as membership_doc_after_first_payment,
  count(pd.id)                                                  as payment_documents,
  count(pd.id) filter (where pd.status = 'issued')              as payment_documents_issued,
  coalesce(sum(pd.total_amount) filter (where pd.status = 'issued'), 0) as payment_documents_issued_total,
  string_agg(coalesce(pd.invoice_prefix, '') || pd.invoice_number::text || ' (' || pd.document_series || ', ' || pd.status || ')',
             ', ' order by pd.created_at)                       as payment_document_numbers
from public.invoices md
join public.memberships m on m.id = md.membership_id
join public.students s on s.id = m.student_id
left join public.invoices pd on pd.membership_id = m.id and pd.payment_id is not null
where md.payment_id is null
  and exists (select 1 from public.membership_payments p where p.membership_id = m.id)
group by m.id, m.membership_code, s.student_code, s.full_name, m.amount, m.payment_status,
         md.id, md.invoice_prefix, md.invoice_number, md.document_title, md.invoice_date, md.total_amount, md.created_at
order by finding, md.created_at;
