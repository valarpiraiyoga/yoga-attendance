"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";

const ATTENDANCE_STATUS_LABELS = { present: "Present", absent: "Absent" };
const ATTENDANCE_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  ...ATTENDANCE_STATUSES.map((status) => ({ value: status, label: ATTENDANCE_STATUS_LABELS[status] })),
];

/**
 * Attendance History's filter bar (Phase 16; wireframe p.6 Instructor /
 * p.30 Admin). One component, not two, because the two variants differ in
 * only two respects — Admin additionally exposes an Instructor filter, and
 * the Batch-equivalent picker is labeled "Assigned Classes" for an
 * instructor — while Date Range, Search, Attendance Status and the
 * Apply/Clear actions are identical. Mirrors
 * app/attendance/attendance-filters.js's apply-on-submit / keyed-remount
 * pattern exactly (see that file's comment for why: a plain `<form>` submit
 * rather than filtering on every keystroke, and the caller remounts this
 * component with a `key` derived from the current filter values so its
 * local state resets when the URL changes from outside, e.g. Clear).
 *
 * The Batch/"Assigned Classes" options list is the same
 * `listBatchOptions()` result for both roles (`app/attendance-history/page.js`)
 * — for an instructor it already contains only batches RLS lets them see
 * through an owned session or schedule
 * (`0014_instructor_attendance_access.sql`), so no separate "assigned
 * classes" query exists; only this component's label changes.
 *
 * No Instructor filter is rendered at all when `variant === "instructor"`
 * (approved requirement) — not hidden by CSS, simply never in the tree.
 */
export default function AttendanceHistoryFilters({
  variant,
  defaultQuery,
  defaultDateFrom,
  defaultDateTo,
  defaultBatchId,
  defaultInstructorId,
  defaultAttendanceStatus,
  batchOptions,
  instructorOptions,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [batchId, setBatchId] = useState(defaultBatchId);
  const [instructorId, setInstructorId] = useState(defaultInstructorId);
  const [attendanceStatus, setAttendanceStatus] = useState(defaultAttendanceStatus);

  const isInstructor = variant === "instructor";
  const batchLabel = isInstructor ? "Assigned Classes" : "Batch";
  const batchSelectOptions = [
    { value: "all", label: isInstructor ? "All Assigned Classes" : "All Batches" },
    ...batchOptions.map((batch) => ({ value: batch.id, label: batch.name })),
  ];
  const instructorSelectOptions = [
    { value: "all", label: "All Instructors" },
    ...(instructorOptions ?? []).map((instructor) => ({ value: instructor.id, label: instructor.full_name })),
  ];

  function applyFilters(event) {
    event.preventDefault();

    const params = new URLSearchParams(searchParams);
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    if (dateFrom) {
      params.set("from", dateFrom);
    } else {
      params.delete("from");
    }
    if (dateTo) {
      params.set("to", dateTo);
    } else {
      params.delete("to");
    }
    if (batchId !== "all") {
      params.set("batch", batchId);
    } else {
      params.delete("batch");
    }
    if (!isInstructor && instructorId !== "all") {
      params.set("instructor", instructorId);
    } else {
      params.delete("instructor");
    }
    if (attendanceStatus !== "all") {
      params.set("status", attendanceStatus);
    } else {
      params.delete("status");
    }
    params.delete("page");

    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setBatchId("all");
    setInstructorId("all");
    setAttendanceStatus("all");
    router.push(pathname);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5 lg:min-w-[220px]">
        <label
          htmlFor="attendance-history-search"
          className="text-small font-medium tracking-wide text-text-secondary uppercase"
        >
          Search
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            id="attendance-history-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by student name or batch"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="attendance-history-date-from" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          From
        </label>
        <Input
          id="attendance-history-date-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="w-full sm:w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="attendance-history-date-to" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          To
        </label>
        <Input
          id="attendance-history-date-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="w-full sm:w-40"
        />
      </div>

      {!isInstructor ? (
        <div className="flex flex-col gap-1.5">
          <span id="attendance-history-batch-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
            {batchLabel}
          </span>
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger aria-labelledby="attendance-history-batch-label" className="w-full sm:w-44">
              <SelectValue />
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
      ) : null}

      {!isInstructor ? (
        <div className="flex flex-col gap-1.5">
          <span
            id="attendance-history-instructor-label"
            className="text-small font-medium tracking-wide text-text-secondary uppercase"
          >
            Instructor
          </span>
          <Select items={instructorSelectOptions} value={instructorId} onValueChange={setInstructorId}>
            <SelectTrigger aria-labelledby="attendance-history-instructor-label" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {instructorSelectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {isInstructor ? (
        <div className="flex flex-col gap-1.5">
          <span id="attendance-history-batch-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
            {batchLabel}
          </span>
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger aria-labelledby="attendance-history-batch-label" className="w-full sm:w-44">
              <SelectValue />
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
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span id="attendance-history-status-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Attendance Status
        </span>
        <Select items={ATTENDANCE_STATUS_OPTIONS} value={attendanceStatus} onValueChange={setAttendanceStatus}>
          <SelectTrigger aria-labelledby="attendance-history-status-label" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTENDANCE_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3">
        <Button type="submit">Apply Filters</Button>
        <Button type="button" variant="ghost" onClick={clearFilters}>
          Clear
        </Button>
      </div>
    </form>
  );
}
