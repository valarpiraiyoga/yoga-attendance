import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildMonthGrid, formatMonthLabel, monthOf, shiftMonth } from "@/lib/attendance-history/calendar";
import { formatDate } from "@/lib/format";
import { buildListHref } from "@/lib/url-params";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function sessionsLabel(count) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

/**
 * Attendance History's date navigator (`ui-reference/02/attendance history.png`):
 * a month calendar whose days with completed sessions carry a brand dot, plus
 * the "Quick dates" list of the most recent such dates. Server-rendered — every
 * control is a link, so month, and date selection live in the URL:
 *
 * - month arrows set `month` and reset the range to that whole month;
 * - a day / quick date sets `date` (the group the timeline opens and
 *   highlights). If the applied range does not contain it, the range is
 *   dropped too so the group exists to be shown.
 *
 * Days without sessions are not links: there is nothing to open.
 */
export default function HistoryCalendar({
  basePath,
  currentParams,
  month,
  monthDays,
  quickDates,
  selectedDate,
  rangeFrom,
  rangeTo,
}) {
  const countByDate = new Map(monthDays.map((day) => [day.date, day.count]));
  const weeks = buildMonthGrid(month);

  function dateHref(date) {
    const inRange = date >= rangeFrom && date <= rangeTo;
    return buildListHref(basePath, currentParams, {
      date,
      page: "",
      ...(inRange ? {} : { from: "", to: "", month: monthOf(date) }),
    });
  }

  function monthHref(delta) {
    return buildListHref(basePath, currentParams, {
      month: shiftMonth(month, delta),
      from: "",
      to: "",
      date: "",
      page: "",
    });
  }

  return (
    <aside aria-label="Browse by date" className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      <section className="rounded-card border border-border bg-surface p-4 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <Link
            href={monthHref(-1)}
            scroll={false}
            className="flex size-7 items-center justify-center rounded-md text-text-secondary hover:bg-brand/10 hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`Previous month, ${formatMonthLabel(shiftMonth(month, -1))}`}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <h2 className="text-body font-semibold text-text-primary" aria-live="polite">
            {formatMonthLabel(month)}
          </h2>
          <Link
            href={monthHref(1)}
            scroll={false}
            className="flex size-7 items-center justify-center rounded-md text-text-secondary hover:bg-brand/10 hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`Next month, ${formatMonthLabel(shiftMonth(month, 1))}`}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-7 text-center text-small text-text-secondary" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className="py-1">
              {weekday}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {weeks.flat().map((cell, index) => {
            if (!cell) return <span key={`blank-${index}`} />;

            const count = countByDate.get(cell.date) ?? 0;
            const isSelected = cell.date === selectedDate;
            const dot = (
              <span
                aria-hidden="true"
                className={cn("size-1 rounded-full", count > 0 ? "bg-brand" : "bg-neutral/30")}
              />
            );
            const number = (
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-body",
                  isSelected ? "bg-brand font-semibold text-surface" : count > 0 ? "font-medium text-text-primary" : "text-text-secondary/70"
                )}
              >
                {cell.day}
              </span>
            );

            if (count === 0) {
              return (
                <span key={cell.date} className="flex flex-col items-center gap-0.5 py-0.5">
                  {number}
                  {dot}
                </span>
              );
            }

            return (
              <Link
                key={cell.date}
                href={dateHref(cell.date)}
                scroll={false}
                aria-label={`${formatDate(cell.date)}, ${sessionsLabel(count)}`}
                aria-current={isSelected ? "date" : undefined}
                className="flex flex-col items-center gap-0.5 rounded-md py-0.5 hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {number}
                {dot}
              </Link>
            );
          })}
        </div>

        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
            Sessions available
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-neutral/30" />
            No sessions
          </span>
        </p>
      </section>

      {quickDates.length > 0 ? (
        <section className="hidden rounded-card border border-border bg-surface p-4 shadow-xs lg:block">
          <h2 className="mb-2 text-body font-semibold text-text-primary">Quick dates</h2>
          <ul className="flex flex-col gap-1">
            {quickDates.map((quick) => {
              const isSelected = quick.date === selectedDate;
              return (
                <li key={quick.date}>
                  <Link
                    href={dateHref(quick.date)}
                    scroll={false}
                    aria-current={isSelected ? "date" : undefined}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border-l-2 px-3 py-2 text-body hover:bg-brand/5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      isSelected ? "border-brand bg-brand/10 font-medium text-text-primary" : "border-transparent text-text-primary"
                    )}
                  >
                    <span>{formatDate(quick.date)}</span>
                    <span className="text-small text-brand">{sessionsLabel(quick.count)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
