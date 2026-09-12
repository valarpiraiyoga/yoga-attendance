import { cn } from "@/lib/utils";

/**
 * A placeholder block shown while real content loads.
 *
 * Deliberately minimal: a neutral, pulsing rectangle sized entirely by the
 * caller's `className`. It carries no semantics of its own — the enclosing
 * loading boundary owns the `role="status"` / `aria-busy` announcement, so
 * a screen reader hears "Loading…" once rather than once per block.
 *
 * Uses the same `animate-pulse` + `bg-neutral/15` treatment the Reports
 * results skeleton already established (app/reports/page.js), so every
 * loading state in the application looks like the same thing.
 */
export function Skeleton({ className, ...props }) {
  return <div className={cn("animate-pulse rounded bg-neutral/15", className)} {...props} />;
}
