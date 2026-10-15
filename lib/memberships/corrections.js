"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { fetchPackageForPricing } from "@/lib/packages/service-core";
import { validateMembershipNotes } from "@/lib/packages/membership-creation";
import {
  CORRECTION_FAILED_MESSAGE,
  correctionRpcParams,
  currentTermsOf,
  isUuid,
  matchCorrectionError,
  parseConfirmedFee,
  previewOf,
  protectedTermsChanged,
  validateCorrectionInput,
  validateCorrectionReason,
} from "@/lib/memberships/correction-core";

/**
 * Edit Membership of a package-linked membership (V1 Fee Structure, FS-8; migration 0050): ONE workflow, Admin only, checked again
 * by the database.
 *
 * What is saved depends on what changed - decided HERE from the stored membership, never from the screen:
 *   - only the notes (or nothing protected): an ordinary save of the notes. No reason and no price confirmation are asked for.
 *   - a protected term (package, duration, start date, pricing mode, custom fee, individual discount): a CORRECTION. The database
 *     (\`correct_membership_terms\`) prices it exactly as a new membership is priced, refuses a final fee that is not above 0 or is
 *     below the payments recorded, requires the revised final fee to be confirmed and a reason, changes no payment and no issued
 *     document, recalculates the payment status, and writes the audit row. Nothing here updates a protected column: the database
 *     guard (0048-0050) refuses every direct UPDATE of one.
 */

// Validates the submitted fields against the chosen package's type. Returns the RPC arguments or the failure to hand back.
async function prepare(supabase, membershipId, rawInput) {
  const packageId = String(rawInput?.package_id ?? "");
  const pkg = isUuid(packageId) ? await fetchPackageForPricing(supabase, packageId) : null;

  const result = validateCorrectionInput(rawInput ?? {}, pkg?.kind ?? null);
  if (!result.success) {
    return { failure: { error: "Check the highlighted fields.", fieldErrors: result.errors } };
  }

  return { params: correctionRpcParams(membershipId, result.data) };
}

/**
 * The revised price and terms of a change of protected terms, written nowhere: what the Admin reviews before saving. The database
 * refuses here exactly what the save would refuse (a fee at or below 0, below the payments recorded, a start date that does not
 * fit, nothing changing).
 *
 * @param {string} membershipId
 * @param {Record<string, string>} rawInput - the fields of \`CORRECTION_FIELDS\`, as strings.
 * @returns {Promise<{ success: true, preview: object } | { error: string, fieldErrors?: Record<string, string> }>}
 */
export async function previewMembershipCorrection(membershipId, rawInput) {
  await requireRole(ROLES.ADMIN);
  if (!isUuid(membershipId)) return { error: CORRECTION_FAILED_MESSAGE };

  const supabase = await createClient();
  const prepared = await prepare(supabase, membershipId, rawInput);
  if (prepared.failure) return prepared.failure;

  const { data, error } = await supabase.rpc("preview_membership_correction", prepared.params);
  if (error) {
    const known = matchCorrectionError(error);
    if (known) return known;
    console.error(`[memberships] Could not preview the correction of ${membershipId}:`, error.code, error.message);
    return { error: CORRECTION_FAILED_MESSAGE };
  }

  return { success: true, preview: previewOf(data) };
}

const STORED_COLUMNS =
  "id, student_id, package_id, kind, plan, duration_months, start_date, amount, pricing_mode, individual_discount_type, individual_discount_value, " +
  "individual_discount_reason_code, individual_discount_note, custom_fee_reason, notes, cancelled_at";

/**
 * Saves Edit Membership for a package-linked membership.
 *
 * @param {string} membershipId
 * @param {Record<string, string>} rawInput - the fields of \`CORRECTION_FIELDS\`, as strings (the current terms when none changed).
 * @param {{ notes: string, confirmedFee?: string|number|null, reason?: string|null }} options - the notes as submitted; and, only when
 *   a protected term changed, the revised final fee the Admin confirmed and the reason of the correction.
 * @returns {Promise<{ success: true, corrected: boolean } | { error: string, fieldErrors?: Record<string, string>, corrected?: boolean }>}
 */
export async function saveMembershipEdit(membershipId, rawInput, options = {}) {
  await requireRole(ROLES.ADMIN);
  if (!isUuid(membershipId)) return { error: CORRECTION_FAILED_MESSAGE };

  const notes = validateMembershipNotes(options.notes);
  if (!notes.success) return { error: "Check the highlighted fields.", fieldErrors: notes.errors };

  const supabase = await createClient();
  const { data: stored, error: readError } = await supabase.from("memberships").select(STORED_COLUMNS).eq("id", membershipId).single();
  if (readError || !stored || !stored.package_id) {
    return { error: CORRECTION_FAILED_MESSAGE };
  }

  // The server decides whether this is a correction, from what is stored: a screen that says "nothing protected changed" cannot
  // make a protected change an ordinary save.
  const corrected = protectedTermsChanged(currentTermsOf(stored), rawInput ?? {});

  if (corrected) {
    if (stored.cancelled_at) {
      return { error: "A cancelled membership's package, price and dates cannot be changed. Only its notes can." };
    }

    const reason = validateCorrectionReason(options.reason);
    if (!reason.success) return { error: reason.error, fieldErrors: { reason: reason.error } };

    const confirmed = parseConfirmedFee(options.confirmedFee);
    if (confirmed === null) {
      const message = "Review the revised price and confirm the final fee before saving.";
      return { error: message, fieldErrors: { confirm: message } };
    }

    const prepared = await prepare(supabase, membershipId, rawInput);
    if (prepared.failure) return prepared.failure;

    const { error } = await supabase.rpc("correct_membership_terms", {
      ...prepared.params,
      p_confirmed_fee: confirmed,
      p_reason: reason.data,
    });
    if (error) {
      const known = matchCorrectionError(error);
      if (known) return known;
      console.error(`[memberships] Could not correct ${membershipId}:`, error.code, error.message);
      return { error: CORRECTION_FAILED_MESSAGE };
    }
  }

  // The notes: an ordinary update of a column the database guard leaves free (it refuses every protected column).
  if ((stored.notes ?? null) !== notes.data) {
    const { error } = await supabase.from("memberships").update({ notes: notes.data }).eq("id", membershipId);
    if (error) {
      console.error(`[memberships] Could not update the notes of membership ${membershipId}:`, error.code, error.message);
      revalidatePath(`/memberships/${membershipId}`);
      return {
        error: corrected
          ? "The terms were corrected, but the notes could not be saved. Edit the membership again to save them."
          : "Could not update the membership. Try again.",
        corrected,
      };
    }
  }

  revalidatePath("/memberships");
  revalidatePath(`/memberships/${membershipId}`);
  revalidatePath(`/students/${stored.student_id}`);

  return { success: true, corrected };
}
