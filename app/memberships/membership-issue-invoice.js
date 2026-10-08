"use client";

import { IssueInvoiceDialog } from "@/app/memberships/[id]/issue-invoice";
import { formatDate } from "@/lib/format";
import { formatPeriod } from "@/lib/memberships/period";
import { PLAN } from "@/lib/status";

/**
 * The existing Issue Receipt dialog (app/memberships/[id]/issue-invoice.js), opened from a
 * membership row's action icon or menu instead of from Membership Details. It is that same
 * component - not a copy: this only turns a membership row into the props it takes, exactly as
 * Membership Details does (a recorded payment date is shown and used; with none, the Admin is asked
 * to confirm it).
 *
 * After a successful issue the `issueInvoice` action revalidates the membership pages, so the list
 * re-renders with the invoice and the action reads View Receipt - no manual reload.
 *
 * @param {object} props
 * @param {{ id: string, membership_code: string, plan: string, start_date: string, end_date: string, payment_date?: string|null }} props.membership
 * @param {{ full_name: string, student_code?: string, photo_url?: string|null }|null} props.student
 */
export default function MembershipIssueInvoiceDialog({ membership, student, open, onOpenChange }) {
  return (
    <IssueInvoiceDialog
      open={open}
      onOpenChange={onOpenChange}
      membershipId={membership.id}
      needsPaymentDate={!membership.payment_date}
      paymentDateLabel={membership.payment_date ? formatDate(membership.payment_date) : null}
      student={student}
      membership={{
        code: membership.membership_code,
        planLabel: PLAN[membership.plan] ?? membership.plan,
        period: formatPeriod(membership.start_date, membership.end_date),
      }}
    />
  );
}
