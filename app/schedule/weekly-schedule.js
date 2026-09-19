import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/list-page";
import { formatTime } from "@/lib/format";
import { DAYS_OF_WEEK, DAY_LABELS, addDaysUTC, timeToMinutes } from "@/lib/schedules/validation";

// Fixed 6:00 AM – 10:00 PM axis (02-ux.md D14 — an explicit decision, not
// read from the wireframe, whose own sample only draws a partial range).
// This must never expand or contract to fit whatever schedules exist.
const GRID_START_MINUTES = 6 * 60;
const GRID_END_MINUTES = 22 * 60;
// Tall enough that a one-hour card fits its three lines (batch code, time
// range, instructor) at the 12px/18px card type without clipping.
const HOUR_HEIGHT_PX = 72;

// Small buffers above the 6:00 AM line and below the 10:00 PM line — not part
// of the 6 AM–10 PM range itself (D14 is unchanged: still 16 one-hour rows),
// just empty space so the first and last hour labels have room to sit
// centered on their lines without clipping against the day-header row above
// or the grid's bottom edge.
const TOP_OFFSET_PX = 16;
const BOTTOM_OFFSET_PX = 16;
const GRID_HEIGHT_PX =
  ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * HOUR_HEIGHT_PX + TOP_OFFSET_PX + BOTTOM_OFFSET_PX;

// Card content tiers by rendered height (line = 18px at the card type size,
// plus 12px of vertical padding): a card shows as many of code / time range /
// instructor as fit. Nothing is ever clipped mid-line, and the full details
// stay available on the card's tooltip.
const CARD_HEIGHT_FOR_TIME_PX = 44;
const CARD_HEIGHT_FOR_INSTRUCTOR_PX = 62;

// A day column's cards must never be narrower than this, regardless of how
// many overlap — batch code, time range and instructor all need to stay
// readable (D15: overlapping cards stay visible, side by side, never
// hidden/collapsed — that only works if "side by side" doesn't mean
// "crushed"). The gap is the visible seam between adjacent overlapping
// cards in the same weekday/time slot.
const MIN_CARD_WIDTH_PX = 144;
const CARD_GAP_PX = 4;

// Maps a clock-time (in minutes since midnight) to its pixel offset from the
// top of the grid, including the buffer above — the single source of truth
// every hour label, gridline and schedule card positions itself against.
function minutesToGridOffsetPx(minutes) {
  return TOP_OFFSET_PX + (minutes - GRID_START_MINUTES) * (HOUR_HEIGHT_PX / 60);
}

function formatHourLabel(hour) {
  return formatTime(`${String(hour).padStart(2, "0")}:00`);
}

function formatDayDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatWeekRange(weekStart, weekEnd) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  // Same year: "Sep 14 – Sep 20, 2026" (both ends named, year once). A week that
  // crosses a year keeps the year on both sides.
  if (startYear === endYear) {
    const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${startLabel} – ${endLabel}, ${endYear}`;
  }

  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel} – ${endLabel}`;
}

/**
 * Packs a single day's overlapping schedule cards into side-by-side columns
 * (02-ux.md D15: "Overlapping cards are rendered side by side... Never hide
 * or collapse them"). Standard day-view calendar layout: cluster mutually
 * overlapping cards, then within each cluster greedily assign the lowest
 * free column — every card in a cluster shares that cluster's column count,
 * so they render at even widths.
 *
 * @param {{ startMinutes: number, endMinutes: number }[]} cards - already sorted by startMinutes.
 * @returns {({ column: number, totalColumns: number })[]} parallel to `cards`.
 */
function layoutDayCards(cards) {
  const clusters = [];
  let current = [];
  let currentEnd = -Infinity;

  for (const card of cards) {
    if (current.length === 0 || card.startMinutes < currentEnd) {
      current.push(card);
      currentEnd = Math.max(currentEnd, card.endMinutes);
    } else {
      clusters.push(current);
      current = [card];
      currentEnd = card.endMinutes;
    }
  }
  if (current.length > 0) clusters.push(current);

  const layoutByCard = new Map();
  for (const cluster of clusters) {
    const columnEnds = [];
    for (const card of cluster) {
      let column = columnEnds.findIndex((end) => end <= card.startMinutes);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(card.endMinutes);
      } else {
        columnEnds[column] = card.endMinutes;
      }
      layoutByCard.set(card, column);
    }
    const totalColumns = columnEnds.length;
    for (const card of cluster) {
      layoutByCard.set(card, { column: layoutByCard.get(card), totalColumns });
    }
  }

  return cards.map((card) => layoutByCard.get(card));
}

/**
 * The Weekly Schedule view (02-ux.md "Weekly Schedule view"): a week grid
 * visualising recurring schedule records only. Renders whatever
 * `listSchedulesForWeek` (lib/schedules/data.js) returned for `weekStart` —
 * this component does the per-occurrence effective-period check and the
 * overlap layout; it fetches nothing itself and creates/persists nothing.
 *
 * No class_sessions, no session status, no attendance — see this file's
 * sibling components for those honest absences; this view has no data to
 * be honest or dishonest about, since it only draws `schedules` rows.
 */
export default function WeeklySchedule({ weekStart, schedules }) {
  const weekEnd = addDaysUTC(weekStart, 6);
  const todayHref = "/schedule?view=weekly";
  const previousWeekHref = `/schedule?view=weekly&week=${addDaysUTC(weekStart, -7)}`;
  const nextWeekHref = `/schedule?view=weekly&week=${addDaysUTC(weekStart, 7)}`;

  const today = new Date().toISOString().slice(0, 10);

  const days = DAYS_OF_WEEK.map((dayOfWeek, index) => {
    const date = addDaysUTC(weekStart, index);

    const dayCards = schedules
      .filter((schedule) => {
        if (schedule.day_of_week !== dayOfWeek) return false;
        if (date < schedule.effective_from) return false;
        if (schedule.effective_until && date > schedule.effective_until) return false;
        return true;
      })
      .map((schedule) => ({
        schedule,
        startMinutes: Math.max(timeToMinutes(schedule.start_time), GRID_START_MINUTES),
        endMinutes: Math.min(timeToMinutes(schedule.end_time), GRID_END_MINUTES),
      }))
      .filter((card) => card.endMinutes > card.startMinutes)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

    const layouts = layoutDayCards(dayCards);
    const maxColumns = layouts.reduce((max, layout) => Math.max(max, layout.totalColumns), 1);

    return {
      dayOfWeek,
      date,
      isToday: date === today,
      cards: dayCards.map((card, index) => ({ ...card, ...layouts[index] })),
      // The widest cluster this day needs to show side by side without any
      // card dropping below MIN_CARD_WIDTH_PX — see the shared column
      // template below, which is what actually enforces it.
      minWidthPx: maxColumns * MIN_CARD_WIDTH_PX + (maxColumns - 1) * CARD_GAP_PX,
    };
  });

  const hourMarks = [];
  for (let hour = GRID_START_MINUTES / 60; hour <= GRID_END_MINUTES / 60; hour += 1) {
    hourMarks.push(hour);
  }

  // Every day still gets a flexible 1fr share of the available width — the
  // normal 7-day layout is unchanged whenever that's wide enough. A day
  // whose busiest overlap needs more room than its fair share gets an
  // explicit floor instead of 0, and grid tracks never shrink a column
  // below its own minmax() minimum: if the floors add up to more than the
  // viewport, the grid itself grows past it rather than crushing any
  // column, and the horizontal scroll below is what makes that reachable.
  const columnsTemplate = `64px ${days.map((day) => `minmax(${day.minWidthPx}px, 1fr)`).join(" ")}`;

  return (
    <>
      {/* Week navigation: the same toolbar card and control heights as the
          finalized list pages. Navigation changes only which week is shown. */}
      <ListToolbar className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" render={<Link href={todayHref} />} nativeButton={false}>
            Today
          </Button>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              render={<Link href={previousWeekHref} />}
              nativeButton={false}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <span className="text-body min-w-44 px-1 text-center font-medium text-text-primary">
              {formatWeekRange(weekStart, weekEnd)}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              render={<Link href={nextWeekHref} />}
              nativeButton={false}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </ListToolbar>

      <div className="overflow-hidden rounded-card border border-border bg-surface shadow-xs">
        {/* Horizontal scroll only when day columns need more width than the
            viewport (overlap floors). The full 6 AM–10 PM grid uses auto
            height and relies on the page scroll — no nested vertical scroller.
            The day-header row is `position: sticky` inside this same container
            so it scrolls horizontally with the body grid (same
            gridTemplateColumns, same parent) while staying pinned at the top
            of this horizontal viewport. */}
        <div className="overflow-x-auto">
          <div className="relative grid" style={{ gridTemplateColumns: columnsTemplate }}>
            <div className="sticky top-0 z-10 border-b border-border bg-surface" />
            {days.map((day) => (
              <div
                key={day.date}
                className={
                  day.isToday
                    ? "sticky top-0 z-10 border-b border-l border-border bg-brand/5 px-2 py-2 text-center"
                    : "sticky top-0 z-10 border-b border-l border-border bg-surface px-2 py-2 text-center"
                }
              >
                <p className={day.isToday ? "text-body font-semibold text-brand" : "text-body font-semibold text-text-primary"}>
                  {DAY_LABELS[day.dayOfWeek].slice(0, 3)}
                </p>
                <p className={day.isToday ? "text-small text-brand" : "text-small text-text-secondary"}>
                  {formatDayDate(day.date)}
                </p>
              </div>
            ))}

            <div className="relative" style={{ height: `${GRID_HEIGHT_PX}px` }}>
              {hourMarks.map((hour) => (
                <div
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-small text-text-secondary"
                  style={{ top: `${minutesToGridOffsetPx(hour * 60)}px` }}
                >
                  {formatHourLabel(hour)}
                </div>
              ))}
            </div>

            {days.map((day) => (
              <div
                key={day.date}
                className="relative border-l border-border"
                style={{ height: `${GRID_HEIGHT_PX}px` }}
              >
                {hourMarks.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-border"
                    style={{ top: `${minutesToGridOffsetPx(hour * 60)}px` }}
                  />
                ))}

                {day.cards.map((card) => {
                  const top = minutesToGridOffsetPx(card.startMinutes);
                  const height = (card.endMinutes - card.startMinutes) * (HOUR_HEIGHT_PX / 60);
                  // Equal-gap column math: each card's share of the day
                  // column's width, minus its fair portion of the gaps
                  // between cards, with `calc()` resolving the percentage
                  // against the day column's actual rendered width — which
                  // MIN_CARD_WIDTH_PX above already guarantees is enough
                  // for `card.totalColumns` cards at CARD_GAP_PX apart.
                  const widthPercent = 100 / card.totalColumns;
                  const gapPerCard = (CARD_GAP_PX * (card.totalColumns - 1)) / card.totalColumns;
                  const leftGap = (CARD_GAP_PX * card.column) / card.totalColumns;

                  const timeRange = `${formatTime(card.schedule.start_time)} – ${formatTime(card.schedule.end_time)}`;
                  const instructor = card.schedule.instructors?.full_name ?? "—";

                  return (
                    <div
                      key={card.schedule.id}
                      className="absolute overflow-hidden rounded-md border border-l-4 border-brand/30 border-l-brand bg-brand/10 px-2 py-1.5 text-small"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${card.column * widthPercent}% + ${leftGap}px)`,
                        width: `calc(${widthPercent}% - ${gapPerCard}px)`,
                      }}
                      title={`${card.schedule.batches?.name ?? ""} · ${timeRange} · ${instructor}`}
                    >
                      <p className="truncate font-semibold text-text-primary">{card.schedule.batches?.code ?? "—"}</p>
                      {height >= CARD_HEIGHT_FOR_TIME_PX ? (
                        <p className="truncate text-text-primary">{timeRange}</p>
                      ) : null}
                      {height >= CARD_HEIGHT_FOR_INSTRUCTOR_PX ? (
                        <p className="truncate text-text-secondary">{instructor}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
