import PageHeader from "@/components/layout/PageHeader";
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
    <>
      <PageHeader
        compact
        back={{ href: "/students", label: "Back to Students" }}
        title="Add Student"
        description="Create a student profile to begin their enrollment setup."
      />

      <div className="mx-auto max-w-5xl">
        <GuidedSteps current={1} className="mt-0" />

        <div className="rounded-card border border-border bg-surface p-6 shadow-xs sm:p-8">
          <StudentForm action={createStudent} submitLabel="Save Student" pendingLabel="Saving…" />
        </div>
      </div>
    </>
  );
}
