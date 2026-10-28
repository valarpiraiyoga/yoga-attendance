"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProfilePhoto } from "@/components/ui/profile-photo-field";
import ProfilePhotoCard from "@/components/ui/profile-photo-card";
import { Textarea } from "@/components/ui/textarea";
import HelpTip from "@/components/ui/help-tip";
import FormField from "@/components/ui/form-field";
import PhoneInput from "@/components/forms/PhoneInput";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PHONE_ERROR_KEYS, phoneErrorsOf } from "@/lib/phone";
import { firstInvalidStudentField, STUDENT_FIELD_ORDER, validateStudentInput } from "@/lib/students/validation";

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

const BLUR_VALIDATED_FIELDS = new Set([
  "full_name",
  "phone",
  "email",
  "date_of_birth",
  "join_date",
  "notes",
]);

/**
 * Shared Add/Edit Student form (wireframe p11, "Student Details" step).
 * Mirrors app/settings/instructors/instructor-form.js and
 * app/batches/batch-form.js exactly — see instructor-form.js's comment for
 * why `state.values` feeds `defaultValue` (react-dom's requestFormReset)
 * and why blur re-runs the same validator the server uses.
 *
 * No Status field here, unlike Instructor/Batch forms: 02-ux.md Flow 11
 * treats deactivation as its own explicit action (Review → Confirm → Save)
 * from Student Details, not a field on this form — see
 * app/students/[id]/student-status-button.js.
 *
 * The Profile Photo (optional) is the shared `ProfilePhotoField`. The chosen
 * file rides in the same form action as the other fields
 * (`useProfilePhoto().appendTo`), is only uploaded when the form is saved, and
 * a failed save keeps the selection.
 */
export default function StudentForm({ action, student, submitLabel, pendingLabel }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const formRef = useRef(null);
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [gender, setGender] = useState(student?.gender ?? "");
  const [fullName, setFullName] = useState(student?.full_name ?? "");
  // V1 Tax Adjustment: the student's default tax invoice choice - on unless turned off.
  const [taxInvoiceDefault, setTaxInvoiceDefault] = useState(
    state?.values?.tax_invoice_default != null ? state.values.tax_invoice_default !== "0" : student?.tax_invoice_default ?? true
  );
  const { photo, setPhoto, appendTo } = useProfilePhoto();

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  // React resets the form's DOM inputs when an action runs, so the photo
  // (kept in state, not in a named input) is added to the submission here.
  function submitForm(formData) {
    appendTo(formData);
    formAction(formData);
  }

  function studentInputOf(formData) {
    return {
      full_name: formData.get("full_name"),
      phone: formData.get("phone"),
      phone_country_code: formData.get("phone_country_code"),
      email: formData.get("email"),
      date_of_birth: formData.get("date_of_birth"),
      gender: formData.get("gender"),
      join_date: formData.get("join_date"),
      notes: formData.get("notes"),
    };
  }

  // Replaces the phone field's errors (the number's and its country code's) with `phoneErrors`.
  function showPhoneErrors(phoneErrors) {
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of PHONE_ERROR_KEYS) delete next[key];
      return { ...next, ...phoneErrors };
    });
  }

  // The phone number is judged against its selected country (lib/phone.js), by the same validator the server runs. A
  // number that has been typed is judged now, on blur and when the country changes; an empty one is left for submit
  // (it is required) and keeps whatever the server last said.
  function recheckPhone(formData) {
    if (!String(formData.get("phone") ?? "").trim()) return;
    const result = validateStudentInput(studentInputOf(formData));
    showPhoneErrors(phoneErrorsOf(result.errors));
  }

  function handleCountryChange(dialCode) {
    const formData = new FormData(formRef.current);
    // The hidden code input still holds the old country until the picker re-renders.
    formData.set("phone_country_code", dialCode);
    recheckPhone(formData);
  }

  // Any error the validator finds - a missing Full Name, Phone or Join Date, a phone that is not a real number for its
  // country, a bad email - stops the submission here, and ALL of them are shown at once with the first invalid field
  // focused. Calling preventDefault in onSubmit makes React skip the form action (react-dom, FormActionEventPlugin: it
  // runs the action only when the submit was not prevented), so nothing is sent, the form is NOT reset and the typed
  // values stay. It is the validator the server runs; the server still checks again, and alone reports the photo.
  function handleSubmit(event) {
    const result = validateStudentInput(studentInputOf(new FormData(event.currentTarget)));
    if (result.success) return;

    event.preventDefault();
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of [...STUDENT_FIELD_ORDER, "phone_country_code"]) delete next[key];
      return { ...next, ...result.errors };
    });
    event.currentTarget.querySelector(`#${firstInvalidStudentField(result.errors)}`)?.focus();
  }

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    if (name === "phone") {
      recheckPhone(formData);
      return;
    }
    const result = validateStudentInput(studentInputOf(formData));

    // A valid recheck clears the field's stale error.
    setFieldErrors((current) => {
      const stale = [name].filter((key) => key in current && (result.success || !result.errors[key]));
      if (stale.length === 0) return current;
      const next = { ...current };
      for (const key of stale) delete next[key];
      return next;
    });
  }

  const cancelHref = student ? `/students/${student.id}` : "/students";

  return (
    <form ref={formRef} action={submitForm} onSubmit={handleSubmit} onBlur={handleBlur} className="flex flex-col gap-5" noValidate>
      {/* Edit only: says which student this is (the SAVED name and ID, not what is typed below). */}
      {student ? <StudentIdentityHeader student={student} /> : null}

      {state?.error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <h2 className="text-section-title font-semibold text-text-primary">Student Details</h2>
        <div className="flex items-center gap-2">
          <Label id="tax_invoice_default-label">Issue tax invoice by default</Label>
          <HelpTip label="About the tax invoice default">
            Used as the starting choice when a payment is recorded. It can be changed for one payment without changing this setting.
          </HelpTip>
          <Switch
            name="tax_invoice_default"
            value="1"
            uncheckedValue="0"
            checked={taxInvoiceDefault}
            onCheckedChange={setTaxInvoiceDefault}
            disabled={isPending}
            aria-labelledby="tax_invoice_default-label"
          />
        </div>
      </div>

      {/* The photo is its own compact left card (a portrait photo, full-width buttons inside it); every other field sits to its right. */}
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
      <ProfilePhotoCard
        name={fullName}
        currentUrl={student?.photo_url ?? null}
        photo={photo}
        onChange={setPhoto}
        error={fieldErrors.photo}
        disabled={isPending}
      />

      <div className="flex min-w-0 flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="full_name">Full Name</Label>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            required
            disabled={isPending}
            defaultValue={state?.values?.full_name ?? student?.full_name ?? ""}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Enter student's full name"
            aria-invalid={Boolean(fieldErrors.full_name)}
            aria-describedby={fieldErrors.full_name ? "full_name-error" : undefined}
          />
          {fieldErrors.full_name ? (
            <p id="full_name-error" role="alert" className="text-small text-danger">
              {fieldErrors.full_name}
            </p>
          ) : null}
        </div>

        <FormField id="phone" label="Phone" error={fieldErrors.phone ?? fieldErrors.phone_country_code}>
          {(field) => (
            <PhoneInput
              {...field}
              name="phone"
              required
              disabled={isPending}
              defaultValue={state?.values?.phone ?? student?.phone ?? ""}
              defaultCountryCode={state?.values?.phone_country_code ?? student?.phone_country_code ?? undefined}
              onCountryChange={handleCountryChange}
              placeholder="Enter phone number"
            />
          )}
        </FormField>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            disabled={isPending}
            defaultValue={state?.values?.email ?? student?.email ?? ""}
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="gender">Gender</Label>
          <Select
            name="gender"
            items={GENDER_OPTIONS}
            value={gender}
            onValueChange={setGender}
            disabled={isPending}
          >
            <SelectTrigger id="gender">
              <SelectValue placeholder="Select gender (optional)" />
            </SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.gender ? (
            <p role="alert" className="text-small text-danger">
              {fieldErrors.gender}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="date_of_birth">Date of Birth</Label>
          <Input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            disabled={isPending}
            defaultValue={state?.values?.date_of_birth ?? student?.date_of_birth ?? ""}
            aria-invalid={Boolean(fieldErrors.date_of_birth)}
            aria-describedby={fieldErrors.date_of_birth ? "date_of_birth-error" : undefined}
          />
          {fieldErrors.date_of_birth ? (
            <p id="date_of_birth-error" role="alert" className="text-small text-danger">
              {fieldErrors.date_of_birth}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="join_date">Join Date</Label>
          <Input
            id="join_date"
            name="join_date"
            type="date"
            required
            disabled={isPending}
            defaultValue={state?.values?.join_date ?? student?.join_date ?? ""}
            aria-invalid={Boolean(fieldErrors.join_date)}
            aria-describedby={fieldErrors.join_date ? "join_date-error" : undefined}
          />
          {fieldErrors.join_date ? (
            <p id="join_date-error" role="alert" className="text-small text-danger">
              {fieldErrors.join_date}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          disabled={isPending}
          defaultValue={state?.values?.notes ?? student?.notes ?? ""}
          placeholder="Enter any relevant notes (optional)"
          aria-invalid={Boolean(fieldErrors.notes)}
          aria-describedby={fieldErrors.notes ? "notes-error" : undefined}
        />
        {fieldErrors.notes ? (
          <p id="notes-error" role="alert" className="text-small text-danger">
            {fieldErrors.notes}
          </p>
        ) : null}
      </div>
      </div>
      </div>

      <div className="mt-2 flex justify-end gap-3 border-t border-border pt-5">
        <Button
          type="button"
          variant="secondary"
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
