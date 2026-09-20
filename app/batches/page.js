import Link from "next/link";
import { CalendarCheck, CircleCheck, Clock, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { KpiStrip, KpiToggle } from "@/components/ui/kpi-visibility";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { DEFAULT_BATCH_SORT, getBatchSummaryCounts, listBatches } from "@/lib/batches/data";
import { formatShare } from "@/lib/format";
import { buildListHref } from "@/lib/url-params";
import BatchFilters from "@/app/batches/batch-filters";
import BatchList from "@/app/batches/batch-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "upcoming", "completed", "inactive"];

// Labels for the "Sort by" control. Every `value` must be a key of
// `BATCH_SORTS` (lib/batches/data.js), which owns the column and direction.
const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

export default async function BatchesPage({ searchParams }) {
  // Authorization boundary. app/batches/layout.js also calls requireRole,
  // but a layout does not re-run on client-side navigation between sibling
  // pages, so this page repeats the check itself — see the comment there.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const status = STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);
  const view = rawParams.view === "table" ? "table" : "cards";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_BATCH_SORT;

  const [{ batches, total }, counts] = await Promise.all([
    listBatches({ q, status, sort, page, pageSize: PAGE_SIZE }),
    getBatchSummaryCounts(),
  ]);

  const isFiltered = Boolean(q) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Batches"
        description="Manage yoga batches and their active status."
        icon={<Layers className="size-6" />}
        actions={
          <>
            <KpiToggle pageKey="batches" />
            <Button render={<Link href="/batches/new" />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Batch
            </Button>
          </>
        }
      />

      {/* Center-wide counts, independent of the search/filters below, from the
          same derived statuses as the badge and the Status filter (Active /
          Upcoming / Completed come from each batch's schedules). Shares are
          derived from the counts. */}
      <KpiStrip pageKey="batches">
        <StatTileGroup className="mb-6" ariaLabel="Batch summary">
          <StatTile valueFirst decorativeChart icon={Layers} label="Total Batches" value={counts.total} tone="brand" />
          <StatTile
            valueFirst
            decorativeChart
            icon={CircleCheck}
            label="Active Batches"
            value={counts.active}
            aside={formatShare(counts.active, counts.total)}
            tone="success"
          />
          <StatTile
            valueFirst
            decorativeChart
            icon={Clock}
            label="Upcoming"
            value={counts.upcoming}
            aside={formatShare(counts.upcoming, counts.total)}
            tone="warning"
          />
          <StatTile
            valueFirst
            decorativeChart
            icon={CalendarCheck}
            label="Completed"
            value={counts.completed}
            aside={formatShare(counts.completed, counts.total)}
            tone="info"
          />
        </StatTileGroup>
      </KpiStrip>

      <BatchFilters key={status} defaultQuery={q} defaultStatus={status} view={view} />

      {batches.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={isFiltered ? undefined : "No batches yet"}
          description={
            isFiltered ? "No batches match your search or filters." : "Add your first batch to get started."
          }
          action={
            isFiltered ? (
              <Button variant="outline" render={<Link href="/batches" />} nativeButton={false}>
                Clear Filters
              </Button>
            ) : (
              <Button render={<Link href="/batches/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Batch
              </Button>
            )
          }
        />
      ) : (
        <>
          <BatchList batches={batches} view={view} total={total} sort={sort} sortOptions={SORT_OPTIONS} />

          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="batches"
            ariaLabel="Batch list pagination"
            getHref={(targetPage) => buildListHref("/batches", rawParams, { page: targetPage })}
          />
        </>
      )}
    </>
  );
}
