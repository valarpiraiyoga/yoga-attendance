import Link from "next/link";
import { CalendarDays, FileText, Hash, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FieldRow from "@/components/layout/FieldRow";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatDate } from "@/lib/format";
import { formatInvoiceNumberOf } from "@/lib/invoices/invoice-number";
import {
  DOCUMENT_TITLE_LABEL,
  getInvoiceSectionState,
  paymentDateText,
} from "@/lib/invoices/membership-invoice";
import IssueInvoice from "@/app/memberships/[id]/issue-invoice";

function Value({ children }) {
  return <p className="text-body font-medium break-words text-text-primary">{children}</p>;
}

/**
 * The invoice section of Membership Details (V1 Invoice / Receipt Enhancement).
 * Small and focused — not the invoice screen.
 *
 * With an invoice, every value comes from the invoice record itself (title,
 * number, invoice date, payment date), never from the membership. Without one it
 * says so, shows the membership's payment date (or that none is recorded), and —
 * for a Paid membership only — offers Issue Invoice.
 *
 * Admin-only: it renders on Membership Details, which requires the Admin role
 * (page and layout), and its data comes from `getInvoiceForMembership`, which
 * requires it too. The database enforces it again.
 */
export default function InvoicePanel({ membership, invoice, student, membershipSummary }) {
  const state = getInvoiceSectionState({ membership, invoice });

  return (
    <Panel aria-label="Invoice">
      <PanelHeader
        icon={Receipt}
        title="Invoice / Receipt"
        description="The stored document for this membership's payment."
        className="mb-4 min-h-8"
        action={
          invoice ? (
            <Button variant="outline" render={<Link href={`/memberships/${membership.id}/invoice`} />} nativeButton={false}>
              View Invoice
            </Button>
          ) : state.canIssue ? (
            <IssueInvoice
              membershipId={membership.id}
              needsPaymentDate={state.needsPaymentDate}
              paymentDateLabel={state.paymentDate.kind === "recorded" ? formatDate(state.paymentDate.date) : null}
              student={student}
              membership={membershipSummary}
            />
          ) : null
        }
      />

      {invoice ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FieldRow icon={FileText} label="Document Title">
            <Value>{DOCUMENT_TITLE_LABEL[invoice.document_title] ?? invoice.document_title}</Value>
          </FieldRow>
          <FieldRow icon={Hash} label="Invoice Number">
            <Value>{formatInvoiceNumberOf(invoice)}</Value>
          </FieldRow>
          <FieldRow icon={CalendarDays} label="Invoice Date">
            <Value>{formatDate(invoice.invoice_date)}</Value>
          </FieldRow>
          <FieldRow icon={CalendarDays} label="Payment Date">
            <Value>{formatDate(invoice.payment_date)}</Value>
          </FieldRow>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldRow icon={Receipt} label="Invoice">
              <Badge variant="neutral">Not issued</Badge>
            </FieldRow>
            <FieldRow icon={CalendarDays} label="Payment Date">
              <Value>{paymentDateText(state.paymentDate)}</Value>
            </FieldRow>
          </div>
          {state.canIssue ? (
            <p className="text-small text-text-secondary">
              {state.needsPaymentDate
                ? "This membership is Paid but has no recorded payment date. Issue Invoice asks you to confirm the date it was paid."
                : "This membership is Paid and has no invoice yet."}
            </p>
          ) : (
            <p className="text-small text-text-secondary">An invoice can be issued once the membership is Paid.</p>
          )}
        </div>
      )}
    </Panel>
  );
}
