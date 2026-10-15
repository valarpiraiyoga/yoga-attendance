import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { DOCUMENT_STATUS } from "@/lib/documents/status";
import { cn } from "@/lib/utils";

// Responsive by the table's own width (container queries), not the viewport - the rule of the Memberships and Students tables.
// Narrowest: Document (the number, with the customer beneath it), Status. From 40rem: Customer as its own column. From 42rem:
// Membership, Date and Amount. From 52rem: Type - the whole table.
const CUSTOMER_ONLY = "hidden @[40rem]:table-cell";
const DETAIL_ONLY = "hidden @[42rem]:table-cell";
const TYPE_ONLY = "hidden @[52rem]:table-cell";

const HEAD = "h-10 px-2 text-small tracking-normal";

function DocumentRow({ document }) {
  const status = DOCUMENT_STATUS[document.status];

  return (
    <TableRow>
      <TableCell className="py-3 pr-2 pl-3">
        <Link href={document.href} className="text-body font-semibold whitespace-nowrap text-brand hover:underline">
          {document.number}
        </Link>
        {/* Below 40rem the customer and below 52rem the type have no column of their own. */}
        <p className="text-small text-text-secondary @[40rem]:hidden">{document.customerName}</p>
        <p className="text-small text-text-secondary @[52rem]:hidden">{document.titleLabel}</p>
      </TableCell>
      <TableCell className={cn("px-2 py-3", CUSTOMER_ONLY)}>
        <p className="text-body font-semibold text-text-primary">{document.customerName}</p>
        <p className="text-small text-text-secondary">{document.customerCode}</p>
      </TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap", DETAIL_ONLY)}>
        {document.membershipCode ? (
          <Link href={document.membershipHref} className="text-body font-medium text-brand hover:underline">
            {document.membershipCode}
          </Link>
        ) : (
          <span className="text-text-secondary">{"—"}</span>
        )}
      </TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap text-text-secondary", TYPE_ONLY)}>{document.titleLabel}</TableCell>
      <TableCell className={cn("px-2 py-3 whitespace-nowrap text-text-secondary", DETAIL_ONLY)}>{formatDate(document.documentDate)}</TableCell>
      <TableCell className={cn("px-2 py-3 text-right whitespace-nowrap text-text-primary tabular-nums", DETAIL_ONLY)}>
        {formatCurrency(document.amount, document.currency)}
      </TableCell>
      <TableCell className="px-2 py-3 pr-3">
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
    </TableRow>
  );
}

/** The Documents table: see `DocumentRow` for the columns. Every row is one stored document; cancelled ones and replacements both show. */
export default function DocumentTable({ documents }) {
  return (
    <div className="@container overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      <Table aria-label="Documents">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Document</TableHead>
            <TableHead className={cn(HEAD, CUSTOMER_ONLY)}>Customer</TableHead>
            <TableHead className={cn(HEAD, DETAIL_ONLY)}>Membership</TableHead>
            <TableHead className={cn(HEAD, TYPE_ONLY)}>Type</TableHead>
            <TableHead className={cn(HEAD, DETAIL_ONLY)}>Date</TableHead>
            <TableHead className={cn(HEAD, "text-right", DETAIL_ONLY)}>Amount</TableHead>
            <TableHead className={cn(HEAD, "pr-3")}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
