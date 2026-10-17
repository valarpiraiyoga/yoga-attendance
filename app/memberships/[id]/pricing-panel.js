import Link from "next/link";
import { FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import { DURATION_LABELS } from "@/lib/packages/labels";
import { cn } from "@/lib/utils";

const PRICING_METHOD = { standard: "Standard package pricing", custom_fee_plan: "Custom Fee Plan" };

/** A titled column of the terms sheet (Plan, Validity, Price Details). */
function Column({ title, children, className }) {
  return (
    <section aria-label={title} className={cn("min-w-0 p-4", className)}>
      <h3 className="text-small mb-2 font-semibold text-text-primary">{title}</h3>
      {children}
    </section>
  );
}

/** A muted label above its value (the Plan column). */
function Stacked({ label, children }) {
  return (
    <div className="mt-2">
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className="text-body font-medium break-words text-text-primary">{children}</dd>
    </div>
  );
}

/** A label and its value on one line, the value beside it (the Validity column). */
function Inline({ label, children }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-3 py-1">
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className="text-body font-medium text-text-primary">{children}</dd>
    </div>
  );
}

/** A label on the left and its amount on the right (the Price Details column); the final fee is a highlighted row. */
function Money({ label, children, final = false }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1", final && "mt-1 -mx-2 rounded-md bg-brand/10 px-2 py-1.5")}>
      <dt className={cn("text-small min-w-0", final ? "font-bold text-text-primary" : "text-text-secondary")}>{label}</dt>
      <dd className={cn("text-body text-right whitespace-nowrap tabular-nums", final ? "font-bold text-text-primary" : "text-text-primary")}>{children}</dd>
    </div>
  );
}

function Amount({ value, currency, negative = false }) {
  return (
    <>
      {negative ? "− " : ""}
      {formatCurrency(value, currency)}
    </>
  );
}

/**
 * Membership Pricing: the pricing of a package-linked membership, exactly as it was recorded when the membership was created (see
 * `pricingSnapshotOf`). It shows stored values only and never reads a package or a fee entry, so a later change to either cannot
 * change it. A Custom Fee Plan shows its agreed fee and reason and no standard fee or discounts, which it never had.
 *
 * Header: the document icon, "Membership Pricing" with its subtitle, and Edit (the secondary button) on the right - a link to
 * Edit Membership, where the package, price and dates are corrected (the same link, and the same "not when cancelled" rule, as
 * the Corrections card). Body: three columns with thin dividers - Plan (the package name, pricing method and type), Validity
 * (start and end date) and Price Details (base fee, package discount, individual discount, and the Final Fee highlighted). Below
 * `md` the columns stack. The values and their meaning are unchanged.
 *
 * @param {{ snapshot: NonNullable<ReturnType<typeof import("@/lib/packages/membership-pricing").pricingSnapshotOf>>,
 *           membershipId: string, canEdit: boolean }} props
 */
export default function PricingPanel({ snapshot, membershipId, canEdit }) {
  const { currency } = snapshot;
  const isClassCount = snapshot.kind === "class_count";
  const isCustomPlan = snapshot.mode === "custom_fee_plan";

  const durationLabel =
    snapshot.plan === "custom" && snapshot.durationMonths
      ? `Custom · ${snapshot.durationMonths} ${snapshot.durationMonths === 1 ? "month" : "months"}`
      : snapshot.durationMonths
        ? `${DURATION_LABELS[snapshot.plan] ?? snapshot.plan} · ${snapshot.durationMonths} ${snapshot.durationMonths === 1 ? "month" : "months"}`
        : null;

  const plan = (
    <Column title="Plan">
      <p className="text-section-title leading-6 font-semibold break-words text-text-primary">{snapshot.packageName}</p>
      <dl>
        <Stacked label="Pricing Method">{PRICING_METHOD[snapshot.mode] ?? "Standard package pricing"}</Stacked>
        <Stacked label={isClassCount ? "Class Count" : "Duration"}>
          {isClassCount
            ? `${snapshot.totalClasses} ${snapshot.totalClasses === 1 ? "class" : "classes"}`
            : (durationLabel ?? "—")}
        </Stacked>
      </dl>
    </Column>
  );
  const validity = (
    <Column title="Validity">
      <dl>
        <Inline label="Start Date">{formatDate(snapshot.startDate)}</Inline>
        <Inline label={isClassCount ? "Expiry" : "End Date"}>{snapshot.endDate ? formatDate(snapshot.endDate) : NO_EXPIRY_LABEL}</Inline>
      </dl>
    </Column>
  );
  const sheet = (price) => (
    <div className="grid overflow-hidden rounded-lg border border-border md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,1.2fr)] md:divide-x max-md:divide-y divide-border">
      {plan}
      {validity}
      <Column title="Price Details">
        <dl>{price}</dl>
      </Column>
    </div>
  );

  return (
    <Panel aria-label="Membership Pricing" className="sm:p-4">
      <PanelHeader
        icon={FileText}
        tone="brand"
        title="Membership Pricing"
        description="Plan and pricing details for this membership."
        action={
          canEdit ? (
            <Button variant="secondary" size="sm" render={<Link href={`/memberships/${membershipId}/edit`} />} nativeButton={false}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : null
        }
        className="mb-3"
      />

      {isCustomPlan ? (
        <>
          {sheet(
            <Money label="Final Fee" final>
              {formatCurrency(snapshot.finalFee, currency)}
            </Money>,
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-small text-text-secondary">Reason</dt>
            <dd className="text-body break-words whitespace-pre-line text-text-primary">{snapshot.customReason}</dd>
            {snapshot.confirmedAt ? (
              <>
                <dt className="text-small text-text-secondary">Confirmed on</dt>
                <dd className="text-body text-text-primary">{formatDate(snapshot.confirmedAt.slice(0, 10))}</dd>
              </>
            ) : null}
          </dl>
        </>
      ) : (
        sheet(
          <>
            <Money label="Base Fee">
              <Amount value={snapshot.standardFee} currency={currency} />
            </Money>
            {isClassCount ? null : (
              <Money label="Package Discount">
                <Amount value={snapshot.packageDiscount > 0 ? snapshot.packageDiscount : 0} currency={currency} negative />
              </Money>
            )}
            <Money label="Individual Discount">
              <Amount value={snapshot.individual ? snapshot.individual.amount : 0} currency={currency} negative />
            </Money>
            {snapshot.individual ? (
              <p className="text-small -mt-0.5 mb-1 text-right text-text-secondary">
                {snapshot.individual.type === "percent" ? `${snapshot.individual.value}%` : "Fixed amount"} · {snapshot.individual.reason}
                {snapshot.individual.note ? ` — ${snapshot.individual.note}` : ""}
              </p>
            ) : null}
            <Money label="Final Fee" final>
              {formatCurrency(snapshot.finalFee, currency)}
            </Money>
          </>,
        )
      )}
    </Panel>
  );
}
