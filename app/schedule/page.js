import Link from "next/link";
import { Calendar, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { DEFAULT_SCHEDULE_SORT, listSchedules, listSchedulesForWeek } from "@/lib/schedules/data";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import { buildListHref } from "@/lib/url-params";
import { isValidDateString, getMondayOfWeek, addDaysUTC, todayDateString } from "@/lib/schedules/validation";
import ScheduleFilters from "@/app/schedule/schedule-filters";
import ScheduleList from "@/app/schedule/schedule-list";
import ScheduleTabs from "@/app/schedule/schedule-tabs";
import WeeklySchedule from "@/app/schedule/weekly-schedule";

const PAGE_SIZE = 10;
const STATUSES = ["active", "inactive"];

// Labels for the "Sort by" control. Every `value` must be a key of
// `SCHEDULE_SORTS` (lib/schedules/data.js), which owns the column and direction.
const SORT_OPTIONS = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

// The page heading, description and Add Schedule action stay the same across
// Weekly Schedule and List View (02-ux.md "Schedule screens").
function ScheduleHeader() {
  return (
    <PageHeader
      title="Schedule"
      description="View and manage recurring weekly schedules."
      icon={<Calendar className="size-6" />}
      actions={
        <Button render={<Link href="/schedule/new" />} nativeButton={false}>
          <Plus className="size-4" aria-hidden="true" />
          Add Schedule
        </Button>
      }
    />
  );
}

export default async function SchedulePage({ searchParams }) {
  // Authorization boundary. app/schedule/layout.js also calls requireRole,
  // but a layout does not re-run on client-side navigation between sibling
  // pages — see app/settings/layout.js for the full explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;

  // Weekly Schedule is the approved default view (02-ux.md's Information
  // Architecture: "Weekly Schedule ← Default") — shown unless `?view=list`
  // explicitly asks for the List View below. `?week=` names any date inside
  // the displayed week (defaults to today), normalized to that week's Monday.
  if (rawParams.view !== "list") {
    const requestedDate =
      typeof rawParams.week === "string" && isValidDateString(rawParams.week)
        ? rawParams.week
        : todayDateString();
    const weekStart = getMondayOfWeek(requestedDate);
    const weekEnd = addDaysUTC(weekStart, 6);

    const schedules = await listSchedulesForWeek(weekStart, weekEnd);

    return (
      <>
        <ScheduleHeader />

        <ScheduleTabs active="weekly" />

        <WeeklySchedule weekStart={weekStart} schedules={schedules} />
      </>
    );
  }

  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const status = STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  const page = Math.max(1, Number(rawParams.page) || 1);
  const layout = rawParams.layout === "table" ? "table" : "cards";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_SCHEDULE_SORT;

  const [{ schedules, total }, batchOptions, instructorOptions] = await Promise.all([
    listSchedules({ q, batchId, instructorId, status, sort, page, pageSize: PAGE_SIZE }),
    listBatchOptions(),
    listInstructorOptions(),
  ]);

  const isFiltered = Boolean(q) || Boolean(batchId) || Boolean(instructorId) || status !== "all";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <ScheduleHeader />

      <ScheduleTabs active="list" />

      <ScheduleFilters
        key={`${batchId}:${instructorId}:${status}`}
        defaultQuery={q}
        defaultBatchId={batchId || "all"}
        defaultInstructorId={instructorId || "all"}
        defaultStatus={status}
        layout={layout}
        batchOptions={batchOptions}
        instructorOptions={instructorOptions}
      />

      {schedules.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={isFiltered ? undefined : "No schedules yet"}
          description={
            isFiltered
              ? "No schedules match your search or filters."
              : "Add the first schedule to get started."
          }
          action={
            isFiltered ? (
              <Button variant="outline" render={<Link href="/schedule?view=list" />} nativeButton={false}>
                Clear Filters
              </Button>
            ) : (
              <Button render={<Link href="/schedule/new" />} nativeButton={false}>
                <Plus className="size-4" aria-hidden="true" />
                Add Schedule
              </Button>
            )
          }
        />
      ) : (
        <>
          <ScheduleList
            schedules={schedules}
            layout={layout}
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
            itemLabel="schedules"
            ariaLabel="Schedule list pagination"
            getHref={(targetPage) => buildListHref("/schedule", rawParams, { page: targetPage })}
          />
        </>
      )}
    </>
  );
}
