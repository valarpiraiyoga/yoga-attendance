"use client";

import { useState } from "react";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatAmount, formatDate } from "@/lib/format";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";

/** "30 days" / "6 months" — real length of the period, derived from its dates. */
function describePeriodLength(totalDays) {
  if (totalDays === 1) return "1 day";
  if (totalDays < 60) return `${totalDays} days`;
  return `${Math.round(totalDays / 30)} months`;
}

/**
 * Membership table row (`06 Memberships table view.png`): Membership,
 * Student, Plan, Period, Amount, Payment, Status, Days Left, Action.
 * The Membership cell's second line is the period's real length rather than
 * the reference's plan-type label, which would just repeat the Plan column.
 */
export default function MembershipTableRow({ membership, today }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const student = membership.students;
  const status = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const validity = getMembershipValidity(membership, today);
  const daysLeft = getValidityLabel(validity, { compact: true });

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell>
        <p className="whitespace-nowrap font-semibold text-text-primary">{membership.membership_code}</p>
        <p className="text-small text-text-secondary">{describePeriodLength(validity.totalDays)}</p>
      </TableCell>
      <TableCell>
        {student ? (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={student.full_name} src={student.photo_url} />
            <div className="min-w-0">
              <p className="font-medium text-text-primary">{student.full_name}</p>
              <p className="text-small text-text-secondary">{student.student_code}</p>
            </div>
          </div>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </TableCell>
      <TableCell className="text-text-secondary">{PLAN[membership.plan] ?? membership.plan}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">
        {formatDate(membership.start_date)} – {formatDate(membership.end_date)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatAmount(membership.amount)}</TableCell>
      <TableCell>
        <Badge variant={payment.variant}>{payment.label}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className="tabular-nums text-text-secondary">{daysLeft.text}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
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
        </div>
      </TableCell>
    </TableRow>
  );
}
