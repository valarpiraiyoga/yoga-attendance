import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users } from "lucide-react";
import EmptyState from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/layout/Panel";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { listEnrollmentsForBatch, listScheduleAssignmentsForEnrollment, isScheduleAssignmentActive } from "@/lib/enrollments/data";
import BatchHeader from "@/app/batches/[id]/batch-header";
import BatchEnrollmentRow from "@/app/batches/[id]/batch-enrollment-row";

/**
 * Batch Details → Students tab (wireframe p17: batch's enrolled students).
 * Un-stubbed in Phase 15A (01-product.md §4 "Schedule Assignment") — this
 * tab predates Phase 13/14 as a disabled placeholder
 * (04-development-plan.md §7's tracked "Batch Details → Students tab" open
 * item); it is real now because Phase 15A specifically needs a place to
 * see, from a batch's own side, who is enrolled and which of the batch's
 * schedules each of them is assigned to — Student Details shows the same
 * assignments from the student's side, but an admin managing one batch's
 * roster should not have to open every student individually to see it.
 *
 * Deliberately minimal: every enrollment in the batch, active and
 * historical alike (never hidden, matching every other enrollment list in
 * this project), each with its currently-active schedule assignment(s).
 * No search/filter/pagination — not asked for, and out of proportion for
 * a single batch's roster at this product's scale. An enrollment with no
 * current assignment is flagged the same honest way Student Details flags
 * it, not hidden or silently repaired.
 */
export default async function BatchStudentsPage({ params }) {
  // Authorization boundary — see app/batches/layout.js for why this must be
  // repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const batch = await getBatch(id);

  if (!batch) {
    notFound();
  }

  const enrollments = await listEnrollmentsForBatch(id);
  const assignmentsByEnrollmentId = new Map(
    await Promise.all(
      enrollments.map(async (enrollment) => [enrollment.id, await listScheduleAssignmentsForEnrollment(enrollment.id)])
    )
  );

  return (
    <BatchHeader batch={batch} active="students">
      <div>
        <PanelHeader
          icon={Users}
          title="Students"
          description={`Students enrolled in ${batch.name} and their assigned schedules.`}
          className="mb-4 min-h-8"
        />

        {enrollments.length === 0 ? (
          <EmptyState size="sm" description="No students are enrolled in this batch yet." />
        ) : (
          // A light table-in-panel border, not another full card — `BatchHeader` already
          // wraps this tab's content in one `Panel` (06-ui-implementation-rules.md §8.1).
          <div className="overflow-hidden rounded-lg border border-border">
            <Table aria-label={`Students in ${batch.name}`}>
              <TableHeader>
                <TableRow>
                  <TableHead className="sm:w-[25%]">Student</TableHead>
                  <TableHead className="hidden whitespace-nowrap sm:table-cell sm:w-[15%]">Phone</TableHead>
                  <TableHead className="sm:w-[12%]">Status</TableHead>
                  <TableHead>Assigned Schedules</TableHead>
                  <TableHead className="w-px px-3 whitespace-nowrap sm:px-4">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((enrollment) => (
                  <BatchEnrollmentRow
                    key={enrollment.id}
                    enrollment={enrollment}
                    activeAssignments={(assignmentsByEnrollmentId.get(enrollment.id) ?? []).filter((assignment) =>
                      isScheduleAssignmentActive(assignment)
                    )}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </BatchHeader>
  );
}
