"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Info, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ContextCard from "@/components/ui/context-card";
import FormField from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { cancelPaymentDocument } from "@/lib/invoices/actions";

const REASON_MAX = 500;

/**
 * Cancel Document (migration 0055) - for an issued payment document. The Admin gives a reason and the document is cancelled:
 * it keeps its number and every detail, stays viewable marked Cancelled with the reason, and NO replacement is issued. The
 * payment and the membership are not changed, and the payment stays locked: to correct its details or amount, use Correct
 * Document instead. Cancelling is separate from correcting; it never reissues anything.
 *
 * Mirrors the other confirmation dialogs: the button only opens it, and the server action runs from Confirm inside
 * `startTransition`. The reason is required here and again in the action and the database. On success the page refreshes and
 * shows the cancelled document with its reason.
 */
export default function CancelDocument({ membershipId, documentId, title, number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();
  // A second click before the first request has finished must never send a second cancellation.
  const inFlight = useRef(false);

  function handleOpenChange(next) {
    if (!next && inFlight.current) return;
    setOpen(next);
    if (!next) {
      setReason("");
      setFieldError(null);
      setFormError(null);
    }
  }

  function runCancel() {
    if (inFlight.current) return;

    if (!reason.trim()) {
      setFieldError("Enter the reason for the cancellation.");
      return;
    }

    inFlight.current = true;
    setFieldError(null);
    setFormError(null);

    startTransition(async () => {
      try {
        const result = await cancelPaymentDocument(membershipId, documentId, reason);

        if (result?.error) {
          setFieldError(result.fieldErrors?.reason ?? null);
          setFormError(result.fieldErrors?.reason ? null : result.error);
          return;
        }

        inFlight.current = false;
        handleOpenChange(false);
        // The action has revalidated this page: it now shows the document as cancelled, with the reason.
        router.refresh();
      } catch {
        setFormError("Could not reach the server. Try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Ban className="size-4" aria-hidden="true" />
        Cancel Document
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        tone="warning"
        destructive
        title={`Cancel ${title} ${number}`}
        context={
          <ContextCard
            className="border-info/20 bg-info/5 p-4"
            mark={
              <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                <Receipt className="size-6" aria-hidden="true" />
              </span>
            }
            title={
              <>
                <span className="text-small block font-normal text-text-secondary">{title}</span>
                <span className="text-section-title block">{number}</span>
              </>
            }
            detail="It keeps its number and every detail."
          />
        }
        description={`${title} ${number} will be cancelled. It stays viewable, marked Cancelled with your reason, and keeps its number and every detail. No replacement is issued, and the payment and the membership are not changed. To correct details or the amount instead, use Correct Document. This cannot be undone.`}
        confirmLabel={
          <span className="inline-flex items-center gap-2">
            <Ban className="size-4" aria-hidden="true" />
            Cancel Document
          </span>
        }
        pendingLabel="Cancelling…"
        isPending={isPending}
        onConfirm={runCancel}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <FormField
            id="cancellation-reason"
            label="Reason for the cancellation"
            required
            error={fieldError}
            help={
              <span className="flex items-start justify-between gap-3">
                <span>Shown on the cancelled document. Up to {REASON_MAX} characters.</span>
                <span className="shrink-0 tabular-nums">
                  {reason.length}/{REASON_MAX}
                </span>
              </span>
            }
          >
            {(field) => (
              <Textarea
                {...field}
                required
                maxLength={REASON_MAX}
                disabled={isPending}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
              />
            )}
          </FormField>

          <div className="flex items-start gap-3 rounded-card border border-info/20 bg-info/5 px-4 py-3">
            <Info className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
            <p className="text-small text-text-secondary">
              This action cannot be undone. The {title.toLowerCase()} will remain in the system as Cancelled and can still be viewed later.
            </p>
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}
