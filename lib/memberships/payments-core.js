/**
 * Membership payments (V1 Tax Adjustment, Step 2; migration 0034) - the pure rules and the database
 * calls, with the Supabase client passed in so they can be tested without a server.
 *
 * A membership can be paid in installments, and one payment can combine several methods
 * (01-product.md §5 "Payments"). Recording a payment is ONE database function,
 * `record_membership_payment`, which checks everything again and sets the membership's payment
 * status; nothing here writes a table directly.
 *
 * Amounts are handled in paise (whole numbers) so a sum of several methods is exact.
 */

export const PAYMENT_METHODS = Object.freeze([
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "other", label: "Other" },
]);

export const PAYMENT_METHOD_LABEL = Object.freeze(Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, m.label])));

const METHOD_VALUES = new Set(PAYMENT_METHODS.map((m) => m.value));
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REFERENCE_MAX = 100;
const NOTES_MAX = 500;

/** "1500.5" -> 150050 paise; null when it is not a plain positive amount with at most two decimals. */
export function toPaise(value) {
  const text = String(value ?? "").trim();
  if (!AMOUNT_PATTERN.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** 150050 -> "1500.50" (what the database receives). */
export function fromPaise(paise) {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Paid so far and the outstanding balance, from the membership amount and its recorded payments.
 *
 * @param {number|string} membershipAmount
 * @param {{ amount: number|string }[]} payments
 * @returns {{ paidPaise: number, balancePaise: number, amountPaise: number }}
 */
export function summarizePayments(membershipAmount, payments) {
  const amountPaise = toPaise(Number(membershipAmount).toFixed(2)) ?? 0;
  const paidPaise = (payments ?? []).reduce((sum, payment) => sum + (toPaise(Number(payment.amount).toFixed(2)) ?? 0), 0);
  return { amountPaise, paidPaise, balancePaise: Math.max(0, amountPaise - paidPaise) };
}

/**
 * Validates a payment before it is sent. The database checks the same rules again.
 *
 * @param {{ paymentDate: string, methods: { method: string, amount: string, referenceId?: string, notes?: string }[] }} input
 * @param {{ today: string, balancePaise: number }} context
 * @returns {{ success: true, data: { paymentDate: string, methods: object[], totalPaise: number } }
 *   | { success: false, errors: { payment_date?: string, methods?: string, rows: Record<number, Record<string, string>> } }}
 */
export function validatePaymentInput(input, { today, balancePaise }) {
  const errors = { rows: {} };
  const paymentDate = String(input?.paymentDate ?? "").trim();

  if (!paymentDate) errors.payment_date = "Enter the payment date.";
  else if (!DATE_PATTERN.test(paymentDate)) errors.payment_date = "Enter a valid payment date.";
  else if (today && paymentDate > today) errors.payment_date = "The payment date cannot be in the future.";

  const rows = Array.isArray(input?.methods) ? input.methods : [];
  if (rows.length === 0) errors.methods = "Add at least one payment method.";

  let totalPaise = 0;
  const methods = rows.map((row, index) => {
    const rowErrors = {};
    const method = String(row?.method ?? "").trim();
    const amountPaise = toPaise(row?.amount);
    const referenceId = String(row?.referenceId ?? "").trim();
    const notes = String(row?.notes ?? "").trim();

    if (!METHOD_VALUES.has(method)) rowErrors.method = "Select a payment method.";
    if (amountPaise === null || amountPaise <= 0) rowErrors.amount = "Enter an amount greater than zero, with at most two decimals.";
    if (referenceId.length > REFERENCE_MAX) rowErrors.referenceId = `Use at most ${REFERENCE_MAX} characters.`;
    if (notes.length > NOTES_MAX) rowErrors.notes = `Use at most ${NOTES_MAX} characters.`;

    if (Object.keys(rowErrors).length > 0) errors.rows[index] = rowErrors;
    if (amountPaise) totalPaise += amountPaise;

    return { method, amount: amountPaise ? fromPaise(amountPaise) : null, reference_id: referenceId || null, notes: notes || null };
  });

  if (!errors.methods && Object.keys(errors.rows).length === 0 && totalPaise > balancePaise) {
    errors.methods = "The payment cannot be more than the outstanding balance.";
  }

  if (errors.payment_date || errors.methods || Object.keys(errors.rows).length > 0) {
    return { success: false, errors };
  }
  // The payment's own tax invoice choice; anything but an explicit true/false lets the database use the student's default.
  const issueTaxInvoice = typeof input?.issueTaxInvoice === "boolean" ? input.issueTaxInvoice : null;

  return { success: true, data: { paymentDate, methods, totalPaise, issueTaxInvoice } };
}

// ---- request IDs (0065) ----------------------------------------------------------------------------

/**
 * Each Record Payment submission carries a request ID. The database answers a repeat of the same request (same
 * membership, date, methods and tax choice) with the payment it already recorded, so a retry after a dropped connection
 * or a timeout can never record the payment twice. The caller keeps the ID until the request has been answered for good
 * (`endsPaymentRequest`), and starts a new one for the next payment.
 */
export const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PAYMENT_REQUEST_MISMATCH_MESSAGE =
  "This payment may already have been recorded. Refresh the page and check the membership's payments before recording it again.";

/**
 * Whether a result ends its request, so the next submission needs a new request ID: a recorded payment, or the database
 * saying the ID has already recorded a payment with other details. Anything else keeps the ID - a refusal recorded
 * nothing under it, and an unclear failure may have recorded the payment, which only the same ID can safely repeat.
 *
 * @param {{ success?: boolean, code?: string }|null|undefined} result
 */
export function endsPaymentRequest(result) {
  return Boolean(result?.success) || result?.code === "23505";
}

/**
 * The request a Confirm sends: the one kept from an earlier, unresolved attempt, or a new one. A kept request is reused only
 * while the page shows the number of payments it was created with. A payment whose answer was lost is known to the Admin
 * only once a refresh shows it - and then the count has grown - so a different count means the earlier attempt is no
 * longer the open question, and a payment entered now is a new payment that must not replay it. A retry after a failure
 * or a closed dialog, with the page unchanged, keeps the same count and so the same ID.
 *
 * The count, not the balance: a membership amount correction or another payment's edit can bring the balance back to the
 * same value while a new payment is showing; the count cannot. This relies on payments never being deleted (no migration
 * allows it): the count only grows, so it changes exactly when a new payment appears. If deletion is ever added, key this
 * on the set of payment IDs instead.
 *
 * @param {{ id: string, paymentCount: number }|null|undefined} current - what the caller kept (null once a request ended).
 * @param {number} paymentCount - how many payments of the membership the page is showing now.
 * @param {() => string} createId - makes a new request ID (`crypto.randomUUID`).
 * @returns {{ id: string, paymentCount: number }} - store it back as the caller's kept request.
 */
export function paymentRequestFor(current, paymentCount, createId) {
  if (current?.id && current.paymentCount === paymentCount) return current;
  return { id: createId(), paymentCount };
}

// No balance limit: a retry of a recorded request is checked for everything but the balance (its own payment is in it).
const NO_BALANCE_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * The checks before a Record Payment submission reaches the database: not Paid, then `validatePaymentInput` against the
 * outstanding balance. They must not refuse a RETRY of a request that has already recorded its payment - that payment
 * already counts against the balance and may have made the membership Paid - so when a check would refuse and the
 * request ID has recorded a payment, the submission is checked for everything but the balance and goes on to the database,
 * which returns the original payment or refuses the ID as used for a different payment (23505). The lookup runs only
 * when a check would refuse, after the membership and its payments were read, so a first attempt that commits meanwhile
 * is seen by it.
 *
 * @param {object} input - as for `validatePaymentInput`.
 * @param {{ today: string, paid: boolean, balancePaise: number, isRecordedRequest: () => Promise<boolean> }} context
 * @returns {Promise<ReturnType<typeof validatePaymentInput> | { success: false, alreadyPaid: true }>}
 */
export async function checkPaymentToRecord(input, { today, paid, balancePaise, isRecordedRequest }) {
  if (paid) {
    if (!(await isRecordedRequest())) return { success: false, alreadyPaid: true };
    return validatePaymentInput(input, { today, balancePaise: NO_BALANCE_LIMIT });
  }
  const result = validatePaymentInput(input, { today, balancePaise });
  if (result.success || !(await isRecordedRequest())) return result;
  return validatePaymentInput(input, { today, balancePaise: NO_BALANCE_LIMIT });
}

// ---- error mapping -------------------------------------------------------------------------------

/** The messages migration 0034 raises (SQLSTATE + exact text), and how each is shown. */
const KNOWN_ERRORS = [
  ["42501", /^Not authorized\.$/, null, "You do not have permission to record payments."],
  ["P0002", /^Membership not found\.$/, null, "Membership not found."],
  ["55000", /^This membership is already paid\.$/, null, "This membership is already paid."],
  ["22023", /^The payment date is required\.$/, "payment_date", "Enter the payment date."],
  ["22023", /^The payment date cannot be in the future\.$/, "payment_date", "The payment date cannot be in the future."],
  ["22023", /^Add at least one payment method\.$/, "methods", "Add at least one payment method."],
  ["22023", /^Select a valid payment method\.$/, "methods", "Select a valid payment method."],
  ["22023", /^Each payment method needs an amount greater than zero, with at most two decimals\.$/, "methods", "Each payment method needs an amount greater than zero, with at most two decimals."],
  ["22023", /^The payment cannot be more than the outstanding balance\.$/, "methods", "The payment cannot be more than the outstanding balance."],
  ["23514", /^The payment cannot be more than the outstanding balance\.$/, "methods", "The payment cannot be more than the outstanding balance."],
  ["23514", /^The payment methods must add up to the payment amount\.$/, "methods", "The payment methods must add up to the payment amount."],
  // Editing a payment (0040).
  ["P0002", /^Payment not found\.$/, null, "Payment not found."],
  ["55006", /^A document has been issued for this payment, so it cannot be edited\.$/, null, "A document has been issued for this payment, so it cannot be edited. Correct the document instead."],
  // The membership guard (a save of the Edit Membership form, not a payment).
  ["55006", /^The payment status follows the recorded payments\.$/, "payment_status", "The payment status follows the recorded payments and cannot be changed here."],
  ["55006", /^Partially Paid is set by recording payments\.$/, "payment_status", "Partially Paid is set by recording payments."],
  ["55006", /^The amount cannot change the payment status given by the recorded payments\.$/, "amount", "The amount cannot go below what has already been paid, or change a membership that is fully paid."],
  // A request ID that has already recorded a payment, reused with other details (0065). The earlier submission WAS recorded.
  ["23505", /^This request ID has already been used for a different payment\.$/, null, PAYMENT_REQUEST_MISMATCH_MESSAGE],
  ["23505", /^This request ID has already been used for another membership\.$/, null, PAYMENT_REQUEST_MISMATCH_MESSAGE],
];

/**
 * The application result for a database error ONLY IF it is one of the payment rules' own messages,
 * else null (the caller keeps its own handling for everything else).
 *
 * @param {{ code?: string, message?: string }|null|undefined} error
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string }|null}
 */
export function matchKnownPaymentError(error) {
  const code = error?.code ?? null;
  if (!code) return null;
  for (const [knownCode, pattern, field, message] of KNOWN_ERRORS) {
    if (code === knownCode && pattern.test(error?.message ?? "")) {
      return field ? { error: message, fieldErrors: { [field]: message }, code } : { error: message, code };
    }
  }
  return null;
}

// ---- database ----------------------------------------------------------------------------------------

const PAYMENT_COLUMNS =
  "id, membership_id, payment_date, amount, issue_tax_invoice, created_at, membership_payment_methods(id, position, method, amount, reference_id, notes), invoices(id, invoice_number, invoice_prefix, document_series, document_title, invoice_date, status, cancelled_at), membership_payment_edits(id, edited_at, previous_amount, new_amount)";

/** The document of a payment that was cancelled last (latest cancellation, then the highest number), or null when none was. */
function latestCancelledOf(documents) {
  const cancelled = documents.filter((doc) => doc.status === "cancelled");
  cancelled.sort(
    (a, b) => String(b.cancelled_at ?? "").localeCompare(String(a.cancelled_at ?? "")) || Number(b.invoice_number ?? 0) - Number(a.invoice_number ?? 0),
  );
  return cancelled[0] ?? null;
}

/**
 * A membership's payments, oldest first, each with its methods in the order they were entered.
 *
 * @param {object} supabase
 * @param {string} membershipId
 */
export async function fetchPaymentsForMembership(supabase, membershipId) {
  const { data, error } = await supabase
    .from("membership_payments")
    .select(PAYMENT_COLUMNS)
    .eq("membership_id", membershipId)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("position", { ascending: true, referencedTable: "membership_payment_methods" });

  if (error) {
    console.error(`[payments] Could not load the payments of membership ${membershipId}:`, error.code, error.message);
    throw new Error("Could not load the payments.");
  }

  // A payment has at most one ISSUED document (0036, 0037); cancelled ones are its correction history.
  return (data ?? []).map(({ membership_payment_methods: methods, invoices, membership_payment_edits: edits, ...payment }) => {
    const documents = Array.isArray(invoices) ? invoices : invoices ? [invoices] : [];
    return {
      ...payment,
      methods: methods ?? [],
      document: documents.find((doc) => (doc.status ?? "issued") === "issued") ?? null,
      // With no issued document left (a cancellation without a replacement), the document that was cancelled last - where the
      // payment's correction history ends - so the panel can open it; its own page lists every earlier document. Null while a
      // document is issued: the issued one is the link then.
      cancelledDocument: documents.some((doc) => (doc.status ?? "issued") === "issued") ? null : latestCancelledOf(documents),
      corrected: documents.some((doc) => doc.status === "cancelled"),
      // Any document at all - issued or cancelled - freezes the payment's amount (Step 8).
      editable: documents.length === 0,
      // Its amount edits, oldest first (0038's audit trail).
      edits: [...(edits ?? [])].sort((a, b) => String(a.edited_at).localeCompare(String(b.edited_at))),
    };
  });
}

/**
 * The payment methods of one payment, in the order they were entered - what a payment document lists
 * (V1 Tax Adjustment, Step 5). Admin-only through row-level security.
 *
 * @param {object} supabase
 * @param {string} paymentId
 */
export async function fetchPaymentMethods(supabase, paymentId) {
  const { data, error } = await supabase
    .from("membership_payment_methods")
    .select("position, method, amount, reference_id, notes")
    .eq("payment_id", paymentId)
    .order("position", { ascending: true });

  if (error) {
    console.error(`[payments] Could not load the methods of payment ${paymentId}:`, error.code, error.message);
    throw new Error("Could not load the payment methods.");
  }

  return data ?? [];
}

/**
 * Edits a recorded payment through the database function (0040): its date and its methods (type, amount, reference
 * and notes - changed, added or removed), replacing them in one transaction. The input is validated by the same
 * `validatePaymentInput` as recording, so the two cannot disagree.
 *
 * @param {object} supabase
 * @param {string} paymentId
 * @param {{ paymentDate: string, methods: object[] }} data - from `validatePaymentInput`.
 * @returns {Promise<{ success: true } | { error: string, fieldErrors?: Record<string, string> }>}
 */
export async function editPaymentFor(supabase, paymentId, data) {
  const { error } = await supabase.rpc("edit_payment", {
    p_payment_id: paymentId,
    p_payment_date: data.paymentDate,
    p_methods: data.methods,
  });

  if (error) {
    const known = matchKnownPaymentError(error);
    if (known) return known;
    console.error(`[payments] Could not edit payment ${paymentId}:`, error.code, error.message);
    return { error: "Could not edit the payment. Try again." };
  }

  return { success: true };
}

/**
 * Whether a request ID has already recorded a payment (0065). Read only to let a retry through checks that the payment it
 * repeats has itself changed - a smaller balance, a Paid membership - so the database can answer it with that payment.
 * A failed read counts as "no": the retry then meets the usual checks, which may refuse it but never record it twice.
 *
 * @param {object} supabase
 * @param {string} requestId
 */
export async function isRecordedPaymentRequest(supabase, requestId) {
  const { data, error } = await supabase.from("membership_payments").select("id").eq("request_id", requestId).maybeSingle();
  if (error) {
    console.error(`[payments] Could not look up payment request ${requestId}:`, error.code, error.message);
    return false;
  }
  return Boolean(data);
}

/**
 * Records one payment through the database function.
 *
 * @param {object} supabase
 * @param {string} membershipId
 * @param {{ paymentDate: string, methods: object[] }} data - from `validatePaymentInput`.
 * @param {string|null} [requestId] - the submission's request ID (0065). Without one the payment is recorded exactly as
 *   before 0065, with no retry protection; the argument is then not sent at all.
 * @returns {Promise<{ success: true, paymentId: string } | { error: string, fieldErrors?: Record<string, string>, code?: string }>}
 */
export async function recordPaymentFor(supabase, membershipId, data, requestId = null) {
  const { data: paymentId, error } = await supabase.rpc("record_membership_payment", {
    p_membership_id: membershipId,
    p_payment_date: data.paymentDate,
    p_methods: data.methods,
    p_issue_tax_invoice: data.issueTaxInvoice ?? null,
    ...(requestId ? { p_request_id: requestId } : {}),
  });

  if (error) {
    const known = matchKnownPaymentError(error);
    if (known) return known;
    console.error(`[payments] Could not record a payment for membership ${membershipId}:`, error.code, error.message);
    return { error: "Could not record the payment. Try again." };
  }

  return { success: true, paymentId };
}
