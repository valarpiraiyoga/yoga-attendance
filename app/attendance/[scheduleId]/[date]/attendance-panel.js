"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { saveSessionAttendance } from "@/lib/attendance/actions";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import { todayInCentreTimezone } from "@/lib/class-sessions/validation";
import { cn } from "@/lib/utils";

function getInitials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function marksToMap(marks) {
  const map = {};
  for (const mark of marks) {
    map[mark.student_id] = mark.status;
  }
  return map;
}

/**
 * Session Details' Attendance tab — Take / View / Edit Attendance.
 * Behaviour unchanged; presentation prioritises fast scanning and clear
 * Present / Absent / Unmarked distinction.
 */
export default function AttendancePanel({ session, scheduleId, date, eligibleStudents, initialMarks }) {
  const today = todayInCentreTimezone();
  const isException = session.status === "cancelled" || session.status === "holiday";
  const isFuture = session.status === "scheduled" && session.session_date > today;
  const isCompleted = session.status === "completed";

  const [marks, setMarks] = useState(() => marksToMap(initialMarks ?? []));
  const [editing, setEditing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [savedMessage, setSavedMessage] = useState(null);
  const [isPending, startTransition] = useTransition();

  const summary = useMemo(
    () =>
      computeAttendanceSummary(
        eligibleStudents.length,
        Object.entries(marks).map(([, status]) => ({ status }))
      ),
    [marks, eligibleStudents.length]
  );

  if (isException) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-6 py-16 text-center">
        <p className="text-body max-w-sm text-text-secondary">
          This session is marked {session.status === "cancelled" ? "Cancelled" : "Holiday"}. Cancelled and
          Holiday sessions do not have attendance.
        </p>
      </div>
    );
  }

  if (isFuture) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-6 py-16 text-center">
        <p className="text-body max-w-sm text-text-secondary">
          Attendance cannot be taken until this session&rsquo;s date.
        </p>
      </div>
    );
  }

  const showControls = !isCompleted || editing;

  function setMark(studentId, status) {
    setSavedMessage(null);
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  }

  function markAllPresent() {
    setSavedMessage(null);
    setMarks((prev) => {
      const next = { ...prev };
      for (const student of eligibleStudents) {
        if (!next[student.id]) next[student.id] = "present";
      }
      return next;
    });
  }

  function runSave() {
    if (isCompleted && !reviewOpen) {
      return;
    }

    setFeedback(null);
    const payload = Object.entries(marks).map(([student_id, status]) => ({ student_id, status }));
    startTransition(async () => {
      const result = await saveSessionAttendance(scheduleId, date, payload);
      if (result?.error) {
        setFeedback(result.error);
        return;
      }
      setReviewOpen(false);
      setEditing(false);
      setSavedMessage("Attendance saved successfully.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SummaryStat label="Eligible" value={summary.eligibleCount} tone="info" />
        <SummaryStat label="Present" value={summary.presentCount} tone="success" />
        <SummaryStat label="Absent" value={summary.absentCount} tone="danger" />
        <SummaryStat label="Unmarked" value={summary.unmarkedCount} tone="warning" />
        <SummaryStat label="Attendance" value={`${summary.percentage}%`} tone="brand" />
      </div>

      {savedMessage ? (
        <p role="status" className="rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success">
          {savedMessage}
        </p>
      ) : null}
      {feedback ? (
        <p role="alert" className="rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-body text-danger">
          {feedback}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/40 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-text-secondary">
          <span className="font-medium text-text-primary">{eligibleStudents.length}</span> student
          {eligibleStudents.length === 1 ? "" : "s"} eligible for this session
        </p>
        <div className="flex flex-wrap gap-2">
          {isCompleted && !editing ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setSavedMessage(null);
                setEditing(true);
              }}
              disabled={isPending}
            >
              Edit Attendance
            </Button>
          ) : null}
          {showControls && eligibleStudents.length > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={markAllPresent} disabled={isPending}>
              Mark All Present
            </Button>
          ) : null}
          {showControls ? (
            isCompleted ? (
              <Button type="button" size="sm" onClick={() => setReviewOpen(true)} disabled={isPending}>
                Save Changes
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={runSave} disabled={isPending}>
                {isPending ? "Saving…" : "Save Attendance"}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {eligibleStudents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/40 px-6 py-16 text-center">
          <p className="text-body max-w-sm text-text-secondary">
            No students are eligible for this session. You can still save attendance to mark this session
            as completed.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border" aria-label="Attendance">
          {eligibleStudents.map((student) => {
            const status = marks[student.id];
            const rowTone =
              status === "present"
                ? "bg-success/5"
                : status === "absent"
                  ? "bg-danger/5"
                  : "bg-surface";

            return (
              <li
                key={student.id}
                className={cn(
                  "flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                  rowTone
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold text-brand"
                  >
                    {getInitials(student.full_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-text-primary">{student.full_name}</p>
                    <p className="text-small truncate text-text-secondary">
                      {student.student_code}
                      {student.phone ? ` · ${student.phone}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                  {showControls ? (
                    <div
                      role="group"
                      aria-label={`Attendance for ${student.full_name}`}
                      className="flex w-full gap-2 sm:w-auto"
                    >
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={status === "present"}
                        onClick={() => setMark(student.id, "present")}
                        disabled={isPending}
                        className={cn(
                          "h-10 flex-1 sm:min-w-24 sm:flex-none",
                          status === "present"
                            ? "border-success bg-success text-surface hover:bg-success/90 hover:text-surface"
                            : "border-border bg-surface text-text-secondary hover:border-success/40 hover:text-success"
                        )}
                        variant="outline"
                      >
                        Present
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={status === "absent"}
                        onClick={() => setMark(student.id, "absent")}
                        disabled={isPending}
                        className={cn(
                          "h-10 flex-1 sm:min-w-24 sm:flex-none",
                          status === "absent"
                            ? "border-danger bg-danger text-surface hover:bg-danger/90 hover:text-surface"
                            : "border-border bg-surface text-text-secondary hover:border-danger/40 hover:text-danger"
                        )}
                        variant="outline"
                      >
                        Absent
                      </Button>
                    </div>
                  ) : (
                    <Badge
                      variant={
                        status === "present" ? "success" : status === "absent" ? "danger" : "neutral"
                      }
                      className="rounded-full px-2.5 py-0.5"
                    >
                      <span className="text-[11px] leading-[14px] font-medium">
                        {status === "present" ? "Present" : status === "absent" ? "Absent" : "Unmarked"}
                      </span>
                    </Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title="Review attendance changes"
        description="This updates the saved attendance for this session. The recorded history for other sessions is unaffected."
        confirmLabel="Confirm & Save"
        isPending={isPending}
        onConfirm={runSave}
      >
        <dl className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 p-4">
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Present</dt>
            <dd className="text-body font-medium text-success">{summary.presentCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Absent</dt>
            <dd className="text-body font-medium text-danger">{summary.absentCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Unmarked</dt>
            <dd className="text-body font-medium text-warning">{summary.unmarkedCount}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  );
}

function SummaryStat({ label, value, tone }) {
  const tones = {
    brand: "border-brand/20 bg-brand/10",
    success: "border-success/20 bg-success/10",
    danger: "border-danger/20 bg-danger/10",
    warning: "border-warning/20 bg-warning/10",
    info: "border-info/20 bg-info/10",
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 shadow-xs ${tones[tone] ?? tones.brand}`}>
      <p className="text-[10px] leading-[14px] font-medium tracking-wide text-text-secondary uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-body font-semibold tracking-tight text-text-primary">{value}</p>
    </div>
  );
}
