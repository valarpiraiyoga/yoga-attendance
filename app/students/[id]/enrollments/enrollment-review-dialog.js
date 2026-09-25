"use client";

import { CalendarDays, CalendarX2, Clock, Info, Layers, UserRound } from "lucide-react";
import ReviewDialog, { ReviewRow } from "@/components/ui/review-dialog";
import StudentContext from "@/components/ui/student-context";
import { getBatchColor } from "@/lib/batches/identity";
import { formatTime } from "@/lib/format";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { cn } from "@/lib/utils";

// Each weekday gets one stable accent from the existing Batch Identity palette, so a day chip
// reads the same everywhere and no new colours are introduced.
const DAY_COLOR = {
  monday: "teal",
  tuesday: "amber",
  wednesday: "blue",
  thursday: "green",
  friday: "purple",
  saturday: "pink",
  sunday: "orange",
};

/** One schedule as a row: day chip, time range, instructor. */
function ScheduleLine({ schedule }) {
  const day = schedule?.day_of_week;
  const color = getBatchColor(DAY_COLOR[day]);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-body">
      <span className={cn("inline-flex w-12 justify-center rounded-md px-2 py-1 text-small font-medium", color.tile)}>
        {(DAY_LABELS[day] ?? day ?? "—").slice(0, 3)}
      </span>
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-text-primary">
        <Clock className="size-4 text-text-secondary" aria-hidden="true" />
        {formatTime(schedule?.start_time)} – {formatTime(schedule?.end_time)}
      </span>
      <span className="inline-flex min-w-0 items-center gap-2 text-text-primary">
        <UserRound className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 truncate">{schedule?.instructors?.full_name ?? "—"}</span>
      </span>
    </li>
  );
}

function ScheduleList({ schedules, label }) {
  return (
    <ul aria-label={label} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {schedules.map((schedule, index) => (
        <ScheduleLine key={schedule.series_id ?? schedule.id ?? `${schedule.day_of_week}-${index}`} schedule={schedule} />
      ))}
    </ul>
  );
}

/**
 * The "Review enrollment" step shown when Save Enrollment is chosen (Review ->
 * Confirm -> Save, 02-ux.md Flow 10), in the shared `ReviewDialog` shell: the
 * enrollment's details (Batch, Start date, End date), then the Schedules as day /
 * time / instructor rows.
 *
 * When an existing enrollment's schedules are being changed, the same rows are
 * repeated under "Adding" and "Ending" with the change's effective date, and the
 * enrollment's Status is shown - all the facts the review has always stated.
 *
 * Controlled by the form (`open` / `onOpenChange`); confirming runs the form's
 * own submit (`onConfirm`), so nothing here saves anything.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {{ full_name: string, student_code?: string, photo_url?: string|null }} [props.student] - who the enrollment is for.
 * @param {object|null} props.review - the form's review data.
 * @param {boolean} props.isEdit - editing an existing enrollment (shows Status).
 * @param {boolean} props.isActive
 * @param {boolean} props.isPending
 * @param {() => void} props.onConfirm
 */
export default function EnrollmentReviewDialog({ open, onOpenChange, student, review, isEdit, isActive, isPending, onConfirm }) {
  return (
    <ReviewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Review enrollment"
      context={<StudentContext student={student} />}
      description="Confirm these details before saving. This applies only to this enrollment and does not affect past attendance."
      isPending={isPending}
      onConfirm={onConfirm}
    >
      {review ? (
        <>
          <dl className="flex flex-col gap-3">
            <ReviewRow icon={Layers} label="Batch">
              {review.batchName}
            </ReviewRow>
            <ReviewRow icon={CalendarDays} label="Start date">
              {review.startDate}
            </ReviewRow>
            <ReviewRow icon={CalendarX2} label="End date">
              {review.endDate || "No end date"}
            </ReviewRow>
            {review.scheduleEffectiveDate ? (
              <ReviewRow icon={CalendarDays} label="Schedule change effective">
                {review.scheduleEffectiveDate}
              </ReviewRow>
            ) : null}
            {isEdit ? (
              <ReviewRow icon={Info} label="Status">
                {isActive ? "Active" : "Inactive"}
              </ReviewRow>
            ) : null}
          </dl>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="flex items-center gap-3 text-body text-text-secondary">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              Schedules
            </p>
            <ScheduleList schedules={review.selectedSchedules} label="Schedules" />

            {review.addedSchedules.length > 0 ? (
              <>
                <p className="text-body font-medium text-success">Adding</p>
                <ScheduleList schedules={review.addedSchedules} label="Schedules being added" />
              </>
            ) : null}
            {review.removedAssignments.length > 0 ? (
              <>
                <p className="text-body font-medium text-danger">Ending</p>
                <ScheduleList
                  schedules={review.removedAssignments.map((assignment) => assignment.schedule)}
                  label="Schedules being ended"
                />
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </ReviewDialog>
  );
}
