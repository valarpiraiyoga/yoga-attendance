"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Eye, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import Progress from "@/components/ui/progress";
import { formatDate } from "@/lib/format";
import { formatCurrency } from "@/lib/currencies";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS } from "@/lib/status";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";

/** Validity bar colour: red once Expired, otherwise the brand teal. */
function validityTone(validity) {
  return validity.status === "expired" ? "danger" : "brand";
}

/**
 * Membership list card (finalized reference): the student's avatar, name
 * (primary) and the membership ID beneath it, View + menu with the membership
 * status stacked under them, then the period, the amount with its payment
 * badge, and a validity footer — "N days left" with "N / total days" and the
 * progress bar while it runs, or a red "Expired" block with a full red bar.
 * Everything comes from the existing validity helpers and status maps. Card
 * actions follow the finalized pattern: eye icon (View) + overflow menu (which
 * also has the receipt). Composed from `EntityCard`; only the interactive
 * menu-open tint is local state.
 */
export default function MembershipCardItem({ membership, today }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const student = membership.students;
  const status = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const validity = getMembershipValidity(membership, today);
  const validityLabel = getValidityLabel(validity);
  const isExpired = validity.status === "expired";
  const isActive = validity.status === "active";
  const showBar = validity.status !== "cancelled";
  const period = `${formatDate(membership.start_date)} – ${formatDate(membership.end_date)}`;

  return (
    <EntityCard
      className={cn("h-auto", menuOpen && "border-brand/40 bg-brand/5")}
      iconClassName="text-brand"
      avatar={<Avatar name={student?.full_name} src={student?.photo_url} size="lg" bordered />}
      title={student?.full_name ?? "—"}
      subtitle={membership.membership_code}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      statusPlacement="actions"
      actions={
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View membership for ${student?.full_name ?? membership.membership_code}`}
            render={<Link href={`/memberships/${membership.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <MembershipCardMenu
            membershipId={membership.id}
            studentId={student?.id}
            onOpenChange={setMenuOpen}
          />
        </div>
      }
      meta={[
        { icon: CalendarDays, label: period, title: period },
        {
          icon: Banknote,
          label: (
            <>
              <span className="font-medium text-text-primary">{formatCurrency(membership.amount, membership.currency)}</span>{" "}
              <Badge variant={payment.variant}>{payment.label}</Badge>
            </>
          ),
          title: `${formatCurrency(membership.amount, membership.currency)} · ${payment.label}`,
        },
      ]}
    >
      {/* Validity footer: the label (and, while it runs, "N / total days") over
          the progress bar; an Expired membership gets a red-tinted block. */}
      <div className={cn("mt-auto flex flex-col gap-1.5", isExpired && "rounded-lg bg-danger/10 px-3 py-2")}>
        <div className="flex items-baseline justify-between gap-2">
          {/* Literal class strings, deliberately not through `cn()` — see StatTile. */}
          <p
            className={
              validityLabel.tone === "danger"
                ? "text-body font-semibold text-danger"
                : "text-small font-normal text-text-secondary"
            }
          >
            {validityLabel.text}
          </p>
          {isActive ? (
            <p className="text-small font-normal text-text-secondary tabular-nums">
              {validity.daysLeft} / {validity.totalDays} days
            </p>
          ) : null}
        </div>
        {showBar ? <Progress value={validity.percentUsed} tone={validityTone(validity)} label="Membership validity used" /> : null}
      </div>
    </EntityCard>
  );
}
