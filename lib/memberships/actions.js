"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { validateMembershipInput } from "@/lib/memberships/validation";
import { getCenterCurrency } from "@/lib/center-profile/settings";
import { matchKnownInvoiceError } from "@/lib/invoices/invoice-core";
import { matchKnownPaymentError } from "@/lib/memberships/payments-core";
import { todayDateString } from "@/lib/memberships/data";
import { changedStartBeforeJoinDateError, matchKnownJoinDateError, startBeforeJoinDateError } from "@/lib/students/join-date";
import { fetchPackageForPricing } from "@/lib/packages/service-core";
import {
  createPackageMembershipRecord,
  packageMembershipInputOf,
  preparePackageMembership,
} from "@/lib/packages/membership-creation";
import {
  createWithInitialPayment,
  INITIAL_PAYMENT_FIELD,
  parseInitialPayment,
  PAYMENT_NOT_RECORDED_NOTICE,
  validateInitialPayment,
} from "@/lib/memberships/initial-payment";

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
 *
 * Create and Renew may also record the membership's first payment ("Record
 * Payment Now", lib/memberships/initial-payment.js). It is validated before
 * the membership is written, and recorded once, after it, through the same
 * `record_membership_payment` function every payment uses. Without the
 * payment field the action is exactly what it was.
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
    kind: formData.get("kind"),
    plan: formData.get("plan"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    total_classes: formData.get("total_classes"),
    amount: formData.get("amount"),
    notes: formData.get("notes"),
  };
}

// The membership fields as the form submits them: a duration membership has a plan and an end date, a class-count
// membership (kind = "class_count") has a class total and an optional end date.
function membershipInputOf(formData, kind) {
  return {
    kind,
    plan: formData.get("plan"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
    total_classes: formData.get("total_classes"),
    amount: formData.get("amount"),
    notes: formData.get("notes"),
  };
}

// The database refusals a class-count edit can meet (supabase/migrations/0044): classes already recorded keep the
// membership's type, its student and its class total from contradicting them. The messages are the migration's own.
function classCountHistoryResult(error, formData) {
  if (error.code === "23514" && /class total cannot be less/i.test(error.message ?? "")) {
    const message = "The class total cannot be less than the classes already recorded.";
    return { error: "Check the highlighted fields.", fieldErrors: { total_classes: message }, values: submittedValues(formData) };
  }
  if (error.code === "55006" && /membership with recorded classes/i.test(error.message ?? "")) {
    return { error: error.message, values: submittedValues(formData) };
  }
  return null;
}

const PACKAGE_MEMBERSHIP_EDIT_MESSAGE =
  "The package, dates, fee and discounts of a package membership are changed in Edit Membership, as an audited correction.";

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
    // Only duration memberships exclude each other (migration 0042): a class-count membership never blocks one.
    .eq("kind", "duration")
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
  // The invoice rules (0026-0030) and the payment rules (0034) are the database refusals a membership save can meet.
  const rule = matchKnownInvoiceError(error) ?? matchKnownPaymentError(error);
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

  const result = validateMembershipInput(membershipInputOf(formData, formData.get("kind")));

  // The optional first payment, checked with the same rules as any payment - against this membership's amount,
  // which is wholly outstanding - BEFORE anything is written, so a payment the database would refuse never leaves
  // a membership behind. No payment field means no payment.
  const initialPayment = parseInitialPayment(formData.get(INITIAL_PAYMENT_FIELD));
  const paymentCheck = initialPayment.enabled
    ? validateInitialPayment(initialPayment.input, { amount: formData.get("amount"), today: await todayDateString() })
    : null;

  if (!result.success || (paymentCheck && !paymentCheck.success)) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: result.success ? {} : result.errors,
      ...(paymentCheck && !paymentCheck.success ? { paymentErrors: paymentCheck.errors } : {}),
      values: submittedValues(formData),
    };
  }

  const supabase = await createClient();

  // The start date cannot be before the student joined (migration 0051 refuses it again, whoever writes). Renewal comes here too.
  const { data: joiner } = await supabase.from("students").select("join_date").eq("id", studentId).maybeSingle();
  const joinDateError = startBeforeJoinDateError("membership", result.data.start_date, joiner?.join_date);
  if (joinDateError) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { start_date: joinDateError },
      values: submittedValues(formData),
    };
  }

  // Only duration memberships exclude each other: a class-count membership has no period to keep exclusive.
  if (
    result.data.kind !== "class_count" &&
    (await hasOverlappingMembership(supabase, studentId, result.data.start_date, result.data.end_date))
  ) {
    return overlapResult(formData);
  }

  const outcome = await createWithInitialPayment({
    supabase,
    payment: paymentCheck?.data ?? null,
    create: async () => {
      const { data, error } = await supabase
        .from("memberships")
        // The membership records the currency it is priced in, so a later change
        // to the centre's currency never re-labels this amount (0024). No payment status is sent: a new membership
        // is Pending (the column default) with its whole amount outstanding, until payments are recorded.
        .insert({ ...result.data, student_id: studentId, currency: await getCenterCurrency() })
        .select("id")
        .single();

      if (error) {
        if (isOverlapError(error)) {
          return { failure: overlapResult(formData) };
        }
        const joinRule = matchKnownJoinDateError(error);
        if (joinRule) {
          return {
            failure: { error: "Check the highlighted fields.", fieldErrors: { start_date: joinRule.error }, values: submittedValues(formData) },
          };
        }
        const invoiceRule = invoiceRuleResult(error, formData);
        if (invoiceRule) return { failure: invoiceRule };
        console.error(`[memberships] Could not create membership for student ${studentId}:`, error.code, error.message);
        return { failure: { error: "Could not save the membership. Try again.", values: submittedValues(formData) } };
      }

      return { id: data.id };
    },
  });

  if (outcome.failure) return outcome.failure;

  revalidatePath(MEMBERSHIPS_PATH);
  revalidatePath(studentPath(studentId));

  // The membership is saved, but its payment was not recorded. Nothing is guessed or repeated: the membership stays
  // Pending, and its own page - wherever the save came from - says so, so the Admin checks Payments before recording again.
  if (outcome.payment && !outcome.payment.recorded) {
    redirect(`${membershipPath(outcome.id)}?success=${context === "renewal" ? "renewed" : "created"}&notice=${PAYMENT_NOT_RECORDED_NOTICE}`);
  }

  redirectAfterCreate(context, studentId, outcome.id);
}

/**
 * Creates a package-linked membership (V1 Fee Structure, FS-6). The same shape as `createMembership` - bound to a student
 * and an entry point, redirecting the same way, with the optional first payment - but the membership is created by the
 * database function `create_membership_from_package` (migration 0048), which resolves the fee in effect on the start
 * date, calculates the end date and the discounts, and refuses what breaks the rules. What is validated here is for early
 * field errors and for checking a first payment against the fee the database is expected to resolve; it never prices.
 */
export async function createPackageMembership(studentId, context, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!studentId) {
    return { error: "Select a student.", fieldErrors: { student_id: "Select a student." } };
  }

  const supabase = await createClient();
  const raw = packageMembershipInputOf(formData);
  // The student's join date: a membership cannot start before it (checked here for an early answer; migration 0051 refuses it again).
  const { data: joiner } = await supabase.from("students").select("join_date").eq("id", studentId).maybeSingle();
  const pkg = raw.package_id ? await fetchPackageForPricing(supabase, String(raw.package_id).trim()) : null;

  const prepared = preparePackageMembership({
    raw,
    pkg,
    centreCurrency: await getCenterCurrency(),
    today: await todayDateString(),
    initialPaymentRaw: formData.get(INITIAL_PAYMENT_FIELD),
    joinDate: joiner?.join_date ?? null,
  });

  if (!prepared.success) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: prepared.errors,
      ...(prepared.paymentErrors ? { paymentErrors: prepared.paymentErrors } : {}),
      values: raw,
    };
  }

  const outcome = await createWithInitialPayment({
    supabase,
    payment: prepared.payment,
    create: () => createPackageMembershipRecord(supabase, studentId, prepared.data),
  });

  if (outcome.failure) return { ...outcome.failure, values: raw };

  revalidatePath(MEMBERSHIPS_PATH);
  revalidatePath(studentPath(studentId));

  // The membership is saved but its payment was not recorded: the same notice, and nothing guessed or repeated.
  if (outcome.payment && !outcome.payment.recorded) {
    redirect(`${membershipPath(outcome.id)}?success=${context === "renewal" ? "renewed" : "created"}&notice=${PAYMENT_NOT_RECORDED_NOTICE}`);
  }

  redirectAfterCreate(context, studentId, outcome.id);
}

export async function updateMembership(id, _prevState, formData) {
  await requireRole(ROLES.ADMIN);

  if (!id) {
    return { error: "Could not update the membership. Try again." };
  }

  const result = validateMembershipInput(membershipInputOf(formData, formData.get("kind")));

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
    .select("student_id, package_id, start_date, students(join_date)")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return { error: "Could not update the membership. Try again." };
  }

  // A package-linked membership's package, dates, fee and discounts are never rewritten through the ordinary Edit form
  // (the database guard refuses it as well); its notes and, as an audited correction, its package, price and dates change only through
  // Edit Membership (saveMembershipEdit, lib/memberships/corrections.js).
  if (existing.package_id) {
    return { error: PACKAGE_MEMBERSHIP_EDIT_MESSAGE, values: submittedValues(formData) };
  }

  // Only a CHANGED start date is judged against the join date, so an unrelated edit of a membership that already starts before it
  // (notes, amount) is never refused. The database refuses a changed start the same way.
  const joinDateError = changedStartBeforeJoinDateError("membership", {
    previousStart: existing.start_date,
    nextStart: result.data.start_date,
    joinDate: existing.students?.join_date,
  });
  if (joinDateError) {
    return {
      error: "Check the highlighted fields.",
      fieldErrors: { start_date: joinDateError },
      values: submittedValues(formData),
    };
  }

  // The form submits the membership's own kind (fixed at creation). If it were tampered with, the database refuses the
  // write: memberships_kind_matches_plan and memberships_total_classes_by_kind tie each kind to its plan and class total.
  const { kind: submittedKind, start_date, total_classes, amount, notes } = result.data;
  const isClassCount = submittedKind === "class_count";

  // Only duration memberships exclude each other: a class-count membership has no period to keep exclusive.
  if (
    !isClassCount &&
    (await hasOverlappingMembership(
      supabase,
      existing.student_id,
      result.data.start_date,
      result.data.end_date,
      id
    ))
  ) {
    return overlapResult(formData);
  }

  // A class-count membership never has its plan or kind written: both are fixed for its life. Nor its expiry (end_date): that
  // changes only through the audited expiry edit (edit_class_count_expiry, migration 0049), which the database enforces.
  if (isClassCount) {
    result.data = { start_date, total_classes, amount, notes };
  }

  // `result.data` carries no payment status: editing a membership never sends or resets it. The status follows
  // the recorded payments, and a membership marked Paid before payments existed keeps the status it has.
  const { error } = await supabase.from("memberships").update(result.data).eq("id", id);

  if (error) {
    if (isOverlapError(error)) {
      return overlapResult(formData);
    }
    const joinRule = matchKnownJoinDateError(error);
    if (joinRule) {
      return { error: "Check the highlighted fields.", fieldErrors: { start_date: joinRule.error }, values: submittedValues(formData) };
    }
    const historyRule = classCountHistoryResult(error, formData);
    if (historyRule) return historyRule;
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
