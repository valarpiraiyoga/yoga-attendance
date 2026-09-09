import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership } from "@/lib/memberships/data";
import { updateMembership } from "@/lib/memberships/actions";
import MembershipForm from "@/app/memberships/membership-form";

/**
 * Edit Membership. Plain Save, no Review/Confirm gate — cancellation is the
 * only Membership action that requires confirmation on top of Add/Renew
 * (02-ux.md: "Normal Edit Membership uses normal Save without
 * confirmation"), matching Edit Student/Edit Batch/Edit Instructor.
 */
export default async function EditMembershipPage({ params }) {
  // Authorization boundary — see app/memberships/layout.js for why this must
  // be repeated here rather than relying on the layout alone. updateMembership
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const membership = await getMembership(id);

  if (!membership) {
    notFound();
  }

  const updateMembershipById = updateMembership.bind(null, id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/memberships/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Membership Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Edit Membership</h1>
      <p className="text-body mt-1 text-text-secondary">
        Update {membership.students?.full_name ?? "this student"}&rsquo;s membership.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <MembershipForm
          action={updateMembershipById}
          student={membership.students}
          membership={membership}
          requireConfirmation={false}
          submitLabel="Save Changes"
          pendingLabel="Saving…"
          cancelHref={`/memberships/${id}`}
        />
      </div>
    </div>
  );
}
