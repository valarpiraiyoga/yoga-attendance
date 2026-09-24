"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A searchable single-choice select for long lists (time zones, currencies):
 * a button that looks like the standard `SelectTrigger` and opens a popover
 * with a search field over a scrollable listbox - never a several-hundred-row
 * dropdown. Options may be grouped under headings (time zones by country).
 *
 * It submits ONE form value, `name` (the chosen option's `value`), through a
 * hidden input, and is uncontrolled from the form's point of view like every
 * other field here: it shows `defaultValue` until the user chooses something,
 * a changed default (the values handed back after a failed submission) is shown
 * as the new selection, and a form reset (the Cancel button, or React resetting
 * the form after an action) drops the user's choice so the default shows
 * again. `onValueChange` reports a choice.
 *
 * The choice is held as an OVERRIDE of the default (`null` = follow the
 * default), not as a copy of it: a reset then just clears the override, with no
 * captured "current default" to go stale, which matters because React resets
 * the form during the commit that also delivers the new default.
 *
 * `groups` is `[{ label?: string, options: [{ value, label, search, leading? }] }]`;
 * `search` is the lower-cased text a query is matched against by `filter`, and
 * `leading` an optional small prefix (a flag). The filter itself is the
 * caller's (`filter(groups, query) => groups`), so each list keeps its own
 * matching rules.
 *
 * Use inside `FormField`: `{(field) => <SearchSelect {...field} ... />}` - the
 * field's `id` lands on the trigger, so the label points at it, and
 * `aria-invalid` / `aria-describedby` tie the error to it.
 *
 * Accessibility: the trigger is a labelled button (`aria-haspopup="listbox"`,
 * `aria-expanded`) that reads out the selected option; the popover holds a
 * labelled search field and a `listbox` of `option`s with `aria-selected`.
 * Arrow Down moves from the search into the list and between options, Arrow Up
 * back, Enter chooses (Enter in the search picks the first match), and Escape
 * closes and returns focus to the trigger.
 */
export default function SearchSelect({
  id,
  name,
  groups,
  filter,
  defaultValue = "",
  onValueChange,
  placeholder = "Select…",
  searchLabel = "Search",
  searchPlaceholder = "Search…",
  emptyText = "No matches found.",
  listLabel,
  disabled = false,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}) {
  const [override, setOverride] = useState(null);
  const [prevDefault, setPrevDefault] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listboxId = useId();
  const hiddenRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  // A new default (what a failed submission handed back) is the new selection.
  if (defaultValue !== prevDefault) {
    setPrevDefault(defaultValue);
    setOverride(null);
  }
  const value = override ?? defaultValue;

  // Cancel / a form reset returns the selection to the default.
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return undefined;
    const handleReset = () => setOverride(null);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, []);

  const selected = groups.flatMap((group) => group.options).find((option) => option.value === value);
  const visible = filter(groups, query);
  const matches = visible.flatMap((group) => group.options);

  function choose(option) {
    setOverride(option.value);
    setOpen(false);
    setQuery("");
    onValueChange?.(option.value);
  }

  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (!nextOpen) setQuery("");
  }

  function optionButtons() {
    return [...(listRef.current?.querySelectorAll('[role="option"]') ?? [])];
  }

  function handleSearchKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionButtons()[0]?.focus();
    } else if (event.key === "Enter") {
      // Enter in the search must not submit the surrounding form.
      event.preventDefault();
      if (matches[0]) choose(matches[0]);
    }
  }

  function handleOptionKeyDown(event, index) {
    const items = optionButtons();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[Math.min(index + 1, items.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else items[index - 1]?.focus();
    }
  }

  // Brings the chosen option into view when the list opens.
  function scrollSelectedIntoView(node) {
    node?.scrollIntoView({ block: "center" });
  }

  return (
    <>
      <input ref={hiddenRef} type="hidden" name={name} value={value} />

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-input border border-input bg-transparent px-3 py-2 text-left text-body transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/50",
            ariaInvalid && "border-destructive ring-3 ring-destructive/20",
            className
          )}
        >
          <span className={cn("flex min-w-0 items-center gap-2", !selected && "text-muted-foreground")}>
            {selected?.leading ? (
              <span aria-hidden="true" className="text-base leading-none">
                {selected.leading}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-(--anchor-width) min-w-64 max-w-[calc(100vw-2rem)] p-2"
        >
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchLabel}
              aria-controls={listboxId}
              autoComplete="off"
              className="h-9 pl-9"
            />
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={listLabel}
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {matches.length === 0 ? (
              <p className="px-3 py-4 text-center text-small text-text-secondary">{emptyText}</p>
            ) : (
              visible.map((group, groupIndex) => (
                <div key={group.label ?? groupIndex} role="group" aria-label={group.label}>
                  {group.label ? (
                    <p
                      aria-hidden="true"
                      className="px-2 pt-2 pb-1 text-small font-semibold text-text-secondary first:pt-0"
                    >
                      {group.label}
                    </p>
                  ) : null}
                  {group.options.map((option) => {
                    const isSelected = option.value === value;
                    const index = matches.indexOf(option);
                    return (
                      <button
                        key={option.value}
                        ref={isSelected ? scrollSelectedIntoView : undefined}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => choose(option)}
                        onKeyDown={(event) => handleOptionKeyDown(event, index)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                          isSelected && "bg-brand/10"
                        )}
                      >
                        {option.leading ? (
                          <span aria-hidden="true" className="text-base leading-none">
                            {option.leading}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1">{option.label}</span>
                        {isSelected ? <Check className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
