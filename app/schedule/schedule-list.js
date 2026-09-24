import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_SCHEDULE_SORT } from "@/lib/schedules/data";
import { cn } from "@/lib/utils";
import ScheduleBatchAccordion from "@/app/schedule/schedule-batch-accordion";
import ScheduleBatchGroupCard from "@/app/schedule/schedule-batch-group-card";

// How many batch groups start expanded in the Table view (the reference opens
// the first two and leaves the rest collapsed).
const INITIALLY_EXPANDED_GROUPS = 2;

/**
 * Schedule List View results: every matching schedule, grouped by batch
 * (`groupSchedulesByBatch`, then ordered by the Sort control — see
 * `sortBatchGroups`). `groups` arrive already grouped and ordered.
 *
 * Cards is the batch-summary card grid; Table is the batch accordions, each
 * over its own schedule table. `layout` is `"cards"`, `"table"`, or `""` (no
 * explicit choice in the URL): then both are rendered and CSS shows Cards
 * below `lg` and Table from `lg` up — the same finalized default rule as
 * Attendance and Attendance History.
 *
 * The summary ("4 Batches · 13 Schedules" / "Grouped by batch") counts the
 * whole filtered set, since the list is no longer paginated. "Sort by" sits on
 * the right of this summary row, below the main toolbar, at every width — with
 * its "Sort by" label and the standard width from `sm` up, and label-less and
 * narrower on a phone so the row never overflows.
 */
export default function ScheduleList({ groups, scheduleCount, layout = "", sort, sortOptions }) {
  const batchCount = groups.length;

  return (
    <div className="mt-5">
      <ResultsHeader
        count={batchCount}
        label={`${batchCount === 1 ? "Batch" : "Batches"} · ${scheduleCount} ${scheduleCount === 1 ? "Schedule" : "Schedules"}`}
        viewLabel="Grouped by batch"
        className="mb-3 flex-row items-start justify-between"
        aside={
          <SortSelect
            id="schedule-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_SCHEDULE_SORT}
            labelClassName="max-sm:sr-only"
            triggerClassName="max-sm:w-36"
          />
        }
      />

      {layout !== "table" ? (
        <CardGrid
          ariaLabel="Schedules, grouped by batch"
          className={cn("items-start xl:grid-cols-3", layout === "" && "lg:hidden")}
        >
          {groups.map((group) => (
            <ScheduleBatchGroupCard
              key={group.batchId}
              batch={group.batch}
              batchId={group.batchId}
              schedules={group.schedules}
            />
          ))}
        </CardGrid>
      ) : null}

      {layout !== "cards" ? (
        <div className={cn("flex flex-col gap-3", layout === "" && "hidden lg:flex")}>
          {groups.map((group, index) => (
            <ScheduleBatchAccordion
              key={group.batchId}
              batch={group.batch}
              batchId={group.batchId}
              schedules={group.schedules}
              defaultExpanded={index < INITIALLY_EXPANDED_GROUPS}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
