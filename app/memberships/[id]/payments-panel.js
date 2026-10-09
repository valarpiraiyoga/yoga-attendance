import Link from "next/link";
import { Wallet } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { fromPaise, PAYMENT_METHOD_LABEL, summarizePayments } from "@/lib/memberships/payments-core";
import { canIssuePaymentDocument, DOCUMENT_TITLE_LABEL, PAYMENT_DOCUMENT_BLOCKED_MESSAGE } from "@/lib/invoices/membership-invoice";
import { formatInvoiceNumberOf } from "@/lib/invoices/invoice-number";
import RecordPayment from "@/app/memberships/[id]/record-payment";
import IssuePaymentDocument from "@/app/memberships/[id]/issue-payment-document";
import EditPaymentAmount from "@/app/memberships/[id]/edit-payment-amount";

/**
 * Payments (V1 Tax Adjustment, Step 2) on Membership Details: what has been paid, what is still due,
 * and every recorded payment with the methods it combined. Record Payment is offered while the
 * membership is not fully paid.
 *
 * A membership that was marked Paid before payments existed has no recorded payments; it reads as
 * Paid with nothing listed, and no payment can be recorded against it.
 */
export default function PaymentsPanel({ membership, payments, today, student, membershipSummary, hasMembershipInvoice = false }) {
  const currency = membership.currency;
  // A membership with a membership-level invoice is documented there; its payments get no document of their own.
  const canIssueDocument = canIssuePaymentDocument({ hasMembershipInvoice });
  const { paidPaise, balancePaise } = summarizePayments(membership.amount, payments);
  const isPaid = membership.payment_status === "paid";
  const legacyPaid = isPaid && payments.length === 0;
  const money = (paise) => formatCurrency(fromPaise(paise), currency);

  return (
    <Panel>
      <PanelHeader
        icon={Wallet}
        title="Payments"
        description={
          legacyPaid
            ? "This membership was marked Paid before payments were recorded."
            : `Paid ${money(paidPaise)} of ${formatCurrency(membership.amount, currency)} · Balance ${money(balancePaise)}`
        }
        action={
          isPaid ? null : (
            <RecordPayment
              membershipId={membership.id}
              balancePaise={balancePaise}
              currency={currency}
              today={today}
              student={student}
              membership={membershipSummary}
              taxInvoiceDefault={student?.tax_invoice_default ?? true}
            />
          )
        }
        className="mb-4 min-h-8"
      />

      {payments.length === 0 ? (
        <EmptyState
          size="sm"
          title="No payments recorded"
          description={legacyPaid ? "No payment records exist for this membership." : "Record a payment when the student pays, in full or in installments."}
        />
      ) : (
        <>
        {hasMembershipInvoice ? (
          <p className="text-small mb-3 text-text-secondary">{PAYMENT_DOCUMENT_BLOCKED_MESSAGE}</p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table aria-label="Payments">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="whitespace-nowrap">Date</TableHead>
                <TableHead className="whitespace-nowrap">Methods</TableHead>
                <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                <TableHead className="whitespace-nowrap">Document</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{formatDate(payment.payment_date)}</TableCell>
                  <TableCell>
                    <ul className="flex flex-col gap-1">
                      {payment.methods.map((method) => (
                        <li key={method.id} className="text-small">
                          <span className="font-medium text-text-primary">{PAYMENT_METHOD_LABEL[method.method] ?? method.method}</span>
                          <span className="text-text-secondary tabular-nums"> · {formatCurrency(method.amount, currency)}</span>
                          {method.reference_id ? <span className="break-all text-text-secondary"> · Ref: {method.reference_id}</span> : null}
                          {method.notes ? <span className="block break-words text-text-secondary">{method.notes}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="text-small mt-1 text-text-secondary">{payment.issue_tax_invoice ? "Tax invoice" : "No tax invoice"}</p>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {formatCurrency(payment.amount, currency)}
                    {payment.edits.length > 0 ? (
                      <span className="text-small block font-normal text-text-secondary">
                        Edited · was {formatCurrency(payment.edits[0].previous_amount, currency)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {payment.document ? (
                      <Link
                        href={`/memberships/${membership.id}/documents/${payment.document.id}`}
                        className="text-small font-medium text-brand hover:underline"
                      >
                        {DOCUMENT_TITLE_LABEL[payment.document.document_title] ?? payment.document.document_title}{" "}
                        {formatInvoiceNumberOf(payment.document)}
                        {payment.corrected ? <span className="font-normal text-text-secondary"> (corrected)</span> : null}
                      </Link>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {canIssueDocument ? (
                          <IssuePaymentDocument
                            membershipId={membership.id}
                            paymentId={payment.id}
                            issueTaxInvoice={payment.issue_tax_invoice}
                            paymentLabel={`the payment of ${formatCurrency(payment.amount, currency)} on ${formatDate(payment.payment_date)}`}
                            student={student}
                            membership={membershipSummary}
                          />
                        ) : (
                          <span className="text-small text-text-secondary">Not available</span>
                        )}
                        {payment.editable ? (
                          <EditPaymentAmount
                            membershipId={membership.id}
                            paymentId={payment.id}
                            methods={payment.methods.map((method) => ({
                              id: method.id,
                              label: PAYMENT_METHOD_LABEL[method.method] ?? method.method,
                              reference: method.reference_id,
                              amount: String(method.amount),
                            }))}
                            paymentAmount={String(payment.amount)}
                            balancePaise={balancePaise}
                            currency={currency}
                            paymentLabel={`the payment on ${formatDate(payment.payment_date)}`}
                            student={student}
                            membership={membershipSummary}
                          />
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </Panel>
  );
}
