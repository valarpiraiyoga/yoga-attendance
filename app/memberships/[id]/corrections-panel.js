import Link from "next/link";
import { PencilRuler } from "lucide-react";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { NO_EXPIRY_LABEL } from "@/lib/memberships/period";
import { DURATION_LABELS } from "@/lib/packages/labels";

/** `12 Oct 2026, 4:05 pm` in the centre's time zone. */
function formatStamp(value, timeZone) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(value));
}

const MODE_LABELS = { standard: "Standard package pricing", custom_fee_plan: "Custom Fee Plan" };
const STATUS_LABELS = { pending: "Pending", partially_paid: "Partially Paid", paid: "Paid" };

// One stored value as the history shows it; nothing here reads a package or a fee entry, so a later change to either cannot alter it.
function shown(value, change, currency) {
  if (value === null || value === undefined || value === "") return change.key === "end_date" ? NO_EXPIRY_LABEL : "—";
  switch (change.format) {
    case "money":
      return formatCurrency(Number(value), currency ?? undefined);
    case "date":
      return formatDate(value);
    case "plan":
      return DURATION_LABELS[value] ?? (value === "class_count" ? "Class count" : String(value));
    case "mode":
      return MODE_LABELS[value] ?? String(value);
    case "status":
      return STATUS_LABELS[value] ?? String(value);
    default:
      return String(value);
  }
}

/**
 * Corrections of a package-linked membership (Membership Details; 01-product.md section 5A "Fee corrections"): the history of every
 * correction - who, when, the reason and what changed, from the stored before and after - and a link to Edit Membership, where a
 * correction is made (one workflow: the notes are saved plainly, a change of package, duration, start date or price is reviewed,
 * given a reason and confirmed). The history is read from `membership_term_corrections` (migration 0050); it can
 * only grow, and nothing here changes a membership, a payment or a document.
 *
 * @param {{ membershipId: string, currency: string, canEdit: boolean, corrections: object[]|null, timeZone: string }} props
 */
export default function CorrectionsPanel({ membershipId, currency, canEdit, corrections, timeZone }) {
  return (
    <Panel aria-label="Corrections">
      <PanelHeader
        icon={PencilRuler}
        title="Corrections"
        description="Changes to the package, price or dates after the membership was created, each with its reason. Payments and receipts are never changed by a correction."
        action={
          canEdit ? (
            <Button variant="outline" size="sm" render={<Link href={`/memberships/${membershipId}/edit`} />} nativeButton={false}>
              Edit Membership
            </Button>
          ) : null
        }
        className="mb-4 min-h-8"
      />
      {corrections === null ? (
        <EmptyState size="sm" title="The corrections could not be loaded" description="Try refreshing the page." />
      ) : corrections.length === 0 ? (
        <EmptyState size="sm" title="No corrections" description="A correction of this membership's package, price or dates appears here, with its reason." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {corrections.map((correction) => (
            <li key={correction.id} className="flex flex-col gap-1 py-3">
              <span className="text-body font-medium text-text-primary">
                {formatCurrency(correction.oldAmount, correction.currency ?? currency)} → {formatCurrency(correction.newAmount, correction.currency ?? currency)}
              </span>
              <span className="text-small text-text-secondary">
                {formatStamp(correction.correctedAt, timeZone)}
                {correction.correctedBy ? ` by ${correction.correctedBy}` : ""}
              </span>
              <ul className="text-small text-text-primary">
                {correction.changes.map((change) => (
                  <li key={change.key}>
                    <span className="text-text-secondary">{change.label}:</span> {shown(change.from, change, correction.currency)} → {shown(change.to, change, correction.currency)}
                  </li>
                ))}
              </ul>
              <span className="text-small text-text-secondary">
                Paid at the time: {formatCurrency(correction.paymentsTotal, correction.currency ?? currency)}
              </span>
              <span className="text-small break-words whitespace-pre-line text-text-secondary">Reason: {correction.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
