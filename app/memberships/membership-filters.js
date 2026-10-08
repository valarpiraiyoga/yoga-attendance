"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const PLAN_OPTIONS = [
  { value: "all", label: "All Plans" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
  { value: "custom", label: "Custom duration" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "all", label: "All Payment Statuses" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
];

const MEMBERSHIP_STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

// The full search hint is too long for a phone's search field; below `sm` it
// reads "Search by student or membership ID...". `matchMedia` has no server
// value, so the server (and first client) render use the full hint.
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
 * Search + Filters + Cards/Table toggle in one toolbar row — the finalized
 * toolbar shared with Students, Batches and Schedule: four individual
 * surfaces (white, subtle border, one 36px height) with no frame around them,
 * "Sort by" on the results row below (`MembershipList`), and, with no `view`
 * in the URL (`view` is `""`), Table from `lg` up and Cards below (drawn by CSS
 * in the switcher; both segments link with an explicit `?view=`). Search is independent of the filter
 * drawer and live: every keystroke writes the `q` URL param (replacing the
 * history entry, so typing does not pile up back-button steps), and the
 * server re-runs the same `listMemberships` search, so filtering, sorting and
 * pagination stay server-side. The X clears only `q`. Filter apply/clear still
 * writes the same `plan` / `payment` / `status` / `from` / `to` URL params
 * (keyed remount from the page, which no longer includes `q` so the field
 * keeps its focus while results update); view switching is a plain URL change.
 *
 * From Date / To Date both filter Membership Start Date (02-ux.md
 * "Memberships list filters"), not End Date.
 */
export default function MembershipFilters({
  defaultQuery,
  defaultPlan,
  defaultPaymentStatus,
  defaultMembershipStatus,
  defaultFromDate,
  defaultToDate,
  view,
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, searchFor } = useLiveSearch(defaultQuery);
  const [plan, setPlan] = useState(defaultPlan);
  const [paymentStatus, setPaymentStatus] = useState(defaultPaymentStatus);
  const [membershipStatus, setMembershipStatus] = useState(defaultMembershipStatus);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isNarrow = useSyncExternalStore(subscribeNarrow, getNarrow, getNarrowServer);

  const appliedPlan = defaultPlan;
  const appliedPayment = defaultPaymentStatus;
  const appliedStatus = defaultMembershipStatus;
  const appliedFrom = defaultFromDate;
  const appliedTo = defaultToDate;

  const activeFilterCount = [
    appliedPlan !== "all",
    appliedPayment !== "all",
    appliedStatus !== "all",
    Boolean(appliedFrom),
    Boolean(appliedTo),
  ].filter(Boolean).length;

  const viewItems = VIEWS.map((item) => ({
    ...item,
    href: buildListHref("/memberships", searchParams, { view: item.key }),
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
      if (plan !== "all") params.set("plan", plan);
      else params.delete("plan");
      if (paymentStatus !== "all") params.set("payment", paymentStatus);
      else params.delete("payment");
      if (membershipStatus !== "all") params.set("status", membershipStatus);
      else params.delete("status");
      if (fromDate) params.set("from", fromDate);
      else params.delete("from");
      if (toDate) params.set("to", toDate);
      else params.delete("to");
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    setPlan("all");
    setPaymentStatus("all");
    setMembershipStatus("all");
    setFromDate("");
    setToDate("");
    pushParams((params) => {
      params.delete("plan");
      params.delete("payment");
      params.delete("status");
      params.delete("from");
      params.delete("to");
    });
    setFiltersOpen(false);
  }

  function clearAllIncludingSearch() {
    setQuery("");
    setPlan("all");
    setPaymentStatus("all");
    setMembershipStatus("all");
    setFromDate("");
    setToDate("");
    router.push(pathname);
    setFiltersOpen(false);
  }

  function removeAppliedFilter(key) {
    if (key === "plan") setPlan("all");
    if (key === "payment") setPaymentStatus("all");
    if (key === "status") setMembershipStatus("all");
    if (key === "from") setFromDate("");
    if (key === "to") setToDate("");
    pushParams((params) => {
      params.delete(key);
    });
  }

  const chips = [];
  if (appliedPlan !== "all") {
    chips.push({ key: "plan", label: `Plan: ${optionLabel(PLAN_OPTIONS, appliedPlan)}` });
  }
  if (appliedPayment !== "all") {
    chips.push({
      key: "payment",
      label: `Payment: ${optionLabel(PAYMENT_STATUS_OPTIONS, appliedPayment)}`,
    });
  }
  if (appliedStatus !== "all") {
    chips.push({
      key: "status",
      label: `Status: ${optionLabel(MEMBERSHIP_STATUS_OPTIONS, appliedStatus)}`,
    });
  }
  if (appliedFrom) {
    chips.push({ key: "from", label: `From: ${appliedFrom}` });
  }
  if (appliedTo) {
    chips.push({ key: "to", label: `To: ${appliedTo}` });
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
            id="membership-search"
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onClear={() => searchFor("")}
            placeholder={
              isNarrow ? "Search by student or membership ID..." : "Search by student name or membership ID..."
            }
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
            ariaLabel="Membership list views"
            separate
            className="flex-[2] sm:flex-none [&>a]:flex-1 [&>a]:justify-center sm:[&>a]:flex-none"
          />
        </div>
      </ListToolbar>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        description="Refine your membership list"
        onSubmit={applyFilters}
        onClearAll={clearAllIncludingSearch}
      >
        <FilterSection id="membership-plan" label="Plan">
          <Select items={PLAN_OPTIONS} value={plan} onValueChange={setPlan}>
            <SelectTrigger aria-labelledby="membership-plan-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        <FilterSection id="membership-payment" label="Payment Status">
          <Select items={PAYMENT_STATUS_OPTIONS} value={paymentStatus} onValueChange={setPaymentStatus}>
            <SelectTrigger aria-labelledby="membership-payment-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        <FilterSection id="membership-status" label="Membership Status">
          <Select items={MEMBERSHIP_STATUS_OPTIONS} value={membershipStatus} onValueChange={setMembershipStatus}>
            <SelectTrigger aria-labelledby="membership-status-label" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBERSHIP_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="membership-from-date">From Date</Label>
          <Input
            id="membership-from-date"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="membership-to-date">To Date</Label>
          <Input
            id="membership-to-date"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>
      </FilterSheet>
    </>
  );
}
