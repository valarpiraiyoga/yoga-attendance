"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ContextCard from "@/components/ui/context-card";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { updateInvoiceDetails } from "@/lib/invoices/actions";
import { initialEditValues, submitInvoiceEdit } from "@/lib/invoices/edit-invoice";

/**
 * Edit Invoice - the one direct edit an issued invoice allows: its number and its date. Nothing else is
 * on the form, and nothing else is sent. The amount, plan and period are not edited here: they follow the
 * membership (migration 0030). The prefix, tax terms, customer, business details, terms, signatory, bank
 * details and payment date are a historical snapshot the database will not let change.
 *
 * Built like the Issue Invoice dialog: the button only opens the
 * dialog, and `updateInvoiceDetails` (called directly inside `startTransition`) runs only from
 * Save. The dialog always opens with the invoice's CURRENT stored values; Cancel discards what was
 * typed. Every rule about the number and the date is the database's - its message is shown against
 * the field - and a saved edit refreshes this page from the stored invoice, so the new number and
 * date show at once. The edit never rebuilds the snapshot.
 *
 * `initial` is `editInvoiceInitial(invoice)` (lib/invoices/edit-invoice.js); `title` and `number` are
 * the document's own display strings (for the context card only).
 */
export default function EditInvoice({ initial, title, number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => initialEditValues(initial));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next) {
    if (isPending) return;
    // Opening and closing both start from the stored values: nothing typed or reported before is carried over.
    setValues(initialEditValues(initial));
    setFieldErrors({});
    setFormError(null);
    setOpen(next);
  }

  function setField(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function save() {
    if (isPending) return;

    startTransition(async () => {
      const outcome = await submitInvoiceEdit(values, (input) => updateInvoiceDetails(initial.id, input));

      if (outcome.status === "saved") {
        setOpen(false);
        router.refresh();
        return;
      }
      setFieldErrors(outcome.fields ?? {});
      setFormError(outcome.formError ?? null);
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => handleOpenChange(true)}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Edit invoice"
        context={
          <ContextCard
            mark={
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Receipt className="size-5" aria-hidden="true" />
              </span>
            }
            title={`${title} ${number}`}
            detail={initial.prefix ? `Prefix ${initial.prefix} stays as issued` : null}
          />
        }
        description="Only the number and the date can be changed here. The amount, plan and dates follow the membership; the number stays assigned to it."
        confirmLabel="Save Changes"
        isPending={isPending}
        onConfirm={save}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <FormField id="edit-number" label="Invoice number" required error={fieldErrors.number}>
            {(field) => (
              <Input
                {...field}
                inputMode="numeric"
                autoComplete="off"
                required
                disabled={isPending}
                value={values.invoiceNumber}
                onChange={(event) => setField("invoiceNumber", event.target.value)}
              />
            )}
          </FormField>

          <FormField id="edit-date" label="Invoice date" required error={fieldErrors.date}>
            {(field) => (
              <Input
                {...field}
                type="date"
                required
                disabled={isPending}
                value={values.invoiceDate}
                onChange={(event) => setField("invoiceDate", event.target.value)}
              />
            )}
          </FormField>
        </div>
      </ConfirmDialog>
    </>
  );
}
