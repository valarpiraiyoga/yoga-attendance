import Link from "next/link";
import { Banknote, CalendarDays, CreditCard, Receipt, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import EntityCard from "@/components/ui/entity-card";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { DOCUMENT_STATUS } from "@/lib/documents/status";

/**
 * Document list card: the document number (primary, a link to the document) with its stored title beneath it, the status badge,
 * and the customer on the document, the membership number (a link to Membership Details), the document date and the amount. The
 * same data and links as a table row; the cancelled and the replacement documents are separate cards. Read-only.
 */
export default function DocumentCardItem({ document }) {
  const status = DOCUMENT_STATUS[document.status];
  const customer = [document.customerName, document.customerCode].filter(Boolean).join(" · ");

  return (
    <EntityCard
      className="h-auto"
      iconClassName="text-brand"
      avatar={
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <Receipt className="size-5" />
        </span>
      }
      title={
        <Link href={document.href} className="text-brand hover:underline">
          {document.number}
        </Link>
      }
      subtitle={document.titleLabel}
      status={<Badge variant={status.variant}>{status.label}</Badge>}
      statusPlacement="actions"
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-brand hover:bg-brand/10 hover:text-brand"
          aria-label={`Open ${document.titleLabel} ${document.number}`}
          title="Open document"
          render={<Link href={document.href} />}
          nativeButton={false}
        >
          <Receipt className="size-4" aria-hidden="true" />
        </Button>
      }
      meta={[
        { icon: User, label: customer, title: customer },
        {
          icon: CreditCard,
          label: document.membershipCode ? (
            <Link href={document.membershipHref} className="font-medium text-brand hover:underline">
              {document.membershipCode}
            </Link>
          ) : (
            "—"
          ),
        },
        { icon: CalendarDays, label: formatDate(document.documentDate) },
        { icon: Banknote, label: <span className="font-medium text-text-primary">{formatCurrency(document.amount, document.currency)}</span> },
      ]}
    />
  );
}
