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

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search is independent of the filter drawer. Filter apply/clear still
 * writes the same `q` / `status` / `batch` / `membership` URL params as
 * before (wireframe p9; keyed remount from the page).
 */
export default function StudentFilters({
  defaultQuery,
  defaultStatus,
  defaultBatchId,
  defaultMembershipFilter,
  batchOptions,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);
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
    <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <label htmlFor="student-search" className="sr-only">
            Search
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <Input
              id="student-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by student name or phone"
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
          <button
            type="button"
            className="text-small font-medium text-brand hover:underline"
            onClick={clearFilters}
          >
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
            <SheetDescription className="text-small text-text-secondary">Refine your student list</SheetDescription>
          </SheetHeader>

          <form onSubmit={applyFilters} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="flex flex-col gap-1.5">
                <span
                  id="student-status-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Student Status
                </span>
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
              </div>

              <div className="flex flex-col gap-1.5">
                <span
                  id="student-batch-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Batch
                </span>
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
              </div>

              <div className="flex flex-col gap-1.5">
                <span
                  id="student-membership-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Membership
                </span>
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
