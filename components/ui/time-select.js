"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1);
  return { value, label: value };
});

const PERIOD_OPTIONS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

const MINUTE_STEP = 5;
const BASE_MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => String(index * MINUTE_STEP).padStart(2, "0"));

// "HH:MM" (or "HH:MM:SS", as Postgres `time` columns return) -> the three
// picker parts, or null when it is not a complete time.
function parseTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value ?? ""));
  if (!match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  return {
    hour: String(hours % 12 === 0 ? 12 : hours % 12),
    minute: match[2],
    period: hours >= 12 ? "PM" : "AM",
  };
}

// The three parts -> "HH:MM" (24-hour), or "" until all three are chosen.
function toTime({ hour, minute, period }) {
  if (!hour || !minute || !period) return "";
  const base = Number(hour) % 12;
  const hours = period === "PM" ? base + 12 : base;
  return `${String(hours).padStart(2, "0")}:${minute}`;
}

/**
 * Time picker for forms: an hour, a minute and an AM/PM dropdown side by side
 * instead of the browser's `<input type="time">`, whose segmented hour/minute
 * fields are fiddly to hit and to type into. Minutes step by 5 (a saved time
 * that is not on that grid is still shown exactly).
 *
 * Controlled by a plain 24-hour "HH:MM" string — the same value the native
 * input produced — and submitted under `name` through a hidden input, so
 * validation, actions and the database are unchanged. `value` is "" until
 * hour, minute and AM/PM are all chosen; picking an hour first fills the
 * minute with "00" (classes usually start on the hour), leaving only AM/PM to
 * choose. A half-chosen time is kept locally so the picker does not snap back.
 *
 * @param {object} props
 * @param {string} props.id - id of the first (hour) control, for the field's `<Label htmlFor>`.
 * @param {string} props.name - form field name of the submitted "HH:MM".
 * @param {string} props.label - what the time is ("Start time"), for the controls' accessible names.
 * @param {string} props.value - "HH:MM" or "".
 * @param {(value: string) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.invalid]
 */
export default function TimeSelect({ id, name, label, value, onChange, disabled = false, invalid = false }) {
  const [draft, setDraft] = useState({ hour: "", minute: "", period: "" });
  const parts = parseTime(value) ?? draft;

  // A saved time whose minute is off the 5-minute grid keeps that minute as an
  // option. Fixed at mount: options that appear or vanish as the value changes
  // make the underlying Select report a spurious "no value".
  const [savedMinute] = useState(() => parseTime(value)?.minute);
  const minuteOptions = (savedMinute && !BASE_MINUTES.includes(savedMinute) ? [...BASE_MINUTES, savedMinute].sort() : BASE_MINUTES).map(
    (minute) => ({ value: minute, label: minute })
  );

  function update(field, next) {
    if (!next) return;
    const updated = { ...parts, [field]: next };
    if (field === "hour" && !updated.minute) updated.minute = "00";
    setDraft(updated);
    onChange(toTime(updated));
  }

  return (
    <div role="group" aria-label={label} className="grid grid-cols-3 gap-2">
      <Select items={HOUR_OPTIONS} value={parts.hour} onValueChange={(next) => update("hour", next)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full min-w-0" aria-label={`${label} hour`} aria-invalid={invalid}>
          <SelectValue placeholder="Hr" />
        </SelectTrigger>
        <SelectContent>
          {HOUR_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={minuteOptions} value={parts.minute} onValueChange={(next) => update("minute", next)} disabled={disabled}>
        <SelectTrigger className="w-full min-w-0" aria-label={`${label} minutes`} aria-invalid={invalid}>
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent>
          {minuteOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select items={PERIOD_OPTIONS} value={parts.period} onValueChange={(next) => update("period", next)} disabled={disabled}>
        <SelectTrigger className="w-full min-w-0" aria-label={`${label} AM or PM`} aria-invalid={invalid}>
          <SelectValue placeholder="AM/PM" />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Always the normalised "HH:MM" (a saved "HH:MM:SS" loses its seconds). */}
      <input type="hidden" name={name} value={toTime(parts)} />
    </div>
  );
}
