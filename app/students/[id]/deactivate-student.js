"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { setStudentStatus } from "@/lib/students/actions";

/**
 * Deactivate / Activate Student (wireframe p10; 02-ux.md Flow 11:
 * "Students → Select Student → Deactivate Student → Review → Confirm →
 * Save → Student Inactive").
 *
 * Only deactivation goes through the Review → Confirm gate — Flow 11 exists
 * specifically for deactivation, and no equivalent flow documents
 * reactivation, so activation stays a plain one-click action rather than
 * inventing a second confirmation workflow.
 *
 * `setStudentStatus` is called directly (per Next.js's own guidance for
 * invoking a Server Action outside a form: from an event handler wrapped in
 * `startTransition`), matching lib/instructors/actions.js's
 * `setInstructorStatus` usage pattern.
 */
export default function DeactivateStudent({ studentId, studentName, status }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();

  function runStatusChange(nextStatus) {
    startTransition(async () => {
      const result = await setStudentStatus(studentId, nextStatus);
      if (result?.success) {
        setFeedback({ type: "success", text: result.success });
      } else if (result?.error) {
        setFeedback({ type: "error", text: result.error });
      }
      setConfirmOpen(false);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {status === "active" ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          disabled={isPending}
        >
          Deactivate Student
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => runStatusChange("active")}
          disabled={isPending}
        >
          {isPending ? "Activating…" : "Activate Student"}
        </Button>
      )}

      {feedback ? (
        <p
          role="status"
          className={feedback.type === "success" ? "text-small text-success" : "text-small text-danger"}
        >
          {feedback.text}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate student"
        description={`Deactivate ${studentName}? This does not delete their record — their history, memberships, and enrollments remain available, and they can be reactivated later.`}
        confirmLabel="Deactivate"
        destructive
        isPending={isPending}
        onConfirm={() => runStatusChange("inactive")}
      />
    </div>
  );
}
