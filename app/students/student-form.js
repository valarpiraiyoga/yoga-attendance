"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ProfilePhotoField, { useProfilePhoto } from "@/components/ui/profile-photo-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateStudentInput } from "@/lib/students/validation";

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
 * app/students/[id]/deactivate-student.js.
 *
 * The Profile Photo (optional) is the shared `ProfilePhotoField`. The chosen
 * file rides in the same form action as the other fields
 * (`useProfilePhoto().appendTo`), is only uploaded when the form is saved, and
 * a failed save keeps the selection.
 */
export default function StudentForm({ action, student, submitLabel, pendingLabel }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [gender, setGender] = useState(student?.gender ?? "");
  const [fullName, setFullName] = useState(student?.full_name ?? "");
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

  function handlePhoneInput(event) {
    event.target.value = event.target.value.replace(/\D/g, "");
  }

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const formData = new FormData(event.currentTarget);
    const result = validateStudentInput({
      full_name: formData.get("full_name"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      date_of_birth: formData.get("date_of_birth"),
      gender: formData.get("gender"),
      join_date: formData.get("join_date"),
      notes: formData.get("notes"),
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

  const cancelHref = student ? `/students/${student.id}` : "/students";

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

      <ProfilePhotoField
        name={fullName}
        currentUrl={student?.photo_url ?? null}
        photo={photo}
        onChange={setPhoto}
        error={fieldErrors.photo}
        disabled={isPending}
      />

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

        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="tel"
            required
            disabled={isPending}
            defaultValue={state?.values?.phone ?? student?.phone ?? ""}
            onChange={handlePhoneInput}
            placeholder="Enter phone number"
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
