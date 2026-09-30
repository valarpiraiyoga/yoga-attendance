"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import MarkButton from "@/components/ui/mark-button";
import SearchInput from "@/components/ui/search-input";
import { Panel } from "@/components/layout/Panel";
import { MarkedProgress } from "@/app/attendance/[scheduleId]/[date]/attendance-panel";
import { computeAttendanceSummary, validateAttendanceMarks } from "@/lib/attendance/validation";
import { cn } from "@/lib/utils";

const ROW_TONE = { present: "bg-success/5", absent: "bg-danger/5" };

// Same threshold as Take Attendance: search only earns its place on a long list.
const SEARCH_THRESHOLD = 8;

export function pendingReviewStorageKey(scheduleId, date) {
  return `attendance-history:pending-review:${scheduleId}:${date}`;
}

function marksToMap(marks) {
  const map = {};
  for (const mark of marks) {
    map[mark.student_id] = mark.status;
  }
  return map;
}

/**
 * Edit Attendance roster, laid out like Take Attendance (`attendance-panel.js`): a
 * card of student rows with the shared Present | Absent `MarkButton`s, Mark All
 * Present (fills only unmarked students) and a search field on a long list, then
 * a bottom bar with the "n of N marked" progress beside Cancel / Review Changes.
 * Nothing is saved here; Review Changes hands off via sessionStorage.
 */
export default function EditAttendanceForm({ scheduleId, date, students, initialMarks }) {
  const router = useRouter();
  const [marks, setMarks] = useState(() => marksToMap(initialMarks ?? []));
  const [query, setQuery] = useState("");
  const [error, setError] = useState(null);

  const summary = computeAttendanceSummary(
    students.length,
    Object.values(marks).map((status) => ({ status }))
  );

  function setMark(studentId, status) {
    setError(null);
    setMarks((prev) => ({ ...prev, [studentId]: status }));
  }

  function markAllPresent() {
    setError(null);
    setMarks((prev) => {
      const next = { ...prev };
      for (const student of students) {
        if (!next[student.id]) next[student.id] = "present";
      }
      return next;
    });
  }

  function handleReviewChanges() {
    const payload = Object.entries(marks).map(([student_id, status]) => ({ student_id, status }));
    const result = validateAttendanceMarks(payload);

    if (!result.success) {
      setError(result.error);
      return;
    }

    try {
      window.sessionStorage.setItem(
        pendingReviewStorageKey(scheduleId, date),
        JSON.stringify({ marks: result.data })
      );
    } catch {
      // Private browsing / storage disabled — still navigate; Review handles missing draft.
    }

    router.push(`/attendance-history/${scheduleId}/${date}/review`);
  }

  const detailsHref = `/attendance-history/${scheduleId}/${date}`;

  if (students.length === 0) {
    return (
      <Panel>
        <EmptyState size="sm" title="No eligible students" description="No students were eligible for this session." />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" render={<Link href={detailsHref} />} nativeButton={false}>
            Cancel
          </Button>
        </div>
      </Panel>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const showSearch = students.length > SEARCH_THRESHOLD;
  const visibleStudents = students.filter(
    (student) =>
      !normalizedQuery ||
      [student.full_name, student.student_code, student.phone].some((value) =>
        String(value ?? "").toLowerCase().includes(normalizedQuery)
      )
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-body text-danger">
          {error}
        </p>
      ) : null}

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {showSearch ? (
            <SearchInput
              id="edit-attendance-search"
              label="Search students"
              type="search"
              placeholder="Search students"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              className="w-full sm:max-w-xs"
            />
          ) : null}
          <div className={cn("flex flex-wrap gap-2", showSearch && "sm:ml-auto")}>
            <Button type="button" variant="outline" onClick={markAllPresent}>
              Mark All Present
            </Button>
          </div>
        </div>

        {visibleStudents.length === 0 ? (
          <EmptyState size="sm" title="No students found" description="No students match your search." />
        ) : (
          <ul aria-label="Edit Attendance" className="flex flex-col gap-1">
            {visibleStudents.map((student) => {
              const status = marks[student.id];

              return (
                <li key={student.id} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5", ROW_TONE[status])}>
                  {/* The avatar is dropped on a phone so the two buttons keep their room. */}
                  <Avatar name={student.full_name} size="sm" className="hidden shrink-0 sm:flex" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words text-text-primary">{student.full_name}</p>
                    <p className="text-small truncate text-text-secondary">{student.student_code}</p>
                  </div>
                  <div role="group" aria-label={`Attendance for ${student.full_name}`} className="flex shrink-0 gap-2">
                    <MarkButton
                      status="present"
                      selected={status === "present"}
                      studentName={student.full_name}
                      className="h-10 sm:h-9"
                      onSelect={() => setMark(student.id, "present")}
                    />
                    <MarkButton
                      status="absent"
                      selected={status === "absent"}
                      studentName={student.full_name}
                      className="h-10 sm:h-9"
                      onSelect={() => setMark(student.id, "absent")}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-card border border-border bg-surface p-3 shadow-md sm:flex-row sm:items-center sm:gap-6 sm:p-4">
        <div className="min-w-0 flex-1">
          <MarkedProgress summary={summary} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:shrink-0 sm:items-center">
          <Button variant="outline" render={<Link href={detailsHref} />} nativeButton={false}>
            Cancel
          </Button>
          <Button type="button" onClick={handleReviewChanges}>
            Review Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
