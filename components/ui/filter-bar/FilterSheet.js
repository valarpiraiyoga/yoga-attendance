"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The one filter drawer (06-ui-implementation-rules.md §16.3), replacing
 * six near-identical `Sheet` implementations (~2,000 lines): a bottom sheet
 * below `sm`, a right drawer from `sm` up, with the locked
 * Clear All / Apply Filters footer. `children` is the caller's filter
 * fields — `FilterSection` below wraps each one in the shared label style.
 */
export default function FilterSheet({
  open,
  onOpenChange,
  title = "Filters",
  description,
  onSubmit,
  onClearAll,
  clearLabel = "Clear All",
  applyLabel = "Apply Filters",
  children,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="h-auto max-h-[90dvh] w-full gap-0 rounded-t-card p-0 data-[side=right]:inset-x-0 data-[side=right]:top-auto data-[side=right]:bottom-0 data-[side=right]:left-0 sm:inset-y-0 sm:h-full sm:max-h-none sm:w-96 sm:max-w-sm sm:rounded-none sm:data-[side=right]:inset-x-auto sm:data-[side=right]:top-0 sm:data-[side=right]:right-0 sm:data-[side=right]:left-auto"
        showCloseButton
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-section-title font-semibold text-text-primary">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-small text-text-secondary">{description}</SheetDescription>
          ) : null}
        </SheetHeader>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>

          <div className="mt-auto flex gap-3 border-t border-border p-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClearAll}>
              {clearLabel}
            </Button>
            <Button type="submit" className="flex-1">
              {applyLabel}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** One labelled filter field inside a `FilterSheet` — the repeated `<Select>` wrapper. */
export function FilterSection({ id, label, className, children }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={`${id}-label`} className="text-small font-medium tracking-wide text-text-secondary uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}
