"use client";

import { useState, useTransition } from "react";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cancelMembership } from "@/lib/memberships/actions";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";
import { IssueInvoiceDialog } from "@/app/memberships/[id]/issue-invoice";

/**
 * Cancel Membership (02-ux.md Flow 15: "Memberships / Membership Details →
 * Select Membership → Cancel Membership → Review → Confirm → Save →
 * Membership Cancelled"). Mirrors
 * app/students/[id]/student-status-button.js exactly: `cancelMembership` is
 * called directly (Next.js's own guidance for invoking a Server Action
 * outside a form, wrapped in `startTransition`), and the menu item only ever
 * opens the confirmation dialog — there is no path to `cancelMembership`
 * outside `onConfirm`. The trigger is the finalized overflow (⋮) button
 * beside Edit / Renew; the action, its dialog and its rules are unchanged. The
 * menu around it is the shared `MembershipCardMenu` (View Membership, Edit,
 * Renew, the status-aware document action, View Student), with Cancel Membership after its own
 * divider. For a Paid membership with no receipt the document item is Issue Receipt, which opens the
 * existing Issue Receipt dialog from here (`invoiceToIssue` carries the same props Membership Details'
 * own button gives it; it is null when there is nothing to issue).
 *
 * Hidden entirely once already cancelled — cancelling twice is rejected
 * server-side anyway (lib/memberships/actions.js), but there's no reason to
 * offer an action that can only fail.
 */
export default function CancelMembership({ membershipId, studentId, paymentStatus, invoiceExists, hasPayments = false, invoiceToIssue, isCancelled, student, membership }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();

  if (isCancelled) {
    return null;
  }

  function runCancel() {
    startTransition(async () => {
      const result = await cancelMembership(membershipId);
      if (result?.error) {
        setFeedback({ type: "error", text: result.error });
      }
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <MembershipCardMenu
        membershipId={membershipId}
        studentId={studentId}
        paymentStatus={paymentStatus}
        invoiceExists={invoiceExists}
        hasPayments={hasPayments}
        onIssueInvoice={() => setIssueOpen(true)}
        triggerVariant="outline"
        triggerSize="icon"
        triggerClassName=""
        triggerLabel="More membership actions"
        triggerDisabled={isPending}
        extraItems={
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            Cancel Membership
          </DropdownMenuItem>
        }
      />

      {feedback ? (
        <p role="status" className="text-small w-full text-right text-danger">
          {feedback.text}
        </p>
      ) : null}

      {invoiceToIssue ? (
        <IssueInvoiceDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          membershipId={membershipId}
          needsPaymentDate={invoiceToIssue.needsPaymentDate}
          paymentDateLabel={invoiceToIssue.paymentDateLabel}
          student={student}
          membership={membership}
        />
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel membership"
        context={<StudentContext student={student} membership={membership} />}
        description="Cancel this membership? This does not delete the record — it remains available in Membership History and cannot be reversed."
        confirmLabel="Cancel Membership"
        destructive
        isPending={isPending}
        onConfirm={runCancel}
      />
    </>
  );
}
