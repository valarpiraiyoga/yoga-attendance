"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PLAN_LABELS = { monthly: "Monthly", quarterly: "Quarterly", custom: "Custom duration" };
const PAYMENT_LABELS = { paid: "Paid", pending: "Pending" };
const STATUS_LABELS = { upcoming: "Upcoming", active: "Active", expired: "Expired", cancelled: "Cancelled" };
const STATUS_VARIANTS = { upcoming: "default", active: "success", expired: "neutral", cancelled: "danger" };

function formatDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatAmount(value) {
  return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MembershipTableRow({ membership }) {
  const [focused, setFocused] = useState(false);

  return (
    <TableRow
      className={cn(
        "border-border/40 transition-colors",
        focused ? "bg-brand/10" : "hover:bg-brand/5"
      )}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
        }
      }}
    >
      <TableCell className="px-5 py-3.5">
        <p className="font-semibold text-text-primary">{membership.membership_code}</p>
        <p className="text-small text-text-secondary">{PLAN_LABELS[membership.plan] ?? membership.plan}</p>
      </TableCell>
      <TableCell className="px-5 py-3.5">
        {membership.students ? (
          <>
            <p className="font-medium text-text-primary">{membership.students.full_name}</p>
            <p className="text-small text-text-secondary">{membership.students.student_code}</p>
          </>
        ) : (
          <span className="text-text-secondary">—</span>
        )}
      </TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">{formatDate(membership.start_date)}</TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">{formatDate(membership.end_date)}</TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">{formatAmount(membership.amount)}</TableCell>
      <TableCell className="px-5 py-3.5 text-text-secondary">
        {PAYMENT_LABELS[membership.payment_status] ?? membership.payment_status}
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Badge variant={STATUS_VARIANTS[membership.status]} className="rounded-full px-2 py-0">
          <span className="text-[10px] leading-[14px] font-medium">
            {STATUS_LABELS[membership.status]}
          </span>
        </Badge>
      </TableCell>
      <TableCell className="px-5 py-3.5">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-text-secondary hover:text-brand"
          render={<Link href={`/memberships/${membership.id}`} />}
          nativeButton={false}
          aria-label={`View membership ${membership.membership_code}`}
        >
          <Eye className="size-4" aria-hidden="true" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
