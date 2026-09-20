"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import Avatar from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  PROFILE_PHOTO_ACCEPT,
  PROFILE_PHOTO_HINT,
  validateProfilePhotoFile,
} from "@/lib/storage/profile-photo-rules";

/**
 * State for a profile photo being added, changed or removed in a form.
 * `file` is the newly chosen image (not uploaded yet), `previewUrl` its local
 * blob preview, `removed` an explicit "remove the current photo".
 *
 * The form keeps this state and calls `appendTo(formData)` from its action, so
 * the photo travels with the rest of the form in ONE server action — nothing
 * is uploaded until the admin saves, an abandoned form leaves no stray file,
 * and a failed save keeps the selection (React resets the DOM inputs of a form
 * action, but not this state).
 */
export function useProfilePhoto() {
  const [photo, setPhoto] = useState({ file: null, previewUrl: null, removed: false });

  function appendTo(formData) {
    if (photo.file) formData.set("photo", photo.file);
    if (photo.removed) formData.set("remove_photo", "1");
  }

  return { photo, setPhoto, appendTo };
}

/**
 * The one profile-photo control for Add/Edit Student and Add/Edit Instructor:
 * the shared `Avatar` (photo, else initials) with Upload / Change / Remove.
 * The chosen file is validated (type, size) immediately and previewed locally;
 * the server validates it again on save. No cropping or editing.
 *
 * @param {object} props
 * @param {string} props.name - the person's name, for the initials fallback.
 * @param {string|null} [props.currentUrl] - the saved photo, if any.
 * @param {ReturnType<typeof useProfilePhoto>["photo"]} props.photo
 * @param {(photo: object) => void} props.onChange
 * @param {string} [props.error] - a server-side message for the photo.
 * @param {boolean} [props.disabled]
 */
export default function ProfilePhotoField({ name, currentUrl = null, photo, onChange, error, disabled = false }) {
  const inputRef = useRef(null);
  const [clientError, setClientError] = useState(null);

  // Revokes a blob URL once it is replaced, cleared or the form unmounts.
  const { previewUrl } = photo;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const shownUrl = photo.removed ? null : (photo.previewUrl ?? currentUrl);
  const message = clientError ?? error;

  function handleSelect(event) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file) return;

    const problem = validateProfilePhotoFile(file);
    if (problem) {
      setClientError(problem);
      return;
    }

    setClientError(null);
    onChange({ file, previewUrl: URL.createObjectURL(file), removed: false });
  }

  function handleRemove() {
    setClientError(null);
    onChange({ file: null, previewUrl: null, removed: Boolean(currentUrl) });
  }

  return (
    <div className="flex flex-col gap-2">
      <span id="profile-photo-label" className="text-body font-medium text-text-primary">
        Profile Photo
      </span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Avatar name={name} src={shownUrl} className="size-20 text-page-title" />

        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
            >
              <ImageUp className="size-4" aria-hidden="true" />
              {shownUrl ? "Change Photo" : "Upload Photo"}
            </Button>
            {shownUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={handleRemove}>
                <Trash2 className="size-4" aria-hidden="true" />
                Remove Photo
              </Button>
            ) : null}
          </div>
          <p className="text-small text-text-secondary">
            {photo.file ? `${photo.file.name} — saved when you save the form. ` : ""}
            {PROFILE_PHOTO_HINT}
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={PROFILE_PHOTO_ACCEPT}
          onChange={handleSelect}
          tabIndex={-1}
          aria-labelledby="profile-photo-label"
          className="sr-only"
        />
      </div>

      {message ? (
        <p role="alert" className="text-small text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
