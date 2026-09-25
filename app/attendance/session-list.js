import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_SESSION_SORT } from "@/lib/class-sessions/data";
import { cn } from "@/lib/utils";
import SessionCardItem from "@/app/attendance/session-card-item";
import SessionTable from "@/app/attendance/session-table";

function sessionKey(session) {
  return session.id ?? `${session.schedule_id}:${session.session_date}`;
}

/**
 * Today's Sessions results — the shared session card / table
 * (`SessionCardItem`, `SessionTable`, the same ones every All Sessions date
 * group uses). `layout` is `"cards"`, `"table"`, or `""` (no explicit choice
 * in the URL): then both are rendered and CSS shows Cards below `lg` and Table
 * from `lg` up, the same finalized default rule as Attendance History.
 */
export default function SessionList({ sessions, layout = "", total, sort, sortOptions, today, timeZone, isAdmin = false }) {
  const ariaLabel = "Today's Sessions";

  return (
    <div className="mt-6">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Session" : "Sessions"}
        aside={
          <SortSelect id="session-sort" options={sortOptions} value={sort} defaultValue={DEFAULT_SESSION_SORT} />
        }
        className="mb-3 flex-row items-center justify-between"
      />

      {layout !== "table" ? (
        <CardGrid ariaLabel={ariaLabel} className={cn("xl:grid-cols-3", layout === "" && "lg:hidden")}>
          {sessions.map((session) => (
            <SessionCardItem key={sessionKey(session)} session={session} today={today} timeZone={timeZone} isAdmin={isAdmin} />
          ))}
        </CardGrid>
      ) : null}
      {layout !== "cards" ? (
        <div className={cn(layout === "" && "hidden lg:block")}>
          <SessionTable sessions={sessions} today={today} timeZone={timeZone} ariaLabel={ariaLabel} isAdmin={isAdmin} />
        </div>
      ) : null}
    </div>
  );
}
