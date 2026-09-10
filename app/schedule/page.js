import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listSchedules } from "@/lib/schedules/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { buildListHref } from "@/lib/url-params";
import ScheduleFilters from "@/app/schedule/schedule-filters";
import ScheduleList from "@/app/schedule/schedule-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];

function scheduleHref(searchParams, overrides) {
  return buildListHref("/schedule", searchParams, overrides);
}

export default async function SchedulePage({ searchParams }) {
  // Authorization boundary. app/schedule/layout.js also calls requireRole,
  // but a layout does not re-run on client-side navigation between sibling
  // pages — see app/settings/layout.js for the full explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const status = STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);

  const [{ schedules, total }, batchOptions, instructorOptions] = await Promise.all([
    listSchedules({ q, batchId, instructorId, status, page, pageSize: PAGE_SIZE }),
    listBatchOptions(),
    listInstructorOptions(),
  ]);

  const isFiltered = Boolean(q) || Boolean(batchId) || Boolean(instructorId) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Schedule"
        description="View and manage recurring weekly schedules."
        actions={
          <Button render={<Link href="/schedule/new" />} nativeButton={false}>
            <Plus className="size-4" aria-hidden="true" />
            Add Schedule
          </Button>
        }
      />

      <ScheduleFilters
        key={`${q}:${batchId}:${instructorId}:${status}`}
        defaultQuery={q}
        defaultBatchId={batchId || "all"}
        defaultInstructorId={instructorId || "all"}
        defaultStatus={status}
        batchOptions={batchOptions}
        instructorOptions={instructorOptions}
      />

      {schedules.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No schedules match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/schedule" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No schedules yet. Add the first schedule to get started.
              </p>
              <Button render={<Link href="/schedule/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Schedule
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <ScheduleList schedules={schedules} />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} schedules
            </p>

            <nav aria-label="Schedule list pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={scheduleHref(rawParams, { page: page - 1 })} />}
                  nativeButton={false}
                >
                  Previous
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
              )}

              <span className="text-body px-1 text-text-secondary">
                Page {page} of {totalPages}
              </span>

              {page < totalPages ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={scheduleHref(rawParams, { page: page + 1 })} />}
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
