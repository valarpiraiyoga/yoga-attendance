import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DAYS_OF_WEEK, DAY_LABELS, addDaysUTC, timeToMinutes } from "@/lib/schedules/validation";

// Fixed 6:00 AM – 10:00 PM axis (02-ux.md D14 — an explicit decision, not
// read from the wireframe, whose own sample only draws a partial range).
// This must never expand or contract to fit whatever schedules exist.
const GRID_START_MINUTES = 6 * 60;
const GRID_END_MINUTES = 22 * 60;
const HOUR_HEIGHT_PX = 64;

// A small buffer above the 6:00 AM line — not part of the 6 AM–10 PM range
// itself (D14 is unchanged: still 16 one-hour rows), just empty space so the
// earliest hour label has room to sit centered on its line without clipping
// against the day-header row above, and a 6:00 AM card starts with visible
// separation from that same border instead of touching it.
const TOP_OFFSET_PX = 16;
const GRID_HEIGHT_PX = ((GRID_END_MINUTES - GRID_START_MINUTES) / 60) * HOUR_HEIGHT_PX + TOP_OFFSET_PX;

// A day column's cards must never be narrower than this, regardless of how
// many overlap — batch code, time range and instructor all need to stay
// readable (D15: overlapping cards stay visible, side by side, never
// hidden/collapsed — that only works if "side by side" doesn't mean
// "crushed"). The gap is the visible seam between adjacent overlapping
// cards in the same weekday/time slot.
const MIN_CARD_WIDTH_PX = 130;
const CARD_GAP_PX = 4;

// Approximate rendered height of the sticky day-header row (two lines of
// text plus its own padding/border) — only used to size the single
// scrollable area's visible window; a few px of slack either way changes
// nothing about correctness, only how much of the body is visible at once
// before the vertical scrollbar engages.
const HEADER_ROW_HEIGHT_PX = 60;
const VISIBLE_HEIGHT_PX = HEADER_ROW_HEIGHT_PX + 640;

// Maps a clock-time (in minutes since midnight) to its pixel offset from the
// top of the grid, including the buffer above — the single source of truth
// every hour label, gridline and schedule card positions itself against.
function minutesToGridOffsetPx(minutes) {
  return TOP_OFFSET_PX + (minutes - GRID_START_MINUTES) * (HOUR_HEIGHT_PX / 60);
}

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatHourLabel(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${period}`;
}

function formatWeekRange(weekStart, weekEnd) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const startLabel = start.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const endLabel = end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
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
  for (let hour = GRID_START_MINUTES / 60; hour < GRID_END_MINUTES / 60; hour += 1) {
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
    <div className="rounded-card border border-border bg-surface shadow-xs">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Button variant="outline" size="sm" render={<Link href={todayHref} />} nativeButton={false}>
          Today
        </Button>
        <Button variant="outline" size="sm" render={<Link href={previousWeekHref} />} nativeButton={false}>
          Previous
        </Button>
        <Button variant="outline" size="sm" render={<Link href={nextWeekHref} />} nativeButton={false}>
          Next
        </Button>
        <span className="text-body font-medium text-text-primary">{formatWeekRange(weekStart, weekEnd)}</span>
      </div>

      {/* A single scroll container for both axes (`overflow-auto` sets
          overflow-x AND overflow-y explicitly, so neither gets silently
          upgraded by the CSS Overflow spec's visible/non-visible coupling
          rule — that coupling is what caused a second, independent
          horizontal scrollbar when the vertical-only scroller below used
          to be a separate nested element). The day-header row is a
          `position: sticky` row *inside* this same container rather than
          a separate element above it, so it is never its own overflow
          context — it scrolls horizontally exactly as one unit with the
          body grid below it (same gridTemplateColumns, same direct parent,
          so both resolve to the identical column widths), while staying
          pinned to the top of the visible area as the container scrolls
          vertically. Wrapping the header in its own sibling div (as a
          previous version of this fix did) required that div's own width
          to independently match the grid's — a plain block does not grow
          to fit a wide child's content the way a CSS grid does, so it
          either clipped the grid or needed a `w-fit` that also broke the
          1fr columns' "fill available width" behavior for the normal,
          non-overlapping case. Making the header a sticky row of the same
          grid sidesteps that entirely. */}
      <div className="overflow-auto" style={{ maxHeight: `${VISIBLE_HEIGHT_PX}px` }}>
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
              <p className="text-small font-medium tracking-wide text-text-secondary uppercase">
                {DAY_LABELS[day.dayOfWeek].slice(0, 3)}
              </p>
              <p className={day.isToday ? "text-body font-semibold text-brand" : "text-body font-semibold text-text-primary"}>
                {Number(day.date.slice(8, 10))}
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

                return (
                  <div
                    key={card.schedule.id}
                    className="absolute overflow-hidden rounded-md border border-brand/30 bg-brand/10 p-1 text-small"
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                      left: `calc(${card.column * widthPercent}% + ${leftGap}px)`,
                      width: `calc(${widthPercent}% - ${gapPerCard}px)`,
                    }}
                    title={`${card.schedule.batches?.name ?? ""} · ${formatTime(card.schedule.start_time)} – ${formatTime(card.schedule.end_time)} · ${card.schedule.instructors?.full_name ?? ""}`}
                  >
                    <Badge variant="outline" className="max-w-full truncate">
                      {card.schedule.batches?.code ?? "—"}
                    </Badge>
                    <p className="mt-0.5 truncate text-text-primary">
                      {formatTime(card.schedule.start_time)} – {formatTime(card.schedule.end_time)}
                    </p>
                    <p className="truncate text-text-secondary">{card.schedule.instructors?.full_name ?? "—"}</p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
