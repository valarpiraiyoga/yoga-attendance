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
import BatchCardItem from "@/app/batches/batch-card-item";
import BatchTableRow from "@/app/batches/batch-table-row";

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function ViewToggle({ active, searchParams }) {
  return (
    <div
      role="tablist"
      aria-label="Batch list views"
      className="inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const href = buildListHref("/batches", searchParams, {
          view: view.key === "cards" ? "" : view.key,
        });

        return (
          <Link
            key={view.key}
            href={href}
            role="tab"
            aria-selected={active === view.key}
            className={
              active === view.key
                ? "inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-small font-semibold text-text-primary shadow-xs"
                : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-small text-text-secondary hover:text-text-primary"
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}

function BatchCards({ batches }) {
  return (
    <DataTableShell tone="info">
      <div
        className="grid grid-cols-1 items-stretch gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4"
        aria-label="Batches"
      >
        {batches.map((batch) => (
          <BatchCardItem key={batch.id} batch={batch} />
        ))}
      </div>
    </DataTableShell>
  );
}

function BatchTable({ batches }) {
  return (
    <DataTableShell tone="info">
      <Table aria-label="Batches">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Batch</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right"># of Schedules</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => (
            <BatchTableRow key={batch.id} batch={batch} />
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}

/**
 * Batch results with Cards / Table toggle. View is URL-driven (`view=table`
 * or default cards). Same data and View action in both layouts; status
 * changes remain on Edit Batch (wireframe p16 ACTION = View only).
 */
export default function BatchList({ batches, view = "cards", searchParams, total }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-medium text-text-primary">
            {total} {total === 1 ? "Batch" : "Batches"}
          </p>
          <p className="text-small text-text-secondary">
            {view === "table" ? "Table view" : "Card list view"}
          </p>
        </div>
        <ViewToggle active={view} searchParams={searchParams} />
      </div>

      {view === "table" ? <BatchTable batches={batches} /> : <BatchCards batches={batches} />}
    </div>
  );
}
