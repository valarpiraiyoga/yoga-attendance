"use client";

import { useState } from "react";
import Link from "next/link";
import { FilePlus, FileText, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { formatCurrency } from "@/lib/currencies";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import { membershipDocumentAction } from "@/lib/memberships/document-action";
import MembershipIssueInvoiceDialog from "@/app/memberships/membership-issue-invoice";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";

// Responsive by the table's own width (container queries), not the viewport,
// the same rule as the Attendance, Schedule, Batches and Students tables.
// Narrowest (mobile): Membership (the ID, with the student beneath it), Status,
// Action — the priority columns. From 40rem: Student as its own column. From
// 42rem: Payment and Amount. From 52rem: Days Left. From 68rem: Plan and
// Period — the whole table, which fits the ~1120px a 1440px screen leaves it.
const STUDENT_ONLY = "hidden @[40rem]:table-cell";
const PAYMENT_ONLY = "hidden @[42rem]:table-cell";
const DAYS_ONLY = "hidden @[52rem]:table-cell";
const WIDE_ONLY = "hidden @[68rem]:table-cell";

const HEAD = "h-10 px-2 text-small tracking-normal";

/**
 * One membership as a table row (finalized reference): Membership (the ID,
 * primary), Student (avatar, name, student code), Plan, Period, Amount,
 * Payment, Status, Days Left, Action. Status and Days Left come from the
 * existing validity helpers (`getMembershipValidity` / `getValidityLabel`,
 * against the centre-timezone `today` the page passes down), never computed
 * here; Action is the document icon + overflow menu, whose
 * first item, View Membership, opens the membership detail page — the eye
 * icon is deliberately not used here, so it stays a document-only mark. The document
 * icon follows the payment status and the invoice: Pending -> the file icon, View Payment
 * Acknowledgement; Paid with a receipt -> the receipt icon, View Receipt; Paid without one -> the
 * file-plus icon, Issue Receipt, which opens the existing Issue Receipt dialog (`membershipDocumentAction`).
 */
const DOCUMENT_ICON = { "due-notice": FileText, "receipt": Receipt, "issue-receipt": FilePlus };

function MembershipRow({ membership, today }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

  const student = membership.students;
  const status = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const documentAction = membershipDocumentAction(membership.id, membership.payment_status, membership.invoice_exists);
  const DocumentIcon = DOCUMENT_ICON[documentAction.kind];
  const validity = getMembershipValidity(membership, today);
  const daysLeft = getValidityLabel(validity, { compact: true });

  return (
    <TableRow className={cn(menuOpen && "bg-brand/10 hover:bg-brand/10")}>
      <TableCell className="py-3 pr-2 pl-3">
        <p className="text-body font-semibold whitespace-nowrap text-text-primary">{membership.membership_code}</p>
        {/* Below 40rem the student has no column of its own. */}
        {student ? (
          <p className="text-small text-text-secondary @[40rem]:hidden">{student.full_name}</p>
        ) : null}
      </TableCell>
      <TableCell className={cn("px-2 py-3", STUDENT_ONLY)}>
        {student ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={student.full_name} src={student.photo_url} />
            <div className="min-w-0">
              <p className="text-body font-semibold text-text-primary">{student.full_name}</p>
              <p className="text-small text-text-secondary">{student.student_code}</p>
            </div>
          </div>
        ) : (
          <span className="text-text-secondary">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-text-secondary", WIDE_ONLY)}>
        {PLAN[membership.plan] ?? membership.plan}
      </TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap text-text-secondary", WIDE_ONLY)}>
        {formatDate(membership.start_date)} {"\u2013"} {formatDate(membership.end_date)}
      </TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap text-text-secondary", PAYMENT_ONLY)}>
        {formatCurrency(membership.amount, membership.currency)}
      </TableCell>
      <TableCell className={cn("px-2 py-3", PAYMENT_ONLY)}>
        <Badge variant={payment.variant}>{payment.label}</Badge>
      </TableCell>
      <TableCell className="px-2 py-3">
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className={cn("px-2 py-3 text-center tabular-nums text-text-secondary", DAYS_ONLY)}>
        {daysLeft.text}
      </TableCell>
      <TableCell className="w-px py-3 pr-3 pl-1 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-brand hover:bg-brand/10 hover:text-brand"
            aria-label={`${documentAction.label} for membership ${membership.membership_code}`}
            title={documentAction.label}
            {...(documentAction.href
              ? { render: <Link href={documentAction.href} />, nativeButton: false }
              : { onClick: () => setIssueOpen(true) })}
          >
            <DocumentIcon className="size-4" aria-hidden="true" />
          </Button>
          <MembershipCardMenu
            membershipId={membership.id}
            studentId={student?.id}
            paymentStatus={membership.payment_status}
            invoiceExists={membership.invoice_exists}
            onIssueInvoice={() => setIssueOpen(true)}
            onOpenChange={setMenuOpen}
          />
          {documentAction.kind === "issue-receipt" ? (
            <MembershipIssueInvoiceDialog membership={membership} student={student} open={issueOpen} onOpenChange={setIssueOpen} />
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The Memberships table (finalized compact style): see `MembershipRow` for the columns. */
export default function MembershipTable({ memberships, today }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label="Memberships">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Membership</TableHead>
            <TableHead className={cn(HEAD, STUDENT_ONLY)}>Student</TableHead>
            <TableHead className={cn(HEAD, WIDE_ONLY)}>Plan</TableHead>
            <TableHead className={cn(HEAD, WIDE_ONLY)}>Period</TableHead>
            <TableHead className={cn(HEAD, PAYMENT_ONLY)}>Amount</TableHead>
            <TableHead className={cn(HEAD, PAYMENT_ONLY)}>Payment</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={cn(HEAD, "text-center", DAYS_ONLY)}>Days Left</TableHead>
            <TableHead className="h-10 w-px pr-3 pl-1 text-small tracking-normal whitespace-nowrap">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <MembershipRow key={membership.id} membership={membership} today={today} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
