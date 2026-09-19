"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
import FormField from "@/components/ui/form-field";
import { validateReportDateRange } from "@/lib/reports/validation";
import ReportFormPanel from "@/app/reports/report-form-panel";

/**
 * Attendance Summary report filters (approved wireframe p.37: DATE FROM,
 * DATE TO, with Clear and Generate Report — no entity picker, since this
 * report spans every batch/student).
 *
 * A direct copy of `app/reports/batch/batch-attendance-filters.js`'s
 * pattern with the Batch picker removed — same apply-on-submit /
 * keyed-remount form, same client-then-server validation split, same
 * required-before-generating rule. Duplicated rather than shared, matching
 * how each Reports filter bar (and `app/attendance-history/
 * attendance-history-filters.js`, `app/attendance/attendance-filters.js`)
 * already keeps its own despite the structural overlap. The panel layout
 * itself is the shared `ReportFormPanel`.
 */
export default function AttendanceSummaryFilters({ defaultDateFrom, defaultDateTo }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [error, setError] = useState("");

  function generateReport(event) {
    event.preventDefault();

    const range = validateReportDateRange(dateFrom, dateTo);
    if (!range.success) {
      setError(range.error);
      return;
    }

    setError("");

    const params = new URLSearchParams();
    params.set("from", range.data.dateFrom);
    params.set("to", range.data.dateTo);

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setError("");
    startTransition(() => {
      router.push(pathname);
    });
  }

  return (
    <ReportFormPanel
      icon={ClipboardList}
      title="Attendance Summary"
      description="View attendance totals for a selected date or date range."
      onSubmit={generateReport}
      onClear={clearFilters}
      isPending={isPending}
      error={error}
    >
      <FormField id="report-summary-date-from" label="Date From" required>
        {(field) => (
          <Input {...field} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        )}
      </FormField>

      <FormField id="report-summary-date-to" label="Date To" required>
        {(field) => (
          <Input {...field} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        )}
      </FormField>
    </ReportFormPanel>
  );
}
