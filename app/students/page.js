import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listStudents } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import { buildListHref } from "@/lib/url-params";
import StudentFilters from "@/app/students/student-filters";
import StudentList from "@/app/students/student-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];
const MEMBERSHIP_FILTERS = ["active", "expired", "none"];

function studentsHref(searchParams, overrides) {
  return buildListHref("/students", searchParams, overrides);
}

export default async function StudentsPage({ searchParams }) {
  // Authorization boundary. app/students/layout.js also calls requireRole,
  // but a layout does not re-run on client-side navigation between sibling
  // pages, so this page repeats the check itself — see the comment there.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const status = STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const membershipFilter = MEMBERSHIP_FILTERS.includes(rawParams.membership) ? rawParams.membership : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);

  const [{ students, total }, batchOptions] = await Promise.all([
    listStudents({ q, status, batchId, membershipFilter, page, pageSize: PAGE_SIZE }),
    listBatchOptions(),
  ]);

  const isFiltered = Boolean(q) || status !== "all" || Boolean(batchId) || membershipFilter !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Students"
        description="Manage student profiles, memberships, and batch enrollments."
        actions={
          <Button render={<Link href="/students/new" />} nativeButton={false}>
            <Plus className="size-4" aria-hidden="true" />
            Add Student
          </Button>
        }
      />

      <StudentFilters
        key={`${q}:${status}:${batchId}:${membershipFilter}`}
        defaultQuery={q}
        defaultStatus={status}
        defaultBatchId={batchId || "all"}
        defaultMembershipFilter={membershipFilter}
        batchOptions={batchOptions}
      />

      {students.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          {isFiltered ? (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No students match your search or filters.
              </p>
              <Button variant="outline" render={<Link href="/students" />} nativeButton={false}>
                Clear Filters
              </Button>
            </>
          ) : (
            <>
              <p className="text-body max-w-sm text-text-secondary">
                No students yet. Add your first student to get started.
              </p>
              <Button render={<Link href="/students/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Student
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <StudentList students={students} />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-text-secondary">
              Showing {rangeStart}–{rangeEnd} of {total} students
            </p>

            <nav aria-label="Student list pagination" className="flex items-center gap-2">
              {page > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={studentsHref(rawParams, { page: page - 1 })} />}
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
                  render={<Link href={studentsHref(rawParams, { page: page + 1 })} />}
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
