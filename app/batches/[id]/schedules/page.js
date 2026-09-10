import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { listSchedulesForBatch } from "@/lib/schedules/data";
import { DAY_LABELS } from "@/lib/schedules/validation";
import BatchHeader from "@/app/batches/[id]/batch-header";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

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
    <div>
      <BatchHeader batch={batch} active="schedules" />

      <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-section-title font-semibold text-text-primary">Schedules</h2>
            <p className="text-body mt-1 text-text-secondary">
              Manage recurring weekly schedules for this batch.
            </p>
          </div>
          <Button render={<Link href={`/schedule/new?batch=${batch.id}`} />} nativeButton={false}>
            <Plus className="size-4" aria-hidden="true" />
            Add Schedule
          </Button>
        </div>

        {schedules.length === 0 ? (
          <p className="text-body mt-6 text-text-secondary">
            No schedules yet. Add one to define when this batch takes place.
          </p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-border">
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
                  <TableRow key={schedule.id}>
                    <TableCell className="text-text-secondary">
                      {DAY_LABELS[schedule.day_of_week] ?? schedule.day_of_week}
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}
                    </TableCell>
                    <TableCell className="text-text-secondary">{schedule.instructors?.full_name ?? "—"}</TableCell>
                    <TableCell className="text-text-secondary">{formatDate(schedule.effective_from)}</TableCell>
                    <TableCell className="text-text-secondary">
                      {schedule.effective_until ? formatDate(schedule.effective_until) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={schedule.status === "active" ? "success" : "danger"}>
                        {schedule.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/schedule/${schedule.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
