import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import TabContentHeading from "@/components/layout/TabContentHeading";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { DEFAULT_INSTRUCTOR_SORT, listInstructors } from "@/lib/instructors/data";
import { buildListHref } from "@/lib/url-params";
import InstructorFilters from "@/app/settings/instructors/instructor-filters";
import InstructorList from "@/app/settings/instructors/instructor-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];

// Labels for the "Sort by" control. Every `value` must be a key of
// `INSTRUCTOR_SORTS` (lib/instructors/data.js), which owns the column and direction.
const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

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
  const view = rawParams.view === "table" ? "table" : "cards";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_INSTRUCTOR_SORT;
  const initialMessage = SUCCESS_MESSAGES[rawParams.success] ?? null;

  // Excludes `success` — it marks one redirect, not list state, so it must
  // not persist onto pagination/filter links.
  const { success: _success, ...paginationParams } = rawParams;

  const { instructors, total } = await listInstructors({
    q,
    status,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  const isFiltered = Boolean(q) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <TabContentHeading
          icon={Users}
          title="Instructors"
          description="Manage instructors who conduct yoga classes."
        />
        <Button render={<Link href="/settings/instructors/new" />} nativeButton={false}>
          <Plus className="size-4" aria-hidden="true" />
          Add Instructor
        </Button>
      </div>

      <InstructorFilters key={status} defaultQuery={q} defaultStatus={status} view={view} />

      {instructors.length === 0 ? (
        <EmptyState
          className="mt-6"
          description={
            isFiltered
              ? "No instructors match your search or filters."
              : "No instructors yet. Add your first instructor to get started."
          }
          action={
            isFiltered ? (
              <Button variant="outline" render={<Link href="/settings/instructors" />} nativeButton={false}>
                Clear Filters
              </Button>
            ) : (
              <Button render={<Link href="/settings/instructors/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Instructor
              </Button>
            )
          }
        />
      ) : (
        <>
          <InstructorList
            instructors={instructors}
            total={total}
            view={view}
            sort={sort}
            sortOptions={SORT_OPTIONS}
            defaultSort={DEFAULT_INSTRUCTOR_SORT}
            initialMessage={initialMessage}
          />

          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="instructors"
            ariaLabel="Instructor list pagination"
            getHref={(targetPage) => instructorsHref(paginationParams, { page: targetPage })}
          />
        </>
      )}
    </div>
  );
}
