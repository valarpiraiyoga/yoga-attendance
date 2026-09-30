"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import SearchInput from "@/components/ui/search-input";
import { Panel } from "@/components/layout/Panel";
import { MarkedProgress } from "@/app/attendance/[scheduleId]/[date]/attendance-panel";
import { cn } from "@/lib/utils";

const STATUS_BADGE = {
  present: { label: "Present", variant: "success" },
  absent: { label: "Absent", variant: "danger" },
};

const ROW_TONE = { present: "bg-success/5", absent: "bg-danger/5" };

// Same threshold as Take Attendance: search only earns its place on a long list.
const SEARCH_THRESHOLD = 8;

/**
 * Attendance Details roster, laid out like Take Attendance (`attendance-panel.js`):
 * a card of student rows — avatar, name (a link to the student), code, and the
 * recorded Present / Absent / Unmarked badge where the mark buttons sit on Take
 * Attendance — then a bottom bar with the same "n of N marked" progress and Edit
 * Attendance in the Save position. Read-only; attendance stores no per-student note.
 */
export default function AttendanceDetailsRoster({ students, marksByStudentId, summary, editHref }) {
  const [query, setQuery] = useState("");

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
      <Panel>
        {students.length === 0 ? (
          <EmptyState size="sm" title="No eligible students" description="No students were eligible for this session." />
        ) : (
          <>
            {showSearch ? (
              <div className="mb-3">
                <SearchInput
                  id="attendance-details-search"
                  label="Search students"
                  type="search"
                  placeholder="Search students"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery("")}
                  className="w-full sm:max-w-xs"
                />
              </div>
            ) : null}

            {visibleStudents.length === 0 ? (
              <EmptyState size="sm" title="No students found" description="No students match your search." />
            ) : (
              <ul aria-label="Student attendance" className="flex flex-col gap-1">
                {visibleStudents.map((student) => {
                  const status = marksByStudentId[student.id];
                  const badge = STATUS_BADGE[status] ?? { label: "Unmarked", variant: "neutral" };

                  return (
                    <li key={student.id} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5", ROW_TONE[status])}>
                      <Avatar name={student.full_name} size="sm" className="hidden shrink-0 sm:flex" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/students/${student.id}`}
                          className="font-semibold break-words text-text-primary hover:text-brand hover:underline"
                        >
                          {student.full_name}
                        </Link>
                        <p className="text-small truncate text-text-secondary">{student.student_code}</p>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Panel>

      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3 shadow-md sm:flex-row sm:items-center sm:gap-6 sm:p-4">
        <div className="min-w-0 flex-1">
          <MarkedProgress summary={summary} />
        </div>
        <Button render={<Link href={editHref} />} nativeButton={false} className="sm:shrink-0">
          Edit Attendance
        </Button>
      </div>
    </div>
  );
}
