"use client";

import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The "Filters" trigger button (06-ui-implementation-rules.md §16.3):
 * opens a `FilterSheet`, and carries a brand count pill once any filter is
 * applied. Search stays a separate `SearchInput` beside it — search is
 * independent of the filter drawer, matching every existing filter bar.
 */
export default function FilterBar({ activeCount = 0, onClick, label = "Filters", className }) {
  return (
    <Button type="button" variant="outline" className={cn("shrink-0 gap-2", className)} onClick={onClick}>
      <SlidersHorizontal className="size-4" aria-hidden="true" />
      {label}
      {activeCount > 0 ? (
        <span className="flex size-5 items-center justify-center rounded-full bg-brand text-small font-semibold text-surface">
          {activeCount}
        </span>
      ) : null}
    </Button>
  );
}
