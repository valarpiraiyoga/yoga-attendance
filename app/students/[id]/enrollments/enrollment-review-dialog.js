"use client";

import { CalendarDays, CalendarX2, Info, Layers } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import ReviewDialog, { ReviewRow } from "@/components/ui/review-dialog";
import StudentContext from "@/components/ui/student-context";
import { formatTimeRange } from "@/lib/format";
import { DAY_LABELS } from "@/lib/schedules/validation";
import { groupSchedulesByTimeSlot, instructorCountLabel, SLOT_TONES } from "@/lib/students/enrollment-schedule-groups";

/**
 * Schedules grouped by time slot, as Student Details' Batch Enrollments lists them: each distinct time slot is one tinted block (the time and
 * "N instructors") spanning that slot's instructor rows; each instructor is a row (photo, name) with the days they teach that slot as chips.
 * Presentation only - `groupSchedulesByTimeSlot` groups the schedules the review already holds.
 */
function ScheduleList({ schedules, label }) {
  const groups = groupSchedulesByTimeSlot(schedules.map((schedule) => ({ schedule })));

  return (
    <ul aria-label={label} className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {groups.map((group, groupIndex) => (
        <li key={group.key} className="flex items-stretch gap-2 p-1.5">
          <div
            className={`flex w-32 shrink-0 flex-col items-center justify-center rounded-lg px-2 py-2 text-center sm:w-36 ${SLOT_TONES[groupIndex % SLOT_TONES.length]}`}
          >
            <span className="text-small leading-5 font-semibold whitespace-nowrap tabular-nums">{formatTimeRange(group.startTime, group.endTime)}</span>
            <span className="text-small opacity-80">{instructorCountLabel(group.instructorCount)}</span>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col divide-y divide-border/60">
            {group.rows.map((row) => (
              <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 py-2 first:pt-1 last:pb-1">
                <span className="flex min-w-0 items-center gap-2 text-body text-text-primary">
                  {row.instructor ? (
                    <>
                      <Avatar name={row.instructor.full_name} src={row.instructor.photo_url} size="sm" className="shrink-0" />
                      <span className="min-w-0 truncate">{row.instructor.full_name}</span>
                    </>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                </span>
                <ul className="flex flex-wrap gap-1.5">
                  {row.days.map((day) => (
                    <li key={day} className="text-small rounded-md border border-border bg-brand/5 px-2 py-0.5 font-medium text-text-primary">
                      {(DAY_LABELS[day] ?? day).slice(0, 3)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </li>
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
