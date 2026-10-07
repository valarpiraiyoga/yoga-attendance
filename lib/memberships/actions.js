"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateMembershipInput } from "@/lib/memberships/validation";
import { getCenterCurrency } from "@/lib/center-profile/settings";
import { matchKnownInvoiceError } from "@/lib/invoices/invoice-core";

/**
 * Server actions for Memberships.
 *
 * Mirrors lib/students/actions.js's and lib/enrollments/actions.js's shape:
 * `requireRole(ROLES.ADMIN)` runs first in every action — RLS also enforces
 * this at the database level (supabase/migrations/0008_memberships.sql).
 * Only the validated, whitelisted fields ever reach the database;
 * `membership_code` is never accepted as input (system-generated and
 * immutable), and cancellation is never set here — see `cancelMembership`.
 *
 * "A student cannot have overlapping non-cancelled membership periods"
 * (01-product.md §12) is enforced at two layers, per Phase 12's scope: an
 * application-level pre-check here (a clean, immediate field error for the
 * common case) and the authoritative `memberships_no_overlap_per_student`
 * exclusion constraint (0008_memberships.sql), whose violation is mapped to
 * the same field error — closing the race window the pre-check alone
 * cannot close.
 *
 * `createMembership` takes a leading `studentId` and `context` — bound at
 * the call site — because where it redirects to differs by entry point
 * (02-ux.md Flow 14 and its "Add Membership entry points" note):
 *   - "standalone" — Memberships list → Select Student: redirects to the
 *     new membership's own Details page.
 *   - "student"    — Student Details → Add Membership: redirects back to
 *     Student Details.
 *   - "guided"     — Add Student guided flow step 2: redirects into step 3
 *     (Add Batch Enrollment), matching createStudent's equivalent redirect.
 *   - "renewal"    — Renew Membership: redirects to the new membership's
 *     own Details page, same as "standalone".
 */

const MEMBERSHIPS_PATH = "/memberships";
const STUDENTS_PATH = "/students";

function membershipPath(id) {
  return `${MEMBERSHIPS_PATH}/${id}`;
}

function studentPath(studentId) {
  return `${STUDENTS_PATH}/${studentId}`;
}

// React resets every uncontrolled form field to its current `defaultValue`
// on every form-action submission, before the action even runs and
// regardless of outcome (react-dom's requestFormReset) — see
// StudentForm's comment.
function submittedValues(formData) {
  return {
    plan: formData.get("plan"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    amount: formData.get("amount"),
    payment_status: formData.get("payment_status"),
    notes: formData.get("notes"),
  };
}

const OVERLAP_MESSAGE = "This student already has a membership covering part of this period.";

// Postgres exclusion_violation — memberships_no_overlap_per_student
// (0008_memberships.sql). Not logged: this is an expected, user-actionable
// conflict, not a failure worth investigating, same treatment as
// lib/batches/actions.js's duplicate-code handling.
function isOverlapError(error) {
  return error.code === "23P01";
}

function overlapResult(formData) {
  return {
    error: "Check the highlighted fields.",
    fieldErrors: { start_date: OVERLAP_MESSAGE },
    values: submittedValues(formData),
  };
}

/**
 * Application-level overlap pre-check (see file comment for why this exists
 * alongside the database constraint). Mirrors the exclusion constraint's own
 * definition: non-cancelled memberships only, inclusive date bounds.
 *
 * @returns {Promise<boolean>} true if the given period overlaps an existing non-cancelled membership for this student.
 */
async function hasOverlappingMembership(supabase, studentId, startDate, endDate, excludeId) {
  let query = supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .is("cancelled_at", null)
    .lte("start_date", endDate)
    .gte("end_date", startDate);

  if (excludeId) {
    query = query.neq("id", excludeId);
  }

  const { count, error } = await query;

  if (error) {
    console.error(
      `[memberships] Could not check overlap for student ${studentId}:`,
      error.code,
      error.message
    );
    // Fail open on the pre-check — the exclusion constraint below remains
    // authoritative and will still reject a genuine overlap.
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * A save the database refused under an invoice rule (supabase/migrations/0026):
 * Paid -> Pending, or a payment-date change, after the membership's invoice was
 * issued; or an automatic invoice that could not be issued. The database owns
 * those rules — nothing here duplicates them — this only shows its own message
 * instead of the generic "Could not save". Anything else returns null and
 * keeps the existing handling.
 */
function invoiceRuleResult(error, formData) {
  const rule = matchKnownInvoiceError(error);
  if (!rule) return null;
  return { error: rule.error, fieldErrors: rule.fieldErrors, values: submittedValues(formData) };
}

function redirectAfterCreate(context, studentId, newId) {
  if (context === "student") {
    redirect(`${studentPath(studentId)}?success=membership_added`);
  }
  if (context === "guided") {
    redirect(`${studentPath(studentId)}/enrollments/new?guided=1`);
  }
  if (context === "renewal") {
    redirect(`${membershipPath(newId)}?success=renewed`);
  }
  redirect(`${membershipPath(newId)}?success=created`);
}

export async function createMembership(studentId, context, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!studentId) {
    return { error: "Select a student.", fieldErrors: { student_id: "Select a student." } };
  }

  const result = validateMembershipInput({
    plan: formData.get("plan"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    amount: formData.get("amount"),
    payment_status: formData.get("payment_status"),
    notes: formData.get("notes"),
  });

  if (!result.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.errors,
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();

  if (await hasOverlappingMembership(supabase, studentId, result.data.start_date, result.data.end_date)) {
    return overlapResult(formData);
  }

  const { data, error } = await supabase
    .from("memberships")
    // The membership records the currency it is priced in, so a later change
    // to the centre's currency never re-labels this amount (0024).
    .insert({ ...result.data, student_id: studentId, currency: await getCenterCurrency() })
    .select("id")
    .single();

  if (error) {
    if (isOverlapError(error)) {
      return overlapResult(formData);
    }
    const invoiceRule = invoiceRuleResult(error, formData);
    if (invoiceRule) return invoiceRule;
    console.error(`[memberships] Could not create membership for student ${studentId}:`, error.code, error.message);
    return { error: "Could not save the membership. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(MEMBERSHIPS_PATH);
  revalidatePath(studentPath(studentId));
  redirectAfterCreate(context, studentId, data.id);
}

export async function updateMembership(id, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update the membership. Try again." };
  }

  const result = validateMembershipInput({
    plan: formData.get("plan"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    amount: formData.get("amount"),
    payment_status: formData.get("payment_status"),
    notes: formData.get("notes"),
  });

  if (!result.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.errors,
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("memberships")
    .select("student_id")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: "Could not update the membership. Try again." };
  }

  if (
    await hasOverlappingMembership(
      supabase,
      existing.student_id,
      result.data.start_date,
      result.data.end_date,
      id
    )
  ) {
    return overlapResult(formData);
  }

  const { error } = await supabase.from("memberships").update(result.data).eq("id", id);

  if (error) {
    if (isOverlapError(error)) {
      return overlapResult(formData);
    }
    const invoiceRule = invoiceRuleResult(error, formData);
    if (invoiceRule) return invoiceRule;
    console.error(`[memberships] Could not update membership ${id}:`, error.code, error.message);
    return { error: "Could not update the membership. Try again.", values: submittedValues(formData) };
  }

  revalidatePath(MEMBERSHIPS_PATH);
  revalidatePath(membershipPath(id));
  revalidatePath(studentPath(existing.student_id));
  redirect(`${membershipPath(id)}?success=updated`);
}

/**
 * Cancels a membership (02-ux.md Flow 15: Review → Confirm → Save). Called
 * directly from a client component wrapped in `useTransition` — Next.js's
 * documented pattern for invoking a Server Action outside a form — matching
 * lib/students/actions.js's `setStudentStatus`.
 *
 * Retains the record; never deletes (01-product.md §12). Rejects an
 * already-cancelled membership rather than silently no-op'ing, so the UI
 * can surface a clear error if this is somehow invoked twice.
 */
export async function cancelMembership(id) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not cancel the membership. Try again." };
  }

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("memberships")
    .select("student_id, cancelled_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: "Could not cancel the membership. Try again." };
  }

  if (existing.cancelled_at) {
    return { error: "This membership is already cancelled." };
  }

  const { error } = await supabase
    .from("memberships")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error(`[memberships] Could not cancel membership ${id}:`, error.code, error.message);
    return { error: "Could not cancel the membership. Try again." };
  }

  revalidatePath(MEMBERSHIPS_PATH);
  revalidatePath(membershipPath(id));
  revalidatePath(studentPath(existing.student_id));
  return { success: "Membership cancelled successfully." };
}
