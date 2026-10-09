"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString } from "@/lib/memberships/data";
import {
  editPaymentAmountFor,
  fetchPaymentsForMembership,
  recordPaymentFor,
  summarizePayments,
  toPaise,
  validatePaymentEdit,
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
 * @param {string} membershipId
 * @param {{ paymentDate: string, methods: { method: string, amount: string, referenceId?: string, notes?: string }[] }} input
 */
export async function recordMembershipPayment(membershipId, input) {
  await requireRole(ROLES.ADMIN);

  if (!membershipId) {
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
  if (membership.payment_status === "paid") {
    return { error: "This membership is already paid." };
  }

  const payments = await fetchPaymentsForMembership(supabase, membershipId);
  const { balancePaise } = summarizePayments(membership.amount, payments);

  const result = validatePaymentInput(input, { today: await todayDateString(), balancePaise });
  if (!result.success) {
    const { rows, ...fieldErrors } = result.errors;
    return { error: "Check the highlighted fields.", fieldErrors, rowErrors: rows };
  }

  const saved = await recordPaymentFor(supabase, membershipId, result.data);
  if (saved.success) {
    revalidatePath("/memberships");
    revalidatePath(`/memberships/${membershipId}`);
    revalidatePath(`/memberships/${membershipId}/receipt`);
    revalidatePath(`/students/${membership.student_id}`);
  }
  return saved;
}

/**
 * Edits a recorded payment's amount (V1 Tax Adjustment, Step 8): the new amount of each of its existing methods.
 * Only while no document exists for the payment; afterwards corrections go through Cancel and Reissue. The database
 * function `edit_payment_amount` checks everything again, records the edit in the audit trail and recomputes the
 * membership's payment status.
 *
 * @param {string} membershipId
 * @param {string} paymentId
 * @param {{ allocations: { id: string, amount: string }[] }} input
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
    return { error: "A document has been issued for this payment, so its amount cannot be edited. Correct the document instead." };
  }

  // What the membership still allows for this payment: its amount less every OTHER payment.
  const otherPaise = payments.filter((row) => row.id !== paymentId).reduce((sum, row) => sum + (toPaise(Number(row.amount).toFixed(2)) ?? 0), 0);
  const availablePaise = (toPaise(Number(membership.amount).toFixed(2)) ?? 0) - otherPaise;

  const result = validatePaymentEdit(input, { methods: payment.methods, availablePaise });
  if (!result.success) {
    const { rows, ...fieldErrors } = result.errors;
    return { error: "Check the highlighted fields.", fieldErrors, rowErrors: rows };
  }

  const saved = await editPaymentAmountFor(supabase, paymentId, result.data);
  if (saved.success) {
    revalidatePath("/memberships");
    revalidatePath(`/memberships/${membershipId}`);
    revalidatePath(`/memberships/${membershipId}/receipt`);
    revalidatePath(`/students/${membership.student_id}`);
  }
  return saved;
}
