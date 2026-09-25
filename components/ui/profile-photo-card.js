"use client";

import { ImageIcon } from "lucide-react";
import ProfilePhotoField from "@/components/ui/profile-photo-field";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The one photo-upload card for a person's photo (Student, Instructor) and for the
 * Center Logo: a bordered card with a bold title, the image in a rounded box,
 * full-width Change / Remove buttons and the file hint beside an info icon. It sits
 * as its own column beside a form's fields, and stacks above them on a narrow screen.
 *
 * It wraps `ProfilePhotoField` in its `stacked` layout, so upload, validation, local
 * preview, replace, remove and the "uploaded with the form" behaviour are exactly
 * the shared photo control's; this only supplies the card and the preview box.
 *
 * `fit="cover"` (a person) fills a portrait box, with the person's initials when
 * there is no photo. `fit="contain"` (a logo) shows the whole image on a wider, dashed box,
 * with an image icon when there is none.
 *
 * @param {object} props
 * @param {string} props.name - the person's name (initials fallback, alt text).
 * @param {string} [props.label] - the card's title ("Profile Photo").
 * @param {string} [props.noun] - what the file is called in buttons and messages ("Photo").
 * @param {string} [props.description] - an optional line under the title.
 * @param {string|null} [props.currentUrl]
 * @param {object} props.photo - state from `useProfilePhoto`.
 * @param {(photo: object) => void} props.onChange
 * @param {string} [props.error]
 * @param {boolean} [props.disabled]
 * @param {"cover"|"contain"} [props.fit]
 */
export default function ProfilePhotoCard({
  name,
  label = "Profile Photo",
  noun = "Photo",
  description,
  currentUrl = null,
  photo,
  onChange,
  error,
  disabled = false,
  fit = "cover",
  className,
}) {
  const contain = fit === "contain";

  return (
    <div className={cn("w-56 max-w-full rounded-card border border-border bg-surface p-4 shadow-xs", className)}>
      <div className="mb-2">
        <p className="text-body font-semibold text-text-primary">{label}</p>
        {description ? <p className="text-small mt-0.5 text-text-secondary">{description}</p> : null}
      </div>
      <ProfilePhotoField
        name={name}
        label={label}
        hideLabel
        noun={noun}
        currentUrl={currentUrl}
        photo={photo}
        onChange={onChange}
        error={error}
        disabled={disabled}
        stacked
        preview={(url) => (
          <div
            className={cn(
              "flex w-full items-center justify-center overflow-hidden rounded-lg border",
              // A logo is wide, so its box is landscape; a person's photo is a portrait.
              contain ? "aspect-[16/10] border-dashed border-border bg-background" : "aspect-[9/10] border-border bg-brand/10"
            )}
          >
            {url ? (
              // A plain <img>: the same tradeoff as every other stored image here (see Avatar).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={`${noun} preview`}
                className={cn("size-full", contain ? "object-contain p-2" : "object-cover")}
              />
            ) : contain ? (
              <ImageIcon className="size-8 text-text-secondary" aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="text-page-title font-semibold text-brand">
                {getInitials(name)}
              </span>
            )}
          </div>
        )}
      />
    </div>
  );
}
