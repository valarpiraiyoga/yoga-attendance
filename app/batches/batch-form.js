"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProfilePhoto } from "@/components/ui/profile-photo-field";
import BatchIdentityField from "@/app/batches/batch-identity-field";
import BatchIdentityHeader from "@/components/ui/batch-identity-header";
import { DEFAULT_BATCH_COLOR } from "@/lib/batches/identity";
import { validateBatchInput } from "@/lib/batches/validation";

const BLUR_VALIDATED_FIELDS = new Set(["name", "code", "category", "description"]);

// Batch Identity (colour + optional image / icon) is one section of the form.
// The colour is controlled state that submits its palette key as
// `batch_color`; the image is kept in state too (`useProfilePhoto`, shared with
// the Student / Instructor photo) and added to the submission with the rest of
// the form, so nothing is uploaded until the admin saves.

/**
 * Shared Add/Edit Batch form. Mirrors
 * app/settings/instructors/instructor-form.js exactly — no dedicated Batch
 * form wireframe exists (wireframe p11 "Add Student" remains the closest
 * approved entity-creation form structure), so this reuses that component's
 * already-established shape rather than inventing a new one.
 *
 * Status is edit-only: `batch` being present signals edit mode (also used
 * for the other fields' pre-population), so the Status field is gated on it.
 * A new batch has no status to choose — it always starts active via the
 * database default.
 *
 * All validation rules live in lib/batches/validation.js; `action` runs them
 * server-side and is the source of truth for every submit. This component
 * also imports the same pure validator to clear a field's stale error on
 * blur once its current value is valid, and reads `state.values` for
 * `defaultValue` to redisplay what was submitted after a failed action —
 * see InstructorForm's comment for why React resets uncontrolled fields on
 * every form-action submission (react-dom's requestFormReset).
 */
export default function BatchForm({ action, batch, submitLabel, pendingLabel }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [isActive, setIsActive] = useState(batch?.status === "active");
  const [batchName, setBatchName] = useState(batch?.name ?? "");
  const [color, setColor] = useState(batch?.batch_color ?? DEFAULT_BATCH_COLOR);
  const { photo: image, setPhoto: setImage, appendTo } = useProfilePhoto();

  // The server's verdict is authoritative and wins on every submission —
  // this only resyncs to it, it never overrides it. Adjusted during render
  // (React's documented pattern for resetting state when a value changes)
  // rather than in an effect, so the stale error never has a chance to
  // paint. Blur-driven clearing below only ever acts between submissions.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  // React resets the form's DOM inputs when an action runs, so the image
  // (kept in state, not in a named input) is added to the submission here.
  function submitForm(formData) {
    appendTo(formData);
    formAction(formData);
  }

  // Mirrors InstructorForm's Phone digit-strip handler: this only reflects
  // the uppercase normalization lib/batches/validation.js already performs
  // server-side (01-product.md §12), so the user sees the same value
  // they're about to save rather than a surprise change after submit.
  function handleCodeInput(event) {
    event.target.value = event.target.value.toUpperCase();
  }

  // Lightweight UX-only recheck: reuses the same validator the server runs
  // to clear one field's stale error once its current value is actually
  // valid — it introduces no second set of validation rules, and never
  // invents an error the server didn't already report.
  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateBatchInput({
      name: formData.get("name"),
      code: formData.get("code"),
      category: formData.get("category"),
      description: formData.get("description"),
    });

    if (result.success || !result.errors[name]) {
      setFieldErrors((current) => {
        if (!(name in current)) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  }

  const cancelHref = batch ? `/batches/${batch.id}` : "/batches";

  return (
    <form action={submitForm} onBlur={handleBlur} className="flex flex-col gap-5" noValidate>
      {state?.error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {batch ? <BatchIdentityHeader batch={batch} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Batch Name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="off"
          required
          disabled={isPending}
          defaultValue={state?.values?.name ?? batch?.name ?? ""}
          onChange={(event) => setBatchName(event.target.value)}
          placeholder="Enter batch name"
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "name-error" : undefined}
        />
        {fieldErrors.name ? (
          <p id="name-error" role="alert" className="text-small text-danger">
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Short Code</Label>
        <Input
          id="code"
          name="code"
          autoComplete="off"
          required
          disabled={isPending}
          defaultValue={state?.values?.code ?? batch?.code ?? ""}
          onChange={handleCodeInput}
          placeholder="e.g. HYG"
          aria-invalid={Boolean(fieldErrors.code)}
          aria-describedby={fieldErrors.code ? "code-error" : undefined}
        />
        {fieldErrors.code ? (
          <p id="code-error" role="alert" className="text-small text-danger">
            {fieldErrors.code}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="category">Category</Label>
        <Input
          id="category"
          name="category"
          autoComplete="off"
          disabled={isPending}
          defaultValue={state?.values?.category ?? batch?.category ?? ""}
          placeholder="Enter category (optional)"
          aria-invalid={Boolean(fieldErrors.category)}
          aria-describedby={fieldErrors.category ? "category-error" : undefined}
        />
        {fieldErrors.category ? (
          <p id="category-error" role="alert" className="text-small text-danger">
            {fieldErrors.category}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          autoComplete="off"
          disabled={isPending}
          defaultValue={state?.values?.description ?? batch?.description ?? ""}
          placeholder="Enter description (optional)"
          aria-invalid={Boolean(fieldErrors.description)}
          aria-describedby={fieldErrors.description ? "description-error" : undefined}
        />
        {fieldErrors.description ? (
          <p id="description-error" role="alert" className="text-small text-danger">
            {fieldErrors.description}
          </p>
        ) : null}
      </div>

      <BatchIdentityField
        batchName={batchName}
        color={color}
        onColorChange={setColor}
        colorError={fieldErrors.batch_color}
        currentImageUrl={batch?.batch_image_url ?? null}
        image={image}
        onImageChange={setImage}
        imageError={fieldErrors.photo}
        disabled={isPending}
      />

      {batch ? (
        <div className="flex flex-col gap-2">
          <Label id="status-label">Status</Label>
          <div className="flex items-center gap-3">
            <Switch
              name="status"
              value="active"
              uncheckedValue="inactive"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={isPending}
              aria-labelledby="status-label"
              aria-describedby={fieldErrors.status ? "status-error" : undefined}
            />
            <span className="text-body font-medium text-text-primary">
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
          {fieldErrors.status ? (
            <p id="status-error" role="alert" className="text-small text-danger">
              {fieldErrors.status}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex justify-end gap-3 border-t border-border pt-5">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          render={<Link href={cancelHref} />}
          nativeButton={false}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
