import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one Present / Absent toggle, shared by Take Attendance
 * (`app/attendance/[scheduleId]/[date]/attendance-panel.js`) and Edit
 * Attendance (`app/attendance-history/[scheduleId]/[date]/edit/edit-attendance-form.js`).
 *
 * Selection is never colour-only: the selected button is filled and carries a
 * check / cross icon, and every button exposes `aria-pressed` and an
 * accessible name that includes the student ("Present: Aarav Sharma").
 * 36px tall; `className` is only for the caller's own layout (e.g. `flex-1`
 * to fill a stacked row), not for restyling the states.
 */
export default function MarkButton({ status, selected, studentName, disabled, onSelect, className }) {
  const isPresent = status === "present";
  const Icon = isPresent ? Check : X;

  return (
    <Button
      type="button"
      variant="outline"
      aria-pressed={selected}
      aria-label={`${isPresent ? "Present" : "Absent"}: ${studentName}`}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "h-9 px-2.5 sm:min-w-24 sm:px-3",
        selected
          ? isPresent
            ? "border-success bg-success text-surface hover:bg-success/90 hover:text-surface"
            : "border-danger bg-danger text-surface hover:bg-danger/90 hover:text-surface"
          : isPresent
            ? "border-border bg-surface text-text-secondary hover:border-success/40 hover:text-success"
            : "border-border bg-surface text-text-secondary hover:border-danger/40 hover:text-danger",
        className
      )}
    >
      {selected ? <Icon className="size-4" aria-hidden="true" /> : null}
      {isPresent ? "Present" : "Absent"}
    </Button>
  );
}
