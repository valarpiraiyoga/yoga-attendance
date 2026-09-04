import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-small font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand/10 text-brand",
        success: "border-transparent bg-success/10 text-success",
        danger: "border-transparent bg-danger/10 text-danger",
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
