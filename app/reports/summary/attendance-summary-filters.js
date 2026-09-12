"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateReportDateRange } from "@/lib/reports/validation";

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
 * already keeps its own despite the structural overlap.
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
    <form
      onSubmit={generateReport}
      className="mt-4 flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="report-summary-date-from"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Date From
          </label>
          <Input
            id="report-summary-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full sm:w-44"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="report-summary-date-to"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Date To
          </label>
          <Input
            id="report-summary-date-to"
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
