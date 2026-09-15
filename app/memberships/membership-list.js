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
import MembershipCardItem from "@/app/memberships/membership-card-item";
import MembershipTableRow from "@/app/memberships/membership-table-row";

const VIEWS = [
  { key: "cards", label: "Cards", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
];

function ViewToggle({ active, searchParams }) {
  return (
    <div
      role="tablist"
      aria-label="Membership list views"
      className="inline-flex gap-1 rounded-lg border border-border bg-background/60 p-1"
    >
      {VIEWS.map((view) => {
        const Icon = view.icon;
        const href = buildListHref("/memberships", searchParams, {
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

function MembershipCards({ memberships }) {
  return (
    <DataTableShell tone="info">
      <div
        className="grid grid-cols-1 items-stretch gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4"
        aria-label="Memberships"
      >
        {memberships.map((membership) => (
          <MembershipCardItem key={membership.id} membership={membership} />
        ))}
      </div>
    </DataTableShell>
  );
}

function MembershipTable({ memberships }) {
  return (
    <DataTableShell tone="info">
      <Table aria-label="Memberships">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Membership</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Start Date</TableHead>
            <TableHead>End Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <MembershipTableRow key={membership.id} membership={membership} />
          ))}
        </TableBody>
      </Table>
    </DataTableShell>
  );
}

/**
 * Membership results with Cards / Table toggle. View is URL-driven
 * (`view=table` or default cards). Same data and View action in both layouts;
 * Edit / Renew / Cancel remain on Membership Details.
 */
export default function MembershipList({ memberships, view = "cards", searchParams, total }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body font-medium text-text-primary">
            {total} {total === 1 ? "Membership" : "Memberships"}
          </p>
          <p className="text-small text-text-secondary">
            {view === "table" ? "Table view" : "Card list view"}
          </p>
        </div>
        <ViewToggle active={view} searchParams={searchParams} />
      </div>

      {view === "table" ? (
        <MembershipTable memberships={memberships} />
      ) : (
        <MembershipCards memberships={memberships} />
      )}
    </div>
  );
}
