/**
 * Validation for the Center Profile form fields (Settings — Phase 19).
 *
 * Plain functions, no schema library — consistent with the rest of the
 * project (`lib/batches/validation.js`, `lib/instructors/validation.js`).
 * Mirrors `validateInstructorInput`'s email/phone rules exactly: same
 * patterns, same normalization (trim, lowercase email, digits-only phone),
 * so a center's contact details are validated the same way a person's are
 * everywhere else in this codebase.
 */

const MAX_NAME_LENGTH = 100;
const MAX_ADDRESS_LENGTH = 300;
const MAX_PHONE_LENGTH = 30;
const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\d+$/;

/**
 * Validates the Center Profile form fields: name, address, phone, email.
 * Name is required; the rest are optional, matching the wireframe's
 * populated-but-not-flagged-required fields — `01-product.md` §11 says
 * only that Admin "can manage" these, not that all of them must be filled
 * in before the center profile is usable.
 *
 * @param {{ name?: unknown, address?: unknown, phone?: unknown, email?: unknown }} input
 * @returns {{ success: true, data: { name: string, address: string|null, phone: string|null, email: string|null } }
 *         | { success: false, errors: Record<string, string> }}
 */
export function validateCenterProfileInput({ name, address, phone, email } = {}) {
  const errors = {};

  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) {
    errors.name = "Yoga center name is required.";
  } else if (trimmedName.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const trimmedAddress = String(address ?? "").trim();
  if (trimmedAddress.length > MAX_ADDRESS_LENGTH) {
    errors.address = `Address must be ${MAX_ADDRESS_LENGTH} characters or fewer.`;
  }

  const trimmedPhone = String(phone ?? "").trim();
  if (trimmedPhone) {
    if (trimmedPhone.length > MAX_PHONE_LENGTH) {
      errors.phone = `Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`;
    } else if (!PHONE_PATTERN.test(trimmedPhone)) {
      errors.phone = "Phone must contain digits only.";
    }
  }

  const trimmedEmail = String(email ?? "").trim().toLowerCase();
  if (trimmedEmail) {
    if (trimmedEmail.length > MAX_EMAIL_LENGTH) {
      errors.email = `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`;
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = "Enter a valid email address.";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      name: trimmedName,
      address: trimmedAddress || null,
      phone: trimmedPhone || null,
      email: trimmedEmail || null,
    },
  };
}
