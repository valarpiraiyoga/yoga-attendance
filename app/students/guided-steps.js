import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { number: 1, label: "Student Details" },
  { number: 2, label: "Membership" },
  { number: 3, label: "Batch Enrollment" },
];

/**
 * The 3-step "Add Student" stepper (wireframe p11/p13). A plain
 * presentational component, feature-local rather than a generic UI
 * primitive — nothing else in the app has a multi-step flow yet.
 *
 * States, all in the brand (teal) colour: a finished step is a filled circle
 * with a check (the same look on every screen, so the completion screen reads
 * as the last step of the same sequence), the current step is a filled circle
 * with its number and a soft ring, later steps are muted. `complete` (the finished flow's summary screen) marks
 * all three as finished.
 * Below `sm` only the current step keeps its label, so the row stays on one
 * line at phone width and the connectors stretch between the circles.
 *
 * Step 2 (Membership) is skippable (01-product.md/02-ux.md Phase 12
 * decisions: an admin can proceed to Batch Enrollment without creating a
 * membership) but not "unavailable" — the page for that step provides its
 * own Skip action; this stepper just shows progress.
 */
export default function GuidedSteps({ current, complete = false, className }) {
  return (
    <ol aria-label="Add Student progress" className={cn("mt-5 mb-6 flex items-center gap-3 sm:gap-4", className)}>
      {STEPS.map((step, index) => {
        const isCurrent = !complete && step.number === current;
        const isDone = complete || step.number < current;
        const isLast = index === STEPS.length - 1;

        return (
          <li
            key={step.number}
            aria-current={isCurrent ? "step" : undefined}
            className={cn("flex items-center gap-3 sm:gap-4", !isLast && "min-w-0 flex-1 sm:flex-none")}
          >
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-small font-semibold",
                  isCurrent && "bg-brand text-surface ring-4 ring-brand/15",
                  isDone && "bg-brand text-surface",
                  !isCurrent && !isDone && "bg-background text-text-secondary"
                )}
              >
                {isDone ? <Check className="size-4" /> : step.number}
              </span>
              <span
                className={cn(
                  "text-body font-medium whitespace-nowrap",
                  isCurrent ? "font-semibold text-text-primary" : isDone ? "text-text-primary" : "text-text-secondary",
                  !isCurrent && "hidden sm:inline"
                )}
              >
                <span className="sr-only">{`Step ${step.number}: `}</span>
                {step.label}
              </span>
            </div>
            {!isLast ? <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border sm:w-16 sm:flex-none" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
