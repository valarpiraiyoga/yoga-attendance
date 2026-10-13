"use client";

import { useState } from "react";
import { CalendarPlus, Pencil, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Alert from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { cancelFeeEntry, correctFeeEntry, editFeeEntry, scheduleFeeEntry } from "@/lib/packages/actions";
import { FEE_STATUS_LABELS, FEE_STATUS_VARIANTS, feeAmount, formatDiscount, formatFee, sortedDiscounts } from "@/lib/packages/labels";
import { feeEntryStatus } from "@/lib/packages/service-core";
import PackageContext from "@/app/settings/packages/package-context";
import { AmountField, DiscountFields, ReasonField, discountsInput, initialDiscountState } from "@/app/settings/packages/fee-fields";
import { usePackageAction } from "@/app/settings/packages/use-package-action";

const TODAY_HELP = "A fee dated today or earlier takes effect immediately.";

/**
 * One fee dialog for the three fee forms: Schedule (new entry), Edit (a scheduled entry, before it takes effect) and Correct
 * (the entry in effect: cancelled and replaced by a linked entry, with a required reason). `entry` is null when scheduling.
 */
function FeeDialog({ mode, pkg, entry, open, onOpenChange }) {
  const kind = pkg.kind;
  // Mounted fresh each time it opens (see FeeHistory), so the fields start from the entry.
  const [effectiveFrom, setEffectiveFrom] = useState(entry?.effective_from ?? "");
  const [amount, setAmount] = useState(entry ? String(feeAmount(entry)) : "");
  const [discounts, setDiscounts] = useState(() => initialDiscountState(entry?.package_fee_entry_discounts));
  const [reason, setReason] = useState("");
  const { error, fieldErrors, isPending, run } = usePackageAction(() => onOpenChange(false));

  const input = {
    effectiveFrom,
    amount,
    discounts: kind === "duration" ? discountsInput(discounts) : [],
    reason,
  };

  function submit() {
    if (mode === "schedule") return run(() => scheduleFeeEntry(pkg.id, input));
    if (mode === "edit") return run(() => editFeeEntry(entry.id, input));
    return run(() => correctFeeEntry(entry.id, { amount, discounts: input.discounts, reason }));
  }

  const copy = {
    schedule: {
      title: "Schedule fee",
      description: "Set the fee for memberships that start on or after the effective date. Existing memberships are never changed.",
      confirm: "Schedule Fee",
    },
    edit: {
      title: "Edit scheduled fee",
      description: "This fee has not taken effect yet, so it can be edited.",
      confirm: "Save Fee",
    },
    correct: {
      title: "Correct fee in effect",
      description:
        "The current entry is cancelled and replaced by a corrected entry with the same effective date. Both stay in the history. Memberships already created keep their agreed fees.",
      confirm: "Correct Fee",
    },
  }[mode];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      context={<PackageContext pkg={pkg} />}
      description={copy.description}
      confirmLabel={copy.confirm}
      isPending={isPending}
      onConfirm={submit}
    >
      <div className="flex flex-col gap-4 text-left">
        {error ? (
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        {mode === "correct" ? (
          <p className="text-body text-text-secondary">
            Effective {formatDate(entry.effective_from)} · current fee {formatFee(entry)}
          </p>
        ) : (
          <FormField id="fee-date" label="Effective from" error={fieldErrors.effectiveFrom} help={mode === "schedule" ? TODAY_HELP : "Must be after today."} required>
            {(field) => (
              <Input {...field} type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={isPending} />
            )}
          </FormField>
        )}
        <AmountField id="fee-amount" kind={kind} value={amount} onChange={setAmount} error={fieldErrors.amount} disabled={isPending} />
        {kind === "duration" ? <DiscountFields state={discounts} onChange={setDiscounts} errors={fieldErrors} disabled={isPending} /> : null}
        <ReasonField
          id="fee-reason"
          value={reason}
          onChange={setReason}
          error={fieldErrors.reason}
          disabled={isPending}
          required={mode === "correct"}
          help={mode === "correct" ? "Required. Kept in the package history." : "Optional."}
        />
      </div>
    </ConfirmDialog>
  );
}

/** Cancel a fee entry. A scheduled one needs no reason; one in effect does. */
function CancelDialog({ pkg, entry, inEffect, open, onOpenChange }) {
  const [reason, setReason] = useState("");
  const { error, fieldErrors, isPending, run } = usePackageAction(() => onOpenChange(false));

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel fee"
      context={<PackageContext pkg={pkg} />}
      description={
        inEffect
          ? "This fee is in effect. Cancelling it leaves the package without it from now on. Existing memberships keep their agreed fees."
          : "This fee has not taken effect yet. It stays in the history as cancelled."
      }
      tone="warning"
      destructive
      confirmLabel="Cancel Fee"
      isPending={isPending}
      onConfirm={() => run(() => cancelFeeEntry(entry.id, { reason }))}
    >
      <div className="flex flex-col gap-4 text-left">
        {error ? (
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        <p className="text-body text-text-secondary">
          Effective {formatDate(entry.effective_from)} · {formatFee(entry)}
        </p>
        <ReasonField
          id="cancel-reason"
          value={reason}
          onChange={setReason}
          error={fieldErrors.reason}
          disabled={isPending}
          required={inEffect}
          help={inEffect ? "Required for a fee in effect." : "Optional."}
        />
      </div>
    </ConfirmDialog>
  );
}

/** The fee history of a package: every entry (newest first), with its discounts, status and actions. */
export default function FeeHistory({ pkg, entries, today }) {
  // { mode: "schedule" | "edit" | "correct" | "cancel", entry }
  const [dialog, setDialog] = useState(null);
  const close = (open) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setDialog({ mode: "schedule", entry: null })}>
          <CalendarPlus className="size-4" aria-hidden="true" />
          Schedule Fee
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-body rounded-card border border-dashed border-border px-4 py-6 text-center text-text-secondary">
          No fee yet. Schedule a fee before memberships can be priced from this package.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Effective from</TableHead>
                <TableHead>{pkg.kind === "duration" ? "Monthly base fee" : "Price"}</TableHead>
                {pkg.kind === "duration" ? <TableHead>Package discounts</TableHead> : null}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const status = feeEntryStatus(entry, today);
                const entryDiscounts = sortedDiscounts(entry);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(entry.effective_from)}
                      {entry.corrects_entry_id ? <span className="text-small block text-text-secondary">Corrected entry</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatFee(entry)}</TableCell>
                    {pkg.kind === "duration" ? (
                      <TableCell>
                        {entryDiscounts.length === 0 ? (
                          <span className="text-text-secondary">None</span>
                        ) : (
                          <ul className="text-small flex flex-col gap-0.5">
                            {entryDiscounts.map((discount) => (
                              <li key={discount.duration_option}>
                                {discountLabel(discount)}: {formatDiscount(discount)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Badge variant={FEE_STATUS_VARIANTS[status]}>{FEE_STATUS_LABELS[status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {status === "scheduled" ? (
                          <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "edit", entry })}>
                            <Pencil className="size-4" aria-hidden="true" />
                            Edit
                          </Button>
                        ) : null}
                        {status === "in_effect" ? (
                          <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "correct", entry })}>
                            <Wrench className="size-4" aria-hidden="true" />
                            Correct
                          </Button>
                        ) : null}
                        {status !== "cancelled" ? (
                          <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "cancel", entry })}>
                            <X className="size-4" aria-hidden="true" />
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog && dialog.mode !== "cancel" ? (
        <FeeDialog key={`${dialog.mode}-${dialog.entry?.id ?? "new"}`} mode={dialog.mode} pkg={pkg} entry={dialog.entry} open onOpenChange={close} />
      ) : null}
      {dialog?.mode === "cancel" ? (
        <CancelDialog
          key={dialog.entry.id}
          pkg={pkg}
          entry={dialog.entry}
          inEffect={feeEntryStatus(dialog.entry, today) === "in_effect"}
          open
          onOpenChange={close}
        />
      ) : null}
    </>
  );
}

const DISCOUNT_LABEL = { quarterly: "Quarterly", half_yearly: "Half Yearly", annual: "Annual" };
function discountLabel(discount) {
  return DISCOUNT_LABEL[discount.duration_option] ?? discount.duration_option;
}
