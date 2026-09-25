import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent } from "@/lib/students/data";
import { createMembership } from "@/lib/memberships/actions";
import MembershipForm from "@/app/memberships/membership-form";
import { getCenterCurrency } from "@/lib/center-profile/settings";
import GuidedSteps from "@/app/students/guided-steps";
import PageHeader from "@/components/layout/PageHeader";

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
    <>
      <PageHeader
        compact
        back={{ href: `/students/${id}`, label: "Back to Student Details" }}
        title="Add Membership"
        description={<>Create a membership for {student.full_name} {isGuided ? " to continue their setup." : "."}</>}
      />
      <div className={isGuided ? "mx-auto w-full max-w-4xl" : "mx-auto w-full max-w-3xl"}>
        {isGuided ? <GuidedSteps current={2} className="mt-0" /> : null}

        <div
          className={`rounded-card border border-border bg-surface p-6 shadow-xs ${isGuided ? "sm:p-8" : ""}`}
        >
          <MembershipForm
            action={createMembershipForStudent}
            currency={await getCenterCurrency()}
            student={student}
            requireConfirmation={!isGuided}
            submitLabel="Save Membership"
            pendingLabel="Saving…"
            cancelHref={`/students/${id}`}
            skipHref={isGuided ? `/students/${id}/enrollments/new?guided=1` : undefined}
          />
        </div>
      </div>
    </>
  );
}
