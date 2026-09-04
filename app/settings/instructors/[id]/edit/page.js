import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getInstructor } from "@/lib/instructors/data";
import { updateInstructor } from "@/lib/instructors/actions";
import InstructorForm from "@/app/settings/instructors/instructor-form";
import InstructorLoginAccess from "@/app/settings/instructors/instructor-login-access";

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
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings/instructors"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Instructors
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit Instructor</h1>
      <p className="text-body mt-1 text-text-secondary">
        Update {instructor.full_name}&rsquo;s details.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <InstructorForm
          action={updateInstructorById}
          instructor={instructor}
          submitLabel="Save Changes"
          pendingLabel="Saving…"
        />
      </div>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <InstructorLoginAccess instructor={instructor} />
      </div>
    </div>
  );
}
