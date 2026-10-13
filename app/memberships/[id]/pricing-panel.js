import { Banknote, CalendarDays, CalendarX2, Hash, Layers, MessageSquareText, Package, ReceiptText } from "lucide-react";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import { DURATION_LABELS } from "@/lib/packages/labels";

function Amount({ value, currency, negative = false }) {
  return (
    <p className="text-body text-text-primary">
      {negative ? "− " : ""}
      {formatCurrency(value, currency)}
    </p>
  );
}

/**
 * The pricing of a package-linked membership, exactly as it was recorded when the membership was created (see
 * `pricingSnapshotOf`). It shows stored values only and never reads a package or a fee entry, so a later change to either cannot
 * change it. A Custom Fee Plan shows its agreed fee and reason and no standard fee or discounts, which it never had.
 *
 * @param {{ snapshot: NonNullable<ReturnType<typeof import("@/lib/packages/membership-pricing").pricingSnapshotOf>> }} props
 */
export default function PricingPanel({ snapshot }) {
  const { currency } = snapshot;
  const isClassCount = snapshot.kind === "class_count";
  const isCustomPlan = snapshot.mode === "custom_fee_plan";

  const durationLabel =
    snapshot.plan === "custom" && snapshot.durationMonths
      ? `Custom · ${snapshot.durationMonths} ${snapshot.durationMonths === 1 ? "month" : "months"}`
      : snapshot.durationMonths
        ? `${DURATION_LABELS[snapshot.plan] ?? snapshot.plan} · ${snapshot.durationMonths} ${snapshot.durationMonths === 1 ? "month" : "months"}`
        : null;

  return (
    <Panel aria-label="Pricing">
      <PanelHeader
        icon={Banknote}
        title="Pricing"
        description="As agreed when the membership was created. Later changes to the package or its fees never change it."
        className="mb-4 min-h-8"
      />
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <FieldRow icon={Package} label="Package">
          <p className="text-body text-text-primary">{snapshot.packageName}</p>
        </FieldRow>
        <FieldRow icon={Layers} label="Type">
          <p className="text-body text-text-primary">
            {isClassCount
              ? `Class count · ${snapshot.totalClasses} ${snapshot.totalClasses === 1 ? "class" : "classes"}`
              : `Duration · ${durationLabel ?? "—"}`}
          </p>
        </FieldRow>
        <FieldRow icon={CalendarDays} label="Start date">
          <p className="text-body text-text-primary">{formatDate(snapshot.startDate)}</p>
        </FieldRow>
        <FieldRow icon={CalendarX2} label={isClassCount ? "Expiry" : "End date"}>
          <p className="text-body text-text-primary">{snapshot.endDate ? formatDate(snapshot.endDate) : NO_EXPIRY_LABEL}</p>
        </FieldRow>

        {isCustomPlan ? (
          <>
            <FieldRow icon={ReceiptText} label="Pricing">
              <p className="text-body text-text-primary">Custom Fee Plan</p>
            </FieldRow>
            <FieldRow icon={Banknote} label="Agreed fee">
              <p className="text-body font-semibold text-text-primary">{formatCurrency(snapshot.finalFee, currency)}</p>
            </FieldRow>
            <FieldRow icon={MessageSquareText} label="Reason" className="sm:col-span-2">
              <p className="text-body break-words whitespace-pre-line text-text-primary">{snapshot.customReason}</p>
            </FieldRow>
            {snapshot.confirmedAt ? (
              <FieldRow icon={Hash} label="Confirmed on" className="sm:col-span-2">
                <p className="text-body text-text-primary">{formatDate(snapshot.confirmedAt.slice(0, 10))}</p>
              </FieldRow>
            ) : null}
          </>
        ) : (
          <>
            <FieldRow icon={Banknote} label="Standard fee">
              <Amount value={snapshot.standardFee} currency={currency} />
            </FieldRow>
            {isClassCount ? null : (
              <FieldRow icon={Banknote} label="Package discount">
                {snapshot.packageDiscount > 0 ? <Amount value={snapshot.packageDiscount} currency={currency} negative /> : <p className="text-body text-text-primary">None</p>}
              </FieldRow>
            )}
            <FieldRow icon={Banknote} label="Individual discount">
              {snapshot.individual ? (
                <>
                  <Amount value={snapshot.individual.amount} currency={currency} negative />
                  <p className="text-small text-text-secondary">
                    {snapshot.individual.type === "percent" ? `${snapshot.individual.value}%` : "Fixed amount"} · {snapshot.individual.reason}
                    {snapshot.individual.note ? ` — ${snapshot.individual.note}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-body text-text-primary">None</p>
              )}
            </FieldRow>
            <FieldRow icon={Banknote} label="Final agreed fee">
              <p className="text-body font-semibold text-text-primary">{formatCurrency(snapshot.finalFee, currency)}</p>
            </FieldRow>
          </>
        )}
      </div>
    </Panel>
  );
}
