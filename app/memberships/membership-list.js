import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <div
      className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Memberships"
    >
      {memberships.map((membership) => (
        <MembershipCardItem key={membership.id} membership={membership} />
      ))}
    </div>
  );
}

function MembershipTable({ memberships }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-r from-info/10 via-surface to-brand/10 p-2 shadow-xs sm:p-3">
      <div className="overflow-hidden rounded-xl bg-surface/55 backdrop-blur-sm">
        <Table aria-label="Memberships">
          <TableHeader className="bg-transparent">
            <TableRow className="border-border/40 hover:bg-transparent">
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Membership
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Student
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Start Date
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                End Date
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Amount
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Payment
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Status
              </TableHead>
              <TableHead className="h-12 px-5 text-small font-medium tracking-wide text-text-secondary uppercase">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberships.map((membership) => (
              <MembershipTableRow key={membership.id} membership={membership} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
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
