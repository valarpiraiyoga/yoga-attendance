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
import { DEFAULT_SESSION_SORT } from "@/lib/class-sessions/data";
import { todayInCentreTimezone } from "@/lib/class-sessions/validation";
import SessionCardItem from "@/app/attendance/session-card-item";
import SessionTableRow from "@/app/attendance/session-table-row";

function sessionKey(session) {
  return session.id ?? `${session.schedule_id}:${session.session_date}`;
}

function SessionCards({ sessions, today, showDate, ariaLabel }) {
  return (
    <CardGrid ariaLabel={ariaLabel}>
      {sessions.map((session) => (
        <SessionCardItem key={sessionKey(session)} session={session} today={today} showDate={showDate} />
      ))}
    </CardGrid>
  );
}

function SessionTable({ sessions, today, showDate, ariaLabel }) {
  return (
    <Panel className="overflow-hidden p-0 sm:p-0">
      {/* Tighter cell padding (12px vs the default 20px) so the wider All
          Sessions table fits a ~960px content column before it scrolls. */}
      <Table aria-label={ariaLabel} className="[&_td]:px-3 [&_th]:px-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showDate ? <TableHead>Date</TableHead> : null}
            <TableHead>Time</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Eligible</TableHead>
            <TableHead>Session Status</TableHead>
            <TableHead>Attendance</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <SessionTableRow key={sessionKey(session)} session={session} today={today} showDate={showDate} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

/**
 * Session results for both Attendance views — Cards / Table is the `layout`
 * URL param decided by `AttendanceFilters`' `ViewSwitcher`. `mode="all"`
 * adds the Date column / row (All Sessions); `mode="today"` omits it since
 * every Today's Sessions row is already today. Same data and actions in both
 * layouts.
 */
export default function SessionList({ mode, sessions, layout = "cards", total, sort, sortOptions }) {
  const showDate = mode === "all";
  const ariaLabel = showDate ? "All Sessions" : "Today's Sessions";
  const today = todayInCentreTimezone();

  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Session" : "Sessions"}
        viewLabel={layout === "table" ? "Table view" : "Card list view"}
        aside={
          <SortSelect
            id="session-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_SESSION_SORT}
          />
        }
      />

      {layout === "table" ? (
        <SessionTable sessions={sessions} today={today} showDate={showDate} ariaLabel={ariaLabel} />
      ) : (
        <SessionCards sessions={sessions} today={today} showDate={showDate} ariaLabel={ariaLabel} />
      )}
    </div>
  );
}
