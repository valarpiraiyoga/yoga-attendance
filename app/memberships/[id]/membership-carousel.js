import Link from "next/link";
import { ChevronLeft, ChevronRight, CreditCard, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatPeriod } from "@/lib/memberships/period";
import { dotWindow, membershipPlanLine, neighboursOf } from "@/lib/memberships/list-panel-core";
import { MEMBERSHIP_STATUS, PLAN } from "@/lib/status";
import { cn } from "@/lib/utils";
import MembershipSummaryCard from "@/app/students/[id]/membership-summary-card";

/** The previous / next arrow: a circular link to the neighbouring membership, or an inert disabled circle at either end. */
function Arrow({ direction, target, className }) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = direction === "previous" ? "Previous membership" : "Next membership";
  const shared = "flex size-9 items-center justify-center rounded-full border border-border bg-surface text-text-primary shadow-sm";

  if (!target) {
    return (
      <span aria-disabled="true" aria-label={`${label} (none)`} className={cn(shared, "pointer-events-none opacity-40", className)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <Link
      href={`/memberships/${target.id}`}
      scroll={false}
      aria-label={`${label}: ${target.membership_code}`}
      title={`${label}: ${target.membership_code}`}
      className={cn(shared, "transition-colors hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", className)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * A neighbouring membership, partly visible beside the selected one: a subdued card with its number, plan, dates, amount and
 * status. It is a link to that membership.
 */
function SideCard({ membership, side }) {
  const state = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
  return (
    <Link
      href={`/memberships/${membership.id}`}
      scroll={false}
      aria-label={`Show membership ${membership.membership_code}, ${state.label}`}
      tabIndex={-1}
      className={cn(
        "absolute top-1/2 z-0 hidden w-64 -translate-y-1/2 flex-col gap-1 rounded-card border border-border bg-neutral/15 p-4 text-left opacity-70 transition-opacity hover:opacity-90 md:flex",
        side === "left" ? "left-1 origin-left scale-95 pr-10" : "right-1 origin-right scale-95 pl-10",
      )}
    >
      <span className="text-body font-semibold text-text-secondary">{membership.membership_code}</span>
      <span className="text-small break-words text-text-secondary">{membershipPlanLine(membership, PLAN)}</span>
      <span className="text-small text-text-secondary">{formatPeriod(membership.start_date, membership.end_date)}</span>
      <span className="text-body mt-1 font-semibold text-text-secondary tabular-nums">{formatCurrency(membership.amount, membership.currency)}</span>
      <Badge variant={state.variant} className="w-fit">
        {state.label}
      </Badge>
    </Link>
  );
}

/**
 * Membership Details → the Membership section at the top of the details (its header: Renew - for the selected membership - and Add Membership): the selected membership as the orange summary card
 * (the one Student Details uses) centred, with the previous and the next membership partly visible on either side.
 *
 * The selection IS the page's membership (`membership.id`, the same one the left list highlights and every panel below shows).
 * The arrows, the side cards and the dots are links to the neighbouring membership's own page, so choosing one changes the whole
 * page, never only this card. Neighbours are the memberships in the order the left list shows them (`memberships` as the page
 * loaded them - no ordering of its own): the card on the left is the one before the selected membership in that list, the card on
 * the right the one after. At either end there is no card on that side and its arrow is disabled; a single membership is shown
 * alone, with no arrows or dots.
 *
 * Wide screens: side cards peek out from behind the centre card and the arrows sit at the edges. Below `md` the side cards are not
 * shown; the arrows and dots sit in one row beneath the card.
 */
export default function MembershipCarousel({ memberships, selectedId, studentId, centreName, today }) {
  const { index, previous, next } = neighboursOf(memberships, selectedId);
  const selected = memberships[index];
  const many = memberships.length > 1;
  const dots = dotWindow(memberships.length, index);

  return (
    <Panel aria-label="Membership" className="sm:p-4">
      <PanelHeader
        icon={CreditCard}
        tone="brand"
        title="Membership"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="sm" render={<Link href={`/memberships/${selectedId}/renew`} />} nativeButton={false}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Renew
            </Button>
            <Button size="sm" render={<Link href={`/students/${studentId}/memberships/new`} />} nativeButton={false}>
              <Plus className="size-4" aria-hidden="true" />
              Add Membership
            </Button>
          </div>
        }
        className="mb-3"
      />

      <div className="relative overflow-hidden py-3">
        {previous ? <SideCard membership={previous} side="left" /> : null}
        {next ? <SideCard membership={next} side="right" /> : null}

        <div className="relative z-10 mx-auto w-full max-w-120 rounded-card bg-surface shadow-md">
          <MembershipSummaryCard membership={selected} centreName={centreName} today={today} showDocuments={false} />
        </div>

        {many ? (
          <>
            <Arrow direction="previous" target={previous} className="absolute top-1/2 left-2 z-20 hidden -translate-y-1/2 md:flex" />
            <Arrow direction="next" target={next} className="absolute top-1/2 right-2 z-20 hidden -translate-y-1/2 md:flex" />
          </>
        ) : null}
      </div>

      {many ? (
        <nav aria-label="Memberships of this student" className="mt-1 flex items-center justify-center gap-3">
          <Arrow direction="previous" target={previous} className="md:hidden" />
          <ul className="flex items-center gap-2">
            {memberships.slice(dots.from, dots.to).map((entry) => {
              const isSelected = entry.id === selectedId;
              return (
                <li key={entry.id}>
                  <Link
                    href={`/memberships/${entry.id}`}
                    scroll={false}
                    aria-current={isSelected ? "page" : undefined}
                    aria-label={`Show membership ${entry.membership_code}`}
                    title={entry.membership_code}
                    className="flex size-4 items-center justify-center rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className={cn("block rounded-full transition-all", isSelected ? "size-2.5 bg-brand" : "size-2 bg-neutral/50 hover:bg-neutral")} />
                  </Link>
                </li>
              );
            })}
          </ul>
          <Arrow direction="next" target={next} className="md:hidden" />
        </nav>
      ) : null}
    </Panel>
  );
}
