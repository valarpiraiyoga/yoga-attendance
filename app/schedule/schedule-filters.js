"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Table2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SearchInput from "@/components/ui/search-input";
import ViewSwitcher from "@/components/ui/view-switcher";
import { FilterBar, FilterChips, FilterSheet, FilterSection } from "@/components/ui/filter-bar";
import { ListToolbar } from "@/components/layout/list-page";
import { buildListHref } from "@/lib/url-params";

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
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
 * composition as `StudentFilters` / `MembershipFilters` / `BatchFilters`).
 * Search is independent of the filter drawer; filter apply/clear writes the
 * same `q` / `batch` / `instructor` / `status` URL params as before (List
 * View only). Every write keeps `view=list` so the admin stays on List View
 * (Weekly is the bare `/schedule` default); Cards/Table is the `layout`
 * param because `view` belongs to the Weekly Schedule / List View tabs.
 */
export default function ScheduleFilters({
  defaultQuery,
  defaultBatchId,
  defaultInstructorId,
  defaultStatus,
  layout,
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

  const appliedBatchId = defaultBatchId;
  const appliedInstructorId = defaultInstructorId;
  const appliedStatus = defaultStatus;

  const activeFilterCount = [
    appliedBatchId !== "all",
    appliedInstructorId !== "all",
    appliedStatus !== "all",
  ].filter(Boolean).length;

  const layoutItems = LAYOUTS.map((item) => ({
    ...item,
    href: buildListHref("/schedule", searchParams, {
      view: "list",
      layout: item.key === "cards" ? "" : item.key,
    }),
  }));

  function pushParams(mutate) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    params.set("view", "list");
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : `${pathname}?view=list`);
  }

  function applySearch(event) {
    event.preventDefault();
    pushParams((params) => {
      if (query.trim()) {
        params.set("q", query.trim());
      } else {
        params.delete("q");
      }
    });
  }

  function applyFilters(event) {
    event.preventDefault();
    pushParams((params) => {
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
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setBatchId("all");
    setInstructorId("all");
    setStatus("all");
    pushParams((params) => {
      params.delete("batch");
      params.delete("instructor");
      params.delete("status");
    });
    setFiltersOpen(false);
  }

  function clearAllIncludingSearch() {
    setQuery("");
    setBatchId("all");
    setInstructorId("all");
    setStatus("all");
    router.push(`${pathname}?view=list`);
    setFiltersOpen(false);
  }

  function removeAppliedFilter(key) {
    if (key === "batch") setBatchId("all");
    if (key === "instructor") setInstructorId("all");
    if (key === "status") setStatus("all");
    pushParams((params) => {
      params.delete(key);
    });
  }

  const chips = [];
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
        chips={
          <FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />
        }
      >
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <SearchInput
            id="schedule-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by batch or instructor"
          />
        </form>

        <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} />

        <ViewSwitcher items={layoutItems} active={layout} ariaLabel="Schedule list views" />
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine your schedule list"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <FilterSection id="schedule-batch" label="Batch">
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger aria-labelledby="schedule-batch-label" className="w-full">
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

        <FilterSection id="schedule-instructor" label="Instructor">
          <Select items={instructorSelectOptions} value={instructorId} onValueChange={setInstructorId}>
            <SelectTrigger aria-labelledby="schedule-instructor-label" className="w-full">
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

        <FilterSection id="schedule-status" label="Status">
          <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby="schedule-status-label" className="w-full">
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
