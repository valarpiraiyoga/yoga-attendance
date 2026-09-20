/**
 * Rules for Student / Instructor profile photos. Plain constants and one pure
 * validator, safe for both the browser (`ProfilePhotoField` rejects a bad file
 * the moment it is chosen) and the server (the action re-checks every upload —
 * the browser is never trusted). Keep in step with the `profile-photos` bucket
 * limits in supabase/migrations/0019_profile_photos.sql, which Storage
 * enforces as well.
 */

export const PROFILE_PHOTO_BUCKET = "profile-photos";
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// MIME type -> stored file extension. The extension is derived from the
// verified type, never from the client-supplied file name.
export const PROFILE_PHOTO_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const PROFILE_PHOTO_ACCEPT = Object.keys(PROFILE_PHOTO_TYPES).join(",");
export const PROFILE_PHOTO_HINT = "JPG, PNG or WebP, up to 2 MB.";

/**
 * @param {{ type?: string, size?: number } | null | undefined} file
 * @returns {string|null} a user-facing message, or null when the file is acceptable.
 */
export function validateProfilePhotoFile(file) {
  if (!file) return null;
  if (!Object.hasOwn(PROFILE_PHOTO_TYPES, file.type)) {
    return "Choose a JPG, PNG or WebP image.";
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    return "The photo is too large. Choose an image of 2 MB or less.";
  }
  if (file.size === 0) {
    return "That file is empty. Choose a different image.";
  }
  return null;
}
