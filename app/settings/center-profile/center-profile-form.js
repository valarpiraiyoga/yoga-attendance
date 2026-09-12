"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { validateCenterProfileInput } from "@/lib/center-profile/validation";

const BLUR_VALIDATED_FIELDS = new Set(["name", "address", "phone", "email"]);

/**
 * Center Profile form (Settings — Phase 19; `01-product.md` §11; wireframe
 * p.38: YOGA CENTER NAME, LOGO, ADDRESS, PHONE, EMAIL, Save Changes).
 *
 * Mirrors `app/batches/batch-form.js`'s shape exactly: `useActionState`,
 * blur-driven stale-error clearing using the same pure validator the
 * server runs, `state.values` for redisplaying a failed submission (see
 * that file's comment for why — react-dom's `requestFormReset` resets every
 * uncontrolled field on each form-action submission, regardless of
 * outcome).
 *
 * Unlike every other form in this codebase, there is no `cancelHref` and no
 * separate view mode: the wireframe shows the fields directly editable with
 * a single Save Changes action, so this form always renders the current
 * center profile pre-filled — there is nothing to "cancel back" to.
 *
 * No Logo upload control: no upload mechanism exists yet (no Storage
 * bucket, no upload UI) — deferred, matching how Instructor Photo and
 * Student Profile Photo were both explicitly deferred.
 * `center_profile.logo_url` exists in the schema for forward compatibility
 * only (0018_center_profile.sql).
 */
export default function CenterProfileForm({ action, profile }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateCenterProfileInput({
      name: formData.get("name"),
      address: formData.get("address"),
      phone: formData.get("phone"),
      email: formData.get("email"),
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

  return (
    <form action={formAction} onBlur={handleBlur} className="flex flex-col gap-5" noValidate>
      {state?.error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Yoga Center Name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="off"
          required
          disabled={isPending}
          defaultValue={state?.values?.name ?? profile?.name ?? ""}
          placeholder="Enter the center's name"
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
        <Label>Logo</Label>
        <p className="text-body text-text-secondary">
          Not available yet — logo upload is part of a later phase.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          name="address"
          disabled={isPending}
          defaultValue={state?.values?.address ?? profile?.address ?? ""}
          placeholder="Enter the center's address (optional)"
          aria-invalid={Boolean(fieldErrors.address)}
          aria-describedby={fieldErrors.address ? "address-error" : undefined}
        />
        {fieldErrors.address ? (
          <p id="address-error" role="alert" className="text-small text-danger">
            {fieldErrors.address}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="off"
          disabled={isPending}
          defaultValue={state?.values?.phone ?? profile?.phone ?? ""}
          placeholder="Enter phone number (optional)"
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
        />
        {fieldErrors.phone ? (
          <p id="phone-error" role="alert" className="text-small text-danger">
            {fieldErrors.phone}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="off"
          disabled={isPending}
          defaultValue={state?.values?.email ?? profile?.email ?? ""}
          placeholder="Enter email address (optional)"
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
        />
        {fieldErrors.email ? (
          <p id="email-error" role="alert" className="text-small text-danger">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <p className="text-small text-text-secondary">
        Center information may appear in exported attendance reports.
      </p>

      <div className="mt-2 flex justify-end border-t border-border pt-5">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
