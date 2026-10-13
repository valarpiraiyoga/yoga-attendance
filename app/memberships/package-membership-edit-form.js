"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import StudentIdentityHeader from "@/components/ui/student-identity-header";
import { formatPeriod } from "@/lib/memberships/period";

/**
 * Edit Membership for a PACKAGE-LINKED membership (V1 Fee Structure, FS-6). Its package, duration or class allowance, start and
 * end or expiry date, standard fee, discounts and final agreed fee were agreed when it was created: they are not offered here,
 * and changing them is a separate, audited correction (FS-8) and the audited class-count expiry edit (FS-7). Only the notes
 * can be edited.
 *
 * This form is a convenience, not the protection: the server action `updatePackageMembershipNotes` writes the notes and nothing
 * else, `updateMembership` refuses a package-linked membership outright, and the database guard (migration 0048) refuses a change to
 * any of those columns whoever sends it.
 */
export default function PackageMembershipEditForm({ action, student, membership, submitLabel, pendingLabel, cancelHref }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [notes, setNotes] = useState(state?.values?.notes ?? membership.notes ?? "");
  const notesError = state?.fieldErrors?.notes;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state?.error && !notesError ? (
        <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {state.error}
        </p>
      ) : null}

      <StudentIdentityHeader student={student} membership={{ code: membership.membership_code, plan: membership.package_name }} />

      <div className="flex flex-col gap-1 rounded-card border border-border bg-background/60 p-4">
        <p className="text-body text-text-primary">
          {membership.package_name} · {formatPeriod(membership.start_date, membership.end_date)}
        </p>
        <p className="text-small text-text-secondary">
          The package, dates, fee and discounts were agreed when this membership was created and are shown on its details page. They
          cannot be edited here.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          disabled={isPending}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Enter any relevant notes (optional)"
          aria-invalid={Boolean(notesError)}
        />
        {notesError ? (
          <p role="alert" className="text-small text-danger">
            {notesError}
          </p>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-3 border-t border-border pt-5">
        <Button type="button" variant="outline" disabled={isPending} render={<Link href={cancelHref} />} nativeButton={false}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
