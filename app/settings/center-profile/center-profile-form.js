"use client";

import { useActionState, useState } from "react";
import { ImageIcon, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/form-field";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { validateCenterProfileInput } from "@/lib/center-profile/validation";

const BLUR_VALIDATED_FIELDS = new Set(["name", "address", "phone", "email"]);

/**
 * Center Profile form (Settings — Phase 19; `01-product.md` §11; wireframe
 * p.38; `18 Settings center profile.png`): the center's details on the left
 * (name, address, phone, email), the Logo panel on the right, and the
 * Cancel / Save Changes actions below — stacked on narrow screens.
 *
 * Mirrors `app/batches/batch-form.js`'s shape exactly: `useActionState`,
 * blur-driven stale-error clearing using the same pure validator the
 * server runs, `state.values` for redisplaying a failed submission (see
 * that file's comment for why — react-dom's `requestFormReset` resets every
 * uncontrolled field on each form-action submission, regardless of
 * outcome).
 *
 * Cancel is the form's native reset: it discards unsaved edits back to the
 * values the form was rendered with (and clears any shown field errors). It
 * navigates nowhere and saves nothing — there is no separate view mode to
 * return to.
 *
 * No Logo upload control: no upload mechanism exists yet (no Storage
 * bucket, no upload UI) — deferred, matching how Instructor Photo and
 * Student Profile Photo were both explicitly deferred. The Logo panel keeps
 * the reference's position and says so plainly. `center_profile.logo_url`
 * exists in the schema for forward compatibility only
 * (0018_center_profile.sql). The reference's Website and Time Zone fields
 * have no column in that schema either and are not shown.
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
    <form
      action={formAction}
      onBlur={handleBlur}
      onReset={() => setFieldErrors({})}
      className="flex flex-col gap-6"
      noValidate
    >
      {state?.error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="flex flex-col gap-5 lg:col-span-3">
          <FormField id="name" label="Yoga Center Name" required error={fieldErrors.name}>
            {(field) => (
              <Input
                {...field}
                name="name"
                autoComplete="off"
                required
                disabled={isPending}
                defaultValue={state?.values?.name ?? profile?.name ?? ""}
                placeholder="Enter the center's name"
              />
            )}
          </FormField>

          <FormField id="address" label="Address" error={fieldErrors.address}>
            {(field) => (
              <Textarea
                {...field}
                name="address"
                rows={4}
                disabled={isPending}
                defaultValue={state?.values?.address ?? profile?.address ?? ""}
                placeholder="Enter the center's address (optional)"
              />
            )}
          </FormField>

          <FormField id="phone" label="Phone" error={fieldErrors.phone}>
            {(field) => (
              <Input
                {...field}
                name="phone"
                type="tel"
                autoComplete="off"
                disabled={isPending}
                defaultValue={state?.values?.phone ?? profile?.phone ?? ""}
                placeholder="Enter phone number (optional)"
              />
            )}
          </FormField>

          <FormField id="email" label="Email" error={fieldErrors.email}>
            {(field) => (
              <Input
                {...field}
                name="email"
                type="email"
                autoComplete="off"
                disabled={isPending}
                defaultValue={state?.values?.email ?? profile?.email ?? ""}
                placeholder="Enter email address (optional)"
              />
            )}
          </FormField>
        </Panel>

        <Panel className="self-start lg:col-span-2">
          <PanelHeader title="Logo" description="This logo will be used in the application and exported reports." />
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand"
            >
              <ImageIcon className="size-5" aria-hidden="true" />
            </span>
            <p className="text-body text-text-secondary">
              Not available yet — logo upload is part of a later phase.
            </p>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small inline-flex items-start gap-2 text-text-secondary">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Center information may appear in exported attendance reports.
        </p>

        <div className="flex justify-end gap-3">
          <Button type="reset" variant="outline" disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
