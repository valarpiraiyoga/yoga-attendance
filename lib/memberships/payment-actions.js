"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString } from "@/lib/memberships/data";
import {
  checkPaymentToRecord,
  editPaymentFor,
  fetchPaymentsForMembership,
  isRecordedPaymentRequest,
  recordPaymentFor,
  REQUEST_ID_PATTERN,
  summarizePayments,
  toPaise,
  validatePaymentInput,
} from "@/lib/memberships/payments-core";

/**
 * Records a payment against a membership (V1 Tax Adjustment, Step 2): one or more payment methods,
 * within the outstanding balance. Called from the Record Payment dialog inside `useTransition`, like
 * the invoice actions, so it returns `{ success }` or `{ error, fieldErrors?, rowErrors? }`.
 *
 * The database function `record_membership_payment` is the authority: it checks the Admin role, the
 * balance and the totals again and sets the membership's payment status from its payments.
 *
 * `requestId` makes the call safe to repeat (0065): a retry of a submission whose answer was lost returns the payment it
 * already recorded instead of recording another. The checks here must not stand in the way of such a retry - the payment
 * it repeats already counts against the balance, and may have made the membership Paid - so when a check would refuse,
 * a request ID that has already recorded a payment goes on to the database, which replays it or refuses it as a
 * different payment (23505). Every other check (date, methods, amounts) still applies to it.
 *
 * @param {string} membershipId
 * @param {{ paymentDate: string, methods: { method: string, amount: string, referenceId?: string, notes?: string }[] }} input
 * @param {string|null} [requestId] - one per submission, kept by the caller until the request has been answered for good.
 */
export async function recordMembershipPayment(membershipId, input, requestId = null) {
  await requireRole(ROLES.ADMIN);

  if (!membershipId || (requestId !== null && !REQUEST_ID_PATTERN.test(String(requestId)))) {
    return { error: "Could not record the payment. Try again." };
  }

  const supabase = await createClient();

  const { data: membership, error } = await supabase
    .from("memberships")
    .select("id, student_id, amount, payment_status")
    .eq("id", membershipId)
    .maybeSingle();

  if (error || !membership) {
    return { error: "Membership not found." };
  }

  const paid = membership.payment_status === "paid";
  const balancePaise = paid ? 0 : summarizePayments(membership.amount, await fetchPaymentsForMembership(supabase, membershipId)).balancePaise;

  const result = await checkPaymentToRecord(input, {
    today: await todayDateString(),
    paid,
    balancePaise,
    isRecordedRequest: async () => Boolean(requestId) && (await isRecordedPaymentRequest(supabase, requestId)),
  });
  if (result.alreadyPaid) {
    return { error: "This membership is already paid." };
  }
  if (!result.success) {
    const { rows, ...fieldErrors } = result.errors;
    return { error: "Check the highlighted fields.", fieldErrors, rowErrors: rows };
  }

  const saved = await recordPaymentFor(supabase, membershipId, result.data, requestId);
  // A request ID already used with other details means an earlier submission WAS recorded: refresh the pages too, so
  // the Admin checking the membership's payments sees it.
  if (saved.success || saved.code === "23505") {
    revalidatePath("/memberships");
    revalidatePath(`/memberships/${membershipId}`);
    revalidatePath(`/memberships/${membershipId}/receipt`);
    revalidatePath(`/students/${membership.student_id}`);
  }
  return saved;
}

/**
 * Edits a recorded payment: its date and its methods (type, amount, reference and notes; changed, added or removed).
 * Only while no document exists for the payment; afterwards corrections go through Cancel and Reissue. The input is
 * validated by `validatePaymentInput`, exactly as when recording, against what the membership still allows once this
 * payment's own previous amount is set aside. The database function `edit_payment` (0040) checks everything again,
 * replaces the methods, date and amount in ONE transaction - so nothing is half-saved - records the edit in the audit
 * trail and recomputes the membership's payment status.
 *
 * @param {string} membershipId
 * @param {string} paymentId
 * @param {{ paymentDate: string, methods: { method: string, amount: string, referenceId?: string, notes?: string }[] }} input
 */
export async function editMembershipPayment(membershipId, paymentId, input) {
  await requireRole(ROLES.ADMIN);

  if (!membershipId || !paymentId) {
    return { error: "Could not edit the payment. Try again." };
  }

  const supabase = await createClient();

  const { data: membership, error } = await supabase
    .from("memberships")
    .select("id, student_id, amount")
    .eq("id", membershipId)
    .maybeSingle();

  if (error || !membership) {
    return { error: "Membership not found." };
  }

  const payments = await fetchPaymentsForMembership(supabase, membershipId);
  const payment = payments.find((row) => row.id === paymentId);
  if (!payment) {
    return { error: "Payment not found." };
  }
  if (!payment.editable) {
    return { error: "A document has been issued for this payment, so it cannot be edited. Correct the document instead." };
  }

  // What the membership still allows for this payment: its amount less every OTHER payment.
  const otherPaise = payments.filter((row) => row.id !== paymentId).reduce((sum, row) => sum + (toPaise(Number(row.amount).toFixed(2)) ?? 0), 0);
  const availablePaise = (toPaise(Number(membership.amount).toFixed(2)) ?? 0) - otherPaise;

  const result = validatePaymentInput(input, { today: await todayDateString(), balancePaise: availablePaise });
  if (!result.success) {
    const { rows, ...fieldErrors } = result.errors;
    return { error: "Check the highlighted fields.", fieldErrors, rowErrors: rows };
  }

  const saved = await editPaymentFor(supabase, paymentId, result.data);
  if (saved.success) {
    revalidatePath("/memberships");
    revalidatePath(`/memberships/${membershipId}`);
    revalidatePath(`/memberships/${membershipId}/receipt`);
    revalidatePath(`/students/${membership.student_id}`);
  }
  return saved;
}
