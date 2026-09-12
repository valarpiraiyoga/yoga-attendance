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
 * Batch Attendance report filters (approved wireframe p.36: BATCH,
 * DATE FROM, DATE TO, with Clear and Generate Report).
 *
 * A direct copy of `app/reports/student-attendance-filters.js`'s pattern
 * with the Student picker swapped for a Batch one — same apply-on-submit /
 * keyed-remount form, same client-then-server validation split, same
 * required-before-generating rule. See that file's own comment for why each
 * of those choices was made; duplicated here rather than shared, matching
 * how `app/attendance-history/attendance-history-filters.js` and
 * `app/attendance/attendance-filters.js` already each keep their own filter
 * bar despite being structurally similar — feature-adjacent components
 * stay independent unless a real second caller forces the abstraction.
 */
export default function BatchAttendanceFilters({
  defaultBatchId,
  defaultDateFrom,
  defaultDateTo,
  batchOptions,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [batchId, setBatchId] = useState(defaultBatchId);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [error, setError] = useState("");

  const batchSelectOptions = batchOptions.map((batch) => ({
    value: batch.id,
    label: `${batch.name} (${batch.code})`,
  }));

  function generateReport(event) {
    event.preventDefault();

    if (!batchId) {
      setError("Select a batch.");
      return;
    }

    const range = validateReportDateRange(dateFrom, dateTo);
    if (!range.success) {
      setError(range.error);
      return;
    }

    setError("");

    const params = new URLSearchParams();
    params.set("batch", batchId);
    params.set("from", range.data.dateFrom);
    params.set("to", range.data.dateTo);

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function clearFilters() {
    setBatchId("");
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
            id="report-batch-label"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Batch
          </span>
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger aria-labelledby="report-batch-label" className="w-full">
              <SelectValue placeholder="Select a batch" />
            </SelectTrigger>
            <SelectContent>
              {batchSelectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="report-batch-date-from"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Date From
          </label>
          <Input
            id="report-batch-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full sm:w-44"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="report-batch-date-to"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Date To
          </label>
          <Input
            id="report-batch-date-to"
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
