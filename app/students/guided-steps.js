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
 * Step 2 (Membership) is skippable (01-product.md/02-ux.md Phase 12
 * decisions: an admin can proceed to Batch Enrollment without creating a
 * membership) but not "unavailable" — the page for that step provides its
 * own Skip action; this stepper just shows progress.
 */
export default function GuidedSteps({ current }) {
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2">
      {STEPS.map((step, index) => {
        const isCurrent = step.number === current;
        const isDone = !isCurrent && step.number < current;

        return (
          <li key={step.number} className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-small font-semibold",
                  isCurrent && "bg-brand text-surface",
                  isDone && "bg-success/15 text-success",
                  !isCurrent && !isDone && "bg-background text-text-secondary"
                )}
              >
                {step.number}
              </span>
              <span
                className={cn("text-body font-medium", isCurrent ? "text-text-primary" : "text-text-secondary")}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 ? (
              <span aria-hidden="true" className="h-px w-8 bg-border sm:w-16" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
