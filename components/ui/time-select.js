"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1);
  return { value, label: value };
});

const PERIOD_OPTIONS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

// Quarter-hour presets — the common case for a class's start/end minute.
// "Custom…" swaps the dropdown for a plain number field so any exact minute
// can still be entered.
const MINUTE_PRESETS = ["00", "15", "30", "45"];
const CUSTOM_MINUTE = "custom";
const MINUTE_OPTIONS = [
  ...MINUTE_PRESETS.map((minute) => ({ value: minute, label: minute })),
  { value: CUSTOM_MINUTE, label: "Custom…" },
];

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
 * fields are fiddly to hit and to type into. Minutes offer the four
 * quarter-hour presets (:00/:15/:30/:45) plus "Custom…", which swaps the
 * dropdown for a plain number field so any exact minute can still be
 * entered — a saved time whose minute isn't a quarter hour (e.g. an existing
 * "06:20" schedule) opens straight into that custom field rather than
 * silently rounding it.
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

  // Custom mode once the current minute isn't one of the quarter-hour
  // presets (fixed at mount, same reasoning as the old preset-injection this
  // replaces: switching modes as the value changes would fight the picker).
  const [customMinute, setCustomMinute] = useState(() => {
    const initial = parseTime(value)?.minute;
    return Boolean(initial) && !MINUTE_PRESETS.includes(initial);
  });
  // The custom field's own displayed text — deliberately NOT the zero-padded
  // "05" `parts.minute` holds, so typing "5" then "0" reads as "50", not a
  // padded value fighting the next keystroke. Same non-padded-while-editing
  // treatment the hour dropdown already gives its "1"–"12" labels.
  const [customMinuteText, setCustomMinuteText] = useState(() => {
    const initial = parseTime(value)?.minute;
    return initial ? String(Number(initial)) : "";
  });

  function update(field, next) {
    if (!next) return;
    const updated = { ...parts, [field]: next };
    if (field === "hour" && !updated.minute) updated.minute = "00";
    setDraft(updated);
    onChange(toTime(updated));
  }

  function selectMinute(next) {
    if (next === CUSTOM_MINUTE) {
      setCustomMinute(true);
      return;
    }
    update("minute", next);
  }

  function typeCustomMinute(raw) {
    const digits = raw.replace(/[^0-9]/g, "").slice(0, 2);
    const clamped = digits === "" ? "" : String(Math.min(59, Number(digits)));
    setCustomMinuteText(clamped);
    const updated = { ...parts, minute: clamped === "" ? "" : clamped.padStart(2, "0") };
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

      {customMinute ? (
        <div className="relative min-w-0">
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            placeholder="Min"
            value={customMinuteText}
            onChange={(event) => typeCustomMinute(event.target.value)}
            disabled={disabled}
            aria-label={`${label} minutes`}
            aria-invalid={invalid}
            className="w-full min-w-0 pr-8 text-center"
          />
          <button
            type="button"
            onClick={() => setCustomMinute(false)}
            disabled={disabled}
            aria-label={`Use quick-select ${label} minutes`}
            title="Use quick-select minutes"
            className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-input text-text-secondary outline-none hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <Select items={MINUTE_OPTIONS} value={parts.minute} onValueChange={selectMinute} disabled={disabled}>
          <SelectTrigger className="w-full min-w-0" aria-label={`${label} minutes`} aria-invalid={invalid}>
            <SelectValue placeholder="Min" />
          </SelectTrigger>
          <SelectContent>
            {MINUTE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

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
