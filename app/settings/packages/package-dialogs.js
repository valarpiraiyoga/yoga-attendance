"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import Alert from "@/components/ui/alert";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPackage, setPackageStatus, updatePackageDetails, updatePackageTerms } from "@/lib/packages/actions";
import { DURATION_LABELS, DURATION_OPTIONS_ORDER, KIND_LABELS } from "@/lib/packages/labels";
import { PACKAGE_DESCRIPTION_MAX, PACKAGE_NAME_MAX } from "@/lib/packages/service-core";
import PackageContext from "@/app/settings/packages/package-context";
import { ReasonField } from "@/app/settings/packages/fee-fields";
import { usePackageAction } from "@/app/settings/packages/use-package-action";
import { showSuccessToast } from "@/components/ui/success-toast";

const KIND_ITEMS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));

/** The form-level error of a dialog; a field error is shown beside its field. */
function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <Alert variant="danger" role="alert">
      {error}
    </Alert>
  );
}

/** Checkboxes for the duration options a package offers. */
function OptionsField({ selected, onChange, error, disabled }) {
  function toggle(option) {
    onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  }
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-body font-medium text-text-primary">
        Duration options offered{" "}
        <span className="text-danger" aria-hidden="true">
          *
        </span>
      </legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {DURATION_OPTIONS_ORDER.map((option) => (
          <label key={option} className="text-body flex items-center gap-2 text-text-primary">
            <input type="checkbox" className="size-4 accent-brand" checked={selected.includes(option)} onChange={() => toggle(option)} />
            {DURATION_LABELS[option]}
          </label>
        ))}
      </div>
      <p className="text-small text-text-secondary">Custom lets the Admin choose a whole number of months for each membership.</p>
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function NameFields({ name, setName, description, setDescription, fieldErrors, disabled }) {
  return (
    <>
      <FormField id="package-name" label="Package name" error={fieldErrors.name} required>
        {(field) => (
          <Input {...field} value={name} onChange={(event) => setName(event.target.value)} maxLength={PACKAGE_NAME_MAX} disabled={disabled} autoComplete="off" />
        )}
      </FormField>
      <FormField id="package-description" label="Description" error={fieldErrors.description} help="Optional.">
        {(field) => (
          <Textarea {...field} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={PACKAGE_DESCRIPTION_MAX} disabled={disabled} />
        )}
      </FormField>
    </>
  );
}

/** Add Package: name, description, type, and the class allowance or the offered options. Fees are scheduled afterwards. */
export function AddPackageButton({ className }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("duration");
  const [totalClasses, setTotalClasses] = useState("");
  const [options, setOptions] = useState(["monthly", "quarterly", "half_yearly", "annual"]);
  const { error, fieldErrors, isPending, run, reset } = usePackageAction((result) => {
    setOpen(false);
    showSuccessToast("Package created successfully.");
    router.push(`/settings/packages/${result.packageId}`);
  });

  function handleOpenChange(next) {
    if (next) {
      reset();
      setName("");
      setDescription("");
      setKind("duration");
      setTotalClasses("");
    }
    setOpen(next);
  }

  return (
    <>
      <Button className={className} onClick={() => handleOpenChange(true)}>
        <Plus className="size-4" aria-hidden="true" />
        Add Package
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Add package"
        context={<PackageContext title="New package" detail="Fees are scheduled after it is created" />}
        description="Create the package first, then schedule its fee on the package page."
        confirmLabel="Create Package"
        isPending={isPending}
        onConfirm={() => run(() => createPackage({ name, description, kind, totalClasses, options: kind === "duration" ? options : [] }))}
      >
        <div className="flex flex-col gap-4 text-left">
          <ErrorBanner error={error} />
          <NameFields name={name} setName={setName} description={description} setDescription={setDescription} fieldErrors={fieldErrors} disabled={isPending} />
          <FormField id="package-kind" label="Package type" help="The type cannot be changed once the package has options or fees." required>
            {(field) => (
              <Select items={KIND_ITEMS} value={kind} onValueChange={setKind} disabled={isPending}>
                <SelectTrigger {...field}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {kind === "duration" ? (
            <OptionsField selected={options} onChange={setOptions} error={fieldErrors.options} disabled={isPending} />
          ) : (
            <FormField id="package-classes" label="Number of classes" error={fieldErrors.totalClasses} required>
              {(field) => (
                <Input {...field} inputMode="numeric" value={totalClasses} onChange={(event) => setTotalClasses(event.target.value)} disabled={isPending} />
              )}
            </FormField>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Edit Details: name and description. */
export function EditDetailsButton({ pkg }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(pkg.name);
  const [description, setDescription] = useState(pkg.description ?? "");
  const { error, fieldErrors, isPending, run, reset } = usePackageAction(() => {
    setOpen(false);
    showSuccessToast("Package details updated successfully.");
  });

  function handleOpenChange(next) {
    if (next) {
      reset();
      setName(pkg.name);
      setDescription(pkg.description ?? "");
    }
    setOpen(next);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => handleOpenChange(true)}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Edit package details"
        context={<PackageContext pkg={pkg} />}
        description="Renaming a package does not change memberships already created."
        confirmLabel="Save"
        isPending={isPending}
        onConfirm={() => run(() => updatePackageDetails(pkg.id, { name, description }))}
      >
        <div className="flex flex-col gap-4 text-left">
          <ErrorBanner error={error} />
          <NameFields name={name} setName={setName} description={description} setDescription={setDescription} fieldErrors={fieldErrors} disabled={isPending} />
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Edit Terms: the class allowance (class-count) or the offered options (duration). Applies to future purchases only. */
export function EditTermsButton({ pkg }) {
  const [open, setOpen] = useState(false);
  const [totalClasses, setTotalClasses] = useState(String(pkg.total_classes ?? ""));
  const [options, setOptions] = useState(pkg.options);
  const [reason, setReason] = useState("");
  const { error, fieldErrors, isPending, run, reset } = usePackageAction(() => {
    setOpen(false);
    showSuccessToast("Package terms updated successfully.");
  });

  function handleOpenChange(next) {
    if (next) {
      reset();
      setTotalClasses(String(pkg.total_classes ?? ""));
      setOptions(pkg.options);
      setReason("");
    }
    setOpen(next);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => handleOpenChange(true)}>
        <Pencil className="size-4" aria-hidden="true" />
        Edit
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Edit package terms"
        context={<PackageContext pkg={pkg} />}
        description="Changed terms apply to memberships created afterwards. Existing memberships are never changed."
        confirmLabel="Save Terms"
        isPending={isPending}
        onConfirm={() => run(() => updatePackageTerms(pkg.id, pkg.kind === "class_count" ? { totalClasses, reason } : { options, reason }))}
      >
        <div className="flex flex-col gap-4 text-left">
          <ErrorBanner error={error} />
          {pkg.kind === "class_count" ? (
            <FormField id="terms-classes" label="Number of classes" error={fieldErrors.totalClasses} required>
              {(field) => (
                <Input {...field} inputMode="numeric" value={totalClasses} onChange={(event) => setTotalClasses(event.target.value)} disabled={isPending} />
              )}
            </FormField>
          ) : (
            <OptionsField selected={options} onChange={setOptions} error={fieldErrors.options} disabled={isPending} />
          )}
          <ReasonField id="terms-reason" value={reason} onChange={setReason} error={fieldErrors.reason} disabled={isPending} help="Optional. Kept in the package history." />
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Deactivate (no new purchases) or reactivate. Packages are never deleted. */
export function StatusButton({ pkg }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const deactivating = pkg.status === "active";
  const { error, fieldErrors, isPending, run, reset } = usePackageAction(() => {
    setOpen(false);
    showSuccessToast(deactivating ? "Package deactivated successfully." : "Package activated successfully.");
  });

  function handleOpenChange(next) {
    if (next) {
      reset();
      setReason("");
    }
    setOpen(next);
  }

  return (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(true)}>
        <Power className="size-4" aria-hidden="true" />
        {deactivating ? "Deactivate" : "Reactivate"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={deactivating ? "Deactivate package" : "Reactivate package"}
        context={<PackageContext pkg={pkg} />}
        description={
          deactivating
            ? "A deactivated package cannot be chosen for new memberships. Existing memberships and the package history are kept."
            : "The package can be chosen for new memberships again."
        }
        tone={deactivating ? "warning" : "info"}
        confirmLabel={deactivating ? "Deactivate" : "Reactivate"}
        isPending={isPending}
        onConfirm={() => run(() => setPackageStatus(pkg.id, { status: deactivating ? "inactive" : "active", reason }))}
      >
        <div className="flex flex-col gap-4 text-left">
          <ErrorBanner error={error} />
          <ReasonField id="status-reason" value={reason} onChange={setReason} error={fieldErrors.reason} disabled={isPending} help="Optional." />
        </div>
      </ConfirmDialog>
    </>
  );
}
