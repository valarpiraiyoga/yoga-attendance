import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DataTableShell from "@/components/ui/data-table-shell";
import { Badge } from "@/components/ui/badge";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getBatch } from "@/lib/batches/data";
import { listEnrollmentsForBatch, listScheduleAssignmentsForEnrollment, isScheduleAssignmentActive } from "@/lib/enrollments/data";
import { DAY_LABELS } from "@/lib/schedules/validation";
import BatchHeader from "@/app/batches/[id]/batch-header";

function formatTime(value) {
  if (!value) return "—";
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

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
        <h2 className="text-section-title font-semibold text-text-primary">Students</h2>
        <p className="text-body mt-1 text-text-secondary">
          Students enrolled in {batch.name} and their assigned schedules.
        </p>

        {enrollments.length === 0 ? (
          <p className="text-body mt-6 text-text-secondary">
            No students are enrolled in this batch yet.
          </p>
        ) : (
          <DataTableShell className="mt-6">
            <Table aria-label={`Students in ${batch.name}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Enrollment</TableHead>
                  <TableHead>Schedules</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((enrollment) => {
                  const activeAssignments = (assignmentsByEnrollmentId.get(enrollment.id) ?? []).filter(
                    (assignment) => isScheduleAssignmentActive(assignment)
                  );

                  return (
                    <TableRow key={enrollment.id}>
                      <TableCell>
                        <p className="font-medium text-text-primary">
                          {enrollment.students?.full_name ?? "Unknown student"}
                        </p>
                        <p className="text-small text-text-secondary">{enrollment.students?.student_code}</p>
                      </TableCell>
                      <TableCell className="text-text-secondary">{enrollment.students?.phone ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={enrollment.status === "active" ? "success" : "danger"}>
                          {enrollment.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-text-secondary">
                        {activeAssignments.length === 0 ? (
                          <span className="font-medium text-danger">No schedule assigned</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {activeAssignments.map((assignment) => (
                              <li key={assignment.id}>
                                {assignment.schedule ? (
                                  <>
                                    {DAY_LABELS[assignment.schedule.day_of_week] ?? assignment.schedule.day_of_week}
                                    {" · "}
                                    {formatTime(assignment.schedule.start_time)} –{" "}
                                    {formatTime(assignment.schedule.end_time)}
                                  </>
                                ) : (
                                  <span className="text-danger">Assigned schedule could not be found</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell>
                        {enrollment.students ? (
                          <Link
                            href={`/students/${enrollment.students.id}`}
                            className="font-medium text-brand hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTableShell>
        )}
      </div>
    </BatchHeader>
  );
}
