/**
 * What the Correct & Reissue screens need about one payment document (migration 0055) - READ ONLY. The document, its payment with
 * its methods, the membership's amount, the total of its OTHER payments (and so the balance the corrected payment may use - this
 * payment's own amount is not counted twice), and the CURRENT tax settings a replacement is issued under. It reads through the
 * caller's client (Admin only through row-level security) and writes nothing: the database function does every write.
 */

import { amountToPaise, availableBalancePaise, methodsInOrder, sumOtherPaymentsPaise } from "./document-correction.js";

/**
 * Takes the document ALREADY LOADED by the caller (`fetchInvoice`), so this file never imports the invoice core.
 * Null when the document is not a payment document of that membership.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} membershipId
 * @param {object|null} document - the invoice row, or null when it was not found.
 */
export async function readCorrectionContext(supabase, membershipId, document) {
  if (!document || document.membership_id !== membershipId || !document.payment_id) return null;

  const [paymentResult, membershipResult, paymentsResult, settingsResult] = await Promise.all([
    supabase
      .from("membership_payments")
      .select("id, membership_id, payment_date, amount, issue_tax_invoice, membership_payment_methods(position, method, amount, reference_id, notes)")
      .eq("id", document.payment_id)
      .maybeSingle(),
    supabase.from("memberships").select("id, amount, payment_status, currency").eq("id", membershipId).maybeSingle(),
    supabase.from("membership_payments").select("id, amount").eq("membership_id", membershipId),
    supabase.from("invoice_settings").select("tax_enabled, tax_name, tax_rate").eq("singleton", true).maybeSingle(),
  ]);

  for (const result of [paymentResult, membershipResult, paymentsResult, settingsResult]) {
    if (result.error) {
      console.error(`[invoices] Could not load the correction context of document ${document.id}:`, result.error.code, result.error.message);
      throw new Error("Could not load the document.");
    }
  }

  const payment = paymentResult.data;
  const membership = membershipResult.data;
  if (!payment || !membership || payment.membership_id !== membershipId) return null;

  const { membership_payment_methods: rawMethods, ...paymentFields } = payment;
  const membershipAmountPaise = amountToPaise(membership.amount);
  const otherPaymentsPaise = sumOtherPaymentsPaise(paymentsResult.data, payment.id);

  return {
    document,
    payment: { ...paymentFields, methods: methodsInOrder(rawMethods) },
    paymentAmountPaise: amountToPaise(payment.amount),
    membership,
    membershipAmountPaise,
    otherPaymentsPaise,
    availablePaise: availableBalancePaise(membershipAmountPaise, otherPaymentsPaise),
    settings: settingsResult.data ?? { tax_enabled: false, tax_name: null, tax_rate: null },
  };
}
