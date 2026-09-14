import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
import { buildListHref } from "@/lib/url-params";
import ScheduleCardItem from "@/app/schedule/schedule-card-item";
import ScheduleTableRow from "@/app/schedule/schedule-table-row";

const LAYOUTS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function LayoutToggle({ active, searchParams }) {
  return (
    <div
      role="tablist"
      aria-label="Schedule list layouts"
      className="inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {LAYOUTS.map((layout) => {
        const Icon = layout.icon;
        const href = buildListHref("/schedule", searchParams, {
          view: "list",
          layout: layout.key === "cards" ? "" : layout.key,
        });

        return (
          <Link
            key={layout.key}
            href={href}
            role="tab"
            aria-selected={active === layout.key}
            className={
              active === layout.key
                ? "inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-small font-semibold text-text-primary shadow-xs"
                : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-small text-text-secondary hover:text-text-primary"
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {layout.label}
          </Link>
        );
      })}
    </div>
  );
}

function ScheduleCards({ schedules }) {
  return (
    <div
      className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Schedules"
    >
      {schedules.map((schedule) => (
        <ScheduleCardItem key={schedule.id} schedule={schedule} />
      ))}
    </div>
  );
}

function ScheduleTable({ schedules }) {
  return (
    <DataTableShell tone="info">
      <Table aria-label="Schedules">
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
    </DataTableShell>
  );
}

/**
 * Schedule List View results with Cards / Table toggle. Layout is URL-driven
 * (`layout=table` or default cards) and keeps `view=list` so it never
 * collides with the Weekly Schedule / List View toggle. Same data and View
 * action in both layouts; Edit and Deactivate live on Schedule Details.
 */
export default function ScheduleList({ schedules, layout = "cards", searchParams, total }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-medium text-text-primary">
            {total} {total === 1 ? "Schedule" : "Schedules"}
          </p>
          <p className="text-small text-text-secondary">
            {layout === "table" ? "Table view" : "Card list view"}
          </p>
        </div>
        <LayoutToggle active={layout} searchParams={searchParams} />
      </div>

      {layout === "table" ? (
        <ScheduleTable schedules={schedules} />
      ) : (
        <ScheduleCards schedules={schedules} />
      )}
    </div>
  );
}
