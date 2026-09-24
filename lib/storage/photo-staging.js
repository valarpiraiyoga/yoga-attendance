import {
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_TYPES,
  validateProfilePhotoFile,
} from "./profile-photo-rules.js";

/**
 * Supabase Storage helpers for Student / Instructor profile photos and Batch
 * images (bucket `profile-photos`, supabase/migrations/0019_profile_photos.sql).
 *
 * Every call takes the signed-in admin's own Supabase client, so Storage's RLS
 * (admin-only writes) applies — no secret key is involved and nothing here
 * reaches the browser. Callers must already have run `requireRole(ROLES.ADMIN)`.
 *
 * Paths are `<folder>/<uuid>.<ext>`: a fresh UUID per upload, so a new photo
 * never overwrites another person's — or the same person's previous — file,
 * and the public URL is unguessable. The old object is deleted only after the
 * database row points at the new one.
 */

function publicUrlPrefix() {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PROFILE_PHOTO_BUCKET}/`;
}

/** The object path inside the bucket for one of our own URLs, else null. */
function pathFromUrl(url) {
  if (typeof url !== "string" || !url.startsWith(publicUrlPrefix())) return null;
  const path = decodeURIComponent(url.slice(publicUrlPrefix().length).split("?")[0]);
  return path && !path.includes("..") ? path : null;
}

/**
 * Reads the optional `photo` file from a submitted form. `null` means no new
 * file was chosen; a bad file returns its message.
 *
 * @param {FormData} formData
 * @param {string} [noun] - "photo", or "image" for a Batch's image.
 * @returns {{ file: File|null, error: string|null }}
 */
export function readPhotoFromForm(formData, noun = "photo") {
  const file = formData.get("photo");
  // An untouched <input type="file"> submits an empty, nameless File.
  if (!(file instanceof File) || (file.size === 0 && !file.name)) {
    return { file: null, error: null };
  }
  return { file, error: validateProfilePhotoFile(file, noun) };
}

/**
 * Uploads `file` under `<folder>/` and returns its public URL and path.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {"students"|"instructors"} folder
 * @param {File} file - already validated.
 * @returns {Promise<{ url: string, path: string } | { error: string }>}
 */
export async function uploadProfilePhoto(supabase, folder, file) {
  const extension = PROFILE_PHOTO_TYPES[file.type];
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });

  if (error) {
    console.error(`[storage] Could not upload profile photo to ${path}:`, error.name, error.message);
    return { error: "Could not upload the photo. Check your connection and try again." };
  }

  const { data } = supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Best-effort removal of a photo object by its public URL. A URL that is not
 * one of ours (or is empty) is ignored, and a failure is logged rather than
 * thrown: by the time this runs the record has already been saved correctly,
 * and an orphaned file is harmless compared with failing the save.
 */
export async function deleteProfilePhotoByUrl(supabase, url) {
  const path = pathFromUrl(url);
  if (!path) return;

  const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
  if (error) {
    console.error(`[storage] Could not delete profile photo ${path}:`, error.name, error.message);
  }
}

/** Same as `deleteProfilePhotoByUrl`, for a path we just uploaded (rollback). */
export async function deleteProfilePhotoByPath(supabase, path) {
  const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
  if (error) {
    console.error(`[storage] Could not roll back profile photo ${path}:`, error.name, error.message);
  }
}

/**
 * Stages a profile-photo change for a create/update, so the two actions share
 * one ordering:
 *
 *   1. `stagePhotoChange` uploads a new file first (a failed upload stops the
 *      save with an error — never a silent success without the photo).
 *   2. The caller writes `patch` ({ photo_url }) together with the other
 *      fields in a single insert/update.
 *   3. On success it calls `commit()`, which deletes the replaced/removed
 *      object; on failure `rollback()`, which deletes the new upload. The old
 *      photo therefore stays intact until the new state is really saved.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} options
 * @param {"students"|"instructors"|"batches"|"center"} options.folder
 * @param {File|null} options.file - a validated new photo, or null.
 * @param {boolean} options.remove - true to clear the current photo.
 * @param {string|null} [options.oldUrl] - the record's stored URL.
 * @param {string} [options.column] - the column holding the URL: `photo_url`
 *   for a person, `batch_image_url` for a batch's image, `logo_url` for the
 *   centre logo.
 * @returns {Promise<{ error: string } | { patch: Record<string, string|null>, commit: () => Promise<void>, rollback: () => Promise<void> }>}
 */
export async function stagePhotoChange(supabase, { folder, file, remove, oldUrl = null, column = "photo_url" }) {
  let uploaded = null;

  if (file) {
    const result = await uploadProfilePhoto(supabase, folder, file);
    if (result.error) return { error: result.error };
    uploaded = result;
  }

  const changes = Boolean(uploaded) || (remove && Boolean(oldUrl));
  const newUrl = uploaded ? uploaded.url : null;

  return {
    patch: changes ? { [column]: newUrl } : {},
    commit: async () => {
      if (changes && oldUrl && oldUrl !== newUrl) await deleteProfilePhotoByUrl(supabase, oldUrl);
    },
    rollback: async () => {
      if (uploaded) await deleteProfilePhotoByPath(supabase, uploaded.path);
    },
  };
}

/**
 * The record's stored photo / image URL, or `{ error }` when it cannot be read.
 * `idColumn` is the key the row is looked up by: `id` for every entity, `singleton`
 * for the one-row centre profile.
 */
export async function getStoredPhotoUrl(supabase, table, id, column = "photo_url", idColumn = "id") {
  const { data, error } = await supabase.from(table).select(column).eq(idColumn, id).maybeSingle();
  if (error) {
    console.error(`[storage] Could not read ${table}.${column} for ${id}:`, error.code, error.message);
    return { error: "Could not update the photo. Try again." };
  }
  return { url: data?.[column] ?? null };
}
