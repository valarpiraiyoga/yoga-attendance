/**
 * Invoice / Receipt — the pure half of the application layer (no Next.js, no
 * React): the column list, how database errors become application messages, and
 * the functions that take a Supabase client. `lib/invoices/data.js` and
 * `lib/invoices/actions.js` are the server-only wrappers that supply the
 * request's client and the Admin check; that is what the rest of the app
 * imports. The split mirrors `lib/center-profile/settings-core.js`.
 *
 * THE DATABASE IS THE AUTHORITY (supabase/migrations/0025, 0026). Nothing here
 * generates or edits an invoice number's sequence, calculates tax, builds the
 * snapshot, or decides who may issue what — it calls `issue_invoice()` and
 * `update_invoice_details()` and reports the result. The only checks made here
 * are the shape of what is being sent (a real date, a whole number), so a typo
 * is a field message rather than a database error.
 */

import { validateInvoiceDetailsInput, validateIssueInvoiceInput } from "./validation.js";
import { readCorrectionContext } from "./correction-context.js";
import {
  buildCorrectionRpcArgs,
  checkReviewed,
  flattenCorrectionErrors,
  previewCorrection,
  validateCorrectionInput,
} from "./document-correction.js";

/** Every column of an invoice, explicitly (the project never `select("*")`). */
export const INVOICE_COLUMNS = [
  "id", "membership_id", "invoice_number", "invoice_date", "payment_date",
  "document_title", "description", "plan", "period_start", "period_end",
  "currency", "total_amount",
  "tax_enabled", "tax_name", "tax_rate", "taxable_amount", "tax_amount",
  "customer_name", "customer_code", "customer_phone", "customer_phone_country_code", "customer_email",
  "business_name", "business_address", "business_phone", "business_email", "business_logo_path", "business_gstin",
  "terms", "signatory_name", "signatory_designation", "signature_path",
  "invoice_prefix",
  "bank_name", "bank_account_name", "bank_account_number", "bank_ifsc_code", "bank_branch",
  "service_details",
  "payment_id", "document_series",
  "status", "cancelled_at", "cancellation_reason", "replaces_id",
  "created_at", "updated_at",
].join(", ");

// ---- error mapping -------------------------------------------------------------------

/**
 * The messages the invoice migrations raise (SQLSTATE + exact text), and how
 * each is shown. Matching on the text as well as the code is deliberate: only a
 * message WE wrote is ever passed on; anything else — a raw Postgres or
 * PostgREST error — falls to a generic message for its code and is logged.
 *
 * `field` names the form field a message belongs to, for `fieldErrors`.
 */
const KNOWN_ERRORS = [
  // 42501 — not authorised
  ["42501", /^Not authorized\.$/, null, "You do not have permission to manage invoices."],

  // P0002 — not found
  ["P0002", /^Membership not found\.$/, null, "Membership not found."],
  ["P0002", /^Invoice not found\.$/, null, "Invoice not found."],
  ["P0002", /^The student or centre profile could not be read\.$/, null, "The student or center profile needed for the invoice could not be read."],

  // 22023 — invalid value
  ["22023", /^Confirm the payment date to issue this invoice\.$/, "payment_date", "Confirm the payment date to issue this invoice."],
  ["22023", /^A payment date is required to issue an invoice\.$/, "payment_date", "A payment date is required to issue an invoice."],
  ["22023", /^The payment date cannot be in the future\.$/, "payment_date", "The payment date cannot be in the future."],
  ["22023", /^This membership already has a payment date, which cannot be changed\.$/, "payment_date", "This membership already has a payment date, which cannot be changed."],
  ["22023", /^The invoice date cannot be in the future\.$/, "invoice_date", "The invoice date cannot be in the future."],
  ["22023", /^The invoice date cannot be before the payment date\.$/, "invoice_date", "The invoice date cannot be before the payment date."],
  ["22023", /^The invoice date is required\.$/, "invoice_date", "Enter the invoice date."],
  ["22023", /^Invoice date and payment date are required\.$/, "invoice_date", "Enter the invoice date."],
  ["22023", /^The invoice number must be a positive whole number\.$/, "invoice_number", "Enter the invoice number as a positive whole number."],
  ["22023", /^The invoice number cannot be below the starting invoice number \((\d+)\)\.$/, "invoice_number", (m) => `The invoice number cannot be below the starting invoice number (${m[1]}).`],

  // 23505 — duplicate
  ["23505", /^An invoice has already been issued for this membership\.$/, null, "An invoice has already been issued for this membership."],
  ["23505", /^That invoice number is already in use\.$/, "invoice_number", "That invoice number is already in use."],
  // A number that was ever assigned to a receipt is never given to another (migration 0030).
  ["23505", /^That invoice number has already been used and cannot be used again\.$/, "invoice_number", "That number has already been used and cannot be used again."],
  // The unique indexes themselves, reached if two requests race past the function's own check.
  ["23505", /invoices_invoice_number_unique/, "invoice_number", "That invoice number is already in use."],
  ["23505", /invoice_number_reservations/, "invoice_number", "That number has already been used and cannot be used again."],
  ["23505", /invoices_membership_id_unique/, null, "An invoice has already been issued for this membership."],

  // Corrections (0037)
  ["22023", /^Enter the reason for the correction\.$/, "reason", "Enter the reason for the correction."],
  ["22023", /^The reason can have at most 500 characters\.$/, "reason", "The reason can have at most 500 characters."],
  ["55000", /^Only a payment document can be corrected\.$/, null, "Only a payment document can be corrected."],
  ["55006", /^This document has already been cancelled\.$/, null, "This document has already been cancelled and corrected."],
  ["55006", /^A cancelled document cannot be changed\.$/, null, "A cancelled document cannot be changed."],
  ["23505", /invoices_replaces_id_unique/, null, "This document has already been corrected."],

  // Cancel Document and Correct & Reissue (0055)
  ["22023", /^Enter the reason for the cancellation\.$/, "reason", "Enter the reason for the cancellation."],
  ["55000", /^Only a payment document can be cancelled\.$/, null, "Only a payment document can be cancelled."],
  ["22023", /^The corrections must be an object\.$/, null, "Those corrections could not be applied. Check the details and try again."],
  ["22023", /^That detail cannot be corrected on a document\.$/, null, "Those corrections could not be applied. Check the details and try again."],
  ["22023", /^Each corrected detail must be text\.$/, null, "Those corrections could not be applied. Check the details and try again."],
  ["22023", /^A corrected detail can have at most 500 characters\.$/, null, "Use at most 500 characters in each corrected detail."],
  ["22023", /^A GSTIN can be corrected on a tax invoice only\.$/, "business_gstin", "A GSTIN can be corrected on a tax invoice only."],
  ["22023", /^The customer name is required\.$/, "customer_name", "Enter the customer name."],
  ["22023", /^The business name is required\.$/, "business_name", "Enter the business name."],
  ["22023", /^The (?:correction|replaced document) must (?:name a|be a) document of this payment\.$/, null, "That document does not belong to this payment."],
  ["22023", /^The payment cannot be more than the outstanding balance\.$/, "methods", "The payment cannot be more than the outstanding balance."],
  ["22023", /^Add at least one payment method\.$/, "methods", "Add at least one payment method."],
  ["22023", /^Select a valid payment method\.$/, "methods", "Select a valid payment method."],
  ["22023", /^Each payment method needs an amount greater than zero, with at most two decimals\.$/, "methods", "Each payment method needs an amount greater than zero, with at most two decimals."],
  ["23514", /invoices_business_gstin_valid/, "business_gstin", "Enter a valid GSTIN, or leave it blank."],
  ["23514", /^The payment methods must add up to the payment amount\.$/, "methods", "The payment methods must add up to the payment amount."],
  ["55006", /^The corrected document is not the one that was reviewed\. Review it again\.$/, null, "The corrected document changed since you reviewed it. Review it again."],

  // Payment documents (0036)
  ["P0002", /^Payment not found\.$/, null, "Payment not found."],
  ["23505", /^A document has already been issued for this payment\.$/, null, "A document has already been issued for this payment."],
  ["23505", /invoices_payment_id_unique/, null, "A document has already been issued for this payment."],
  ["23505", /^That payment receipt number has already been used and cannot be used again\.$/, "invoice_number", "That number has already been used and cannot be used again."],
  ["23505", /invoices_payment_receipt_number_unique|payment_receipt_number_reservations/, "invoice_number", "That payment receipt number is already in use."],
  ["55000", /^Payment receipt numbering has not been configured\.$/, null, "Payment receipt numbering has not been configured yet. Set the starting payment receipt number in Settings."],
  ["55000", /^This membership has recorded payments: issue a document for each payment\.$/, null, "This membership has recorded payments: issue a document for each payment instead."],
  ["55000", /^A membership invoice already exists for this membership\.$/, null, "A membership invoice already exists for this membership, so its payments cannot be given documents."],
  ["22023", /^The document date cannot be before the payment date\.$/, "invoice_date", "The document date cannot be before the payment date."],
  ["22023", /^The document date cannot be in the future\.$/, "invoice_date", "The document date cannot be in the future."],
  ["22023", /^The payment receipt number cannot be below the starting payment receipt number \((\d+)\)\.$/, "invoice_number", (m) => `The number cannot be below the starting payment receipt number (${m[1]}).`],
  ["55006", /^The starting payment receipt number cannot be changed once a payment receipt has been issued\.$/, "payment_receipt_starting_number", "The starting payment receipt number cannot be changed once a payment receipt has been issued."],

  // 55000 — prerequisite not met
  ["55000", /^Invoice numbering has not been configured\.$/, null, "Invoice numbering has not been configured yet, so an invoice cannot be issued."],
  ["55000", /^Only a Paid membership can be invoiced\.$/, null, "Only a Paid membership can be invoiced."],

  // 55006 — protected / locked
  ["55006", /^The payment status cannot be changed after an invoice has been issued\.$/, "payment_status", "The payment status cannot be changed after an invoice has been issued."],
  ["55006", /^The payment date cannot be changed after an invoice has been issued\.$/, "payment_date", "The payment date cannot be changed after an invoice has been issued."],
  ["55006", /^The starting invoice number cannot be changed once an invoice has been issued\.$/, null, "The starting invoice number cannot be changed once an invoice has been issued."],
  ["55006", /^An issued invoice can only change its number and date\.$/, null, "An issued invoice can only change its number and date."],
  ["55006", /^An issued invoice cannot be deleted\.$/, null, "An issued invoice cannot be deleted."],
];

// What a recognised code says when its message is not one we know.
const CODE_FALLBACKS = {
  "42501": "You do not have permission to manage invoices.",
  P0002: "The invoice or membership could not be found.",
  "22023": "Check the values you entered.",
  "23505": "That invoice number is already in use, or an invoice has already been issued.",
  "55000": "The invoice cannot be issued right now.",
  "55006": "This change is not allowed once an invoice has been issued.",
};

/**
 * The application result for a database error ONLY IF it is one of the
 * invoice rules' own messages (the whitelist above), else null. No logging, no
 * fallback — so a caller with its own error handling (the membership actions,
 * whose saves can now be refused by the invoice triggers) can surface exactly
 * these and leave everything else to its existing handling.
 *
 * @param {{ code?: string, message?: string, details?: string }|null|undefined} error
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string }|null}
 */
export function matchKnownInvoiceError(error) {
  const code = error?.code ?? null;
  if (!code) return null;
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`.trim();

  for (const [knownCode, pattern, field, message] of KNOWN_ERRORS) {
    if (code !== knownCode) continue;
    const match = text.match(pattern) ?? error?.message?.match(pattern);
    if (!match) continue;
    const shown = typeof message === "function" ? message(match) : message;
    return field ? { error: shown, fieldErrors: { [field]: shown }, code } : { error: shown, code };
  }

  return null;
}

/**
 * A database error as an application result: `{ error, fieldErrors?, code }`,
 * the same shape the membership actions return. A raw Postgres/PostgREST
 * message is never passed on; an unrecognised error is logged here (code and
 * message only, as everywhere else) and shown as `fallback`.
 *
 * @param {{ code?: string, message?: string, details?: string }|null|undefined} error
 * @param {string} fallback - what to say when nothing more specific is known.
 * @param {string} [context] - for the log line.
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string|null }}
 */
export function mapInvoiceError(error, fallback, context = "invoice") {
  const known = matchKnownInvoiceError(error);
  if (known) return known;

  const code = error?.code ?? null;
  if (CODE_FALLBACKS[code]) {
    return { error: CODE_FALLBACKS[code], code };
  }

  console.error(`[invoices] ${context} failed:`, code, error?.message);
  return { error: fallback, code };
}

// ---- reads ---------------------------------------------------------------------------------

/**
 * The invoice issued for a membership, or null if it has none (or is not
 * visible to the caller under RLS — an Instructor sees no invoices).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} membershipId
 */
export async function fetchInvoiceForMembership(supabase, membershipId) {
  if (!membershipId) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("membership_id", membershipId)
    // The membership-level document only; a payment's own documents (0036) are read by their id.
    .is("payment_id", null)
    .maybeSingle();

  if (error) {
    console.error(`[invoices] Could not load the invoice for membership ${membershipId}:`, error.code, error.message);
    throw new Error("Could not load the invoice.");
  }

  return data ?? null;
}

/**
 * An invoice by its own id, or null if it does not exist (or is not visible
 * to the caller under RLS).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} invoiceId
 */
export async function fetchInvoice(supabase, invoiceId) {
  if (!invoiceId) return null;

  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLUMNS)
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) {
    console.error(`[invoices] Could not load invoice ${invoiceId}:`, error.code, error.message);
    throw new Error("Could not load the invoice.");
  }

  return data ?? null;
}

// ---- writes ----------------------------------------------------------------------------------

/**
 * Issues the invoice for a Paid membership that has none, through the
 * `issue_invoice()` function — the database numbers it, calculates any tax,
 * builds the snapshot and enforces every date and uniqueness rule.
 *
 * `paymentDate` is for a membership that was Paid before invoicing existed and
 * so has no payment date: the Admin confirms one here (the database refuses to
 * invent it). `invoiceDate` is optional and defaults, in the database, to the
 * payment date.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} membershipId
 * @param {{ paymentDate?: string|null, invoiceDate?: string|null }} [input]
 * @returns {Promise<{ success: true, invoiceId: string } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function issueInvoiceFor(supabase, membershipId, input = {}) {
  if (!membershipId) {
    return { error: "Could not issue the invoice. Try again.", code: null };
  }

  const result = validateIssueInvoiceInput(input);
  if (!result.success) {
    return { error: "Check the highlighted fields.", fieldErrors: result.errors, code: null };
  }

  const { data, error } = await supabase.rpc("issue_invoice", {
    p_membership_id: membershipId,
    p_payment_date: result.data.paymentDate,
    p_invoice_date: result.data.invoiceDate,
  });

  if (error) {
    return mapInvoiceError(error, "Could not issue the invoice. Try again.", `issue for membership ${membershipId}`);
  }

  return { success: true, invoiceId: data };
}

/**
 * Cancels one issued payment document (0055) with a required reason and issues NO replacement. The document keeps its number and
 * its details; the payment and the membership are untouched and the payment stays locked, so a payment can be corrected only
 * through Correct & Reissue.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} documentId
 * @param {string} reason
 * @returns {Promise<{ success: true, documentId: string } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function cancelPaymentDocumentFor(supabase, documentId, reason) {
  const text = String(reason ?? "").trim();
  if (!documentId) {
    return { error: "Could not cancel the document. Try again.", code: null };
  }
  if (!text) {
    return { error: "Enter the reason for the cancellation.", fieldErrors: { reason: "Enter the reason for the cancellation." }, code: null };
  }
  if (text.length > 500) {
    return { error: "The reason can have at most 500 characters.", fieldErrors: { reason: "The reason can have at most 500 characters." }, code: null };
  }

  const { data, error } = await supabase.rpc("cancel_payment_document", { p_document_id: documentId, p_reason: text });

  if (error) {
    return mapInvoiceError(error, "Could not cancel the document. Try again.", `cancel document ${documentId}`);
  }

  return { success: true, documentId: data };
}

/**
 * What the correction screens need about one payment document: the document (an invoice read), then its payment, the
 * membership balance and the current tax terms (`readCorrectionContext`, read-only). Null when the document is not a payment
 * document of that membership.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} membershipId
 * @param {string} documentId
 */
export async function fetchCorrectionContext(supabase, membershipId, documentId) {
  return readCorrectionContext(supabase, membershipId, await fetchInvoice(supabase, documentId));
}

/**
 * Validates a correction against its context and recalculates the replacement for the review step. Pure: it reads the context
 * and the input and writes nothing.
 *
 * @param {Awaited<ReturnType<typeof fetchCorrectionContext>>} context
 * @param {object} input - the form (see `validateCorrectionInput`).
 * @param {string} today - the centre's date, YYYY-MM-DD.
 */
export function evaluateCorrection(context, input, today) {
  const { document } = context;
  const validation = validateCorrectionInput(input, {
    series: document.document_series,
    paymentDate: context.payment.payment_date,
    originalInvoiceDate: document.invoice_date,
    today,
    paymentAmountPaise: context.paymentAmountPaise,
    currentMethods: context.payment.methods,
    availablePaise: context.availablePaise,
  });
  if (!validation.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: flattenCorrectionErrors(validation.errors),
      rowErrors: validation.errors.rows,
      code: null,
    };
  }

  const preview = previewCorrection({
    series: document.document_series,
    totalPaise: validation.data.totalPaise,
    tax: { enabled: context.settings.tax_enabled === true, rate: context.settings.tax_rate, name: context.settings.tax_name },
    membership: { amountPaise: context.membershipAmountPaise, otherPaymentsPaise: context.otherPaymentsPaise },
  });

  return { success: true, data: validation.data, preview };
}

/**
 * Correct & Reissue (0055): validates the correction, recalculates it, checks it is the document the Admin reviewed, then calls
 * `correct_and_reissue_payment_document` - ONE database transaction that cancels the original, corrects the payment (amount and
 * methods, the payment date unchanged, within the membership's remaining balance) and issues the linked replacement in the same
 * series with a new number. The database checks every rule again under the membership lock and is the authority on the balance;
 * a refusal rolls everything back.
 *
 * `input.expectedTotal` / `input.expectedTax` are the figures the Admin reviewed; they travel to the database, which refuses a
 * replacement that differs.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ membershipId: string, documentId: string, input: object, today: string }} request
 * @returns {Promise<{ success: true, invoiceId: string } | { error: string, fieldErrors?: Record<string, string>, rowErrors?: object, code: string|null }>}
 */
export async function correctAndReissuePaymentDocumentFor(supabase, { membershipId, documentId, input, today }) {
  if (!membershipId || !documentId) {
    return { error: "Could not correct the document. Try again.", code: null };
  }

  const context = await fetchCorrectionContext(supabase, membershipId, documentId);
  if (!context) {
    return { error: "Invoice not found.", code: "P0002" };
  }
  if (context.document.status !== "issued") {
    return { error: "This document has already been cancelled and corrected.", code: "55006" };
  }

  const evaluated = evaluateCorrection(context, input, today);
  if (!evaluated.success) return evaluated;

  const reviewed = checkReviewed(evaluated.preview, { total: input?.expectedTotal, tax: input?.expectedTax });
  if (!reviewed.ok) {
    return { error: reviewed.error, code: null };
  }

  const { data, error } = await supabase.rpc("correct_and_reissue_payment_document", buildCorrectionRpcArgs(documentId, evaluated.data, reviewed));

  if (error) {
    return mapInvoiceError(error, "Could not correct the document. Try again.", `correct and reissue document ${documentId}`);
  }

  return { success: true, invoiceId: data };
}

/**
 * Issues the one document of a recorded payment (0036): a tax invoice from the invoice sequence, or a
 * payment receipt from its own sequence, as the payment's `issue_tax_invoice` chose. The database picks
 * the series, the number and the snapshot; nothing is sent but the payment.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} paymentId
 * @returns {Promise<{ success: true, invoiceId: string } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function issuePaymentDocumentFor(supabase, paymentId) {
  if (!paymentId) {
    return { error: "Could not issue the document. Try again.", code: null };
  }

  const { data, error } = await supabase.rpc("issue_payment_document", { p_payment_id: paymentId });

  if (error) {
    return mapInvoiceError(error, "Could not issue the document. Try again.", `issue for payment ${paymentId}`);
  }

  return { success: true, invoiceId: data };
}

/**
 * Every document of one payment - issued and cancelled - oldest first: its correction history (0037).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} paymentId
 */
export async function fetchPaymentDocumentHistory(supabase, paymentId) {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_prefix, document_title, status, invoice_date, cancelled_at, cancellation_reason, replaces_id, created_at")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[invoices] Could not load the documents of payment ${paymentId}:`, error.code, error.message);
    throw new Error("Could not load the invoice.");
  }

  return data ?? [];
}

/**
 * Corrects a payment document (0037): cancels it with the reason and issues its replacement - a new number
 * from the same series - in one database transaction. Nothing else is sent.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} documentId
 * @param {string} reason
 * @returns {Promise<{ success: true, invoiceId: string } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function correctPaymentDocumentFor(supabase, documentId, reason) {
  const text = String(reason ?? "").trim();
  if (!documentId) {
    return { error: "Could not correct the document. Try again.", code: null };
  }
  if (!text) {
    return { error: "Enter the reason for the correction.", fieldErrors: { reason: "Enter the reason for the correction." }, code: null };
  }
  if (text.length > 500) {
    return { error: "The reason can have at most 500 characters.", fieldErrors: { reason: "The reason can have at most 500 characters." }, code: null };
  }

  const { data, error } = await supabase.rpc("correct_payment_document", { p_document_id: documentId, p_reason: text });

  if (error) {
    return mapInvoiceError(error, "Could not correct the document. Try again.", `correct document ${documentId}`);
  }

  return { success: true, invoiceId: data };
}

/**
 * Edits the two things an issued invoice allows — its number and its date —
 * through `update_invoice_details()`. Nothing else is sent: the amount,
 * customer, tax, terms, business details and payment date are a historical
 * snapshot the database will not let change.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} invoiceId
 * @param {{ invoiceNumber: string|number, invoiceDate: string }} input
 * @returns {Promise<{ success: true } | { error: string, fieldErrors?: Record<string, string>, code: string|null }>}
 */
export async function updateInvoiceDetailsFor(supabase, invoiceId, input = {}) {
  if (!invoiceId) {
    return { error: "Could not update the invoice. Try again.", code: null };
  }

  const result = validateInvoiceDetailsInput(input);
  if (!result.success) {
    return { error: "Check the highlighted fields.", fieldErrors: result.errors, code: null };
  }

  const { error } = await supabase.rpc("update_invoice_details", {
    p_invoice_id: invoiceId,
    p_invoice_number: result.data.invoiceNumber,
    p_invoice_date: result.data.invoiceDate,
  });

  if (error) {
    return mapInvoiceError(error, "Could not update the invoice. Try again.", `update of invoice ${invoiceId}`);
  }

  return { success: true };
}
