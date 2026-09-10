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

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/**
 * Search + Batch + Instructor + Status filter bar for the Schedule area's
 * List View (one of its two approved views). Mirrors
 * app/memberships/membership-filters.js's apply-on-submit / keyed-remount
 * pattern exactly — see that file's comment for why.
 */
export default function ScheduleFilters({
  defaultQuery,
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
    params.delete("page");

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearFilters() {
    setQuery("");
    setBatchId("all");
    setInstructorId("all");
    setStatus("all");
    // Weekly Schedule is now the default at a bare `/schedule` (Phase 13
    // follow-up), so clearing filters must keep `view=list` explicit —
    // otherwise this button would silently switch the admin to a different
    // view instead of just resetting the list they're looking at.
    router.push(`${pathname}?view=list`);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5 lg:min-w-[220px]">
        <label
          htmlFor="schedule-search"
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
            id="schedule-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by batch or instructor"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="schedule-batch-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Batch
        </span>
        <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
          <SelectTrigger aria-labelledby="schedule-batch-label" className="w-full sm:w-44">
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
          id="schedule-instructor-label"
          className="text-small font-medium tracking-wide text-text-secondary uppercase"
        >
          Instructor
        </span>
        <Select items={instructorSelectOptions} value={instructorId} onValueChange={setInstructorId}>
          <SelectTrigger aria-labelledby="schedule-instructor-label" className="w-full sm:w-44">
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
        <span id="schedule-status-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Status
        </span>
        <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
          <SelectTrigger aria-labelledby="schedule-status-label" className="w-full sm:w-40">
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
