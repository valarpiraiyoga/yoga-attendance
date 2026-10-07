import {
  PROFILE_PHOTO_TYPES,
  validateProfilePhotoFile,
} from "../storage/profile-photo-rules.js";

/**
 * The Invoice / Receipt signature image, in the PRIVATE `invoice-assets` bucket
 * (supabase/migrations/0026_invoices.sql). Plain functions over a Supabase
 * client, so they can be tested with a fake one (as `lib/storage/photo-staging.js`
 * is); `lib/invoice-settings/actions.js` and `data.js` are the server-only
 * callers. Deliberately separate from the public profile-photo storage — that
 * code is not used or changed.
 *
 * Only a PATH is stored (`invoice_settings.signature_path`), never a URL.
 *
 *   - Upload / replace: a new object `signatures/<uuid>.<ext>` is uploaded and
 *     `signature_path` points at it. The old object stays.
 *   - Remove: `signature_path` is set to NULL. The object stays.
 *
 * NOTHING HERE EVER DELETES AN OBJECT. An issued invoice records the path it
 * was issued with, so a replaced or removed signature must remain readable
 * (and the bucket has no delete policy). A failed save after an upload leaves
 * an unreferenced file: private and harmless, and logged.
 *
 * The file is checked against the approved image rules (JPG, PNG or WebP, up to
 * 2 MB — the same as the bucket's own limits); the browser is never trusted.
 */

export const SIGNATURE_BUCKET = "invoice-assets";
export const SIGNATURE_FOLDER = "signatures";
// A signed link is only for showing the preview; when it lapses the stored signature is untouched.
export const SIGNATURE_URL_TTL_SECONDS = 60 * 60;

/** `signatures/<uuid>.<ext>` — the extension comes from the verified type, never the file name. */
export function signaturePathFor(file, id = crypto.randomUUID()) {
  return `${SIGNATURE_FOLDER}/${id}.${PROFILE_PHOTO_TYPES[file.type]}`;
}

/**
 * Reads the optional signature from the submitted form. The shared photo field
 * submits the chosen image as `photo` and a removal as `remove_photo`.
 * `file: null` means no new file was chosen; a bad file returns its message.
 *
 * @param {FormData} formData
 * @returns {{ file: File|null, remove: boolean, error: string|null }}
 */
export function readSignatureFromForm(formData) {
  const remove = formData.get("remove_photo") === "1";
  const file = formData.get("photo");

  // An untouched <input type="file"> submits an empty, nameless File.
  if (!(file instanceof File) || (file.size === 0 && !file.name)) {
    return { file: null, remove, error: null };
  }
  return { file, remove, error: validateProfilePhotoFile(file, "signature") };
}

/**
 * Uploads a validated signature. `upsert: false`: an existing object is never overwritten.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {File} file - already validated.
 * @returns {Promise<{ path: string } | { error: string }>}
 */
export async function uploadSignature(supabase, file) {
  const path = signaturePathFor(file);

  const { error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });

  if (error) {
    console.error(`[invoice-settings] Could not upload the signature to ${path}:`, error.name, error.message);
    return { error: "Could not upload the signature. Check your connection and try again." };
  }

  return { path };
}

/**
 * Turns a submitted change into the `invoice_settings` patch it needs:
 *   - a new file     -> { signature_path: <new path> } (after uploading it);
 *   - a removal      -> { signature_path: null };
 *   - neither        -> {} (nothing to write).
 * A new file wins over a removal. No object is ever deleted.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ file: File|null, remove: boolean }} change
 * @returns {Promise<{ error: string } | { patch: { signature_path?: string|null } }>}
 */
export async function stageSignatureChange(supabase, { file, remove }) {
  if (file) {
    const uploaded = await uploadSignature(supabase, file);
    if (uploaded.error) return { error: uploaded.error };
    return { patch: { signature_path: uploaded.path } };
  }

  if (remove) {
    return { patch: { signature_path: null } };
  }

  return { patch: {} };
}

/**
 * A temporary signed URL for showing the stored signature (the bucket is
 * private), or null when there is none or one cannot be made. The page never
 * fails because a preview could not be signed.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string|null|undefined} path
 * @returns {Promise<string|null>}
 */
export async function createSignatureUrl(supabase, path) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(path, SIGNATURE_URL_TTL_SECONDS);

  if (error) {
    console.error(`[invoice-settings] Could not sign the signature preview ${path}:`, error.name, error.message);
    return null;
  }

  return data?.signedUrl ?? null;
}
