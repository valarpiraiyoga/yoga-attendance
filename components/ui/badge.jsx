import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Pill shape lives in the primitive (06-ui-implementation-rules.md §10) —
 * callers no longer need `className="rounded-full px-2 py-0"` plus a
 * nested `text-[10px]` span to get the status-pill look; that pattern is
 * retired here and migrates away from call sites as each page is next
 * implemented (§21 — incremental, not a repo-wide sweep in this task).
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-small font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand/10 text-brand",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/10 text-warning",
        danger: "border-transparent bg-danger/10 text-danger",
        info: "border-transparent bg-info/10 text-info",
        neutral: "border-transparent bg-neutral/15 text-text-secondary",
        outline: "border-border bg-transparent text-text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
