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
import { cn } from "@/lib/utils";

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
 *
 * Attendance History itself passes `showDateFilters={false}`: its date range
 * lives in the page header's range control (`HistoryDateRange`), so the drawer
 * carries no From / To, the range gets no chip, "Clear" leaves the range (and
 * the calendar month) untouched, and `toolbarClassName` drops the card frame
 * so the row sits directly on the page as in the finalized reference.
 *
 * `responsiveLayoutDefault` (Attendance History only) is the finalized default
 * view rule: with no `layout` in the URL (`layout` is `""`), Table is the
 * default from `lg` up and Cards below it. The switcher then draws the default
 * by CSS, and *both* segments link with an explicit `?layout=`, so a choice is
 * always kept — including choosing what would have been the default. Callers
 * without it (Batch Details → Attendance) keep Table as the only default.
 */
export default function AttendanceHistoryFilters({
  variant,
  layout,
  basePath = "/attendance-history",
  hideBatchFilter = false,
  showDateFilters = true,
  responsiveLayoutDefault = false,
  toolbarClassName,
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
    showDateFilters && Boolean(appliedFrom),
    showDateFilters && Boolean(appliedTo),
    !hideBatchFilter && appliedBatchId !== "all",
    !isInstructor && appliedInstructorId !== "all",
    appliedStatus !== "all",
  ].filter(Boolean).length;

  const layoutItems = LAYOUTS.map((item) => ({
    ...item,
    href: buildListHref(basePath, searchParams, {
      layout: item.key === "table" && !responsiveLayoutDefault ? "" : item.key,
    }),
    autoActive: responsiveLayoutDefault ? (item.key === "table" ? "lg" : "below-lg") : undefined,
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
      if (showDateFilters) {
        if (dateFrom) params.set("from", dateFrom);
        else params.delete("from");
        if (dateTo) params.set("to", dateTo);
        else params.delete("to");
      }
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
      if (showDateFilters) {
        params.delete("from");
        params.delete("to");
      }
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
    if (showDateFilters) {
      router.push(pathname);
    } else {
      // Keep the header's range and the calendar's month; clear everything else.
      const params = new URLSearchParams();
      for (const key of ["from", "to", "month", "layout"]) {
        const value = searchParams.get(key);
        if (value) params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    }
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
  if (!showDateFilters) {
    // The range is shown by the header control, not as a chip.
  } else if (appliedFrom && appliedTo) {
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
        className={toolbarClassName}
        chips={
          <FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />
        }
      >
        <form onSubmit={applySearch} className={cn("min-w-0 flex-1", showDateFilters && "sm:max-w-sm")}>
          <SearchInput
            id="attendance-history-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder={searchPlaceholder}
          />
        </form>

        {/* Attendance History (no date filters) keeps Filters and Cards / Table on
            one row on mobile, as the reference draws it; other callers stack. */}
        <div className={cn("flex items-center gap-3", showDateFilters ? "contents" : "sm:contents")}>
          <FilterBar
            activeCount={activeFilterCount}
            onClick={() => setFiltersOpen(true)}
            className={showDateFilters ? undefined : "flex-1 justify-center sm:flex-none"}
          />

          <ViewSwitcher
            items={layoutItems}
            active={layout || undefined}
            ariaLabel="Attendance history views"
            className={showDateFilters ? undefined : "flex-[2] sm:flex-none [&>a]:flex-1 [&>a]:justify-center sm:[&>a]:flex-none"}
          />
        </div>
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine attendance history"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        {showDateFilters ? (
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
        ) : null}

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
