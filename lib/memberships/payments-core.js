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

/**
 * Validates an edit of a recorded payment's amount (Step 8): one amount for EVERY existing method of the payment,
 * each greater than zero with at most two decimals, adding up to a total within what the membership still allows
 * once this payment's own previous amount is set aside. The database checks the same rules again.
 *
 * @param {{ allocations: { id: string, amount: string }[] }} input
 * @param {{ methods: { id: string }[], availablePaise: number }} context - the payment's methods, and the
 *   membership amount less every OTHER payment.
 * @returns {{ success: true, data: { allocations: { id: string, amount: string }[], totalPaise: number } }
 *   | { success: false, errors: { allocations?: string, rows: Record<string, string> } }}
 */
export function validatePaymentEdit(input, { methods, availablePaise }) {
  const errors = { rows: {} };
  const given = new Map((Array.isArray(input?.allocations) ? input.allocations : []).map((row) => [String(row?.id ?? ""), row?.amount]));
  const ids = (methods ?? []).map((method) => String(method.id));

  if (ids.length === 0 || given.size !== ids.length || ids.some((id) => !given.has(id))) {
    errors.allocations = "Enter an amount for each payment method.";
  }

  let totalPaise = 0;
  const allocations = ids.map((id) => {
    const amountPaise = toPaise(given.get(id));
    if (amountPaise === null || amountPaise <= 0) errors.rows[id] = "Enter an amount greater than zero, with at most two decimals.";
    else totalPaise += amountPaise;
    return { id, amount: amountPaise ? fromPaise(amountPaise) : null };
  });

  if (!errors.allocations && Object.keys(errors.rows).length === 0 && totalPaise > availablePaise) {
    errors.allocations = "The payment cannot be more than the outstanding balance.";
  }

  if (errors.allocations || Object.keys(errors.rows).length > 0) return { success: false, errors };
  return { success: true, data: { allocations, totalPaise } };
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
  // Editing a payment's amount (0038).
  ["P0002", /^Payment not found\.$/, null, "Payment not found."],
  ["55006", /^A document has been issued for this payment, so its amount cannot be edited\.$/, null, "A document has been issued for this payment, so its amount cannot be edited. Correct the document instead."],
  ["22023", /^Enter an amount for each payment method(, once)?\.$/, "allocations", "Enter an amount for each payment method."],
  ["22023", /^Each amount must belong to one of this payment's methods\.$/, "allocations", "Enter an amount for each payment method."],
  // The membership guard (a save of the Edit Membership form, not a payment).
  ["55006", /^The payment status follows the recorded payments\.$/, "payment_status", "The payment status follows the recorded payments and cannot be changed here."],
  ["55006", /^Partially Paid is set by recording payments\.$/, "payment_status", "Partially Paid is set by recording payments."],
  ["55006", /^The amount cannot change the payment status given by the recorded payments\.$/, "amount", "The amount cannot go below what has already been paid, or change a membership that is fully paid."],
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
  "id, membership_id, payment_date, amount, issue_tax_invoice, created_at, membership_payment_methods(id, position, method, amount, reference_id, notes), invoices(id, invoice_number, invoice_prefix, document_series, document_title, invoice_date, status), membership_payment_edits(id, edited_at, previous_amount, new_amount)";

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
 * Edits a recorded payment's amount through the database function (0038): the new amount of each existing method.
 *
 * @param {object} supabase
 * @param {string} paymentId
 * @param {{ allocations: { id: string, amount: string }[] }} data - from `validatePaymentEdit`.
 * @returns {Promise<{ success: true } | { error: string, fieldErrors?: Record<string, string> }>}
 */
export async function editPaymentAmountFor(supabase, paymentId, data) {
  const { error } = await supabase.rpc("edit_payment_amount", { p_payment_id: paymentId, p_allocations: data.allocations });

  if (error) {
    const known = matchKnownPaymentError(error);
    if (known) return known;
    console.error(`[payments] Could not edit payment ${paymentId}:`, error.code, error.message);
    return { error: "Could not edit the payment. Try again." };
  }

  return { success: true };
}

/**
 * Records one payment through the database function.
 *
 * @param {object} supabase
 * @param {string} membershipId
 * @param {{ paymentDate: string, methods: object[] }} data - from `validatePaymentInput`.
 * @returns {Promise<{ success: true, paymentId: string } | { error: string, fieldErrors?: Record<string, string> }>}
 */
export async function recordPaymentFor(supabase, membershipId, data) {
  const { data: paymentId, error } = await supabase.rpc("record_membership_payment", {
    p_membership_id: membershipId,
    p_payment_date: data.paymentDate,
    p_methods: data.methods,
    p_issue_tax_invoice: data.issueTaxInvoice ?? null,
  });

  if (error) {
    const known = matchKnownPaymentError(error);
    if (known) return known;
    console.error(`[payments] Could not record a payment for membership ${membershipId}:`, error.code, error.message);
    return { error: "Could not record the payment. Try again." };
  }

  return { success: true, paymentId };
}
