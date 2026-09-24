import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/list-page";
import { formatTime, formatTimeRangeCompactParts } from "@/lib/format";
import { DAYS_OF_WEEK, DAY_LABELS, addDaysUTC, timeToMinutes, scheduleAppliesOn } from "@/lib/schedules/validation";
import WeeklyScheduleCard from "@/app/schedule/weekly-schedule-card";

// Fixed 6:00 AM – 10:00 PM axis (02-ux.md D14 — an explicit decision, not
// read from the wireframe, whose own sample only draws a partial range).
// This must never expand or contract to fit whatever schedules exist.
const GRID_START_MINUTES = 6 * 60;
const GRID_END_MINUTES = 22 * 60;
// The vertical scale — every card's height and position are still purely a
// function of its real start/end time against the hour height. Unchanged by
// the card's own content simplification below: a card's box is never
// resized to fit (or save on) whatever is drawn inside it.
//
// The hour height is the CSS variable `--week-hour`, set on the calendar card
// below: 72px from `sm` up (the established desktop scale) and a tighter 56px
// on a phone. Every top / height / grid height is a `calc()` of it, so a
// session occupies exactly its real share of the axis at either size.

// Small buffers above the 6:00 AM line and below the 10:00 PM line — not part
// of the 6 AM–10 PM range itself (D14 is unchanged: still 16 one-hour rows),
// just empty space so the first and last hour labels have room to sit
// centered on their lines without clipping against the day-header row above
// or the grid's bottom edge.
const TOP_OFFSET_PX = 16;
const BOTTOM_OFFSET_PX = 16;
const GRID_HOURS = (GRID_END_MINUTES - GRID_START_MINUTES) / 60;
const GRID_HEIGHT = `calc(var(--week-hour) * ${GRID_HOURS} + ${TOP_OFFSET_PX + BOTTOM_OFFSET_PX}px)`;

// A day column's cards must never be narrower than this, regardless of how
// many overlap — a small instructor avatar plus the batch code, on one line,
// both need to stay readable (D15: overlapping cards stay visible, side by
// side, never hidden/collapsed — that only works if "side by side" doesn't
// mean "crushed"). The card no longer carries the instructor's name or the
// time range (available on click instead), so this floor is deliberately
// narrow — just enough for the avatar + a short code, not a name that would
// need to wrap. The gap is the visible seam between adjacent overlapping
// cards in the same weekday/time slot; the same value also insets every card
// from its day column's own left/right edges, so cards never visually touch
// the grid lines.
const MIN_CARD_WIDTH_PX = 96;
// A day with only one (non-overlapping) card gets `width: 100%` of its day
// column, which can stretch well past what a tiny avatar + short code needs
// on a wide viewport — this caps how big the card is ever drawn, so it stays
// a compact chip instead of a mostly-empty stretched box. Never shrinks a
// shared/overlapping card below its MIN_CARD_WIDTH_PX floor: the two only
// disagree when a card would otherwise be wider than this, i.e. exactly the
// single-card-in-a-wide-column case this exists to fix.
const CARD_MAX_WIDTH_PX = 140;
const CARD_GAP_PX = 4;
// A hairline seam between two back-to-back cards (e.g. Tuesday 6–7 and
// 7–8) so they read as two separate records, not one continuous block.
// Trims only the rendered box's bottom edge — `top` (the card's start
// position) is untouched, so its vertical position against the grid stays
// exactly what the schedule's start time computes.
const CARD_VERTICAL_GAP_PX = 2;
// On a phone a card also carries its short time range under the batch code, but
// only when its (proportional) height can hold both lines without clipping — a
// shorter session shows just the code, its time still on the axis and in its
// click-to-open details.
const MIN_SHORT_TIME_MINUTES = 45;

// Maps a clock-time (in minutes since midnight) to its offset from the top of
// the grid, including the buffer above — the single source of truth every hour
// label, gridline and schedule card positions itself against. A CSS `calc()`
// string of `--week-hour`, not a fixed pixel number (see `--week-hour` above).
function minutesToGridOffset(minutes) {
  return `calc(var(--week-hour) * ${(minutes - GRID_START_MINUTES) / 60} + ${TOP_OFFSET_PX}px)`;
}

// A card's height for its real duration, a hairline shorter (`trimPx`).
function durationToHeight(minutes, trimPx) {
  return `max(0px, calc(var(--week-hour) * ${minutes / 60} - ${trimPx}px))`;
}

function formatHourLabel(hour) {
  return formatTime(`${String(hour).padStart(2, "0")}:00`);
}

// "6 AM" — the axis label a narrow (mobile) time column can hold legibly.
function formatHourLabelShort(hour) {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour >= 12 ? "PM" : "AM"}`;
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
export default function WeeklySchedule({ weekStart, schedules, today }) {
  const weekEnd = addDaysUTC(weekStart, 6);
  const todayHref = "/schedule?view=weekly";
  const previousWeekHref = `/schedule?view=weekly&week=${addDaysUTC(weekStart, -7)}`;
  const nextWeekHref = `/schedule?view=weekly&week=${addDaysUTC(weekStart, 7)}`;

  // `today` is the centre's business date (its time zone from Center Settings),
  // the same one Attendance and the Dashboard use — not the UTC date, which is
  // still yesterday for part of every centre day.

  const days = DAYS_OF_WEEK.map((dayOfWeek, index) => {
    const date = addDaysUTC(weekStart, index);

    const dayCards = schedules
      .filter((schedule) => scheduleAppliesOn(schedule, dayOfWeek, date))
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
  //
  // On a phone the same template gives every day at least a third of the
  // calendar's width (`--week-col-floor`, 0 from `sm` up), so three days are
  // comfortably readable at once and the rest are a swipe away inside the
  // calendar card — the page itself never scrolls sideways. The time axis is
  // `--week-axis` wide (44px on mobile, 64px from `sm`) and stays pinned while
  // the days scroll.
  const columnsTemplate = `var(--week-axis) ${days
    .map((day) => `minmax(max(${day.minWidthPx}px, var(--week-col-floor)), 1fr)`)
    .join(" ")}`;

  return (
    <>
      {/* Week navigation: the same toolbar card and control heights as the
          finalized list pages. Navigation changes only which week is shown. */}
      <ListToolbar className="mb-4 max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none">
        <div className="flex items-center gap-2 sm:flex-wrap sm:gap-3">
          <Button variant="outline" render={<Link href={todayHref} />} nativeButton={false}>
            Today
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5 sm:flex-none sm:justify-start">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              render={<Link href={previousWeekHref} />}
              nativeButton={false}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <span className="text-body px-1 text-center font-medium whitespace-nowrap text-text-primary sm:min-w-44">
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

      <div className="@container overflow-hidden rounded-card border border-border bg-surface shadow-xs [--week-axis:44px] [--week-col-floor:calc((100cqw-44px)/3)] [--week-hour:56px] sm:[--week-axis:64px] sm:[--week-col-floor:0px] sm:[--week-hour:72px]">
        {/* Horizontal scroll only when day columns need more width than the
            viewport (overlap floors). The full 6 AM–10 PM grid uses auto
            height and relies on the page scroll — no nested vertical scroller.
            The day-header row is `position: sticky` inside this same container
            so it scrolls horizontally with the body grid (same
            gridTemplateColumns, same parent) while staying pinned at the top
            of this horizontal viewport. */}
        <div className="overflow-x-auto">
          <div className="relative grid" style={{ gridTemplateColumns: columnsTemplate }}>
            <div className="sticky top-0 left-0 z-20 border-b border-border bg-surface" />
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

            {/* The time axis: pinned to the left while the days scroll, on its own
                surface with a right rule so it reads as separate from the day
                columns; the labels sit right-aligned against that rule. */}
            <div
              className="sticky left-0 z-10 border-r border-border bg-surface"
              style={{ height: GRID_HEIGHT }}
            >
              {hourMarks.map((hour) => (
                <div
                  key={hour}
                  className="absolute right-1.5 -translate-y-1/2 text-small whitespace-nowrap text-text-secondary sm:right-2"
                  style={{ top: minutesToGridOffset(hour * 60) }}
                >
                  <span className="sm:hidden">{formatHourLabelShort(hour)}</span>
                  <span className="max-sm:hidden">{formatHourLabel(hour)}</span>
                </div>
              ))}
            </div>

            {days.map((day) => (
              <div
                key={day.date}
                className="relative border-l border-border"
                style={{ height: GRID_HEIGHT }}
              >
                {hourMarks.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-border"
                    style={{ top: minutesToGridOffset(hour * 60) }}
                  />
                ))}

                {/* Insets every card CARD_GAP_PX from this day column's own left/right
                    edges — a `position: absolute` box with both `left` and `right` set
                    becomes its own positioning context, so every card below keeps
                    positioning itself with the exact same percentage/calc() math against
                    this (slightly narrower) box instead of the day column directly. Purely
                    a rendering box: the vertical axis (top/height, i.e. every card's actual
                    time) is untouched. */}
                <div className="absolute inset-y-0" style={{ left: `${CARD_GAP_PX}px`, right: `${CARD_GAP_PX}px` }}>
                  {day.cards.map((card) => {
                    const top = minutesToGridOffset(card.startMinutes);
                    // Equal-gap column math: each card's share of the day
                    // column's width, minus its fair portion of the gaps
                    // between cards, with `calc()` resolving the percentage
                    // against the day column's actual rendered width — which
                    // MIN_CARD_WIDTH_PX above already guarantees is enough
                    // for `card.totalColumns` cards at CARD_GAP_PX apart.
                    const widthPercent = 100 / card.totalColumns;
                    const gapPerCard = (CARD_GAP_PX * (card.totalColumns - 1)) / card.totalColumns;
                    const leftGap = (CARD_GAP_PX * card.column) / card.totalColumns;

                    // Still handed to the card for its click-to-open popup — the visible
                    // card itself shows only the instructor's avatar and the batch code;
                    // the grid's vertical axis (left-hand hour labels + this card's own
                    // position) is what communicates the time.
                    const timeRange = `${formatTime(card.schedule.start_time)} – ${formatTime(card.schedule.end_time)}`;
                    const instructor = card.schedule.instructors?.full_name ?? "—";

                    return (
                      <WeeklyScheduleCard
                        key={card.schedule.id}
                        schedule={card.schedule}
                        dayLabel={DAY_LABELS[day.dayOfWeek]}
                        timeRange={timeRange}
                        shortTimeParts={formatTimeRangeCompactParts(card.schedule.start_time, card.schedule.end_time)}
                        showShortTime={card.endMinutes - card.startMinutes >= MIN_SHORT_TIME_MINUTES}
                        instructor={instructor}
                        style={{
                          top,
                          // A hairline shorter than the schedule's real duration (see
                          // CARD_VERTICAL_GAP_PX) so back-to-back cards (e.g. Tuesday
                          // 6–7 and 7–8) show a visible seam instead of touching.
                          height: durationToHeight(card.endMinutes - card.startMinutes, CARD_VERTICAL_GAP_PX),
                          left: `calc(${card.column * widthPercent}% + ${leftGap}px)`,
                          width: `calc(${widthPercent}% - ${gapPerCard}px)`,
                          maxWidth: `${CARD_MAX_WIDTH_PX}px`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
