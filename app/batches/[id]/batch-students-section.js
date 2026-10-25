"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Eye, MoreVertical, Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import SearchInput from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatTimeRange } from "@/lib/format";
import { groupStudentsBySession, instructorCountLabel, NO_SESSION_KEY, studentCountLabel } from "@/lib/batches/students-by-session";
import { TIME_RANGE_CHIPS, timeRangeKey, timeRangeSlots } from "@/lib/enrollments/schedule-picker-core";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { value: "all", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const COLUMNS = 6;

/** The Student, Instructor, Status, Phone and Actions cells of one row (the `#` and the session block are laid out by the caller). */
function RowCells({ row, number }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { enrollment } = row;
  const student = enrollment.students;
  const name = student?.full_name ?? "Unknown student";
  const status = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;
  const studentHref = student?.id ? `/students/${student.id}` : null;
  const editHref = `/students/${enrollment.student_id}/enrollments/${enrollment.id}/edit`;

  return (
    <>
      <TableCell className={cn("w-10 text-text-secondary tabular-nums", menuOpen && "bg-brand/5")}>{number}</TableCell>
      <TableCell className={cn(menuOpen && "bg-brand/5")}>
        <span className="flex items-center gap-3">
          <Avatar name={name} src={student?.photo_url} size="md" className="shrink-0" />
          <span className="min-w-0">
            {studentHref ? (
              <Link href={studentHref} className="block truncate font-semibold text-brand hover:underline">
                {name}
              </Link>
            ) : (
              <span className="block truncate font-semibold text-text-primary">{name}</span>
            )}
            <span className="text-small block text-text-secondary">{student?.student_code ?? "—"}</span>
          </span>
        </span>
      </TableCell>
      <TableCell className={cn("hidden md:table-cell", menuOpen && "bg-brand/5")}>
        {row.instructor ? (
          <span className="flex items-center gap-2.5">
            <Avatar name={row.instructor.full_name} src={row.instructor.photo_url} size="md" className="shrink-0" />
            <span className="text-body font-medium text-text-primary">{row.instructor.full_name}</span>
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </TableCell>
      <TableCell className={cn(menuOpen && "bg-brand/5")}>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className={cn("hidden whitespace-nowrap text-text-secondary lg:table-cell", menuOpen && "bg-brand/5")}>{student?.phone ?? "—"}</TableCell>
      <TableCell className={cn("w-px", menuOpen && "bg-brand/5")}>
        <span className="flex items-center justify-end gap-1">
          {studentHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`View student ${name}`}
              render={<Link href={studentHref} />}
              nativeButton={false}
            >
              <Eye className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
          <DropdownMenu onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-brand hover:bg-brand/10 hover:text-brand"
                  aria-label={`Student actions for ${name}`}
                />
              }
            >
              <MoreVertical className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {studentHref ? (
                <DropdownMenuItem render={<Link href={studentHref} />} nativeButton={false}>
                  View Student
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem render={<Link href={editHref} />} nativeButton={false}>
                Edit Enrollment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </TableCell>
    </>
  );
}

/** One student row: its own component so each row keeps its own open-menu tint. */
function StudentRow({ row, number, sessionCell }) {
  return (
    <TableRow className="border-border/60">
      {sessionCell}
      <RowCells row={row} number={number} />
    </TableRow>
  );
}

/**
 * Batch Details → Students on the Overview: the batch's students grouped by SESSION - each time slot of the batch's current schedules is a tinted
 * block (the time, "N students", "N instructors" and a chevron that collapses the group) spanning that slot's rows; a row is the number, the
 * student (photo, name as a link, Student ID), the slot's instructor, the enrollment's status, the phone and the View / menu actions (both existing
 * routes). A student in two sessions appears under each; one with no current session is listed last under "No session". Search (name, Student
 * ID, phone) and a Status filter narrow the rows on screen only. The chevron at the right of the header collapses the whole section; the body is
 * only hidden, so the search, the filter and the collapsed groups keep their state. Add Student opens the existing Add Student flow.
 *
 * @param {object} props
 * @param {object[]} props.enrollments
 * @param {number} props.activeCount
 * @param {object[]|null} props.assignments - the enrollments' CURRENT schedule assignments, or null when they could not be read.
 * @param {object[]} props.schedules - the batch's current schedules (the series each assignment points at).
 */
export default function BatchStudentsSection({ enrollments, activeCount, assignments = null, schedules = [] }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const bodyId = useId();

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return enrollments.filter((enrollment) => {
      if (status !== "all" && enrollment.status !== status) return false;
      if (!term) return true;
      const student = enrollment.students;
      return [student?.full_name, student?.student_code, student?.phone].some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [enrollments, q, status]);

  const groups = useMemo(() => groupStudentsBySession({ enrollments: visible, assignments, schedules }), [visible, assignments, schedules]);
  // The same colour for the same time range as everywhere else (Weekly Schedule, the enrollment picker).
  const tones = useMemo(() => timeRangeSlots(schedules, TIME_RANGE_CHIPS.length), [schedules]);

  function toggleGroup(key) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  let number = 0;

  return (
    <Panel aria-label="Students" className="min-w-0">
      <PanelHeader
        icon={Users}
        tone="brand"
        title={`Active Students (${activeCount})`}
        description="Students enrolled in this batch, grouped by session and instructor."
        className="mb-4 flex-col items-start lg:flex-row lg:items-center"
        action={
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
            <div className="min-w-48 flex-1 lg:w-64 lg:flex-none">
              <SearchInput
                label="Search students"
                type="search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onClear={() => setQ("")}
                placeholder="Search by name, ID or phone..."
                inputClassName="h-9 bg-surface"
              />
            </div>
            <Select items={STATUS_FILTERS} value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Filter by status" className="w-36 bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" render={<Link href="/students/new" />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Student
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={open ? "Collapse students" : "Expand students"}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
            </Button>
          </div>
        }
      />

      <div id={bodyId} hidden={!open}>
        {enrollments.length === 0 ? (
          <EmptyState size="compact" title="No students enrolled" description="No students are enrolled in this batch yet." />
        ) : visible.length === 0 ? (
          <EmptyState
            size="compact"
            title="No students match"
            description="Try a different search or status."
            action={
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                }}
              >
                Clear Filters
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <Table aria-label="Students in this batch" className="min-w-[40rem] [&_td]:py-2.5 [&_td]:align-middle [&_th]:h-10">
              <TableHeader>
                <TableRow className="bg-brand/5 hover:bg-brand/5">
                  <TableHead className="w-56 pl-4">Time / Session</TableHead>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden md:table-cell">Instructor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Phone</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              {groups.map((group, groupIndex) => {
                const isCollapsed = collapsed.has(group.key);
                const hasSession = group.key !== NO_SESSION_KEY;
                const tone = hasSession ? TIME_RANGE_CHIPS[tones.get(timeRangeKey({ start_time: group.startTime, end_time: group.endTime })) ?? 0] : "bg-neutral/15 text-text-secondary";
                const label = hasSession ? formatTimeRange(group.startTime, group.endTime) : "No session";
                const rowCount = isCollapsed ? 1 : group.rows.length;

                const sessionCell = (
                  // `h-px` gives the spanning cell a definite height, so the tinted block's `h-full` fills every row it spans
                  // instead of shrinking to its text (a percentage height has nothing to resolve against in an auto-height cell).
                  <TableCell rowSpan={rowCount} className="h-px p-1.5 pl-3 align-middle">
                    <div className={cn("flex h-full min-h-16 items-center gap-2 rounded-lg px-3 py-2", tone)}>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="shrink-0 bg-surface text-text-primary"
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
                        onClick={() => toggleGroup(group.key)}
                      >
                        {isCollapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                      </Button>
                      <div className="min-w-0">
                        <p className="text-small font-semibold whitespace-nowrap tabular-nums">{label}</p>
                        <p className="text-small opacity-80">{studentCountLabel(group.studentCount)}</p>
                        {hasSession ? <p className="text-small opacity-80">{instructorCountLabel(group.instructorCount)}</p> : null}
                      </div>
                    </div>
                  </TableCell>
                );

                return (
                  <TableBody key={group.key} className={cn(groupIndex > 0 && "border-t-2 border-border")}>
                    {isCollapsed ? (
                      <TableRow className="border-border/60">
                        {sessionCell}
                        <TableCell colSpan={COLUMNS} className="text-small text-text-secondary">
                          {studentCountLabel(group.studentCount)} hidden - expand the session to see them.
                        </TableCell>
                      </TableRow>
                    ) : (
                      group.rows.map((row, rowIndex) => {
                        number += 1;
                        return <StudentRow key={row.key} row={row} number={number} sessionCell={rowIndex === 0 ? sessionCell : null} />;
                      })
                    )}
                  </TableBody>
                );
              })}
            </Table>
          </div>
        )}
      </div>
    </Panel>
  );
}
