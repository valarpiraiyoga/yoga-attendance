import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listBatches } from "@/lib/batches/data";
import { buildListHref } from "@/lib/url-params";
import BatchFilters from "@/app/batches/batch-filters";
import BatchList from "@/app/batches/batch-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];

function batchesHref(searchParams, overrides) {
  return buildListHref("/batches", searchParams, overrides);
}

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

  const { batches, total } = await listBatches({ q, status, page, pageSize: PAGE_SIZE });

  const isFiltered = Boolean(q) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Batches"
        description="Manage yoga batches and their active status."
        icon={<Layers className="size-6" />}
        actions={
          <Button render={<Link href="/batches/new" />} nativeButton={false}>
            <Plus className="size-4" aria-hidden="true" />
            Add Batch
          </Button>
        }
      />

      <BatchFilters key={`${q}:${status}`} defaultQuery={q} defaultStatus={status} />

      {batches.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No batches match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/batches" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No batches yet. Add your first batch to get started.
              </p>
              <Button render={<Link href="/batches/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Batch
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <BatchList batches={batches} view={view} searchParams={rawParams} total={total} />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-small text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} batches
            </p>

            <nav aria-label="Batch list pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={batchesHref(rawParams, { page: page - 1 })} />}
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
                  render={<Link href={batchesHref(rawParams, { page: page + 1 })} />}
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
