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
import { buildListHref } from "@/lib/url-params";
import { formatDate } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "all", label: "All Session Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "in_progress", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "holiday", label: "Holiday" },
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
 * composition as the finalized Students / Memberships / Batches / Schedule
 * toolbars). Search is independent of the filter drawer; filter apply/clear
 * writes the same `q` / `from` / `to` / `batch` / `instructor` / `status` URL
 * params as before. Cards/Table is the `layout` param (`view` belongs to the
 * Today's / All Sessions switch).
 *
 * Both views follow the finalized responsive default rule (as Attendance
 * History): with no `layout` in the URL (`layout` is `""`), Table is the
 * default from `lg` up and Cards below it — drawn by CSS in the switcher —
 * and both segments link with an explicit `?layout=`, so a choice is always
 * kept. `trailing` (All Sessions' "Sort by") sits after the switcher.
 *
 * `mode` is "today" or "all". Today's Sessions is fixed to today's date
 * (02-ux.md), so its drawer has no Date Range; All Sessions keeps
 * `view=all` on every write so clearing never drops the admin back onto
 * Today's Sessions.
 */
export default function AttendanceFilters({
  mode,
  defaultQuery,
  defaultDateFrom = "",
  defaultDateTo = "",
  defaultBatchId,
  defaultInstructorId,
  defaultStatus,
  layout,
  trailing,
  batchOptions,
  instructorOptions,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAll = mode === "all";
  const { query, setQuery, searchFor } = useLiveSearch(defaultQuery, {
    prepare: (params) => {
      if (isAll) params.set("view", "all");
    },
  });
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [batchId, setBatchId] = useState(defaultBatchId);
  const [instructorId, setInstructorId] = useState(defaultInstructorId);
  const [status, setStatus] = useState(defaultStatus);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const batchSelectOptions = [
    { value: "all", label: "All Batches" },
    ...batchOptions.map((batch) => ({ value: batch.id, label: batch.name })),
  ];

  const instructorSelectOptions = [
    { value: "all", label: "All Instructors" },
    ...instructorOptions.map((instructor) => ({
      value: instructor.id,
      label: instructor.full_name,
    })),
  ];

  const appliedFrom = defaultDateFrom;
  const appliedTo = defaultDateTo;
  const appliedBatchId = defaultBatchId;
  const appliedInstructorId = defaultInstructorId;
  const appliedStatus = defaultStatus;

  const activeFilterCount = [
    Boolean(appliedFrom),
    Boolean(appliedTo),
    appliedBatchId !== "all",
    appliedInstructorId !== "all",
    appliedStatus !== "all",
  ].filter(Boolean).length;

  const layoutItems = LAYOUTS.map((item) => ({
    ...item,
    href: buildListHref("/attendance", searchParams, {
      view: isAll ? "all" : "",
      layout: item.key,
    }),
    autoActive: item.key === "table" ? "lg" : "below-lg",
  }));

  function pushParams(mutate) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    if (isAll) params.set("view", "all");
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
      if (isAll) {
        if (dateFrom) params.set("from", dateFrom);
        else params.delete("from");
        if (dateTo) params.set("to", dateTo);
        else params.delete("to");
      }
      if (batchId !== "all") params.set("batch", batchId);
      else params.delete("batch");
      if (instructorId !== "all") params.set("instructor", instructorId);
      else params.delete("instructor");
      if (status !== "all") params.set("status", status);
      else params.delete("status");
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setBatchId("all");
    setInstructorId("all");
    setStatus("all");
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
    setStatus("all");
    router.push(isAll ? `${pathname}?view=all` : pathname);
    setFiltersOpen(false);
  }

  function removeAppliedFilter(key) {
    if (key === "from") setDateFrom("");
    if (key === "to") setDateTo("");
    if (key === "batch") setBatchId("all");
    if (key === "instructor") setInstructorId("all");
    if (key === "status") setStatus("all");
    pushParams((params) => {
      params.delete(key);
    });
  }

  const chips = [];
  if (appliedFrom) chips.push({ key: "from", label: `From: ${formatDate(appliedFrom)}` });
  if (appliedTo) chips.push({ key: "to", label: `To: ${formatDate(appliedTo)}` });
  if (appliedBatchId !== "all") {
    chips.push({ key: "batch", label: `Batch: ${optionLabel(batchSelectOptions, appliedBatchId)}` });
  }
  if (appliedInstructorId !== "all") {
    chips.push({
      key: "instructor",
      label: `Instructor: ${optionLabel(instructorSelectOptions, appliedInstructorId)}`,
    });
  }
  if (appliedStatus !== "all") {
    chips.push({ key: "status", label: `Status: ${optionLabel(STATUS_OPTIONS, appliedStatus)}` });
  }

  return (
    <>
      <ListToolbar
        className="border-0 bg-transparent p-0 shadow-none"
        rowClassName="sm:flex-wrap"
        chips={
          <FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />
        }
      >
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <SearchInput
            id="attendance-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder="Search by batch name, code or instructor..."
          />
        </form>

        {/* Filters and Cards / Table share one row on mobile, as the reference draws it. */}
        <div className="flex items-center gap-3 sm:contents">
          <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} className="flex-1 justify-center sm:flex-none" />

          <ViewSwitcher
            items={layoutItems}
            active={layout || undefined}
            ariaLabel="Session list views"
            className="flex-[2] sm:flex-none [&>a]:flex-1 [&>a]:justify-center sm:[&>a]:flex-none"
          />
        </div>

        {/* All Sessions' "Sort by": beside the switcher when the toolbar is wide
            enough, otherwise on its own right-aligned row beneath. */}
        {trailing ? <div className="flex basis-full justify-end @3xl:basis-auto">{trailing}</div> : null}
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description={isAll ? "Refine your session list" : "Refine today's sessions"}
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        {isAll ? (
          <div className="grid grid-cols-2 gap-3">
            <FilterSection id="attendance-date-from" label="From">
              <Input
                id="attendance-date-from"
                type="date"
                aria-labelledby="attendance-date-from-label"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </FilterSection>
            <FilterSection id="attendance-date-to" label="To">
              <Input
                id="attendance-date-to"
                type="date"
                aria-labelledby="attendance-date-to-label"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </FilterSection>
          </div>
        ) : null}

        <FilterSection id="attendance-batch" label="Batch">
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger aria-labelledby="attendance-batch-label" className="w-full">
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

        <FilterSection id="attendance-instructor" label="Instructor">
          <Select items={instructorSelectOptions} value={instructorId} onValueChange={setInstructorId}>
            <SelectTrigger aria-labelledby="attendance-instructor-label" className="w-full">
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

        <FilterSection id="attendance-status" label="Session Status">
          <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby="attendance-status-label" className="w-full">
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
        </FilterSection>
      </FilterSheet>
    </>
  );
}
