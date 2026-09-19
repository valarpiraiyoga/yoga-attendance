"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one applied-filters chip row (06-ui-implementation-rules.md §16.3):
 * brand-tinted removable chips followed by "Clear all". `chips`:
 * `{ key, label }[]`. Renders nothing when there are no active filters.
 */
export default function FilterChips({ chips, onRemove, onClearAll, className }) {
  if (!chips || chips.length === 0) return null;

  return (
    <div className={cn("mt-3 flex flex-wrap items-center gap-2", className)}>
      <span className="text-small text-text-secondary">Active filters:</span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pr-1 pl-2.5 text-small font-medium text-brand"
        >
          {chip.label}
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded-full text-brand hover:bg-brand/15"
            aria-label={`Remove ${chip.label}`}
            onClick={() => onRemove?.(chip.key)}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="text-small font-medium text-brand hover:underline" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  );
}
