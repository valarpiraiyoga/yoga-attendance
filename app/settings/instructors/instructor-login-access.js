"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { provideLoginAccess } from "@/lib/instructors/actions";

/**
 * "Provide Login Access" panel (02-ux.md Flow 12; 01-product.md §11).
 *
 * Kept separate from the Edit form on purpose: granting an account is a
 * distinct administrative act, not a field that gets saved along with a phone
 * number. Flow 12 orders it after Add/Edit and Set Active/Inactive.
 *
 * The server action re-checks every condition shown here — this component
 * only explains the state, it does not authorize anything.
 */

function loginAccessBlocker(instructor) {
  if (instructor.status !== "active") {
    return "Activate this instructor before providing login access.";
  }
  if (!instructor.email) {
    return "Add an email address for this instructor before providing login access.";
  }
  return null;
}

export default function InstructorLoginAccess({ instructor }) {
  const [state, formAction, isPending] = useActionState(
    provideLoginAccess.bind(null, instructor.id),
    {}
  );

  const hasAccess = Boolean(instructor.user_id);
  const blocker = hasAccess ? null : loginAccessBlocker(instructor);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-section-title font-semibold text-text-primary">Login Access</h2>
        <p className="text-body mt-1 text-text-secondary">
          {hasAccess
            ? "This instructor has an account and can sign in."
            : "Send an email invitation so this instructor can set a password and sign in."}
        </p>
      </div>

      {state?.error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state?.success ? (
        <p
          role="status"
          className="text-body rounded-input border border-success/30 bg-success/5 px-3 py-2 text-success"
        >
          {state.success}
        </p>
      ) : null}

      {hasAccess ? null : (
        <form action={formAction} className="flex flex-col items-start gap-2">
          <Button
            type="submit"
            disabled={isPending || Boolean(blocker)}
            aria-describedby={blocker ? "login-access-blocker" : undefined}
          >
            {isPending ? "Sending invitation…" : "Provide Login Access"}
          </Button>
          {blocker ? (
            <p id="login-access-blocker" className="text-small text-text-secondary">
              {blocker}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
