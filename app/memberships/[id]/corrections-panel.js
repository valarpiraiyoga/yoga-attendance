import Link from "next/link";
import { Flag, Pencil, PencilRuler } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { Panel } from "@/components/layout/Panel";
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

/** One field of a correction: its name, the stored value before, an arrow, the stored value after. */
function ChangeRow({ label, before, after }) {
  return (
    <tr className="border-t border-border/60">
      <td className="py-1.5 pr-3 pl-3 text-text-primary">{label}</td>
      <td className="py-1.5 pr-3 text-text-primary">{before}</td>
      <td aria-hidden="true" className="w-10 py-1.5 text-center text-brand">→</td>
      <td className="py-1.5 pr-3 text-text-primary">{after}</td>
    </tr>
  );
}

/**
 * Corrections of a package-linked membership (Membership Details; 01-product.md section 5A "Fee corrections"): the history of every
 * correction - who, when, the reason and what changed, from the stored before and after - and a link to Edit Membership, where a
 * correction is made (one workflow: the notes are saved plainly, a change of package, duration, start date or price is reviewed,
 * given a reason and confirmed). The history is read from `membership_term_corrections` (migration 0050); it can
 * only grow, and nothing here changes a membership, a payment or a document.
 *
 * Layout: a tinted tile with the title, description and Edit Membership; then one card per correction (numbered in the order listed): the old
 * amount struck through, an arrow and the new amount, who and when with the author's avatar, a Field | Before | → | After table of what
 * changed (plus "Paid at the time"), and the reason in a tinted box with a flag. Presentation only - the data, the order and the link are the
 * existing ones.
 *
 * @param {{ membershipId: string, currency: string, canEdit: boolean, corrections: object[]|null, timeZone: string }} props
 */
export default function CorrectionsPanel({ membershipId, currency, canEdit, corrections, timeZone }) {
  return (
    <Panel aria-label="Corrections" className="sm:p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <PencilRuler className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-section-title font-semibold text-text-primary">Corrections</h2>
            <p className="text-small text-text-secondary">
              Changes to the package, price or dates after the membership was created, each with its reason. Payments and receipts are never changed by a correction.
            </p>
          </div>
        </div>
        {canEdit ? (
          <Button variant="secondary" size="sm" render={<Link href={`/memberships/${membershipId}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit Membership
          </Button>
        ) : null}
      </div>
      {corrections === null ? (
        <EmptyState size="sm" title="The corrections could not be loaded" description="Try refreshing the page." />
      ) : corrections.length === 0 ? (
        <EmptyState size="compact" title="No corrections" description="A correction of this membership's package, price or dates appears here, with its reason." className="items-center py-4 text-center" />
      ) : (
        <ul className="flex flex-col gap-4">
          {corrections.map((correction, index) => {
            const money = (value) => formatCurrency(value, correction.currency ?? currency);
            return (
              <li key={correction.id} className="rounded-card border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-small font-semibold text-brand">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-section-title flex flex-wrap items-center gap-x-2 font-semibold text-text-primary tabular-nums">
                      <span className="text-text-secondary line-through">{money(correction.oldAmount)}</span>
                      <span aria-hidden="true" className="text-brand">→</span>
                      <span className="sr-only">changed to</span>
                      <span>{money(correction.newAmount)}</span>
                    </p>
                    <p className="text-small mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-secondary">
                      <span>{formatStamp(correction.correctedAt, timeZone)}</span>
                      {correction.correctedBy ? (
                        <>
                          <span>by</span>
                          <span className="inline-flex items-center gap-1.5">
                            <Avatar name={correction.correctedBy} size="sm" className="size-6 text-[0.625rem]" />
                            {correction.correctedBy}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table aria-label={`Correction ${index + 1}: what changed`} className="text-small w-full min-w-[28rem] text-left">
                    <thead>
                      <tr className="bg-brand/5 text-brand">
                        <th scope="col" className="w-2/5 py-1.5 pl-3 font-medium">Field</th>
                        <th scope="col" className="py-1.5 font-medium">Before</th>
                        <th scope="col" className="w-10 py-1.5"><span className="sr-only">Change</span></th>
                        <th scope="col" className="py-1.5 font-medium">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {correction.changes.map((change) => (
                        <ChangeRow
                          key={change.key}
                          label={change.label}
                          before={shown(change.from, change, correction.currency)}
                          after={shown(change.to, change, correction.currency)}
                        />
                      ))}
                      <tr className="border-t border-border/60">
                        <td className="py-1.5 pl-3 text-text-primary">Paid at the time</td>
                        <td className="py-1.5 text-text-primary">{money(correction.paymentsTotal)}</td>
                        <td />
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex items-start gap-3 rounded-card border border-info/20 bg-info/10 px-3 py-2.5">
                  <Flag className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
                  <div className="min-w-0 border-l border-info/20 pl-3">
                    <p className="text-small text-text-secondary">Reason</p>
                    <p className="text-body break-words whitespace-pre-line text-text-primary">{correction.reason}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
