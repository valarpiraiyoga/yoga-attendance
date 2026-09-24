"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { setInstructorStatus } from "@/lib/instructors/actions";
import { cn } from "@/lib/utils";
import InstructorCardItem from "@/app/settings/instructors/instructor-card-item";
import InstructorTable from "@/app/settings/instructors/instructor-table";

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
 * `ViewSwitcher`: `"cards"`, `"table"`, or `""` (no explicit choice) — then both
 * are rendered and CSS shows Cards below `lg` and Table from `lg` up, the
 * finalized default rule shared with the other list pages. Both layouts show
 * the same instructors and offer the same actions. The results row ("N
 * Instructors", "Sort by" on its right) sits below the toolbar.
 */
export default function InstructorList({
  instructors,
  total,
  view = "",
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

  // Each row / card's update state and toggle handler.
  const rowProps = (instructor) => ({
    isUpdating: isPending && pendingId === instructor.id,
    disabled: isPending,
    onToggleStatus: () => handleToggleStatus(instructor),
  });

  return (
    <div className="mt-5">
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
        className="mb-3 flex-row items-center justify-between"
        aside={
          <SortSelect
            id="instructor-sort"
            options={sortOptions}
            value={sort}
            defaultValue={defaultSort}
            compactOnMobile
          />
        }
      />

      {view !== "table" ? (
        <CardGrid ariaLabel="Instructors" className={cn("xl:grid-cols-3", view === "" && "lg:hidden")}>
          {instructors.map((instructor) => (
            <InstructorCardItem key={instructor.id} instructor={instructor} {...rowProps(instructor)} />
          ))}
        </CardGrid>
      ) : null}

      {view !== "cards" ? (
        <div className={cn(view === "" && "hidden lg:block")}>
          <InstructorTable instructors={instructors} renderRowProps={rowProps} />
        </div>
      ) : null}
    </div>
  );
}
