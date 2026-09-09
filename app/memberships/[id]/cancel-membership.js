"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { cancelMembership } from "@/lib/memberships/actions";

/**
 * Cancel Membership (02-ux.md Flow 15: "Memberships / Membership Details →
 * Select Membership → Cancel Membership → Review → Confirm → Save →
 * Membership Cancelled"). Mirrors
 * app/students/[id]/deactivate-student.js exactly: `cancelMembership` is
 * called directly (Next.js's own guidance for invoking a Server Action
 * outside a form, wrapped in `startTransition`), and the visible button
 * only ever opens the confirmation dialog — there is no path to
 * `cancelMembership` outside `onConfirm`.
 *
 * Hidden entirely once already cancelled — cancelling twice is rejected
 * server-side anyway (lib/memberships/actions.js), but there's no reason to
 * offer an action that can only fail.
 */
export default function CancelMembership({ membershipId, isCancelled }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)} disabled={isPending}>
        Cancel Membership
      </Button>

      {feedback ? (
        <p role="status" className="text-small text-danger">
          {feedback.text}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel membership"
        description="Cancel this membership? This does not delete the record — it remains available in Membership History and cannot be reversed."
        confirmLabel="Cancel Membership"
        destructive
        isPending={isPending}
        onConfirm={runCancel}
      />
    </div>
  );
}
