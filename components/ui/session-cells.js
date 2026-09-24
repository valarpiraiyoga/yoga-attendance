import { Clock } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The compact session pattern shared by every session table — Attendance
 * (Today's / All Sessions) and Attendance History — so they cannot drift
 * apart: a round clock icon, the start time and the batch name at the same
 * size and both semibold (the primary pair), the end time at that size but
 * muted, and the batch code smaller and muted beside the batch name.
 *
 * The time line stays on one row from `@xl` up; in a narrower (mobile) table it
 * may wrap between the start and end time, never inside either. The batch name
 * may wrap too. Sized for a table's own width via container-query
 * variants (`@xl:`), so the enclosing wrapper must be an `@container`.
 */
export function SessionCell({ startTime, endTime, batchName, batchCode }) {
  return (
    <div className="flex items-center gap-2 @xl:gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand @xl:size-8"
      >
        <Clock className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="leading-tight @xl:whitespace-nowrap">
          <span className="text-body font-semibold whitespace-nowrap text-text-primary">
            {formatTime(startTime)}
          </span>{" "}
          <span className="text-body whitespace-nowrap text-text-secondary">– {formatTime(endTime)}</span>
        </p>
        <p className="leading-snug">
          <span className="text-body font-semibold text-text-primary">{batchName}</span>
          {batchCode ? <span className="text-small whitespace-nowrap text-text-secondary"> · {batchCode}</span> : null}
        </p>
      </div>
    </div>
  );
}

/**
 * Instructor avatar with name and a quiet "Instructor" label. With
 * `avatarOnlyWhenNarrow`, the text drops out below the table's `@xl` width
 * (mobile tables show the avatar alone) while the name stays available to
 * assistive tech.
 */
export function InstructorCell({ name, photoUrl, avatarOnlyWhenNarrow = false }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={name} src={photoUrl} size="sm" />
      <span className={cn("min-w-0", avatarOnlyWhenNarrow && "sr-only @xl:not-sr-only")}>
        <span className="block max-w-36 truncate text-small font-semibold text-text-primary" title={name || undefined}>
          {name || "—"}
        </span>
        <span className="block text-small text-text-secondary">Instructor</span>
      </span>
    </span>
  );
}
