"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { TIME_RANGE_CHIPS as TIME_CHIPS, groupSchedulesByDay, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { scheduleChoice } from "@/lib/enrollments/schedule-availability";
import { cn } from "@/lib/utils";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

/**
 * The schedule checkboxes of a batch, grouped Monday to Sunday in an accordion. All seven days start open; a day header only
 * shows or hides its rows (`hidden`, so every checkbox stays in the form and a collapsed day keeps its selection). Each schedule
 * is its own row and its own checkbox - two instructors at the same time are never merged or selected together.
 *
 * `selectedSeriesIds` and `onToggle` are the form's own state; the checkboxes keep the name `schedule_series_ids`.
 *
 * Schedule capacity (01-product.md §7): `capacities` is the plain object of places per schedule series (or null when it could
 * not be read - nothing is then shown or locked). Each row shows its places ("10 / 20", or "Unlimited") and a "Full" chip; a full
 * schedule cannot be newly ticked, except one in `heldSeriesIds` - the places this enrollment already holds, which stay selectable
 * because keeping them takes no new place. A full schedule that is ticked can still be unticked. When the enrollment will take no
 * place as saved (`restricted` false: inactive, or ended before today) the database counts none of its assignments, so nothing is
 * locked. This is a guide only: the database decides on Save.
 */
export default function SchedulePicker({
  schedules,
  selectedSeriesIds,
  onToggle,
  disabled = false,
  labelledBy,
  capacities = null,
  heldSeriesIds = new Set(),
  restricted = true,
}) {
  const [closedDays, setClosedDays] = useState(() => new Set());
  const days = useMemo(() => groupSchedulesByDay(schedules), [schedules]);
  const slots = useMemo(() => timeRangeSlots(schedules, TIME_CHIPS.length), [schedules]);

  function toggleDay(day) {
    setClosedDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-2">
      {days.map(({ day, schedules: list }) => {
        const open = !closedDays.has(day);
        const panelId = `schedule-day-${day}`;
        return (
          <section key={day} className="overflow-hidden rounded-card border border-border bg-surface">
            <h3 className="m-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggleDay(day)}
                className="flex w-full items-center justify-between gap-3 bg-brand/5 px-4 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-body font-semibold text-text-primary">{DAY_LABELS[day]}</span>
                  <span className="text-small rounded-full bg-neutral/15 px-2.5 py-0.5 whitespace-nowrap text-text-secondary">
                    {list.length} {list.length === 1 ? "class" : "classes"}
                  </span>
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-text-secondary transition-transform", open && "rotate-180")} aria-hidden="true" />
              </button>
            </h3>
            <div id={panelId} hidden={!open} className="px-4">
              {list.length === 0 ? (
                <p className="text-small py-3 text-text-secondary">No classes scheduled.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {list.map((schedule) => {
                    const checked = selectedSeriesIds.has(schedule.series_id);
                    const choice = scheduleChoice({
                      info: capacities?.[schedule.series_id] ?? null,
                      checked,
                      held: heldSeriesIds.has(schedule.series_id),
                      restricted,
                    });
                    const capacityId = `schedule-capacity-${schedule.series_id}`;
                    return (
                      <li key={schedule.series_id}>
                        <label
                          className={cn(
                            "grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[auto_11rem_minmax(0,1fr)] sm:gap-x-4",
                            choice.disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                          )}
                        >
                          <input
                            type="checkbox"
                            name="schedule_series_ids"
                            value={schedule.series_id}
                            checked={checked}
                            onChange={() => onToggle(schedule.series_id)}
                            disabled={disabled || choice.disabled}
                            aria-describedby={choice.text ? capacityId : undefined}
                            className="row-span-2 size-4 rounded border-border accent-brand disabled:cursor-not-allowed sm:row-span-1"
                          />
                          <span
                            className={cn(
                              "text-small w-fit rounded-md px-2 py-0.5 font-medium whitespace-nowrap tabular-nums",
                              TIME_CHIPS[slots.get(timeRangeKey(schedule)) ?? 0],
                            )}
                          >
                            {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                          </span>
                          <span className="flex min-w-0 items-center gap-2 sm:col-auto max-sm:col-start-2">
                            <Avatar name={schedule.instructors?.full_name ?? "—"} src={schedule.instructors?.photo_url ?? null} size="sm" className="size-7" />
                            <span className="text-body min-w-0 truncate text-text-primary">{schedule.instructors?.full_name ?? "—"}</span>
                            {choice.text ? (
                              <span id={capacityId} className="ml-auto flex shrink-0 items-center gap-1.5" title={choice.hint ?? undefined}>
                                <span className="text-small tabular-nums text-text-secondary">{choice.text}</span>
                                {choice.chip ? (
                                  <span className="text-small rounded-full bg-danger/10 px-2 py-0.5 font-medium whitespace-nowrap text-danger">{choice.chip}</span>
                                ) : null}
                                {choice.hint ? <span className="sr-only">{choice.hint}</span> : null}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
