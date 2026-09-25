"use client";

import { useCallback, useState, useTransition } from "react";
import { ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import StudentContext from "@/components/ui/student-context";
import Toast from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { setStudentStatus } from "@/lib/students/actions";

/**
 * The Student Details header's active / inactive toggle icon button, placed
 * before Edit Student (the status text itself is the badge beside the student's
 * name). The toggle shows the current state — on and green when active, off and
 * grey when inactive — and is also the control that changes it — the Deactivate / Activate Student actions that used to live
 * in the overflow menu (wireframe p10; 02-ux.md Flow 11: "Students → Select
 * Student → Deactivate Student → Review → Confirm → Save → Student Inactive").
 * The actions and their rules are unchanged.
 *
 * Only deactivation goes through the Review → Confirm gate — Flow 11 exists
 * specifically for deactivation, and no equivalent flow documents
 * reactivation, so activation stays a plain one-click action rather than
 * inventing a second confirmation workflow.
 *
 * `setStudentStatus` is called directly (per Next.js's own guidance for
 * invoking a Server Action outside a form: from an event handler wrapped in
 * `startTransition`), matching lib/instructors/actions.js's
 * `setInstructorStatus` usage pattern. The result message appears as a toast
 * (top-right of the window), so it never disturbs the header's layout.
 */
export default function StudentStatusButton({ studentId, studentName, status, student }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isPending, startTransition] = useTransition();
  const dismissFeedback = useCallback(() => setFeedback(null), []);
  const isActive = status === "active";

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
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={isPending}
        onClick={isActive ? () => setConfirmOpen(true) : () => runStatusChange("active")}
        aria-label={
          isActive
            ? `${studentName} is active. Deactivate student`
            : `${studentName} is inactive. Activate student`
        }
        title={isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
        className={cn(
          isActive
            ? "border-success/30 bg-success/5 text-success hover:bg-success/10 hover:text-success"
            : "text-text-secondary"
        )}
      >
        {isActive ? (
          <ToggleRight className="size-5" aria-hidden="true" />
        ) : (
          <ToggleLeft className="size-5" aria-hidden="true" />
        )}
      </Button>

      <Toast
        message={feedback?.text}
        tone={feedback?.type === "error" ? "error" : "success"}
        onDismiss={dismissFeedback}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate student"
        context={<StudentContext student={student} />}
        description={`Deactivate ${studentName}? This does not delete their record — their history, memberships, and enrollments remain available, and they can be reactivated later.`}
        confirmLabel="Deactivate"
        destructive
        isPending={isPending}
        onConfirm={() => runStatusChange("inactive")}
      />
    </>
  );
}
