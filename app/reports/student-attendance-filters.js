"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateReportDateRange } from "@/lib/reports/validation";

/**
 * Student Attendance report filters (approved wireframe p.35: STUDENT,
 * DATE FROM, DATE TO, with Clear and Generate Report).
 *
 * Follows app/attendance-history/attendance-history-filters.js's
 * apply-on-submit / keyed-remount pattern exactly: a plain `<form>` submit
 * rather than re-querying on every keystroke, and the caller remounts this
 * component with a `key` derived from the current filter values so local
 * state resets when the URL changes from outside (e.g. Clear).
 *
 * Unlike Attendance History's filter bar, all three inputs are REQUIRED
 * before anything is generated. A report has no natural "everything"
 * default — the wireframe gates its whole result behind an explicit
 * selection and a Generate Report action — so this validates before
 * navigating and shows the reason inline instead of pushing an
 * unsatisfiable URL.
 *
 * Validation reuses `validateReportDateRange` from the Reports data layer's
 * own validation module, so the rule that the range is inclusive and that
 * From must not follow To is stated once. The server re-validates anyway
 * (`app/reports/page.js`) — this is the fast, friendly half of that pair,
 * never the authority.
 */
export default function StudentAttendanceFilters({
  defaultStudentId,
  defaultDateFrom,
  defaultDateTo,
  studentOptions,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [studentId, setStudentId] = useState(defaultStudentId);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [error, setError] = useState("");

  const studentSelectOptions = studentOptions.map((student) => ({
    value: student.id,
    label: `${student.full_name} (${student.student_code})`,
  }));

  function generateReport(event) {
    event.preventDefault();

    if (!studentId) {
      setError("Select a student.");
      return;
    }

    const range = validateReportDateRange(dateFrom, dateTo);
    if (!range.success) {
      setError(range.error);
      return;
    }

    setError("");

    const params = new URLSearchParams();
    params.set("student", studentId);
    params.set("from", range.data.dateFrom);
    params.set("to", range.data.dateTo);

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function clearFilters() {
    setStudentId("");
    setDateFrom("");
    setDateTo("");
    setError("");
    startTransition(() => {
      router.push(pathname);
    });
  }

  return (
    <form
      onSubmit={generateReport}
      className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-1 flex-col gap-1.5 lg:min-w-[260px]">
          <span
            id="report-student-label"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Student
          </span>
          <Select items={studentSelectOptions} value={studentId} onValueChange={setStudentId}>
            <SelectTrigger aria-labelledby="report-student-label" className="w-full">
              <SelectValue placeholder="Select a student" />
            </SelectTrigger>
            <SelectContent>
              {studentSelectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="report-date-from"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Date From
          </label>
          <Input
            id="report-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full sm:w-44"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="report-date-to"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Date To
          </label>
          <Input
            id="report-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="w-full sm:w-44"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={clearFilters} disabled={isPending}>
            Clear
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Generating…" : "Generate Report"}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
