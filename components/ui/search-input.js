"use client";

import { useRef } from "react";
import { Search, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The one search field (06-ui-implementation-rules.md §16.2): leading
 * search icon, visually-hidden label, otherwise a plain `Input`. Search
 * stays independent of the filter drawer — this component owns only the
 * field's appearance, not a form or URL-writing behaviour (list pages wire
 * live search with `useLiveSearch`).
 *
 * `onClear` is optional. When given, a "Clear search" button appears inside
 * the field on the right while it has text; it calls `onClear` and returns
 * focus to the input. What clearing means (empty the text, drop the URL
 * param) stays with the caller. Fields that omit it are unchanged.
 */
export default function SearchInput({ id, label = "Search", className, inputClassName, onClear, ...props }) {
  const inputRef = useRef(null);
  const showClear = Boolean(onClear) && Boolean(props.value);

  function handleClear() {
    onClear();
    inputRef.current?.focus();
  }

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        id={id}
        className={cn(
          "pl-9",
          // The shared X replaces the browser's own clear button on type="search".
          onClear && "[&::-webkit-search-cancel-button]:appearance-none",
          showClear && "pr-10",
          inputClassName,
        )}
        {...props}
      />
      {showClear ? (
        <button
          type="button"
          aria-label="Clear search"
          // Keep focus in the input while the pointer is down on the button.
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClear}
          className="absolute inset-y-0 right-0 flex h-full w-10 items-center justify-center rounded-input text-text-secondary outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
