"use client";

import { useCallback, useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import FormField, { FormActions } from "@/components/ui/form-field";
import PasswordInput from "@/components/ui/password-input";
import Toast from "@/components/ui/toast";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { changePassword } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH, validatePasswordChange } from "@/lib/auth/password-rules";

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };
const IDS = {
  currentPassword: "current-password",
  newPassword: "new-password",
  confirmPassword: "confirm-new-password",
};
// The order the fields appear in, so an error moves focus to the first one that needs attention.
const FIELD_ORDER = ["currentPassword", "newPassword", "confirmPassword"];

/**
 * Settings -> Reset Password: the signed-in user changes their OWN password. The card is a plain Settings panel
 * (icon, title, one-line description), three password fields with the shared show / hide control, and the
 * usual right-aligned action row.
 *
 * The browser checks required fields, the minimum length and that the two new entries match, using the same
 * rules module as the server, so the person gets the message beside the field at once. That check is a
 * convenience only: `changePassword` (lib/auth/actions.js) validates again, verifies the current password with
 * Supabase Auth and changes the password of the signed-in user, and nothing else.
 *
 * The form stays on the page. A wrong current password, a rule the server enforces, or any failure is shown
 * here as a message (never technical detail); success shows the standard toast and empties the three fields.
 * Fields are controlled so what the person typed survives a failed attempt, and the passwords are never put in
 * a URL, storage or a log.
 */
export default function ResetPasswordCard() {
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [toast, setToast] = useState(null);
  const [isPending, startTransition] = useTransition();
  const dismissToast = useCallback(() => setToast(null), []);

  function handleChange(field) {
    return (event) => {
      const { value } = event.target;
      setValues((previous) => ({ ...previous, [field]: value }));
      setFieldErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
      setFormError(null);
    };
  }

  function focusFirstError(errors) {
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) document.getElementById(IDS[first])?.focus();
  }

  function handleSubmit(event) {
    event.preventDefault();

    const { valid, fieldErrors: found } = validatePasswordChange(values);
    if (!valid) {
      setFieldErrors(found);
      setFormError(null);
      focusFirstError(found);
      return;
    }

    setFieldErrors({});
    setFormError(null);

    startTransition(async () => {
      const formData = new FormData();
      for (const field of FIELD_ORDER) formData.set(field, values[field]);

      const result = await changePassword({}, formData);

      if (result?.success) {
        setValues(EMPTY);
        setToast({ text: result.success, tone: "success" });
        return;
      }

      const errors = result?.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(result?.error ?? null);
      focusFirstError(errors);
    });
  }

  return (
    <Panel>
      <PanelHeader
        icon={KeyRound}
        title="Reset Password"
        description="Change your account password to keep your account secure."
        className="mb-4"
      />

      <form onSubmit={handleSubmit} noValidate className="grid gap-5 sm:grid-cols-2">
        {formError ? (
          <p
            role="alert"
            className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger sm:col-span-2"
          >
            {formError}
          </p>
        ) : null}

        <FormField
          id={IDS.currentPassword}
          label="Current Password"
          required
          error={fieldErrors.currentPassword}
          className="sm:col-span-2 sm:max-w-sm"
        >
          {(field) => (
            <PasswordInput
              {...field}
              name="currentPassword"
              autoComplete="current-password"
              placeholder="Enter your current password"
              value={values.currentPassword}
              onChange={handleChange("currentPassword")}
              disabled={isPending}
            />
          )}
        </FormField>

        <FormField
          id={IDS.newPassword}
          label="New Password"
          required
          error={fieldErrors.newPassword}
          help={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        >
          {(field) => (
            <PasswordInput
              {...field}
              name="newPassword"
              autoComplete="new-password"
              placeholder="Enter a new password"
              value={values.newPassword}
              onChange={handleChange("newPassword")}
              disabled={isPending}
            />
          )}
        </FormField>

        <FormField id={IDS.confirmPassword} label="Confirm New Password" required error={fieldErrors.confirmPassword}>
          {(field) => (
            <PasswordInput
              {...field}
              name="confirmPassword"
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              value={values.confirmPassword}
              onChange={handleChange("confirmPassword")}
              disabled={isPending}
            />
          )}
        </FormField>

        <FormActions className="sm:col-span-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Updating…" : "Reset Password"}
          </Button>
        </FormActions>
      </form>

      <Toast message={toast?.text} tone={toast?.tone} onDismiss={dismissToast} />
    </Panel>
  );
}
