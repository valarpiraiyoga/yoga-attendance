"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";

const ATTENDANCE_STATUS_LABELS = { present: "Present", absent: "Absent" };
const ATTENDANCE_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  ...ATTENDANCE_STATUSES.map((status) => ({ value: status, label: ATTENDANCE_STATUS_LABELS[status] })),
];

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function formatChipDate(value) {
  if (!value) return value;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Attendance History filters — sheet + chips pattern matching Attendance /
 * Schedule / Batches. Admin gets Instructor filter; instructor does not.
 * Batch label remains "Assigned Classes" for instructors.
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  const isInstructor = variant === "instructor";
  const batchLabel = isInstructor ? "Assigned Classes" : "Batch";
  const batchSelectOptions = [
    { value: "all", label: isInstructor ? "All Assigned Classes" : "All Batches" },
    ...batchOptions.map((batch) => ({ value: batch.id, label: batch.name })),
  ];
  const instructorSelectOptions = [
    { value: "all", label: "All Instructors" },
    ...(instructorOptions ?? []).map((instructor) => ({
      value: instructor.id,
      label: instructor.full_name,
    })),
  ];

  const appliedFrom = defaultDateFrom;
  const appliedTo = defaultDateTo;
  const appliedBatchId = defaultBatchId;
  const appliedInstructorId = defaultInstructorId;
  const appliedStatus = defaultAttendanceStatus;

  const activeFilterCount = [
    Boolean(appliedFrom),
    Boolean(appliedTo),
    appliedBatchId !== "all",
    !isInstructor && appliedInstructorId !== "all",
    appliedStatus !== "all",
  ].filter(Boolean).length;

  function pushParams(mutate) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function applySearch(event) {
    event.preventDefault();
    pushParams((params) => {
      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");
    });
  }

  function applyFilters(event) {
    event.preventDefault();
    pushParams((params) => {
      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");
      if (dateFrom) params.set("from", dateFrom);
      else params.delete("from");
      if (dateTo) params.set("to", dateTo);
      else params.delete("to");
      if (batchId !== "all") params.set("batch", batchId);
      else params.delete("batch");
      if (!isInstructor && instructorId !== "all") params.set("instructor", instructorId);
      else params.delete("instructor");
      if (attendanceStatus !== "all") params.set("status", attendanceStatus);
      else params.delete("status");
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setBatchId("all");
    setInstructorId("all");
    setAttendanceStatus("all");
    pushParams((params) => {
      params.delete("from");
      params.delete("to");
      params.delete("batch");
      params.delete("instructor");
      params.delete("status");
    });
    setFiltersOpen(false);
  }

  function clearAllIncludingSearch() {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setBatchId("all");
    setInstructorId("all");
    setAttendanceStatus("all");
    router.push(pathname);
    setFiltersOpen(false);
  }

  function removeAppliedFilter(key) {
    if (key === "from") setDateFrom("");
    if (key === "to") setDateTo("");
    if (key === "batch") setBatchId("all");
    if (key === "instructor") setInstructorId("all");
    if (key === "status") setAttendanceStatus("all");
    pushParams((params) => {
      params.delete(key === "status" ? "status" : key);
    });
  }

  const chips = [];
  if (appliedFrom) chips.push({ key: "from", label: `From: ${formatChipDate(appliedFrom)}` });
  if (appliedTo) chips.push({ key: "to", label: `To: ${formatChipDate(appliedTo)}` });
  if (appliedBatchId !== "all") {
    chips.push({ key: "batch", label: `${batchLabel}: ${optionLabel(batchSelectOptions, appliedBatchId)}` });
  }
  if (!isInstructor && appliedInstructorId !== "all") {
    chips.push({
      key: "instructor",
      label: `Instructor: ${optionLabel(instructorSelectOptions, appliedInstructorId)}`,
    });
  }
  if (appliedStatus !== "all") {
    chips.push({
      key: "status",
      label: `Attendance: ${optionLabel(ATTENDANCE_STATUS_OPTIONS, appliedStatus)}`,
    });
  }

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <label htmlFor="attendance-history-search" className="sr-only">
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
              className="h-9 pl-8"
            />
          </div>
        </form>

        <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-brand text-small font-semibold text-surface">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </div>

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-small text-text-secondary">Active filters:</span>
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pr-1 pl-2.5 text-small font-medium text-brand"
            >
              {chip.label}
              <button
                type="button"
                className="flex size-5 items-center justify-center rounded-full text-brand hover:bg-brand/15"
                aria-label={`Remove ${chip.label}`}
                onClick={() => removeAppliedFilter(chip.key)}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="text-small font-medium text-brand hover:underline" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      ) : null}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="right"
          className="h-auto max-h-[90dvh] w-full gap-0 rounded-t-card p-0 data-[side=right]:inset-x-0 data-[side=right]:top-auto data-[side=right]:bottom-0 data-[side=right]:left-0 sm:inset-y-0 sm:h-full sm:max-h-none sm:w-96 sm:max-w-sm sm:rounded-none sm:data-[side=right]:inset-x-auto sm:data-[side=right]:top-0 sm:data-[side=right]:right-0 sm:data-[side=right]:left-auto"
          showCloseButton
        >
          <SheetHeader className="border-b border-border pr-12">
            <SheetTitle className="text-section-title font-semibold text-text-primary">Filters</SheetTitle>
            <SheetDescription className="text-small text-text-secondary">
              Refine attendance history
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={applyFilters} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="attendance-history-date-from"
                    className="text-small font-medium tracking-wide text-text-secondary uppercase"
                  >
                    From
                  </label>
                  <Input
                    id="attendance-history-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="attendance-history-date-to"
                    className="text-small font-medium tracking-wide text-text-secondary uppercase"
                  >
                    To
                  </label>
                  <Input
                    id="attendance-history-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span
                  id="attendance-history-batch-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  {batchLabel}
                </span>
                <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
                  <SelectTrigger aria-labelledby="attendance-history-batch-label" className="w-full">
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

              {!isInstructor ? (
                <div className="flex flex-col gap-1.5">
                  <span
                    id="attendance-history-instructor-label"
                    className="text-small font-medium tracking-wide text-text-secondary uppercase"
                  >
                    Instructor
                  </span>
                  <Select items={instructorSelectOptions} value={instructorId} onValueChange={setInstructorId}>
                    <SelectTrigger aria-labelledby="attendance-history-instructor-label" className="w-full">
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

              <div className="flex flex-col gap-1.5">
                <span
                  id="attendance-history-status-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Attendance Status
                </span>
                <Select
                  items={ATTENDANCE_STATUS_OPTIONS}
                  value={attendanceStatus}
                  onValueChange={setAttendanceStatus}
                >
                  <SelectTrigger aria-labelledby="attendance-history-status-label" className="w-full">
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
            </div>

            <div className="mt-auto flex gap-3 border-t border-border p-4">
              <Button type="button" variant="outline" className="flex-1" onClick={clearAllIncludingSearch}>
                Clear All
              </Button>
              <Button type="submit" className="flex-1">
                Apply Filters
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
