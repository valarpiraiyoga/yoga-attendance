"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import { Info, Lock, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ContextCard from "@/components/ui/context-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import FormField from "@/components/ui/form-field";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { useProfilePhoto } from "@/components/ui/profile-photo-field";
import ProfilePhotoCard from "@/components/ui/profile-photo-card";
import { parseTaxEnabled, validateInvoiceSettingsInput } from "@/lib/invoice-settings/validation";

// Below `sm` the help popover opens above its (i) rather than below it. `matchMedia` has no server
// value, so the server (and first client) render use the desktop placement (the same approach as
// the Students and Memberships search hints).
const NARROW_QUERY = "(max-width: 639px)";
function subscribeNarrow(callback) {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getNarrow = () => window.matchMedia(NARROW_QUERY).matches;
const getNarrowServer = () => false;

const DOCUMENT_TITLE_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "receipt", label: "Receipt" },
];

const BLUR_VALIDATED_FIELDS = new Set([
  "starting_invoice_number",
  "invoice_prefix",
  "payment_receipt_starting_number",
  "payment_receipt_prefix",
  "tax_name",
  "tax_rate",
  "terms",
  "signatory_name",
  "signatory_designation",
]);

// What the form submits, as the validator's input.
function readInput(formData) {
  return {
    document_title: formData.get("document_title"),
    starting_invoice_number: formData.get("starting_invoice_number"),
    invoice_prefix: formData.get("invoice_prefix"),
    payment_receipt_starting_number: formData.get("payment_receipt_starting_number") ?? undefined,
    payment_receipt_prefix: formData.get("payment_receipt_prefix") ?? undefined,
    tax_enabled: formData.get("tax_enabled"),
    tax_name: formData.get("tax_name"),
    tax_rate: formData.get("tax_rate"),
    terms: formData.get("terms"),
    signatory_name: formData.get("signatory_name"),
    signatory_designation: formData.get("signatory_designation"),
  };
}

/**
 * Progressive help: a small (i) button that opens a compact popover with a title, the
 * explanation and a close (x) control. Closed by default, so the form shows only what is
 * needed to fill it in; after closing, the (i) stays and opens it again. Both buttons are
 * `type="button"` and the popover is portalled outside the form, so it cannot submit or
 * otherwise affect the form. Explanations are muted text, never red - red is for errors.
 */
function HelpPopover({ label, title, children }) {
  const [open, setOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribeNarrow, getNarrow, getNarrowServer);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-text-secondary outline-none transition-colors hover:bg-neutral/10 hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        <Info className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      {/* Desktop: below the (i), as before. Phone: above it (it flips below if there is no room), so the
          field being explained stays in view; the side margins keep it clear of the screen edges. */}
      <PopoverContent
        align="start"
        side={narrow ? "top" : "bottom"}
        className="max-sm:mx-4 max-sm:max-w-[calc(100vw-4.5rem)]"
      >
        <div className="flex items-start justify-between gap-3">
          <PopoverTitle>{title}</PopoverTitle>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="-mt-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-text-secondary outline-none transition-colors hover:bg-neutral/10 hover:text-text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-small mt-1 text-text-secondary">{children}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Invoice / Receipt Settings form (V1 Invoice / Receipt Enhancement, Phase 3):
 * Document, Tax and Document Content panels on the left and the Signature card
 * on the right, with Cancel / Save Changes below — stacked on narrow screens.
 *
 * Mirrors `app/settings/center-profile/center-profile-form.js`: `useActionState`,
 * blur-driven stale-error clearing with the same pure validator the server runs,
 * `state.values` to redisplay a failed submission (React resets uncontrolled
 * fields on every form action), the signature kept in `useProfilePhoto` state and
 * added to the submission, and a native Cancel (reset) — plus the controlled
 * pieces (title, tax switch) reset by hand.
 *
 * Business identity (name, address, phone, email, logo, time zone, currency)
 * is NOT here; it lives in Center Profile.
 *
 * The UI only manages settings. The database numbers the invoices, keeps the
 * counter, locks the starting number once an invoice exists, enforces the tax
 * rules and does the tax calculation; nothing here computes any of that.
 *
 * Starting number: blank = numbering not configured (no invoice is issued
 * automatically). Editable until the first invoice exists; then shown locked and
 * not submitted. Setting or changing it to a number asks for confirmation first.
 *
 * Tax: when off, the name and rate stay visible and disabled with their stored
 * values; disabled fields are not submitted, so the server leaves them as they were.
 */
export default function InvoiceReceiptForm({ action, settings, startingLocked, receiptStartingLocked = false, signatureUrl }) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [fieldErrors, setFieldErrors] = useState(state?.fieldErrors ?? {});
  const [documentTitle, setDocumentTitle] = useState(state?.values?.document_title || settings?.document_title || "invoice");
  const [taxEnabled, setTaxEnabled] = useState(
    state?.values ? parseTaxEnabled(state.values.tax_enabled) : Boolean(settings?.tax_enabled)
  );
  const [confirmNumber, setConfirmNumber] = useState(null);
  const { photo: signature, setPhoto: setSignature, appendTo } = useProfilePhoto();
  const formRef = useRef(null);
  const confirmedRef = useRef(false);

  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    setFieldErrors(state?.fieldErrors ?? {});
  }

  // React resets the form's DOM inputs when an action runs, so the signature (kept in
  // state, not in a named input) is added to the submission here. It is uploaded by the
  // server action, and only when the form saves.
  function submitForm(formData) {
    appendTo(formData);
    formAction(formData);
  }

  function handleReset() {
    setFieldErrors({});
    setSignature({ file: null, previewUrl: null, removed: false });
    setDocumentTitle(settings?.document_title ?? "invoice");
    setTaxEnabled(Boolean(settings?.tax_enabled));
  }

  function handleBlur(event) {
    const { name } = event.target;
    if (!BLUR_VALIDATED_FIELDS.has(name)) return;

    const result = validateInvoiceSettingsInput(readInput(new FormData(event.currentTarget)), { startingLocked, receiptStartingLocked });

    if (result.success || !result.errors[name]) {
      setFieldErrors((current) => {
        if (!(name in current)) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  }

  // Setting or changing the starting number to a number (before the first invoice) is confirmed
  // first. Clearing it, or leaving it as it is, is not. Invalid input falls through to the server,
  // which reports it against the field like every other form.
  function handleSubmit(event) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    if (startingLocked) return;

    const result = validateInvoiceSettingsInput(readInput(new FormData(event.currentTarget)), { startingLocked, receiptStartingLocked });
    const next = result.success ? result.data.starting_invoice_number : null;

    if (next !== null && next !== (settings?.starting_invoice_number ?? null)) {
      event.preventDefault();
      setConfirmNumber(next);
    }
  }

  function confirmAndSubmit() {
    setConfirmNumber(null);
    confirmedRef.current = true;
    formRef.current?.requestSubmit();
  }

  // Only the essential state is always visible; the explanation is in the (i) help.
  const startingState = startingLocked ? (
    <span className="inline-flex items-center gap-1.5">
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
      Locked — invoices have been issued.
    </span>
  ) : settings?.starting_invoice_number ? null : (
    "Not set — invoices are not issued automatically."
  );

  return (
    <>
      <form
        ref={formRef}
        action={submitForm}
        onSubmit={handleSubmit}
        onBlur={handleBlur}
        onReset={handleReset}
        className="flex flex-col gap-6"
        noValidate
      >
        {state?.error ? (
          <p
            role="alert"
            className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger"
          >
            {state.error}
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="flex flex-col gap-6 lg:col-span-3">
            <Panel className="flex flex-col gap-5">
              <PanelHeader className="mb-0" title="Document" />

              <FormField id="document_title" label="Document Title" error={fieldErrors.document_title}>
                {(field) => (
                  <Select
                    name="document_title"
                    items={DOCUMENT_TITLE_OPTIONS}
                    value={documentTitle}
                    onValueChange={setDocumentTitle}
                    disabled={isPending}
                  >
                    <SelectTrigger {...field}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TITLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="starting_invoice_number">Starting Invoice Number</Label>
                  <HelpPopover label="About the starting invoice number" title="Starting invoice number">
                    Enter the next number after your last existing invoice. For example, if your last invoice
                    was 1223, enter 1224. Once the first invoice is issued, the starting number cannot be
                    changed.
                  </HelpPopover>
                </div>
                <FormField
                  id="starting_invoice_number"
                  error={fieldErrors.starting_invoice_number}
                  help={startingState}
                >
                {(field) =>
                  startingLocked ? (
                    // Locked: shown, never submitted (no name), and the server ignores it as well.
                    <Input {...field} disabled readOnly value={String(settings?.starting_invoice_number ?? "")} />
                  ) : (
                    <Input
                      {...field}
                      name="starting_invoice_number"
                      inputMode="numeric"
                      autoComplete="off"
                      disabled={isPending}
                      defaultValue={state?.values?.starting_invoice_number ?? settings?.starting_invoice_number ?? ""}
                    />
                  )
                }
                </FormField>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="invoice_prefix">Invoice Number Prefix</Label>
                  <HelpPopover label="About the invoice number prefix" title="Invoice number prefix">
                    Optional prefix used for new invoices. Changing the prefix affects future invoices only;
                    existing invoices keep their original prefix.
                  </HelpPopover>
                </div>
                <FormField id="invoice_prefix" error={fieldErrors.invoice_prefix}>
                  {(field) => (
                    <Input
                      {...field}
                      name="invoice_prefix"
                      autoComplete="off"
                      disabled={isPending}
                      defaultValue={state?.values?.invoice_prefix ?? settings?.invoice_prefix ?? ""}
                    />
                  )}
                </FormField>
              </div>
            </Panel>

            {/* V1 Tax Adjustment: the separate sequence of non-tax payment receipts. */}
            <Panel className="flex flex-col gap-5">
              <PanelHeader className="mb-0" title="Payment Receipt Numbering" />

              <FormField
                id="payment_receipt_starting_number"
                label="Starting Payment Receipt Number"
                error={fieldErrors.payment_receipt_starting_number}
                help={
                  receiptStartingLocked
                    ? "Locked: a payment receipt has been issued."
                    : "Used for payments issued without a tax invoice. Its numbers never use or consume an invoice number."
                }
              >
                {(field) =>
                  receiptStartingLocked ? (
                    // Locked: shown, never submitted (no name), and the server ignores it as well.
                    <Input {...field} disabled readOnly value={String(settings?.payment_receipt_starting_number ?? "")} />
                  ) : (
                    <Input
                      {...field}
                      name="payment_receipt_starting_number"
                      inputMode="numeric"
                      autoComplete="off"
                      disabled={isPending}
                      defaultValue={state?.values?.payment_receipt_starting_number ?? settings?.payment_receipt_starting_number ?? ""}
                    />
                  )
                }
              </FormField>

              <FormField
                id="payment_receipt_prefix"
                label="Payment Receipt Number Prefix"
                error={fieldErrors.payment_receipt_prefix}
                help="Optional. Affects payment receipts issued afterwards only."
              >
                {(field) => (
                  <Input
                    {...field}
                    name="payment_receipt_prefix"
                    autoComplete="off"
                    disabled={isPending}
                    defaultValue={state?.values?.payment_receipt_prefix ?? settings?.payment_receipt_prefix ?? ""}
                  />
                )}
              </FormField>
            </Panel>

            <Panel className="flex flex-col gap-5">
              <PanelHeader
                className="mb-0"
                title="Tax"
                action={
                  <HelpPopover label="About tax" title="About tax">
                    Prices include tax. The membership amount is the final amount paid by the customer. Tax is
                    calculated from that amount when the invoice is issued.
                  </HelpPopover>
                }
              />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label id="tax_enabled-label">Enable tax on new invoices</Label>
                  <Switch
                    name="tax_enabled"
                    value="1"
                    uncheckedValue="0"
                    checked={taxEnabled}
                    onCheckedChange={setTaxEnabled}
                    disabled={isPending}
                    aria-labelledby="tax_enabled-label"
                  />
                </div>
                {!taxEnabled ? (
                  <p className="text-small text-text-secondary">Tax is not shown on new invoices.</p>
                ) : null}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField id="tax_name" label="Tax Name" required={taxEnabled} error={fieldErrors.tax_name}>
                  {(field) => (
                    <Input
                      {...field}
                      name="tax_name"
                      autoComplete="off"
                      disabled={isPending || !taxEnabled}
                      defaultValue={state?.values?.tax_name ?? settings?.tax_name ?? ""}
                    />
                  )}
                </FormField>

                <FormField id="tax_rate" label="Tax Rate (%)" required={taxEnabled} error={fieldErrors.tax_rate}>
                  {(field) => (
                    <Input
                      {...field}
                      name="tax_rate"
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={isPending || !taxEnabled}
                      defaultValue={state?.values?.tax_rate ?? settings?.tax_rate ?? ""}
                    />
                  )}
                </FormField>
              </div>

            </Panel>

            <Panel className="flex flex-col gap-5">
              <PanelHeader className="mb-0" title="Document Content" />

              <FormField id="terms" label="Terms & Conditions" error={fieldErrors.terms}>
                {(field) => (
                  <Textarea
                    {...field}
                    name="terms"
                    rows={5}
                    disabled={isPending}
                    defaultValue={state?.values?.terms ?? settings?.terms ?? ""}
                  />
                )}
              </FormField>

              <FormField id="signatory_name" label="Signatory Name" error={fieldErrors.signatory_name}>
                {(field) => (
                  <Input
                    {...field}
                    name="signatory_name"
                    autoComplete="off"
                    disabled={isPending}
                    defaultValue={state?.values?.signatory_name ?? settings?.signatory_name ?? ""}
                  />
                )}
              </FormField>

              <FormField
                id="signatory_designation"
                label="Signatory Designation"
                error={fieldErrors.signatory_designation}
              >
                {(field) => (
                  <Input
                    {...field}
                    name="signatory_designation"
                    autoComplete="off"
                    disabled={isPending}
                    defaultValue={state?.values?.signatory_designation ?? settings?.signatory_designation ?? ""}
                  />
                )}
              </FormField>
            </Panel>
          </div>

          <ProfilePhotoCard
            name=""
            label="Signature"
            noun="Signature"
            currentUrl={signatureUrl}
            photo={signature}
            onChange={setSignature}
            error={fieldErrors.photo}
            disabled={isPending}
            fit="contain"
            className="w-full self-start lg:col-span-2"
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-small flex flex-col gap-1 text-text-secondary">
            <p className="inline-flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Changes apply to invoices issued from now on. Issued invoices keep the details they were issued
              with.
            </p>
            <p className="pl-6">
              Center name, address, phone, email and logo come from{" "}
              <Link href="/settings/center-profile" className="font-medium text-brand hover:underline">
                Center Profile
              </Link>
              .
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="reset" variant="outline" disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmNumber !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmNumber(null);
        }}
        tone="warning"
        title="Set starting invoice number"
        context={
          <ContextCard
            mark={
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
              >
                <Receipt className="size-5" aria-hidden="true" />
              </span>
            }
            title="Invoice / Receipt settings"
            detail={`Starting invoice number: ${confirmNumber}`}
          />
        }
        description={`Invoice numbering will start at ${confirmNumber}. Once the first invoice is issued, the starting number is locked and cannot be changed.`}
        confirmLabel="Save"
        isPending={isPending}
        onConfirm={confirmAndSubmit}
      />
    </>
  );
}
