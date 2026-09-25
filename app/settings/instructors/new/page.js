import { requireRole, ROLES } from "@/lib/auth/dal";
import { createInstructor } from "@/lib/instructors/actions";
import InstructorForm from "@/app/settings/instructors/instructor-form";
import PageHeader from "@/components/layout/PageHeader";

export default async function NewInstructorPage() {
  // Authorization boundary — see app/settings/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createInstructor
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/settings/instructors", label: "Back to Instructors" }}
        title="Add Instructor"
        description="Create an instructor profile. You can assign them to schedules later."
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <InstructorForm
            action={createInstructor}
            submitLabel="Create Instructor"
            pendingLabel="Creating…"
          />
        </div>
      </div>
    </>
  );
}
