"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 */
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
}) {
  const documentAction = membershipDocumentAction(membershipId, paymentStatus, invoiceExists, hasPayments);

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
            <DropdownMenuGroup>
              <DropdownMenuLabel>Reminders</DropdownMenuLabel>
              {reminders.expiry ? <p className="text-small px-1.5 pb-1 font-medium text-danger">{reminders.expiry.text}</p> : null}
              {reminders.payment ? <p className="text-small px-1.5 pb-1 font-medium text-warning">{reminders.payment.text}</p> : null}
            </DropdownMenuGroup>
            {reminders.payment ? (
              <DropdownMenuItem render={<Link href={`/memberships/${membershipId}`} />} nativeButton={false}>
                Record Payment
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}`} />} nativeButton={false}>
          View Membership
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}/edit`} />} nativeButton={false}>
          Edit Membership
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/memberships/${membershipId}/renew`} />} nativeButton={false}>
          Renew Membership
        </DropdownMenuItem>
        {documentAction.href ? (
          <DropdownMenuItem render={<Link href={documentAction.href} />} nativeButton={false}>
            {documentAction.label}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onIssueInvoice}>{documentAction.label}</DropdownMenuItem>
        )}

        {studentId ? (
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
