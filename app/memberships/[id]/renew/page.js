import { notFound } from "next/navigation";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership } from "@/lib/memberships/data";
import { createMembership, createPackageMembership } from "@/lib/memberships/actions";
import { getActivePackages } from "@/lib/packages/data";
import { todayDateString } from "@/lib/memberships/data";
import { calculateMembershipEndDate, addOneDayUTC } from "@/lib/memberships/validation";
import MembershipForm from "@/app/memberships/membership-form";
import { getCenterCurrency } from "@/lib/center-profile/settings";
import PageHeader from "@/components/layout/PageHeader";

/**
 * Renew Membership (02-ux.md Flow 09). Renewal always creates a NEW
 * membership record (01-product.md §12) — this page reuses `createMembership`
 * exactly like the standalone Add Membership flow, just pre-filled from the
 * previous membership: Start Date defaults to the previous membership's end
 * date plus one day, End Date recalculates from that, Plan and Amount carry
 * over as a starting point, and Payment Status resets to Pending (a new
 * record is a new, unpaid billing cycle) — all editable before saving.
 * The previous membership itself is never modified.
 *
 * A CLASS-COUNT membership is renewed as a class-count membership (its type is fixed): it has no end date to
 * continue from, so the new one starts today at the centre, with the previous class total and amount carried over
 * as a starting point and no end date (no expiry) unless one is entered - all editable before saving.
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
  // A renewal is priced in the centre's CURRENT currency. The previous amount
  // is only a sensible starting point when it was priced in that same currency;
  // otherwise (the centre changed currency since) it is left blank rather than
  // silently re-labelled.
  const startingAmount = previous.currency === currency ? previous.amount : "";

  const initialValues =
    previous.kind === "class_count"
      ? {
          kind: "class_count",
          plan: "class_count",
          // No end date to continue from: the new membership starts today at the centre.
          start_date: await todayDateString(),
          end_date: "",
          total_classes: previous.total_classes,
          amount: startingAmount,
          notes: "",
        }
      : (() => {
          const defaultStartDate = addOneDayUTC(previous.end_date);
          return {
            plan: previous.plan,
            start_date: defaultStartDate,
            end_date: calculateMembershipEndDate(previous.plan, defaultStartDate) || defaultStartDate,
            amount: startingAmount,
            notes: "",
          };
        })();

  const createRenewal = createMembership.bind(null, previous.student_id, "renewal");

  // Renewing from a package: only packages of the previous membership's type (a class-count membership is renewed as one),
  // opening on the package form when the previous membership came from a package. The package, the duration and the start date
  // carry over as a starting point; an individual discount never does (the package form starts with none).
  const packages = (await getActivePackages()).filter((candidate) => candidate.kind === previous.kind);
  const previousPackage = previous.package_id ? packages.find((candidate) => candidate.id === previous.package_id) : null;
  const packageInitialValues = {
    start_date: initialValues.start_date,
    ...(previousPackage
      ? {
          package_id: previousPackage.id,
          ...(previous.kind === "duration" && previousPackage.options.includes(previous.plan)
            ? {
                duration_option: previous.plan,
                custom_months: previous.plan === "custom" && previous.duration_months ? String(previous.duration_months) : "",
              }
            : {}),
        }
      : {}),
  };

  return (
    <>
      <PageHeader
        compact
        back={{ href: `/memberships/${id}`, label: "Back to Membership Details" }}
        title="Renew Membership"
        description={<>Create a new membership record for {previous.students?.full_name ?? "this student"}.</>}
      />
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-border bg-surface p-6 shadow-xs">
          <MembershipForm
            action={createRenewal}
            packages={packages}
            packageAction={createPackageMembership.bind(null, previous.student_id, "renewal")}
            packageInitialValues={packageInitialValues}
            defaultMode={previous.package_id ? "package" : "manual"}
            currency={currency}
            student={previous.students}
            initialValues={initialValues}
            requireConfirmation
            allowInitialPayment
            lockKind
            today={await todayDateString()}
            submitLabel="Save Renewal"
            pendingLabel="Saving…"
            cancelHref={`/memberships/${id}`}
          />
        </div>
      </div>
    </>
  );
}
