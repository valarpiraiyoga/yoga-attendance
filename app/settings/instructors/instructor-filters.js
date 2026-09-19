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

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search + Filters + Cards/Table toggle in one toolbar row (the finalized
 * list-page composition shared with Students / Memberships / Batches /
 * Schedule / Attendance), for the Instructor list (wireframe p39). Search is
 * independent of the filter drawer; view switching is a plain URL change;
 * Apply Filters writes the same `q` / `status` URL params as before, and any
 * change resets pagination to page 1. The parent page keys this component by
 * the current `q`/`status`, so it remounts — and its local draft state
 * re-initializes from the URL — whenever those change by any means other
 * than this form (e.g. the empty-state "Clear Filters" link).
 */
export default function InstructorFilters({ defaultQuery, defaultStatus, view }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);
  const [status, setStatus] = useState(defaultStatus);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const appliedStatus = defaultStatus;
  const activeFilterCount = [appliedStatus !== "all"].filter(Boolean).length;

  const viewItems = VIEWS.map((item) => ({
    ...item,
    href: buildListHref("/settings/instructors", searchParams, { view: item.key === "cards" ? "" : item.key }),
  }));

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
      if (status !== "all") params.set("status", status);
      else params.delete("status");
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setStatus("all");
    pushParams((params) => {
      params.delete("status");
    });
    setFiltersOpen(false);
  }

  function clearAllIncludingSearch() {
    setQuery("");
    setStatus("all");
    router.push(pathname);
    setFiltersOpen(false);
  }

  function removeAppliedFilter(key) {
    if (key === "status") setStatus("all");
    pushParams((params) => {
      params.delete(key);
    });
  }

  const chips = [];
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
            id="instructor-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by instructor name"
          />
        </form>

        <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} />

        <ViewSwitcher items={viewItems} active={view} ariaLabel="Instructor list views" />
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine your instructor list"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <FilterSection id="instructor-status" label="Status">
          <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby="instructor-status-label" className="w-full">
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
