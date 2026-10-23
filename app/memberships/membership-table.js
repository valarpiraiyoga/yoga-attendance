"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, CircleCheck, Clock, FilePlus, FileText, Flower2, Receipt, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import AnimatedBorder from "@/components/ui/animated-border";
import { formatPhone } from "@/lib/phone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { formatCurrency } from "@/lib/currencies";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import { membershipDocumentAction } from "@/lib/memberships/document-action";
import { formatEndDate } from "@/lib/memberships/period";
import MembershipIssueInvoiceDialog from "@/app/memberships/membership-issue-invoice";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";
import ReminderIndicators from "@/app/memberships/reminder-indicators";
import MembershipReminderMessage, { ReminderMessageButton, hasReminder } from "@/app/memberships/membership-reminder-message";

// Responsive by the table's own width (container queries), not the viewport, the same rule as the Attendance, Schedule, Batches and Students
// tables. Narrowest (mobile): Student, Membership (with its status) and Actions - the priority columns. From 42rem: Amount & Payment. From
// 52rem: Plan & Period. From 60rem: Time Remaining - the whole table, which fits the ~1120px a 1440px screen leaves it.
const PAYMENT_ONLY = "hidden @[42rem]:table-cell";
const PERIOD_ONLY = "hidden @[52rem]:table-cell";
const REMAINING_ONLY = "hidden @[60rem]:table-cell";

// Each membership is its own rounded row card on the page background (the table is `border-separate`, with a gap between rows), the same
// look as the Students table: a pale rounded header strip, and every row's cells carry the surface and the pale border, rounded at the row's
// two ends. The hover border is the shared animated one (`.card-border-animated-row`, drawn by `AnimatedBorder` in the first cell).
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-2 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";
const SURFACE = "[&>td]:bg-surface";
const SURFACE_OPEN = "[&>td]:bg-brand/10";

// The icon tile tints, by the existing status variants (presentation only).
const TILE = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-neutral/15 text-text-secondary",
};
const PAYMENT_ICON = { paid: CircleCheck, partially_paid: Clock, pending: Clock };

/**
 * One membership as a row card: Student (avatar, name, student code, phone), Membership (a status-tinted document tile, the ID and the status
 * badge, with the membership's reminder indicators beneath), Plan & Period, Amount & Payment, Time Remaining and Actions. Status and Time
 * Remaining come from the existing validity helpers (`getMembershipValidity` / `getValidityLabel`,
 * against the centre-timezone `today` the page passes down), never computed
 * here (the date beneath the Time Remaining text is the start date for an upcoming membership, the end date otherwise); Actions is the document icon + overflow menu, whose
 * first item, View Membership, opens the membership detail page — the eye
 * icon is deliberately not used here, so it stays a document-only mark. The document
 * icon follows the payment status and the invoice: Pending -> the file icon, View Payment
 * Acknowledgement; Paid with a receipt -> the receipt icon, View Receipt; Paid without one -> the
 * file-plus icon, Issue Receipt, which opens the existing Issue Receipt dialog (`membershipDocumentAction`).
 */
const DOCUMENT_ICON = { "due-notice": FileText, "receipt": Receipt, "issue-receipt": FilePlus, "payments": Wallet };

function MembershipRow({ membership, today, reminders, centreName }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  // The reminder message popup - opened by the red bell button and by the menu's Reminder Message alike.
  const [reminderOpen, setReminderOpen] = useState(false);

  const student = membership.students;
  const status = MEMBERSHIP_STATUS[membership.status] ?? MEMBERSHIP_STATUS.expired;
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const documentAction = membershipDocumentAction(membership.id, membership.payment_status, membership.invoice_exists, membership.has_payments);
  const DocumentIcon = DOCUMENT_ICON[documentAction.kind];
  const validity = getMembershipValidity(membership, today);
  const remaining = getValidityLabel(validity);
  const remainingDate = validity.status === "upcoming" ? formatDate(membership.start_date) : formatEndDate(membership.end_date);
  const PaymentIcon = PAYMENT_ICON[membership.payment_status] ?? Clock;

  return (
    <TableRow
      className={cn(
        "card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent",
        menuOpen ? SURFACE_OPEN : SURFACE
      )}
    >
      <TableCell className={cn(CELL, "py-3 pr-2 pl-3")}>
        {/* The row's hover border: drawn from the first cell, sized to the whole row (see `.card-border-animated-row`). */}
        <AnimatedBorder />
        {student ? (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={student.full_name} src={student.photo_url} size="lg" />
            <div className="min-w-0">
              <p className="text-body font-semibold text-text-primary">
                <Link href={`/students/${student.id}`} className="rounded-sm text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {student.full_name}
                </Link>
              </p>
              <p className="text-small text-text-secondary">{student.student_code}</p>
              {student.phone ? <p className="text-small whitespace-nowrap text-text-secondary">{formatPhone(student.phone, student.phone_country_code)}</p> : null}
            </div>
          </div>
        ) : (
          <span className="text-text-secondary">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell className={CELL}>
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", TILE[status.variant] ?? TILE.neutral)}>
            <FileText className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <p className="text-body font-semibold whitespace-nowrap text-text-primary">
              <Link href={`/memberships/${membership.id}`} className="rounded-sm text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {membership.membership_code}
              </Link>
            </p>
            <Badge variant={status.variant}>{status.label}</Badge>
            {/* The expiry reminder sits under the membership status (02-ux.md "Membership & payment reminders"); the Balance badge belongs under the
                payment status, so here it only shows while the Amount & Payment column is hidden (a narrow table). */}
            <ReminderIndicators reminders={reminders} only="expiry" className="max-w-48" />
            <ReminderIndicators reminders={reminders} only="payment" className="max-w-48 @[42rem]:hidden" />
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, PERIOD_ONLY)}>
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Flower2 className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">
              {PLAN[membership.plan] ?? membership.plan}
              {membership.class_count ? (
                <span className="text-small font-normal text-text-secondary"> · {membership.class_count.remaining} of {membership.class_count.total} left</span>
              ) : null}
            </p>
            <p className="text-small flex items-center gap-1.5 whitespace-nowrap text-text-secondary">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
              {formatDate(membership.start_date)} {"\u2013"} {formatEndDate(membership.end_date)}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, PAYMENT_ONLY)}>
        <p className="text-body font-semibold whitespace-nowrap text-text-primary">{formatCurrency(membership.amount, membership.currency)}</p>
        <Badge variant={payment.variant} className="mt-1">
          <PaymentIcon className="size-3.5" aria-hidden="true" />
          {payment.label}
        </Badge>
        <ReminderIndicators reminders={reminders} only="payment" className="mt-1" />
      </TableCell>
      <TableCell className={cn(CELL, REMAINING_ONLY)}>
        <div className="flex min-w-0 items-center gap-3">
          <CalendarDays className="size-6 shrink-0 text-text-secondary" aria-hidden="true" />
          <div className="min-w-0">
            <p className={cn("text-body font-semibold whitespace-nowrap", remaining.tone === "danger" ? "text-danger" : "text-text-primary")}>{remaining.text}</p>
            <p className="text-small whitespace-nowrap text-text-secondary">{remainingDate}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "w-px py-3 pr-3 pl-1 whitespace-nowrap")}>
        <div className="flex items-center gap-1">
          {/* One primary action: the red reminder bell while a reminder applies (its document action stays in the More menu), otherwise the document icon. */}
          {hasReminder(reminders) ? (
            <ReminderMessageButton reminders={reminders} studentName={student?.full_name} onClick={() => setReminderOpen(true)} />
          ) : (
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
          )}
          <MembershipCardMenu
            membershipId={membership.id}
            studentId={student?.id}
            paymentStatus={membership.payment_status}
            invoiceExists={membership.invoice_exists}
            hasPayments={membership.has_payments}
            reminders={reminders}
            onOpenReminderMessage={() => setReminderOpen(true)}
            onIssueInvoice={() => setIssueOpen(true)}
            onOpenChange={setMenuOpen}
          />
          {documentAction.kind === "issue-receipt" ? (
            <MembershipIssueInvoiceDialog membership={membership} student={student} open={issueOpen} onOpenChange={setIssueOpen} />
          ) : null}
          <MembershipReminderMessage
            membership={membership}
            reminders={reminders}
            centreName={centreName}
            open={reminderOpen}
            onOpenChange={setReminderOpen}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The Memberships table (rounded row cards on the page background): see `MembershipRow` for the columns. */
export default function MembershipTable({ memberships, today, reminders = {}, centreName }) {
  return (
    <div className="@container">
      <Table aria-label="Memberships" className="border-separate border-spacing-y-2">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Student</TableHead>
            <TableHead className={HEAD}>Membership</TableHead>
            <TableHead className={cn(HEAD, PERIOD_ONLY)}>Plan &amp; Period</TableHead>
            <TableHead className={cn(HEAD, PAYMENT_ONLY)}>Amount &amp; Payment</TableHead>
            <TableHead className={cn(HEAD, REMAINING_ONLY)}>Time Remaining</TableHead>
            <TableHead className={cn(HEAD, "w-px pr-3 pl-1 whitespace-nowrap")}>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memberships.map((membership) => (
            <MembershipRow key={membership.id} membership={membership} today={today} reminders={reminders[membership.id]} centreName={centreName} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
