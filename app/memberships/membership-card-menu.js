"use client";

import Link from "next/link";
import { BellRing, Eye, FilePlus, FileText, MoreVertical, Pencil, Receipt, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordPaymentHref } from "@/lib/memberships/payment-focus";
import { membershipDocumentAction } from "@/lib/memberships/document-action";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Memberships card / row overflow — links only to routes that already
 * exist (Membership Details, Edit, Renew, the membership's document, and the student's own page).
 * The document item follows the payment status and the invoice (`membershipDocumentAction`): View
 * Payment Due Notice for a Pending membership, View Receipt for a Paid one with an invoice, and
 * Issue Receipt for a Paid one without - which opens the existing Issue Receipt dialog through
 * `onIssueInvoice` (the host owns the dialog) instead of linking to a page that would not exist.
 * Cancel is deliberately not here: it needs its confirmation dialog, which
 * lives on Membership Details. Mirrors `StudentCardMenu`.
 *
 * Also the Membership Details header's more (⋮) menu: the same action list,
 * with the trigger's look and label passed in (`trigger*`, defaults are the
 * list card's) and `extraItems` for the one action that only exists on the
 * detail page (Cancel Membership), rendered after its own divider.
 *
 * `reminders` (the Memberships list only; 02-ux.md "Membership & payment reminders"): the membership's current reminders are stated at the top
 * of the menu ("Expires in 3 days", "Balance ₹1,500.00"), and a payment reminder adds Record Payment, which opens Membership Details where
 * payments are recorded - there is no payment form in the list. Renew Membership is already in the menu. These are in-app actions only; nothing
 * is sent to anyone.
 *
 * Reminder Message (with `onOpenReminderMessage`) opens the row's reminder message popup - the same popup as the row's red bell button; the host
 * owns it. Both reminder texts are red (`text-danger`), as on the popup.
 *
 * `listActions` (the Memberships list, table and cards): every item carries an icon (icon and label only), View Student is left out and a
 * "View Payments" document item is left out (both are one step away on Membership Details, which View Membership opens). The detail page,
 * its history rows and the Dashboard keep their menus exactly as before.
 *
 * `hideDocumentAction` (the Dashboard's reminder rows): the document item needs the invoice and payment facts only the Memberships list reads,
 * so the Dashboard leaves it out; View Membership is one step from the same documents.
 */
const DOCUMENT_ICON = { "due-notice": FileText, receipt: Receipt, "issue-receipt": FilePlus, payments: Wallet };

export default function MembershipCardMenu({
  membershipId,
  studentId,
  paymentStatus,
  invoiceExists = false,
  hasPayments = false,
  onIssueInvoice,
  onOpenChange,
  triggerVariant = "ghost",
  triggerSize = "icon-sm",
  triggerClassName = "shrink-0 text-brand hover:bg-brand/10 hover:text-brand",
  triggerLabel = "Membership actions",
  triggerDisabled = false,
  extraItems = null,
  reminders = null,
  onOpenReminderMessage,
  hideDocumentAction = false,
  listActions = false,
}) {
  const documentAction = membershipDocumentAction(membershipId, paymentStatus, invoiceExists, hasPayments);
  const DocumentIcon = DOCUMENT_ICON[documentAction.kind];
  // `icon` is an item's leading icon on the list's menu only.
  const icon = (Icon) => (listActions ? <Icon aria-hidden="true" /> : null);
  const showDocumentAction = !hideDocumentAction && !(listActions && documentAction.kind === "payments");

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant={triggerVariant}
            size={triggerSize}
            className={triggerClassName}
            aria-label={triggerLabel}
            disabled={triggerDisabled}
          />
        }
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {reminders?.expiry || reminders?.payment ? (
          <>
            {/* The reminders, boxed: a bordered, softly tinted panel at the top of the menu. */}
            <DropdownMenuGroup className="mx-1 mb-1 rounded-card border border-danger/20 bg-danger/5 py-1">
              <DropdownMenuLabel>Reminders</DropdownMenuLabel>
              {reminders.expiry ? <p className="text-small px-1.5 pb-1 font-medium text-danger">{reminders.expiry.text}</p> : null}
              {reminders.payment ? <p className="text-small px-1.5 pb-1 font-medium text-danger">{reminders.payment.text}</p> : null}
            </DropdownMenuGroup>
            {onOpenReminderMessage ? <DropdownMenuItem onClick={onOpenReminderMessage}>
                {icon(BellRing)}
                Reminder Message
              </DropdownMenuItem> : null}
            {reminders.payment ? (
              <DropdownMenuItem render={<Link href={recordPaymentHref(membershipId)} />} nativeButton={false}>
                {icon(Wallet)}
                Record Payment
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}`} />} nativeButton={false}>
          {icon(Eye)}
          View Membership
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}/edit`} />} nativeButton={false}>
          {icon(Pencil)}
          Edit Membership
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}/renew`} />} nativeButton={false}>
          {icon(RefreshCw)}
          Renew Membership
        </DropdownMenuItem>
        {!showDocumentAction ? null : documentAction.href ? (
          <DropdownMenuItem render={<Link href={documentAction.href} />} nativeButton={false}>
            {icon(DocumentIcon)}
            {documentAction.label}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onIssueInvoice}>
            {icon(DocumentIcon)}
            {documentAction.label}
          </DropdownMenuItem>
        )}

        {studentId && !listActions ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={`/students/${studentId}`} />} nativeButton={false}>
              View Student
            </DropdownMenuItem>
          </>
        ) : null}

        {extraItems ? (
          <>
            <DropdownMenuSeparator />
            {extraItems}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
