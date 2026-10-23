import Link from "next/link";
import { CalendarDays, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Avatar from "@/components/ui/avatar";
import AnimatedBorder from "@/components/ui/animated-border";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { DOCUMENT_STATUS } from "@/lib/documents/status";
import { cn } from "@/lib/utils";
import DocumentRowActions from "@/app/documents/document-row-actions";

// Responsive by the table's own width (container queries), not the viewport - the rule of the Memberships and Students tables.
// Narrowest: Document (the number and its type, with the customer beneath it), Status, Actions. From 40rem: Customer as its own column.
// From 42rem: Membership, Date and Amount - the whole table.
const CUSTOMER_ONLY = "hidden @[40rem]:table-cell";
const DETAIL_ONLY = "hidden @[42rem]:table-cell";

// Each document is its own rounded row card on the page background (the table is `border-separate`, with a gap between rows) - the same look
// as the Students and Memberships tables: a pale rounded header strip, and every row's cells carry the surface and the pale border, rounded at
// the row's two ends. The hover border is the shared animated one (`.card-border-animated-row`, drawn by `AnimatedBorder` in the first cell).
const HEAD = "h-10 border-y border-border/60 bg-brand/5 px-2 text-small tracking-normal first:rounded-l-lg first:border-l last:rounded-r-lg last:border-r";
const CELL = "border-y border-border bg-surface px-2 py-3 first:rounded-l-card first:border-l last:rounded-r-card last:border-r";

// The document tile's tint follows the stored status: issued is the brand tint, cancelled is danger (presentation only).
const TILE = { issued: "bg-brand/10 text-brand", cancelled: "bg-danger/10 text-danger" };

function DocumentRow({ document }) {
  const status = DOCUMENT_STATUS[document.status];

  return (
    <TableRow className="card-border-animated-row border-0 [--card-border-inset:0px] [--card-border-radius:var(--radius-card)] hover:bg-transparent">
      <TableCell className={cn(CELL, "py-3 pr-2 pl-3")}>
        {/* The row's hover border: drawn from the first cell, sized to the whole row (see `.card-border-animated-row`). */}
        <AnimatedBorder />
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", TILE[document.status] ?? TILE.issued)}>
            <FileText className="size-5" />
          </span>
          <div className="min-w-0">
            <Link href={document.href} className="text-body font-semibold whitespace-nowrap text-brand hover:underline">
              {document.number}
            </Link>
            <p className="text-small text-text-secondary">{document.titleLabel}</p>
            {/* Below 40rem the customer has no column of its own. */}
            <p className="text-small text-text-secondary @[40rem]:hidden">{document.customerName}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, CUSTOMER_ONLY)}>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={document.customerName} size="lg" />
          <div className="min-w-0">
            <p className="text-body font-semibold text-text-primary">
              {document.studentHref ? (
                <Link href={document.studentHref} className="rounded-sm text-brand hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  {document.customerName}
                </Link>
              ) : (
                document.customerName
              )}
            </p>
            <p className="text-small text-text-secondary">{document.customerCode}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "whitespace-nowrap", DETAIL_ONLY)}>
        {document.membershipCode ? (
          <Link href={document.membershipHref} className="text-body font-semibold text-brand hover:underline">
            {document.membershipCode}
          </Link>
        ) : (
          <span className="text-text-secondary">{"—"}</span>
        )}
      </TableCell>
      <TableCell className={cn(CELL, "whitespace-nowrap", DETAIL_ONLY)}>
        <span className="text-body inline-flex items-center gap-2 text-text-secondary">
          <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
          {formatDate(document.documentDate)}
        </span>
      </TableCell>
      <TableCell className={cn(CELL, "text-right whitespace-nowrap tabular-nums", DETAIL_ONLY)}>
        <span className="text-body font-semibold text-text-primary">{formatCurrency(document.amount, document.currency)}</span>
      </TableCell>
      <TableCell className={CELL}>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell className={cn(CELL, "w-px py-3 pr-3 pl-1 whitespace-nowrap")}>
        <DocumentRowActions document={document} />
      </TableCell>
    </TableRow>
  );
}

/** The Documents table: see `DocumentRow` for the columns. Every row is one stored document; cancelled ones and replacements both show. */
export default function DocumentTable({ documents }) {
  return (
    <div className="@container">
      <Table aria-label="Documents" className="border-separate border-spacing-y-2">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(HEAD, "pl-3")}>Document</TableHead>
            <TableHead className={cn(HEAD, CUSTOMER_ONLY)}>Customer</TableHead>
            <TableHead className={cn(HEAD, DETAIL_ONLY)}>Membership</TableHead>
            <TableHead className={cn(HEAD, DETAIL_ONLY)}>Date</TableHead>
            <TableHead className={cn(HEAD, "text-right", DETAIL_ONLY)}>Amount</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={cn(HEAD, "w-px pr-3 pl-1 whitespace-nowrap")}>Actions</TableHead>
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
