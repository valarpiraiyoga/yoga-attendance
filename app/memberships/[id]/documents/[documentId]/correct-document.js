"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePen, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ContextCard from "@/components/ui/context-card";
import FormField from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { correctPaymentDocument } from "@/lib/invoices/actions";

const REASON_MAX = 500;

/**
 * Correct Document (V1 Tax Adjustment, Step 6) - for an issued payment document. The Admin gives a reason;
 * the database then cancels this document (it keeps its number and stays viewable as Cancelled) and issues
 * its replacement with a new number from the same series, in one transaction. On success the replacement
 * is opened.
 *
 * Mirrors the other confirmation dialogs: the button only opens it, and the action runs from Confirm inside
 * `startTransition`. The reason is required here and again in the database.
 */
export default function CorrectDocument({ membershipId, documentId, title, number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next) {
    setOpen(next);
    if (!next) {
      setReason("");
      setFieldError(null);
      setFormError(null);
    }
  }

  function runCorrect() {
    if (!reason.trim()) {
      setFieldError("Enter the reason for the correction.");
      return;
    }

    startTransition(async () => {
      const result = await correctPaymentDocument(membershipId, documentId, reason);

      if (result?.error) {
        setFieldError(result.fieldErrors?.reason ?? null);
        setFormError(result.fieldErrors?.reason ? null : result.error);
        return;
      }

      handleOpenChange(false);
      router.push(`/memberships/${membershipId}/documents/${result.invoiceId}`);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FilePen className="size-4" aria-hidden="true" />
        Correct Document
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        tone="warning"
        title={`Correct ${title} ${number}`}
        context={
          <ContextCard
            mark={
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Receipt className="size-5" aria-hidden="true" />
              </span>
            }
            title={`${title} ${number}`}
            detail="Its number stays with it; the replacement gets a new one."
          />
        }
        description={`${title} ${number} will be cancelled - it keeps its number and stays viewable - and a replacement will be issued with a new number from the same series. This cannot be undone.`}
        confirmLabel="Cancel and Reissue"
        pendingLabel="Correcting…"
        isPending={isPending}
        onConfirm={runCorrect}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <FormField id="correction-reason" label="Reason for the correction" required error={fieldError} help={`Shown on the cancelled document. Up to ${REASON_MAX} characters.`}>
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
        </div>
      </ConfirmDialog>
    </>
  );
}
