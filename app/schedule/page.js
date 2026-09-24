import Link from "next/link";
import { Calendar, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import { requireRole, ROLES } from "@/lib/auth/dal";
import {
  DEFAULT_SCHEDULE_SORT,
  SCHEDULE_LIST_LIMIT,
  SCHEDULE_SORTS,
  listSchedules,
  listSchedulesForWeek,
} from "@/lib/schedules/data";
import { getCentreToday } from "@/lib/center-profile/settings";
import { listBatchOptions } from "@/lib/batches/data";
import { listInstructorOptions } from "@/lib/instructors/data";
import {
  isValidDateString,
  getMondayOfWeek,
  addDaysUTC,
  groupSchedulesByBatch,
  sortBatchGroups,
} from "@/lib/schedules/validation";
import ScheduleFilters from "@/app/schedule/schedule-filters";
import ScheduleList from "@/app/schedule/schedule-list";
import ScheduleTabs from "@/app/schedule/schedule-tabs";
import WeeklySchedule from "@/app/schedule/weekly-schedule";

const STATUSES = ["active", "inactive"];

// Labels for the "Sort by" control. Every `value` must be a key of
// `SCHEDULE_SORTS` (lib/schedules/data.js), which owns the column and direction.
const SORT_OPTIONS = [
  { value: "batch_asc", label: "Batch (A–Z)" },
  { value: "batch_desc", label: "Batch (Z–A)" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

// The page heading, description and Add Schedule action stay the same across
// Weekly Schedule and List View (02-ux.md "Schedule screens"): the compact
// header strip on desktop, and on mobile the top bar (`mobileTitle`
// "Schedule", set by app/schedule/layout.js) with an Add icon on its right.
function ScheduleHeader() {
  return (
    <PageHeader
      compact
      title="Schedule"
      description="View and manage recurring weekly schedules."
      icon={<Calendar className="size-6" />}
      actions={
        <Button render={<Link href="/schedule/new" />} nativeButton={false}>
          <Plus className="size-4" aria-hidden="true" />
          Add Schedule
        </Button>
      }
      mobileActions={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Add Schedule"
          className="text-brand hover:bg-brand/10 hover:text-brand"
          render={<Link href="/schedule/new" />}
          nativeButton={false}
        >
          <Plus className="size-5" aria-hidden="true" />
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
    // The centre's own day (Center Settings) - the default week and the
    // highlighted "today" - never the viewer's.
    const today = await getCentreToday();
    const requestedDate =
      typeof rawParams.week === "string" && isValidDateString(rawParams.week)
        ? rawParams.week
        : today;
    const weekStart = getMondayOfWeek(requestedDate);
    const weekEnd = addDaysUTC(weekStart, 6);

    const schedules = await listSchedulesForWeek(weekStart, weekEnd);

    return (
      <>
        <ScheduleHeader />

        <Container>
          <ScheduleTabs active="weekly" />

          <WeeklySchedule weekStart={weekStart} schedules={schedules} today={today} />
        </Container>
      </>
    );
  }

  const q = typeof rawParams.q === "string" ? rawParams.q : "";
  const batchId = typeof rawParams.batch === "string" ? rawParams.batch : "";
  const instructorId = typeof rawParams.instructor === "string" ? rawParams.instructor : "";
  const status = STATUSES.includes(rawParams.status) ? rawParams.status : "all";
  // `created=N` marks the redirect after Add Schedule created several
  // weekday schedules at once. It is not list state, so it is kept out of the
  // pagination links below.
  const createdCount = Math.min(7, Math.max(0, Math.floor(Number(rawParams.created)) || 0));
  // "" = no explicit choice: Table from `lg` up, Cards below (resolved in CSS).
  const layout = rawParams.layout === "cards" || rawParams.layout === "table" ? rawParams.layout : "";
  const sort = SORT_OPTIONS.some((option) => option.value === rawParams.sort)
    ? rawParams.sort
    : DEFAULT_SCHEDULE_SORT;

  const [{ schedules, total }, batchOptions, instructorOptions] = await Promise.all([
    listSchedules({ q, batchId, instructorId, status, sort, page: 1, pageSize: SCHEDULE_LIST_LIMIT }),
    listBatchOptions(),
    listInstructorOptions(),
  ]);

  const isFiltered = Boolean(q) || Boolean(batchId) || Boolean(instructorId) || status !== "all";
  // Every matching schedule, grouped by batch and ordered by the Sort control
  // (the query's own order stands for Newest / Oldest First).
  const groups = sortBatchGroups(groupSchedulesByBatch(schedules), SCHEDULE_SORTS[sort]?.batchOrder);

  return (
    <>
      <ScheduleHeader />

      <Container>
      <ScheduleTabs active="list" />

      {createdCount > 0 ? (
        <div
          role="status"
          className="mb-4 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {createdCount === 1 ? "Schedule created successfully." : `${createdCount} schedules created successfully.`}
        </div>
      ) : null}

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
            groups={groups}
            scheduleCount={total}
            layout={layout}
            sort={sort}
            sortOptions={SORT_OPTIONS}
          />
          {total > schedules.length ? (
            <p className="mt-4 text-small text-text-secondary">
              Showing the first {schedules.length} of {total} schedules. Narrow the search or filters to see the rest.
            </p>
          ) : null}
        </>
      )}
      </Container>
    </>
  );
}
