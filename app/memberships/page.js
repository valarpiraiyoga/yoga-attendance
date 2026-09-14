import Link from "next/link";
import { CreditCard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listMemberships } from "@/lib/memberships/data";
import { buildListHref } from "@/lib/url-params";
import MembershipFilters from "@/app/memberships/membership-filters";
import MembershipList from "@/app/memberships/membership-list";

const PAGE_SIZE = 10;
const PLANS = ["monthly", "quarterly", "custom"];
const PAYMENT_STATUSES = ["paid", "pending"];
const MEMBERSHIP_STATUSES = ["upcoming", "active", "expired", "cancelled"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function membershipsHref(searchParams, overrides) {
  return buildListHref("/memberships", searchParams, overrides);
}

export default async function MembershipsPage({ searchParams }) {
  // Authorization boundary. app/memberships/layout.js also calls
  // requireRole, but a layout does not re-run on client-side navigation
  // between sibling pages — see app/settings/layout.js for the full
  // explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const plan = PLANS.includes(rawParams.plan) ? rawParams.plan : "all";
  const paymentStatus = PAYMENT_STATUSES.includes(rawParams.payment) ? rawParams.payment : "all";
  const membershipStatus = MEMBERSHIP_STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const fromDate = typeof rawParams.from === "string" && DATE_PATTERN.test(rawParams.from) ? rawParams.from : "";
  const toDate = typeof rawParams.to === "string" && DATE_PATTERN.test(rawParams.to) ? rawParams.to : "";
  const page = Math.max(1, Number(rawParams.page) || 1);
  const view = rawParams.view === "table" ? "table" : "cards";

  const { memberships, total } = await listMemberships({
    q,
    plan,
    paymentStatus,
    membershipStatus,
    fromDate,
    toDate,
    page,
    pageSize: PAGE_SIZE,
  });

  const isFiltered =
    Boolean(q) || plan !== "all" || paymentStatus !== "all" || membershipStatus !== "all" || Boolean(fromDate) || Boolean(toDate);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Memberships"
        description="Manage student memberships, plans, validity, and payment status."
        icon={<CreditCard className="size-6" />}
        actions={
          <Button render={<Link href="/memberships/new" />} nativeButton={false}>
            <Plus className="size-4" aria-hidden="true" />
            Add Membership
          </Button>
        }
      />

      <MembershipFilters
        key={`${q}:${plan}:${paymentStatus}:${membershipStatus}:${fromDate}:${toDate}`}
        defaultQuery={q}
        defaultPlan={plan}
        defaultPaymentStatus={paymentStatus}
        defaultMembershipStatus={membershipStatus}
        defaultFromDate={fromDate}
        defaultToDate={toDate}
      />

      {memberships.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No memberships match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/memberships" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No memberships yet. Add the first membership to get started.
              </p>
              <Button render={<Link href="/memberships/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Membership
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <MembershipList
            memberships={memberships}
            view={view}
            searchParams={rawParams}
            total={total}
          />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-small text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} memberships
            </p>

            <nav aria-label="Membership list pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={membershipsHref(rawParams, { page: page - 1 })} />}
                  nativeButton={false}
                >
                  Previous
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
              )}

              <span className="text-small px-1 text-text-secondary">
                Page {page} of {totalPages}
              </span>

              {page < totalPages ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={membershipsHref(rawParams, { page: page + 1 })} />}
                  nativeButton={false}
                >
                  Next
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Next
                </Button>
              )}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
