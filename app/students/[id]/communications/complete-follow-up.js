"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import { completeStudentFollowUp } from "@/lib/communications/actions";
import { showSuccessToast } from "@/components/ui/success-toast";

/**
 * Mark as Completed - for a PENDING follow-up. A confirmation, then the follow-up is Completed: its date and note stay exactly as
 * recorded, and when and by whom it was completed are added. No new communication is created; when the student is contacted
 * again, staff add a separate communication.
 */
export default function CompleteFollowUp({ studentId, student, communicationId, subject, dueLabel }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [isPending, startTransition] = useTransition();
  const inFlight = useRef(false);

  function handleOpenChange(next) {
    if (!next && inFlight.current) return;
    setOpen(next);
    if (!next) setError(null);
  }

  function complete() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);

    startTransition(async () => {
      try {
        const result = await completeStudentFollowUp(studentId, communicationId);
        if (result?.error) {
          setError(result.error);
          return;
        }
        inFlight.current = false;
        handleOpenChange(false);
        showSuccessToast("Follow-up completed successfully.");
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} aria-label={`Mark the follow-up for ${subject} as completed`}>
        <CircleCheck className="size-4" aria-hidden="true" />
        Mark as Completed
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        tone="success"
        title="Complete follow-up"
        context={<StudentContext student={student} />}
        description={`Mark the follow-up for "${subject}" (due ${dueLabel}) as completed? Its date and note are kept. No new communication is added.`}
        confirmLabel="Mark as Completed"
        pendingLabel="Saving…"
        isPending={isPending}
        onConfirm={complete}
      >
        {error ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
