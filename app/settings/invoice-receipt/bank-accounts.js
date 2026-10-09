"use client";

import { useState, useTransition } from "react";
import { Landmark, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import ContextCard from "@/components/ui/context-card";
import FormField from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeader } from "@/components/layout/Panel";
import { activateBankAccount, addBankAccount, deactivateBankAccount, editBankAccount } from "@/lib/bank-accounts/actions";
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_ACCOUNT_NUMBER_LENGTH,
  MAX_BANK_NAME_LENGTH,
  MAX_BRANCH_LENGTH,
  MAX_IFSC_CODE_LENGTH,
  maskAccountNumber,
  validateBankAccountInput,
} from "@/lib/bank-accounts/validation";

const EMPTY_FORM = { bank_name: "", account_name: "", account_number: "", ifsc_code: "", branch: "" };

// The two status changes, as the confirmation they ask for. The switch itself is the database's.
const STATUS_CHANGES = {
  activate: {
    title: "Activate this bank account?",
    description: "The currently active bank account will become inactive.",
    confirmLabel: "Activate",
    pendingLabel: "Activating…",
    run: activateBankAccount,
  },
  deactivate: {
    title: "Deactivate this bank account?",
    description: "New invoices will not include bank details until another account is activated.",
    confirmLabel: "Deactivate",
    pendingLabel: "Deactivating…",
    run: deactivateBankAccount,
  },
};

function formOf(account) {
  return {
    bank_name: account.bank_name,
    account_name: account.account_name,
    account_number: account.account_number,
    ifsc_code: account.ifsc_code,
    branch: account.branch ?? "",
  };
}

// The "which record is this about?" card of a popup: the bank account, or the section for a new one.
function AccountContext({ account }) {
  return (
    <ContextCard
      mark={
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Landmark className="size-5" aria-hidden="true" />
        </span>
      }
      title={account ? account.bank_name : "New bank account"}
      detail={account ? `${account.account_name} · ${maskAccountNumber(account.account_number)}` : "Invoice / Receipt settings"}
    />
  );
}

// One label above its value, for the account card.
function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-text-secondary">{label}</dt>
      <dd className="text-body break-words text-text-primary tabular-nums">{children}</dd>
    </div>
  );
}

function AccountCard({ account, disabled, onEdit, onStatusChange }) {
  const active = account.is_active;

  return (
    <li
      className={
        active
          ? "rounded-card border border-brand/40 bg-brand/5 p-4"
          : "rounded-card border border-border bg-surface p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-body min-w-0 font-semibold break-words text-text-primary">{account.bank_name}</p>
          <Badge variant={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={() => onEdit(account)}>
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onStatusChange(active ? "deactivate" : "activate", account)}
          >
            {active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Detail label="Account name">{account.account_name}</Detail>
        <Detail label="Account number">{maskAccountNumber(account.account_number)}</Detail>
        <Detail label="IFSC code">{account.ifsc_code}</Detail>
        {account.branch ? <Detail label="Branch">{account.branch}</Detail> : null}
      </dl>
    </li>
  );
}

/**
 * Settings — Invoice / Receipt — Bank Accounts (supabase/migrations/0028). Admin-only: the page
 * that renders it requires the Admin role, and the actions and the database check it again.
 *
 * A list of the accounts, each with Edit and Activate / Deactivate, and Add Bank Account. There
 * is no Delete. Activating or deactivating is one call to the database function (through the
 * server action) after a confirmation — which account is active is never worked out here, and
 * the list simply re-renders from the server after each change. Only new invoices are affected:
 * an issued invoice keeps the bank details it was issued with.
 */
export default function BankAccounts({ accounts }) {
  // null = closed; { account: null } = adding; { account } = editing that one.
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  // null = closed; { kind: "activate" | "deactivate", account }
  const [statusChange, setStatusChange] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [isPending, startTransition] = useTransition();

  function openEditor(account) {
    setForm(account ? formOf(account) : EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setEditor({ account });
  }

  function closeEditor(open) {
    if (!open) setEditor(null);
  }

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function saveAccount() {
    const checked = validateBankAccountInput(form);
    if (!checked.success) {
      setFieldErrors(checked.errors);
      setFormError(null);
      return;
    }

    startTransition(async () => {
      const result = editor.account
        ? await editBankAccount(editor.account.id, form)
        : await addBankAccount(form);

      if (result?.error) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
        return;
      }
      setEditor(null);
    });
  }

  function openStatusChange(kind, account) {
    setStatusError(null);
    setStatusChange({ kind, account });
  }

  function closeStatusChange(open) {
    if (!open) setStatusChange(null);
  }

  function changeStatus() {
    const { kind, account } = statusChange;
    startTransition(async () => {
      const result = await STATUS_CHANGES[kind].run(account.id);
      if (result?.error) {
        setStatusError(result.error);
        return;
      }
      setStatusChange(null);
    });
  }

  const change = statusChange ? STATUS_CHANGES[statusChange.kind] : null;
  const editing = Boolean(editor?.account);

  return (
    <Panel className="flex flex-col gap-4">
      <PanelHeader
        className="mb-0"
        title="Bank Accounts"
        description="Manage bank accounts used on new invoices. Changes apply to invoices issued from now on."
        action={
          <Button type="button" variant="outline" onClick={() => openEditor(null)}>
            <Plus className="size-4" aria-hidden="true" />
            Add Bank Account
          </Button>
        }
      />

      {statusError && !statusChange ? (
        <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          {statusError}
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-4 py-8 text-center">
          <Landmark className="size-6 text-text-secondary" aria-hidden="true" />
          <p className="text-body font-medium text-text-primary">No bank accounts yet</p>
          <p className="text-small text-text-secondary">
            Add one and activate it to show bank details on new invoices.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              disabled={isPending}
              onEdit={openEditor}
              onStatusChange={openStatusChange}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={editor !== null}
        onOpenChange={closeEditor}
        title={editing ? "Edit bank account" : "Add bank account"}
        size="lg"
        context={<AccountContext account={editor?.account} />}
        description={
          editing
            ? "Changes apply to invoices issued from now on."
            : "A new account is inactive until you activate it."
        }
        confirmLabel={editing ? "Save Changes" : "Add Account"}
        isPending={isPending}
        onConfirm={saveAccount}
      >
        <div className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              {formError}
            </p>
          ) : null}

          <FormField id="bank-name" label="Bank Name" required error={fieldErrors.bank_name}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={MAX_BANK_NAME_LENGTH}
                disabled={isPending}
                value={form.bank_name}
                onChange={(event) => setField("bank_name", event.target.value)}
              />
            )}
          </FormField>

          <FormField id="bank-account-name" label="Account Name" required error={fieldErrors.account_name}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={MAX_ACCOUNT_NAME_LENGTH}
                disabled={isPending}
                value={form.account_name}
                onChange={(event) => setField("account_name", event.target.value)}
              />
            )}
          </FormField>

          <FormField id="bank-account-number" label="Account Number" required error={fieldErrors.account_number}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                inputMode="numeric"
                maxLength={MAX_ACCOUNT_NUMBER_LENGTH}
                disabled={isPending}
                value={form.account_number}
                onChange={(event) => setField("account_number", event.target.value)}
              />
            )}
          </FormField>

          <FormField id="bank-ifsc-code" label="IFSC Code" required error={fieldErrors.ifsc_code}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={MAX_IFSC_CODE_LENGTH}
                disabled={isPending}
                value={form.ifsc_code}
                onChange={(event) => setField("ifsc_code", event.target.value)}
              />
            )}
          </FormField>

          <FormField id="bank-branch" label="Branch" error={fieldErrors.branch}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={MAX_BRANCH_LENGTH}
                disabled={isPending}
                value={form.branch}
                onChange={(event) => setField("branch", event.target.value)}
              />
            )}
          </FormField>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={statusChange !== null}
        onOpenChange={closeStatusChange}
        tone={statusChange?.kind === "deactivate" ? "warning" : "info"}
        title={change?.title ?? ""}
        context={<AccountContext account={statusChange?.account} />}
        description={change?.description}
        confirmLabel={change?.confirmLabel}
        pendingLabel={change?.pendingLabel}
        isPending={isPending}
        onConfirm={changeStatus}
      >
        {statusError ? (
          <p role="alert" className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
            {statusError}
          </p>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}
