"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SearchInput from "@/components/ui/search-input";
import { useLiveSearch } from "@/components/ui/use-live-search";
import ViewSwitcher from "@/components/ui/view-switcher";
import { FilterBar, FilterChips, FilterSheet, FilterSection } from "@/components/ui/filter-bar";
import { ListToolbar } from "@/components/layout/list-page";
import { ATTENDANCE_STATUSES } from "@/lib/attendance/validation";
import { buildListHref } from "@/lib/url-params";
import { formatDate } from "@/lib/format";

const ATTENDANCE_STATUS_LABELS = { present: "Present", absent: "Absent" };
const ATTENDANCE_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  ...ATTENDANCE_STATUSES.map((status) => ({ value: status, label: ATTENDANCE_STATUS_LABELS[status] })),
];

const LAYOUTS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search + Filters + Cards/Table toggle in one toolbar row (the same
 * composition as the finalized Students / Memberships / Batches / Schedule /
 * Attendance toolbars). Search is independent of the filter drawer; filter
 * apply/clear writes the same `q` / `from` / `to` / `batch` / `instructor` /
 * `status` URL params as before. The date range lives in the drawer with the
 * other filters, and shows as one chip when both ends are set. Table is
 * Attendance History's default layout (no `layout` param); Cards is
 * `layout=cards`.
 *
 * Admin gets the Instructor filter; an instructor does not, and their Batch
 * filter reads "Assigned Classes".
 *
 * The same toolbar also serves Batch Details' Attendance tab, where the batch
 * is fixed by the page: `basePath` points the Cards / Table switch at that
 * route, `hideBatchFilter` drops the (redundant) Batch filter and chip, and
 * `searchPlaceholder` narrows the search hint. The defaults are Attendance
 * History's own.
 */
export default function AttendanceHistoryFilters({
  variant,
  layout,
  basePath = "/attendance-history",
  hideBatchFilter = false,
  searchPlaceholder = "Search by student name or batch",
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
  const { query, setQuery, searchFor } = useLiveSearch(defaultQuery);
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
    !hideBatchFilter && appliedBatchId !== "all",
    !isInstructor && appliedInstructorId !== "all",
    appliedStatus !== "all",
  ].filter(Boolean).length;

  const layoutItems = LAYOUTS.map((item) => ({
    ...item,
    href: buildListHref(basePath, searchParams, {
      layout: item.key === "table" ? "" : item.key,
    }),
  }));

  function pushParams(mutate) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function applySearch(event) {
    // Results already follow the field as it is typed; Enter only must not
    // submit the form natively.
    event.preventDefault();
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
      if (!isInstructor) {
        if (instructorId !== "all") params.set("instructor", instructorId);
        else params.delete("instructor");
      }
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
    if (key === "range") {
      setDateFrom("");
      setDateTo("");
    }
    if (key === "from") setDateFrom("");
    if (key === "to") setDateTo("");
    if (key === "batch") setBatchId("all");
    if (key === "instructor") setInstructorId("all");
    if (key === "status") setAttendanceStatus("all");
    pushParams((params) => {
      if (key === "range") {
        params.delete("from");
        params.delete("to");
      } else {
        params.delete(key);
      }
    });
  }

  const chips = [];
  if (appliedFrom && appliedTo) {
    chips.push({ key: "range", label: `${formatDate(appliedFrom)} – ${formatDate(appliedTo)}` });
  } else if (appliedFrom) {
    chips.push({ key: "from", label: `From: ${formatDate(appliedFrom)}` });
  } else if (appliedTo) {
    chips.push({ key: "to", label: `To: ${formatDate(appliedTo)}` });
  }
  if (!hideBatchFilter && appliedBatchId !== "all") {
    chips.push({ key: "batch", label: `${isInstructor ? "Class" : "Batch"}: ${optionLabel(batchSelectOptions, appliedBatchId)}` });
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
    <>
      <ListToolbar
        chips={
          <FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />
        }
      >
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <SearchInput
            id="attendance-history-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder={searchPlaceholder}
          />
        </form>

        <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} />

        <ViewSwitcher items={layoutItems} active={layout} ariaLabel="Attendance history views" />
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine attendance history"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <div className="grid grid-cols-2 gap-3">
          <FilterSection id="attendance-history-date-from" label="From">
            <Input
              id="attendance-history-date-from"
              type="date"
              aria-labelledby="attendance-history-date-from-label"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </FilterSection>
          <FilterSection id="attendance-history-date-to" label="To">
            <Input
              id="attendance-history-date-to"
              type="date"
              aria-labelledby="attendance-history-date-to-label"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </FilterSection>
        </div>

        {!hideBatchFilter ? (
          <FilterSection id="attendance-history-batch" label={batchLabel}>
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
          </FilterSection>
        ) : null}

        {!isInstructor ? (
          <FilterSection id="attendance-history-instructor" label="Instructor">
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
          </FilterSection>
        ) : null}

        <FilterSection id="attendance-history-status" label="Attendance Status">
          <Select items={ATTENDANCE_STATUS_OPTIONS} value={attendanceStatus} onValueChange={setAttendanceStatus}>
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
        </FilterSection>
      </FilterSheet>
    </>
  );
}
