"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { formatCurrency } from "@/lib/currencies";
import { MEMBERSHIP_STATUS, PLAN } from "@/lib/status";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";
import MembershipIssueInvoiceDialog from "@/app/memberships/membership-issue-invoice";

/**
 * One row of Membership Details' Membership History table — one of the
 * student's other memberships: ID, plan, period, amount, status, and the
 * finalized action pair (eye icon + the same overflow menu the Memberships
 * list uses: View / Edit / Renew Membership, and the status-aware document action - for a Paid
 * membership with no receipt, that is Issue Receipt, which opens the existing dialog from here).
 */
export default function MembershipHistoryRow({ entry, student }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const status = MEMBERSHIP_STATUS[entry.status] ?? MEMBERSHIP_STATUS.expired;

  return (
    <TableRow
      className={cn(
        "border-border/30 bg-surface/40 transition-colors hover:bg-surface/70",
        menuOpen && "bg-brand/10 hover:bg-brand/10"
      )}
    >
      <TableCell className="font-semibold whitespace-nowrap text-text-primary">{entry.membership_code}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{PLAN[entry.plan] ?? entry.plan}</TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">
        {formatDate(entry.start_date)} – {formatDate(entry.end_date)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-text-secondary">{formatCurrency(entry.amount, entry.currency)}</TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`View membership ${entry.membership_code}`}
            render={<Link href={`/memberships/${entry.id}`} />}
            nativeButton={false}
          >
            <Eye className="size-4" aria-hidden="true" />
          </Button>
          <MembershipCardMenu
            membershipId={entry.id}
            paymentStatus={entry.payment_status}
            invoiceExists={entry.invoice_exists}
            hasPayments={entry.has_payments}
            onIssueInvoice={() => setIssueOpen(true)}
            onOpenChange={setMenuOpen}
          />
          {entry.payment_status === "paid" && !entry.invoice_exists && !entry.has_payments ? (
            <MembershipIssueInvoiceDialog membership={entry} student={student} open={issueOpen} onOpenChange={setIssueOpen} />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
