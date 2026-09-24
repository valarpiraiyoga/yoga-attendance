"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, formatDateShort } from "@/lib/format";
import { monthOf } from "@/lib/attendance-history/calendar";
import { cn } from "@/lib/utils";

/**
 * The date-range control in Attendance History's header
 * (`ui-reference/02/attendance history.png`): a button showing the applied
 * range ("Sep 01, 2026 – Sep 30, 2026") that opens a small From / To popover.
 * The range is always defined — it defaults to the displayed month — so the
 * button never shows an empty state; Reset returns to that default.
 *
 * `compact` is the mobile top-bar form: a small button — calendar icon and a
 * short label ("Sep 1 – Sep 30, 2026"), no chevron — opening the same popover.
 *
 * Applying writes the same `from` / `to` URL params the page already reads,
 * moves the calendar to the range's first month (`month`) and drops the
 * selected `date` and page, so the page re-resolves both from the new range.
 */
export default function HistoryDateRange({ from, to, compact = false, className }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [error, setError] = useState("");

  function handleOpenChange(nextOpen) {
    if (nextOpen) {
      setDraftFrom(from);
      setDraftTo(to);
      setError("");
    }
    setOpen(nextOpen);
  }

  function navigate(mutate) {
    const params = new URLSearchParams(searchParams);
    params.delete("page");
    params.delete("date");
    mutate(params);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  function apply(event) {
    event.preventDefault();
    if (!draftFrom || !draftTo) {
      setError("Choose both a start and an end date.");
      return;
    }
    if (draftFrom > draftTo) {
      setError("The start date must be on or before the end date.");
      return;
    }
    navigate((params) => {
      params.set("from", draftFrom);
      params.set("to", draftTo);
      params.set("month", monthOf(draftFrom));
    });
  }

  function reset() {
    navigate((params) => {
      params.delete("from");
      params.delete("to");
      params.delete("month");
    });
  }

  const label = `${formatDate(from)} – ${formatDate(to)}`;
  // A same-year range drops the first year and the leading zeros: "Sep 1 – Sep 30, 2026".
  const compactLabel =
    from.slice(0, 4) === to.slice(0, 4)
      ? `${formatDateShort(from)} – ${formatDateShort(to)}, ${to.slice(0, 4)}`
      : label;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            className={cn(compact && "text-small", className)}
            aria-label={`Date range: ${label}. Change date range`}
          />
        }
      >
        <CalendarDays className="size-4 shrink-0 text-brand" aria-hidden="true" />
        <span className="truncate">{compact ? compactLabel : label}</span>
        {compact ? null : <ChevronDown className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent align="end">
        <form onSubmit={apply} className="flex flex-col gap-3" noValidate>
          <PopoverTitle>Date range</PopoverTitle>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-small font-medium tracking-wide text-text-secondary uppercase">
              From
              <Input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-small font-medium tracking-wide text-text-secondary uppercase">
              To
              <Input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={reset}>
              Reset
            </Button>
            <Button type="submit" className="flex-1">
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
