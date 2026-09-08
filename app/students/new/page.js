import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { createStudent } from "@/lib/students/actions";
import StudentForm from "@/app/students/student-form";
import GuidedSteps from "@/app/students/guided-steps";

/**
 * Step 1 of the Add Student guided flow (02-ux.md Flow 02; wireframe p11).
 * `createStudent` redirects straight into step 3 (Add Batch Enrollment) on
 * success — step 2 (Membership) is unavailable until Phase 12.
 */
export default async function NewStudentPage() {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createStudent
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/students"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Students
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Student</h1>
      <p className="text-body mt-1 text-text-secondary">
        Create a student profile to begin their enrollment setup.
      </p>

      <GuidedSteps current={1} />

      <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
        <StudentForm action={createStudent} submitLabel="Save Student" pendingLabel="Saving…" />
      </div>
    </div>
  );
}
