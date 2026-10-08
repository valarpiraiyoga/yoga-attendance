/**
 * What the stored Invoice Detail shows, built from ONE input: the invoice record.
 *
 * An issued invoice is a historical snapshot — its business details, customer, plan and
 * period, amounts, tax, terms and signatory were copied into it when it was issued
 * (supabase/migrations/0026, 0027). This builder reads nothing else: it takes the invoice
 * and nothing more, so the page cannot be fed the live membership, student, Center Profile
 * or Invoice / Receipt Settings, and a later change to any of them cannot alter what an
 * issued invoice shows. It does no calculation — every amount, including the tax and the
 * amount before tax, is the stored value — and the displayed number comes from the one
 * formatter.
 *
 * Pure (no database, no React); the page and the tests share it.
 */

import { formatCurrency } from "../currencies.js";
import { formatDate } from "../format.js";
import { formatPhone } from "../phone.js";
import { formatInvoiceNumberOf } from "./invoice-number.js";
import { splitTax } from "./tax-split.js";
import { DOCUMENT_TITLE_LABEL } from "./membership-invoice.js";

const blank = (value) => (typeof value === "string" && value.trim() ? value : null);

// The stored bank snapshot is all-or-nothing (the four details together, branch optional).
function bankDetails(invoice) {
  const name = blank(invoice.bank_name);
  const accountName = blank(invoice.bank_account_name);
  const accountNumber = blank(invoice.bank_account_number);
  const ifscCode = blank(invoice.bank_ifsc_code);
  if (!name && !accountName && !accountNumber && !ifscCode) return null;
  return { name, accountName, accountNumber, ifscCode, branch: blank(invoice.bank_branch) };
}

/**
 * @param {object} invoice - a record from `getInvoiceForMembership` / `getInvoice`.
 * @returns {{
 *   title: string,
 *   number: string,
 *   invoiceDate: string,
 *   paymentDate: string,
 *   business: { name: string, address: string|null, phone: string|null, email: string|null, hasLogo: boolean },
 *   customer: { name: string, code: string, phone: string|null, email: string|null },
 *   line: { description: string, period: string },
 *   amounts: { currency: string, total: string, taxable: string|null, tax: { rate: string, amount: string, components: { label: string, rate: string, amount: string }[] }|null },
 *   terms: string|null,
 *   bank: { name: string, accountName: string, accountNumber: string, ifscCode: string, branch: string|null }|null,
 *   signatory: { name: string|null, designation: string|null, hasSignature: boolean },
 * }}
 */
export function buildInvoiceDocument(invoice) {
  const currency = invoice.currency;
  const taxed = Boolean(invoice.tax_enabled);
  // The stored total tax, shown as CGST and SGST (lib/invoices/tax-split.js): nothing is recalculated.
  const split = taxed ? splitTax(invoice.tax_amount, invoice.tax_rate) : null;

  return {
    title: DOCUMENT_TITLE_LABEL[invoice.document_title] ?? invoice.document_title,
    number: formatInvoiceNumberOf(invoice),
    invoiceDate: formatDate(invoice.invoice_date),
    paymentDate: formatDate(invoice.payment_date),

    business: {
      name: invoice.business_name,
      address: blank(invoice.business_address),
      phone: blank(invoice.business_phone),
      email: blank(invoice.business_email),
      hasLogo: Boolean(invoice.business_logo_path),
    },

    customer: {
      name: invoice.customer_name,
      code: invoice.customer_code,
      phone: blank(invoice.customer_phone) ? formatPhone(invoice.customer_phone, invoice.customer_phone_country_code) : null,
      email: blank(invoice.customer_email),
    },

    line: {
      description: invoice.description,
      period: `${formatDate(invoice.period_start)} – ${formatDate(invoice.period_end)}`,
    },

    // The stored amounts, as they are. With tax: the amount before tax, the total tax (with its combined
    // rate) and the total the customer paid, and the total tax shown as CGST and SGST; without tax: just the
    // total. The tax name is not used for the CGST / SGST labels.
    amounts: {
      currency,
      total: formatCurrency(invoice.total_amount, currency),
      taxable: taxed ? formatCurrency(invoice.taxable_amount, currency) : null,
      tax: taxed
        ? {
            rate: String(invoice.tax_rate),
            amount: formatCurrency(invoice.tax_amount, currency),
            components: split
              ? [
                  { label: "CGST", rate: split.rate, amount: formatCurrency(split.cgst, currency) },
                  { label: "SGST", rate: split.rate, amount: formatCurrency(split.sgst, currency) },
                ]
              : [],
          }
        : null,
    },

    terms: blank(invoice.terms),
    // The bank account snapshotted when the invoice was issued (0029); null when it had none.
    bank: bankDetails(invoice),
    signatory: {
      name: blank(invoice.signatory_name),
      designation: blank(invoice.signatory_designation),
      hasSignature: Boolean(invoice.signature_path),
    },
  };
}
