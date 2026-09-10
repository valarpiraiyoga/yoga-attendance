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

// The five *displayed* session statuses (approved Phase 14 decision;
// 02-ux.md "Class Session: Upcoming / In Progress / Completed / Cancelled /
// Holiday") — not the four persisted `class_sessions.status` values.
// "Scheduled" is never shown to the user: it is a database value, not a
// status this product exposes (lib/class-sessions/data.js's `listSessions`
// filters on the same derived status the STATUS badge displays).
const STATUS_OPTIONS = [
  { value: "all", label: "All Session Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "holiday", label: "Holiday" },
];

/**
 * Search + Date Range + Batch + Instructor + Session Status filter bar for
 * All Sessions. Mirrors app/schedule/schedule-filters.js's apply-on-submit /
 * keyed-remount pattern exactly (see that file's comment for why), extended
 * with the two native date inputs the approved wireframe's Date Range
 * filter needs — no date-range UI exists elsewhere in the project yet to
 * reuse.
 */
export default function AttendanceFilters({
  defaultQuery,
  defaultDateFrom,
  defaultDateTo,
  defaultBatchId,
  defaultInstructorId,
  defaultStatus,
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
  const [status, setStatus] = useState(defaultStatus);

  const batchSelectOptions = [
    { value: "all", label: "All Batches" },
    ...batchOptions.map((batch) => ({ value: batch.id, label: batch.name })),
  ];

  const instructorSelectOptions = [
    { value: "all", label: "All Instructors" },
    ...instructorOptions.map((instructor) => ({ value: instructor.id, label: instructor.full_name })),
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
    if (instructorId !== "all") {
      params.set("instructor", instructorId);
    } else {
      params.delete("instructor");
    }
    if (status !== "all") {
      params.set("status", status);
    } else {
      params.delete("status");
    }
    params.set("view", "all");
    params.delete("page");

    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilters() {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setBatchId("all");
    setInstructorId("all");
    setStatus("all");
    router.push(`${pathname}?view=all`);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5 lg:min-w-[220px]">
        <label
          htmlFor="attendance-search"
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
            id="attendance-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by batch or instructor"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="attendance-date-from" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          From
        </label>
        <Input
          id="attendance-date-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="w-full sm:w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="attendance-date-to" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          To
        </label>
        <Input
          id="attendance-date-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="w-full sm:w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="attendance-batch-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Batch
        </span>
        <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
          <SelectTrigger aria-labelledby="attendance-batch-label" className="w-full sm:w-44">
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

      <div className="flex flex-col gap-1.5">
        <span
          id="attendance-instructor-label"
          className="text-small font-medium tracking-wide text-text-secondary uppercase"
        >
          Instructor
        </span>
        <Select items={instructorSelectOptions} value={instructorId} onValueChange={setInstructorId}>
          <SelectTrigger aria-labelledby="attendance-instructor-label" className="w-full sm:w-44">
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

      <div className="flex flex-col gap-1.5">
        <span id="attendance-status-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Session Status
        </span>
        <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
          <SelectTrigger aria-labelledby="attendance-status-label" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
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
