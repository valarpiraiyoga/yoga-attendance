import Link from "next/link";
import { CircleCheck, CreditCard, Hourglass, CalendarX, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { KpiStrip, KpiToggle } from "@/components/ui/kpi-visibility";
import { requireRole, ROLES } from "@/lib/auth/dal";
import {
  DEFAULT_MEMBERSHIP_SORT,
  getMembershipSummaryCounts,
  listMemberships,
  todayDateString,
} from "@/lib/memberships/data";
import { formatShare } from "@/lib/format";
import { buildListHref } from "@/lib/url-params";
import MembershipFilters from "@/app/memberships/membership-filters";
import MembershipList from "@/app/memberships/membership-list";

const PAGE_SIZE = 10;
const PLANS = ["monthly", "quarterly", "custom"];
const PAYMENT_STATUSES = ["paid", "pending"];
const MEMBERSHIP_STATUSES = ["upcoming", "active", "expired", "cancelled"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Labels for the "Sort by" control. Every `value` must be a key of
// `MEMBERSHIP_SORTS` (lib/memberships/data.js), which owns the column and
// direction.
const SORT_OPTIONS = [
  { value: "start-newest", label: "Start Date (Newest)" },
  { value: "start-oldest", label: "Start Date (Oldest)" },
];

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
  // "" = no explicit choice: Table from `lg` up, Cards below (resolved in CSS).
  const view = rawParams.view === "cards" || rawParams.view === "table" ? rawParams.view : "";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_MEMBERSHIP_SORT;

  const [{ memberships, total }, counts] = await Promise.all([
    listMemberships({
      q,
      plan,
      paymentStatus,
      membershipStatus,
      fromDate,
      toDate,
      sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    getMembershipSummaryCounts(),
  ]);

  // The same "today" `listMemberships` derived each row's status from, so a
  // card's status and its days-left always agree.
  const today = await todayDateString();

  const isFiltered =
    Boolean(q) || plan !== "all" || paymentStatus !== "all" || membershipStatus !== "all" || Boolean(fromDate) || Boolean(toDate);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        compact
        title="Memberships"
        description="Manage student memberships, plans, validity, and payment status."
        icon={<CreditCard className="size-6" />}
        actions={
          <>
            <KpiToggle pageKey="memberships" />
            <Button render={<Link href="/memberships/new" />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Membership
            </Button>
          </>
        }
        mobileActions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add Membership"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            render={<Link href="/memberships/new" />}
            nativeButton={false}
          >
            <Plus className="size-5" aria-hidden="true" />
          </Button>
        }
      />

      <Container>

      {/* Center-wide counts, independent of the search/filters below.
          Shares are derived from the counts. Expiring Soon = Active with
          EXPIRING_SOON_DAYS or fewer days left. */}
      <div className="max-lg:hidden">
      <KpiStrip pageKey="memberships">
        <StatTileGroup className="mb-6" ariaLabel="Membership summary">
          <StatTile
            valueFirst
            icon={CreditCard}
            label="Total Memberships"
            value={counts.total}
            tone="brand"
          />
          <StatTile
            valueFirst
            icon={CircleCheck}
            label="Active"
            value={counts.active}
            aside={formatShare(counts.active, counts.total)}
            tone="success"
          />
          <StatTile
            valueFirst
            icon={Hourglass}
            label="Expiring Soon"
            value={counts.expiringSoon}
            aside={formatShare(counts.expiringSoon, counts.total)}
            tone="warning"
          />
          <StatTile
            valueFirst
            icon={CalendarX}
            label="Expired"
            value={counts.expired}
            aside={formatShare(counts.expired, counts.total)}
            tone="danger"
          />
        </StatTileGroup>
      </KpiStrip>
      </div>

      <MembershipFilters
        key={`${plan}:${paymentStatus}:${membershipStatus}:${fromDate}:${toDate}`}
        defaultQuery={q}
        defaultPlan={plan}
        defaultPaymentStatus={paymentStatus}
        defaultMembershipStatus={membershipStatus}
        defaultFromDate={fromDate}
        defaultToDate={toDate}
        view={view}
      />

      {memberships.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={isFiltered ? undefined : "No memberships yet"}
          description={
            isFiltered
              ? "No memberships match your search or filters."
              : "Add the first membership to get started."
          }
          action={
            isFiltered ? (
              <Button variant="outline" render={<Link href="/memberships" />} nativeButton={false}>
                Clear Filters
              </Button>
            ) : (
              <Button render={<Link href="/memberships/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Membership
              </Button>
            )
          }
        />
      ) : (
        <>
          <MembershipList
            memberships={memberships}
            view={view}
            total={total}
            today={today}
            sort={sort}
            sortOptions={SORT_OPTIONS}
          />

          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="memberships"
            ariaLabel="Membership list pagination"
            getHref={(targetPage) => buildListHref("/memberships", rawParams, { page: targetPage })}
          />
        </>
      )}
      </Container>
    </>
  );
}
