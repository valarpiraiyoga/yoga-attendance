import Link from "next/link";
import { Banknote, CalendarDays, CreditCard, FileText, Layers, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currencies";
import { formatPeriod } from "@/lib/memberships/period";
import { classCountText } from "@/lib/memberships/class-count";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";

/** A faint lotus mark for the card's corner - decoration only, hidden from assistive technology. */
function LotusMark({ className }) {
  return (
    <svg viewBox="0 0 120 80" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M60 6c9 10 14 22 14 34S69 64 60 72c-9-8-14-20-14-32S51 16 60 6Z" />
      <path d="M33 22c12 3 22 12 27 24 2 6 2 14 0 26-12-2-22-9-27-20-4-9-4-19 0-30Z" opacity=".8" />
      <path d="M87 22c-12 3-22 12-27 24-2 6-2 14 0 26 12-2 22-9 27-20 4-9 4-19 0-30Z" opacity=".8" />
      <path d="M8 40c15-2 30 3 40 14 4 5 8 11 12 18-16 3-30 0-40-8C14 58 10 50 8 40Z" opacity=".6" />
      <path d="M112 40c-15-2-30 3-40 14-4 5-8 11-12 18 16 3 30 0 40-8 6-6 10-14 12-24Z" opacity=".6" />
    </svg>
  );
}

function Fact({ icon: Icon, label, children, className }) {
  return (
    <div className={`flex min-w-0 items-start gap-2 ${className ?? ""}`}>
      <Icon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-small text-text-secondary">{label}</dt>
        <dd className="text-small font-semibold break-words text-text-primary">{children}</dd>
      </div>
    </div>
  );
}

/**
 * Student Details → Membership: the current membership as a summary card - the centre's name, the plan, the membership number
 * (a link to Membership Details), its status, and a row of facts: validity (with the days left), the amount and the payment
 * status; a class-count membership also shows its classes. Edit Membership stays on the card. Beneath the card, the membership's
 * issued invoices and receipts (if it has any) are links to their pages - the same links, from the same data, as in Membership
 * History. Data and rules are unchanged:
 * the same current membership, status and validity derivation as before.
 */
export default function MembershipSummaryCard({ membership, centreName, today, showDocuments = true }) {
  const status = MEMBERSHIP_STATUS[membership.status] ?? { label: membership.status, variant: "neutral" };
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const validity = getMembershipValidity(membership, today);
  const validityNote = membership.status === "active" || membership.status === "upcoming" ? getValidityLabel(validity).text : null;

  // Membership Details shows the documents in its Payments section, so its carousel passes showDocuments={false}.
  const documents = showDocuments ? (membership.documents ?? []) : [];

  return (
    <>
    <div className="overflow-hidden rounded-card border border-warning/30">
      <div className="relative bg-linear-to-br from-warning/10 via-warning/25 to-warning/55 px-4 pt-4 pb-5">
        <LotusMark className="pointer-events-none absolute -right-3 -bottom-4 h-24 w-36 text-surface/60" />
        <div className="relative flex items-start justify-between gap-3">
          <p className="text-small min-w-0 truncate font-semibold text-text-primary">{centreName}</p>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="outline" className="border-warning/40 bg-surface/80">
              {PLAN[membership.plan] ?? membership.plan}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-text-secondary hover:bg-surface/60 hover:text-brand"
              aria-label={`Edit membership ${membership.membership_code}`}
              title="Edit Membership"
              render={<Link href={`/memberships/${membership.id}/edit`} />}
              nativeButton={false}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <Link
          href={`/memberships/${membership.id}`}
          className="relative mt-2 block w-fit text-[1.75rem] leading-9 font-bold tracking-tight text-text-primary hover:underline"
          title="View Membership"
        >
          {membership.membership_code}
        </Link>
        <Badge variant={status.variant} className="relative mt-2">
          {status.label}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-3 bg-warning/5 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Fact icon={CalendarDays} label="Validity">
          {formatPeriod(membership.start_date, membership.end_date)}
          {validityNote ? <span className="block font-normal text-text-secondary">{validityNote}</span> : null}
        </Fact>
        <Fact icon={Banknote} label="Amount">
          {formatCurrency(membership.amount, membership.currency)}
        </Fact>
        <div className="flex min-w-0 items-start gap-2">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="text-small text-text-secondary">Payment</dt>
            <dd className="mt-0.5">
              <Badge variant={payment.variant}>{payment.label}</Badge>
            </dd>
          </div>
        </div>
        {membership.class_count ? (
          <Fact icon={Layers} label="Classes" className="sm:col-span-3">
            {classCountText(membership.class_count)}
          </Fact>
        ) : null}
      </dl>
    </div>

    {documents.length > 0 ? (
      <p className="text-small mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <FileText className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        {documents.map((document) => (
          <Link
            key={document.id}
            href={document.href}
            aria-label={`Open ${document.label} ${document.number}`}
            className="font-medium text-brand hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {document.label} {document.number}
          </Link>
        ))}
      </p>
    ) : null}
    </>
  );
}
