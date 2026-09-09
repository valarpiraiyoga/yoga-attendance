"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
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

/**
 * Search + Plan + Payment Status + Membership Status + From/To Date filter
 * bar for the Memberships list. Mirrors app/students/student-filters.js's
 * apply-on-submit / keyed-remount pattern exactly — see that file's comment
 * for why filtering applies only on "Apply Filters".
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

  function applyFilters(event) {
    event.preventDefault();

    const params = new URLSearchParams(searchParams);
    const setOrDelete = (key, value, defaultValue = "all") => {
      if (value && value !== defaultValue) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    };

    setOrDelete("q", query.trim(), "");
    setOrDelete("plan", plan);
    setOrDelete("payment", paymentStatus);
    setOrDelete("status", membershipStatus);
    setOrDelete("from", fromDate, "");
    setOrDelete("to", toDate, "");
    params.delete("page");

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearFilters() {
    setQuery("");
    setPlan("all");
    setPaymentStatus("all");
    setMembershipStatus("all");
    setFromDate("");
    setToDate("");
    router.push(pathname);
  }

  return (
    <form
      onSubmit={applyFilters}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background/60 p-4 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5 lg:min-w-[220px]">
        <label
          htmlFor="membership-search"
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
            id="membership-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search student or membership ID"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="membership-plan-label" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Plan
        </span>
        <Select items={PLAN_OPTIONS} value={plan} onValueChange={setPlan}>
          <SelectTrigger aria-labelledby="membership-plan-label" className="w-full sm:w-44">
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
          <SelectTrigger aria-labelledby="membership-payment-label" className="w-full sm:w-48">
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
          <SelectTrigger aria-labelledby="membership-status-label" className="w-full sm:w-44">
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
          className="sm:w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="membership-to-date">To Date</Label>
        <Input
          id="membership-to-date"
          type="date"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
          className="sm:w-40"
        />
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
