import { Receipt } from "lucide-react";
import { requireRole, ROLES } from "@/lib/auth/dal";
import TabContentHeading from "@/components/layout/TabContentHeading";
import { getInvoiceSettings, getSignaturePreviewUrl, hasAnyInvoice, hasAnyPaymentReceipt } from "@/lib/invoice-settings/data";
import { updateInvoiceSettings } from "@/lib/invoice-settings/actions";
import { getBankAccounts } from "@/lib/bank-accounts/data";
import InvoiceReceiptForm from "@/app/settings/invoice-receipt/invoice-receipt-form";
import BankAccounts from "@/app/settings/invoice-receipt/bank-accounts";

const SUCCESS_MESSAGES = {
  updated: "Invoice / Receipt settings updated successfully.",
};

/**
 * Settings — Invoice / Receipt (V1 Invoice / Receipt Enhancement;
 * `01-product.md` §11 "Invoice / Receipt Settings"). The fourth Settings tab,
 * built exactly like Center Profile.
 *
 * Repeats `requireRole` even though `app/settings/layout.js` also calls it — a
 * layout does not re-run on client-side navigation between sibling pages (see
 * that layout's own comment), so every page under /settings asserts this
 * itself. The data functions require the Admin role too.
 *
 * `getInvoiceSettings` returns exactly one row once migration 0025 is applied;
 * the `null` branch exists only so a genuinely missing row fails honestly.
 * `hasAnyInvoice` tells the form whether the starting number is locked (an
 * invoice has been issued — the database enforces the lock). The signature is
 * in a private bucket, so its preview is a temporary signed link.
 *
 * Bank Accounts (0028) sit below the form, outside it: they have their own actions and dialogs and
 * are not part of the settings save.
 */
export default async function InvoiceReceiptSettingsPage({ searchParams }) {
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const message = SUCCESS_MESSAGES[rawParams?.success] ?? null;

  const [settings, startingLocked, receiptStartingLocked, bankAccounts] = await Promise.all([
    getInvoiceSettings(),
    hasAnyInvoice(),
    hasAnyPaymentReceipt(),
    getBankAccounts(),
  ]);
  const signatureUrl = settings?.signature_path ? await getSignaturePreviewUrl(settings.signature_path) : null;

  return (
    <div>
      <div className="mb-6">
        <TabContentHeading
          icon={Receipt}
          title="Invoice / Receipt"
          description="Configure the document issued for paid memberships. Changes apply to invoices issued from now on."
        />
      </div>

      {message ? (
        <div
          role="status"
          className="mb-6 rounded-input border border-success/30 bg-success/5 px-3 py-2 text-body text-success"
        >
          {message}
        </div>
      ) : null}

      {settings ? (
        <div className="flex flex-col gap-6">
          <InvoiceReceiptForm
            action={updateInvoiceSettings}
            settings={settings}
            startingLocked={startingLocked}
            receiptStartingLocked={receiptStartingLocked}
            signatureUrl={signatureUrl}
          />

          {bankAccounts ? (
            <BankAccounts accounts={bankAccounts} />
          ) : (
            <p className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
              The bank accounts could not be loaded. Try refreshing the page.
            </p>
          )}
        </div>
      ) : (
        <p className="text-body rounded-input border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
          The invoice settings could not be loaded. Try refreshing the page.
        </p>
      )}
    </div>
  );
}
