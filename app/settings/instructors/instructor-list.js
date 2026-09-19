"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel } from "@/components/layout/Panel";
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { setInstructorStatus } from "@/lib/instructors/actions";
import InstructorCardItem from "@/app/settings/instructors/instructor-card-item";
import InstructorTableRow from "@/app/settings/instructors/instructor-table-row";

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
 * separate submission to model, just one action per click. It is triggered
 * from each card's / row's overflow menu.
 *
 * Cards / Table is the `view` URL param decided by `InstructorFilters`'
 * `ViewSwitcher` (cards by default, as on every finalized list page); both
 * layouts show the same instructors and offer the same actions.
 */
export default function InstructorList({
  instructors,
  total,
  view = "cards",
  sort,
  sortOptions,
  defaultSort,
  initialMessage,
}) {
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

      <ResultsHeader
        count={total}
        label={total === 1 ? "Instructor" : "Instructors"}
        viewLabel={view === "table" ? "Table view" : "Card list view"}
        aside={<SortSelect id="instructor-sort" options={sortOptions} value={sort} defaultValue={defaultSort} />}
      />

      {view === "table" ? (
        <Panel className="overflow-hidden p-0 sm:p-0">
          <Table aria-label="Instructors">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Instructor</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instructors.map((instructor) => (
                <InstructorTableRow
                  key={instructor.id}
                  instructor={instructor}
                  isUpdating={isPending && pendingId === instructor.id}
                  disabled={isPending}
                  onToggleStatus={() => handleToggleStatus(instructor)}
                />
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : (
        <CardGrid ariaLabel="Instructors">
          {instructors.map((instructor) => (
            <InstructorCardItem
              key={instructor.id}
              instructor={instructor}
              isUpdating={isPending && pendingId === instructor.id}
              disabled={isPending}
              onToggleStatus={() => handleToggleStatus(instructor)}
            />
          ))}
        </CardGrid>
      )}
    </div>
  );
}
