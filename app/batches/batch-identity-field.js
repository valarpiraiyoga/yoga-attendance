"use client";

import FormField from "@/components/ui/form-field";
import ProfilePhotoField from "@/components/ui/profile-photo-field";
import BatchAvatar, { BatchColorDot } from "@/components/ui/batch-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listBatchColors } from "@/lib/batches/identity";

const COLORS = listBatchColors();
const COLOR_ITEMS = COLORS.map(({ key, label }) => ({ value: key, label }));

/**
 * The "Batch Identity" section of Add / Edit Batch: a colour from the curated
 * palette and an optional image / icon, so a batch is recognisable across the
 * app. Colour is a labelled select (a dot beside its name - never colour
 * alone) that submits the palette KEY as `batch_color`. The image reuses
 * `ProfilePhotoField` (Upload / Change / Remove, validated and previewed
 * locally, uploaded with the form) with the batch's own mark as the preview,
 * which also shows how the colour will look on the initials tile.
 *
 * The form owns both pieces of state (`color`, and `image` from
 * `useProfilePhoto`) so a failed save keeps them; this only renders them.
 */
export default function BatchIdentityField({
  batchName,
  color,
  onColorChange,
  colorError,
  currentImageUrl = null,
  image,
  onImageChange,
  imageError,
  disabled = false,
}) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-border bg-background/50 p-4">
      <legend className="px-1 text-body font-semibold text-text-primary">Batch Identity</legend>
      <p className="-mt-1 text-small text-text-secondary">
        Choose a color and optionally upload an image or icon to help identify this batch throughout the app.
      </p>

      <FormField id="batch_color" label="Color" error={colorError}>
        {(field) => (
          <Select
            name="batch_color"
            items={COLOR_ITEMS}
            value={color}
            onValueChange={onColorChange}
            disabled={disabled}
          >
            <SelectTrigger {...field}>
              <SelectValue>
                {(value) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <BatchColorDot color={value} />
                    {COLOR_ITEMS.find((item) => item.value === value)?.label ?? "Teal"}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COLORS.map(({ key, label }) => (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-2">
                    <BatchColorDot color={key} />
                    {label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <ProfilePhotoField
        name={batchName}
        label="Image / Icon"
        noun="Image"
        currentUrl={currentImageUrl}
        photo={image}
        onChange={onImageChange}
        error={imageError}
        disabled={disabled}
        preview={(url) => (
          <BatchAvatar
            batch={{ name: batchName || "Batch", batch_color: color, batch_image_url: url }}
            alt={url ? "Batch image preview" : ""}
            className="size-20 text-page-title"
          />
        )}
      />
    </fieldset>
  );
}
