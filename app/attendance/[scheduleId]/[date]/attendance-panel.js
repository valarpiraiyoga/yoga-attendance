"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, CircleMinus, CircleX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import EmptyState from "@/components/ui/empty-state";
import MarkButton from "@/components/ui/mark-button";
import SearchInput from "@/components/ui/search-input";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { saveSessionAttendance } from "@/lib/attendance/actions";
import { computeAttendanceSummary } from "@/lib/attendance/validation";
import { formatDate } from "@/lib/format";
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

const ROW_TONE = { present: "bg-success/5 hover:bg-success/5", absent: "bg-danger/5 hover:bg-danger/5" };

/**
 * Session Details' Attendance tab — the Take / View / Edit Attendance view:
 * the four attendance StatTiles, the students panel (search, Present / Absent
 * per student) and the save area. Behaviour is unchanged — the same marks
 * state, Mark All Present, `saveSessionAttendance`, and the review dialog
 * before a completed session's marks are changed. The session's own header
 * and summary panel are rendered above by `session-header.js`.
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
  const visibleStudents = eligibleStudents
    .map((student, index) => ({ student, position: index + 1 }))
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
    <div className="flex flex-col gap-6">
      <StatTileGroup ariaLabel="Attendance summary">
        <StatTile icon={Users} label="Eligible" value={summary.eligibleCount} tone="brand" />
        <StatTile icon={CircleCheck} label="Present" value={summary.presentCount} tone="success" />
        <StatTile icon={CircleX} label="Absent" value={summary.absentCount} tone="danger" />
        <StatTile icon={CircleMinus} label="Unmarked" value={summary.unmarkedCount} tone="warning" />
      </StatTileGroup>

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
        <PanelHeader
          icon={Users}
          title={`Students (${eligibleStudents.length})`}
          description={showControls ? "Mark each student as Present or Absent." : "Attendance recorded for each student."}
          className="mb-4 min-h-8"
        />

        {eligibleStudents.length === 0 ? (
          <EmptyState
            size="sm"
            title="No eligible students"
            description="No students are eligible for this session. You can still save attendance to mark this session as completed."
          />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchInput
                id="take-attendance-search"
                label="Search students"
                type="search"
                placeholder="Search students"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery("")}
                className="sm:max-w-xs"
              />
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
              <div className="overflow-hidden rounded-lg border border-border">
                <Table aria-label="Student attendance">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="hidden w-12 sm:table-cell">#</TableHead>
                      <TableHead className="px-3 whitespace-nowrap sm:px-5">Student</TableHead>
                      <TableHead className="hidden whitespace-nowrap sm:table-cell">Membership</TableHead>
                      <TableHead className="px-3 whitespace-nowrap sm:px-5">Attendance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleStudents.map(({ student, position }) => {
                      const status = marks[student.id];
                      const badge = STATUS_BADGE[status] ?? { label: "Unmarked", variant: "neutral" };

                      return (
                        <TableRow key={student.id} className={cn(ROW_TONE[status])}>
                          <TableCell className="hidden tabular-nums text-text-secondary sm:table-cell">{position}</TableCell>
                          <TableCell className="px-3 sm:px-5">
                            {/* Below `sm` the avatar and phone are dropped and the membership shows only its
                                end date under the name, so the Present / Absent controls stay on screen
                                without sideways scrolling. */}
                            <div className="flex items-center gap-3 sm:whitespace-nowrap">
                              <Avatar name={student.full_name} size="sm" className="hidden shrink-0 sm:flex" />
                              <div className="min-w-0">
                                <p className="font-semibold text-text-primary">{student.full_name}</p>
                                <p className="text-small text-text-secondary sm:whitespace-nowrap">
                                  {student.student_code}
                                  {student.phone ? <span className="hidden sm:inline"> · {student.phone}</span> : null}
                                </p>
                                <p className="text-small text-text-secondary sm:hidden">
                                  Until {formatDate(student.membership?.end_date)}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-text-secondary sm:table-cell">
                            {formatDate(student.membership?.start_date)} – {formatDate(student.membership?.end_date)}
                          </TableCell>
                          <TableCell className="px-3 sm:px-5">
                            {showControls ? (
                              <div role="group" aria-label={`Attendance for ${student.full_name}`} className="flex gap-2">
                                <MarkButton
                                  status="present"
                                  selected={status === "present"}
                                  studentName={student.full_name}
                                  disabled={isPending}
                                  onSelect={() => setMark(student.id, "present")}
                                />
                                <MarkButton
                                  status="absent"
                                  selected={status === "absent"}
                                  studentName={student.full_name}
                                  disabled={isPending}
                                  onSelect={() => setMark(student.id, "absent")}
                                />
                              </div>
                            ) : (
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Panel>

      {showControls ? (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-small text-text-secondary">
            <span className="font-medium text-text-primary">{summary.presentCount + summary.absentCount}</span> of{" "}
            {summary.eligibleCount} students marked
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
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
