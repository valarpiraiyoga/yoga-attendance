"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Eye, MoreVertical, Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EmptyState from "@/components/ui/empty-state";
import SearchInput from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { ENTITY_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { value: "all", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

function StudentRow({ enrollment, number }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const student = enrollment.students;
  const name = student?.full_name ?? "Unknown student";
  const status = ENTITY_STATUS[enrollment.status] ?? ENTITY_STATUS.inactive;
  const studentHref = student?.id ? `/students/${student.id}` : null;
  const editHref = `/students/${enrollment.student_id}/enrollments/${enrollment.id}/edit`;

  return (
    <TableRow className={cn(menuOpen && "bg-brand/5")}>
      <TableCell className="w-10 text-text-secondary tabular-nums">{number}</TableCell>
      <TableCell>
        <span className="flex items-center gap-3">
          <Avatar name={name} src={student?.photo_url} size="sm" />
          {studentHref ? (
            <Link href={studentHref} className="font-semibold text-text-primary hover:text-brand hover:underline">
              {name}
            </Link>
          ) : (
            <span className="font-semibold text-text-primary">{name}</span>
          )}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-text-secondary sm:table-cell">{student?.student_code ?? "—"}</TableCell>
      <TableCell className="hidden whitespace-nowrap text-text-secondary md:table-cell">{student?.phone ?? "—"}</TableCell>
      <TableCell className="w-px">
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
    </TableRow>
  );
}

/**
 * Batch Details → Students on the Overview: the batch's enrollments in one compact table (number, student with avatar, the
 * enrollment's status, Student ID, phone, and the View / menu actions - both existing routes). Search (name, Student ID, phone) and
 * a Status filter narrow the rows on screen only. The chevron at the right of the header collapses the whole section; the body is
 * only hidden, so the search and the filter keep their state. Add Student opens the existing Add Student flow.
 */
export default function BatchStudentsSection({ enrollments, activeCount }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
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

  return (
    <Panel aria-label="Students" className="min-w-0">
      <PanelHeader
        icon={Users}
        tone="brand"
        title={`Active Students (${activeCount})`}
        description="Students enrolled in this batch."
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
              <SelectTrigger aria-label="Filter by status" className="w-36">
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
                variant="secondary"
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
          <div className="overflow-hidden rounded-lg border border-border">
            <Table aria-label="Students in this batch" className="[&_td]:py-2.5 [&_th]:h-10">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Student ID</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((enrollment, index) => (
                  <StudentRow key={enrollment.id} enrollment={enrollment} number={index + 1} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Panel>
  );
}
