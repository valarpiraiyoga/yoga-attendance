import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MessageCircle, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getMembership, todayDateString } from "@/lib/memberships/data";
import { getCenterProfile } from "@/lib/center-profile/data";
import { formatAmount, formatDate } from "@/lib/format";
import { MEMBERSHIP_STATUS, PAYMENT_STATUS, PLAN } from "@/lib/status";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { formatPhone } from "@/lib/phone";
import PrintReceiptButton from "@/app/memberships/[id]/receipt/print-receipt-button";

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className="text-body font-medium break-words text-text-primary">{children}</dd>
    </div>
  );
}

// One contact line (mobile / email) with its icon. The icon is decorative; the
// value itself identifies the line.
function ContactLine({ icon: Icon, children }) {
  return (
    <p className="text-small flex min-w-0 items-center gap-1.5 text-text-secondary">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * Membership Receipt — generated on the fly from the membership record, the
 * student and the Center Profile; nothing is stored. The membership code is
 * the receipt number, the membership's own creation date is the receipt date,
 * and the plan / period / amount / payment status are the record's own values.
 * The schema holds no tax, discount, payment-method or bank details, so none
 * are shown: the total is the membership's amount.
 *
 * Print: `Print Receipt` calls `window.print()`. The sidebar, header, back
 * link and buttons are `print:hidden` (see `AppShell`), the article drops its
 * frame, and `@page` asks for A4 with a 14mm margin.
 *
 * `Send WhatsApp` is a plain wa.me link to the student's registered phone with
 * the receipt details pre-filled (`lib/whatsapp.js`) — no API or messaging
 * integration. With no usable number it is disabled rather than linking
 * nowhere.
 */
export default async function MembershipReceiptPage({ params }) {
  // Authorization boundary — see app/memberships/layout.js for why this must
  // be repeated here rather than relying on the layout alone.
  await requireRole(ROLES.ADMIN);

  const { id } = await params;
  const [membership, center] = await Promise.all([getMembership(id), getCenterProfile()]);

  if (!membership) {
    notFound();
  }

  const student = membership.students;
  const status = MEMBERSHIP_STATUS[membership.status] ?? { label: membership.status, variant: "neutral" };
  const payment = PAYMENT_STATUS[membership.payment_status] ?? PAYMENT_STATUS.pending;
  const planLabel = PLAN[membership.plan] ?? membership.plan;
  const amount = formatAmount(membership.amount);
  const receiptDate = membership.created_at ? formatDate(String(membership.created_at).slice(0, 10)) : "—";
  const cancelledOn = membership.cancelled_at ? formatDate(String(membership.cancelled_at).slice(0, 10)) : null;

  const whatsAppMessage = [
    center?.name ? `${center.name} – Membership Receipt` : "Membership Receipt",
    `Receipt No.: ${membership.membership_code}`,
    `Student: ${student?.full_name ?? "—"}`,
    `Membership: ${planLabel} Membership`,
    `Start Date: ${formatDate(membership.start_date)}`,
    `End Date: ${formatDate(membership.end_date)}`,
    `Amount: ${amount}`,
    `Payment Status: ${payment.label}`,
  ].join("\n");
  const whatsAppUrl = buildWhatsAppUrl(student?.phone, whatsAppMessage, student?.phone_country_code);
  const noNumberLabel = "Send WhatsApp is unavailable: this student has no registered mobile number";

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <style>{`@media print { @page { size: A4; margin: 14mm; } }`}</style>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/memberships/${id}`}
          className="text-body inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Membership
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <PrintReceiptButton />
          {whatsAppUrl ? (
            <Button
              variant="outline"
              render={<a href={whatsAppUrl} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              <MessageCircle className="size-4" aria-hidden="true" />
              Send WhatsApp
            </Button>
          ) : (
            <span title={noNumberLabel}>
              <Button variant="outline" disabled aria-label={noNumberLabel}>
                <MessageCircle className="size-4" aria-hidden="true" />
                Send WhatsApp
              </Button>
            </span>
          )}
        </div>
      </div>

      <article
        aria-label={`Receipt ${membership.membership_code}`}
        className="rounded-card border border-border bg-surface p-6 shadow-xs sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-page-title font-semibold break-words text-text-primary">
              {center?.name ?? "Membership Receipt"}
            </p>
            {center?.address ? (
              <p className="text-small mt-1 break-words whitespace-pre-line text-text-secondary">{center.address}</p>
            ) : null}
            {center?.phone || center?.email ? (
              <div className="mt-1 flex flex-col gap-0.5">
                {center.phone ? <ContactLine icon={Phone}>{center.phone}</ContactLine> : null}
                {center.email ? <ContactLine icon={Mail}>{center.email}</ContactLine> : null}
              </div>
            ) : null}
          </div>

          <div className="sm:text-right">
            <h1 className="text-page-title font-semibold tracking-wide text-brand uppercase">Receipt</h1>
            <dl className="mt-2 flex flex-col gap-1">
              <Detail label="Receipt No.">{membership.membership_code}</Detail>
              <Detail label="Date">{receiptDate}</Detail>
            </dl>
          </div>
        </header>

        <section aria-labelledby="receipt-billed-to" className="grid gap-6 border-b border-border py-6 sm:grid-cols-2">
          <div className="min-w-0">
            <h2 id="receipt-billed-to" className="text-small font-medium tracking-wide text-text-secondary uppercase">
              Billed To
            </h2>
            <p className="text-body mt-1 font-semibold break-words text-text-primary">{student?.full_name ?? "—"}</p>
            <p className="text-small break-words text-text-secondary">Student ID: {student?.student_code ?? "—"}</p>
            {student?.phone ? (
              <ContactLine icon={Phone}>{formatPhone(student.phone, student.phone_country_code)}</ContactLine>
            ) : null}
            {student?.email ? <ContactLine icon={Mail}>{student.email}</ContactLine> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:justify-items-end sm:text-right">
            <Detail label="Payment Status">
              <Badge variant={payment.variant}>{payment.label}</Badge>
            </Detail>
            <Detail label="Membership Status">
              <Badge variant={status.variant}>{status.label}</Badge>
            </Detail>
            {cancelledOn ? <Detail label="Cancelled On">{cancelledOn}</Detail> : null}
          </dl>
        </section>

        <section aria-label="Items" className="border-b border-border py-6">
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table aria-label="Receipt items">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">Description</TableHead>
                  <TableHead className="whitespace-nowrap">Start Date</TableHead>
                  <TableHead className="whitespace-nowrap">End Date</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium whitespace-nowrap text-text-primary">
                    {planLabel} Membership
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(membership.start_date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-text-secondary">{formatDate(membership.end_date)}</TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap text-text-primary tabular-nums">
                    {amount}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <dl className="mt-4 ml-auto flex max-w-xs items-baseline justify-between gap-6 border-t border-border pt-4">
            <dt className="text-body font-semibold text-text-primary">Total</dt>
            <dd className="text-page-title font-semibold text-text-primary tabular-nums">{amount}</dd>
          </dl>
        </section>

        {membership.notes ? (
          <section aria-labelledby="receipt-notes" className="border-b border-border py-6">
            <h2 id="receipt-notes" className="text-small font-medium tracking-wide text-text-secondary uppercase">
              Notes
            </h2>
            <p className="text-body mt-1 break-words whitespace-pre-line text-text-primary">{membership.notes}</p>
          </section>
        ) : null}

        <footer className="flex flex-col gap-1 pt-6 text-small text-text-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>{center?.name ?? "Membership Receipt"}</span>
          <span>
            Receipt {membership.membership_code} · Generated {formatDate(todayDateString())}
          </span>
        </footer>
      </article>
    </div>
  );
}
