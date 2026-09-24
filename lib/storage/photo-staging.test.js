// Run with `npm test` (Node's built-in test runner).
//
// The image save flow for a Batch (Batch Identity): a new image is uploaded
// first, its URL is saved with the batch, and the replaced / removed object is
// deleted only after that save - a failed save deletes the new upload instead,
// so the old image is never lost. A fake Supabase client records every call.

import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteProfilePhotoByUrl,
  getStoredPhotoUrl,
  readPhotoFromForm,
  stagePhotoChange,
} from "./photo-staging.js";
import { validateProfilePhotoFile } from "./profile-photo-rules.js";

const BASE = "https://project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
const OLD_URL = `${BASE}/storage/v1/object/public/profile-photos/batches/old.png`;

function image(overrides = {}) {
  return new File([new Uint8Array(1024)], "logo.png", { type: "image/png", ...overrides });
}

// A recording stand-in for the parts of the Supabase client the helpers use.
function fakeSupabase({ uploadError = null, removeError = null, row = { batch_image_url: OLD_URL }, rowError = null } = {}) {
  const calls = { uploads: [], removes: [], reads: [] };
  const client = {
    calls,
    storage: {
      from(bucket) {
        assert.equal(bucket, "profile-photos");
        return {
          upload: async (path, file, options) => {
            calls.uploads.push({ path, type: options.contentType });
            return { error: uploadError };
          },
          remove: async (paths) => {
            calls.removes.push(...paths);
            return { error: removeError };
          },
          getPublicUrl: (path) => ({ data: { publicUrl: `${BASE}/storage/v1/object/public/profile-photos/${path}` } }),
        };
      },
    },
    from(table) {
      return {
        select: (column) => ({
          eq: (idColumn, id) => ({
            maybeSingle: async () => {
              calls.reads.push({ table, column, idColumn, id });
              return { data: row, error: rowError };
            },
          }),
        }),
      };
    },
  };
  return client;
}

const BATCH = { folder: "batches", column: "batch_image_url" };

test("a new image is uploaded under batches/ and saved to batch_image_url", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...BATCH, file: image(), remove: false });

  assert.equal(supabase.calls.uploads.length, 1);
  assert.match(supabase.calls.uploads[0].path, /^batches\/[0-9a-f-]{36}\.png$/);
  assert.equal(supabase.calls.uploads[0].type, "image/png");
  assert.deepEqual(Object.keys(staged.patch), ["batch_image_url"]);
  assert.match(staged.patch.batch_image_url, /^https:\/\/project\.supabase\.co\/.+\/batches\/.+\.png$/);
});

test("the stored value is a URL, never the file's bytes or base64", async () => {
  const staged = await stagePhotoChange(fakeSupabase(), { ...BATCH, file: image(), remove: false });
  assert.match(staged.patch.batch_image_url, /^https:\/\//);
  assert.doesNotMatch(staged.patch.batch_image_url, /^data:|base64/);
});

test("no file and no removal changes nothing and deletes nothing", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...BATCH, file: null, remove: false, oldUrl: OLD_URL });
  assert.deepEqual(staged.patch, {});
  await staged.commit();
  assert.deepEqual(supabase.calls.uploads, []);
  assert.deepEqual(supabase.calls.removes, []);
});

test("removing the image clears the column and deletes the old object only on commit", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...BATCH, file: null, remove: true, oldUrl: OLD_URL });
  assert.deepEqual(staged.patch, { batch_image_url: null });
  assert.deepEqual(supabase.calls.removes, [], "nothing deleted before the save succeeds");

  await staged.commit();
  assert.deepEqual(supabase.calls.removes, ["batches/old.png"]);
});

test("removing when there was no image is a no-op", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...BATCH, file: null, remove: true, oldUrl: null });
  assert.deepEqual(staged.patch, {});
  await staged.commit();
  assert.deepEqual(supabase.calls.removes, []);
});

test("replacing an image uploads the new one and deletes the old one only on commit", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...BATCH, file: image(), remove: false, oldUrl: OLD_URL });
  assert.equal(supabase.calls.uploads.length, 1);
  assert.deepEqual(supabase.calls.removes, []);

  await staged.commit();
  assert.deepEqual(supabase.calls.removes, ["batches/old.png"]);
});

test("a failed save rolls back: the new upload is deleted and the old image is kept", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...BATCH, file: image(), remove: false, oldUrl: OLD_URL });
  const uploaded = supabase.calls.uploads[0].path;

  await staged.rollback();
  assert.deepEqual(supabase.calls.removes, [uploaded]);
  assert.ok(!supabase.calls.removes.includes("batches/old.png"), "the old image must survive");
});

test("a failed upload stops the save with a message and touches nothing else", async () => {
  const supabase = fakeSupabase({ uploadError: { name: "StorageError", message: "boom" } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await stagePhotoChange(supabase, { ...BATCH, file: image(), remove: false, oldUrl: OLD_URL });
    assert.match(result.error, /Could not upload the photo/);
    assert.equal(result.patch, undefined);
    assert.deepEqual(supabase.calls.removes, []);
  } finally {
    console.error = originalError;
  }
});

test("a failed cleanup delete is logged, not thrown - the save already succeeded", async () => {
  const supabase = fakeSupabase({ removeError: { name: "StorageError", message: "nope" } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const staged = await stagePhotoChange(supabase, { ...BATCH, file: null, remove: true, oldUrl: OLD_URL });
    await assert.doesNotReject(staged.commit());
  } finally {
    console.error = originalError;
  }
});

test("a URL that is not one of ours is never deleted", async () => {
  const supabase = fakeSupabase();
  await deleteProfilePhotoByUrl(supabase, "https://elsewhere.example/batches/old.png");
  await deleteProfilePhotoByUrl(supabase, `${BASE}/storage/v1/object/public/profile-photos/../secret.png`);
  await deleteProfilePhotoByUrl(supabase, null);
  assert.deepEqual(supabase.calls.removes, []);
});

test("people keep using photo_url by default", async () => {
  const staged = await stagePhotoChange(fakeSupabase(), { folder: "students", file: image(), remove: false });
  assert.deepEqual(Object.keys(staged.patch), ["photo_url"]);
});

test("the stored batch image URL is read from batch_image_url", async () => {
  const supabase = fakeSupabase();
  const stored = await getStoredPhotoUrl(supabase, "batches", "b1", "batch_image_url");
  assert.equal(stored.url, OLD_URL);
  assert.deepEqual(supabase.calls.reads, [{ table: "batches", column: "batch_image_url", idColumn: "id", id: "b1" }]);

  const none = await getStoredPhotoUrl(fakeSupabase({ row: { batch_image_url: null } }), "batches", "b1", "batch_image_url");
  assert.equal(none.url, null);
});

// ---- the image file rules (shared with profile photos) --------------------

test("an image is optional: an untouched file input is no file and no error", () => {
  const form = new FormData();
  form.set("photo", new File([], ""));
  assert.deepEqual(readPhotoFromForm(form, "image"), { file: null, error: null });
  assert.deepEqual(readPhotoFromForm(new FormData(), "image"), { file: null, error: null });
});

test("PNG, JPG and WebP under 2 MB are accepted", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(validateProfilePhotoFile(image({ type }), "image"), null, type);
  }
});

test("SVG, GIF and other types are rejected", () => {
  for (const type of ["image/svg+xml", "image/gif", "application/pdf", ""]) {
    assert.match(validateProfilePhotoFile(image({ type }), "image"), /JPG, PNG or WebP/, type);
  }
});

test("an oversized or empty image is rejected, worded for an image", () => {
  const big = { type: "image/png", size: 2 * 1024 * 1024 + 1 };
  assert.equal(validateProfilePhotoFile(big, "image"), "The image is too large. Choose an image of 2 MB or less.");
  assert.equal(validateProfilePhotoFile(big), "The photo is too large. Choose an image of 2 MB or less.");
  assert.match(validateProfilePhotoFile({ type: "image/png", size: 0 }, "image"), /empty/);
});

test("readPhotoFromForm reports a bad chosen file", () => {
  const form = new FormData();
  form.set("photo", image({ type: "image/gif" }));
  const { file, error } = readPhotoFromForm(form, "image");
  assert.ok(file);
  assert.match(error, /JPG, PNG or WebP/);
});

// ---- the Center Logo (same storage, `center/` folder, `logo_url`) -------------------

const LOGO = { folder: "center", column: "logo_url" };
const OLD_LOGO = `${BASE}/storage/v1/object/public/profile-photos/center/old.png`;

test("a new logo is uploaded under center/ and saved to logo_url", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...LOGO, file: image(), remove: false });
  assert.match(supabase.calls.uploads[0].path, /^center\/[0-9a-f-]{36}\.png$/);
  assert.deepEqual(Object.keys(staged.patch), ["logo_url"]);
  assert.match(staged.patch.logo_url, /^https:\/\/project\.supabase\.co\/.+\/center\/.+\.png$/);
});

test("replacing the logo deletes the old file only after the save, and rollback keeps it", async () => {
  const saved = fakeSupabase();
  const staged = await stagePhotoChange(saved, { ...LOGO, file: image(), remove: false, oldUrl: OLD_LOGO });
  assert.deepEqual(saved.calls.removes, [], "the old logo survives until the save succeeds");
  await staged.commit();
  assert.deepEqual(saved.calls.removes, ["center/old.png"]);

  const failed = fakeSupabase();
  const staged2 = await stagePhotoChange(failed, { ...LOGO, file: image(), remove: false, oldUrl: OLD_LOGO });
  await staged2.rollback();
  assert.deepEqual(failed.calls.removes, [failed.calls.uploads[0].path], "only the new upload is removed");
});

test("removing the logo clears logo_url and deletes the file on commit", async () => {
  const supabase = fakeSupabase();
  const staged = await stagePhotoChange(supabase, { ...LOGO, file: null, remove: true, oldUrl: OLD_LOGO });
  assert.deepEqual(staged.patch, { logo_url: null });
  await staged.commit();
  assert.deepEqual(supabase.calls.removes, ["center/old.png"]);
});

test("a failed logo upload stops the save with a message", async () => {
  const supabase = fakeSupabase({ uploadError: { name: "StorageError", message: "boom" } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await stagePhotoChange(supabase, { ...LOGO, file: image(), remove: false, oldUrl: OLD_LOGO });
    assert.match(result.error, /Could not upload/);
    assert.deepEqual(supabase.calls.removes, []);
  } finally {
    console.error = originalError;
  }
});

test("the one-row centre profile is looked up by its singleton key", async () => {
  const supabase = fakeSupabase({ row: { logo_url: OLD_LOGO } });
  const stored = await getStoredPhotoUrl(supabase, "center_profile", true, "logo_url", "singleton");
  assert.equal(stored.url, OLD_LOGO);
  assert.deepEqual(supabase.calls.reads, [{ table: "center_profile", column: "logo_url", idColumn: "singleton", id: true }]);
});

test("the logo follows the same image rules: PNG / JPG / WebP, 2 MB, worded for a logo", () => {
  assert.equal(validateProfilePhotoFile(image(), "logo"), null);
  assert.match(validateProfilePhotoFile(image({ type: "image/svg+xml" }), "logo"), /JPG, PNG or WebP/);
  assert.equal(
    validateProfilePhotoFile({ type: "image/png", size: 2 * 1024 * 1024 + 1 }, "logo"),
    "The logo is too large. Choose an image of 2 MB or less."
  );
});
