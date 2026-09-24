"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { formatDateWithWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";

function groupAnchorId(date) {
  return `history-date-${date}`;
}

/**
 * Results grouped by date as a timeline of accordions — the finalized pattern
 * shared by Attendance History and Attendance → All Sessions
 * (`ui-reference/02`): one group per date — a brand chevron on the timeline
 * rail, the date on the left and the "N Sessions" count on the right, just
 * before the expand / collapse chevron — opening onto that date's cards or
 * table. The selected date (`selectedDate`, from the URL) is open on arrival;
 * every group toggles independently, so several can be open at once.
 *
 * Each header is one real `<button>` (`aria-expanded` / `aria-controls`), so
 * the whole bar is keyboard and screen-reader operable. Choosing a date in the
 * calendar or Quick dates changes `selectedDate`: that group opens (undoing an
 * earlier manual collapse of it) and scrolls into view. Open/closed choices
 * live here as overrides on top of that default, so they survive the URL
 * changes a date selection causes.
 *
 * `groups`: `{ date, items }[]` in display order. What a group's items look
 * like is the caller's business: `renderCards(group)` / `renderTable(group)`
 * draw them (function props, so a caller is itself a client component).
 * `layout` is `"cards"`, `"table"`, or `""` (no explicit choice): then both
 * are rendered and CSS shows Cards below `lg` and Table from `lg` up, so
 * crossing the breakpoint switches the view with no client state, and nothing
 * depends on the viewport at render time. Each group's region is an
 * `@container`, so tables can size themselves to their own width.
 */
export default function DateGroupTimeline({
  groups,
  selectedDate,
  layout = "",
  renderCards,
  renderTable,
  ariaLabel = "Sessions by date",
  cardsClassName = "grid grid-cols-1 items-stretch gap-4 md:grid-cols-2",
}) {
  const [overrides, setOverrides] = useState({});
  const [seenSelectedDate, setSeenSelectedDate] = useState(selectedDate);
  const hasMounted = useRef(false);

  if (seenSelectedDate !== selectedDate) {
    setSeenSelectedDate(selectedDate);
    setOverrides((previous) => {
      const next = { ...previous };
      delete next[selectedDate];
      return next;
    });
  }

  useEffect(() => {
    // Not on first render — arriving on the page should not scroll it.
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (!selectedDate) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(groupAnchorId(selectedDate))
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [selectedDate]);

  function isOpen(date) {
    return overrides[date] ?? date === selectedDate;
  }

  function toggle(date) {
    setOverrides((previous) => ({ ...previous, [date]: !isOpen(date) }));
  }

  return (
    <ol className="flex flex-col gap-3" aria-label={ariaLabel}>
      {groups.map((group, index) => {
        const open = isOpen(group.date);
        const isLast = index === groups.length - 1;
        const count = group.items.length;
        const regionId = `history-group-${group.date}`;
        const label = formatDateWithWeekday(group.date);

        return (
          <li key={group.date} id={groupAnchorId(group.date)} className="relative scroll-mt-4">
            {!isLast ? (
              <span
                aria-hidden="true"
                className="absolute top-7 -bottom-3 left-3.5 w-px -translate-x-1/2 bg-brand/25"
              />
            ) : null}

            <button
              type="button"
              className="group flex w-full items-center gap-3 rounded-lg text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-expanded={open}
              aria-controls={regionId}
              onClick={() => toggle(group.date)}
            >
              <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-surface">
                {open ? (
                  <ChevronDown className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4" aria-hidden="true" />
                )}
              </span>
              <span
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2.5 transition-colors group-hover:bg-brand/10",
                  open ? "bg-brand/10" : "bg-brand/5"
                )}
              >
                <span className="min-w-0 text-body font-semibold text-text-primary">{label}</span>
                <span className="ml-auto shrink-0 text-small font-medium whitespace-nowrap text-brand">
                  {count} {count === 1 ? "Session" : "Sessions"}
                </span>
                {open ? (
                  <ChevronUp className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                )}
              </span>
            </button>

            <div
              id={regionId}
              role="region"
              aria-label={`${label} sessions`}
              hidden={!open}
              className="@container pt-3 pl-6 sm:pl-9"
            >
              {open ? (
                <>
                  {layout !== "table" ? (
                    <div className={cn(cardsClassName, layout === "" && "lg:hidden")}>{renderCards(group)}</div>
                  ) : null}
                  {layout !== "cards" ? (
                    <div className={cn(layout === "" && "hidden lg:block")}>{renderTable(group)}</div>
                  ) : null}
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
