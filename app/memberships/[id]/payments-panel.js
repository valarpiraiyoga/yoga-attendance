import Link from "next/link";
import { Banknote, CircleCheck, Clock, CreditCard, FileText, Landmark, Smartphone, Wallet } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/layout/Panel";
import { formatCurrency } from "@/lib/currencies";
import { formatDate, formatDateParts } from "@/lib/format";
import { fromPaise, PAYMENT_METHOD_LABEL, summarizePayments } from "@/lib/memberships/payments-core";
import { canIssuePaymentDocument, DOCUMENT_TITLE_LABEL, PAYMENT_DOCUMENT_BLOCKED_MESSAGE } from "@/lib/invoices/membership-invoice";
import { formatInvoiceNumberOf } from "@/lib/invoices/invoice-number";
import RecordPayment from "@/app/memberships/[id]/record-payment";
import IssuePaymentDocument from "@/app/memberships/[id]/issue-payment-document";
import EditPayment from "@/app/memberships/[id]/edit-payment";
import { cn } from "@/lib/utils";

// Presentation only: each method's icon and its soft tint (the stored method decides it).
const METHOD_ICON = {
  cash: { Icon: Banknote, tone: "bg-success/10 text-success" },
  card: { Icon: CreditCard, tone: "bg-info/10 text-info" },
  upi: { Icon: Smartphone, tone: "bg-success/10 text-success" },
  bank_transfer: { Icon: Landmark, tone: "bg-brand/10 text-brand" },
  other: { Icon: Wallet, tone: "bg-neutral/15 text-text-secondary" },
};

// The three summary cards: a tinted surface, a round icon and the figure in the same colour.
const SUMMARY_TONE = {
  success: { card: "border-success/20 bg-success/10", icon: "bg-success/15 text-success", value: "text-success" },
  info: { card: "border-info/20 bg-info/10", icon: "bg-info/15 text-info", value: "text-info" },
  warning: { card: "border-warning/20 bg-warning/10", icon: "bg-warning/15 text-warning", value: "text-warning" },
};

/** The payment date as a small calendar tile: the month on a brand band, the day large, the year beneath (from `formatDateParts`; the date is read as written, no timezone). Screen readers get the full date. */
function DateTile({ date }) {
  const { day, monthYear } = formatDateParts(date);
  const [month, year] = String(monthYear).split(" ");
  return (
    <div className="inline-flex w-14 flex-col overflow-hidden rounded-lg border border-border bg-surface text-center">
      <span className="sr-only">{formatDate(date)}</span>
      <span aria-hidden="true" className="bg-brand py-0.5 text-[0.625rem] leading-4 font-semibold tracking-wide text-surface uppercase">
        {month}
      </span>
      <span aria-hidden="true" className="text-section-title pt-0.5 leading-6 font-semibold text-text-primary tabular-nums">
        {day}
      </span>
      <span aria-hidden="true" className="text-small pb-0.5 leading-4 text-text-secondary tabular-nums">
        {year}
      </span>
    </div>
  );
}

function SummaryCard({ tone, icon: Icon, label, value }) {
  const styles = SUMMARY_TONE[tone];
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-card border px-4 py-3.5", styles.card)}>
      <span aria-hidden="true" className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", styles.icon)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-small text-text-secondary">{label}</p>
        <p className={cn("text-section-title font-semibold tabular-nums", styles.value)}>{value}</p>
      </div>
    </div>
  );
}

/**
 * Payments (V1 Tax Adjustment, Step 2) on Membership Details: what has been paid, what is still due,
 * and every recorded payment with the methods it combined. Record Payment is offered while the
 * membership is not fully paid.
 *
 * Header: a tinted wallet tile, the title and Record Payment. Three summary cards - Amount Paid, Total Fee and Balance Due - show the figures
 * the panel already had (`summarizePayments` and the membership amount; nothing is recalculated here). The history table is Date | Payment
 * Details | Amount | Document: each payment's methods are separate lines (icon, method, its amount, reference, notes) with the tax-invoice
 * (no invoice badge there), the amount with its edit context, with the Tax invoice / No tax invoice badge beneath, and the Document column: the document link with the existing Issue / Edit actions.
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
    <Panel className="sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Wallet className="size-5" />
          </span>
          <h2 className="text-section-title font-semibold text-text-primary">Payments</h2>
        </div>
        {isPaid ? null : (
          <RecordPayment
            membershipId={membership.id}
            balancePaise={balancePaise}
            currency={currency}
            today={today}
            student={student}
            membership={membershipSummary}
            taxInvoiceDefault={student?.tax_invoice_default ?? true}
          />
        )}
      </div>

      {legacyPaid ? <p className="text-small mb-3 text-text-secondary">This membership was marked Paid before payments were recorded.</p> : null}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard tone="info" icon={FileText} label="Total Fee" value={formatCurrency(membership.amount, currency)} />
        <SummaryCard tone="success" icon={CircleCheck} label="Amount Paid" value={money(paidPaise)} />
        <SummaryCard tone="warning" icon={Clock} label="Balance Due" value={money(balancePaise)} />
      </div>

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
        <div className="overflow-x-auto rounded-card border border-border">
          <Table aria-label="Payments" className="[&_td]:px-4 [&_td]:py-3 [&_th]:h-10 [&_th]:px-4">
            <TableHeader>
              <TableRow className="bg-brand/5 hover:bg-brand/5">
                <TableHead className="whitespace-nowrap">Date</TableHead>
                <TableHead className="whitespace-nowrap">Payment Details</TableHead>
                <TableHead className="whitespace-nowrap">Amount</TableHead>
                <TableHead className="whitespace-nowrap">Document</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap">
                    <DateTile date={payment.payment_date} />
                  </TableCell>
                  <TableCell>
                    <ul className="flex flex-col gap-2.5">
                      {payment.methods.map((method) => {
                        const { Icon, tone } = METHOD_ICON[method.method] ?? METHOD_ICON.other;
                        return (
                          <li key={method.id} className="flex items-center gap-3">
                            <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tone)}>
                              <Icon className="size-4" />
                            </span>
                            <div className="text-small min-w-0">
                              <p>
                                <span className="font-semibold text-text-primary">{PAYMENT_METHOD_LABEL[method.method] ?? method.method}</span>
                                <span className="text-text-primary tabular-nums"> · {formatCurrency(method.amount, currency)}</span>
                                {method.reference_id ? <span className="break-all text-text-secondary"> · Ref: {method.reference_id}</span> : null}
                              </p>
                              {method.notes ? <p className="break-words text-text-secondary">{method.notes}</p> : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <span className="text-body font-semibold text-text-primary">{formatCurrency(payment.amount, currency)}</span>
                    {payment.edits.length > 0 ? (
                      <span className="text-small block font-normal text-text-secondary">
                        Edited
                        {Number(payment.edits[0].previous_amount) !== Number(payment.amount)
                          ? ` · was ${formatCurrency(payment.edits[0].previous_amount, currency)}`
                          : ""}
                      </span>
                    ) : null}
                    <span className="text-small mt-1.5 flex w-fit items-center gap-1.5 rounded-full bg-neutral/15 px-2.5 py-0.5 font-normal text-text-secondary">
                      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                      {payment.issue_tax_invoice ? "Tax invoice" : "No tax invoice"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {payment.document ? (
                      <span className="inline-flex items-center gap-2">
                        <FileText className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                        <Link
                          href={`/memberships/${membership.id}/documents/${payment.document.id}`}
                          className="text-small font-medium text-brand hover:underline"
                        >
                          {DOCUMENT_TITLE_LABEL[payment.document.document_title] ?? payment.document.document_title}{" "}
                          {formatInvoiceNumberOf(payment.document)}
                          {payment.corrected ? <span className="font-normal text-text-secondary"> (corrected)</span> : null}
                        </Link>
                      </span>
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
                        {payment.cancelledDocument ? (
                          <Button
                            variant="outline"
                            size="sm"
                            render={<Link href={`/memberships/${membership.id}/documents/${payment.cancelledDocument.id}`} />}
                            nativeButton={false}
                            aria-label={`View Cancelled Invoice ${DOCUMENT_TITLE_LABEL[payment.cancelledDocument.document_title] ?? payment.cancelledDocument.document_title} ${formatInvoiceNumberOf(payment.cancelledDocument)}`}
                          >
                            View Cancelled Invoice
                          </Button>
                        ) : null}
                        {payment.editable ? (
                          <EditPayment
                            membershipId={membership.id}
                            payment={payment}
                            balancePaise={balancePaise}
                            currency={currency}
                            today={today}
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
