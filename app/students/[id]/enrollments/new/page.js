import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { listBatchOptions } from "@/lib/batches/data";
import { createEnrollment } from "@/lib/enrollments/actions";
import EnrollmentForm from "@/app/students/[id]/enrollments/enrollment-form";
import GuidedSteps from "@/app/students/guided-steps";

/**
 * Add Batch Enrollment (wireframe p13). Serves two entry points with one
 * page rather than duplicating the form across two routes:
 *
 * - `?guided=1` — step 3 of the Add Student flow, arrived at directly from
 *   `createStudent`'s redirect (02-ux.md Flow 02).
 * - no query param — "Add Enrollment" from an existing student's Details
 *   page (02-ux.md Flow 10).
 */
export default async function NewEnrollmentPage({ params, searchParams }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createEnrollment
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const rawParams = await searchParams;
  const isGuided = rawParams?.guided === "1";

  const batchOptions = await listBatchOptions();
  const createEnrollmentForStudent = createEnrollment.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/students/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Student Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Batch Enrollment</h1>
      <p className="text-body mt-1 text-text-secondary">
        Assign this student to a batch{isGuided ? " to complete their setup." : "."}
      </p>

      {isGuided ? <GuidedSteps current={3} /> : null}

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <div className="mb-6 flex flex-wrap items-baseline gap-x-3 rounded-lg border border-border bg-background/60 p-3">
          <span className="text-body font-medium text-text-primary">{student.full_name}</span>
          <span className="text-body text-text-secondary">{student.phone}</span>
        </div>

        <EnrollmentForm
          action={createEnrollmentForStudent}
          batchOptions={batchOptions}
          submitLabel="Save Enrollment"
          pendingLabel="Saving…"
          cancelHref={`/students/${id}`}
        />
      </div>
    </div>
  );
}
