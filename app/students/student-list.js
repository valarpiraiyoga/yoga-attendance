import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildListHref } from "@/lib/url-params";
import StudentCardItem from "@/app/students/student-card-item";
import StudentTableRow from "@/app/students/student-table-row";

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function ViewToggle({ active, searchParams }) {
  return (
    <div
      role="tablist"
      aria-label="Student list views"
      className="inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const href = buildListHref("/students", searchParams, {
          view: view.key === "cards" ? "" : view.key,
        });

        return (
          <Link
            key={view.key}
            href={href}
            role="tab"
            aria-selected={active === view.key}
            className={
              active === view.key
                ? "inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-small font-semibold text-text-primary shadow-xs"
                : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-small text-text-secondary hover:text-text-primary"
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}

function StudentCards({ students }) {
  return (
    <div
      className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Students"
    >
      {students.map((student) => (
        <StudentCardItem key={student.id} student={student} />
      ))}
    </div>
  );
}

function StudentTable({ students }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-r from-brand/10 via-surface to-info/10 p-2 shadow-xs sm:p-3">
      <div className="overflow-hidden rounded-xl bg-surface/55 backdrop-blur-sm">
        <Table aria-label="Students">
          <TableHeader className="bg-transparent">
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Student
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Phone
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Batches
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Membership
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Status
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <StudentTableRow key={student.id} student={student} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Student results with Cards / Table toggle. View is URL-driven (`view=table`
 * or default cards), matching Schedule/Attendance toggles — not client state.
 * Same data, View action, and membership summary in both layouts.
 */
export default function StudentList({ students, view = "cards", searchParams, total }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-medium text-text-primary">
            {total} {total === 1 ? "Student" : "Students"}
          </p>
          <p className="text-small text-text-secondary">
            {view === "table" ? "Table view" : "Card list view"}
          </p>
        </div>
        <ViewToggle active={view} searchParams={searchParams} />
      </div>

      {view === "table" ? <StudentTable students={students} /> : <StudentCards students={students} />}
    </div>
  );
}
