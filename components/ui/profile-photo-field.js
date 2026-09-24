"use client";

import { useEffect, useId, useRef, useState } from "react";
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
 * Add/Edit Batch reuses it for the batch image (same rules, same bucket): it
 * passes its own `label` / `noun` for the wording and a `preview` to draw the
 * batch's mark instead of a person's avatar.
 *
 * @param {object} props
 * @param {string} props.name - the person's name, for the initials fallback.
 * @param {string} [props.label] - the field's label ("Profile Photo").
 * @param {string} [props.noun] - the file's name in buttons and messages ("Photo").
 * @param {(url: string|null) => import("react").ReactNode} [props.preview] - draws the preview for the shown URL (default: the person's `Avatar`).
 * @param {boolean} [props.hideLabel] - keep the label for assistive technology only, when the field already sits under a visible heading.
 * @param {string|null} [props.currentUrl] - the saved photo, if any.
 * @param {ReturnType<typeof useProfilePhoto>["photo"]} props.photo
 * @param {(photo: object) => void} props.onChange
 * @param {string} [props.error] - a server-side message for the photo.
 * @param {boolean} [props.disabled]
 */
export default function ProfilePhotoField({
  name,
  label = "Profile Photo",
  hideLabel = false,
  noun = "Photo",
  preview,
  currentUrl = null,
  photo,
  onChange,
  error,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const labelId = useId();
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

    const problem = validateProfilePhotoFile(file, noun.toLowerCase());
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
      <span id={labelId} className={hideLabel ? "sr-only" : "text-body font-medium text-text-primary"}>
        {label}
      </span>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        {preview ? preview(shownUrl) : <Avatar name={name} src={shownUrl} className="size-20 text-page-title" />}

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
              {shownUrl ? `Change ${noun}` : `Upload ${noun}`}
            </Button>
            {shownUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={handleRemove}>
                <Trash2 className="size-4" aria-hidden="true" />
                Remove {noun}
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
          aria-labelledby={labelId}
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
