import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight, CircleCheck, Clock, Layers, UserPlus, Zap } from "lucide-react";
import { buildMonthGrid, formatMonthLabel, monthOf, shiftMonth } from "@/lib/attendance-history/calendar";
import { describeWhen } from "@/lib/dashboard/activity";
import { cn } from "@/lib/utils";

const PANEL = "rounded-card border border-border bg-surface p-4 shadow-xs";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The Dashboard's month calendar (server-rendered - every control is a link, so
 * the month lives in the URL: `/?month=YYYY-MM`). Today, at the centre, is the
 * solid brand day; a day that has class sessions carries a small dot and opens
 * that date in Attendance -> All Sessions; days with none are plain text.
 *
 * @param {{ month: string, today: string, monthDays: { date: string, count: number }[] }} props
 */
export function DashboardCalendar({ month, today, monthDays }) {
  const countByDate = new Map(monthDays.map((day) => [day.date, day.count]));
  const weeks = buildMonthGrid(month);
  const currentMonth = monthOf(today);
  const monthHref = (delta) => {
    const next = shiftMonth(month, delta);
    return next === currentMonth ? "/" : `/?month=${next}`;
  };

  return (
    <section className={PANEL} aria-label="Calendar">
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-text-primary">{formatMonthLabel(month)}</h2>
        <div className="flex items-center gap-1">
          <Link
            href={monthHref(-1)}
            aria-label="Previous month"
            className="rounded-md p-1 text-text-secondary hover:bg-background hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={monthHref(1)}
            aria-label="Next month"
            className="rounded-md p-1 text-text-secondary hover:bg-background hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <table className="mt-3 w-full table-fixed border-separate border-spacing-y-1 text-center">
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="pb-1 text-[11px] font-medium text-text-secondary">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, index) => (
            <tr key={index}>
              {week.map((cell, cellIndex) => {
                if (!cell) return <td key={cellIndex} />;
                const count = countByDate.get(cell.date) ?? 0;
                const isToday = cell.date === today;
                const face = (
                  <span
                    className={cn(
                      "relative mx-auto flex size-8 items-center justify-center rounded-full text-small",
                      isToday ? "bg-brand font-semibold text-surface" : "text-text-primary",
                      count > 0 && !isToday && "hover:bg-brand/10"
                    )}
                  >
                    {cell.day}
                    {count > 0 ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute bottom-0.5 size-1 rounded-full",
                          isToday ? "bg-surface" : "bg-brand"
                        )}
                      />
                    ) : null}
                  </span>
                );

                return (
                  <td key={cell.date} className="p-0">
                    {count > 0 ? (
                      <Link
                        href={`/attendance?view=all&date=${cell.date}`}
                        aria-label={`${count} ${count === 1 ? "session" : "sessions"} on ${cell.date}`}
                        aria-current={isToday ? "date" : undefined}
                        className="block rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {face}
                      </Link>
                    ) : (
                      <span aria-current={isToday ? "date" : undefined}>{face}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const QUICK_ACTIONS = [
  { label: "Mark Attendance", href: "/attendance", icon: CircleCheck, tone: "bg-success/10 text-success hover:bg-success/15" },
  { label: "Add Student", href: "/students/new", icon: UserPlus, tone: "bg-info/10 text-info hover:bg-info/15" },
  { label: "Create Batch", href: "/batches/new", icon: Layers, tone: "bg-batch-purple/10 text-batch-purple hover:bg-batch-purple/15" },
  { label: "Create Schedule", href: "/schedule/new", icon: CalendarPlus, tone: "bg-warning/10 text-warning hover:bg-warning/15" },
];

/** Shortcuts to the four things an Admin starts most often - each an existing route. */
export function DashboardQuickActions() {
  return (
    <section className={PANEL} aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="flex items-center gap-2 text-body font-semibold text-text-primary">
        <Zap className="size-4 text-warning" aria-hidden="true" />
        Quick Actions
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {QUICK_ACTIONS.map(({ label, href, icon: Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2.5 text-small font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              tone
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 text-text-primary">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const ACTIVITY_DOT = { attendance: "bg-success", student: "bg-brand", membership: "bg-neutral" };

/**
 * The latest few things that happened at the centre, newest first, each with when
 * it happened in the centre's own time zone. An empty list says so plainly.
 *
 * @param {{ items: { kind: string, at: string, title: string, detail: string }[], timeZone: string }} props
 */
export function DashboardRecentActivity({ items, timeZone }) {
  const now = new Date();

  return (
    <section className={PANEL} aria-labelledby="recent-activity-heading">
      <h2 id="recent-activity-heading" className="flex items-center gap-2 text-body font-semibold text-text-primary">
        <Clock className="size-4 text-text-secondary" aria-hidden="true" />
        Recent Activity
      </h2>

      {items.length === 0 ? (
        <p className="text-small mt-3 text-text-secondary">Nothing has happened yet.</p>
      ) : (
        <ol className="mt-3 flex flex-col">
          {items.map((item, index) => (
            <li key={`${item.kind}-${item.at}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
              {index < items.length - 1 ? (
                <span aria-hidden="true" className="absolute top-3 bottom-0 left-[4px] w-px bg-border" />
              ) : null}
              <span
                aria-hidden="true"
                className={cn("relative mt-1.5 size-2.5 shrink-0 rounded-full", ACTIVITY_DOT[item.kind] ?? "bg-neutral")}
              />
              <div className="min-w-0">
                <p className="text-small font-medium text-text-primary">{item.title}</p>
                <p className="text-small truncate text-text-secondary">{item.detail}</p>
                <p className="text-small text-text-secondary">{describeWhen(item.at, now, timeZone)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
