"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@base-ui/react/tooltip";
import Avatar from "@/components/ui/avatar";
import { DAY_STATUS } from "@/lib/students/attendance-calendar";
import { formatDateWithWeekday, formatTimeRange } from "@/lib/format";
import { cn } from "@/lib/utils";

// Circle sizes: the strip's markers and the (smaller) legend's.
const SIZE = {
  md: { box: "size-5 text-[11px]", dot: "size-2.5" },
  sm: { box: "size-4 text-[9px]", dot: "size-2" },
};

const LETTER_BASE = "inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold";

/**
 * A day's marker, one small circle: P on green (Present), A on red (Absent), a dash in an outlined circle (nothing recorded),
 * and the plain neutral dot for Not Enrolled. A day with both a present and an absent mark shows the P and the A side by side.
 * Presentation only: the state comes from `buildAttendanceStrip`.
 */
export function DayMarker({ status, size = "md", className }) {
  const sizes = SIZE[size] ?? SIZE.md;

  if (status === "present") {
    return (
      <span aria-hidden="true" className={cn(LETTER_BASE, sizes.box, "bg-success text-surface", className)}>
        P
      </span>
    );
  }
  if (status === "absent") {
    return (
      <span aria-hidden="true" className={cn(LETTER_BASE, sizes.box, "bg-danger text-surface", className)}>
        A
      </span>
    );
  }
  if (status === "mixed") {
    return (
      <span aria-hidden="true" className={cn("inline-flex items-center -space-x-1", className)}>
        <span className={cn(LETTER_BASE, sizes.box, "bg-success text-surface ring-2 ring-surface")}>P</span>
        <span className={cn(LETTER_BASE, sizes.box, "bg-danger text-surface ring-2 ring-surface")}>A</span>
      </span>
    );
  }
  if (status === "no_record") {
    return (
      <span aria-hidden="true" className={cn(LETTER_BASE, sizes.box, "border border-neutral text-text-secondary", className)}>
        {"\u2014"}
      </span>
    );
  }
  // Not Enrolled: the existing neutral dot, centred in the same box so every row lines up.
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center justify-center", sizes.box, className)}>
      <span className={cn("rounded-full bg-neutral", sizes.dot)} />
    </span>
  );
}

/**
 * The instructor of a day's class(es): their photo, or the app's initials fallback, in a small circle. A day with two or more
 * instructors shows the first and a "+n" for the rest (the tooltip lists them all), the way the batch cards stack theirs. A day
 * with no instructor data shows nothing - never an assumed instructor.
 */
function DayInstructors({ instructors }) {
  if (instructors.length === 0) return null;
  const [first] = instructors;
  return (
    <span className="flex items-center -space-x-1.5">
      <Avatar name={first.name} src={first.photoUrl} size="sm" className="size-6 shrink-0 ring-2 ring-surface" />
      {instructors.length > 1 ? (
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral/15 text-[10px] font-semibold text-text-secondary ring-2 ring-surface"
        >
          +{instructors.length - 1}
        </span>
      ) : null}
    </span>
  );
}

// The words for a class's own state (screen readers; the circle itself is the visual).
const SESSION_STATUS_WORD = { present: "Present", absent: "Absent", no_record: "No record" };

function sessionTimeOf(session) {
  return session.startTime && session.endTime ? formatTimeRange(session.startTime, session.endTime) : null;
}

/**
 * The text a screen reader gets for a card: the date and the day's overall state, then each class - its time, instructor and ITS
 * OWN state. The tooltip shows the same facts; this keeps them available without it (a button's label replaces its inner content).
 */
function cardLabel(day) {
  const parts = [`${formatDateWithWeekday(day.date)}: ${DAY_STATUS[day.status]?.label ?? ""}`];
  for (const session of day.sessions ?? []) {
    parts.push(
      [sessionTimeOf(session), session.instructor ? `Instructor ${session.instructor.name}` : null, SESSION_STATUS_WORD[session.status]]
        .filter(Boolean)
        .join(", "),
    );
  }
  if (!(day.sessions ?? []).length && (day.instructors ?? []).length) {
    parts.push(`Instructor: ${day.instructors.map((instructor) => instructor.name).join(", ")}`);
  }
  return parts.filter(Boolean).join(". ");
}

/**
 * The tooltip for one date. Header: the full date, with the batch name beneath it, on a light band across the top - no overall
 * status, because a day can have several classes with different states. Then one row per class, divided by a thin line: on the left its time, and beneath it
 * the instructor (photo or initials, name - a long name wraps); on the right a status circle in its own column, the state of THAT
 * class only (P, A, or the outlined "no record" circle). Only what the data holds: a missing time or instructor reads
 * "not available" in grey; nothing is filled in from the batch or the schedule's weekday.
 */
function DayTip({ day, batchName }) {
  const sessions = day.sessions ?? [];

  return (
    <div className="flex flex-col">
      <div className="border-b border-border bg-background px-3 py-2.5">
        <p className="text-body leading-5 font-semibold text-text-primary">{formatDateWithWeekday(day.date)}</p>
        {batchName ? <p className="text-small leading-4 text-text-secondary">{batchName}</p> : null}
      </div>

      {sessions.length === 0 ? (
        <p className="text-small px-3 py-2.5 text-text-secondary">No session details available.</p>
      ) : (
        <ul className="flex flex-col px-3 pb-1">
          {sessions.map((session, index) => {
            const time = sessionTimeOf(session);
            return (
              <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                <div className="min-w-0">
                  <p className="text-small leading-4 font-semibold text-text-primary">{time ?? <span className="font-normal text-text-secondary">Time not available</span>}</p>
                  {session.instructor ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Avatar name={session.instructor.name} src={session.instructor.photoUrl} size="sm" className="size-6 shrink-0" />
                      <p className="min-w-0">
                        <span className="text-small block leading-4 font-medium break-words text-text-primary">{session.instructor.name}</span>
                        <span className="text-small block leading-4 text-text-secondary">Instructor</span>
                      </p>
                    </div>
                  ) : (
                    <p className="text-small mt-1.5 leading-4 text-text-secondary">Instructor not available</p>
                  )}
                </div>
                <span className="flex w-6 shrink-0 items-center justify-center">
                  <DayMarker status={session.status} />
                  <span className="sr-only">{SESSION_STATUS_WORD[session.status]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The calendar strip: one card per class date (weekday and date, state circle, instructor), scrolling sideways when the month
 * does not fit. A card can be selected (it starts on today, or the month's last shown day) - clicking selects, as always. Each
 * card also has a details tooltip (`DayTip`): on mouse hover (after a short delay; the pointer can move onto the tooltip) and on
 * keyboard focus; Escape, leaving, scrolling the strip or a tap elsewhere closes it. A tap on a touch screen selects the day
 * AND shows its details (a second tap on the same card hides them), since touch has no hover. The tooltip is placed above the
 * card, flipping below it and shifting sideways so it never runs off the screen. The selected card is scrolled into view
 * inside the strip only - the page itself never moves.
 */
export default function AttendanceStrip({ days, today, label, batchName }) {
  const initial = days.some((day) => day.date === today) ? today : days.at(-1)?.date;
  const [selected, setSelected] = useState(initial);
  // The date whose tooltip is open: one at a time, driven by hover, focus and (touch) taps.
  const [openDate, setOpenDate] = useState(null);
  const scroller = useRef(null);
  const selectedRef = useRef(null);
  // What the last pointer press was (to tell a touch tap from a mouse click) and whether the tip was already open then.
  const press = useRef(null);

  useEffect(() => {
    const box = scroller.current;
    const cell = selectedRef.current;
    if (!box || !cell) return;
    const left = cell.offsetLeft - box.clientWidth / 2 + cell.clientWidth / 2;
    box.scrollLeft = Math.max(0, left);
  }, []);

  // While a tooltip is open: Escape, or a press anywhere outside the cards and the tooltip, closes it.
  useEffect(() => {
    if (!openDate) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpenDate(null);
    };
    const onPointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest("[data-day-card], [data-attendance-tip]")) return;
      setOpenDate(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openDate]);

  return (
    <div
      ref={scroller}
      onScroll={() => setOpenDate(null)}
      className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-2 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
    >
      <ul aria-label={label} className="flex min-w-max gap-1.5">
        {days.map((day) => {
          const isSelected = day.date === selected;
          return (
            <li key={day.date}>
              <Tooltip.Root
                open={openDate === day.date}
                onOpenChange={(open) => setOpenDate((current) => (open ? day.date : current === day.date ? null : current))}
              >
                <Tooltip.Trigger
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  delay={350}
                  closeDelay={80}
                  closeOnClick={false}
                  data-day-card=""
                  onPointerDown={(event) => {
                    press.current = { type: event.pointerType, wasOpen: openDate === day.date };
                  }}
                  onClick={() => {
                    // The click always selects the day, as before. A touch tap (no hover) also toggles its details.
                    setSelected(day.date);
                    const last = press.current;
                    press.current = null;
                    if (last && last.type !== "mouse") setOpenDate(last.wasOpen ? null : day.date);
                  }}
                  aria-pressed={isSelected}
                  aria-label={cardLabel(day)}
                  className={cn(
                    "flex w-14 flex-col overflow-hidden rounded-lg border bg-surface text-center transition-colors",
                    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    isSelected ? "border-brand" : "border-border hover:border-brand/40"
                  )}
                >
                  {/* Header: weekday over the date number, one block. */}
                  <span className={cn("flex flex-col items-center border-b py-1.5", isSelected ? "border-brand/30 bg-brand/10" : "border-border bg-background")}>
                    <span className={cn("text-small leading-4 font-medium", isSelected ? "text-brand" : "text-text-secondary")}>{day.weekday}</span>
                    <span className={cn("text-section-title leading-6 font-bold", isSelected ? "text-brand" : "text-text-primary")}>{day.day}</span>
                  </span>
                  <span className="flex h-9 items-center justify-center">
                    <DayMarker status={day.status} />
                  </span>
                  <span className="flex h-9 items-center justify-center pb-1">
                    <DayInstructors instructors={day.instructors ?? []} />
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner side="top" align="center" sideOffset={8} collisionPadding={8} className="isolate z-50">
                    <Tooltip.Popup
                      data-attendance-tip=""
                      className="w-60 max-w-[calc(100vw-1rem)] origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-surface shadow-md duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0"
                    >
                      <DayTip day={day} batchName={batchName} />
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
