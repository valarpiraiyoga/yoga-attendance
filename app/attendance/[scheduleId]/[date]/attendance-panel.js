"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { saveSessionAttendance } from "@/lib/attendance/actions";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import { todayInCentreTimezone } from "@/lib/class-sessions/validation";

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
 * Session Details' Attendance tab content (Phase 15 Slice 3 — Take
 * Attendance; approved wireframe: Attendance tab + Overview's Attendance
 * Summary card, both fed by this same component's data once wired in).
 * Not yet rendered anywhere (Step 1 of Slice 3) — this file only builds the
 * panel; `session-details-tabs.js` and `page.js` start passing it real data
 * in a later step.
 *
 * Reuses the existing Phase 15 foundation without adding anything new to
 * it: `eligibleStudents` is the same schedule-scoped list
 * `listEligibleStudents` (lib/attendance/data.js) already produces for the
 * Eligible Students tab, `initialMarks` is `getAttendanceForSession`'s
 * output verbatim, and the only write path is the existing
 * `saveSessionAttendance` server action — this component never talks to
 * Supabase directly and never re-derives eligibility or completion itself.
 *
 * `session.status` alone decides which of four modes renders (01-product.md
 * §7A/§8; approved Slice 3 decisions):
 * - `cancelled`/`holiday` → blocked, explanatory state, no controls (a
 *   Cancelled/Holiday session cannot accept attendance — `save_session_attendance`
 *   already rejects this server-side; this is the UI-level mirror of that
 *   rule so a doomed request is never attempted).
 * - `scheduled` with a future `session_date` → blocked, explanatory state,
 *   no controls (`save_session_attendance` already rejects a future date
 *   the same way).
 * - `scheduled` with `session_date <= today` → Take Attendance: eligible
 *   students with Present/Absent controls, defaulting unmarked.
 * - `completed` → read-only saved attendance by default, with an
 *   "Edit Attendance" affordance that unlocks the same controls, pre-filled
 *   from `initialMarks`.
 *
 * The first save (Take Attendance) writes directly on click, matching Flow
 * 01's lighter diagram (Mark All Present → Change Absent Students → Review
 * Summary → Save). Editing an already-completed session's attendance goes
 * through `ConfirmDialog`'s Review → Confirm → Save gate instead (Flow 08;
 * 02-ux.md's "Review Before Important Changes" — a correction to saved
 * history is treated more carefully than the first save), the same
 * two-stage pattern `mark-session.js` already uses for Cancel/Holiday.
 *
 * Zero eligible students does not block saving (approved decision): a
 * session with no one currently eligible can still be completed with an
 * empty marks array, matching `save_session_attendance`'s own unconditional
 * completion behavior.
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
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <p className="text-body max-w-sm text-text-secondary">
          This session is marked {session.status === "cancelled" ? "Cancelled" : "Holiday"}. Cancelled and
          Holiday sessions do not have attendance.
        </p>
      </div>
    );
  }

  if (isFuture) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
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

  // Only fills students with no mark yet — a student already set to Absent
  // is left alone, matching Flow 01's separate "Change Absent Students"
  // step (approved decision).
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
    // Enforced here, not just by which button happens to call this function:
    // a completed session's attendance may only be written while the
    // Review/Confirm dialog is open (approved requirement — a correction to
    // saved history always goes through Review → Confirm). The scheduled
    // session's first save is the one path allowed to call this directly,
    // with the dialog never opened at all.
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
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryStat label="Eligible" value={summary.eligibleCount} />
        <SummaryStat label="Present" value={summary.presentCount} />
        <SummaryStat label="Absent" value={summary.absentCount} />
        <SummaryStat label="Unmarked" value={summary.unmarkedCount} />
        <SummaryStat label="Attendance" value={`${summary.percentage}%`} />
      </div>

      {savedMessage ? (
        <p role="status" className="mb-4 text-body text-success">
          {savedMessage}
        </p>
      ) : null}
      {feedback ? (
        <p role="alert" className="mb-4 text-body text-danger">
          {feedback}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-text-secondary">
          {eligibleStudents.length} student{eligibleStudents.length === 1 ? "" : "s"} eligible for this
          session.
        </p>
        <div className="flex flex-wrap gap-2">
          {isCompleted && !editing ? (
            <Button
              type="button"
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
            <Button type="button" variant="outline" onClick={markAllPresent} disabled={isPending}>
              Mark All Present
            </Button>
          ) : null}
          {showControls ? (
            isCompleted ? (
              <Button type="button" onClick={() => setReviewOpen(true)} disabled={isPending}>
                Save Changes
              </Button>
            ) : (
              <Button type="button" onClick={runSave} disabled={isPending}>
                {isPending ? "Saving…" : "Save Attendance"}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {eligibleStudents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-body max-w-sm text-text-secondary">
            No students are eligible for this session. You can still save attendance to mark this session
            as completed.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <Table aria-label="Attendance">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligibleStudents.map((student) => {
                const status = marks[student.id];
                return (
                  <TableRow key={student.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-small font-medium text-brand"
                        >
                          {getInitials(student.full_name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-text-primary">{student.full_name}</p>
                          <p className="text-small text-text-secondary">{student.student_code}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-text-secondary">{student.phone}</TableCell>
                    <TableCell>
                      {showControls ? (
                        <div role="group" aria-label={`Attendance for ${student.full_name}`} className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={status === "present" ? "default" : "outline"}
                            aria-pressed={status === "present"}
                            onClick={() => setMark(student.id, "present")}
                            disabled={isPending}
                          >
                            Present
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={status === "absent" ? "destructive" : "outline"}
                            aria-pressed={status === "absent"}
                            onClick={() => setMark(student.id, "absent")}
                            disabled={isPending}
                          >
                            Absent
                          </Button>
                        </div>
                      ) : (
                        <Badge variant={status === "present" ? "success" : status === "absent" ? "danger" : "neutral"}>
                          {status === "present" ? "Present" : status === "absent" ? "Absent" : "Unmarked"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
            <dd className="text-body font-medium text-text-primary">{summary.presentCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Absent</dt>
            <dd className="text-body font-medium text-text-primary">{summary.absentCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-body text-text-secondary">Unmarked</dt>
            <dd className="text-body font-medium text-text-primary">{summary.unmarkedCount}</dd>
          </div>
        </dl>
      </ConfirmDialog>
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <p className="text-small font-medium tracking-wide text-text-secondary uppercase">{label}</p>
      <p className="mt-1 text-section-title font-semibold text-text-primary">{value}</p>
    </div>
  );
}
