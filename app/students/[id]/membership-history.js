import Link from "next/link";
import { ChevronRight, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatPeriod } from "@/lib/memberships/period";
import { MEMBERSHIP_STATUS } from "@/lib/status";

/**
 * Student Details → Membership History: the student's other memberships (everything except the one shown in Membership above),
 * newest first, numbered. A row opens that membership's Membership Details - the same destination as before - and shows the
 * membership number, its dates (the plan is not repeated: the dates already say the duration), the
 * amount and the membership's own derived status (Upcoming, Active, Expired or Cancelled; nothing is relabelled or invented).
 * When the membership has issued invoices or receipts they are listed beneath the dates, each a link to that document.
 *
 * The row's link covers the whole row (a stretched link); the document links sit above it, so they are real, separate links and
 * never nested inside another link.
 */
export default function MembershipHistory({ memberships }) {
  return (
    <Panel>
      <PanelHeader icon={History} tone="brand" title="Membership History" />
      {memberships.length === 0 ? (
        <EmptyState size="compact" title="No earlier memberships" />
      ) : (
        <ol aria-label="Membership history, newest first" className="flex flex-col gap-2.5">
          {memberships.map((membership, index) => {
            const status = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
            const documents = membership.documents ?? [];
            return (
              <li
                key={membership.id}
                className="relative flex items-center gap-3 rounded-card border border-border bg-surface p-3 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:border-brand/40 hover:bg-brand/5"
              >
                <span
                  aria-hidden="true"
                  className="text-small flex size-8 shrink-0 items-center justify-center rounded-full bg-background font-semibold text-text-secondary"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/memberships/${membership.id}`}
                    aria-label={`Membership ${membership.membership_code}, ${status.label}. Open Membership Details`}
                    className="text-body block w-fit font-semibold text-text-primary outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {membership.membership_code}
                  </Link>
                  <p className="text-small text-text-secondary">{formatPeriod(membership.start_date, membership.end_date)}</p>
                  {documents.length > 0 ? (
                    <p className="text-small mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {documents.map((document) => (
                        <Link
                          key={document.id}
                          href={document.href}
                          aria-label={`Open ${document.label} ${document.number}`}
                          className="relative z-10 font-medium text-brand hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {document.label} {document.number}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-body font-semibold whitespace-nowrap text-text-primary tabular-nums">
                    {formatCurrency(membership.amount, membership.currency)}
                  </span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
