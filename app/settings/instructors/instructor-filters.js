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
  { value: "all", label: "Status: All" },
  { value: "active", label: "Status: Active" },
  { value: "inactive", label: "Status: Inactive" },
];

/**
 * Search + status filter bar for the Instructor list (wireframe p39).
 *
 * Filters only take effect on "Apply Filters" (not as-you-type), matching
 * the wireframe. Filtering resets pagination to page 1. The parent page
 * keys this component by the current `q`/`status`, so it remounts — and its
 * local draft state re-initializes from the URL — whenever those change by
 * any means other than this form (e.g. the empty-state "Clear Filters" link).
 */
export default function InstructorFilters({ defaultQuery, defaultStatus }) {
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
          htmlFor="instructor-search"
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
            id="instructor-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by instructor name"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="instructor-status-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Status
        </span>
        <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
          <SelectTrigger aria-labelledby="instructor-status-label" className="w-full sm:w-44">
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
