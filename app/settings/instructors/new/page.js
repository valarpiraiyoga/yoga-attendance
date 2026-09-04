import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { createInstructor } from "@/lib/instructors/actions";
import InstructorForm from "@/app/settings/instructors/instructor-form";

export default async function NewInstructorPage() {
  // Authorization boundary — see app/settings/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createInstructor
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings/instructors"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Instructors
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Instructor</h1>
      <p className="text-body mt-1 text-text-secondary">
        Create an instructor profile. You can assign them to schedules later.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <InstructorForm
          action={createInstructor}
          submitLabel="Create Instructor"
          pendingLabel="Creating…"
        />
      </div>
    </div>
  );
}
