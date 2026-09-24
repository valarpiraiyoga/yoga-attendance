"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { monthOf } from "@/lib/attendance-history/calendar";
import { formatDate, formatDateShort, formatDateWithWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Today's Sessions is fixed to today (02-ux.md), so its header shows the date
 * as a plain, non-interactive chip — the same outlined shape as All Sessions'
 * date control, without the chevron that would promise a picker.
 */
export function TodayDateChip({ date, compact = false, className }) {
  return (
    <p
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-button border border-border bg-background px-3 font-medium whitespace-nowrap text-text-primary",
        compact ? "h-8 text-small" : "h-9 text-button",
        className
      )}
    >
      <CalendarDays className="size-4 shrink-0 text-brand" aria-hidden="true" />
      <span className="sr-only">Today: </span>
      {compact ? `${formatDateShort(date)}, ${date.slice(0, 4)}` : formatDateWithWeekday(date)}
    </p>
  );
}

/**
 * All Sessions' date control: shows the selected date and opens a small
 * "go to date" popover. Applying writes `date` (the group the timeline opens),
 * moves the calendar to that month, and drops any applied From / To range and
 * the page, so the chosen date is shown. A date without sessions simply falls
 * back to the first group on the page. `compact` is the mobile top-bar form.
 */
export function SessionDateJump({ date, compact = false, className }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(date);
  const [error, setError] = useState("");

  function handleOpenChange(nextOpen) {
    if (nextOpen) {
      setDraft(date);
      setError("");
    }
    setOpen(nextOpen);
  }

  function apply(event) {
    event.preventDefault();
    if (!draft) {
      setError("Choose a date.");
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.set("view", "all");
    params.set("date", draft);
    params.set("month", monthOf(draft));
    params.delete("from");
    params.delete("to");
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  const label = date ? formatDate(date) : "Select date";
  const shownLabel = compact && date ? `${formatDateShort(date)}, ${date.slice(0, 4)}` : label;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            className={cn(compact && "text-small", className)}
            aria-label={`Selected date: ${label}. Go to another date`}
          />
        }
      >
        <CalendarDays className="size-4 shrink-0 text-brand" aria-hidden="true" />
        <span className="truncate">{shownLabel}</span>
        {compact ? null : <ChevronDown className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent align="end">
        <form onSubmit={apply} className="flex flex-col gap-3" noValidate>
          <PopoverTitle>Go to date</PopoverTitle>
          <label className="flex flex-col gap-1.5 text-small font-medium tracking-wide text-text-secondary uppercase">
            Date
            <Input type="date" value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
          {error ? (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit">Show sessions</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
