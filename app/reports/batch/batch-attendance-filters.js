"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Layers } from "lucide-react";
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
 * stay independent unless a real second caller forces the abstraction. The
 * panel layout itself is the shared `ReportFormPanel`.
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
    <ReportFormPanel
      icon={Layers}
      title="Batch Attendance"
      description="View attendance performance for a batch over a selected date range."
      hasPicker
      onSubmit={generateReport}
      onClear={clearFilters}
      isPending={isPending}
      error={error}
    >
      <FormField id="report-batch" label="Batch" required className="sm:col-span-2">
        {(field) => (
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger id={field.id} className="w-full">
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
        )}
      </FormField>

      <FormField id="report-batch-date-from" label="Date From" required>
        {(field) => (
          <Input {...field} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        )}
      </FormField>

      <FormField id="report-batch-date-to" label="Date To" required>
        {(field) => (
          <Input {...field} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        )}
      </FormField>
    </ReportFormPanel>
  );
}
