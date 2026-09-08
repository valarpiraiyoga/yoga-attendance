import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import { getEnrollment } from "@/lib/enrollments/data";
import { updateEnrollment } from "@/lib/enrollments/actions";
import EnrollmentForm from "@/app/students/[id]/enrollments/enrollment-form";

export default async function EditEnrollmentPage({ params }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. updateEnrollment
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id, enrollmentId } = await params;
  const [student, enrollment, batchOptions] = await Promise.all([
    getStudent(id),
    getEnrollment(enrollmentId),
    listBatchOptions(),
  ]);

  // The enrollment must both exist and actually belong to this student —
  // otherwise a crafted URL pairing one student's id with another's
  // enrollmentId would silently operate on the wrong record.
  if (!student || !enrollment || enrollment.student_id !== id) {
    notFound();
  }

  const updateEnrollmentById = updateEnrollment.bind(null, enrollmentId, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/students/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Student Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit Batch Enrollment</h1>
      <p className="text-body mt-1 text-text-secondary">
        Update {student.full_name}&rsquo;s enrollment in {enrollment.batches?.name ?? "this batch"}.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <EnrollmentForm
          action={updateEnrollmentById}
          enrollment={enrollment}
          batchOptions={batchOptions}
          submitLabel="Save Changes"
          pendingLabel="Saving…"
          cancelHref={`/students/${id}`}
        />
      </div>
    </div>
  );
}
