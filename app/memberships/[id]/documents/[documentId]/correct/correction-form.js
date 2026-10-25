"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { CORRECTION_REASON_MAX } from "@/lib/invoices/document-correction";
import { correctAndReissuePaymentDocument, previewPaymentDocumentCorrection } from "@/lib/invoices/actions";
import { fromPaise, PAYMENT_METHOD_LABEL, toPaise } from "@/lib/memberships/payments-core";
import PaymentFields, { usePaymentDraft } from "@/app/memberships/[id]/payment-fields";
import { showSuccessToast } from "@/components/ui/success-toast";
import { withDocumentsSource } from "@/lib/documents/source";

const PAYMENT_STATUS_LABEL = { paid: "Paid", partially_paid: "Partially Paid" };

const CUSTOMER_FIELDS = [
  { name: "customer_name", label: "Customer name", required: true },
  { name: "customer_phone_country_code", label: "Phone country code", placeholder: "+91" },
  { name: "customer_phone", label: "Phone", inputMode: "tel" },
  { name: "customer_email", label: "Email", inputMode: "email" },
];

const BUSINESS_FIELDS = [
  { name: "business_name", label: "Business name", required: true },
  { name: "business_address", label: "Address" },
  { name: "business_phone", label: "Phone", inputMode: "tel" },
  { name: "business_email", label: "Email", inputMode: "email" },
];

function Section({ id, title, description, children }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div>
        <h2 id={id} className="text-section-title font-semibold text-text-primary">
          {title}
        </h2>
        {description ? <p className="text-small text-text-secondary">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-body text-text-secondary">{label}</dt>
      <dd className={`${strong ? "font-semibold" : ""} text-body break-words text-text-primary sm:text-right`}>{value}</dd>
    </div>
  );
}

function ErrorBanner({ children }) {
  return (
    <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
      {children}
    </p>
  );
}

/**
 * Correct & Reissue - the dedicated page of a payment document (migration 0055). Two steps:
 *
 *   1. Edit: the customer and business details, the invoice date, the payment's methods (add, remove, edit: type, amount,
 *      reference ID, notes) and the reason. The payment date cannot change, and a payment receipt has no GSTIN and no tax.
 *   2. Review: the document as it will be issued - recalculated by the server from the same rules as the original, with the
 *      membership's resulting payment status and balance - then an explicit confirmation.
 *
 * Nothing is written until Confirm. The server action validates again, recalculates, and passes the REVIEWED total and tax to
 * the database function, which cancels this document, corrects the payment and issues the linked replacement (a new number
 * from the same series) in one transaction, under the membership lock, refusing anything that no longer matches. The original
 * stays as issued; the student record and the centre profile are never changed.
 */
export default function CorrectionForm({
  membershipId,
  documentId,
  fromDocuments = false,
  series,
  title,
  number,
  currency,
  today,
  originalInvoiceDate,
  paymentDate,
  initialDetails,
  initialRows,
  paymentAmountPaise,
  membershipAmountPaise,
  otherPaymentsPaise,
  availablePaise,
  student,
  membership,
}) {
  const router = useRouter();
  const isTaxInvoice = series === "invoice";
  const money = (paise) => formatCurrency(fromPaise(paise), currency);

  const [step, setStep] = useState("edit");
  const [details, setDetails] = useState(initialDetails);
  const [invoiceDate, setInvoiceDate] = useState(originalInvoiceDate);
  const draft = usePaymentDraft({ today, balancePaise: availablePaise, initialPaymentDate: paymentDate, initialRows });
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [isPending, startTransition] = useTransition();
  // A second click (or Enter) before the first request has finished must never send a second correction.
  const inFlight = useRef(false);

  const setDetail = (name) => (event) => {
    setDetails((previous) => ({ ...previous, [name]: event.target.value }));
    setFieldErrors((previous) => ({ ...previous, [name]: undefined }));
    setSubmitError(null);
  };

  const input = () => ({ reason, invoiceDate, details, methods: draft.rows });

  /** Shows what the server refused: on the fields where it can, in a banner otherwise. Returns whether any field was marked. */
  function showRefusal(result) {
    const fields = result?.fieldErrors ?? {};
    const rows = result?.rowErrors ?? {};
    const onFields = Object.keys(fields).length > 0 || Object.keys(rows).length > 0;
    setFieldErrors(fields);
    setRowErrors(rows);
    setSubmitError(onFields ? null : (result?.error ?? "Could not complete the correction. Try again."));
    return onFields;
  }

  // Step 1: the server checks the form and recalculates the replacement.
  function reviewDocument(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setFieldErrors({});
    setRowErrors({});
    setSubmitError(null);

    startTransition(async () => {
      try {
        const result = await previewPaymentDocumentCorrection(membershipId, documentId, input());
        if (result?.success) {
          setReview({ preview: result.preview, data: result.data });
          setConfirmed(false);
          setStep("review");
        } else {
          showRefusal(result);
        }
      } catch {
        setSubmitError("Could not reach the server. Try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  // Step 2: the reviewed total and tax travel with the request; the database refuses anything that no longer matches.
  function confirmCorrection() {
    if (inFlight.current) return;
    if (!confirmed) {
      setFieldErrors({ confirm: "Confirm the corrected document before reissuing." });
      return;
    }
    inFlight.current = true;
    setFieldErrors({});
    setSubmitError(null);

    startTransition(async () => {
      try {
        const { preview } = review;
        const result = await correctAndReissuePaymentDocument(membershipId, documentId, {
          ...input(),
          expectedTotal: fromPaise(preview.totalPaise),
          expectedTax: preview.taxed ? fromPaise(preview.taxPaise) : null,
        });

        if (result?.success) {
          // Stay locked while the replacement opens: the original is cancelled now, and there is nothing left to submit.
          showSuccessToast("Document corrected and reissued successfully.");
          // The replacement opens where the original did: from the Documents list it stays under Documents.
          const replacementPath = `/memberships/${membershipId}/documents/${result.invoiceId}`;
          router.push(fromDocuments ? withDocumentsSource(replacementPath) : replacementPath);
          router.refresh();
          return;
        }

        inFlight.current = false;
        // A refused field takes the Admin back to the form; anything else (for example "changed since you reviewed it") stays here.
        if (showRefusal(result)) setStep("edit");
      } catch {
        inFlight.current = false;
        setSubmitError("Could not reach the server. Try again.");
      }
    });
  }

  const backPath = `/memberships/${membershipId}/documents/${documentId}`;
  const backHref = fromDocuments ? withDocumentsSource(backPath) : backPath;
  const header = <StudentIdentityHeader student={student} membership={membership} />;

  // ---- step 2: review ------------------------------------------------------------------------------------------------

  if (step === "review" && review) {
    const { preview, data } = review;
    const methodRows = draft.rows.map((row) => ({ ...row, paise: toPaise(row.amount) ?? 0 }));
    const lowered = preview.totalPaise < paymentAmountPaise;
    const chosenDate = data.invoiceDate ?? originalInvoiceDate;
    const phone = [data.overrides.customer_phone_country_code, data.overrides.customer_phone].filter(Boolean).join(" ");

    return (
      <div className="flex flex-col gap-5">
        {header}
        <div>
          <h2 className="text-section-title font-semibold text-text-primary">Review the corrected document</h2>
          <p className="text-small text-text-secondary">
            {title} {number} will be cancelled and kept exactly as issued. A replacement will be issued with a new number from the same series. Check it
            below, then confirm.
          </p>
        </div>

        {submitError ? <ErrorBanner>{submitError}</ErrorBanner> : null}

        <dl className="rounded-lg border border-border bg-surface-muted/40 px-4 py-2">
          <Row label="Replaces" value={`${title} ${number}`} />
          <Row label="Invoice date" value={formatDate(chosenDate)} />
          <Row label="Payment date (unchanged)" value={formatDate(paymentDate)} />
          <Row label="Customer" value={data.overrides.customer_name} />
          {phone ? <Row label="Customer phone" value={phone} /> : null}
          {data.overrides.customer_email ? <Row label="Customer email" value={data.overrides.customer_email} /> : null}
          <Row label="Business" value={data.overrides.business_name} />
          {data.overrides.business_address ? <Row label="Business address" value={data.overrides.business_address} /> : null}
          {data.overrides.business_phone ? <Row label="Business phone" value={data.overrides.business_phone} /> : null}
          {data.overrides.business_email ? <Row label="Business email" value={data.overrides.business_email} /> : null}
          {isTaxInvoice && data.overrides.business_gstin ? <Row label="GSTIN" value={data.overrides.business_gstin} /> : null}
        </dl>

        <section aria-labelledby="review-payment" className="flex flex-col gap-2">
          <h3 id="review-payment" className="text-body font-semibold text-text-primary">
            Payment
          </h3>
          <ul className="flex flex-col gap-1">
            {methodRows.map((row, index) => (
              <li key={index} className="text-body flex flex-wrap items-baseline justify-between gap-x-4 text-text-primary">
                <span className="break-words">
                  {PAYMENT_METHOD_LABEL[row.method] ?? row.method}
                  {row.referenceId.trim() ? ` · ${row.referenceId.trim()}` : ""}
                  {row.notes.trim() ? ` · ${row.notes.trim()}` : ""}
                </span>
                <span className="tabular-nums">{money(row.paise)}</span>
              </li>
            ))}
          </ul>
        </section>

        <dl className="rounded-lg border border-border bg-surface-muted/40 px-4 py-2">
          {preview.taxed ? (
            <>
              <Row label="Amount before tax" value={money(preview.taxablePaise)} />
              <Row label={`${preview.taxName ?? "Tax"} (${Number(preview.taxRate)}%)`} value={money(preview.taxPaise)} />
            </>
          ) : null}
          <Row label="Document total" value={money(preview.totalPaise)} strong />
          <Row label="Membership payable" value={money(preview.membership.payablePaise)} />
          <Row label="Paid after this correction" value={money(preview.membership.paidPaise)} />
          <Row label="Outstanding balance" value={money(preview.membership.balancePaise)} />
          <Row label="Payment status" value={PAYMENT_STATUS_LABEL[preview.membership.paymentStatus] ?? preview.membership.paymentStatus} />
        </dl>
        {lowered ? (
          <p className="text-small text-text-secondary">
            The payment is lower than before. This only corrects the record: no refund is processed or recorded.
          </p>
        ) : null}
        <p className="text-small text-text-secondary">
          The membership&rsquo;s price, package, dates and attendance are not changed, and neither are the student&rsquo;s or the center&rsquo;s own details.
        </p>

        <div>
          <p className="text-small font-medium text-text-primary">Reason for the correction</p>
          <p className="text-body break-words text-text-primary">{data.reason}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="correct-confirm" className="text-body flex items-start gap-2 text-text-primary">
            <input
              id="correct-confirm"
              type="checkbox"
              className="mt-1 size-4 accent-brand"
              checked={confirmed}
              disabled={isPending}
              aria-invalid={Boolean(fieldErrors.confirm)}
              aria-describedby={fieldErrors.confirm ? "correct-confirm-error" : undefined}
              onChange={(event) => {
                setConfirmed(event.target.checked);
                setFieldErrors({});
              }}
            />
            <span>
              I confirm this corrected {title.toLowerCase()}
              {preview.taxed ? `, with a total of ${money(preview.totalPaise)} and tax of ${money(preview.taxPaise)},` : `, with a total of ${money(preview.totalPaise)},`} and that{" "}
              {title} {number} is cancelled.
            </span>
          </label>
          {fieldErrors.confirm ? (
            <p id="correct-confirm-error" role="alert" className="text-small text-danger">
              {fieldErrors.confirm}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="secondary" disabled={isPending} onClick={() => setStep("edit")}>
            Back to edit
          </Button>
          <Button type="button" disabled={isPending} onClick={confirmCorrection}>
            {isPending ? "Reissuing…" : "Confirm and Reissue"}
          </Button>
        </div>
      </div>
    );
  }

  // ---- step 1: edit ----------------------------------------------------------------------------------------------------

  return (
    <form onSubmit={reviewDocument} className="flex flex-col gap-6" noValidate>
      {header}

      {submitError ? <ErrorBanner>{submitError}</ErrorBanner> : null}

      <Section
        id="correct-customer"
        title="Customer"
        description="Shown on the replacement only. The student's own record is not changed."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CUSTOMER_FIELDS.map((field) => (
            <FormField key={field.name} id={`correct-${field.name}`} label={field.label} required={field.required} error={fieldErrors[field.name]}>
              {(control) => (
                <Input
                  {...control}
                  inputMode={field.inputMode}
                  placeholder={field.placeholder}
                  disabled={isPending}
                  value={details[field.name]}
                  onChange={setDetail(field.name)}
                />
              )}
            </FormField>
          ))}
        </div>
      </Section>

      <Section
        id="correct-business"
        title="Business"
        description="Shown on the replacement only. The center profile is not changed."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {BUSINESS_FIELDS.map((field) => (
            <FormField key={field.name} id={`correct-${field.name}`} label={field.label} required={field.required} error={fieldErrors[field.name]}>
              {(control) => (
                <Input
                  {...control}
                  inputMode={field.inputMode}
                  disabled={isPending}
                  value={details[field.name]}
                  onChange={setDetail(field.name)}
                />
              )}
            </FormField>
          ))}
          {isTaxInvoice ? (
            <FormField
              id="correct-business_gstin"
              label="GSTIN"
              error={fieldErrors.business_gstin}
              help="Optional. 15 characters, for a tax invoice only."
            >
              {(control) => (
                <Input
                  {...control}
                  autoCapitalize="characters"
                  maxLength={15}
                  disabled={isPending}
                  value={details.business_gstin}
                  onChange={setDetail("business_gstin")}
                />
              )}
            </FormField>
          ) : null}
        </div>
      </Section>

      <Section id="correct-date" title="Document date">
        <FormField
          id="correct-invoice-date"
          label="Invoice date"
          error={fieldErrors.invoice_date}
          help={`Not before the payment date (${formatDate(paymentDate)}) and not in the future. Leave it as it is to keep ${formatDate(originalInvoiceDate)}.`}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              min={paymentDate}
              max={today}
              disabled={isPending}
              value={invoiceDate}
              onChange={(event) => {
                setInvoiceDate(event.target.value);
                setFieldErrors((previous) => ({ ...previous, invoice_date: undefined }));
              }}
            />
          )}
        </FormField>
      </Section>

      <Section
        id="correct-payment"
        title="Payment"
        description={`Payment date ${formatDate(paymentDate)} cannot be changed. The membership is ${money(membershipAmountPaise)} and ${money(otherPaymentsPaise)} is paid by its other payments, so this payment may total up to ${money(availablePaise)}.`}
      >
        <PaymentFields
          draft={draft}
          currency={currency}
          today={today}
          disabled={isPending}
          fieldErrors={fieldErrors}
          rowErrors={rowErrors}
          showPaymentDate={false}
          showTaxInvoice={false}
          idPrefix="correct-payment"
          onRowRemoved={() => setRowErrors({})}
        />
        <p className="text-small text-text-secondary">
          Changing the amount recalculates the {isTaxInvoice ? "tax and " : ""}document total and the membership&rsquo;s payment status. A lower amount only
          corrects the record; no refund is processed.
        </p>
      </Section>

      <Section id="correct-reason-section" title="Reason">
        <FormField
          id="correct-reason"
          label="Reason for the correction"
          required
          error={fieldErrors.reason}
          help={`${reason.trim().length} of ${CORRECTION_REASON_MAX} characters. Shown on the cancelled ${title.toLowerCase()} and kept in the correction history.`}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={CORRECTION_REASON_MAX + 100}
              disabled={isPending}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setFieldErrors((previous) => ({ ...previous, reason: undefined }));
                setSubmitError(null);
              }}
            />
          )}
        </FormField>
      </Section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="secondary" render={<Link href={backHref} />} nativeButton={false} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Checking…" : "Review corrected document"}
        </Button>
      </div>
    </form>
  );
}
