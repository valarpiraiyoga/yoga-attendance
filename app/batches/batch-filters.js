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

/**
 * Search + status filter bar for the Batches list (wireframe p16). Mirrors
 * app/settings/instructors/instructor-filters.js exactly — see that file's
 * comment for why filtering applies only on "Apply Filters" and why this
 * component is keyed by the parent on `q`/`status`.
 */
export default function BatchFilters({ defaultQuery, defaultStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(defaultQuery);
  const [status, setStatus] = useState(defaultStatus);

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
    params.delete("page");

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearFilters() {
    setQuery("");
    setStatus("all");
    router.push(pathname);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="grid gap-4 rounded-lg border border-border bg-background/60 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="batch-search"
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
            id="batch-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by batch name or code"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="batch-status-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Status
        </span>
        <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
          <SelectTrigger aria-labelledby="batch-status-label" className="w-full sm:w-44">
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

      <Button type="submit">Apply Filters</Button>

      <Button type="button" variant="ghost" onClick={clearFilters}>
        Clear
      </Button>
    </form>
  );
}
