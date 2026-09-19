"use client";

import { useState } from "react";
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
import ViewSwitcher from "@/components/ui/view-switcher";
import { FilterBar, FilterChips, FilterSheet, FilterSection } from "@/components/ui/filter-bar";
import { ListToolbar } from "@/components/layout/list-page";
import { buildListHref } from "@/lib/url-params";

const PLAN_OPTIONS = [
  { value: "all", label: "All Plans" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
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

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search + Filters + Cards/Table toggle in one toolbar row (the same
 * composition as `StudentFilters`). Search is independent of the filter
 * drawer. Filter apply/clear still writes the same `q` / `plan` / `payment`
 * / `status` / `from` / `to` URL params as before (keyed remount from the
 * page); view switching is a plain URL change.
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
  const [query, setQuery] = useState(defaultQuery);
  const [plan, setPlan] = useState(defaultPlan);
  const [paymentStatus, setPaymentStatus] = useState(defaultPaymentStatus);
  const [membershipStatus, setMembershipStatus] = useState(defaultMembershipStatus);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    href: buildListHref("/memberships", searchParams, { view: item.key === "cards" ? "" : item.key }),
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
        chips={
          <FilterChips chips={chips} onRemove={removeAppliedFilter} onClearAll={clearFilters} className="mt-3" />
        }
      >
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <SearchInput
            id="membership-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search student or membership ID"
          />
        </form>

        <FilterBar activeCount={activeFilterCount} onClick={() => setFiltersOpen(true)} />

        <ViewSwitcher items={viewItems} active={view} ariaLabel="Membership list views" />
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
