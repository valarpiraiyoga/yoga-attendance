"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import EmptyState from "@/components/ui/empty-state";
import MarkButton from "@/components/ui/mark-button";
import SearchInput from "@/components/ui/search-input";
import { Panel } from "@/components/layout/Panel";
import SessionContext, { sessionContextOf } from "@/app/attendance/session-context";
import { saveSessionAttendance } from "@/lib/attendance/actions";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import { cn } from "@/lib/utils";

function marksToMap(marks) {
  const map = {};
  for (const mark of marks) {
    map[mark.student_id] = mark.status;
  }
  return map;
}

const STATUS_BADGE = {
  present: { label: "Present", variant: "success" },
  absent: { label: "Absent", variant: "danger" },
};

const ROW_TONE = { present: "bg-success/5", absent: "bg-danger/5" };

// Search only earns its place on a long list; a small class is scanned by eye.
const SEARCH_THRESHOLD = 8;

/** Present / Absent counts with their colour dots (colour is never the only cue: the words are there too). */
function CountsLine({ summary }) {
  return (
    <p className="text-small flex flex-wrap items-center gap-x-4 gap-y-1 text-text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-success" />
        <span className="font-medium text-text-primary tabular-nums">{summary.presentCount}</span> Present
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
        <span className="font-medium text-text-primary tabular-nums">{summary.absentCount}</span> Absent
      </span>
    </p>
  );
}

/** "n of N marked" over a two-part bar (Present green, Absent red): the whole session's progress at a glance. */
function MarkedProgress({ summary }) {
  const total = summary.eligibleCount;
  const marked = summary.presentCount + summary.absentCount;
  const percent = (count) => (total > 0 ? (count / total) * 100 : 0);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-body text-text-secondary">
          <span className="font-semibold text-text-primary tabular-nums">{marked}</span> of {total} marked
        </p>
        <CountsLine summary={summary} />
      </div>
      <div
        role="progressbar"
        aria-label="Students marked"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={marked}
        className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div className="bg-success" style={{ width: `${percent(summary.presentCount)}%` }} />
        <div className="bg-danger" style={{ width: `${percent(summary.absentCount)}%` }} />
      </div>
    </div>
  );
}

/**
 * The Take / View / Edit Attendance view: a card of students, one row each with a
 * Present | Absent toggle (Mark All Present, and a search field only on a long
 * list), and a save bar that stays at the bottom of the screen with the progress
 * ("n of N marked", Present and Absent counts) beside Cancel / Save. Behaviour is
 * unchanged: the same marks state, Mark All Present, `saveSessionAttendance`, and
 * the review dialog before a completed session's marks are changed. The session's
 * own one-line summary is rendered above by `session-header.js`.
 *
 * The attendance data model stores only Present / Absent per student
 * (0011_attendance.sql), so there is no per-student note field and no
 * notification option here.
 */
export default function AttendancePanel({ session, scheduleId, date, eligibleStudents, initialMarks, today }) {
  const isException = session.status === "cancelled" || session.status === "holiday";
  const isFuture = session.status === "scheduled" && session.session_date > today;
  const isCompleted = session.status === "completed";

  const [marks, setMarks] = useState(() => marksToMap(initialMarks ?? []));
  const [editing, setEditing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  if (isException || isFuture) {
    return (
      <Panel>
        <EmptyState
          size="sm"
          title={isException ? "No attendance for this session" : "Attendance is not open yet"}
          description={
            isException
              ? `This session is marked ${session.status === "cancelled" ? "Cancelled" : "Holiday"}. Cancelled and Holiday sessions do not have attendance.`
              : "Attendance cannot be taken until this session’s date."
          }
        />
      </Panel>
    );
  }

  const showControls = !isCompleted || editing;
  const normalizedQuery = query.trim().toLowerCase();
  const showSearch = eligibleStudents.length > SEARCH_THRESHOLD;
  const visibleStudents = eligibleStudents
    .map((student) => ({ student }))
    .filter(
      ({ student }) =>
        !normalizedQuery ||
        [student.full_name, student.student_code, student.phone].some((value) =>
          String(value ?? "").toLowerCase().includes(normalizedQuery)
        )
    );

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

  /** Cancel while editing a completed session: drop the unsaved changes. */
  function cancelEditing() {
    setMarks(marksToMap(initialMarks ?? []));
    setFeedback(null);
    setEditing(false);
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

      <Panel>
        {eligibleStudents.length === 0 ? (
          <EmptyState
            size="sm"
            title="No eligible students"
            description="No students are eligible for this session. You can still save attendance to mark this session as completed."
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {showSearch ? (
                <SearchInput
                  id="take-attendance-search"
                  label="Search students"
                  type="search"
                  placeholder="Search students"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery("")}
                  className="w-full sm:max-w-xs"
                />
              ) : null}
              {showControls ? null : <CountsLine summary={summary} />}
              <div className={cn("flex flex-wrap gap-2", showSearch && "sm:ml-auto")}>
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
                {showControls ? (
                  <Button type="button" variant="outline" onClick={markAllPresent} disabled={isPending}>
                    Mark All Present
                  </Button>
                ) : null}
              </div>
            </div>

            {visibleStudents.length === 0 ? (
              <EmptyState size="sm" title="No students found" description="No students match your search." />
            ) : (
              <ul aria-label="Student attendance" className="flex flex-col gap-1">
                {visibleStudents.map(({ student }) => {
                  const status = marks[student.id];
                  const badge = STATUS_BADGE[status] ?? { label: "Unmarked", variant: "neutral" };

                  return (
                    <li
                      key={student.id}
                      className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5", ROW_TONE[status])}
                    >
                      {/* The avatar is dropped on a phone so the two buttons keep their room. */}
                      <Avatar name={student.full_name} size="sm" className="hidden shrink-0 sm:flex" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-words text-text-primary">{student.full_name}</p>
                        <p className="text-small truncate text-text-secondary">{student.student_code}</p>
                      </div>
                      {showControls ? (
                        <div role="group" aria-label={`Attendance for ${student.full_name}`} className="flex shrink-0 gap-2">
                          <MarkButton
                            status="present"
                            selected={status === "present"}
                            studentName={student.full_name}
                            disabled={isPending}
                            className="h-10 sm:h-9"
                            onSelect={() => setMark(student.id, "present")}
                          />
                          <MarkButton
                            status="absent"
                            selected={status === "absent"}
                            studentName={student.full_name}
                            disabled={isPending}
                            className="h-10 sm:h-9"
                            onSelect={() => setMark(student.id, "absent")}
                          />
                        </div>
                      ) : (
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Panel>

      {showControls ? (
        <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-card border border-border bg-surface p-3 shadow-md sm:flex-row sm:items-center sm:gap-6 sm:p-4">
          <div className="min-w-0 flex-1">
            <MarkedProgress summary={summary} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:shrink-0 sm:items-center">
            {isCompleted ? (
              <Button type="button" variant="outline" onClick={cancelEditing} disabled={isPending}>
                Cancel
              </Button>
            ) : (
              <Button variant="outline" render={<Link href="/attendance" />} nativeButton={false}>
                Cancel
              </Button>
            )}
            {isCompleted ? (
              <Button type="button" onClick={() => setReviewOpen(true)} disabled={isPending}>
                Save Changes
              </Button>
            ) : (
              <Button type="button" onClick={runSave} disabled={isPending}>
                {isPending ? "Saving…" : "Save Attendance"}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title="Review attendance changes"
        context={<SessionContext context={sessionContextOf(session)} />}
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
