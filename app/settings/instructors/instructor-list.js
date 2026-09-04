"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { setInstructorStatus } from "@/lib/instructors/actions";

/**
 * The Instructor table plus the success banner and the Activate/Deactivate
 * quick action, which share this one client boundary because they share
 * state: `message` is seeded from the create/update redirect's `?success=`
 * param (see lib/instructors/actions.js), then owned locally so the
 * Activate/Deactivate action — which never navigates — can also set it.
 *
 * `setInstructorStatus` is called directly (per Next.js's own guidance for
 * invoking a Server Action outside a form: from an event handler wrapped in
 * `startTransition`), not through a `<form>`/`useActionState` — there is no
 * separate submission to model, just one action per click.
 */
export default function InstructorList({ instructors, initialMessage }) {
  const [feedback, setFeedback] = useState(
    initialMessage ? { type: "success", text: initialMessage } : null
  );
  const [pendingId, setPendingId] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleToggleStatus(instructor) {
    const nextStatus = instructor.status === "active" ? "inactive" : "active";
    setPendingId(instructor.id);
    startTransition(async () => {
      const result = await setInstructorStatus(instructor.id, nextStatus);
      if (result?.success) {
        setFeedback({ type: "success", text: result.success });
      } else if (result?.error) {
        setFeedback({ type: "error", text: result.error });
      }
      setPendingId(null);
    });
  }

  return (
    <div className="mt-6">
      {feedback ? (
        <div
          role="status"
          className={
            feedback.type === "success"
              ? "mb-4 flex items-start justify-between gap-3 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
              : "mb-4 flex items-start justify-between gap-3 rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-body text-danger"
          }
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss"
            className={
              feedback.type === "success"
                ? "shrink-0 text-success/70 hover:text-success"
                : "shrink-0 text-danger/70 hover:text-danger"
            }
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <Table aria-label="Instructors">
        <TableHeader>
          <TableRow>
            <TableHead>Instructor</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instructors.map((instructor) => (
            <TableRow key={instructor.id}>
              <TableCell className="font-medium text-text-primary">
                {instructor.full_name}
              </TableCell>
              <TableCell>{instructor.phone || "—"}</TableCell>
              <TableCell>{instructor.email || "—"}</TableCell>
              <TableCell>
                <Badge variant={instructor.status === "active" ? "success" : "danger"}>
                  {instructor.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-4">
                  <Link
                    href={`/settings/instructors/${instructor.id}/edit`}
                    className="font-medium text-brand hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(instructor)}
                    disabled={isPending}
                    className="font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
                  >
                    {isPending && pendingId === instructor.id
                      ? "Updating…"
                      : instructor.status === "active"
                        ? "Deactivate"
                        : "Activate"}
                  </button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
