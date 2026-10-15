import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership, listPackagesForCorrection } from "@/lib/memberships/data";
import { getInvoiceForMembership } from "@/lib/invoices/data";
import { updateMembership } from "@/lib/memberships/actions";
import { currentTermsOf } from "@/lib/memberships/correction-core";
import { formatPeriod } from "@/lib/memberships/period";
import MembershipForm from "@/app/memberships/membership-form";
import PackageMembershipEditor from "@/app/memberships/[id]/edit/package-membership-editor";
import PageHeader from "@/components/layout/PageHeader";
import Alert from "@/components/ui/alert";

/**
 * Edit Membership - one workflow for every membership (02-ux.md: "Normal Edit Membership uses normal Save without confirmation",
 * matching Edit Student/Edit Batch/Edit Instructor, except where a protected term changes).
 *
 *   - A LEGACY membership (no package) keeps its form and its `updateMembership` action, unchanged.
 *   - A PACKAGE-LINKED membership gets the editor: Membership, Pricing and Notes. Changing only the notes is a plain save; changing
 *     a protected term (package, duration, start date, pricing, discount) shows the revised price and asks for a reason and the
 *     confirmation of the revised final fee, then saves the audited correction of migration 0050 (FS-8). The server decides which
 *     it is from the stored membership; this page only lays the screen out.
 *   - A legacy Paid membership that already has its issued receipt shows a notice: editing the membership never changes that receipt
 *     (migration 0054, FS-D). The notice is informational only; it adds no control and changes no behaviour.
 */
export default async function EditMembershipPage({ params }) {
  // Authorization boundary - see app/memberships/layout.js for why this must be repeated here rather than relying on the layout
  // alone. The actions also call requireRole themselves before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const membership = await getMembership(id);

  if (!membership) {
    notFound();
  }

  const isPackageLinked = Boolean(membership.package_id);
  const packages = isPackageLinked ? await listPackagesForCorrection(membership) : [];
  const student = membership.students;
  // Only a legacy membership can hold a membership-level receipt (a package-linked one is documented per payment).
  const hasIssuedReceipt = !isPackageLinked && membership.payment_status === "paid" && Boolean(await getInvoiceForMembership(id));

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/memberships/${id}`, label: "Back to Membership Details" }}
        title="Edit Membership"
        description={<>Update {student?.full_name ?? "this student"}&rsquo;s membership.</>}
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          {isPackageLinked ? (
            <PackageMembershipEditor
              membershipId={id}
              kind={membership.kind}
              currency={membership.currency}
              current={currentTermsOf(membership)}
              packages={packages}
              endDate={membership.end_date}
              notes={membership.notes ?? ""}
              locked={membership.status === "cancelled"}
              student={student}
              membership={{
                membership_code: membership.membership_code,
                package_name: membership.package_name,
                amount: membership.amount,
                period: formatPeriod(membership.start_date, membership.end_date),
              }}
            />
          ) : (
            <div className="flex flex-col gap-5">
              {hasIssuedReceipt ? (
                <Alert variant="info" title="This membership has an issued receipt">
                  Changing the amount, plan or dates will not change the receipt. It keeps the details it was issued with.
                </Alert>
              ) : null}
              <MembershipForm
                action={updateMembership.bind(null, id)}
                currency={membership.currency}
                student={student}
                membership={membership}
                classesUsed={membership.class_count?.used ?? 0}
                requireConfirmation={false}
                submitLabel="Save Changes"
                pendingLabel="Saving…"
                cancelHref={`/memberships/${id}`}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
