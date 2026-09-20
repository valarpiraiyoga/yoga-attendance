import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import BatchHeader from "@/app/batches/[id]/batch-header";
import BatchScheduleRow from "@/app/batches/[id]/batch-schedule-row";

/**
 * Batch Details → Schedules tab (wireframe p18: "Manage recurring weekly
 * schedules for this batch."). Un-stubbed for Phase 13 — see
 * app/batches/[id]/batch-header.js for the shared header/tab-nav this page
 * renders alongside Overview.
 */
export default async function BatchSchedulesPage({ params }) {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const schedules = await listSchedulesForBatch(id);

  return (
    <BatchHeader batch={batch} active="schedules">
      <div>
        <PanelHeader
          icon={Calendar}
          title="Schedules"
          description="Manage recurring weekly schedules for this batch."
          className="mb-4 min-h-8 flex-col items-start sm:flex-row sm:items-center"
          action={
            <Button render={<Link href={`/schedule/new?batch=${batch.id}`} />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Schedule
            </Button>
          }
        />

        {schedules.length === 0 ? (
          <EmptyState size="sm" description="No schedules yet. Add one to define when this batch takes place." />
        ) : (
          <DataTableShell>
            <Table aria-label={`Schedules for ${batch.name}`}>
              <TableHeader>
                <TableRow>
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
                  <BatchScheduleRow key={schedule.id} schedule={schedule} />
                ))}
              </TableBody>
            </Table>
          </DataTableShell>
        )}
      </div>
    </BatchHeader>
  );
}
