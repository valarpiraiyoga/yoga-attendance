import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership } from "@/lib/memberships/data";
import { updateMembership } from "@/lib/memberships/actions";
import MembershipForm from "@/app/memberships/membership-form";
import PageHeader from "@/components/layout/PageHeader";

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
    <>
      <PageHeader
        compact
        back={{ href: `/memberships/${id}`, label: "Back to Membership Details" }}
        title="Edit Membership"
        description={<>Update {membership.students?.full_name ?? "this student"}&rsquo;s membership.</>}
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <MembershipForm
            action={updateMembershipById}
            currency={membership.currency}
            student={membership.students}
            membership={membership}
            requireConfirmation={false}
            submitLabel="Save Changes"
            pendingLabel="Saving…"
            cancelHref={`/memberships/${id}`}
          />
        </div>
      </div>
    </>
  );
}
