/**
 * Package and fee services (V1 Fee Structure, FS-3; migration 0047) - the pure rules and the database calls, with the
 * Supabase client passed in so they can be tested without a server. Nothing here writes a table directly: every change is
 * ONE database function (create_package, update_package_details, update_package_terms, set_package_status,
 * schedule_fee_entry, edit_fee_entry, cancel_fee_entry, correct_fee_entry), which checks the Admin role, locks the
 * package, changes the data and writes the audit event in the same transaction.
 *
 * The validators here give an Admin clear field errors before anything is sent; the database checks every rule again and is
 * the authority. They reuse the FS-1 rules (lib/packages/validation.js, duration.js) and the money helpers of
 * lib/memberships/payments-core.js. Amounts travel as strings with two decimals, never as floating-point numbers.
 *
 * Fee conflict detection is NOT here: it needs package-linked memberships (FS-5).
 */

import { fromPaise, toPaise } from "../memberships/payments-core.js";
import { DURATION_OPTIONS } from "./duration.js";
import { REASON_MAX_LENGTH, REASON_MIN_LENGTH, requiredReasonText, validateDiscountInput } from "./validation.js";

export const PACKAGE_KINDS = Object.freeze(["duration", "class_count"]);
export const PACKAGE_STATUSES = Object.freeze(["active", "inactive"]);

/** The duration options that can carry a package discount. Monthly never does; Custom uses a standard option's. */
export const DISCOUNTABLE_OPTIONS = Object.freeze(["quarterly", "half_yearly", "annual"]);

export const PACKAGE_NAME_MIN = 2;
export const PACKAGE_NAME_MAX = 100;
export const PACKAGE_DESCRIPTION_MAX = 500;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;
const MAX_INTEGER = 2147483647;
const MAX_AMOUNT_PAISE = 9999999999; // numeric(10,2): 99,999,999.99

const NAME_MESSAGE = `Enter a name of ${PACKAGE_NAME_MIN} to ${PACKAGE_NAME_MAX} characters.`;
const REASON_MESSAGE = `The reason must be ${REASON_MIN_LENGTH} to ${REASON_MAX_LENGTH} characters.`;

const cleanText = (value) => String(value ?? "").trim();
const characterCount = (text) => Array.from(text).length;
const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";

function isValidDateString(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ---- validators --------------------------------------------------------------------------------------

function parseName(value, errors) {
  const name = cleanText(value);
  const length = characterCount(name);
  if (length < PACKAGE_NAME_MIN || length > PACKAGE_NAME_MAX) errors.name = NAME_MESSAGE;
  return name;
}

function parseDescription(value, errors) {
  const description = cleanText(value);
  if (!description) return null;
  if (characterCount(description) > PACKAGE_DESCRIPTION_MAX) {
    errors.description = `The description can have at most ${PACKAGE_DESCRIPTION_MAX} characters.`;
  }
  return description;
}

function parseClassAllowance(value, errors) {
  const text = cleanText(value);
  if (!text) {
    errors.totalClasses = "Enter the number of classes, at least 1.";
    return null;
  }
  if (!WHOLE_NUMBER_PATTERN.test(text) || Number(text) < 1 || Number(text) > MAX_INTEGER) {
    errors.totalClasses = "Enter a whole number of classes, at least 1.";
    return null;
  }
  return Number(text);
}

function parseOptions(value, errors) {
  const list = Array.isArray(value) ? value.map((option) => cleanText(option)) : [];
  const options = [...new Set(list)].sort();
  if (options.length === 0) {
    errors.options = "Select at least one duration option.";
  } else if (options.some((option) => !DURATION_OPTIONS.includes(option))) {
    errors.options = "Select valid duration options.";
  }
  return options;
}

/** An optional reason: empty is null; otherwise 3 to 500 characters. */
function parseOptionalReason(value, errors) {
  const text = cleanText(value);
  if (!text) return null;
  const reason = requiredReasonText(text);
  if (reason === null) errors.reason = REASON_MESSAGE;
  return reason;
}

/** A required reason, with the message to show when it is missing. */
function parseRequiredReason(value, errors, missingMessage) {
  const text = cleanText(value);
  if (!text) {
    errors.reason = missingMessage;
    return null;
  }
  const reason = requiredReasonText(text);
  if (reason === null) errors.reason = REASON_MESSAGE;
  return reason;
}

function parseAmount(value, errors) {
  const paise = toPaise(cleanText(value));
  if (paise === null || paise <= 0 || paise > MAX_AMOUNT_PAISE) {
    errors.amount = "Enter an amount greater than 0, with at most two decimal places.";
    return null;
  }
  return fromPaise(paise);
}

/**
 * The package discounts as the database function takes them: [{ option, type, value }], value a string with two decimals.
 * A class-count package has none.
 */
function parseDiscounts(kind, value, errors) {
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) return [];

  if (kind === "class_count") {
    errors.discounts = "A class-count package has no package discounts.";
    return [];
  }

  const rows = [];
  const seen = new Set();
  for (const item of list) {
    const option = cleanText(item?.option);
    if (!DISCOUNTABLE_OPTIONS.includes(option)) {
      errors.discounts = "Package discounts apply to Quarterly, Half Yearly and Annual only.";
      return [];
    }
    if (seen.has(option)) {
      errors.discounts = "A duration option can have only one package discount.";
      return [];
    }
    seen.add(option);

    const discount = validateDiscountInput({ type: item?.type, value: item?.value });
    if (!discount.success) {
      errors.discounts = discount.errors.discount;
      return [];
    }
    rows.push({
      option,
      type: discount.data.type,
      value: discount.data.type === "fixed" ? fromPaise(discount.data.valuePaise) : (discount.data.basisPoints / 100).toFixed(2),
    });
  }
  return rows;
}

const ok = (data) => ({ success: true, data });
const fail = (errors) => ({ success: false, errors });

/**
 * A new package.
 *
 * @param {{ name?: unknown, description?: unknown, kind?: unknown, totalClasses?: unknown, options?: unknown }} [input]
 */
export function validatePackageInput(input = {}) {
  const errors = {};
  const name = parseName(input.name, errors);
  const description = parseDescription(input.description, errors);
  const kind = cleanText(input.kind);

  let totalClasses = null;
  let options = [];

  if (kind === "class_count") {
    totalClasses = parseClassAllowance(input.totalClasses, errors);
    if (Array.isArray(input.options) && input.options.length > 0) errors.options = "A class-count package has no duration options.";
  } else if (kind === "duration") {
    if (hasValue(input.totalClasses)) errors.totalClasses = "A duration package has no class allowance.";
    options = parseOptions(input.options, errors);
  } else {
    errors.kind = "Select a valid package type.";
  }

  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ name, description, kind, totalClasses, options });
}

/** A package's name and description. */
export function validatePackageDetailsInput(input = {}) {
  const errors = {};
  const name = parseName(input.name, errors);
  const description = parseDescription(input.description, errors);
  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ name, description });
}

/**
 * A package's terms: the class allowance of a class-count package, or the offered options of a duration package. They
 * apply to future purchases only. `kind` is the package's own type.
 */
export function validatePackageTermsInput(kind, input = {}) {
  const errors = {};
  let totalClasses = null;
  let options = [];

  if (kind === "class_count") {
    totalClasses = parseClassAllowance(input.totalClasses, errors);
    if (Array.isArray(input.options) && input.options.length > 0) errors.options = "A class-count package has no duration options.";
  } else if (kind === "duration") {
    if (hasValue(input.totalClasses)) errors.totalClasses = "A duration package has no class allowance.";
    options = parseOptions(input.options, errors);
  } else {
    errors.kind = "Select a valid package type.";
  }

  const reason = parseOptionalReason(input.reason, errors);
  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ totalClasses, options, reason });
}

/** Activating or deactivating a package, with an optional reason. */
export function validateStatusInput(input = {}) {
  const errors = {};
  const status = cleanText(input.status);
  if (!PACKAGE_STATUSES.includes(status)) errors.status = "Select a valid status.";
  const reason = parseOptionalReason(input.reason, errors);
  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ status, reason });
}

/**
 * A fee entry to schedule, or a scheduled one to edit. `kind` is the package's own type. When `requireFuture` is set (an
 * edit) the date must be after `today`: a scheduled fee never becomes a fee in effect through an edit.
 *
 * @param {string} kind
 * @param {{ effectiveFrom?: unknown, amount?: unknown, discounts?: unknown, reason?: unknown }} [input]
 * @param {{ today?: string, requireFuture?: boolean }} [options]
 */
export function validateFeeInput(kind, input = {}, { today, requireFuture = false } = {}) {
  const errors = {};

  if (!PACKAGE_KINDS.includes(kind)) errors.kind = "Select a valid package type.";

  const effectiveFrom = cleanText(input.effectiveFrom);
  if (!isValidDateString(effectiveFrom)) {
    errors.effectiveFrom = "Enter the date the fee takes effect.";
  } else if (requireFuture && today && effectiveFrom <= today) {
    errors.effectiveFrom = "A scheduled fee must take effect after today.";
  }

  const amount = parseAmount(input.amount, errors);
  const discounts = parseDiscounts(kind, input.discounts, errors);
  const reason = parseOptionalReason(input.reason, errors);

  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ effectiveFrom, amount, discounts, reason });
}

/** Cancelling a fee entry. A reason is optional here; the database requires one when the fee is in effect. */
export function validateCancelInput(input = {}) {
  const errors = {};
  const reason = parseOptionalReason(input.reason, errors);
  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ reason });
}

/** Correcting the fee in effect: the corrected amount and discounts, and a REQUIRED reason. */
export function validateCorrectionInput(kind, input = {}) {
  const errors = {};

  if (!PACKAGE_KINDS.includes(kind)) errors.kind = "Select a valid package type.";

  const amount = parseAmount(input.amount, errors);
  const discounts = parseDiscounts(kind, input.discounts, errors);
  const reason = parseRequiredReason(input.reason, errors, "Enter the reason for the correction.");

  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ amount, discounts, reason });
}

// ---- how a fee entry reads ---------------------------------------------------------------------------

/**
 * Where a fee entry stands on a day: `cancelled`, `scheduled` (not yet in effect) or `in_effect` (on or after its date,
 * today included). The same rule 0046's guards and 0047's functions apply with the centre's date.
 *
 * @param {{ effective_from: string, cancelled_at?: string|null }} entry
 * @param {string} today - "YYYY-MM-DD" at the centre.
 */
export function feeEntryStatus(entry, today) {
  if (entry.cancelled_at) return "cancelled";
  return entry.effective_from > today ? "scheduled" : "in_effect";
}

// ---- database errors ---------------------------------------------------------------------------------

// The database's own user-facing messages (migrations 0046 and 0047), each with the field it belongs to.
const KNOWN_ERRORS = [
  ["42501", /^Not authorized\.$/, null, "You do not have permission to manage packages."],
  ["P0002", /^Package not found\.$/, null, "Package not found."],
  ["P0002", /^Fee entry not found\.$/, null, "Fee entry not found."],
  ["23505", /packages_name_unique/, "name", "A package with this name already exists. Names ignore case and include deactivated packages."],
  ["23505", /package_fee_entries_package_date_unique/, "effectiveFrom", "This package already has a fee taking effect on that date."],
  ["23514", /packages_name_valid/, "name", NAME_MESSAGE],
  ["23514", /packages_description_valid/, "description", `The description can have at most ${PACKAGE_DESCRIPTION_MAX} characters.`],
  ["22023", /^Enter the package name\.$/, "name", NAME_MESSAGE],
  ["22023", /^Select a valid package type\.$/, "kind", "Select a valid package type."],
  ["22023", /^Enter the number of classes, at least 1\.$/, "totalClasses", "Enter the number of classes, at least 1."],
  ["22023", /^A class-count package has no duration options\.$/, "options", "A class-count package has no duration options."],
  ["22023", /^A duration package has no class allowance\.$/, "totalClasses", "A duration package has no class allowance."],
  ["22023", /^Select at least one duration option\.$/, "options", "Select at least one duration option."],
  ["22023", /^Select valid duration options\.$/, "options", "Select valid duration options."],
  ["22023", /^Select a valid status\.$/, "status", "Select a valid status."],
  ["22023", /^The reason must be 3 to 500 characters\.$/, "reason", REASON_MESSAGE],
  ["22023", /^Enter the date the fee takes effect\.$/, "effectiveFrom", "Enter the date the fee takes effect."],
  ["22023", /^Enter an amount greater than 0, with at most two decimal places\.$/, "amount", "Enter an amount greater than 0, with at most two decimal places."],
  ["22023", /^A scheduled fee must take effect after today\./, "effectiveFrom", "A scheduled fee must take effect after today. To change the fee in effect, correct it."],
  ["22023", /^Enter the reason for cancelling a fee that is in effect\.$/, "reason", "Enter the reason for cancelling a fee that is in effect."],
  ["22023", /^Enter the reason for the correction\.$/, "reason", "Enter the reason for the correction."],
  ["22023", /^The corrected fee is the same as the fee in effect\.$/, "amount", "The corrected fee is the same as the fee in effect. Change the amount or a discount."],
  ["22023", /^(Package discounts|Each package discount|A duration option can have|Select a valid discount|Enter a discount|A class-count package has no package discounts)/, "discounts", null],
  ["55006", /^A cancelled fee entry cannot be (changed|corrected)\.$/, null, "A cancelled fee cannot be changed. Schedule a new one instead."],
  ["55006", /^This fee entry is already cancelled\.$/, null, "This fee is already cancelled."],
  ["55006", /^A fee entry in effect cannot be edited\./, null, "A fee in effect cannot be edited. Correct it instead."],
  ["55006", /^A fee that has not taken effect is edited, not corrected\.$/, null, "A fee that has not taken effect is edited, not corrected."],
  ["55000", /^The centre currency is not set\.$/, null, "The centre currency is not set. Set it in Center Profile first."],
];

/**
 * The application result for a database error ONLY IF it is one of the package rules' own messages, else null (the caller
 * keeps its own handling for everything else). A rule whose message is shown as the database wrote it has `null` as its
 * message here.
 *
 * @param {{ code?: string, message?: string }|null|undefined} error
 * @returns {{ error: string, fieldErrors?: Record<string, string>, code: string }|null}
 */
export function matchKnownPackageError(error) {
  const code = error?.code ?? null;
  if (!code) return null;
  const text = error?.message ?? "";
  for (const [knownCode, pattern, field, message] of KNOWN_ERRORS) {
    if (code === knownCode && pattern.test(text)) {
      const shown = message ?? text;
      return field ? { error: shown, fieldErrors: { [field]: shown }, code } : { error: shown, code };
    }
  }
  return null;
}

// ---- database calls ----------------------------------------------------------------------------------

async function callPackageFunction(supabase, name, params, failureMessage) {
  const { data, error } = await supabase.rpc(name, params);

  if (error) {
    const known = matchKnownPackageError(error);
    if (known) return known;
    console.error(`[packages] ${name} failed:`, error.code, error.message);
    return { error: failureMessage };
  }

  return { success: true, data };
}

/** Creates a package. @param {object} data - from `validatePackageInput`. */
export async function createPackageFor(supabase, data) {
  const result = await callPackageFunction(supabase, "create_package", {
    p_name: data.name,
    p_description: data.description,
    p_kind: data.kind,
    p_total_classes: data.totalClasses,
    p_options: data.kind === "duration" ? data.options : null,
  }, "Could not create the package. Try again.");
  return result.success ? { success: true, packageId: result.data } : result;
}

/** Renames a package or changes its description. @param {object} data - from `validatePackageDetailsInput`. */
export async function updatePackageDetailsFor(supabase, packageId, data) {
  return callPackageFunction(supabase, "update_package_details", {
    p_package_id: packageId,
    p_name: data.name,
    p_description: data.description,
  }, "Could not save the package. Try again.");
}

/** Changes a package's terms (future purchases only). @param {object} data - from `validatePackageTermsInput`. */
export async function updatePackageTermsFor(supabase, packageId, kind, data) {
  return callPackageFunction(supabase, "update_package_terms", {
    p_package_id: packageId,
    p_total_classes: kind === "class_count" ? data.totalClasses : null,
    p_options: kind === "duration" ? data.options : null,
    p_reason: data.reason,
  }, "Could not save the package terms. Try again.");
}

/** Activates or deactivates a package. @param {object} data - from `validateStatusInput`. */
export async function setPackageStatusFor(supabase, packageId, data) {
  return callPackageFunction(supabase, "set_package_status", {
    p_package_id: packageId,
    p_status: data.status,
    p_reason: data.reason,
  }, "Could not change the package status. Try again.");
}

/** Schedules a fee entry. @param {object} data - from `validateFeeInput`. */
export async function scheduleFeeEntryFor(supabase, packageId, data) {
  const result = await callPackageFunction(supabase, "schedule_fee_entry", {
    p_package_id: packageId,
    p_effective_from: data.effectiveFrom,
    p_amount: data.amount,
    p_discounts: data.discounts,
    p_reason: data.reason,
  }, "Could not schedule the fee. Try again.");
  return result.success ? { success: true, entryId: result.data } : result;
}

/** Edits a scheduled fee entry. @param {object} data - from `validateFeeInput` with `requireFuture`. */
export async function editFeeEntryFor(supabase, entryId, data) {
  return callPackageFunction(supabase, "edit_fee_entry", {
    p_entry_id: entryId,
    p_effective_from: data.effectiveFrom,
    p_amount: data.amount,
    p_discounts: data.discounts,
    p_reason: data.reason,
  }, "Could not save the fee. Try again.");
}

/** Cancels a fee entry. @param {object} data - from `validateCancelInput`. */
export async function cancelFeeEntryFor(supabase, entryId, data) {
  return callPackageFunction(supabase, "cancel_fee_entry", {
    p_entry_id: entryId,
    p_reason: data.reason,
  }, "Could not cancel the fee. Try again.");
}

/** Corrects the fee in effect; returns the replacement's id. @param {object} data - from `validateCorrectionInput`. */
export async function correctFeeEntryFor(supabase, entryId, data) {
  const result = await callPackageFunction(supabase, "correct_fee_entry", {
    p_entry_id: entryId,
    p_amount: data.amount,
    p_discounts: data.discounts,
    p_reason: data.reason,
  }, "Could not correct the fee. Try again.");
  return result.success ? { success: true, entryId: result.data } : result;
}

// ---- reads (Admin only: row-level security allows only an Admin to read these tables) -----------------

const PACKAGE_BASE_COLUMNS =
  "id, name, description, kind, total_classes, status, created_at, updated_at, package_duration_options(duration_option)";

// The list also needs each package's fee entries, to show the fee in effect and the next scheduled one.
const PACKAGE_LIST_COLUMNS =
  `${PACKAGE_BASE_COLUMNS}, package_fee_entries(id, effective_from, currency, monthly_fee, price, cancelled_at)`;

const PACKAGE_DETAIL_COLUMNS =
  `${PACKAGE_BASE_COLUMNS}, ` +
  "package_fee_entries(id, effective_from, currency, monthly_fee, price, corrects_entry_id, cancelled_at, cancelled_by, created_at, created_by, " +
  "package_fee_entry_discounts(duration_option, discount_type, fixed_amount, percent_value)), " +
  "package_events(id, fee_entry_id, event_type, occurred_at, actor, reason, before_state, after_state)";

/** Every package, by name, with its offered options. */
export async function fetchPackages(supabase) {
  const { data, error } = await supabase.from("packages").select(PACKAGE_LIST_COLUMNS).order("name", { ascending: true });
  if (error) {
    console.error("[packages] Could not list packages:", error.code, error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    ...row,
    options: (row.package_duration_options ?? []).map((option) => option.duration_option).sort(),
  }));
}

/**
 * One package with its options, its fee entries (newest effective date first, each with its discounts) and its audit
 * events (newest first), or null.
 */
export async function fetchPackage(supabase, packageId) {
  const { data, error } = await supabase.from("packages").select(PACKAGE_DETAIL_COLUMNS).eq("id", packageId).maybeSingle();
  if (error) {
    console.error(`[packages] Could not read package ${packageId}:`, error.code, error.message);
    return null;
  }
  if (!data) return null;

  return {
    ...data,
    options: (data.package_duration_options ?? []).map((option) => option.duration_option).sort(),
    feeEntries: [...(data.package_fee_entries ?? [])].sort(
      (a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at)
    ),
    events: [...(data.package_events ?? [])].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
  };
}

/** What the actions need to know about a package before validating: its type. Null when it does not exist. */
export async function fetchPackageHead(supabase, packageId) {
  const { data } = await supabase.from("packages").select("id, kind, status").eq("id", packageId).maybeSingle();
  return data ?? null;
}

/** What the actions need to know about a fee entry: its package type. Null when it does not exist. */
export async function fetchFeeEntryHead(supabase, entryId) {
  const { data } = await supabase
    .from("package_fee_entries")
    .select("id, package_id, package_kind, effective_from, cancelled_at")
    .eq("id", entryId)
    .maybeSingle();
  return data ?? null;
}
