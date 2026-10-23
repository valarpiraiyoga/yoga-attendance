import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiStrip, KpiToggle } from "@/components/ui/kpi-visibility";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { getCenterCurrency, getCenterTimezone } from "@/lib/center-profile/settings";
import { getDocumentSummary, listDocuments } from "@/lib/documents/data";
import { DOCUMENTS_PAGE_SIZE, DOCUMENT_SORT_OPTIONS, parseDocumentListParams } from "@/lib/documents/list-core";
import { currentFinancialYear } from "@/lib/financial-year";
import { buildListHref } from "@/lib/url-params";
import DocumentFilters from "@/app/documents/document-filters";
import DocumentList from "@/app/documents/document-list";
import DocumentSummary from "@/app/documents/document-summary";

/**
 * Documents - the central register (Phase 1, read-only; 01-product.md section 5A "Documents Register", 02-ux.md "Documents").
 * Every stored invoice and receipt, issued and cancelled, across all memberships: search, filters, newest first, 10 per page, a
 * table from `lg` and cards below - the Memberships list pattern. It only reads: no document is issued, edited, cancelled or
 * corrected here. A payment with a cancelled document and its replacement appears as two rows. The KPI tiles above the toolbar
 * are center-wide figures (they ignore the search and filters); only Issued Value adds anything up, and only issued documents.
 */
export default async function DocumentsPage({ searchParams }) {
  // Authorization boundary. app/documents/layout.js also calls requireRole, but a layout does not re-run on client-side navigation
  // between sibling pages - see app/settings/layout.js for the full explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const params = parseDocumentListParams(rawParams);
  const { q, series, status, fromDate, toDate, page, view, sort } = params;

  const [{ documents, total }, summary, currency, timeZone] = await Promise.all([
    listDocuments(params),
    // The tiles must never take the list down: on a failure they show a dash and the register below still works.
    // (A Next.js redirect or not-found from the role check is re-thrown, never swallowed.)
    getDocumentSummary().catch((error) => {
      unstable_rethrow(error);
      return null;
    }),
    getCenterCurrency(),
    getCenterTimezone(),
  ]);
  // The Financial Year choices end at the centre's current financial year, read from the centre's own day.
  const financialYear = currentFinancialYear(new Date(), timeZone);
  const totalPages = Math.max(1, Math.ceil(total / DOCUMENTS_PAGE_SIZE));

  // A page past the last one (a stale link, or a filter that shrank the list): go to the last page.
  if (documents.length === 0 && total > 0) {
    redirect(buildListHref("/documents", rawParams, { page: totalPages }));
  }

  const isFiltered = Boolean(q) || series !== "all" || status !== "all" || Boolean(fromDate) || Boolean(toDate);

  return (
    <>
      <PageHeader
        compact
        title="Documents"
        description="Every invoice and receipt, issued and cancelled, across all memberships."
        icon={<FileText className="size-6" />}
        actions={<KpiToggle pageKey="documents" />}
      />

      <Container>
        {/* The KPI tiles are off until the person turns them on (the KPIs button; the shared default is hidden). */}
        <KpiStrip pageKey="documents">
          <DocumentSummary summary={summary} currency={currency} />
        </KpiStrip>

        <DocumentFilters
          key={`${series}:${status}:${fromDate}:${toDate}`}
          defaultQuery={q}
          defaultSeries={series}
          defaultStatus={status}
          defaultFromDate={fromDate}
          defaultToDate={toDate}
          view={view}
          currentFinancialYear={financialYear}
        />

        {documents.length === 0 ? (
          <EmptyState
            className="mt-6"
            title={isFiltered ? undefined : "No documents yet"}
            description={isFiltered ? "No documents match your search or filters." : "Invoices and receipts appear here once they are issued."}
            action={
              isFiltered ? (
                <Button variant="secondary" render={<Link href="/documents" />} nativeButton={false}>
                  Clear Filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <DocumentList documents={documents} view={view} total={total} sort={sort} sortOptions={DOCUMENT_SORT_OPTIONS} />

            <Pagination
              className="mt-4"
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={DOCUMENTS_PAGE_SIZE}
              itemLabel="documents"
              ariaLabel="Document list pagination"
              getHref={(targetPage) => buildListHref("/documents", rawParams, { page: targetPage })}
            />
          </>
        )}
      </Container>
    </>
  );
}
