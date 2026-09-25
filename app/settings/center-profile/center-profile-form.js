"use client";

import { useActionState, useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/form-field";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { useProfilePhoto } from "@/components/ui/profile-photo-field";
import ProfilePhotoCard from "@/components/ui/profile-photo-card";
import TimeZoneSelect from "@/components/forms/TimeZoneSelect";
import CurrencySelect from "@/components/forms/CurrencySelect";
import { validateCenterProfileInput } from "@/lib/center-profile/validation";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";
import { DEFAULT_CURRENCY } from "@/lib/currencies";

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
 * Regional Settings (time zone, currency) sit beneath the centre's details
 * and are real settings, not display: the whole app reads them
 * (`getCenterSettings`, lib/center-profile/settings.js). The Logo panel is the
 * upload control for `center_profile.logo_url`, reusing the photo field the
 * Student, Instructor and Batch forms use (Upload / Change / Remove, validated
 * and previewed locally, uploaded with the form). The reference's Website
 * field has no column and is not shown.
 */
export default function CenterProfileForm({ action, profile }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const { photo: logo, setPhoto: setLogo, appendTo } = useProfilePhoto();

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  // React resets the form's DOM inputs when an action runs, so the logo (kept
  // in state, not in a named input) is added to the submission here. It is
  // uploaded by the server action, and only when the form saves.
  function submitForm(formData) {
    appendTo(formData);
    formAction(formData);
  }

  function handleReset() {
    setFieldErrors({});
    setLogo({ file: null, previewUrl: null, removed: false });
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
      timezone: formData.get("timezone"),
      currency: formData.get("currency"),
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
      action={submitForm}
      onBlur={handleBlur}
      onReset={handleReset}
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
        <div className="flex flex-col gap-6 lg:col-span-3">
        <Panel className="flex flex-col gap-5">
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

        <Panel className="flex flex-col gap-5">
          <PanelHeader
            className="mb-0"
            title="Regional Settings"
            description="The center's time zone and currency, used across the application."
          />

          <FormField
            id="timezone"
            label="Time Zone"
            error={fieldErrors.timezone}
            help="Session dates, Today and membership validity follow this time zone, whatever a user's own device is set to."
          >
            {(field) => (
              <TimeZoneSelect
                {...field}
                disabled={isPending}
                defaultValue={state?.values?.timezone ?? profile?.timezone ?? DEFAULT_TIMEZONE}
              />
            )}
          </FormField>

          <FormField
            id="currency"
            label="Currency"
            error={fieldErrors.currency}
            help="Amounts are shown in this currency, and new memberships are priced in it. Existing amounts are never converted."
          >
            {(field) => (
              <CurrencySelect
                {...field}
                disabled={isPending}
                defaultValue={state?.values?.currency ?? profile?.currency ?? DEFAULT_CURRENCY}
              />
            )}
          </FormField>
        </Panel>
        </div>

        <ProfilePhotoCard
          name={profile?.name ?? ""}
          label="Center Logo"
          noun="Logo"
          description="This logo is used in the application and on receipts."
          currentUrl={profile?.logo_url ?? null}
          photo={logo}
          onChange={setLogo}
          error={fieldErrors.photo}
          disabled={isPending}
          fit="contain"
          className="w-full self-start lg:col-span-2"
        />
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
