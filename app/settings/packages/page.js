import Link from "next/link";
import { Package } from "lucide-react";
import MobileHeaderAction from "@/components/layout/MobileHeaderAction";
import TabContentHeading from "@/components/layout/TabContentHeading";
import { Panel } from "@/components/layout/Panel";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString } from "@/lib/memberships/data";
import { getPackages } from "@/lib/packages/data";
import { KIND_LABELS, currentFeeEntry, formatFee, nextScheduledEntry, termsSummary } from "@/lib/packages/labels";
import { AddPackageButton } from "@/app/settings/packages/package-dialogs";

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
          <Panel className="max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Offers</TableHead>
                  <TableHead>Current fee</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell>
                      <Link href={`/settings/packages/${pkg.id}`} className="font-medium text-text-primary hover:text-brand">
                        {pkg.name}
                      </Link>
                    </TableCell>
                    <TableCell>{KIND_LABELS[pkg.kind]}</TableCell>
                    <TableCell>{termsSummary(pkg)}</TableCell>
                    <TableCell>{feeText(pkg, today)}</TableCell>
                    <TableCell>
                      <StatusBadge status={pkg.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <ul className="flex flex-col gap-3 md:hidden">
            {packages.map((pkg) => (
              <li key={pkg.id}>
                <Link href={`/settings/packages/${pkg.id}`} className="block rounded-card border border-border bg-surface p-4 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-body font-semibold text-text-primary">{pkg.name}</span>
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
