"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Receipt, IndianRupee, Layers, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import Progress from "@/components/ui/progress";
import { formatAmount, formatDate } from "@/lib/format";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";

/**
 * Validity bar colour: red once Expired, orange while payment is still
 * Pending (as the reference shows), otherwise green.
 */
function validityTone(membership, validity) {
  if (validity.status === "expired") return "danger";
  if (membership.payment_status === "pending") return "warning";
  return "success";
}

/**
 * Membership list card (`05 Memberships card view.png`): student identity +
 * status, then code / plan / period / amount+payment, then a validity
 * footer (days left + progress bar). Card actions follow the finalized
 * Students pattern: eye icon (View) + overflow menu. Composed from
 * `EntityCard`; only the interactive menu-open tint is local state.
 */
export default function MembershipCardItem({ membership, today }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const student = membership.students;
  const status = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const planLabel = PLAN[membership.plan] ?? membership.plan;
  const validity = getMembershipValidity(membership, today);
  const validityLabel = getValidityLabel(validity);
  const isExpired = validity.status === "expired";
  const showBar = validity.status !== "cancelled";
  const period = `${formatDate(membership.start_date)} – ${formatDate(membership.end_date)}`;

  return (
    <EntityCard
      className={cn(
        isExpired && "border-danger/20 bg-danger/5",
        menuOpen && "border-brand/40 bg-brand/5"
      )}
      iconClassName="text-brand"
      avatar={<Avatar name={student?.full_name} src={student?.photo_url} bordered />}
      title={student?.full_name ?? "—"}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View receipt for ${membership.membership_code}`}
            render={<Link href={`/memberships/${membership.id}/receipt`} />}
            nativeButton={false}
          >
            <Receipt className="size-4" aria-hidden="true" />
          </Button>
          <MembershipCardMenu
            membershipId={membership.id}
            studentId={student?.id}
            onOpenChange={setMenuOpen}
          />
        </>
      }
      meta={[
        {
          icon: Layers,
          label: (
            <>
              Code: <span className="font-medium text-text-primary">{membership.membership_code}</span>
            </>
          ),
          title: `Code: ${membership.membership_code}`,
        },
        {
          icon: Tag,
          label: (
            <>
              Plan: <span className="font-medium text-text-primary">{planLabel}</span>
            </>
          ),
          title: `Plan: ${planLabel}`,
        },
        { icon: CalendarDays, label: period, title: period },
        {
          icon: IndianRupee,
          label: (
            <>
              <span className="font-medium text-text-primary">{formatAmount(membership.amount)}</span>{" "}
              <Badge variant={payment.variant}>{payment.label}</Badge>
            </>
          ),
          title: `${formatAmount(membership.amount)} · ${payment.label}`,
        },
      ]}
    >
      {/* Validity footer: days-left label over the progress bar. */}
      <div className="mt-auto flex flex-col gap-1.5">
        {/* Literal class strings, deliberately not through `cn()` — see StatTile. */}
        <p
          className={
            validityLabel.tone === "danger"
              ? "text-small font-medium text-danger"
              : "text-small font-normal text-text-secondary"
          }
        >
          {validityLabel.text}
        </p>
        {showBar ? (
          <Progress
            value={validity.percentUsed}
            tone={validityTone(membership, validity)}
            label="Membership validity used"
          />
        ) : null}
      </div>
    </EntityCard>
  );
}
