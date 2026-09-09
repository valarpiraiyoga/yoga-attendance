import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { createMembership } from "@/lib/memberships/actions";
import MembershipForm from "@/app/memberships/membership-form";
import GuidedSteps from "@/app/students/guided-steps";

/**
 * Add Membership from a known student. Serves two entry points with one
 * page rather than duplicating the form across two routes — mirroring
 * app/students/[id]/enrollments/new/page.js exactly:
 *
 * - `?guided=1` — step 2 of the Add Student flow, arrived at directly from
 *   `createStudent`'s redirect (02-ux.md Flow 02). Saves directly, no
 *   Review/Confirm gate, and is skippable straight to Batch Enrollment.
 * - no query param — "Add Membership" from an existing student's Details
 *   page (02-ux.md Flow 14's "Add Membership entry points" note). Goes
 *   through Review → Confirm like every other non-guided entry point.
 */
export default async function NewStudentMembershipPage({ params, searchParams }) {
  // Authorization boundary — see app/students/layout.js for why this must be
  // repeated here rather than relying on the layout alone. createMembership
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const student = await getStudent(id);

  if (!student) {
    notFound();
  }

  const rawParams = await searchParams;
  const isGuided = rawParams?.guided === "1";

  const createMembershipForStudent = createMembership.bind(null, id, isGuided ? "guided" : "student");

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/students/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Student Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Membership</h1>
      <p className="text-body mt-1 text-text-secondary">
        Create a membership for {student.full_name}
        {isGuided ? " to continue their setup." : "."}
      </p>

      {isGuided ? <GuidedSteps current={2} /> : null}

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <MembershipForm
          action={createMembershipForStudent}
          student={student}
          requireConfirmation={!isGuided}
          submitLabel="Save Membership"
          pendingLabel="Saving…"
          cancelHref={`/students/${id}`}
          skipHref={isGuided ? `/students/${id}/enrollments/new?guided=1` : undefined}
        />
      </div>
    </div>
  );
}
