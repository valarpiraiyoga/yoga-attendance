import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership } from "@/lib/memberships/data";
import { createMembership } from "@/lib/memberships/actions";
import { calculateMembershipEndDate, addOneDayUTC } from "@/lib/memberships/validation";
import MembershipForm from "@/app/memberships/membership-form";
import { getCenterCurrency } from "@/lib/center-profile/settings";

/**
 * Renew Membership (02-ux.md Flow 09). Renewal always creates a NEW
 * membership record (01-product.md §12) — this page reuses `createMembership`
 * exactly like the standalone Add Membership flow, just pre-filled from the
 * previous membership: Start Date defaults to the previous membership's end
 * date plus one day, End Date recalculates from that, Plan and Amount carry
 * over as a starting point, and Payment Status resets to Pending (a new
 * record is a new, unpaid billing cycle) — all editable before saving.
 * The previous membership itself is never modified.
 */
export default async function RenewMembershipPage({ params }) {
  // Authorization boundary — see app/memberships/layout.js for why this must
  // be repeated here rather than relying on the layout alone. createMembership
  // also calls requireRole itself before writing anything.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const previous = await getMembership(id);

  if (!previous) {
    notFound();
  }

  const currency = await getCenterCurrency();
  const defaultStartDate = addOneDayUTC(previous.end_date);
  const initialValues = {
    plan: previous.plan,
    start_date: defaultStartDate,
    end_date: calculateMembershipEndDate(previous.plan, defaultStartDate) || defaultStartDate,
    // A renewal is priced in the centre's CURRENT currency. The previous amount
    // is only a sensible starting point when it was priced in that same currency;
    // otherwise (the centre changed currency since) it is left blank rather than
    // silently re-labelled.
    amount: previous.currency === currency ? previous.amount : "",
    payment_status: "pending",
    notes: "",
  };

  const createRenewal = createMembership.bind(null, previous.student_id, "renewal");

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/memberships/${id}`}
        className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Membership Details
      </Link>

      <h1 className="text-page-title mt-3 font-semibold text-text-primary">Renew Membership</h1>
      <p className="text-body mt-1 text-text-secondary">
        Create a new membership record for {previous.students?.full_name ?? "this student"}.
      </p>

      <div className="mt-6 rounded-card border border-border bg-surface p-6 shadow-xs">
        <MembershipForm
          action={createRenewal}
          currency={currency}
          student={previous.students}
          initialValues={initialValues}
          requireConfirmation
          submitLabel="Save Renewal"
          pendingLabel="Saving…"
          cancelHref={`/memberships/${id}`}
        />
      </div>
    </div>
  );
}
