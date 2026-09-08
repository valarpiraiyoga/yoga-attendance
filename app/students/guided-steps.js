import { cn } from "@/lib/utils";

const STEPS = [
  { number: 1, label: "Student Details" },
  { number: 2, label: "Membership" },
  { number: 3, label: "Batch Enrollment" },
];

// Step 2 is unavailable until Phase 12 (Memberships) — 02-ux.md Flow 02's
// three-step guided flow is kept fully visible, per the approved decision,
// with this one step marked unavailable rather than removed.
const UNAVAILABLE_STEP = 2;

/**
 * The 3-step "Add Student" stepper (wireframe p11/p13). A plain
 * presentational component, feature-local rather than a generic UI
 * primitive — nothing else in the app has a multi-step flow yet.
 */
export default function GuidedSteps({ current }) {
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2">
      {STEPS.map((step, index) => {
        const isUnavailable = step.number === UNAVAILABLE_STEP;
        const isCurrent = step.number === current;
        const isDone = !isUnavailable && !isCurrent && step.number < current;

        return (
          <li key={step.number} className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-small font-semibold",
                  isCurrent && "bg-brand text-surface",
                  isDone && "bg-success/15 text-success",
                  isUnavailable && "bg-background text-text-secondary/50",
                  !isCurrent && !isDone && !isUnavailable && "bg-background text-text-secondary"
                )}
              >
                {step.number}
              </span>
              <span
                className={cn(
                  "text-body font-medium",
                  isCurrent ? "text-text-primary" : "text-text-secondary",
                  isUnavailable && "text-text-secondary/50"
                )}
              >
                {step.label}
                {isUnavailable ? (
                  <span className="ml-1.5 text-small font-normal">(unavailable)</span>
                ) : null}
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
