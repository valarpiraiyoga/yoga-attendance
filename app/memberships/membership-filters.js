"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Search is independent of the filter drawer. Filter apply/clear still
 * writes the same `q` / `plan` / `payment` / `status` / `from` / `to`
 * URL params as before (wireframe Memberships list; keyed remount from page).
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
    <div className="rounded-card border border-border bg-surface p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={applySearch} className="min-w-0 flex-1">
          <label htmlFor="membership-search" className="sr-only">
            Search
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-secondary"
              aria-hidden="true"
            />
            <Input
              id="membership-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search student or membership ID"
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
            <SheetDescription className="text-small text-text-secondary">
              Refine your membership list
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={applyFilters} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <div className="flex flex-col gap-1.5">
                <span
                  id="membership-plan-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Plan
                </span>
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
              </div>

              <div className="flex flex-col gap-1.5">
                <span
                  id="membership-payment-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Payment Status
                </span>
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
              </div>

              <div className="flex flex-col gap-1.5">
                <span
                  id="membership-status-label"
                  className="text-small font-medium tracking-wide text-text-secondary uppercase"
                >
                  Membership Status
                </span>
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
              </div>

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
