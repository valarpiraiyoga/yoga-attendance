import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_SCHEDULE_SORT } from "@/lib/schedules/data";
import { groupSchedulesByBatch } from "@/lib/schedules/validation";
import ScheduleBatchGroupCard from "@/app/schedule/schedule-batch-group-card";
import ScheduleTableRow from "@/app/schedule/schedule-table-row";

// Cards view groups by batch (one card per batch, summarized — see
// groupSchedulesByBatch and schedule-batch-group-card.js). Same column cap
// and `items-start` (overriding CardGrid's default `items-stretch`) as the
// finalized Batches card grid, since this card now matches that one's size
// and shape: a batch with a short schedule summary no longer stretches to
// match a taller sibling in the same grid row.
function ScheduleCards({ groups }) {
  return (
    <CardGrid ariaLabel="Schedules, grouped by batch" className="items-start xl:grid-cols-3">
      {groups.map((group) => (
        <ScheduleBatchGroupCard
          key={group.batchId}
          batch={group.batch}
          batchId={group.batchId}
          schedules={group.schedules}
        />
      ))}
    </CardGrid>
  );
}

// Grouped by batch, same as Cards view (groupSchedulesByBatch): each batch is
// its own collapsible card — a trigger bar with the batch identity, schedule
// count and a chevron toggle, and (while expanded) its own self-contained
// table of schedule rows underneath, column labels included. No table or
// column is shared across groups — see schedule-table-row.js
// (`ScheduleBatchGroupTableRows`) for that card's own structure.
function ScheduleTable({ groups }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <ScheduleTableRow key={group.batchId} batch={group.batch} batchId={group.batchId} schedules={group.schedules} />
      ))}
    </div>
  );
}

/**
 * Schedule List View results — Cards / Table is the `layout` URL param
 * decided by `ScheduleFilters`' `ViewSwitcher` (`view` is taken by the
 * Weekly Schedule / List View tabs). Same data and View action in both
 * layouts; Edit and Deactivate live on Schedule Details.
 *
 * `total` is the schedule count across every page (the same figure
 * Pagination's "Showing X–Y of Z schedules" already uses — untouched here).
 * Both Cards and Table now group `schedules` by batch — Table's own grouped
 * card (schedule-table-row.js's `ScheduleBatchGroupTableRows`) is structured
 * differently from Cards' (a trigger bar over a real per-batch table, rather
 * than `EntityCard`), but both render one collapsible/summarized unit per
 * batch. `groups.length` is the number of DISTINCT batches on
 * THIS page's `schedules` — grouping runs on whatever page the server
 * already returned, so it cannot know how many batches exist across other
 * pages. The "N Batches · M Schedules" summary is therefore only shown in
 * Cards view when this page holds every matching schedule
 * (`schedules.length === total`, i.e. pagination is not truncating the
 * result) — otherwise a batch count from one page would misstate the total
 * and the summary falls back to the plain schedule count, same as before
 * grouping existed. Table view's header is unchanged by grouping (still the
 * plain schedule count) since its toolbar was not part of this change.
 */
export default function ScheduleList({ schedules, layout = "cards", total, sort, sortOptions }) {
  const groups = groupSchedulesByBatch(schedules);
  const showBatchSummary = layout === "cards" && schedules.length === total;

  return (
    <div className="mt-6">
      <ResultsHeader
        count={showBatchSummary ? groups.length : total}
        label={
          showBatchSummary
            ? `${groups.length === 1 ? "Batch" : "Batches"} · ${total} ${total === 1 ? "Schedule" : "Schedules"}`
            : total === 1
              ? "Schedule"
              : "Schedules"
        }
        viewLabel={layout === "table" ? "Table view" : "Grouped by batch"}
        aside={
          <SortSelect
            id="schedule-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_SCHEDULE_SORT}
          />
        }
      />

      {layout === "table" ? <ScheduleTable groups={groups} /> : <ScheduleCards groups={groups} />}
    </div>
  );
}
