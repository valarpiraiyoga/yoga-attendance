/**
 * Validation for the Batch form fields (Batches).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project. Each validator both checks and normalizes: callers get back
 * trimmed/normalized values ready to write to the database, never the raw
 * form input.
 */

const MAX_NAME_LENGTH = 100;
const MAX_CODE_LENGTH = 20;
const MAX_CATEGORY_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 500;

export const BATCH_STATUSES = ["active", "inactive"];

/**
 * Validates the editable Batch fields shared by create and update: name,
 * code, category, description. Status is deliberately excluded — it is
 * only ever changed via the Edit form's Status switch, validated separately
 * by `validateBatchStatus`.
 *
 * @param {{ name?: unknown, code?: unknown, category?: unknown, description?: unknown }} input
 * @returns {{ success: true, data: { name: string, code: string, category: string|null, description: string|null } }
 *         | { success: false, errors: Record<string, string> }}
 */
export function validateBatchInput({ name, code, category, description } = {}) {
  const errors = {};

  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) {
    errors.name = "Batch name is required.";
  } else if (trimmedName.length > MAX_NAME_LENGTH) {
    errors.name = `Batch name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  // Uppercased before the length check so the stored value and the
  // validated value are the same thing (01-product.md §12: "codes are
  // normalized to uppercase").
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  if (!normalizedCode) {
    errors.code = "Short code is required.";
  } else if (normalizedCode.length > MAX_CODE_LENGTH) {
    errors.code = `Short code must be ${MAX_CODE_LENGTH} characters or fewer.`;
  }

  const trimmedCategory = String(category ?? "").trim();
  if (trimmedCategory.length > MAX_CATEGORY_LENGTH) {
    errors.category = `Category must be ${MAX_CATEGORY_LENGTH} characters or fewer.`;
  }

  const trimmedDescription = String(description ?? "").trim();
  if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      name: trimmedName,
      code: normalizedCode,
      category: trimmedCategory || null,
      description: trimmedDescription || null,
    },
  };
}

/**
 * Validates a status value for the Edit form's Status switch (and the
 * list's Activate/Deactivate quick action).
 *
 * @param {unknown} status
 * @returns {{ success: true, data: "active"|"inactive" }
 *         | { success: false, errors: { status: string } }}
 */
export function validateBatchStatus(status) {
  if (!BATCH_STATUSES.includes(status)) {
    return {
      success: false,
      errors: { status: "Status must be active or inactive." },
    };
  }

  return { success: true, data: status };
}
