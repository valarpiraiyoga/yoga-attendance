import Link from "next/link";
import { Package } from "lucide-react";
import MobileHeaderAction from "@/components/layout/MobileHeaderAction";
import TabContentHeading from "@/components/layout/TabContentHeading";
import AnimatedBorder from "@/components/ui/animated-border";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString } from "@/lib/memberships/data";
import { getPackages } from "@/lib/packages/data";
import { KIND_LABELS, currentFeeEntry, formatFee, nextScheduledEntry, termsSummary } from "@/lib/packages/labels";
import { AddPackageButton } from "@/app/settings/packages/package-dialogs";
import { cn } from "@/lib/utils";

// As every list: rounded row cards on the page background under a pale header strip, with the shared hover border.
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-3 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border bg-surface px-3 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";

function PackageTile() {
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
      <Package className="size-5" />
    </span>
  );
}

function StatusBadge({ status }) {
  return <Badge variant={status === "active" ? "success" : "neutral"}>{status === "active" ? "Active" : "Inactive"}</Badge>;
}

function feeText(pkg, today) {
  const current = currentFeeEntry(pkg.package_fee_entries, today);
  if (current) return formatFee(current);
  return nextScheduledEntry(pkg.package_fee_entries, today) ? "Scheduled" : "No fee set";
}

export default async function PackagesPage() {
  // Authorization boundary - see app/settings/layout.js for why it is repeated here.
  await requireRole(ROLES.ADMIN);

  const [packages, today] = await Promise.all([getPackages(), todayDateString()]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <TabContentHeading
          icon={Package}
          title="Packages & Fees"
          description="Manage the packages you sell, their duration options and class allowances, and their fee history."
        />
        <AddPackageButton className="max-lg:hidden" />
        <MobileHeaderAction>
          <AddPackageButton className="lg:hidden" />
        </MobileHeaderAction>
      </div>

      {packages.length === 0 ? (
        <EmptyState description="No packages yet. Add your first package, then schedule its fee." action={<AddPackageButton />} />
      ) : (
        <>
          <div className="max-md:hidden">
            <Table aria-label="Packages" className="border-separate border-spacing-y-2">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className={HEAD}>Package</TableHead>
                  <TableHead className={HEAD}>Type</TableHead>
                  <TableHead className={HEAD}>Offers</TableHead>
                  <TableHead className={HEAD}>Current fee</TableHead>
                  <TableHead className={HEAD}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow
                    key={pkg.id}
                    className="card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent"
                  >
                    <TableCell className={CELL}>
                      <AnimatedBorder />
                      <span className="flex min-w-0 items-center gap-3">
                        <PackageTile />
                        <Link href={`/settings/packages/${pkg.id}`} className="rounded-sm font-semibold text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                          {pkg.name}
                        </Link>
                      </span>
                    </TableCell>
                    <TableCell className={cn(CELL, "text-text-secondary")}>{KIND_LABELS[pkg.kind]}</TableCell>
                    <TableCell className={cn(CELL, "text-text-secondary")}>{termsSummary(pkg)}</TableCell>
                    <TableCell className={cn(CELL, "font-semibold text-text-primary tabular-nums")}>{feeText(pkg, today)}</TableCell>
                    <TableCell className={CELL}>
                      <StatusBadge status={pkg.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="flex flex-col gap-3 md:hidden">
            {packages.map((pkg) => (
              <li key={pkg.id}>
                <Link href={`/settings/packages/${pkg.id}`} className="card-border-animated block rounded-card border border-border bg-surface p-4 shadow-xs transition-shadow hover:shadow-lg">
                  <AnimatedBorder />
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-3">
                      <PackageTile />
                      <span className="text-body font-semibold text-brand">{pkg.name}</span>
                    </span>
                    <StatusBadge status={pkg.status} />
                  </div>
                  <p className="text-small mt-1 text-text-secondary">
                    {KIND_LABELS[pkg.kind]} · {termsSummary(pkg)}
                  </p>
                  <p className="text-body mt-2 text-text-primary">{feeText(pkg, today)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
