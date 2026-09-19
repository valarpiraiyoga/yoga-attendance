import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel } from "@/components/layout/Panel";
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_SCHEDULE_SORT } from "@/lib/schedules/data";
import ScheduleCardItem from "@/app/schedule/schedule-card-item";
import ScheduleTableRow from "@/app/schedule/schedule-table-row";

function ScheduleCards({ schedules }) {
  return (
    <CardGrid ariaLabel="Schedules">
      {schedules.map((schedule) => (
        <ScheduleCardItem key={schedule.id} schedule={schedule} />
      ))}
    </CardGrid>
  );
}

function ScheduleTable({ schedules }) {
  return (
    <Panel className="overflow-hidden p-0 sm:p-0">
      {/* Eight columns: tighter cell padding (12px vs the default 20px) so the
          table fits a ~960px content column before it has to scroll. */}
      <Table aria-label="Schedules" className="[&_td]:px-3 [&_th]:px-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Batch</TableHead>
            <TableHead>Day</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Effective From</TableHead>
            <TableHead>Effective Until</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules.map((schedule) => (
            <ScheduleTableRow key={schedule.id} schedule={schedule} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * Schedule List View results — Cards / Table is the `layout` URL param
 * decided by `ScheduleFilters`' `ViewSwitcher` (`view` is taken by the
 * Weekly Schedule / List View tabs). Same data and View action in both
 * layouts; Edit and Deactivate live on Schedule Details.
 */
export default function ScheduleList({ schedules, layout = "cards", total, sort, sortOptions }) {
  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Schedule" : "Schedules"}
        viewLabel={layout === "table" ? "Table view" : "Card list view"}
        aside={
          <SortSelect
            id="schedule-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_SCHEDULE_SORT}
          />
        }
      />

      {layout === "table" ? <ScheduleTable schedules={schedules} /> : <ScheduleCards schedules={schedules} />}
    </div>
  );
}
