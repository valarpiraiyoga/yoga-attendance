import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listInstructors } from "@/lib/instructors/data";
import { buildListHref } from "@/lib/url-params";
import InstructorFilters from "@/app/settings/instructors/instructor-filters";
import InstructorList from "@/app/settings/instructors/instructor-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];

const SUCCESS_MESSAGES = {
  created: "Instructor created successfully.",
  updated: "Instructor updated successfully.",
};

function instructorsHref(searchParams, overrides) {
  return buildListHref("/settings/instructors", searchParams, overrides);
}

export default async function InstructorsPage({ searchParams }) {
  // Authorization boundary. app/settings/layout.js also calls requireRole,
  // but a layout does not re-run on client-side navigation between sibling
  // pages, so this page repeats the check itself — see the comment there.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const status = STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);
  const initialMessage = SUCCESS_MESSAGES[rawParams.success] ?? null;

  // Excludes `success` — it marks one redirect, not list state, so it must
  // not persist onto pagination/filter links.
  const { success: _success, ...paginationParams } = rawParams;

  const { instructors, total } = await listInstructors({
    q,
    status,
    page,
    pageSize: PAGE_SIZE,
  });

  const isFiltered = Boolean(q) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <section className="rounded-card border border-border bg-surface p-6 shadow-xs">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-section-title font-semibold text-text-primary">Instructors</h2>
          <p className="text-body mt-1 text-text-secondary">
            Manage instructors who conduct yoga classes.
          </p>
        </div>
        <Button render={<Link href="/settings/instructors/new" />} nativeButton={false}>
          <Plus className="size-4" aria-hidden="true" />
          Add Instructor
        </Button>
      </div>

      <InstructorFilters key={`${q}:${status}`} defaultQuery={q} defaultStatus={status} />

      {instructors.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No instructors match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/settings/instructors" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No instructors yet. Add your first instructor to get started.
              </p>
              <Button render={<Link href="/settings/instructors/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Instructor
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <InstructorList instructors={instructors} initialMessage={initialMessage} />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} instructors
            </p>

            <nav aria-label="Instructor list pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={instructorsHref(paginationParams, { page: page - 1 })} />}
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
                  render={<Link href={instructorsHref(paginationParams, { page: page + 1 })} />}
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
    </section>
  );
}
