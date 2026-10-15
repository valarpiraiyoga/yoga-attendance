import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/Container";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { requireRole, ROLES } from "@/lib/auth/dal";
import { listDocuments } from "@/lib/documents/data";
import { DOCUMENTS_PAGE_SIZE, DOCUMENT_SORT_OPTIONS, parseDocumentListParams } from "@/lib/documents/list-core";
import { buildListHref } from "@/lib/url-params";
import DocumentFilters from "@/app/documents/document-filters";
import DocumentList from "@/app/documents/document-list";

/**
 * Documents - the central register (Phase 1, read-only; 01-product.md section 5A "Documents Register", 02-ux.md "Documents").
 * Every stored invoice and receipt, issued and cancelled, across all memberships: search, filters, newest first, 10 per page, a
 * table from `lg` and cards below - the Memberships list pattern. It only reads: no document is issued, edited, cancelled or
 * corrected here, and nothing is summed (a payment with a cancelled document and its replacement appears as two rows).
 */
export default async function DocumentsPage({ searchParams }) {
  // Authorization boundary. app/documents/layout.js also calls requireRole, but a layout does not re-run on client-side navigation
  // between sibling pages - see app/settings/layout.js for the full explanation.
  await requireRole(ROLES.ADMIN);

  const rawParams = await searchParams;
  const params = parseDocumentListParams(rawParams);
  const { q, series, status, fromDate, toDate, page, view, sort } = params;

  const { documents, total } = await listDocuments(params);
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
      />

      <Container>
        <DocumentFilters
          key={`${series}:${status}:${fromDate}:${toDate}`}
          defaultQuery={q}
          defaultSeries={series}
          defaultStatus={status}
          defaultFromDate={fromDate}
          defaultToDate={toDate}
          view={view}
        />

        {documents.length === 0 ? (
          <EmptyState
            className="mt-6"
            title={isFiltered ? undefined : "No documents yet"}
            description={isFiltered ? "No documents match your search or filters." : "Invoices and receipts appear here once they are issued."}
            action={
              isFiltered ? (
                <Button variant="outline" render={<Link href="/documents" />} nativeButton={false}>
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
