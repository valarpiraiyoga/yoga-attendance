"use client";

import { useMemo } from "react";
import Avatar from "@/components/ui/avatar";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { TIME_RANGE_CHIPS as TIME_CHIPS, WEEKDAYS, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { scheduleChoice } from "@/lib/enrollments/schedule-availability";
import { cn } from "@/lib/utils";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

const instructorKey = (schedule) => schedule.instructors?.id ?? schedule.instructors?.full_name ?? "none";

/**
 * The batch's schedules as a grid: a row per time slot and instructor, a column per weekday (Monday to Sunday). Each time slot is one tinted
 * block (the time and "(N instructors)") spanning its instructor rows; a row is the instructor (photo, name) and a checkbox on every day that
 * instructor teaches that slot - empty days have none. Presentation only: the time slots, ordering and colours are the picker's own helpers.
 *
 * @param {object[]} schedules
 * @returns {{ key: string, start: string, end: string, rows: { key: string, instructor: object|null, days: Map<string, object[]> }[] }[]}
 */
function gridOf(schedules) {
  const slots = new Map();
  for (const schedule of schedules ?? []) {
    const key = timeRangeKey(schedule);
    const slot = slots.get(key) ?? { key, start: schedule.start_time, end: schedule.end_time, rows: new Map() };
    slots.set(key, slot);
    const rowKey = instructorKey(schedule);
    const row = slot.rows.get(rowKey) ?? { key: rowKey, instructor: schedule.instructors ?? null, days: new Map() };
    slot.rows.set(rowKey, row);
    row.days.set(schedule.day_of_week, [...(row.days.get(schedule.day_of_week) ?? []), schedule]);
  }
  const name = (row) => row.instructor?.full_name ?? "";
  return [...slots.values()]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.end).localeCompare(String(b.end)))
    .map((slot) => ({ ...slot, rows: [...slot.rows.values()].sort((a, b) => name(a).localeCompare(name(b))) }));
}

/**
 * Select Class Schedules: the schedule checkboxes of a batch as a time-slot x weekday grid. Each schedule is still its own checkbox (the name
 * `schedule_series_ids`, one per series) - two instructors at the same time are never merged or selected together, and nothing here ticks or
 * unticks a schedule by itself. The grid scrolls sideways inside its own box on a narrow screen.
 *
 * `selectedSeriesIds` and `onToggle` are the form's own state.
 *
 * Schedule capacity (01-product.md §7): `capacities` is the plain object of places per schedule series (or null when it could not be read -
 * nothing is then shown or locked). Each checkbox shows its places beneath it ("10 / 20", or "Unlimited") and a "Full" chip; a full schedule
 * cannot be newly ticked, except one in `heldSeriesIds` - the places this enrollment already holds, which stay selectable because keeping them
 * takes no new place. A full schedule that is ticked can still be unticked. When the enrollment will take no place as saved (`restricted`
 * false: inactive, or ended before today) the database counts none of its assignments, so nothing is locked. This is a guide only: the database
 * decides on Save.
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
  const grid = useMemo(() => gridOf(schedules), [schedules]);
  const slots = useMemo(() => timeRangeSlots(schedules, TIME_CHIPS.length), [schedules]);

  return (
    <div role="group" aria-labelledby={labelledBy} className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-left">
        <thead>
          <tr className="bg-brand/5">
            <th scope="col" className="w-40 border-b border-border px-3 py-2.5 text-small font-semibold text-text-primary">Time</th>
            <th scope="col" className="w-48 border-b border-border px-3 py-2.5 text-small font-medium text-text-secondary">Instructor</th>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="border-b border-border px-1 py-2.5 text-center text-small font-medium text-text-secondary">
                <span aria-hidden="true">{DAY_LABELS[day].slice(0, 3)}</span>
                <span className="sr-only">{DAY_LABELS[day]}</span>
              </th>
            ))}
          </tr>
        </thead>
        {grid.map((slot) => {
          const tone = TIME_CHIPS[slots.get(slot.key) ?? 0];
          const instructorCount = slot.rows.filter((row) => row.instructor).length;
          const time = `${formatTime(slot.start)} – ${formatTime(slot.end)}`;
          return (
            <tbody key={slot.key} className="[&>tr:last-child>td]:border-b [&>tr:last-child>td]:border-border">
              {slot.rows.map((row, rowIndex) => {
                const instructorName = row.instructor?.full_name ?? "—";
                return (
                  <tr key={row.key}>
                    {rowIndex === 0 ? (
                      <td rowSpan={slot.rows.length} className="p-1.5 align-middle">
                        <div className={cn("flex h-full min-h-14 flex-col items-center justify-center rounded-lg px-2 py-2 text-center", tone)}>
                          <span className="text-small font-semibold whitespace-nowrap tabular-nums">{time}</span>
                          <span className="text-small opacity-80">
                            ({instructorCount === 1 ? "1 instructor" : `${instructorCount} instructors`})
                          </span>
                        </div>
                      </td>
                    ) : null}
                    <td className={cn("px-3 py-2", rowIndex > 0 && "border-t border-border/60")}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={instructorName} src={row.instructor?.photo_url ?? null} size="md" className="shrink-0" />
                        <span className="min-w-0">
                          <span className="text-body block truncate font-medium text-text-primary">{instructorName}</span>
                          <span className="text-small block text-text-secondary">Instructor</span>
                        </span>
                      </span>
                    </td>
                    {WEEKDAYS.map((day) => (
                      <td key={day} className={cn("px-1 py-2 text-center align-middle", rowIndex > 0 && "border-t border-border/60")}>
                        {(row.days.get(day) ?? []).map((schedule) => {
                          const checked = selectedSeriesIds.has(schedule.series_id);
                          const choice = scheduleChoice({
                            info: capacities?.[schedule.series_id] ?? null,
                            checked,
                            held: heldSeriesIds.has(schedule.series_id),
                            restricted,
                          });
                          const capacityId = `schedule-capacity-${schedule.series_id}`;
                          return (
                            <label
                              key={schedule.series_id}
                              className={cn("flex flex-col items-center gap-0.5 py-0.5", choice.disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer")}
                              title={choice.hint ?? undefined}
                            >
                              <input
                                type="checkbox"
                                name="schedule_series_ids"
                                value={schedule.series_id}
                                checked={checked}
                                onChange={() => onToggle(schedule.series_id)}
                                disabled={disabled || choice.disabled}
                                aria-describedby={choice.text ? capacityId : undefined}
                                className="size-5 rounded border-border accent-brand disabled:cursor-not-allowed"
                              />
                              <span className="sr-only">
                                {DAY_LABELS[day]} {time} with {instructorName}
                              </span>
                              {choice.text ? (
                                <span id={capacityId} className="flex flex-col items-center gap-0.5">
                                  <span className="text-[0.6875rem] leading-4 tabular-nums text-text-secondary">{choice.text}</span>
                                  {choice.chip ? (
                                    <span className="text-small rounded-full bg-danger/10 px-2 py-0.5 font-medium whitespace-nowrap text-danger">{choice.chip}</span>
                                  ) : null}
                                  {choice.hint ? <span className="sr-only">{choice.hint}</span> : null}
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
