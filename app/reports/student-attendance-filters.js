"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportFormPanel from "@/app/reports/report-form-panel";

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
 *
 * The panel layout (heading, field grid, Clear / Generate Report) is the
 * shared `ReportFormPanel`; this file owns only the state and the rules.
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
    <ReportFormPanel
      icon={Users}
      title="Student Attendance"
      description="View attendance history for a student over a selected date range."
      hasPicker
      onSubmit={generateReport}
      onClear={clearFilters}
      isPending={isPending}
      error={error}
    >
      <FormField id="report-student" label="Student" required className="sm:col-span-2">
        {(field) => (
          <Select items={studentSelectOptions} value={studentId} onValueChange={setStudentId}>
            <SelectTrigger id={field.id} className="w-full">
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
        )}
      </FormField>

      <FormField id="report-date-from" label="Date From" required>
        {(field) => (
          <Input {...field} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        )}
      </FormField>

      <FormField id="report-date-to" label="Date To" required>
        {(field) => (
          <Input {...field} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        )}
      </FormField>
    </ReportFormPanel>
  );
}
