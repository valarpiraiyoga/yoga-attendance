import { CardGrid, ResultsHeader } from "@/components/layout/list-page";
import SortSelect from "@/components/ui/sort-select";
import { DEFAULT_DOCUMENT_SORT } from "@/lib/documents/list-core";
import { cn } from "@/lib/utils";
import DocumentCardItem from "@/app/documents/document-card-item";
import DocumentTable from "@/app/documents/document-table";

/**
 * Document results: the summary row ("N Documents", with "Sort by" on its right) over either the card grid or the table - the
 * Memberships list's layout. `view` is `"cards"`, `"table"`, or `""` (no explicit choice in the URL): then both are rendered and
 * CSS shows Cards below `lg` and Table from `lg` up. The same data and the same links in both layouts. Read-only: a row only
 * links to its document and its membership.
 */
export default function DocumentList({ documents, view = "", total, sort, sortOptions }) {
  return (
    <div className="mt-5">
      <ResultsHeader
        count={total}
        label={total === 1 ? "Document" : "Documents"}
        className="mb-3 flex-row items-center justify-between"
        aside={<SortSelect
            id="document-sort"
            options={sortOptions}
            value={sort}
            defaultValue={DEFAULT_DOCUMENT_SORT}
            triggerClassName="w-56"
            compactOnMobile
          />}
      />

      {view !== "table" ? (
        <CardGrid ariaLabel="Documents" className={cn("items-start xl:grid-cols-3", view === "" && "lg:hidden")}>
          {documents.map((document) => (
            <DocumentCardItem key={document.id} document={document} />
          ))}
        </CardGrid>
      ) : null}

      {view !== "cards" ? (
        <div className={cn(view === "" && "hidden lg:block")}>
          <DocumentTable documents={documents} />
        </div>
      ) : null}
    </div>
  );
}
