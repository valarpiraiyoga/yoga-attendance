import { Mail, Phone } from "lucide-react";

// One contact line with its icon. The icon is decorative; the value itself identifies the line.
function ContactLine({ icon: Icon, children }) {
  return (
    <p className="text-small flex min-w-0 items-center gap-1.5 text-text-secondary">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

// A label above its value, for the metadata band.
function Meta({ label, children, className }) {
  return (
    <div className={className}>
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className="text-body font-semibold text-text-primary tabular-nums">{children}</dd>
    </div>
  );
}

// One labelled line of the bank details: a compact label beside its value.
function BankLine({ label, children }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-text-primary tabular-nums">{children}</dd>
    </div>
  );
}

// A row of the totals block: a label and its right-aligned amount.
function TotalRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-body text-text-secondary">{label}</dt>
      <dd className="text-body font-medium whitespace-nowrap text-text-primary tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The stored invoice as a formal document: the business identity and document title, a
 * band with the number and dates, who it is billed to, the item with its amounts, the
 * totals, the terms, and the authorized signatory.
 *
 * It renders ONLY the view model built from the invoice record (`buildInvoiceDocument`,
 * lib/invoices/invoice-document.js) and the two image URLs made from the paths that
 * invoice stored — it is given no membership, student, Center Profile or Invoice /
 * Receipt Settings, so it can show nothing but what was issued. Every part is one the
 * stored invoice actually has; nothing is shown for a field the invoice does not hold.
 *
 * In the application's own surface, border and type tokens. Printing uses this same document
 * (the page's Print button calls window.print()): the brand rule and the grey band keep their
 * colour (`print-color-adjust`), the frame's rounding and shadow drop away, and the items row,
 * the terms-and-totals block and the bank-details-and-signature block do not split across pages.
 * A printed page is wider than `sm`, so it prints the desktop layout. Amounts are
 * right-aligned in their own column; on a narrow screen the table keeps just the item and
 * its amount (the breakdown is in the totals below), and the sections stack, so nothing
 * scrolls sideways. PDF and share come later and will reuse this presentation.
 */
export default function InvoiceDocument({ invoiceDocument: doc, logoUrl, signatureUrl }) {
  const { business, customer, line, amounts } = doc;
  const hasSignatory = doc.signatory.name || doc.signatory.designation || signatureUrl;

  return (
    <article
      aria-label={`${doc.title} ${doc.number}`}
      className="overflow-hidden rounded-card border border-border border-t-2 border-t-brand bg-surface shadow-xs [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:rounded-none print:shadow-none"
    >
      <header className="flex flex-col gap-6 px-6 pt-6 pb-6 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:pt-8">
        <div className="flex min-w-0 items-start gap-4">
          {logoUrl ? (
            // A plain <img>: the same tradeoff as every other stored image here (see Avatar).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${business.name} logo`} className="h-16 w-auto max-w-24 shrink-0 object-contain" />
          ) : null}
          <div className="min-w-0">
            <p className="text-page-title font-semibold break-words text-brand">{business.name}</p>
            {business.address ? (
              <p className="text-small mt-1 break-words whitespace-pre-line text-text-secondary">{business.address}</p>
            ) : null}
            {business.phone || business.email ? (
              <div className="mt-1 flex flex-col gap-0.5">
                {business.phone ? <ContactLine icon={Phone}>{business.phone}</ContactLine> : null}
                {business.email ? <ContactLine icon={Mail}>{business.email}</ContactLine> : null}
              </div>
            ) : null}
          </div>
        </div>

        <h2 className="text-page-title font-semibold tracking-wide text-text-primary uppercase sm:text-right">{doc.title}</h2>
      </header>

      <dl className="grid gap-3 border-y border-border bg-background px-6 py-3 sm:grid-cols-3 sm:px-10">
        <Meta label={`${doc.title} No.`}>{doc.number}</Meta>
        <Meta label="Payment Date" className="sm:text-center">
          {doc.paymentDate}
        </Meta>
        <Meta label={`${doc.title} Date`} className="sm:text-right">
          {doc.invoiceDate}
        </Meta>
      </dl>

      <section aria-labelledby="invoice-bill-to" className="px-6 pt-6 pb-6 sm:px-10">
        <h3 id="invoice-bill-to" className="text-small font-medium tracking-wide text-text-secondary uppercase">
          Bill To
        </h3>
        <p className="text-body mt-1 font-semibold break-words text-text-primary">{customer.name}</p>
        <p className="text-small break-words text-text-secondary">Student ID: {customer.code}</p>
        {customer.phone ? <ContactLine icon={Phone}>{customer.phone}</ContactLine> : null}
        {customer.email ? <ContactLine icon={Mail}>{customer.email}</ContactLine> : null}
      </section>

      <section aria-label="Items" className="px-6 sm:px-10">
        <table className="w-full text-left">
          <caption className="sr-only">Items on this {doc.title.toLowerCase()}</caption>
          <thead>
            <tr className="border-y border-border">
              <th scope="col" className="text-small py-2 pr-4 font-medium tracking-wide text-text-secondary uppercase">
                Services
              </th>
              {amounts.tax ? (
                <>
                  <th scope="col" className="text-small hidden py-2 pr-4 text-right font-medium tracking-wide text-text-secondary uppercase sm:table-cell">
                    Before tax
                  </th>
                  <th scope="col" className="text-small hidden py-2 pr-4 text-right font-medium tracking-wide text-text-secondary uppercase sm:table-cell">
                    Tax
                  </th>
                </>
              ) : null}
              <th scope="col" className="text-small py-2 text-right font-medium tracking-wide text-text-secondary uppercase">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border print:break-inside-avoid">
              <td className="py-4 pr-4 align-top">
                <ServiceCell line={line} />
              </td>
              {amounts.tax ? (
                <>
                  <td className="text-body hidden py-4 pr-4 text-right align-top whitespace-nowrap text-text-primary tabular-nums sm:table-cell">
                    {amounts.taxable}
                  </td>
                  <td className="text-body hidden py-4 pr-4 text-right align-top whitespace-nowrap text-text-primary tabular-nums sm:table-cell">
                    {amounts.tax.amount}
                    <span className="text-small block text-text-secondary">({amounts.tax.rate}%)</span>
                  </td>
                </>
              ) : null}
              <td className="text-body py-4 text-right align-top font-medium whitespace-nowrap text-text-primary tabular-nums">
                {amounts.total}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10 print:break-inside-avoid">
        <div className="min-w-0">
          {doc.terms ? (
            <section aria-labelledby="invoice-terms">
              <h3 id="invoice-terms" className="text-small font-medium tracking-wide text-text-secondary uppercase">
                Terms &amp; Conditions
              </h3>
              <p className="text-small mt-1 break-words whitespace-pre-line text-text-primary">{doc.terms}</p>
            </section>
          ) : null}
        </div>

        <dl className="flex flex-col gap-1.5 sm:ml-auto sm:w-full sm:max-w-xs">
          {amounts.tax ? (
            <>
              <TotalRow label="Amount before tax">{amounts.taxable}</TotalRow>
              {amounts.tax.components.map((component) => (
                <TotalRow key={component.label} label={`${component.label} @ ${component.rate}%`}>
                  {component.amount}
                </TotalRow>
              ))}
              <div className="mt-1 flex items-baseline justify-between gap-6 border-t border-border pt-2">
                <dt className="text-body font-medium text-text-primary">Total Tax</dt>
                <dd className="text-body font-medium whitespace-nowrap text-text-primary tabular-nums">
                  {amounts.tax.amount}
                </dd>
              </div>
            </>
          ) : null}
          <div className="mt-1 flex items-baseline justify-between gap-6 border-t border-border pt-3">
            <dt className="text-body font-semibold text-text-primary">Total Amount</dt>
            <dd className="text-page-title font-semibold whitespace-nowrap text-text-primary tabular-nums">{amounts.total}</dd>
          </div>
        </dl>
      </div>

      {doc.bank || hasSignatory ? (
        <div className="grid gap-6 px-6 pt-2 pb-8 sm:grid-cols-2 sm:px-10 print:break-inside-avoid">
          <div className="min-w-0">
            {doc.bank ? (
              <section aria-labelledby="invoice-bank">
                <h3 id="invoice-bank" className="text-small font-medium tracking-wide text-text-secondary uppercase">
                  Bank Details
                </h3>
                <dl className="text-small mt-1 flex flex-col gap-0.5">
                  <BankLine label="Bank">{doc.bank.name}</BankLine>
                  <BankLine label="A/C Name">{doc.bank.accountName}</BankLine>
                  <BankLine label="A/C No.">{doc.bank.accountNumber}</BankLine>
                  <BankLine label="IFSC">{doc.bank.ifscCode}</BankLine>
                  {doc.bank.branch ? <BankLine label="Branch">{doc.bank.branch}</BankLine> : null}
                </dl>
              </section>
            ) : null}
          </div>

          {hasSignatory ? (
            <section aria-label="Authorized signatory" className="min-w-0 sm:text-right">
              {signatureUrl ? (
                // A plain <img>, as above; the link is a temporary signed one (private bucket).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={signatureUrl} alt="Signature" className="mb-2 h-16 w-auto max-w-full object-contain sm:ml-auto" />
              ) : null}
              {doc.signatory.name ? (
                <p className="text-body font-semibold break-words text-text-primary">{doc.signatory.name}</p>
              ) : null}
              {doc.signatory.designation ? (
                <p className="text-small break-words text-text-secondary">{doc.signatory.designation}</p>
              ) : null}
              <p className="text-small mt-1 tracking-wide text-text-secondary uppercase">
                Authorized Signatory for {business.name}
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// The Services cell, in the same conditional hierarchy as the PDF (the source of truth for it).
// - No stored service details: the description and the period, as it has always been.
// - One batch: the batch, the plan, its schedule line(s), then the period.
// - Several batches: the plan and the period, then a numbered entry per batch with its schedule line(s)
//   indented beneath. The number is generated here (it is never stored).
function ServiceCell({ line }) {
  const { service } = line;

  if (service && !service.table) {
    return (
      <>
        <p className="text-body font-medium break-words text-text-primary">{service.lead}</p>
        <p className="text-small break-words text-text-secondary">{line.description}</p>
        {service.schedule.map((schedule) => (
          <p key={schedule} className="text-small break-words text-text-secondary">
            {schedule}
          </p>
        ))}
        <p className="text-small break-words text-text-secondary">{line.period}</p>
      </>
    );
  }

  return (
    <>
      <p className="text-body font-medium break-words text-text-primary">{line.description}</p>
      <p className="text-small break-words text-text-secondary">{line.period}</p>

      {service?.table ? (
        <ol className="mt-2 space-y-1.5">
          {service.table.map((row) => (
            <li key={row.number} className="print:break-inside-avoid">
              <p className="text-body break-words text-text-primary">
                {row.number}. {row.batch}
              </p>
              {row.schedule.map((schedule) => (
                <p key={schedule} className="text-small pl-5 break-words text-text-secondary">
                  {schedule}
                </p>
              ))}
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
