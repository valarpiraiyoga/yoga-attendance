/**
 * The optional first payment of Create Membership and Renew Membership ("Record Payment Now").
 *
 * Nothing here is new payment logic. The payment is validated by `validatePaymentInput` and recorded by
 * `recordPaymentFor` (the `record_membership_payment` database function) - the same two functions the Record
 * Payment dialog uses - so the amount rules, the allocation rules, the tax invoice preference, the payment status
 * and the payment-level document rules are exactly those of a payment recorded later. This file only decides the ORDER.
 *
 * The membership and its payment are two database calls, not one transaction, so the order is what keeps them safe:
 *   1. The payment is validated BEFORE anything is written, against the membership amount (a new membership's whole
 *      amount is outstanding). A payment the database would refuse is therefore refused here, before a membership exists.
 *   2. The membership is created. If that fails (an overlap, a database error) no payment is attempted.
 *   3. Only then is the payment recorded - once, never retried. A second submit of the same form cannot record a second
 *      payment: it cannot create a second membership (the overlap rule) and so never reaches step 3.
 *   4. If step 3 fails, the membership stays - correctly Pending, with nothing paid - and the caller is told, so the
 *      Admin can check Payments and record it from there. A payment is never guessed at or repeated.
 *
 * No request ID is sent (0065's `p_request_id` stays NULL, its default). One would only help a repeat of the same
 * payment call, and there is none: the call is made once, on the server, for a membership created a moment before in the
 * same action, and a resubmitted form never reaches it (step 3). The Record Payment dialog, which can be retried, sends one.
 *
 * Pure: the Supabase client and the membership insert are passed in, so it is tested without a server.
 */

import { recordPaymentFor, toPaise, validatePaymentInput } from "./payments-core.js";

/** The name of the single form field that carries the payment. */
export const INITIAL_PAYMENT_FIELD = "initial_payment";

/** Why the membership page warns after a save whose payment did not go through (read by the page). */
export const PAYMENT_NOT_RECORDED_NOTICE = "payment_not_recorded";

// Larger than any membership amount: the balance when the amount itself is not valid yet (that error is shown on the amount).
const NO_LIMIT_PAISE = Number.MAX_SAFE_INTEGER;

/**
 * Reads the payment out of the submitted form.
 *
 * The form submits the payment as one JSON field, and ONLY while "Record Payment Now" is on - so an absent field is
 * "no payment", and the membership is saved exactly as it always was. A field that is present but unreadable counts as
 * a payment with nothing in it (so the Admin is told what is missing) rather than as no payment.
 *
 * @param {string|null|undefined} raw - `formData.get("initial_payment")`
 * @returns {{ enabled: false } | { enabled: true, input: { paymentDate?: string, methods?: object[], issueTaxInvoice?: boolean } }}
 */
export function parseInitialPayment(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { enabled: false };
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { enabled: true, input: parsed };
  } catch {
    // fall through: present but unreadable
  }
  return { enabled: true, input: {} };
}

/**
 * Validates the payment against the membership it is about to be recorded with.
 *
 * @param {object} input - from `parseInitialPayment`.
 * @param {{ amount: string|number, today: string }} context - the membership amount as submitted, and the centre's today.
 * @returns {ReturnType<typeof validatePaymentInput>} - `errors` has the shape the Record Payment dialog shows.
 */
export function validateInitialPayment(input, { amount, today }) {
  const amountPaise = toPaise(String(amount ?? "").trim());
  return validatePaymentInput(input, { today, balancePaise: amountPaise ?? NO_LIMIT_PAISE });
}

/**
 * Creates a membership and, when there is one, records its first payment - in the order described at the top of the file.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {{ paymentDate: string, methods: object[], issueTaxInvoice: boolean|null }|null} args.payment - validated data
 *   from `validateInitialPayment`, or null for no payment.
 * @param {() => Promise<{ id: string } | { failure: object }>} args.create - inserts the membership (and maps its own errors).
 * @returns {Promise<{ failure: object } | { id: string, payment: null | { recorded: true, paymentId: string } | { recorded: false, error: string } }>}
 */
export async function createWithInitialPayment({ supabase, payment, create }) {
  const created = await create();
  if (!created || created.failure || !created.id) {
    return { failure: created?.failure ?? { error: "Could not save the membership. Try again." } };
  }

  if (!payment) return { id: created.id, payment: null };

  // The membership exists from here on, so nothing may escape: a refusal OR a thrown error (a dropped connection)
  // both become "not recorded", and the caller sends the Admin to the membership instead of an error page.
  let saved;
  try {
    saved = await recordPaymentFor(supabase, created.id, payment);
  } catch (error) {
    console.error(`[payments] Could not record the first payment of membership ${created.id}:`, error?.message);
    return { id: created.id, payment: { recorded: false, error: "Could not record the payment." } };
  }

  if (saved?.success) return { id: created.id, payment: { recorded: true, paymentId: saved.paymentId } };

  return { id: created.id, payment: { recorded: false, error: saved?.error ?? "Could not record the payment." } };
}
