import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_HISTORY_SORT } from "@/lib/attendance-history/data";
import HistorySessionCard from "@/app/attendance-history/history-session-card";
import HistoryTableRow from "@/app/attendance-history/history-table-row";

// A light table-in-panel border (matching the pattern already established on
// Batch Overview / Students / Schedules and Membership Detail), not the
// heavier `DataTableShell` card — `bg-surface` is explicit here since, unlike
// those detail-page tables, this one is not already sitting inside a `Panel`.
const TABLE_WRAPPER_CLASS = "overflow-hidden rounded-lg border border-border bg-surface";

function AdminTable({ sessions, hideBatch }) {
  return (
    <div className={TABLE_WRAPPER_CLASS}>
      <Table aria-label="Attendance History">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="whitespace-nowrap">Date</TableHead>
            <TableHead className="whitespace-nowrap">Time</TableHead>
            {!hideBatch ? <TableHead className="sm:w-[18%]">Batch</TableHead> : null}
            <TableHead className="sm:w-[16%]">Instructor</TableHead>
            <TableHead className="text-right">Eligible</TableHead>
            <TableHead className="text-right">Present</TableHead>
            <TableHead className="text-right">Absent</TableHead>
            <TableHead className="text-right">Attendance</TableHead>
            <TableHead className="w-px px-3 whitespace-nowrap sm:px-4">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <HistoryTableRow key={session.id} session={session} variant="admin" hideBatch={hideBatch} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InstructorTable({ sessions }) {
  return (
    <div className={TABLE_WRAPPER_CLASS}>
      <Table aria-label="Attendance History">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="whitespace-nowrap">Date</TableHead>
            <TableHead className="whitespace-nowrap">Time</TableHead>
            <TableHead className="sm:w-[20%]">Batch / Class</TableHead>
            <TableHead className="text-right">Eligible</TableHead>
            <TableHead className="text-right">Present</TableHead>
            <TableHead className="text-right">Absent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-px px-3 whitespace-nowrap sm:px-4">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <HistoryTableRow key={session.id} session={session} variant="instructor" />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HistoryCards({ sessions, variant }) {
  return (
    // Three columns at every width from `lg` up (the reference's density): the
    // date tile takes 64px of each card's header, so a fourth column at `xl`
    // would truncate most batch names.
    <CardGrid ariaLabel="Attendance History" className="xl:grid-cols-3">
      {sessions.map((session) => (
        <HistorySessionCard key={session.id} session={session} variant={variant} />
      ))}
    </CardGrid>
  );
}

/**
 * Attendance History results — TABLE is the default / primary desktop view
 * (data-review screen). Cards remain available via `layout=cards`; the
 * Cards / Table switch itself lives in `AttendanceHistoryFilters`'
 * `ViewSwitcher`, beside search and Filters.
 *
 * `hideBatch` drops the admin table's Batch column for pages already scoped
 * to one batch (Batch Details → Attendance); the default keeps it.
 */
export default function HistoryList({
  sessions,
  total,
  variant = "admin",
  layout = "table",
  sort,
  sortOptions,
  hideBatch = false,
}) {
  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Session" : "Sessions"}
        viewLabel={layout === "cards" ? "Card list view" : "Table view"}
        aside={
          <SortSelect
            id="history-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_HISTORY_SORT}
          />
        }
      />

      {layout === "cards" ? (
        <HistoryCards sessions={sessions} variant={variant} />
      ) : variant === "admin" ? (
        <AdminTable sessions={sessions} hideBatch={hideBatch} />
      ) : (
        <InstructorTable sessions={sessions} />
      )}
    </div>
  );
}
