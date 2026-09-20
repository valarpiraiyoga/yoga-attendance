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
import { setStudentStatus } from "@/lib/students/actions";

/**
 * The Student Details header's overflow menu: Deactivate / Activate Student
 * (wireframe p10; 02-ux.md Flow 11: "Students → Select Student → Deactivate
 * Student → Review → Confirm → Save → Student Inactive"). The actions and
 * their rules are exactly the former Deactivate / Activate button's — only
 * the trigger changed, from a text button to the finalized overflow (⋮)
 * button beside Edit Student.
 *
 * Only deactivation goes through the Review → Confirm gate — Flow 11 exists
 * specifically for deactivation, and no equivalent flow documents
 * reactivation, so activation stays a plain one-click action rather than
 * inventing a second confirmation workflow.
 *
 * `setStudentStatus` is called directly (per Next.js's own guidance for
 * invoking a Server Action outside a form: from an event handler wrapped in
 * `startTransition`), matching lib/instructors/actions.js's
 * `setInstructorStatus` usage pattern. The result message shows under the
 * header actions, as before.
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isPending}
              aria-label={`More actions for ${studentName}`}
            />
          }
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {status === "active" ? (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
              Deactivate Student
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => runStatusChange("active")}>
              {isPending ? "Activating…" : "Activate Student"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {feedback ? (
        <p
          role="status"
          className={
            feedback.type === "success"
              ? "text-small w-full text-right text-success"
              : "text-small w-full text-right text-danger"
          }
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
    </>
  );
}
