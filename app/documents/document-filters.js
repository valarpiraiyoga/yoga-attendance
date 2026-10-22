"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchInput from "@/components/ui/search-input";
import { useLiveSearch } from "@/components/ui/use-live-search";
import ViewSwitcher from "@/components/ui/view-switcher";
import { FilterBar, FilterChips, FilterSheet, FilterSection } from "@/components/ui/filter-bar";
import { ListToolbar } from "@/components/layout/list-page";
import { buildListHref } from "@/lib/url-params";
import {
  FINANCIAL_YEAR_ALL,
  SERIES_OPTIONS,
  STATUS_OPTIONS,
  documentDateChips,
  financialYearFilterValue,
  financialYearOptions,
} from "@/lib/documents/list-core";
import { financialYearRange } from "@/lib/financial-year";

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

// The full search hint is too long for a phone's search field; below `sm` it is shorter. `matchMedia` has no server value, so the
// server (and first client) render use the full hint - the same rule as the Memberships toolbar.
const NARROW_QUERY = "(max-width: 639px)";
function subscribeNarrow(callback) {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getNarrow = () => window.matchMedia(NARROW_QUERY).matches;
const getNarrowServer = () => false;

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search + Filters + Cards/Table toggle in one toolbar row - the Memberships toolbar, for documents. Search is live: every
 * keystroke writes the `q` URL param (replacing the history entry) and the server re-runs the same query, so searching, filtering,
 * sorting and paging stay server-side and in the URL. The filter sheet writes `series`, `status`, `from` and `to` (the document
 * date, inclusive); changing any of them returns to page 1. View switching is a plain URL change. The Financial Year select is
 * only a shortcut that fills From and To with a financial year's range - it has no URL param of its own, and the dates can still
 * be edited by hand. `currentFinancialYear` is the centre's current financial year, worked out on the server.
 */
export default function DocumentFilters({ defaultQuery, defaultSeries, defaultStatus, defaultFromDate, defaultToDate, view, currentFinancialYear }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, searchFor } = useLiveSearch(defaultQuery);
  const [series, setSeries] = useState(defaultSeries);
  const [status, setStatus] = useState(defaultStatus);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isNarrow = useSyncExternalStore(subscribeNarrow, getNarrow, getNarrowServer);

  const financialYear = financialYearFilterValue(fromDate, toDate);
  const financialYearItems = financialYearOptions(currentFinancialYear, financialYear);

  const viewItems = VIEWS.map((item) => ({
    ...item,
    href: buildListHref("/documents", searchParams, { view: item.key }),
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
    // Results already follow the field as it is typed; Enter only must not submit the form natively.
    event.preventDefault();
  }

  function setOrDelete(params, key, value, empty) {
    if (value && value !== empty) params.set(key, value);
    else params.delete(key);
  }

  function applyFilters(event) {
    event.preventDefault();
    pushParams((params) => {
      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");
      setOrDelete(params, "series", series, "all");
      setOrDelete(params, "status", status, "all");
      setOrDelete(params, "from", fromDate, "");
      setOrDelete(params, "to", toDate, "");
    });
    setFiltersOpen(false);
  }

  function resetFilterState() {
    setSeries("all");
    setStatus("all");
    setFromDate("");
    setToDate("");
  }

  function clearFilters() {
    resetFilterState();
    pushParams((params) => {
      for (const key of ["series", "status", "from", "to"]) params.delete(key);
    });
    setFiltersOpen(false);
  }

  function clearAllIncludingSearch() {
    setQuery("");
    resetFilterState();
    router.push(pathname);
    setFiltersOpen(false);
  }

  function selectFinancialYear(value) {
    // "Custom Range" only describes hand-edited dates; choosing it changes nothing.
    if (value === FINANCIAL_YEAR_ALL) {
      setFromDate("");
      setToDate("");
      return;
    }
    const range = financialYearRange(Number(value));
    if (!range) return;
    setFromDate(range.from);
    setToDate(range.to);
  }

  function removeAppliedFilter(key) {
    if (key === "series") setSeries("all");
    if (key === "status") setStatus("all");
    if (key === "from" || key === "fy") setFromDate("");
    if (key === "to" || key === "fy") setToDate("");
    // The Financial Year chip stands for both dates.
    pushParams((params) => {
      for (const param of key === "fy" ? ["from", "to"] : [key]) params.delete(param);
    });
  }

  const chips = [];
  if (defaultSeries !== "all") chips.push({ key: "series", label: `Series: ${optionLabel(SERIES_OPTIONS, defaultSeries)}` });
  if (defaultStatus !== "all") chips.push({ key: "status", label: `Status: ${optionLabel(STATUS_OPTIONS, defaultStatus)}` });
  chips.push(...documentDateChips(defaultFromDate, defaultToDate));
  // One per applied chip, so a financial year counts as one filter, not two.
  const activeFilterCount = chips.length;

  return (
    <>
      <ListToolbar
        className="border-0 bg-transparent p-0 shadow-none"
        chips={<FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />}
      >
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <SearchInput
            id="document-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder={isNarrow ? "Search by number, name or code..." : "Search by document number, customer name or code..."}
            inputClassName="h-9 bg-surface"
          />
        </form>

        {/* Filters and Cards / Table share one row on mobile. */}
        <div className="flex items-center gap-3 sm:contents">
          <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} className="flex-1 justify-center bg-surface sm:flex-none" />

          <ViewSwitcher
            items={viewItems}
            active={view || undefined}
            ariaLabel="Document list views"
            separate
            className="flex-[2] sm:flex-none [&>a]:flex-1 [&>a]:justify-center sm:[&>a]:flex-none"
          />
        </div>
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine your document list"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <FilterSection id="document-series" label="Document Series">
          <Select items={SERIES_OPTIONS} value={series} onValueChange={setSeries}>
            <SelectTrigger aria-labelledby="document-series-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SERIES_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        <FilterSection id="document-status" label="Status">
          <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
            <SelectTrigger aria-labelledby="document-status-label" className="w-full">
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

        <FilterSection id="document-financial-year" label="Financial Year">
          <Select items={financialYearItems} value={financialYear} onValueChange={selectFinancialYear}>
            <SelectTrigger aria-labelledby="document-financial-year-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {financialYearItems.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="document-from-date">From Date</Label>
          <Input id="document-from-date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="document-to-date">To Date</Label>
          <Input id="document-to-date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>
      </FilterSheet>
    </>
  );
}
