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

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// "Expired" is not equivalent to "None" (02-ux.md "Memberships list
// filters") — kept as three distinct options rather than collapsing
// "Expired"/"None" into one, per that explicit rule.
const MEMBERSHIP_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "none", label: "None" },
];

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search + Filters + Cards/Table toggle live in one toolbar row
 * (06-ui-implementation-rules.md §16.1, matching `02`/`03`'s single
 * combined bar — this was previously two rows, with the view toggle
 * rendered separately above the results in `student-list.js`). Search
 * stays independent of the filter drawer; filter apply/clear still write
 * the same `q` / `status` / `batch` / `membership` URL params as before
 * (wireframe p9; keyed remount from the page). View switching is a plain
 * URL change, not client state.
 */
export default function StudentFilters({
  defaultQuery,
  defaultStatus,
  defaultBatchId,
  defaultMembershipFilter,
  batchOptions,
  view,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, searchFor } = useLiveSearch(defaultQuery);
  const [status, setStatus] = useState(defaultStatus);
  const [batchId, setBatchId] = useState(defaultBatchId);
  const [membershipFilter, setMembershipFilter] = useState(defaultMembershipFilter);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const batchSelectOptions = [
    { value: "all", label: "All Batches" },
    ...batchOptions.map((batch) => ({ value: batch.id, label: batch.name })),
  ];

  const appliedStatus = defaultStatus;
  const appliedBatchId = defaultBatchId;
  const appliedMembership = defaultMembershipFilter;

  const activeFilterCount = [appliedStatus !== "all", appliedBatchId !== "all", appliedMembership !== "all"].filter(
    Boolean
  ).length;

  const viewItems = VIEWS.map((item) => ({
    ...item,
    href: buildListHref("/students", searchParams, { view: item.key === "cards" ? "" : item.key }),
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
      if (batchId !== "all") {
        params.set("batch", batchId);
      } else {
        params.delete("batch");
      }
      if (membershipFilter !== "all") {
        params.set("membership", membershipFilter);
      } else {
        params.delete("membership");
      }
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setStatus("all");
    setBatchId("all");
    setMembershipFilter("all");
    pushParams((params) => {
      params.delete("status");
      params.delete("batch");
      params.delete("membership");
    });
    setFiltersOpen(false);
  }

  function clearAllIncludingSearch() {
    setQuery("");
    setStatus("all");
    setBatchId("all");
    setMembershipFilter("all");
    router.push(pathname);
    setFiltersOpen(false);
  }

  function removeAppliedFilter(key) {
    if (key === "status") setStatus("all");
    if (key === "batch") setBatchId("all");
    if (key === "membership") setMembershipFilter("all");
    pushParams((params) => {
      params.delete(key);
    });
  }

  const chips = [];
  if (appliedStatus !== "all") {
    chips.push({
      key: "status",
      label: `Status: ${optionLabel(STATUS_OPTIONS, appliedStatus)}`,
    });
  }
  if (appliedBatchId !== "all") {
    chips.push({
      key: "batch",
      label: `Batch: ${optionLabel(batchSelectOptions, appliedBatchId)}`,
    });
  }
  if (appliedMembership !== "all") {
    chips.push({
      key: "membership",
      label: `Membership: ${optionLabel(MEMBERSHIP_OPTIONS, appliedMembership)}`,
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
            id="student-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder="Search by student name or phone"
          />
        </form>

        <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} />

        <ViewSwitcher items={viewItems} active={view} ariaLabel="Student list views" />
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine your student list"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <FilterSection id="student-status" label="Student Status">
          <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby="student-status-label" className="w-full">
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

        <FilterSection id="student-batch" label="Batch">
          <Select items={batchSelectOptions} value={batchId} onValueChange={setBatchId}>
            <SelectTrigger aria-labelledby="student-batch-label" className="w-full">
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

        <FilterSection id="student-membership" label="Membership">
          <Select items={MEMBERSHIP_OPTIONS} value={membershipFilter} onValueChange={setMembershipFilter}>
            <SelectTrigger aria-labelledby="student-membership-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBERSHIP_OPTIONS.map((option) => (
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
