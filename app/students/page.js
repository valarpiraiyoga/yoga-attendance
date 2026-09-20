import Link from "next/link";
import { Layers, Plus, UserCheck, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { StatTile, StatTileGroup } from "@/components/ui/stat-tile";
import { KpiStrip, KpiToggle } from "@/components/ui/kpi-visibility";
import { requireRole, ROLES } from "@/lib/auth/dal";
import {
  DEFAULT_STUDENT_SORT,
  getActiveStudentCount,
  getInactiveStudentCount,
  listStudents,
} from "@/lib/students/data";
import { getTotalBatchCount, listBatchOptions } from "@/lib/batches/data";
import { buildListHref } from "@/lib/url-params";
import StudentFilters from "@/app/students/student-filters";
import StudentList from "@/app/students/student-list";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];
const MEMBERSHIP_FILTERS = ["active", "expired", "none"];

// Labels for the "Sort by" control. Every `value` must be a key of
// `STUDENT_SORTS` (lib/students/data.js), which owns the column/direction.
const SORT_OPTIONS = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

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
  const view = rawParams.view === "table" ? "table" : "cards";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_STUDENT_SORT;

  const [
    { students, total },
    batchOptions,
    activeStudentCount,
    inactiveStudentCount,
    totalBatchCount,
  ] = await Promise.all([
    listStudents({ q, status, batchId, membershipFilter, sort, page, pageSize: PAGE_SIZE }),
    listBatchOptions(),
    getActiveStudentCount(),
    getInactiveStudentCount(),
    getTotalBatchCount(),
  ]);

  const isFiltered = Boolean(q) || status !== "all" || Boolean(batchId) || membershipFilter !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The summary tiles are center-wide, independent of the search/filters
  // below. `status` is constrained to active | inactive, so the two counts
  // sum to the total. Shares are derived, never stored.
  const totalStudentCount = activeStudentCount + inactiveStudentCount;
  const sharePercent = (count) =>
    totalStudentCount > 0 ? `${Math.round((count / totalStudentCount) * 100)}%` : null;

  return (
    <>
      <PageHeader
        title="Students"
        description="Manage student profiles, memberships, and batch enrollments."
        icon={<Users className="size-6" />}
        actions={
          <>
            <KpiToggle pageKey="students" />
            <Button render={<Link href="/students/new" />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Student
            </Button>
          </>
        }
      />

      <KpiStrip pageKey="students">
        <StatTileGroup className="mb-6" ariaLabel="Student summary">
          <StatTile valueFirst decorativeChart icon={Users} label="Total Students" value={totalStudentCount} tone="brand" />
          <StatTile
            valueFirst
            decorativeChart
            icon={UserCheck}
            label="Active Students"
            value={activeStudentCount}
            aside={sharePercent(activeStudentCount)}
            tone="success"
          />
          <StatTile
            valueFirst
            decorativeChart
            icon={UserX}
            label="Inactive Students"
            value={inactiveStudentCount}
            aside={sharePercent(inactiveStudentCount)}
            tone="warning"
          />
          <StatTile valueFirst decorativeChart icon={Layers} label="Total Batches" value={totalBatchCount} tone="info" />
        </StatTileGroup>
      </KpiStrip>

      <StudentFilters
        key={`${status}:${batchId}:${membershipFilter}`}
        defaultQuery={q}
        defaultStatus={status}
        defaultBatchId={batchId || "all"}
        defaultMembershipFilter={membershipFilter}
        batchOptions={batchOptions}
        view={view}
      />

      {students.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={isFiltered ? undefined : "No students yet"}
          description={
            isFiltered
              ? "No students match your search or filters."
              : "Add your first student to get started."
          }
          action={
            isFiltered ? (
              <Button variant="outline" render={<Link href="/students" />} nativeButton={false}>
                Clear Filters
              </Button>
            ) : (
              <Button render={<Link href="/students/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Student
              </Button>
            )
          }
        />
      ) : (
        <>
          <StudentList
            students={students}
            view={view}
            total={total}
            sort={sort}
            sortOptions={SORT_OPTIONS}
          />

          <Pagination
            className="mt-4"
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel="students"
            ariaLabel="Student list pagination"
            getHref={(targetPage) => buildListHref("/students", rawParams, { page: targetPage })}
          />
        </>
      )}
    </>
  );
}
