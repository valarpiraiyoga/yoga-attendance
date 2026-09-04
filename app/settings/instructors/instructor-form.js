"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { validateInstructorInput } from "@/lib/instructors/validation";

// The three text fields a blur can revalidate. Status is a binary switch,
// not a free-text field a user retypes and re-checks, so it is out of scope
// for this fix.
const BLUR_VALIDATED_FIELDS = new Set(["full_name", "email", "phone"]);

/**
 * Shared Add/Edit Instructor form (wireframe p11 "Add Student" is the
 * closest approved reference for an entity-creation form's structure; no
 * dedicated Instructor form wireframe exists).
 *
 * Status is edit-only: `instructor` being present is what signals edit mode
 * (also used for the other fields' pre-population), so the Status field is
 * gated on it rather than a separate mode prop. A new instructor has no
 * status to choose — it always starts active via the database default.
 *
 * All validation rules live in lib/instructors/validation.js. `action` runs
 * them server-side and is the source of truth for every submit. This
 * component also imports the same pure validator to clear a field's stale
 * error on blur once its current value is valid (see `handleBlur`) — a UX
 * nicety, not a second, independent validation path.
 *
 * `defaultValue` on the three text fields reads `state.values` first: React
 * resets every uncontrolled field to its current `defaultValue` on every
 * form-action submission, before the action even runs (react-dom's
 * requestFormReset) — so after a failed submit, without this, the fields
 * would snap back to `instructor`'s original values (or blank, when adding)
 * instead of showing back what was just typed. `action` returns exactly
 * what was submitted for this reason; see lib/instructors/actions.js.
 */
export default function InstructorForm({ action, instructor, submitLabel, pendingLabel }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [isActive, setIsActive] = useState(instructor?.status === "active");

  // The server's verdict is authoritative and wins on every submission — this
  // only resyncs to it, it never overrides it. Adjusted during render (React's
  // documented pattern for resetting state when a value changes) rather than
  // in an effect, so the stale error never has a chance to paint. Blur-driven
  // clearing below only ever acts between submissions.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  // Strips anything but digits from the Phone field as it changes — typed,
  // pasted, dropped, or autofilled all fire the same input event, so one
  // handler covers every source. The field stays uncontrolled (no `value`
  // prop); this only corrects the DOM value already there, the same way a
  // native constraint would, without introducing a phone-formatting library.
  // Not a replacement for server-side validation: a request built without a
  // browser never runs this at all, which is exactly why
  // lib/instructors/validation.js checks the digit format too.
  function handlePhoneInput(event) {
    event.target.value = event.target.value.replace(/\D/g, "");
  }

  // Lightweight UX-only recheck: reuses the same validator the server runs
  // (lib/instructors/validation.js) to clear one field's stale error once
  // its current value is actually valid — it introduces no second set of
  // validation rules, and never invents an error the server didn't already
  // report. The server still re-validates authoritatively on submit.
  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateInstructorInput({
      full_name: formData.get("full_name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
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
        <Label htmlFor="full_name">Full Name</Label>
        <Input
          id="full_name"
          name="full_name"
          autoComplete="name"
          required
          disabled={isPending}
          defaultValue={state?.values?.full_name ?? instructor?.full_name ?? ""}
          placeholder="Enter instructor's full name"
          aria-invalid={Boolean(fieldErrors.full_name)}
          aria-describedby={fieldErrors.full_name ? "full_name-error" : undefined}
        />
        {fieldErrors.full_name ? (
          <p id="full_name-error" role="alert" className="text-small text-danger">
            {fieldErrors.full_name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="tel"
          disabled={isPending}
          defaultValue={state?.values?.phone ?? instructor?.phone ?? ""}
          onChange={handlePhoneInput}
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
          autoComplete="email"
          disabled={isPending}
          defaultValue={state?.values?.email ?? instructor?.email ?? ""}
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

      {instructor ? (
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
          render={<Link href="/settings/instructors" />}
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
