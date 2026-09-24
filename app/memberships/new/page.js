import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getStudent, listStudentOptions } from "@/lib/students/data";
import { createMembership } from "@/lib/memberships/actions";
import MembershipForm from "@/app/memberships/membership-form";
import { getCenterCurrency } from "@/lib/center-profile/settings";
import SelectStudentStep from "@/app/memberships/new/select-student-step";

/**
 * Standalone Add Membership (02-ux.md Flow 14: "Memberships → Add
 * Membership → Select Student → Membership Details → Review → Confirm →
 * Save"). One route serves both halves of that flow: without `?student=`,
 * it shows Select Student; with it, the same MembershipForm used by every
 * other Add Membership entry point (02-ux.md "Add Membership entry
 * points").
 */
export default async function NewMembershipPage({ searchParams }) {
  // Authorization boundary — see app/memberships/layout.js for why this
  // must be repeated here rather than relying on the layout alone.
  // createMembership also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const studentId = typeof rawParams?.student === "string" ? rawParams.student : "";

  if (!studentId) {
    const studentOptions = await listStudentOptions();

    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href="/memberships"
          className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Memberships
        </Link>

        <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Membership</h1>
        <p className="text-body mt-1 text-text-secondary">Select the student this membership belongs to.</p>

        <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
          <SelectStudentStep studentOptions={studentOptions} />
        </div>
      </div>
    );
  }

  const student = await getStudent(studentId);
  if (!student) {
    notFound();
  }

  const createMembershipForStudent = createMembership.bind(null, studentId, "standalone");

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/memberships"
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Memberships
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Add Membership</h1>
      <p className="text-body mt-1 text-text-secondary">Create a membership for {student.full_name}.</p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <MembershipForm
          action={createMembershipForStudent}
          currency={await getCenterCurrency()}
          student={student}
          requireConfirmation
          submitLabel="Save Membership"
          pendingLabel="Saving…"
          cancelHref="/memberships"
        />
      </div>
    </div>
  );
}
