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

// "Expired" is not equivalent to "None" (02-ux.md "Memberships list
// filters") — kept as three distinct options rather than collapsing
// "Expired"/"None" into one, per that explicit rule.
const MEMBERSHIP_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "none", label: "None" },
];

/**
 * Search + Student Status + Batch + Membership filter bar for the Students
 * list (wireframe p9). Mirrors app/batches/batch-filters.js's
 * apply-on-submit / keyed-remount pattern exactly — see that file's comment
 * for why.
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

  const batchSelectOptions = [
    { value: "all", label: "All Batches" },
    ...batchOptions.map((batch) => ({ value: batch.id, label: batch.name })),
  ];

  function applyFilters(event) {
    event.preventDefault();

    const params = new URLSearchParams(searchParams);
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
    params.delete("page");

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setBatchId("all");
    setMembershipFilter("all");
    router.push(pathname);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5 lg:min-w-[220px]">
        <label
          htmlFor="student-search"
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
            id="student-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by student name or phone"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span
          id="student-status-label"
          className="text-small font-medium tracking-wide text-text-secondary uppercase"
        >
          Student Status
        </span>
        <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
          <SelectTrigger aria-labelledby="student-status-label" className="w-full sm:w-40">
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
          <SelectTrigger aria-labelledby="student-batch-label" className="w-full sm:w-40">
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
          <SelectTrigger aria-labelledby="student-membership-label" className="w-full sm:w-40">
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

      <div className="flex gap-3">
        <Button type="submit">Apply Filters</Button>
        <Button type="button" variant="ghost" onClick={clearFilters}>
          Clear
        </Button>
      </div>
    </form>
  );
}
