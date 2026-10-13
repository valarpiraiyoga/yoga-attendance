"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { todayDateString } from "@/lib/memberships/data";
import {
  cancelFeeEntryFor,
  correctFeeEntryFor,
  createPackageFor,
  editFeeEntryFor,
  fetchFeeEntryHead,
  fetchPackageHead,
  scheduleFeeEntryFor,
  setPackageStatusFor,
  updatePackageDetailsFor,
  updatePackageTermsFor,
  validateCancelInput,
  validateCorrectionInput,
  validateFeeInput,
  validatePackageDetailsInput,
  validatePackageInput,
  validatePackageTermsInput,
  validateStatusInput,
} from "@/lib/packages/service-core";

/**
 * Server actions for packages and their fees (V1 Fee Structure, FS-3). Each one requires an Admin, validates the input
 * with the rules of `lib/packages/service-core.js`, and calls ONE database function (migration 0047), which checks the
 * Admin role again, changes the data and writes the audit event in the same transaction. Like the payment actions, each is
 * called from a client component inside `useTransition` and returns `{ success, ... }` or
 * `{ error, fieldErrors? }`; nothing redirects.
 *
 * No screen uses them yet (Settings -> Packages & Fees is FS-4). Fee conflict detection arrives with FS-5.
 */

const NOT_FOUND = "Package not found.";
const CHECK_FIELDS = "Check the highlighted fields.";

function revalidatePackages(packageId) {
  revalidatePath("/settings/packages");
  if (packageId) revalidatePath(`/settings/packages/${packageId}`);
}

/** The first rejected field of a validation result, in the shape the screens read. */
function rejected(errors) {
  return { error: CHECK_FIELDS, fieldErrors: errors };
}

/**
 * Creates a package.
 *
 * @param {{ name: string, description?: string, kind: "duration"|"class_count", totalClasses?: string|number, options?: string[] }} input
 */
export async function createPackage(input) {
  await requireRole(ROLES.ADMIN);

  const result = validatePackageInput(input);
  if (!result.success) return rejected(result.errors);

  const saved = await createPackageFor(await createClient(), result.data);
  if (saved.success) revalidatePackages(saved.packageId);
  return saved;
}

/** Renames a package or changes its description. @param {string} packageId @param {{ name: string, description?: string }} input */
export async function updatePackageDetails(packageId, input) {
  await requireRole(ROLES.ADMIN);
  if (!packageId) return { error: NOT_FOUND };

  const result = validatePackageDetailsInput(input);
  if (!result.success) return rejected(result.errors);

  const saved = await updatePackageDetailsFor(await createClient(), packageId, result.data);
  if (saved.success) revalidatePackages(packageId);
  return saved;
}

/**
 * Changes a package's terms: the class allowance (class-count) or the offered options (duration). They apply to future
 * purchases only.
 *
 * @param {string} packageId
 * @param {{ totalClasses?: string|number, options?: string[], reason?: string }} input
 */
export async function updatePackageTerms(packageId, input) {
  await requireRole(ROLES.ADMIN);
  if (!packageId) return { error: NOT_FOUND };

  const supabase = await createClient();
  const head = await fetchPackageHead(supabase, packageId);
  if (!head) return { error: NOT_FOUND };

  const result = validatePackageTermsInput(head.kind, input);
  if (!result.success) return rejected(result.errors);

  const saved = await updatePackageTermsFor(supabase, packageId, head.kind, result.data);
  if (saved.success) revalidatePackages(packageId);
  return saved;
}

/** Activates or deactivates a package. @param {string} packageId @param {{ status: "active"|"inactive", reason?: string }} input */
export async function setPackageStatus(packageId, input) {
  await requireRole(ROLES.ADMIN);
  if (!packageId) return { error: NOT_FOUND };

  const result = validateStatusInput(input);
  if (!result.success) return rejected(result.errors);

  const saved = await setPackageStatusFor(await createClient(), packageId, result.data);
  if (saved.success) revalidatePackages(packageId);
  return saved;
}

/**
 * Schedules a fee entry: the monthly base fee of a duration package (with package discounts for Quarterly, Half Yearly and
 * Annual), or the price of a class-count package. The currency is the centre's, stamped by the database.
 *
 * @param {string} packageId
 * @param {{ effectiveFrom: string, amount: string|number, discounts?: { option: string, type: "fixed"|"percent", value: string|number }[], reason?: string }} input
 */
export async function scheduleFeeEntry(packageId, input) {
  await requireRole(ROLES.ADMIN);
  if (!packageId) return { error: NOT_FOUND };

  const supabase = await createClient();
  const head = await fetchPackageHead(supabase, packageId);
  if (!head) return { error: NOT_FOUND };

  const result = validateFeeInput(head.kind, input);
  if (!result.success) return rejected(result.errors);

  const saved = await scheduleFeeEntryFor(supabase, packageId, result.data);
  if (saved.success) revalidatePackages(packageId);
  return saved;
}

/** Edits a scheduled fee entry (one that has not taken effect). @param {string} entryId @param {object} input - as `scheduleFeeEntry`. */
export async function editFeeEntry(entryId, input) {
  await requireRole(ROLES.ADMIN);
  if (!entryId) return { error: "Fee entry not found." };

  const supabase = await createClient();
  const head = await fetchFeeEntryHead(supabase, entryId);
  if (!head) return { error: "Fee entry not found." };

  const result = validateFeeInput(head.package_kind, input, { today: await todayDateString(), requireFuture: true });
  if (!result.success) return rejected(result.errors);

  const saved = await editFeeEntryFor(supabase, entryId, result.data);
  if (saved.success) revalidatePackages(head.package_id);
  return saved;
}

/** Cancels a fee entry; a reason is required when it is in effect. @param {string} entryId @param {{ reason?: string }} input */
export async function cancelFeeEntry(entryId, input) {
  await requireRole(ROLES.ADMIN);
  if (!entryId) return { error: "Fee entry not found." };

  const supabase = await createClient();
  const head = await fetchFeeEntryHead(supabase, entryId);
  if (!head) return { error: "Fee entry not found." };

  const result = validateCancelInput(input);
  if (!result.success) return rejected(result.errors);

  const saved = await cancelFeeEntryFor(supabase, entryId, result.data);
  if (saved.success) revalidatePackages(head.package_id);
  return saved;
}

/**
 * Corrects the fee in effect: cancels it and appends a linked replacement with the corrected amount and discounts. A reason
 * is required.
 *
 * @param {string} entryId
 * @param {{ amount: string|number, discounts?: object[], reason: string }} input
 */
export async function correctFeeEntry(entryId, input) {
  await requireRole(ROLES.ADMIN);
  if (!entryId) return { error: "Fee entry not found." };

  const supabase = await createClient();
  const head = await fetchFeeEntryHead(supabase, entryId);
  if (!head) return { error: "Fee entry not found." };

  const result = validateCorrectionInput(head.package_kind, input);
  if (!result.success) return rejected(result.errors);

  const saved = await correctFeeEntryFor(supabase, entryId, result.data);
  if (saved.success) revalidatePackages(head.package_id);
  return saved;
}
