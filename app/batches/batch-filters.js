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
import { useLiveSearch } from "@/components/ui/use-live-search";
import ViewSwitcher from "@/components/ui/view-switcher";
import { FilterBar, FilterChips, FilterSheet, FilterSection } from "@/components/ui/filter-bar";
import { ListToolbar } from "@/components/layout/list-page";
import { buildListHref } from "@/lib/url-params";

// The same four display statuses the badge and the KPI tiles use
// (`lib/batches/summary.js`) — filtering by what the list shows.
const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
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
 * Search + Filters + Cards/Table toggle in one toolbar row: four individual
 * surfaces (white, subtle border, one 36px height) with no frame around them —
 * the finalized Schedule toolbar. "Sort by" is not in this row; it sits on the
 * results row below (`BatchList`). Search is independent of the filter drawer;
 * filter apply/clear still writes the same `q` / `status` URL params (keyed
 * remount from the page); view switching is a plain URL change.
 *
 * Follows the finalized responsive default rule: with no `view` in the URL
 * (`view` is `""`), Table is the default from `lg` up and Cards below it —
 * drawn by CSS in the switcher — and both segments link with an explicit
 * `?view=`, so a choice is always kept.
 */
export default function BatchFilters({ defaultQuery, defaultStatus, view }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, searchFor } = useLiveSearch(defaultQuery);
  const [status, setStatus] = useState(defaultStatus);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const appliedStatus = defaultStatus;
  const activeFilterCount = [appliedStatus !== "all"].filter(Boolean).length;

  const viewItems = VIEWS.map((item) => ({
    ...item,
    href: buildListHref("/batches", searchParams, { view: item.key }),
    autoActive: item.key === "table" ? "lg" : "below-lg",
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
      if (query.trim()) {
        params.set("q", query.trim());
      } else {
        params.delete("q");
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
        className="border-0 bg-transparent p-0 shadow-none"
        chips={
          <FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />
        }
      >
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <SearchInput
            id="batch-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder="Search by batch name or code..."
            inputClassName="h-9 bg-surface"
          />
        </form>

        {/* Filters and Cards / Table share one row on mobile. */}
        <div className="flex items-center gap-3 sm:contents">
          <FilterBar
            activeCount={activeFilterCount}
            onClick={() => setFiltersOpen(true)}
            className="flex-1 justify-center bg-surface sm:flex-none"
          />

          <ViewSwitcher
            items={viewItems}
            active={view || undefined}
            ariaLabel="Batch list views"
            separate
            className="flex-[2] sm:flex-none [&>a]:flex-1 [&>a]:justify-center sm:[&>a]:flex-none"
          />
        </div>
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine your batch list"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <FilterSection id="batch-status" label="Status">
          <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby="batch-status-label" className="w-full">
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
