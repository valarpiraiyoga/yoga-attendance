import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getInstructor } from "@/lib/instructors/data";
import { updateInstructor } from "@/lib/instructors/actions";
import InstructorForm from "@/app/settings/instructors/instructor-form";
import InstructorLoginAccess from "@/app/settings/instructors/instructor-login-access";
import PageHeader from "@/components/layout/PageHeader";

export default async function EditInstructorPage({ params }) {
  // Authorization boundary — see app/settings/layout.js for why this must be
  // repeated here rather than relying on the layout alone. updateInstructor
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const instructor = await getInstructor(id);

  if (!instructor) {
    notFound();
  }

  const updateInstructorById = updateInstructor.bind(null, id);

  return (
    <>
      <PageHeader
        compact
        back={{ href: "/settings/instructors", label: "Back to Instructors" }}
        title="Edit Instructor"
        description={<>Update {instructor.full_name}&rsquo;s details.</>}
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <InstructorForm
            action={updateInstructorById}
            instructor={instructor}
            submitLabel="Save Changes"
            pendingLabel="Saving…"
          />
        </div>

        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <InstructorLoginAccess instructor={instructor} />
        </div>
      </div>
    </>
  );
}
