"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, FilePlus, FileText, Receipt, Banknote, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/ui/avatar";
import EntityCard from "@/components/ui/entity-card";
import Progress from "@/components/ui/progress";
import { formatDate } from "@/lib/format";
import { formatEndDate } from "@/lib/memberships/period";
import { classCountText } from "@/lib/memberships/class-count";
import { membershipDocumentAction } from "@/lib/memberships/document-action";
import MembershipIssueInvoiceDialog from "@/app/memberships/membership-issue-invoice";
import { formatCurrency } from "@/lib/currencies";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS } from "@/lib/status";
import { getMembershipValidity, getValidityLabel } from "@/lib/memberships/validity";
import { cn } from "@/lib/utils";
import MembershipCardMenu from "@/app/memberships/membership-card-menu";
import ReminderIndicators from "@/app/memberships/reminder-indicators";
import MembershipReminderMessage, { ReminderMessageButton, hasReminder } from "@/app/memberships/membership-reminder-message";

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
 * actions follow the finalized pattern: document icon + overflow menu,
 * whose first item, View Membership, opens the membership detail page — the
 * eye icon is deliberately not used here, so it stays a document-only mark.
 * The document icon follows the payment status and the invoice: Pending -> the file
 * icon, View Due Notice; Paid with a receipt -> the receipt icon, View Paid
 * Invoice; Paid without one -> the file-plus icon, Issue Receipt (the existing dialog). Composed from `EntityCard`; only the interactive
 * menu-open tint is local state.
 */
const DOCUMENT_ICON = { "due-notice": FileText, "receipt": Receipt, "issue-receipt": FilePlus, "payments": Wallet };

export default function MembershipCardItem({ membership, today, reminders, centreName }) {
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
  const validityLabel = getValidityLabel(validity);
  const isExpired = validity.status === "expired";
  const isActive = validity.status === "active";
  // A class-count membership shows its classes used and left; a membership with no end date has no days to count down.
  const classCount = membership.class_count;
  const classPercent = classCount && classCount.total > 0 ? Math.round((classCount.used / classCount.total) * 100) : 0;
  const showBar = validity.status !== "cancelled" && (classCount ? classCount.total > 0 : !validity.noExpiry);
  const period = `${formatDate(membership.start_date)} – ${formatEndDate(membership.end_date)}`;

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
          {/* One primary action: the red reminder bell while a reminder applies (its document action stays in the More menu), otherwise the document icon. */}
          {hasReminder(reminders) ? (
            <ReminderMessageButton reminders={reminders} studentName={student?.full_name} onClick={() => setReminderOpen(true)} />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-brand hover:bg-brand/10 hover:text-brand"
              aria-label={`${documentAction.label} for ${student?.full_name ?? membership.membership_code}`}
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
      {/* The membership's reminders, the same indicators as the table row (02-ux.md "Membership & payment reminders"). */}
      <ReminderIndicators reminders={reminders} className="mb-1" />
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
          {classCount ? (
            <p className="text-small font-normal text-text-secondary tabular-nums">{classCountText(classCount)}</p>
          ) : isActive && !validity.noExpiry ? (
            <p className="text-small font-normal text-text-secondary tabular-nums">
              {validity.daysLeft} / {validity.totalDays} days
            </p>
          ) : null}
        </div>
        {showBar ? (
          <Progress
            value={classCount ? classPercent : validity.percentUsed}
            tone={validityTone(validity)}
            label={classCount ? "Classes used" : "Membership validity used"}
          />
        ) : null}
      </div>
    </EntityCard>
  );
}
