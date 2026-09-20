"use client";

import { useState, useTransition } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cancelMembership } from "@/lib/memberships/actions";

/**
 * Cancel Membership (02-ux.md Flow 15: "Memberships / Membership Details →
 * Select Membership → Cancel Membership → Review → Confirm → Save →
 * Membership Cancelled"). Mirrors
 * app/students/[id]/deactivate-student.js exactly: `cancelMembership` is
 * called directly (Next.js's own guidance for invoking a Server Action
 * outside a form, wrapped in `startTransition`), and the menu item only ever
 * opens the confirmation dialog — there is no path to `cancelMembership`
 * outside `onConfirm`. The trigger is the finalized overflow (⋮) button
 * beside Edit / Renew; the action, its dialog and its rules are unchanged.
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isPending}
              aria-label="More membership actions"
            />
          }
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
            Cancel Membership
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {feedback ? (
        <p role="status" className="text-small w-full text-right text-danger">
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
    </>
  );
}
