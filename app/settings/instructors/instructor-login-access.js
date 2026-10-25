"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import Alert from "@/components/ui/alert";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { provideLoginAccess, provideTemporaryLoginAccess, resetInstructorPassword } from "@/lib/instructors/actions";
import { temporaryAccessBlocker } from "@/lib/instructors/temporary-access-rules";
import InstructorContext from "@/components/ui/instructor-context";
import TemporaryPasswordDialog from "@/app/settings/instructors/temporary-password-dialog";

/**
 * "Login Access" panel (02-ux.md Flow 12; 01-product.md §11).
 *
 * Kept separate from the Edit form on purpose: granting an account is a
 * distinct administrative act, not a field that gets saved along with a phone
 * number. Flow 12 orders it after Add/Edit and Set Active/Inactive.
 *
 * Two ways to give an instructor access, clearly separate:
 *   - Send Email Invitation - the existing flow: the instructor gets an email and sets their own password.
 *   - Generate Temporary Password - for when email is not practical: the admin is shown a generated password once, to hand over; the
 *     instructor must change it at first sign-in.
 * Once there is an account, Reset Password (after a confirmation) generates a new temporary password and the old one stops working.
 *
 * The server actions re-check every condition shown here - this component
 * only explains the state, it does not authorize anything. A generated
 * password is held in state only while its dialog is open.
 */

export default function InstructorLoginAccess({ instructor }) {
  const [state, formAction, isInviting] = useActionState(provideLoginAccess.bind(null, instructor.id), {});
  const [isWorking, startTransition] = useTransition();
  const [confirmReset, setConfirmReset] = useState(false);
  const [revealed, setRevealed] = useState(null); // { password, email, kind } - dropped when the dialog closes
  const [error, setError] = useState(null);

  const hasAccess = Boolean(instructor.user_id);
  const blocker = temporaryAccessBlocker(instructor, hasAccess ? "reset" : "create");
  const busy = isInviting || isWorking;

  function run(action, kind) {
    setError(null);
    startTransition(async () => {
      const result = await action(instructor.id);
      if (result?.error) {
        setError(result.error);
      } else if (result?.temporaryPassword) {
        setRevealed({ password: result.temporaryPassword, email: result.email ?? null, kind });
      }
      setConfirmReset(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-section-title font-semibold text-text-primary">Login Access</h2>
        <p className="text-body mt-1 text-text-secondary">
          {hasAccess
            ? "This instructor has an account and can sign in."
            : "Send an email invitation so this instructor can set a password and sign in, or generate a temporary password to hand over when email is not practical."}
        </p>
      </div>

      {state?.error || error ? (
        <p
          role="alert"
          className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
        >
          {error ?? state.error}
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

      {hasAccess ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || Boolean(blocker)}
            aria-describedby={blocker ? "login-access-blocker" : undefined}
            onClick={() => setConfirmReset(true)}
          >
            Reset Password
          </Button>
          <p className="text-small text-text-secondary">
            Generates a new temporary password. The current password stops working and the instructor must change the new one at the next sign-in.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <form action={formAction} className="flex flex-col items-start gap-2">
            <Button
              type="submit"
              disabled={busy || Boolean(blocker)}
              aria-describedby={blocker ? "login-access-blocker" : undefined}
            >
              {isInviting ? "Sending invitation…" : "Send Email Invitation"}
            </Button>
            <p className="text-small text-text-secondary">The instructor receives an email and chooses their own password.</p>
          </form>

          <div className="flex flex-col items-start gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || Boolean(blocker)}
              aria-describedby={blocker ? "login-access-blocker" : undefined}
              onClick={() => run(provideTemporaryLoginAccess, "created")}
            >
              {isWorking ? "Generating…" : "Generate Temporary Password"}
            </Button>
            <p className="text-small text-text-secondary">
              You will be shown a password once to share with the instructor. They must change it at first sign-in.
            </p>
          </div>
        </div>
      )}

      {blocker ? (
        <p id="login-access-blocker" className="text-small text-text-secondary">
          {blocker}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={(next) => {
          if (!isWorking) setConfirmReset(next);
        }}
        destructive
        context={<InstructorContext instructor={instructor} />}
        title="Reset this instructor's password?"
        description="A new temporary password will be generated. The instructor's current password will stop working immediately."
        confirmLabel="Reset Password"
        pendingLabel="Resetting…"
        isPending={isWorking}
        onConfirm={() => run(resetInstructorPassword, "reset")}
      >
        <Alert variant="warning">
          The new password is shown once. Share it securely - the instructor must change it at their next sign-in.
        </Alert>
      </ConfirmDialog>

      <TemporaryPasswordDialog
        instructor={instructor}
        open={Boolean(revealed)}
        password={revealed?.password ?? null}
        email={revealed?.email ?? null}
        kind={revealed?.kind ?? "created"}
        onClose={() => setRevealed(null)}
      />
    </div>
  );
}
